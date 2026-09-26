(function initializeScroll2PDFSelectedArea(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFSelectedArea) return;

  const { CAPTURE_LIMITS, CAPTURE_MODES } = globalScope.Scroll2PDFConstants;
  const {
    findScrollableAncestor,
    isSelectionLargeEnough,
    normalizeSelectionRect,
    windowCanScroll,
  } = globalScope.Scroll2PDFCaptureUtils;
  const {
    createCleanupBag,
    createOneShotOutcome,
    createSelectionOverlay,
  } = globalScope.Scroll2PDFSelectionOverlay;
  const stability = globalScope.Scroll2PDFCaptureStability;
  let session = null;

  function rectSnapshot(rect) {
    return {
      left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
      width: rect.width, height: rect.height,
    };
  }

  function containsFrameAt(x, y, host) {
    const target = document.elementsFromPoint(x, y).find((element) => element !== host);
    return ["IFRAME", "FRAME"].includes(String(target?.tagName || "").toUpperCase());
  }

  // Determines what actually scrolls under the selection. Ordinary pages scroll
  // through the viewport; pinned app shells (Discord, Slack, Teams, …) scroll an
  // inner container. In the latter case the crop is clipped to that container and
  // the capture scrolls it directly so the area advances instead of stalling.
  function resolveScrollerForSelection(state, rect) {
    const centerX = rect.left + (rect.width / 2);
    const centerY = rect.top + (rect.height / 2);
    const elements = document.elementsFromPoint(centerX, centerY)
      .filter((element) => element !== state.overlay?.host);
    const element = findScrollableAncestor(elements, window, document);
    if (element) {
      const containerRect = element.getBoundingClientRect();
      const clipped = {
        left: Math.max(rect.left, containerRect.left),
        top: Math.max(rect.top, containerRect.top),
        right: Math.min(rect.right, containerRect.right),
        bottom: Math.min(rect.bottom, containerRect.bottom),
      };
      clipped.width = clipped.right - clipped.left;
      clipped.height = clipped.bottom - clipped.top;
      if (isSelectionLargeEnough(clipped)) {
        return {
          type: "element",
          element,
          originalScrollTop: Math.max(0, Number(element.scrollTop) || 0),
          clipped,
        };
      }
    }
    if (windowCanScroll(window, document)) {
      return { type: "window" };
    }
    return { type: "none" };
  }

  async function restoreManualStartPosition(state) {
    if (state.scroller?.type === "element" && state.scroller.element?.isConnected) {
      state.scroller.element.scrollTop = state.scroller.originalScrollTop;
      await globalScope.Scroll2PDFPageCapture.settlePage();
      return;
    }
    window.scrollTo({ left: state.originalX, top: state.originalY, behavior: "auto" });
    await globalScope.Scroll2PDFPageCapture.settlePage();
  }

  function startManualExtentSelection(state, outcome) {
    state.overlay?.cleanup();
    state.phase = "manual-scroll";
    const cleanupBag = createCleanupBag();
    const host = document.createElement("div");
    host.id = "scroll2pdf-manual-scroll-host";
    host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .selection-window { position: fixed; box-sizing: border-box; border: 2px solid #45e0c4;
        border-radius: 4px; box-shadow: 0 0 0 9999px rgba(4,10,18,.38), inset 0 0 0 1px rgba(255,255,255,.14);
        pointer-events: auto; overscroll-behavior: contain; touch-action: none; cursor: ns-resize; }
      .selection-window::after { content: "Scroll inside this box"; position: absolute; top: 8px; left: 50%;
        transform: translateX(-50%); padding: 4px 8px; border-radius: 999px; background: rgba(7,20,31,.88);
        color: #d8fff8; font: 650 11px/1.2 system-ui,sans-serif; white-space: nowrap; pointer-events: none; }
      .selection-window:focus-visible { outline: 2px solid #9bc2ff; outline-offset: 3px; }
      .panel { position: fixed; right: 18px; bottom: 18px; width: min(330px, calc(100vw - 36px));
        box-sizing: border-box; padding: 13px; border: 1px solid rgba(120,169,255,.55);
        border-radius: 12px; background: #0c1a27; color: #f5f8ff; box-shadow: 0 12px 36px rgba(0,0,0,.35);
        font: 500 12px/1.4 system-ui,sans-serif; pointer-events: auto; }
      .title { font-weight: 750; font-size: 13px; margin-bottom: 4px; }
      .hint { color: #b8c7dc; margin-bottom: 10px; }
      .actions { display: flex; justify-content: flex-end; gap: 8px; }
      button { border: 1px solid #476384; border-radius: 8px; padding: 7px 10px; background: #13263d;
        color: #eef5ff; font: 650 12px system-ui,sans-serif; cursor: pointer; }
      button.primary { border-color: #6b9cff; background: #3478e5; color: white; }
      button:focus-visible { outline: 2px solid #9bc2ff; outline-offset: 2px; }
    `;
    const selectionWindow = document.createElement("div");
    selectionWindow.className = "selection-window";
    selectionWindow.tabIndex = 0;
    selectionWindow.style.left = `${state.rect.left}px`;
    selectionWindow.style.top = `${state.rect.top}px`;
    selectionWindow.style.width = `${state.rect.width}px`;
    selectionWindow.style.height = `${state.rect.height}px`;
    const panel = document.createElement("div");
    panel.className = "panel";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = "Choose where this capture ends";
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "Scroll down as far as you want, then click Capture to here.";
    const actions = document.createElement("div");
    actions.className = "actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    const finish = document.createElement("button");
    finish.type = "button";
    finish.className = "primary";
    finish.textContent = "Capture to here";
    actions.append(cancel, finish);
    panel.append(title, hint, actions);
    shadow.append(style, selectionWindow, panel);
    document.documentElement.append(host);
    selectionWindow.focus({ preventScroll: true });
    cleanupBag.add(() => host.remove());
    state.manualControlCleanup = () => cleanupBag.cleanup();

    const currentScrollPosition = () => state.scroller?.type === "element"
      ? Math.max(0, Number(state.scroller.element?.scrollTop) || 0)
      : Math.max(0, Number(window.scrollY) || 0);
    const startScrollPosition = state.scroller?.type === "element"
      ? state.scroller.originalScrollTop
      : state.originalY;

    function scrollSelectedContent(deltaY) {
      const delta = Number(deltaY) || 0;
      if (!delta) return;
      if (state.scroller?.type === "element" && state.scroller.element?.isConnected) {
        state.scroller.element.scrollTop += delta;
        return;
      }
      window.scrollBy({ left: 0, top: delta, behavior: "auto" });
    }

    function wheelDelta(event) {
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
      if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * Math.max(1, state.rect.height);
      return event.deltaY;
    }

    cleanupBag.listen(selectionWindow, "wheel", (event) => {
      event.preventDefault();
      event.stopPropagation();
      scrollSelectedContent(wheelDelta(event));
    }, { passive: false });
    cleanupBag.listen(selectionWindow, "keydown", (event) => {
      const pageStep = Math.max(80, state.rect.height * 0.85);
      const keyDeltas = {
        ArrowDown: 56,
        ArrowUp: -56,
        PageDown: pageStep,
        PageUp: -pageStep,
        " ": event.shiftKey ? -pageStep : pageStep,
      };
      const delta = keyDeltas[event.key];
      if (!Number.isFinite(delta)) return;
      event.preventDefault();
      scrollSelectedContent(delta);
    });
    cleanupBag.listen(window, "wheel", (event) => {
      if (event.composedPath().includes(host)) return;
      event.preventDefault();
    }, { capture: true, passive: false });

    async function cancelManual() {
      if (state.phase !== "manual-scroll") return;
      state.phase = "cancelling";
      cleanupBag.cleanup();
      await restoreManualStartPosition(state);
      outcome.settle({ ok: false, cancelled: true, error: "Capture cancelled" });
    }

    async function finishManual() {
      if (state.phase !== "manual-scroll") return;
      const endScrollPosition = currentScrollPosition();
      if (endScrollPosition < startScrollPosition - CAPTURE_LIMITS.SCROLL_POSITION_TOLERANCE_CSS) {
        hint.textContent = "Scroll downward from the starting point, then capture.";
        return;
      }
      if (state.scroller?.type === "element") {
        const element = state.scroller.element;
        const containerRect = element.getBoundingClientRect();
        const cropTopInContainer = state.rect.top - containerRect.top;
        state.manualEndContentY = Math.min(
          Number(element.scrollHeight),
          endScrollPosition + cropTopInContainer + state.rect.height,
        );
      } else {
        const page = globalScope.Scroll2PDFPageCapture.getPageMetrics();
        state.manualEndContentY = Math.min(page.totalHeight, endScrollPosition + state.rect.bottom);
      }
      state.manualEndContentY = Math.max(
        state.startContentY + state.rect.height,
        state.manualEndContentY,
      );
      state.phase = "selected";
      cleanupBag.cleanup();
      await restoreManualStartPosition(state);
      outcome.settle({
        ok: true,
        selection: {
          mode: CAPTURE_MODES.SELECTED_AREA,
          manualScroll: true,
          endContentY: state.manualEndContentY,
        },
      });
    }

    cleanupBag.listen(cancel, "click", () => { void cancelManual(); });
    cleanupBag.listen(finish, "click", () => { void finishManual(); });
    cleanupBag.listen(window, "keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void cancelManual();
      }
    }, true);
    state.cancel = cancelManual;
  }

  function startSelection(captureId, options = {}) {
    if (!captureId) return Promise.reject(new Error("A capture ID is required."));
    if (session) return Promise.reject(new Error("Another area selection is already active."));

    return new Promise((resolve) => {
      const overlay = createSelectionOverlay("Drag to select an area · Esc to cancel");
      const state = {
        captureId,
        overlay,
        phase: "selecting",
        pointerId: null,
        start: null,
        rect: null,
        cropShiftY: 0,
        originalX: window.scrollX,
        originalY: window.scrollY,
        startContentY: null,
        scroller: null,
        scrollStyles: [],
        scrollInterferenceCleanup: null,
        hiddenElements: new Map(),
        bottomChromeElements: new Set(),
        manualScroll: Boolean(options.manualScroll),
        manualEndContentY: null,
        manualControlCleanup: null,
      };
      session = state;
      const outcome = createOneShotOutcome((value) => {
        overlay.cleanup();
        state.manualControlCleanup?.();
        state.manualControlCleanup = null;
        if (value?.cancelled) session = null;
        resolve(value);
      });

      function pointerDown(event) {
        if (event.button !== 0) return;
        if (containsFrameAt(event.clientX, event.clientY, overlay.host)) {
          overlay.clearRect("Content inside frames is not supported in Stage 3", true);
          return;
        }
        event.preventDefault();
        state.pointerId = event.pointerId;
        state.start = { x: event.clientX, y: event.clientY };
        overlay.surface.setPointerCapture?.(event.pointerId);
      }

      function pointerMove(event) {
        if (state.pointerId !== event.pointerId || !state.start) return;
        const rect = normalizeSelectionRect(
          state.start,
          { x: event.clientX, y: event.clientY },
          { width: window.innerWidth, height: window.innerHeight },
        );
        state.rect = rect;
        overlay.setRect(rect, `${Math.round(rect.width)} × ${Math.round(rect.height)} px`, !isSelectionLargeEnough(rect));
      }

      function pointerUp(event) {
        if (state.pointerId !== event.pointerId || !state.start) return;
        event.preventDefault();
        overlay.surface.releasePointerCapture?.(event.pointerId);
        const rect = normalizeSelectionRect(
          state.start,
          { x: event.clientX, y: event.clientY },
          { width: window.innerWidth, height: window.innerHeight },
        );
        state.pointerId = null;
        state.start = null;
        if (!isSelectionLargeEnough(rect)) {
          state.rect = null;
          overlay.clearRect("Selected area is too small · Drag at least 80 × 80 px", true);
          return;
        }
        const scroller = resolveScrollerForSelection(state, rect);
        let capturedRect = rect;
        if (scroller.type === "element") {
          capturedRect = scroller.clipped;
          state.scroller = scroller;
        } else if (scroller.type === "none") {
          state.scroller = null;
        } else {
          state.scroller = scroller;
        }
        state.rect = rectSnapshot(capturedRect);
        if (state.scroller?.type === "element") {
          const containerRect = state.scroller.element.getBoundingClientRect();
          state.startContentY = state.scroller.originalScrollTop
            + Math.max(0, capturedRect.top - containerRect.top);
        } else {
          state.startContentY = state.originalY + capturedRect.top;
        }
        if (state.manualScroll) {
          startManualExtentSelection(state, outcome);
          return;
        }
        state.phase = "selected";
        outcome.settle({ ok: true, selection: { mode: CAPTURE_MODES.SELECTED_AREA } });
      }

      function keydown(event) {
        if (event.key === "Escape") outcome.settle({ ok: false, cancelled: true, error: "Capture cancelled" });
      }

      overlay.cleanupBag.listen(overlay.surface, "pointerdown", pointerDown);
      overlay.cleanupBag.listen(overlay.surface, "pointermove", pointerMove);
      overlay.cleanupBag.listen(overlay.surface, "pointerup", pointerUp);
      overlay.cleanupBag.listen(window, "keydown", keydown, true);
      state.cancel = () => outcome.settle({ ok: false, cancelled: true, error: "Capture cancelled" });
    });
  }

  function requireSession(captureId) {
    if (!session || session.captureId !== captureId || !session.rect) {
      throw new Error("The selected-area capture session is no longer active.");
    }
    return session;
  }

  function saveStyle(element, property) {
    if (!element?.style) return null;
    return {
      element, property,
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
    };
  }

  function restoreStyle(snapshot) {
    if (!snapshot) return;
    if (snapshot.value) snapshot.element.style.setProperty(snapshot.property, snapshot.value, snapshot.priority);
    else snapshot.element.style.removeProperty(snapshot.property);
  }

  async function scrollAndSettle(x, y) {
    const targetY = Math.max(0, Number(y) || 0);
    const tolerance = CAPTURE_LIMITS.SCROLL_POSITION_TOLERANCE_CSS;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = Math.max(0, Number(window.scrollY) || 0);
      if (attempt === 0) {
        window.scrollTo({ left: Math.max(0, Number(x) || 0), top: targetY, behavior: "auto" });
      } else {
        const scroller = document.scrollingElement || document.documentElement;
        scroller.scrollTop = targetY;
      }
      await globalScope.Scroll2PDFPageCapture.settlePage();
      const after = Math.max(0, Number(window.scrollY) || 0);
      const advanced = after > before + 0.5;
      const atTarget = Math.abs(after - targetY) <= Math.max(8, tolerance);
      const noMovement = after <= before + 0.5;
      if (advanced || atTarget || noMovement) break;
    }
  }

  function currentCropForWindow(state, metrics) {
    const maxShift = Math.max(0, metrics.viewportHeight - state.rect.bottom);
    const shiftY = Math.min(maxShift, Math.max(0, state.cropShiftY));
    return {
      left: state.rect.left,
      top: state.rect.top + shiftY,
      right: state.rect.right,
      bottom: state.rect.bottom + shiftY,
      width: state.rect.width,
      height: state.rect.height,
      shifted: shiftY > 0,
      shiftY,
    };
  }

  function currentCropForElement(state, containerRect) {
    const cropTopInContainer = state.rect.top - containerRect.top;
    const maxShift = Math.max(0, containerRect.height - (cropTopInContainer + state.rect.height));
    const shiftY = Math.min(maxShift, Math.max(0, state.cropShiftY));
    return {
      left: state.rect.left,
      top: state.rect.top + shiftY,
      right: state.rect.right,
      bottom: state.rect.bottom + shiftY,
      width: state.rect.width,
      height: state.rect.height,
      shifted: shiftY > 0,
      shiftY,
    };
  }

  function getWindowScrollerMetrics(state) {
    const page = globalScope.Scroll2PDFPageCapture.getPageMetrics();
    const maximumScroll = Math.max(0, page.totalHeight - page.viewportHeight);
    const captureEnd = Number.isFinite(state.manualEndContentY)
      ? Math.min(page.totalHeight, state.manualEndContentY)
      : page.totalHeight;
    const crop = currentCropForWindow(state, page);
    const contentPosition = page.scrollY + crop.top;
    const contentBottom = Math.min(captureEnd, contentPosition + crop.height);
    let nextPosition = null;
    if (contentBottom < captureEnd - CAPTURE_LIMITS.SCROLL_POSITION_TOLERANCE_CSS) {
      nextPosition = page.scrollY < maximumScroll - CAPTURE_LIMITS.SCROLL_POSITION_TOLERANCE_CSS
        ? Math.min(page.scrollY + state.rect.height, maximumScroll)
        : page.scrollY;
    }
    return {
      captureMode: CAPTURE_MODES.SELECTED_AREA,
      captureModeLabel: "Selected Area",
      contentPositionCss: contentPosition,
      scrollPositionCss: page.scrollY,
      contentStartCss: state.startContentY,
      totalContentHeightCss: captureEnd,
      contentViewportHeightCss: crop.height,
      viewportCssWidth: page.viewportWidth,
      viewportCssHeight: page.viewportHeight,
      cropRectCss: crop,
      timestamp: Date.now(),
      nextPosition,
    };
  }

  function getElementScrollerMetrics(state) {
    const element = state.scroller.element;
    if (!element.isConnected) {
      throw new Error("The selected area's scrollable region was removed from the page.");
    }
    const containerRect = element.getBoundingClientRect();
    const scrollTop = Math.max(0, Number(element.scrollTop) || 0);
    const crop = currentCropForElement(state, containerRect);
    const cropTopInContainer = crop.top - containerRect.top;
    const contentPosition = scrollTop + cropTopInContainer;
    const captureEnd = Number.isFinite(state.manualEndContentY)
      ? Math.min(Number(element.scrollHeight), state.manualEndContentY)
      : Number(element.scrollHeight);
    const contentBottom = Math.min(captureEnd, contentPosition + crop.height);
    const maximumScroll = Math.max(0, Number(element.scrollHeight) - Number(element.clientHeight));
    let nextPosition = null;
    if (contentBottom < captureEnd - CAPTURE_LIMITS.SCROLL_POSITION_TOLERANCE_CSS) {
      nextPosition = scrollTop < maximumScroll - CAPTURE_LIMITS.SCROLL_POSITION_TOLERANCE_CSS
        ? Math.min(scrollTop + crop.height, maximumScroll)
        : scrollTop;
    }
    return {
      captureMode: CAPTURE_MODES.SELECTED_AREA,
      captureModeLabel: "Selected Area",
      contentPositionCss: contentPosition,
      scrollPositionCss: scrollTop,
      contentStartCss: state.startContentY,
      totalContentHeightCss: captureEnd,
      contentViewportHeightCss: crop.height,
      viewportCssWidth: window.innerWidth,
      viewportCssHeight: window.innerHeight,
      cropRectCss: crop,
      timestamp: Date.now(),
      nextPosition,
    };
  }

  function getMetrics(captureId) {
    const state = requireSession(captureId);
    if (state.scroller?.type === "element") {
      return getElementScrollerMetrics(state);
    }
    return getWindowScrollerMetrics(state);
  }

  async function prepareCapture(captureId) {
    const state = requireSession(captureId);
    state.phase = "capturing";
    if (state.scroller?.type === "element") {
      state.scrollInterferenceCleanup = stability.disableScrollingInterference(state.scroller.element);
      state.scrollbarCleanup = stability.hideScrollbar(state.scroller.element);
    } else {
      state.scrollStyles = [
        saveStyle(document.documentElement, "scroll-behavior"),
        saveStyle(document.body, "scroll-behavior"),
      ].filter(Boolean);
      document.documentElement?.style?.setProperty("scroll-behavior", "auto", "important");
      document.body?.style?.setProperty("scroll-behavior", "auto", "important");
      state.scrollInterferenceCleanup = stability.disableScrollingInterference(document.body);
      state.scrollbarCleanup = stability.hideScrollbar(null);
    }
    // The enter-chat composer (and any bottom chrome bar pinned inside the
    // selection by layout) is hidden from the very first frame so it never
    // appears mid-capture; it is not part of the scroller content, so it is
    // also absent from the stitched result.
    hideBottomChrome(state);
    await globalScope.Scroll2PDFPageCapture.settlePage();
    return { ok: true, metrics: getMetrics(captureId) };
  }

  function hideElementVisibility(state, element) {
    if (!state.hiddenElements.has(element)) state.hiddenElements.set(element, saveStyle(element, "visibility"));
    element.style.setProperty("visibility", "hidden", "important");
  }

  // App chrome bars pinned to the selection's bottom edge (in-flow, absolute,
  // fixed, or sticky) are hidden for every frame.
  function hideBottomChrome(state) {
    const region = state.rect;
    if (!region) return;
    const { bottom } = stability.collectRegionEdgeBars(region);
    for (const element of bottom) {
      hideElementVisibility(state, element);
      state.bottomChromeElements.add(element);
    }
  }

  async function scrollToPosition(captureId, position) {
    const state = requireSession(captureId);
    const requestedPosition = Math.max(0, Number(position) || 0);
    if (state.scroller?.type === "element") {
      const element = state.scroller.element;
      const before = getMetrics(captureId);
      const elementBefore = Math.max(0, Number(element.scrollTop) || 0);
      await stability.scrollElementWithRetry(element, requestedPosition, {
        settle: globalScope.Scroll2PDFPageCapture.settlePage,
      });
      const elementAfter = Math.max(0, Number(element.scrollTop) || 0);
      const maximumScroll = Math.max(0, Number(element.scrollHeight) - Number(element.clientHeight));
      const advancedBy = elementAfter - elementBefore;
      const effectivelyAtMaximum = elementAfter
        >= maximumScroll - CAPTURE_LIMITS.SCROLL_POSITION_TOLERANCE_CSS;
      if (advancedBy <= CAPTURE_LIMITS.SCROLL_POSITION_TOLERANCE_CSS && effectivelyAtMaximum) {
        const containerRect = element.getBoundingClientRect();
        const cropTopInContainer = state.rect.top - containerRect.top;
        const maxShift = Math.max(0, containerRect.height - (cropTopInContainer + state.rect.height));
        const nextNaturalShift = state.cropShiftY + state.rect.height;
        const bottomAlignShift = Math.max(
          0,
          Number(element.scrollHeight) - (elementAfter + cropTopInContainer + state.rect.height),
        );
        state.cropShiftY = Math.min(maxShift, Math.min(nextNaturalShift, bottomAlignShift));
        if (state.cropShiftY <= before.cropRectCss.shiftY + 0.01) {
          // If the measured content is now covered by this crop, the container
          // shrank mid-capture; report metrics normally so the coordinator
          // adopts the smaller height instead of reporting a false stall.
          const latest = getMetrics(captureId);
          if (latest.contentPositionCss + latest.contentViewportHeightCss
            >= latest.totalContentHeightCss - CAPTURE_LIMITS.SCROLL_POSITION_TOLERANCE_CSS) {
            return { ok: true, requestedPosition, metrics: latest };
          }
          throw new Error("The selected area cannot reach the page bottom without a gap.");
        }
      } else {
        state.cropShiftY = 0;
      }
      return { ok: true, requestedPosition, metrics: getMetrics(captureId) };
    }
    const before = getMetrics(captureId);
    const pageBefore = globalScope.Scroll2PDFPageCapture.getPageMetrics();
    await scrollAndSettle(state.originalX, requestedPosition);
    const pageAfter = globalScope.Scroll2PDFPageCapture.getPageMetrics();
    const maximumScroll = Math.max(0, pageAfter.totalHeight - pageAfter.viewportHeight);
    const advancedBy = pageAfter.scrollY - pageBefore.scrollY;
    const effectivelyAtMaximum = pageAfter.scrollY
      >= maximumScroll - CAPTURE_LIMITS.SCROLL_POSITION_TOLERANCE_CSS;

    if (advancedBy <= CAPTURE_LIMITS.SCROLL_POSITION_TOLERANCE_CSS && effectivelyAtMaximum) {
      const maxShift = Math.max(0, pageAfter.viewportHeight - state.rect.bottom);
      const nextNaturalShift = state.cropShiftY + state.rect.height;
      const bottomAlignShift = Math.max(
        0,
        pageAfter.totalHeight - (pageAfter.scrollY + state.rect.bottom),
      );
      state.cropShiftY = Math.min(maxShift, Math.min(nextNaturalShift, bottomAlignShift));
      if (state.cropShiftY <= before.cropRectCss.shiftY + 0.01) {
        // If the measured page height is now covered by this crop, the page
        // shrank mid-capture; report metrics normally so the coordinator adopts
        // the smaller height instead of reporting a false stall.
        const latest = getMetrics(captureId);
        if (latest.contentPositionCss + latest.contentViewportHeightCss
          >= latest.totalContentHeightCss - CAPTURE_LIMITS.SCROLL_POSITION_TOLERANCE_CSS) {
          return { ok: true, requestedPosition, metrics: latest };
        }
        throw new Error("The selected area cannot reach the page bottom without a gap.");
      }
    } else {
      state.cropShiftY = 0;
    }
    return { ok: true, requestedPosition, metrics: getMetrics(captureId) };
  }

  function hideRepeatedOverlays(captureId) {
    const state = requireSession(captureId);
    const elements = Array.from(document.querySelectorAll("body *"))
      .slice(0, CAPTURE_LIMITS.MAX_OVERLAY_SCAN_ELEMENTS);
    let hiddenCount = 0;
    for (const element of elements) {
      const style = window.getComputedStyle(element);
      if (style.position !== "fixed" && style.position !== "sticky") continue;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || style.visibility === "hidden" || style.display === "none") continue;
      hideElementVisibility(state, element);
      hiddenCount += 1;
    }
    // Layout-pinned chrome bars flush with the selection's top or bottom edge
    // are hidden too (top bars from the second frame onward, so the header
    // appears exactly once at the top; bottom bars stay hidden).
    if (state.rect) {
      const { top, bottom } = stability.collectRegionEdgeBars(state.rect);
      for (const element of [...top, ...bottom]) {
        if (state.hiddenElements.has(element)) continue;
        hideElementVisibility(state, element);
        hiddenCount += 1;
      }
    }
    return { ok: true, hiddenCount };
  }

  async function restoreCapture(captureId) {
    if (!session || session.captureId !== captureId) return { ok: true, restored: false };
    const state = session;
    try {
      state.overlay?.cleanup();
      for (const snapshot of state.hiddenElements.values()) restoreStyle(snapshot);
      state.bottomChromeElements.clear();
      if (state.scroller?.type === "element" && state.scroller.element?.isConnected) {
        const element = state.scroller.element;
        const maximum = Math.max(0, Number(element.scrollHeight) - Number(element.clientHeight));
        element.scrollTop = Math.min(state.scroller.originalScrollTop, maximum);
        await globalScope.Scroll2PDFPageCapture.settlePage();
      } else {
        await scrollAndSettle(state.originalX, state.originalY);
      }
      state.scrollInterferenceCleanup?.();
      state.scrollbarCleanup?.();
      state.scrollbarCleanup = null;
      for (const snapshot of state.scrollStyles) restoreStyle(snapshot);
      return { ok: true, restored: true };
    } finally {
      session = null;
    }
  }

  function cancelSelection(captureId) {
    if (!session || (captureId && session.captureId !== captureId)) return { ok: true, cancelled: false };
    if (session.phase === "selecting" || session.phase === "manual-scroll") session.cancel?.();
    return { ok: true, cancelled: true };
  }

  Object.defineProperty(globalScope, "Scroll2PDFSelectedArea", {
    value: Object.freeze({
      cancelSelection, getMetrics, hideRepeatedOverlays, prepareCapture,
      restoreCapture, scrollToPosition, startSelection, resolveScrollerForSelection,
    }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
