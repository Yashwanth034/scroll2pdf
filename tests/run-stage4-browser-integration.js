#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const {
  fixtureBase,
  report,
  runFullPage,
  runRegionMode,
} = require("./run-stage3-browser-integration.js");

function verifyPdfBinary(result, expected) {
  const pdf = result.analysis;
  assert.match(pdf.signature, /^%PDF-1\.7/);
  assert.equal(pdf.hasEof, true);
  assert.equal(pdf.pageObjects, pdf.pageCount);
  assert.equal(pdf.nonEmptyStreams >= pdf.pageCount * 2, true);
  assert.equal(pdf.hasCreator && pdf.hasProducer && pdf.hasTitle, true);
  assert.equal(pdf.filename.endsWith(".pdf"), true);
  assert.equal(pdf.mimeType, "application/pdf");
  assert.equal(pdf.orientation, expected.orientation);
  assert.equal(pdf.captureMode, expected.captureMode);
  assert.equal(pdf.mediaBoxes.length, pdf.pageCount);
  const expectedBox = expected.orientation === "portrait"
    ? [595.2756, 841.8898]
    : [841.8898, 595.2756];
  for (const box of pdf.mediaBoxes) {
    assert.ok(Math.abs(box[0] - expectedBox[0]) < 0.001);
    assert.ok(Math.abs(box[1] - expectedBox[1]) < 0.001);
  }
  assert.equal(pdf.stored, true);
  assert.equal(pdf.deletedIds.length, 1, "Temporary source image was not released exactly once.");
  assert.equal(pdf.size > 500, true);
}

(async () => {
  try {
    const server = await fetch(`${fixtureBase}/pdf-smart-break-test.html`);
    assert.equal(server.ok, true, "Fixture server is not available.");

    const portrait = await runFullPage({
      outputType: "a4-pdf", orientation: "portrait", quality: "high",
    });
    verifyPdfBinary(portrait, { orientation: "portrait", captureMode: "full-page" });
    assert.equal(portrait.analysis.pageCount > 1, true);
    assert.equal(portrait.analysis.hasFlate, true);
    assert.equal(portrait.sourceAnalysis.bottomDarkPixels > 100, true, "Portrait PDF source is missing the dark bottom footer.");
    assert.equal(portrait.restored.position, 731);
    report("Full Page → A4 Portrait PDF", `${portrait.analysis.pageCount} pages, ${portrait.analysis.size} bytes`);

    const landscape = await runFullPage({
      outputType: "a4-pdf", orientation: "landscape", quality: "standard",
    });
    verifyPdfBinary(landscape, { orientation: "landscape", captureMode: "full-page" });
    assert.equal(landscape.analysis.hasJpeg, true);
    assert.equal(landscape.sourceAnalysis.bottomDarkPixels > 100, true, "Landscape PDF source is missing the dark bottom footer.");
    report("Full Page → A4 Landscape PDF", `${landscape.analysis.pageCount} pages, ${landscape.analysis.size} bytes`);

    const scrollable = await runRegionMode("scrollable-area", {
      outputType: "a4-pdf", orientation: "portrait", quality: "standard",
    });
    verifyPdfBinary(scrollable, { orientation: "portrait", captureMode: "scrollable-area" });
    assert.equal(scrollable.restored.position, scrollable.initial.scroll);
    assert.deepEqual(scrollable.restored.labels, Array.from({ length: 24 }, (_, index) => `Message ${String(index + 1).padStart(2, "0")}`));
    assert.equal(scrollable.sourceAnalysis.greenPixels > 100, true, "Scrollable PDF source is missing the bottom marker.");
    assert.equal(scrollable.sourceAnalysis.rowRuns >= 20, true);
    // The crop rect is exact, so any red-aside pixels are JPEG/color-management
    // noise (observed ~70); a real sidebar bleed would be thousands.
    assert.equal(scrollable.sourceAnalysis.redPixels < 500, true);
    report("Scrollable Area → A4 PDF", `${scrollable.analysis.pageCount} pages, 24 ordered messages, restored to ${scrollable.restored.position}px`);

    const selected = await runRegionMode("selected-area", {
      outputType: "a4-pdf", orientation: "portrait", quality: "standard",
    });
    verifyPdfBinary(selected, { orientation: "portrait", captureMode: "selected-area" });
    assert.equal(selected.restored.position, selected.initial.scroll);
    assert.equal(selected.sourceAnalysis.greenPixels > 100, true, "Selected PDF source is missing the bottom marker.");
    assert.equal(selected.sourceAnalysis.redPixels < 500, true, "Selected PDF source contains excluded side content.");
    assert.equal(selected.frames.at(-1).cropRectCss.left, selected.frames[0].cropRectCss.left);
    assert.equal(selected.frames.at(-1).cropRectCss.width, selected.frames[0].cropRectCss.width);
    report("Selected Area → A4 PDF", `${selected.analysis.pageCount} pages, sidebars excluded, restored to ${selected.restored.position}px`);

    const short = await runFullPage({
      fixture: "short-page.html", outputType: "a4-pdf", orientation: "portrait", quality: "standard",
    });
    verifyPdfBinary(short, { orientation: "portrait", captureMode: "full-page" });
    assert.equal(short.analysis.pageCount, 1);
    report("Short capture → one-page A4 PDF", `${short.analysis.sourceWidth}×${short.analysis.sourceHeight}px source`);

    const smart = await runFullPage({
      fixture: "pdf-smart-break-test.html", outputType: "a4-pdf", orientation: "portrait", quality: "standard",
    });
    verifyPdfBinary(smart, { orientation: "portrait", captureMode: "full-page" });
    const idealBandHeight = Math.floor(smart.pdfPlan.sourcePixelsPerPage);
    assert.equal(smart.pdfPlan.ranges.some((range, index) => (
      index < smart.pdfPlan.ranges.length - 1 && range.height < idealBandHeight
    )), true,
      `Smart breaks did not move any boundary: ${JSON.stringify(smart.pdfPlan.ranges)}`);
    assert.equal(smart.pdfPlan.ranges.at(-1).end, smart.pdfPlan.sourceHeight);
    assert.equal(smart.sourceAnalysis.greenPixels > 100, true);
    report("Smart-break browser fixture", `${smart.analysis.pageCount} pages, ranges ${smart.pdfPlan.ranges.map((range) => range.height).join("/")}`);

    const cancelled = await runRegionMode("selected-area", {
      outputType: "a4-pdf", orientation: "portrait", quality: "standard", cancelPdf: true,
    });
    assert.equal(cancelled.cancelled, true);
    assert.equal(cancelled.openedResult, "");
    assert.equal(cancelled.cleanup.resultCount, 0);
    assert.equal(cancelled.cleanup.deletedIds.length, 1);
    assert.equal(cancelled.restored.position, 900);
    assert.equal(cancelled.events.some((event) => event.type === "CAPTURE_CANCELLED"), true);
    report("Cancel during PDF generation", "no result, temporary image deleted, page restored");
  } catch (error) {
    console.error(`STAGE4 BROWSER INTEGRATION ERROR ${error.stack || error.message}`);
    process.exitCode = 1;
  }
})();
