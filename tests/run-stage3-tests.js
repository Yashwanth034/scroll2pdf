#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const tests = [];

function test(name, run) { tests.push({ name, run }); }
function read(file) { return fs.readFileSync(path.join(projectRoot, file), "utf8"); }

function runScript(file, sandbox = {}) {
  sandbox.globalThis = sandbox;
  sandbox.URL ||= URL;
  sandbox.setTimeout ||= setTimeout;
  sandbox.clearTimeout ||= clearTimeout;
  const context = vm.createContext(sandbox);
  new vm.Script(read(file), { filename: file }).runInContext(context);
  return sandbox;
}

function loadUtils() {
  const sandbox = runScript("utils/constants.js", {});
  runScript("utils/capture-utils.js", sandbox);
  return sandbox.Scroll2PDFCaptureUtils;
}

test("scrollable qualification requires real overflow, visibility, and useful dimensions", () => {
  const utils = loadUtils();
  const valid = {
    scrollHeight: 1800,
    clientHeight: 400,
    clientWidth: 320,
    rect: { left: 20, top: 30, right: 340, bottom: 430, width: 320, height: 400 },
    style: { overflowY: "auto", display: "block", visibility: "visible", opacity: "1" },
    viewportWidth: 1000,
    viewportHeight: 800,
  };

  assert.equal(utils.isVerticallyScrollableCandidate(valid), true);
  assert.equal(utils.isVerticallyScrollableCandidate({ ...valid, scrollHeight: 400 }), false);
  assert.equal(utils.isVerticallyScrollableCandidate({ ...valid, style: { ...valid.style, overflowY: "hidden" } }), false);
  assert.equal(utils.isVerticallyScrollableCandidate({ ...valid, rect: { ...valid.rect, width: 60 } }), false);
  assert.equal(utils.isVerticallyScrollableCandidate({ ...valid, style: { ...valid.style, visibility: "hidden" } }), false);
});

test("candidate viewport check allows rounding tolerance but rejects clipped containers", () => {
  const utils = loadUtils();
  assert.equal(utils.isRectFullyVisible(
    { left: -1, top: 1, right: 1001, bottom: 799, width: 1002, height: 798 },
    1000,
    800,
    2,
  ), true);
  assert.equal(utils.isRectFullyVisible(
    { left: -8, top: 1, right: 992, bottom: 799, width: 1000, height: 798 },
    1000,
    800,
    2,
  ), false);
});

test("selection rectangle normalizes every drag direction and clamps to viewport", () => {
  const utils = loadUtils();
  assert.equal(JSON.stringify(utils.normalizeSelectionRect(
    { x: 700, y: 600 },
    { x: 100, y: 150 },
    { width: 800, height: 700 },
  )), JSON.stringify({ left: 100, top: 150, right: 700, bottom: 600, width: 600, height: 450 }));
  assert.equal(JSON.stringify(utils.normalizeSelectionRect(
    { x: -20, y: 760 },
    { x: 850, y: -10 },
    { width: 800, height: 700 },
  )), JSON.stringify({ left: 0, top: 0, right: 800, bottom: 700, width: 800, height: 700 }));
});

test("selected regions require at least 80 CSS pixels in both dimensions", () => {
  const utils = loadUtils();
  assert.equal(utils.isSelectionLargeEnough({ width: 80, height: 80 }), true);
  assert.equal(utils.isSelectionLargeEnough({ width: 79.9, height: 200 }), false);
  assert.equal(utils.isSelectionLargeEnough({ width: 200, height: 50 }), false);
});

test("CSS crop conversion uses independent scales and clamps bitmap bounds", () => {
  const utils = loadUtils();
  assert.equal(JSON.stringify(utils.convertCssRectToBitmapCrop({
    rect: { left: 100.2, top: 50.4, right: 700.6, bottom: 450.1, width: 600.4, height: 399.7 },
    viewportCssWidth: 1000,
    viewportCssHeight: 800,
    bitmapWidth: 1500,
    bitmapHeight: 1600,
  })), JSON.stringify({ x: 150, y: 100, width: 901, height: 801, right: 1051, bottom: 901, scaleX: 1.5, scaleY: 2 }));

  assert.equal(JSON.stringify(utils.convertCssRectToBitmapCrop({
    rect: { left: -10, top: -20, right: 1100, bottom: 900, width: 1110, height: 920 },
    viewportCssWidth: 1000,
    viewportCssHeight: 800,
    bitmapWidth: 1500,
    bitmapHeight: 1600,
  })), JSON.stringify({ x: 0, y: 0, width: 1500, height: 1600, right: 1500, bottom: 1600, scaleX: 1.5, scaleY: 2 }));
});

