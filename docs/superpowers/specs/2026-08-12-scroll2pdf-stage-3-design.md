# Scroll2PDF Stage 3 Design

## Scope

Stage 3 adds two generic capture modes to the verified Manifest V3 extension:

- Scrollable Area: select one visible vertically scrollable element, scroll only that element, crop every tab screenshot to its visible rectangle, and create a long image of its content.
- Selected Area: drag one viewport-relative rectangle, retain its X/width while scrolling the top-level page from the current position toward the document bottom, crop each screenshot to that band, and create a long image.

Full Page capture keeps its existing user-visible behavior. All three modes reuse the same background operation state, Chrome screenshot throttling, offscreen stitching, temporary IndexedDB handoff, progress UI, cancellation, result page, image quality rules, safety limits, and A4 Stage 4 notice.

Stage 3 does not implement PDF generation, A4 pagination, smart page breaks, site-specific selectors, virtualized-history reconstruction, recursive nested-container capture, iframe traversal, intelligent DOM-following selected regions, or Stage 5 performance work.

## Architectural direction

The existing capture implementation is generalized around one operation manager and three mode adapters rather than copied into three engines.

### Background responsibilities

- `background/background.js` remains the extension message router and configuration validator.
- `background/capture-manager.js` owns the one active operation, public status, cancellation flag, duration/count checks, progress events, cleanup ordering, offscreen lifecycle, completion/error/cancel events, and result-tab opening.
- `background/capture-adapters.js` exposes Full Page, Scrollable Area, and Selected Area adapters through the same interface.
- `background/full-page-capture.js` retains the verified Full Page loop as the Full Page adapter implementation, with only boundary refactoring needed to use shared orchestration.
- `background/region-capture.js` implements the common screenshot/crop-frame loop for Scrollable Area and Selected Area. It requests mode-specific metrics and scroll actions from the content script but never touches DOM objects.

An adapter provides:

- initial selection/preparation request;
- current content metrics;
- current crop rectangle;
- current actual scroll coordinate;
- total content height;
- next requested scroll coordinate;
- scroll command;
- overlay-suppression command;
- restoration command;
- capture/result mode metadata.

The operation manager is the only owner of success, failure, or cancellation finalization. Result tabs open only after page restoration, offscreen cleanup, and the popup completion event.

### Content responsibilities

- `content/content.js` remains a small async router.
- `content/page-capture.js` retains verified Full Page measurement, scroll, sticky/fixed suppression, and restoration behavior.
- `content/selection-overlay.js` owns the shared isolated selection UI, event lifecycle, and idempotent cleanup.
- `content/scrollable-selection.js` owns scrollable candidate qualification, element selection, stable element reference, container metrics, container scrolling, validation, and restoration.
- `content/selected-area.js` owns rectangle selection, minimum-size validation, current-position start semantics, page scrolling, final bottom crop adjustment, and restoration.

DOM element references remain inside the content-script JavaScript world. They are never serialized to the service worker. A capture ID associates background messages with one in-page selection/session.

### Offscreen and result responsibilities

- `offscreen/offscreen.js` generalizes the verified stitcher to crop each screenshot before overlap-aware placement.
- `utils/capture-utils.js` gains pure selection, crop, and region-scroll calculations shared by browser code and tests.
- `result/result.js` reads capture-mode metadata from the existing IndexedDB record and displays the mode label, output dimensions, and image format.

## Message protocol

The Stage 2 protocol remains. Stage 3 adds mode-neutral selection/session messages:

- `START_REGION_SELECTION`: enter Scrollable Area or Selected Area selection for a capture ID.
- `SELECTION_CONFIRMED`: content-to-background event containing serializable selected metrics, not a DOM reference.
- `SELECTION_CANCELLED`: content-to-background event for Escape or defensive overlay cancellation.
- `CANCEL_PAGE_SELECTION`: background-to-content request to stop an active selector immediately.
- `PREPARE_REGION_CAPTURE`: finalize selected mode state and return initial metrics.
- `GET_REGION_METRICS`: return current actual scroll coordinate, total content height, crop rectangle, viewport dimensions, and validation state.
- `SCROLL_REGION_TO_POSITION`: scroll the selected container or page and return actual settled metrics.
- `SET_REGION_OVERLAYS_HIDDEN`: apply conservative repeated-overlay suppression without hiding the selected container.
- `RESTORE_REGION_CAPTURE`: restore scroll position, inline styles, overlays, and selection listeners/UI.

