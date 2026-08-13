# Scroll2PDF

Scroll2PDF is a local-only Chrome/Chromium Manifest V3 extension for capturing content beyond the visible viewport. It supports full webpages, visible scrollable containers, and a selected viewport region, with either a long image or a clean paginated A4 PDF result.

## Current capabilities

- **Full Page:** scrolls a normal HTTP/HTTPS page from the top and captures it through the real viewport. When the page pins `html`/`body` and scrolls an inner container instead (Discord, Slack, Teams, VS Code Web, and similar app shells), Scroll2PDF detects that container and captures its content automatically. Same-origin embedded iframes are temporarily expanded to their full content height before capture, so embedded scrollable documents and widgets (including app-shell layouts inside the frame) are captured in full; cross-origin frames are captured at their rendered size because their contents cannot be inspected.
- **Scrollable Area:** highlights real vertically scrollable elements and captures the chosen visible container, excluding the surrounding page. Ordinary panels start at the top; chat-like containers (including WhatsApp, Telegram, and any other chat layout) start from your current position and scroll downward to the bottom of the chat — they never rewind to the top or traverse older history.
- **Selected Area:** captures a fixed selected X/width from the user's current page position to the document bottom. On app shells the selection is clipped to the real underlying scroll container, which is scrolled directly so the area advances instead of stopping.
- **Screenshot:** captures exactly what is visible on screen in one shot — no scrolling, no selection, no page scripting. The result is always saved as a lossless PNG at the browser's native screenshot resolution and opens in the same result view as every other capture.
- On-demand content-script injection: tabs opened before the extension was installed or reloaded are injected on capture start, so ordinary HTTP/HTTPS pages do not need a manual page reload first.
- Exact overlap removal based on settled scroll positions, including browser-clamped final viewports.
- Standard JPEG (raised to 95% quality) and High PNG long-image output.
- Portrait or Landscape A4 PDF output with true A4 proportions and 10 mm margins.
- Sequential image-band PDF generation: Standard uses JPEG bands; High uses lossless DEFLATE-compressed RGB bands.
- Generic smart page breaks that prefer nearby low-information horizontal bands without duplicating or skipping source rows.
- Capture and PDF progress, popup-reopen recovery, one active operation, and cancellation during selection, scrolling, stitching, or PDF generation.
- Restoration of original page/container positions, scroll behavior, temporary fixed/sticky suppression, overlays, and listeners on success, failure, or cancellation.
- Responsive Long Image preview, compact PDF result metadata, local Blob downloads, and an inline PDF page preview on the result page so the capture can be reviewed before downloading.
- Local image editing after capture: crop, remove a full-width section, insert white space, draw arrows/shapes/freehand marks, highlight, add multiline text, blur private details, move/resize/style/delete annotations, and use bounded Undo/Redo/Reset history. Edited images can be copied as PNG or downloaded in their original PNG/JPEG format. PDF results remain unchanged.
- Scrollbars are hidden during capture so the stitched image has no vertical scrollbar stripe on its right edge; pages that shrink mid-capture (a classic cause of "stopped scrolling") are handled by adopting the smaller measured height.
- Protected-page handling plus capture-rate, duration, canvas, pixel-area, and PDF page-count safety limits.
- Explicitly selected difficult-chat capture with bottom-to-top traversal while preserving oldest-to-newest output order.
- Chats are captured with a simple, reliable downward traversal from the user's current position to the bottom of the container — no upward history walk, no up-and-down oscillation, and no prepended-history interference.
- Stall handling retries the scroll several times (and falls back to the best inner scroll container when the window scroller cannot move) before reporting an error, so virtualized feeds and self-resizing pages finish instead of failing.
- Generic prepended-history loading, stable-anchor displacement, virtualization signals, bounded repeat recovery, lazy-media settling, and visual seam refinement remain available in the packaged difficult-chat engine.
- Best-effort, isolated WhatsApp Web and Telegram Web adapters that redirect a hovered chat wrapper to a likely underlying message scroller and label it before the user confirms.
- Conservative one-time handling for repeated chat chrome and sticky date separators, plus context-change protection. Channel/name headers appear exactly once at the top and the enter-chat composer exactly once at the true bottom — in Scrollable Area AND Selected Area, even when the app pins them by layout (in-flow/absolute siblings) or re-creates the nodes on every render (React/SPA style) — so they never repeat in every PDF page or long image.

