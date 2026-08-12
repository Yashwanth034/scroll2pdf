# Scroll2PDF Stage 5 Implementation Plan

## Task 1: Pure dynamic-capture contracts

1. Add failing Stage 5 tests for adapter results, effective-scroller scoring, stable anchor identity, anchor displacement, capture context, virtualization signals, logical frame-chain ordering, repeated-state recovery, crop normalization, and safety limits.
2. Run the Stage 5 suite and confirm failures are caused by missing Stage 5 modules.
3. Add `utils/difficult-page-utils.js` and the Stage 5 constants/messages required by those contracts.
4. Rerun Stage 5 and Stage 1–4 unit suites.

## Task 2: Adapter registry and explicit selection

1. Add failing DOM tests for generic fallback, WhatsApp wrapper redirection/labeling, Telegram WebA/WebK-like redirection/labeling, uncertain adapter fallback, and adapter exception containment.
2. Implement `content/adapters/adapter-registry.js`, `generic-chat-adapter.js`, `whatsapp-adapter.js`, and `telegram-adapter.js`.
3. Update Scrollable Area hover resolution to use the registry while retaining click confirmation and ordinary candidate behavior.
4. Add the scripts to the manifest in dependency order and run selection regressions.

## Task 3: Difficult-page content session

1. Add failing tests for reverse preparation, anchor snapshots, mutation/history settling, loading retries, lazy-media waits, scoped animation suppression, small geometry changes, context-change failure, and anchor-based restoration.
2. Implement `content/difficult-page-capture.js` and `content/capture-stability.js`.
3. Extend the Scrollable Area session to delegate only confidently difficult targets to this module.
4. Ensure observers, styles, attributes, and scroll positions clean up on success, cancellation, and error.

## Task 4: Dynamic background coordinator

1. Add failing coordinator tests for unknown-total progress, upward frame collection, history-load retries, virtualized progress, repeating-state recovery/failure, navigation failure, cancellation during waits, and ordinary-path preservation.
2. Implement `background/dynamic-region-capture.js` and route capable Scrollable Area sessions from `region-capture.js`.
3. Keep screenshot throttling, target-tab protection, restoration, stitching, PDF conversion, and single-operation ownership in the existing architecture.

## Task 5: Offscreen fingerprints and seam planner

1. Add failing pure tests for grayscale fingerprints, identical/near/different frame comparison, row-signature overlap selection, predicted-overlap fallback, and ordered frame-chain plans.
2. Implement `offscreen/frame-analysis.js` and `offscreen/seam-planner.js`.
3. Extend frame ingestion to store lightweight analysis metadata.
4. Generalize stitching to accept an explicit logical frame chain and seam trims while retaining coordinate stitching for Stage 2–4 captures.
5. Run offscreen and PDF regressions.

## Task 6: Realistic fixtures

1. Create `prepend-history-chat.html` with delayed prepends and anchor-preserving scroll adjustment.
2. Create `virtualized-chat.html` with a bounded recycled DOM window over hundreds of logical messages.
3. Create sticky chrome, lazy media, dynamic resize, navigation change, seam-overlap, WhatsApp-like, and Telegram WebA/WebK-like fixtures.
4. Give every fixture machine-readable visual markers without production-only test hooks.

## Task 7: Browser integration

1. Extend the production Chrome fixture harness to inject the new content/offscreen/background modules.
2. Drive explicit hover/click selection and actual browser screenshots.
3. Verify ordered oldest/newest/message/color markers, outside-content exclusion, sticky/composer repetition, media completion, accepted safe resize, navigation abort, seam trimming, cancellation, and restoration.
4. Exercise difficult Long Image and A4 PDF results through the Stage 4 output path.
5. Attempt actual unpacked-extension context once if a compatible browser is available; otherwise record the branded-Chrome limitation and use the established fallback.

## Task 8: Full regression and documentation

1. Update README with explicit chat selection, best-effort adapter support, privacy, limits, cancellation, and virtualization constraints.
2. Validate the manifest and script order.
3. Run Stage 1, Stage 2, Stage 3, Stage 4, Stage 5, popup E2E, result E2E, smoke diagnostics, Stage 3 browser integration, Stage 4 browser integration, and Stage 5 browser integration.
4. Fix every failure and rerun the affected and complete suites.
5. Scan production code for remote code, external services, private site APIs, Stage 6 work, and unreleased observers/styles.
