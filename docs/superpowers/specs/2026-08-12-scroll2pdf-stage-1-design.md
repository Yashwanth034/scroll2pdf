# Scroll2PDF Stage 1 Design

## Scope

Stage 1 establishes a production-minded Manifest V3 extension shell and a polished popup. It does not capture, scroll, stitch, select page regions, generate images, or create PDFs.

The extension is stored at `/home/yash/Videos/scroll2pdf` and uses only HTML, CSS, and JavaScript. It has no build process, package dependencies, remote scripts, analytics, or network services.

## User experience

The popup is a single-screen, approximately 380-pixel-wide control panel. Its visual language is a deep ink/navy surface with cool blue interaction states and a restrained page-edge motif in the header. System fonts keep it fast and native-looking.

The form contains:

- Three large capture-mode radio cards: Full Page, Scrollable Area, and Selected Area. Full Page is selected initially.
- An Output segmented control with A4 PDF and Long Image. A4 PDF is selected initially.
- Compact Quality and A4 Orientation segmented controls. High and Portrait are selected initially.
- A prominent Start Capture button and an accessible live status area.

Native radio inputs provide single-selection behavior and keyboard semantics. Custom styling adds clear selected, hover, disabled, and focus-visible states. The layout does not scroll horizontally. Reduced-motion preferences are respected.

## Components and responsibilities

### Manifest

`manifest.json` declares Manifest V3, version 0.1.0, the popup, background service worker, shared constant module, and a content script on normal HTTP and HTTPS pages.

The extension requests:

- `activeTab`, for temporary access to the active page after a user action in future capture stages.
- `scripting`, for future, user-triggered page interaction where a declared content script is insufficient.
- Host access for `http://*/*` and `https://*/*`, so the declared content script can initialize on ordinary web pages and later support page capture workflows.

No downloads, storage, tabs, debugger, offscreen, clipboard, or native messaging permission is included in Stage 1.

### Shared constants

`utils/constants.js` exports frozen capture modes, output types, quality levels, orientations, message types, and default configuration. Popup, background, content, and tests use these values instead of duplicating protocol strings.

### Popup

`popup/popup.html` provides semantic form controls and no inline JavaScript. `popup/popup.css` owns the complete visual treatment. `popup/popup.js` reads the current form state, disables Start Capture while a request is pending, sends `START_CAPTURE`, and shows a temporary status message.

When the background accepts the configuration, the popup displays: “Capture engine will be added in Stage 2.” If messaging or validation fails, it displays a concise error and restores the button.

### Background service worker

`background/background.js` listens for extension messages. For `START_CAPTURE`, it verifies that the payload has exactly one recognized value for capture mode, output type, quality, and orientation. It logs a normalized configuration and returns a structured success response. It performs no screenshot or page mutation.

Comments mark the future orchestration boundaries for viewport capture, automatic scrolling, image stitching, A4 pagination, and PDF generation.

### Content script

`content/content.js` initializes once without changing the DOM or page styling. It responds to a `PING` message with a small readiness response. Comments mark future container detection, selected-area overlay, and page-scrolling work.

## Message flow

1. The user chooses settings and activates Start Capture.
2. The popup normalizes the selected values into a configuration object.
3. The popup sends `{ type: START_CAPTURE, payload: configuration }` to the service worker.
4. The worker validates and logs the configuration.
5. The worker responds with `{ ok: true, message }`, or `{ ok: false, error }` for invalid data.
6. The popup announces the result in an `aria-live` status region.

Reserved message types—`CAPTURE_PROGRESS`, `CAPTURE_COMPLETE`, and `CAPTURE_ERROR`—are defined but have no Stage 1 handlers.

## Error handling and security

Unexpected message types are ignored. Invalid capture configurations receive a structured failure response and are not logged as accepted work. The popup handles both runtime errors and rejected responses.

All code is local. There is no `eval`, inline script, remote JavaScript, CDN asset, external font, or server communication. The content script does not inspect or transmit webpage content.

## Verification

A dependency-free Node test script is written before production JavaScript. It checks:

- Manifest V3 metadata, requested permissions, matches, and referenced files.
- Required popup labels, default selections, accessible control grouping, status semantics, and absence of inline script.
- Shared constants and default values.
- Popup message construction and background configuration validation.
- Content-script ping handling and safe initialization.
- Absence of prohibited capture, stitching, PDF, selection, remote-code, and network behavior.
- JavaScript syntax for all extension scripts.

Manual verification loads the unpacked extension, checks selection states and keyboard focus, clicks Start Capture, confirms the Stage 2 status text, and inspects the extension service-worker console for the logged configuration.

## Stage boundary

Stage 1 ends once the static popup, validated message round trip, minimal content script, documentation, and checks work. Capture APIs and capture-related DOM behavior remain intentionally unimplemented until the user explicitly requests Stage 2.