Capture always requires the user's explicit click. Adapters never switch conversations, send messages, use private APIs, or bypass authentication. Difficult-page capture does not recursively traverse nested containers or frames.

## Project structure

```text
scroll2pdf/
├── manifest.json
├── README.md
├── assets/icons/README.md
├── background/
│   ├── background.js
│   ├── full-page-capture.js
│   ├── dynamic-region-capture.js
│   ├── region-capture.js
│   └── pdf-output.js
├── content/
│   ├── content.js
│   ├── capture-stability.js
│   ├── iframe-expansion.js
│   ├── page-capture.js
│   ├── selection-overlay.js
│   ├── difficult-page-capture.js
│   ├── scrollable-selection.js
│   ├── selected-area.js
│   └── adapters/
│       ├── adapter-registry.js
│       ├── generic-chat-adapter.js
│       ├── whatsapp-adapter.js
│       └── telegram-adapter.js
├── offscreen/
│   ├── offscreen.html
│   ├── offscreen.js
│   ├── frame-analysis.js
│   ├── seam-planner.js
│   ├── pdf-generator.js
│   └── pdf-writer.js
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── result/
│   ├── editor-core.js
│   ├── editor-renderer.js
│   ├── editor-controller.js
│   ├── result.html
│   ├── result.css
│   └── result.js
├── utils/
│   ├── capture-utils.js
│   ├── constants.js
│   ├── difficult-page-utils.js
│   ├── pdf-utils.js
│   └── result-store.js
├── tests/
│   ├── fixtures/
│   │   ├── test-hub.html
│   │   ├── full-page-test.*
│   │   ├── scrollable-area-test.html
│   │   ├── selected-area-test.html
│   │   ├── pdf-smart-break-test.html
│   │   ├── prepend-history-chat.html
│   │   ├── virtualized-chat.html
│   │   ├── sticky-chat.html
│   │   ├── lazy-media-chat.html
│   │   ├── dynamic-resize-chat.html
│   │   ├── navigation-change-chat.html
│   │   ├── seam-overlap-chat.html
│   │   ├── container-scroll-test.html
│   │   ├── iframe-page-test.html
│   │   ├── shrinking-page-test.html
│   │   ├── stripe-seam-test.html
│   │   ├── long-page-test.html
│   │   └── short-page.html
│   ├── run-tests.js
│   ├── run-stage2-tests.js
│   ├── run-stage3-tests.js
│   ├── run-stage4-tests.js
│   ├── run-stage5-tests.js
│   ├── run-stage6-tests.js
│   ├── run-editor-tests.js
│   ├── run-stage3-browser-integration.js
│   ├── run-stage4-browser-integration.js
│   ├── run-stage5-browser-integration.js
│   ├── run-extension-smoke.js
│   ├── run-popup-e2e.js
│   └── run-result-e2e.js
├── scripts/
│   └── package-release.sh
└── store/
    ├── detailed-description.md
    ├── permission-justification.md
    ├── privacy-disclosure.md
    └── short-description.txt
```

## Architecture

The popup starts/cancels an operation and renders status owned by the background service worker. The worker enforces one active capture and dispatches the full-page or generalized region coordinator. Content modules own DOM selection, measurement, scrolling, settling, conservative overlay suppression, and unconditional restoration; DOM references never leave the page.

Each visible-tab screenshot carries its actual content position and CSS crop rectangle to the offscreen document. The generalized stitcher measures CSS-to-bitmap scale, crops the region, removes overlap, enforces canvas limits, and stores one temporary image Blob in IndexedDB.

