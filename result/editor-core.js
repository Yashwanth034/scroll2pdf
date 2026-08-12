(function initializeScroll2PDFEditorCore(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFEditorCore) return;

  const DEFAULT_MAX_COMMANDS = 100;
  const DEFAULT_MAX_HISTORY_BYTES = 64 * 1024 * 1024;

  function clonePlain(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
  }

  function freezeDocument(document) {
    return deepFreeze(clonePlain(document));
  }

  function createDocument(input = {}) {
    const width = Number(input.width);
    const height = Number(input.height);
    const segment = Object.freeze({
      kind: "source",
      sourceX: 0,
      sourceY: 0,
      width,
      height,
    });
    return Object.freeze({
      width,
      height,
      sourceWidth: width,
      sourceHeight: height,
      mimeType: input.mimeType,
      segments: Object.freeze([segment]),
      annotations: Object.freeze([]),
    });
  }

  function replaceAnnotations(document, annotations) {
    return freezeDocument({
      ...document,
      annotations: Array.isArray(annotations) ? annotations : [],
    });
  }

  function previewPointToDocument(point, bounds, scaleValue, document) {
    const scale = Number(scaleValue);
    const width = Math.max(0, Number(document?.width) || 0);
    const height = Math.max(0, Number(document?.height) || 0);
    const x = (Number(point?.clientX) - Number(bounds?.left || 0)) / scale;
    const y = (Number(point?.clientY) - Number(bounds?.top || 0)) / scale;
    return {
      x: Math.max(0, Math.min(width, x)),
      y: Math.max(0, Math.min(height, y)),
    };
  }

  function fingerprint(document) {
    return JSON.stringify(document);
  }

  function estimateBytes(document) {
    return fingerprint(document).length * 2;
  }

  function createSession(originalDocument, options = {}) {
    const original = freezeDocument(originalDocument);
    const originalFingerprint = fingerprint(original);
    const maxCommands = Math.max(1, Math.floor(Number(options.maxCommands) || DEFAULT_MAX_COMMANDS));
    const maxHistoryBytes = Math.max(1, Math.floor(Number(options.maxHistoryBytes) || DEFAULT_MAX_HISTORY_BYTES));
    const past = [];
    const future = [];
    let current = original;
    let exportedFingerprint = originalFingerprint;
    let pastBytes = 0;

    function trimPast() {
      while (past.length > maxCommands || (pastBytes > maxHistoryBytes && past.length > 1)) {
        const removed = past.shift();
        pastBytes -= removed.bytes;
      }
    }

    function pushPast(document) {
      const entry = { document, bytes: estimateBytes(document) };
      past.push(entry);
      pastBytes += entry.bytes;
      trimPast();
    }

    function commit(nextDocument) {
      const next = freezeDocument(nextDocument);
      if (fingerprint(next) === fingerprint(current)) return current;
      pushPast(current);
      current = next;
      future.length = 0;
      return current;
    }

    function undo() {
      if (!past.length) return current;
      future.push(current);
      const entry = past.pop();
      pastBytes -= entry.bytes;
      current = entry.document;
      return current;
    }

    function redo() {
      if (!future.length) return current;
      pushPast(current);
      current = future.pop();
      return current;
    }

    function reset() {
      commit(original);
      exportedFingerprint = originalFingerprint;
      return current;
    }

    function markExported() {
      exportedFingerprint = fingerprint(current);
    }

    function getState() {
      const currentFingerprint = fingerprint(current);
      return {
        document: current,
        modified: currentFingerprint !== originalFingerprint,
        unexported: currentFingerprint !== exportedFingerprint,
        canUndo: past.length > 0,
        canRedo: future.length > 0,
      };
    }

    return Object.freeze({ commit, getState, markExported, redo, reset, undo });
  }

  Object.defineProperty(globalScope, "Scroll2PDFEditorCore", {
    value: Object.freeze({
      createDocument,
      createSession,
      previewPointToDocument,
      replaceAnnotations,
    }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
