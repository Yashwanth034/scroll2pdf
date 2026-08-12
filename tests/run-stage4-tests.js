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
  sandbox.Blob ||= Blob;
  sandbox.TextEncoder ||= TextEncoder;
  sandbox.TextDecoder ||= TextDecoder;
  const context = vm.createContext(sandbox);
  new vm.Script(read(file), { filename: file }).runInContext(context);
  return sandbox;
}

function loadPdfUtils() {
  const sandbox = runScript("utils/constants.js", {});
  runScript("utils/capture-utils.js", sandbox);
  runScript("utils/pdf-utils.js", sandbox);
  return sandbox;
}

function nearlyEqual(actual, expected, tolerance = 0.001) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
}

test("A4 portrait and landscape use true physical dimensions and 10 mm margins", () => {
  const { Scroll2PDFPdfUtils: pdf } = loadPdfUtils();
  const portrait = pdf.getA4PageSpec("portrait");
  const landscape = pdf.getA4PageSpec("landscape");

  assert.equal(portrait.widthMm, 210);
  assert.equal(portrait.heightMm, 297);
  assert.equal(landscape.widthMm, 297);
  assert.equal(landscape.heightMm, 210);
  assert.equal(portrait.marginMm, 10);
  nearlyEqual(portrait.widthPt, 595.2756);
  nearlyEqual(portrait.heightPt, 841.8898);
  nearlyEqual(landscape.widthPt, portrait.heightPt);
  nearlyEqual(landscape.heightPt, portrait.widthPt);
  nearlyEqual(portrait.contentWidthPt, pdf.mmToPoints(190));
  nearlyEqual(portrait.contentHeightPt, pdf.mmToPoints(277));
});

test("source scaling fits width, preserves aspect ratio, and caps narrow-image upscale", () => {
  const { Scroll2PDFPdfUtils: pdf } = loadPdfUtils();
  const page = pdf.getA4PageSpec("portrait");
  const wide = pdf.calculatePdfLayout(1600, 12000, page);
  nearlyEqual(wide.scale, page.contentWidthPt / 1600);
  nearlyEqual(wide.sourcePixelsPerPage, page.contentHeightPt / wide.scale);
  assert.ok(wide.displayWidthPt <= page.contentWidthPt);

  const narrow = pdf.calculatePdfLayout(100, 200, page);
  assert.equal(narrow.scale, 1.25);
  assert.equal(narrow.displayWidthPt, 125);
  assert.equal(narrow.pageCount, 1);
});

test("basic pagination covers every source row exactly once and crops the last page", () => {
  const { Scroll2PDFPdfUtils: pdf } = loadPdfUtils();
  const ranges = pdf.buildPageRanges(2531, 700);
  assert.equal(JSON.stringify(ranges), JSON.stringify([
    { start: 0, end: 700, height: 700 },
    { start: 700, end: 1400, height: 700 },
    { start: 1400, end: 2100, height: 700 },
    { start: 2100, end: 2531, height: 431 },
  ]));
  assert.equal(ranges[0].start, 0);
  assert.equal(ranges.at(-1).end, 2531);
  for (let index = 1; index < ranges.length; index += 1) {
    assert.equal(ranges[index].start, ranges[index - 1].end);
  }
});

test("smart break prefers a sustained low-information band near the ideal boundary", () => {
  const { Scroll2PDFPdfUtils: pdf } = loadPdfUtils();
  const scores = new Array(1200).fill(90);
  for (let row = 930; row <= 944; row += 1) scores[row] = 2;
  const selected = pdf.chooseSmartBreak({
    start: 0,
    idealEnd: 1000,
    sourceHeight: 3000,
    scores,
    searchWindow: 100,
    minimumBandRows: 4,
  });
  assert.ok(selected >= 930 && selected <= 944, `unexpected smart boundary ${selected}`);
  assert.ok(selected < 1000);
});

test("smart break falls back to the exact ideal boundary when no quiet band exists", () => {
  const { Scroll2PDFPdfUtils: pdf } = loadPdfUtils();
  const scores = Array.from({ length: 1100 }, (_, row) => 45 + ((row * 17) % 9));
  assert.equal(pdf.chooseSmartBreak({
    start: 0,
    idealEnd: 1000,
    sourceHeight: 3000,
    scores,
    searchWindow: 80,
    minimumBandRows: 4,
  }), 1000);
});

test("smart-break search is bounded to 8 percent, 256 pixels, and 10 percent shortening", () => {
  const { Scroll2PDFPdfUtils: pdf } = loadPdfUtils();
  assert.equal(pdf.getSmartBreakSearchWindow(1000), 80);
  assert.equal(pdf.getSmartBreakSearchWindow(10000), 256);
  assert.equal(pdf.getSmartBreakMinimumEnd(500, 1500), 1400);
});

