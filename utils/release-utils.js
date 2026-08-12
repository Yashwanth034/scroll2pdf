(function initializeScroll2PDFReleaseUtils(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFReleaseUtils) return;

  function buildReleaseFilename(_pageUrl, _title, extension, instant = new Date()) {
    const date = instant instanceof Date ? instant : new Date(instant);
    const pad = (value) => String(value).padStart(2, "0");
    const captureDate = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
    const suffix = String(extension || "png").replace(/[^a-z0-9]/gi, "").toLowerCase() || "png";
    return `scroll2pdf-${captureDate}.${suffix}`;
  }

  function toUserFacingError(error) {
    const raw = String(error?.message || error || "");
    if (/protected|Receiving end|establish connection|Cannot access/i.test(raw)) {
      return { message: "Scroll2PDF cannot capture browser-protected pages.", guidance: "Try a normal webpage." };
    }
    if (/stopped advancing|stopped scrolling|non-advancing/i.test(raw)) {
      return { message: "Scrolling stopped before the capture finished.", guidance: "Make the entire scrollable area visible and try again." };
    }
    if (/gap detected|no drawable pixels|do not reach the document bottom/i.test(raw)) {
      return { message: "The page changed while it was being captured.", guidance: "Try again; if the page keeps changing, use Scrollable Area and capture from your current position downward." };
    }
    if (/conversation changed|context changed/i.test(raw)) {
      return { message: "The conversation changed during capture.", guidance: "Open the chat you want and start again." };
    }
    if (/too long|frame safety|maximum capture length/i.test(raw)) {
      return { message: "The chat exceeded the maximum capture length.", guidance: "Capture a smaller section or shorter conversation." };
    }
    if (/canvas|pixel area|dimension|too long to capture in one image/i.test(raw)) {
      return {
        message: "This page is too long to capture as one image.",
        guidance: "Choose PDF output to paginate long pages automatically, or capture a shorter area.",
      };
    }
    if (/cancel/i.test(raw)) return { message: "Capture cancelled", guidance: "" };
    return { message: "Scroll2PDF could not complete this capture.", guidance: "Keep the page active and try again." };
  }

  async function cleanupStaleRecords(records, now, maxAge) {
    const cutoff = Number(now) - Number(maxAge);
    return records.filter((record) => record && !record.active && Number(record.createdAt) < cutoff)
      .map((record) => record.resultId).filter(Boolean);
  }

  Object.defineProperty(globalScope, "Scroll2PDFReleaseUtils", {
    value: Object.freeze({ buildReleaseFilename, cleanupStaleRecords, toUserFacingError }),
    configurable: false, enumerable: true, writable: false,
  });
})(globalThis);
