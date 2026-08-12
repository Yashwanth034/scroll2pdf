(function initializeScroll2PDFDifficultPageCapture(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFDifficultPageCapture) return;

  const { CAPTURE_LIMITS } = globalScope.Scroll2PDFConstants;
  const difficult = globalScope.Scroll2PDFDifficultPageUtils;
  const stability = globalScope.Scroll2PDFCaptureStability;
  const DEFAULT_ANCHOR_SELECTOR = globalScope.Scroll2PDFGenericChatAdapter?.GENERIC_MESSAGE_SELECTOR
    || "[data-message-id],[data-mid],[data-id],[data-timestamp],[role=\"listitem\"],[role=\"row\"]";

  function createController(options = {}) {
    const element = options.element;
    const contentRoot = options.contentRoot || element;
    const target = options.target || {};
    const documentValue = options.document || globalScope.document;
    const windowValue = options.window || globalScope.window;
    const locationValue = options.location || globalScope.location;
    const settlePage = options.settlePage || globalScope.Scroll2PDFPageCapture?.settlePage || (async () => {});
    const wait = options.wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    const now = options.now || Date.now;
    const weakIdentities = new WeakMap();
    let nextWeakIdentity = 1;
    let prepared = false;
    let cancelled = false;
    let mutationVersion = 0;
    let observer = null;
    let captureStyles = null;
    let restoreSmooth = null;
    let restoreScrollbar = null;
    let original = null;
    let initialContext = null;
    let previousVirtualizationSnapshot = null;
    let virtualizationDetected = false;
    let stableHistoryAttempts = 0;
    let historyLoadAttempts = 0;
    // State measured immediately before the most recent upward scroll step. When
    // the capture reaches the top of the loaded history, the app itself prepends
    // older messages and compensates the scroll position — often before the
    // coordinator's loadOlderHistory call arrives. Comparing against this
    // pre-scroll baseline (instead of the already-mutated current state) lets
    // the controller recognize a load that already landed, so it neither loops
    // back to the top (the visible up-and-down bounce) nor recaptures the same
    // viewport.
    let lastAdvanceBefore = null;

    function requireActive() {
      if (cancelled) {
        const error = new Error("Capture cancelled");
        error.name = "CaptureCancelledError";
        throw error;
      }
      if (!prepared) throw new Error("The difficult-page capture session is not prepared.");
      if (!element?.isConnected) throw new Error("The selected chat view could not be captured reliably.");
    }

    function descriptorFor(node, index) {
      const attributes = {};
      for (const name of difficult.STABLE_ATTRIBUTE_ORDER) {
        const value = node.getAttribute?.(name);
        if (value) attributes[name] = value;
      }
      if (!weakIdentities.has(node)) weakIdentities.set(node, `weak-${nextWeakIdentity++}`);
      return {
        id: node.id,
        attributes,
        structuralPath: String(index),
        sessionIdentity: weakIdentities.get(node),
      };
    }

    function visibleAnchors(rect) {
      let nodes = [];
      try {
        nodes = Array.from(contentRoot.querySelectorAll(target.messageSelector || DEFAULT_ANCHOR_SELECTOR));
      } catch (_) {
        nodes = Array.from(contentRoot.querySelectorAll?.("*") || []);
      }
      return nodes.slice(0, CAPTURE_LIMITS.MAX_OVERLAY_SCAN_ELEMENTS)
        .map((node, index) => {
          const nodeRect = node.getBoundingClientRect?.();
          const trackingMargin = Math.max(rect.height || 0, Number(element.clientHeight) || 0);
          if (!nodeRect
              || nodeRect.bottom <= rect.top - trackingMargin
              || nodeRect.top >= rect.bottom + trackingMargin) return null;
          const identity = difficult.getStableAnchorIdentity(descriptorFor(node, index));
          return identity ? { identity, viewportY: Number(nodeRect.top) || 0 } : null;
        })
        .filter(Boolean)
        .slice(0, 12);
    }

    function conversationIdentity() {
      if (target.conversationIdentity) return String(target.conversationIdentity);
      for (const name of ["data-conversation-id", "data-chat-id", "data-peer-id"]) {
        const value = element.getAttribute?.(name) || contentRoot.getAttribute?.(name);
        if (value) return `${name}:${value}`;
      }
      return "";
    }

    function currentContext() {
      return difficult.createCaptureContext({
        url: locationValue.href || `${locationValue.origin || ""}${locationValue.pathname || ""}`,
        scrollerIdentity: difficult.getStableAnchorIdentity(descriptorFor(element, 0)),
        conversationIdentity: conversationIdentity(),
      });
    }

    function rawMetrics(validateContext = true) {
      const rawRect = element.getBoundingClientRect();
      const cropRect = original
        ? difficult.normalizeDynamicCrop({ original: original.rect, current: rawRect })
        : {
          left: rawRect.left, top: rawRect.top, right: rawRect.right, bottom: rawRect.bottom,
          width: rawRect.width, height: rawRect.height,
        };
      if (validateContext && initialContext && difficult.captureContextChanged(initialContext, currentContext())) {
        throw new Error("The selected conversation changed during capture.");
      }
      const anchors = visibleAnchors(cropRect);
      const snapshot = {
        childCount: contentRoot.querySelectorAll?.("*")?.length || 0,
        scrollHeight: Number(element.scrollHeight) || 0,
        firstAnchor: anchors[0]?.identity || "",
        lastAnchor: anchors.at(-1)?.identity || "",
        scrollPosition: Number(element.scrollTop) || 0,
      };
      const newlyVirtualized = previousVirtualizationSnapshot
        ? difficult.detectLikelyVirtualization({ previous: previousVirtualizationSnapshot, current: snapshot })
        : false;
      virtualizationDetected = virtualizationDetected || newlyVirtualized;
      previousVirtualizationSnapshot = snapshot;
      return {
        difficult: true,
        adapterId: target.adapterId || "generic-chat",
        captureModeLabel: target.label || "Chat / scrollable area",
        captureDirection: target.captureDirection || "upward",
        naturalOrder: target.naturalOrder || "oldest-to-newest",
        scrollTop: snapshot.scrollPosition,
        scrollHeight: snapshot.scrollHeight,
        clientHeight: Number(element.clientHeight) || cropRect.height,
        childCount: snapshot.childCount,
        cropRectCss: cropRect,
        viewportCssWidth: windowValue.innerWidth,
        viewportCssHeight: windowValue.innerHeight,
        anchors,
        firstAnchor: snapshot.firstAnchor,
        lastAnchor: snapshot.lastAnchor,
        atHistoryBoundary: snapshot.scrollPosition <= 2,
        historyStart: Boolean(contentRoot.querySelector?.("[data-scroll2pdf-history-start],[data-history-start]")),
        loading: Boolean(contentRoot.querySelector?.("[aria-busy=\"true\"],[role=\"progressbar\"]")),
        virtualized: virtualizationDetected,
        mutationVersion,
        timestamp: Date.now(),
      };
    }

    async function waitForMedia(metrics) {
      return stability.waitForVisibleMedia({
        root: contentRoot,
        cropRect: metrics.cropRectCss,
        wait,
        now,
        timeoutMs: CAPTURE_LIMITS.LAZY_MEDIA_WAIT_MS,
      });
    }

    async function setScrollTop(value) {
      if (typeof element.scrollTo === "function") element.scrollTo({ top: value, behavior: "auto" });
      else element.scrollTop = value;
      await settlePage();
    }

    async function prepare() {
      if (prepared) throw new Error("The difficult-page capture session is already prepared.");
      const rect = element.getBoundingClientRect();
      const anchors = visibleAnchors(rect);
      original = {
        scrollTop: Number(element.scrollTop) || 0,
        nearBottom: Number(element.scrollTop) + Number(element.clientHeight)
          >= Number(element.scrollHeight) - 4,
        rect: {
          left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
          width: rect.width, height: rect.height,
        },
        anchors,
      };
      initialContext = currentContext();
      restoreSmooth = stability.disableSmoothScrolling(element);
      restoreScrollbar = stability.hideScrollbar(element);
      captureStyles = stability.installScopedCaptureStyles({
        root: contentRoot,
        document: documentValue,
        captureId: options.captureId,
      });
      if (typeof globalScope.MutationObserver === "function") {
        observer = new globalScope.MutationObserver(() => { mutationVersion += 1; });
        observer.observe(contentRoot, { childList: true, subtree: true, attributes: true });
      }
      prepared = true;
      const metrics = rawMetrics(false);
      await waitForMedia(metrics);
      return { ok: true, metrics: rawMetrics() };
    }

    function getMetrics() {
      requireActive();
      return rawMetrics();
    }

    async function advanceUpward(optionsValue = {}) {
      requireActive();
      const before = rawMetrics();
      lastAdvanceBefore = before;
      const step = Math.max(64, before.clientHeight * (optionsValue.corrective ? 0.15 : 0.78));
      await setScrollTop(Math.max(0, before.scrollTop - step));
      const after = rawMetrics();
      await waitForMedia(after);
      return {
        ok: true,
        anchorDisplacement: difficult.calculateAnchorDisplacement(before.anchors, after.anchors),
        metrics: rawMetrics(),
      };
    }

    async function loadOlderHistory() {
      requireActive();
      historyLoadAttempts += 1;
      if (historyLoadAttempts > CAPTURE_LIMITS.MAX_HISTORY_LOAD_ATTEMPTS) {
        throw new Error("The chat stopped loading older content.");
      }
      // The app usually starts loading older messages as soon as the capture's
      // advance scrolls to the top, and it may have already prepended and
      // compensated by the time this message arrives. Measure progress against
      // the state before that scroll, not the already-mutated current state.
      const baseline = lastAdvanceBefore || rawMetrics();
      const mutationBaseline = baseline.mutationVersion;
      // Do NOT scroll back to the top here: the advance that reached the top
      // already fired the app's load-on-scroll listener, and the app may have
      // compensated the viewport since. Re-scrolling would visibly bounce the
      // chat back to the top and could trigger a second, spurious history load.
      const maximumChecks = Math.max(
        CAPTURE_LIMITS.HISTORY_STABLE_CHECKS,
        Math.ceil(CAPTURE_LIMITS.HISTORY_MUTATION_WAIT_MS / CAPTURE_LIMITS.HISTORY_STABLE_INTERVAL_MS),
      );
      let after = rawMetrics();
      let anchorDisplacement = difficult.calculateAnchorDisplacement(baseline.anchors, after.anchors);
      let loaded = false;
      for (let check = 0; check < maximumChecks; check += 1) {
        requireActive();
        await wait(CAPTURE_LIMITS.HISTORY_STABLE_INTERVAL_MS);
        after = rawMetrics();
        anchorDisplacement = difficult.calculateAnchorDisplacement(baseline.anchors, after.anchors);
        loaded = after.scrollHeight > baseline.scrollHeight + 1
          || mutationVersion !== mutationBaseline
          || (Number.isFinite(anchorDisplacement) && Math.abs(anchorDisplacement) > 1)
          || (after.firstAnchor && baseline.firstAnchor && after.firstAnchor !== baseline.firstAnchor);
        if (loaded) break;
      }
      if (loaded) stableHistoryAttempts = 0;
      else stableHistoryAttempts += 1;
      return {
        ok: true,
        loaded,
        anchorDisplacement,
        complete: after.historyStart || stableHistoryAttempts >= CAPTURE_LIMITS.HISTORY_STABLE_RETRIES,
        attempts: historyLoadAttempts,
        metrics: after,
      };
    }

    async function restore() {
      if (!prepared && !original) return { ok: true, restored: false };
      try {
        observer?.disconnect();
        observer = null;
        captureStyles?.cleanup();
        captureStyles = null;
        restoreSmooth?.();
        restoreSmooth = null;
        restoreScrollbar?.();
        restoreScrollbar = null;
        if (element?.isConnected && original) {
          const targetPosition = original.nearBottom
            ? Math.max(0, Number(element.scrollHeight) - Number(element.clientHeight))
            : original.scrollTop;
          await setScrollTop(targetPosition);
          const currentAnchors = visibleAnchors(original.rect);
          const displacement = difficult.calculateAnchorDisplacement(original.anchors, currentAnchors);
          if (!original.nearBottom && Number.isFinite(displacement) && Math.abs(displacement) > 0.5) {
            await setScrollTop((Number(element.scrollTop) || 0) + displacement);
          }
        }
        return { ok: true, restored: true };
      } finally {
        prepared = false;
      }
    }

    function cancel() {
      cancelled = true;
      observer?.disconnect();
      return { ok: true, cancelled: true };
    }

    return Object.freeze({
      advanceUpward,
      cancel,
      getMetrics,
      loadOlderHistory,
      prepare,
      restore,
      waitForMedia,
    });
  }

  Object.defineProperty(globalScope, "Scroll2PDFDifficultPageCapture", {
    value: Object.freeze({ createController }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
