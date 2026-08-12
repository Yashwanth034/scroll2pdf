#!/usr/bin/env node

"use strict";

// Regression test: a chat whose sticky channel header and enter-chat composer
// are re-created on every scroll (React/SPA style, no stable attributes) must
// not repeat in the stitched capture. The header must appear exactly once at
// the top and the composer exactly once at the true bottom.
//
// Run with: S2P_ATTACH_PORT=<port> node tests/run-chrome-dedup-browser-test.js

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const projectRoot = __dirname.replace(/\/tests$/, "");
const port = Number(process.env.S2P_ATTACH_PORT || 9444);
const cdpBase = `http://127.0.0.1:${port}`;
const fixtureBase = process.env.S2P_FIXTURE_BASE || "http://127.0.0.1:8765/tests/fixtures";
// Tolerances are wide because real displays apply color management to
// captureVisibleTab screenshots (e.g. red 43 -> 69 on some GPUs).
const CHROME_COLOR = { r: 23, g: 69, b: 122, tolerance: 45 }; // #17457a in the fixture
const NEWS_BAR = { r: 27, g: 110, b: 245, tolerance: 45 }; // #1b6ef5 in news-scroller-chat.html
let commandId = 0;
const read = (file) => fs.readFileSync(path.join(projectRoot, file), "utf8");
async function getJson(endpoint, method = "GET") {
  const response = await fetch(`${cdpBase}${endpoint}`, { method });
  if (!response.ok) throw new Error(`${method} ${endpoint} ${response.status}`);
  return response.json();
}
async function waitFor(check, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const value = await check(); if (value) return value; } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
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
function send(socket, method, params = {}, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const id = ++commandId;
    const timer = setTimeout(() => reject(new Error(`No CDP reply for ${method}`)), timeoutMs);
    socket.pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(socket, expression, timeoutMs = 60000) {
  const result = await send(socket, "Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function createPage(url) {
  const target = await getJson(`/json/new?${encodeURIComponent(url)}`, "PUT");
  const socket = await connect(target);
  await send(socket, "Runtime.enable");
  await send(socket, "Page.enable");
  await send(socket, "Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await waitFor(() => evaluate(socket, "document.readyState === 'complete' && !!document.body"), 30000, url);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return { target, socket };
}
async function closePage(page) {
  page.socket.close();
  await fetch(`${cdpBase}/json/close/${page.target.id}`).catch(() => {});
}
function clickOn(socket, x, y) {
  return send(socket, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y })
    .then(() => send(socket, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 }))
    .then(() => send(socket, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 }));
}

