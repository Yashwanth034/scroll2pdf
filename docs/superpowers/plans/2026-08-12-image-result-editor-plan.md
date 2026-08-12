# Image Result Editor and Clipboard Export Implementation Plan

Date: 2026-08-12
Design: `docs/superpowers/specs/2026-08-12-image-result-editor-design.md`

## Constraints

- Editing is image-result-only; PDF results remain unchanged.
- Capture, scrolling, stitching, chat, and PDF-generation code remain untouched.
- No external runtime dependency or new manifest permission.
- The original result Blob remains immutable and Reset-capable in memory.
- Every production behavior starts with a focused failing test.
- Each phase ends with focused tests, the complete existing automated suite, visual/browser review, and a checkpoint commit.

## Phase 1: Editor foundation and Copy Image

### Task 1.1: Pure document and revision state

Files:

- Add `tests/run-editor-tests.js`
- Add `result/editor-core.js`
- Modify `result/result.html`
- Modify `tests/run-tests.js`
- Modify `tests/run-stage6-tests.js`

Test-first behaviors:

- Create an image document with an immutable source plan and literal dimensions.
- Convert preview points to document points at multiple display scales.
- Track original, edited, exported, and unexported revision states.
- Bound snapshot history by count/estimated metadata size without duplicating the source Blob.
- Package every new local script with no permission or remote-code change.

### Task 1.2: Native-resolution renderer and export cache

Files:

- Extend `tests/run-editor-tests.js`
- Add `result/editor-renderer.js`

Test-first behaviors:

- Render a literal source segment into the requested document region.
- Reject invalid/excessive output sizes through existing bitmap limits.
- Export PNG or JPEG according to the requested output type.
- Cache an export by document fingerprint and MIME type.
- Invalidate/revoke stale edited Blob URLs after a changed revision.
- Release decoded bitmap and work canvases on dispose.

### Task 1.3: Image-only result integration and clipboard

Files:

- Extend `tests/run-result-e2e.js`
- Modify `result/result.html`
- Modify `result/result.css`
- Modify `result/result.js`
- Add `result/editor-controller.js`

Test-first behaviors:

- Image results show Copy Image and the focused editor toolbar; PDF results do not.
- The editor starts in Select mode and retains the current unedited Download URL.
- Copy Image exports PNG and calls `navigator.clipboard.write` with a `ClipboardItem`.
- Copy success, denial, unavailable API, and encoding failure produce accessible status without breaking Download.
- PDF card/preview/download behavior and immediate temporary-result deletion stay unchanged.
- All Blob URLs/listeners/bitmap resources are released on unload.

### Task 1.4: Phase 1 browser checkpoint

- Run editor unit, result E2E, popup E2E, all stage suites, packaging/security tests.
- Inspect focused toolbar layout at desktop and narrow widths.
- Run a real Chrome image result and verify Copy writes a PNG payload where supported.
- Commit Phase 1 only after the tree is green.

## Phase 2: Annotation editor

### Task 2.1: Annotation model, fragments, hit testing, and history

Files:

- Extend `tests/run-editor-tests.js`
- Extend `result/editor-core.js`

Test-first behaviors:

- Normalize arrow, rectangle, circle, pen, highlighter, text, and blur annotations.
- Preserve stable IDs, shared group identity, creation order, and valid style ranges.
- Calculate literal bounds and topmost hit-testing results.
- Move, resize, restyle, and delete selected objects.
- Simplify a literal freehand path while preserving endpoints.
- Commit one history entry per completed action; Undo, Redo, redo-branch invalidation, and Reset undo work.

### Task 2.2: Annotation and localized-blur rendering

Files:

- Extend `tests/run-editor-tests.js`
- Extend `result/editor-renderer.js`

Test-first behaviors:

- Render each annotation type with literal geometry and styles.
- Respect fragment clips and transforms.
- Render translucent highlighter and localized non-cumulative blur.
- Preserve creation order and selected-output independence.
- Produce expected pixels/dimensions in a real-canvas browser fixture.

### Task 2.3: Annotation interaction controller

Files:

- Extend `tests/run-result-e2e.js`
- Extend `result/editor-controller.js`
- Modify `result/result.html`
- Modify `result/result.css`

Test-first behaviors:

- Tool selection reveals only applicable contextual controls.
- Pointer drag creates arrows, shapes, freehand paths, highlights, and blur regions.
- Text uses inline multiline entry and rejects empty content.
- Select mode supports topmost selection, move, resize, arrow endpoint adjustment, restyle, and deletion.
- Undo/Redo/Reset buttons and keyboard shortcuts update enabled/pressed states.
- Edited and unexported revision states control indicators and unload warning.
- Download and Copy render the latest annotation revision and reuse caches until the next edit.

### Task 2.4: Phase 2 browser checkpoint

- Exercise every annotation tool on a known fixture.
- Analyze exported geometry/colors, blur change, MIME type, and native dimensions.
- Verify keyboard focus, narrow toolbar behavior, repeated exports, and cleanup.
- Run the complete regression suite and commit Phase 2.

## Phase 3: Structural Long Image editing

### Task 3.1: Structural source/blank render plan

Files:

- Extend `tests/run-editor-tests.js`
- Extend `result/editor-core.js`

Test-first behaviors:

- Crop source and blank segments with literal expected source coordinates.
- Split/remove a full-width horizontal band and close its exact gap.
- Split at an insertion line and insert an exact white segment.
- Reject zero/too-small results and insertion beyond dimension/pixel limits.
- Preserve document width/height and contiguous destination coverage.

### Task 3.2: Annotation transformation through structure

Files:

- Extend `tests/run-editor-tests.js`
- Extend `result/editor-core.js`

Test-first behaviors:

- Crop translates surviving objects, removes outside objects, and clips intersecting objects.
- Cut leaves upper fragments, shifts lower fragments, and groups split fragments.
- Insert leaves upper fragments, shifts lower fragments, and creates a blank gap through crossing objects.
- Move/resize/style/delete after splitting affects the logical grouped object.
- Undo/Redo restores exact structural and annotation snapshots.

### Task 3.3: Structural preview/export and interactions

Files:

- Extend `tests/run-editor-tests.js`
- Extend `tests/run-result-e2e.js`
- Extend `result/editor-renderer.js`
- Extend `result/editor-controller.js`
- Modify `result/result.html`
- Modify `result/result.css`

Test-first behaviors:

- Tiled rendering composes source and white segments without gaps.
- Crop and Cut use a draft plus Apply/Cancel.
- Cut selection always spans the full current width.
- Insert Space shows the allowed maximum and commits only a valid height.
- Current dimensions update after every structural operation.
- Exported striped fixtures prove crop dimensions, cut row continuity, and inserted white-band height.

### Task 3.4: Phase 3 browser checkpoint

- Edit a tall striped Long Image through crop, cut, insertion, annotation, Undo/Redo, Copy, and Download.
- Verify exact output dimensions/pixels and unchanged original Reset result.
- Run the complete regression suite and commit Phase 3.

## Phase 4: Hardening and release readiness

### Task 4.1: Preview tile virtualization and resource limits

Files:

- Extend `tests/run-editor-tests.js`
- Extend `tests/run-result-e2e.js`
- Refine editor modules only where tests require it.

Test-first behaviors:

- Only visible preview tiles plus overscan remain mounted.
- Scroll/resize/zoom preserves document geometry and invalidates only affected tiles.
- History stops at 100 commands or 64 MB metadata.
- Maximum practical captures export or fail with the designed actionable message.
- Repeated edits/exports revoke obsolete URLs and do not retain abandoned canvases.

### Task 4.2: Accessibility and failure recovery

- Verify tool names, pressed states, labels, focus order, live announcements, minimum targets, reduced motion, and Apply/Cancel keyboard access.
- Verify corrupt source, unsupported Clipboard API, clipboard rejection, loss of focus, export allocation failure, and unload warning.
- Confirm unsupported features disable locally without hiding Download.

### Task 4.3: Documentation, packaging, and final regression

Files:

- Update `README.md`
- Update store copy only if editor functionality is intended for the next release description.
- Rebuild `dist/scroll2pdf-1.0.0.zip`

Verification:

- Run `node tests/run-tests.js` and every stage suite.
- Run editor, popup, result, packaging/security, and Chrome browser integration suites.
- Re-run Telegram/WhatsApp header/composer regressions and selected Screenshot crop regression.
- Inspect Git diff/check/status, rebuild the release archive, and commit Phase 4.

## Later Project

PDF annotation/editing and insertion of another external image receive a separate design/specification after image-editor usage is stable.
