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
function loadDifficultUtils() {
  const sandbox = runScript("utils/constants.js", {});
  runScript("utils/capture-utils.js", sandbox);
  runScript("utils/difficult-page-utils.js", sandbox);
  return sandbox;
}

function makeElement(options = {}) {
  const attributes = { ...(options.attributes || {}) };
  const descendants = options.descendants || [];
  return {
    tagName: options.tagName || "DIV",
    id: options.id || "",
    role: attributes.role || "",
    scrollHeight: options.scrollHeight || 0,
    clientHeight: options.clientHeight || 0,
    clientWidth: options.clientWidth || 0,
    scrollTop: options.scrollTop || 0,
    isConnected: true,
    style: {},
    parentElement: options.parentElement || null,
    getAttribute(name) { return attributes[name] ?? null; },
    hasAttribute(name) { return Object.hasOwn(attributes, name); },
    getBoundingClientRect() {
      return options.rect || { left: 50, top: 80, right: 850, bottom: 680, width: 800, height: 600 };
    },
    querySelectorAll(selector) {
      if (selector === "*") return descendants;
      return descendants.filter((element) => {
        if (selector.includes("data-message-id") && element.hasAttribute?.("data-message-id")) return true;
        if (selector.includes("data-id") && element.hasAttribute?.("data-id")) return true;
        if (selector.includes("data-pre-plain-text") && element.hasAttribute?.("data-pre-plain-text")) return true;
        if (selector.includes("data-mid") && element.hasAttribute?.("data-mid")) return true;
        if (selector.includes('[role="listitem"]') && element.getAttribute?.("role") === "listitem") return true;
        if (selector.includes('[role="row"]') && element.getAttribute?.("role") === "row") return true;
        return false;
      });
    },
  };
}

function makeMutableStyle() {
  const values = new Map();
  return {
    getPropertyValue(name) { return values.get(name)?.value || ""; },
    getPropertyPriority(name) { return values.get(name)?.priority || ""; },
    setProperty(name, value, priority = "") { values.set(name, { value, priority }); },
    removeProperty(name) { values.delete(name); },
  };
}

function makeDifficultFixture(options = {}) {
  const attributes = new Map([["data-conversation-id", options.conversationId || "conversation-1"]]);
  const style = makeMutableStyle();
  const messages = Array.from({ length: 8 }, (_, index) => ({
    id: `message-${index + 20}`,
    isConnected: true,
    getAttribute() { return null; },
    getBoundingClientRect() { return { top: 100 + (index * 55), bottom: 145 + (index * 55), height: 45 }; },
  }));
  const images = options.images || [];
  const element = {
    id: "chat-scroll",
    isConnected: true,
    scrollTop: options.scrollTop ?? 2400,
    scrollHeight: options.scrollHeight ?? 3000,
    clientHeight: 600,
    clientWidth: 700,
    style,
    parentElement: null,
    getAttribute(name) { return attributes.get(name) || null; },
    hasAttribute(name) { return attributes.has(name); },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    getBoundingClientRect() { return { left: 100, top: 80, right: 800, bottom: 680, width: 700, height: 600 }; },
    querySelectorAll(selector) {
      if (selector === "img") return images;
      if (selector === "*") return messages;
      return messages;
    },
    querySelector(selector) {
      if (selector.includes("history-start")) return options.historyStart ? {} : null;
      if (selector.includes("aria-busy") || selector.includes("progressbar")) return options.loading ? {} : null;
      return null;
    },
    scrollTo({ top }) { this.scrollTop = Math.max(0, Math.min(Number(top) || 0, this.scrollHeight - this.clientHeight)); },
  };
  const appended = [];
  const document = {
    head: { appendChild(node) { appended.push(node); node.isConnected = true; } },
    createElement() { return { textContent: "", remove() { this.isConnected = false; } }; },
  };
  const location = { href: "https://chat.example.test/room", origin: "https://chat.example.test", pathname: "/room" };
  const window = {
    innerWidth: 1200,
    innerHeight: 800,
    getComputedStyle() { return { overflowY: "auto", display: "block", visibility: "visible", opacity: "1" }; },
  };
  return { attributes, appended, document, element, images, location, messages, style, window };
}

function loadDifficultCapture(extra = {}) {
  const sandbox = loadDifficultUtils();
  Object.assign(sandbox, extra);
  runScript("content/capture-stability.js", sandbox);
  runScript("content/difficult-page-capture.js", sandbox);
  return sandbox;
}

function loadFrameAnalysis() {
  const sandbox = loadDifficultUtils();
  runScript("offscreen/frame-analysis.js", sandbox);
  runScript("offscreen/seam-planner.js", sandbox);
  return sandbox;
}

function loadDynamicCoordinator() {
  const sandbox = loadDifficultUtils();
  sandbox.console = console;
  runScript("background/dynamic-region-capture.js", sandbox);
  return sandbox;
}

