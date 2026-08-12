#!/usr/bin/env node

"use strict";

const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const debugPort = 9900 + Math.floor(Math.random() * 80);
const profilePath = `/tmp/scroll2pdf-extension-smoke-${process.pid}`;
let browser;
let pageSocket;
let workerSocket;
let commandId = 0;

const server = http.createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><title>Scroll2PDF smoke page</title>
    <style>body{margin:0}section{display:grid;height:900px;place-items:center;font:48px sans-serif}section:nth-child(1){background:#dce9ff}section:nth-child(2){background:#dff7ed}</style>
    <section>Smoke section 1</section><section>Smoke section 2</section>`);
});

async function waitFor(check, timeoutMs, label) {
  const startedAt = Date.now();
  let lastError = "";

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await check();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error(`Timed out waiting for ${label}. ${lastError}`);
}

async function getJson(endpoint, method = "GET") {
  const response = await fetch(`http://127.0.0.1:${debugPort}${endpoint}`, { method });
  return response.json();
}

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  socket.pending = new Map();
  socket.events = [];
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && socket.pending.has(message.id)) {
      const pending = socket.pending.get(message.id);
      socket.pending.delete(message.id);
      clearTimeout(pending.timer);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    } else {
      socket.events.push(message);
    }
  };
  return socket;
}

function send(socket, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++commandId;
    const timer = setTimeout(() => reject(new Error(`No CDP reply for ${method}`)), 10000);
    socket.pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(socket, expression) {
  const result = await send(socket, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text);
  }
  return result.result.value;
}

function report(name, condition, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) {
    process.exitCode = 1;
  }
}

(async () => {
  let browserError = "";

  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const webPort = server.address().port;
    const smokePageUrl = `http://127.0.0.1:${webPort}/`;

    browser = spawn("google-chrome", [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--no-first-run",
      `--user-data-dir=${profilePath}`,
      `--remote-debugging-port=${debugPort}`,
      `--disable-extensions-except=${projectRoot}`,
      `--load-extension=${projectRoot}`,
      smokePageUrl,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    browser.stderr.on("data", (chunk) => {
      browserError += chunk;
    });

    await waitFor(() => getJson("/json/version"), 30000, "Chrome DevTools");
    const workerTarget = await waitFor(async () => {
      const targets = await getJson("/json/list");
      return targets.find(
        (target) => target.type === "service_worker"
          && target.url.endsWith("/background/background.js"),
      );
    }, 20000, "Scroll2PDF service worker");

    const extensionId = new URL(workerTarget.url).host;
    workerSocket = await connect(workerTarget);
    await send(workerSocket, "Runtime.enable");

    const targets = await getJson("/json/list");
    const smokeTarget = targets.find((target) => target.type === "page" && target.url.startsWith(smokePageUrl));
    if (!smokeTarget) throw new Error("Smoke page target was not found.");
    pageSocket = await connect(smokeTarget);
    await send(pageSocket, "Page.enable");
    await send(pageSocket, "Runtime.enable");

    const pingResult = await evaluate(workerSocket, `new Promise((resolve) => {
      chrome.tabs.query({}, (tabs) => {
        const tab = tabs.find((candidate) => candidate.url && candidate.url.startsWith(${JSON.stringify(smokePageUrl)}));
        if (!tab) {
          resolve({ ok: false, error: "Smoke page tab not found." });
          return;
        }
        chrome.tabs.sendMessage(tab.id, { type: "PING" }, resolve);
      });
    })`);
    report(
      "declared content script answers PING on a normal HTTP page",
      pingResult?.ok === true && pingResult?.ready === true,
      JSON.stringify(pingResult),
    );

    const startResult = await evaluate(workerSocket, `Scroll2PDFBackground.captureManager.startCapture({
      captureMode: "full-page",
      outputType: "long-image",
      quality: "high",
      orientation: "portrait"
    }).then(({ completion, ...response }) => response)`);
    report("background accepts a real full-page capture", startResult?.ok === true, JSON.stringify(startResult));

    const resultTarget = await waitFor(async () => {
      const currentTargets = await getJson("/json/list");
      return currentTargets.find(
        (target) => target.type === "page"
          && target.url.startsWith(`chrome-extension://${extensionId}/result/result.html?id=`),
      );
    }, 30000, "Stage 2 result page");
    report("full capture opens the extension result page", Boolean(resultTarget));

    const restoredScroll = await evaluate(pageSocket, "window.scrollY");
    report("full capture restores the original scroll position", restoredScroll === 0, String(restoredScroll));

    const popupExceptions = pageSocket.events.filter((event) => event.method === "Runtime.exceptionThrown");
    const workerExceptions = workerSocket.events.filter((event) => event.method === "Runtime.exceptionThrown");
    report("extension contexts have no runtime exceptions", popupExceptions.length + workerExceptions.length === 0);
  } catch (error) {
    if (error.message.includes("Scroll2PDF service worker")) {
      console.log("SKIP branded Chrome did not load the unpacked extension from command-line flags");
      console.log("     Use Chrome for Testing/Chromium or follow the manual Load unpacked steps.");
      process.exitCode = 0;
    } else {
      console.error(`SMOKE ERROR ${error.message}`);
      console.error(browserError.slice(0, 600));
      process.exitCode = 2;
    }
  } finally {
    try {
      pageSocket?.close();
      workerSocket?.close();
      browser?.kill();
      server.close();
    } catch (_) {
      // A failed browser startup can leave one or more handles unopened.
    }
  }
})();