test("container positions end with the browser-clamped overlapping viewport", () => {
  const utils = loadUtils();
  assert.deepEqual(Array.from(utils.buildRegionScrollPositions(2200, 600, 0)), [0, 600, 1200, 1600]);
  assert.deepEqual(Array.from(utils.buildRegionScrollPositions(500, 600, 0)), [0]);
  assert.equal(utils.getNextRegionScrollPosition(1200, 2200, 600), 1600);
  assert.equal(utils.getNextRegionScrollPosition(1600, 2200, 600), null);
  assert.equal(utils.getNextRegionScrollPosition(649.2, 1250, 600), null);
});

test("fractional clamped bottom extends the final draw to the exact output edge", () => {
  const utils = loadUtils();
  assert.equal(JSON.stringify(utils.calculateFrameDrawPlan({
    actualY: 649.2,
    viewportCssHeight: 600,
    bitmapHeight: 600,
    totalHeightCss: 1250,
    coveredBottomCss: 1200,
    scaleY: 1,
    finalBitmapHeight: 1250,
  })), JSON.stringify({
    sourceY: 551,
    sourceHeight: 49,
    destinationY: 1200,
    destinationHeight: 50,
    nextCoveredBottomCss: 1250,
  }));
});

test("selected-area positions start at current page position and step by selection height", () => {
  const utils = loadUtils();
  assert.deepEqual(Array.from(utils.buildSelectedAreaPagePositions({
    startPageY: 900,
    totalHeight: 3500,
    viewportHeight: 800,
    selectionHeight: 300,
  })), [900, 1200, 1500, 1800, 2100, 2400, 2700]);
});

test("only the final selected-area crop shifts minimally to reach document bottom", () => {
  const utils = loadUtils();
  const rect = { left: 120, top: 100, right: 720, bottom: 400, width: 600, height: 300 };
  assert.equal(JSON.stringify(utils.calculateSelectedAreaCrop({
    originalRect: rect,
    actualPageY: 2400,
    totalHeight: 3500,
    viewportHeight: 800,
    finalFrame: false,
  })), JSON.stringify({ ...rect, shifted: false, shiftY: 0 }));
  assert.equal(JSON.stringify(utils.calculateSelectedAreaCrop({
    originalRect: rect,
    actualPageY: 2700,
    totalHeight: 3500,
    viewportHeight: 800,
    finalFrame: true,
  })), JSON.stringify({ left: 120, top: 500, right: 720, bottom: 800, width: 600, height: 300, shifted: true, shiftY: 400 }));
});

test("selected-area final shift reports unreachable bottoms instead of leaving gaps", () => {
  const utils = loadUtils();
  assert.throws(() => utils.calculateSelectedAreaCrop({
    originalRect: { left: 10, top: 50, right: 210, bottom: 250, width: 200, height: 200 },
    actualPageY: 2000,
    totalHeight: 3000,
    viewportHeight: 700,
    finalFrame: true,
  }), /reach the page bottom/i);
});