function loadAdapters() {
  const sandbox = loadDifficultUtils();
  sandbox.location = { hostname: "example.test", origin: "https://example.test", pathname: "/chat" };
  sandbox.window = {
    innerWidth: 1200,
    innerHeight: 800,
    getComputedStyle(element) {
      return element.__style || { overflowY: "auto", display: "block", visibility: "visible", opacity: "1" };
    },
  };
  sandbox.document = { documentElement: {}, body: {}, scrollingElement: null };
  runScript("content/adapters/generic-chat-adapter.js", sandbox);
  runScript("content/adapters/whatsapp-adapter.js", sandbox);
  runScript("content/adapters/telegram-adapter.js", sandbox);
  runScript("content/adapters/adapter-registry.js", sandbox);
  return sandbox;
}

test("anchor identity prefers stable attributes and does not use message text", () => {
  const { Scroll2PDFDifficultPageUtils: difficult } = loadDifficultUtils();
  assert.equal(difficult.getStableAnchorIdentity({ id: "message-42", text: "private words" }), "id:message-42");
  assert.equal(difficult.getStableAnchorIdentity({
    attributes: { "data-message-id": "8421", "data-id": "fallback" },
    text: "private words",
  }), "data-message-id:8421");
  assert.equal(difficult.getStableAnchorIdentity({
    attributes: { "aria-label": "Message 11:30" },
    structuralPath: "3/7",
    text: "private words",
  }), "aria-label:Message 11:30");
  assert.equal(difficult.getStableAnchorIdentity({ structuralPath: "3/7", text: "private words" }), "path:3/7");
  assert.equal(difficult.getStableAnchorIdentity({ sessionIdentity: "weak-9", text: "private words" }), "session:weak-9");
  assert.equal(difficult.getStableAnchorIdentity({ text: "private words" }), "");
});

test("matching anchor displacement measures content inserted above the viewport", () => {
  const { Scroll2PDFDifficultPageUtils: difficult } = loadDifficultUtils();
  const before = [
    { identity: "message:20", viewportY: 120 },
    { identity: "message:21", viewportY: 330 },
  ];
  const after = [
    { identity: "message:19", viewportY: 20 },
    { identity: "message:20", viewportY: 460 },
    { identity: "message:21", viewportY: 670 },
  ];
  assert.equal(difficult.calculateAnchorDisplacement(before, after), 340);
  assert.equal(difficult.calculateAnchorDisplacement(before, [{ identity: "other", viewportY: 1 }]), null);
});

test("virtualization is detected from bounded DOM size plus changing logical anchors", () => {
  const { Scroll2PDFDifficultPageUtils: difficult } = loadDifficultUtils();
  assert.equal(difficult.detectLikelyVirtualization({
    previous: { childCount: 30, scrollHeight: 2400, firstAnchor: "m180", lastAnchor: "m209", scrollPosition: 900 },
    current: { childCount: 31, scrollHeight: 2420, firstAnchor: "m150", lastAnchor: "m180", scrollPosition: 880 },
  }), true);
  assert.equal(difficult.detectLikelyVirtualization({
    previous: { childCount: 30, scrollHeight: 2400, firstAnchor: "m1", lastAnchor: "m30", scrollPosition: 0 },
    current: { childCount: 60, scrollHeight: 4800, firstAnchor: "m1", lastAnchor: "m60", scrollPosition: 0 },
  }), false);
});

test("logical frame ordering is oldest-to-newest regardless of traversal direction", () => {
  const { Scroll2PDFDifficultPageUtils: difficult } = loadDifficultUtils();
  const captured = [
    { id: "newest", traversalOrdinal: 0 },
    { id: "middle", traversalOrdinal: 1 },
    { id: "oldest", traversalOrdinal: 2 },
  ];
  assert.deepEqual(
    Array.from(difficult.orderFrameChain(captured, "upward"), (frame) => frame.id),
    ["oldest", "middle", "newest"],
  );
  assert.deepEqual(
    Array.from(difficult.orderFrameChain(captured, "downward"), (frame) => frame.id),
    ["newest", "middle", "oldest"],
  );
});

test("repeated viewport states request one recovery before declaring a virtualized loop", () => {
  const { Scroll2PDFDifficultPageUtils: difficult } = loadDifficultUtils();
  const tracker = difficult.createRepeatedStateTracker({ repeatLimit: 3, historyLimit: 4 });
  assert.equal(tracker.observe("state-a"), "progress");
  assert.equal(tracker.observe("state-a"), "recover");
  assert.equal(tracker.observe("state-a"), "recover");
  assert.equal(tracker.observe("state-a"), "stuck");
  assert.equal(tracker.observe("state-b"), "progress");
  assert.equal(tracker.size(), 2);
  tracker.observe("state-c");
  tracker.observe("state-d");
  tracker.observe("state-e");
  assert.equal(tracker.size(), 4);
});