// Drags a selection rectangle over the whole viewport (Selected Area mode).
async function dragSelection(page, from, to) {
  const socket = page.socket;
  await send(socket, "Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
  await send(socket, "Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1 });
  await send(socket, "Input.dispatchMouseEvent", { type: "mouseMoved", x: to.x, y: to.y, button: "left", buttons: 1 });
  await send(socket, "Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", buttons: 0, clickCount: 1 });
}

async function captureSelectedArea(fixture) {
  const url = `${fixtureBase}/${fixture}`;
  const page = await createPage(url);
  const offscreen = await createPage(`${fixtureBase}/short-page.html`);
  const frames = [];
  const hiddenCounts = [];
  let openedResult = "";
  try {
    await evaluate(page.socket, [
      "utils/constants.js", "utils/capture-utils.js", "utils/difficult-page-utils.js",
      "content/capture-stability.js", "content/iframe-expansion.js", "content/page-capture.js",
      "content/selection-overlay.js", "content/adapters/generic-chat-adapter.js",
      "content/adapters/whatsapp-adapter.js", "content/adapters/telegram-adapter.js",
      "content/adapters/adapter-registry.js", "content/difficult-page-capture.js",
      "content/scrollable-selection.js", "content/selected-area.js",
    ].map(read).join("\n") + "\ntrue", 30000);
    await evaluate(offscreen.socket, [
      "utils/constants.js", "utils/capture-utils.js", "utils/difficult-page-utils.js",
      "utils/pdf-utils.js", "offscreen/frame-analysis.js", "offscreen/seam-planner.js",
      "offscreen/pdf-writer.js",
    ].map(read).join("\n") + `
      globalThis.chrome = { runtime: { onMessage: { addListener() {} } } };
      globalThis.__scroll2pdfResults = new Map();
      globalThis.__scroll2pdfSavedRecord = null;
      globalThis.Scroll2PDFResultStore = {
        async saveResult(record) { globalThis.__scroll2pdfSavedRecord = record; globalThis.__scroll2pdfResults.set(record.resultId, record); },
        async getResult(resultId) { return globalThis.__scroll2pdfResults.get(resultId); },
        async deleteResult(resultId) { globalThis.__scroll2pdfResults.delete(resultId); }
      };
      ${read("offscreen/pdf-generator.js")}
      ${read("offscreen/offscreen.js")}
      true`, 30000);
    await send(page.socket, "Page.bringToFront");
    const deps = {
      getActiveTab: async () => ({ id: 1, windowId: 1, url }),
      ensureOffscreen: async () => {}, closeOffscreen: async () => {},
      assertTargetActive: async () => {}, delay: async () => {}, broadcast: async () => {},
      openResult: async (resultId) => { openedResult = resultId; },
      createId: () => `chrome-dedup-sel-${fixture}`,
      captureVisibleTab: async () => {
        const shot = await send(page.socket, "Page.captureScreenshot", { format: "png", fromSurface: true });
        return `data:image/png;base64,${shot.data}`;
      },
      sendOffscreen: async (message) => {
        if (message.type === "OFFSCREEN_ADD_CAPTURE") frames.push(JSON.parse(JSON.stringify(message.payload.frame)));
        return evaluate(offscreen.socket, `Scroll2PDFOffscreen.routeMessage(${JSON.stringify(message)})`, 120000);
      },
      cancelOperation: async (operation) => {
        await Promise.allSettled([
          evaluate(offscreen.socket, `Scroll2PDFOffscreen.routeMessage(${JSON.stringify({ type: "OFFSCREEN_CANCEL_CAPTURE", target: "offscreen", payload: { captureId: operation.captureId } })})`),
          evaluate(page.socket, `Scroll2PDFSelectedArea.cancelSelection(${JSON.stringify(operation.captureId)})`),
        ]);
      },
      sendTabMessage: async (tabId, message) => {
        const payload = message.payload || {};
        if (message.type === "START_REGION_SELECTION") {
          const pending = evaluate(page.socket, `Scroll2PDFSelectedArea.startSelection(${JSON.stringify(payload.captureId)})`, 30000);
          await waitFor(() => evaluate(page.socket, "Boolean(document.getElementById('scroll2pdf-selection-host'))"), 5000, "overlay");
          await dragSelection(page, { x: 100, y: 0 }, { x: 1180, y: 900 });
          return pending;
        }
        const api = "Scroll2PDFSelectedArea";
        let expression;
        if (message.type === "PREPARE_REGION_CAPTURE") expression = `${api}.prepareCapture(${JSON.stringify(payload.captureId)})`;
        else if (message.type === "GET_REGION_METRICS") expression = `({ok:true, metrics:${api}.getMetrics(${JSON.stringify(payload.captureId)})})`;
        else if (message.type === "SCROLL_REGION_TO_POSITION") expression = `${api}.scrollToPosition(${JSON.stringify(payload.captureId)}, ${Number(payload.position)})`;
        else if (message.type === "SET_REGION_OVERLAYS_HIDDEN") {
          const result = await evaluate(page.socket, `${api}.hideRepeatedOverlays(${JSON.stringify(payload.captureId)})`, 60000);
          hiddenCounts.push(result.hiddenCount || 0);
          return result;
        } else if (message.type === "RESTORE_REGION_CAPTURE") {
          return evaluate(page.socket, `${api}.restoreCapture(${JSON.stringify(payload.captureId)})`, 60000);
        }
        if (expression) return evaluate(page.socket, expression, 60000);
        throw new Error(`Unexpected page message ${message.type}`);
      },
    };
    const sandbox = { globalThis: null, URL, setTimeout, clearTimeout, console };
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);
    for (const file of ["utils/constants.js", "utils/capture-utils.js", "utils/difficult-page-utils.js", "utils/pdf-utils.js",
      "background/pdf-output.js", "background/dynamic-region-capture.js", "background/region-capture.js", "background/full-page-capture.js"]) {
      new vm.Script(read(file), { filename: file }).runInContext(context);
    }
    const manager = sandbox.Scroll2PDFFullPageCapture.createCaptureManager(deps);
    const started = await manager.startCapture({ captureMode: "selected-area", outputType: "long-image", quality: "high", orientation: "portrait" });
    const completion = await started.completion;
    const analysis = await evaluate(offscreen.socket, `(async () => {
      const record = globalThis.__scroll2pdfSavedRecord;
      if (!record?.blob) return null;
      const image = new Image();
      const url = URL.createObjectURL(record.blob);
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const chromeRuns = [];
      let start = -1, prev = -2;
      const x = Math.round(canvas.width / 2);
      const matches = (y) => {
        const i = ((y * canvas.width) + x) * 4;
        // news-tab green #2b9a5f (tolerance wide for display color management)
        return Math.abs(data[i] - 43) < 45 && Math.abs(data[i + 1] - 154) < 45 && Math.abs(data[i + 2] - 95) < 45;
      };
      for (let y = 0; y < canvas.height; y += 1) {
        if (matches(y) && y === prev + 1) { prev = y; continue; }
        if (matches(y)) { if (start >= 0) chromeRuns.push([start, prev]); start = y; prev = y; }
        else if (start >= 0) { chromeRuns.push([start, prev]); start = -1; }
      }
      if (start >= 0) chromeRuns.push([start, prev]);
      return { width: canvas.width, height: canvas.height, chromeRuns };
    })()`);
    return { ok: completion.ok, error: completion.error, frames, hiddenCounts, openedResult, analysis };
  } finally {
    await closePage(page);
    await closePage(offscreen);
  }
}