test("selected-area capture accepts clamped page scroll, shifts only the final crop, and restores", async () => {
  const sandbox = runScript("utils/constants.js", {});
  runScript("utils/capture-utils.js", sandbox);

  const listeners = {};
  const styleValues = new Map();
  function makeStyle() {
    const values = new Map();
    styleValues.set(values, values);
    return {
      getPropertyValue(name) { return values.get(name)?.value || ""; },
      getPropertyPriority(name) { return values.get(name)?.priority || ""; },
      setProperty(name, value, priority = "") { values.set(name, { value, priority }); },
      removeProperty(name) { values.delete(name); },
    };
  }
  const rootStyle = makeStyle();
  const bodyStyle = makeStyle();
  const page = {
    totalHeight: 3500,
    viewportWidth: 1000,
    viewportHeight: 800,
    scrollX: 0,
    scrollY: 900,
  };
  const scrollHistory = [];
  const fakeWindow = {
    innerWidth: page.viewportWidth,
    innerHeight: page.viewportHeight,
    scrollX: page.scrollX,
    scrollY: page.scrollY,
    scrollTo({ left, top }) {
      this.scrollX = Number(left) || 0;
      this.scrollY = Math.min(Number(top) || 0, 2699.2);
      page.scrollX = this.scrollX;
      page.scrollY = this.scrollY;
      scrollHistory.push(this.scrollY);
    },
    getComputedStyle() { return { position: "static" }; },
  };
  const fakeDocument = {
    documentElement: { style: rootStyle },
    body: { style: bodyStyle },
    elementsFromPoint() { return [{ tagName: "ARTICLE" }]; },
    querySelectorAll() { return []; },
  };
  sandbox.window = fakeWindow;
  sandbox.document = fakeDocument;
  sandbox.Scroll2PDFPageCapture = {
    getPageMetrics() {
      return {
        totalHeight: page.totalHeight,
        viewportWidth: page.viewportWidth,
        viewportHeight: page.viewportHeight,
        scrollX: page.scrollX,
        scrollY: page.scrollY,
      };
    },
    async settlePage() {},
  };
  sandbox.Scroll2PDFSelectionOverlay = {
    createOneShotOutcome(callback) {
      let settled = false;
      return { settle(value) { if (settled) return false; settled = true; callback(value); return true; } };
    },
    createSelectionOverlay() {
      return {
        host: {},
        surface: { setPointerCapture() {}, releasePointerCapture() {} },
        cleanupBag: { listen(target, type, listener) { listeners[type] = listener; } },
        setRect() {}, clearRect() {}, cleanup() {},
      };
    },
  };
  runScript("content/capture-stability.js", sandbox);
  runScript("content/selected-area.js", sandbox);
  runScript("background/region-capture.js", sandbox);

  const api = sandbox.Scroll2PDFSelectedArea;
  const frames = [];
  let restored = false;
  const operation = {
    captureId: "selected-clamped",
    tabId: 10,
    windowId: 2,
    pageUrl: "https://example.com/",
    configuration: { captureMode: "selected-area", quality: "high", outputType: "long-image" },
    completed: 0,
    cancelRequested: false,
    startedAt: Date.now(),
    async report(update) { Object.assign(this, update); },
  };
  const deps = {
    ensureOffscreen: async () => {}, closeOffscreen: async () => {},
    assertTargetActive: async () => {}, delay: async () => {},
    captureVisibleTab: async () => `data:image/png;base64,${frames.length}`,
    sendTabMessage: async (tabId, message) => {
      const payload = message.payload || {};
      if (message.type === "START_REGION_SELECTION") {
        const selected = api.startSelection(payload.captureId);
        listeners.pointerdown({ button: 0, pointerId: 1, clientX: 120, clientY: 200, preventDefault() {} });
        listeners.pointermove({ pointerId: 1, clientX: 720, clientY: 600 });
        listeners.pointerup({ pointerId: 1, clientX: 720, clientY: 600, preventDefault() {} });
        return selected;
      }
      if (message.type === "PREPARE_REGION_CAPTURE") return api.prepareCapture(payload.captureId);
      if (message.type === "GET_REGION_METRICS") return { ok: true, metrics: api.getMetrics(payload.captureId) };
      if (message.type === "SCROLL_REGION_TO_POSITION") {
        return api.scrollToPosition(payload.captureId, payload.position);
      }
      if (message.type === "SET_REGION_OVERLAYS_HIDDEN") return api.hideRepeatedOverlays(payload.captureId);
      if (message.type === "RESTORE_REGION_CAPTURE") {
        const response = await api.restoreCapture(payload.captureId);
        restored = response.restored;
        return response;
      }
      throw new Error(`Unexpected message ${message.type}`);
    },
    sendOffscreen: async (message) => {
      if (message.type === "OFFSCREEN_ADD_CAPTURE") frames.push(message.payload.frame);
      if (message.type === "OFFSCREEN_STITCH_CAPTURE") {
        let coveredBottomCss = frames[0].contentStartCss;
        for (const frame of frames) {
          const plan = sandbox.Scroll2PDFCaptureUtils.calculateFrameDrawPlan({
            actualY: frame.contentPositionCss,
            viewportCssHeight: frame.contentViewportHeightCss,
            bitmapHeight: frame.contentViewportHeightCss,
            totalHeightCss: page.totalHeight,
            coveredBottomCss,
            contentStartCss: frames[0].contentStartCss,
            scaleY: 1,
            finalBitmapHeight: page.totalHeight - frames[0].contentStartCss,
          });
          coveredBottomCss = plan.nextCoveredBottomCss;
        }
        return { ok: true, result: { resultId: "selected-result", coveredBottomCss } };
      }
      return { ok: true };
    },
  };

  const result = await sandbox.Scroll2PDFRegionCapture.executeRegionCapture(operation, deps);
  assert.equal(result.resultId, "selected-result");
  assert.equal(result.coveredBottomCss, 3500);
  assert.equal(restored, true);
  assert.equal(page.scrollY, 900);
  assert.equal(scrollHistory.filter((position) => position === 2699.2).length >= 2, true);
  const finalFrame = frames.at(-1);
  assert.equal(finalFrame.cropRectCss.left, 120);
  assert.equal(finalFrame.cropRectCss.width, 600);
  assert.equal(finalFrame.cropRectCss.top, 400);
  assert.equal(finalFrame.cropRectCss.bottom, 800);
  assert.equal(frames.slice(0, -1).every((frame) => frame.cropRectCss.top === 200), true);
});

