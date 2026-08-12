(function initializeScroll2PDFPdfWriter(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFPdfWriter) return;

  const encoder = new TextEncoder();

  function encode(value) { return encoder.encode(String(value)); }

  function concatenate(parts) {
    const length = parts.reduce((total, part) => total + part.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  }

  function pdfNumber(value) {
    const rounded = Math.round(Number(value) * 10000) / 10000;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  }

  function escapePdfString(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)")
      .replace(/[\r\n]+/g, " ")
      .replace(/[^\x20-\x7e]/g, "?");
  }

  function pdfDate(value) {
    const date = new Date(value && typeof value.getTime === "function" ? value.getTime() : (value || Date.now()));
    const pad = (number) => String(number).padStart(2, "0");
    return `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
      + `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  }

  class RasterPdfWriter {
    constructor(options = {}) {
      if (!options.pageSpec?.widthPt || !options.pageSpec?.heightPt) {
        throw new Error("A valid PDF page specification is required.");
      }
      this.pageSpec = options.pageSpec;
      this.title = String(options.title || "Scroll2PDF capture.pdf");
      this.creationDate = new Date(
        options.creationDate && typeof options.creationDate.getTime === "function"
          ? options.creationDate.getTime()
          : (options.creationDate || Date.now()),
      );
      this.pages = [];
    }

    addImagePage(page = {}) {
      const bytes = page.bytes instanceof Uint8Array ? page.bytes : new Uint8Array(page.bytes || []);
      const width = Math.floor(Number(page.width));
      const height = Math.floor(Number(page.height));
      const displayWidthPt = Number(page.displayWidthPt);
      const displayHeightPt = Number(page.displayHeightPt);
      if (!bytes.length || width <= 0 || height <= 0 || displayWidthPt <= 0 || displayHeightPt <= 0) {
        throw new Error("PDF page image data is incomplete.");
      }
      if (page.filter !== "DCTDecode" && page.filter !== "FlateDecode") {
        throw new Error("Unsupported PDF image compression filter.");
      }
      this.pages.push({ bytes, width, height, displayWidthPt, displayHeightPt, filter: page.filter });
    }

    build() {
      if (this.pages.length === 0) throw new Error("A PDF requires at least one page.");
      const objects = [null];
      const reserve = () => { objects.push(null); return objects.length - 1; };
      const set = (id, bytes) => { objects[id] = bytes instanceof Uint8Array ? bytes : encode(bytes); };
      const stream = (dictionary, bytes) => concatenate([
        encode(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`),
        bytes,
        encode("\nendstream"),
      ]);

      const catalogId = reserve();
      const pagesId = reserve();
      const infoId = reserve();
      const pageIds = [];

      this.pages.forEach((page, index) => {
        const pageId = reserve();
        const imageId = reserve();
        const contentId = reserve();
        pageIds.push(pageId);
        const imageName = `Im${index + 1}`;
        const imageDictionary = `/Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height}`
          + ` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${page.filter}`;
        set(imageId, stream(imageDictionary, page.bytes));

        const x = (this.pageSpec.widthPt - page.displayWidthPt) / 2;
        const top = this.pageSpec.heightPt - this.pageSpec.marginPt;
        const y = top - page.displayHeightPt;
        const drawing = encode(`q\n${pdfNumber(page.displayWidthPt)} 0 0 ${pdfNumber(page.displayHeightPt)}`
          + ` ${pdfNumber(x)} ${pdfNumber(y)} cm\n/${imageName} Do\nQ\n`);
        set(contentId, stream("", drawing));
        set(pageId, `<< /Type /Page /Parent ${pagesId} 0 R`
          + ` /MediaBox [0 0 ${pdfNumber(this.pageSpec.widthPt)} ${pdfNumber(this.pageSpec.heightPt)}]`
          + ` /Resources << /XObject << /${imageName} ${imageId} 0 R >> >>`
          + ` /Contents ${contentId} 0 R >>`);
      });

      set(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
      set(pagesId, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
      set(infoId, `<< /Title (${escapePdfString(this.title)}) /Creator (Scroll2PDF)`
        + ` /Producer (Scroll2PDF) /CreationDate (${pdfDate(this.creationDate)}) >>`);

      const parts = [encode("%PDF-1.7\n%\xC2\xB5\xC2\xB6\n")];
      const offsets = [0];
      let byteOffset = parts[0].length;
      for (let id = 1; id < objects.length; id += 1) {
        if (!objects[id]) throw new Error(`PDF object ${id} was not initialized.`);
        offsets[id] = byteOffset;
        const objectBytes = concatenate([encode(`${id} 0 obj\n`), objects[id], encode("\nendobj\n")]);
        parts.push(objectBytes);
        byteOffset += objectBytes.length;
      }
      const xrefOffset = byteOffset;
      let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
      for (let id = 1; id < objects.length; id += 1) {
        xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
      }
      xref += `trailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\n`;
      xref += `startxref\n${xrefOffset}\n%%EOF\n`;
      parts.push(encode(xref));
      return concatenate(parts);
    }
  }

  Object.defineProperty(globalScope, "Scroll2PDFPdfWriter", {
    value: Object.freeze({ RasterPdfWriter, escapePdfString, pdfDate, pdfNumber }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
