(function initializeScroll2PDFDynamicRegionCapture(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFDynamicRegionCapture) return;

  const { CAPTURE_LIMITS, CAPTURE_PHASES, MESSAGE_TYPES } = globalScope.Scroll2PDFConstants;
  const { getImageFormat } = globalScope.Scroll2PDFCaptureUtils;
  const difficult = globalScope.Scroll2PDFDifficultPageUtils;

  function requireResponse(response, fallback) {
    if (!response?.ok) throw new Error(response?.error || fallback);
    return response;
  }

  function throwIfStopped(operation, now) {
    if (operation.cancelRequested) {
      const error = new Error("Capture cancelled");
      error.name = "CaptureCancelledError";
      throw error;
    }
    difficult.validateTraversalBudget({
      frameCount: operation.completed,
      elapsedMs: now() - operation.startedAt,
    });
  }

  function stateFingerprint(response, metrics) {
    const anchors = (metrics.anchors || []).map((anchor) => anchor.identity).join("|");
    return `${response.fingerprint || ""}:${anchors}`;
  }

  async function advance(operation, deps, corrective) {
    return requireResponse(await deps.sendTabMessage(operation.tabId, {
      type: corrective
        ? MESSAGE_TYPES.RECOVER_DIFFICULT_CAPTURE
        : MESSAGE_TYPES.ADVANCE_DIFFICULT_CAPTURE,
      payload: { captureId: operation.captureId },
    }), "The chat view could not advance reliably.").metrics;
  }

  async function executeDynamicCapture(operation, deps, initialMetrics, output) {
    const now = deps.now || Date.now;
    const tracker = difficult.createRepeatedStateTracker();
    const format = getImageFormat(operation.configuration.quality);
    let metrics = initialMetrics;
    let lastCaptureTime = 0;
    let traversalOrdinal = 0;
    let movementFromPreviousCss = 0;
    let correctiveAttempts = 0;

    operation.difficultCapture = true;
    while (true) {
      throwIfStopped(operation, now);
      if (operation.completed >= CAPTURE_LIMITS.MAX_DYNAMIC_CAPTURE_FRAMES) {
        throw new Error(`Difficult capture exceeds the ${CAPTURE_LIMITS.MAX_DYNAMIC_CAPTURE_FRAMES}-frame safety limit.`);
      }
      await deps.assertTargetActive(operation);
      const throttle = Math.max(
        0,
        CAPTURE_LIMITS.MIN_CAPTURE_INTERVAL_MS - (now() - lastCaptureTime),
      );
      if (throttle) await deps.delay(throttle);
      throwIfStopped(operation, now);

      // From the second kept frame onward, hide the sticky channel header and
      // enter-chat composer so they never repeat mid-capture. The first frame
      // keeps them: the header appears once at the top and (because a chat
      // capture starts at the newest messages) the composer appears once at
      // the very bottom of the result.
      if (operation.completed > 0) {
        requireResponse(await deps.sendTabMessage(operation.tabId, {
          type: MESSAGE_TYPES.SET_REGION_OVERLAYS_HIDDEN,
          payload: { captureId: operation.captureId },
        }), "Could not prepare repeated chat overlays.");
      }

      const options = { format: format.captureFormat };
      if (format.captureQuality) options.quality = format.captureQuality;
      const imageDataUrl = await deps.captureVisibleTab(operation.windowId, options);
      lastCaptureTime = now();
      throwIfStopped(operation, now);

      const queued = requireResponse(await deps.sendOffscreen({
        type: MESSAGE_TYPES.OFFSCREEN_ADD_CAPTURE,
        target: "offscreen",
        payload: {
          captureId: operation.captureId,
          frame: {
            dynamic: true,
            traversalOrdinal,
            captureDirection: metrics.captureDirection,
            logicalMovementCss: movementFromPreviousCss,
            cropRectCss: metrics.cropRectCss,
            viewportCssWidth: metrics.viewportCssWidth,
            viewportCssHeight: metrics.viewportCssHeight,
            contentViewportHeightCss: metrics.clientHeight,
            anchors: metrics.anchors,
            virtualized: Boolean(metrics.virtualized),
            timestamp: metrics.timestamp || now(),
            imageDataUrl,
          },
        },
      }), "Could not queue a chat frame for stitching.");

      const repeatedState = tracker.observe(stateFingerprint(queued, metrics));
      if (repeatedState !== "progress") {
        requireResponse(await deps.sendOffscreen({
          type: MESSAGE_TYPES.OFFSCREEN_DROP_LAST_CAPTURE,
          target: "offscreen",
          payload: { captureId: operation.captureId },
        }), "Could not discard a repeated chat frame.");
        if (repeatedState === "stuck") {
          throw new Error("Scroll2PDF detected a repeating virtualized view.");
        }
        const before = metrics;
        metrics = await advance(
          operation,
          deps,
          correctiveAttempts < CAPTURE_LIMITS.CORRECTIVE_SCROLL_ATTEMPTS,
        );
        correctiveAttempts += 1;
        movementFromPreviousCss = Math.abs((before.scrollTop || 0) - (metrics.scrollTop || 0));
        continue;
      }

      correctiveAttempts = 0;
      traversalOrdinal += 1;
      operation.completed += 1;
      operation.total = 0;
      await operation.report({
        phase: CAPTURE_PHASES.CAPTURING,
        completed: operation.completed,
        total: 0,
        message: `Capturing chat… ${operation.completed} frames`,
      });

      if (metrics.atHistoryBoundary) {
        if (metrics.historyStart) break;
        let history;
        do {
          throwIfStopped(operation, now);
          await operation.report({
            phase: CAPTURE_PHASES.CAPTURING,
            completed: operation.completed,
            total: 0,
            message: `Loading older messages… ${operation.completed} captured`,
          });
          history = requireResponse(await deps.sendTabMessage(operation.tabId, {
            type: MESSAGE_TYPES.LOAD_OLDER_HISTORY,
            payload: { captureId: operation.captureId },
          }), "The chat stopped loading older content.");
          metrics = history.metrics;
        } while (!history.loaded && !history.complete);
        if (history.complete && !history.loaded) break;
        const before = metrics;
        metrics = await advance(operation, deps, false);
        movementFromPreviousCss = Math.abs((before.scrollTop || 0) - (metrics.scrollTop || 0));
        continue;
      }

      const before = metrics;
      metrics = await advance(operation, deps, false);
      movementFromPreviousCss = Math.abs((before.scrollTop || 0) - (metrics.scrollTop || 0));
    }

    throwIfStopped(operation, now);
    await operation.report({ phase: CAPTURE_PHASES.STITCHING, message: "Stitching chat…" });
    const stitched = requireResponse(await deps.sendOffscreen({
      type: MESSAGE_TYPES.OFFSCREEN_STITCH_CAPTURE,
      target: "offscreen",
      payload: {
        captureId: operation.captureId,
        dynamicFrameChain: true,
        captureDirection: initialMetrics.captureDirection || "upward",
        quality: operation.configuration.quality,
        filename: output.filename,
        captureMode: operation.configuration.captureMode,
        captureModeLabel: output.captureModeLabel,
      },
    }), "Chat stitching failed.");
    return stitched.result;
  }

  Object.defineProperty(globalScope, "Scroll2PDFDynamicRegionCapture", {
    value: Object.freeze({ executeDynamicCapture }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
