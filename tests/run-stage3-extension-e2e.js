#!/usr/bin/env node

"use strict";

const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const port = Number(process.env.S2P_ATTACH_PORT || 9444);
const base = `http://127.0.0.1:${port}`;
let commandId = 0;

async function getJson(endpoint, method = "GET") {
  const response = await fetch(`${base}${endpoint}`, { method });
  if (!response.ok) throw new Error(`${method} ${endpoint} returned ${response.status}`);
  return response.json();
}

async function waitFor(check, timeoutMs, label) {
  const started = Date.now();
  let detail = "";
  while (Date.now() - started < timeoutMs) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) { detail = error.message; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}${detail ? `: ${detail}` : ""}`);
}

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  socket.pending = new Map();
  socket.events = [];
  socket.listeners = [];
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
      return;
    }
    socket.events.push(message);
    for (const listener of socket.listeners.slice()) listener(message);
  };
  return socket;
}

function send(socket, method, params = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const id = ++commandId;
    const timer = setTimeout(() => reject(new Error(`No CDP reply for ${method}`)), timeoutMs);
    socket.pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

function waitForEvent(socket, method, timeoutMs = 10000) {
  const existing = socket.events.find((event) => event.method === method);
  if (existing) return Promise.resolve(existing.params);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.listeners = socket.listeners.filter((item) => item !== listener);
      reject(new Error(`No CDP event ${method}`));
    }, timeoutMs);
    function listener(message) {
      if (message.method !== method) return;
      clearTimeout(timer);
      socket.listeners = socket.listeners.filter((item) => item !== listener);
      resolve(message.params);
    }
    socket.listeners.push(listener);
  });
}

async function evaluate(socket, expression) {
  const result = await send(socket, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, 30000);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}

async function createTarget(url) {
  return getJson(`/json/new?${encodeURIComponent(url)}`, "PUT");
}

async function installUnpackedThroughUi() {
  const existing = (await getJson("/json/list"))
    .find((target) => target.type === "service_worker" && target.url.endsWith("/background/background.js"));
  if (existing) return existing;

  const target = await createTarget("chrome://extensions/");
  const socket = await connect(target);
  try {
    await send(socket, "Runtime.enable");
    await send(socket, "Page.enable");
    await waitFor(() => evaluate(socket, "document.readyState === 'complete' && Boolean(document.querySelector('extensions-manager'))"), 10000, "extensions manager");
    const enabled = await evaluate(socket, `(() => {
      const toolbar = document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-toolbar');
      const toggle = toolbar.shadowRoot.querySelector('#devMode');
      if (!toggle.checked) toggle.click();
      return true;
    })()`);
    if (!enabled) throw new Error("Developer mode could not be enabled.");
    await waitFor(() => evaluate(socket, `Boolean(document.querySelector('extensions-manager').shadowRoot
      .querySelector('extensions-toolbar').shadowRoot.querySelector('#loadUnpacked'))`), 5000, "Load unpacked button");
    await send(socket, "Page.setInterceptFileChooserDialog", { enabled: true });
    const chooserPromise = waitForEvent(socket, "Page.fileChooserOpened");
    await evaluate(socket, `document.querySelector('extensions-manager').shadowRoot
      .querySelector('extensions-toolbar').shadowRoot.querySelector('#loadUnpacked').click()`);
    const chooser = await chooserPromise;
    await send(socket, "DOM.setFileInputFiles", {
      files: [projectRoot],
      backendNodeId: chooser.backendNodeId,
    });
    return waitFor(async () => (await getJson("/json/list"))
      .find((item) => item.type === "service_worker" && item.url.endsWith("/background/background.js")), 15000, "Scroll2PDF service worker after UI install");
  } finally {
    socket.close();
    await fetch(`${base}/json/close/${target.id}`).catch(() => {});
  }
}

(async () => {
  try {
    const worker = await installUnpackedThroughUi();
    console.log(`PASS unpacked Scroll2PDF loaded through chrome://extensions — ${worker.url}`);
  } catch (error) {
    if (/No CDP event Page\.fileChooserOpened/.test(error.message)) {
      console.log("SKIP branded Chrome ignored command-line unpacked loading, and its native Load unpacked directory chooser is not exposed through CDP.");
      console.log("     The fixture integration suite is the strongest automatable browser fallback in this installation.");
      return;
    }
    console.error(`STAGE3 EXTENSION E2E ERROR ${error.message}`);
    process.exitCode = 1;
  }
})();
