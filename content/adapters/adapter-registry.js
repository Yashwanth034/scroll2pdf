(function initializeScroll2PDFAdapterRegistry(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFAdapterRegistry) return;

  function safeDetect(adapter, input) {
    try {
      return adapter?.detect?.(input) || null;
    } catch (_) {
      return null;
    }
  }

  function genericFallback(path, fallbackResolver) {
    const element = typeof fallbackResolver === "function" ? fallbackResolver(path) : null;
    return element ? {
      element,
      contentRoot: element,
      adapterId: "generic-scrollable",
      label: "Scrollable area",
      confidence: 1,
      captureDirection: "downward",
      naturalOrder: "top-to-bottom",
      difficult: false,
      requiresConfirmation: true,
    } : null;
  }

  function resolveTarget(path = [], options = {}) {
    const input = {
      path,
      hostname: options.hostname || globalScope.location?.hostname || "",
      pathname: options.pathname || globalScope.location?.pathname || "",
      window: options.window || globalScope.window,
      document: options.document || globalScope.document,
    };
    const adapters = options.adapters || [
      globalScope.Scroll2PDFWhatsAppAdapter,
      globalScope.Scroll2PDFTelegramAdapter,
      globalScope.Scroll2PDFGenericChatAdapter,
    ];
    for (const adapter of adapters) {
      const target = safeDetect(adapter, input);
      if (target?.element && Number(target.confidence) >= 0.68) return target;
    }
    return genericFallback(path, options.fallbackResolver);
  }

  Object.defineProperty(globalScope, "Scroll2PDFAdapterRegistry", {
    value: Object.freeze({ genericFallback, resolveTarget, safeDetect }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