test("selection cleanup removes listeners and settles an outcome only once", () => {
  const sandbox = runScript("utils/constants.js", {});
  runScript("content/selection-overlay.js", sandbox);
  const calls = [];
  const target = {
    addEventListener(type, listener) { calls.push(`add-${type}`); this.listener = listener; },
    removeEventListener(type) { calls.push(`remove-${type}`); },
  };
  const bag = sandbox.Scroll2PDFSelectionOverlay.createCleanupBag();
  bag.listen(target, "keydown", () => {});
  bag.add(() => calls.push("custom"));
  bag.cleanup();
  bag.cleanup();
  assert.deepEqual(calls, ["add-keydown", "remove-keydown", "custom"]);

  const outcomes = [];
  const outcome = sandbox.Scroll2PDFSelectionOverlay.createOneShotOutcome((value) => outcomes.push(value));
  assert.equal(outcome.settle("confirmed"), true);
  assert.equal(outcome.settle("cancelled"), false);
  assert.deepEqual(outcomes, ["confirmed"]);
});

test("screenshot selector returns one viewport crop and cleans up without scrolling", async () => {
  const sandbox = runScript("utils/constants.js", {});
  runScript("utils/capture-utils.js", sandbox);
  const listeners = new Map();
  let cleanupCount = 0;
  let scrollCalls = 0;
  const surface = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    setPointerCapture() {},
    releasePointerCapture() {},
  };
  sandbox.window = {
    innerWidth: 1000,
    innerHeight: 700,
    addEventListener(type, listener) { listeners.set(`window-${type}`, listener); },
    removeEventListener(type) { listeners.delete(`window-${type}`); },
    scrollTo() { scrollCalls += 1; },
  };
  sandbox.Scroll2PDFSelectionOverlay = {
    createSelectionOverlay() {
      return {
        surface,
        cleanupBag: {
          listen(target, type, listener) { target.addEventListener(type, listener); },
        },
        setRect() {},
        clearRect() {},
        cleanup() {
          cleanupCount += 1;
          listeners.clear();
        },
      };
    },
    createOneShotOutcome(callback) {
      let settled = false;
      return {
        settle(value) {
          if (settled) return false;
          settled = true;
          callback(value);
          return true;
        },
      };
    },
  };

  runScript("content/screenshot-selection.js", sandbox);
  const selection = sandbox.Scroll2PDFScreenshotSelection.startSelection("shot-1");
  listeners.get("pointerdown")({ button: 0, pointerId: 4, clientX: 140, clientY: 90, preventDefault() {} });
  listeners.get("pointermove")({ pointerId: 4, clientX: 740, clientY: 490 });
  listeners.get("pointerup")({ pointerId: 4, clientX: 740, clientY: 490, preventDefault() {} });

  assert.equal(JSON.stringify(await selection), JSON.stringify({
    ok: true,
    selection: {
      cropRectCss: { left: 140, top: 90, right: 740, bottom: 490, width: 600, height: 400 },
      viewportCssWidth: 1000,
      viewportCssHeight: 700,
    },
  }));
  assert.equal(cleanupCount, 1);
  assert.equal(scrollCalls, 0);
});

