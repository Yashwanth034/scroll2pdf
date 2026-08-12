#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const tests = [];

function test(name, run) {
  tests.push({ name, run });
}

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function runScript(relativePath, sandbox = {}) {
  sandbox.globalThis = sandbox;
  sandbox.URL = sandbox.URL || URL;
  sandbox.setTimeout = sandbox.setTimeout || setTimeout;
  sandbox.clearTimeout = sandbox.clearTimeout || clearTimeout;
  const context = vm.createContext(sandbox);
  new vm.Script(read(relativePath), { filename: relativePath }).runInContext(context);
  return sandbox;
}

function loadCaptureUtils() {
  const sandbox = runScript("utils/constants.js", {});
  runScript("utils/capture-utils.js", sandbox);
  return sandbox.Scroll2PDFCaptureUtils;
}

test("page dimensions use robust document/body maxima", () => {
  const utils = loadCaptureUtils();
  const result = utils.calculatePageDimensions({
    documentElement: {
      scrollHeight: 2400,
      offsetHeight: 2350,
      clientHeight: 900,
      scrollWidth: 1180,
      offsetWidth: 1200,
      clientWidth: 1000,
    },
    body: {
      scrollHeight: 2500,
      offsetHeight: 2450,
      clientHeight: 880,
      scrollWidth: 1250,
      offsetWidth: 1230,
      clientWidth: 980,
    },
    viewportWidth: 1000,
    viewportHeight: 900,
    scrollX: 12,
    scrollY: 340,
    devicePixelRatio: 1.25,
  });

  assert.equal(JSON.stringify(result), JSON.stringify({
    totalWidth: 1250,
    totalHeight: 2500,
    viewportWidth: 1000,
    viewportHeight: 900,
    scrollX: 12,
    scrollY: 340,
    devicePixelRatio: 1.25,
  }));
});

test("scroll positions include one viewport and a clamped overlapping bottom", () => {
  const utils = loadCaptureUtils();

  assert.deepEqual(Array.from(utils.buildScrollPositions(700, 900)), [0]);
  assert.deepEqual(Array.from(utils.buildScrollPositions(1800, 900)), [0, 900]);
  assert.deepEqual(Array.from(utils.buildScrollPositions(2500, 900)), [0, 900, 1600]);
  assert.equal(utils.getNextScrollPosition(900, 2500, 900), 1600);
  assert.equal(utils.getNextScrollPosition(1600, 2500, 900), null);
});

test("bitmap scale is measured from screenshot and CSS viewport dimensions", () => {
  const utils = loadCaptureUtils();
  const scale = utils.calculateBitmapScale({
    bitmapWidth: 2000,
    bitmapHeight: 1800,
    viewportCssWidth: 1000,
    viewportCssHeight: 900,
  });

  assert.equal(JSON.stringify(scale), JSON.stringify({ x: 2, y: 2 }));
  assert.throws(() => utils.calculateBitmapScale({
    bitmapWidth: 2000,
    bitmapHeight: 1350,
    viewportCssWidth: 1000,
    viewportCssHeight: 900,
  }), /inconsistent/i);
});

test("overlap plan crops the final viewport and exact document bottom", () => {
  const utils = loadCaptureUtils();
  const plan = utils.calculateFrameDrawPlan({
    actualY: 1600,
    viewportCssHeight: 900,
    bitmapHeight: 1800,
    totalHeightCss: 2500,
    coveredBottomCss: 1800,
    scaleY: 2,
    finalBitmapHeight: 5000,
  });

  assert.equal(JSON.stringify(plan), JSON.stringify({
    sourceY: 400,
    sourceHeight: 1400,
    destinationY: 3600,
    destinationHeight: 1400,
    nextCoveredBottomCss: 2500,
  }));
});

test("draw planning rejects CSS gaps instead of producing blank bands", () => {
  const utils = loadCaptureUtils();
  assert.throws(() => utils.calculateFrameDrawPlan({
    actualY: 1001,
    viewportCssHeight: 900,
    bitmapHeight: 900,
    totalHeightCss: 2000,
    coveredBottomCss: 900,
    scaleY: 1,
    finalBitmapHeight: 2000,
  }), /gap/i);
});

