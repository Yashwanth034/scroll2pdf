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

function runScript(relativePath, sandbox) {
  const context = vm.createContext(sandbox);
  new vm.Script(read(relativePath), { filename: relativePath }).runInContext(context);
  return sandbox;
}

function installConstants(sandbox) {
  return runScript("utils/constants.js", sandbox);
}

test("manifest preserves the MV3 foundation with scoped local capture modules", () => {
  const manifest = JSON.parse(read("manifest.json"));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "Scroll2PDF");
  assert.equal(manifest.version, "1.0.0");
  assert.equal(manifest.action.default_popup, "popup/popup.html");
  assert.equal(manifest.background.service_worker, "background/background.js");
  assert.deepEqual(manifest.permissions.sort(), ["activeTab", "offscreen", "scripting"]);
  assert.equal(manifest.minimum_chrome_version, "109");
  assert.deepEqual(manifest.host_permissions.sort(), ["http://*/*", "https://*/*"]);
  assert.deepEqual(manifest.content_scripts[0].matches.sort(), ["http://*/*", "https://*/*"]);
  assert.deepEqual(manifest.content_scripts[0].js, [
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
    "content/content.js",
  ]);
});

test("CONTENT_SCRIPT_FILES stays in sync with the manifest content scripts", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const sandbox = installConstants({});
  assert.equal(
    JSON.stringify(sandbox.Scroll2PDFConstants.CONTENT_SCRIPT_FILES),
    JSON.stringify(manifest.content_scripts[0].js),
    "The on-demand injection list must match the manifest content script order.",
  );
});

test("scroller detection distinguishes ordinary pages from pinned app shells", () => {
  const sandbox = installConstants({});
  runScript("utils/capture-utils.js", sandbox);
  const utils = sandbox.Scroll2PDFCaptureUtils;

  function element(overrides = {}) {
    const rect = overrides.rect || { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 };
    return {
      scrollHeight: overrides.scrollHeight ?? 2000,
      clientHeight: overrides.clientHeight ?? 600,
      clientWidth: overrides.clientWidth ?? 800,
      scrollWidth: 800,
      offsetWidth: 800,
      offsetHeight: 600,
      style: overrides.style || { overflowY: "auto" },
      getBoundingClientRect: () => rect,
      children: overrides.children || [],
      parentElement: overrides.parentElement || null,
    };
  }

  function makeDocument(documentElement, body) {
    return { documentElement, body };
  }

  function makeWindow(documentValue, options = {}) {
    return {
      innerWidth: options.innerWidth || 1200,
      innerHeight: options.innerHeight || 800,
      document: documentValue,
      getComputedStyle: (el) => el?.style || { overflowY: "visible" },
    };
  }

  const tallHtml = element({
    rect: { left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 },
    scrollHeight: 3000, clientHeight: 800, clientWidth: 1200,
    style: { overflowY: "visible" },
  });
  const tallBody = element({
    rect: { left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 },
    scrollHeight: 3000, clientHeight: 800, clientWidth: 1200,
    style: { overflowY: "visible" },
  });
  const ordinaryDoc = makeDocument(tallHtml, tallBody);
  const ordinaryWin = makeWindow(ordinaryDoc);
  assert.equal(utils.windowCanScroll(ordinaryWin, ordinaryDoc), true);

  const pinnedHtml = element({
    rect: { left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 },
    scrollHeight: 800, clientHeight: 800, clientWidth: 1200,
    style: { overflowY: "hidden" },
  });
  const pinnedBody = element({
    rect: { left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 },
    scrollHeight: 800, clientHeight: 800, clientWidth: 1200,
    style: { overflowY: "hidden" },
  });
  const appDoc = makeDocument(pinnedHtml, pinnedBody);
  const appWin = makeWindow(appDoc);
  assert.equal(utils.windowCanScroll(appWin, appDoc), false);

  const sidebar = element({
    rect: { left: 0, top: 0, right: 220, bottom: 800, width: 220, height: 800 },
    scrollHeight: 1400, clientHeight: 800, clientWidth: 220,
  });
  const mainScroller = element({
    rect: { left: 220, top: 0, right: 1200, bottom: 800, width: 980, height: 800 },
    scrollHeight: 3400, clientHeight: 800, clientWidth: 980,
    children: [
      element({
        rect: { left: 220, top: 0, right: 1200, bottom: 120, width: 980, height: 120 },
        scrollHeight: 120, clientHeight: 120, clientWidth: 980,
      }),
    ],
  });
  pinnedBody.children = [sidebar, mainScroller];
  assert.equal(utils.findBestScrollContainer(appWin, appDoc), mainScroller);

  const row = element({
    rect: { left: 240, top: 40, right: 1180, bottom: 160, width: 940, height: 120 },
    scrollHeight: 120, clientHeight: 120, clientWidth: 940,
    parentElement: mainScroller,
  });
  assert.equal(utils.findScrollableAncestor(row, appWin, appDoc), mainScroller);
  assert.equal(utils.findScrollableAncestor([row], appWin, appDoc), mainScroller);
  assert.equal(utils.findScrollableAncestor([], appWin, appDoc), null);
});