test("screenshot selector retries a small drag and Escape cancels exactly once", async () => {
  const sandbox = runScript("utils/constants.js", {});
  runScript("utils/capture-utils.js", sandbox);
  const listeners = new Map();
  const messages = [];
  let cleanupCount = 0;
  const surface = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    setPointerCapture() {},
    releasePointerCapture() {},
  };
  sandbox.window = {
    innerWidth: 800,
    innerHeight: 600,
    addEventListener(type, listener) { listeners.set(`window-${type}`, listener); },
    removeEventListener(type) { listeners.delete(`window-${type}`); },
  };
  sandbox.Scroll2PDFSelectionOverlay = {
    createSelectionOverlay() {
      return {
        surface,
        cleanupBag: { listen(target, type, listener) { target.addEventListener(type, listener); } },
        setRect() {},
        clearRect(message) { messages.push(message); },
        cleanup() { cleanupCount += 1; },
      };
    },
    createOneShotOutcome(callback) {
      let settled = false;
      return { settle(value) { if (settled) return false; settled = true; callback(value); return true; } };
    },
  };

  runScript("content/screenshot-selection.js", sandbox);
  const selection = sandbox.Scroll2PDFScreenshotSelection.startSelection("shot-2");
  listeners.get("pointerdown")({ button: 0, pointerId: 2, clientX: 10, clientY: 10, preventDefault() {} });
  listeners.get("pointerup")({ pointerId: 2, clientX: 50, clientY: 50, preventDefault() {} });
  assert.match(messages.at(-1), /at least 80 × 80/i);
  listeners.get("window-keydown")({ key: "Escape" });

  assert.equal(JSON.stringify(await selection), JSON.stringify({
    ok: false,
    cancelled: true,
    error: "Capture cancelled",
  }));
  assert.equal(cleanupCount, 1);
  assert.equal((await sandbox.Scroll2PDFScreenshotSelection.cancelSelection("shot-2")).cancelled, false);
});

test("scrollable selector chooses the nearest valid ancestor and rejects roots and frames", () => {
  const sandbox = runScript("utils/constants.js", {});
  runScript("utils/capture-utils.js", sandbox);
  const root = { tagName: "HTML" };
  const frame = { tagName: "IFRAME" };
  const parent = {
    tagName: "DIV",
    scrollHeight: 1200,
    clientHeight: 300,
    clientWidth: 400,
    getBoundingClientRect: () => ({ left: 20, top: 20, right: 420, bottom: 320, width: 400, height: 300 }),
  };
  const child = {
    tagName: "SPAN",
    scrollHeight: 20,
    clientHeight: 20,
    clientWidth: 50,
    getBoundingClientRect: () => ({ left: 30, top: 30, right: 80, bottom: 50, width: 50, height: 20 }),
  };
  sandbox.window = {
    innerWidth: 1000,
    innerHeight: 800,
    getComputedStyle(element) {
      return element === parent
        ? { overflowY: "auto", display: "block", visibility: "visible", opacity: "1" }
        : { overflowY: "visible", display: "block", visibility: "visible", opacity: "1" };
    },
  };
  sandbox.document = { documentElement: root, body: {}, scrollingElement: root };
  runScript("content/scrollable-selection.js", sandbox);
  const api = sandbox.Scroll2PDFScrollableSelection;

  assert.equal(api.findCandidateFromPath([child, parent, root]), parent);
  assert.equal(api.findCandidateFromPath([child, root]), null);
  assert.equal(api.findCandidateFromPath([frame, parent]), null);
});

test("region capture frame uses actual content position and crop metadata", async () => {
  const sandbox = runScript("utils/constants.js", {});
  runScript("utils/capture-utils.js", sandbox);
  runScript("background/region-capture.js", sandbox);
  const queued = [];
  let position = 0;
  const operation = {
    captureId: "region-test",
    tabId: 3,
    windowId: 2,
    pageUrl: "https://example.com/",
    configuration: { captureMode: "scrollable-area", quality: "high", outputType: "long-image" },
    completed: 0,
    cancelRequested: false,
    startedAt: Date.now(),
    async report(update) { Object.assign(this, update); },
  };
  const metrics = () => ({
    contentPositionCss: position,
    contentStartCss: 0,
    totalContentHeightCss: 1000,
    contentViewportHeightCss: 600,
    viewportCssWidth: 1000,
    viewportCssHeight: 800,
    cropRectCss: { left: 100, top: 80, right: 500, bottom: 680, width: 400, height: 600 },
    nextPosition: position === 0 ? 400 : null,
  });
  const deps = {
    ensureOffscreen: async () => {}, closeOffscreen: async () => {},
    assertTargetActive: async () => {}, delay: async () => {},
    captureVisibleTab: async () => "data:image/png;base64,frame",
    sendTabMessage: async (tabId, message) => {
      if (message.type === "START_REGION_SELECTION") return { ok: true, selection: { mode: "scrollable-area" } };
      if (message.type === "SCROLL_REGION_TO_POSITION") position = message.payload.position;
      if (message.type === "RESTORE_REGION_BOTTOM_CHROME") return { ok: true, restored: true };
      if (message.type === "RESTORE_REGION_CAPTURE") return { ok: true, restored: true };
      return { ok: true, metrics: metrics() };
    },
    sendOffscreen: async (message) => {
      if (message.type === "OFFSCREEN_ADD_CAPTURE") queued.push(message.payload.frame);
      if (message.type === "OFFSCREEN_STITCH_CAPTURE") return { ok: true, result: { resultId: "region-result" } };
      return { ok: true };
    },
  };
  const result = await sandbox.Scroll2PDFRegionCapture.executeRegionCapture(operation, deps);
  assert.equal(result.resultId, "region-result");
  assert.deepEqual(queued.map((frame) => frame.contentPositionCss), [0, 400]);
  assert.equal(JSON.stringify(queued[0].cropRectCss), JSON.stringify(metrics().cropRectCss));
});

