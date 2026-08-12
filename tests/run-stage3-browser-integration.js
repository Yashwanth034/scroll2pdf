#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const port = Number(process.env.S2P_ATTACH_PORT || 9444);
const cdpBase = `http://127.0.0.1:${port}`;
const fixtureBase = process.env.S2P_FIXTURE_BASE || "http://127.0.0.1:8765/tests/fixtures";
let commandId = 0;

function read(file) { return fs.readFileSync(path.join(projectRoot, file), "utf8"); }
function report(name, detail = "") { console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`); }

async function getJson(endpoint, method = "GET") {
  const response = await fetch(`${cdpBase}${endpoint}`, { method });
  if (!response.ok) throw new Error(`${method} ${endpoint} returned ${response.status}`);
  return response.json();
}

async function waitFor(check, timeoutMs, label) {
  const started = Date.now();
  let detail = "";
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) { detail = error.message; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}${detail ? `: ${detail}` : ""}`);
}

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  socket.pending = new Map();
  socket.exceptions = [];
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && socket.pending.has(message.id)) {
      const pending = socket.pending.get(message.id);
      socket.pending.delete(message.id);
      clearTimeout(pending.timer);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    } else if (message.method === "Runtime.exceptionThrown") {
      socket.exceptions.push(message.params.exceptionDetails.text);
    }
  };
  return socket;
}