test("capture context detects navigation or conversation changes but ignores scroll changes", () => {
  const { Scroll2PDFDifficultPageUtils: difficult } = loadDifficultUtils();
  const initial = difficult.createCaptureContext({
    url: "https://web.example.test/chat/room",
    scrollerIdentity: "scroll:main",
    conversationIdentity: "conversation:7",
  });
  assert.equal(difficult.captureContextChanged(initial, difficult.createCaptureContext({
    url: "https://web.example.test/chat/room#bottom",
    scrollerIdentity: "scroll:main",
    conversationIdentity: "conversation:7",
  })), false);
  assert.equal(difficult.captureContextChanged(initial, difficult.createCaptureContext({
    url: "https://web.example.test/chat/other",
    scrollerIdentity: "scroll:main",
    conversationIdentity: "conversation:7",
  })), true);
  assert.equal(difficult.captureContextChanged(initial, difficult.createCaptureContext({
    url: "https://web.example.test/chat/room",
    scrollerIdentity: "scroll:main",
    conversationIdentity: "conversation:8",
  })), true);
});

test("small dynamic geometry changes normalize to a safe common crop", () => {
  const { Scroll2PDFDifficultPageUtils: difficult } = loadDifficultUtils();
  const normalized = difficult.normalizeDynamicCrop({
    original: { left: 100, top: 50, right: 600, bottom: 450, width: 500, height: 400 },
    current: { left: 102, top: 48, right: 598, bottom: 452, width: 496, height: 404 },
    minimumTolerance: 8,
    ratioTolerance: 0.04,
  });
  assert.equal(JSON.stringify(normalized), JSON.stringify({
    left: 102, top: 50, right: 598, bottom: 450, width: 496, height: 400,
  }));
  assert.throws(() => difficult.normalizeDynamicCrop({
    original: { left: 100, top: 50, right: 600, bottom: 450, width: 500, height: 400 },
    current: { left: 150, top: 50, right: 550, bottom: 350, width: 400, height: 300 },
    minimumTolerance: 8,
    ratioTolerance: 0.04,
  }), /changed too much/i);
});

test("difficult traversal budget allows long chats but stops frames and duration", () => {
  const { Scroll2PDFDifficultPageUtils: difficult } = loadDifficultUtils();
  assert.doesNotThrow(() => difficult.validateTraversalBudget({ frameCount: 300, elapsedMs: 600000 }));
  assert.throws(() => difficult.validateTraversalBudget({ frameCount: 301, elapsedMs: 1 }), /300-frame safety limit/i);
  assert.throws(() => difficult.validateTraversalBudget({ frameCount: 1, elapsedMs: 600001 }), /10-minute safety limit/i);
});

test("WhatsApp wrapper hover redirects to a structural message scroller and still requires confirmation", () => {
  const sandbox = loadAdapters();
  const messages = Array.from({ length: 12 }, (_, index) => makeElement({
    attributes: { "data-id": `false_100_${index}` },
  }));
  const scroller = makeElement({
    scrollHeight: 4800, clientHeight: 600, clientWidth: 800, scrollTop: 4200,
    attributes: { role: "application" }, descendants: messages,
  });
  const wrapper = makeElement({ descendants: [scroller] });
  const target = sandbox.Scroll2PDFAdapterRegistry.resolveTarget([wrapper], {
    hostname: "web.whatsapp.com",
    fallbackResolver: () => null,
  });
  assert.equal(target.element, scroller);
  assert.equal(target.label, "WhatsApp Chat");
  assert.equal(target.adapterId, "whatsapp");
  assert.equal(target.captureDirection, "upward");
  assert.equal(target.requiresConfirmation, true);
  assert.equal(target.difficult, true);
});

test("Telegram adapter recognizes both data-message and listitem structural variants", () => {
  const sandbox = loadAdapters();
  const webKMessages = Array.from({ length: 9 }, (_, index) => makeElement({
    attributes: { "data-mid": String(100 + index) },
  }));
  const webKScroller = makeElement({
    scrollHeight: 3600, clientHeight: 600, clientWidth: 720, scrollTop: 3000,
    attributes: { role: "list" }, descendants: webKMessages,
  });
  const webK = sandbox.Scroll2PDFAdapterRegistry.resolveTarget(
    [makeElement({ descendants: [webKScroller] })],
    { hostname: "web.telegram.org", pathname: "/k/", fallbackResolver: () => null },
  );
  assert.equal(webK.element, webKScroller);
  assert.equal(webK.label, "Telegram Chat");
  assert.equal(webK.adapterId, "telegram");
  assert.equal(webK.captureDirection, "downward");
  assert.equal(webK.naturalOrder, "top-to-bottom");
  assert.equal(webK.difficult, false);

  const webAMessages = Array.from({ length: 10 }, () => makeElement({ attributes: { role: "listitem" } }));
  const webAScroller = makeElement({
    scrollHeight: 4200, clientHeight: 600, clientWidth: 720, scrollTop: 3600,
    attributes: { "aria-label": "Message history" }, descendants: webAMessages,
  });
  const webA = sandbox.Scroll2PDFAdapterRegistry.resolveTarget(
    [makeElement({ descendants: [webAScroller] })],
    { hostname: "web.telegram.org", pathname: "/a/", fallbackResolver: () => null },
  );
  assert.equal(webA.element, webAScroller);
  assert.equal(webA.label, "Telegram Chat");
  assert.equal(webA.captureDirection, "downward");
  assert.equal(webA.difficult, false);
});

