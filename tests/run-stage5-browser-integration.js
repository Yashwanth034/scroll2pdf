#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const {
  fixtureBase,
  report,
  runRegionMode,
} = require("./run-stage3-browser-integration.js");

const chatOptions = Object.freeze({
  elementId: "chat-scroll",
  prescroll: 800,
});

// Chats are captured downward from the user's current position to the bottom of
// the container (never rewind to the top and never traverse older history), so
// the oldest-start marker is not expected to appear; the newest bottom marker is.
function assertDownwardChatResult(result, label, prescroll = chatOptions.prescroll) {
  assert.equal(result.analysis.captureMode, "scrollable-area");
  assert.ok(result.analysis.newestPixels > 30, `${label} is missing its newest bottom marker.`);
  assert.ok(result.frames.length > 1, `${label} did not traverse multiple viewports.`);
  assert.ok(result.frames.every((frame) => !frame.dynamic), `${label} used the plain downward path.`);
  const positions = result.frames.map((frame) => frame.contentPositionCss);
  assert.ok(positions.every((position, index) => index === 0 || position >= positions[index - 1] - 1),
    `${label} did not advance monotonically downward.`);
  assert.equal(result.restored.position, prescroll,
    `${label} did not restore the user's original position.`);
}

async function main() {
  try {
    const server = await fetch(`${fixtureBase}/prepend-history-chat.html`);
    assert.equal(server.ok, true, "Fixture server is not available.");

    const prepend = await runRegionMode("scrollable-area", {
      ...chatOptions,
      fixture: "prepend-history-chat.html",
    });
    assertDownwardChatResult(prepend, "Prepend-history downward capture");
    assert.ok(prepend.restored.historyLoads === undefined || prepend.restored.historyLoads === 0,
      "Downward capture must not load older history.");
    assert.ok(Math.abs(prepend.restored.position - chatOptions.prescroll) <= 2,
      "Prepend-history capture did not restore the current position.");
    report("Prepend-history chat downward capture",
      `${prepend.frames.length} frames, ${prepend.analysis.width}×${prepend.analysis.height}, restored to ${prepend.restored.position}`);

    const virtualized = await runRegionMode("scrollable-area", {
      ...chatOptions,
      prescroll: 4000,
      fixture: "virtualized-chat.html",
    });
    assertDownwardChatResult(virtualized, "Virtualized downward capture", 4000);
    report("Virtualized-chat downward capture", `${virtualized.frames.length} frames`);

    const sticky = await runRegionMode("scrollable-area", {
      ...chatOptions,
      fixture: "sticky-chat.html",
    });
    assertDownwardChatResult(sticky, "Sticky-chat downward capture");
    assert.ok(sticky.analysis.height < sticky.frames.length * sticky.frames[0].cropRectCss.height * 1.1,
      "Sticky-chat seams were not trimmed.");
    report("Sticky date/app-chrome fixture", `${sticky.frames.length} frames with overlap trimming`);

    const seam = await runRegionMode("scrollable-area", {
      ...chatOptions,
      fixture: "seam-overlap-chat.html",
    });
    assertDownwardChatResult(seam, "Seam-overlap downward capture");
    const seamExpected = (seam.restored.scrollHeight - chatOptions.prescroll) * 1.1;
    assert.ok(Math.abs(seam.analysis.height - seamExpected) / seamExpected < 0.03,
      `Stitched height ${seam.analysis.height} did not match the container extent ${Math.round(seamExpected)}.`);
    report("Seam-overlap downward capture",
      `${seam.frames.length} frames, ${seam.analysis.width}×${seam.analysis.height} (expected ${Math.round(seamExpected)})`);

    const lazy = await runRegionMode("scrollable-area", {
      ...chatOptions,
      fixture: "lazy-media-chat.html",
    });
    assertDownwardChatResult(lazy, "Lazy-media downward capture");
    assert.ok(lazy.analysis.mediaPixels > 60, "Rendered media markers are missing from the result.");
    report("Lazy-media downward capture", `${lazy.analysis.mediaPixels} rendered-media pixel samples`);

    const resize = await runRegionMode("scrollable-area", {
      ...chatOptions,
      fixture: "dynamic-resize-chat.html",
    });
    assertDownwardChatResult(resize, "Dynamic-resize downward capture");
    report("Dynamic-resize downward capture", `${resize.frames.length} frames completed without geometry abort`);

    const cancelled = await runRegionMode("scrollable-area", {
      ...chatOptions,
      fixture: "virtualized-chat.html",
      cancelAfterFrames: 3,
    });
    assert.equal(cancelled.cancelled, true);
    assert.equal(cancelled.openedResult, "");
    assert.equal(cancelled.restored.position, chatOptions.prescroll);
    report("Chat-capture cancellation", "cancelled during traversal, no result, restored to the original position");

    const pdf = await runRegionMode("scrollable-area", {
      ...chatOptions,
      fixture: "prepend-history-chat.html",
      outputType: "a4-pdf",
      orientation: "portrait",
    });
    assert.equal(pdf.analysis.mimeType, "application/pdf");
    assert.equal(pdf.analysis.signature.startsWith("%PDF-"), true);
    assert.ok(pdf.analysis.pageCount > 1);
    assert.ok(pdf.sourceAnalysis.newestPixels > 30,
      "PDF source is missing the newest bottom marker.");
    report("Chat A4 PDF regression",
      `${pdf.analysis.pageCount} pages from ${pdf.sourceAnalysis.width}×${pdf.sourceAnalysis.height} source`);
  } catch (error) {
    console.error(`STAGE5 BROWSER INTEGRATION ERROR ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

main();
