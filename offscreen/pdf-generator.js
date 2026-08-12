(function initializeScroll2PDFPdfGenerator(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFPdfGenerator) return;

  const { QUALITY_LEVELS } = globalScope.Scroll2PDFConstants;
  const {
    buildPageRanges,
    calculatePdfLayout,
    calculateRowInformationScores,
    chooseSmartBreak,
    getA4PageSpec,
    getSmartBreakMinimumEnd,
    getSmartBreakSearchWindow,
  } = globalScope.Scroll2PDFPdfUtils;
  const { RasterPdfWriter } = globalScope.Scroll2PDFPdfWriter;
  const resultStore = globalScope.Scroll2PDFResultStore;
  const ANALYSIS_WIDTH = 96;
  const ANALYSIS_HORIZONTAL_INSET_RATIO = 0.125;
  const STANDARD_JPEG_QUALITY = 0.95;
  let session = null;

  class OffscreenCancelledError extends Error {
    constructor() {
      super("Capture cancelled");
      this.name = "OffscreenCancelledError";
    }
  }

  function requireSession(captureId) {
    if (!session || session.captureId !== captureId) {
      throw new Error("The PDF generation session is unavailable.");
    }
    if (session.cancelled) throw new OffscreenCancelledError();
    return session;
  }

  function canvasContext(canvas, options) {
    const context = canvas.getContext("2d", options);
    if (!context) throw new Error("Canvas PDF processing is unavailable.");
    return context;
  }

  function canvasToBlob(canvas, mimeType, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("A PDF page image could not be encoded."));
      }, mimeType, quality);
    });
  }

  async function deflate(bytes) {
    if (typeof globalScope.CompressionStream !== "function") {
      throw new Error("Lossless PDF compression is unavailable in this browser.");
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new globalScope.CompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function rgbaToRgb(imageData) {
    const rgba = imageData.data;
    const rgb = new Uint8Array((rgba.length / 4) * 3);
    let output = 0;
    for (let input = 0; input < rgba.length; input += 4) {
      const alpha = rgba[input + 3] / 255;
      rgb[output] = Math.round((rgba[input] * alpha) + (255 * (1 - alpha)));
      rgb[output + 1] = Math.round((rgba[input + 1] * alpha) + (255 * (1 - alpha)));
      rgb[output + 2] = Math.round((rgba[input + 2] * alpha) + (255 * (1 - alpha)));
      output += 3;
    }
    return rgb;
  }

  function planBoundary(current, input) {
    const windowSize = getSmartBreakSearchWindow(input.pageSourceHeight);
    const minimumEnd = Math.max(
      getSmartBreakMinimumEnd(input.start, input.idealEnd),
      input.idealEnd - windowSize,
    );
    const analysisHeight = input.idealEnd - minimumEnd;
    if (analysisHeight < 4) return input.idealEnd;
    const canvas = current.analysisCanvas;
    canvas.width = Math.min(ANALYSIS_WIDTH, current.sourceWidth);
    canvas.height = analysisHeight;
    try {
      const context = canvasContext(canvas, { alpha: false, willReadFrequently: true });
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      const sourceInsetX = Math.floor(current.sourceWidth * ANALYSIS_HORIZONTAL_INSET_RATIO);
      const analyzedSourceWidth = Math.max(1, current.sourceWidth - (sourceInsetX * 2));
      context.drawImage(
        current.sourceImage,
        sourceInsetX,
        minimumEnd,
        analyzedSourceWidth,
        analysisHeight,
        0,
        0,
        canvas.width,
        analysisHeight,
      );
      const localScores = calculateRowInformationScores(
        context.getImageData(0, 0, canvas.width, canvas.height),
        canvas.width,
        canvas.height,
      );
      const scores = [];
      localScores.forEach((score, index) => { scores[minimumEnd + index] = score; });
      return chooseSmartBreak({
        start: input.start,
        idealEnd: input.idealEnd,
        sourceHeight: input.sourceHeight,
        scores,
        searchWindow: windowSize,
      });
    } catch (_) {
      return input.idealEnd;
    } finally {
      canvas.width = 1;
      canvas.height = 1;
    }
  }

  async function releaseSession(current, deleteSource) {
    if (!current) return;
    if (current.sourceImage && typeof current.sourceImage.close === "function") current.sourceImage.close();
    current.sourceImage = null;
    if (current.analysisCanvas) {
      current.analysisCanvas.width = 1;
      current.analysisCanvas.height = 1;
    }
    if (current.pageCanvas) {
      current.pageCanvas.width = 1;
      current.pageCanvas.height = 1;
    }
    if (deleteSource && current.sourceResultId && !current.sourceDeleted) {
      current.sourceDeleted = true;
      await resultStore.deleteResult(current.sourceResultId);
    }
  }

  async function planPdf(payload) {
    if (session) await resetPdf(session.captureId);
    const sourceRecord = await resultStore.getResult(payload.sourceResultId);
    if (!sourceRecord?.blob) throw new Error("The temporary stitched image is unavailable.");
    if (payload.quality !== QUALITY_LEVELS.STANDARD && payload.quality !== QUALITY_LEVELS.HIGH) {
      throw new Error("Unsupported PDF quality.");
    }
    const current = {
      captureId: payload.captureId,
      sourceResultId: payload.sourceResultId,
      sourceRecord,
      sourceDeleted: false,
      cancelled: false,
      renderedPages: 0,
      quality: payload.quality,
      orientation: payload.orientation,
      filename: payload.filename,
      analysisCanvas: document.createElement("canvas"),
      pageCanvas: document.createElement("canvas"),
    };
    session = current;
    try {
      current.sourceImage = await globalScope.createImageBitmap(sourceRecord.blob);
      requireSession(payload.captureId);
      current.sourceWidth = Number(current.sourceImage.width || sourceRecord.width);
      current.sourceHeight = Number(current.sourceImage.height || sourceRecord.height);
      current.pageSpec = getA4PageSpec(payload.orientation);
      current.layout = calculatePdfLayout(current.sourceWidth, current.sourceHeight, current.pageSpec);
      current.ranges = buildPageRanges(
        current.sourceHeight,
        current.layout.sourcePixelsPerPage,
        (input) => planBoundary(current, input),
      );
      current.writer = new RasterPdfWriter({
        pageSpec: current.pageSpec,
        title: payload.filename,
        creationDate: new Date(),
      });
      return {
        ok: true,
        pageCount: current.ranges.length,
        sourceWidth: current.sourceWidth,
        sourceHeight: current.sourceHeight,
        sourcePixelsPerPage: current.layout.sourcePixelsPerPage,
        ranges: current.ranges.map((range) => ({ ...range })),
      };
    } catch (error) {
      await releaseSession(current, true);
      if (session === current) session = null;
      throw error;
    }
  }

  async function renderPdfPage(payload) {
    const current = requireSession(payload.captureId);
    const pageIndex = Number(payload.pageIndex);
    if (!Number.isInteger(pageIndex) || pageIndex !== current.renderedPages) {
      throw new Error("PDF pages must be generated sequentially.");
    }
    const range = current.ranges[pageIndex];
    if (!range) throw new Error("The requested PDF page is outside the pagination plan.");
    const canvas = current.pageCanvas;
    canvas.width = current.sourceWidth;
    canvas.height = range.height;
    try {
      const context = canvasContext(canvas, { alpha: false, willReadFrequently: current.quality === QUALITY_LEVELS.HIGH });
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(
        current.sourceImage,
        0,
        range.start,
        current.sourceWidth,
        range.height,
        0,
        0,
        current.sourceWidth,
        range.height,
      );
      requireSession(payload.captureId);
      let bytes;
      let filter;
      if (current.quality === QUALITY_LEVELS.HIGH) {
        const rgb = rgbaToRgb(context.getImageData(0, 0, canvas.width, canvas.height));
        requireSession(payload.captureId);
        bytes = await deflate(rgb);
        filter = "FlateDecode";
      } else {
        const blob = await canvasToBlob(canvas, "image/jpeg", STANDARD_JPEG_QUALITY);
        requireSession(payload.captureId);
        bytes = new Uint8Array(await blob.arrayBuffer());
        filter = "DCTDecode";
      }
      requireSession(payload.captureId);
      current.writer.addImagePage({
        bytes,
        width: current.sourceWidth,
        height: range.height,
        filter,
        displayWidthPt: current.layout.displayWidthPt,
        displayHeightPt: range.height * current.layout.scale,
      });
      current.renderedPages += 1;
      return { ok: true, completed: current.renderedPages, total: current.ranges.length };
    } finally {
      canvas.width = 1;
      canvas.height = 1;
    }
  }

  async function finalizePdf(payload) {
    const current = requireSession(payload.captureId);
    if (current.renderedPages !== current.ranges.length) {
      throw new Error("PDF generation is incomplete.");
    }
    const bytes = current.writer.build();
    requireSession(payload.captureId);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const resultId = globalScope.crypto.randomUUID();
    const record = {
      resultId,
      blob,
      width: current.sourceWidth,
      height: current.sourceHeight,
      sourceWidth: current.sourceWidth,
      sourceHeight: current.sourceHeight,
      mimeType: "application/pdf",
      outputType: "a4-pdf",
      filename: current.filename,
      size: blob.size,
      createdAt: Date.now(),
      captureMode: current.sourceRecord.captureMode || "full-page",
      captureModeLabel: current.sourceRecord.captureModeLabel || "Full Page",
      orientation: current.orientation,
      pageCount: current.ranges.length,
      imageFormat: "PDF",
    };
    await resultStore.saveResult(record);
    requireSession(payload.captureId);
    await releaseSession(current, true);
    current.finalized = true;
    return {
      ok: true,
      result: {
        resultId,
        width: record.width,
        height: record.height,
        sourceWidth: record.sourceWidth,
        sourceHeight: record.sourceHeight,
        mimeType: record.mimeType,
        outputType: record.outputType,
        filename: record.filename,
        size: record.size,
        captureMode: record.captureMode,
        captureModeLabel: record.captureModeLabel,
        orientation: record.orientation,
        pageCount: record.pageCount,
      },
    };
  }

  // Creates a PDF writer for a capture, shared by the streaming paginator.
  function createPdfWriter(pageSpec, filename) {
    return new RasterPdfWriter({
      pageSpec,
      title: filename,
      creationDate: new Date(),
    });
  }

  // Encodes one rendered page canvas to the bytes + filter the writer expects.
  async function encodeCanvasPage(canvas, quality) {
    if (quality === QUALITY_LEVELS.HIGH) {
      const context = canvasContext(canvas, { alpha: false, willReadFrequently: true });
      const rgb = rgbaToRgb(context.getImageData(0, 0, canvas.width, canvas.height));
      return { bytes: await deflate(rgb), filter: "FlateDecode" };
    }
    const blob = await canvasToBlob(canvas, "image/jpeg", STANDARD_JPEG_QUALITY);
    return { bytes: new Uint8Array(await blob.arrayBuffer()), filter: "DCTDecode" };
  }

  // Saves a fully built PDF blob (used by the streaming paginator, which never
  // renders the full-height source image) and returns the result record shape.
  async function savePdfResult(input) {
    const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const resultId = globalScope.crypto.randomUUID();
    const record = {
      resultId,
      blob,
      width: input.width,
      height: input.height,
      sourceWidth: input.width,
      sourceHeight: input.height,
      mimeType: "application/pdf",
      outputType: "a4-pdf",
      filename: input.filename,
      size: blob.size,
      createdAt: Date.now(),
      captureMode: input.captureMode || "full-page",
      captureModeLabel: input.captureModeLabel || "Full Page",
      orientation: input.orientation || "portrait",
      pageCount: input.pageCount,
      imageFormat: "PDF",
    };
    await resultStore.saveResult(record);
    return {
      ok: true,
      result: {
        resultId,
        width: record.width,
        height: record.height,
        sourceWidth: record.sourceWidth,
        sourceHeight: record.sourceHeight,
        mimeType: record.mimeType,
        outputType: record.outputType,
        filename: record.filename,
        size: record.size,
        captureMode: record.captureMode,
        captureModeLabel: record.captureModeLabel,
        orientation: record.orientation,
        pageCount: record.pageCount,
      },
    };
  }

  function cancelPdf(captureId) {
    if (session?.captureId === captureId) session.cancelled = true;
    return { ok: true };
  }

  async function resetPdf(captureId) {
    if (!session || (captureId && session.captureId !== captureId)) return { ok: true };
    const current = session;
    session = null;
    await releaseSession(current, !current.finalized);
    return { ok: true };
  }

  Object.defineProperty(globalScope, "Scroll2PDFPdfGenerator", {
    value: Object.freeze({
      OffscreenCancelledError,
      cancelPdf,
      createPdfWriter,
      encodeCanvasPage,
      finalizePdf,
      planPdf,
      renderPdfPage,
      resetPdf,
      savePdfResult,
    }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