test("canvas safety rejects excessive dimensions and area", () => {
  const utils = loadCaptureUtils();
  assert.deepEqual(JSON.parse(JSON.stringify(utils.validateCanvasSize(1600, 12000))), {
    width: 1600,
    height: 12000,
    pixels: 19200000,
  });
  assert.throws(() => utils.validateCanvasSize(32768, 100), /per side|dimension/i);
  assert.throws(() => utils.validateCanvasSize(20000, 10000), /pixels total|area/i);
});

test("image filenames contain only the UTC capture date and correct extension", () => {
  const utils = loadCaptureUtils();
  const instant = new Date("2026-08-12T10:30:00Z");

  assert.equal(
    utils.buildCaptureFilename("https://Example.COM/a", "high", instant),
    "scroll2pdf-2026-08-12.png",
  );
  assert.equal(
    utils.buildCaptureFilename("https://weird_host.example/a", "standard", instant),
    "scroll2pdf-2026-08-12.jpg",
  );
});

test("restricted URL classification permits only capturable normal web pages", () => {
  const utils = loadCaptureUtils();
  assert.equal(utils.isRestrictedCaptureUrl("https://example.com/long"), false);
  assert.equal(utils.isRestrictedCaptureUrl("http://localhost:8080/"), false);
  assert.equal(utils.isRestrictedCaptureUrl("chrome://extensions"), true);
  assert.equal(utils.isRestrictedCaptureUrl("chrome-extension://abc/page.html"), true);
  assert.equal(utils.isRestrictedCaptureUrl("https://chromewebstore.google.com/detail/x"), true);
  assert.equal(utils.isRestrictedCaptureUrl("https://chrome.google.com/webstore/detail/x"), true);

  assert.equal(
    JSON.stringify(utils.classifyCaptureUrl("https://example.com/a")),
    JSON.stringify({ restricted: false, reason: null }),
  );
  assert.equal(utils.classifyCaptureUrl("chrome://newtab/").reason, "protocol");
  assert.equal(utils.classifyCaptureUrl("about:blank").reason, "protocol");
  assert.equal(utils.classifyCaptureUrl("file:///tmp/page.html").reason, "protocol");
  assert.equal(utils.classifyCaptureUrl("https://chromewebstore.google.com/detail/x").reason, "webstore");
  assert.equal(utils.classifyCaptureUrl(undefined).reason, "unknown");
});

test("quality maps to readable screenshot and final image formats", () => {
  const utils = loadCaptureUtils();
  assert.equal(JSON.stringify(utils.getImageFormat("standard")), JSON.stringify({
    captureFormat: "jpeg",
    captureQuality: 95,
    mimeType: "image/jpeg",
    extension: "jpg",
    encodeQuality: 0.95,
  }));
  assert.equal(JSON.stringify(utils.getImageFormat("high")), JSON.stringify({
    captureFormat: "png",
    mimeType: "image/png",
    extension: "png",
  }));
});

test("capture coordinator rejects unsupported and concurrent operations", async () => {
  const sandbox = runScript("utils/constants.js", {});
  runScript("utils/capture-utils.js", sandbox);
  runScript("background/full-page-capture.js", sandbox);

  let finish;
  const operation = new Promise((resolve) => { finish = resolve; });
  const events = [];
  const manager = sandbox.Scroll2PDFFullPageCapture.createCaptureManager({
    getActiveTab: async () => ({ id: 7, windowId: 2, url: "https://example.com/" }),
    executeOperation: async () => operation,
    broadcast: async (event) => { events.push(event); },
    openResult: async () => { events.push({ type: "RESULT_OPENED" }); },
    createId: () => "capture-1",
  });

  const unsupported = await manager.startCapture({ captureMode: "selected-area" });
  assert.equal(unsupported.ok, false);
  assert.match(unsupported.error, /Stage 3/);

  const started = await manager.startCapture({ captureMode: "full-page" });
  assert.equal(started.ok, true);
  assert.equal(manager.getStatus().active, true);

  const concurrent = await manager.startCapture({ captureMode: "full-page" });
  assert.equal(concurrent.ok, false);
  assert.match(concurrent.error, /already in progress/i);

  finish({ resultId: "done" });
  await started.completion;
  assert.equal(manager.getStatus().active, false);
  assert.equal(events.some((event) => event.type === "CAPTURE_COMPLETE"), true);
  assert.equal(
    events.findIndex((event) => event.type === "CAPTURE_COMPLETE")
      < events.findIndex((event) => event.type === "RESULT_OPENED"),
    true,
  );
});

