(function initializeScroll2PDFScrollableSelection(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFScrollableSelection) return;

  const { CAPTURE_LIMITS, CAPTURE_MODES } = globalScope.Scroll2PDFConstants;
  const {
    getNextRegionScrollPosition,
    isRectFullyVisible,
    isVerticallyScrollableCandidate,
  } = globalScope.Scroll2PDFCaptureUtils;
  let session = null;

  function isFrame(element) {
    return ["IFRAME", "FRAME"].includes(String(element?.tagName || "").toUpperCase());
  }

  function findCandidateFromPath(path) {
    for (const element of path || []) {
      if (isFrame(element)) return null;
      if (!element || element === document.documentElement || element === document.body
          || element === document.scrollingElement || !element.getBoundingClientRect) continue;
      const rect = element.getBoundingClientRect();
      if (isVerticallyScrollableCandidate({
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        clientWidth: element.clientWidth,
        rect,
        style: window.getComputedStyle(element),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      })) return element;
    }
    return null;
  }

  function resolveSelectionTargetFromPath(path, options = {}) {
    if (!globalScope.Scroll2PDFAdapterRegistry) {
      const element = findCandidateFromPath(path);
      return element ? {
        element,
        contentRoot: element,
        adapterId: "generic-scrollable",
        label: "Scrollable area",
        captureDirection: "downward",
        naturalOrder: "top-to-bottom",
        difficult: false,
        requiresConfirmation: true,
      } : null;
    }
    return globalScope.Scroll2PDFAdapterRegistry.resolveTarget(path, {
      hostname: options.hostname || globalScope.location?.hostname || "",
      pathname: options.pathname || globalScope.location?.pathname || "",
      fallbackResolver: findCandidateFromPath,
    });
  }

  function elementsBelowOverlay(x, y, host) {
    return document.elementsFromPoint(x, y).filter((element) => element !== host);
  }

  function startSelection(captureId) {
    if (!captureId) return Promise.reject(new Error("A capture ID is required."));
    if (session) return Promise.reject(new Error("Another area selection is already active."));

    return new Promise((resolve) => {
      const { createOneShotOutcome, createSelectionOverlay } = globalScope.Scroll2PDFSelectionOverlay;
      const overlay = createSelectionOverlay("Move over a scrollable area and click to select · Esc to cancel");
      const state = {
        captureId,
        overlay,
        candidate: null,
        candidateTarget: null,
        target: null,
        element: null,
        originalScrollTop: 0,
        originalRect: null,
        scrollBehavior: null,
        scrollInterferenceCleanup: null,
        hiddenElements: new Map(),
        difficultController: null,
        seenSignatures: new Set(),
        bottomChromeElements: new Set(),
        bottomChromeRestored: false,
        overlayScanInitialized: false,
        phase: "selecting",
      };
      session = state;
      const outcome = createOneShotOutcome((value) => {
        overlay.cleanup();
        if (value?.cancelled) session = null;
        resolve(value);
      });

      function move(event) {
        const target = resolveSelectionTargetFromPath(
          elementsBelowOverlay(event.clientX, event.clientY, overlay.host),
        );
        state.candidateTarget = target;
        state.candidate = target?.element || null;
        if (!state.candidate) {
          overlay.clearRect("Choose a visible, vertically scrollable area", true);
          return;
        }
        const rect = state.candidate.getBoundingClientRect();
        const fullyVisible = isRectFullyVisible(
          rect, window.innerWidth, window.innerHeight, CAPTURE_LIMITS.VIEWPORT_EDGE_TOLERANCE_CSS,
        );
        overlay.setRect(
          rect,
          fullyVisible ? `${target.label} · Click to capture` : "Area must be fully visible",
          !fullyVisible,
        );
      }

      function confirm(event) {
        event.preventDefault();
        event.stopPropagation();
        const element = state.candidate;
        if (!element) return;
        const rect = element.getBoundingClientRect();
        if (!isRectFullyVisible(rect, window.innerWidth, window.innerHeight,
          CAPTURE_LIMITS.VIEWPORT_EDGE_TOLERANCE_CSS)) {
          overlay.setRect(rect, "Area must be fully visible", true);
          return;
        }
        state.element = element;
        state.target = state.candidateTarget || {
          adapterId: "generic-scrollable",
          label: "Scrollable area",
          captureDirection: "downward",
          difficult: false,
        };
        state.originalScrollTop = element.scrollTop;
        state.originalRect = rectSnapshot(rect);
        state.phase = "selected";
        outcome.settle({
          ok: true,
          selection: {
            mode: CAPTURE_MODES.SCROLLABLE_AREA,
            adapterId: state.target.adapterId,
            label: state.target.label,
            difficult: Boolean(state.target.difficult),
            captureDirection: state.target.captureDirection,
          },
        });
      }

      function keydown(event) {
        if (event.key === "Escape") outcome.settle({ ok: false, cancelled: true, error: "Capture cancelled" });
      }

      overlay.cleanupBag.listen(overlay.surface, "pointermove", move);
      overlay.cleanupBag.listen(overlay.surface, "click", confirm, true);
      overlay.cleanupBag.listen(window, "keydown", keydown, true);
      state.cancel = () => outcome.settle({ ok: false, cancelled: true, error: "Capture cancelled" });
    });
  }

  function rectSnapshot(rect) {
    return {
      left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
      width: rect.width, height: rect.height,
    };
  }

  function requireSession(captureId) {
    if (!session || session.captureId !== captureId || !session.element) {
      throw new Error("The scrollable-area capture session is no longer active.");
    }
    return session;
  }

  function saveStyle(element, property) {
    return {
      element, property,
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
    };
  }

  function restoreStyle(snapshot) {
    if (snapshot.value) snapshot.element.style.setProperty(snapshot.property, snapshot.value, snapshot.priority);
    else snapshot.element.style.removeProperty(snapshot.property);
  }

  async function setScrollTop(element, value) {
    await globalScope.Scroll2PDFCaptureStability.scrollElementWithRetry(element, value, {
      settle: globalScope.Scroll2PDFPageCapture.settlePage,
    });
  }

  function isChatTarget(state) {
    return Boolean(state.target?.adapterId)
      && state.target.adapterId !== "generic-scrollable";
  }

  function getMetrics(captureId) {
    const state = requireSession(captureId);
    if (state.difficultController) return state.difficultController.getMetrics();
    const element = state.element;
    if (!element.isConnected) throw new Error("The selected scrollable area was removed from the page.");
    const rect = rectSnapshot(element.getBoundingClientRect());
    const style = window.getComputedStyle(element);
    if (!isVerticallyScrollableCandidate({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      rect,
      style,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    })) throw new Error("The selected element is no longer a visible scrollable area.");
    if (!isRectFullyVisible(rect, window.innerWidth, window.innerHeight,
      CAPTURE_LIMITS.VIEWPORT_EDGE_TOLERANCE_CSS)) {
      throw new Error("The selected scrollable area moved outside the viewport.");
    }
    const widthTolerance = Math.max(
      CAPTURE_LIMITS.REGION_SIZE_CHANGE_MIN_CSS,
      state.originalRect.width * CAPTURE_LIMITS.REGION_SIZE_CHANGE_RATIO,
    );
    const heightTolerance = Math.max(
      CAPTURE_LIMITS.REGION_SIZE_CHANGE_MIN_CSS,
      state.originalRect.height * CAPTURE_LIMITS.REGION_SIZE_CHANGE_RATIO,
    );
    if (Math.abs(rect.width - state.originalRect.width) > widthTolerance
        || Math.abs(rect.height - state.originalRect.height) > heightTolerance) {
      throw new Error("The selected scrollable area changed size during capture.");
    }
    const actual = Math.max(0, Number(element.scrollTop) || 0);
    const startFromCurrent = Boolean(state.startFromCurrentPosition);
    const startCss = startFromCurrent ? state.originalScrollTop : 0;
    // A self-resizing container can wobble clientHeight by a few pixels per
    // scroll, which would otherwise make the capture oscillate near the bottom.
    const bottomTolerance = Math.max(
      CAPTURE_LIMITS.SCROLL_POSITION_TOLERANCE_CSS,
      Number(element.clientHeight) * CAPTURE_LIMITS.BOTTOM_COVER_TOLERANCE_RATIO,
    );
    const maximumScroll = Math.max(0, Number(element.scrollHeight) - Number(element.clientHeight));
    const nextPosition = actual >= maximumScroll - bottomTolerance
      ? null
      : getNextRegionScrollPosition(actual, element.scrollHeight, element.clientHeight);
    return {
      captureMode: CAPTURE_MODES.SCROLLABLE_AREA,
      captureModeLabel: state.target?.label || "Scrollable Area",
      adapterId: state.target?.adapterId || "generic-scrollable",
      difficult: false,
      captureDirection: "downward",
      contentPositionCss: actual,
      scrollPositionCss: actual,
      contentStartCss: startCss,
      totalContentHeightCss: element.scrollHeight,
      contentViewportHeightCss: element.clientHeight,
      viewportCssWidth: window.innerWidth,
      viewportCssHeight: window.innerHeight,
      cropRectCss: rect,
      timestamp: Date.now(),
      nextPosition,
    };
  }

  async function prepareCapture(captureId) {
    const state = requireSession(captureId);
    state.phase = "capturing";
    state.scrollBehavior = saveStyle(state.element, "scroll-behavior");
    state.element.style.setProperty("scroll-behavior", "auto", "important");
    state.scrollInterferenceCleanup = globalScope.Scroll2PDFCaptureStability
      .disableScrollingInterference(state.element);
    state.scrollbarCleanup = globalScope.Scroll2PDFCaptureStability.hideScrollbar(state.element);
    // Chat-like containers (any adapter-detected chat target) are captured from
    // the user's current position downward, so the capture never rewinds to the
    // top or traverses older history. Ordinary scrollable panels still start at
    // the top so their full content is captured.
    const chatTarget = isChatTarget(state);
    state.startFromCurrentPosition = chatTarget;
    if (!chatTarget) {
      await setScrollTop(state.element, 0);
    }
    // The enter-chat composer is hidden from the very first frame so it never
    // appears mid-capture; restoreBottomChrome() brings it back for the final
    // frame so it appears exactly once at the true bottom. Interactive chat
    // captures use this ordinary downward flow even if an adapter retains
    // legacy difficult-capture metadata; only a real difficult controller
    // owns a different first/final-frame policy.
    if (!state.difficultController) hideBottomChromeForFirstFrame(state);
    return { ok: true, metrics: getMetrics(captureId) };
  }

  async function scrollToPosition(captureId, position) {
    const state = requireSession(captureId);
    const requestedPosition = Math.max(0, Number(position) || 0);
    await setScrollTop(state.element, requestedPosition);
    return { ok: true, requestedPosition, metrics: getMetrics(captureId) };
  }

  async function advanceDifficultCapture(captureId, corrective = false) {
    const state = requireSession(captureId);
    if (!state.difficultController) throw new Error("The difficult-page capture session is unavailable.");
    return state.difficultController.advanceUpward({ corrective });
  }

  async function loadOlderHistory(captureId) {
    const state = requireSession(captureId);
    if (!state.difficultController) throw new Error("The difficult-page capture session is unavailable.");
    return state.difficultController.loadOlderHistory();
  }

  // A signature identity (tag, class, position, geometry, color) so that chrome
  // which is re-created on every render — React/SPA style, no stable
  // attributes — is still recognized as the same element across frames and
  // stays hidden. Deliberately excludes textContent: real headers contain
  // live-changing text (clocks, unread counts, typing indicators) that would
  // change the signature every frame and defeat repeated-frame suppression.
  function overlaySignature(element, style, rect) {
    const className = typeof element.className === "string" ? element.className : "";
    return [
      element.tagName,
      className,
      style.position,
      Math.round(rect.left),
      Math.round(rect.top),
      Math.round(rect.width),
      Math.round(rect.height),
      style.backgroundColor,
    ].join("|");
  }

  function hideElementVisibility(state, element) {
    if (!state.hiddenElements.has(element)) state.hiddenElements.set(element, saveStyle(element, "visibility"));
    element.style.setProperty("visibility", "hidden", "important");
  }

  // Collects every element that could appear inside the captured crop and needs
  // repeated-frame suppression: fixed/sticky elements intersecting the region's
  // rect, plus any layout-pinned chrome bar flush with the region's top or
  // bottom edge (in-flow/absolute siblings of the scroller, like a channel
  // header and an enter-chat composer). Samples both ends of the DOM so a
  // composer late in a huge chat DOM is still found, and skips tiny sticky
  // chips nested inside message rows.
  function collectOverlayCandidates(state) {
    const regionRect = rectSnapshot(state.element.getBoundingClientRect());
    const all = Array.from(document.querySelectorAll("body *"));
    const limit = Math.max(2, CAPTURE_LIMITS.MAX_OVERLAY_SCAN_ELEMENTS);
    const half = limit >> 1;
    const stability = globalScope.Scroll2PDFCaptureStability;
    const edgeToleranceCss = isChatTarget(state)
      ? CAPTURE_LIMITS.DYNAMIC_POSITION_TOLERANCE_CSS
      : undefined;
    const boundedSample = all.length > limit ? [...all.slice(0, half), ...all.slice(-half)] : all;
    const edgeHits = stability.collectRegionEdgeHitElements(regionRect, { edgeToleranceCss });
    const sample = Array.from(new Set([...boundedSample, ...edgeHits]));
    const candidates = [];
    for (const element of sample) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (style.visibility === "hidden" || style.display === "none") continue;
      const isPinned = style.position === "fixed" || style.position === "sticky";
      const intersectsCrop = rect.bottom >= regionRect.top - 2
        && rect.top <= regionRect.bottom + 2
        && rect.right >= regionRect.left - 2
        && rect.left <= regionRect.right + 2;
      if (!isPinned && !intersectsCrop) continue;
      if (!isPinned && !stability.classifyChromeEdgeBar({ rect, regionRect, edgeToleranceCss })) continue;
      if (rect.height < 24
        && element.closest?.("article, [data-message-id], [data-mid], [role='listitem']")) {
        continue;
      }
      candidates.push({ element, style, rect });
    }
    return { candidates, regionRect, edgeToleranceCss };
  }

  function hideBottomChromeForFirstFrame(state) {
    const { candidates, regionRect, edgeToleranceCss } = collectOverlayCandidates(state);
    const stability = globalScope.Scroll2PDFCaptureStability;
    for (const { element, style, rect } of candidates) {
      if (stability.classifyChromeEdgeBar({ rect, regionRect, edgeToleranceCss }) !== "bottom") continue;
      hideElementVisibility(state, element);
      state.bottomChromeElements.add(element);
    }
  }

  function hideRepeatedOverlays(captureId) {
    const state = requireSession(captureId);
    const { candidates, regionRect, edgeToleranceCss } = collectOverlayCandidates(state);
    const stability = globalScope.Scroll2PDFCaptureStability;
    let hiddenCount = 0;
    for (const { element, style, rect } of candidates) {
      const classification = stability.classifyRepeatedOverlay({
        position: style.position,
        role: element.getAttribute?.("role"),
        ariaLabel: element.getAttribute?.("aria-label"),
        rect,
        regionRect,
      });
      const edge = stability.classifyChromeEdgeBar({ rect, regionRect, edgeToleranceCss });
      if (edge === "bottom") {
        // The enter-chat composer stays hidden for every frame except the final
        // one; restoreBottomChrome() brings it back so it appears exactly once
        // at the true bottom of the capture.
        if (state.bottomChromeRestored) continue;
        hideElementVisibility(state, element);
        state.bottomChromeElements.add(element);
        hiddenCount += 1;
        continue;
      }
      if (classification === "content" && !edge) continue;
      if (classification === "content-sticky" && !edge) {
        // Sticky content separators (date pills) are kept once on their first
        // sighting. Signature-based, so re-created nodes still match.
        const signature = overlaySignature(element, style, rect);
        if (!state.seenSignatures.has(signature)) {
          state.seenSignatures.add(signature);
          continue;
        }
        hideElementVisibility(state, element);
        hiddenCount += 1;
        continue;
      }
      // App chrome (full-width top bars, fixed controls, jump buttons) is
      // hidden from the second frame onward so it appears exactly once at the
      // top of the stitched result.
      hideElementVisibility(state, element);
      hiddenCount += 1;
    }
    state.overlayScanInitialized = true;
    return { ok: true, hiddenCount };
  }

  // Brings the enter-chat composer back for the final (bottom) frame so it
  // appears exactly once at the end of the capture.
  function restoreBottomChrome(captureId) {
    const state = requireSession(captureId);
    for (const element of state.bottomChromeElements) {
      const snapshot = state.hiddenElements.get(element);
      if (snapshot) restoreStyle(snapshot);
      state.hiddenElements.delete(element);
    }
    state.bottomChromeElements.clear();
    state.bottomChromeRestored = true;
    return { ok: true, restored: true };
  }

  async function restoreCapture(captureId) {
    if (!session || session.captureId !== captureId) return { ok: true, restored: false };
    const state = session;
    try {
      state.overlay?.cleanup();
      for (const snapshot of state.hiddenElements.values()) restoreStyle(snapshot);
      state.bottomChromeElements.clear();
      if (state.difficultController) {
        await state.difficultController.restore();
      } else if (state.element?.isConnected) {
        await setScrollTop(state.element, state.originalScrollTop);
      }
      state.scrollInterferenceCleanup?.();
      state.scrollInterferenceCleanup = null;
      state.scrollbarCleanup?.();
      state.scrollbarCleanup = null;
      if (!state.difficultController && state.scrollBehavior) restoreStyle(state.scrollBehavior);
      return { ok: true, restored: true };
    } finally {
      session = null;
    }
  }

  function cancelSelection(captureId) {
    if (!session || (captureId && session.captureId !== captureId)) return { ok: true, cancelled: false };
    if (session.phase === "selecting") session.cancel?.();
    else session.difficultController?.cancel();
    return { ok: true, cancelled: true };
  }

  Object.defineProperty(globalScope, "Scroll2PDFScrollableSelection", {
    value: Object.freeze({
      cancelSelection, findCandidateFromPath, getMetrics, hideRepeatedOverlays,
      advanceDifficultCapture, loadOlderHistory, prepareCapture, restoreBottomChrome,
      restoreCapture, scrollToPosition, startSelection,
      resolveSelectionTargetFromPath,
    }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
