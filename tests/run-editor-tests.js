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

test("annotation creation normalizes geometry and applies tool-specific defaults", () => {
  const core = loadCore();
  const document = core.createDocument({ width: 800, height: 1200, mimeType: "image/png" });
  const rectangle = core.createAnnotation({
    id: "rectangle-1",
    type: "rectangle",
    geometry: { x: 420, y: 360, width: -120, height: -80 },
  }, document);
  const highlighter = core.createAnnotation({
    id: "highlighter-1",
    type: "highlighter",
    geometry: { points: [{ x: 10, y: 20 }, { x: 90, y: 100 }] },
  }, document);

  assert.equal(JSON.stringify(rectangle), JSON.stringify({
    id: "rectangle-1",
    type: "rectangle",
    geometry: { x: 300, y: 280, width: 120, height: 80 },
    style: { color: "#ff4d67", thickness: 6, opacity: 1, fontSize: 32, blur: 12 },
  }));
  assert.equal(highlighter.style.color, "#ffe066");
  assert.equal(highlighter.style.thickness, 28);
  assert.equal(highlighter.style.opacity, 0.4);
  assert.equal(Object.isFrozen(rectangle), true);
});

test("annotation edits stay immutable and support move resize restyle and delete", () => {
  const core = loadCore();
  const original = core.createDocument({ width: 800, height: 1200, mimeType: "image/png" });
  const arrow = core.createAnnotation({
    id: "arrow-1",
    type: "arrow",
    geometry: { x1: 100, y1: 120, x2: 240, y2: 260 },
  }, original);
  const withArrow = core.appendAnnotation(original, arrow);
  const moved = core.moveAnnotation(withArrow, "arrow-1", 30, -20);
  const resized = core.resizeAnnotation(moved, "arrow-1", {
    x: 50, y: 60, width: 300, height: 200,
  });
  const styled = core.restyleAnnotation(resized, "arrow-1", {
    color: "#00d4ff", thickness: 10, opacity: 0.65,
  });
  const removed = core.removeAnnotation(styled, "arrow-1");

  assert.equal(withArrow.annotations[0].geometry.x1, 100);
  assert.equal(moved.annotations[0].geometry.x1, 130);
  assert.equal(JSON.stringify(core.getAnnotationBounds(resized.annotations[0])), JSON.stringify({
    x: 50, y: 60, width: 300, height: 200,
  }));
  assert.equal(styled.annotations[0].style.color, "#00d4ff");
  assert.equal(styled.annotations[0].style.thickness, 10);
  assert.equal(styled.annotations[0].style.opacity, 0.65);
  assert.equal(removed.annotations.length, 0);
});

test("annotation hit testing returns the topmost visible object", () => {
  const core = loadCore();
  const document = core.createDocument({ width: 800, height: 1200, mimeType: "image/png" });
  const lower = core.createAnnotation({
    id: "lower", type: "rectangle", geometry: { x: 100, y: 100, width: 200, height: 160 },
  }, document);
  const upper = core.createAnnotation({
    id: "upper", type: "circle", geometry: { x: 150, y: 130, width: 180, height: 180 },
  }, document);
  const annotated = core.replaceAnnotations(document, [lower, upper]);

  assert.equal(core.hitTestAnnotations(annotated.annotations, { x: 210, y: 180 }, 8).id, "upper");
  assert.equal(core.hitTestAnnotations(annotated.annotations, { x: 105, y: 105 }, 8).id, "lower");
  assert.equal(core.hitTestAnnotations(annotated.annotations, { x: 700, y: 900 }, 8), null);
});

test("freehand simplification preserves endpoints while reducing dense points", () => {
  const core = loadCore();
  const points = Array.from({ length: 101 }, (_, index) => ({
    x: index,
    y: index % 2 === 0 ? 10 : 10.2,
  }));
  const simplified = core.simplifyPath(points, 1);

  assert.equal(JSON.stringify(simplified[0]), JSON.stringify(points[0]));
  assert.equal(JSON.stringify(simplified[simplified.length - 1]), JSON.stringify(points[points.length - 1]));
  assert.ok(simplified.length < 10, `Expected a compact path, got ${simplified.length} points.`);
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

test("renderer keeps annotation creation order and culls annotations outside a tile", () => {
  const sandbox = loadRenderer();
  const core = sandbox.Scroll2PDFEditorCore;
  const base = core.createDocument({ width: 800, height: 1200, mimeType: "image/png" });
  const document = core.replaceAnnotations(base, [
    core.createAnnotation({
      id: "rectangle-1", type: "rectangle", geometry: { x: 50, y: 100, width: 200, height: 100 },
    }, base),
    core.createAnnotation({
      id: "text-1", type: "text", geometry: { x: 80, y: 160, text: "Second" },
    }, base),
    core.createAnnotation({
      id: "offscreen", type: "circle", geometry: { x: 50, y: 900, width: 100, height: 100 },
    }, base),
  ]);

  const commands = sandbox.Scroll2PDFEditorRenderer.buildAnnotationCommands(document, {
    left: 0, top: 0, width: 800, height: 400,
  });
  assert.equal(JSON.stringify(commands.map((command) => [command.kind, command.annotation.id])), JSON.stringify([
    ["annotation", "rectangle-1"],
    ["annotation", "text-1"],
  ]));
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
