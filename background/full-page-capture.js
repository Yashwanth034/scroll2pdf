(function initializeScroll2PDFFullPageCapture(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFFullPageCapture) {
    return;
  }

  const {
    CAPTURE_LIMITS,
    CAPTURE_MODES,
    CAPTURE_PHASES,
    MESSAGE_TYPES,
    OUTPUT_TYPES,
    QUALITY_LEVELS,
  } = globalScope.Scroll2PDFConstants;
  const {
    buildCaptureFilename,
    buildScrollPositions,
    classifyCaptureUrl,
    getImageFormat,
    getNextScrollPosition,
    isRestrictedCaptureUrl,
  } = globalScope.Scroll2PDFCaptureUtils;

  // A page can grow (lazy content, late images) or shrink (collapsed sections,
  // ads, fonts) while it is being captured. Keep the largest observed height
  // while it is still reachable, but adopt a smaller measured height as soon as
  // the current viewport covers the new bottom — otherwise the loop keeps
  // chasing a bottom that no longer exists and reports a false stall.
  function syncObservedPageHeight(observed, measured, coveredBottomCss) {
    if (measured < observed
        && coveredBottomCss >= measured - CAPTURE_LIMITS.SCROLL_POSITION_TOLERANCE_CSS) {
      return measured;
    }
    return Math.max(observed, measured);
  }

  const PROTECTED_PAGE_MESSAGE = "Scroll2PDF cannot capture this browser-protected page.";
  const UNREACHABLE_PAGE_MESSAGE = "Scroll2PDF could not connect to this page. Reload the page (or reload the Scroll2PDF extension in chrome://extensions if it was just updated) and try again.";
  const STAGE_3_MESSAGE = "This capture mode is unavailable because the Stage 3 engine is not loaded.";
  const OFFSCREEN_PATH = "offscreen/offscreen.html";
  let creatingOffscreenDocument;

  class CaptureCancelledError extends Error {
    constructor(message = "Capture cancelled") {
      super(message);
      this.name = "CaptureCancelledError";
    }
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function createCaptureId() {
    if (globalScope.crypto?.randomUUID) {
      return globalScope.crypto.randomUUID();
    }
    return `capture-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function publicStatus(operation) {
    if (!operation) {
      return { active: false };
    }
    return {
      active: true,
      captureId: operation.captureId,
      phase: operation.phase,
      completed: operation.completed,
      total: operation.total,
      message: operation.message,
      cancelling: operation.cancelRequested,
    };
  }

  function isCancellation(error, operation) {
    return error instanceof CaptureCancelledError || operation.cancelRequested;
  }

  // Explains why a page cannot be captured. Browser-owned URLs (chrome://,
  // about:, file:, PDF viewers, …) and the Chrome Web Store are permanently
  // uncapturable by any extension; a missing content-script connection on an
  // ordinary page is a recoverable problem instead.
  function protectedPageMessage(tabUrl) {
    const classification = classifyCaptureUrl(tabUrl);
    if (classification.reason === "webstore") {
      return "Scroll2PDF cannot capture Chrome Web Store pages. Open a normal website and try again.";
    }
    if (classification.reason === "protocol") {
      return "This is a browser-protected page (chrome://, about:, file://, a PDF viewer, or another browser-owned page). No extension can capture it — open a normal website and try again.";
    }
    return PROTECTED_PAGE_MESSAGE;
  }

  function captureErrorMessage(error, pageUrl) {
    const message = error?.message || "Full-page capture failed.";
    if (message === UNREACHABLE_PAGE_MESSAGE) {
      return UNREACHABLE_PAGE_MESSAGE;
    }
    if (/Receiving end does not exist|Could not establish connection|Cannot access/i.test(message)) {
      if (classifyCaptureUrl(pageUrl).restricted) {
        return protectedPageMessage(pageUrl);
      }
      return UNREACHABLE_PAGE_MESSAGE;
    }
    return globalScope.Scroll2PDFReleaseUtils
      ? globalScope.Scroll2PDFReleaseUtils.toUserFacingError(error).message
      : message;
  }

  function createCaptureManager(dependencies) {
    const deps = dependencies || createChromeCaptureDependencies();
    let activeCapture = null;

    async function broadcast(message) {
      try {
        await deps.broadcast(message);
      } catch (_) {
        // The popup is allowed to close while a background capture continues.
      }
    }

    async function startCapture(configuration) {
      const isFullPage = configuration?.captureMode === CAPTURE_MODES.FULL_PAGE;
      const isScreenshot = configuration?.captureMode === CAPTURE_MODES.NORMAL_SCREENSHOT;
      const isRegion = [CAPTURE_MODES.SCROLLABLE_AREA, CAPTURE_MODES.SELECTED_AREA]
        .includes(configuration?.captureMode);
      if (!isFullPage && !isRegion && !isScreenshot) {
        return { ok: false, error: "Unsupported capture mode." };
      }
      if (isRegion && !globalScope.Scroll2PDFRegionCapture) {
        return { ok: false, error: STAGE_3_MESSAGE };
      }
      if (activeCapture) {
        return { ok: false, error: "A capture is already in progress." };
      }
      const captureConfiguration = isScreenshot
        ? Object.freeze({
          ...configuration,
          outputType: OUTPUT_TYPES.LONG_IMAGE,
          quality: QUALITY_LEVELS.HIGH,
          selectScreenshotArea: Boolean(configuration.selectScreenshotArea),
        })
        : configuration;

      let tab;
      try {
        tab = await deps.getActiveTab();
      } catch (error) {
        return { ok: false, error: captureErrorMessage(error) };
      }
      if (!tab?.id || !Number.isInteger(tab.windowId) || isRestrictedCaptureUrl(tab.url)) {
        return { ok: false, error: protectedPageMessage(tab?.url) };
      }
      if (deps.ensureContentScripts) {
        try {
          await deps.ensureContentScripts(tab.id, tab.url);
        } catch (error) {
          return { ok: false, error: captureErrorMessage(error, tab.url) };
        }
      }

      const operation = {
        captureId: deps.createId ? deps.createId() : createCaptureId(),
        tabId: tab.id,
        windowId: tab.windowId,
        pageUrl: tab.url,
        configuration: captureConfiguration,
        phase: isFullPage || (isScreenshot && !captureConfiguration.selectScreenshotArea)
          ? CAPTURE_PHASES.PREPARING
          : CAPTURE_PHASES.SELECTING,
        completed: 0,
        total: 0,
        message: isFullPage
          ? "Preparing page…"
          : isScreenshot
            ? captureConfiguration.selectScreenshotArea
              ? "Drag to select a screenshot area"
              : "Taking a screenshot of the visible page…"
            : captureConfiguration.captureMode === CAPTURE_MODES.SCROLLABLE_AREA
              ? "Select a scrollable area on the page"
              : "Drag to select an area",
        cancelRequested: false,
        startedAt: Date.now(),
      };

      operation.report = async (update) => {
        Object.assign(operation, update);
        await broadcast({
          type: MESSAGE_TYPES.CAPTURE_PROGRESS,
          payload: publicStatus(operation),
        });
      };

      activeCapture = operation;
      const executeOperation = deps.executeOperation || ((current) => {
        if (current.configuration.captureMode === CAPTURE_MODES.FULL_PAGE) {
          return executeFullPageCapture(current, deps);
        }
        if (current.configuration.captureMode === CAPTURE_MODES.NORMAL_SCREENSHOT) {
          return executeNormalScreenshot(current, deps);
        }
        return globalScope.Scroll2PDFRegionCapture.executeRegionCapture(current, deps);
      });

      const completion = Promise.resolve()
        .then(() => executeOperation(operation))
        .then(async (result) => {
          if (operation.cancelRequested) {
            throw new CaptureCancelledError();
          }
          const isPdf = operation.configuration.outputType === OUTPUT_TYPES.A4_PDF;
          await broadcast({
            type: MESSAGE_TYPES.CAPTURE_COMPLETE,
            payload: {
              ...result,
              message: isPdf ? "PDF complete" : "Capture complete",
            },
          });
          if (result?.resultId && deps.openResult) {
            await deps.openResult(result.resultId);
          }
          return { ok: true, result };
        })
        .catch(async (error) => {
          if (isCancellation(error, operation)) {
            await broadcast({
              type: MESSAGE_TYPES.CAPTURE_CANCELLED,
              payload: { message: "Capture cancelled" },
            });
            return { ok: false, cancelled: true };
          }
          const message = captureErrorMessage(error, operation.pageUrl);
          console.error("Scroll2PDF capture failed:", error);
          await broadcast({
            type: MESSAGE_TYPES.CAPTURE_ERROR,
            payload: { message },
          });
          return { ok: false, error: message };
        })
        .finally(() => {
          if (activeCapture === operation) {
            activeCapture = null;
          }
        });

      operation.completion = completion;
      await operation.report({ phase: operation.phase, message: operation.message });

      return {
        ok: true,
        captureId: operation.captureId,
        completion,
      };
    }

    async function cancelCapture() {
      if (!activeCapture) {
        return { ok: false, error: "There is no active capture to cancel." };
      }
      activeCapture.cancelRequested = true;
      await activeCapture.report({
        phase: CAPTURE_PHASES.CANCELLING,
        message: "Cancelling…",
      });
      if (deps.cancelOperation) {
        try {
          await deps.cancelOperation(activeCapture);
        } catch (_) {
          // The operation loop still observes the cancellation flag.
        }
      }
      return { ok: true, message: "Cancellation requested." };
    }

    function getStatus() {
      return publicStatus(activeCapture);
    }

    function handleTabRemoved(tabId) {
      if (activeCapture?.tabId === tabId) {
        activeCapture.cancelRequested = true;
      }
    }

    return Object.freeze({
      cancelCapture,
      getStatus,
      handleTabRemoved,
      startCapture,
    });
  }

  function throwIfCancelled(operation) {
    if (operation.cancelRequested) {
      throw new CaptureCancelledError();
    }
    if (Date.now() - operation.startedAt > CAPTURE_LIMITS.MAX_CAPTURE_DURATION_MS) {
      throw new Error(`Capture exceeded the ${Math.round(CAPTURE_LIMITS.MAX_CAPTURE_DURATION_MS / 60000)}-minute safety limit.`);
    }
  }

  function requireMessageResponse(response, fallback) {
    if (!response?.ok) {
      throw new Error(response?.error || fallback);
    }
    return response;
  }

  async function executeFullPageCapture(operation, deps) {
    let pagePrepared = false;
    let offscreenReady = false;
    let captureResult;

    try {
      throwIfCancelled(operation);
      await deps.ensureOffscreen();
      offscreenReady = true;
      requireMessageResponse(await deps.sendOffscreen({
        type: MESSAGE_TYPES.OFFSCREEN_RESET_CAPTURE,
        target: "offscreen",
        payload: { captureId: operation.captureId },
      }), "Could not initialize image stitching.");        const prepared = requireMessageResponse(await deps.sendTabMessage(operation.tabId, {
          type: MESSAGE_TYPES.PREPARE_FULL_PAGE_CAPTURE,
          payload: { captureId: operation.captureId },
        }), PROTECTED_PAGE_MESSAGE);
        pagePrepared = true;
        let metrics = prepared.metrics;
        let observedTotalHeight = metrics.totalHeight;
        let contentStartCss = Math.max(0, Number(metrics.contentStartCss) || 0);
        let requestedY = 0;
        let previousActualY = -1;
        let lastCaptureTime = 0;
        let stallRetries = 0;
        let stallRetrying = false;

      while (true) {
        throwIfCancelled(operation);
        if (operation.completed >= CAPTURE_LIMITS.MAX_VIEWPORT_CAPTURES) {
          throw new Error(`Page requires more than ${CAPTURE_LIMITS.MAX_VIEWPORT_CAPTURES} viewport captures.`);
        }
        await deps.assertTargetActive(operation);

        if (operation.completed > 0 && !stallRetrying) {
          requireMessageResponse(await deps.sendTabMessage(operation.tabId, {
            type: MESSAGE_TYPES.SET_CAPTURE_OVERLAYS_HIDDEN,
            payload: { captureId: operation.captureId },
          }), "Could not prepare repeated page overlays.");
        }

        if (!stallRetrying) {
          const waitForThrottle = Math.max(
            0,
            CAPTURE_LIMITS.MIN_CAPTURE_INTERVAL_MS - (Date.now() - lastCaptureTime),
          );
          if (waitForThrottle > 0) {
            await deps.delay(waitForThrottle);
          }
          throwIfCancelled(operation);

          const imageFormat = getImageFormat(operation.configuration.quality);
          const captureOptions = { format: imageFormat.captureFormat };
          if (imageFormat.captureQuality) {
            captureOptions.quality = imageFormat.captureQuality;
          }
          const imageDataUrl = await deps.captureVisibleTab(operation.windowId, captureOptions);
          lastCaptureTime = Date.now();
          throwIfCancelled(operation);
          await deps.assertTargetActive(operation);

          const addedCapture = requireMessageResponse(await deps.sendOffscreen({
            type: MESSAGE_TYPES.OFFSCREEN_ADD_CAPTURE,
            target: "offscreen",
            payload: {
              captureId: operation.captureId,
              frame: {
                requestedY,
                actualY: metrics.scrollY,
                viewportCssWidth: metrics.viewportCssWidth ?? metrics.viewportWidth,
                viewportCssHeight: metrics.viewportCssHeight ?? metrics.viewportHeight,
                contentViewportHeightCss: metrics.contentViewportHeightCss ?? metrics.viewportHeight,
                cropRectCss: metrics.cropRectCss,
                imageDataUrl,
              },
            },
          }), "Could not queue a captured viewport for stitching.");

          operation.completed += 1;
          // Fail fast for long images that can never fit in one canvas; PDF
          // output keeps going because it paginates beyond the canvas cap.
          if (operation.completed === 1 && operation.configuration.outputType !== "a4-pdf") {
            const viewportWidth = Number(metrics.viewportCssWidth ?? metrics.viewportWidth) || 1;
            const scaleY = Number(addedCapture.bitmapWidth) / viewportWidth;
            const estimateHeight = Math.ceil(Math.max(1, observedTotalHeight - contentStartCss) * scaleY);
            if (estimateHeight > CAPTURE_LIMITS.MAX_BITMAP_DIMENSION
              || Number(addedCapture.bitmapWidth) > CAPTURE_LIMITS.MAX_BITMAP_DIMENSION
              || Number(addedCapture.bitmapWidth) * estimateHeight > CAPTURE_LIMITS.MAX_BITMAP_AREA) {
              throw new Error(`This page is too long to capture in one image — the browser limits a single image to ${CAPTURE_LIMITS.MAX_BITMAP_DIMENSION}px per side. Reduce the browser zoom or capture a shorter region, or choose PDF output to paginate long pages automatically.`);
            }
          }
          const latest = requireMessageResponse(await deps.sendTabMessage(operation.tabId, {
            type: MESSAGE_TYPES.GET_PAGE_METRICS,
            payload: { captureId: operation.captureId },
          }), "Could not remeasure the page.");
          metrics = latest.metrics;
          observedTotalHeight = syncObservedPageHeight(
            observedTotalHeight,
            metrics.totalHeight,
            metrics.scrollY + metrics.viewportHeight,
          );
          operation.total = Math.max(
            operation.completed,
            buildScrollPositions(observedTotalHeight, metrics.viewportHeight).length,
          );
          await operation.report({
            phase: CAPTURE_PHASES.CAPTURING,
            completed: operation.completed,
            total: operation.total,
            message: `Capturing page… ${operation.completed} / ${operation.total}`,
          });
        }
        stallRetrying = false;

        // Self-resizing containers can wobble clientHeight by a few pixels per
        // scroll; treat a position within a small fraction of the viewport of
        // the maximum scroll as the bottom so the capture finishes instead of
        // oscillating (the frame at that position is already captured).
        const maximumScroll = Math.max(0, observedTotalHeight - metrics.viewportHeight);
        const bottomTolerance = Math.max(
          CAPTURE_LIMITS.SCROLL_POSITION_TOLERANCE_CSS,
          metrics.viewportHeight * CAPTURE_LIMITS.BOTTOM_COVER_TOLERANCE_RATIO,
        );
        const nextY = metrics.scrollY >= maximumScroll - bottomTolerance
          ? null
          : getNextScrollPosition(
            metrics.scrollY,
            observedTotalHeight,
            metrics.viewportHeight,
          );
        if (nextY === null) {
          break;
        }
        previousActualY = metrics.scrollY;
        requestedY = nextY;
        throwIfCancelled(operation);
        const scrolled = requireMessageResponse(await deps.sendTabMessage(operation.tabId, {
          type: MESSAGE_TYPES.SCROLL_TO_POSITION,
          payload: { captureId: operation.captureId, y: requestedY },
        }), "Could not scroll the page.");
        metrics = scrolled.metrics;
        const previousObservedHeight = observedTotalHeight;
        observedTotalHeight = syncObservedPageHeight(
          observedTotalHeight,
          metrics.totalHeight,
          metrics.scrollY + metrics.viewportHeight,
        );
        const pageHeightShrank = metrics.totalHeight < previousObservedHeight;
        if (metrics.scrollY <= previousActualY && !pageHeightShrank) {
          // Virtualized feeds and lazy sections can take a beat to move after a
          // scroll. Re-scroll a few times before declaring a stall, without
          // capturing duplicate frames.
          stallRetries += 1;
          if (stallRetries >= CAPTURE_LIMITS.STALL_RETRY_LIMIT) {
            throw new Error("The page stopped advancing before its bottom was captured.");
          }
          stallRetrying = true;
          continue;
        }
        stallRetries = 0;
      }

      throwIfCancelled(operation);
      await operation.report({
        phase: CAPTURE_PHASES.STITCHING,
        message: "Stitching image…",
      });
      const filename = buildCaptureFilename(
        operation.pageUrl,
        operation.configuration.quality,
        new Date(),
      );
      const stitched = requireMessageResponse(await deps.sendOffscreen({
        type: MESSAGE_TYPES.OFFSCREEN_STITCH_CAPTURE,
        target: "offscreen",
        payload: {
          captureId: operation.captureId,
          totalHeightCss: observedTotalHeight,
          contentStartCss,
          quality: operation.configuration.quality,
          filename,
          captureMode: operation.configuration.captureMode,
          captureModeLabel: "Full Page",
          orientation: operation.configuration.orientation,
          paginatePdf: operation.configuration.outputType === "a4-pdf",
        },
      }), "Image stitching failed.");
      throwIfCancelled(operation);
      if (pagePrepared) {
        requireMessageResponse(await deps.sendTabMessage(operation.tabId, {
          type: MESSAGE_TYPES.RESTORE_PAGE,
          payload: { captureId: operation.captureId },
        }), "Could not restore the original page context.");
        pagePrepared = false;
      }
      captureResult = globalScope.Scroll2PDFPdfOutput
        ? await globalScope.Scroll2PDFPdfOutput.finalizeCaptureOutput(operation, deps, stitched.result)
        : stitched.result;
    } finally {
      if (pagePrepared) {
        try {
          await deps.sendTabMessage(operation.tabId, {
            type: MESSAGE_TYPES.RESTORE_PAGE,
            payload: { captureId: operation.captureId },
          });
        } catch (error) {
          console.warn("Scroll2PDF could not restore the original page context:", error);
        }
      }
      if (offscreenReady) {
        try {
          await deps.sendOffscreen({
            type: MESSAGE_TYPES.OFFSCREEN_RESET_CAPTURE,
            target: "offscreen",
            payload: { captureId: operation.captureId },
          });
        } catch (_) {
          // Closing the offscreen document also releases encoded frames.
        }
        try {
          await deps.closeOffscreen();
        } catch (_) {
          // The document may already have closed after a browser failure.
        }
      }
    }

    throwIfCancelled(operation);
    return captureResult;
  }

  // Captures exactly what the user sees: a single screenshot of the visible
  // viewport, saved as-is with no scrolling or stitching. The frame goes
  // through the offscreen processor so the result record (filename, format,
  // temporary IndexedDB handoff) matches every other capture mode.
  async function executeNormalScreenshot(operation, deps) {
    let offscreenReady = false;
    try {
      throwIfCancelled(operation);
      let selectedViewport = null;
      if (operation.configuration.selectScreenshotArea) {
        const response = await deps.sendTabMessage(operation.tabId, {
          type: MESSAGE_TYPES.START_SCREENSHOT_SELECTION,
          payload: { captureId: operation.captureId },
        });
        if (response?.cancelled) throw new CaptureCancelledError();
        selectedViewport = requireMessageResponse(
          response,
          "Screenshot area selection could not start on this page.",
        ).selection;
        if (!selectedViewport?.cropRectCss
            || !Number.isFinite(selectedViewport.viewportCssWidth)
            || !Number.isFinite(selectedViewport.viewportCssHeight)) {
          throw new Error("Screenshot area selection metadata is incomplete.");
        }
        throwIfCancelled(operation);
        await deps.delay(50);
      }
      await deps.ensureOffscreen();
      offscreenReady = true;
      requireMessageResponse(await deps.sendOffscreen({
        type: MESSAGE_TYPES.OFFSCREEN_RESET_CAPTURE,
        target: "offscreen",
        payload: { captureId: operation.captureId },
      }), "Could not initialize the screenshot.");
      await operation.report({
        phase: CAPTURE_PHASES.CAPTURING,
        message: "Taking screenshot…",
      });
      const format = getImageFormat(operation.configuration.quality);
      const captureOptions = { format: format.captureFormat };
      if (format.captureQuality) captureOptions.quality = format.captureQuality;
      const imageDataUrl = await deps.captureVisibleTab(operation.windowId, captureOptions);
      throwIfCancelled(operation);
      operation.completed = 1;
      operation.total = 1;
      requireMessageResponse(await deps.sendOffscreen({
        type: MESSAGE_TYPES.OFFSCREEN_ADD_CAPTURE,
        target: "offscreen",
        payload: {
          captureId: operation.captureId,
          frame: {
            screenshot: true,
            contentPositionCss: 0,
            timestamp: Date.now(),
            imageDataUrl,
            ...(selectedViewport || {}),
          },
        },
      }), "Could not queue the screenshot.");
      throwIfCancelled(operation);
      await operation.report({
        phase: CAPTURE_PHASES.STITCHING,
        message: "Saving screenshot…",
      });
      const filename = buildCaptureFilename(
        operation.pageUrl,
        operation.configuration.quality,
        new Date(),
      );
      const stitched = requireMessageResponse(await deps.sendOffscreen({
        type: MESSAGE_TYPES.OFFSCREEN_STITCH_CAPTURE,
        target: "offscreen",
        payload: {
          captureId: operation.captureId,
          screenshot: true,
          quality: operation.configuration.quality,
          filename,
          captureMode: operation.configuration.captureMode,
          captureModeLabel: "Screenshot",
          orientation: operation.configuration.orientation,
        },
      }), "Screenshot saving failed.");
      return stitched.result;
    } finally {
      if (offscreenReady) {
        try {
          await deps.sendOffscreen({
            type: MESSAGE_TYPES.OFFSCREEN_RESET_CAPTURE,
            target: "offscreen",
            payload: { captureId: operation.captureId },
          });
        } catch (_) {
          // Closing the offscreen document also releases encoded frames.
        }
        try {
          await deps.closeOffscreen();
        } catch (_) {
          // The document may already have closed after a browser failure.
        }
      }
    }
  }

  async function hasOffscreenDocument() {
    const url = chrome.runtime.getURL(OFFSCREEN_PATH);
    if (chrome.runtime.getContexts) {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [url],
      });
      return contexts.length > 0;
    }
    if (globalScope.clients?.matchAll) {
      const clients = await globalScope.clients.matchAll();
      return clients.some((client) => client.url === url);
    }
    return false;
  }

  async function ensureOffscreen() {
    if (await hasOffscreenDocument()) {
      return;
    }
    if (!creatingOffscreenDocument) {
      creatingOffscreenDocument = chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: ["BLOBS"],
        justification: "Decode, stitch, paginate, encode, and temporarily store local capture results.",
      }).finally(() => {
        creatingOffscreenDocument = null;
      });
    }
    await creatingOffscreenDocument;
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  // Pages opened before the extension was installed or reloaded do not have the
  // declared content script yet. PING first, then inject the packaged content
  // scripts on demand so every ordinary HTTP/HTTPS page can be captured without
  // requiring the user to reload the tab.
  async function pingTab(tabId) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: MESSAGE_TYPES.PING });
      return Boolean(response?.ok && response?.ready);
    } catch (_) {
      return false;
    }
  }

  async function ensureContentScriptsInTab(tabId, tabUrl) {
    if (await pingTab(tabId)) return true;
    if (isRestrictedCaptureUrl(tabUrl)) {
      throw new Error(protectedPageMessage(tabUrl));
    }
    const files = globalScope.Scroll2PDFConstants?.CONTENT_SCRIPT_FILES;
    if (!Array.isArray(files) || !files.length) {
      throw new Error("The packaged content scripts are unavailable.");
    }
    await chrome.scripting.executeScript({
      target: { tabId },
      files,
    });
    if (!(await pingTab(tabId))) {
      throw new Error(UNREACHABLE_PAGE_MESSAGE);
    }
    return true;
  }

  async function assertTargetActive(operation) {
    const [tab] = await chrome.tabs.query({ active: true, windowId: operation.windowId });
    if (!tab || tab.id !== operation.tabId) {
      throw new Error("Keep the page tab active until Scroll2PDF finishes capturing it.");
    }
  }

  function createChromeCaptureDependencies() {
    return {
      assertTargetActive,
      captureVisibleTab: (windowId, options) => chrome.tabs.captureVisibleTab(windowId, options),
      closeOffscreen: async () => {
        if (await hasOffscreenDocument()) {
          await chrome.offscreen.closeDocument();
        }
      },
      ensureOffscreen,
      ensureContentScripts: ensureContentScriptsInTab,
      getActiveTab,
      openResult: (resultId) => chrome.tabs.create({
        url: chrome.runtime.getURL(`result/result.html?id=${encodeURIComponent(resultId)}`),
      }),
      sendOffscreen: (message) => chrome.runtime.sendMessage(message),
      sendTabMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
      broadcast: (message) => chrome.runtime.sendMessage(message),
      cancelOperation: (operation) => Promise.allSettled([
        chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.OFFSCREEN_CANCEL_CAPTURE,
          target: "offscreen",
          payload: { captureId: operation.captureId },
        }),
        chrome.tabs.sendMessage(operation.tabId, {
          type: MESSAGE_TYPES.CANCEL_PAGE_SELECTION,
          payload: { captureId: operation.captureId },
        }),
      ]),
      createId: createCaptureId,
      delay,
    };
  }

  Object.defineProperty(globalScope, "Scroll2PDFFullPageCapture", {
    value: Object.freeze({
      CaptureCancelledError,
      PROTECTED_PAGE_MESSAGE,
      STAGE_3_MESSAGE,
      createCaptureManager,
      createChromeCaptureDependencies,
      executeFullPageCapture,
      protectedPageMessage,
    }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
