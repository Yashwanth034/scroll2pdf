# Scroll2PDF Stage 2 Design

## Scope

Stage 2 adds real full-page scrolling capture to the existing Manifest V3 extension. It captures the active normal HTTP or HTTPS page, stitches the captured viewports into one long image, opens an extension-owned preview, and supports local download.

Only `full-page` performs capture. `scrollable-area` and `selected-area` return `This capture mode will be added in Stage 3.` The output selection does not alter the Stage 2 pipeline: both A4 PDF and Long Image produce a long-image preview. When A4 PDF is selected, completion also states that A4 PDF export will be added in Stage 4.

Stage 2 does not add container selection, nested scrolling, drag selection, site-specific logic, PDF generation, A4 pagination, or smart page breaks.

## Architecture

Responsibilities remain isolated:

- `background/background.js` routes extension messages and exposes configuration validation.
- `background/full-page-capture.js` owns the single active operation, tab checks, capture loop, cancellation, progress, offscreen lifecycle, result-tab creation, and unconditional cleanup.
- `content/content.js` routes messages inside the page.
- `content/page-capture.js` measures the document, saves and restores page state, scrolls and settles, and conservatively suppresses repeated overlays.
- `utils/constants.js` defines protocol values and safety limits.
- `utils/capture-utils.js` provides pure scroll, scale, crop, filename, restricted-URL, and safety calculations.
- `utils/result-store.js` provides a small IndexedDB interface shared by the offscreen and result documents.
- `offscreen/offscreen.html` and `offscreen/offscreen.js` decode, validate, crop, stitch, encode, and store the final Blob.
- `result/result.html`, `result/result.css`, and `result/result.js` retrieve the result, create a local object URL, show a responsive preview, download it, and close the tab.
- `popup/*` shows progress, cancel state, completion, failure, and active-state recovery after the popup reopens.

The background service worker never uses DOM or Canvas APIs. The content script never captures screenshots. The offscreen document only performs image processing and temporary result storage.

## Permissions and platform constraints

Stage 2 adds only the `offscreen` permission. Chrome's Offscreen API requires that permission and allows a packaged hidden document to use DOM and Blob APIs. The document is created with the `BLOBS` reason and closed after stitching or cleanup.

The existing `activeTab`, HTTP/HTTPS host permissions, and `chrome.tabs` API cover active-page access, content-script messaging, tab creation, and `captureVisibleTab`. No `downloads`, `tabs`, `storage`, `debugger`, clipboard, native messaging, or remote-code permission is added.

Chrome currently permits at most two `captureVisibleTab` calls per second. The engine enforces at least 550 milliseconds between screenshot calls. Each scroll first settles through two animation frames and a 180-millisecond delay; the capture throttle then waits any remaining time.

Minimum supported Chrome version is 109 because that is the first version with `chrome.offscreen`.

## Message protocol

Existing messages remain and these messages are added:

- `PREPARE_FULL_PAGE_CAPTURE`: save original page state, disable smooth scrolling, scroll to the top, and return metrics.
- `GET_PAGE_METRICS`: return current robust dimensions and positions.
- `SCROLL_TO_POSITION`: scroll, settle, and return actual position plus fresh metrics.
- `SET_CAPTURE_OVERLAYS_HIDDEN`: hide conservative repeated fixed/stuck elements after the first frame.
- `RESTORE_PAGE`: restore element styles, scroll behavior, and the original X/Y position.
- `GET_CAPTURE_STATUS`: return the current background-owned operation status for a reopened popup.
- `CANCEL_CAPTURE`: mark the operation cancelled and abort offscreen stitching if it has started.
- `CAPTURE_CANCELLED`: announce cancellation after restoration completes.
- `OFFSCREEN_RESET_CAPTURE`: initialize or clear one offscreen frame collection.
- `OFFSCREEN_ADD_CAPTURE`: append one screenshot and its metadata.
- `OFFSCREEN_STITCH_CAPTURE`: validate and stitch the collected frames.
- `OFFSCREEN_CANCEL_CAPTURE`: mark an offscreen operation cancelled.

`CAPTURE_PROGRESS`, `CAPTURE_COMPLETE`, and `CAPTURE_ERROR` become active event messages. Messages intended for the offscreen document include `target: "offscreen"`; other contexts ignore them.

The popup receives an immediate acknowledgement from `START_CAPTURE`. The capture continues asynchronously, which lets the popup receive progress and send cancellation. The popup asks `GET_CAPTURE_STATUS` during initialization so closing and reopening it does not lose the visible operation state.

## Capture state and concurrency

The service worker stores at most one `activeCapture` object containing:

- capture ID;
- tab and window IDs;
- validated configuration;
- phase and progress counters;
- start time;
- cancellation flag;
- promise for the running operation.