Confidently detected difficult chats use a separate capability-driven frame-chain coordinator. It captures rendered viewports before virtualized DOM nodes disappear, traverses upward, observes prepended history through DOM mutations and stable-anchor displacement, and orders frames oldest-to-newest independently of raw `scrollTop`. The offscreen document calculates a small grayscale fingerprint plus sampled edge rows; coordinates remain authoritative, while a bounded seam search refines duplicate-row trimming. Ordinary Full Page, Selected Area, and top-to-bottom Scrollable Area captures continue through their original Stage 2/3 coordinators.

For **Long Image**, that stitched record opens directly in the result page. For **A4 PDF**, the background asks the same offscreen document to:

1. decode the stitched image once;
2. calculate A4 layout and exact page ranges;
3. adjust eligible boundaries toward nearby quiet image rows;
4. render and encode one source band at a time;
5. assemble a local PDF 1.7 document;
6. store the final PDF and delete the temporary source image.

The image result page retains the original Blob and represents crop/cut/insert operations as a non-destructive source-row map. Annotations stay as editable vector metadata, while a bounded vertical tile renderer draws only the visible preview area. Copy and Download render the current revision locally; no capture or edit data leaves the browser.

The PDF writer is project-owned JavaScript rather than a third-party dependency. It writes the catalog, page tree, A4 media boxes, image XObjects, drawing streams, metadata, xref table, and trailer. No build system or PDF library is required.

## A4 model

- Portrait: 210 × 297 mm.
- Landscape: 297 × 210 mm.
- Margin: 10 mm on all sides.
- Internal PDF unit: points (72 points per inch).
- Scaling: uniform fit-to-width; no independent X/Y stretching and no horizontal cropping.
- Maximum upscale: 1.25 PDF points per source pixel.
- Maximum PDF length: 500 pages.
- Smart-break search: upward from the ideal boundary, 8% of an ideal source band capped at 256 px, with at most 10% page shortening.

Every source row belongs to one and only one page. A smart boundary becomes the exact start of the following page; PDF pages never overlap.

## Quality and memory

- **Standard:** the stitched source and each PDF page band use readable JPEG encoding (PDF page bands use approximately 84% quality).
- **High:** the stitched source stays PNG and each PDF page stores lossless RGB compressed through the browser's DEFLATE stream.

The long source is decoded once. The offscreen document reuses one analysis canvas and one page canvas, then releases each page canvas after its encoded bytes enter the PDF writer. It never keeps a collection of full page canvases or page Blobs alive.

## Permissions

- `activeTab`: user-triggered active-page access and visible-tab screenshots.
- `offscreen`: packaged hidden document for Canvas, image decode/encode, PDF work, Blob handling, and IndexedDB handoff because MV3 workers have no DOM Canvas.
- `scripting`: retained for the extension's page-interaction architecture; normal operation uses declared content scripts.
- `http://*/*` and `https://*/*`: installs local content scripts on ordinary webpages for selection, scrolling, measurement, and restoration.

Stages 4 and 5 add **no new permission**. The extension does not request `downloads`; result downloads use local Blob anchors. It requests no network, debugger, storage, clipboard, native messaging, or remote-code permission.

## Safety limits

- Ordinary captures: at most 500 viewport screenshots and 600 seconds.
- A position within 2% of the viewport height of the bottom counts as reached, so self-resizing containers finish instead of oscillating.
- At least 550 ms between `captureVisibleTab` calls.
- Two animation frames plus 180 ms settling after scrolling.
- Final image dimension at most 32,767 px and area at most 160,000,000 pixels.
- At most 1000 PDF pages.
- At most 10,000 elements inspected for conservative fixed/sticky suppression.
- Selection/candidate minimum: 80 × 80 CSS px.
- Scrollable containers must be fully visible within a 2 CSS px tolerance and remain approximately the same size.
- Difficult captures: 10 minutes, 300 rendered frames, 40 history-load attempts, three stable boundary retries, one corrective scroll, and 64 recent fingerprints.
- History settling: three 200 ms checks; visible lazy media waits at most 1.5 seconds per frame.
- Dynamic crop position tolerance: 40 CSS px for temporary loading chrome; size tolerance remains 8 CSS px or 4%.
- Visual seam search: at most 160 CSS px around the coordinate-predicted overlap.

## Load manually in Chrome

