(function initializeScroll2PDFFrameAnalysis(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFFrameAnalysis) return;

  function luminance(data, offset) {
    return Math.round((data[offset] * 0.2126) + (data[offset + 1] * 0.7152) + (data[offset + 2] * 0.0722));
  }

  function requirePixels(input = {}) {
    const width = Math.floor(Number(input.width));
    const height = Math.floor(Number(input.height));
    const data = input.data?.data || input.data;
    if (!data || width <= 0 || height <= 0 || data.length < width * height * 4) {
      throw new Error("Frame analysis pixel data is incomplete.");
    }
    return { data, width, height };
  }

  function createVisualFingerprint(input = {}) {
    const { data, width, height } = requirePixels(input);
    const sampleWidth = Math.max(1, Math.floor(Number(input.sampleWidth) || 32));
    const sampleHeight = Math.max(1, Math.floor(Number(input.sampleHeight) || 24));
    const samples = new Uint8Array(sampleWidth * sampleHeight);
    let hash = 2166136261;
    for (let sampleY = 0; sampleY < sampleHeight; sampleY += 1) {
      const y = Math.min(height - 1, Math.floor(((sampleY + 0.5) / sampleHeight) * height));
      for (let sampleX = 0; sampleX < sampleWidth; sampleX += 1) {
        const x = Math.min(width - 1, Math.floor(((sampleX + 0.5) / sampleWidth) * width));
        const value = luminance(data, ((y * width) + x) * 4);
        const index = (sampleY * sampleWidth) + sampleX;
        samples[index] = value;
        hash ^= value;
        hash = Math.imul(hash, 16777619) >>> 0;
      }
    }
    return { hash: hash.toString(16).padStart(8, "0"), samples: Array.from(samples) };
  }

  function normalizedSampleDifference(first = [], second = []) {
    const length = Math.min(first.length, second.length);
    if (!length || first.length !== second.length) return 1;
    let difference = 0;
    for (let index = 0; index < length; index += 1) {
      difference += Math.abs(Number(first[index]) - Number(second[index]));
    }
    return difference / (length * 255);
  }

  function createRowSignatures(input = {}) {
    const { data, width, height } = requirePixels(input);
    const sampleColumns = Math.max(2, Math.floor(Number(input.sampleColumns) || 32));
    const rows = new Array(height);
    for (let y = 0; y < height; y += 1) {
      const row = new Array(sampleColumns);
      for (let sampleX = 0; sampleX < sampleColumns; sampleX += 1) {
        const x = Math.min(width - 1, Math.floor(((sampleX + 0.5) / sampleColumns) * width));
        row[sampleX] = luminance(data, ((y * width) + x) * 4);
      }
      rows[y] = row;
    }
    return rows;
  }

  Object.defineProperty(globalScope, "Scroll2PDFFrameAnalysis", {
    value: Object.freeze({
      createRowSignatures,
      createVisualFingerprint,
      normalizedSampleDifference,
    }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