A second `START_CAPTURE` request receives a clear already-active error. `CANCEL_CAPTURE` only affects the matching current operation. A tab-removal listener marks an operation for that tab as cancelled.

The operation is cleared only after its `finally` block attempts page restoration, resets offscreen frame state, and closes the offscreen document. Cleanup failures are logged but do not hide the original result or error.

## Page preparation and measurement

Preparation saves:

- original `scrollX` and `scrollY`;
- original inline `scroll-behavior` values and priorities on `document.documentElement` and `document.body`;
- every inline visibility value and priority changed for overlay suppression.

It sets document and body smooth scrolling to `auto` using an important inline declaration, scrolls to `(0, 0)`, and settles. It does not alter overflow, dimensions, animation, network behavior, or page content.

Metrics use the maximum of the relevant document-element and body values:

- `scrollHeight`, `offsetHeight`, and `clientHeight` for total height;
- `scrollWidth`, `offsetWidth`, and `clientWidth` for total width.

The returned structure also includes `innerWidth`, `innerHeight`, actual `scrollX`, actual `scrollY`, and reported device pixel ratio. Bitmap scaling never assumes that reported device pixel ratio matches the screenshot.

The engine retains the maximum height observed during an operation so natural scrolling can discover lazy-loaded content. Metrics are re-read after every settled scroll and before deciding that the bottom is complete.

## Scroll and capture algorithm

1. Validate mode, configuration, active tab, URL, and concurrency.
2. Create/reset the offscreen frame collection.
3. Prepare the page, which saves state and settles at the top.
4. Capture the current viewport and record requested Y, actual Y, CSS viewport dimensions, bitmap dimensions, and image data.
5. After the first frame, enable conservative overlay suppression.
6. Re-read metrics and update the maximum observed total height.
7. If `actualY + viewportHeight` covers the observed height, stop.
8. Otherwise request `min(actualY + viewportHeight, totalHeight - viewportHeight)`.
9. Require the returned actual Y position to advance; a repeated/non-advancing position fails safely rather than looping.
10. Repeat until the bottom, cancellation, failure, duration limit, or viewport-count limit.
11. Ask the offscreen document to stitch, open the result page, and announce completion.
12. In `finally`, restore and release all page/offscreen/capture state.

The target tab must still be the active tab in its original window immediately before and after every screenshot. If the user switches tabs, the operation fails rather than accidentally stitching another page.

## Scale, overlap, and bottom cropping

Each decoded frame calculates:

- horizontal scale as `bitmapWidth / viewportCssWidth`;
- vertical scale as `bitmapHeight / viewportCssHeight`.

Both values must be finite and positive. A material mismatch indicates an inconsistent capture and fails safely. Normal integer rounding is tolerated. Vertical placement and cropping use the measured vertical scale; final width uses the first frame bitmap width.

Frames are sorted by actual CSS Y. The stitcher tracks the greatest CSS document coordinate already drawn. For a frame:

- `sourceStartCss = max(0, coveredBottomCss - actualY)`;
- `drawableCss = min(viewportCssHeight - sourceStartCss, totalHeightCss - actualY - sourceStartCss)`;
- source bitmap Y is the rounded scaled `sourceStartCss`;
- destination bitmap Y is the rounded scaled `(actualY + sourceStartCss)`;
- draw height is clamped against both the source bitmap and final canvas.

Thus a final viewport clamped upward by the browser contributes only its previously unseen lower portion. The last draw is cropped exactly at the measured total document height. Any CSS gap between frames is rejected rather than filled with blank pixels.

## Offscreen stitching and result handoff

Captured data URLs are sent to the offscreen document one at a time so the service worker does not retain the full batch. The offscreen document retains encoded frames until stitching begins. It decodes and draws one frame at a time, releases that image reference immediately after drawing, and clears all encoded frame references after success, cancellation, or failure.

Before canvas allocation, the stitcher calculates final bitmap dimensions and enforces:

- maximum 32,767 pixels in either dimension;
- maximum 160,000,000 total pixels.

High quality captures and encodes PNG. Standard quality captures JPEG at quality 82 and encodes the final JPEG at quality 0.82. `canvas.toBlob` is used rather than a final data URL.

The final Blob and metadata are written to the `Scroll2PDFResults` IndexedDB database under a generated result ID. Only the newest completed result is retained; starting a new stitch clears older results. The background receives only the result ID, dimensions, MIME type, filename, and size, then closes the offscreen document and opens `result/result.html?id=...`.

The result page reads the Blob, deletes the stored record after creating its own object URL, and revokes that URL on unload. This keeps large binary payloads out of extension messages and service-worker memory.

## Filename rules

The filename format is `scroll2pdf-<hostname>-<YYYY-MM-DD-HHmm>.<extension>`. Hostnames are lowercased. Characters outside letters, digits, dots, and hyphens become hyphens; repeated separators collapse; leading/trailing separators are removed. If no usable host exists, `page` is used. Standard uses `.jpg`; High uses `.png`.