test("browser-clamped container bottom captures the final frame and stitches without overlap", async () => {
  const sandbox = runScript("utils/constants.js", {});
  runScript("utils/capture-utils.js", sandbox);
  runScript("background/region-capture.js", sandbox);
  const frames = [];
  let position = 0;
  const totalHeight = 1250;
  const clientHeight = 600;
  const metrics = () => ({
    captureMode: "scrollable-area",
    captureModeLabel: "Scrollable Area",
    contentPositionCss: position,
    scrollPositionCss: position,
    contentStartCss: 0,
    totalContentHeightCss: totalHeight,
    contentViewportHeightCss: clientHeight,
    viewportCssWidth: 1000,
    viewportCssHeight: 800,
    cropRectCss: { left: 100, top: 50, right: 500, bottom: 650, width: 400, height: 600 },
    nextPosition: position === 0 ? 600 : position === 600 ? 650 : position === 649.7 ? 700 : null,
  });
  const operation = {
    captureId: "clamped-bottom",
    tabId: 8,
    windowId: 2,
    pageUrl: "https://example.com/",
    configuration: { captureMode: "scrollable-area", quality: "high", outputType: "long-image" },
    completed: 0,
    cancelRequested: false,
    startedAt: Date.now(),
    async report(update) { Object.assign(this, update); },
  };
  const deps = {
    ensureOffscreen: async () => {}, closeOffscreen: async () => {},
    assertTargetActive: async () => {}, delay: async () => {},
    captureVisibleTab: async () => `data:image/png;base64,${position}`,
    sendTabMessage: async (tabId, message) => {
      if (message.type === "START_REGION_SELECTION") return { ok: true, selection: { mode: "scrollable-area" } };
      if (message.type === "SCROLL_REGION_TO_POSITION") {
        if (message.payload.position === 600) position = 600;
        else if (message.payload.position === 650) position = 649.7;
        else if (message.payload.position > 650) position = 650;
      }
      if (message.type === "RESTORE_REGION_CAPTURE") return { ok: true, restored: true };
      return { ok: true, metrics: metrics() };
    },
    sendOffscreen: async (message) => {
      if (message.type === "OFFSCREEN_ADD_CAPTURE") frames.push(message.payload.frame);
      if (message.type === "OFFSCREEN_STITCH_CAPTURE") {
        let coveredBottomCss = 0;
        for (const frame of frames) {
          const plan = sandbox.Scroll2PDFCaptureUtils.calculateFrameDrawPlan({
            actualY: frame.contentPositionCss,
            viewportCssHeight: frame.contentViewportHeightCss,
            bitmapHeight: clientHeight,
            totalHeightCss: totalHeight,
            coveredBottomCss,
            scaleY: 1,
            finalBitmapHeight: totalHeight,
          });
          coveredBottomCss = plan.nextCoveredBottomCss;
        }
        return { ok: true, result: { resultId: "clamped-result", coveredBottomCss } };
      }
      return { ok: true };
    },
  };

  const result = await sandbox.Scroll2PDFRegionCapture.executeRegionCapture(operation, deps);
  assert.equal(result.resultId, "clamped-result");
  assert.deepEqual(frames.map((frame) => frame.contentPositionCss), [0, 600, 649.7, 650]);
  assert.equal(result.coveredBottomCss, 1250);
});

