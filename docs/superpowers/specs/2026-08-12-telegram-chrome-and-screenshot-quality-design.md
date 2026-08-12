# Telegram Chrome Deduplication and Screenshot Quality Design

## Scope

This change fixes only two behaviors:

1. Scrollable Area captures on Telegram must include the conversation header once at the top and the Broadcast composer once at the true bottom, without repeated copies between captured frames.
2. The popup mode named `Normal Screenshot` becomes `Screenshot`, and that mode always produces a lossless PNG at the browser's native screenshot resolution.

No other capture mode, pagination behavior, image format, permission, adapter, or user-facing workflow will change.

## Telegram Repeated-Chrome Fix

The supplied Telegram PDF shows that the current bounded DOM sampler can miss visible header and composer elements when they occur in the middle of Telegram's large rendered DOM. The Telegram adapter also retains a stale `difficult` flag even though interactive Scrollable Area capture now uses the ordinary downward-from-current coordinator. That flag prevents the composer from being hidden before the first frame.

The fix will:

- mark the interactive Telegram target as an ordinary downward capture, matching the current documented behavior;
- discover visible bars at the selected region's top and bottom edges by sampling screen coordinates with `document.elementsFromPoint`, then walking the returned elements' ancestor chains;
- merge those geometry-derived candidates with the existing bounded candidate scan, retaining the existing conservative classification rules;
- keep the top header in the first captured frame and hide it in subsequent frames;
- hide the bottom composer before the first frame and keep it hidden until the final frame, where it is restored for one capture;
- restore all inline visibility styles on success, failure, or cancellation.

Detection remains structural and geometry-based. It will not depend on Telegram text, translated labels, unstable generated class names, or private APIs.

## Screenshot Mode

The popup label and result metadata will use `Screenshot`. When this mode is selected, Output and Quality controls will be hidden and disabled because they do not alter the result. The capture configuration will be normalized so Screenshot always uses the existing High-quality path: PNG capture, lossless PNG output, and the full pixel dimensions returned by `captureVisibleTab`.

The extension will not request the `debugger` permission, alter browser zoom, resize the viewport, or upscale pixels. Those approaches could change page layout or add permissions and would not create genuine source detail.

## Tests

Implementation will follow red-green-refactor:

- a unit regression will require Telegram targets to use ordinary downward capture;
- a DOM-level regression will place edge chrome outside the first/last portions of a large DOM and require geometry-based discovery;
- browser integration will require exactly one top header and one final composer in the stitched result;
- popup/background tests will require the `Screenshot` label, hidden irrelevant controls, and forced High/PNG behavior even when Standard was previously selected;
- the existing Stage 1-6, popup, result, and relevant browser-integration suites will be rerun to protect all working features.

## Acceptance Criteria

- The Telegram channel header appears exactly once at the top of the captured output.
- The Broadcast composer appears exactly once at the true bottom.
- Real message content and sticky message separators are preserved.
- The selected Telegram scroll position and all changed styles are restored.
- Screenshot mode is labeled `Screenshot` and always saves a lossless PNG at native browser resolution.
- No new permissions, dependencies, or unrelated production changes are introduced.
