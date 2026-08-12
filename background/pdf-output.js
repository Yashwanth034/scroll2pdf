(function initializeScroll2PDFPdfOutput(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFPdfOutput) return;

  const { CAPTURE_LIMITS, CAPTURE_PHASES, MESSAGE_TYPES, OUTPUT_TYPES } = globalScope.Scroll2PDFConstants;
  const { buildPdfFilename } = globalScope.Scroll2PDFPdfUtils;

  function requireResponse(response, fallback) {
    if (!response?.ok) throw new Error(response?.error || fallback);
    return response;
  }

  function throwIfCancelled(operation) {
    if (operation.cancelRequested) {
      const error = new Error("Capture cancelled");
      error.name = "CaptureCancelledError";
      throw error;
    }
    if (Number.isFinite(operation.startedAt)
        && Date.now() - operation.startedAt > CAPTURE_LIMITS.MAX_CAPTURE_DURATION_MS) {
      throw new Error(`Capture exceeded the ${Math.round(CAPTURE_LIMITS.MAX_CAPTURE_DURATION_MS / 60000)}-minute safety limit.`);
    }
  }

  async function finalizeCaptureOutput(operation, deps, stitchedResult) {
    if (operation.configuration.outputType === OUTPUT_TYPES.LONG_IMAGE) return stitchedResult;
    if (operation.configuration.outputType !== OUTPUT_TYPES.A4_PDF) {
      throw new Error("Unsupported capture output type.");
    }
    // Extremely long pages are paginated directly from the captured frames
    // during stitching (they exceed the browser's single-canvas limit), so the
    // stitch already returned a finished PDF.
    if (stitchedResult?.mimeType === "application/pdf") return stitchedResult;
    throwIfCancelled(operation);
    const filename = buildPdfFilename(operation.pageUrl, new Date());
    const planned = requireResponse(await deps.sendOffscreen({
      type: MESSAGE_TYPES.OFFSCREEN_PLAN_PDF,
      target: "offscreen",
      payload: {
        captureId: operation.captureId,
        sourceResultId: stitchedResult.resultId,
        orientation: operation.configuration.orientation,
        quality: operation.configuration.quality,
        filename,
      },
    }), "PDF pagination failed.");
    const pageCount = Number(planned.pageCount);
    if (!Number.isInteger(pageCount) || pageCount < 1) {
      throw new Error("PDF pagination produced no pages.");
    }
    await operation.report({
      phase: CAPTURE_PHASES.CREATING_PDF,
      completed: 0,
      total: pageCount,
      message: `Creating PDF… 0 / ${pageCount}`,
    });
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      throwIfCancelled(operation);
      requireResponse(await deps.sendOffscreen({
        type: MESSAGE_TYPES.OFFSCREEN_RENDER_PDF_PAGE,
        target: "offscreen",
        payload: { captureId: operation.captureId, pageIndex },
      }), `PDF page ${pageIndex + 1} could not be created.`);
      throwIfCancelled(operation);
      await operation.report({
        phase: CAPTURE_PHASES.CREATING_PDF,
        completed: pageIndex + 1,
        total: pageCount,
        message: `Creating PDF… ${pageIndex + 1} / ${pageCount}`,
      });
    }
    throwIfCancelled(operation);
    return requireResponse(await deps.sendOffscreen({
      type: MESSAGE_TYPES.OFFSCREEN_FINALIZE_PDF,
      target: "offscreen",
      payload: { captureId: operation.captureId },
    }), "PDF finalization failed.").result;
  }

  Object.defineProperty(globalScope, "Scroll2PDFPdfOutput", {
    value: Object.freeze({ finalizeCaptureOutput, throwIfCancelled }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