test("edge hit testing finds visible chat chrome omitted by a bounded DOM sample", () => {
  const regionRect = { left: 100, top: 80, right: 800, bottom: 680, width: 700, height: 600 };
  const header = makeElement({
    rect: { left: 100, top: 116, right: 800, bottom: 170, width: 700, height: 54 },
  });
  const headerButton = makeElement({
    rect: { left: 740, top: 126, right: 780, bottom: 160, width: 40, height: 34 },
    parentElement: header,
  });
  const composer = makeElement({
    rect: { left: 100, top: 586, right: 800, bottom: 644, width: 700, height: 58 },
  });
  const composerInput = makeElement({
    rect: { left: 160, top: 598, right: 720, bottom: 632, width: 560, height: 34 },
    parentElement: composer,
  });
  const document = {
    elementsFromPoint(x, y) {
      if (y >= 116 && y <= 170) return x > 700 ? [headerButton, header] : [header];
      if (y >= 586 && y <= 644) return x > 120 ? [composerInput, composer] : [composer];
      return [];
    },
  };
  const sandbox = loadDifficultCapture({ document });
  const ordinaryFound = sandbox.Scroll2PDFCaptureStability.collectRegionEdgeHitElements(regionRect, { document });
  assert.equal(ordinaryFound.includes(header), false);
  assert.equal(ordinaryFound.includes(composer), false);
  assert.equal(sandbox.Scroll2PDFCaptureStability.classifyChromeEdgeBar({
    rect: header.getBoundingClientRect(), regionRect,
  }), null);
  assert.equal(sandbox.Scroll2PDFCaptureStability.classifyChromeEdgeBar({
    rect: composer.getBoundingClientRect(), regionRect,
  }), null);
  const chatFound = sandbox.Scroll2PDFCaptureStability.collectRegionEdgeHitElements(regionRect, {
    document, edgeToleranceCss: 40,
  });
  assert.equal(chatFound.includes(header), true);
  assert.equal(chatFound.includes(composer), true);
  assert.equal(sandbox.Scroll2PDFCaptureStability.classifyChromeEdgeBar({
    rect: header.getBoundingClientRect(), regionRect, edgeToleranceCss: 40,
  }), "top");
  assert.equal(sandbox.Scroll2PDFCaptureStability.classifyChromeEdgeBar({
    rect: composer.getBoundingClientRect(), regionRect, edgeToleranceCss: 40,
  }), "bottom");
});

test("interactive chat preparation hides bottom chrome despite legacy difficult metadata", async () => {
  const sandbox = loadDifficultUtils();
  const listeners = {};
  const scrollerStyle = makeMutableStyle();
  const composerStyle = makeMutableStyle();
  const rootStyle = makeMutableStyle();
  const bodyStyle = makeMutableStyle();
  const regionRect = { left: 100, top: 80, right: 800, bottom: 680, width: 700, height: 600 };
  const scroller = {
    tagName: "DIV", isConnected: true,
    scrollTop: 900, scrollHeight: 3000, clientHeight: 600, clientWidth: 700,
    style: scrollerStyle, parentElement: null,
    getBoundingClientRect() { return regionRect; },
    scrollTo({ top }) { this.scrollTop = Number(top) || 0; },
  };
  const composer = {
    tagName: "DIV", className: "composer", style: composerStyle,
    parentElement: null,
    getAttribute() { return null; },
    closest() { return null; },
    getBoundingClientRect() {
      return { left: 100, top: 586, right: 800, bottom: 644, width: 700, height: 58 };
    },
  };
  const documentElement = { style: rootStyle };
  const body = { style: bodyStyle };
  const document = {
    documentElement, body, scrollingElement: documentElement,
    head: { appendChild() {} },
    createElement() { return { textContent: "", remove() {} }; },
    elementsFromPoint() { return [composer, scroller]; },
    querySelectorAll() { return [scroller, composer]; },
  };
  const windowValue = {
    innerWidth: 1000, innerHeight: 800,
    getComputedStyle(element) {
      if (element === scroller) {
        return { overflowY: "auto", display: "block", visibility: "visible", opacity: "1", position: "relative", backgroundColor: "rgb(0, 0, 0)" };
      }
      return { overflowY: "visible", display: "flex", visibility: "visible", opacity: "1", position: "sticky", backgroundColor: "rgb(30, 30, 30)" };
    },
  };
  Object.assign(sandbox, { document, window: windowValue });
  sandbox.Scroll2PDFPageCapture = { async settlePage() {} };
  sandbox.Scroll2PDFSelectionOverlay = {
    createOneShotOutcome(callback) {
      let settled = false;
      return { settle(value) { if (settled) return false; settled = true; callback(value); return true; } };
    },
    createSelectionOverlay() {
      return {
        host: {}, surface: {}, setRect() {}, clearRect() {}, cleanup() {},
        cleanupBag: { listen(target, type, listener) { listeners[type] = listener; } },
      };
    },
  };
  sandbox.Scroll2PDFAdapterRegistry = {
    resolveTarget() {
      return {
        element: scroller, contentRoot: scroller, adapterId: "whatsapp",
        label: "WhatsApp Chat", captureDirection: "upward", difficult: true,
        requiresConfirmation: true,
      };
    },
  };
  runScript("content/capture-stability.js", sandbox);
  runScript("content/scrollable-selection.js", sandbox);
  const selection = sandbox.Scroll2PDFScrollableSelection.startSelection("legacy-chat");
  listeners.pointermove({ clientX: 300, clientY: 300 });
  listeners.click({ preventDefault() {}, stopPropagation() {} });
  await selection;
  await sandbox.Scroll2PDFScrollableSelection.prepareCapture("legacy-chat");
  assert.equal(composerStyle.getPropertyValue("visibility"), "hidden");
  await sandbox.Scroll2PDFScrollableSelection.restoreCapture("legacy-chat");
  assert.equal(composerStyle.getPropertyValue("visibility"), "");
});

