(function initializeScroll2PDFEditorCore(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFEditorCore) return;

  const DEFAULT_MAX_COMMANDS = 100;
  const DEFAULT_MAX_HISTORY_BYTES = 64 * 1024 * 1024;
  const ANNOTATION_TYPES = new Set([
    "arrow", "rectangle", "circle", "pen", "highlighter", "text", "blur",
  ]);
  let annotationSequence = 0;

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

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, finite(value)));
  }

  function clampPoint(point, document) {
    return {
      x: clamp(point?.x, 0, document.width),
      y: clamp(point?.y, 0, document.height),
    };
  }

  function normalizeRect(geometry = {}, document) {
    const first = clampPoint({ x: geometry.x, y: geometry.y }, document);
    const second = clampPoint({
      x: finite(geometry.x) + finite(geometry.width),
      y: finite(geometry.y) + finite(geometry.height),
    }, document);
    return {
      x: Math.min(first.x, second.x),
      y: Math.min(first.y, second.y),
      width: Math.abs(second.x - first.x),
      height: Math.abs(second.y - first.y),
    };
  }

  function defaultStyle(type) {
    return {
      color: type === "highlighter" ? "#ffe066" : "#ff4d67",
      thickness: type === "highlighter" ? 28 : 6,
      opacity: type === "highlighter" ? 0.4 : 1,
      fontSize: 32,
      blur: 12,
    };
  }

  function normalizeStyle(type, style = {}) {
    const defaults = defaultStyle(type);
    const color = /^#[0-9a-f]{6}$/i.test(style.color || "") ? style.color.toLowerCase() : defaults.color;
    return {
      color,
      thickness: clamp(style.thickness ?? defaults.thickness, 1, 80),
      opacity: clamp(style.opacity ?? defaults.opacity, 0.05, 1),
      fontSize: clamp(style.fontSize ?? defaults.fontSize, 10, 240),
      blur: clamp(style.blur ?? defaults.blur, 2, 40),
    };
  }

  function normalizeGeometry(type, geometry = {}, document) {
    if (type === "arrow") {
      const first = clampPoint({ x: geometry.x1, y: geometry.y1 }, document);
      const second = clampPoint({ x: geometry.x2, y: geometry.y2 }, document);
      return { x1: first.x, y1: first.y, x2: second.x, y2: second.y };
    }
    if (type === "rectangle" || type === "circle" || type === "blur") {
      return normalizeRect(geometry, document);
    }
    if (type === "pen" || type === "highlighter") {
      const points = Array.isArray(geometry.points) ? geometry.points : [];
      return { points: points.map((point) => clampPoint(point, document)) };
    }
    const point = clampPoint({ x: geometry.x, y: geometry.y }, document);
    return {
      x: point.x,
      y: point.y,
      text: String(geometry.text || ""),
    };
  }

  function createAnnotation(input = {}, document) {
    const type = ANNOTATION_TYPES.has(input.type) ? input.type : "rectangle";
    return deepFreeze({
      id: String(input.id || `${type}-${++annotationSequence}`),
      type,
      geometry: normalizeGeometry(type, input.geometry, document),
      style: normalizeStyle(type, input.style),
    });
  }

  function getAnnotationBounds(annotation) {
    const geometry = annotation?.geometry || {};
    if (annotation?.type === "arrow") {
      return {
        x: Math.min(geometry.x1, geometry.x2),
        y: Math.min(geometry.y1, geometry.y2),
        width: Math.abs(geometry.x2 - geometry.x1),
        height: Math.abs(geometry.y2 - geometry.y1),
      };
    }
    if (annotation?.type === "pen" || annotation?.type === "highlighter") {
      const points = geometry.points || [];
      if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    }
    if (annotation?.type === "text") {
      const fontSize = annotation.style?.fontSize || 32;
      return {
        x: geometry.x,
        y: geometry.y,
        width: Math.max(fontSize, String(geometry.text || "").length * fontSize * 0.62),
        height: fontSize * 1.3,
      };
    }
    return {
      x: finite(geometry.x),
      y: finite(geometry.y),
      width: Math.max(0, finite(geometry.width)),
      height: Math.max(0, finite(geometry.height)),
    };
  }

  function replaceAnnotation(document, id, transform) {
    let changed = false;
    const annotations = document.annotations.map((annotation) => {
      if (annotation.id !== id) return annotation;
      const next = transform(annotation);
      changed = fingerprint(next) !== fingerprint(annotation);
      return next;
    });
    return changed ? replaceAnnotations(document, annotations) : document;
  }

  function appendAnnotation(document, annotation) {
    return replaceAnnotations(document, [...document.annotations, annotation]);
  }

  function removeAnnotation(document, id) {
    return replaceAnnotations(document, document.annotations.filter((annotation) => annotation.id !== id));
  }

  function translateGeometry(annotation, dx, dy) {
    const geometry = annotation.geometry;
    if (annotation.type === "arrow") {
      return { x1: geometry.x1 + dx, y1: geometry.y1 + dy, x2: geometry.x2 + dx, y2: geometry.y2 + dy };
    }
    if (annotation.type === "pen" || annotation.type === "highlighter") {
      return { points: geometry.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) };
    }
    return { ...geometry, x: geometry.x + dx, y: geometry.y + dy };
  }

  function moveAnnotation(document, id, dxValue, dyValue) {
    const dx = finite(dxValue);
    const dy = finite(dyValue);
    return replaceAnnotation(document, id, (annotation) => deepFreeze({
      ...annotation,
      geometry: translateGeometry(annotation, dx, dy),
    }));
  }

  function resizeGeometry(annotation, nextBounds) {
    const current = getAnnotationBounds(annotation);
    const next = {
      x: finite(nextBounds.x),
      y: finite(nextBounds.y),
      width: Math.max(1, finite(nextBounds.width, 1)),
      height: Math.max(1, finite(nextBounds.height, 1)),
    };
    const scaleX = current.width ? next.width / current.width : 1;
    const scaleY = current.height ? next.height / current.height : 1;
    const mapPoint = (point) => ({
      x: next.x + (point.x - current.x) * scaleX,
      y: next.y + (point.y - current.y) * scaleY,
    });
    if (annotation.type === "arrow") {
      const first = mapPoint({ x: annotation.geometry.x1, y: annotation.geometry.y1 });
      const second = mapPoint({ x: annotation.geometry.x2, y: annotation.geometry.y2 });
      return { x1: first.x, y1: first.y, x2: second.x, y2: second.y };
    }
    if (annotation.type === "pen" || annotation.type === "highlighter") {
      return { points: annotation.geometry.points.map(mapPoint) };
    }
    if (annotation.type === "text") return { ...annotation.geometry, x: next.x, y: next.y };
    return next;
  }

  function resizeAnnotation(document, id, bounds) {
    return replaceAnnotation(document, id, (annotation) => deepFreeze({
      ...annotation,
      geometry: resizeGeometry(annotation, bounds),
    }));
  }

  function restyleAnnotation(document, id, style) {
    return replaceAnnotation(document, id, (annotation) => deepFreeze({
      ...annotation,
      style: normalizeStyle(annotation.type, { ...annotation.style, ...style }),
    }));
  }

  function distanceToSegment(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (!dx && !dy) return Math.hypot(point.x - start.x, point.y - start.y);
    const ratio = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy), 0, 1);
    return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy));
  }

  function containsPoint(annotation, point, tolerance) {
    const bounds = getAnnotationBounds(annotation);
    const padded = {
      x: bounds.x - tolerance,
      y: bounds.y - tolerance,
      width: bounds.width + tolerance * 2,
      height: bounds.height + tolerance * 2,
    };
    if (point.x < padded.x || point.y < padded.y || point.x > padded.x + padded.width || point.y > padded.y + padded.height) return false;
    if (annotation.type === "arrow") {
      return distanceToSegment(point,
        { x: annotation.geometry.x1, y: annotation.geometry.y1 },
        { x: annotation.geometry.x2, y: annotation.geometry.y2 }) <= tolerance + annotation.style.thickness / 2;
    }
    if (annotation.type === "pen" || annotation.type === "highlighter") {
      return annotation.geometry.points.some((item, index, points) => index > 0
        && distanceToSegment(point, points[index - 1], item) <= tolerance + annotation.style.thickness / 2);
    }
    return true;
  }

  function hitTestAnnotations(annotations, point, tolerance = 6) {
    for (let index = annotations.length - 1; index >= 0; index -= 1) {
      if (containsPoint(annotations[index], point, tolerance)) return annotations[index];
    }
    return null;
  }

  function perpendicularDistance(point, start, end) {
    return distanceToSegment(point, start, end);
  }

  function simplifyPath(pointsValue, toleranceValue = 1) {
    const points = Array.isArray(pointsValue) ? pointsValue.map((point) => ({ x: finite(point.x), y: finite(point.y) })) : [];
    const tolerance = Math.max(0, finite(toleranceValue, 1));
    if (points.length <= 2) return points;
    let maximumDistance = 0;
    let splitIndex = 0;
    for (let index = 1; index < points.length - 1; index += 1) {
      const distance = perpendicularDistance(points[index], points[0], points[points.length - 1]);
      if (distance > maximumDistance) {
        maximumDistance = distance;
        splitIndex = index;
      }
    }
    if (maximumDistance <= tolerance) return [points[0], points[points.length - 1]];
    const left = simplifyPath(points.slice(0, splitIndex + 1), tolerance);
    const right = simplifyPath(points.slice(splitIndex), tolerance);
    return [...left.slice(0, -1), ...right];
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
      appendAnnotation,
      createAnnotation,
      createSession,
      getAnnotationBounds,
      hitTestAnnotations,
      moveAnnotation,
      previewPointToDocument,
      removeAnnotation,
      replaceAnnotations,
      resizeAnnotation,
      restyleAnnotation,
      simplifyPath,
    }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
