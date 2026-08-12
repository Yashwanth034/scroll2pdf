(function initializeScroll2PDFScreenshotSelection(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFScreenshotSelection) return;

  const { isSelectionLargeEnough, normalizeSelectionRect } = globalScope.Scroll2PDFCaptureUtils;
  const { createOneShotOutcome, createSelectionOverlay } = globalScope.Scroll2PDFSelectionOverlay;
  let session = null;

  function startSelection(captureId) {
    if (!captureId) return Promise.reject(new Error("A capture ID is required."));
    if (session) return Promise.reject(new Error("Another screenshot selection is already active."));

    return new Promise((resolve) => {
      const overlay = createSelectionOverlay("Drag to select a screenshot area · Esc to cancel");
      const state = {
        captureId,
        overlay,
        pointerId: null,
        start: null,
      };
      session = state;
      const outcome = createOneShotOutcome((value) => {
        overlay.cleanup();
        session = null;
        resolve(value);
      });

      function pointerDown(event) {
        if (event.button !== 0) return;
        event.preventDefault();
        state.pointerId = event.pointerId;
        state.start = { x: event.clientX, y: event.clientY };
        overlay.surface.setPointerCapture?.(event.pointerId);
      }

      function pointerMove(event) {
        if (state.pointerId !== event.pointerId || !state.start) return;
        const rect = normalizeSelectionRect(
          state.start,
          { x: event.clientX, y: event.clientY },
          { width: window.innerWidth, height: window.innerHeight },
        );
        overlay.setRect(
          rect,
          `${Math.round(rect.width)} × ${Math.round(rect.height)} px`,
          !isSelectionLargeEnough(rect),
        );
      }

      function pointerUp(event) {
        if (state.pointerId !== event.pointerId || !state.start) return;
        event.preventDefault();
        overlay.surface.releasePointerCapture?.(event.pointerId);
        const rect = normalizeSelectionRect(
          state.start,
          { x: event.clientX, y: event.clientY },
          { width: window.innerWidth, height: window.innerHeight },
        );
        state.pointerId = null;
        state.start = null;
        if (!isSelectionLargeEnough(rect)) {
          overlay.clearRect("Selected area is too small · Drag at least 80 × 80 px", true);
          return;
        }
        outcome.settle({
          ok: true,
          selection: {
            cropRectCss: rect,
            viewportCssWidth: window.innerWidth,
            viewportCssHeight: window.innerHeight,
          },
        });
      }

      function keydown(event) {
        if (event.key === "Escape") {
          outcome.settle({ ok: false, cancelled: true, error: "Capture cancelled" });
        }
      }

      overlay.cleanupBag.listen(overlay.surface, "pointerdown", pointerDown);
      overlay.cleanupBag.listen(overlay.surface, "pointermove", pointerMove);
      overlay.cleanupBag.listen(overlay.surface, "pointerup", pointerUp);
      overlay.cleanupBag.listen(window, "keydown", keydown, true);
      state.cancel = () => outcome.settle({ ok: false, cancelled: true, error: "Capture cancelled" });
    });
  }

  function cancelSelection(captureId) {
    if (!session || (captureId && session.captureId !== captureId)) {
      return { ok: true, cancelled: false };
    }
    const cancelled = session.cancel();
    return { ok: true, cancelled };
  }

  Object.defineProperty(globalScope, "Scroll2PDFScreenshotSelection", {
    value: Object.freeze({ cancelSelection, startSelection }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