async function captureScrollableArea(fixture, prescroll, chromeColor = CHROME_COLOR) {
  const url = `${fixtureBase}/${fixture}`;
  const page = await createPage(url);
  const offscreen = await createPage(`${fixtureBase}/short-page.html`);
  const frames = [];
  const hiddenCounts = [];
  let openedResult = "";
  try {
    await evaluate(page.socket, [
      "utils/constants.js", "utils/capture-utils.js", "utils/difficult-page-utils.js",
      "content/capture-stability.js", "content/iframe-expansion.js", "content/page-capture.js",
      "content/selection-overlay.js", "content/adapters/generic-chat-adapter.js",
      "content/adapters/whatsapp-adapter.js", "content/adapters/telegram-adapter.js",
      "content/adapters/adapter-registry.js", "content/difficult-page-capture.js",
      "content/scrollable-selection.js", "content/selected-area.js",
    ].map(read).join("\n") + "\ntrue", 30000);
    await evaluate(offscreen.socket, [
      "utils/constants.js", "utils/capture-utils.js", "utils/difficult-page-utils.js",
      "utils/pdf-utils.js", "offscreen/frame-analysis.js", "offscreen/seam-planner.js",
      "offscreen/pdf-writer.js",
    ].map(read).join("\n") + `
      globalThis.chrome = { runtime: { onMessage: { addListener() {} } } };
      globalThis.__scroll2pdfResults = new Map();
      globalThis.__scroll2pdfSavedRecord = null;
      globalThis.Scroll2PDFResultStore = {
        async saveResult(record) { globalThis.__scroll2pdfSavedRecord = record; globalThis.__scroll2pdfResults.set(record.resultId, record); },
        async getResult(resultId) { return globalThis.__scroll2pdfResults.get(resultId); },
        async deleteResult(resultId) { globalThis.__scroll2pdfResults.delete(resultId); }
      };
      ${read("offscreen/pdf-generator.js")}
      ${read("offscreen/offscreen.js")}
      true`, 30000);

    const initial = await evaluate(page.socket, `(() => {
      const scroller = document.getElementById("chat-scroll");
      scroller.scrollTop = ${prescroll};
      window.__scrollSeq = [scroller.scrollTop];
      scroller.addEventListener("scroll", () => window.__scrollSeq.push(scroller.scrollTop));
      const rect = scroller.getBoundingClientRect();
      return { rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } };
    })()`);
    await send(page.socket, "Page.bringToFront");

    const deps = {
      getActiveTab: async () => ({ id: 1, windowId: 1, url }),
      ensureOffscreen: async () => {}, closeOffscreen: async () => {},
      assertTargetActive: async () => {}, delay: async () => {}, broadcast: async () => {},
      openResult: async (resultId) => { openedResult = resultId; },
      createId: () => `chrome-dedup-${fixture}`,
      captureVisibleTab: async () => {
        const shot = await send(page.socket, "Page.captureScreenshot", { format: "png", fromSurface: true });
        return `data:image/png;base64,${shot.data}`;
      },
      sendOffscreen: async (message) => {
        if (message.type === "OFFSCREEN_ADD_CAPTURE") frames.push(JSON.parse(JSON.stringify(message.payload.frame)));
        return evaluate(offscreen.socket, `Scroll2PDFOffscreen.routeMessage(${JSON.stringify(message)})`, 120000);
      },
      cancelOperation: async (operation) => {
        await Promise.allSettled([
          evaluate(offscreen.socket, `Scroll2PDFOffscreen.routeMessage(${JSON.stringify({ type: "OFFSCREEN_CANCEL_CAPTURE", target: "offscreen", payload: { captureId: operation.captureId } })})`),
          evaluate(page.socket, `Scroll2PDFScrollableSelection.cancelSelection(${JSON.stringify(operation.captureId)})`),
        ]);
      },
      sendTabMessage: async (tabId, message) => {
        const payload = message.payload || {};
        if (message.type === "START_REGION_SELECTION") {
          const pending = evaluate(page.socket, `Scroll2PDFScrollableSelection.startSelection(${JSON.stringify(payload.captureId)})`, 30000);
          await waitFor(() => evaluate(page.socket, "Boolean(document.getElementById('scroll2pdf-selection-host'))"), 5000, "overlay");
          const rect = initial.rect;
          await clickOn(page.socket, rect.left + rect.width / 2, rect.top + rect.height / 2);
          return pending;
        }
        const api = "Scroll2PDFScrollableSelection";
        let expression;
        if (message.type === "PREPARE_REGION_CAPTURE") expression = `${api}.prepareCapture(${JSON.stringify(payload.captureId)})`;
        else if (message.type === "GET_REGION_METRICS") expression = `({ok:true, metrics:${api}.getMetrics(${JSON.stringify(payload.captureId)})})`;
        else if (message.type === "SCROLL_REGION_TO_POSITION") expression = `${api}.scrollToPosition(${JSON.stringify(payload.captureId)}, ${Number(payload.position)})`;
        else if (message.type === "SET_REGION_OVERLAYS_HIDDEN") {
          const result = await evaluate(page.socket, `${api}.hideRepeatedOverlays(${JSON.stringify(payload.captureId)})`, 60000);
          hiddenCounts.push(result.hiddenCount || 0);
          return result;
        } else if (message.type === "RESTORE_REGION_BOTTOM_CHROME") {
          return evaluate(page.socket, `${api}.restoreBottomChrome(${JSON.stringify(payload.captureId)})`, 60000);
        } else if (message.type === "RESTORE_REGION_CAPTURE") {
          return evaluate(page.socket, `${api}.restoreCapture(${JSON.stringify(payload.captureId)})`, 60000);
        } else if (message.type === "ADVANCE_DIFFICULT_CAPTURE" || message.type === "RECOVER_DIFFICULT_CAPTURE") {
          return evaluate(page.socket, `${api}.advanceDifficultCapture(${JSON.stringify(payload.captureId)}, ${message.type === "RECOVER_DIFFICULT_CAPTURE"})`, 60000);
        } else if (message.type === "LOAD_OLDER_HISTORY") {
          return evaluate(page.socket, `${api}.loadOlderHistory(${JSON.stringify(payload.captureId)})`, 60000);
        }
        if (expression) return evaluate(page.socket, expression, 60000);
        throw new Error(`Unexpected page message ${message.type}`);
      },
    };
    const sandbox = { globalThis: null, URL, setTimeout, clearTimeout, console };
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);
    for (const file of ["utils/constants.js", "utils/capture-utils.js", "utils/difficult-page-utils.js", "utils/pdf-utils.js",
      "background/pdf-output.js", "background/dynamic-region-capture.js", "background/region-capture.js", "background/full-page-capture.js"]) {
      new vm.Script(read(file), { filename: file }).runInContext(context);
    }
    const manager = sandbox.Scroll2PDFFullPageCapture.createCaptureManager(deps);
    const started = await manager.startCapture({ captureMode: "scrollable-area", outputType: "long-image", quality: "high", orientation: "portrait" });
    const completion = await started.completion;
    const seq = await evaluate(page.socket, `({ seq: window.__scrollSeq, restored: document.getElementById("chat-scroll").scrollTop })`);
    const analysis = await evaluate(offscreen.socket, `(async () => {
      const record = globalThis.__scroll2pdfSavedRecord;
      if (!record?.blob) return null;
      const image = new Image();
      const url = URL.createObjectURL(record.blob);
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const chromeRuns = [];
      let start = -1, prev = -2;
      const x = Math.round(canvas.width / 2);
      const matches = (y) => {
        const i = ((y * canvas.width) + x) * 4;
        return Math.abs(data[i] - ${chromeColor.r}) < ${chromeColor.tolerance}
          && Math.abs(data[i + 1] - ${chromeColor.g}) < ${chromeColor.tolerance}
          && Math.abs(data[i + 2] - ${chromeColor.b}) < ${chromeColor.tolerance};
      };
      for (let y = 0; y < canvas.height; y += 1) {
        if (matches(y) && y === prev + 1) { prev = y; continue; }
        if (matches(y)) { if (start >= 0) chromeRuns.push([start, prev]); start = y; prev = y; }
        else if (start >= 0) { chromeRuns.push([start, prev]); start = -1; }
      }
      if (start >= 0) chromeRuns.push([start, prev]);
      return { width: canvas.width, height: canvas.height, chromeRuns };
    })()`);
    return {
      ok: completion.ok, error: completion.error, frames, hiddenCounts, openedResult,
      seq, restored: seq.restored, analysis, exceptions: page.socket.exceptions,
    };
  } finally {
    await closePage(page);
    await closePage(offscreen);
  }
}

