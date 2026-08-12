(function initializeScroll2PDFCaptureStability(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFCaptureStability) return;

  const { CAPTURE_LIMITS } = globalScope.Scroll2PDFConstants;

  function snapshotStyle(element, property) {
    return {
      element,
      property,
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
    };
  }

  function restoreStyle(snapshot) {
    if (!snapshot?.element?.style) return;
    if (snapshot.value) snapshot.element.style.setProperty(snapshot.property, snapshot.value, snapshot.priority);
    else snapshot.element.style.removeProperty(snapshot.property);
  }

  function installScopedCaptureStyles(options = {}) {
    const root = options.root;
    const documentValue = options.document || globalScope.document;
    const captureId = String(options.captureId || "capture").replace(/[^a-z0-9_-]/gi, "-");
    if (!root?.setAttribute || !documentValue?.createElement || !documentValue?.head) {
      return { cleanup() {} };
    }
    const attribute = "data-scroll2pdf-capture-root";
    const hadAttribute = root.hasAttribute(attribute);
    const previousValue = root.getAttribute(attribute);
    root.setAttribute(attribute, captureId);
    const style = documentValue.createElement("style");
    style.textContent = `[${attribute}="${captureId}"], [${attribute}="${captureId}"] * {`
      + "animation-duration: 0s !important; animation-delay: 0s !important;"
      + "transition-duration: 0s !important; transition-delay: 0s !important;"
      + "scroll-behavior: auto !important; caret-color: transparent !important; }";
    documentValue.head.appendChild(style);
    return {
      cleanup() {
        style.remove?.();
        if (hadAttribute) root.setAttribute(attribute, previousValue);
        else root.removeAttribute(attribute);
      },
    };
  }

  function disableSmoothScrolling(element) {
    const snapshots = [];
    const seen = new Set();
    let current = element;
    while (current && !seen.has(current)) {
      seen.add(current);
      if (current.style?.setProperty) {
        const snapshot = snapshotStyle(current, "scroll-behavior");
        snapshots.push(snapshot);
        current.style.setProperty("scroll-behavior", "auto", "important");
      }
      current = current.parentElement;
    }
    return () => snapshots.reverse().forEach(restoreStyle);
  }

  // Disables smooth scrolling, scroll snapping, scroll anchoring, and
  // overscroll behavior on an element and its ancestors so programmatic scroll
  // steps land exactly where Scroll2PDF asks. Returns a cleanup function.
  function disableScrollingInterference(element) {
    const snapshots = [];
    const seen = new Set();
    let current = element;
    while (current && !seen.has(current)) {
      seen.add(current);
      if (current.style?.setProperty) {
        const properties = {
          "scroll-behavior": "auto",
          "scroll-snap-type": "none",
          "overflow-anchor": "none",
          "overscroll-behavior": "none",
        };
        for (const [property, value] of Object.entries(properties)) {
          snapshots.push(snapshotStyle(current, property));
          current.style.setProperty(property, value, "important");
        }
      }
      current = current.parentElement;
    }
    return () => snapshots.reverse().forEach(restoreStyle);
  }

  // Hides the scrollbar of the viewport (window scroller) or of a specific
  // element so the stitched capture does not contain a vertical scrollbar
  // stripe on its right edge. Returns a cleanup function that restores the
  // original scrollbar styles. Chromium renders viewport scrollbars from the
  // html/body rules; element scrollbars need the element itself.
  function hideScrollbar(target, documentValue = globalScope.document) {
    const documentElement = documentValue?.documentElement;
    const body = documentValue?.body;
    const isWindowTarget = !target || target === documentElement || target === body
      || target === documentValue?.scrollingElement;
    const targets = isWindowTarget && body?.style
      ? [documentElement, body]
      : [target];
    const snapshots = [];
    for (const element of targets) {
      if (!element?.style) continue;
      snapshots.push(snapshotStyle(element, "scrollbar-width"));
      element.style.setProperty("scrollbar-width", "none", "important");
    }
    let style = null;
    let attribute = "";
    if (documentValue?.head?.appendChild && documentValue?.createElement) {
      if (!isWindowTarget && target?.setAttribute) {
        attribute = "data-scroll2pdf-scrollbar-hidden";
        target.setAttribute(attribute, "1");
      }
      // Each selector part needs its own ::-webkit-scrollbar pseudo-element;
      // "html, body::-webkit-scrollbar" would hide the whole html element.
      const selectorParts = (isWindowTarget ? ["html", "body"] : [`[${attribute}]`])
        .map((part) => `${part}::-webkit-scrollbar`)
        .join(", ");
      style = documentValue.createElement("style");
      style.textContent = `${selectorParts} { width: 0 !important; height: 0 !important;`
        + " display: none !important; background: transparent !important; }";
      documentValue.head.appendChild(style);
    }
    return () => {
      style?.remove?.();
      snapshots.reverse().forEach(restoreStyle);
      if (attribute && target?.removeAttribute) target.removeAttribute(attribute);
    };
  }

  // Scrolls an element to `value`, retrying with a direct scrollTop assignment
  // when a page script reverts or cancels the first programmatic scroll.
  async function scrollElementWithRetry(element, value, options = {}) {
    const settle = options.settle || (async () => {});
    const tolerance = Math.max(1, Number(options.tolerance) || 2);
    const maxAttempts = Math.max(1, Math.floor(Number(options.maxAttempts) || 3));
    const target = Math.max(0, Number(value) || 0);
    let lastPosition = -1;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const before = Math.max(0, Number(element.scrollTop) || 0);
      if (attempt === 0 && typeof element.scrollTo === "function") {
        element.scrollTo({ top: target, behavior: "auto" });
      } else {
        element.scrollTop = target;
      }
      await settle();
      lastPosition = Math.max(0, Number(element.scrollTop) || 0);
      const advanced = lastPosition > before + 0.5;
      const atTarget = Math.abs(lastPosition - target) <= Math.max(8, tolerance);
      const noMovement = lastPosition <= before + 0.5;
      if (advanced || atTarget || noMovement) break;
    }
    return lastPosition;
  }

  function imageIsVisible(image, cropRect) {
    if (!image?.getBoundingClientRect) return true;
    const rect = image.getBoundingClientRect();
    return rect.right > cropRect.left && rect.left < cropRect.right
      && rect.bottom > cropRect.top && rect.top < cropRect.bottom;
  }

  async function waitForVisibleMedia(options = {}) {
    const root = options.root;
    const cropRect = options.cropRect;
    const wait = options.wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    const now = options.now || Date.now;
    const timeoutMs = Number(options.timeoutMs) || CAPTURE_LIMITS.LAZY_MEDIA_WAIT_MS;
    const started = now();
    let incomplete = [];
    do {
      incomplete = Array.from(root?.querySelectorAll?.("img") || []).filter((image) => (
        imageIsVisible(image, cropRect) && (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0)
      ));
      if (!incomplete.length) return { settled: true, incomplete: 0 };
      if (now() - started >= timeoutMs) break;
      await wait(Math.min(100, timeoutMs));
    } while (now() - started < timeoutMs);
    return { settled: false, incomplete: incomplete.length };
  }

  function classifyRepeatedOverlay(input = {}) {
    const position = String(input.position || "").toLowerCase();
    const role = String(input.role || "").toLowerCase();
    const ariaLabel = String(input.ariaLabel || "").toLowerCase();
    const rect = input.rect || {};
    const region = input.regionRect || {};
    const heightRatio = (Number(rect.height) || 0) / Math.max(1, Number(region.height) || 1);
    if (heightRatio >= 0.3 || role === "listitem" || role === "article") return "content";
    const control = ["button", "textbox", "navigation", "toolbar"].includes(role)
      || /composer|message input|jump to bottom|new messages|toolbar/.test(ariaLabel);
    if (position === "fixed" || control) return "app-chrome";
    if (position === "sticky") return "content-sticky";
    return "content";
  }

  // A wide bar pinned to the top or bottom edge of the captured region is app
  // chrome (a channel/name header, an enter-chat composer), not content.
  // Returns "top", "bottom", or null. The bar must span at least half of the
  // region's width (so date pills and floating buttons are excluded) and sit
  // flush against the edge; bars taller than 35% of the region are content.
  // A real header/composer keeps this shape in every frame, while a content
  // row flush with the edge is only ever caught once and reappears fully in
  // the following overlapping frame, so hiding it is safe.
  function classifyChromeEdgeBar(input = {}) {
    const rect = input.rect || {};
    const region = input.regionRect || {};
    const regionHeight = Number(region.height) || 1;
    const regionWidth = Number(region.width) || 1;
    const height = Number(rect.height) || 0;
    const width = Number(rect.width) || 0;
    if (height <= 0 || height / regionHeight >= 0.35) return null;
    if (width / regionWidth < 0.5) return null;
    const requestedTolerance = Number(input.edgeToleranceCss);
    const edgeTolerance = Number.isFinite(requestedTolerance) && requestedTolerance > 0
      ? Math.max(3, Math.min(requestedTolerance, regionHeight * 0.1))
      : Math.max(3, Math.min(24, regionHeight * 0.05));
    if (Math.abs(Number(rect.top) - Number(region.top)) <= edgeTolerance) return "top";
    if (Math.abs(Number(region.bottom) - Number(rect.bottom)) <= edgeTolerance) return "bottom";
    return null;
  }

  // A large virtualized app can place its visible header/composer in the
  // middle of a huge DOM, outside the bounded first/last-node scan. Sampling
  // the selected region's rendered edges finds what is actually painted there
  // without depending on site-specific class names or text.
  function collectRegionEdgeHitElements(regionRect, options = {}) {
    const documentValue = options.document || globalScope.document;
    if (typeof documentValue?.elementsFromPoint !== "function") return [];
    const region = regionRect || {};
    const left = Number(region.left) || 0;
    const right = Number(region.right) || left;
    const top = Number(region.top) || 0;
    const bottom = Number(region.bottom) || top;
    const width = Math.max(0, right - left);
    const pointsX = [
      left + 2,
      left + (width * 0.25),
      left + (width * 0.5),
      left + (width * 0.75),
      right - 2,
    ];
    const requestedTolerance = Number(options.edgeToleranceCss);
    const edgeDepth = Number.isFinite(requestedTolerance) && requestedTolerance > 0
      ? requestedTolerance
      : 24;
    const edgeOffsets = Array.from(new Set([2, 16, 24, 32, 40, edgeDepth]))
      .filter((offset) => offset <= edgeDepth);
    const pointsY = edgeOffsets.flatMap((offset) => [top + offset, bottom - offset]);
    const found = new Set();
    for (const y of pointsY) {
      for (const x of pointsX) {
        let stack = [];
        try {
          stack = documentValue.elementsFromPoint(x, y) || [];
        } catch (_) {
          stack = [];
        }
        for (const element of stack) {
          let current = element;
          while (current && current !== documentValue.body
              && current !== documentValue.documentElement) {
            found.add(current);
            current = current.parentElement;
          }
        }
      }
    }
    return Array.from(found);
  }

  // Finds app-chrome bars that sit flush against the top or bottom edge of the
  // captured region and span its full width. Works for ANY CSS position — the
  // common real-world case is a channel/name header and an enter-chat composer
  // pinned by the app's layout (in-flow or absolute siblings of the scroller)
  // rather than by position: fixed/sticky. Those bars stay at the region's edge
  // in every frame, so they must be hidden during capture or they duplicate.
  function collectRegionEdgeBars(regionRect, options = {}) {
    const documentValue = options.document || globalScope.document;
    const limit = Math.max(2, Number(options.limit) || CAPTURE_LIMITS.MAX_OVERLAY_SCAN_ELEMENTS);
    const all = Array.from(documentValue.querySelectorAll("body *"));
    const half = limit >> 1;
    const sample = all.length > limit ? [...all.slice(0, half), ...all.slice(-half)] : all;
    const region = regionRect || {};
    const top = [];
    const bottom = [];
    for (const element of sample) {
      const style = window.getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const rect = element.getBoundingClientRect();
      if (Number(rect.width) <= 0 || Number(rect.height) <= 0) continue;
      // Rows partially cut by the region edge are content, not chrome: a cut
      // row extends beyond the edge, so the flush checks reject it.
      if (element.closest?.("article, [data-message-id], [data-mid], [role='listitem']")) continue;
      const edge = classifyChromeEdgeBar({ rect, regionRect: region });
      if (edge === "top") top.push(element);
      else if (edge === "bottom") bottom.push(element);
    }
    return { top, bottom };
  }

  Object.defineProperty(globalScope, "Scroll2PDFCaptureStability", {
    value: Object.freeze({
      disableScrollingInterference,
      disableSmoothScrolling,
      classifyChromeEdgeBar,
      classifyRepeatedOverlay,
      collectRegionEdgeHitElements,
      collectRegionEdgeBars,
      hideScrollbar,
      installScopedCaptureStyles,
      restoreStyle,
      scrollElementWithRetry,
      snapshotStyle,
      waitForVisibleMedia,
    }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