Clone or download this repository:

```bash
git clone https://github.com/Yashwanth034/scroll2pdf.git
cd scroll2pdf
```

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the cloned project folder containing `manifest.json`.
5. Pin Scroll2PDF from the Extensions menu if desired.
6. After source changes, return to `chrome://extensions` and click Scroll2PDF's **Reload** button.

The repository includes packaged extension icons for every Chrome-required size.

## Automated checks

From the project folder:

```bash
cd scroll2pdf
node tests/run-tests.js
node tests/run-stage2-tests.js
node tests/run-stage3-tests.js
node tests/run-stage4-tests.js
node tests/run-stage5-tests.js
node tests/run-stage6-tests.js
node tests/run-editor-tests.js
node tests/run-popup-e2e.js
node tests/run-result-e2e.js
node tests/run-extension-smoke.js
node tests/run-long-page-browser-test.js   # needs S2P_ATTACH_PORT, see below
```

For production browser fixture integration, start the fixture server and a Chrome debugging instance, then use its port:

```bash
python3 -m http.server 8765
google-chrome --headless=new --no-sandbox --remote-debugging-port=9446 --user-data-dir=/tmp/scroll2pdf-browser-tests about:blank
env S2P_ATTACH_PORT=9446 node tests/run-stage3-browser-integration.js
env S2P_ATTACH_PORT=9446 node tests/run-stage4-browser-integration.js
env S2P_ATTACH_PORT=9446 node tests/run-stage5-browser-integration.js
env S2P_ATTACH_PORT=9446 node tests/run-chrome-dedup-browser-test.js
env S2P_ATTACH_PORT=9446 node tests/run-long-page-browser-test.js
env S2P_ATTACH_PORT=9446 node tests/run-stage3-extension-e2e.js
```

The Stage 4 and Stage 6 tests cover A4 geometry, margins, scale, exact pagination, final-page crop, maximum upscale, smart breaks/fallback/search bounds, filenames, 500-page protection, cancellation, PDF object/xref generation, signature, page count, media boxes, metadata, filters, non-empty content, popup behavior, result behavior, release metadata, icons, stale cleanup, security scans, and package contents.

The Stage 3 browser integration also covers pinned app shells (`container-scroll-test.html`), where Full Page, Scrollable Area, and Selected Area capture the inner scroll container instead of stopping on a non-scrolling viewport, and iframe traversal (`iframe-page-test.html`), where two same-origin embedded documents — one window-scrolled, one app-shell with an inner scroller — are expanded and captured in full, then restored exactly.

The browser integration uses rendered fixture pages, actual browser scrolling, production selection/capture coordinators, real viewport screenshots, production Canvas stitching, production offscreen PDF processing, binary PDF inspection, bottom-marker checks, excluded-content checks, restoration, cleanup, and result flow. Some branded Chrome builds ignore automated unpacked-extension loading and do not expose their native directory chooser through CDP; in that case the extension-context diagnostic skips and this fixture pipeline is the strongest automatic fallback.

## Local fixture pages

After starting `python3 -m http.server 8765`, open:

