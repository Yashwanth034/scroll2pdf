(function initializeScroll2PDFSeamPlanner(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFSeamPlanner) return;

  function rowDifference(first = [], second = []) {
    const length = Math.min(first.length, second.length);
    if (!length) return 1;
    let difference = 0;
    for (let index = 0; index < length; index += 1) {
      difference += Math.abs(Number(first[index]) - Number(second[index]));
    }
    return difference / (length * 255);
  }

  function overlapDifference(upperRows, lowerRows, overlap, comparisonRows) {
    if (overlap <= 0 || overlap > upperRows.length || overlap > lowerRows.length) return Infinity;
    const rows = Math.min(overlap, comparisonRows);
    let difference = 0;
    for (let index = 0; index < rows; index += 1) {
      difference += rowDifference(
        upperRows[upperRows.length - overlap + index],
        lowerRows[index],
      );
    }
    return difference / rows;
  }

  function findMatchingSeam(input = {}) {
    const upperRows = input.upperRows || [];
    const lowerRows = input.lowerRows || [];
    const predicted = Math.max(0, Math.floor(Number(input.predictedOverlap) || 0));
    const radius = Math.max(0, Math.floor(Number(input.searchRadius) || 0));
    const comparisonRows = Math.max(2, Math.floor(Number(input.comparisonRows) || 16));
    const minimum = Math.max(1, predicted - radius);
    const maximum = Math.min(upperRows.length, lowerRows.length, predicted + radius);
    const predictedDifference = overlapDifference(upperRows, lowerRows, predicted, comparisonRows);
    let bestOverlap = predicted;
    let bestDifference = predictedDifference;
    for (let overlap = minimum; overlap <= maximum; overlap += 1) {
      const difference = overlapDifference(upperRows, lowerRows, overlap, comparisonRows);
      if (difference < bestDifference) {
        bestDifference = difference;
        bestOverlap = overlap;
      }
    }
    const improvement = predictedDifference - bestDifference;
    const convincing = Number.isFinite(bestDifference)
      && bestDifference <= 0.08
      && (bestDifference === 0 || improvement >= 0.015);
    return convincing
      ? { overlap: bestOverlap, matched: true, difference: bestDifference }
      : { overlap: predicted, matched: false, difference: predictedDifference };
  }

  function buildFrameChainPlan(frames = []) {
    const plans = [];
    let destinationY = 0;
    for (let index = 0; index < frames.length; index += 1) {
      const frame = frames[index];
      const cropHeight = Math.max(0, Math.floor(Number(frame.cropHeight) || 0));
      const overlap = index === 0
        ? 0
        : Math.max(0, Math.min(cropHeight, Math.floor(Number(frame.overlapWithPrevious) || 0)));
      const sourceHeight = cropHeight - overlap;
      plans.push({
        id: frame.id,
        sourceY: overlap,
        sourceHeight,
        destinationY,
      });
      destinationY += sourceHeight;
    }
    return { frames: plans, height: destinationY };
  }

  Object.defineProperty(globalScope, "Scroll2PDFSeamPlanner", {
    value: Object.freeze({ buildFrameChainPlan, findMatchingSeam, overlapDifference, rowDifference }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
