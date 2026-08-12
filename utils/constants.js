(function initializeScroll2PDFConstants(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFConstants) {
    return;
  }

  const CAPTURE_MODES = Object.freeze({
    FULL_PAGE: "full-page",
    SCROLLABLE_AREA: "scrollable-area",
    SELECTED_AREA: "selected-area",
    NORMAL_SCREENSHOT: "normal-screenshot",
  });

  const OUTPUT_TYPES = Object.freeze({
    A4_PDF: "a4-pdf",
    LONG_IMAGE: "long-image",
  });

  const QUALITY_LEVELS = Object.freeze({
    STANDARD: "standard",
    HIGH: "high",
  });

  const ORIENTATIONS = Object.freeze({
    PORTRAIT: "portrait",
    LANDSCAPE: "landscape",
  });

  const MESSAGE_TYPES = Object.freeze({
    START_CAPTURE: "START_CAPTURE",
    START_SCREENSHOT_SELECTION: "START_SCREENSHOT_SELECTION",
    START_REGION_SELECTION: "START_REGION_SELECTION",
    CANCEL_PAGE_SELECTION: "CANCEL_PAGE_SELECTION",
    PREPARE_REGION_CAPTURE: "PREPARE_REGION_CAPTURE",
    GET_REGION_METRICS: "GET_REGION_METRICS",
    SCROLL_REGION_TO_POSITION: "SCROLL_REGION_TO_POSITION",
    SET_REGION_OVERLAYS_HIDDEN: "SET_REGION_OVERLAYS_HIDDEN",
    RESTORE_REGION_BOTTOM_CHROME: "RESTORE_REGION_BOTTOM_CHROME",
    ADVANCE_DIFFICULT_CAPTURE: "ADVANCE_DIFFICULT_CAPTURE",
    LOAD_OLDER_HISTORY: "LOAD_OLDER_HISTORY",
    RECOVER_DIFFICULT_CAPTURE: "RECOVER_DIFFICULT_CAPTURE",
    RESTORE_REGION_CAPTURE: "RESTORE_REGION_CAPTURE",
    PREPARE_FULL_PAGE_CAPTURE: "PREPARE_FULL_PAGE_CAPTURE",
    GET_PAGE_METRICS: "GET_PAGE_METRICS",
    SCROLL_TO_POSITION: "SCROLL_TO_POSITION",
    SET_CAPTURE_OVERLAYS_HIDDEN: "SET_CAPTURE_OVERLAYS_HIDDEN",
    RESTORE_PAGE: "RESTORE_PAGE",
    GET_CAPTURE_STATUS: "GET_CAPTURE_STATUS",
    CANCEL_CAPTURE: "CANCEL_CAPTURE",
    CAPTURE_PROGRESS: "CAPTURE_PROGRESS",
    CAPTURE_COMPLETE: "CAPTURE_COMPLETE",
    CAPTURE_ERROR: "CAPTURE_ERROR",
    CAPTURE_CANCELLED: "CAPTURE_CANCELLED",
    OFFSCREEN_RESET_CAPTURE: "OFFSCREEN_RESET_CAPTURE",
    OFFSCREEN_ADD_CAPTURE: "OFFSCREEN_ADD_CAPTURE",
    OFFSCREEN_DROP_LAST_CAPTURE: "OFFSCREEN_DROP_LAST_CAPTURE",
    OFFSCREEN_STITCH_CAPTURE: "OFFSCREEN_STITCH_CAPTURE",
    OFFSCREEN_PLAN_PDF: "OFFSCREEN_PLAN_PDF",
    OFFSCREEN_RENDER_PDF_PAGE: "OFFSCREEN_RENDER_PDF_PAGE",
    OFFSCREEN_FINALIZE_PDF: "OFFSCREEN_FINALIZE_PDF",
    OFFSCREEN_CANCEL_CAPTURE: "OFFSCREEN_CANCEL_CAPTURE",
    PING: "PING",
  });

  const CAPTURE_PHASES = Object.freeze({
    SELECTING: "selecting",
    PREPARING: "preparing",
    CAPTURING: "capturing",
    STITCHING: "stitching",
    CREATING_PDF: "creating-pdf",
    CANCELLING: "cancelling",
  });

  const CAPTURE_LIMITS = Object.freeze({
    MAX_VIEWPORT_CAPTURES: 500,
    MAX_CAPTURE_DURATION_MS: 600000,
    MIN_CAPTURE_INTERVAL_MS: 550,
    PAGE_SETTLE_MS: 180,
    MAX_BITMAP_DIMENSION: 32767,
    MAX_BITMAP_AREA: 160000000,
    MAX_OVERLAY_SCAN_ELEMENTS: 10000,
    SCALE_MISMATCH_TOLERANCE: 0.03,
    MIN_REGION_SIZE_CSS: 80,
    VIEWPORT_EDGE_TOLERANCE_CSS: 2,
    REGION_SIZE_CHANGE_MIN_CSS: 4,
    REGION_SIZE_CHANGE_RATIO: 0.05,
    CROP_WIDTH_TOLERANCE_PX: 2,
    CROP_WIDTH_TOLERANCE_RATIO: 0.01,
    SCROLL_POSITION_TOLERANCE_CSS: 2,
    // Fraction of the viewport treated as "reached the bottom". Virtualized
    // lists and self-resizing containers can wobble their client height by a
    // few pixels per scroll; without this margin the capture oscillates at the
    // bottom instead of finishing.
    BOTTOM_COVER_TOLERANCE_RATIO: 0.02,
    STALL_RETRY_LIMIT: 3,
    MAX_PDF_PAGES: 1000,
    MAX_DIFFICULT_CAPTURE_DURATION_MS: 600000,
    MAX_DYNAMIC_CAPTURE_FRAMES: 300,
    MAX_HISTORY_LOAD_ATTEMPTS: 40,
    HISTORY_STABLE_RETRIES: 3,
    HISTORY_MUTATION_WAIT_MS: 4000,
    HISTORY_STABLE_INTERVAL_MS: 200,
    HISTORY_STABLE_CHECKS: 3,
    LAZY_MEDIA_WAIT_MS: 1500,
    REPEATED_VIEWPORT_LIMIT: 3,
    CORRECTIVE_SCROLL_ATTEMPTS: 1,
    FINGERPRINT_HISTORY_LIMIT: 64,
    MAX_SEAM_SEARCH_CSS: 160,
    DYNAMIC_GEOMETRY_MIN_TOLERANCE_CSS: 8,
    DYNAMIC_GEOMETRY_RATIO_TOLERANCE: 0.04,
    DYNAMIC_POSITION_TOLERANCE_CSS: 40,
  });

  // Ordered content-script files. Must stay in sync with manifest.json so the
  // background can inject them on demand into tabs that predate the extension
  // load (for example after a development reload).
  const CONTENT_SCRIPT_FILES = Object.freeze([
    "utils/constants.js",
    "utils/capture-utils.js",
    "utils/difficult-page-utils.js",
    "content/capture-stability.js",
    "content/iframe-expansion.js",
    "content/page-capture.js",
    "content/selection-overlay.js",
    "content/adapters/generic-chat-adapter.js",
    "content/adapters/whatsapp-adapter.js",
    "content/adapters/telegram-adapter.js",
    "content/adapters/adapter-registry.js",
    "content/difficult-page-capture.js",
    "content/scrollable-selection.js",
    "content/screenshot-selection.js",
    "content/selected-area.js",
    "content/content.js",
  ]);

  const DEFAULT_CONFIG = Object.freeze({
    captureMode: CAPTURE_MODES.FULL_PAGE,
    outputType: OUTPUT_TYPES.A4_PDF,
    quality: QUALITY_LEVELS.HIGH,
    orientation: ORIENTATIONS.PORTRAIT,
    selectScreenshotArea: false,
  });

  Object.defineProperty(globalScope, "Scroll2PDFConstants", {
    value: Object.freeze({
      CAPTURE_MODES,
      OUTPUT_TYPES,
      QUALITY_LEVELS,
      ORIENTATIONS,
      MESSAGE_TYPES,
      CAPTURE_PHASES,
      CAPTURE_LIMITS,
      CONTENT_SCRIPT_FILES,
      DEFAULT_CONFIG,
    }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