function report(label, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  try {
    const result = await captureScrollableArea("react-recreate-chat.html", 1200);
    assert.equal(result.ok, true, result.error);
    assert.ok(result.frames.length > 3, "capture did not traverse multiple viewports");
    assert.ok(result.hiddenCounts.length >= 3, "overlay hiding did not run across frames");
    assert.ok(result.hiddenCounts.every((count) => count >= 1),
      `chrome was not hidden every frame: ${result.hiddenCounts.join(",")}`);
    assert.ok(result.analysis, "no stitched result to analyze");
    const runs = result.analysis.chromeRuns || [];
    assert.ok(runs.length >= 1, "the header band is missing entirely");
    const [firstStart, firstEnd] = runs[0];
    assert.ok(firstStart < 10 && firstEnd <= 60,
      `header did not appear once at the very top: first run ${firstStart}-${firstEnd}`);
    // Group runs separated by small gaps (the composer's inner elements split
    // its band into fragments) into top / bottom groups.
    const groups = [];
    for (const [start, end] of runs) {
      const last = groups[groups.length - 1];
      if (last && start - last.end <= 100) last.end = Math.max(last.end, end);
      else groups.push({ start, end });
    }
    assert.equal(groups.length, 2,
      `chrome must appear only at the top and bottom: ${JSON.stringify(groups)}`);
    const top = groups[0];
    const bottom = groups[1];
    assert.ok(top.start < 10 && top.end <= 60,
      `header band is not at the very top: ${top.start}-${top.end}`);
    assert.ok(bottom.start >= result.analysis.height - 80 && bottom.end >= result.analysis.height - 60,
      `composer band is not at the true bottom: ${bottom.start}-${bottom.end} of ${result.analysis.height}`);
    report("Sticky chrome appears once (header top, composer bottom) with per-scroll node re-creation",
      true, `${result.frames.length} frames, ${result.analysis.width}×${result.analysis.height}, hidden ${result.hiddenCounts.join(",")}`);

    // Selected Area on a window-scrolling news app: the sticky World News tab
    // and the sticky Broadcast enter-chat bar must each appear only once.
    const news = await captureSelectedArea("news-app-chat.html");
    assert.equal(news.ok, true, news.error);
    assert.ok(news.frames.length > 3, "news capture did not traverse multiple viewports");
    assert.ok(news.hiddenCounts.length >= 2, "selected-area overlay hiding did not run");
    const newsRuns = (news.analysis?.chromeRuns || []).map(([a, b]) => [a, b]);
    const newsGroups = [];
    for (const [start, end] of newsRuns) {
      const last = newsGroups[newsGroups.length - 1];
      if (last && start - last.end <= 100) last.end = Math.max(last.end, end);
      else newsGroups.push({ start, end });
    }
    assert.equal(newsGroups.length, 1,
      `news tab must appear exactly once at the top: ${JSON.stringify(newsRuns)}`);
    const newsTop = newsGroups[0];
    assert.ok(newsTop.start < 10 && newsTop.end <= 60,
      `news tab not at the very top: ${newsTop.start}-${newsTop.end}`);
    report("Selected Area dedup on window-scrolling news app (sticky World News tab + Broadcast bar)",
      true, `${news.frames.length} frames, ${news.analysis.width}×${news.analysis.height}, hidden ${news.hiddenCounts.join(",")}`);

    // Scrollable Area on a chat app whose sticky channel header and enter-chat
    // composer sit INSIDE the scroller with side gutters (not full-bleed) and a
    // live-updating header clock — the exact layout that used to repeat both
    // bars in every frame. Each bar must appear exactly once (top / bottom).
    for (const [name, prescroll] of [["plain downward", 0], ["difficult upward", 13100]]) {
      const scroller = await captureScrollableArea("news-scroller-chat.html", prescroll, NEWS_BAR);
      assert.equal(scroller.ok, true, scroller.error);
      assert.ok(scroller.frames.length > 3, `${name}: capture did not traverse multiple viewports`);
      assert.ok(scroller.analysis, `${name}: no stitched result to analyze`);
      const scrollerRuns = scroller.analysis.chromeRuns || [];
      const scrollerGroups = [];
      for (const [start, end] of scrollerRuns) {
        const last = scrollerGroups[scrollerGroups.length - 1];
        if (last && start - last.end <= 100) last.end = Math.max(last.end, end);
        else scrollerGroups.push({ start, end });
      }
      assert.equal(scrollerGroups.length, 2,
        `${name}: chrome must appear only at the top and bottom: ${JSON.stringify(scrollerRuns)}`);
      const scrollerTop = scrollerGroups[0];
      const scrollerBottom = scrollerGroups[1];
      assert.ok(scrollerTop.start < 10 && scrollerTop.end <= 70,
        `${name}: header band not at the very top: ${scrollerTop.start}-${scrollerTop.end}`);
      assert.ok(scrollerBottom.start >= scroller.analysis.height - 100,
        `${name}: composer band not at the true bottom: ${scrollerBottom.start}-${scrollerBottom.end} of ${scroller.analysis.height}`);
      report(`Scrollable Area dedup (${name}) — guttered sticky header + composer with live clock, inside the scroller`,
        true, `${scroller.frames.length} frames, ${scroller.analysis.width}×${scroller.analysis.height}, bands ${JSON.stringify(scrollerRuns)}`);
    }

    const buried = await captureScrollableArea("news-scroller-chat.html?buried=1&inset=1", 0, NEWS_BAR);
    assert.equal(buried.ok, true, buried.error);
    assert.ok(buried.frames.length > 3, "buried DOM capture did not traverse multiple viewports");
    assert.ok(buried.hiddenCounts.some((count) => count >= 1),
      `buried inset chrome was never hidden: ${buried.hiddenCounts.join(",")}`);
    const buriedRuns = buried.analysis?.chromeRuns || [];
    const buriedGroups = [];
    for (const [start, end] of buriedRuns) {
      const last = buriedGroups[buriedGroups.length - 1];
      if (last && start - last.end <= 100) last.end = Math.max(last.end, end);
      else buriedGroups.push({ start, end });
    }
    assert.equal(buriedGroups.length, 2,
      `buried inset chrome must appear only at the top and bottom: ${JSON.stringify(buriedRuns)}`);
    assert.ok(buriedGroups[0].start <= 44 && buriedGroups[0].end <= 100,
      `buried inset header is not at the top: ${JSON.stringify(buriedGroups[0])}`);
    assert.ok(buriedGroups[1].start >= buried.analysis.height - 120,
      `buried inset composer is not at the bottom: ${JSON.stringify(buriedGroups[1])}`);
    report("Scrollable Area dedup — Telegram-sized DOM with 36px-inset header and composer",
      true, `${buried.frames.length} frames, hidden ${buried.hiddenCounts.join(",")}`);
  } catch (error) {
    report("Sticky chrome dedup", false, error.stack || error.message);
  }
}

main();
