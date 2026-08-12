#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const debugPort = 9700 + Math.floor(Math.random() * 200);
const popupUrl = pathToFileURL(path.resolve(__dirname, "../popup/popup.html")).href;
const screenshotPath = "/tmp/scroll2pdf-popup.png";
const screenshotModePath = "/tmp/scroll2pdf-popup-screenshot-mode.png";
const browser = spawn("google-chrome", [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--no-first-run",
  `--user-data-dir=/tmp/scroll2pdf-e2e-${process.pid}`,
  `--remote-debugging-port=${debugPort}`,
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

let browserError = "";
browser.stderr.on("data", (chunk) => {
  browserError += chunk;
});

async function getJson(endpoint, method = "GET") {
  const response = await fetch(`http://127.0.0.1:${debugPort}${endpoint}`, { method });
  return response.json();
}

async function waitFor(check, timeoutMs, label) {
  const startedAt = Date.now();
  let lastError = "";

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await check();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error(`Timed out waiting for ${label}. ${lastError}`);
}

let socket;
let commandId = 0;

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++commandId;
    const timer = setTimeout(() => reject(new Error(`No CDP reply for ${method}`)), 10000);
    socket.pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

function check(name, condition, detail = "") {
  const prefix = condition ? "PASS" : "FAIL";
  console.log(`${prefix} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) {
    process.exitCode = 1;
  }
}

const chromeStub = `
  window.__scroll2pdfMessages = [];
  window.__scroll2pdfRuntimeListeners = [];
  window.__emitScroll2PDFMessage = (message) => {
    window.__scroll2pdfRuntimeListeners.forEach((listener) => listener(message, {}, () => {}));
  };
  window.chrome = {
    runtime: {
      onMessage: {
        addListener(listener) {
          window.__scroll2pdfRuntimeListeners.push(listener);
        }
      },
      sendMessage(message) {
        window.__scroll2pdfMessages.push(message);
        if (message.type === "GET_CAPTURE_STATUS") {
          return Promise.resolve({ ok: true, active: false });
        }
        if (message.type === "CANCEL_CAPTURE") {
          return Promise.resolve({ ok: true, message: "Cancellation requested." });
        }
        return Promise.resolve({ ok: true, captureId: "capture-e2e" });
      }
    }
  };
`;

(async () => {
  try {
    await waitFor(() => getJson("/json/version"), 30000, "Chrome DevTools");
    const tab = await getJson(`/json/new?${encodeURIComponent("about:blank")}`, "PUT");
    socket = new WebSocket(tab.webSocketDebuggerUrl);
    socket.pending = new Map();

    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });

    const runtimeErrors = [];
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && socket.pending.has(message.id)) {
        const pending = socket.pending.get(message.id);
        socket.pending.delete(message.id);
        clearTimeout(pending.timer);
        message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
      } else if (message.method === "Runtime.exceptionThrown") {
        runtimeErrors.push(message.params.exceptionDetails.text);
      }
    };

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: chromeStub });
    await send("Emulation.setDeviceMetricsOverride", {
      width: 384,
      height: 650,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send("Page.navigate", { url: popupUrl });

    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      return result.result.value;
    };

    await waitFor(
      () => evaluate("document.readyState === 'complete' && Boolean(window.Scroll2PDFPopup)"),
      15000,
      "popup initialization",
    );

    const defaults = await evaluate(`JSON.stringify({
      captureMode: document.querySelector('[name="captureMode"]:checked').value,
      outputType: document.querySelector('[name="outputType"]:checked').value,
      quality: document.querySelector('[name="quality"]:checked').value,
      orientation: document.querySelector('[name="orientation"]:checked').value,
      selectScreenshotArea: document.getElementById('select-screenshot-area').checked
    })`);
    check("required defaults render", defaults === JSON.stringify({
      captureMode: "full-page",
      outputType: "a4-pdf",
      quality: "high",
      orientation: "portrait",
      selectScreenshotArea: false,
    }));

    const geometry = JSON.parse(await evaluate(`JSON.stringify({
      bodyWidth: document.body.getBoundingClientRect().width,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      buttonHeight: document.getElementById('start-capture').getBoundingClientRect().height
    })`));
    check("popup is 384px wide", geometry.bodyWidth === 384, `${geometry.bodyWidth}px`);
    check("popup has no horizontal overflow", geometry.scrollWidth <= geometry.viewportWidth);
    check("primary action has a generous hit target", geometry.buttonHeight >= 44, `${geometry.buttonHeight}px`);

    const settingsGeometry = JSON.parse(await evaluate(`(() => {
      const rect = (element) => {
        const value = element.getBoundingClientRect();
        return { left: value.left, top: value.top, right: value.right, bottom: value.bottom };
      };
      const qualityCard = document.getElementById('quality-setting');
      const orientationCard = document.getElementById('orientation-setting');
      return JSON.stringify({
        qualityCard: rect(qualityCard),
        orientationCard: rect(orientationCard),
        qualityLabel: rect(qualityCard.querySelector('legend')),
        orientationLabel: rect(orientationCard.querySelector('legend')),
        qualityControl: rect(qualityCard.querySelector('.segment-control')),
        orientationControl: rect(orientationCard.querySelector('.segment-control'))
      });
    })()`));
    const contains = (outer, inner) => inner.left >= outer.left + 1
      && inner.right <= outer.right - 1
      && inner.top >= outer.top + 1
      && inner.bottom <= outer.bottom - 1;
    check("Quality label is contained inside its settings card",
      contains(settingsGeometry.qualityCard, settingsGeometry.qualityLabel));
    check("A4 Orientation label is contained inside its settings card",
      contains(settingsGeometry.orientationCard, settingsGeometry.orientationLabel));
    check("settings labels share one aligned row",
      Math.abs(settingsGeometry.qualityLabel.top - settingsGeometry.orientationLabel.top) <= 1);
    check("settings controls sit below their labels without overlap",
      settingsGeometry.qualityControl.top >= settingsGeometry.qualityLabel.bottom + 4
      && settingsGeometry.orientationControl.top >= settingsGeometry.orientationLabel.bottom + 4);
    check("settings cards remain aligned",
      Math.abs(settingsGeometry.qualityCard.top - settingsGeometry.orientationCard.top) <= 1
      && Math.abs(settingsGeometry.qualityCard.bottom - settingsGeometry.orientationCard.bottom) <= 1);

    const screenshotMode = JSON.parse(await evaluate(`(() => {
      document.getElementById('quality-standard').checked = true;
      document.querySelector('label[for="mode-normal-screenshot"]').click();
      return JSON.stringify({
        title: document.querySelector('label[for="mode-normal-screenshot"] .mode-title').textContent,
        outputHidden: document.getElementById('output-section').hidden,
        outputDisabled: [...document.querySelectorAll('[name="outputType"]')].every((input) => input.disabled),
        qualityHidden: document.getElementById('quality-setting')?.hidden === true,
        qualityDisabled: [...document.querySelectorAll('[name="quality"]')].every((input) => input.disabled),
        areaOptionHidden: document.getElementById('screenshot-area-option').hidden,
        areaToggleDisabled: document.getElementById('select-screenshot-area').disabled,
        areaToggleChecked: document.getElementById('select-screenshot-area').checked,
        configuration: window.Scroll2PDFPopup.readCaptureConfiguration(document.getElementById('capture-form'))
      });
    })()`));
    check("Screenshot uses the concise mode name", screenshotMode.title === "Screenshot");
    check("Screenshot hides irrelevant Output controls", screenshotMode.outputHidden && screenshotMode.outputDisabled);
    check("Screenshot hides irrelevant Quality controls", screenshotMode.qualityHidden && screenshotMode.qualityDisabled);
    check("Screenshot shows the optional area toggle off by default",
      !screenshotMode.areaOptionHidden && !screenshotMode.areaToggleDisabled && !screenshotMode.areaToggleChecked);
    check("Screenshot forces lossless image settings", screenshotMode.configuration.outputType === "long-image"
      && screenshotMode.configuration.quality === "high");
    const selectedScreenshotOption = JSON.parse(await evaluate(`(() => {
      document.querySelector('label[for="select-screenshot-area"]').click();
      return JSON.stringify({
        checked: document.getElementById('select-screenshot-area').checked,
        configuration: window.Scroll2PDFPopup.readCaptureConfiguration(document.getElementById('capture-form'))
      });
    })()`));
    check("Screenshot area toggle enables selected capture",
      selectedScreenshotOption.checked && selectedScreenshotOption.configuration.selectScreenshotArea === true);
    const screenshotModeImage = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    fs.writeFileSync(screenshotModePath, Buffer.from(screenshotModeImage.data, "base64"));
    const nonScreenshotOption = JSON.parse(await evaluate(`(() => {
      document.querySelector('label[for="mode-full-page"]').click();
      return JSON.stringify({
        hidden: document.getElementById('screenshot-area-option').hidden,
        disabled: document.getElementById('select-screenshot-area').disabled,
        configuration: window.Scroll2PDFPopup.readCaptureConfiguration(document.getElementById('capture-form'))
      });
    })()`));
    check("other modes hide, disable, and ignore the Screenshot area toggle",
      nonScreenshotOption.hidden && nonScreenshotOption.disabled
      && nonScreenshotOption.configuration.selectScreenshotArea === false);

    await evaluate(`(() => {
      document.querySelector('label[for="output-image"]').click();
      window.__orientationImageState = {
        hidden: document.getElementById('orientation-setting').hidden,
        disabled: [...document.querySelectorAll('[name="orientation"]')].map((input) => input.disabled),
        output: document.querySelector('[name="outputType"]:checked').value
      };
      document.querySelector('label[for="output-pdf"]').click();
      window.__orientationVisibleForPdf = !document.getElementById('orientation-setting').hidden
        && [...document.querySelectorAll('[name="orientation"]')].every((input) => !input.disabled);
      document.querySelector('label[for="quality-standard"]').click();
      document.querySelector('label[for="orientation-landscape"]').click();
      document.querySelector('label[for="output-image"]').click();
      document.getElementById('start-capture').click();
      return true;
    })()`);

    await waitFor(
      () => evaluate("!document.getElementById('cancel-capture').hidden"),
      5000,
      "active capture UI",
    );

    await evaluate(`window.__emitScroll2PDFMessage({
      type: "CAPTURE_PROGRESS",
      payload: {
        active: true,
        phase: "capturing",
        completed: 4,
        total: 12,
        message: "Capturing page… 4 / 12",
        cancelling: false
      }
    })`);

    const submitted = JSON.parse(await evaluate("JSON.stringify(window.__scroll2pdfMessages)"));
    const imageOrientationState = JSON.parse(await evaluate("JSON.stringify(window.__orientationImageState)"));
    check(
      "Long Image hides and disables A4 orientation",
      imageOrientationState.hidden && imageOrientationState.disabled.every(Boolean),
      JSON.stringify(imageOrientationState),
    );
    check("A4 PDF shows and enables orientation", await evaluate("window.__orientationVisibleForPdf"));
    const startMessages = submitted.filter((message) => message.type === "START_CAPTURE");
    check("Start Capture sends exactly one capture request", startMessages.length === 1);
    check("message contains the selected settings", JSON.stringify(startMessages[0]) === JSON.stringify({
      type: "START_CAPTURE",
      payload: {
        captureMode: "full-page",
        outputType: "long-image",
        quality: "standard",
        orientation: "landscape",
        selectScreenshotArea: false,
      },
    }));
    check(
      "live progress is announced",
      await evaluate("document.getElementById('capture-status').textContent")
        === "Capturing page… 4 / 12",
    );
    check("progressbar reflects 4 of 12", await evaluate("document.getElementById('capture-progress').getAttribute('aria-valuenow')") === "33");
    check("Start is replaced by Cancel", await evaluate("document.getElementById('start-capture').hidden && !document.getElementById('cancel-capture').hidden"));

    const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

    await evaluate("document.getElementById('cancel-capture').click()");
    await waitFor(
      () => evaluate("document.getElementById('cancel-capture').disabled"),
      3000,
      "cancelling UI",
    );
    check("Cancel sends CANCEL_CAPTURE", await evaluate("window.__scroll2pdfMessages.some((message) => message.type === 'CANCEL_CAPTURE')"));

    await evaluate("window.__emitScroll2PDFMessage({ type: 'CAPTURE_CANCELLED', payload: { message: 'Capture cancelled' } })");
    check("cancellation status is announced", await evaluate("document.getElementById('capture-status').textContent") === "Capture cancelled");
    check("button returns to idle state", await evaluate("!document.getElementById('start-capture').hidden && document.getElementById('cancel-capture').hidden"));
    check("popup has no runtime exceptions", runtimeErrors.length === 0, runtimeErrors.join(", "));
    console.log(`SCREENSHOT ${screenshotPath}`);
    console.log(`SCREENSHOT_MODE ${screenshotModePath}`);
  } catch (error) {
    console.error(`E2E ERROR ${error.message}`);
    console.error(browserError.slice(0, 500));
    process.exitCode = 2;
  } finally {
    try {
      socket?.close();
      browser.kill();
    } catch (_) {
      // The browser may already be closed after a startup failure.
    }
  }
})();
