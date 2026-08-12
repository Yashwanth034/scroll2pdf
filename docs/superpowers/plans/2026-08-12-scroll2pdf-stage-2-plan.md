# Scroll2PDF Stage 2 Implementation Plan

## 1. Protocol and pure capture logic

- Extend the dependency-free suite with failing assertions for Stage 2 manifest paths and permission changes.
- Add failing tests for page dimension maxima, scroll positions, dynamic next positions, screenshot scale, overlap/bottom crop plans, gap rejection, canvas limits, filename generation, quality mapping, and protected URLs.
- Implement message names, fixed safety limits, and `utils/capture-utils.js` until those tests pass.

## 2. Page interaction

- Add failing tests using a minimal real fake DOM/window for preparation, robust measurement, settled scrolling, overlay-style bookkeeping, and restoration.
- Implement `content/page-capture.js` and expand `content/content.js` into an async message router.
- Verify that preparation and every error/cancel cleanup restore scroll behavior, modified visibility, and the original position.

## 3. Capture orchestration

- Add failing tests for unsupported modes, protected pages, single-capture exclusion, progress, cancellation, and restoration in `finally` using narrow browser-boundary fakes.
- Implement `background/full-page-capture.js` with one active operation, Chrome's capture throttle, active-tab checks, live metrics, incremental offscreen frame transfer, limits, and result opening after cleanup.
- Refactor `background/background.js` into the protocol router without moving capture logic back into it.

## 4. Offscreen stitching and temporary storage

- Add failing contract tests for offscreen frame metadata, stitch-plan use, cancellation checks, and result record shape.
- Implement `utils/result-store.js` using IndexedDB and an offscreen document that decodes/draws one frame at a time, releases sources, uses `toBlob`, stores only the newest result, and always clears frame state.
- Add the `offscreen` permission and packaged offscreen paths to the manifest.

## 5. Popup progress and cancellation

- Add failing DOM/behavior checks for progress recovery, active control locking, working cancel messaging, completion, cancellation, unsupported-mode errors, and A4 Stage 4 notice.
- Update the existing popup without changing its established visual identity.

## 6. Result preview and download

- Add failing structure/behavior checks for result lookup, responsive preview, dimensions, anchor download, missing-result state, IndexedDB deletion after load, object URL cleanup, and Close.
- Implement the result page and shared result-store usage with no `downloads` permission.

## 7. Verification and documentation

- Run the complete Stage 1 and Stage 2 dependency-free suites.
- Run standalone JSON parsing, JavaScript syntax checks, referenced-path checks, and forbidden Stage 3/4 behavior scans.
- Use local Chromium rendering for popup and result UI checks where supported.
- Update README permissions, structure, safety limits, limitations, and exact manual test matrix.
- Inspect all changed files and stop at the Stage 2 boundary.
