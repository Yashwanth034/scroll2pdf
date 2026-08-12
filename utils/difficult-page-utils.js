(function initializeScroll2PDFDifficultPageUtils(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFDifficultPageUtils) return;

  const limits = globalScope.Scroll2PDFConstants.CAPTURE_LIMITS;
  const STABLE_ATTRIBUTE_ORDER = Object.freeze([
    "data-message-id",
    "data-mid",
    "data-id",
    "data-timestamp",
    "data-time",
    "aria-label",
  ]);

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function getStableAnchorIdentity(descriptor = {}) {
    const id = String(descriptor.id || "").trim();
    if (id) return `id:${id}`;
    const attributes = descriptor.attributes || {};
    for (const name of STABLE_ATTRIBUTE_ORDER) {
      const value = String(attributes[name] || "").trim();
      if (value) return `${name}:${value}`;
    }
    const structuralPath = String(descriptor.structuralPath || "").trim();
    if (structuralPath) return `path:${structuralPath}`;
    const sessionIdentity = String(descriptor.sessionIdentity || "").trim();
    return sessionIdentity ? `session:${sessionIdentity}` : "";
  }

  function calculateAnchorDisplacement(before = [], after = []) {
    const afterByIdentity = new Map();
    for (const anchor of after) {
      if (anchor?.identity) afterByIdentity.set(anchor.identity, finite(anchor.viewportY, NaN));
    }
    const displacements = [];
    for (const anchor of before) {
      if (!anchor?.identity || !afterByIdentity.has(anchor.identity)) continue;
      const previousY = finite(anchor.viewportY, NaN);
      const currentY = afterByIdentity.get(anchor.identity);
      if (Number.isFinite(previousY) && Number.isFinite(currentY)) {
        displacements.push(currentY - previousY);
      }
    }
    if (!displacements.length) return null;
    displacements.sort((a, b) => a - b);
    return displacements[Math.floor(displacements.length / 2)];
  }

  function detectLikelyVirtualization(input = {}) {
    const previous = input.previous || {};
    const current = input.current || {};
    const previousChildren = Math.max(0, finite(previous.childCount));
    const currentChildren = Math.max(0, finite(current.childCount));
    const maxChildren = Math.max(previousChildren, currentChildren, 1);
    const childChangeRatio = Math.abs(currentChildren - previousChildren) / maxChildren;
    const previousHeight = Math.max(1, finite(previous.scrollHeight, 1));
    const heightChangeRatio = Math.abs(finite(current.scrollHeight) - previousHeight) / previousHeight;
    const anchorsChanged = Boolean(previous.firstAnchor && current.firstAnchor
      && (previous.firstAnchor !== current.firstAnchor || previous.lastAnchor !== current.lastAnchor));
    const boundedDom = childChangeRatio <= 0.2;
    const boundedHeight = heightChangeRatio <= 0.2;
    return anchorsChanged && boundedDom && boundedHeight;
  }

  function orderFrameChain(frames = [], direction = "downward") {
    if (direction !== "upward" && direction !== "downward") {
      throw new Error("Unsupported difficult-page traversal direction.");
    }
    const ordered = Array.from(frames).sort((a, b) => (
      finite(a?.traversalOrdinal) - finite(b?.traversalOrdinal)
    ));
    if (direction === "upward") ordered.reverse();
    return ordered;
  }

  function createRepeatedStateTracker(options = {}) {
    const repeatLimit = Math.max(1, Math.floor(finite(options.repeatLimit, limits.REPEATED_VIEWPORT_LIMIT)));
    const historyLimit = Math.max(1, Math.floor(finite(options.historyLimit, limits.FINGERPRINT_HISTORY_LIMIT)));
    const history = new Map();
    let previous = "";
    let consecutiveRepeats = 0;

    return Object.freeze({
      observe(fingerprintValue) {
        const fingerprint = String(fingerprintValue || "");
        if (!fingerprint) return "progress";
        if (history.has(fingerprint)) history.delete(fingerprint);
        history.set(fingerprint, true);
        while (history.size > historyLimit) history.delete(history.keys().next().value);
        if (fingerprint !== previous) {
          previous = fingerprint;
          consecutiveRepeats = 0;
          return "progress";
        }
        consecutiveRepeats += 1;
        return consecutiveRepeats >= repeatLimit ? "stuck" : "recover";
      },
      size() { return history.size; },
    });
  }

  function createCaptureContext(input = {}) {
    let origin = "";
    let pathname = "";
    try {
      const url = new URL(input.url);
      origin = url.origin;
      pathname = url.pathname;
    } catch (_) {
      origin = "";
      pathname = "";
    }
    return Object.freeze({
      origin,
      pathname,
      scrollerIdentity: String(input.scrollerIdentity || ""),
      conversationIdentity: String(input.conversationIdentity || ""),
    });
  }

  function captureContextChanged(initial, current) {
    if (!initial || !current) return true;
    return initial.origin !== current.origin
      || initial.pathname !== current.pathname
      || initial.scrollerIdentity !== current.scrollerIdentity
      || initial.conversationIdentity !== current.conversationIdentity;
  }

  function normalizeRect(rect = {}) {
    const left = finite(rect.left, NaN);
    const top = finite(rect.top, NaN);
    const width = finite(rect.width, finite(rect.right, NaN) - left);
    const height = finite(rect.height, finite(rect.bottom, NaN) - top);
    return { left, top, right: left + width, bottom: top + height, width, height };
  }

  function normalizeDynamicCrop(input = {}) {
    const original = normalizeRect(input.original);
    const current = normalizeRect(input.current);
    if (![...Object.values(original), ...Object.values(current)].every(Number.isFinite)
        || original.width <= 0 || original.height <= 0 || current.width <= 0 || current.height <= 0) {
      throw new Error("The selected chat area has invalid geometry.");
    }
    const minimumTolerance = Math.max(0, finite(
      input.minimumTolerance,
      limits.DYNAMIC_GEOMETRY_MIN_TOLERANCE_CSS,
    ));
    const ratioTolerance = Math.max(0, finite(
      input.ratioTolerance,
      limits.DYNAMIC_GEOMETRY_RATIO_TOLERANCE,
    ));
    const widthTolerance = Math.max(minimumTolerance, original.width * ratioTolerance);
    const heightTolerance = Math.max(minimumTolerance, original.height * ratioTolerance);
    const positionTolerance = Math.max(
      widthTolerance,
      heightTolerance,
      finite(input.positionTolerance, limits.DYNAMIC_POSITION_TOLERANCE_CSS),
    );
    if (Math.abs(current.width - original.width) > widthTolerance
        || Math.abs(current.height - original.height) > heightTolerance
        || Math.abs(current.left - original.left) > positionTolerance
        || Math.abs(current.top - original.top) > positionTolerance) {
      throw new Error("The selected chat area changed too much during capture.");
    }
    const left = Math.max(original.left, current.left);
    const top = Math.max(original.top, current.top);
    const right = Math.min(original.right, current.right);
    const bottom = Math.min(original.bottom, current.bottom);
    if (right <= left || bottom <= top) {
      throw new Error("The selected chat area changed too much during capture.");
    }
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function validateTraversalBudget(input = {}) {
    const frames = Math.max(0, Math.floor(finite(input.frameCount)));
    const elapsedMs = Math.max(0, finite(input.elapsedMs));
    if (frames > limits.MAX_DYNAMIC_CAPTURE_FRAMES) {
      throw new Error(`Difficult capture exceeds the ${limits.MAX_DYNAMIC_CAPTURE_FRAMES}-frame safety limit.`);
    }
    if (elapsedMs > limits.MAX_DIFFICULT_CAPTURE_DURATION_MS) {
      throw new Error("Difficult capture exceeds the 10-minute safety limit.");
    }
    return { frames, elapsedMs };
  }

  Object.defineProperty(globalScope, "Scroll2PDFDifficultPageUtils", {
    value: Object.freeze({
      STABLE_ATTRIBUTE_ORDER,
      calculateAnchorDisplacement,
      captureContextChanged,
      createCaptureContext,
      createRepeatedStateTracker,
      detectLikelyVirtualization,
      getStableAnchorIdentity,
      normalizeDynamicCrop,
      orderFrameChain,
      validateTraversalBudget,
    }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
