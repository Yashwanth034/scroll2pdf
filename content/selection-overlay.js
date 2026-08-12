(function initializeScroll2PDFSelectionOverlay(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFSelectionOverlay) return;

  function createCleanupBag() {
    const cleanups = [];
    let cleaned = false;
    return Object.freeze({
      add(cleanup) {
        if (typeof cleanup !== "function") return;
        if (cleaned) cleanup();
        else cleanups.push(cleanup);
      },
      listen(target, type, listener, options) {
        target.addEventListener(type, listener, options);
        cleanups.push(() => target.removeEventListener(type, listener, options));
      },
      cleanup() {
        if (cleaned) return;
        cleaned = true;
        for (const cleanup of cleanups.splice(0)) {
          try { cleanup(); } catch (_) { /* Cleanup is best effort. */ }
        }
      },
    });
  }

  function createOneShotOutcome(callback) {
    let settled = false;
    return Object.freeze({
      settle(value) {
        if (settled) return false;
        settled = true;
        callback(value);
        return true;
      },
      get settled() { return settled; },
    });
  }

  function createSelectionOverlay(instruction) {
    const cleanupBag = createCleanupBag();
    const host = document.createElement("div");
    host.id = "scroll2pdf-selection-host";
    host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .surface { position: fixed; inset: 0; cursor: crosshair; pointer-events: auto; user-select: none; touch-action: none; }
      .shade { position: fixed; background: rgba(5, 10, 24, .42); pointer-events: none; }
      .outline { position: fixed; box-sizing: border-box; border: 2px solid #77e7cf; border-radius: 8px;
        box-shadow: 0 0 0 1px rgba(4, 16, 25, .7), 0 8px 30px rgba(0, 0, 0, .28); pointer-events: none; }
      .label { position: fixed; max-width: min(320px, calc(100vw - 24px)); padding: 7px 10px; border-radius: 7px;
        background: #0c1a27; color: #f4fffc; border: 1px solid rgba(119, 231, 207, .5);
        font: 600 12px/1.35 system-ui, sans-serif; letter-spacing: .01em; pointer-events: none; }
      .label.invalid { border-color: #ff9b91; color: #ffe8e5; }
      [hidden] { display: none !important; }
    `;
    const surface = document.createElement("div");
    surface.className = "surface";
    surface.setAttribute("role", "application");
    surface.setAttribute("aria-label", instruction);
    const shades = Array.from({ length: 4 }, () => {
      const node = document.createElement("div");
      node.className = "shade";
      return node;
    });
    const outline = document.createElement("div");
    outline.className = "outline";
    outline.hidden = true;
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = instruction;
    shadow.append(style, ...shades, outline, label, surface);
    document.documentElement.append(host);
    cleanupBag.add(() => host.remove());

    function updateShade(rect) {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const rules = [
        [0, 0, width, rect.top],
        [0, rect.bottom, width, Math.max(0, height - rect.bottom)],
        [0, rect.top, rect.left, rect.height],
        [rect.right, rect.top, Math.max(0, width - rect.right), rect.height],
      ];
      shades.forEach((node, index) => {
        const [left, top, itemWidth, itemHeight] = rules[index];
        Object.assign(node.style, {
          left: `${left}px`, top: `${top}px`, width: `${itemWidth}px`, height: `${itemHeight}px`,
        });
      });
    }

    function setRect(rect, text, invalid = false) {
      outline.hidden = false;
      Object.assign(outline.style, {
        left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
      });
      updateShade(rect);
      label.textContent = text;
      label.classList.toggle("invalid", invalid);
      label.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 328))}px`;
      label.style.top = `${Math.max(8, rect.top > 44 ? rect.top - 38 : rect.bottom + 8)}px`;
    }

    function clearRect(message = instruction, invalid = false) {
      outline.hidden = true;
      const width = window.innerWidth;
      const height = window.innerHeight;
      Object.assign(shades[0].style, { left: "0", top: "0", width: `${width}px`, height: `${height}px` });
      shades.slice(1).forEach((node) => { node.style.width = "0"; node.style.height = "0"; });
      label.textContent = message;
      label.classList.toggle("invalid", invalid);
      label.style.left = "12px";
      label.style.top = "12px";
    }

    clearRect();
    return Object.freeze({
      host,
      surface,
      cleanupBag,
      setRect,
      clearRect,
      cleanup: () => cleanupBag.cleanup(),
    });
  }

  Object.defineProperty(globalScope, "Scroll2PDFSelectionOverlay", {
    value: Object.freeze({ createCleanupBag, createOneShotOutcome, createSelectionOverlay }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