function send(socket, method, params = {}, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const id = ++commandId;
    const timer = setTimeout(() => reject(new Error(`No CDP reply for ${method}`)), timeoutMs);
    socket.pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(socket, expression, timeoutMs = 30000) {
  const result = await send(socket, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, timeoutMs);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}

async function createPage(url) {
  const target = await getJson(`/json/new?${encodeURIComponent(url)}`, "PUT");
  const socket = await connect(target);
  await send(socket, "Runtime.enable");
  await send(socket, "Page.enable");
  await send(socket, "Emulation.setDeviceMetricsOverride", {
    width: 1200,
    height: 800,
    deviceScaleFactor: 1.1,
    mobile: false,
  });
  await send(socket, "Page.reload", { ignoreCache: true });
  await waitFor(() => evaluate(socket, "document.readyState === 'complete'"), 15000, `fixture ${url}`);
  return { target, socket };
}

async function closePage(page) {
  page.socket.close();
  await fetch(`${cdpBase}/json/close/${page.target.id}`).catch(() => {});
}

async function injectPageCaptureModules(socket) {
  const source = [
    "utils/constants.js",
    "utils/capture-utils.js",
    "utils/difficult-page-utils.js",
    "content/capture-stability.js",
    "content/iframe-expansion.js",
    "content/page-capture.js",
    "content/selection-overlay.js",
    "content/adapters/generic-chat-adapter.js",
    "content/adapters/whatsapp-adapter.js",
    "content/adapters/telegram-adapter.js",
    "content/adapters/adapter-registry.js",
    "content/difficult-page-capture.js",
    "content/scrollable-selection.js",
    "content/screenshot-selection.js",
    "content/selected-area.js",
  ].map(read).join("\n");
  await evaluate(socket, `${source}\ntrue`);
}

async function createOffscreenProcessor() {
  const page = await createPage(`${fixtureBase}/short-page.html`);
  const source = [
    "utils/constants.js",
    "utils/capture-utils.js",
    "utils/difficult-page-utils.js",
    "utils/pdf-utils.js",
    "offscreen/frame-analysis.js",
    "offscreen/seam-planner.js",
    "offscreen/pdf-writer.js",
  ].map(read).join("\n");
  await evaluate(page.socket, `${source}
    globalThis.chrome = { runtime: { onMessage: { addListener() {} } } };
    globalThis.__scroll2pdfResults = new Map();
    globalThis.__scroll2pdfDeletedIds = [];
    globalThis.Scroll2PDFResultStore = {
      async saveResult(record) {
        globalThis.__scroll2pdfSavedRecord = record;
        globalThis.__scroll2pdfResults.set(record.resultId, record);
      },
      async getResult(resultId) { return globalThis.__scroll2pdfResults.get(resultId); },
      async deleteResult(resultId) {
        globalThis.__scroll2pdfDeletedIds.push(resultId);
        globalThis.__scroll2pdfResults.delete(resultId);
      }
    };
    ${read("offscreen/pdf-generator.js")}
    ${read("offscreen/offscreen.js")}
    true`);
  return page;
}

function createBackgroundManager(deps) {
  const sandbox = { globalThis: null, URL, setTimeout, clearTimeout, console };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  for (const file of [
    "utils/constants.js",
    "utils/capture-utils.js",
    "utils/difficult-page-utils.js",
    "utils/pdf-utils.js",
    "background/pdf-output.js",
    "background/dynamic-region-capture.js",
    "background/region-capture.js",
    "background/full-page-capture.js",
  ]) new vm.Script(read(file), { filename: file }).runInContext(context);
  return {
    manager: sandbox.Scroll2PDFFullPageCapture.createCaptureManager(deps),
    constants: sandbox.Scroll2PDFConstants,
  };
}

async function sendOffscreen(page, message) {
  return evaluate(page.socket, `Scroll2PDFOffscreen.routeMessage(${JSON.stringify(message)})`, 60000);
}

async function analyzeResult(page, scanRows = false) {
  return evaluate(page.socket, `(async () => {
    const record = globalThis.__scroll2pdfSavedRecord;
    if (!record?.blob) throw new Error("No stitched browser result was saved.");
    const image = new Image();
    const url = URL.createObjectURL(record.blob);
    await new Promise((resolve, reject) => {
      image.onload = resolve; image.onerror = reject; image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const scaleX = canvas.width / record.width;
    let greenPixels = 0;
    let redPixels = 0;
    let oldestPixels = 0;
    let newestPixels = 0;
    let mediaPixels = 0;
    let oldestFirstY = -1;
    let newestFirstY = -1;
    let bottomDarkPixels = 0;
    for (let y = 0; y < canvas.height; y += 3) {
      for (let x = 0; x < canvas.width; x += 3) {
        const index = ((y * canvas.width) + x) * 4;
        const r = data[index], g = data[index + 1], b = data[index + 2];
        if (Math.abs(r - 23) < 8 && Math.abs(g - 118) < 8 && Math.abs(b - 90) < 8) greenPixels += 1;
        if (Math.abs(r - 255) < 8 && Math.abs(g - 240) < 8 && Math.abs(b - 237) < 8) redPixels += 1;
        if (Math.abs(r - 255) < 12 && Math.abs(g - 223) < 12 && Math.abs(b - 110) < 12) {
          oldestPixels += 1; if (oldestFirstY < 0) oldestFirstY = y;
        }
        if (Math.abs(r - 251) < 12 && Math.abs(g - 113) < 12 && Math.abs(b - 133) < 12) {
          newestPixels += 1; if (newestFirstY < 0) newestFirstY = y;
        }
        if (Math.abs(r - 22) < 12 && Math.abs(g - 163) < 12 && Math.abs(b - 74) < 12) mediaPixels += 1;
        if (y >= canvas.height - Math.min(canvas.height, 140) && ((r + g + b) / 3) < 110) bottomDarkPixels += 1;
      }
    }
    let rowRuns = 0;
    if (${scanRows}) {
      let inRow = false;
      const x = Math.min(canvas.width - 1, Math.max(1, Math.round(50 * (canvas.width / record.width))));
      for (let y = 0; y < canvas.height; y += Math.max(1, Math.round(canvas.height / record.height))) {
        const index = ((y * canvas.width) + x) * 4;
        const r = data[index], g = data[index + 1], b = data[index + 2];
        const row = (Math.abs(r - 238) < 8 && Math.abs(g - 244) < 8 && Math.abs(b - 255) < 8)
          || (Math.abs(r - 243) < 8 && Math.abs(g - 251) < 8 && Math.abs(b - 247) < 8);
        if (row && !inRow) rowRuns += 1;
        inRow = row;
      }
    }
    URL.revokeObjectURL(url);
    return {
      width: record.width, height: record.height, captureMode: record.captureMode,
      mimeType: record.mimeType, imageFormat: record.imageFormat, filename: record.filename,
      greenPixels, redPixels, oldestPixels, newestPixels, oldestFirstY, newestFirstY,
      mediaPixels, bottomDarkPixels, rowRuns,
    };
  })()`, 60000);
}

async function analyzeIframeColors(offscreen, targets) {
  return evaluate(offscreen.socket, `(async () => {
    const record = globalThis.__scroll2pdfSavedRecord;
    if (!record?.blob) throw new Error("No stitched browser result was saved.");
    const image = new Image();
    const url = URL.createObjectURL(record.blob);
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const targets = ${JSON.stringify(targets)};
    const counts = {};
    const firstY = {};
    for (const name of Object.keys(targets)) { counts[name] = 0; firstY[name] = -1; }
    for (let y = 0; y < canvas.height; y += 3) {
      for (let x = 0; x < canvas.width; x += 3) {
        const index = ((y * canvas.width) + x) * 4;
        const r = data[index], g = data[index + 1], b = data[index + 2];
        for (const [name, target] of Object.entries(targets)) {
          if (Math.abs(r - target[0]) <= 14 && Math.abs(g - target[1]) <= 14 && Math.abs(b - target[2]) <= 14) {
            counts[name] += 1;
            if (firstY[name] < 0) firstY[name] = y;
          }
        }
      }
    }
    URL.revokeObjectURL(url);
    return { width: canvas.width, height: canvas.height, counts, firstY };
  })()`, 60000);
}

async function analyzePdfResult(page) {
  return evaluate(page.socket, `(async () => {
    const record = globalThis.__scroll2pdfSavedRecord;
    if (record?.mimeType !== "application/pdf" || !record.blob) {
      throw new Error("No PDF browser result was saved.");
    }
    const bytes = new Uint8Array(await record.blob.arrayBuffer());
    const text = new TextDecoder("latin1").decode(bytes);
    const pageObjects = (text.match(/\\/Type \\/Page\\b/g) || []).length;
    const boxes = Array.from(text.matchAll(/\\/MediaBox \\[0 0 ([0-9.]+) ([0-9.]+)\\]/g),
      (match) => [Number(match[1]), Number(match[2])]);
    return {
      resultId: record.resultId,
      filename: record.filename,
      mimeType: record.mimeType,
      size: record.size,
      pageCount: record.pageCount,
      orientation: record.orientation,
      captureMode: record.captureMode,
      sourceWidth: record.sourceWidth,
      sourceHeight: record.sourceHeight,
      signature: String.fromCharCode(...bytes.slice(0, 8)),
      hasEof: text.endsWith("%%EOF\\n"),
      pageObjects,
      mediaBoxes: boxes,
      hasCreator: text.includes("/Creator (Scroll2PDF)"),
      hasProducer: text.includes("/Producer (Scroll2PDF)"),
      hasTitle: text.includes("/Title ("),
      hasFlate: text.includes("/Filter /FlateDecode"),
      hasJpeg: text.includes("/Filter /DCTDecode"),
      nonEmptyStreams: Array.from(text.matchAll(/\\/Length (\\d+) >>\\nstream/g),
        (match) => Number(match[1])).filter((length) => length > 0).length,
      stored: globalThis.__scroll2pdfResults.has(record.resultId),
      deletedIds: globalThis.__scroll2pdfDeletedIds.slice(),
    };
  })()`, 60000);
}

async function dispatchSelectedDrag(socket, rect) {
  const startX = rect.left + 8;
  const endX = rect.right - 8;
  const startY = 180;
  const endY = 650;
  await send(socket, "Input.dispatchMouseEvent", { type: "mouseMoved", x: startX, y: startY });
  await send(socket, "Input.dispatchMouseEvent", { type: "mousePressed", x: startX, y: startY, button: "left", buttons: 1, clickCount: 1 });
  await send(socket, "Input.dispatchMouseEvent", { type: "mouseMoved", x: endX, y: endY, button: "left", buttons: 1 });
  await send(socket, "Input.dispatchMouseEvent", { type: "mouseReleased", x: endX, y: endY, button: "left", buttons: 0, clickCount: 1 });
}

async function dispatchScrollableClick(socket, rect) {
  const x = rect.left + (rect.width / 2);
  const y = rect.top + (rect.height / 2);
  await send(socket, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await send(socket, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await send(socket, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
}

async function runRegionMode(mode, options = {}) {
  const fixture = options.fixture || (mode === "selected-area" ? "selected-area-test.html" : "scrollable-area-test.html");
  const scrollableId = options.elementId || "scrollable-panel";
  const page = await createPage(`${fixtureBase}/${fixture}`);
  const offscreen = await createOffscreenProcessor();
  const frames = [];
  const events = [];
  let openedResult = "";
  let pdfPlan = null;
  let sourceAnalysis = null;
  let manager;
  try {
    await injectPageCaptureModules(page.socket);
    if (mode === "selected-area") {
      await evaluate(page.socket, `window.scrollTo(0, 900); window.__s2pScrollHistory = [window.scrollY];
        window.addEventListener("scroll", () => window.__s2pScrollHistory.push(window.scrollY)); true`);
    } else if (!options.preserveFixtureScroll) {
      const prescroll = Number.isFinite(options.prescroll) ? options.prescroll : 177;
      await evaluate(page.socket, `(() => { const panel = document.getElementById(${JSON.stringify(scrollableId)});
        panel.scrollTop = ${prescroll}; window.__s2pPanelHistory = [panel.scrollTop];
        panel.addEventListener("scroll", () => window.__s2pPanelHistory.push(panel.scrollTop)); return true; })()`);
    } else {
      await evaluate(page.socket, `(() => { const panel = document.getElementById(${JSON.stringify(scrollableId)});
        window.__s2pPanelHistory = [panel.scrollTop];
        panel.addEventListener("scroll", () => window.__s2pPanelHistory.push(panel.scrollTop)); return true; })()`);
    }
    const initial = await evaluate(page.socket, mode === "selected-area"
      ? `({ scroll: window.scrollY, rect: (() => { const r = document.getElementById("selected-column").getBoundingClientRect(); return {left:r.left,right:r.right,width:r.width}; })() })`
      : `({ scroll: document.getElementById(${JSON.stringify(scrollableId)}).scrollTop, rect: (() => { const r = document.getElementById(${JSON.stringify(scrollableId)}).getBoundingClientRect(); return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; })() })`);
    await send(page.socket, "Page.bringToFront");

    const deps = {
      getActiveTab: async () => ({ id: 1, windowId: 1, url: `${fixtureBase}/${fixture}` }),
      ensureOffscreen: async () => {}, closeOffscreen: async () => {},
      assertTargetActive: async () => {}, delay: async () => {},
      broadcast: async (event) => { events.push(event); },
      openResult: async (resultId) => { openedResult = resultId; },
      createId: () => `browser-${mode}`,
      captureVisibleTab: async () => {
        const screenshot = await send(page.socket, "Page.captureScreenshot", { format: "png", fromSurface: true });
        return `data:image/png;base64,${screenshot.data}`;
      },
      sendOffscreen: async (message) => {
        if (message.type === "OFFSCREEN_ADD_CAPTURE") frames.push(JSON.parse(JSON.stringify(message.payload.frame)));
        if (message.type === "OFFSCREEN_PLAN_PDF") sourceAnalysis = await analyzeResult(offscreen, mode === "scrollable-area");
        try {
          const response = await sendOffscreen(offscreen, message);
          if (options.cancelAfterFrames && message.type === "OFFSCREEN_ADD_CAPTURE"
              && frames.length === options.cancelAfterFrames) await manager.cancelCapture();
          if (message.type === "OFFSCREEN_PLAN_PDF") pdfPlan = response;
          if (options.cancelPdf && message.type === "OFFSCREEN_RENDER_PDF_PAGE" && message.payload.pageIndex === 0) {
            await manager.cancelCapture();
          }
          return response;
        }
        catch (error) { throw new Error(`${message.type}: ${error.message}`); }
      },
      cancelOperation: async (operation) => {
        await Promise.allSettled([
          sendOffscreen(offscreen, { type: "OFFSCREEN_CANCEL_CAPTURE", target: "offscreen", payload: { captureId: operation.captureId } }),
          evaluate(page.socket, `Scroll2PDFScrollableSelection.cancelSelection(${JSON.stringify(operation.captureId)})`),
        ]);
      },
      sendTabMessage: async (tabId, message) => {
        const payload = message.payload || {};
        if (message.type === "START_REGION_SELECTION") {
          const pending = evaluate(page.socket,
            `${mode === "selected-area" ? "Scroll2PDFSelectedArea" : "Scroll2PDFScrollableSelection"}.startSelection(${JSON.stringify(payload.captureId)})`,
            30000);
          await waitFor(() => evaluate(page.socket, "Boolean(document.getElementById('scroll2pdf-selection-host'))"), 5000, `${mode} overlay`);
          if (mode === "selected-area") await dispatchSelectedDrag(page.socket, initial.rect);
          else await dispatchScrollableClick(page.socket, initial.rect);
          return pending;
        }
        const api = mode === "selected-area" ? "Scroll2PDFSelectedArea" : "Scroll2PDFScrollableSelection";
        let expression;
        if (message.type === "PREPARE_REGION_CAPTURE") expression = `${api}.prepareCapture(${JSON.stringify(payload.captureId)})`;
        else if (message.type === "GET_REGION_METRICS") expression = `({ok:true, metrics:${api}.getMetrics(${JSON.stringify(payload.captureId)})})`;
        else if (message.type === "SCROLL_REGION_TO_POSITION") expression = `${api}.scrollToPosition(${JSON.stringify(payload.captureId)}, ${Number(payload.position)})`;
        else if (message.type === "SET_REGION_OVERLAYS_HIDDEN") expression = `${api}.hideRepeatedOverlays(${JSON.stringify(payload.captureId)})`;
        else if (message.type === "RESTORE_REGION_BOTTOM_CHROME") expression = `${api}.restoreBottomChrome(${JSON.stringify(payload.captureId)})`;
        else if (message.type === "ADVANCE_DIFFICULT_CAPTURE") expression = `${api}.advanceDifficultCapture(${JSON.stringify(payload.captureId)}, false)`;
        else if (message.type === "RECOVER_DIFFICULT_CAPTURE") expression = `${api}.advanceDifficultCapture(${JSON.stringify(payload.captureId)}, true)`;
        else if (message.type === "LOAD_OLDER_HISTORY") expression = `${api}.loadOlderHistory(${JSON.stringify(payload.captureId)})`;
        else if (message.type === "RESTORE_REGION_CAPTURE") expression = `${api}.restoreCapture(${JSON.stringify(payload.captureId)})`;
        if (expression) {
          try { return await evaluate(page.socket, expression); }
          catch (error) { throw new Error(`${message.type}: ${error.message}`); }
        }
        throw new Error(`Unexpected page message ${message.type}`);
      },
    };
    ({ manager } = createBackgroundManager(deps));
    const started = await manager.startCapture({
      captureMode: mode,
      outputType: options.outputType || "long-image",
      quality: options.quality || "high",
      orientation: options.orientation || "portrait",
    });
    assert.equal(started.ok, true);
    const completion = await started.completion;
    if (options.expectError) {
      assert.equal(completion.ok, false);
      assert.match(completion.error || "", options.expectError);
      const restored = await evaluate(page.socket, `({ position: document.getElementById(${JSON.stringify(scrollableId)}).scrollTop,
        scrollHeight: document.getElementById(${JSON.stringify(scrollableId)}).scrollHeight,
        clientHeight: document.getElementById(${JSON.stringify(scrollableId)}).clientHeight,
        history: window.__s2pPanelHistory })`);
      return { completion, restored, frames, events, openedResult };
    }
    if (options.cancelAfterFrames) {
      assert.equal(completion.cancelled, true);
      const restored = await evaluate(page.socket, `({ position: document.getElementById(${JSON.stringify(scrollableId)}).scrollTop,
        scrollHeight: document.getElementById(${JSON.stringify(scrollableId)}).scrollHeight,
        clientHeight: document.getElementById(${JSON.stringify(scrollableId)}).clientHeight,
        history: window.__s2pPanelHistory })`);
      return { cancelled: true, restored, frames, events, openedResult };
    }
    if (options.cancelPdf) {
      assert.equal(completion.cancelled, true);
      const cleanup = await evaluate(offscreen.socket, `({
        resultCount: globalThis.__scroll2pdfResults.size,
        deletedIds: globalThis.__scroll2pdfDeletedIds.slice()
      })`);
      const restored = await evaluate(page.socket, mode === "selected-area"
        ? `({ position: window.scrollY, history: window.__s2pScrollHistory })`
        : `({ position: document.getElementById(${JSON.stringify(scrollableId)}).scrollTop, history: window.__s2pPanelHistory })`);
      return { cancelled: true, cleanup, restored, openedResult, sourceAnalysis, events };
    }
    assert.equal(completion.ok, true, completion.error);
    assert.equal(Boolean(openedResult), true);
    const analysis = options.outputType === "a4-pdf"
      ? await analyzePdfResult(offscreen)
      : await analyzeResult(offscreen, mode === "scrollable-area");
    const restored = await evaluate(page.socket, mode === "selected-area"
      ? `({ position: window.scrollY, history: window.__s2pScrollHistory })`
      : `({ position: document.getElementById(${JSON.stringify(scrollableId)}).scrollTop,
          scrollHeight: document.getElementById(${JSON.stringify(scrollableId)}).scrollHeight,
          clientHeight: document.getElementById(${JSON.stringify(scrollableId)}).clientHeight,
          historyLoads: window.__historyLoads || 0, mountedRange: window.__mountedMessageRange || null,
          history: window.__s2pPanelHistory,
          labels: Array.from(document.querySelectorAll(".row")).map((row) => row.textContent.trim()) })`);
    assert.equal(page.socket.exceptions.length, 0, page.socket.exceptions.join(", "));
    return { initial, frames, events, analysis, sourceAnalysis, pdfPlan, restored, openedResult };
  } finally {
    await closePage(page);
    await closePage(offscreen);
  }
}

async function runIframeFullPage() {
  const fixture = "iframe-page-test.html";
  const page = await createPage(`${fixtureBase}/${fixture}`);
  const offscreen = await createOffscreenProcessor();
  const frames = [];
  let openedResult = "";
  try {
    await injectPageCaptureModules(page.socket);
    // Measure the expanded height the capture should reach without touching the
    // page: the top page's natural height minus each iframe's rendered height,
    // plus the full embedded content height of both inner documents.
    const measurements = await evaluate(page.socket, `(() => {
      const top = document.documentElement.scrollHeight;
      const w = document.getElementById("frame-window");
      const s = document.getElementById("frame-shell");
      const wDoc = w.contentDocument;
      const sDoc = s.contentDocument;
      const wContent = Math.max(
        wDoc.scrollingElement.scrollHeight, wDoc.documentElement.scrollHeight, wDoc.body.scrollHeight);
      const sScroller = sDoc.getElementById("scroller");
      const sHeader = sDoc.getElementById("shell-header");
      const sContent = sHeader.offsetHeight + sScroller.scrollHeight;
      return {
        top, wClient: w.clientHeight, sClient: s.clientHeight, wContent, sContent,
        expected: top - w.clientHeight - s.clientHeight + wContent + sContent,
      };
    })()`);
    await send(page.socket, "Page.bringToFront");
    const deps = {
      getActiveTab: async () => ({ id: 1, windowId: 1, url: `${fixtureBase}/${fixture}` }),
      ensureOffscreen: async () => {}, closeOffscreen: async () => {},
      assertTargetActive: async () => {}, delay: async () => {}, broadcast: async () => {},
      openResult: async (resultId) => { openedResult = resultId; }, createId: () => "browser-iframe-full",
      captureVisibleTab: async () => {
        const shot = await send(page.socket, "Page.captureScreenshot", { format: "png", fromSurface: true });
        return `data:image/png;base64,${shot.data}`;
      },
      sendOffscreen: async (message) => {
        if (message.type === "OFFSCREEN_ADD_CAPTURE") frames.push(JSON.parse(JSON.stringify(message.payload.frame)));
        return sendOffscreen(offscreen, message);
      },
      sendTabMessage: async (tabId, message) => {
        const payload = message.payload || {};
        if (message.type === "PREPARE_FULL_PAGE_CAPTURE") return evaluate(page.socket, `Scroll2PDFPageCapture.prepareFullPageCapture(${JSON.stringify(payload.captureId)})`);
        if (message.type === "GET_PAGE_METRICS") return evaluate(page.socket, `({ok:true, metrics:Scroll2PDFPageCapture.getPageMetrics()})`);
        if (message.type === "SCROLL_TO_POSITION") return evaluate(page.socket, `Scroll2PDFPageCapture.scrollToPosition(${JSON.stringify(payload.captureId)}, ${Number(payload.y)})`);
        if (message.type === "SET_CAPTURE_OVERLAYS_HIDDEN") return evaluate(page.socket, `Scroll2PDFPageCapture.hideRepeatedOverlays(${JSON.stringify(payload.captureId)})`);
        if (message.type === "RESTORE_PAGE") return evaluate(page.socket, `Scroll2PDFPageCapture.restorePage(${JSON.stringify(payload.captureId)})`);
        throw new Error(`Unexpected page message ${message.type}`);
      },
    };
    const { manager } = createBackgroundManager(deps);
    const started = await manager.startCapture({
      captureMode: "full-page",
      outputType: "long-image",
      quality: "high",
      orientation: "portrait",
    });
    const completion = await started.completion;
    assert.equal(completion.ok, true, completion.error);
    assert.equal(Boolean(openedResult), true);
    const analysis = await analyzeResult(offscreen);
    const colors = await analyzeIframeColors(offscreen, {
      windowDeep: [59, 130, 246],
      shellDeep: [34, 197, 94],
    });
    const restored = await evaluate(page.socket, `(() => {
      const w = document.getElementById("frame-window");
      const s = document.getElementById("frame-shell");
      return {
        scrollY: window.scrollY,
        windowClient: w.clientHeight,
        shellClient: s.clientHeight,
        windowInlineHeight: w.style.getPropertyValue("height"),
        shellInlineHeight: s.style.getPropertyValue("height"),
        windowScroll: w.contentWindow.scrollY,
        shellScroll: s.contentDocument.getElementById("scroller").scrollTop,
        shellScrollerInlineHeight: s.contentDocument.getElementById("scroller").style.getPropertyValue("height"),
        shellHtmlInlineHeight: s.contentDocument.documentElement.style.getPropertyValue("height"),
      };
    })()`);
    assert.equal(page.socket.exceptions.length, 0, page.socket.exceptions.join(", "));
    return {
      frames,
      analysis,
      colors,
      expected: measurements.expected,
      measurements,
      restored,
      openedResult,
    };
  } finally {
    await closePage(page);
    await closePage(offscreen);
  }
}

async function runFullPage(options = {}) {
  const fixture = options.fixture || "full-page-test.html";
  const page = await createPage(`${fixtureBase}/${fixture}`);
  const offscreen = await createOffscreenProcessor();
  let openedResult = "";
  let sourceAnalysis = null;
  let pdfPlan = null;
  try {
    await injectPageCaptureModules(page.socket);
    await evaluate(page.socket, `window.scrollTo(0, 731); window.__s2pScrollHistory = [window.scrollY];
      window.addEventListener("scroll", () => window.__s2pScrollHistory.push(window.scrollY)); true`);
    const initialScroll = await evaluate(page.socket, "window.scrollY");
    await send(page.socket, "Page.bringToFront");
    const deps = {
      getActiveTab: async () => ({ id: 1, windowId: 1, url: `${fixtureBase}/${fixture}` }),
      ensureOffscreen: async () => {}, closeOffscreen: async () => {},
      assertTargetActive: async () => {}, delay: async () => {}, broadcast: async () => {},
      openResult: async (resultId) => { openedResult = resultId; }, createId: () => "browser-full-page",
      captureVisibleTab: async () => {
        const shot = await send(page.socket, "Page.captureScreenshot", { format: "png", fromSurface: true });
        return `data:image/png;base64,${shot.data}`;
      },
      sendOffscreen: async (message) => {
        if (message.type === "OFFSCREEN_PLAN_PDF") sourceAnalysis = await analyzeResult(offscreen);
        const response = await sendOffscreen(offscreen, message);
        if (message.type === "OFFSCREEN_PLAN_PDF") pdfPlan = response;
        return response;
      },
      sendTabMessage: async (tabId, message) => {
        const payload = message.payload || {};
        if (message.type === "PREPARE_FULL_PAGE_CAPTURE") return evaluate(page.socket, `Scroll2PDFPageCapture.prepareFullPageCapture(${JSON.stringify(payload.captureId)})`);
        if (message.type === "GET_PAGE_METRICS") return evaluate(page.socket, `({ok:true, metrics:Scroll2PDFPageCapture.getPageMetrics()})`);
        if (message.type === "SCROLL_TO_POSITION") return evaluate(page.socket, `Scroll2PDFPageCapture.scrollToPosition(${JSON.stringify(payload.captureId)}, ${Number(payload.y)})`);
        if (message.type === "SET_CAPTURE_OVERLAYS_HIDDEN") return evaluate(page.socket, `Scroll2PDFPageCapture.hideRepeatedOverlays(${JSON.stringify(payload.captureId)})`);
        if (message.type === "RESTORE_PAGE") return evaluate(page.socket, `Scroll2PDFPageCapture.restorePage(${JSON.stringify(payload.captureId)})`);
        throw new Error(`Unexpected page message ${message.type}`);
      },
    };
    const { manager } = createBackgroundManager(deps);
    const started = await manager.startCapture({
      captureMode: "full-page",
      outputType: options.outputType || "long-image",
      quality: options.quality || "high",
      orientation: options.orientation || "portrait",
    });
    const completion = await started.completion;
    if (options.expectError) {
      assert.equal(completion.ok, false);
      assert.match(completion.error || "", options.expectError);
      const restored = await evaluate(page.socket, `({ position: window.scrollY, history: window.__s2pScrollHistory })`);
      return { completion, restored, sourceAnalysis, pdfPlan, openedResult };
    }
    assert.equal(completion.ok, true, completion.error);
    assert.equal(Boolean(openedResult), true);
    const analysis = options.outputType === "a4-pdf"
      ? await analyzePdfResult(offscreen)
      : await analyzeResult(offscreen);
    const restored = await evaluate(page.socket, `({ position: window.scrollY, history: window.__s2pScrollHistory })`);
    assert.equal(restored.position, initialScroll);
    assert.equal(analysis.captureMode, "full-page");
    assert.equal(page.socket.exceptions.length, 0, page.socket.exceptions.join(", "));
    return { analysis, sourceAnalysis, pdfPlan, restored, openedResult };
  } finally {
    await closePage(page);
    await closePage(offscreen);
  }
}

async function runContainerFullPage(options = {}) {
  const fixture = "container-scroll-test.html";
  const page = await createPage(`${fixtureBase}/${fixture}`);
  const offscreen = await createOffscreenProcessor();
  const frames = [];
  let openedResult = "";
  try {
    await injectPageCaptureModules(page.socket);
    await send(page.socket, "Page.bringToFront");
    const deps = {
      getActiveTab: async () => ({ id: 1, windowId: 1, url: `${fixtureBase}/${fixture}` }),
      ensureOffscreen: async () => {}, closeOffscreen: async () => {},
      assertTargetActive: async () => {}, delay: async () => {}, broadcast: async () => {},
      openResult: async (resultId) => { openedResult = resultId; }, createId: () => "browser-container-full",
      captureVisibleTab: async () => {
        const shot = await send(page.socket, "Page.captureScreenshot", { format: "png", fromSurface: true });
        return `data:image/png;base64,${shot.data}`;
      },
      sendOffscreen: async (message) => {
        if (message.type === "OFFSCREEN_ADD_CAPTURE") frames.push(JSON.parse(JSON.stringify(message.payload.frame)));
        return sendOffscreen(offscreen, message);
      },
      sendTabMessage: async (tabId, message) => {
        const payload = message.payload || {};
        if (message.type === "PREPARE_FULL_PAGE_CAPTURE") return evaluate(page.socket, `Scroll2PDFPageCapture.prepareFullPageCapture(${JSON.stringify(payload.captureId)})`);
        if (message.type === "GET_PAGE_METRICS") return evaluate(page.socket, `({ok:true, metrics:Scroll2PDFPageCapture.getPageMetrics()})`);
        if (message.type === "SCROLL_TO_POSITION") return evaluate(page.socket, `Scroll2PDFPageCapture.scrollToPosition(${JSON.stringify(payload.captureId)}, ${Number(payload.y)})`);
        if (message.type === "SET_CAPTURE_OVERLAYS_HIDDEN") return evaluate(page.socket, `Scroll2PDFPageCapture.hideRepeatedOverlays(${JSON.stringify(payload.captureId)})`);
        if (message.type === "RESTORE_PAGE") return evaluate(page.socket, `Scroll2PDFPageCapture.restorePage(${JSON.stringify(payload.captureId)})`);
        throw new Error(`Unexpected page message ${message.type}`);
      },
    };
    const { manager } = createBackgroundManager(deps);
    const started = await manager.startCapture({
      captureMode: "full-page",
      outputType: options.outputType || "long-image",
      quality: options.quality || "high",
      orientation: options.orientation || "portrait",
    });
    const completion = await started.completion;
    assert.equal(completion.ok, true, completion.error);
    assert.equal(Boolean(openedResult), true);
    const analysis = await analyzeResult(offscreen);
    const scrollerState = await evaluate(page.socket, `(() => {
      const scroller = document.getElementById("selected-column");
      return { scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight };
    })()`);
    assert.equal(page.socket.exceptions.length, 0, page.socket.exceptions.join(", "));
    return { frames, analysis, scrollerState, openedResult };
  } finally {
    await closePage(page);
    await closePage(offscreen);
  }
}

async function runNormalScreenshot(options = {}) {
  const fixture = options.fixture || "full-page-test.html";
  const page = await createPage(`${fixtureBase}/${fixture}`);
  const offscreen = await createOffscreenProcessor();
  let openedResult = "";
  let captureCount = 0;
  let overlayPresentAtCapture = false;
  try {
    await send(page.socket, "Page.bringToFront");
    if (options.selectArea) await injectPageCaptureModules(page.socket);
    await evaluate(page.socket, "window.scrollTo(0, 240); true");
    const viewport = await evaluate(page.socket,
      `({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio, scrollY: window.scrollY })`);
    const deps = {
      getActiveTab: async () => ({ id: 1, windowId: 1, url: `${fixtureBase}/${fixture}` }),
      ensureOffscreen: async () => {}, closeOffscreen: async () => {},
      assertTargetActive: async () => {}, delay: async () => {}, broadcast: async () => {},
      openResult: async (resultId) => { openedResult = resultId; },
      createId: () => "browser-screenshot",
      captureVisibleTab: async () => {
        captureCount += 1;
        overlayPresentAtCapture = await evaluate(page.socket,
          "Boolean(document.getElementById('scroll2pdf-selection-host'))");
        const shot = await send(page.socket, "Page.captureScreenshot", { format: "png", fromSurface: true });
        return `data:image/png;base64,${shot.data}`;
      },
      sendOffscreen: async (message) => sendOffscreen(offscreen, message),
      sendTabMessage: async (tabId, message) => {
        if (!options.selectArea) throw new Error("Screenshot must not message the page.");
        assert.equal(message.type, "START_SCREENSHOT_SELECTION");
        await evaluate(page.socket,
          `globalThis.__scroll2pdfScreenshotSelection = Scroll2PDFScreenshotSelection.startSelection("${message.payload.captureId}"); true`);
        await waitFor(
          () => evaluate(page.socket, "Boolean(document.getElementById('scroll2pdf-selection-host'))"),
          5000,
          "screenshot selection overlay",
        );
        const selectedRect = options.selectedRect || { left: 150, top: 120, right: 650, bottom: 420 };
        await send(page.socket, "Input.dispatchMouseEvent", { type: "mouseMoved", x: selectedRect.left, y: selectedRect.top });
        await send(page.socket, "Input.dispatchMouseEvent", {
          type: "mousePressed", x: selectedRect.left, y: selectedRect.top, button: "left", buttons: 1, clickCount: 1,
        });
        await send(page.socket, "Input.dispatchMouseEvent", {
          type: "mouseMoved", x: selectedRect.right, y: selectedRect.bottom, button: "left", buttons: 1,
        });
        await send(page.socket, "Input.dispatchMouseEvent", {
          type: "mouseReleased", x: selectedRect.right, y: selectedRect.bottom, button: "left", buttons: 0, clickCount: 1,
        });
        return evaluate(page.socket, "globalThis.__scroll2pdfScreenshotSelection");
      },
    };
    const { manager } = createBackgroundManager(deps);
    const started = await manager.startCapture({
      captureMode: "normal-screenshot",
      outputType: "long-image",
      quality: options.quality || "standard",
      orientation: "portrait",
      selectScreenshotArea: Boolean(options.selectArea),
    });
    assert.equal(started.ok, true);
    const completion = await started.completion;
    assert.equal(completion.ok, true, completion.error);
    assert.equal(Boolean(openedResult), true);
    assert.equal(captureCount, 1, "a Screenshot must capture exactly one viewport");
    const analysis = await analyzeResult(offscreen);
    assert.equal(analysis.captureMode, "normal-screenshot");
    assert.equal(analysis.mimeType, "image/png");
    assert.equal(analysis.imageFormat, "PNG");
    assert.match(analysis.filename, /\.png$/);
    const selectedRect = options.selectedRect || { left: 150, top: 120, right: 650, bottom: 420 };
    const expectedWidth = Math.round((options.selectArea ? selectedRect.right - selectedRect.left : viewport.width) * viewport.dpr);
    const expectedHeight = Math.round((options.selectArea ? selectedRect.bottom - selectedRect.top : viewport.height) * viewport.dpr);
    assert.ok(Math.abs(analysis.width - expectedWidth) <= 2,
      `screenshot width ${analysis.width} does not match the viewport ${expectedWidth}`);
    assert.ok(Math.abs(analysis.height - expectedHeight) <= 2,
      `screenshot height ${analysis.height} does not match the viewport ${expectedHeight}`);
    const finalScrollY = await evaluate(page.socket, "window.scrollY");
    assert.equal(finalScrollY, viewport.scrollY, "Screenshot area selection changed page scroll position");
    assert.equal(overlayPresentAtCapture, false, "selection overlay was present in the saved Screenshot");
    assert.equal(offscreen.socket.exceptions.length, 0, offscreen.socket.exceptions.join(", "));
    return { analysis, captureCount, openedResult, viewport, overlayPresentAtCapture, finalScrollY };
  } finally {
    await closePage(page);
    await closePage(offscreen);
  }
}

async function main() {
  try {
    const server = await fetch(`${fixtureBase}/selected-area-test.html`);
    assert.equal(server.ok, true, "Fixture server is not available.");

    const containerFull = await runContainerFullPage();
    assert.equal(containerFull.frames.length > 3, true, `Only ${containerFull.frames.length} container frames were captured.`);
    assert.equal(containerFull.frames.length > 0
      && containerFull.frames.every((frame) => (
        frame.cropRectCss
        && Math.abs(frame.cropRectCss.width - containerFull.frames[0].cropRectCss.width) < 2
        && Math.abs(frame.cropRectCss.left - containerFull.frames[0].cropRectCss.left) < 2
      )), true, "Container frames did not keep a stable inner-scroller crop.");
    assert.equal(containerFull.frames[0].cropRectCss.width < 1200, true,
      "Full-page capture used the full viewport instead of the inner scroll container.");
    assert.equal(containerFull.analysis.greenPixels > 100, true,
      `Container full-page result is missing the green bottom marker (${containerFull.analysis.greenPixels}).`);
    assert.equal(containerFull.scrollerState.scrollTop, 0,
      `Container scroller was not restored to its original position (${containerFull.scrollerState.scrollTop}).`);
    report("Container app shell full-page capture", `${containerFull.frames.length} frames, crop ${Math.round(containerFull.frames[0].cropRectCss.width)}px wide, ${containerFull.analysis.width}×${containerFull.analysis.height}`);

    const containerSelected = await runRegionMode("selected-area", { fixture: "container-scroll-test.html" });
    assert.equal(containerSelected.analysis.captureMode, "selected-area");
    assert.equal(containerSelected.analysis.greenPixels > 100, true,
      `Container selected-area result is missing the green bottom marker (${containerSelected.analysis.greenPixels}).`);
    assert.equal(containerSelected.frames.length > 3, true);
    assert.equal(containerSelected.frames.every((frame) => (
      Math.abs(frame.cropRectCss.width - containerSelected.frames[0].cropRectCss.width) < 2
    )), true);
    report("Container app shell Selected Area capture", `${containerSelected.frames.length} frames, restored to ${containerSelected.restored.position}px`);

    const containerScrollable = await runRegionMode("scrollable-area", {
      fixture: "container-scroll-test.html",
      elementId: "selected-column",
    });
    assert.deepEqual(containerScrollable.restored.labels,
      Array.from({ length: 24 }, (_, index) => `Message ${String(index + 1).padStart(2, "0")}`));
    assert.equal(containerScrollable.analysis.greenPixels > 100, true,
      `Container scrollable-area result is missing the green bottom marker (${containerScrollable.analysis.greenPixels}).`);
    report("Container app shell Scrollable Area capture", `${containerScrollable.frames.length} frames, ${containerScrollable.analysis.rowRuns} row bands`);

    const iframe = await runIframeFullPage();
    assert.equal(iframe.frames.length > 3, true,
      `Only ${iframe.frames.length} iframe-page frames were captured.`);
    assert.equal(iframe.analysis.captureMode, "full-page");
    const expectedPixels = iframe.expected * 1.1;
    assert.equal(Math.abs(iframe.analysis.height - expectedPixels) / expectedPixels < 0.03, true,
      `Stitched height ${iframe.analysis.height} did not match the expanded page ${Math.round(expectedPixels)} (${iframe.expected} CSS px).`);
    assert.equal(iframe.colors.counts.windowDeep > 50, true,
      `Window-scrolled embedded content is missing from the result (${iframe.colors.counts.windowDeep} samples).`);
    assert.equal(iframe.colors.counts.shellDeep > 50, true,
      `App-shell embedded content is missing from the result (${iframe.colors.counts.shellDeep} samples).`);
    assert.equal(iframe.analysis.bottomDarkPixels > 0, true,
      "The top page bottom marker is missing from the iframe-page result.");
    assert.equal(iframe.restored.windowClient, iframe.measurements.wClient,
      `Window iframe element was not restored (${iframe.restored.windowClient}px, expected ${iframe.measurements.wClient}px).`);
    assert.equal(iframe.restored.shellClient, iframe.measurements.sClient,
      `Shell iframe element was not restored (${iframe.restored.shellClient}px, expected ${iframe.measurements.sClient}px).`);
    assert.equal(iframe.restored.windowInlineHeight, "", "Window iframe left an inline height behind.");
    assert.equal(iframe.restored.shellInlineHeight, "", "Shell iframe left an inline height behind.");
    assert.equal(iframe.restored.shellScrollerInlineHeight, "", "App-shell inner scroller left an inline height behind.");
    assert.equal(iframe.restored.shellHtmlInlineHeight, "", "App-shell inner html left an inline height behind.");
    assert.equal(iframe.restored.windowScroll, 0, "Window-scrolled inner document was not restored to the top.");
    assert.equal(iframe.restored.shellScroll, 0, "App-shell inner scroller was not restored to the top.");
    assert.equal(iframe.restored.scrollY, 0, "Top page scroll was not restored.");
    report("Iframe traversal full-page capture",
      `${iframe.frames.length} frames, ${iframe.analysis.width}×${iframe.analysis.height}px, expected ${Math.round(expectedPixels)}px, both embedded documents restored`);

    const selected = await runRegionMode("selected-area");
    assert.equal(selected.restored.position, selected.initial.scroll);
    assert.equal(selected.restored.history.length > 3, true);
    assert.equal(selected.frames.at(-1).cropRectCss.left, selected.frames[0].cropRectCss.left);
    assert.equal(selected.frames.at(-1).cropRectCss.width, selected.frames[0].cropRectCss.width);
    assert.equal(selected.frames.slice(0, -1).every((frame) => frame.cropRectCss.top === selected.frames[0].cropRectCss.top), true);
    assert.equal(selected.frames.at(-1).cropRectCss.top > selected.frames[0].cropRectCss.top, true);
    assert.equal(selected.analysis.captureMode, "selected-area");
    assert.equal(selected.analysis.greenPixels > 100, true, "Selected result is missing the green bottom marker.");
    assert.equal(selected.analysis.redPixels < 50, true,
      `Selected result contains a material amount of excluded red side content (${selected.analysis.redPixels} samples).`);
    report("Selected Area browser fixture capture", `${selected.frames.length} frames, ${selected.analysis.width}×${selected.analysis.height}, restored to ${selected.restored.position}px`);

    const scrollable = await runRegionMode("scrollable-area");
    assert.equal(scrollable.restored.position, scrollable.initial.scroll);
    assert.deepEqual(scrollable.restored.labels, Array.from({ length: 24 }, (_, index) => `Message ${String(index + 1).padStart(2, "0")}`));
    assert.equal(scrollable.analysis.captureMode, "scrollable-area");
    assert.equal(scrollable.analysis.greenPixels > 100, true, "Scrollable result is missing the green bottom marker.");
    assert.equal(scrollable.analysis.redPixels < 50, true,
      `Scrollable result contains a material amount of excluded red page content (${scrollable.analysis.redPixels} samples).`);
    assert.equal(scrollable.analysis.rowRuns >= 20, true, `Only ${scrollable.analysis.rowRuns} numbered row bands were detected.`);
    report("Scrollable Area browser fixture regression", `${scrollable.frames.length} frames, ${scrollable.analysis.rowRuns} row bands, restored to ${scrollable.restored.position}px`);

    const full = await runFullPage();
    assert.equal(full.restored.history.length > 3, true);
    report("Full Page browser fixture regression", `${full.analysis.width}×${full.analysis.height}, restored to ${full.restored.position}px`);

    const screenshot = await runNormalScreenshot();
    assert.equal(screenshot.captureCount, 1, "Screenshot captured more than one viewport.");
    report("Screenshot browser fixture capture",
      `${screenshot.analysis.width}×${screenshot.analysis.height} (viewport ${screenshot.viewport.width}×${screenshot.viewport.height}), 1 viewport, no page scripting`);

    const selectedScreenshot = await runNormalScreenshot({ selectArea: true });
    assert.equal(selectedScreenshot.captureCount, 1, "Selected Screenshot captured more than one viewport.");
    report("Selected Screenshot browser fixture capture",
      `${selectedScreenshot.analysis.width}×${selectedScreenshot.analysis.height}, 1 cropped viewport, scroll unchanged at ${selectedScreenshot.finalScrollY}px`);
  } catch (error) {
    console.error(`STAGE3 BROWSER INTEGRATION ERROR ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({
  analyzeIframeColors,
  analyzePdfResult,
  analyzeResult,
  fixtureBase,
  report,
  runFullPage,
  runIframeFullPage,
  runNormalScreenshot,
  runRegionMode,
});

if (require.main === module) main();