test("planned smart ranges remain continuous even when boundaries move", () => {
  const { Scroll2PDFPdfUtils: pdf } = loadPdfUtils();
  const ranges = pdf.buildPageRanges(2600, 1000, ({ idealEnd }) => idealEnd - 40);
  assert.equal(ranges[0].end, 960);
  assert.equal(ranges.at(-1).end, 2600);
  for (let index = 0; index < ranges.length; index += 1) {
    assert.ok(ranges[index].height > 0);
    if (index) assert.equal(ranges[index].start, ranges[index - 1].end);
  }
});

test("PDF filenames contain only the UTC capture date", () => {
  const { Scroll2PDFPdfUtils: pdf } = loadPdfUtils();
  assert.equal(
    pdf.buildPdfFilename("https://Example.COM/a", new Date("2026-08-12T07:35:00Z")),
    "scroll2pdf-2026-08-12.pdf",
  );
});

test("pagination refuses more than 1000 pages", () => {
  const { Scroll2PDFPdfUtils: pdf } = loadPdfUtils();
  assert.throws(() => pdf.buildPageRanges(100100, 100), /1000-page safety limit/i);
  assert.equal(pdf.buildPageRanges(100000, 100).length, 1000);
});

test("custom writer emits a valid two-page portrait PDF with metadata and content", () => {
  const sandbox = loadPdfUtils();
  runScript("offscreen/pdf-writer.js", sandbox);
  const Writer = sandbox.Scroll2PDFPdfWriter.RasterPdfWriter;
  const page = sandbox.Scroll2PDFPdfUtils.getA4PageSpec("portrait");
  const writer = new Writer({
    pageSpec: page,
    title: "scroll2pdf-example.com-2026-08-12-1305.pdf",
    creationDate: new Date("2026-08-12T13:05:00Z"),
  });
  writer.addImagePage({
    bytes: Uint8Array.from([255, 216, 255, 217]),
    width: 800,
    height: 1000,
    filter: "DCTDecode",
    displayWidthPt: 400,
    displayHeightPt: 500,
  });
  writer.addImagePage({
    bytes: Uint8Array.from([120, 156, 3, 0, 0, 0, 0, 1]),
    width: 800,
    height: 320,
    filter: "FlateDecode",
    displayWidthPt: 400,
    displayHeightPt: 160,
  });
  const bytes = writer.build();
  const text = new TextDecoder("latin1").decode(bytes);
  assert.equal(text.startsWith("%PDF-1.7"), true);
  assert.equal(text.endsWith("%%EOF\n"), true);
  assert.match(text, /\/Count 2\b/);
  assert.equal((text.match(/\/Type \/Page\b/g) || []).length, 2);
  assert.match(text, /\/MediaBox \[0 0 595\.2756 841\.8898\]/);
  assert.match(text, /\/Filter \/DCTDecode/);
  assert.match(text, /\/Filter \/FlateDecode/);
  assert.match(text, /\/Title \(scroll2pdf-example\.com-2026-08-12-1305\.pdf\)/);
  assert.match(text, /\/Creator \(Scroll2PDF\)/);
  assert.match(text, /\/Producer \(Scroll2PDF\)/);
  assert.match(text, /\/CreationDate \(D:20260812130500Z\)/);
  assert.ok(bytes.length > 500);
});

test("landscape writer swaps the A4 media box and rejects empty pages", () => {
  const sandbox = loadPdfUtils();
  runScript("offscreen/pdf-writer.js", sandbox);
  const page = sandbox.Scroll2PDFPdfUtils.getA4PageSpec("landscape");
  const writer = new sandbox.Scroll2PDFPdfWriter.RasterPdfWriter({ pageSpec: page, title: "test.pdf" });
  assert.throws(() => writer.build(), /at least one page/i);
  writer.addImagePage({
    bytes: Uint8Array.of(1, 2, 3), width: 10, height: 10, filter: "DCTDecode",
    displayWidthPt: 10, displayHeightPt: 10,
  });
  const text = new TextDecoder("latin1").decode(writer.build());
  assert.match(text, /\/MediaBox \[0 0 841\.8898 595\.2756\]/);
});

