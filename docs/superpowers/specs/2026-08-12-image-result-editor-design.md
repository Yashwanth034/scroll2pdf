# Image Result Editor and Clipboard Export Design

Date: 2026-08-12

## Goal

Turn the existing image result page into a local, dependency-free editor for Screenshot and Long Image results. Users can annotate an image, crop it, remove a horizontal section, insert blank space, copy the edited image to the clipboard, or download it. PDF results remain unchanged until a later project.

## Scope

The first image-editor release includes:

- Select and object editing
- Crop
- Remove horizontal section
- Insert blank space
- Arrow
- Rectangle
- Circle
- Freehand pen
- Highlighter
- Text
- Blur
- Undo and redo
- Color, thickness, opacity, font-size, and blur-strength controls where applicable
- Delete selected object
- Reset to original
- Copy Image
- Download edited image
- Edited-state indicator and unexported-change exit warning

The release does not include PDF editing, inserting another image, rotation, filters, cloud sharing, persistent drafts, collaboration, or layer reordering.

## Product Boundaries

Editing is confined to the result page. Capture coordinators, content scripts, scrolling, stitching, chat handling, PDF generation, and capture permissions are not changed.

Only image records show the editor and Copy Image control. PDF records retain the current PDF card, preview, Close button, and Download PDF action without editor controls.

Edits exist only in the open result tab. Closing or reloading after an edit that has not been successfully copied or downloaded loses that work after a browser confirmation. A successful Copy or Download marks the current revision as exported and suppresses the warning until another edit occurs. The original capture stays available in memory for Reset while the tab remains open.

## Result-Page Experience

The selected visual direction is the focused top-toolbar layout.

- The sticky result header retains the filename, dimensions, metadata, Close, and Download Image.
- Copy Image appears immediately beside Download Image.
- An image-only editor toolbar appears below the header.
- The primary toolbar contains Select, Crop, Cut section, Insert space, Arrow, Rectangle, Circle, Pen, Highlighter, Text, Blur, Undo, Redo, and Reset.
- Selecting a tool reveals a compact contextual row containing only its applicable controls.
- The editor opens in Select mode so pointer movement cannot accidentally draw.
- The current tool, unavailable actions, selection state, and keyboard focus are visually distinct.
- An Edited indicator appears whenever the current document differs from the original and clears after Reset.
- Status messages announce copied, exported, reset, invalid selection, memory-limit, and clipboard outcomes.

On narrow screens the toolbar wraps or becomes horizontally scrollable without covering the canvas. The image workspace remains the dominant area.

## Tool Behavior

### Select

Select mode supports choosing, moving, resizing, and deleting annotation objects. Arrow endpoints can be adjusted independently. Text can be reopened for editing. Freehand paths, highlighter paths, and blur regions expose a bounding box for movement and proportional resizing.

Objects remain in creation order. Layer reordering is not part of this release.

### Crop

The user drags a rectangle in image coordinates. The proposed crop remains a preview until Apply or Cancel.

Applying crop:

- changes the document width and height to the selected rectangle;
- removes source pixels outside it;
- translates surviving annotations into the new origin;
- removes annotations fully outside the crop;
- clips annotations crossing a crop boundary; and
- creates one undoable command.

A crop must satisfy the existing minimum selection size and output safety limits.

### Remove horizontal section

The user drags a horizontal band. The selection always spans the full current document width, regardless of the pointer's horizontal position. The band remains a preview until Apply or Cancel.

Applying removal:

- deletes every source, blank-space, blur, and annotation pixel inside the band;
- shifts all content below the band upward by the removed height;
- removes annotations wholly inside the band;
- clips annotations that intersect the band while preserving their visible upper and lower portions as one selectable grouped object; and
- creates one undoable command.

The result must retain a positive height and meet existing output safety limits.

### Insert blank space

The user selects a horizontal insertion line and enters a height. Applying inserts an opaque white band across the entire current width and moves everything below it downward.

The inserted height must be at least 1 CSS/output pixel and no more than the lesser of 5,000 pixels or the remaining height allowed by the existing bitmap dimension and pixel-area limits. The UI shows the permitted maximum before Apply. Insert space creates one undoable command.

### Arrow, rectangle, and circle

These vector annotations support color, stroke thickness, and opacity. Rectangles and circles have no fill in the first release so the captured content remains visible. Arrowheads scale with stroke thickness.

### Pen and highlighter

Pen records a simplified freehand path with color, thickness, and opacity. Highlighter uses a broad translucent stroke with a default yellow color and reduced opacity. Pointer sampling is simplified after the stroke ends to avoid excessive history and memory usage without visibly changing the path.

### Text

A click establishes the text origin and opens an inline text editor. Text supports color, font size, and multiline content. Empty text is cancelled rather than creating an object. The first release uses the extension's system-font stack and does not offer font-family selection.

### Blur

