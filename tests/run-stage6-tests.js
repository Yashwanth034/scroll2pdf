#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const tests = [];
function test(name, run) { tests.push({ name, run }); }
function read(file) { return fs.readFileSync(path.join(root, file), "utf8"); }
function loadReleaseUtils() {
  const sandbox = { globalThis: null, URL, Date, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  new vm.Script(read("utils/constants.js")).runInContext(sandbox);
  new vm.Script(read("utils/capture-utils.js")).runInContext(sandbox);
  new vm.Script(read("utils/release-utils.js")).runInContext(sandbox);
  return sandbox;
}

test("release metadata is 1.0.0 and manifest icons are declared", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.version, "1.0.0");
  assert.deepEqual(manifest.icons, { "16": "assets/icons/icon-16.png", "32": "assets/icons/icon-32.png", "48": "assets/icons/icon-48.png", "128": "assets/icons/icon-128.png" });
});

test("release filename contains only the UTC capture date and never private page text", () => {
  const { Scroll2PDFReleaseUtils: release } = loadReleaseUtils();
  assert.equal(release.buildReleaseFilename("https://Example.com/a", "A private chat · Alice", "png", new Date("2026-08-12T14:30:00Z")), "scroll2pdf-2026-08-12.png");
  const pdfName = release.buildReleaseFilename("https://example.com", "secret message", "pdf", new Date("2026-08-12T23:59:00Z"));
  assert.equal(pdfName, "scroll2pdf-2026-08-12.pdf");
  assert.ok(!pdfName.includes("secret"));
  assert.ok(!pdfName.includes("example.com"));
  assert.ok(!pdfName.includes("2359"));
});

test("technical capture errors map to concise recovery guidance", () => {
  const { Scroll2PDFReleaseUtils: release } = loadReleaseUtils();
  assert.equal(release.toUserFacingError(new Error("The selected area stopped advancing before its bottom was captured.")).message, "Scrolling stopped before the capture finished.");
  assert.match(release.toUserFacingError(new Error("The selected conversation changed during capture.")).guidance, /open the chat/i);
  assert.match(release.toUserFacingError(new Error("Could not establish connection")).message, /browser-protected/i);
  assert.equal(release.toUserFacingError(new Error("random internal detail")).message, "Scroll2PDF could not complete this capture.");
});

test("stale result cleanup keeps recent records and removes only expired abandoned records", async () => {
  const { Scroll2PDFReleaseUtils: release } = loadReleaseUtils();
  const now = 1_000_000;
  const records = [
    { resultId: "old", createdAt: now - 10_000 },
    { resultId: "recent", createdAt: now - 100 },
    { resultId: "active", createdAt: now - 10_000, active: true },
  ];
  const deleted = await release.cleanupStaleRecords(records, now, 5_000);
  assert.deepEqual(deleted, ["old"]);
});

test("security review rejects remote scripts and unsafe executable construction", () => {
  const files = [
    "manifest.json", "popup/popup.html", "result/result.html", "background/background.js", "content/content.js",
    "result/editor-core.js", "result/editor-renderer.js", "result/editor-controller.js", "result/result.js",
  ];
  for (const file of files) {
    const source = read(file);
    assert.equal(/<script[^>]+src=["']https?:|(?:https?:\/\/[^\s"']+)/i.test(source.replace(/https?:\/\/\*\//g, "")), false, file);
    assert.equal(/\beval\s*\(|new\s+Function\s*\(/.test(source), false, file);
  }
});

test("popup exposes release-ready copy and reduced-motion accessibility hooks", () => {
  const html = read("popup/popup.html");
  const css = read("popup/popup.css");
  assert.match(html, /Capture the entire webpage\./);
  assert.match(html, /Select a chat, panel, or scrollable container\./);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
});

test("release icons are valid PNGs at every Chrome size", () => {
  for (const size of [16, 32, 48, 128]) {
    const file = path.join(root, `assets/icons/icon-${size}.png`);
    const bytes = fs.readFileSync(file);
    assert.deepEqual(Array.from(bytes.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
});

test("release packaging excludes development fixtures and keeps generated archives ignored", () => {
  const script = read("scripts/package-release.sh");
  assert.match(script, /zip -q -r/);
  assert.match(script, /manifest\.json/);
  assert.match(script, /copy LICENSE/);
  assert.match(script, /background\/\*\.js/);
  assert.match(script, /result\/\*\.js/);
  assert.doesNotMatch(script, /tests\/\*/);
  assert.doesNotMatch(script, /docs\/superpowers/);
  assert.match(read(".gitignore"), /^dist\/$/m);
});

async function main() {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`PASS ${name}`); }
    catch (error) { failures += 1; console.error(`FAIL ${name}\n  ${error.stack || error.message}`); }
  }
  console.log(`\n${tests.length - failures}/${tests.length} Stage 6 tests passed`);
  process.exitCode = failures ? 1 : 0;
}
main();
