(function initializeScroll2PDFPopup(globalScope) {
  "use strict";

  const { CAPTURE_PHASES, MESSAGE_TYPES } = globalScope.Scroll2PDFConstants;
  const SETTING_NAMES = Object.freeze([
    "captureMode",
    "outputType",
    "quality",
    "orientation",
  ]);
  let statusTimer;

  function readCaptureConfiguration(form) {
    const configuration = {};
    for (const name of SETTING_NAMES) {
      const selectedControl = form.querySelector(`[name="${name}"]:checked`);
      if (!selectedControl) {
        throw new Error(`Missing selection for ${name}.`);
      }
      configuration[name] = selectedControl.value;
    }
    if (configuration.captureMode === "normal-screenshot") {
      configuration.outputType = "long-image";
      configuration.quality = "high";
    }
    configuration.selectScreenshotArea = configuration.captureMode === "normal-screenshot"
      && Boolean(form.querySelector("#select-screenshot-area")?.checked);
    return configuration;
  }

  function requestCapture(configuration, runtime = chrome.runtime) {
    return runtime.sendMessage({
      type: MESSAGE_TYPES.START_CAPTURE,
      payload: configuration,
    });
  }

  function getOrientationUiModel(outputType) {
    const isPdf = outputType === "a4-pdf";
    return { hidden: !isPdf, disabled: !isPdf };
  }

  // Screenshot always captures the visible viewport as a lossless PNG, so
  // output format and quality choices do not apply to this mode.
  function syncModeUi(elements) {
    const selected = elements.form.querySelector('[name="captureMode"]:checked');
    if (!selected) return;
    const isScreenshot = selected.value === "normal-screenshot";
    elements.outputSection.hidden = isScreenshot;
    for (const input of elements.outputSection.querySelectorAll("input")) {
      input.disabled = isScreenshot;
    }
    elements.qualitySetting.hidden = isScreenshot;
    for (const input of elements.qualitySetting.querySelectorAll("input")) {
      input.disabled = isScreenshot;
    }
    elements.screenshotAreaOption.hidden = !isScreenshot;
    elements.screenshotAreaToggle.disabled = !isScreenshot;
  }

  function syncOutputUi(elements) {
    const mode = elements.form.querySelector('[name="captureMode"]:checked');
    const isScreenshot = mode?.value === "normal-screenshot";
    const selected = elements.form.querySelector('[name="outputType"]:checked');
    if (!selected) return;
    const model = getOrientationUiModel(isScreenshot ? "long-image" : selected.value);
    elements.orientationSetting.hidden = model.hidden;
    for (const input of elements.orientationSetting.querySelectorAll("input")) {
      input.disabled = model.disabled;
    }
    elements.settingsGrid.classList.toggle("settings-grid--single", model.hidden);
  }

  function getCaptureUiModel(status = {}) {
    const busy = Boolean(status.active);
    const completed = Math.max(0, Number(status.completed) || 0);
    const total = Math.max(0, Number(status.total) || 0);
    const progressValue = total > 0
      ? Math.min(100, Math.round((completed / total) * 100))
      : 0;
    return {
      busy,
      showCancel: busy,
      cancelDisabled: Boolean(status.cancelling),
      message: status.message || (status.cancelling ? "Cancelling…" : "Preparing page…"),
      progressValue,
    };
  }

  function showStatus(statusElement, message, state, temporary = false) {
    clearTimeout(statusTimer);
    statusElement.textContent = message;
    statusElement.dataset.state = state;
    statusElement.hidden = false;
    if (temporary) {
      statusTimer = setTimeout(() => {
        statusElement.textContent = "";
        statusElement.hidden = true;
        delete statusElement.dataset.state;
      }, 5000);
    }
  }

  function setControlsDisabled(form, disabled) {
    for (const input of form.querySelectorAll("input")) {
      input.disabled = disabled;
    }
  }

  function renderCaptureState(elements, status) {
    const model = getCaptureUiModel(status);
    setControlsDisabled(elements.form, model.busy);
    elements.startButton.hidden = model.busy;
    elements.cancelButton.hidden = !model.showCancel;
    elements.cancelButton.disabled = model.cancelDisabled;
    elements.cancelButton.textContent = model.cancelDisabled ? "Cancelling…" : "Cancel Capture";
    elements.progress.hidden = !model.busy;
    elements.progress.setAttribute("aria-valuenow", String(model.progressValue));
    elements.progressFill.style.width = `${model.progressValue}%`;
    if (model.busy) {
      showStatus(elements.status, model.message, "pending");
    }
  }

  function idleCaptureState(elements, message, state) {
    setControlsDisabled(elements.form, false);
    syncModeUi(elements);
    syncOutputUi(elements);
    elements.startButton.hidden = false;
    elements.startButton.disabled = false;
    elements.startButton.removeAttribute("aria-busy");
    elements.cancelButton.hidden = true;
    elements.cancelButton.disabled = false;
    elements.cancelButton.textContent = "Cancel Capture";
    elements.progress.hidden = true;
    elements.progress.setAttribute("aria-valuenow", "0");
    elements.progressFill.style.width = "0%";
    showStatus(elements.status, message, state, true);
  }

  function collectElements() {
    return {
      form: document.getElementById("capture-form"),
      startButton: document.getElementById("start-capture"),
      cancelButton: document.getElementById("cancel-capture"),
      progress: document.getElementById("capture-progress"),
      progressFill: document.getElementById("capture-progress-fill"),
      status: document.getElementById("capture-status"),
      orientationSetting: document.getElementById("orientation-setting"),
      outputSection: document.getElementById("output-section"),
      qualitySetting: document.getElementById("quality-setting"),
      settingsGrid: document.querySelector(".settings-grid"),
      screenshotAreaOption: document.getElementById("screenshot-area-option"),
      screenshotAreaToggle: document.getElementById("select-screenshot-area"),
    };
  }

  function initialize() {
    const elements = collectElements();
    if (Object.values(elements).some((element) => !element)) {
      return;
    }

    elements.form.addEventListener("submit", async (event) => {
      event.preventDefault();
      renderCaptureState(elements, {
        active: true,
        phase: CAPTURE_PHASES.PREPARING,
        message: "Preparing page…",
      });
      elements.startButton.setAttribute("aria-busy", "true");

      try {
        const response = await requestCapture(readCaptureConfiguration(elements.form));
        if (!response?.ok) {
          throw new Error(response?.error || "The capture request was rejected.");
        }
      } catch (error) {
        console.error("Scroll2PDF could not start capture:", error);
        idleCaptureState(elements, error?.message || "Could not start capture.", "error");
      }
    });

    for (const input of elements.form.querySelectorAll('[name="outputType"]')) {
      input.addEventListener("change", () => { syncModeUi(elements); syncOutputUi(elements); });
    }
    for (const input of elements.form.querySelectorAll('[name="captureMode"]')) {
      input.addEventListener("change", () => { syncModeUi(elements); syncOutputUi(elements); });
    }
    syncModeUi(elements);
    syncOutputUi(elements);

    elements.cancelButton.addEventListener("click", async () => {
      renderCaptureState(elements, {
        active: true,
        phase: CAPTURE_PHASES.CANCELLING,
        cancelling: true,
        message: "Cancelling…",
      });
      try {
        const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CANCEL_CAPTURE });
        if (!response?.ok) {
          throw new Error(response?.error || "Could not cancel capture.");
        }
      } catch (error) {
        idleCaptureState(elements, error?.message || "Could not cancel capture.", "error");
      }
    });

    chrome.runtime.onMessage.addListener((message) => {
      switch (message?.type) {
        case MESSAGE_TYPES.CAPTURE_PROGRESS:
          renderCaptureState(elements, message.payload);
          break;
        case MESSAGE_TYPES.CAPTURE_COMPLETE:
          idleCaptureState(elements, message.payload?.message || "Capture complete", "success");
          break;
        case MESSAGE_TYPES.CAPTURE_CANCELLED:
          idleCaptureState(elements, "Capture cancelled", "success");
          break;
        case MESSAGE_TYPES.CAPTURE_ERROR:
          idleCaptureState(elements, message.payload?.message || "Capture failed.", "error");
          break;
        default:
          break;
      }
      return false;
    });

    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_CAPTURE_STATUS })
      .then((response) => {
        if (response?.ok && response.active) {
          renderCaptureState(elements, response);
        }
      })
      .catch(() => {
        // A newly installed worker can be briefly unavailable; submit will retry it.
      });
  }

  globalScope.Scroll2PDFPopup = Object.freeze({
    getCaptureUiModel,
    getOrientationUiModel,
    initialize,
    readCaptureConfiguration,
    renderCaptureState,
    requestCapture,
    syncModeUi,
    syncOutputUi,
  });

  document.addEventListener("DOMContentLoaded", initialize);
})(globalThis);