The result page downloads through a local anchor with the `download` attribute, so the `downloads` permission is unnecessary.

## Basic fixed and sticky handling

The first viewport remains visually unchanged so a normal top header is preserved. Before later viewports:

- visible `position: fixed` elements are hidden with `visibility: hidden !important`;
- visible `position: sticky` elements are hidden only when they are currently pinned to a viewport edge and their document origin is already above the current viewport.

Visibility preserves layout geometry. Every changed inline value and priority is recorded once and restored in `RESTORE_PAGE`. This is deliberately conservative and does not attempt Stage 5-level handling of complex transformed, animated, nested, or script-controlled overlays.

## Cancellation and recovery

The popup presents `Cancel Capture` only while a full-page operation is active. Activating it sends `CANCEL_CAPTURE`, changes the control to `Cancelling…`, and prevents repeated requests.

The background checks cancellation:

- before and after every content-script message;
- before and after every screenshot;
- before stitching and after the stitch response.

If stitching is active, it also sends `OFFSCREEN_CANCEL_CAPTURE`. The offscreen code checks cancellation between image decodes/draws and before storing the Blob.

Cancellation is not announced as complete until the background `finally` block has attempted restoration and cleanup. The popup then shows `Capture cancelled`. A reopened popup uses `GET_CAPTURE_STATUS` to restore capturing or cancelling state.

## Errors and restricted pages

Only ordinary HTTP and HTTPS pages are accepted. Browser-owned URLs, extension pages, file URLs without declared support, and known Chrome Web Store hosts fail with `Scroll2PDF cannot capture this browser-protected page.` A missing content-script receiver on an otherwise protected page is normalized to the same message.

Other user-facing failures distinguish:

- another active capture;
- switching away from the captured tab;
- a page that stops advancing;
- capture API failure;
- page or tab closure;
- safety-limit refusal;
- stitching/storage failure.

Errors are logged locally and announced through `CAPTURE_ERROR`. No page information or image leaves the browser.

Regardless of success, failure, or cancellation, the background uses `try/finally` to request `RESTORE_PAGE`, reset offscreen state, close the offscreen document, and clear `activeCapture`. If the page navigated or closed, restoration may be impossible because the original document no longer exists; no temporary modification can remain in a replaced document.

## Safety limits

Stage 2 uses these fixed limits:

- 120 captured viewports;
- 120 seconds for capture and stitching;
- at least 550 milliseconds between screenshot calls;
- 180 milliseconds plus two animation frames for page settling;
- 32,767 bitmap pixels per canvas dimension;
- 160,000,000 total canvas pixels.

The capture count and duration prevent infinite dynamic-page loops. Canvas limits reject unsafe results before allocation. Stage 5 may introduce tiled or streaming output for pages beyond these limits.

## Popup and result experience

The existing navy document-capture visual system remains intact.

The popup adds one restrained progress track below the action area. While capturing, controls are disabled, Start Capture is replaced with a high-contrast Cancel Capture action, and the status uses concrete phrases such as `Preparing page…`, `Capturing page… 4 / 12`, `Stitching image…`, `Capture complete`, and `Capture cancelled`. Reopening the popup reflects the current background state.

The result page is a full-tab extension page using the same palette and page-edge motif. A compact header shows the filename and exact bitmap dimensions. The image sits on a checker-neutral preview surface with `max-width: 100%` and automatic height. Download Image is primary; Close is secondary. Loading, unavailable-result, and decode failures contain clear next actions.

## Testing

The existing dependency-free suite remains green and is extended test-first. Pure tests cover:

- robust page-dimension maxima;
- initial and final scroll positions;
- one-viewport and exact-multiple pages;
- dynamic next-position calculation;
- CSS-to-bitmap scale validation;
- overlap cropping and exact bottom cropping;
- gap rejection;
- canvas dimension/area limits;
- filename sanitization and quality extension;
- restricted URL classification;
- configuration validation;
- unsupported modes;
- single-capture exclusion;
- cancellation state and unconditional cleanup;
- manifest permission and referenced paths;
- result-store and message contracts;
- absence of Stage 3 selection/container behavior and Stage 4 PDF generation.

Browser-facing probes test popup progress/cancel/recovery and result-page Blob preview/download behavior where local Chrome supports those contexts. Manual unpacked-extension testing remains required for the real `captureVisibleTab`, offscreen, scrolling, sticky, lazy-load, zoom, restricted-page, restoration, cancellation, and download flows.

## Completion boundary

Stage 2 is complete when Full Page capture produces a downloadable long image with progress, safe cancellation, overlap-aware stitching, result preview, safety refusals, and page restoration. Scrollable Area, Selected Area, and PDF behaviors remain explicit unavailable-mode messages until later stages.
