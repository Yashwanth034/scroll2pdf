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

function loadCore() {
  const file = path.join(projectRoot, "result/editor-core.js");
  assert.equal(fs.existsSync(file), true, "The image editor core is not implemented.");
  const sandbox = { globalThis: null };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  new vm.Script(read("result/editor-core.js"), { filename: "result/editor-core.js" }).runInContext(sandbox);
  return sandbox.Scroll2PDFEditorCore;
}

function loadRenderer(overrides = {}) {
  const file = path.join(projectRoot, "result/editor-renderer.js");
  assert.equal(fs.existsSync(file), true, "The image editor renderer is not implemented.");
  const sandbox = { globalThis: null, Blob, ...overrides };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const script of [
    "utils/constants.js",
    "utils/capture-utils.js",
    "result/editor-core.js",
    "result/editor-renderer.js",
  ]) {
    new vm.Script(read(script), { filename: script }).runInContext(sandbox);
  }
  return sandbox;
}

test("image editor document starts as one exact immutable source segment", () => {
  const core = loadCore();
  const document = core.createDocument({ width: 1200, height: 4800, mimeType: "image/png" });

  assert.equal(JSON.stringify(document), JSON.stringify({
    width: 1200,
    height: 4800,
    sourceWidth: 1200,
    sourceHeight: 4800,
    mimeType: "image/png",
    segments: [{
      kind: "source",
      sourceX: 0,
      sourceY: 0,
      width: 1200,
      height: 4800,
    }],
    annotations: [],
  }));
  assert.equal(Object.isFrozen(document), true);
  assert.equal(Object.isFrozen(document.segments), true);
});

test("preview pointer coordinates map and clamp to native document pixels", () => {
  const core = loadCore();
  assert.equal(JSON.stringify(core.previewPointToDocument(
    { clientX: 310, clientY: 220 },
    { left: 10, top: 20 },
    0.5,
    { width: 1200, height: 4800 },
  )), JSON.stringify({ x: 600, y: 400 }));
  assert.equal(JSON.stringify(core.previewPointToDocument(
    { clientX: -50, clientY: 5000 },
    { left: 10, top: 20 },
    0.5,
    { width: 1200, height: 4800 },
  )), JSON.stringify({ x: 0, y: 4800 }));
});

test("editor revision state distinguishes edited content from unexported work", () => {
  const core = loadCore();
  const original = core.createDocument({ width: 800, height: 1200, mimeType: "image/png" });
  const session = core.createSession(original);
  assert.equal(JSON.stringify(session.getState()), JSON.stringify({
    document: original,
    modified: false,
    unexported: false,
    canUndo: false,
    canRedo: false,
  }));

  const firstEdit = core.replaceAnnotations(original, [{ id: "arrow-1", type: "arrow" }]);
  session.commit(firstEdit);
  assert.equal(session.getState().modified, true);
  assert.equal(session.getState().unexported, true);
  assert.equal(session.getState().canUndo, true);

  session.markExported();
  assert.equal(session.getState().modified, true);
  assert.equal(session.getState().unexported, false);

  const secondEdit = core.replaceAnnotations(firstEdit, [
    { id: "arrow-1", type: "arrow" },
    { id: "text-1", type: "text" },
  ]);
  session.commit(secondEdit);
  assert.equal(session.getState().unexported, true);
  session.undo();
  assert.equal(session.getState().unexported, false);
  session.redo();
  assert.equal(session.getState().unexported, true);
  session.reset();
  assert.equal(session.getState().modified, false);
  assert.equal(session.getState().unexported, false);
});

test("editor history keeps only the configured number of reversible commands", () => {
  const core = loadCore();
  const original = core.createDocument({ width: 400, height: 600, mimeType: "image/jpeg" });
  const session = core.createSession(original, { maxCommands: 2 });
  const a = core.replaceAnnotations(original, [{ id: "a" }]);
  const b = core.replaceAnnotations(original, [{ id: "b" }]);
  const c = core.replaceAnnotations(original, [{ id: "c" }]);
  session.commit(a);
  session.commit(b);
  session.commit(c);

  assert.equal(session.undo().annotations[0].id, "b");
  assert.equal(session.undo().annotations[0].id, "a");
  assert.equal(session.getState().canUndo, false);
});

test("renderer maps a document region to exact source rows", () => {
  const sandbox = loadRenderer();
  const document = sandbox.Scroll2PDFEditorCore.createDocument({
    width: 800,
    height: 1200,
    mimeType: "image/png",
  });
  assert.equal(JSON.stringify(
    sandbox.Scroll2PDFEditorRenderer.buildRenderCommands(document, {
      left: 0, top: 300, width: 800, height: 400,
    }),
  ), JSON.stringify([{
    kind: "source",
    sourceX: 0,
    sourceY: 300,
    sourceWidth: 800,
    sourceHeight: 400,
    destinationX: 0,
    destinationY: 300,
    destinationWidth: 800,
    destinationHeight: 400,
  }]));
});