test("generic semantic chat is labeled without claiming a site adapter", () => {
  const sandbox = loadAdapters();
  const messages = Array.from({ length: 8 }, (_, index) => makeElement({
    attributes: { "data-message-id": String(index) },
  }));
  const chat = makeElement({
    scrollHeight: 3000, clientHeight: 600, clientWidth: 700, scrollTop: 2400,
    attributes: { role: "log" }, descendants: messages,
  });
  const target = sandbox.Scroll2PDFAdapterRegistry.resolveTarget([chat], {
    hostname: "chat.example.test",
    fallbackResolver: () => null,
  });
  assert.equal(target.element, chat);
  assert.equal(target.label, "Chat / scrollable area");
  assert.equal(target.adapterId, "generic-chat");
  assert.equal(target.captureDirection, "upward");
});

test("uncertain or failing adapters preserve ordinary manual selection fallback", () => {
  const sandbox = loadAdapters();
  const ordinary = makeElement({ scrollHeight: 1600, clientHeight: 500, clientWidth: 500 });
  const fallback = () => ordinary;
  const uncertain = sandbox.Scroll2PDFAdapterRegistry.resolveTarget([ordinary], {
    hostname: "web.whatsapp.com",
    fallbackResolver: fallback,
  });
  assert.equal(uncertain.element, ordinary);
  assert.equal(uncertain.label, "Scrollable area");
  assert.equal(uncertain.adapterId, "generic-scrollable");
  assert.equal(uncertain.difficult, false);

  const failed = sandbox.Scroll2PDFAdapterRegistry.resolveTarget([ordinary], {
    hostname: "web.whatsapp.com",
    fallbackResolver: fallback,
    adapters: [{ id: "broken", detect() { throw new Error("site changed"); } }],
  });
  assert.equal(failed.element, ordinary);
  assert.equal(failed.adapterId, "generic-scrollable");
});

test("Scrollable Area selection resolves and labels the adapter target without auto-confirming it", () => {
  const sandbox = loadAdapters();
  sandbox.Scroll2PDFSelectionOverlay = {};
  sandbox.Scroll2PDFPageCapture = {};
  const messages = Array.from({ length: 10 }, (_, index) => makeElement({
    attributes: { "data-message-id": String(index + 1) },
  }));
  const scroller = makeElement({
    scrollHeight: 4000, clientHeight: 600, clientWidth: 760, scrollTop: 3400,
    attributes: { role: "log" }, descendants: messages,
  });
  const wrapper = makeElement({ descendants: [scroller] });
  runScript("content/scrollable-selection.js", sandbox);
  const target = sandbox.Scroll2PDFScrollableSelection.resolveSelectionTargetFromPath([wrapper], {
    hostname: "web.telegram.org",
  });
  assert.equal(target.element, scroller);
  assert.equal(target.label, "Telegram Chat");
  assert.equal(target.requiresConfirmation, true);
});

test("difficult session starts at the current newest viewport and applies scoped capture stability", async () => {
  const fixture = makeDifficultFixture();
  let observerDisconnected = false;
  class FakeObserver {
    observe() {}
    disconnect() { observerDisconnected = true; }
  }
  const sandbox = loadDifficultCapture({ MutationObserver: FakeObserver });
  const controller = sandbox.Scroll2PDFDifficultPageCapture.createController({
    captureId: "dynamic-1",
    element: fixture.element,
    contentRoot: fixture.element,
    target: { adapterId: "generic-chat", label: "Chat / scrollable area", captureDirection: "upward" },
    document: fixture.document,
    window: fixture.window,
    location: fixture.location,
    settlePage: async () => {},
    wait: async () => {},
  });
  const prepared = await controller.prepare();
  assert.equal(fixture.element.scrollTop, 2400);
  assert.equal(prepared.metrics.captureDirection, "upward");
  assert.equal(prepared.metrics.difficult, true);
  assert.equal(prepared.metrics.anchors[0].identity, "id:message-20");
  assert.equal(fixture.attributes.has("data-scroll2pdf-capture-root"), true);
  assert.match(fixture.appended[0].textContent, /animation-duration/);
  await controller.restore();
  assert.equal(fixture.attributes.has("data-scroll2pdf-capture-root"), false);
  assert.equal(observerDisconnected, true);
});

