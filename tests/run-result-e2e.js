#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const debugPort = 9750 + Math.floor(Math.random() * 150);
const resultUrl = `${pathToFileURL(path.resolve(__dirname, "../result/result.html")).href}?id=result-e2e`;
const screenshotPath = "/tmp/scroll2pdf-result.png";
const editorScreenshotPath = "/tmp/scroll2pdf-editor-phase1.png";
const browser = spawn("google-chrome", [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run",
  `--user-data-dir=/tmp/scroll2pdf-result-e2e-${process.pid}`,
  `--remote-debugging-port=${debugPort}`,
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

let browserError = "";
browser.stderr.on("data", (chunk) => { browserError += chunk; });

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
      if (result) return result;
    } catch (error) { lastError = error.message; }
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
  console.log(`${condition ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) process.exitCode = 1;
}

const resultStoreStub = `
  window.__deletedResultId = "";
  window.__clipboardWrites = [];
  Object.defineProperty(window, "ClipboardItem", {
    configurable: true,
    value: class ClipboardItem {
      constructor(items) { this.items = items; this.types = Object.keys(items); }
    }
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      write(items) {
        window.__clipboardWrites.push(items);
        return Promise.resolve();
      }
    }
  });
  window.Scroll2PDFResultStore = {
    getResult(resultId) {
      if (resultId === "pdf-e2e") {
        const blob = new Blob(["%PDF-1.7\\n%%EOF\\n"], { type: "application/pdf" });
        return Promise.resolve({
          resultId,
          blob,
          sourceWidth: 900,
          sourceHeight: 5200,
          width: 900,
          height: 5200,
          mimeType: "application/pdf",
          outputType: "a4-pdf",
          captureMode: "scrollable-area",
          captureModeLabel: "Scrollable Area",
          orientation: "landscape",
          pageCount: 6,
          filename: "scroll2pdf-example.com-2026-08-12-1305.pdf",
          size: blob.size
        });
      }
      return new Promise((resolve) => {
        const canvas = document.createElement("canvas");
        canvas.width = 1000;
        canvas.height = 2500;
        const context = canvas.getContext("2d");
        const gradient = context.createLinearGradient(0, 0, 0, 2500);
        gradient.addColorStop(0, "#78a9ff");
        gradient.addColorStop(1, "#08111f");
        context.fillStyle = gradient;
        context.fillRect(0, 0, 1000, 2500);
        context.fillStyle = "white";
        context.font = "48px sans-serif";
        context.fillText("Scroll2PDF preview", 80, 130);
        canvas.toBlob((blob) => resolve({
          resultId,
          blob,
          width: 1000,
          height: 2500,
          mimeType: "image/png",
          captureMode: "selected-area",
          captureModeLabel: "Selected Area",
          imageFormat: "PNG",
          filename: "scroll2pdf-example.com-2026-08-12-1030.png",
          size: blob.size
        }), "image/png");
      });
    },
    deleteResult(resultId) {
      window.__deletedResultId = resultId;
      return Promise.resolve();
    }
  };
`;

(async () => {
  try {
    await waitFor(() => getJson("/json/version"), 30000, "Chrome DevTools");
    const tab = await getJson(`/json/new?${encodeURIComponent("about:blank")}`, "PUT");
    socket = new WebSocket(tab.webSocketDebuggerUrl);
    socket.pending = new Map();
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
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
    await send("Page.addScriptToEvaluateOnNewDocument", { source: resultStoreStub });
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1200, height: 800, deviceScaleFactor: 1, mobile: false,
    });
    await send("Page.navigate", { url: resultUrl });

    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", {
        expression, awaitPromise: true, returnByValue: true,
      });
      return result.result.value;
    };
    await waitFor(
      () => evaluate("!document.getElementById('preview-surface').hidden"),
      15000,
      "result preview",
    );

    check("result filename renders", await evaluate("document.getElementById('result-title').textContent.includes('scroll2pdf-example.com')"));
    check("bitmap dimensions render", await evaluate("document.getElementById('result-dimensions').textContent.includes('1,000 × 2,500 px')"));
    check("capture mode and image format render", await evaluate("document.getElementById('result-metadata').textContent === 'Selected Area · PNG'"));
    check("download is a local Blob URL", await evaluate("document.getElementById('download-image').href.startsWith('blob:')"));
    check("download filename is preserved", await evaluate("document.getElementById('download-image').download") === "scroll2pdf-example.com-2026-08-12-1030.png");
    check("temporary IndexedDB record is released after load", await evaluate("window.__deletedResultId") === "result-e2e");
    check("preview is responsive", await evaluate("document.getElementById('result-image').getBoundingClientRect().width <= document.getElementById('preview-surface').clientWidth"));
    check("image result shows Copy Image beside Download",
      await evaluate("!document.getElementById('copy-image').hidden && document.getElementById('copy-image').nextElementSibling.id === 'download-image'"));
    check("image result shows the focused editor toolbar in Select mode",
      await evaluate("!document.getElementById('editor-toolbar').hidden && document.querySelector('[data-editor-tool=\"select\"]').getAttribute('aria-pressed') === 'true'"));
    await evaluate("document.querySelector('[data-editor-tool=\"rectangle\"]').click()");
    check("drawing tools expose compact style controls",
      await evaluate("!document.getElementById('editor-context').hidden && !!document.querySelector('[data-editor-style=\"color\"]') && !!document.querySelector('[data-editor-style=\"thickness\"]')"));
    await evaluate(`(() => {
      const layer = document.getElementById('editor-interaction-layer');
      const bounds = layer.getBoundingClientRect();
      const event = (type, x, y, buttons) => layer.dispatchEvent(new PointerEvent(type, {
        bubbles: true, pointerId: 7, pointerType: 'mouse', buttons, clientX: bounds.left + x, clientY: bounds.top + y,
      }));
      event('pointerdown', 120, 110, 1);
      event('pointermove', 330, 235, 1);
      event('pointerup', 330, 235, 0);
    })()`);
    check("dragging creates and selects an annotation",
      await evaluate("document.getElementById('editor-interaction-layer').dataset.annotationCount === '1' && !document.getElementById('editor-selection').hidden"));
    check("annotation edits enable undo and reset",
      await evaluate("!document.getElementById('editor-undo').disabled && !document.getElementById('editor-reset').disabled"));
    await evaluate("document.getElementById('editor-undo').click()");
    check("Undo removes the last annotation and enables Redo",
      await evaluate("document.getElementById('editor-interaction-layer').dataset.annotationCount === '0' && !document.getElementById('editor-redo').disabled"));
    await evaluate("document.getElementById('editor-redo').click()");
    check("Redo restores the annotation",
      await evaluate("document.getElementById('editor-interaction-layer').dataset.annotationCount === '1'"));
    await evaluate(`(() => {
      const color = document.querySelector('[data-editor-style="color"]');
      color.value = '#00d4ff';
      color.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    check("selected annotation style changes are applied",
      await evaluate("document.getElementById('editor-interaction-layer').dataset.selectedColor === '#00d4ff'"));
    check("unexported edits request a navigation warning",
      await evaluate(`(() => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      })()`));
    check("long image preview uses bounded visible tiles instead of one full canvas",
      await evaluate(`(() => {
        const viewport = document.getElementById('editor-viewport');
        const layer = document.getElementById('editor-tile-layer');
        const mounted = layer.querySelectorAll('.editor-preview-tile').length;
        const total = Number(layer.dataset.totalTiles);
        return !viewport.hidden && document.getElementById('result-image').hidden
          && mounted > 0 && total > mounted;
      })()`));
    await evaluate("document.getElementById('copy-image').click()");
    await waitFor(
      () => evaluate("window.__clipboardWrites.length === 1"),
      10000,
      "clipboard image write",
    );
    check("Copy Image writes one PNG ClipboardItem",
      await evaluate("window.__clipboardWrites[0][0].types.length === 1 && window.__clipboardWrites[0][0].types[0] === 'image/png' && window.__clipboardWrites[0][0].items['image/png'].type === 'image/png'"));
    check("Copy Image announces success",
      await evaluate("document.getElementById('copy-image').textContent === 'Copied' && document.getElementById('result-status').textContent.includes('Copied')"));
    check("successful Copy marks the current revision exported",
      !(await evaluate(`(() => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      })()`)));
    await evaluate(`(() => {
      navigator.clipboard.write = () => Promise.reject(new Error('NotAllowedError'));
      document.getElementById('copy-image').click();
    })()`);
    await waitFor(
      () => evaluate("document.getElementById('copy-image').textContent === 'Copy Image'"),
      10000,
      "clipboard rejection recovery",
    );
    check("clipboard denial keeps Download available and gives fallback guidance",
      await evaluate("document.getElementById('result-status').dataset.state === 'error' && document.getElementById('result-status').textContent.includes('Download Image') && document.getElementById('download-image').getAttribute('aria-disabled') === 'false'"));

    await evaluate(`(() => {
      document.querySelector('[data-editor-tool="select"]').click();
      const layer = document.getElementById('editor-interaction-layer');
      const bounds = layer.getBoundingClientRect();
      const event = (type, x, y, buttons) => layer.dispatchEvent(new PointerEvent(type, {
        bubbles: true, pointerId: 8, pointerType: 'mouse', buttons, clientX: bounds.left + x, clientY: bounds.top + y,
      }));
      event('pointerdown', 220, 170, 1);
      event('pointermove', 270, 210, 1);
      event('pointerup', 270, 210, 0);
    })()`);
    check("Select tool moves an existing annotation",
      await evaluate("parseFloat(document.getElementById('editor-selection').style.left) > 160"));
    const selectionWidthBeforeResize = await evaluate("parseFloat(document.getElementById('editor-selection').style.width)");
    await evaluate(`(() => {
      const layer = document.getElementById('editor-interaction-layer');
      const handle = document.querySelector('[data-resize-handle="se"]');
      const bounds = handle.getBoundingClientRect();
      const x = bounds.left + bounds.width / 2;
      const y = bounds.top + bounds.height / 2;
      handle.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, pointerId: 10, pointerType: 'mouse', buttons: 1, clientX: x, clientY: y,
      }));
      layer.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, pointerId: 10, pointerType: 'mouse', buttons: 1, clientX: x + 70, clientY: y + 45,
      }));
      layer.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, pointerId: 10, pointerType: 'mouse', buttons: 0, clientX: x + 70, clientY: y + 45,
      }));
    })()`);
    check("selection handles resize an annotation",
      (await evaluate("parseFloat(document.getElementById('editor-selection').style.width)")) > selectionWidthBeforeResize + 40);
    await evaluate(`(() => {
      const layer = document.getElementById('editor-interaction-layer');
      layer.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Delete' }));
    })()`);
    check("Delete removes the selected annotation",
      await evaluate("document.getElementById('editor-interaction-layer').dataset.annotationCount === '0'"));
    await evaluate("document.getElementById('editor-undo').click()");
    check("Undo restores a deleted annotation",
      await evaluate("document.getElementById('editor-interaction-layer').dataset.annotationCount === '1'"));

    await evaluate(`(() => {
      document.querySelector('[data-editor-tool="text"]').click();
      const layer = document.getElementById('editor-interaction-layer');
      const bounds = layer.getBoundingClientRect();
      layer.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, pointerId: 9, pointerType: 'mouse', buttons: 1,
        clientX: bounds.left + 520, clientY: bounds.top + 180,
      }));
      const input = document.getElementById('editor-text-input');
      input.value = 'Important detail';
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', ctrlKey: true }));
    })()`);
    check("Text tool commits an inline text annotation",
      await evaluate("document.getElementById('editor-interaction-layer').dataset.annotationCount === '2' && document.getElementById('editor-text-input').hidden"));

    const originalDownloadHref = await evaluate("document.getElementById('download-image').href");
    await evaluate("document.getElementById('download-image').click()");
    await waitFor(
      () => evaluate("document.getElementById('result-status').textContent.includes('ready and downloading')"),
      10000,
      "edited image download",
    );
    check("Download exports the edited revision using a fresh Blob URL",
      (await evaluate("document.getElementById('download-image').href")) !== originalDownloadHref);
    check("edited Download preserves the original PNG format",
      await evaluate("fetch(document.getElementById('download-image').href).then((response) => response.blob()).then((blob) => blob.type === 'image/png')"));
    check("successful Download marks the current revision exported",
      !(await evaluate(`(() => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      })()`)));

    const editorScreenshot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(editorScreenshotPath, Buffer.from(editorScreenshot.data, "base64"));
    console.log(`SCREENSHOT ${editorScreenshotPath}`);

    await send("Page.navigate", { url: resultUrl.replace("result-e2e", "pdf-e2e") });
    await waitFor(
      () => evaluate("!document.getElementById('pdf-result-card').hidden"),
      15000,
      "PDF result card",
    );
    check("PDF filename renders", await evaluate("document.getElementById('result-title').textContent.endsWith('.pdf')"));
    check("PDF source dimensions render", await evaluate("document.getElementById('result-dimensions').textContent.includes('900 × 5,200 px source')"));
    check("PDF metadata renders mode, orientation, and pages", await evaluate("document.getElementById('result-metadata').textContent === 'Scrollable Area · A4 PDF · Landscape · 6 pages'"));
    check("PDF uses a compact result card instead of image preview", await evaluate("!document.getElementById('pdf-result-card').hidden && document.getElementById('preview-surface').hidden"));
    check("PDF download uses a local Blob URL", await evaluate("document.getElementById('download-image').href.startsWith('blob:')"));
    check("PDF download filename and action are correct", await evaluate("document.getElementById('download-image').download.endsWith('.pdf') && document.getElementById('download-image').textContent === 'Download PDF'"));
    check("PDF result does not expose image editing or clipboard controls",
      await evaluate("document.getElementById('copy-image').hidden && document.getElementById('editor-toolbar').hidden"));
    check("PDF temporary result is released after load", await evaluate("window.__deletedResultId") === "pdf-e2e");
    check("result page has no runtime exceptions", runtimeErrors.length === 0, runtimeErrors.join(", "));

    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
    console.log(`SCREENSHOT ${screenshotPath}`);
  } catch (error) {
    console.error(`RESULT E2E ERROR ${error.message}`);
    console.error(browserError.slice(0, 500));
    process.exitCode = 2;
  } finally {
    try { socket?.close(); browser.kill(); } catch (_) {}
  }
})();