test("Screenshot capture normalizes stale output and quality settings", async () => {
  const sandbox = runScript("utils/constants.js", {});
  runScript("utils/capture-utils.js", sandbox);
  runScript("background/full-page-capture.js", sandbox);
  let received;
  const manager = sandbox.Scroll2PDFFullPageCapture.createCaptureManager({
    getActiveTab: async () => ({ id: 12, windowId: 3, url: "https://example.com/" }),
    executeOperation: async (operation) => {
      received = operation.configuration;
      return { resultId: "screenshot-result" };
    },
    broadcast: async () => {},
    openResult: async () => {},
    createId: () => "screenshot-normalized",
  });
  const started = await manager.startCapture({
    captureMode: "normal-screenshot",
    outputType: "a4-pdf",
    quality: "standard",
    orientation: "landscape",
  });
  assert.equal(started.ok, true);
  await started.completion;
  assert.equal(received.outputType, "long-image");
  assert.equal(received.quality, "high");
  assert.equal(received.selectScreenshotArea, false);
});

test("selected Screenshot captures once and forwards the viewport crop", async () => {
  const sandbox = runScript("utils/constants.js", {});
  runScript("utils/capture-utils.js", sandbox);
  runScript("background/full-page-capture.js", sandbox);
  const pageMessages = [];
  const queuedFrames = [];
  let captures = 0;
  const manager = sandbox.Scroll2PDFFullPageCapture.createCaptureManager({
    getActiveTab: async () => ({ id: 12, windowId: 3, url: "https://example.com/" }),
    ensureOffscreen: async () => {},
    closeOffscreen: async () => {},
    assertTargetActive: async () => {},
    delay: async () => {},
    broadcast: async () => {},
    openResult: async () => {},
    createId: () => "selected-screenshot",
    captureVisibleTab: async () => {
      captures += 1;
      return "data:image/png;base64,selected";
    },
    sendTabMessage: async (tabId, message) => {
      pageMessages.push(message);
      return {
        ok: true,
        selection: {
          cropRectCss: { left: 120, top: 80, right: 620, bottom: 380, width: 500, height: 300 },
          viewportCssWidth: 1000,
          viewportCssHeight: 700,
        },
      };
    },
    sendOffscreen: async (message) => {
      if (message.type === "OFFSCREEN_ADD_CAPTURE") queuedFrames.push(message.payload.frame);
      if (message.type === "OFFSCREEN_STITCH_CAPTURE") {
        return { ok: true, result: { resultId: "selected-screenshot-result" } };
      }
      return { ok: true };
    },
  });

  const started = await manager.startCapture({
    captureMode: "normal-screenshot",
    outputType: "long-image",
    quality: "high",
    orientation: "portrait",
    selectScreenshotArea: true,
  });
  assert.equal(started.ok, true);
  const completion = await started.completion;
  assert.equal(completion.ok, true, completion.error);
  assert.equal(captures, 1);
  assert.equal(pageMessages.length, 1);
  assert.equal(pageMessages[0].type, "START_SCREENSHOT_SELECTION");
  assert.equal(JSON.stringify(queuedFrames[0].cropRectCss), JSON.stringify({
    left: 120, top: 80, right: 620, bottom: 380, width: 500, height: 300,
  }));
  assert.equal(queuedFrames[0].viewportCssWidth, 1000);
  assert.equal(queuedFrames[0].viewportCssHeight, 700);
});

