#!/usr/bin/env node

"use strict";

// Browser integration test for pages longer than Chrome's single-canvas limit
// (32,767px per side):
//   1. Full Page + A4 PDF on a 40,000px page must succeed by paginating rows
//      as they stream (no giant canvas ever exists) — a real multi-page PDF
//      whose pages sum to the full source height.
//   2. Full Page + long image on the same page must fail fast with a friendly
//      "page too long" message instead of wasting ~20s capturing then crashing.
//   3. A normal long page (under the cap) still captures as a single image.
//
// Run with: S2P_ATTACH_PORT=<port> node tests/run-long-page-browser-test.js

const assert = require("node:assert/strict");
const { runFullPage, report } = require("./run-stage3-browser-integration.js");

async function main() {
  // 1. The 40,000px page as A4 PDF — must paginate instead of erroring.
  const pdf = await runFullPage({
    fixture: "long-page-test.html?mode=too-long",
    outputType: "a4-pdf",
    quality: "high",
  });
  assert.equal(pdf.analysis.mimeType, "application/pdf");
  assert.ok(pdf.analysis.pageCount > 1, `expected multiple pages, got ${pdf.analysis.pageCount}`);
  assert.ok(pdf.analysis.pageCount >= 15, `expected >= 15 pages, got ${pdf.analysis.pageCount}`);
  assert.ok(pdf.analysis.sourceHeight >= 40000,
    `source height ${pdf.analysis.sourceHeight} should cover the full 40,000px page`);
  assert.equal(pdf.analysis.mediaBoxes.length, pdf.analysis.pageCount);
  for (const box of pdf.analysis.mediaBoxes) {
    assert.ok(box[0] > 0 && box[1] > 0, `invalid media box ${box}`);
  }
  assert.match(pdf.analysis.signature, /^%PDF-1\.[4567]$/);
  assert.equal(pdf.analysis.hasEof, true);
  assert.equal(pdf.analysis.hasCreator, true);
  assert.equal(pdf.analysis.hasFlate, true);
  report("long-page too-long -> chunked multi-page PDF",
    `pageCount=${pdf.analysis.pageCount} sourceHeight=${pdf.analysis.sourceHeight}`);

  // 2. Same page as a long image — must fail fast with the friendly message.
  const failed = await runFullPage({
    fixture: "long-page-test.html?mode=too-long",
    outputType: "long-image",
    expectError: /too long to capture in one image|browser limits a single image/i,
  });
  assert.equal(failed.openedResult, "");
  assert.equal(failed.completion.ok, false);
  report("long-page too-long -> fail-fast friendly error",
    `error="${failed.completion.error}"`);

  // 3. The ordinary long page (under the cap) still captures as one image.
  const ok = await runFullPage({ fixture: "long-page-test.html" });
  assert.ok(ok.analysis.height > 17000, `unexpected height ${ok.analysis.height}`);
  report("long-page normal -> single-image capture",
    `height=${ok.analysis.height}px`);
}

main().then(
  () => { process.exitCode = 0; },
  (error) => { console.error(error.stack || error); process.exitCode = 1; },
);