- `http://127.0.0.1:8765/tests/fixtures/full-page-test.html`
- `http://127.0.0.1:8765/tests/fixtures/short-page.html`
- `http://127.0.0.1:8765/tests/fixtures/scrollable-area-test.html`
- `http://127.0.0.1:8765/tests/fixtures/selected-area-test.html`
- `http://127.0.0.1:8765/tests/fixtures/pdf-smart-break-test.html`
- `http://127.0.0.1:8765/tests/fixtures/prepend-history-chat.html`
- `http://127.0.0.1:8765/tests/fixtures/virtualized-chat.html`
- `http://127.0.0.1:8765/tests/fixtures/sticky-chat.html`
- `http://127.0.0.1:8765/tests/fixtures/lazy-media-chat.html`
- `http://127.0.0.1:8765/tests/fixtures/dynamic-resize-chat.html`
- `http://127.0.0.1:8765/tests/fixtures/navigation-change-chat.html`
- `http://127.0.0.1:8765/tests/fixtures/seam-overlap-chat.html`
- `http://127.0.0.1:8765/tests/fixtures/container-scroll-test.html`
- `http://127.0.0.1:8765/tests/fixtures/iframe-page-test.html`
- `http://127.0.0.1:8765/tests/fixtures/iframe-inner-window.html`
- `http://127.0.0.1:8765/tests/fixtures/iframe-inner-shell.html`
- `http://127.0.0.1:8765/tests/fixtures/sticky-chrome-chat.html` (sticky header + composer inside the scroller)
- `http://127.0.0.1:8765/tests/fixtures/react-recreate-chat.html` (chrome re-created per scroll, the repeated-header bug)
- `http://127.0.0.1:8765/tests/fixtures/news-app-chat.html` (window-scrolling feed with sticky World News tab + Broadcast bar)
- `http://127.0.0.1:8765/tests/fixtures/test-hub.html` (all fixtures with what each tests)
- `http://127.0.0.1:8765/tests/fixtures/shrinking-page-test.html` (collapses on first scroll — reproduces the old "stopped scrolling" stall)
- `http://127.0.0.1:8765/tests/fixtures/stripe-seam-test.html` (full-bleed stripes — any seam or scrollbar artifact shows as a bright line)
- `http://127.0.0.1:8765/tests/fixtures/long-page-test.html` and `?mode=too-long` (40 000px: friendly "page too long" error for one image, or a multi-page A4 PDF via the streaming paginator — pages are emitted as rows stream in, so no single canvas ever exceeds 32 767px)
- `http://127.0.0.1:8765/tests/fixtures/test-hub.html` (a hub listing every fixture and what it verifies)

## Capturing a chat

1. Keep the intended conversation open and avoid navigating until capture finishes.
2. Choose **Scrollable Area**, then click **Start Capture**.
3. Hover the conversation pane. When detection is confident, the effective scroller is highlighted as **WhatsApp Chat**, **Telegram Chat**, or **Chat / scrollable area**. Otherwise the ordinary **Scrollable area** selector remains available.
4. Click the highlighted target to confirm. Detection never starts capture automatically.
5. Scroll to the place in the conversation where you want the capture to begin, then start the capture. The capture proceeds **downward from your current position to the bottom of the chat** — it never rewinds to the top or loads older history.
6. Cancel may be used during selection, traversal, stitching, or PDF generation. No result opens, temporary data is discarded, and the chat position/styles are restored.

## The difficult-chat engine (legacy)

Scroll2PDF ships a separate capability-driven frame-chain engine for bottom-to-top conversations (prepended history, virtualization, stable anchors). It is exercised by the unit suites but is no longer used for interactive Scrollable Area captures, which use the simpler and more predictable downward-from-current behavior above.

1. Keep the intended conversation open and avoid navigating until capture finishes.
2. Choose **Scrollable Area**, then click **Start Capture**.
3. Hover the conversation pane. When detection is confident, the effective scroller is highlighted as **WhatsApp Chat**, **Telegram Chat**, or **Chat / scrollable area**. Otherwise the ordinary **Scrollable area** selector remains available.
4. Click the highlighted target to confirm. Detection never starts capture automatically.
5. For a bottom-anchored chat, progress may alternate between `Capturing chat… N frames` and `Loading older messages… N captured` because the final total is initially unknown.
6. Cancel may be used during selection, history loading, traversal, stitching, or PDF generation. No result opens, temporary data is discarded, and the chat position/styles are restored when the page still permits it.

WhatsApp and Telegram support is best-effort because their rendered layouts change and may be virtualized differently across releases. If a site adapter is uncertain, use the generic manual selector. Select the visible message scroller rather than a composer, sidebar, or the whole application shell.

## Verification checklist

Keep the capture tab active while viewport screenshots are being taken.

### Full Page PDF

1. Open `full-page-test.html` and scroll to a memorable position.
2. Select **Full Page**, **A4 PDF**, **High**, and **Portrait**.
3. Start capture. Verify page scrolling, `Creating PDF… i / N`, `PDF complete`, and exact scroll restoration.
4. Verify the result says Full Page, A4 PDF, Portrait, page count, source dimensions, and file size.
5. Download the `.pdf`; verify every page is Portrait A4, the final dark footer is present, and no strips are missing or repeated.
6. Repeat with Landscape and Standard; verify Landscape A4 dimensions and readable text.