test("overlay classification suppresses app chrome but preserves message-sized content", () => {
  const sandbox = loadDifficultCapture();
  const classify = sandbox.Scroll2PDFCaptureStability.classifyRepeatedOverlay;
  assert.equal(classify({
    position: "fixed", role: "button", ariaLabel: "Jump to bottom",
    rect: { top: 620, bottom: 660, width: 44, height: 40 },
    regionRect: { top: 80, bottom: 680, width: 700, height: 600 },
  }), "app-chrome");
  assert.equal(classify({
    position: "sticky", role: "", ariaLabel: "Monday",
    rect: { top: 80, bottom: 112, width: 120, height: 32 },
    regionRect: { top: 80, bottom: 680, width: 700, height: 600 },
  }), "content-sticky");
  assert.equal(classify({
    position: "sticky", role: "listitem", ariaLabel: "",
    rect: { top: 130, bottom: 430, width: 600, height: 300 },
    regionRect: { top: 80, bottom: 680, width: 700, height: 600 },
  }), "content");
});

test("history settling recognizes prepended content through height and anchor displacement", async () => {
  const fixture = makeDifficultFixture({ scrollTop: 0, scrollHeight: 3000 });
  let waited = false;
  const sandbox = loadDifficultCapture({ MutationObserver: class { observe() {} disconnect() {} } });
  const controller = sandbox.Scroll2PDFDifficultPageCapture.createController({
    captureId: "dynamic-load",
    element: fixture.element,
    contentRoot: fixture.element,
    target: { adapterId: "generic-chat", label: "Chat", captureDirection: "upward" },
    document: fixture.document,
    window: fixture.window,
    location: fixture.location,
    settlePage: async () => {},
    wait: async () => {
      if (waited) return;
      waited = true;
      fixture.element.scrollHeight = 3600;
      fixture.element.scrollTop = 600;
      for (const message of fixture.messages) {
        const original = message.getBoundingClientRect;
        message.getBoundingClientRect = () => {
          const rect = original();
          return { ...rect, top: rect.top + 600, bottom: rect.bottom + 600 };
        };
      }
    },
  });
  await controller.prepare();
  const result = await controller.loadOlderHistory();
  assert.equal(result.loaded, true);
  assert.equal(result.complete, false);
  assert.equal(result.anchorDisplacement, 600);
  assert.equal(result.metrics.scrollHeight, 3600);
  await controller.restore();
});

test("three stable top-boundary history attempts finish without waiting forever", async () => {
  const fixture = makeDifficultFixture({ scrollTop: 0 });
  const sandbox = loadDifficultCapture({ MutationObserver: class { observe() {} disconnect() {} } });
  const controller = sandbox.Scroll2PDFDifficultPageCapture.createController({
    captureId: "dynamic-stable",
    element: fixture.element,
    contentRoot: fixture.element,
    target: { adapterId: "generic-chat", label: "Chat", captureDirection: "upward" },
    document: fixture.document,
    window: fixture.window,
    location: fixture.location,
    settlePage: async () => {},
    wait: async () => {},
  });
  await controller.prepare();
  assert.equal((await controller.loadOlderHistory()).complete, false);
  assert.equal((await controller.loadOlderHistory()).complete, false);
  assert.equal((await controller.loadOlderHistory()).complete, true);
  await controller.restore();
});

test("history mutation waiting accepts content that arrives after the initial stable checks", async () => {
  const fixture = makeDifficultFixture({ scrollTop: 0, scrollHeight: 3000 });
  let checks = 0;
  const sandbox = loadDifficultCapture({ MutationObserver: class { observe() {} disconnect() {} } });
  const controller = sandbox.Scroll2PDFDifficultPageCapture.createController({
    captureId: "dynamic-delayed-load",
    element: fixture.element,
    contentRoot: fixture.element,
    target: { adapterId: "generic-chat", label: "Chat", captureDirection: "upward" },
    document: fixture.document,
    window: fixture.window,
    location: fixture.location,
    settlePage: async () => {},
    wait: async () => {
      checks += 1;
      if (checks === 10) {
        fixture.element.scrollHeight = 3300;
        fixture.element.scrollTop = 300;
      }
    },
  });
  await controller.prepare();
  const result = await controller.loadOlderHistory();
  assert.equal(result.loaded, true);
  assert.equal(result.complete, false);
  assert.equal(checks, 10);
  await controller.restore();
});

test("difficult session aborts on conversation change and restores the original viewport", async () => {
  const fixture = makeDifficultFixture();
  const sandbox = loadDifficultCapture({ MutationObserver: class { observe() {} disconnect() {} } });
  const controller = sandbox.Scroll2PDFDifficultPageCapture.createController({
    captureId: "dynamic-context",
    element: fixture.element,
    contentRoot: fixture.element,
    target: { adapterId: "generic-chat", label: "Chat", captureDirection: "upward" },
    document: fixture.document,
    window: fixture.window,
    location: fixture.location,
    settlePage: async () => {},
    wait: async () => {},
  });
  await controller.prepare();
  fixture.element.scrollTop = 1200;
  fixture.attributes.set("data-conversation-id", "conversation-2");
  assert.throws(() => controller.getMetrics(), /conversation changed/i);
  await controller.restore();
  assert.equal(fixture.element.scrollTop, 2400);
});

