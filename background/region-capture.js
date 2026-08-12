(function initializeScroll2PDFRegionCapture(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFRegionCapture) return;

  const { CAPTURE_LIMITS, CAPTURE_PHASES, MESSAGE_TYPES } = globalScope.Scroll2PDFConstants;
  const { buildCaptureFilename, getImageFormat } = globalScope.Scroll2PDFCaptureUtils;
  const PROTECTED_PAGE_MESSAGE = "Scroll2PDF cannot capture this browser-protected page.";

  function requireResponse(response, fallback) {
    if (!response?.ok) throw new Error(response?.error || fallback);
    return response;
  }

  // A page (or scroll container) can grow or shrink while it is captured. Keep
  // the largest observed height while it is still reachable, but adopt a smaller
  // measured height as soon as the current crop covers the new bottom — otherwise
  // the loop keeps chasing a bottom that no longer exists and reports a stall.
  function syncObservedRegionHeight(observed, measured, coveredBottomCss) {
    if (measured < observed
        && coveredBottomCss >= measured - CAPTURE_LIMITS.SCROLL_POSITION_TOLERANCE_CSS) {
      return measured;
    }
    return Math.max(observed, measured);
  }

  function throwIfCancelled(operation) {
    if (operation.cancelRequested) {
      const error = new Error("Capture cancelled");
      error.name = "CaptureCancelledError";
      throw error;
    }
    const durationLimit = operation.difficultCapture
      ? CAPTURE_LIMITS.MAX_DIFFICULT_CAPTURE_DURATION_MS
      : CAPTURE_LIMITS.MAX_CAPTURE_DURATION_MS;        if (Date.now() - operation.startedAt > durationLimit) {
      throw new Error(operation.difficultCapture
        ? "Difficult capture exceeded the 10-minute safety limit."
        : `Capture exceeded the ${Math.round(CAPTURE_LIMITS.MAX_CAPTURE_DURATION_MS / 60000)}-minute safety limit.`);
    }
  }

  function estimatedFrameCount(metrics, completed) {
    const remaining = Math.max(0, metrics.totalContentHeightCss - metrics.contentStartCss);
    const estimate = Math.max(1, Math.ceil(remaining / metrics.contentViewportHeightCss));
    return Math.max(completed, estimate);
  }

  function contentBottomIsCovered(metrics, totalHeight) {
    const position = Number(metrics?.contentPositionCss);
    const viewportHeight = Number(metrics?.contentViewportHeightCss);
    const bottomTolerance = Math.max(
      CAPTURE_LIMITS.SCROLL_POSITION_TOLERANCE_CSS,
      viewportHeight * CAPTURE_LIMITS.BOTTOM_COVER_TOLERANCE_RATIO,
    );
    return Number.isFinite(position)
      && Number.isFinite(viewportHeight)
      && position + viewportHeight >= totalHeight - bottomTolerance;
  }

  async function executeRegionCapture(operation, deps) {
    let selectionConfirmed = false;
    let offscreenReady = false;
    let captureResult;

    try {
      throwIfCancelled(operation);
      const selectingMessage = operation.configuration.captureMode === "scrollable-area"
        ? "Select a scrollable area on the page"
        : "Drag to select an area";
      await operation.report({ phase: CAPTURE_PHASES.SELECTING, message: selectingMessage });
      const selected = await deps.sendTabMessage(operation.tabId, {
        type: MESSAGE_TYPES.START_REGION_SELECTION,
        payload: {
          captureId: operation.captureId,
          captureMode: operation.configuration.captureMode,
        },
      });
      if (selected?.cancelled) {
        operation.cancelRequested = true;
        throwIfCancelled(operation);
      }
      requireResponse(selected, "Area selection could not start on this page.");
      selectionConfirmed = true;
      throwIfCancelled(operation);

      await operation.report({ phase: CAPTURE_PHASES.PREPARING, message: "Preparing selected area…" });
      await deps.ensureOffscreen();
      offscreenReady = true;
      requireResponse(await deps.sendOffscreen({
        type: MESSAGE_TYPES.OFFSCREEN_RESET_CAPTURE,
        target: "offscreen",
        payload: { captureId: operation.captureId },
      }), "Could not initialize image stitching.");

      const prepared = requireResponse(await deps.sendTabMessage(operation.tabId, {
        type: MESSAGE_TYPES.PREPARE_REGION_CAPTURE,
        payload: { captureId: operation.captureId },
      }), PROTECTED_PAGE_MESSAGE);
      let metrics = prepared.metrics;
      if (metrics.difficult) {
        const filename = buildCaptureFilename(
          operation.pageUrl,
          operation.configuration.quality,
          new Date(),
        );
        const stitchedResult = await globalScope.Scroll2PDFDynamicRegionCapture.executeDynamicCapture(
          operation,
          deps,
          metrics,
          { filename, captureModeLabel: metrics.captureModeLabel },
        );
        throwIfCancelled(operation);
        requireResponse(await deps.sendTabMessage(operation.tabId, {
          type: MESSAGE_TYPES.RESTORE_REGION_CAPTURE,
          payload: { captureId: operation.captureId },
        }), "Could not restore the selected chat area.");
        selectionConfirmed = false;
        captureResult = globalScope.Scroll2PDFPdfOutput
          ? await globalScope.Scroll2PDFPdfOutput.finalizeCaptureOutput(operation, deps, stitchedResult)
          : stitchedResult;
        return captureResult;
      }
      // A region that fits in a single frame is also the final frame, so the
      // enter-chat composer must be visible for it (chat scrollable areas only).
      if (operation.configuration.captureMode === "scrollable-area" && metrics.nextPosition === null) {
        requireResponse(await deps.sendTabMessage(operation.tabId, {
          type: MESSAGE_TYPES.RESTORE_REGION_BOTTOM_CHROME,
          payload: { captureId: operation.captureId },
        }), "Could not restore the selected area's bottom bar.");
      }
      let requestedPosition = metrics.scrollPositionCss ?? metrics.contentPositionCss;
      let previousContentPosition = -1;
      let lastCaptureTime = 0;
      let observedTotalHeight = metrics.totalContentHeightCss;
      const contentStartCss = metrics.contentStartCss;
      const captureModeLabel = metrics.captureModeLabel;
      let stallRetries = 0;
      let stallRetrying = false;

      while (true) {
        throwIfCancelled(operation);
        if (operation.completed >= CAPTURE_LIMITS.MAX_VIEWPORT_CAPTURES) {
          throw new Error(`The selected area requires more than ${CAPTURE_LIMITS.MAX_VIEWPORT_CAPTURES} viewport captures.`);
        }
        await deps.assertTargetActive(operation);
        if (operation.completed > 0 && !stallRetrying) {
          requireResponse(await deps.sendTabMessage(operation.tabId, {
            type: MESSAGE_TYPES.SET_REGION_OVERLAYS_HIDDEN,
            payload: { captureId: operation.captureId },
          }), "Could not prepare repeated page overlays.");
        }

        if (!stallRetrying) {
          const throttle = Math.max(0, CAPTURE_LIMITS.MIN_CAPTURE_INTERVAL_MS - (Date.now() - lastCaptureTime));
          if (throttle > 0) await deps.delay(throttle);
          throwIfCancelled(operation);
          const format = getImageFormat(operation.configuration.quality);
          const options = { format: format.captureFormat };
          if (format.captureQuality) options.quality = format.captureQuality;
          const imageDataUrl = await deps.captureVisibleTab(operation.windowId, options);
          lastCaptureTime = Date.now();
          throwIfCancelled(operation);
          await deps.assertTargetActive(operation);

          const addedCapture = requireResponse(await deps.sendOffscreen({
            type: MESSAGE_TYPES.OFFSCREEN_ADD_CAPTURE,
            target: "offscreen",
            payload: {
              captureId: operation.captureId,
              frame: {
                requestedPosition,
                actualY: metrics.contentPositionCss,
                actualScrollPositionCss: metrics.scrollPositionCss ?? metrics.contentPositionCss,
                contentPositionCss: metrics.contentPositionCss,
                contentStartCss,
                contentViewportHeightCss: metrics.contentViewportHeightCss,
                viewportCssWidth: metrics.viewportCssWidth,
                viewportCssHeight: metrics.viewportCssHeight,
                cropRectCss: metrics.cropRectCss,
                timestamp: metrics.timestamp || Date.now(),
                imageDataUrl,
              },
            },
          }), "Could not queue a captured area for stitching.");

          operation.completed += 1;
          // Fail fast for long images that can never fit in one canvas; PDF
          // output keeps going because it paginates beyond the canvas cap.
          if (operation.completed === 1 && operation.configuration.outputType !== "a4-pdf") {
            const viewportWidth = Number(metrics.viewportCssWidth) || 1;
            const scaleY = Number(addedCapture.bitmapWidth) / viewportWidth;
            const estimateHeight = Math.ceil(Math.max(1, observedTotalHeight - contentStartCss) * scaleY);
            if (estimateHeight > CAPTURE_LIMITS.MAX_BITMAP_DIMENSION
              || Number(addedCapture.bitmapWidth) > CAPTURE_LIMITS.MAX_BITMAP_DIMENSION
              || Number(addedCapture.bitmapWidth) * estimateHeight > CAPTURE_LIMITS.MAX_BITMAP_AREA) {
              throw new Error(`This page is too long to capture in one image — the browser limits a single image to ${CAPTURE_LIMITS.MAX_BITMAP_DIMENSION}px per side. Reduce the browser zoom or capture a shorter region, or choose PDF output to paginate long pages automatically.`);
            }
          }
          const latest = requireResponse(await deps.sendTabMessage(operation.tabId, {
            type: MESSAGE_TYPES.GET_REGION_METRICS,
            payload: { captureId: operation.captureId },
          }), "Could not remeasure the selected area.");
          metrics = latest.metrics;
          observedTotalHeight = syncObservedRegionHeight(
            observedTotalHeight,
            metrics.totalContentHeightCss,
            metrics.contentPositionCss + metrics.contentViewportHeightCss,
          );
          operation.total = Math.min(
            CAPTURE_LIMITS.MAX_VIEWPORT_CAPTURES,
            estimatedFrameCount({ ...metrics, totalContentHeightCss: observedTotalHeight }, operation.completed),
          );
          await operation.report({
            phase: CAPTURE_PHASES.CAPTURING,
            completed: operation.completed,
            total: operation.total,
            message: `Capturing… ${operation.completed} / ${operation.total}`,
          });
        }
        stallRetrying = false;

        if (metrics.nextPosition === null) break;
        previousContentPosition = metrics.contentPositionCss;
        requestedPosition = metrics.nextPosition;
        throwIfCancelled(operation);
        const scrolled = requireResponse(await deps.sendTabMessage(operation.tabId, {
          type: MESSAGE_TYPES.SCROLL_REGION_TO_POSITION,
          payload: { captureId: operation.captureId, position: requestedPosition },
        }), "Could not scroll the selected area.");
        metrics = scrolled.metrics;
        // The scroll that reaches the bottom is followed by the final capture;
        // bring the enter-chat composer back so it appears once at the end.
        if (operation.configuration.captureMode === "scrollable-area" && metrics.nextPosition === null) {
          requireResponse(await deps.sendTabMessage(operation.tabId, {
            type: MESSAGE_TYPES.RESTORE_REGION_BOTTOM_CHROME,
            payload: { captureId: operation.captureId },
          }), "Could not restore the selected area's bottom bar.");
        }
        const previousObservedHeight = observedTotalHeight;
        observedTotalHeight = syncObservedRegionHeight(
          observedTotalHeight,
          metrics.totalContentHeightCss,
          metrics.contentPositionCss + metrics.contentViewportHeightCss,
        );
        const regionHeightShrank = metrics.totalContentHeightCss < previousObservedHeight;
        const advanced = metrics.contentPositionCss > previousContentPosition + 0.01;
        const bottomCovered = contentBottomIsCovered(metrics, observedTotalHeight);
        if (!advanced && bottomCovered) {
          break;
        }
        if (!bottomCovered
            && metrics.contentPositionCss <= previousContentPosition
              + CAPTURE_LIMITS.SCROLL_POSITION_TOLERANCE_CSS
            && !regionHeightShrank) {
          // The page may need a beat to settle (virtualized lists re-render on
          // scroll, lazy sections collapse). Re-scroll a few times before
          // declaring a stall, without capturing duplicate frames.
          stallRetries += 1;
          if (stallRetries >= CAPTURE_LIMITS.STALL_RETRY_LIMIT) {
            throw new Error("The selected area stopped advancing before its bottom was captured.");
          }
          stallRetrying = true;
          continue;
        }
        stallRetries = 0;
      }

      throwIfCancelled(operation);
      await operation.report({ phase: CAPTURE_PHASES.STITCHING, message: "Stitching image…" });
      const stitched = requireResponse(await deps.sendOffscreen({
        type: MESSAGE_TYPES.OFFSCREEN_STITCH_CAPTURE,
        target: "offscreen",
        payload: {
          captureId: operation.captureId,
          totalHeightCss: observedTotalHeight,
          contentStartCss,
          quality: operation.configuration.quality,
          filename: buildCaptureFilename(operation.pageUrl, operation.configuration.quality, new Date()),
          captureMode: operation.configuration.captureMode,
          captureModeLabel,
          orientation: operation.configuration.orientation,
          paginatePdf: operation.configuration.outputType === "a4-pdf",
        },
      }), "Image stitching failed.");
      throwIfCancelled(operation);
      if (selectionConfirmed) {
        requireResponse(await deps.sendTabMessage(operation.tabId, {
          type: MESSAGE_TYPES.RESTORE_REGION_CAPTURE,
          payload: { captureId: operation.captureId },
        }), "Could not restore the selected area.");
        selectionConfirmed = false;
      }
      captureResult = globalScope.Scroll2PDFPdfOutput
        ? await globalScope.Scroll2PDFPdfOutput.finalizeCaptureOutput(operation, deps, stitched.result)
        : stitched.result;
    } finally {
      if (selectionConfirmed) {
        try {
          await deps.sendTabMessage(operation.tabId, {
            type: MESSAGE_TYPES.RESTORE_REGION_CAPTURE,
            payload: { captureId: operation.captureId },
          });
        } catch (error) {
          console.warn("Scroll2PDF could not restore the selected area:", error);
        }
      }
      if (offscreenReady) {
        try {
          await deps.sendOffscreen({
            type: MESSAGE_TYPES.OFFSCREEN_RESET_CAPTURE,
            target: "offscreen",
            payload: { captureId: operation.captureId },
          });
        } catch (_) { /* Closing the document also releases frames. */ }
        try { await deps.closeOffscreen(); } catch (_) { /* It may already be closed. */ }
      }
    }

    throwIfCancelled(operation);
    return captureResult;
  }

  Object.defineProperty(globalScope, "Scroll2PDFRegionCapture", {
    value: Object.freeze({ executeRegionCapture }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
