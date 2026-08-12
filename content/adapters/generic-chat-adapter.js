(function initializeScroll2PDFGenericChatAdapter(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFGenericChatAdapter) return;

  const { isVerticallyScrollableCandidate } = globalScope.Scroll2PDFCaptureUtils;
  const MAX_CANDIDATES = 160;
  const GENERIC_MESSAGE_SELECTOR = [
    "[data-message-id]",
    "[data-mid]",
    "[data-id]",
    "[data-timestamp]",
    "[role=\"listitem\"]",
    "[role=\"row\"]",
  ].join(",");

  function environment(options = {}) {
    return {
      window: options.window || globalScope.window,
      document: options.document || globalScope.document,
    };
  }

  function isScrollable(element, options = {}) {
    if (!element?.getBoundingClientRect) return false;
    const env = environment(options);
    const rect = element.getBoundingClientRect();
    const style = env.window.getComputedStyle(element);
    return isVerticallyScrollableCandidate({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      rect,
      style,
      viewportWidth: env.window.innerWidth,
      viewportHeight: env.window.innerHeight,
    });
  }

  function collectPotentialScrollers(path = [], options = {}) {
    const env = environment(options);
    const seen = new Set();
    const candidates = [];
    const add = (element) => {
      if (!element || seen.has(element) || candidates.length >= MAX_CANDIDATES) return;
      seen.add(element);
      if (element !== env.document.documentElement
          && element !== env.document.body
          && element !== env.document.scrollingElement
          && isScrollable(element, options)) candidates.push(element);
    };
    for (const element of path) {
      add(element);
      const descendants = element?.querySelectorAll ? Array.from(element.querySelectorAll("*")) : [];
      for (const descendant of descendants) add(descendant);
    }
    return candidates;
  }

  function messageLikeCount(element, selector = GENERIC_MESSAGE_SELECTOR) {
    if (!element?.querySelectorAll) return 0;
    try {
      return Math.min(100, element.querySelectorAll(selector).length);
    } catch (_) {
      return 0;
    }
  }

  function roleFor(element) {
    return String(element?.getAttribute?.("role") || element?.role || "").toLowerCase();
  }

  function visibleArea(element) {
    const rect = element.getBoundingClientRect();
    return Math.max(0, Number(rect.width) || 0) * Math.max(0, Number(rect.height) || 0);
  }

  function chooseBest(candidates, score) {
    let best = null;
    for (const element of candidates) {
      const value = score(element);
      if (!best || value > best.score || (value === best.score && visibleArea(element) > visibleArea(best.element))) {
        best = { element, score: value };
      }
    }
    return best;
  }

  function detect(input = {}) {
    const candidates = collectPotentialScrollers(input.path, input);
    const best = chooseBest(candidates, (element) => {
      const role = roleFor(element);
      const semantic = role === "log" || role === "feed" ? 0.44 : role === "list" ? 0.22 : 0;
      const messageScore = Math.min(0.4, messageLikeCount(element) * 0.05);
      const overflowScore = element.scrollHeight > element.clientHeight * 2 ? 0.12 : 0.04;
      return semantic + messageScore + overflowScore;
    });
    if (!best || best.score < 0.68) return null;
    const nearBottom = Number(best.element.scrollTop) + Number(best.element.clientHeight)
      >= Number(best.element.scrollHeight) - Math.max(4, Number(best.element.clientHeight) * 0.1);
    return {
      element: best.element,
      contentRoot: best.element,
      adapterId: "generic-chat",
      label: "Chat / scrollable area",
      confidence: best.score,
      captureDirection: nearBottom ? "upward" : "downward",
      naturalOrder: "oldest-to-newest",
      difficult: nearBottom,
      requiresConfirmation: true,
    };
  }

  Object.defineProperty(globalScope, "Scroll2PDFGenericChatAdapter", {
    value: Object.freeze({
      GENERIC_MESSAGE_SELECTOR,
      chooseBest,
      collectPotentialScrollers,
      detect,
      isScrollable,
      messageLikeCount,
      roleFor,
      visibleArea,
    }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