The user drags a rectangular blur region and controls blur strength. Blur is represented as an editable region, not destructively applied during editing. Preview and export sample the pixels beneath the region and apply a localized blur. Moving or resizing the region recalculates the preview from underlying content, avoiding cumulative blur.

Blur is intended as a convenience redaction tool, not a cryptographic privacy guarantee. The result page explains that users should verify the exported image before sharing.

## Editing Commands and History

Every completed annotation, object move/resize/style change, crop, cut, insert-space operation, deletion, and Reset boundary is represented by an editor command.

- Undo reverses the most recent committed command.
- Redo reapplies the most recently undone command.
- Starting a new command after Undo discards the redo branch.
- Pointer movement during a drag does not create history entries; pointer release commits one entry.
- Undo history is bounded by both command count and estimated memory. The initial limits are 100 commands and 64 MB of history metadata, whichever is reached first.
- The immutable original Blob is not duplicated in each history entry.
- Reset asks for confirmation when dirty and returns to the original document with no annotations. Reset itself can be undone during the same open editor session.

Keyboard behavior:

- Ctrl/Cmd+Z: Undo
- Ctrl/Cmd+Shift+Z: Redo
- Delete/Backspace: delete the selected annotation when focus is not inside text entry
- Escape: cancel the active draft operation or return to Select mode
- The Copy Image button always copies the full edited image to the system clipboard
- Ctrl/Cmd+C is not overridden in the first release, avoiding ambiguity between browser text copying, object copying, and full-image copying

## Layered Document Model

The editor owns an in-memory document with four independent concerns:

1. **Original source**: the immutable image Blob and decoded bitmap.
2. **Structural map**: an ordered render plan containing source rectangles and inserted white-space segments. Crop, cut, and insert-space operations transform this plan rather than rewriting the original pixels.
3. **Annotation layers**: typed vector/path/text/blur objects stored in current document coordinates with stable IDs and style data.
4. **History**: reversible commands containing only changed structural metadata and annotation data.

Structural operations transform annotation geometry. When an operation clips an annotation into multiple visible pieces, the pieces share one group ID so selection, movement, deletion, undo, and style changes still treat them as one logical object.

All pointer input is converted from scaled preview coordinates into current document coordinates. Resizing the browser or changing preview zoom cannot change stored geometry.

## Preview Rendering

The original image is decoded once. The editor does not allocate one canvas at the full source dimensions merely to display the preview.

- The visible preview uses bounded vertical tiles generated at the current display scale.
- Only tiles near the viewport plus a small overscan margin are rendered.
- Structural source/blank segments are composed into each preview tile.
- Annotation and blur layers are rendered into the same display-coordinate tile after the base pixels.
- Selection handles and draft shapes use a lightweight interaction overlay so dragging does not rerender unaffected base tiles.
- Dirty tiles are invalidated after a command; unaffected tiles remain reusable.
- Zoom is display-only and never resamples stored source data.

This model keeps very tall Long Images responsive while preserving native-resolution export.

## Export and Download

Download always represents the current editor document.

- An original PNG exports as PNG.
- An original JPEG exports as JPEG at the project's existing high/readable encoding quality.
- The filename remains the current short date-only filename.
- The current document dimensions replace the original dimensions in the result-page metadata after structural edits.

Export validates width, height, and total pixel area against the existing bitmap limits before allocating the final canvas. Rendering proceeds through bounded vertical work tiles drawn into the final output canvas so no additional full-size intermediate canvas is required. The browser still needs memory for the final canvas and encoded Blob; allocation or encoding failure produces a clear error without losing edits.

After successful edited export:

- a new Blob URL replaces the previous Download URL;
- the previous edited Blob URL is revoked;
- repeated downloads reuse the last rendered Blob until another edit invalidates it; and
- the immutable original Blob URL remains available internally for Reset and is revoked on page unload.

## Copy Image

Copy Image is available only for image results and always copies the full current editor document.

- The button's trusted user click starts rendering and clipboard writing.
- Clipboard output is PNG for compatibility, even when the original image is JPEG.
- The editor uses `ClipboardItem` and `navigator.clipboard.write` from the extension result page.
- The extension does not read clipboard contents.
- The first implementation attempts this without a new manifest permission. If Chrome rejects clipboard writing in a supported environment, the feature reports that clipboard access was denied and leaves Download available; a permission expansion requires a separate explicit design decision.
- On success the button briefly reads Copied and an accessible status message announces success.
- If PNG encoding, clipboard allocation, OS clipboard size, browser focus, or permission fails, the editor keeps all edits and explains that Download Image remains available.

Copy and Download share the same renderer and cache key, but Copy requests PNG encoding while Download preserves the original image format.

## Result Storage and Cleanup

The result page loads the temporary IndexedDB record exactly once. It retains the original Blob and decoded bitmap in memory, then deletes the temporary record as it does today. No editor draft is written back to IndexedDB in this release.