test("container that remains stuck before its content bottom still fails", async () => {
  const sandbox = runScript("utils/constants.js", {});
  runScript("utils/capture-utils.js", sandbox);
  runScript("background/region-capture.js", sandbox);
  const metrics = {
    captureMode: "scrollable-area",
    captureModeLabel: "Scrollable Area",
    contentPositionCss: 0,
    scrollPositionCss: 0,
    contentStartCss: 0,
    totalContentHeightCss: 1250,
    contentViewportHeightCss: 600,
    viewportCssWidth: 1000,
    viewportCssHeight: 800,
    cropRectCss: { left: 100, top: 50, right: 500, bottom: 650, width: 400, height: 600 },
    nextPosition: 600,
  };
  const operation = {
    captureId: "stuck-before-bottom",
    tabId: 9,
    windowId: 2,
    pageUrl: "https://example.com/",
    configuration: { captureMode: "scrollable-area", quality: "high", outputType: "long-image" },
    completed: 0,
    cancelRequested: false,
    startedAt: Date.now(),
    async report(update) { Object.assign(this, update); },
  };
  const deps = {
    ensureOffscreen: async () => {}, closeOffscreen: async () => {},
    assertTargetActive: async () => {}, delay: async () => {},
    captureVisibleTab: async () => "data:image/png;base64,stuck",
    sendTabMessage: async (tabId, message) => {
      if (message.type === "START_REGION_SELECTION") return { ok: true };
      if (message.type === "RESTORE_REGION_CAPTURE") return { ok: true, restored: true };
      return { ok: true, metrics };
    },
    sendOffscreen: async () => ({ ok: true }),
  };

  await assert.rejects(
    sandbox.Scroll2PDFRegionCapture.executeRegionCapture(operation, deps),
    /stopped advancing before its bottom/i,
  );
});

test("selected page that is stuck before effective maximum still fails and restores", async () => {
  const sandbox = runScript("utils/constants.js", {});
  runScript("utils/capture-utils.js", sandbox);
  runScript("background/region-capture.js", sandbox);
  let restored = false;
  const metrics = {
    captureMode: "selected-area",
    captureModeLabel: "Selected Area",
    contentPositionCss: 1100,
    scrollPositionCss: 900,
    contentStartCss: 1100,
    totalContentHeightCss: 3500,
    contentViewportHeightCss: 400,
    viewportCssWidth: 1000,
    viewportCssHeight: 800,
    cropRectCss: { left: 120, top: 200, right: 720, bottom: 600, width: 600, height: 400 },
    nextPosition: 1300,
  };
  const operation = {
    captureId: "selected-stuck",
    tabId: 11,
    windowId: 2,
    pageUrl: "https://example.com/",
    configuration: { captureMode: "selected-area", quality: "high", outputType: "long-image" },
    completed: 0,
    cancelRequested: false,
    startedAt: Date.now(),
    async report(update) { Object.assign(this, update); },
  };
  const deps = {
    ensureOffscreen: async () => {}, closeOffscreen: async () => {},
    assertTargetActive: async () => {}, delay: async () => {},
    captureVisibleTab: async () => "data:image/png;base64,selected-stuck",
    sendTabMessage: async (tabId, message) => {
      if (message.type === "START_REGION_SELECTION") return { ok: true };
      if (message.type === "RESTORE_REGION_CAPTURE") {
        restored = true;
        return { ok: true, restored: true };
      }
      return { ok: true, metrics };
    },
    sendOffscreen: async () => ({ ok: true }),
  };

  await assert.rejects(
    sandbox.Scroll2PDFRegionCapture.executeRegionCapture(operation, deps),
    /stopped advancing before its bottom/i,
  );
  assert.equal(restored, true);
});

test("offscreen stitching crops region frames, rebases output, and removes overlap", async () => {
  const drawCalls = [];
  let savedRecord;
  class FakeImage {
    constructor() { this.naturalWidth = 1500; this.naturalHeight = 1600; }
    set src(value) { this._src = value; if (value) queueMicrotask(() => this.onload()); }
    get src() { return this._src; }
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return {
        fillStyle: "",
        fillRect() {},
        drawImage(...args) { drawCalls.push(args.slice(1)); },
      };
    },
    toBlob(callback, mimeType) { callback(new Blob(["region"], { type: mimeType })); },
  };
  const sandbox = runScript("utils/constants.js", {
    Blob,
    Image: FakeImage,
    crypto: { randomUUID: () => "region-offscreen-result" },
    document: { createElement: () => canvas },
    chrome: { runtime: { onMessage: { addListener() {} } } },
  });
  runScript("utils/capture-utils.js", sandbox);
  sandbox.Scroll2PDFResultStore = { async saveResult(record) { savedRecord = record; } };
  runScript("offscreen/offscreen.js", sandbox);
  const api = sandbox.Scroll2PDFOffscreen;
  api.resetCapture("region-offscreen");
  for (const position of [1000, 1200]) {
    await api.addCaptureFrame({
      captureId: "region-offscreen",
      frame: {
        contentPositionCss: position,
        contentStartCss: 1000,
        contentViewportHeightCss: 300,
        viewportCssWidth: 1000,
        viewportCssHeight: 800,
        cropRectCss: { left: 100, top: 50, right: 500, bottom: 350, width: 400, height: 300 },
        imageDataUrl: `data:image/png;base64,${position}`,
      },
    });
  }
  const stitched = await api.stitchCapture({
    captureId: "region-offscreen",
    contentStartCss: 1000,
    totalHeightCss: 1500,
    quality: "high",
    filename: "region.png",
    captureMode: "selected-area",
    captureModeLabel: "Selected Area",
  });

  assert.equal(stitched.result.width, 600);
  assert.equal(stitched.result.height, 1000);
  assert.deepEqual(drawCalls[0], [150, 100, 600, 600, 0, 0, 600, 600]);
  assert.deepEqual(drawCalls[1], [150, 300, 600, 400, 0, 600, 600, 400]);
  assert.equal(savedRecord.captureMode, "selected-area");
  assert.equal(savedRecord.imageFormat, "PNG");
});