test("full-viewport Screenshot does not request page selection", async () => {
  const sandbox = runScript("utils/constants.js", {});
  runScript("utils/capture-utils.js", sandbox);
  runScript("background/full-page-capture.js", sandbox);
  let captures = 0;
  const manager = sandbox.Scroll2PDFFullPageCapture.createCaptureManager({
    getActiveTab: async () => ({ id: 12, windowId: 3, url: "https://example.com/" }),
    ensureOffscreen: async () => {},
    closeOffscreen: async () => {},
    broadcast: async () => {},
    openResult: async () => {},
    createId: () => "full-screenshot",
    captureVisibleTab: async () => {
      captures += 1;
      return "data:image/png;base64,full";
    },
    sendTabMessage: async () => { throw new Error("full Screenshot must not request selection"); },
    sendOffscreen: async (message) => message.type === "OFFSCREEN_STITCH_CAPTURE"
      ? { ok: true, result: { resultId: "full-screenshot-result" } }
      : { ok: true },
  });

  const started = await manager.startCapture({
    captureMode: "normal-screenshot",
    outputType: "long-image",
    quality: "high",
    orientation: "portrait",
    selectScreenshotArea: false,
  });
  assert.equal(started.ok, true);
  const completion = await started.completion;
  assert.equal(completion.ok, true, completion.error);
  assert.equal(captures, 1);
});

test("cancellation is announced only after operation cleanup finishes", async () => {
  const sandbox = runScript("utils/constants.js", {});
  runScript("utils/capture-utils.js", sandbox);
  runScript("background/full-page-capture.js", sandbox);

  const order = [];
  let operationRef;
  const manager = sandbox.Scroll2PDFFullPageCapture.createCaptureManager({
    getActiveTab: async () => ({ id: 9, windowId: 4, url: "https://example.com/" }),
    executeOperation: async (operation) => {
      operationRef = operation;
      while (!operation.cancelRequested) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      order.push("restore");
      throw new sandbox.Scroll2PDFFullPageCapture.CaptureCancelledError();
    },
    broadcast: async (event) => { order.push(event.type); },
    createId: () => "capture-cancel",
  });

  const started = await manager.startCapture({ captureMode: "full-page" });
  await manager.cancelCapture();
  assert.equal(operationRef.cancelRequested, true);
  await started.completion;

  assert.deepEqual(order.slice(-2), ["restore", "CAPTURE_CANCELLED"]);
  assert.equal(manager.getStatus().active, false);
});

test("capture start injects content scripts on demand and maps failures", async () => {
  const sandbox = runScript("utils/constants.js", {});
  runScript("utils/capture-utils.js", sandbox);
  runScript("background/full-page-capture.js", sandbox);

  const injected = [];
  const manager = sandbox.Scroll2PDFFullPageCapture.createCaptureManager({
    getActiveTab: async () => ({ id: 7, windowId: 2, url: "https://example.com/" }),
    ensureContentScripts: async (tabId, url) => { injected.push({ tabId, url }); },
    executeOperation: async () => ({ resultId: "injected-result" }),
    broadcast: async () => {},
    openResult: async () => {},
    createId: () => "capture-inject",
  });
  const started = await manager.startCapture({ captureMode: "full-page" });
  assert.equal(started.ok, true);
  assert.deepEqual(injected, [{ tabId: 7, url: "https://example.com/" }]);
  await started.completion;

  const unreachable = sandbox.Scroll2PDFFullPageCapture.createCaptureManager({
    getActiveTab: async () => ({ id: 8, windowId: 2, url: "https://example.com/" }),
    ensureContentScripts: async () => {
      throw new Error("Scroll2PDF could not connect to this page. Reload the page (or reload the Scroll2PDF extension in chrome://extensions if it was just updated) and try again.");
    },
    broadcast: async () => {},
    createId: () => "capture-unreachable",
  });
  const failed = await unreachable.startCapture({ captureMode: "full-page" });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /Reload the page/);

  const protectedManager = sandbox.Scroll2PDFFullPageCapture.createCaptureManager({
    getActiveTab: async () => ({ id: 9, windowId: 2, url: "chrome://extensions" }),
    ensureContentScripts: async () => { throw new Error("should not be called"); },
    broadcast: async () => {},
    createId: () => "capture-protected",
  });
  const protectedResult = await protectedManager.startCapture({ captureMode: "full-page" });
  assert.equal(protectedResult.ok, false);
  assert.match(protectedResult.error, /browser-protected/);
  assert.match(protectedResult.error, /chrome:\/\//);

  // A missing content-script connection on an ordinary page is a recoverable
  // problem, not a protected page: the user is told to reload instead.
  const connectManager = sandbox.Scroll2PDFFullPageCapture.createCaptureManager({
    getActiveTab: async () => ({ id: 10, windowId: 2, url: "https://example.com/" }),
    ensureContentScripts: async () => {
      throw new Error("Could not establish connection. Receiving end does not exist.");
    },
    broadcast: async () => {},
    createId: () => "capture-connect",
  });
  const connectResult = await connectManager.startCapture({ captureMode: "full-page" });
  assert.equal(connectResult.ok, false);
  assert.doesNotMatch(connectResult.error, /browser-protected/);
  assert.match(connectResult.error, /Reload the page/);
});

