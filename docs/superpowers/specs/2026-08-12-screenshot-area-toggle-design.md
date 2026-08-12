# Screenshot Area Toggle Design

Date: 2026-08-12

## Goal

Add an optional **Select area before capture** toggle inside the existing Screenshot mode. When enabled, the user selects a rectangle in the visible viewport and Scroll2PDF saves that rectangle as one lossless PNG without scrolling. When disabled, Screenshot keeps its current full-viewport behavior.

## Scope

- Keep Screenshot as one capture mode; do not add another mode card.
- Show a compact toggle directly beneath the Screenshot card only while Screenshot is selected.
- Default the toggle to off every time the popup opens. Do not persist it.
- Keep Screenshot output fixed to a native-resolution, lossless PNG.
- Leave Full Page, Scrollable Area, Selected Area, PDF output, and their settings unchanged.

## User Flow

### Toggle off

1. The user selects Screenshot.
2. The toggle is visible and off.
3. The user starts capture.
4. Scroll2PDF captures exactly one full visible viewport and opens the existing result page.

### Toggle on

1. The user selects Screenshot and enables **Select area before capture**.
2. The user starts capture.
3. A viewport overlay asks the user to drag an area. The page does not scroll.
4. A selection smaller than 80 by 80 CSS pixels is rejected and the overlay remains available for another drag.
5. A valid pointer release removes the overlay, waits for the page to repaint, captures exactly one viewport, and crops it to the selected rectangle.
6. Scroll2PDF opens the existing result page with a lossless PNG labelled Screenshot.
7. Pressing Escape or Cancel Capture removes the overlay and cancels the operation without producing a result.

## Architecture

### Popup

The popup adds one non-persistent boolean setting, `selectScreenshotArea`. It is included in the capture request and is always `false` unless the Screenshot-only toggle is checked. Selecting another capture mode hides and disables the toggle so it cannot affect other modes.

The control uses the existing popup palette, typography, spacing, keyboard focus treatment, and compact dimensions. It is visually attached to the Screenshot card and does not resemble a fifth capture mode.

### Configuration validation

The background configuration validator accepts the new field only as a boolean. It normalizes the value to `false` for every non-Screenshot mode. Screenshot continues to normalize output to Long Image and quality to High so stale or irrelevant popup values cannot affect PNG output.

### One-shot page selector

A focused content-script module owns only viewport screenshot selection. It reuses the existing selection overlay and rectangle utilities, but it does not reuse the Selected Area capture session because that session manages scrolling, pinned chrome, restoration, and multi-frame state.

The selector returns:

- the CSS crop rectangle;
- the viewport CSS width and height needed to convert the rectangle to bitmap pixels; or
- a cancelled result.

The selector owns its pointer and keyboard listeners and removes them exactly once on success, cancellation, or error. Only one selector may be active at a time.

### Background capture flow

Screenshot keeps a one-frame capture path:

1. If `selectScreenshotArea` is false, use the current full-viewport path unchanged.
2. If true, request one rectangle from the page and stop if selection is cancelled.
3. After the overlay has been removed and a repaint boundary has passed, call `captureVisibleTab` once.
4. Send the selected CSS rectangle and viewport dimensions with the captured frame to the offscreen processor.
5. Save and open the existing PNG result.

No page scroll, capture preparation, repeated-frame detection, header/composer suppression, or restoration logic runs in this flow.

### Offscreen cropping

The offscreen processor keeps full-viewport behavior when no selected rectangle is supplied. When selected metadata is supplied, it converts the CSS rectangle to bitmap coordinates using the actual screenshot dimensions and the supplied viewport dimensions, then saves only that crop. This preserves device-pixel-ratio sharpness without resampling or JPEG conversion.

## Error Handling

- Escape and the extension's Cancel Capture action are normal cancellation, not errors.
- A too-small drag displays the existing minimum-size guidance and allows another attempt.
- If page interaction is unavailable, return the existing protected/unavailable-page guidance and do not take a misleading full-screen screenshot.
- If the tab loses focus before capture, retain the existing active-tab protection.
- Any failure or cancellation removes the selector overlay and clears offscreen temporary state.

## Accessibility

- The switch has an explicit visible label and keyboard focus state.
- Its checked state uses a native checkbox so assistive technology receives the correct role and value.
- The selection surface retains an accessible instruction and Escape cancellation.
- Reduced-motion preferences remain respected.

## Testing

Implementation follows test-driven development. Tests must fail for the missing behavior before production code is changed.

Automated coverage will verify:

- the toggle appears only for Screenshot, defaults off, and is not stored;
- capture configuration contains a strict boolean and non-Screenshot modes normalize it to false;
- toggle-off Screenshot remains one full-viewport lossless PNG with no page-selection message;
- toggle-on Screenshot requests a selection, captures once, and forwards accurate crop metadata;
- the offscreen result dimensions match the selected rectangle at the browser's device pixel ratio;
- the overlay is gone from the saved image;
- the page scroll position is unchanged;
- small selections retry, while Escape and Cancel clean up without a result;
- all existing unit, popup, result, and browser-integration suites remain green.

## Acceptance Criteria

The feature is complete when Screenshot offers the optional toggle, an enabled toggle produces an accurately cropped native-resolution PNG from one visible-viewport capture, disabled behavior is unchanged, cancellation leaves no overlay or result, the page never scrolls, and all existing capture modes pass regression tests.
