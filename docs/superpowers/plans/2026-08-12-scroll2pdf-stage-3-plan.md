# Scroll2PDF Stage 3 Implementation Plan

## 1. Pure region geometry

- Add failing Stage 3 tests for scrollable qualification, viewport visibility, rectangle normalization, minimum size, CSS-to-bitmap crop conversion, crop clamping, container steps, selected-area steps, and final bottom shift.
- Extend constants and `capture-utils.js` minimally until this pure suite passes.
- Rerun unchanged Stage 1/2 suites after the utility refactor.

## 2. Isolated selection UI

- Add failing lifecycle tests for one-shot confirmation, Escape cancellation, iframe rejection, tiny-drag retry, and idempotent cleanup.
- Implement a shared closed-Shadow-DOM overlay with mode-specific hover and drag controllers.
- Keep element references in content-script state only and route serializable messages through `content.js`.

## 3. Region capture sessions

- Add failing tests for container preparation/scroll/restoration, selected-area current-position semantics, size/disconnection failures, and final crop adjustment.
- Implement `scrollable-selection.js` and `selected-area.js` with separate state, metrics, scrolling, overlay suppression, and unconditional restoration.

## 4. Generalized background operation

- Add failing tests for adapter selection, pending selection resolution, popup cancellation while selecting, single-capture exclusion, region progress, and cleanup ordering.
- Generalize the existing operation manager while preserving its Full Page facade and tests.
- Add `region-capture.js` for the shared screenshot loop and mode adapters.

## 5. Generalized offscreen stitching

- Add failing draw-coordinate tests for cropped screenshots, unequal bitmap scales, container overlap, selected-area rebasing, shifted final crop, width consistency, and Full Page regression.
- Extend the existing offscreen frame model and stitcher without adding another canvas pipeline.
- Preserve PNG/JPEG, canvas limits, cancellation, encoded-frame release, and IndexedDB handoff.

## 6. Popup and result metadata

- Add failing behavior checks for selection instructions, recovered selecting state, all-mode cancellation, and capture-mode/image-format result metadata.
- Update the existing UI without changing its established design system or adding permissions.

## 7. Fixtures and verification

- Add generic Scrollable Area and Selected Area fixture pages.
- Run every Stage 1, Stage 2, and Stage 3 suite; syntax, manifest-reference, security, and Stage 4/5 exclusion scans.
- Render/probe selection overlays, popup recovery/cancel, and result metadata with local Chromium where supported.
- Audit every success/error/cancel path for listener, overlay, scroll, style, offscreen, and operation-state cleanup.
- Update README with exact manual tests and stop before Stage 4.
