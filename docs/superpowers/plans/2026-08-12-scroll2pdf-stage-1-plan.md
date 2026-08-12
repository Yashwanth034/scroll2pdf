# Scroll2PDF Stage 1 Implementation Plan

1. Add a dependency-free validation suite covering the manifest contract, shared settings protocol, popup request payload, service-worker validation, content-script ping response, accessibility essentials, security constraints, and JavaScript syntax.
2. Run the suite and confirm it fails because the extension artifacts do not yet exist.
3. Implement the shared constants, Manifest V3 shell, popup markup/styles/behavior, background listener, minimal content script, and README.
4. Run the suite until all checks pass, then refactor only where clarity improves without expanding Stage 1.
5. Inspect the final tree, run standalone JSON and JavaScript syntax checks, and manually exercise the popup in Chromium when the local environment supports it.

The implementation must not call capture APIs, scroll a page, create a selection overlay, stitch images, use canvas, or generate PDFs.
