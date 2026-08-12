(function initializeScroll2PDFResult(globalScope) {
  "use strict";

  let imageObjectUrl = "";

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return "";
    }
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
  }

  function showError(status, message) {
    status.textContent = message;
    status.dataset.state = "error";
    status.hidden = false;
  }

  function formatNumber(value) {
    return Number(value).toLocaleString("en-US");
  }

  function getResultViewModel(record = {}) {
    const isPdf = record.mimeType === "application/pdf" || record.outputType === "a4-pdf";
    const width = Number(record.sourceWidth || record.width);
    const height = Number(record.sourceHeight || record.height);
    const dimensions = Number.isFinite(width) && Number.isFinite(height)
      ? `${formatNumber(width)} × ${formatNumber(height)} px${isPdf ? " source" : ""} · ${formatBytes(record.size)}`
      : formatBytes(record.size);
    const captureMode = record.captureModeLabel || "Full Page";
    if (isPdf) {
      const orientation = record.orientation === "landscape" ? "Landscape" : "Portrait";
      const pageCount = Math.max(1, Number(record.pageCount) || 1);
      return {
        isPdf,
        dimensions,
        metadata: `${captureMode} · A4 PDF · ${orientation} · ${pageCount} ${pageCount === 1 ? "page" : "pages"}`,
        downloadLabel: "Download PDF",
        summary: `${orientation} A4 · ${pageCount} ${pageCount === 1 ? "page" : "pages"} · ${formatBytes(record.size)}`,
      };
    }
    return {
      isPdf,
      dimensions,
      metadata: `${captureMode} · ${record.imageFormat || (record.mimeType === "image/png" ? "PNG" : "JPEG")}`,
      downloadLabel: "Download Image",
      summary: "",
    };
  }

  async function initialize() {
    const title = document.getElementById("result-title");
    const dimensions = document.getElementById("result-dimensions");
    const metadata = document.getElementById("result-metadata");
    const status = document.getElementById("result-status");
    const preview = document.getElementById("preview-surface");
    const image = document.getElementById("result-image");
    const download = document.getElementById("download-image");
    const close = document.getElementById("close-result");
    const pdfCard = document.getElementById("pdf-result-card");
    const pdfSummary = document.getElementById("pdf-result-summary");
    const resultId = new URLSearchParams(location.search).get("id");

    close.addEventListener("click", () => window.close());
    if (!resultId) {
      showError(status, "This capture result link is incomplete. Start a new capture from Scroll2PDF.");
      return;
    }

    try {
      const record = await globalScope.Scroll2PDFResultStore.getResult(resultId);
      if (!record?.blob) {
        showError(status, "This temporary capture is no longer available. Start a new capture from Scroll2PDF.");
        return;
      }

      imageObjectUrl = URL.createObjectURL(record.blob);
      const view = getResultViewModel(record);
      title.textContent = record.filename;
      dimensions.textContent = view.dimensions;
      metadata.textContent = view.metadata;
      download.href = imageObjectUrl;
      download.download = record.filename;
      download.textContent = view.downloadLabel;
      download.setAttribute("aria-disabled", "false");
      if (view.isPdf) {
        const pdfPreview = document.getElementById("pdf-preview-surface");
        const pdfFrame = document.getElementById("result-pdf");
        const pdfLabel = document.getElementById("pdf-preview-label");
        pdfSummary.textContent = view.summary;
        pdfCard.hidden = false;
        preview.hidden = true;
        pdfFrame.addEventListener("load", () => {
          pdfLabel.textContent = "Previewing the captured PDF · scroll to review every page · Download to save";
        }, { once: true });
        pdfFrame.addEventListener("error", () => {
          pdfLabel.textContent = "The PDF preview could not be rendered here, but it is ready to download.";
        }, { once: true });
        pdfFrame.src = imageObjectUrl;
        pdfPreview.hidden = false;
      } else {
        image.src = imageObjectUrl;
        preview.hidden = false;
        pdfCard.hidden = true;
      }
      status.hidden = true;
      await globalScope.Scroll2PDFResultStore.deleteResult(resultId);
    } catch (error) {
      console.error("Scroll2PDF could not load the capture result:", error);
      showError(status, "The captured result could not be opened. Start a new capture and try again.");
    }
  }

  globalScope.addEventListener("beforeunload", () => {
    if (imageObjectUrl) {
      URL.revokeObjectURL(imageObjectUrl);
      imageObjectUrl = "";
    }
  });
  document.addEventListener("DOMContentLoaded", initialize);

  globalScope.Scroll2PDFResult = Object.freeze({ formatBytes, getResultViewModel, initialize });
})(globalThis);
