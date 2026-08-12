(function initializeScroll2PDFIframeExpansion(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFIframeExpansion) {
    return;
  }

  const { CAPTURE_LIMITS } = globalScope.Scroll2PDFConstants;
  const {
    findBestScrollContainer,
    windowCanScroll,
  } = globalScope.Scroll2PDFCaptureUtils;
  const stability = globalScope.Scroll2PDFCaptureStability;

  const EXPANSION_TOLERANCE_CSS = 2;

  function elementComputedStyle(win, element) {
    try {
      return win.getComputedStyle(element);
    } catch (_) {
      return null;
    }
  }

  function overflowYClips(style) {
    return style && ["hidden", "clip"].includes(String(style.overflowY || "").toLowerCase());
  }

  function snapshotStyles(element, properties) {
    return properties.map((property) => stability.snapshotStyle(element, property));
  }

  function setStyleImportant(element, property, value) {
    if (element?.style?.setProperty) {
      element.style.setProperty(property, value, "important");
    }
  }

  function documentScrollHeight(doc) {
    return Math.max(
      Number(doc?.scrollingElement?.scrollHeight) || 0,
      Number(doc?.documentElement?.scrollHeight) || 0,
      Number(doc?.body?.scrollHeight) || 0,
    );
  }

  // Measures how tall one accessible iframe document must be so that none of
  // its content is clipped or hidden behind an inner scrollbar.
  //
  // Ordinary documents scroll through the browser viewport, so the needed
  // height is simply the document's scroll height. App-shell documents pin
  // html/body and scroll an inner container (the same layout the page capture
  // handles by scrolling); inside an iframe we cannot scroll during capture,
  // so instead the document is temporarily un-pinned and its scroll container
  // is expanded to its full content height. If anything resists the expansion
  // (for example a genuinely fixed-size embedded widget), every change is
  // reverted and the iframe is left exactly as it was.
  function resolveDocumentExtent(doc, win) {
    const snapshots = [];
    const viewportHeight = Math.max(1, Number(win?.innerHeight) || 1);

    function restoreSnapshots() {
      for (let index = snapshots.length - 1; index >= 0; index -= 1) {
        stability.restoreStyle(snapshots[index]);
      }
    }

    try {
      if (windowCanScroll(win, doc)) {
        return {
          height: documentScrollHeight(doc),
          restore: restoreSnapshots,
        };
      }

      const container = findBestScrollContainer(win, doc);
      if (!container) {
        return { height: viewportHeight, restore() {} };
      }

      for (const element of [doc?.documentElement, doc?.body]) {
        if (!element?.style) continue;
        snapshots.push(...snapshotStyles(element, ["height", "max-height", "overflow-y"]));
        setStyleImportant(element, "height", "auto");
        setStyleImportant(element, "max-height", "none");
        setStyleImportant(element, "overflow-y", "visible");
      }

      let current = container.parentElement;
      let guard = 0;
      while (current && current !== doc?.documentElement && guard < 100) {
        const style = elementComputedStyle(win, current);
        if (overflowYClips(style) && current.style?.setProperty) {
          snapshots.push(stability.snapshotStyle(current, "overflow-y"));
          setStyleImportant(current, "overflow-y", "visible");
        }
        current = current.parentElement;
        guard += 1;
      }

      snapshots.push(...snapshotStyles(container, ["height", "max-height", "overflow-y"]));
      setStyleImportant(container, "height", `${Number(container.scrollHeight) || 0}px`);
      setStyleImportant(container, "max-height", "none");
      setStyleImportant(container, "overflow-y", "visible");

      const height = documentScrollHeight(doc);
      if (height <= viewportHeight + EXPANSION_TOLERANCE_CSS) {
        restoreSnapshots();
        return { height: viewportHeight, restore() {} };
      }
      return { height, restore: restoreSnapshots };
    } catch (error) {
      restoreSnapshots();
      throw error;
    }
  }

  // Depth-first over same-origin frames, expanding nested iframes before their
  // parents so an outer iframe's size accounts for the inner expansions.
  function expandDocument(doc, win, state) {
    let frames = [];
    try {
      frames = Array.from(doc.querySelectorAll("iframe, frame"));
    } catch (_) {
      return;
    }

    for (const frame of frames) {
      let innerDoc = null;
      try {
        innerDoc = frame.contentDocument;
      } catch (_) {
        innerDoc = null;
      }
      if (!innerDoc?.documentElement) {
        // Cross-origin frames (or frames that are still loading) cannot be
        // inspected; they are captured at their rendered size.
        state.crossOrigin += 1;
        continue;
      }
      const innerWin = frame.contentWindow || innerDoc.defaultView;
      expandDocument(innerDoc, innerWin, state);

      const extent = resolveDocumentExtent(innerDoc, innerWin);
      state.undo.push(extent.restore);

      const clientHeight = Math.max(0, Number(frame.clientHeight) || 0);
      const grows = extent.height > clientHeight + EXPANSION_TOLERANCE_CSS;
      const withinCap = extent.height <= Math.max(1, clientHeight) * CAPTURE_LIMITS.MAX_VIEWPORT_CAPTURES;
      if (!grows) {
        continue;
      }
      if (!withinCap) {
        // A single gigantic embedded document would consume the whole capture
        // budget; leave it scrollable (captured at its rendered size) instead.
        state.skipped += 1;
        continue;
      }
      state.expanded += 1;
      // Capture the original styles before mutating so restore() reverts the
      // iframe element to its pre-capture size.
      const frameSnapshots = snapshotStyles(frame, ["height", "max-height"]);
      state.undo.push(() => {
        for (const snapshot of frameSnapshots) {
          stability.restoreStyle(snapshot);
        }
      });
      setStyleImportant(frame, "height", `${extent.height}px`);
      setStyleImportant(frame, "max-height", "none");
    }
  }

  // Temporarily expands every accessible (same-origin) iframe in the document
  // tree to the full height of its content so full-page captures include
  // embedded scrollable content. Returns an object with `restore()` that
  // reverts all sizes and document-level changes, plus counters describing
  // what was touched.
  function expandIframesForCapture(options = {}) {
    const doc = options.root || globalScope.document;
    const win = options.window || doc?.defaultView || globalScope;
    const state = {
      expanded: 0,
      crossOrigin: 0,
      skipped: 0,
      undo: [],
    };

    if (doc?.querySelectorAll) {
      try {
        expandDocument(doc, win, state);
      } catch (error) {
        for (let index = state.undo.length - 1; index >= 0; index -= 1) {
          try {
            state.undo[index]();
          } catch (_) {
            // Best-effort rollback; the page capture will still attempt restore.
          }
        }
        throw error;
      }
    }

    return {
      expandedCount: state.expanded,
      crossOriginCount: state.crossOrigin,
      skippedCount: state.skipped,
      restore() {
        for (let index = state.undo.length - 1; index >= 0; index -= 1) {
          try {
            state.undo[index]();
          } catch (_) {
            // Restoring is best-effort so one detached element cannot block the
            // remaining page restoration.
          }
        }
      },
    };
  }

  Object.defineProperty(globalScope, "Scroll2PDFIframeExpansion", {
    value: Object.freeze({
      expandIframesForCapture,
      resolveDocumentExtent,
    }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
