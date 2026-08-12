(function initializeScroll2PDFCaptureUtils(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFCaptureUtils) {
    return;
  }

  const { CAPTURE_LIMITS, QUALITY_LEVELS } = globalScope.Scroll2PDFConstants;

  function finiteNonNegative(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  }

  function finitePositive(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
      throw new Error(`${label} must be a positive number.`);
    }
    return number;
  }

  function dimensionsFor(element = {}) {
    return {
      heights: [element.scrollHeight, element.offsetHeight, element.clientHeight]
        .map(finiteNonNegative),
      widths: [element.scrollWidth, element.offsetWidth, element.clientWidth]
        .map(finiteNonNegative),
    };
  }

  function calculatePageDimensions(input) {
    const documentElement = dimensionsFor(input?.documentElement);
    const body = dimensionsFor(input?.body);
    const viewportWidth = finiteNonNegative(input?.viewportWidth);
    const viewportHeight = finiteNonNegative(input?.viewportHeight);

    return {
      totalWidth: Math.max(viewportWidth, ...documentElement.widths, ...body.widths),
      totalHeight: Math.max(viewportHeight, ...documentElement.heights, ...body.heights),
      viewportWidth,
      viewportHeight,
      scrollX: finiteNonNegative(input?.scrollX),
      scrollY: finiteNonNegative(input?.scrollY),
      devicePixelRatio: finitePositive(input?.devicePixelRatio || 1, "Device pixel ratio"),
    };
  }

  function buildScrollPositions(totalHeightValue, viewportHeightValue) {
    const totalHeight = finitePositive(totalHeightValue, "Total height");
    const viewportHeight = finitePositive(viewportHeightValue, "Viewport height");
    const maximumScroll = Math.max(0, totalHeight - viewportHeight);
    const positions = [0];
    let current = 0;

    while (current < maximumScroll) {
      const next = Math.min(current + viewportHeight, maximumScroll);
      if (next <= current) {
        break;
      }
      positions.push(next);
      current = next;
    }

    return positions;
  }

  function getNextScrollPosition(actualYValue, totalHeightValue, viewportHeightValue) {
    const actualY = finiteNonNegative(actualYValue);
    const totalHeight = finitePositive(totalHeightValue, "Total height");
    const viewportHeight = finitePositive(viewportHeightValue, "Viewport height");
    const maximumScroll = Math.max(0, totalHeight - viewportHeight);

    if (actualY + viewportHeight >= totalHeight || actualY >= maximumScroll) {
      return null;
    }

    const next = Math.min(actualY + viewportHeight, maximumScroll);
    return next > actualY ? next : null;
  }

  function calculateBitmapScale(frame, tolerance = CAPTURE_LIMITS.SCALE_MISMATCH_TOLERANCE) {
    const bitmapWidth = finitePositive(frame?.bitmapWidth, "Bitmap width");
    const bitmapHeight = finitePositive(frame?.bitmapHeight, "Bitmap height");
    const viewportCssWidth = finitePositive(frame?.viewportCssWidth, "CSS viewport width");
    const viewportCssHeight = finitePositive(frame?.viewportCssHeight, "CSS viewport height");
    const x = bitmapWidth / viewportCssWidth;
    const y = bitmapHeight / viewportCssHeight;
    const mismatch = Math.abs(x - y) / Math.max(x, y);

    if (mismatch > tolerance) {
      throw new Error("Screenshot scale is inconsistent with the CSS viewport.");
    }

    return { x, y };
  }

  function calculateFrameDrawPlan(input) {
    const actualY = finiteNonNegative(input?.actualY);
    const viewportCssHeight = finitePositive(input?.viewportCssHeight, "CSS viewport height");
    const bitmapHeight = finitePositive(input?.bitmapHeight, "Bitmap height");
    const totalHeightCss = finitePositive(input?.totalHeightCss, "Total CSS height");
    const coveredBottomCss = finiteNonNegative(input?.coveredBottomCss);
    const scaleY = finitePositive(input?.scaleY, "Vertical bitmap scale");
    const finalBitmapHeight = finitePositive(input?.finalBitmapHeight, "Final bitmap height");
    const contentStartCss = finiteNonNegative(input?.contentStartCss);

    if (actualY > coveredBottomCss + 0.5) {
      throw new Error(`Capture gap detected before CSS position ${actualY}.`);
    }

    const sourceStartCss = Math.max(0, coveredBottomCss - actualY);
    const availableCss = Math.max(0, viewportCssHeight - sourceStartCss);
    const remainingDocumentCss = Math.max(0, totalHeightCss - actualY - sourceStartCss);
    const drawableCss = Math.min(availableCss, remainingDocumentCss);
    const sourceY = Math.round(sourceStartCss * scaleY);
    const destinationY = Math.round((actualY + sourceStartCss - contentStartCss) * scaleY);
    const requestedHeight = Math.round(drawableCss * scaleY);
    const sourceHeight = Math.max(0, Math.min(
      requestedHeight,
      bitmapHeight - sourceY,
      finalBitmapHeight - destinationY,
    ));
    const bottomTolerance = Math.max(
      CAPTURE_LIMITS.SCROLL_POSITION_TOLERANCE_CSS,
      viewportCssHeight * CAPTURE_LIMITS.BOTTOM_COVER_TOLERANCE_RATIO,
    );
    const reachesDocumentBottom = actualY + viewportCssHeight
      >= totalHeightCss - bottomTolerance;
    const destinationHeight = sourceHeight > 0 && reachesDocumentBottom
      ? Math.max(sourceHeight, finalBitmapHeight - destinationY)
      : sourceHeight;

    if (sourceHeight <= 0 && actualY + sourceStartCss < totalHeightCss) {
      throw new Error("Capture frame has no drawable pixels.");
    }

    return {
      sourceY,
      sourceHeight,
      destinationY,
      destinationHeight,
      nextCoveredBottomCss: reachesDocumentBottom
        && (sourceHeight > 0 || coveredBottomCss >= totalHeightCss - CAPTURE_LIMITS.SCROLL_POSITION_TOLERANCE_CSS)
        ? totalHeightCss
        : Math.min(totalHeightCss, actualY + sourceStartCss + (sourceHeight / scaleY)),
    };
  }

  function validateCanvasSize(widthValue, heightValue, limits = CAPTURE_LIMITS) {
    const width = Math.ceil(finitePositive(widthValue, "Canvas width"));
    const height = Math.ceil(finitePositive(heightValue, "Canvas height"));

    if (width > limits.MAX_BITMAP_DIMENSION || height > limits.MAX_BITMAP_DIMENSION) {
      throw new Error(`This page is too ${height > limits.MAX_BITMAP_DIMENSION ? "long" : "wide"} to capture in one image — the browser limits a single image to ${limits.MAX_BITMAP_DIMENSION}px per side (current ${width} × ${height}px). Reduce the browser zoom or capture a shorter region.`);
    }

    const pixels = width * height;
    if (pixels > limits.MAX_BITMAP_AREA) {
      throw new Error(`This page is too large to capture in one image — the browser limits a single image to ${limits.MAX_BITMAP_AREA} pixels total (current ${width} × ${height}px). Reduce the browser zoom or capture a shorter region.`);
    }

    return { width, height, pixels };
  }

  function sanitizeHostname(hostname) {
    return String(hostname || "")
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, "-")
      .replace(/[.-]{2,}/g, "-")
      .replace(/^[.-]+|[.-]+$/g, "") || "page";
  }

  function getImageFormat(quality) {
    if (quality === QUALITY_LEVELS.STANDARD) {
      return {
        captureFormat: "jpeg",
        captureQuality: 95,
        mimeType: "image/jpeg",
        extension: "jpg",
        encodeQuality: 0.95,
      };
    }

    if (quality === QUALITY_LEVELS.HIGH) {
      return {
        captureFormat: "png",
        mimeType: "image/png",
        extension: "png",
      };
    }

    throw new Error("Unsupported image quality.");
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function buildCaptureFilename(_pageUrl, quality, instant = new Date()) {
    const date = instant instanceof Date ? instant : new Date(instant);
    if (Number.isNaN(date.getTime())) {
      throw new Error("A valid capture date is required.");
    }
    const captureDate = [
      date.getUTCFullYear(),
      pad(date.getUTCMonth() + 1),
      pad(date.getUTCDate()),
    ].join("-");
    return `scroll2pdf-${captureDate}.${getImageFormat(quality).extension}`;
  }

  // Classifies a tab URL for capture eligibility. Browser-owned protocols
  // (chrome://, about:, file:, data:, chrome-extension://, …) and the Chrome Web
  // Store can never be captured by any extension; every ordinary HTTP/HTTPS
  // page is eligible.
  function classifyCaptureUrl(value) {
    let url = null;
    try {
      url = new URL(value);
    } catch (_) {
      return { restricted: true, reason: "unknown" };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { restricted: true, reason: "protocol" };
    }
    const hostname = url.hostname.toLowerCase();
    if (hostname === "chromewebstore.google.com"
        || (hostname === "chrome.google.com" && url.pathname.startsWith("/webstore"))) {
      return { restricted: true, reason: "webstore" };
    }
    return { restricted: false, reason: null };
  }

  function isRestrictedCaptureUrl(value) {
    return classifyCaptureUrl(value).restricted;
  }

  function normalizedRect(rect) {
    const left = Number(rect?.left);
    const top = Number(rect?.top);
    const width = Number(rect?.width);
    const height = Number(rect?.height);
    const right = Number.isFinite(Number(rect?.right)) ? Number(rect.right) : left + width;
    const bottom = Number.isFinite(Number(rect?.bottom)) ? Number(rect.bottom) : top + height;
    return {
      left,
      top,
      right,
      bottom,
      width: Number.isFinite(width) ? width : right - left,
      height: Number.isFinite(height) ? height : bottom - top,
    };
  }

  function isRectFullyVisible(rectValue, viewportWidthValue, viewportHeightValue, toleranceValue = 0) {
    const rect = normalizedRect(rectValue);
    const viewportWidth = finitePositive(viewportWidthValue, "Viewport width");
    const viewportHeight = finitePositive(viewportHeightValue, "Viewport height");
    const tolerance = finiteNonNegative(toleranceValue);
    return Object.values(rect).every(Number.isFinite)
      && rect.width > 0
      && rect.height > 0
      && rect.left >= -tolerance
      && rect.top >= -tolerance
      && rect.right <= viewportWidth + tolerance
      && rect.bottom <= viewportHeight + tolerance;
  }

  function isVerticallyScrollableCandidate(input) {
    const rect = normalizedRect(input?.rect);
    const style = input?.style || {};
    const overflowY = String(style.overflowY || "").toLowerCase();
    const opacity = Number.parseFloat(style.opacity ?? "1");
    const viewportWidth = finiteNonNegative(input?.viewportWidth);
    const viewportHeight = finiteNonNegative(input?.viewportHeight);
    const intersectsViewport = rect.right > 0
      && rect.bottom > 0
      && rect.left < viewportWidth
      && rect.top < viewportHeight;
    return Number(input?.scrollHeight) > Number(input?.clientHeight) + 1
      && Number(input?.clientHeight) > 0
      && Number(input?.clientWidth) > 0
      && rect.width >= CAPTURE_LIMITS.MIN_REGION_SIZE_CSS
      && rect.height >= CAPTURE_LIMITS.MIN_REGION_SIZE_CSS
      && intersectsViewport
      && ["auto", "scroll", "overlay"].includes(overflowY)
      && style.display !== "none"
      && style.visibility !== "hidden"
      && style.visibility !== "collapse"
      && Number.isFinite(opacity)
      && opacity > 0;
  }

  function normalizeSelectionRect(start, end, viewport) {
    const viewportWidth = finitePositive(viewport?.width, "Viewport width");
    const viewportHeight = finitePositive(viewport?.height, "Viewport height");
    const startX = Math.min(viewportWidth, Math.max(0, Number(start?.x) || 0));
    const startY = Math.min(viewportHeight, Math.max(0, Number(start?.y) || 0));
    const endX = Math.min(viewportWidth, Math.max(0, Number(end?.x) || 0));
    const endY = Math.min(viewportHeight, Math.max(0, Number(end?.y) || 0));
    const left = Math.min(startX, endX);
    const top = Math.min(startY, endY);
    const right = Math.max(startX, endX);
    const bottom = Math.max(startY, endY);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function isSelectionLargeEnough(rect, minimum = CAPTURE_LIMITS.MIN_REGION_SIZE_CSS) {
    return Number(rect?.width) >= minimum && Number(rect?.height) >= minimum;
  }

  function convertCssRectToBitmapCrop(input) {
    const viewportCssWidth = finitePositive(input?.viewportCssWidth, "CSS viewport width");
    const viewportCssHeight = finitePositive(input?.viewportCssHeight, "CSS viewport height");
    const bitmapWidth = Math.floor(finitePositive(input?.bitmapWidth, "Bitmap width"));
    const bitmapHeight = Math.floor(finitePositive(input?.bitmapHeight, "Bitmap height"));
    const rect = normalizedRect(input?.rect);
    const leftCss = Math.min(viewportCssWidth, Math.max(0, rect.left));
    const topCss = Math.min(viewportCssHeight, Math.max(0, rect.top));
    const rightCss = Math.min(viewportCssWidth, Math.max(leftCss, rect.right));
    const bottomCss = Math.min(viewportCssHeight, Math.max(topCss, rect.bottom));
    const scaleX = bitmapWidth / viewportCssWidth;
    const scaleY = bitmapHeight / viewportCssHeight;
    const x = Math.min(bitmapWidth, Math.max(0, Math.floor(leftCss * scaleX)));
    const y = Math.min(bitmapHeight, Math.max(0, Math.floor(topCss * scaleY)));
    const right = Math.min(bitmapWidth, Math.max(x, Math.ceil(rightCss * scaleX)));
    const bottom = Math.min(bitmapHeight, Math.max(y, Math.ceil(bottomCss * scaleY)));
    if (right - x < 1 || bottom - y < 1) {
      throw new Error("The selected crop does not contain any bitmap pixels.");
    }
    return { x, y, width: right - x, height: bottom - y, right, bottom, scaleX, scaleY };
  }

  function buildRegionScrollPositions(totalHeightValue, regionHeightValue, startValue = 0) {
    const totalHeight = finitePositive(totalHeightValue, "Total content height");
    const regionHeight = finitePositive(regionHeightValue, "Region height");
    const maximumScroll = Math.max(0, totalHeight - regionHeight);
    const start = Math.min(maximumScroll, finiteNonNegative(startValue));
    const positions = [start];
    let current = start;
    while (current < maximumScroll) {
      const next = Math.min(current + regionHeight, maximumScroll);
      if (next <= current) break;
      positions.push(next);
      current = next;
    }
    return positions;
  }

  function getNextRegionScrollPosition(
    actualValue,
    totalHeightValue,
    regionHeightValue,
    toleranceValue = CAPTURE_LIMITS.SCROLL_POSITION_TOLERANCE_CSS,
  ) {
    const actual = finiteNonNegative(actualValue);
    const totalHeight = finitePositive(totalHeightValue, "Total content height");
    const regionHeight = finitePositive(regionHeightValue, "Region height");
    const tolerance = finiteNonNegative(toleranceValue);
    const maximumScroll = Math.max(0, totalHeight - regionHeight);
    if (actual + regionHeight >= totalHeight - tolerance || actual >= maximumScroll - tolerance) return null;
    const next = Math.min(actual + regionHeight, maximumScroll);
    return next > actual ? next : null;
  }

  function effectiveViewportOverflowY(win = globalScope, doc = win?.document) {
    const documentElement = doc?.documentElement;
    if (!documentElement?.style) return "visible";
    const documentOverflow = String(win.getComputedStyle(documentElement).overflowY || "").toLowerCase();
    if (documentOverflow !== "visible") return documentOverflow;
    const body = doc?.body;
    if (body?.style) {
      const bodyOverflow = String(win.getComputedStyle(body).overflowY || "").toLowerCase();
      if (bodyOverflow !== "visible") return bodyOverflow;
    }
    return "visible";
  }

  // True when the browser viewport itself can scroll (window.scrollTo moves the page).
  function windowCanScroll(win = globalScope, doc = win?.document) {
    const documentElement = doc?.documentElement;
    if (!documentElement?.style) return false;
    const contentHeight = Math.max(
      finiteNonNegative(documentElement.scrollHeight),
      finiteNonNegative(doc?.body?.scrollHeight),
    );
    if (contentHeight <= finiteNonNegative(win?.innerHeight) + 1) return false;
    return ["auto", "scroll", "overlay", "visible"].includes(effectiveViewportOverflowY(win, doc));
  }

  // Finds the most likely main vertical scroll container when the window itself
  // cannot scroll (app shells such as Discord, Slack, Teams, VS Code Web, …).
  function findBestScrollContainer(win = globalScope, doc = win?.document, options = {}) {
    const body = doc?.body;
    if (!body?.getBoundingClientRect) return null;
    const limit = Math.max(1, Math.floor(finiteNonNegative(options?.limit) || CAPTURE_LIMITS.MAX_OVERLAY_SCAN_ELEMENTS));
    const viewportWidth = Math.max(1, finiteNonNegative(win?.innerWidth));
    const viewportHeight = Math.max(1, finiteNonNegative(win?.innerHeight));
    const candidates = [];
    const stack = [body];
    let visited = 0;

    while (stack.length > 0 && visited < limit) {
      const element = stack.pop();
      visited += 1;
      if (!element?.getBoundingClientRect) continue;
      const scrollHeight = finiteNonNegative(element.scrollHeight);
      const clientHeight = finiteNonNegative(element.clientHeight);
      if (scrollHeight > clientHeight + 1 && clientHeight >= 120) {
        const rect = normalizedRect(element.getBoundingClientRect());
        const intersectsViewport = rect.right > 0 && rect.bottom > 0
          && rect.left < viewportWidth && rect.top < viewportHeight;
        if (intersectsViewport && rect.width >= CAPTURE_LIMITS.MIN_REGION_SIZE_CSS
            && rect.height >= CAPTURE_LIMITS.MIN_REGION_SIZE_CSS) {
          const overflowY = String(win.getComputedStyle(element).overflowY || "").toLowerCase();
          if (["auto", "scroll", "overlay"].includes(overflowY)) {
            candidates.push({ element, rect, scrollHeight, clientHeight });
          }
        }
      }
      if (element.children) {
        for (let index = element.children.length - 1; index >= 0; index -= 1) {
          stack.push(element.children[index]);
        }
      }
    }

    if (!candidates.length) return null;
    let best = null;
    let bestScore = -Infinity;
    for (const candidate of candidates) {
      const area = Math.max(0, candidate.rect.width) * Math.max(0, candidate.rect.height);
      const coverage = area / Math.max(1, viewportWidth * viewportHeight);
      const extent = Math.max(0, candidate.scrollHeight - candidate.clientHeight);
      const extentRatio = Math.min(1, extent / Math.max(1, viewportHeight));
      const widthRatio = Math.min(1, candidate.rect.width / Math.max(1, viewportWidth));
      const score = (coverage * 0.6) + (extentRatio * 0.25) + (widthRatio * 0.15);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best ? best.element : null;
  }

  // Walks up from an element (or from a point's element stack) to the deepest
  // visible, vertically scrollable ancestor. Used by Selected Area when the
  // window itself cannot scroll.
  function findScrollableAncestor(elementOrPath, win = globalScope, doc = win?.document) {
    const elements = Array.isArray(elementOrPath) ? elementOrPath : [elementOrPath];
    const documentElement = doc?.documentElement;
    const viewportWidth = Math.max(1, finiteNonNegative(win?.innerWidth));
    const viewportHeight = Math.max(1, finiteNonNegative(win?.innerHeight));
    for (const root of elements) {
      let current = root;
      let guard = 0;
      while (current && current !== documentElement && current !== doc?.body && guard < 60) {
        if (current?.getBoundingClientRect) {
          const overflowY = String(win.getComputedStyle(current).overflowY || "").toLowerCase();
          const scrollHeight = finiteNonNegative(current.scrollHeight);
          const clientHeight = finiteNonNegative(current.clientHeight);
          if (["auto", "scroll", "overlay"].includes(overflowY)
              && scrollHeight > clientHeight + 1
              && clientHeight > 0) {
            const rect = normalizedRect(current.getBoundingClientRect());
            if (rect.width >= CAPTURE_LIMITS.MIN_REGION_SIZE_CSS
                && rect.height >= CAPTURE_LIMITS.MIN_REGION_SIZE_CSS
                && rect.right > 0 && rect.bottom > 0
                && rect.left < viewportWidth && rect.top < viewportHeight) {
              return current;
            }
          }
        }
        current = current.parentElement;
        guard += 1;
      }
    }
    return null;
  }

  function buildSelectedAreaPagePositions(input) {
    const startPageY = finiteNonNegative(input?.startPageY);
    const totalHeight = finitePositive(input?.totalHeight, "Total page height");
    const viewportHeight = finitePositive(input?.viewportHeight, "Viewport height");
    const selectionHeight = finitePositive(input?.selectionHeight, "Selection height");
    const maximumScroll = Math.max(0, totalHeight - viewportHeight);
    const start = Math.min(startPageY, maximumScroll);
    const positions = [start];
    let current = start;
    while (current < maximumScroll) {
      const next = Math.min(current + selectionHeight, maximumScroll);
      if (next <= current) break;
      positions.push(next);
      current = next;
    }
    return positions;
  }

  function calculateSelectedAreaCrop(input) {
    const rect = normalizedRect(input?.originalRect);
    if (!input?.finalFrame) return { ...rect, shifted: false, shiftY: 0 };
    const actualPageY = finiteNonNegative(input?.actualPageY);
    const totalHeight = finitePositive(input?.totalHeight, "Total page height");
    const viewportHeight = finitePositive(input?.viewportHeight, "Viewport height");
    const requiredShift = Math.max(0, totalHeight - (actualPageY + rect.bottom));
    const availableShift = Math.max(0, viewportHeight - rect.bottom);
    if (requiredShift > availableShift + 0.5) {
      throw new Error("The selected region can no longer reach the page bottom.");
    }
    const shiftY = Math.min(requiredShift, availableShift);
    return {
      left: rect.left,
      top: rect.top + shiftY,
      right: rect.right,
      bottom: rect.bottom + shiftY,
      width: rect.width,
      height: rect.height,
      shifted: shiftY > 0,
      shiftY,
    };
  }

  Object.defineProperty(globalScope, "Scroll2PDFCaptureUtils", {
    value: Object.freeze({
      buildCaptureFilename,
      buildRegionScrollPositions,
      buildScrollPositions,
      buildSelectedAreaPagePositions,
      calculateBitmapScale,
      calculateFrameDrawPlan,
      calculatePageDimensions,
      calculateSelectedAreaCrop,
      classifyCaptureUrl,
      convertCssRectToBitmapCrop,
      effectiveViewportOverflowY,
      findBestScrollContainer,
      findScrollableAncestor,
      getImageFormat,
      getNextScrollPosition,
      getNextRegionScrollPosition,
      isRectFullyVisible,
      isRestrictedCaptureUrl,
      isSelectionLargeEnough,
      isVerticallyScrollableCandidate,
      normalizeSelectionRect,
      sanitizeHostname,
      validateCanvasSize,
      windowCanScroll,
    }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
