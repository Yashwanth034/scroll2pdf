(function initializeScroll2PDFEditorRenderer(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFEditorRenderer) return;

  const { validateCanvasSize } = globalScope.Scroll2PDFCaptureUtils;

  function intersectRect(a, b) {
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.left + a.width, b.left + b.width);
    const bottom = Math.min(a.top + a.height, b.top + b.height);
    if (right <= left || bottom <= top) return null;
    return { left, top, width: right - left, height: bottom - top };
  }

  function buildRenderCommands(document, region = {}) {
    const renderRegion = {
      left: Number.isFinite(region.left) ? region.left : 0,
      top: Number.isFinite(region.top) ? region.top : 0,
      width: Number.isFinite(region.width) ? region.width : document.width,
      height: Number.isFinite(region.height) ? region.height : document.height,
    };
    const commands = [];
    let destinationY = 0;
    for (const segment of document.segments) {
      const destination = {
        left: 0,
        top: destinationY,
        width: segment.width,
        height: segment.height,
      };
      const visible = intersectRect(destination, renderRegion);
      if (visible) {
        if (segment.kind === "source") {
          commands.push({
            kind: "source",
            sourceX: segment.sourceX + (visible.left - destination.left),
            sourceY: segment.sourceY + (visible.top - destination.top),
            sourceWidth: visible.width,
            sourceHeight: visible.height,
            destinationX: visible.left,
            destinationY: visible.top,
            destinationWidth: visible.width,
            destinationHeight: visible.height,
          });
        } else {
          commands.push({
            kind: "blank",
            destinationX: visible.left,
            destinationY: visible.top,
            destinationWidth: visible.width,
            destinationHeight: visible.height,
          });
        }
      }
      destinationY += segment.height;
    }
    return commands;
  }

  function drawCommands(context, source, commands) {
    for (const command of commands) {
      if (command.kind === "blank") {
        context.fillStyle = "#ffffff";
        context.fillRect(
          command.destinationX,
          command.destinationY,
          command.destinationWidth,
          command.destinationHeight,
        );
        continue;
      }
      context.drawImage(
        source,
        command.sourceX,
        command.sourceY,
        command.sourceWidth,
        command.sourceHeight,
        command.destinationX,
        command.destinationY,
        command.destinationWidth,
        command.destinationHeight,
      );
    }
  }

  function getVisibleTileIndexes(input = {}) {
    const tileHeight = Math.max(1, Number(input.tileCssHeight) || 1);
    const documentHeight = Math.max(0, Number(input.documentDisplayHeight) || 0);
    const total = Math.max(1, Math.ceil(documentHeight / tileHeight));
    const overscan = Math.max(0, Math.floor(Number(input.overscan) || 0));
    const scrollTop = Math.max(0, Number(input.scrollTop) || 0);
    const viewportHeight = Math.max(1, Number(input.viewportHeight) || 1);
    const visibleStart = Math.min(total - 1, Math.floor(scrollTop / tileHeight));
    const visibleEnd = Math.min(
      total - 1,
      Math.floor(Math.max(scrollTop, scrollTop + viewportHeight - 1) / tileHeight),
    );
    const start = Math.max(0, visibleStart - overscan);
    const end = Math.min(total - 1, visibleEnd + overscan);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }

  function renderPreviewTile(input = {}) {
    const scale = Number(input.scale);
    const devicePixelRatio = Math.max(1, Number(input.devicePixelRatio) || 1);
    const factor = scale * devicePixelRatio;
    const documentTop = Math.max(0, Number(input.documentTop) || 0);
    const documentHeight = Math.max(0, Number(input.documentHeight) || 0);
    const canvas = input.canvas;
    canvas.width = Math.max(1, Math.ceil(input.document.width * factor));
    canvas.height = Math.max(1, Math.ceil(documentHeight * factor));
    canvas.style.width = `${input.document.width * scale}px`;
    canvas.style.height = `${documentHeight * scale}px`;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas image processing is unavailable.");
    context.setTransform(factor, 0, 0, factor, 0, -documentTop * factor);
    context.fillStyle = "#ffffff";
    context.fillRect(0, documentTop, input.document.width, documentHeight);
    drawCommands(context, input.source, buildRenderCommands(input.document, {
      left: 0,
      top: documentTop,
      width: input.document.width,
      height: documentHeight,
    }));
    return canvas;
  }

  function canvasToBlob(canvas, mimeType, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The edited image could not be encoded."));
      }, mimeType, quality);
    });
  }

  function createRenderer(options = {}) {
    const source = options.source;
    const createCanvas = options.createCanvas || (() => document.createElement("canvas"));
    const cache = new Map();
    let disposed = false;

    async function exportDocument(documentValue, exportOptions = {}) {
      if (disposed) throw new Error("The image editor renderer is closed.");
      const mimeType = exportOptions.mimeType === "image/jpeg" ? "image/jpeg" : "image/png";
      const quality = mimeType === "image/jpeg" ? Number(exportOptions.quality) || 0.95 : undefined;
      const cacheKey = `${JSON.stringify(documentValue)}|${mimeType}|${quality || ""}`;
      if (cache.has(cacheKey)) return cache.get(cacheKey);

      const size = validateCanvasSize(documentValue.width, documentValue.height);
      const canvas = createCanvas();
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Canvas image processing is unavailable.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size.width, size.height);
      drawCommands(context, source, buildRenderCommands(documentValue));
      const blob = await canvasToBlob(canvas, mimeType, quality);
      canvas.width = 1;
      canvas.height = 1;
      cache.set(cacheKey, blob);
      return blob;
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      cache.clear();
      source?.close?.();
    }

    return Object.freeze({ dispose, exportDocument });
  }

  Object.defineProperty(globalScope, "Scroll2PDFEditorRenderer", {
    value: Object.freeze({
      buildRenderCommands,
      createRenderer,
      drawCommands,
      getVisibleTileIndexes,
      renderPreviewTile,
    }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