test("offscreen Screenshot preserves a selected CSS crop at device pixel ratio", async () => {
  const drawCalls = [];
  let savedRecord;
  class FakeImage {
    constructor() { this.naturalWidth = 1600; this.naturalHeight = 1200; }
    set src(value) { this._src = value; if (value) queueMicrotask(() => this.onload()); }
    get src() { return this._src; }
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return {
        fillStyle: "",
        fillRect() {},
        drawImage(...args) { drawCalls.push(args.slice(1)); },
      };
    },
    toBlob(callback, mimeType) { callback(new Blob(["screenshot"], { type: mimeType })); },
  };
  const sandbox = runScript("utils/constants.js", {
    Blob,
    Image: FakeImage,
    crypto: { randomUUID: () => "screenshot-crop-result" },
    document: { createElement: () => canvas },
    chrome: { runtime: { onMessage: { addListener() {} } } },
  });
  runScript("utils/capture-utils.js", sandbox);
  sandbox.Scroll2PDFResultStore = { async saveResult(record) { savedRecord = record; } };
  runScript("offscreen/offscreen.js", sandbox);
  const api = sandbox.Scroll2PDFOffscreen;
  api.resetCapture("screenshot-crop");
  await api.addCaptureFrame({
    captureId: "screenshot-crop",
    frame: {
      screenshot: true,
      contentPositionCss: 0,
      viewportCssWidth: 800,
      viewportCssHeight: 600,
      cropRectCss: { left: 100, top: 50, right: 400, bottom: 250, width: 300, height: 200 },
      imageDataUrl: "data:image/png;base64,crop",
    },
  });
  const stitched = await api.stitchCapture({
    captureId: "screenshot-crop",
    screenshot: true,
    quality: "high",
    filename: "screenshot.png",
    captureMode: "normal-screenshot",
    captureModeLabel: "Screenshot",
  });

  assert.equal(stitched.result.width, 600);
  assert.equal(stitched.result.height, 400);
  assert.deepEqual(drawCalls[0], [200, 100, 600, 400, 0, 0, 600, 400]);
  assert.equal(savedRecord.captureMode, "normal-screenshot");
  assert.equal(savedRecord.imageFormat, "PNG");
});

test("Stage 3 content modules and fixtures are packaged without new permissions", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const scripts = manifest.content_scripts[0].js;
  for (const file of [
    "content/selection-overlay.js",
    "content/scrollable-selection.js",
    "content/screenshot-selection.js",
    "content/selected-area.js",
  ]) {
    assert.equal(scripts.includes(file), true, `${file} is not declared`);
    assert.equal(fs.existsSync(path.join(projectRoot, file)), true, `${file} is missing`);
  }
  assert.deepEqual(manifest.permissions.sort(), ["activeTab", "offscreen", "scripting"]);
  assert.equal(fs.existsSync(path.join(projectRoot, "tests/fixtures/scrollable-area-test.html")), true);
  assert.equal(fs.existsSync(path.join(projectRoot, "tests/fixtures/selected-area-test.html")), true);
});

test("Stage 3 remains generic and contains no PDF or site-specific engine", () => {
  for (const file of [
    "background/region-capture.js",
    "content/selection-overlay.js",
    "content/scrollable-selection.js",
    "content/selected-area.js",
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /whatsapp|telegram|jsPDF|application\/pdf|capture iframe|contentDocument/i);
  }
});

async function main() {
  let failures = 0;
  for (const { name, run } of tests) {
    try {
      await run();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${name}`);
      console.error(`  ${error.message}`);
    }
  }
  console.log(`\n${tests.length - failures}/${tests.length} Stage 3 tests passed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