test("every required project and manifest-referenced file exists", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const requiredFiles = [
    "manifest.json",
    "popup/popup.html",
    "popup/popup.css",
    "popup/popup.js",
    manifest.background.service_worker,
    ...manifest.content_scripts.flatMap((entry) => entry.js),
    "background/full-page-capture.js",
    "background/pdf-output.js",
    "utils/pdf-utils.js",
    "utils/result-store.js",
    "offscreen/offscreen.html",
    "offscreen/offscreen.js",
    "offscreen/pdf-writer.js",
    "offscreen/pdf-generator.js",
    "result/result.html",
    "result/result.css",
    "result/editor-core.js",
    "result/editor-renderer.js",
    "result/editor-controller.js",
    "result/result.js",
    "README.md",
  ];

  for (const relativePath of new Set(requiredFiles)) {
    assert.equal(fs.existsSync(path.join(projectRoot, relativePath)), true, `${relativePath} is missing`);
  }
});

test("shared defaults produce the required initial capture configuration", () => {
  const sandbox = installConstants({});
  const constants = sandbox.Scroll2PDFConstants;

  assert.equal(JSON.stringify(constants.DEFAULT_CONFIG), JSON.stringify({
    captureMode: "full-page",
    outputType: "a4-pdf",
    quality: "high",
    orientation: "portrait",
    selectScreenshotArea: false,
  }));
  assert.equal(constants.MESSAGE_TYPES.START_CAPTURE, "START_CAPTURE");
  assert.equal(constants.MESSAGE_TYPES.CAPTURE_PROGRESS, "CAPTURE_PROGRESS");
  assert.equal(constants.MESSAGE_TYPES.CAPTURE_COMPLETE, "CAPTURE_COMPLETE");
  assert.equal(constants.MESSAGE_TYPES.CAPTURE_ERROR, "CAPTURE_ERROR");
  assert.equal(constants.MESSAGE_TYPES.CANCEL_CAPTURE, "CANCEL_CAPTURE");
  assert.equal(constants.MESSAGE_TYPES.CAPTURE_CANCELLED, "CAPTURE_CANCELLED");
  assert.equal(constants.CAPTURE_LIMITS.MAX_VIEWPORT_CAPTURES, 500);
  assert.equal(constants.CAPTURE_LIMITS.MIN_CAPTURE_INTERVAL_MS, 550);
  assert.equal(Object.isFrozen(constants.DEFAULT_CONFIG), true);
});

