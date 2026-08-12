# Screenshot Area Toggle Implementation Plan

Date: 2026-08-12
Design: `docs/superpowers/specs/2026-08-12-screenshot-area-toggle-design.md`

## Constraints

- Add an option inside Screenshot mode, not a fifth capture mode.
- Default it off on every popup load and do not persist it.
- Capture exactly one lossless PNG frame whether the option is on or off.
- Do not change scrolling, chat handling, PDF output, or existing capture behavior.
- Write each behavioral test first and observe the expected failure before production changes.

## Task 1: Popup contract and compact toggle

Files:

- Modify `tests/run-tests.js`
- Modify `tests/run-popup-e2e.js`
- Modify `popup/popup.html`
- Modify `popup/popup.js`
- Modify `popup/popup.css`

Steps:

1. Add tests asserting the Screenshot-only toggle exists, defaults off, is hidden and disabled for other modes, and returns a strict `selectScreenshotArea` boolean.
2. Run those tests and confirm they fail because the option is absent.
3. Add a native checkbox and compact switch row visually attached beneath the Screenshot card.
4. Extend popup configuration reading and mode synchronization with the boolean.
5. Run popup unit and browser-layout tests until green.

## Task 2: Strict configuration validation

Files:

- Modify `tests/run-tests.js`
- Modify `tests/run-stage2-tests.js`
- Modify `utils/constants.js`
- Modify `background/background.js`
- Modify `background/full-page-capture.js`

Steps:

1. Add tests for the required boolean, rejection of non-boolean values, and normalization to false outside Screenshot mode.
2. Confirm the validator and manager tests fail for the missing field.
3. Add `selectScreenshotArea: false` to the default/configuration contract and normalize it defensively.
4. Run the focused tests until green.

## Task 3: One-shot viewport selector

Files:

- Modify `tests/run-stage3-tests.js`
- Add `content/screenshot-selection.js`
- Modify `content/content.js`
- Modify `utils/constants.js`
- Modify `manifest.json`

Steps:

1. Add tests for a valid rectangle result, retry after a too-small drag, Escape cancellation, external cancellation, listener/overlay cleanup, and single-session protection.
2. Confirm they fail because the selector and message type do not exist.
3. Implement a small selector using the existing overlay, rectangle normalization, and minimum-size utilities.
4. Route start/cancel messages without entering the region scrolling session.
5. Add the module to both static and on-demand content-script lists.
6. Run focused selector/content tests until green.

## Task 4: One-frame crop pipeline

Files:

- Modify `tests/run-stage2-tests.js`
- Modify `tests/run-stage3-browser-integration.js`
- Modify `background/full-page-capture.js`
- Modify `offscreen/offscreen.js`

Steps:

1. Add coordinator tests proving toggle-off sends no selection message, while toggle-on requests one selection, captures once, and forwards the exact CSS rectangle and viewport dimensions.
2. Add offscreen/browser coverage proving output dimensions equal the selected rectangle at device pixel ratio, the overlay is absent, and scroll position is unchanged.
3. Confirm tests fail for missing selection/crop behavior.
4. Request selection before offscreen capture, handle cancellation as normal cancellation, wait for repaint, and pass crop metadata with the single frame.
5. Preserve a supplied Screenshot crop in the offscreen processor; synthesize a full-viewport crop only when no crop was supplied.
6. Run focused coordinator and browser tests until green.

## Task 5: Regression and visual QA

Files:

- No production changes unless a failing test identifies a scoped defect.

Steps:

1. Run all unit/stage suites.
2. Run popup and result E2E suites.
3. Run existing Chrome integration suites, including both toggle-off and toggle-on Screenshot flows.
4. Inspect the popup screenshot for alignment, clipping, readable switch text, keyboard focus, and correct hidden states.
5. Confirm Full Page, Scrollable Area, Selected Area, chat header/composer placement, PDF output, and current Screenshot behavior remain green.