test("renderer exports the requested image type and caches only an unchanged revision", async () => {
  const drawCalls = [];
  let canvasCount = 0;
  function createCanvas() {
    canvasCount += 1;
    return {
      width: 0,
      height: 0,
      getContext() {
        return {
          fillStyle: "",
          fillRect() {},
          drawImage(...args) { drawCalls.push(args.slice(1)); },
        };
      },
      toBlob(callback, mimeType) {
        callback(new Blob([`canvas-${canvasCount}`], { type: mimeType }));
      },
    };
  }
  const sandbox = loadRenderer();
  const document = sandbox.Scroll2PDFEditorCore.createDocument({
    width: 640,
    height: 480,
    mimeType: "image/png",
  });
  const source = { width: 640, height: 480 };
  const renderer = sandbox.Scroll2PDFEditorRenderer.createRenderer({ source, createCanvas });

  const first = await renderer.exportDocument(document, { mimeType: "image/png" });
  const cached = await renderer.exportDocument(document, { mimeType: "image/png" });
  const jpeg = await renderer.exportDocument(document, { mimeType: "image/jpeg", quality: 0.95 });

  assert.equal(first.type, "image/png");
  assert.equal(cached, first);
  assert.equal(jpeg.type, "image/jpeg");
  assert.equal(canvasCount, 2);
  assert.deepEqual(drawCalls[0], [0, 0, 640, 480, 0, 0, 640, 480]);
});

test("renderer rejects an excessive output before allocating a canvas", async () => {
  let canvasCount = 0;
  const sandbox = loadRenderer();
  const document = sandbox.Scroll2PDFEditorCore.createDocument({
    width: 40000,
    height: 100,
    mimeType: "image/png",
  });
  const renderer = sandbox.Scroll2PDFEditorRenderer.createRenderer({
    source: { width: 40000, height: 100 },
    createCanvas() { canvasCount += 1; return {}; },
  });
  await assert.rejects(
    renderer.exportDocument(document, { mimeType: "image/png" }),
    /too wide|dimension|per side/i,
  );
  assert.equal(canvasCount, 0);
});

test("preview virtualization returns only visible tiles plus one overscan tile", () => {
  const sandbox = loadRenderer();
  assert.equal(JSON.stringify(sandbox.Scroll2PDFEditorRenderer.getVisibleTileIndexes({
    scrollTop: 700,
    viewportHeight: 500,
    documentDisplayHeight: 2500,
    tileCssHeight: 600,
    overscan: 1,
  })), JSON.stringify([0, 1, 2]));
  assert.equal(JSON.stringify(sandbox.Scroll2PDFEditorRenderer.getVisibleTileIndexes({
    scrollTop: 2200,
    viewportHeight: 300,
    documentDisplayHeight: 2500,
    tileCssHeight: 600,
    overscan: 1,
  })), JSON.stringify([2, 3, 4]));
});

test("preview tile draws exact source rows at display scale and DPR", () => {
  const transforms = [];
  const drawCalls = [];
  const canvas = {
    width: 0,
    height: 0,
    style: {},
    getContext() {
      return {
        fillStyle: "",
        fillRect() {},
        setTransform(...args) { transforms.push(args); },
        drawImage(...args) { drawCalls.push(args.slice(1)); },
      };
    },
  };
  const sandbox = loadRenderer();
  const document = sandbox.Scroll2PDFEditorCore.createDocument({
    width: 800,
    height: 1200,
    mimeType: "image/png",
  });
  sandbox.Scroll2PDFEditorRenderer.renderPreviewTile({
    canvas,
    source: { width: 800, height: 1200 },
    document,
    documentTop: 200,
    documentHeight: 300,
    scale: 0.5,
    devicePixelRatio: 2,
  });

  assert.equal(JSON.stringify({
    width: canvas.width,
    height: canvas.height,
    cssWidth: canvas.style.width,
    cssHeight: canvas.style.height,
  }), JSON.stringify({ width: 800, height: 300, cssWidth: "400px", cssHeight: "150px" }));
  assert.deepEqual(transforms[0], [1, 0, 0, 1, 0, -200]);
  assert.deepEqual(drawCalls[0], [0, 200, 800, 300, 0, 200, 800, 300]);
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
  console.log(`\n${tests.length - failures}/${tests.length} editor tests passed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