test("popup markup supplies semantic single-choice groups and safe local scripts", () => {
  const html = read("popup/popup.html");

  assert.match(html, /<h1[^>]*>\s*Scroll2PDF\s*<\/h1>/);
  assert.match(html, /Capture anything beyond the screen/);
  assert.match(html, /<form[^>]+id="capture-form"/);
  assert.equal((html.match(/name="captureMode"/g) || []).length, 4);
  assert.equal((html.match(/name="outputType"/g) || []).length, 2);
  assert.equal((html.match(/name="quality"/g) || []).length, 2);
  assert.equal((html.match(/name="orientation"/g) || []).length, 2);
  assert.equal((html.match(/name="selectScreenshotArea"/g) || []).length, 1);
  assert.match(html, /value="full-page"\s+checked/);
  assert.match(html, /value="a4-pdf"\s+checked/);
  assert.match(html, /value="high"\s+checked/);
  assert.match(html, /value="portrait"\s+checked/);
  assert.match(html, /<input[^>]+type="checkbox"[^>]+id="select-screenshot-area"/);
  assert.match(html, /for="select-screenshot-area"[^>]*>[\s\S]*Select area before capture/);
  assert.match(html, /id="capture-status"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(html, /<button[^>]+type="submit"[^>]*>[\s\S]*Start Capture[\s\S]*<\/button>/);
  assert.match(html, /id="cancel-capture"[^>]+type="button"/);
  assert.match(html, /id="capture-progress"[^>]+role="progressbar"/);
  assert.doesNotMatch(html, /<script(?!\s+src=)[^>]*>/i);
  assert.doesNotMatch(html, /https?:\/\//i);
});

test("popup builds and sends the selected configuration as START_CAPTURE", async () => {
  const selected = {
    captureMode: "selected-area",
    outputType: "long-image",
    quality: "standard",
    orientation: "landscape",
    selectScreenshotArea: false,
  };
  const form = {
    querySelector(selector) {
      if (selector === "#select-screenshot-area") return { checked: true };
      const name = selector.match(/name="([^"]+)"/)[1];
      return { value: selected[name] };
    },
  };
  const document = { addEventListener() {} };
  const sentMessages = [];
  const runtime = {
    async sendMessage(message) {
      sentMessages.push(message);
      return { ok: true, captureId: "capture-test" };
    },
  };
  const sandbox = installConstants({ document, chrome: { runtime }, setTimeout, clearTimeout });
  runScript("popup/popup.js", sandbox);

  const configuration = sandbox.Scroll2PDFPopup.readCaptureConfiguration(form);
  const response = await sandbox.Scroll2PDFPopup.requestCapture(configuration, runtime);

  assert.equal(JSON.stringify(configuration), JSON.stringify(selected));
  assert.equal(JSON.stringify(sentMessages), JSON.stringify([{
    type: "START_CAPTURE",
    payload: selected,
  }]));
  assert.equal(response.ok, true);
});

test("background accepts complete known settings and rejects malformed settings", () => {
  let listener;
  const logged = [];
  const chrome = {
    runtime: {
      onMessage: {
        addListener(handler) {
          listener = handler;
        },
      },
    },
  };
  const sandbox = installConstants({ chrome, console: { log: (...args) => logged.push(args) } });
  sandbox.Scroll2PDFCaptureUtils = {};
  sandbox.Scroll2PDFFullPageCapture = {
    createCaptureManager() {
      return { startCapture() {}, cancelCapture() {}, getStatus() {} };
    },
  };
  runScript("background/background.js", sandbox);
  const api = sandbox.Scroll2PDFBackground;
  const validConfig = {
    captureMode: "full-page",
    outputType: "a4-pdf",
    quality: "high",
    orientation: "portrait",
    selectScreenshotArea: true,
  };

  const valid = api.validateCaptureConfiguration(validConfig);
  assert.equal(valid.valid, true);
  assert.equal(valid.configuration.selectScreenshotArea, false);
  const screenshot = api.validateCaptureConfiguration({
    captureMode: "normal-screenshot",
    outputType: "a4-pdf",
    quality: "standard",
    orientation: "landscape",
    selectScreenshotArea: true,
  });
  assert.equal(screenshot.valid, true);
  assert.equal(screenshot.configuration.outputType, "long-image");
  assert.equal(screenshot.configuration.quality, "high");
  assert.equal(screenshot.configuration.selectScreenshotArea, true);
  assert.equal(api.validateCaptureConfiguration({ ...validConfig, selectScreenshotArea: "true" }).valid, false);
  assert.equal(api.validateCaptureConfiguration({ ...validConfig, quality: "ultra" }).valid, false);
  assert.equal(api.validateCaptureConfiguration({ ...validConfig, unexpected: true }).valid, false);
  assert.equal(api.validateCaptureConfiguration(null).valid, false);

  assert.equal(typeof listener, "function");
});

test("content script initializes once and answers PING without touching the DOM", () => {
  const listeners = [];
  const chrome = {
    runtime: {
      onMessage: {
        addListener(handler) {
          listeners.push(handler);
        },
      },
    },
  };
  const sandbox = installConstants({ chrome });
  sandbox.Scroll2PDFPageCapture = { handleMessage() { return false; } };

  runScript("content/content.js", sandbox);
  runScript("content/content.js", sandbox);

  assert.equal(listeners.length, 1);
  let response;
  listeners[0]({ type: "PING" }, {}, (value) => {
    response = value;
  });
  assert.equal(JSON.stringify(response), JSON.stringify({ ok: true, ready: true }));
});

test("extension scripts are valid JavaScript with no remote or external PDF code", () => {
  const scripts = [
    "utils/constants.js",
    "utils/capture-utils.js",
    "utils/result-store.js",
    "utils/pdf-utils.js",
    "popup/popup.js",
    "background/background.js",
    "background/full-page-capture.js",
    "background/pdf-output.js",
    "content/iframe-expansion.js",
    "content/page-capture.js",
    "content/screenshot-selection.js",
    "content/content.js",
    "offscreen/offscreen.js",
    "offscreen/pdf-writer.js",
    "offscreen/pdf-generator.js",
    "result/editor-core.js",
    "result/editor-renderer.js",
    "result/editor-controller.js",
    "result/result.js",
  ];

  for (const relativePath of scripts) {
    const source = read(relativePath);
    assert.doesNotThrow(() => new vm.Script(source, { filename: relativePath }));
    assert.doesNotMatch(source, /\beval\s*\(/);
    assert.doesNotMatch(source, /\bjsPDF\b/);
    assert.doesNotMatch(source, /\bXMLHttpRequest\b/);
  }
});

test("iframe expansion sizes embedded documents and restores them exactly", () => {
  const sandbox = installConstants({});
  runScript("utils/capture-utils.js", sandbox);
  runScript("content/capture-stability.js", sandbox);
  runScript("content/iframe-expansion.js", sandbox);
  const api = sandbox.Scroll2PDFIframeExpansion;

  function makeStyle(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
      getPropertyValue(name) { return values.get(name) === undefined ? "" : values.get(name); },
      getPropertyPriority() { return ""; },
      setProperty(name, value) { values.set(name, value); },
      removeProperty(name) { values.delete(name); },
    };
  }

  // Measures an element like a browser lays it out: an explicit px inline
  // height wins, otherwise the tallest child box (offsetTop + height) or the
  // element's own content height.
  function measure(element) {
    if (!element) return 0;
    const inline = element.style?.getPropertyValue("height") || "";
    if (/px$/.test(inline)) return Math.max(0, Number.parseFloat(inline));
    const childrenMax = element.children.reduce((maximum, child) => (
      Math.max(maximum, (Number(child.offsetTop) || 0) + measure(child))
    ), 0);
    return Math.max(Number(element._contentHeight) || 0, childrenMax);
  }

  function makeElement(name, options = {}) {
    const children = options.children || [];
    const element = {
      tagName: name,
      style: makeStyle(options.style || {}),
      _contentHeight: options.scrollHeight ?? 0,
      clientHeight: options.clientHeight ?? 0,
      clientWidth: options.clientWidth ?? 640,
      offsetTop: options.offsetTop ?? 0,
      children,
      parentElement: options.parentElement || null,
      contentDocument: options.contentDocument || null,
      contentWindow: options.contentWindow || null,
      getBoundingClientRect: () => options.rect
        || { left: 0, top: 0, right: 640, bottom: 300, width: 640, height: 300 },
    };
    Object.defineProperty(element, "scrollHeight", { get: () => measure(element), enumerable: true });
    Object.defineProperty(element, "offsetHeight", { get: () => measure(element), enumerable: true });
    for (const child of children) child.parentElement = element;
    return element;
  }

  function makeInnerDoc(options = {}) {
    const overflowY = options.overflowY || "visible";
    const html = makeElement("HTML", {
      scrollHeight: options.scrollHeight || 0,
      clientHeight: options.clientHeight || 300,
      style: { "overflow-y": overflowY, height: overflowY === "hidden" ? "100%" : "" },
    });
    const body = makeElement("BODY", {
      scrollHeight: options.scrollHeight || 0,
      clientHeight: options.clientHeight || 300,
      style: { "overflow-y": overflowY, height: overflowY === "hidden" ? "100%" : "" },
      children: options.bodyChildren || [],
      rect: { left: 0, top: 0, right: 640, bottom: 300, width: 640, height: 300 },
    });
    const win = {
      innerHeight: options.viewportHeight || 300,
      innerWidth: 640,
      getComputedStyle: (element) => ({
        overflowY: element.style.getPropertyValue("overflow-y") || overflowY,
      }),
    };
    const doc = {
      documentElement: html,
      body,
      scrollingElement: html,
      defaultView: win,
      querySelectorAll: () => [],
    };
    return { doc, win, html, body };
  }

  // Window-scrolled embedded document: 6 x 420px bands = 2520px of content.
  const windowDoc = makeInnerDoc({ scrollHeight: 2520, clientHeight: 300 });
  const frameWindow = makeElement("IFRAME", {
    clientHeight: 300,
    contentDocument: windowDoc.doc,
    contentWindow: windowDoc.win,
  });

  // App-shell embedded document: pinned html/body + a 252px-tall scroller whose
  // content is 2568px (48px shell header + 6 x 420px bands).
  const shellScroller = makeElement("DIV", {
    scrollHeight: 2568,
    clientHeight: 252,
    offsetTop: 48,
    style: { "overflow-y": "auto" },
    rect: { left: 0, top: 48, right: 640, bottom: 300, width: 640, height: 252 },
  });
  const shellHeader = makeElement("HEADER", { scrollHeight: 48, clientHeight: 48 });
  const shellBody = makeElement("BODY", {
    clientHeight: 300,
    style: { "overflow-y": "hidden", height: "100%" },
    children: [shellHeader, shellScroller],
    rect: { left: 0, top: 0, right: 640, bottom: 300, width: 640, height: 300 },
  });
  const shellHtml = makeElement("HTML", {
    clientHeight: 300,
    style: { "overflow-y": "hidden", height: "100%" },
  });
  const shellWin = {
    innerHeight: 300,
    innerWidth: 640,
    getComputedStyle: (element) => ({
      overflowY: element.style.getPropertyValue("overflow-y") || "visible",
    }),
  };
  const shellDoc = {
    documentElement: shellHtml,
    body: shellBody,
    scrollingElement: shellHtml,
    defaultView: shellWin,
    querySelectorAll: () => [],
  };
  const frameShell = makeElement("IFRAME", {
    clientHeight: 300,
    contentDocument: shellDoc,
    contentWindow: shellWin,
  });

  // A cross-origin frame that cannot be inspected.
  const frameCross = makeElement("IFRAME", { clientHeight: 300, contentDocument: null });

  // A single gigantic embedded document that must be skipped, not expanded.
  // Its height exceeds the expansion cap (clientHeight × MAX_VIEWPORT_CAPTURES)
  // even as that cap grows, so the test stays meaningful if the limit changes.
  const expansionCap = sandbox.Scroll2PDFConstants.CAPTURE_LIMITS.MAX_VIEWPORT_CAPTURES;
  const giantDoc = makeInnerDoc({ scrollHeight: 300 * (expansionCap + 1), clientHeight: 300 });
  const frameGiant = makeElement("IFRAME", {
    clientHeight: 300,
    contentDocument: giantDoc.doc,
    contentWindow: giantDoc.win,
  });

  const topBody = makeElement("BODY", {
    scrollHeight: 1350,
    clientHeight: 800,
    style: { "overflow-y": "visible" },
    children: [frameWindow, frameShell, frameCross, frameGiant],
    rect: { left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 },
  });
  const topHtml = makeElement("HTML", {
    scrollHeight: 1350,
    clientHeight: 800,
    style: { "overflow-y": "visible" },
  });
  const topDoc = {
    documentElement: topHtml,
    body: topBody,
    scrollingElement: topHtml,
    defaultView: { innerHeight: 800, innerWidth: 1200, getComputedStyle: () => ({ overflowY: "visible" }) },
    querySelectorAll: (selector) => (selector === "iframe, frame"
      ? [frameWindow, frameShell, frameCross, frameGiant]
      : []),
  };

  const expansion = api.expandIframesForCapture({ root: topDoc });

  assert.equal(expansion.expandedCount, 2, "Both accessible embedded documents should be expanded.");
  assert.equal(expansion.crossOriginCount, 1, "The cross-origin frame should be counted as skipped.");
  assert.equal(expansion.skippedCount, 1, "The gigantic frame should be skipped rather than expanded.");
  assert.equal(frameWindow.style.getPropertyValue("height"), "2520px");
  assert.equal(frameShell.style.getPropertyValue("height"), "2616px");
  assert.equal(frameCross.style.getPropertyValue("height"), "", "Cross-origin frames must stay untouched.");
  assert.equal(frameGiant.style.getPropertyValue("height"), "", "Gigantic frames must stay untouched.");
  assert.equal(shellHtml.style.getPropertyValue("height"), "auto");
  assert.equal(shellScroller.style.getPropertyValue("overflow-y"), "visible");

  expansion.restore();

  assert.equal(frameWindow.style.getPropertyValue("height"), "");
  assert.equal(frameShell.style.getPropertyValue("height"), "");
  assert.equal(shellHtml.style.getPropertyValue("height"), "100%");
  assert.equal(shellBody.style.getPropertyValue("overflow-y"), "hidden");
  assert.equal(shellScroller.style.getPropertyValue("overflow-y"), "auto");
  assert.equal(shellScroller.style.getPropertyValue("height"), "");
  assert.equal(frameShell.clientHeight, 300);
  assert.equal(frameWindow.clientHeight, 300);

  // Restoring twice is harmless (best-effort rollback leaves styles stable).
  expansion.restore();
  assert.equal(frameWindow.style.getPropertyValue("height"), "");
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

  console.log(`\n${tests.length - failures}/${tests.length} tests passed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