test("page capture restores scroll behavior, hidden overlays, and original position", async () => {
  const styleValues = new Map();
  const stylePriorities = new Map();
  const makeStyle = () => ({
    getPropertyValue(name) { return styleValues.get(this)?.get(name) || ""; },
    getPropertyPriority(name) { return stylePriorities.get(this)?.get(name) || ""; },
    setProperty(name, value, priority = "") {
      if (!styleValues.has(this)) styleValues.set(this, new Map());
      if (!stylePriorities.has(this)) stylePriorities.set(this, new Map());
      styleValues.get(this).set(name, value);
      stylePriorities.get(this).set(name, priority);
    },
    removeProperty(name) {
      styleValues.get(this)?.delete(name);
      stylePriorities.get(this)?.delete(name);
    },
  });
  const rootStyle = makeStyle();
  const bodyStyle = makeStyle();
  const overlayStyle = makeStyle();
  rootStyle.setProperty("scroll-behavior", "smooth", "");
  overlayStyle.setProperty("visibility", "visible", "");

  const dimensions = {
    scrollHeight: 2500,
    offsetHeight: 2500,
    clientHeight: 900,
    scrollWidth: 1000,
    offsetWidth: 1000,
    clientWidth: 1000,
  };
  const overlay = {
    style: overlayStyle,
    offsetTop: 0,
    offsetParent: null,
    getBoundingClientRect: () => ({ top: 0, bottom: 50, left: 0, right: 1000, width: 1000, height: 50 }),
  };
  const fakeWindow = {
    innerWidth: 1000,
    innerHeight: 900,
    scrollX: 14,
    scrollY: 640,
    devicePixelRatio: 1.5,
    requestAnimationFrame(callback) { callback(); },
    getComputedStyle(element) {
      return element === overlay
        ? { position: "fixed", visibility: "visible", display: "block", opacity: "1", top: "0px", bottom: "auto" }
        : { position: "static" };
    },
    scrollTo(options) {
      this.scrollX = Number(options.left) || 0;
      this.scrollY = Number(options.top) || 0;
    },
  };
  const fakeDocument = {
    documentElement: { ...dimensions, style: rootStyle },
    body: { ...dimensions, style: bodyStyle },
    querySelectorAll() { return [overlay]; },
  };
  const sandbox = runScript("utils/constants.js", {
    window: fakeWindow,
    document: fakeDocument,
    setTimeout(callback) { callback(); },
  });
  runScript("utils/capture-utils.js", sandbox);
  runScript("content/capture-stability.js", sandbox);
  runScript("content/page-capture.js", sandbox);
  const api = sandbox.Scroll2PDFPageCapture;

  const prepared = await api.prepareFullPageCapture("capture-page");
  assert.equal(prepared.metrics.scrollY, 0);
  assert.equal(rootStyle.getPropertyValue("scroll-behavior"), "auto");

  await api.scrollToPosition("capture-page", 900);
  const hidden = api.hideRepeatedOverlays("capture-page");
  assert.equal(hidden.hiddenCount, 1);
  assert.equal(overlayStyle.getPropertyValue("visibility"), "hidden");

  const restored = await api.restorePage("capture-page");
  assert.equal(restored.restored, true);
  assert.equal(fakeWindow.scrollX, 14);
  assert.equal(fakeWindow.scrollY, 640);
  assert.equal(rootStyle.getPropertyValue("scroll-behavior"), "smooth");
  assert.equal(overlayStyle.getPropertyValue("visibility"), "visible");
});

