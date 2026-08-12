#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const debugPort = 9750 + Math.floor(Math.random() * 150);
const resultUrl = `${pathToFileURL(path.resolve(__dirname, "../result/result.html")).href}?id=result-e2e`;
const screenshotPath = "/tmp/scroll2pdf-result.png";
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
