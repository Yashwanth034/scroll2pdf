# Short Date-Only Filenames Implementation Plan

Date: 2026-08-12
Design: `docs/superpowers/specs/2026-08-12-short-date-only-filenames-design.md`

## Task 1: Lock the image filename contract

Files:

- Modify `tests/run-stage2-tests.js`
- Modify `tests/run-stage6-tests.js`

Steps:

1. Change literal PNG and JPG expectations to `scroll2pdf-YYYY-MM-DD.ext`.
2. Assert that generated names exclude the hostname, page title, chat text, and time.
3. Run the focused suites and confirm they fail because production still includes hostname and time.

## Task 2: Lock the PDF filename contract

Files:

- Modify `tests/run-stage4-tests.js`

Steps:

1. Change the literal PDF expectation to `scroll2pdf-YYYY-MM-DD.pdf`.
2. Run the focused suite and confirm it fails for the existing hostname/time format.

## Task 3: Apply the minimal production change

Files:

- Modify `utils/capture-utils.js`
- Modify `utils/pdf-utils.js`
- Modify `utils/release-utils.js`

Steps:

1. Retain date validation and UTC date formatting.
2. Remove hostname parsing and hour/minute formatting from all three filename builders.
3. Retain quality-based PNG/JPG selection and the `.pdf` extension.
4. Run the focused filename suites until green.

## Task 4: Regression verification

Files:

- No production changes unless a scoped regression is found.

Steps:

1. Run all unit and stage suites.
2. Run popup and result E2E suites to confirm download rendering remains unchanged.
3. Confirm capture configuration, selected Screenshot cropping, chat handling, image encoding, and PDF generation tests remain green.