### Scrollable Area PDF

1. Open `scrollable-area-test.html`, set the blue panel to a non-zero `scrollTop`, and remember it.
2. Select **Scrollable Area** and **A4 PDF**, then click the panel.
3. Verify messages 01–24 remain ordered, the green bottom marker is included, surrounding red page content is absent, and the panel returns to its original position.
4. Download/open the PDF and verify all pages use the selected orientation.

### Selected Area PDF

1. Open `selected-area-test.html`, scroll partway down, choose **Selected Area** and **A4 PDF**, and drag around the central column.
2. Verify capture starts at the current position, the X/width stays fixed, sidebars are excluded, the bottom marker is present, and the exact page position returns.
3. Download/open the PDF and verify ordered pages with no gaps or duplicated strips.

### Short, smart-break, cancel, and Long Image

1. Capture `short-page.html` as A4 PDF and verify exactly one page.
2. Capture `pdf-smart-break-test.html` and verify page boundaries prefer nearby clear gaps rather than obvious card interiors where possible.
3. Cancel while `Creating PDF…` is visible; verify `Capture cancelled`, no result tab, and no stale temporary result.
4. Select **Long Image**; verify orientation is hidden/disabled and PNG/JPEG preview/download behavior remains unchanged.
5. Close/reopen the popup during PDF generation and verify phase/progress/Cancel recover.
6. Try `chrome://extensions` and verify the protected-page error.

## Known limitations

- The PDF contains rasterized capture bands, not selectable/searchable DOM text.
- Very wide Portrait captures may render small; Scroll2PDF never changes the user's selected orientation automatically.
- Hiding the viewport scrollbar during capture frees its width to page content, so the stitched image can be a few pixels wider than the visible scrollable area.
- High lossless PDFs can be substantially larger than Standard PDFs.
- Smart breaks are image-based heuristics; when no clearly quieter nearby row exists, the exact mathematical break is used and may cross content.
- Captures exceeding canvas, pixel-area, duration, screenshot-count, or 500-page limits fail safely rather than using tiled/streaming architecture.
- Same-origin iframes are traversed and expanded for Full Page capture; cross-origin frames and frames that are still loading cannot be inspected and are captured at their rendered size.
- Scrollable Area captures only the selected container; nested containers are not traversed recursively.
- Virtualized capture records currently rendered bands and can follow common recycled-window layouts, but it does not reconstruct content from hidden application stores; highly nonstandard virtualization can stop with a reliability error.
- WhatsApp/Telegram adapters are structural, conservative, and best-effort rather than guaranteed across every build.
- The composer and persistent controls are retained at most once when included in the crop; conservative classification can leave an unusual overlay or suppress a repeated pinned copy.
- Visible media that takes longer than the bounded wait can still appear as the page's current placeholder.
- Changing conversation, route, or selected scroller identity aborts rather than mixing content.
- Switching the active tab aborts capture to avoid recording the wrong page.
- Cross-origin iframe content, iframe expansion in Scrollable/Selected Area modes, multiple independent scrollers, hidden chat-store extraction, and automatic infinite-history reconstruction are not supported.

## Security and privacy

All scripts, styles, DOM inspection, anchor identities, capture data, image processing, PDF generation, temporary storage, result display, and downloading remain local. Scroll2PDF never uploads chat text or screenshots, calls WhatsApp/Telegram backends, extracts tokens, or sends analytics. There are no external scripts, fonts, CDNs, `eval`, inline extension JavaScript, external screenshot/PDF services, or webpage data transmissions. Captures persist only through the existing temporary result/download flow.

For sensitive security reports, do not post private captures, page content, credentials, or exploit details in a public issue. Open a minimal issue requesting a private reporting channel without including sensitive information.

## License

Scroll2PDF is available under the [MIT License](LICENSE).

Copyright (c) 2026 Yashwanth.
