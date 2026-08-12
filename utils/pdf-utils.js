(function initializeScroll2PDFPdfUtils(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFPdfUtils) return;

  const A4_PORTRAIT_MM = Object.freeze({ width: 210, height: 297 });
  const PDF_MARGIN_MM = 10;
  const POINTS_PER_INCH = 72;
  const MILLIMETERS_PER_INCH = 25.4;
  const MAX_UPSCALE = 1.25;
  const SMART_BREAK_WINDOW_RATIO = 0.08;
  const SMART_BREAK_WINDOW_CAP_PX = 256;
  const SMART_BREAK_MAX_SHORTEN_RATIO = 0.10;
  const DEFAULT_MINIMUM_BAND_ROWS = 4;
  const MAX_PDF_PAGES = globalScope.Scroll2PDFConstants?.CAPTURE_LIMITS?.MAX_PDF_PAGES || 500;

  function positive(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
      throw new Error(`${label} must be a positive number.`);
    }
    return number;
  }

  function mmToPoints(millimeters) {
    return Number(millimeters) * POINTS_PER_INCH / MILLIMETERS_PER_INCH;
  }

  function getA4PageSpec(orientation, marginMm = PDF_MARGIN_MM) {
    if (orientation !== "portrait" && orientation !== "landscape") {
      throw new Error("Unsupported A4 orientation.");
    }
    const dimensions = orientation === "portrait"
      ? A4_PORTRAIT_MM
      : { width: A4_PORTRAIT_MM.height, height: A4_PORTRAIT_MM.width };
    const margin = positive(marginMm, "PDF margin");
    if (margin * 2 >= dimensions.width || margin * 2 >= dimensions.height) {
      throw new Error("PDF margins leave no printable content area.");
    }
    const widthPt = mmToPoints(dimensions.width);
    const heightPt = mmToPoints(dimensions.height);
    const marginPt = mmToPoints(margin);
    return Object.freeze({
      orientation,
      widthMm: dimensions.width,
      heightMm: dimensions.height,
      marginMm: margin,
      widthPt,
      heightPt,
      marginPt,
      contentWidthPt: widthPt - (marginPt * 2),
      contentHeightPt: heightPt - (marginPt * 2),
    });
  }

  function calculatePdfLayout(sourceWidthValue, sourceHeightValue, pageSpec, maxUpscale = MAX_UPSCALE) {
    const sourceWidth = positive(sourceWidthValue, "Source width");
    const sourceHeight = positive(sourceHeightValue, "Source height");
    const upscale = positive(maxUpscale, "Maximum upscale");
    if (!pageSpec?.contentWidthPt || !pageSpec?.contentHeightPt) {
      throw new Error("A valid A4 page specification is required.");
    }
    const scale = Math.min(pageSpec.contentWidthPt / sourceWidth, upscale);
    const sourcePixelsPerPage = pageSpec.contentHeightPt / scale;
    const pageCount = Math.ceil(sourceHeight / sourcePixelsPerPage);
    if (pageCount > MAX_PDF_PAGES) {
      throw new Error(`PDF exceeds the ${MAX_PDF_PAGES}-page safety limit.`);
    }
    return Object.freeze({
      sourceWidth,
      sourceHeight,
      scale,
      sourcePixelsPerPage,
      displayWidthPt: sourceWidth * scale,
      pageCount,
    });
  }

  function getSmartBreakSearchWindow(pageSourceHeight) {
    return Math.max(1, Math.min(
      SMART_BREAK_WINDOW_CAP_PX,
      Math.floor(positive(pageSourceHeight, "Page source height") * SMART_BREAK_WINDOW_RATIO),
    ));
  }

  function getSmartBreakMinimumEnd(startValue, idealEndValue) {
    const start = Number(startValue);
    const idealEnd = Number(idealEndValue);
    if (!Number.isFinite(start) || !Number.isFinite(idealEnd) || idealEnd <= start) {
      throw new Error("A valid smart-break interval is required.");
    }
    return Math.ceil(idealEnd - ((idealEnd - start) * SMART_BREAK_MAX_SHORTEN_RATIO));
  }

  function chooseSmartBreak(input) {
    const start = Math.max(0, Math.floor(Number(input?.start) || 0));
    const idealEnd = Math.floor(positive(input?.idealEnd, "Ideal page boundary"));
    const sourceHeight = Math.floor(positive(input?.sourceHeight, "Source height"));
    const scores = input?.scores;
    if (!scores || typeof scores.length !== "number" || idealEnd >= sourceHeight) return idealEnd;
    const searchWindow = Math.max(1, Math.floor(input.searchWindow
      || getSmartBreakSearchWindow(idealEnd - start)));
    const minimumBandRows = Math.max(1, Math.floor(input.minimumBandRows || DEFAULT_MINIMUM_BAND_ROWS));
    const minimumEnd = Math.max(
      start + 1,
      getSmartBreakMinimumEnd(start, idealEnd),
      idealEnd - searchWindow,
    );
    const maximumEnd = Math.min(idealEnd - 1, scores.length - 1);
    if (maximumEnd - minimumEnd + 1 < minimumBandRows) return idealEnd;

    const finiteScores = [];
    for (let row = minimumEnd; row <= maximumEnd; row += 1) {
      const score = Number(scores[row]);
      if (Number.isFinite(score)) finiteScores.push(score);
    }
    if (finiteScores.length < minimumBandRows) return idealEnd;
    const sorted = finiteScores.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    let rolling = 0;
    let bestAverage = Infinity;
    let bestCenter = idealEnd;
    for (let row = minimumEnd; row <= maximumEnd; row += 1) {
      const score = Number(scores[row]);
      rolling += Number.isFinite(score) ? score : median;
      if (row - minimumEnd >= minimumBandRows) {
        const leaving = Number(scores[row - minimumBandRows]);
        rolling -= Number.isFinite(leaving) ? leaving : median;
      }
      if (row - minimumEnd + 1 >= minimumBandRows) {
        const average = rolling / minimumBandRows;
        if (average < bestAverage) {
          bestAverage = average;
          bestCenter = row - Math.floor((minimumBandRows - 1) / 2);
        }
      }
    }
    const quietEnough = median > 0
      ? bestAverage <= median * 0.82
      : bestAverage === 0;
    return quietEnough ? bestCenter : idealEnd;
  }

  function buildPageRanges(sourceHeightValue, pageSourceHeightValue, selectBoundary) {
    const sourceHeight = Math.ceil(positive(sourceHeightValue, "Source height"));
    const pageSourceHeight = positive(pageSourceHeightValue, "Page source height");
    const step = Math.max(1, Math.floor(pageSourceHeight));
    const ranges = [];
    let start = 0;
    while (start < sourceHeight) {
      if (ranges.length >= MAX_PDF_PAGES) {
        throw new Error(`PDF exceeds the ${MAX_PDF_PAGES}-page safety limit.`);
      }
      const idealEnd = Math.min(sourceHeight, start + step);
      let end = idealEnd;
      if (idealEnd < sourceHeight && typeof selectBoundary === "function") {
        const selected = Math.floor(Number(selectBoundary({
          start,
          idealEnd,
          sourceHeight,
          pageSourceHeight: step,
        })));
        const minimumEnd = getSmartBreakMinimumEnd(start, idealEnd);
        if (Number.isFinite(selected) && selected >= minimumEnd && selected <= idealEnd) {
          end = selected;
        }
      }
      if (end <= start) end = idealEnd;
      ranges.push(Object.freeze({ start, end, height: end - start }));
      start = end;
    }
    return Object.freeze(ranges);
  }

  function pad(value) { return String(value).padStart(2, "0"); }

  function buildPdfFilename(_pageUrl, instant = new Date()) {
    const date = instant instanceof Date ? instant : new Date(instant);
    if (Number.isNaN(date.getTime())) throw new Error("A valid PDF creation date is required.");
    const captureDate = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
    return `scroll2pdf-${captureDate}.pdf`;
  }

  function calculateRowInformationScores(imageData, widthValue, heightValue) {
    const width = Math.floor(positive(widthValue, "Analysis width"));
    const height = Math.floor(positive(heightValue, "Analysis height"));
    const pixels = imageData?.data || imageData;
    if (!pixels || pixels.length < width * height * 4) {
      throw new Error("Smart-break pixel data is incomplete.");
    }
    const scores = new Array(height).fill(0);
    let previousMean = 0;
    for (let y = 0; y < height; y += 1) {
      let sum = 0;
      let sumSquares = 0;
      let edges = 0;
      let previous = 0;
      for (let x = 0; x < width; x += 1) {
        const offset = ((y * width) + x) * 4;
        const luminance = (pixels[offset] * 0.2126)
          + (pixels[offset + 1] * 0.7152)
          + (pixels[offset + 2] * 0.0722);
        sum += luminance;
        sumSquares += luminance * luminance;
        if (x > 0) edges += Math.abs(luminance - previous);
        previous = luminance;
      }
      const mean = sum / width;
      const variance = Math.max(0, (sumSquares / width) - (mean * mean));
      const rowDifference = y > 0 ? Math.abs(mean - previousMean) : 0;
      scores[y] = Math.sqrt(variance) + (edges / Math.max(1, width - 1)) + rowDifference;
      previousMean = mean;
    }
    return scores;
  }

  Object.defineProperty(globalScope, "Scroll2PDFPdfUtils", {
    value: Object.freeze({
      A4_PORTRAIT_MM,
      DEFAULT_MINIMUM_BAND_ROWS,
      MAX_PDF_PAGES,
      MAX_UPSCALE,
      PDF_MARGIN_MM,
      buildPageRanges,
      buildPdfFilename,
      calculatePdfLayout,
      calculateRowInformationScores,
      chooseSmartBreak,
      getA4PageSpec,
      getSmartBreakMinimumEnd,
      getSmartBreakSearchWindow,
      mmToPoints,
    }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