Every request contains `captureId` and `captureMode`. Messages with a stale ID or wrong mode fail without touching the current session.

Selection confirmation resolves the background's pending selection phase exactly once. Repeated click, pointer-up, Escape, cancel, or delayed messages after cleanup are ignored.

## Shared selection overlay

Selection UI is created by `selection-overlay.js` as one uniquely identified host appended directly to the top-level document element. The host uses a closed Shadow DOM root. All styles, nodes, and labels remain inside the shadow tree so host-page styles neither alter the selector nor receive Scroll2PDF CSS.

The host is:

- fixed to the viewport;
- inset to all four edges;
- above ordinary page content using the highest practical z-index;
- removed before any screenshot;
- recreated only for an active selection phase;
- never included in final screenshots.

The overlay dims the page through four non-interactive shade rectangles around the active selection instead of one opaque pane over the selected content. A transparent interaction surface receives pointer events. The focus-independent Escape handler is registered on `window` in capture phase so the overlay does not prevent keyboard cancellation.

The visual treatment follows the extension's navy/blue/mint identity:

- subtle navy dimming outside the selected region;
- two-pixel cool-blue outline;
- compact mint-on-navy mode label;
- crosshair cursor during drag selection;
- live width × height label during Selected Area drag;
- restrained motion disabled under reduced-motion preferences.

Cleanup removes pointer/mouse/keyboard listeners, animation-frame callbacks, shadow host, and retained callbacks. Cleanup is idempotent and safe when invoked before setup finishes.

Stage 3 operates only in the top-level document. Pointer targets that resolve to `iframe`, `frame`, or content inside a same-origin frame boundary are not traversed; the overlay shows `Frames are not supported in Stage 3` and keeps selection active.

## Scrollable Area selection

### Candidate qualification

An element is a valid candidate only when all conditions are true:

- it belongs to the top-level document;
- computed `display` is not `none`;
- computed `visibility` is not `hidden` or `collapse`;
- computed opacity is nonzero;
- its bounding rectangle intersects the viewport;
- rectangle width and height are each at least 80 CSS pixels;
- `clientWidth` and `clientHeight` are positive;
- `scrollHeight > clientHeight + 1`;
- computed `overflow-y` is `auto`, `scroll`, or `overlay`;
- it is not the overlay host or one of its ancestors;
- it is not the root document scroller, because Full Page owns root scrolling.

The selector starts with `event.composedPath()` or `document.elementsFromPoint()` and chooses the nearest qualifying ancestor. It does not recursively inspect descendants once a valid nearest candidate is found. This lets users deliberately select an outer container when hovering its padding while avoiding automatic nested traversal.

Candidates smaller than 80×80, fully clipped candidates, and style-only non-scrolling elements are ignored.

### Visibility requirement

The selected rectangle must be fully inside the visual viewport with a two-CSS-pixel rounding tolerance on every edge. If not, clicking does not confirm. The label changes to `Make the scrollable area fully visible`, and selection continues.

Stage 3 does not scroll the page to reposition the container. This prevents layout surprises and keeps cropping reliable.

### Confirmation and identity

On confirmation, the overlay is removed and the content module stores a direct reference to the selected element in a session keyed by capture ID. Initial serializable metrics include:

- `scrollTop` and original `scrollTop`;
- `scrollHeight`, `clientHeight`, and `clientWidth`;
- viewport CSS width/height;
- clamped bounding rectangle;
- document scroll position;
- mode label.

The background does not attempt to reconstruct the element with a selector. If the reference disconnects, the capture fails cleanly.

## Scrollable Area capture

Preparation saves the selected element's original:

- `scrollTop`;
- inline `scroll-behavior` value and priority;
- any inline visibility values changed for sticky/fixed child suppression.

It sets the element's `scroll-behavior` to `auto !important`, sets `scrollTop` to zero, waits through the existing two animation frames plus settle delay, and returns actual metrics.

Before each screenshot the content script validates:

- the element is still connected;
- it remains visible;
- its rectangle is fully within the viewport tolerance;
- width and height have not changed by more than max(4 CSS pixels, 5 percent) from the confirmed rectangle;
- `clientHeight` remains positive;
- `scrollHeight` remains at least `clientHeight`;
- actual `scrollTop` is finite and nonnegative.

The rectangle is reread before every screenshot. Small movement is allowed and included in that frame's crop metadata. Large size changes abort with `The selected scrollable area changed size during capture.` Disconnection or invisibility aborts with `The selected scrollable area is no longer available.`

The first frame begins at actual `scrollTop = 0`. Subsequent requested positions use `min(actualScrollTop + clientHeight, scrollHeight - clientHeight)`. Actual returned `scrollTop` must advance. `scrollHeight` may grow during lazy loading; the operation retains the maximum observed height. It ends when `actualScrollTop + clientHeight` covers the maximum observed height.

Each screenshot frame contains:

- requested and actual `scrollTop`;
- current `scrollHeight` and `clientHeight`;
- viewport CSS width/height;
- current container rectangle;
- encoded tab screenshot;
- capture mode and timestamp.

Only the explicit selected element scrolls. Nested scrollable descendants are neither discovered nor scrolled.

## Selected Area selection

Pointer-down records a viewport-CSS start point clamped within the visual viewport. Pointer movement updates a normalized rectangle:

- `left = min(startX, currentX)`;
- `top = min(startY, currentY)`;
- `width = abs(currentX - startX)`;
- `height = abs(currentY - startY)`.

Pointer-up confirms only when width and height are each at least 80 CSS pixels. A smaller rectangle displays `Selected area is too small` and resets the drag while keeping selection active. Escape or popup cancellation removes the overlay without starting capture.

Selection is unavailable when pointer-down begins over an iframe rectangle. Cross-origin and same-origin frame content are not inspected.

On confirmation, the overlay is removed and the module stores:

- normalized selected rectangle;
- original page `scrollX` and `scrollY`;
- starting content coordinate `startContentY = originalScrollY + selectedRect.top`;
- original inline root/body scroll behavior;
- modified overlay style snapshots.

The starting page position is never reset to the top.

## Selected Area capture

The selected X coordinate and width stay fixed for every frame. The normal crop top and height stay equal to the original selected rectangle.

The content coordinate contributed by a frame is `actualPageScrollY + cropRect.top`. The total desired vertical content begins at `startContentY` and ends at the robust current document height. Normal requested page-scroll increments equal the selected rectangle height.

For a normal next step:

`requestedPageY = currentActualPageY + selectedRect.height`

The request is clamped to the page's maximum scroll position. Actual `window.scrollY` is returned after settling and must advance.

### Final bottom adjustment

If Chrome clamps the final page scroll and the original crop rectangle would end above the real document bottom, only the final frame shifts vertically downward.

The minimum shift is:

`requiredShift = totalHeight - (actualPageY + originalRect.bottom)`

The applied shift is clamped to:

- at least zero;
- no more than `viewportHeight - originalRect.bottom`;
- no more than needed to place the crop bottom at the document bottom.

The final crop keeps the original X, width, and height. Its top becomes `originalRect.top + appliedShift`. If the viewport cannot accommodate enough shift, the last drawable height is cropped to the reachable document boundary and an uncovered gap fails safely.

Earlier frames never shift. The shifted frame's actual content coordinate is `actualPageY + shiftedCropTop`; overlap calculation removes content already contributed by the preceding frame. This includes the real document bottom without duplicate bands.

The document height is reread after every settled page scroll and may grow. Capture stops when the maximum observed document height is covered or an existing Stage 2 safety limit is reached.

## Repeated fixed and sticky handling

The verified conservative Stage 2 mechanism is reused.

- Selection overlays are always removed before the first screenshot.
- Full Page behavior remains unchanged.
- Selected Area may suppress visible repeated page fixed/sticky elements after the first frame.
- Scrollable Area never hides the selected container or its ancestors.
- Within a Scrollable Area, a visible fixed/sticky descendant may remain in the first crop. On later frames it is hidden only when it is pinned and already represented by an earlier frame.
- Every modified visibility property and priority is recorded once and restored.