test("downsampled visual fingerprints distinguish different rendered viewports", () => {
  const sandbox = loadFrameAnalysis();
  const pixels = new Uint8ClampedArray(8 * 8 * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = 40;
    pixels[index + 1] = 90;
    pixels[index + 2] = 150;
    pixels[index + 3] = 255;
  }
  const identical = pixels.slice();
  const changed = pixels.slice();
  for (let index = 0; index < changed.length / 2; index += 4) changed[index] = 240;
  const analysis = sandbox.Scroll2PDFFrameAnalysis;
  const first = analysis.createVisualFingerprint({ data: pixels, width: 8, height: 8, sampleWidth: 4, sampleHeight: 4 });
  const second = analysis.createVisualFingerprint({ data: identical, width: 8, height: 8, sampleWidth: 4, sampleHeight: 4 });
  const third = analysis.createVisualFingerprint({ data: changed, width: 8, height: 8, sampleWidth: 4, sampleHeight: 4 });
  assert.equal(first.hash, second.hash);
  assert.equal(analysis.normalizedSampleDifference(first.samples, second.samples), 0);
  assert.ok(analysis.normalizedSampleDifference(first.samples, third.samples) > 0.05);
});

test("row-signature seam matching finds the exact duplicated overlap", () => {
  const { Scroll2PDFSeamPlanner: seams } = loadFrameAnalysis();
  const upperRows = Array.from({ length: 100 }, (_, row) => [row, row + 1, row + 2]);
  const lowerRows = Array.from({ length: 100 }, (_, row) => [row + 70, row + 71, row + 72]);
  const match = seams.findMatchingSeam({
    upperRows,
    lowerRows,
    predictedOverlap: 24,
    searchRadius: 12,
    comparisonRows: 16,
  });
  assert.equal(match.overlap, 30);
  assert.equal(match.matched, true);
  assert.equal(match.difference, 0);
});

test("seam matching falls back to logical overlap when visuals have no convincing match", () => {
  const { Scroll2PDFSeamPlanner: seams } = loadFrameAnalysis();
  const upperRows = Array.from({ length: 80 }, (_, row) => [row % 2 ? 10 : 240]);
  const lowerRows = Array.from({ length: 80 }, (_, row) => [120 + (row % 3)]);
  const match = seams.findMatchingSeam({
    upperRows,
    lowerRows,
    predictedOverlap: 20,
    searchRadius: 8,
    comparisonRows: 10,
  });
  assert.equal(match.overlap, 20);
  assert.equal(match.matched, false);
});

test("frame-chain plan trims seams once and produces continuous destination bands", () => {
  const { Scroll2PDFSeamPlanner: seams } = loadFrameAnalysis();
  const plan = seams.buildFrameChainPlan([
    { id: "old", cropHeight: 100 },
    { id: "middle", cropHeight: 100, overlapWithPrevious: 30 },
    { id: "new", cropHeight: 100, overlapWithPrevious: 20 },
  ]);
  assert.equal(JSON.stringify(plan.frames), JSON.stringify([
    { id: "old", sourceY: 0, sourceHeight: 100, destinationY: 0 },
    { id: "middle", sourceY: 30, sourceHeight: 70, destinationY: 100 },
    { id: "new", sourceY: 20, sourceHeight: 80, destinationY: 170 },
  ]));
  assert.equal(plan.height, 250);
});

