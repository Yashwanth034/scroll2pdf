# Scroll2PDF Stage 4 Implementation Plan

## 1. Freeze the contract in tests

- Add pure tests for A4 dimensions, margins, scaling, maximum upscale, exact page ranges, final-page cropping, smart breaks, fallbacks, search bounds, filename generation, and the 500-page guard.
- Add binary writer tests for PDF signature, page count, A4 media boxes, orientation, metadata, non-empty image/content streams, and final page presence.
- Add orchestration tests for PDF progress, cancellation, cleanup, unsupported state, and preservation of Long Image behavior.
- Run the new tests before implementation and confirm they fail for missing Stage 4 modules.

## 2. Implement pure PDF geometry and pagination

- Add `utils/pdf-utils.js` as a browser/Node-compatible global module.
- Centralize A4 and margin constants.
- Implement scale and source-band calculations.
- Implement exact page coverage and the bounded smart-break selector.
- Extend filename helpers for `.pdf`.
- Make the pure test group pass.

## 3. Implement the custom PDF writer

- Add `offscreen/pdf-writer.js` with deterministic object allocation and byte-safe output.
- Support JPEG `/DCTDecode` and raw deflated RGB `/FlateDecode` image XObjects.
- Generate A4 page objects, drawing commands, metadata, xref, and trailer.
- Make PDF binary validation tests pass without introducing a package or build system.

## 4. Implement offscreen PDF processing

- Add `offscreen/pdf-generator.js` for source decode, row analysis, page planning, sequential band rendering, encoding, final storage, cancellation, and cleanup.
- Load the new scripts from `offscreen.html`.
- Route plan/render/finalize messages through `offscreen.js`.
- Keep the long-image stitcher unchanged except for handing its temporary result to the PDF stage.

## 5. Integrate background orchestration

- Add `background/pdf-output.js` to convert a stitched result according to output type.
- Add Stage 4 message and phase constants.
- Call the output finalizer from both the full-page and region capture coordinators.
- Preserve single-operation state, popup recovery, cancellation, restoration, time and size limits, and result-page opening.

## 6. Update popup and result UI

- Hide/disable orientation for Long Image and expose it for A4 PDF.
- Render PDF metadata and a Download PDF action in the existing result page.
- Preserve current image preview/download behavior.
- Extend popup and result E2E tests.

## 7. Browser fixtures and integration

- Add a pagination/smart-break fixture where ideal cuts cross cards but nearby quiet gaps exist.
- Exercise production capture, stitching, offscreen PDF generation, result storage, and binary inspection through the strongest available Chrome CDP fixture harness.
- Cover Full Page portrait/landscape, Scrollable Area, Selected Area from mid-page, short one-page content, smart breaks, cancellation during PDF generation, and Long Image regressions.
- Attempt actual unpacked-extension automation once with the available browser; if blocked, record the evidence and run the established production-module fixture fallback.

## 8. Full verification and review

- Run Stage 1, Stage 2, Stage 3, PDF unit/binary tests, popup E2E, result E2E, smoke tests, extension integration, and browser fixtures.
- Fix every failure and rerun affected and full suites.
- Inspect the manifest, script ordering, cleanup paths, stage-boundary exclusions, and final project tree.