No Stage 5 logic attempts to reconstruct sticky sections or virtualized content.

## Crop and stitch model

The offscreen frame model becomes mode-neutral. A frame contains the full screenshot plus:

- `contentPositionCss`: actual page `scrollY` for Full Page/Selected Area or actual `scrollTop` for Scrollable Area;
- `contentViewportHeightCss`: full viewport height for Full Page or crop height for region modes;
- `totalContentHeightCss` observed for that mode;
- `cropRectCss`: screenshot-relative rectangle; Full Page uses the whole viewport;
- screenshot bitmap dimensions and CSS viewport dimensions;
- capture mode.

### CSS crop conversion

Scale is measured independently:

- `scaleX = bitmapWidth / viewportCssWidth`;
- `scaleY = bitmapHeight / viewportCssHeight`.

A crop rectangle is normalized and clamped to the CSS viewport before conversion. Bitmap bounds use conservative rounding:

- source left/top use `floor(cssCoordinate × scale)`;
- source right/bottom use `ceil(cssEdge × scale)`;
- all edges are clamped to `[0, bitmapDimension]`.

A resulting width or height below one bitmap pixel fails. Scale X and Y need not be identical, but each must remain stable across frames within the verified tolerance for its axis.

### Vertical overlap

Frames are ordered by their actual contributed content coordinate, not requested position.

For every mode the stitcher tracks the greatest content CSS coordinate already drawn. It removes leading overlap from the current cropped frame, rejects gaps beyond rounding tolerance, and crops the last draw at the mode's total desired content height.

For Selected Area, placement coordinates are rebased by `startContentY` so the result begins at output Y zero. For Scrollable Area and Full Page, the base is zero.

Final bitmap width is the first clamped crop width. Later crop widths may vary by at most max(2 bitmap pixels, 1 percent). Small variation caused by layout rounding is drawn into the fixed result width; substantial variation aborts.

Canvas dimension and area limits remain 32,767 pixels and 160,000,000 pixels. Encoded frames are still released after each draw, and the final Blob still uses temporary IndexedDB handoff.

## Capture manager, progress, and popup recovery

The one active operation stores:

- capture ID and mode;
- tab/window IDs and configuration;
- phase: selecting, preparing, capturing, stitching, or cancelling;
- completed/estimated total frames;
- user-facing message;
- cancellation flag and running promise.

Mode-specific initial status:

- Full Page: `Preparing page…`
- Scrollable Area: `Select a scrollable area on the page`
- Selected Area: `Drag to select an area`

After selection confirmation, both new modes report `Preparing selection…`, then `Capturing… n / total`, then `Stitching image…`.

`GET_CAPTURE_STATUS` returns the selection phase and message, so closing and reopening the popup retains the Cancel button and correct instruction. The popup itself does not hold the selection promise.

All controls remain disabled during any active operation. The current Cancel Capture button works without visual redesign.

## Cancellation and cleanup

Cancellation is supported during:

- Scrollable Area hover selection;
- Selected Area drag selection;
- container/page scrolling;
- screenshot capture;
- offscreen decoding/stitching;
- result preparation before completion.

The manager marks cancellation first, reports `Cancelling…`, then sends both:

- `CANCEL_PAGE_SELECTION` to remove any selector/listeners immediately;
- `OFFSCREEN_CANCEL_CAPTURE` to stop decoding/drawing if active.

Every loop checks cancellation before and after content messages, screenshot calls, and offscreen calls.

Cleanup order is:

1. resolve/reject any pending selection once;
2. remove selection UI and listeners;
3. restore selected container or page scroll position and inline styles;
4. clear offscreen encoded frames and close the document;
5. report `CAPTURE_CANCELLED`, `CAPTURE_ERROR`, or `CAPTURE_COMPLETE`;
6. open a result tab only after completion is reported;
7. clear the active operation.

Cleanup is attempted in `finally` for success, failure, cancellation, page navigation, tab closure, and messaging errors. Cleanup errors are logged but do not replace the primary error.

Cancellation creates no result record or tab and reports `Capture cancelled` only after restoration attempts finish.

## Errors

Stage 2 protected-page behavior remains unchanged.

Stage 3 adds clear failures:

- `Selected area is too small`
- `Make the scrollable area fully visible`
- `Frames are not supported in Stage 3`
- `The selected scrollable area is no longer available.`
- `The selected scrollable area changed size during capture.`
- `The selected region can no longer reach the page bottom.`
- `The selected content stopped advancing before capture completed.`

User-correctable selection errors keep selection mode active. Runtime validity errors after confirmation abort and restore.

## Result metadata

The IndexedDB result record and background response add:

- `captureMode`;
- `captureModeLabel`: `Full Page`, `Scrollable Area`, or `Selected Area`;
- existing width, height, MIME type, filename, size, and creation time.

The result header displays mode label, exact pixel dimensions, and `PNG` or `JPEG`. Download behavior remains a local anchor and adds no permission.

If A4 PDF is selected, every mode still creates the long-image result and reports `<Mode> capture complete. A4 PDF export will be added in Stage 4.`

## Permissions and security

Stage 3 adds no permission. Existing `activeTab`, `offscreen`, `scripting`, and HTTP/HTTPS host access cover the generic top-level-page workflow.

All overlay, capture, crop, stitch, Blob storage, preview, and download behavior stays local. No remote scripts, services, analytics, external fonts, `eval`, debugger protocol, download API, or PDF library is used.

## Safety limits

Stage 2 limits remain:

- 120 viewport captures;
- 120-second total duration;
- 550-millisecond screenshot interval;
- two animation frames plus 180-millisecond settling;
- 32,767-pixel canvas dimension;
- 160,000,000-pixel canvas area;
- 10,000-element conservative overlay scan.

Stage 3 adds:

- minimum selectable/candidate width and height: 80 CSS pixels;
- viewport-edge tolerance: 2 CSS pixels;
- substantial container size-change threshold: max(4 CSS pixels, 5 percent);
- crop-width consistency threshold: max(2 bitmap pixels, 1 percent).

Container and Selected Area captures share the 120-frame and 120-second limits. Growing content cannot bypass them.

## Testing strategy

All existing Stage 1 and Stage 2 tests must remain green.

New dependency-free tests are written before production changes and cover:

- vertically scrollable qualification using dimensions, overflow, visibility, and minimum size;
- nearest valid ancestor selection and root/iframe exclusions;
- selected rectangle normalization in every drag direction;
- 80×80 acceptance and tiny-region rejection;
- viewport visibility qualification;
- CSS crop-to-bitmap conversion with unequal X/Y scale;
- crop clamping at every bitmap edge;
- container scroll positions and final overlapping position;
- actual `scrollTop` overlap and bottom cropping;
- selected-area start coordinate from current scroll position;
- selected-area height-based steps;
- minimal final bottom shift;
- shifted-frame overlap and exact document bottom;
- dynamic height growth and non-advancing failures;
- container movement, size change, disconnection, and invisibility errors;
- idempotent overlay cleanup and selection promise resolution;
- Escape, popup cancellation, capture cancellation, and stitching cancellation;
- restoration of container `scrollTop`, page scroll position, and inline styles;
- Full Page adapter regression using existing actual positions;
- result capture-mode and image-format metadata;
- manifest/content-script references;
- absence of PDF, site-specific selectors, recursive nested capture, and iframe traversal.

Browser fixture tests add:

- `scrollable-area-test.html`: one obvious fully visible scrollable panel, numbered rows, sticky child header, outside-page content, and bottom marker;
- `selected-area-test.html`: wide outside columns, a marked central capture column, numbered vertical sections, current-position start marker, and bottom marker.

Browser probes exercise hover highlight, rectangle drag, dimensions label, Escape cleanup, popup cancellation cleanup, and responsive result metadata where local Chrome supports extension contexts.

Manual unpacked-extension testing remains authoritative for the real screenshot API, container scrolling, selected-area bottom shift, and restoration.

## Completion boundary

Stage 3 is complete when generic top-level Scrollable Area and Selected Area selection, capture, crop, overlap-aware stitching, progress, cancellation, restoration, preview, and download work without changing Full Page behavior.

PDF/A4 work waits for Stage 4. Site-specific selectors, iframe capture, virtualized chat reconstruction, recursive nested scrolling, infinite-history loading, and advanced optimization wait for Stage 5 or later.
