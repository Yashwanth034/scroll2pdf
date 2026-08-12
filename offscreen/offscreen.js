(function initializeScroll2PDFOffscreen(globalScope) {
  "use strict";

  const { CAPTURE_LIMITS, MESSAGE_TYPES } = globalScope.Scroll2PDFConstants;
  const {
    calculateFrameDrawPlan,
    convertCssRectToBitmapCrop,
    getImageFormat,
    validateCanvasSize,
  } = globalScope.Scroll2PDFCaptureUtils;
  const resultStore = globalScope.Scroll2PDFResultStore;
  let capture = null;

  class OffscreenCancelledError extends Error {
    constructor() {
      super("Capture cancelled");
      this.name = "OffscreenCancelledError";
    }
  }

  function requireCapture(captureId) {
    if (!capture || capture.captureId !== captureId) {
      throw new Error("The offscreen capture session is unavailable.");
    }
    if (capture.cancelled) {
      throw new OffscreenCancelledError();
    }
    return capture;
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("A captured viewport could not be decoded."));
      image.src = dataUrl;
    });
  }

  function canvasToBlob(canvas, mimeType, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("The stitched image could not be encoded."));
        }
      }, mimeType, quality);
    });
  }

  async function resetCapture(captureId) {
    if (globalScope.Scroll2PDFPdfGenerator) {
      await globalScope.Scroll2PDFPdfGenerator.resetPdf();
    }
    capture = {
      captureId,
      cancelled: false,
      frames: [],
    };
    return { ok: true };
  }

  async function addCaptureFrame(payload) {
    const current = requireCapture(payload.captureId);
    const frame = payload.frame;
    const contentPosition = Number.isFinite(frame?.contentPositionCss)
      ? frame.contentPositionCss
      : frame?.actualY;
    if (!frame?.imageDataUrl || (!frame.dynamic && !Number.isFinite(contentPosition))) {
      throw new Error("Captured viewport metadata is incomplete.");
    }
    const image = await loadImage(frame.imageDataUrl);
    try {
      requireCapture(payload.captureId);
      const storedFrame = {
        ...frame,
        bitmapWidth: image.naturalWidth,
        bitmapHeight: image.naturalHeight,
      };
      // A normal screenshot is the whole visible viewport: its crop is the full
      // bitmap, so the stitcher can save it as-is without any coordinate math.
      if (frame.screenshot && !frame.cropRectCss) {
        storedFrame.cropRectCss = {
          left: 0,
          top: 0,
          right: image.naturalWidth,
          bottom: image.naturalHeight,
          width: image.naturalWidth,
          height: image.naturalHeight,
        };
        storedFrame.viewportCssWidth = image.naturalWidth;
        storedFrame.viewportCssHeight = image.naturalHeight;
        storedFrame.contentViewportHeightCss = image.naturalHeight;
      }
      let fingerprint = "";
      if (frame.dynamic) {
        const crop = convertCssRectToBitmapCrop({
          rect: frame.cropRectCss,
          viewportCssWidth: frame.viewportCssWidth,
          viewportCssHeight: frame.viewportCssHeight,
          bitmapWidth: image.naturalWidth,
          bitmapHeight: image.naturalHeight,
        });
        const analysisCanvas = document.createElement("canvas");
        analysisCanvas.width = crop.width;
        analysisCanvas.height = crop.height;
        const analysisContext = analysisCanvas.getContext("2d", { willReadFrequently: true });
        if (!analysisContext) throw new Error("Frame analysis is unavailable.");
        analysisContext.drawImage(
          image, crop.x, crop.y, crop.width, crop.height,
          0, 0, crop.width, crop.height,
        );
        const pixels = analysisContext.getImageData(0, 0, crop.width, crop.height);
        const visual = globalScope.Scroll2PDFFrameAnalysis.createVisualFingerprint({
          data: pixels, width: crop.width, height: crop.height,
        });
        const rows = globalScope.Scroll2PDFFrameAnalysis.createRowSignatures({
          data: pixels, width: crop.width, height: crop.height,
        });
        const bandHeight = Math.min(crop.height, Math.max(
          512,
          Math.ceil(crop.height * 0.4),
          Math.ceil(CAPTURE_LIMITS.MAX_SEAM_SEARCH_CSS * crop.scaleY * 2),
        ));
        storedFrame.analysis = {
          fingerprint: visual.hash,
          topRows: rows.slice(0, bandHeight),
          bottomRows: rows.slice(-bandHeight),
        };
        fingerprint = visual.hash;
        analysisCanvas.width = 1;
        analysisCanvas.height = 1;
      }
      current.frames.push(storedFrame);
      return {
        ok: true,
        bitmapWidth: image.naturalWidth,
        bitmapHeight: image.naturalHeight,
        fingerprint,
      };
    } finally {
      image.src = "";
    }
  }

  function dropLastCapture(payload) {
    const current = requireCapture(payload.captureId);
    const dropped = current.frames.pop();
    if (dropped) dropped.imageDataUrl = "";
    return { ok: true, dropped: Boolean(dropped) };
  }

  async function saveStitchedResult(payload, current, canvas, format) {
    const blob = await canvasToBlob(canvas, format.mimeType, format.encodeQuality);
    requireCapture(payload.captureId);
    const resultId = globalScope.crypto.randomUUID();
    const record = {
      resultId,
      blob,
      width: canvas.width,
      height: canvas.height,
      mimeType: format.mimeType,
      filename: payload.filename,
      size: blob.size,
      createdAt: Date.now(),
      captureMode: payload.captureMode || "full-page",
      captureModeLabel: payload.captureModeLabel || "Full Page",
      imageFormat: format.mimeType === "image/png" ? "PNG" : "JPEG",
    };
    await resultStore.saveResult(record);
    requireCapture(payload.captureId);
    return {
      ok: true,
      result: {
        resultId,
        width: record.width,
        height: record.height,
        mimeType: record.mimeType,
        filename: record.filename,
        size: record.size,
        captureMode: record.captureMode,
        captureModeLabel: record.captureModeLabel,
        imageFormat: record.imageFormat,
      },
    };
  }

  async function stitchDynamicFrameChain(payload) {
    const current = requireCapture(payload.captureId);
    if (!current.frames.length) throw new Error("No captured chat frames are available to stitch.");
    const ordered = globalScope.Scroll2PDFDifficultPageUtils.orderFrameChain(
      current.frames,
      payload.captureDirection || "upward",
    );
    const cropFor = (frame) => convertCssRectToBitmapCrop({
      rect: frame.cropRectCss,
      viewportCssWidth: frame.viewportCssWidth,
      viewportCssHeight: frame.viewportCssHeight,
      bitmapWidth: frame.bitmapWidth,
      bitmapHeight: frame.bitmapHeight,
    });
    const firstCrop = cropFor(ordered[0]);
    const plannedFrames = [];
    for (let index = 0; index < ordered.length; index += 1) {
      const frame = ordered[index];
      const crop = cropFor(frame);
      const widthTolerance = Math.max(
        CAPTURE_LIMITS.CROP_WIDTH_TOLERANCE_PX,
        firstCrop.width * CAPTURE_LIMITS.CROP_WIDTH_TOLERANCE_RATIO,
      );
      if (Math.abs(crop.width - firstCrop.width) > widthTolerance) {
        throw new Error("The selected chat area changed too much during capture.");
      }
      let overlap = 0;
      if (index > 0) {
        const upper = ordered[index - 1];
        const movementCss = Number(upper.logicalMovementCss || frame.logicalMovementCss) || 0;
        const predicted = Math.max(0, Math.round(crop.height - (movementCss * crop.scaleY)));
        const searchRadius = Math.min(
          Math.ceil(CAPTURE_LIMITS.MAX_SEAM_SEARCH_CSS * crop.scaleY),
          Math.max(0, predicted - 1),
        );
        const match = globalScope.Scroll2PDFSeamPlanner.findMatchingSeam({
          upperRows: upper.analysis?.bottomRows || [],
          lowerRows: frame.analysis?.topRows || [],
          predictedOverlap: predicted,
          searchRadius,
          comparisonRows: Math.min(32, Math.max(8, Math.round(crop.scaleY * 16))),
        });
        overlap = Math.min(crop.height - 1, match.overlap);
      }
      plannedFrames.push({ id: index, cropHeight: crop.height, overlapWithPrevious: overlap, crop, frame });
    }
    const plan = globalScope.Scroll2PDFSeamPlanner.buildFrameChainPlan(plannedFrames);
    const finalSize = validateCanvasSize(firstCrop.width, plan.height);
    const canvas = document.createElement("canvas");
    canvas.width = finalSize.width;
    canvas.height = finalSize.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas image processing is unavailable.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    try {
      for (let index = 0; index < plan.frames.length; index += 1) {
        requireCapture(payload.captureId);
        const draw = plan.frames[index];
        const planned = plannedFrames[index];
        const image = await loadImage(planned.frame.imageDataUrl);
        try {
          if (draw.sourceHeight > 0) {
            context.drawImage(
              image,
              planned.crop.x,
              planned.crop.y + draw.sourceY,
              planned.crop.width,
              draw.sourceHeight,
              0,
              draw.destinationY,
              canvas.width,
              draw.sourceHeight,
            );
          }
        } finally {
          image.src = "";
          planned.frame.imageDataUrl = "";
          planned.frame.analysis = null;
        }
        await Promise.resolve();
      }
      const format = getImageFormat(payload.quality);
      return await saveStitchedResult(payload, current, canvas, format);
    } finally {
      current.frames.length = 0;
      canvas.width = 1;
      canvas.height = 1;
    }
  }

  // Finds a quiet page boundary inside the streaming row buffer. All
  // coordinates are local bitmap rows (buffer row 0 = current page start).
  async function findPdfBreakInBuffer(bufferContext, analysisCanvas, idealEnd, searchWindow, sourceHeight) {
    const pdfUtils = globalScope.Scroll2PDFPdfUtils;
    const minimumEnd = Math.max(
      1,
      pdfUtils.getSmartBreakMinimumEnd(0, idealEnd),
      idealEnd - searchWindow,
    );
    const analysisHeight = idealEnd - minimumEnd;
    if (analysisHeight < 4) return idealEnd;
    analysisCanvas.width = Math.min(96, bufferContext.canvas.width);
    analysisCanvas.height = analysisHeight;
    const context = analysisCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!context) return idealEnd;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, analysisCanvas.width, analysisCanvas.height);
    const insetX = Math.floor(bufferContext.canvas.width * 0.125);
    const analyzedWidth = Math.max(1, bufferContext.canvas.width - (insetX * 2));
    context.drawImage(
      bufferContext.canvas,
      insetX,
      minimumEnd,
      analyzedWidth,
      analysisHeight,
      0,
      0,
      analysisCanvas.width,
      analysisHeight,
    );
    try {
      const localScores = pdfUtils.calculateRowInformationScores(
        context.getImageData(0, 0, analysisCanvas.width, analysisHeight),
        analysisCanvas.width,
        analysisHeight,
      );
      const scores = new Array(Math.max(1, idealEnd)).fill(NaN);
      localScores.forEach((score, index) => { scores[minimumEnd + index] = score; });
      return pdfUtils.chooseSmartBreak({
        start: 0,
        idealEnd,
        sourceHeight,
        scores,
        searchWindow,
      });
    } catch (_) {
      return idealEnd;
    } finally {
      analysisCanvas.width = 1;
      analysisCanvas.height = 1;
    }
  }

  async function emitPdfPageFromBuffer(pdf, writer, pageCanvas, bufferContext, breakBitmap, layout, quality) {
    pageCanvas.height = breakBitmap;
    const context = pageCanvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas PDF processing is unavailable.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    context.drawImage(
      bufferContext.canvas,
      0, 0, pageCanvas.width, breakBitmap,
      0, 0, pageCanvas.width, breakBitmap,
    );
    const { bytes, filter } = await pdf.encodeCanvasPage(pageCanvas, quality);
    writer.addImagePage({
      bytes,
      width: pageCanvas.width,
      height: breakBitmap,
      filter,
      displayWidthPt: layout.displayWidthPt,
      displayHeightPt: breakBitmap * layout.scale,
    });
    pageCanvas.height = 1;
  }

  function shiftBufferUp(context, rows, fill) {
    if (rows <= 0) return;
    const canvas = context.canvas;
    if (fill <= rows) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const remaining = fill - rows;
    context.drawImage(canvas, 0, rows, canvas.width, remaining, 0, 0, canvas.width, remaining);
    context.clearRect(0, remaining, canvas.width, canvas.height - remaining);
  }

  // Streaming PDF pagination for pages whose stitched image would exceed the
  // browser's single-canvas limit (32,767px per side). Captured rows accumulate
  // in a bounded buffer and are emitted as A4 pages one at a time, so the
  // full-height source image never needs to exist in memory.
  async function stitchPdfFromFrames(payload, current, frames, firstCrop, contentStartCss, sourceHeightBitmap) {
    const pdfUtils = globalScope.Scroll2PDFPdfUtils;
    const pdf = globalScope.Scroll2PDFPdfGenerator;
    const pageSpec = pdfUtils.getA4PageSpec(payload.orientation || "portrait");
    const layout = pdfUtils.calculatePdfLayout(firstCrop.width, sourceHeightBitmap, pageSpec);
    const writer = pdf.createPdfWriter(pageSpec, payload.filename);
    const cropFor = (frame) => convertCssRectToBitmapCrop({
      rect: frame.cropRectCss,
      viewportCssWidth: frame.viewportCssWidth,
      viewportCssHeight: frame.viewportCssHeight,
      bitmapWidth: frame.bitmapWidth,
      bitmapHeight: frame.bitmapHeight,
    });
    const searchWindow = pdfUtils.getSmartBreakSearchWindow(sourceHeightBitmap);
    const bufferCapacity = Math.ceil(layout.sourcePixelsPerPage + searchWindow + 96);
    const buffer = document.createElement("canvas");
    buffer.width = firstCrop.width;
    buffer.height = Math.max(bufferCapacity, 128);
    const bufferContext = buffer.getContext("2d", { alpha: false });
    if (!bufferContext) throw new Error("Canvas image processing is unavailable.");
    const analysisCanvas = document.createElement("canvas");
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = firstCrop.width;
    let fill = 0;
    let coveredBottomCss = contentStartCss;
    let pageCount = 0;
    try {
      for (let index = 0; index < frames.length; index += 1) {
        requireCapture(payload.captureId);
        const frame = frames[index];
        const crop = cropFor(frame);
        const plan = calculateFrameDrawPlan({
          actualY: frame.contentPositionCss ?? frame.actualY,
          viewportCssHeight: frame.contentViewportHeightCss ?? frame.viewportCssHeight,
          bitmapHeight: crop.height,
          totalHeightCss: payload.totalHeightCss,
          coveredBottomCss,
          contentStartCss,
          scaleY: crop.scaleY,
          finalBitmapHeight: sourceHeightBitmap,
        });
        const image = await loadImage(frame.imageDataUrl);
        try {
          if (plan.sourceHeight > 0) {
            bufferContext.drawImage(
              image,
              crop.x,
              crop.y + plan.sourceY,
              crop.width,
              plan.sourceHeight,
              0,
              fill,
              buffer.width,
              plan.sourceHeight,
            );
            fill += plan.sourceHeight;
          }
        } finally {
          image.src = "";
          frame.imageDataUrl = "";
          frame.analysis = null;
        }
        coveredBottomCss = plan.nextCoveredBottomCss;
        while (fill >= layout.sourcePixelsPerPage + searchWindow) {
          const breakBitmap = await findPdfBreakInBuffer(
            bufferContext, analysisCanvas, layout.sourcePixelsPerPage, searchWindow, sourceHeightBitmap,
          );
          await emitPdfPageFromBuffer(pdf, writer, pageCanvas, bufferContext, breakBitmap, layout, payload.quality);
          pageCount += 1;
          shiftBufferUp(bufferContext, breakBitmap, fill);
          fill -= breakBitmap;
          if (pageCount >= CAPTURE_LIMITS.MAX_PDF_PAGES) {
            throw new Error(`PDF exceeds the ${CAPTURE_LIMITS.MAX_PDF_PAGES}-page safety limit.`);
          }
        }
        await Promise.resolve();
      }
      if (fill > 0) {
        let breakBitmap = fill;
        if (fill >= pdfUtils.getSmartBreakMinimumEnd(0, fill) + 1) {
          const smart = await findPdfBreakInBuffer(bufferContext, analysisCanvas, fill, searchWindow, sourceHeightBitmap);
          if (Number.isFinite(smart) && smart >= pdfUtils.getSmartBreakMinimumEnd(0, fill) && smart < fill) {
            breakBitmap = smart;
          }
        }
        await emitPdfPageFromBuffer(pdf, writer, pageCanvas, bufferContext, breakBitmap, layout, payload.quality);
        pageCount += 1;
      }
      if (pageCount === 0) throw new Error("PDF pagination produced no pages.");
      return await pdf.savePdfResult({
        bytes: writer.build(),
        width: firstCrop.width,
        height: sourceHeightBitmap,
        filename: payload.filename,
        captureMode: payload.captureMode,
        captureModeLabel: payload.captureModeLabel,
        orientation: payload.orientation,
        pageCount,
      });
    } finally {
      current.frames.length = 0;
      buffer.width = 1;
      buffer.height = 1;
      analysisCanvas.width = 1;
      analysisCanvas.height = 1;
      pageCanvas.width = 1;
      pageCanvas.height = 1;
    }
  }

  async function stitchCapture(payload) {
    if (payload.dynamicFrameChain) return stitchDynamicFrameChain(payload);
    const current = requireCapture(payload.captureId);
    // A normal screenshot is a single full-viewport frame saved unchanged.
    if (payload.screenshot) {
      const frame = current.frames[0];
      if (!frame?.imageDataUrl) throw new Error("No screenshot was captured.");
      const crop = convertCssRectToBitmapCrop({
        rect: frame.cropRectCss,
        viewportCssWidth: frame.viewportCssWidth,
        viewportCssHeight: frame.viewportCssHeight,
        bitmapWidth: frame.bitmapWidth,
        bitmapHeight: frame.bitmapHeight,
      });
      const format = getImageFormat(payload.quality);
      const canvas = document.createElement("canvas");
      canvas.width = crop.width;
      canvas.height = crop.height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Canvas image processing is unavailable.");
      const image = await loadImage(frame.imageDataUrl);
      try {
        requireCapture(payload.captureId);
        context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
      } finally {
        image.src = "";
        frame.imageDataUrl = "";
      }
      const saved = await saveStitchedResult(payload, current, canvas, format);
      canvas.width = 1;
      canvas.height = 1;
      return saved;
    }
    if (current.frames.length === 0) {
      throw new Error("No captured viewports are available to stitch.");
    }
    const frames = current.frames.slice().sort((a, b) => (
      (a.contentPositionCss ?? a.actualY) - (b.contentPositionCss ?? b.actualY)
    ));
    const contentStartCss = Math.max(0, Number(payload.contentStartCss) || 0);
    const cropFor = (frame) => convertCssRectToBitmapCrop({
      rect: frame.cropRectCss || {
        left: 0,
        top: 0,
        right: frame.viewportCssWidth,
        bottom: frame.viewportCssHeight,
        width: frame.viewportCssWidth,
        height: frame.viewportCssHeight,
      },
      viewportCssWidth: frame.viewportCssWidth,
      viewportCssHeight: frame.viewportCssHeight,
      bitmapWidth: frame.bitmapWidth,
      bitmapHeight: frame.bitmapHeight,
    });
    const firstCrop = cropFor(frames[0]);
    const expectedHeight = Math.ceil((payload.totalHeightCss - contentStartCss) * firstCrop.scaleY);
    let finalSize;
    try {
      finalSize = validateCanvasSize(firstCrop.width, expectedHeight);
    } catch (error) {
      // A page taller than the browser's single-canvas cap can still be saved
      // as a multi-page A4 PDF by paginating rows as they stream in.
      if (!payload.paginatePdf) throw error;
      return await stitchPdfFromFrames(payload, current, frames, firstCrop, contentStartCss, expectedHeight);
    }
    const canvas = document.createElement("canvas");
    canvas.width = finalSize.width;
    canvas.height = finalSize.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("Canvas image processing is unavailable.");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    let coveredBottomCss = contentStartCss;

    try {
      for (let index = 0; index < frames.length; index += 1) {
        requireCapture(payload.captureId);
        const frame = frames[index];
        const crop = cropFor(frame);
        if (Math.abs(crop.scaleY - firstCrop.scaleY) / firstCrop.scaleY > 0.01) {
          throw new Error("Screenshot scale changed during capture.");
        }
        const widthTolerance = Math.max(
          CAPTURE_LIMITS.CROP_WIDTH_TOLERANCE_PX,
          canvas.width * CAPTURE_LIMITS.CROP_WIDTH_TOLERANCE_RATIO,
        );
        if (Math.abs(crop.width - canvas.width) > widthTolerance) {
          throw new Error("Selected capture width changed during capture.");
        }

        const plan = calculateFrameDrawPlan({
          actualY: frame.contentPositionCss ?? frame.actualY,
          viewportCssHeight: frame.contentViewportHeightCss ?? frame.viewportCssHeight,
          bitmapHeight: crop.height,
          totalHeightCss: payload.totalHeightCss,
          coveredBottomCss,
          contentStartCss,
          scaleY: crop.scaleY,
          finalBitmapHeight: canvas.height,
        });
        const image = await loadImage(frame.imageDataUrl);
        try {
          requireCapture(payload.captureId);
          if (plan.sourceHeight > 0) {
            context.drawImage(
              image,
              crop.x,
              crop.y + plan.sourceY,
              crop.width,
              plan.sourceHeight,
              0,
              plan.destinationY,
              canvas.width,
              plan.destinationHeight,
            );
          }
        } finally {
          image.src = "";
          frame.imageDataUrl = "";
        }
        coveredBottomCss = plan.nextCoveredBottomCss;
        await Promise.resolve();
      }

      if (coveredBottomCss + 0.5 < payload.totalHeightCss) {
        throw new Error("Captured frames do not reach the document bottom.");
      }
      requireCapture(payload.captureId);
      const format = getImageFormat(payload.quality);
      const blob = await canvasToBlob(canvas, format.mimeType, format.encodeQuality);
      requireCapture(payload.captureId);
      const resultId = globalScope.crypto.randomUUID();
      const record = {
        resultId,
        blob,
        width: canvas.width,
        height: canvas.height,
        mimeType: format.mimeType,
        filename: payload.filename,
        size: blob.size,
        createdAt: Date.now(),
        captureMode: payload.captureMode || "full-page",
        captureModeLabel: payload.captureModeLabel || "Full Page",
        imageFormat: format.mimeType === "image/png" ? "PNG" : "JPEG",
      };
      await resultStore.saveResult(record);
      requireCapture(payload.captureId);
      return {
        ok: true,
        result: {
          resultId,
          width: record.width,
          height: record.height,
          mimeType: record.mimeType,
          filename: record.filename,
          size: record.size,
          captureMode: record.captureMode,
          captureModeLabel: record.captureModeLabel,
          imageFormat: record.imageFormat,
        },
      };
    } finally {
      current.frames.length = 0;
      canvas.width = 1;
      canvas.height = 1;
    }
  }

  async function routeMessage(message) {
    const payload = message.payload || {};
    switch (message.type) {
      case MESSAGE_TYPES.OFFSCREEN_RESET_CAPTURE:
        return resetCapture(payload.captureId);
      case MESSAGE_TYPES.OFFSCREEN_ADD_CAPTURE:
        return addCaptureFrame(payload);
      case MESSAGE_TYPES.OFFSCREEN_DROP_LAST_CAPTURE:
        return dropLastCapture(payload);
      case MESSAGE_TYPES.OFFSCREEN_STITCH_CAPTURE:
        return stitchCapture(payload);
      case MESSAGE_TYPES.OFFSCREEN_PLAN_PDF:
        if (!globalScope.Scroll2PDFPdfGenerator) throw new Error("The PDF engine is unavailable.");
        return globalScope.Scroll2PDFPdfGenerator.planPdf(payload);
      case MESSAGE_TYPES.OFFSCREEN_RENDER_PDF_PAGE:
        if (!globalScope.Scroll2PDFPdfGenerator) throw new Error("The PDF engine is unavailable.");
        return globalScope.Scroll2PDFPdfGenerator.renderPdfPage(payload);
      case MESSAGE_TYPES.OFFSCREEN_FINALIZE_PDF:
        if (!globalScope.Scroll2PDFPdfGenerator) throw new Error("The PDF engine is unavailable.");
        return globalScope.Scroll2PDFPdfGenerator.finalizePdf(payload);
      case MESSAGE_TYPES.OFFSCREEN_CANCEL_CAPTURE:
        if (capture?.captureId === payload.captureId) {
          capture.cancelled = true;
        }
        globalScope.Scroll2PDFPdfGenerator?.cancelPdf(payload.captureId);
        return { ok: true };
      default:
        return null;
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.target !== "offscreen") {
      return false;
    }
    routeMessage(message)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({
        ok: false,
        cancelled: error instanceof OffscreenCancelledError || error?.name === "OffscreenCancelledError",
        error: error?.message || "Offscreen image processing failed.",
      }));
    return true;
  });

  globalScope.Scroll2PDFOffscreen = Object.freeze({
    OffscreenCancelledError,
    addCaptureFrame,
    dropLastCapture,
    resetCapture,
    routeMessage,
    stitchCapture,
    stitchDynamicFrameChain,
  });
})(globalThis);