test("popup derives progress and cancellation UI from recoverable background status", () => {
  const sandbox = runScript("utils/constants.js", {
    document: { addEventListener() {} },
    chrome: { runtime: { sendMessage: async () => ({}), onMessage: { addListener() {} } } },
  });
  runScript("popup/popup.js", sandbox);
  const ui = sandbox.Scroll2PDFPopup.getCaptureUiModel({
    active: true,
    phase: "capturing",
    completed: 4,
    total: 12,
    message: "Capturing page… 4 / 12",
    cancelling: false,
  });

  assert.equal(JSON.stringify(ui), JSON.stringify({
    busy: true,
    showCancel: true,
    cancelDisabled: false,
    message: "Capturing page… 4 / 12",
    progressValue: 33,
  }));
  assert.equal(
    sandbox.Scroll2PDFPopup.getCaptureUiModel({ active: true, cancelling: true }).cancelDisabled,
    true,
  );
});

test("full-page operation uses actual scroll positions and restores before returning result", async () => {
  const sandbox = runScript("utils/constants.js", {});
  runScript("utils/capture-utils.js", sandbox);
  runScript("background/full-page-capture.js", sandbox);
  const order = [];
  const frames = [];
  let scrollY = 0;
  const metrics = () => ({
    totalWidth: 1000,
    totalHeight: 2500,
    viewportWidth: 1000,
    viewportHeight: 900,
    scrollX: 0,
    scrollY,
    devicePixelRatio: 1,
  });
  const operation = {
    captureId: "capture-loop",
    tabId: 5,
    windowId: 2,
    pageUrl: "https://example.com/",
    configuration: { captureMode: "full-page", outputType: "long-image", quality: "high" },
    phase: "preparing",
    completed: 0,
    total: 0,
    message: "Preparing page…",
    cancelRequested: false,
    startedAt: Date.now(),
    async report(update) { Object.assign(this, update); },
  };
  const deps = {
    ensureOffscreen: async () => { order.push("offscreen-open"); },
    closeOffscreen: async () => { order.push("offscreen-close"); },
    assertTargetActive: async () => {},
    delay: async () => {},
    captureVisibleTab: async () => {
      order.push(`capture-${scrollY}`);
      return `data:image/png;base64,frame-${scrollY}`;
    },
    sendTabMessage: async (tabId, message) => {
      if (message.type === "PREPARE_FULL_PAGE_CAPTURE") {
        scrollY = 0;
        return { ok: true, metrics: metrics() };
      }
      if (message.type === "SCROLL_TO_POSITION") {
        scrollY = Math.min(message.payload.y, 1600);
        order.push(`scroll-${scrollY}`);
        return { ok: true, metrics: metrics() };
      }
      if (message.type === "RESTORE_PAGE") {
        order.push("restore");
        return { ok: true, restored: true };
      }
      return { ok: true, metrics: metrics() };
    },
    sendOffscreen: async (message) => {
      if (message.type === "OFFSCREEN_ADD_CAPTURE") {
        frames.push(message.payload.frame);
      }
      if (message.type === "OFFSCREEN_STITCH_CAPTURE") {
        return { ok: true, result: { resultId: "result-1", width: 1000, height: 2500 } };
      }
      return { ok: true };
    },
    openResult: async () => { order.push("open-result"); },
  };

  const result = await sandbox.Scroll2PDFFullPageCapture.executeFullPageCapture(operation, deps);
  assert.equal(result.resultId, "result-1");
  assert.deepEqual(frames.map((frame) => frame.actualY), [0, 900, 1600]);
  assert.deepEqual(frames.map((frame) => frame.requestedY), [0, 900, 1600]);
  assert.equal(order.includes("restore"), true);
  assert.equal(order.includes("offscreen-close"), true);
  assert.equal(order.includes("open-result"), false);
});

