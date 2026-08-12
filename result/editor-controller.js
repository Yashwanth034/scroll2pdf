(function initializeScroll2PDFEditorController(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFEditorController) return;

  const core = globalScope.Scroll2PDFEditorCore;
  const rendererApi = globalScope.Scroll2PDFEditorRenderer;
  const TILE_CSS_HEIGHT = 640;

  async function create(options = {}) {
    const record = options.record;
    const elements = options.elements;
    const decode = options.decode || globalScope.createImageBitmap?.bind(globalScope);
    if (!decode) throw new Error("This browser cannot decode the captured image for editing.");
    const source = await decode(record.blob);
    const documentValue = core.createDocument({
      width: record.width,
      height: record.height,
      mimeType: record.mimeType,
    });
    const session = core.createSession(documentValue);
    const renderer = rendererApi.createRenderer({ source });
    let disposed = false;
    let displayScale = 1;
    const mountedTiles = new Map();
    let resizeObserver = null;

    function removeTile(index) {
      const canvas = mountedTiles.get(index);
      if (!canvas) return;
      canvas.width = 1;
      canvas.height = 1;
      canvas.remove();
      mountedTiles.delete(index);
    }

    function updateTiles() {
      if (disposed) return;
      const documentState = session.getState().document;
      const displayHeight = documentState.height * displayScale;
      const totalTiles = Math.max(1, Math.ceil(displayHeight / TILE_CSS_HEIGHT));
      elements.tileLayer.dataset.totalTiles = String(totalTiles);
      const indexes = rendererApi.getVisibleTileIndexes({
        scrollTop: elements.viewport.scrollTop,
        viewportHeight: elements.viewport.clientHeight,
        documentDisplayHeight: displayHeight,
        tileCssHeight: TILE_CSS_HEIGHT,
        overscan: 1,
      });
      const wanted = new Set(indexes);
      for (const index of mountedTiles.keys()) {
        if (!wanted.has(index)) removeTile(index);
      }
      for (const index of indexes) {
        if (mountedTiles.has(index)) continue;
        const displayTop = index * TILE_CSS_HEIGHT;
        const displayTileHeight = Math.min(TILE_CSS_HEIGHT, displayHeight - displayTop);
        const documentTop = displayTop / displayScale;
        const documentHeight = displayTileHeight / displayScale;
        const canvas = document.createElement("canvas");
        canvas.className = "editor-preview-tile";
        canvas.dataset.tileIndex = String(index);
        canvas.style.top = `${displayTop}px`;
        rendererApi.renderPreviewTile({
          canvas,
          source,
          document: documentState,
          documentTop,
          documentHeight,
          scale: displayScale,
          devicePixelRatio: globalScope.devicePixelRatio || 1,
        });
        elements.tileLayer.append(canvas);
        mountedTiles.set(index, canvas);
      }
    }

    function layoutPreview() {
      const documentState = session.getState().document;
      const availableWidth = Math.max(1, elements.viewport.clientWidth - 2);
      displayScale = Math.min(1, availableWidth / documentState.width);
      const displayWidth = documentState.width * displayScale;
      const displayHeight = documentState.height * displayScale;
      Object.assign(elements.document.style, {
        width: `${displayWidth}px`,
        height: `${displayHeight}px`,
      });
      Object.assign(elements.tileLayer.style, {
        width: `${displayWidth}px`,
        height: `${displayHeight}px`,
      });
      Object.assign(elements.interactionLayer.style, {
        width: `${displayWidth}px`,
        height: `${displayHeight}px`,
      });
      for (const index of [...mountedTiles.keys()]) removeTile(index);
      updateTiles();
    }

    elements.toolbar.hidden = false;
    elements.copy.hidden = false;
    elements.selectTool.setAttribute("aria-pressed", "true");
    elements.image.hidden = true;
    elements.viewport.hidden = false;
    elements.viewport.addEventListener("scroll", updateTiles, { passive: true });
    if (globalScope.ResizeObserver) {
      resizeObserver = new globalScope.ResizeObserver(layoutPreview);
      resizeObserver.observe(elements.viewport);
    }
    layoutPreview();

    async function copyImage() {
      if (disposed) return;
      const originalLabel = "Copy Image";
      elements.copy.disabled = true;
      elements.copy.textContent = "Copying…";
      try {
        if (!globalScope.navigator?.clipboard?.write || !globalScope.ClipboardItem) {
          throw new Error("Clipboard image copying is unavailable in this browser. Use Download Image instead.");
        }
        const blob = await renderer.exportDocument(session.getState().document, { mimeType: "image/png" });
        await globalScope.navigator.clipboard.write([
          new globalScope.ClipboardItem({ "image/png": blob }),
        ]);
        session.markExported();
        elements.copy.textContent = "Copied";
        elements.status.textContent = "Copied the image to your clipboard.";
        elements.status.dataset.state = "success";
        elements.status.hidden = false;
      } catch (error) {
        elements.copy.textContent = originalLabel;
        const detail = error?.message && !/NotAllowedError/i.test(error.message)
          ? `${error.message} `
          : "The browser denied clipboard image access. ";
        elements.status.textContent = `${detail}Use Download Image instead.`;
        elements.status.dataset.state = "error";
        elements.status.hidden = false;
      } finally {
        elements.copy.disabled = false;
      }
    }

    elements.copy.addEventListener("click", copyImage);

    function dispose() {
      if (disposed) return;
      disposed = true;
      elements.copy.removeEventListener("click", copyImage);
      elements.viewport.removeEventListener("scroll", updateTiles);
      resizeObserver?.disconnect();
      for (const index of [...mountedTiles.keys()]) removeTile(index);
      renderer.dispose();
    }

    return Object.freeze({ dispose, renderer, session });
  }

  Object.defineProperty(globalScope, "Scroll2PDFEditorController", {
    value: Object.freeze({ create }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
