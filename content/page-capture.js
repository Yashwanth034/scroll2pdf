(function initializeScroll2PDFPageCapture(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFPageCapture) {
    return;
  }

  const { CAPTURE_LIMITS, MESSAGE_TYPES } = globalScope.Scroll2PDFConstants;
  const {
    calculatePageDimensions,
    findBestScrollContainer,
    windowCanScroll,
  } = globalScope.Scroll2PDFCaptureUtils;
  const stability = globalScope.Scroll2PDFCaptureStability;
  let captureState = null;

  function readElementDimensions(element) {
    if (!element) {
      return {};
    }
    return {
      scrollHeight: element.scrollHeight,
      offsetHeight: element.offsetHeight,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      offsetWidth: element.offsetWidth,
      clientWidth: element.clientWidth,
    };
  }

  function fullViewportCrop(metrics) {
    return {
      left: 0,
      top: 0,
      right: metrics.viewportWidth,
      bottom: metrics.viewportHeight,
      width: metrics.viewportWidth,
      height: metrics.viewportHeight,
    };
  }

  function elementRectSnapshot(element) {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }

  // Most sites scroll through the browser viewport. App shells (Discord, Slack,
  // Teams, VS Code Web, …) pin html/body and scroll an inner container instead;
  // in that case the page capture scrolls and measures that container so the
  // capture advances instead of stopping at the first frame.
  function resolvePageScrollTarget() {
    if (windowCanScroll(window, document)) {
      return { type: "window" };
    }
    const element = findBestScrollContainer(window, document);
    if (element) {
      return { type: "element", element };
    }
    return { type: "window" };
  }

  function scrollTargetPosition(target) {
    if (target?.type === "element") {
      return Math.max(0, Number(target.element?.scrollTop) || 0);
    }
    return Math.max(0, Number(window.scrollY) || 0);
  }

  function getPageMetrics() {
    const base = calculatePageDimensions({
      documentElement: readElementDimensions(document.documentElement),
      body: readElementDimensions(document.body),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      devicePixelRatio: window.devicePixelRatio || 1,
    });
    const state = captureState;
    const scrollTarget = state?.scrollTarget || { type: "window" };

    if (scrollTarget.type === "element" && scrollTarget.element?.isConnected) {
      const element = scrollTarget.element;
      const clientWidth = Math.max(0, Number(element.clientWidth) || 0);
      const clientHeight = Math.max(0, Number(element.clientHeight) || 0);
      const scrollTop = Math.max(0, Number(element.scrollTop) || 0);
      return {
        totalWidth: clientWidth,
        totalHeight: Math.max(clientHeight, Number(element.scrollHeight) || clientHeight),
        viewportWidth: clientWidth,
        viewportHeight: clientHeight,
        viewportCssWidth: base.viewportWidth,
        viewportCssHeight: base.viewportHeight,
        scrollX: 0,
        scrollY: scrollTop,
        devicePixelRatio: base.devicePixelRatio,
        cropRectCss: elementRectSnapshot(element),
        contentViewportHeightCss: clientHeight,
        contentStartCss: scrollTop,
        scrollTargetType: "element",
      };
    }

    return {
      ...base,
      viewportCssWidth: base.viewportWidth,
      viewportCssHeight: base.viewportHeight,
      cropRectCss: fullViewportCrop(base),
      contentViewportHeightCss: base.viewportHeight,
      contentStartCss: base.scrollY,
      scrollTargetType: "window",
    };
  }

  function nextAnimationFrame() {
    return new Promise((resolve) => window.requestAnimationFrame(resolve));
  }

  async function settlePage() {
    await nextAnimationFrame();
    await nextAnimationFrame();
    await new Promise((resolve) => setTimeout(resolve, CAPTURE_LIMITS.PAGE_SETTLE_MS));
  }

  function saveStyleProperty(element, property) {
    if (!element?.style) {
      return null;
    }
    return {
      element,
      property,
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
    };
  }

  function restoreStyleProperty(snapshot) {
    if (!snapshot) {
      return;
    }
    if (snapshot.value) {
      snapshot.element.style.setProperty(snapshot.property, snapshot.value, snapshot.priority);
    } else {
      snapshot.element.style.removeProperty(snapshot.property);
    }
  }

  function requireCapture(captureId) {
    if (!captureState || captureState.captureId !== captureId) {
      throw new Error("The page capture session is no longer active.");
    }
    return captureState;
  }

  // Scrolls the effective scroller to the requested position and waits for the
  // page to settle. If a page script cancels or reverts the first programmatic
  // scroll, later attempts use a direct scrollTop assignment (which bypasses
  // site scrollTo overrides) and the position is re-measured after each attempt.
  // When the window scroller was chosen but genuinely cannot move (a pinned app
  // shell the container scan missed), the best inner scroll container is used
  // as a fallback so the capture advances instead of reporting a stall.
  async function scrollAndSettle(x, y) {
    const state = captureState;
    const target = state?.scrollTarget || { type: "window" };
    const targetY = Math.max(0, Number(y) || 0);
    const tolerance = CAPTURE_LIMITS.SCROLL_POSITION_TOLERANCE_CSS;
    let lastPosition = -1;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = scrollTargetPosition(target);
      if (target.type === "element") {
        if (attempt === 0 && typeof target.element.scrollTo === "function") {
          target.element.scrollTo({ top: targetY, behavior: "auto" });
        } else {
          target.element.scrollTop = targetY;
        }
      } else if (attempt === 0) {
        window.scrollTo({ left: Math.max(0, Number(x) || 0), top: targetY, behavior: "auto" });
      } else {
        const scroller = document.scrollingElement || document.documentElement;
        scroller.scrollTop = targetY;
      }
      await settlePage();
      lastPosition = scrollTargetPosition(target);
      const advanced = lastPosition > before + 0.5;
      const atTarget = Math.abs(lastPosition - targetY) <= Math.max(8, tolerance);
      const noMovement = lastPosition <= before + 0.5;
      if (advanced || atTarget || noMovement) {
        break;
      }
    }

    if (state && target.type === "window"
        && lastPosition <= 0.5
        && targetY > lastPosition + tolerance) {
      const element = findBestScrollContainer(window, document);
      if (element?.isConnected) {
        const before = Math.max(0, Number(element.scrollTop) || 0);
        element.scrollTop = targetY;
        await settlePage();
        const after = Math.max(0, Number(element.scrollTop) || 0);
        if (after > before + 0.5) {
          state.scrollTarget = { type: "element", element };
        }
      }
    }
    return getPageMetrics();
  }

  async function prepareFullPageCapture(captureId) {
    if (!captureId) {
      throw new Error("A capture ID is required.");
    }
    if (captureState && captureState.captureId !== captureId) {
      throw new Error("Another page capture session is already active.");
    }
    if (captureState) {
      return { ok: true, metrics: getPageMetrics() };
    }

    const scrollTarget = resolvePageScrollTarget();
    const originalScrollTop = scrollTarget.type === "element"
      ? Math.max(0, Number(scrollTarget.element.scrollTop) || 0)
      : 0;
    captureState = {
      captureId,
      originalX: window.scrollX,
      originalY: window.scrollY,
      scrollTarget,
      originalScrollTop,
      scrollStyles: [
        saveStyleProperty(document.documentElement, "scroll-behavior"),
        saveStyleProperty(document.body, "scroll-behavior"),
      ].filter(Boolean),
      scrollInterferenceCleanup: stability.disableScrollingInterference(
        scrollTarget.type === "element" ? scrollTarget.element : document.body,
      ),
      scrollbarCleanup: stability.hideScrollbar(
        scrollTarget.type === "element" ? scrollTarget.element : document.scrollingElement || document.documentElement,
      ),
      hiddenElements: new Map(),
      initialEdgeCandidates: new Map(),
    };

    try {
      if (globalScope.Scroll2PDFIframeExpansion) {
        // Size same-origin iframes to their full content height so embedded
        // scrollable content is captured as part of the page scroll instead of
        // only its visible slice. Cross-origin frames are skipped and captured
        // at their rendered size.
        captureState.iframeExpansion = globalScope.Scroll2PDFIframeExpansion
          .expandIframesForCapture({ root: document });
      }
      document.documentElement?.style?.setProperty("scroll-behavior", "auto", "important");
      document.body?.style?.setProperty("scroll-behavior", "auto", "important");
      const metrics = await scrollAndSettle(0, 0);
      hideInitialFixedOverlays(captureState);
      await settlePage();
      snapshotInitialEdgeCandidates(captureState);
      return { ok: true, metrics: getPageMetrics() };
    } catch (error) {
      await restorePage(captureId);
      throw error;
    }
  }

  async function scrollToPosition(captureId, y) {
    requireCapture(captureId);
    const requestedY = Math.max(0, Number(y) || 0);
    const metrics = await scrollAndSettle(0, requestedY);
    return { ok: true, requestedY, metrics };
  }

  function documentOffsetTop(element) {
    let top = 0;
    let current = element;
    let guard = 0;
    while (current && guard < 100) {
      top += Number(current.offsetTop) || 0;
      current = current.offsetParent;
      guard += 1;
    }
    return top;
  }

  function isVisible(rect, style) {
    return rect.width > 0
      && rect.height > 0
      && rect.bottom > 0
      && rect.right > 0
      && rect.top < window.innerHeight
      && rect.left < window.innerWidth
      && style.display !== "none"
      && style.visibility !== "hidden"
      && Number(style.opacity || 1) !== 0;
  }

  function isPinnedSticky(element, rect, style, containerRect) {
    const top = Number.parseFloat(style.top);
    const bottom = Number.parseFloat(style.bottom);
    const container = containerRect || { top: 0, bottom: window.innerHeight };
    const pinnedTop = Number.isFinite(top) && Math.abs(rect.top - (container.top + top)) <= 2;
    const pinnedBottom = Number.isFinite(bottom)
      && Math.abs((container.bottom - rect.bottom) - bottom) <= 2;
    const scrollOffset = containerRect
      ? Math.max(0, Number(captureState?.scrollTarget?.element?.scrollTop) || 0)
      : Math.max(0, Number(window.scrollY) || 0);
    return (pinnedTop || pinnedBottom)
      && scrollOffset > CAPTURE_LIMITS.SCROLL_POSITION_TOLERANCE_CSS;
  }

  function collectBoundedBodyElements() {
    const limit = Math.min(CAPTURE_LIMITS.MAX_OVERLAY_SCAN_ELEMENTS, 2000);
    if (document.createTreeWalker && globalScope.NodeFilter) {
      const walker = document.createTreeWalker(
        document.body,
        globalScope.NodeFilter.SHOW_ELEMENT,
      );
      const elements = [];
      let current = walker.nextNode();
      while (current && elements.length < limit) {
        elements.push(current);
        current = walker.nextNode();
      }
      return elements;
    }
    return Array.from(document.querySelectorAll("body *")).slice(0, limit);
  }

  function hideInitialFixedOverlays(state) {
    const canHitTest = typeof document.elementsFromPoint === "function";
    const candidates = new Set(canHitTest ? [] : collectBoundedBodyElements());
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const xs = [
      1,
      Math.round(width * 0.12),
      Math.round(width * 0.3),
      Math.round(width * 0.5),
      Math.round(width * 0.7),
      Math.round(width * 0.88),
      width - 2,
    ];
    const ys = [
      1,
      Math.round(height * 0.12),
      Math.round(height * 0.3),
      Math.round(height * 0.5),
      Math.round(height * 0.7),
      Math.round(height * 0.88),
      height - 2,
    ];
    if (typeof document.elementsFromPoint === "function") {
      for (const y of ys) {
        for (const x of xs) {
          for (const hit of document.elementsFromPoint(x, y).slice(0, 8)) {
            let current = hit;
            for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
              candidates.add(current);
            }
          }
        }
      }
    }

    let hiddenCount = 0;
    for (const element of candidates) {
      if (!element || element.isConnected === false || element === document.body || element === document.documentElement) continue;
      const style = window.getComputedStyle(element);
      if (style.position !== "fixed") continue;
      const rect = element.getBoundingClientRect();
      if (!isVisible(rect, style) && style.visibility === "hidden") continue;
      if (!state.hiddenElements.has(element)) {
        state.hiddenElements.set(element, saveStyleProperty(element, "visibility"));
      }
      if (style.visibility !== "hidden") {
        element.style.setProperty("visibility", "hidden", "important");
        hiddenCount += 1;
      }
    }
    return hiddenCount;
  }

  function snapshotInitialEdgeCandidates(state) {
    const metrics = getPageMetrics();
    const regionRect = metrics.cropRectCss || fullViewportCrop({
      viewportWidth: metrics.viewportCssWidth ?? metrics.viewportWidth,
      viewportHeight: metrics.viewportCssHeight ?? metrics.viewportHeight,
    });
    const edgeToleranceCss = Math.min(96, Math.max(24, regionRect.height * 0.12));
    const chromeSelector = [
      "header",
      "nav",
      "aside",
      "[role='banner']",
      "[role='navigation']",
      "[role='toolbar']",
      "[role='complementary']",
      "[class*='sticky']",
      "[class*='sidebar']",
      "[class*='side-bar']",
      "[class*='pinnable']",
      "[class*='toolbar']",
      "[class*='appearance']",
      "[id*='sidebar']",
      "[id*='toolbar']",
      "[id*='appearance']",
    ].join(", ");
    const candidates = new Set(stability.collectRegionEdgeHitElements(regionRect, {
      edgeToleranceCss,
    }));
    for (const element of Array.from(document.querySelectorAll(chromeSelector))
      .slice(0, CAPTURE_LIMITS.MAX_OVERLAY_SCAN_ELEMENTS)) {
      candidates.add(element);
    }

    state.initialEdgeCandidates.clear();
    for (const element of candidates) {
      if (!element?.isConnected || element === state.scrollTarget?.element) continue;
      if (element.closest?.("article, [role='article'], [role='listitem']")) continue;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (!isVisible(rect, style)) continue;
      if (rect.width < 24 || rect.height < 16) continue;
      const coversMostViewport = rect.width >= regionRect.width * 0.9
        && rect.height >= regionRect.height * 0.75;
      if (coversMostViewport) continue;
      const edge = stability.classifyChromeEdgeBar({
        rect,
        regionRect,
        edgeToleranceCss,
      });
      state.initialEdgeCandidates.set(element, {
        edge: edge || "stable-chrome",
        rect: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        },
      });
    }
  }

  function hideStableEdgeCandidates(state) {
    if (!state.initialEdgeCandidates?.size) return 0;
    let hiddenCount = 0;
    const tolerance = 4;
    for (const [element, baseline] of state.initialEdgeCandidates) {
      if (!element?.isConnected || state.hiddenElements.has(element)) continue;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (!isVisible(rect, style)) continue;
      const stable = Math.abs(rect.top - baseline.rect.top) <= tolerance
        && Math.abs(rect.left - baseline.rect.left) <= tolerance
        && Math.abs(rect.width - baseline.rect.width) <= tolerance
        && Math.abs(rect.height - baseline.rect.height) <= tolerance;
      if (!stable) continue;
      state.hiddenElements.set(element, saveStyleProperty(element, "visibility"));
      element.style.setProperty("visibility", "hidden", "important");
      hiddenCount += 1;
    }
    return hiddenCount;
  }

  function looksLikeViewportChrome(element, rect, style, containerRect) {
    if (!element || element === document.body || element === document.documentElement) return false;
    if (element.closest?.("article, [role='article'], [data-message-id], [data-message-author-role]")) {
      return false;
    }

    const tag = String(element.tagName || "").toLowerCase();
    const role = String(element.getAttribute?.("role") || "").toLowerCase();
    const identity = `${element.id || ""} ${typeof element.className === "string" ? element.className : ""}`
      .toLowerCase();
    const semanticChrome = tag === "header"
      || tag === "nav"
      || role === "banner"
      || role === "navigation"
      || role === "toolbar";
    const namedChrome = /(^|[\s_-])(site[-_ ]?)?(header|masthead|navbar|navigation|topbar|top-bar|sticky)([\s_-]|$)/i
      .test(identity);
    const pinned = style.position === "fixed"
      || (style.position === "sticky" && isPinnedSticky(element, rect, style, containerRect));

    const viewportWidth = Math.max(1, window.innerWidth);
    const viewportHeight = Math.max(1, window.innerHeight);
    const wideTopBar = rect.top <= Math.max(8, viewportHeight * 0.025)
      && rect.bottom > 0
      && rect.width >= viewportWidth * 0.42
      && rect.height >= 24
      && rect.height <= viewportHeight * 0.35;

    return pinned || ((semanticChrome || namedChrome) && wideTopBar);
  }

  function collectVisibleViewportChrome(state) {
    const found = new Set();
    if (typeof document.elementsFromPoint !== "function") return found;
    const viewportWidth = Math.max(1, window.innerWidth);
    const viewportHeight = Math.max(1, window.innerHeight);
    const sampleXs = [0.02, 0.16, 0.35, 0.5, 0.65, 0.84, 0.98]
      .map((ratio) => Math.min(viewportWidth - 1, Math.max(0, Math.round(viewportWidth * ratio))));
    const sampleYs = [1, 12, 28, 52, 80, 112, Math.min(150, Math.round(viewportHeight * 0.2))]
      .filter((value, index, values) => value < viewportHeight && values.indexOf(value) === index);
    const containerRect = state.scrollTarget?.type === "element"
      ? state.scrollTarget.element.getBoundingClientRect()
      : null;

    for (const y of sampleYs) {
      for (const x of sampleXs) {
        const stack = document.elementsFromPoint(x, y).slice(0, 8);
        for (const hit of stack) {
          let element = hit;
          for (let depth = 0; element && depth < 7; depth += 1, element = element.parentElement) {
            if (found.has(element)) continue;
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            if (!isVisible(rect, style)) continue;
            if (looksLikeViewportChrome(element, rect, style, containerRect)) {
              found.add(element);
            }
          }
        }
      }
    }
    return found;
  }

  function hideVisibleViewportChrome(state) {
    let hiddenCount = 0;
    for (const element of collectVisibleViewportChrome(state)) {
      if (!element?.isConnected || state.hiddenElements.has(element)) continue;
      state.hiddenElements.set(element, saveStyleProperty(element, "visibility"));
      element.style.setProperty("visibility", "hidden", "important");
      hiddenCount += 1;
    }
    return hiddenCount;
  }

  function hideRepeatedOverlays(captureId) {
    const state = requireCapture(captureId);
    let hiddenCount = hideInitialFixedOverlays(state);

    // Sample what is actually visible at the top of the viewport after the
    // first frame. This catches sticky/fixed headers and JS-transformed/recreated
    // mastheads without depending on site-specific selectors.
    hiddenCount += hideVisibleViewportChrome(state);

    // Some sites pin page chrome through wrappers/transforms rather than
    // position:fixed/sticky. If an edge bar from frame one has the same viewport
    // geometry after the page moved, it is viewport chrome and must not repeat.
    hiddenCount += hideStableEdgeCandidates(state);

    // Semantic edge-bar fallback also catches chrome that was recreated by a SPA.
    const pageMetrics = getPageMetrics();
    const regionRect = pageMetrics.cropRectCss || fullViewportCrop({
      viewportWidth: pageMetrics.viewportCssWidth ?? pageMetrics.viewportWidth,
      viewportHeight: pageMetrics.viewportCssHeight ?? pageMetrics.viewportHeight,
    });
    const edgeBars = stability.collectRegionEdgeBars(regionRect);
    const chromeSelector = "header, nav, [role='banner'], [role='navigation'], [role='toolbar']";
    for (const candidate of [...edgeBars.top, ...edgeBars.bottom]) {
      const chromeRoot = candidate.matches?.(chromeSelector)
        ? candidate
        : candidate.closest?.(chromeSelector);
      if (!chromeRoot || state.hiddenElements.has(chromeRoot)) continue;
      const style = window.getComputedStyle(chromeRoot);
      const rect = chromeRoot.getBoundingClientRect();
      if (!isVisible(rect, style)) continue;
      state.hiddenElements.set(chromeRoot, saveStyleProperty(chromeRoot, "visibility"));
      chromeRoot.style.setProperty("visibility", "hidden", "important");
      hiddenCount += 1;
    }

    return { ok: true, hiddenCount };
  }

  async function restorePage(captureId) {
    if (!captureState || captureState.captureId !== captureId) {
      return { ok: true, restored: false };
    }
    const state = captureState;

    try {
      state.iframeExpansion?.restore?.();
      state.iframeExpansion = null;
      for (const snapshot of state.hiddenElements.values()) {
        restoreStyleProperty(snapshot);
      }
      if (state.scrollTarget?.type === "element" && state.scrollTarget.element?.isConnected) {
        const element = state.scrollTarget.element;
        const maximum = Math.max(0, Number(element.scrollHeight) - Number(element.clientHeight));
        element.scrollTop = Math.min(state.originalScrollTop, maximum);
        await settlePage();
      } else {
        await scrollAndSettle(state.originalX, state.originalY);
      }
      state.scrollInterferenceCleanup?.();
      state.scrollbarCleanup?.();
      state.scrollbarCleanup = null;
      for (const snapshot of state.scrollStyles) {
        restoreStyleProperty(snapshot);
      }
      return { ok: true, restored: true };
    } finally {
      captureState = null;
    }
  }

  async function handleMessage(message) {
    const payload = message?.payload || {};
    switch (message?.type) {
      case MESSAGE_TYPES.PREPARE_FULL_PAGE_CAPTURE:
        return prepareFullPageCapture(payload.captureId);
      case MESSAGE_TYPES.GET_PAGE_METRICS:
        requireCapture(payload.captureId);
        return { ok: true, metrics: getPageMetrics() };
      case MESSAGE_TYPES.SCROLL_TO_POSITION:
        return scrollToPosition(payload.captureId, payload.y);
      case MESSAGE_TYPES.SET_INITIAL_FIXED_OVERLAYS_HIDDEN: {
        const state = requireCapture(payload.captureId);
        return { ok: true, hiddenCount: hideInitialFixedOverlays(state) };
      }
      case MESSAGE_TYPES.SET_CAPTURE_OVERLAYS_HIDDEN:
        return hideRepeatedOverlays(payload.captureId);
      case MESSAGE_TYPES.RESTORE_PAGE:
        return restorePage(payload.captureId);
      default:
        return null;
    }
  }

  Object.defineProperty(globalScope, "Scroll2PDFPageCapture", {
    value: Object.freeze({
      getPageMetrics,
      handleMessage,
      hideRepeatedOverlays,
      prepareFullPageCapture,
      resolvePageScrollTarget,
      restorePage,
      scrollToPosition,
      settlePage,
    }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