All object URLs, decoded bitmaps, preview tile canvases, export work canvases, cached Blobs, event listeners, and clipboard/export operations are released or cancelled during unload. Closing with a revision newer than the last successful Copy or Download invokes the browser's standard unsaved-change confirmation.

## Accessibility

- Every tool is a real button with a name, pressed/selected state, tooltip, and keyboard focus style.
- Context controls use native form fields with explicit labels.
- Apply/Cancel is available without pointer input.
- Status and error messages use the existing live region.
- Color is not the only selected-state indicator.
- Minimum target size remains approximately 40 by 40 CSS pixels.
- Reduced-motion preferences disable nonessential transitions.
- The canvas has a descriptive accessible label; precise drawing remains pointer-oriented, while all toolbar, history, reset, export, copy, and object deletion actions are keyboard reachable.

## Error Handling

- Invalid or too-small crop/cut selections remain drafts and show corrective guidance.
- Structural operations that would exceed bitmap limits are rejected before commit.
- Export errors do not clear history, annotations, or the last valid download.
- Clipboard errors do not affect Download.
- A missing/expired source result keeps the current existing recovery message and never opens an empty editor.
- A corrupted or undecodable image produces a concise error and no editor controls.
- PDF records bypass all editor initialization.
- Unsupported browser APIs disable only the affected control and explain the fallback.

## Delivery Phases

### Phase 1: Foundation and clipboard

- Add the image-only focused toolbar shell and editor state boundary.
- Add source decoding, scaled/tiled preview foundation, coordinate conversion, edited/exported revision state, and cleanup.
- Add Copy Image for the unedited source and preserve existing Download behavior.
- Establish real-browser clipboard coverage before annotation work.

### Phase 2: Annotation editor

- Add Select, arrow, rectangle, circle, pen, highlighter, text, and blur.
- Add contextual styles, move/resize/delete, undo/redo, reset, edited indicator, and unexported-change exit warning.
- Make Download and Copy render annotations.

### Phase 3: Structural Long Image editing

- Add crop with Apply/Cancel.
- Add full-width horizontal cut with gap closure.
- Add bounded white-space insertion.
- Add structural render-plan transformation, annotation clipping/grouping, current-dimension updates, and undo/redo.

### Phase 4: Hardening

- Complete keyboard and narrow-layout behavior.
- Exercise maximum supported dimensions, history limits, repeated export, clipboard failures, and resource cleanup.
- Run all capture, chat, PDF, popup, result, packaging, and browser integration regressions.

Each phase is independently reviewable and must leave all earlier behavior green before the next phase begins.

## Testing Strategy

Implementation follows strict test-driven development. Every production behavior begins with a failing test that exercises the real boundary.

### Unit tests

- Preview/document coordinate conversion at multiple zoom and DPR values
- Structural render-plan crop, cut, and insertion results with literal expected segments
- Annotation translation, clipping, grouped fragments, and deletion
- Command history, redo invalidation, Reset undo, and history limits
- Freehand simplification and style normalization
- Dimension/pixel-area checks and insertion maximum
- Export format selection, cache invalidation, and Blob URL revocation
- Clipboard PNG conversion and error mapping

### Result-page integration tests

- Image-only toolbar and Copy visibility; PDF UI remains unchanged
- Default Select mode and contextual controls
- Drawing, selecting, moving, resizing, styling, text editing, deleting, undoing, and resetting
- Crop Apply/Cancel, horizontal cut closure, insertion, and metadata dimension updates
- Edited Download Blob dimensions, MIME type, filename, and visible annotation pixels
- Copy Image invokes a real ClipboardItem-compatible boundary with a PNG Blob
- Edited-state indicator and unexported-change unload warning
- No runtime errors, overflow, or unreachable controls at narrow widths

### Real Chrome tests

- Draw each tool over a known fixture and analyze output pixels/geometry
- Crop and cut a striped Long Image and verify exact output dimensions and row continuity
- Insert white space and verify its location and height
- Verify annotation mapping through crop/cut/insert
- Copy a small edited image and inspect clipboard-write payload type/size where the Chrome environment permits it
- Repeated edit/export cycles do not retain obsolete Blob URLs or canvases
- A maximum practical long image either exports within limits or fails with the designed guidance

### Regression tests

All current unit/stage suites, popup E2E, result PDF preview, image preview/download, Screenshot selection, chat header/composer placement, packaging, and security checks remain green. No new remote dependency or permission is introduced.

## Acceptance Criteria

The image result page provides the approved focused toolbar, every scoped annotation and structural tool behaves as specified, objects remain editable, undo/redo/reset are reliable, edited Download preserves the original image format, Copy Image writes a PNG or gives an actionable fallback, very tall images use bounded preview rendering, resources are cleaned up, PDFs remain unchanged, and the complete existing regression suite passes.
