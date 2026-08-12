(function initializeScroll2PDFEditorController(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFEditorController) return;

  const core = globalScope.Scroll2PDFEditorCore;
  const rendererApi = globalScope.Scroll2PDFEditorRenderer;
  const TILE_CSS_HEIGHT = 640;
  const DRAW_TOOLS = new Set(["arrow", "rectangle", "circle", "pen", "highlighter", "text", "blur"]);
  const TOOL_DEFAULTS = Object.freeze({
    arrow: { color: "#ff4d67", thickness: 6, opacity: 1, fontSize: 32, blur: 12 },
    rectangle: { color: "#ff4d67", thickness: 6, opacity: 1, fontSize: 32, blur: 12 },
    circle: { color: "#ff4d67", thickness: 6, opacity: 1, fontSize: 32, blur: 12 },
    pen: { color: "#ff4d67", thickness: 6, opacity: 1, fontSize: 32, blur: 12 },
    highlighter: { color: "#ffe066", thickness: 28, opacity: 0.4, fontSize: 32, blur: 12 },
    text: { color: "#ff4d67", thickness: 6, opacity: 1, fontSize: 32, blur: 12 },
    blur: { color: "#ff4d67", thickness: 6, opacity: 1, fontSize: 32, blur: 12 },
  });
  let annotationSequence = 0;

  async function create(options = {}) {
    const record = options.record;
    const elements = options.elements;
    const decode = options.decode || globalScope.createImageBitmap?.bind(globalScope);
    if (!decode) throw new Error("This browser cannot decode the captured image for editing.");
    const source = await decode(record.blob);
    const originalDocument = core.createDocument({
      width: record.width,
      height: record.height,
      mimeType: record.mimeType,
    });
    const session = core.createSession(originalDocument);
    const renderer = rendererApi.createRenderer({ source });
    const toolButtons = [...elements.toolbar.querySelectorAll("[data-editor-tool]")];
    const undoButton = elements.toolbar.querySelector("#editor-undo");
    const redoButton = elements.toolbar.querySelector("#editor-redo");
    const resetButton = elements.toolbar.querySelector("#editor-reset");
    const contextPanel = elements.toolbar.querySelector("#editor-context");
    const selectionBox = elements.interactionLayer.querySelector("#editor-selection");
    const textInput = elements.interactionLayer.querySelector("#editor-text-input");
    const mountedTiles = new Map();
    const cleanupListeners = [];
    const toolStyles = new Map(Object.entries(TOOL_DEFAULTS).map(([tool, style]) => [tool, { ...style }]));
    let activeTool = "select";
    let selectedId = null;
    let previewDocument = null;
    let gesture = null;
    let disposed = false;
    let displayScale = 1;
    let resizeObserver = null;
    let exportedObjectUrl = "";
    let downloadBypass = false;

    function listen(target, type, handler, listenerOptions) {
      target.addEventListener(type, handler, listenerOptions);
      cleanupListeners.push(() => target.removeEventListener(type, handler, listenerOptions));
    }

    function getDocument() {
      return previewDocument || session.getState().document;
    }

    function getSelected(documentValue = getDocument()) {
      return documentValue.annotations.find((annotation) => annotation.id === selectedId) || null;
    }

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
      const documentState = getDocument();
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
        const canvas = globalScope.document.createElement("canvas");
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

    function renderSelection() {
      const selected = getSelected();
      elements.interactionLayer.dataset.annotationCount = String(getDocument().annotations.length);
      elements.interactionLayer.dataset.selectedColor = selected?.style?.color || "";
      if (!selected) {
        selectionBox.hidden = true;
        return;
      }
      const bounds = core.getAnnotationBounds(selected);
      const padding = Math.max(3, selected.style.thickness / 2) * displayScale;
      Object.assign(selectionBox.style, {
        left: `${bounds.x * displayScale - padding}px`,
        top: `${bounds.y * displayScale - padding}px`,
        width: `${Math.max(8, bounds.width * displayScale + padding * 2)}px`,
        height: `${Math.max(8, bounds.height * displayScale + padding * 2)}px`,
      });
      selectionBox.hidden = false;
    }

    function refreshPreview(layout = false) {
      if (layout) {
        const documentState = getDocument();
        const availableWidth = Math.max(1, elements.viewport.clientWidth - 2);
        displayScale = Math.min(1, availableWidth / documentState.width);
        const displayWidth = documentState.width * displayScale;
        const displayHeight = documentState.height * displayScale;
        for (const target of [elements.document, elements.tileLayer, elements.interactionLayer]) {
          Object.assign(target.style, { width: `${displayWidth}px`, height: `${displayHeight}px` });
        }
      }
      for (const index of [...mountedTiles.keys()]) removeTile(index);
      updateTiles();
      renderSelection();
    }

    function createControl(labelText, name, type, value, attributes = {}) {
      const label = globalScope.document.createElement("label");
      label.className = "editor-context__control";
      const text = globalScope.document.createElement("span");
      text.textContent = labelText;
      const input = globalScope.document.createElement("input");
      input.type = type;
      input.value = String(value);
      input.dataset.editorStyle = name;
      for (const [key, attributeValue] of Object.entries(attributes)) input.setAttribute(key, String(attributeValue));
      label.append(text, input);
      return { label, input };
    }

    function applySelectedStyle(name, value) {
      const selected = getSelected(session.getState().document);
      if (!selected) return;
      session.commit(core.restyleAnnotation(session.getState().document, selected.id, { [name]: value }));
      previewDocument = null;
      refreshPreview();
      updateControls(false);
    }

    function renderContext() {
      const selected = getSelected(session.getState().document);
      const styleTool = selected?.type || (DRAW_TOOLS.has(activeTool) ? activeTool : null);
      if (!styleTool) {
        contextPanel.hidden = true;
        contextPanel.replaceChildren();
        return;
      }
      const style = selected?.style || toolStyles.get(styleTool) || TOOL_DEFAULTS.arrow;
      const controls = [];
      if (styleTool !== "blur") controls.push(createControl("Color", "color", "color", style.color));
      if (styleTool !== "text" && styleTool !== "blur") {
        controls.push(createControl("Thickness", "thickness", "range", style.thickness, { min: 1, max: 80, step: 1 }));
      }
      controls.push(createControl("Opacity", "opacity", "range", style.opacity, { min: 0.05, max: 1, step: 0.05 }));
      if (styleTool === "text") controls.push(createControl("Text size", "fontSize", "range", style.fontSize, { min: 10, max: 120, step: 1 }));
      if (styleTool === "blur") controls.push(createControl("Blur", "blur", "range", style.blur, { min: 4, max: 40, step: 1 }));
      const fragment = globalScope.document.createDocumentFragment();
      for (const control of controls) {
        control.input.addEventListener("input", () => {
          const value = control.input.type === "color" ? control.input.value : Number(control.input.value);
          if (selected) applySelectedStyle(control.input.dataset.editorStyle, value);
          else toolStyles.set(styleTool, { ...toolStyles.get(styleTool), [control.input.dataset.editorStyle]: value });
        });
        fragment.append(control.label);
      }
      if (selected) {
        const remove = globalScope.document.createElement("button");
        remove.type = "button";
        remove.className = "editor-context__delete";
        remove.textContent = "Delete object";
        remove.addEventListener("click", deleteSelection);
        fragment.append(remove);
      }
      contextPanel.replaceChildren(fragment);
      contextPanel.hidden = false;
    }

    function updateControls(renderPanel = true) {
      const state = session.getState();
      for (const button of toolButtons) button.setAttribute("aria-pressed", String(button.dataset.editorTool === activeTool));
      undoButton.disabled = !state.canUndo;
      redoButton.disabled = !state.canRedo;
      resetButton.disabled = !state.modified;
      renderSelection();
      if (renderPanel) renderContext();
    }

    function setTool(tool) {
      activeTool = tool;
      previewDocument = null;
      gesture = null;
      textInput.hidden = true;
      elements.interactionLayer.dataset.tool = tool;
      updateControls();
    }

    function pointFromEvent(event) {
      return core.previewPointToDocument(
        event,
        elements.interactionLayer.getBoundingClientRect(),
        displayScale,
        getDocument(),
      );
    }

    function annotationForDrag(tool, start, point, points) {
      let geometry;
      if (tool === "arrow") geometry = { x1: start.x, y1: start.y, x2: point.x, y2: point.y };
      else if (tool === "pen" || tool === "highlighter") geometry = { points };
      else geometry = { x: start.x, y: start.y, width: point.x - start.x, height: point.y - start.y };
      return core.createAnnotation({
        id: gesture?.annotationId || `${tool}-${Date.now()}-${++annotationSequence}`,
        type: tool,
        geometry,
        style: toolStyles.get(tool),
      }, session.getState().document);
    }

    function showTextInput(point) {
      const style = toolStyles.get("text");
      textInput.value = "";
      Object.assign(textInput.style, {
        left: `${point.x * displayScale}px`,
        top: `${point.y * displayScale}px`,
        color: style.color,
        fontSize: `${Math.max(14, style.fontSize * displayScale)}px`,
      });
      textInput.dataset.documentX = String(point.x);
      textInput.dataset.documentY = String(point.y);
      textInput.hidden = false;
      textInput.focus();
    }

    function commitText() {
      if (textInput.hidden) return;
      const value = textInput.value.trim();
      textInput.hidden = true;
      if (!value) return;
      const annotation = core.createAnnotation({
        id: `text-${Date.now()}-${++annotationSequence}`,
        type: "text",
        geometry: {
          x: Number(textInput.dataset.documentX),
          y: Number(textInput.dataset.documentY),
          text: value,
        },
        style: toolStyles.get("text"),
      }, session.getState().document);
      session.commit(core.appendAnnotation(session.getState().document, annotation));
      selectedId = annotation.id;
      refreshPreview();
      updateControls();
    }

    function boundsForResize(bounds, handle, point) {
      let left = bounds.x;
      let top = bounds.y;
      let right = bounds.x + bounds.width;
      let bottom = bounds.y + bounds.height;
      if (handle.includes("w")) left = Math.min(point.x, right - 2);
      if (handle.includes("e")) right = Math.max(point.x, left + 2);
      if (handle.includes("n")) top = Math.min(point.y, bottom - 2);
      if (handle.includes("s")) bottom = Math.max(point.y, top + 2);
      return { x: left, y: top, width: right - left, height: bottom - top };
    }

    function onPointerDown(event) {
      if (disposed || !textInput.hidden) return;
      event.preventDefault();
      elements.interactionLayer.focus({ preventScroll: true });
      const point = pointFromEvent(event);
      const handle = event.target.closest?.("[data-resize-handle]")?.dataset.resizeHandle;
      if (handle && selectedId) {
        const selected = getSelected(session.getState().document);
        gesture = {
          kind: "resize",
          pointerId: event.pointerId,
          handle,
          original: session.getState().document,
          bounds: core.getAnnotationBounds(selected),
        };
      } else if (activeTool === "select") {
        const hit = core.hitTestAnnotations(session.getState().document.annotations, point, 8 / displayScale);
        selectedId = hit?.id || null;
        if (hit) {
          gesture = {
            kind: "move",
            pointerId: event.pointerId,
            start: point,
            original: session.getState().document,
          };
        }
        updateControls();
      } else if (activeTool === "text") {
        showTextInput(point);
      } else if (DRAW_TOOLS.has(activeTool)) {
        gesture = {
          kind: "draw",
          pointerId: event.pointerId,
          tool: activeTool,
          start: point,
          points: [point],
          annotationId: `${activeTool}-${Date.now()}-${++annotationSequence}`,
        };
      }
      try { elements.interactionLayer.setPointerCapture(event.pointerId); } catch (_) {}
    }

    function onPointerMove(event) {
      if (!gesture || (gesture.pointerId && event.pointerId !== gesture.pointerId)) return;
      const point = pointFromEvent(event);
      if (gesture.kind === "move") {
        previewDocument = core.moveAnnotation(
          gesture.original,
          selectedId,
          point.x - gesture.start.x,
          point.y - gesture.start.y,
        );
      } else if (gesture.kind === "resize") {
        previewDocument = core.resizeAnnotation(
          gesture.original,
          selectedId,
          boundsForResize(gesture.bounds, gesture.handle, point),
        );
      } else if (gesture.kind === "draw") {
        if (gesture.tool === "pen" || gesture.tool === "highlighter") {
          const previous = gesture.points[gesture.points.length - 1];
          if (Math.hypot(point.x - previous.x, point.y - previous.y) >= 1 / displayScale) gesture.points.push(point);
        }
        const annotation = annotationForDrag(gesture.tool, gesture.start, point, gesture.points);
        previewDocument = core.appendAnnotation(session.getState().document, annotation);
        selectedId = annotation.id;
      }
      refreshPreview();
    }

    function onPointerUp(event) {
      if (!gesture || (gesture.pointerId && event.pointerId !== gesture.pointerId)) return;
      if (gesture.kind === "draw" && previewDocument) {
        const annotation = getSelected(previewDocument);
        const bounds = core.getAnnotationBounds(annotation);
        if (gesture.tool === "pen" || gesture.tool === "highlighter") {
          const simplified = core.simplifyPath(annotation.geometry.points, 1.2 / displayScale);
          if (simplified.length > 1) {
            const finalAnnotation = core.createAnnotation({ ...annotation, geometry: { points: simplified } }, session.getState().document);
            previewDocument = core.appendAnnotation(session.getState().document, finalAnnotation);
          } else previewDocument = null;
        } else if (Math.max(bounds.width, bounds.height) < 3 / displayScale) previewDocument = null;
      }
      if (previewDocument) session.commit(previewDocument);
      previewDocument = null;
      gesture = null;
      refreshPreview();
      updateControls();
      try { elements.interactionLayer.releasePointerCapture(event.pointerId); } catch (_) {}
    }

    function deleteSelection() {
      if (!selectedId) return;
      session.commit(core.removeAnnotation(session.getState().document, selectedId));
      selectedId = null;
      refreshPreview();
      updateControls();
    }

    function undo() {
      session.undo();
      previewDocument = null;
      refreshPreview(true);
      updateControls();
    }

    function redo() {
      session.redo();
      previewDocument = null;
      refreshPreview(true);
      updateControls();
    }

    function reset() {
      session.reset();
      selectedId = null;
      previewDocument = null;
      refreshPreview(true);
      updateControls();
    }

    function onKeyDown(event) {
      if (event.target === textInput) {
        if (event.key === "Escape") {
          event.preventDefault();
          textInput.hidden = true;
          elements.interactionLayer.focus();
        } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          commitText();
        }
        return;
      }
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      } else if (modifier && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
        event.preventDefault();
        deleteSelection();
      } else if (event.key === "Escape") {
        previewDocument = null;
        gesture = null;
        selectedId = null;
        refreshPreview();
        updateControls();
      }
    }

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
        await globalScope.navigator.clipboard.write([new globalScope.ClipboardItem({ "image/png": blob })]);
        session.markExported();
        elements.copy.textContent = "Copied";
        elements.status.textContent = "Copied the edited image to your clipboard.";
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

    async function downloadImage(event) {
      if (downloadBypass) {
        downloadBypass = false;
        return;
      }
      const state = session.getState();
      if (!state.modified) return;
      event.preventDefault();
      elements.download.setAttribute("aria-disabled", "true");
      elements.download.textContent = "Preparing…";
      try {
        const mimeType = record.mimeType === "image/jpeg" ? "image/jpeg" : "image/png";
        const blob = await renderer.exportDocument(state.document, { mimeType, quality: 0.95 });
        if (exportedObjectUrl) globalScope.URL.revokeObjectURL(exportedObjectUrl);
        exportedObjectUrl = globalScope.URL.createObjectURL(blob);
        elements.download.href = exportedObjectUrl;
        elements.download.download = record.filename;
        session.markExported();
        elements.status.textContent = "The edited image is ready and downloading.";
        elements.status.dataset.state = "success";
        elements.status.hidden = false;
        downloadBypass = true;
        elements.download.click();
      } catch (error) {
        elements.status.textContent = error?.message || "The edited image could not be prepared.";
        elements.status.dataset.state = "error";
        elements.status.hidden = false;
      } finally {
        elements.download.textContent = "Download Image";
        elements.download.setAttribute("aria-disabled", "false");
      }
    }

    elements.toolbar.hidden = false;
    elements.copy.hidden = false;
    elements.image.hidden = true;
    elements.viewport.hidden = false;
    elements.interactionLayer.dataset.tool = activeTool;
    for (const button of toolButtons) listen(button, "click", () => setTool(button.dataset.editorTool));
    listen(elements.viewport, "scroll", updateTiles, { passive: true });
    listen(elements.interactionLayer, "pointerdown", onPointerDown);
    listen(elements.interactionLayer, "pointermove", onPointerMove);
    listen(elements.interactionLayer, "pointerup", onPointerUp);
    listen(elements.interactionLayer, "pointercancel", onPointerUp);
    listen(elements.interactionLayer, "keydown", onKeyDown);
    listen(textInput, "blur", commitText);
    listen(undoButton, "click", undo);
    listen(redoButton, "click", redo);
    listen(resetButton, "click", reset);
    listen(elements.copy, "click", copyImage);
    listen(elements.download, "click", downloadImage);
    if (globalScope.ResizeObserver) {
      resizeObserver = new globalScope.ResizeObserver(() => refreshPreview(true));
      resizeObserver.observe(elements.viewport);
    }
    refreshPreview(true);
    updateControls();

    function hasUnexportedChanges() {
      return session.getState().unexported;
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      for (const cleanup of cleanupListeners.splice(0)) cleanup();
      resizeObserver?.disconnect();
      for (const index of [...mountedTiles.keys()]) removeTile(index);
      if (exportedObjectUrl) globalScope.URL.revokeObjectURL(exportedObjectUrl);
      renderer.dispose();
    }

    return Object.freeze({ dispose, hasUnexportedChanges, renderer, session });
  }

  Object.defineProperty(globalScope, "Scroll2PDFEditorController", {
    value: Object.freeze({ create }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
