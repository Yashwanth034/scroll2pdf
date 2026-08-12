(function initializeScroll2PDFWhatsAppAdapter(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFWhatsAppAdapter) return;

  const helpers = globalScope.Scroll2PDFGenericChatAdapter;
  const MESSAGE_SELECTOR = [
    "[data-message-id]",
    "[data-id]",
    "[data-pre-plain-text]",
    "[role=\"row\"]",
    "[role=\"listitem\"]",
  ].join(",");

  function detect(input = {}) {
    if (String(input.hostname || globalScope.location?.hostname || "").toLowerCase() !== "web.whatsapp.com") {
      return null;
    }
    const candidates = helpers.collectPotentialScrollers(input.path, input);
    const best = helpers.chooseBest(candidates, (element) => {
      const messageCount = helpers.messageLikeCount(element, MESSAGE_SELECTOR);
      const role = helpers.roleFor(element);
      const semantic = role === "application" || role === "log" ? 0.18 : 0;
      const messageScore = Math.min(0.68, messageCount * 0.065);
      const overflowScore = element.scrollHeight > element.clientHeight * 2 ? 0.15 : 0.05;
      return semantic + messageScore + overflowScore;
    });
    if (!best || best.score < 0.72) return null;
    return {
      element: best.element,
      contentRoot: best.element,
      adapterId: "whatsapp",
      label: "WhatsApp Chat",
      confidence: best.score,
      captureDirection: "upward",
      naturalOrder: "oldest-to-newest",
      difficult: true,
      requiresConfirmation: true,
      messageSelector: MESSAGE_SELECTOR,
    };
  }

  Object.defineProperty(globalScope, "Scroll2PDFWhatsAppAdapter", {
    value: Object.freeze({ detect, id: "whatsapp" }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