test("PDF output orchestration reports every page and preserves Long Image pass-through", async () => {
  const sandbox = loadPdfUtils();
  runScript("background/pdf-output.js", sandbox);
  const messages = [];
  const reports = [];
  const operation = {
    captureId: "pdf-op",
    pageUrl: "https://example.com/article",
    configuration: { outputType: "a4-pdf", orientation: "portrait", quality: "high" },
    cancelRequested: false,
    async report(update) { reports.push(update); Object.assign(this, update); },
  };
  const deps = {
    async sendOffscreen(message) {
      messages.push(message);
      if (message.type === "OFFSCREEN_PLAN_PDF") return { ok: true, pageCount: 3 };
      if (message.type === "OFFSCREEN_FINALIZE_PDF") return { ok: true, result: { resultId: "pdf-result", pageCount: 3 } };
      return { ok: true };
    },
  };
  const result = await sandbox.Scroll2PDFPdfOutput.finalizeCaptureOutput(
    operation,
    deps,
    { resultId: "image-result", width: 900, height: 5000 },
  );
  assert.equal(result.resultId, "pdf-result");
  assert.deepEqual(messages.map((message) => message.type), [
    "OFFSCREEN_PLAN_PDF",
    "OFFSCREEN_RENDER_PDF_PAGE",
    "OFFSCREEN_RENDER_PDF_PAGE",
    "OFFSCREEN_RENDER_PDF_PAGE",
    "OFFSCREEN_FINALIZE_PDF",
  ]);
  assert.deepEqual(reports.map((report) => report.message), [
    "Creating PDF… 0 / 3",
    "Creating PDF… 1 / 3",
    "Creating PDF… 2 / 3",
    "Creating PDF… 3 / 3",
  ]);

  const longOperation = {
    ...operation,
    configuration: { ...operation.configuration, outputType: "long-image" },
  };
  const image = { resultId: "keep-image" };
  assert.equal(await sandbox.Scroll2PDFPdfOutput.finalizeCaptureOutput(longOperation, deps, image), image);
});

test("cancellation during PDF page generation stops output and requests temporary cleanup", async () => {
  const sandbox = loadPdfUtils();
  runScript("background/pdf-output.js", sandbox);
  const operation = {
    captureId: "cancel-pdf",
    pageUrl: "https://example.com/",
    configuration: { outputType: "a4-pdf", orientation: "portrait", quality: "standard" },
    cancelRequested: false,
    async report() {},
  };
  const rendered = [];
  const deps = {
    async sendOffscreen(message) {
      if (message.type === "OFFSCREEN_PLAN_PDF") return { ok: true, pageCount: 4 };
      if (message.type === "OFFSCREEN_RENDER_PDF_PAGE") {
        rendered.push(message.payload.pageIndex);
        operation.cancelRequested = true;
      }
      return { ok: true };
    },
  };
  await assert.rejects(
    sandbox.Scroll2PDFPdfOutput.finalizeCaptureOutput(operation, deps, { resultId: "temporary-image" }),
    (error) => error.name === "CaptureCancelledError",
  );
  assert.deepEqual(rendered, [0]);
});

test("offscreen PDF generator plans, renders sequential JPEG bands, stores PDF, and deletes its source", async () => {
  const sandbox = loadPdfUtils();
  runScript("offscreen/pdf-writer.js", sandbox);
  const saved = [];
  const deleted = [];
  sandbox.crypto = { randomUUID: () => "generated-pdf" };
  sandbox.Scroll2PDFResultStore = {
    async getResult() {
      return {
        resultId: "source-image",
        blob: new Blob(["image"], { type: "image/png" }),
        width: 800,
        height: 2600,
        captureMode: "selected-area",
        captureModeLabel: "Selected Area",
      };
    },
    async saveResult(record) { saved.push(record); },
    async deleteResult(id) { deleted.push(id); },
  };
  sandbox.createImageBitmap = async () => ({ width: 800, height: 2600, close() {} });
  const canvases = [];
  sandbox.document = {
    createElement() {
      const canvas = {
        width: 0,
        height: 0,
        getContext() {
          return {
            fillStyle: "",
            fillRect() {},
            drawImage() {},
            getImageData() {
              return { data: new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(255) };
            },
          };
        },
        toBlob(callback) { callback(new Blob([Uint8Array.of(255, 216, 255, 217)], { type: "image/jpeg" })); },
      };
      canvases.push(canvas);
      return canvas;
    },
  };
  runScript("offscreen/pdf-generator.js", sandbox);
  const generator = sandbox.Scroll2PDFPdfGenerator;
  const plan = await generator.planPdf({
    captureId: "capture-pdf",
    sourceResultId: "source-image",
    orientation: "portrait",
    quality: "standard",
    filename: "capture.pdf",
  });
  assert.ok(plan.pageCount > 1);
  assert.equal(plan.ranges[0].start, 0);
  assert.equal(plan.ranges.at(-1).end, 2600);
  for (let index = 0; index < plan.pageCount; index += 1) {
    const rendered = await generator.renderPdfPage({ captureId: "capture-pdf", pageIndex: index });
    assert.equal(rendered.completed, index + 1);
  }
  const finalized = await generator.finalizePdf({ captureId: "capture-pdf" });
  assert.equal(finalized.result.resultId, "generated-pdf");
  assert.equal(finalized.result.mimeType, "application/pdf");
  assert.equal(finalized.result.pageCount, plan.pageCount);
  assert.equal(finalized.result.orientation, "portrait");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].blob.type, "application/pdf");
  assert.deepEqual(deleted, ["source-image"]);
  const signature = new TextDecoder().decode(new Uint8Array(await saved[0].blob.slice(0, 8).arrayBuffer()));
  assert.match(signature, /^%PDF-1\.7/);
});

