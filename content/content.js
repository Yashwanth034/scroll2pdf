(function initializeScroll2PDFContent(globalScope) {
  "use strict";

  if (globalScope.__scroll2pdfContentInitialized) {
    return;
  }
  globalScope.__scroll2pdfContentInitialized = true;

  const { CAPTURE_MODES, MESSAGE_TYPES } = globalScope.Scroll2PDFConstants;
  let regionSession = null;

  function regionAdapter(mode) {
    if (mode === CAPTURE_MODES.SCROLLABLE_AREA) return globalScope.Scroll2PDFScrollableSelection;
    if (mode === CAPTURE_MODES.SELECTED_AREA) return globalScope.Scroll2PDFSelectedArea;
    throw new Error("Unsupported capture mode.");
  }

  async function handleRegionMessage(message) {
    const payload = message?.payload || {};
    if (message?.type === MESSAGE_TYPES.CANCEL_PAGE_SELECTION) {
      const results = await Promise.all([
        globalScope.Scroll2PDFScrollableSelection.cancelSelection(payload.captureId),
        globalScope.Scroll2PDFScreenshotSelection.cancelSelection(payload.captureId),
        globalScope.Scroll2PDFSelectedArea.cancelSelection(payload.captureId),
      ]);
      return { ok: true, cancelled: results.some((result) => result.cancelled) };
    }
    if (message?.type === MESSAGE_TYPES.START_SCREENSHOT_SELECTION) {
      if (regionSession) throw new Error("Another page selection is already active.");
      return globalScope.Scroll2PDFScreenshotSelection.startSelection(payload.captureId);
    }
    if (message?.type === MESSAGE_TYPES.START_REGION_SELECTION) {
      if (regionSession) throw new Error("Another page selection is already active.");
      regionSession = { captureId: payload.captureId, mode: payload.captureMode };
      try {
        const response = await regionAdapter(payload.captureMode).startSelection(payload.captureId);
        if (!response?.ok) regionSession = null;
        return response;
      } catch (error) {
        regionSession = null;
        throw error;
      }
    }
    if (!regionSession || regionSession.captureId !== payload.captureId) return null;
    const adapter = regionAdapter(regionSession.mode);
    switch (message?.type) {
      case MESSAGE_TYPES.PREPARE_REGION_CAPTURE:
        return adapter.prepareCapture(payload.captureId);
      case MESSAGE_TYPES.GET_REGION_METRICS:
        return { ok: true, metrics: adapter.getMetrics(payload.captureId) };
      case MESSAGE_TYPES.SCROLL_REGION_TO_POSITION:
        return adapter.scrollToPosition(payload.captureId, payload.position);
      case MESSAGE_TYPES.SET_REGION_OVERLAYS_HIDDEN:
        return adapter.hideRepeatedOverlays(payload.captureId);
      case MESSAGE_TYPES.RESTORE_REGION_BOTTOM_CHROME:
        return adapter.restoreBottomChrome(payload.captureId);
      case MESSAGE_TYPES.ADVANCE_DIFFICULT_CAPTURE:
        return adapter.advanceDifficultCapture(payload.captureId, false);
      case MESSAGE_TYPES.RECOVER_DIFFICULT_CAPTURE:
        return adapter.advanceDifficultCapture(payload.captureId, true);
      case MESSAGE_TYPES.LOAD_OLDER_HISTORY:
        return adapter.loadOlderHistory(payload.captureId);
      case MESSAGE_TYPES.RESTORE_REGION_CAPTURE: {
        try {
          return await adapter.restoreCapture(payload.captureId);
        } finally {
          regionSession = null;
        }
      }
      default:
        return null;
    }
  }

  function handleMessage(message, sender, sendResponse) {
    if (message?.type === MESSAGE_TYPES.PING) {
      sendResponse({ ok: true, ready: true });
      return false;
    }

    Promise.resolve(handleRegionMessage(message))
      .then((response) => response || globalScope.Scroll2PDFPageCapture.handleMessage(message))
      .then((response) => {
        if (response) {
          sendResponse(response);
        }
      })
      .catch((error) => {
        console.error("Scroll2PDF page interaction failed:", error);
        sendResponse({
          ok: false,
          error: error?.message || "Page interaction failed.",
        });
      });
    return true;
  }

  chrome.runtime.onMessage.addListener(handleMessage);
})(globalThis);