test("offscreen stitcher draws only the unseen bottom portion of the final frame", async () => {
  const drawCalls = [];
  let savedRecord;
  let messageListener;
  class FakeImage {
    constructor() {
      this.naturalWidth = 1000;
      this.naturalHeight = 900;
    }
    set src(value) {
      this._src = value;
      if (value) queueMicrotask(() => this.onload());
    }
    get src() { return this._src; }
  }
  const fakeCanvas = {
    width: 0,
    height: 0,
    getContext() {
      return {
        fillStyle: "",
        fillRect() {},
        drawImage(...args) { drawCalls.push(args.slice(1)); },
      };
    },
    toBlob(callback, mimeType) { callback(new Blob(["image"], { type: mimeType })); },
  };
  const sandbox = runScript("utils/constants.js", {
    Blob,
    Image: FakeImage,
    crypto: { randomUUID: () => "result-offscreen" },
    document: { createElement: () => fakeCanvas },
    chrome: { runtime: { onMessage: { addListener(listener) { messageListener = listener; } } } },
  });
  runScript("utils/capture-utils.js", sandbox);
  sandbox.Scroll2PDFResultStore = {
    async saveResult(record) { savedRecord = record; },
  };
  runScript("offscreen/offscreen.js", sandbox);
  const api = sandbox.Scroll2PDFOffscreen;
  api.resetCapture("offscreen-capture");
  for (const actualY of [0, 900, 1600]) {
    await api.addCaptureFrame({
      captureId: "offscreen-capture",
      frame: {
        requestedY: actualY,
        actualY,
        viewportCssWidth: 1000,
        viewportCssHeight: 900,
        imageDataUrl: `data:image/png;base64,${actualY}`,
      },
    });
  }
  const stitched = await api.stitchCapture({
    captureId: "offscreen-capture",
    totalHeightCss: 2500,
    quality: "high",
    filename: "capture.png",
  });

  assert.equal(typeof messageListener, "function");
  assert.equal(stitched.result.width, 1000);
  assert.equal(stitched.result.height, 2500);
  assert.equal(savedRecord.resultId, "result-offscreen");
  assert.deepEqual(drawCalls[2], [0, 200, 1000, 700, 0, 1800, 1000, 700]);
});

test("result and offscreen pages remain local and expose Stage 2 controls", () => {
  const offscreen = read("offscreen/offscreen.html");
  const result = read("result/result.html");

  assert.match(offscreen, /utils\/result-store\.js/);
  assert.match(offscreen, /offscreen\.js/);
  assert.doesNotMatch(offscreen, /https?:\/\//i);
  assert.match(result, /id="result-image"/);
  assert.match(result, /id="download-image"[^>]+download/);
  assert.match(result, /id="close-result"/);
  assert.doesNotMatch(result, /https?:\/\//i);
});

test("Stage 2 capture core stays generic and Stage 4 adds no external PDF engine", () => {
  const implementationFiles = [
    "background/full-page-capture.js",
    "content/page-capture.js",
    "offscreen/offscreen.js",
  ];

  for (const file of implementationFiles) {
    const source = read(file);
    assert.doesNotMatch(source, /querySelector[^\n]*(whatsapp|telegram)/i);
    assert.doesNotMatch(source, /\bjsPDF\b|new\s+PDF/i);
    assert.doesNotMatch(source, /mousedown[^\n]*(selection|overlay)|pointerdown[^\n]*(selection|overlay)/i);
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
  console.log(`\n${tests.length - failures}/${tests.length} Stage 2 tests passed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
