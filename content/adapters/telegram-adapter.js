(function initializeScroll2PDFTelegramAdapter(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFTelegramAdapter) return;

  const helpers = globalScope.Scroll2PDFGenericChatAdapter;
  const MESSAGE_SELECTOR = [
    "[data-message-id]",
    "[data-mid]",
    "[data-timestamp]",
    "[role=\"listitem\"]",
    "[role=\"row\"]",
  ].join(",");

  function detect(input = {}) {
    if (String(input.hostname || globalScope.location?.hostname || "").toLowerCase() !== "web.telegram.org") {
      return null;
    }
    const candidates = helpers.collectPotentialScrollers(input.path, input);
    const best = helpers.chooseBest(candidates, (element) => {
      const messageCount = helpers.messageLikeCount(element, MESSAGE_SELECTOR);
      const role = helpers.roleFor(element);
      const label = String(element.getAttribute?.("aria-label") || "").toLowerCase();
      const semantic = ["list", "log", "feed"].includes(role) || /message|history/.test(label) ? 0.2 : 0;
      return semantic
        + Math.min(0.68, messageCount * 0.065)
        + (element.scrollHeight > element.clientHeight * 2 ? 0.15 : 0.05);
    });
    if (!best || best.score < 0.72) return null;
    return {
      element: best.element,
      contentRoot: best.element,
      adapterId: "telegram",
      label: "Telegram Chat",
      confidence: best.score,
      captureDirection: "downward",
      naturalOrder: "top-to-bottom",
      difficult: false,
      requiresConfirmation: true,
      messageSelector: MESSAGE_SELECTOR,
    };
  }

  Object.defineProperty(globalScope, "Scroll2PDFTelegramAdapter", {
    value: Object.freeze({ detect, id: "telegram" }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
