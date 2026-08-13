# Scroll2PDF

Scroll2PDF is a local-only Chrome/Chromium extension for capturing content beyond the visible screen. Save full webpages, scrollable panels, chats, selected regions, or the current viewport as a long image or a clean A4 PDF.

## Features

- Four capture modes: **Full Page**, **Scrollable Area**, **Selected Area**, and **Screenshot**.
- Long-image output as readable JPEG or lossless PNG.
- A4 PDF output in Portrait or Landscape with consistent margins and smart page breaks.
- Automatic support for pages that scroll inside an app container instead of the browser window.
- Same-origin iframe expansion during Full Page capture.
- Conservative chat handling for virtualized layouts, sticky headers, and bottom composers.
- Best-effort structural selection helpers for WhatsApp Web and Telegram Web.
- Progress reporting, cancellation, safety limits, and restoration of original scroll positions.
- Local image editor with crop, section removal, blank-space insertion, text, arrows, shapes, pen, highlight, blur, Undo, and Redo.
- Local preview, clipboard copy, and download with no capture data uploaded.

## Install

Requires Chrome or a Chromium-based browser version 109 or newer.

```bash
git clone https://github.com/Yashwanth034/scroll2pdf.git
cd scroll2pdf
```

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the cloned folder containing `manifest.json`.
5. Pin Scroll2PDF from the Extensions menu if desired.

After updating the source, return to `chrome://extensions` and select **Reload** for Scroll2PDF.

## Use

Choose a capture mode in the extension popup:

| Mode | Captures |
| --- | --- |
| Full Page | The complete page or its main app-shell scroller |
| Scrollable Area | A selected scrollable panel or chat |
| Selected Area | A fixed-width region from the current position toward the bottom |
| Screenshot | The visible viewport or an optional selected viewport region |

Then:

1. Choose **Long Image** or **A4 PDF** when available.
2. Select Standard or High quality and PDF orientation if applicable.
3. Click **Start Capture** and complete any on-page selection.
4. Keep the capture tab active until scrolling and screenshots finish.
5. Review the local result, edit image results if needed, then copy or download.

Scrollable chat captures begin at the current conversation position and move downward. Scroll2PDF never sends messages, changes conversations, or reads hidden application stores.

## Image editing

Image results can be edited before export. Available tools include Select, Crop, Cut section, Insert space, Arrow, Rectangle, Circle, Pen, Highlighter, Text, and Blur.

Text can be positioned with its move handle before saving. Edited images support Undo, Redo, Reset, clipboard copy as PNG, and download in the original PNG or JPEG format. PDF editing is not currently supported.

## Privacy and permissions

All capture, stitching, editing, PDF generation, temporary storage, preview, and download work happens locally in the browser. Scroll2PDF has no analytics, telemetry, remote scripts, external fonts, CDNs, or capture-upload service.

| Permission | Purpose |
| --- | --- |
| `activeTab` | Access the page selected by the user for capture |
| `offscreen` | Stitch screenshots and generate images/PDFs with Canvas |
| `scripting` | Inject local capture scripts when a tab predates an extension reload |
| HTTP/HTTPS host access | Select, measure, scroll, capture, and restore ordinary webpages |

The extension does not request cookies, debugger, web request, native messaging, downloads, or network permissions. Temporary results use local IndexedDB and are removed after opening or expiration.

For sensitive security reports, do not post private captures, credentials, page content, or exploit details in a public issue. Open a minimal issue requesting a private reporting channel without including sensitive information.

## Limitations

- PDFs contain rasterized page images; captured text is not selectable or searchable.
- Cross-origin iframe contents cannot be inspected and are captured only at their rendered size.
- Scrollable Area captures one selected container and does not recursively traverse nested scrollers.
- WhatsApp and Telegram layouts change frequently, so their selection helpers are best effort.
- Very large captures stop safely when browser canvas, pixel-area, page-count, screenshot-count, or duration limits are reached.
- Keep the target tab active during capture to prevent recording the wrong page.
- Browser-protected pages such as `chrome://extensions` cannot be captured.

## Development

The extension has no build step or runtime dependencies. Run the automated checks directly with Node.js:

```bash
node tests/run-tests.js
node tests/run-stage2-tests.js
node tests/run-stage3-tests.js
node tests/run-stage4-tests.js
node tests/run-stage5-tests.js
node tests/run-stage6-tests.js
node tests/run-editor-tests.js
node tests/run-popup-e2e.js
node tests/run-result-e2e.js
```

The browser E2E checks require a local Chrome/Chromium installation. To build the Chrome release archive:

```bash
bash scripts/package-release.sh
```

The generated ZIP is written to `dist/` and remains excluded from Git.

## License

Scroll2PDF is available under the [MIT License](LICENSE).

Copyright (c) 2026 Yashwanth.