test("dynamic coordinator captures upward, loads prepended history, and requests natural frame ordering", async () => {
  const sandbox = loadDynamicCoordinator();
  const messages = [];
  const metrics = [
    { difficult: true, captureDirection: "upward", captureModeLabel: "Chat", cropRectCss: { left: 10, top: 20, width: 300, height: 200 }, viewportCssWidth: 800, viewportCssHeight: 600, scrollTop: 400, scrollHeight: 600, clientHeight: 200, anchors: [{ identity: "m5", viewportY: 50 }], atHistoryBoundary: false },
    { difficult: true, captureDirection: "upward", captureModeLabel: "Chat", cropRectCss: { left: 10, top: 20, width: 300, height: 200 }, viewportCssWidth: 800, viewportCssHeight: 600, scrollTop: 244, scrollHeight: 600, clientHeight: 200, anchors: [{ identity: "m3", viewportY: 50 }], atHistoryBoundary: false },
    { difficult: true, captureDirection: "upward", captureModeLabel: "Chat", cropRectCss: { left: 10, top: 20, width: 300, height: 200 }, viewportCssWidth: 800, viewportCssHeight: 600, scrollTop: 0, scrollHeight: 600, clientHeight: 200, anchors: [{ identity: "m1", viewportY: 50 }], atHistoryBoundary: true },
    { difficult: true, captureDirection: "upward", captureModeLabel: "Chat", cropRectCss: { left: 10, top: 20, width: 300, height: 200 }, viewportCssWidth: 800, viewportCssHeight: 600, scrollTop: 300, scrollHeight: 900, clientHeight: 200, anchors: [{ identity: "m1", viewportY: 350 }], atHistoryBoundary: false },
    { difficult: true, captureDirection: "upward", captureModeLabel: "Chat", cropRectCss: { left: 10, top: 20, width: 300, height: 200 }, viewportCssWidth: 800, viewportCssHeight: 600, scrollTop: 144, scrollHeight: 900, clientHeight: 200, anchors: [{ identity: "old-2", viewportY: 50 }], atHistoryBoundary: false },
    { difficult: true, captureDirection: "upward", captureModeLabel: "Chat", cropRectCss: { left: 10, top: 20, width: 300, height: 200 }, viewportCssWidth: 800, viewportCssHeight: 600, scrollTop: 0, scrollHeight: 900, clientHeight: 200, anchors: [{ identity: "oldest", viewportY: 50 }], atHistoryBoundary: true, historyStart: true },
  ];
  let index = 0;
  const added = [];
  const operation = {
    captureId: "dynamic-1", tabId: 1, windowId: 2, startedAt: 1000,
    configuration: { quality: "high", captureMode: "scrollable-area" },
    completed: 0, cancelRequested: false,
    async report(update) { messages.push(update.message); },
  };
  const result = await sandbox.Scroll2PDFDynamicRegionCapture.executeDynamicCapture(operation, {
    now: () => 2000,
    delay: async () => {},
    assertTargetActive: async () => {},
    captureVisibleTab: async () => `data:image/png;base64,frame-${index}`,
    async sendTabMessage(_tabId, message) {
      if (message.type === "SET_REGION_OVERLAYS_HIDDEN") return { ok: true };
      if (message.type === "ADVANCE_DIFFICULT_CAPTURE") return { ok: true, metrics: metrics[++index] };
      if (message.type === "LOAD_OLDER_HISTORY") return { ok: true, loaded: true, complete: false, metrics: metrics[++index] };
      throw new Error(`Unexpected tab message ${message.type}`);
    },
    async sendOffscreen(message) {
      if (message.type === "OFFSCREEN_ADD_CAPTURE") {
        added.push(message.payload.frame);
        return { ok: true, fingerprint: `fingerprint-${index}` };
      }
      if (message.type === "OFFSCREEN_STITCH_CAPTURE") {
        assert.equal(message.payload.dynamicFrameChain, true);
        assert.equal(message.payload.captureDirection, "upward");
        return { ok: true, result: { resultId: "result-1", height: 900, width: 300 } };
      }
      throw new Error(`Unexpected offscreen message ${message.type}`);
    },
  }, metrics[0], { filename: "capture.png", captureModeLabel: "Chat" });
  assert.equal(result.resultId, "result-1");
  assert.equal(added.length, 5);
  assert.deepEqual(Array.from(added, (frame) => frame.traversalOrdinal), [0, 1, 2, 3, 4]);
  assert.ok(messages.some((message) => /Loading older messages/.test(message)));
  assert.ok(messages.some((message) => /Capturing chat/.test(message)));
});

test("dynamic coordinator drops a repeated frame, performs bounded recovery, and remains cancellable", async () => {
  const sandbox = loadDynamicCoordinator();
  const initial = { difficult: true, captureDirection: "upward", cropRectCss: { left: 0, top: 0, width: 300, height: 200 }, viewportCssWidth: 800, viewportCssHeight: 600, scrollTop: 200, scrollHeight: 400, clientHeight: 200, anchors: [], atHistoryBoundary: false };
  let captures = 0;
  let recoveries = 0;
  let drops = 0;
  const operation = { captureId: "repeat", tabId: 1, windowId: 2, startedAt: 0, configuration: { quality: "high", captureMode: "scrollable-area" }, completed: 0, cancelRequested: false, report: async () => {} };
  await assert.rejects(() => sandbox.Scroll2PDFDynamicRegionCapture.executeDynamicCapture(operation, {
    now: () => 1,
    delay: async () => {}, assertTargetActive: async () => {}, captureVisibleTab: async () => { captures += 1; return "data:image/png;base64,x"; },
    async sendTabMessage(_id, message) {
      if (message.type === "SET_REGION_OVERLAYS_HIDDEN") return { ok: true };
      if (message.type === "ADVANCE_DIFFICULT_CAPTURE") return { ok: true, metrics: initial };
      if (message.type === "RECOVER_DIFFICULT_CAPTURE") { recoveries += 1; return { ok: true, metrics: initial }; }
      throw new Error(message.type);
    },
    async sendOffscreen(message) {
      if (message.type === "OFFSCREEN_ADD_CAPTURE") return { ok: true, fingerprint: "same" };
      if (message.type === "OFFSCREEN_DROP_LAST_CAPTURE") { drops += 1; return { ok: true }; }
      throw new Error(message.type);
    },
  }, initial, { filename: "x.png", captureModeLabel: "Chat" }), /repeating virtualized view/i);
  assert.equal(recoveries, 1);
  assert.ok(drops >= 1);
  assert.ok(captures >= 3);
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
      console.error(`  ${error.stack || error.message}`);
    }
  }
  console.log(`\n${tests.length - failures}/${tests.length} Stage 5 tests passed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