test("offscreen PDF cancellation discards the session and its temporary image", async () => {
  const sandbox = loadPdfUtils();
  runScript("offscreen/pdf-writer.js", sandbox);
  const deleted = [];
  sandbox.Scroll2PDFResultStore = {
    async getResult() {
      return { resultId: "temporary", blob: new Blob(["x"]), width: 400, height: 1200 };
    },
    async deleteResult(id) { deleted.push(id); },
  };
  sandbox.createImageBitmap = async () => ({ width: 400, height: 1200, close() {} });
  sandbox.document = { createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }) }),
  }) };
  runScript("offscreen/pdf-generator.js", sandbox);
  await sandbox.Scroll2PDFPdfGenerator.planPdf({
    captureId: "cancelled", sourceResultId: "temporary", orientation: "portrait",
    quality: "standard", filename: "cancelled.pdf",
  });
  sandbox.Scroll2PDFPdfGenerator.cancelPdf("cancelled");
  await assert.rejects(
    sandbox.Scroll2PDFPdfGenerator.renderPdfPage({ captureId: "cancelled", pageIndex: 0 }),
    (error) => error.name === "OffscreenCancelledError",
  );
  await sandbox.Scroll2PDFPdfGenerator.resetPdf("cancelled");
  assert.deepEqual(deleted, ["temporary"]);
});

test("popup exposes an accessible PDF-only orientation model", () => {
  const sandbox = runScript("utils/constants.js", {
    document: { addEventListener() {} },
    chrome: { runtime: { sendMessage() {}, onMessage: { addListener() {} } } },
    setTimeout,
    clearTimeout,
  });
  runScript("popup/popup.js", sandbox);
  assert.equal(JSON.stringify(sandbox.Scroll2PDFPopup.getOrientationUiModel("a4-pdf")), JSON.stringify({
    hidden: false,
    disabled: false,
  }));
  assert.equal(JSON.stringify(sandbox.Scroll2PDFPopup.getOrientationUiModel("long-image")), JSON.stringify({
    hidden: true,
    disabled: true,
  }));
  assert.match(read("popup/popup.html"), /id="orientation-setting"/);
});

test("result view model separates PDF metadata from Long Image preview", () => {
  const sandbox = runScript("result/result.js", {
    document: { addEventListener() {} },
    addEventListener() {},
  });
  const pdf = sandbox.Scroll2PDFResult.getResultViewModel({
    mimeType: "application/pdf",
    sourceWidth: 900,
    sourceHeight: 5200,
    pageCount: 6,
    orientation: "landscape",
    captureModeLabel: "Scrollable Area",
    size: 345678,
  });
  assert.equal(pdf.isPdf, true);
  assert.equal(pdf.dimensions, "900 × 5,200 px source · 337.6 KB");
  assert.equal(pdf.metadata, "Scrollable Area · A4 PDF · Landscape · 6 pages");
  assert.equal(pdf.downloadLabel, "Download PDF");

  const image = sandbox.Scroll2PDFResult.getResultViewModel({
    mimeType: "image/png", width: 800, height: 2400, size: 1024,
    captureModeLabel: "Full Page", imageFormat: "PNG",
  });
  assert.equal(image.isPdf, false);
  assert.equal(image.metadata, "Full Page · PNG");
  assert.equal(image.downloadLabel, "Download Image");
  assert.match(read("result/result.html"), /id="pdf-result-card"/);
});

test("Stage 4 packaging adds no permission, remote code, PDF library, or Stage 5 logic", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.deepEqual(manifest.permissions.sort(), ["activeTab", "offscreen", "scripting"]);
  for (const file of [
    "utils/pdf-utils.js",
    "offscreen/pdf-writer.js",
    "offscreen/pdf-generator.js",
    "background/pdf-output.js",
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /https?:\/\/|\beval\s*\(|jsPDF|whatsapp|telegram|contentDocument/i);
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
      console.error(`  ${error.stack || error.message}`);
    }
  }
  console.log(`\n${tests.length - failures}/${tests.length} Stage 4 tests passed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
