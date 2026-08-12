if (typeof importScripts === "function") {
  if (!globalThis.Scroll2PDFConstants) {
    importScripts("../utils/constants.js");
  }
  if (!globalThis.Scroll2PDFCaptureUtils) {
    importScripts("../utils/capture-utils.js");
  }
  if (!globalThis.Scroll2PDFReleaseUtils) {
    importScripts("../utils/release-utils.js");
  }
  if (!globalThis.Scroll2PDFDifficultPageUtils) {
    importScripts("../utils/difficult-page-utils.js");
  }
  if (!globalThis.Scroll2PDFPdfUtils) {
    importScripts("../utils/pdf-utils.js");
  }
  if (!globalThis.Scroll2PDFResultStore) {
    importScripts("../utils/result-store.js");
  }
  if (!globalThis.Scroll2PDFPdfOutput) {
    importScripts("pdf-output.js");
  }
  if (!globalThis.Scroll2PDFFullPageCapture) {
    importScripts("full-page-capture.js");
  }
  if (!globalThis.Scroll2PDFDynamicRegionCapture) {
    importScripts("dynamic-region-capture.js");
  }
  if (!globalThis.Scroll2PDFRegionCapture) {
    importScripts("region-capture.js");
  }
}

(function initializeScroll2PDFBackground(globalScope) {
  "use strict";

  const {
    CAPTURE_MODES,
    OUTPUT_TYPES,
    QUALITY_LEVELS,
    ORIENTATIONS,
    MESSAGE_TYPES,
  } = globalScope.Scroll2PDFConstants;
  const CONFIG_FIELDS = Object.freeze([
    "captureMode",
    "outputType",
    "quality",
    "orientation",
    "selectScreenshotArea",
  ]);
  const ALLOWED_VALUES = Object.freeze({
    captureMode: new Set(Object.values(CAPTURE_MODES)),
    outputType: new Set(Object.values(OUTPUT_TYPES)),
    quality: new Set(Object.values(QUALITY_LEVELS)),
    orientation: new Set(Object.values(ORIENTATIONS)),
    selectScreenshotArea: new Set([false, true]),
  });
  const captureManager = globalScope.Scroll2PDFFullPageCapture.createCaptureManager();

  function invalidResult(detail) {
    return { valid: false, error: `Invalid capture configuration: ${detail}` };
  }

  function validateCaptureConfiguration(configuration) {
    if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) {
      return invalidResult("expected a settings object.");
    }
    const receivedFields = Object.keys(configuration);
    if (
      receivedFields.length !== CONFIG_FIELDS.length
      || receivedFields.some((field) => !CONFIG_FIELDS.includes(field))
    ) {
      return invalidResult("unexpected or missing settings.");
    }
    for (const field of CONFIG_FIELDS) {
      if (!ALLOWED_VALUES[field].has(configuration[field])) {
        return invalidResult(`unsupported ${field} value.`);
      }
    }
    const isScreenshot = configuration.captureMode === CAPTURE_MODES.NORMAL_SCREENSHOT;
    return {
      valid: true,
      configuration: Object.freeze({
        captureMode: configuration.captureMode,
        outputType: isScreenshot ? OUTPUT_TYPES.LONG_IMAGE : configuration.outputType,
        quality: isScreenshot ? QUALITY_LEVELS.HIGH : configuration.quality,
        orientation: configuration.orientation,
        selectScreenshotArea: isScreenshot && configuration.selectScreenshotArea,
      }),
    };
  }

  function publicStartResponse(response) {
    if (!response || typeof response !== "object") {
      return { ok: false, error: "The capture engine did not respond." };
    }
    const { completion, ...serializable } = response;
    return serializable;
  }

  function handleMessage(message, sender, sendResponse) {
    if (message?.target === "offscreen") {
      return false;
    }
    if (message?.type === MESSAGE_TYPES.GET_CAPTURE_STATUS) {
      sendResponse({ ok: true, ...captureManager.getStatus() });
      return false;
    }
    if (message?.type === MESSAGE_TYPES.CANCEL_CAPTURE) {
      captureManager.cancelCapture()
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error?.message || "Cancellation failed." }));
      return true;
    }
    if (message?.type !== MESSAGE_TYPES.START_CAPTURE) {
      return false;
    }

    const validation = validateCaptureConfiguration(message.payload);
    if (!validation.valid) {
      sendResponse({ ok: false, error: validation.error });
      return false;
    }
    captureManager.startCapture(validation.configuration)
      .then((response) => sendResponse(publicStartResponse(response)))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Capture could not start." }));
    return true;
  }

  globalScope.Scroll2PDFBackground = Object.freeze({
    captureManager,
    handleMessage,
    validateCaptureConfiguration,
  });

  chrome.runtime.onMessage.addListener(handleMessage);
  globalScope.Scroll2PDFResultStore?.cleanupStaleResults?.().catch(() => {});
  chrome.tabs?.onRemoved?.addListener((tabId) => captureManager.handleTabRemoved(tabId));
})(globalThis);
