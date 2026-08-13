# Draggable Inline Text Editor Design

Date: 2026-08-13

## Goal

Allow users to reposition the inline text editor while creating or editing a text annotation, so the text can be placed precisely before it is committed.

## Scope

This change affects only image-result text editing. It does not change capture, stitching, PDF generation, other annotation tools, or exported image formats.

## Interaction

- The open inline text editor displays a clearly visible drag handle with an accessible name such as `Move text`.
- Pressing and dragging the handle moves the editor without interrupting typing, text selection, or the textarea's existing resize behavior.
- The editor remains within the current image document bounds.
- Creating new text stores the final dragged document coordinates when the text is committed.
- Reopening existing text allows both its content and position to be changed before committing.
- Committing edited text and its new position creates one history entry, so one Undo restores both the previous content and previous position.
- Pressing Escape cancels the open editor and preserves an existing annotation's original content and position. Empty new text remains cancelled.
- Blur and Ctrl/Cmd+Enter retain their current commit behavior.

## Implementation Boundaries

The result-page markup gains a small wrapper/handle for the existing textarea. The controller owns the pointer gesture, converts movement through the current display scale into document coordinates, clamps the proposed editor bounds to the document, and updates the stored draft coordinates. Pointer events from the handle do not propagate into the canvas annotation gesture handler.

The existing text-area editing behavior remains unchanged. On commit, the controller composes the existing immutable text-update and annotation-move operations before making a single session commit. No new editor document type or persistent state is introduced.

## Accessibility and Visual Feedback

- The handle is a real button or equivalently keyboard-focusable control with an accessible `Move text` label.
- Its cursor and focus styling communicate that it moves the editor.
- The textarea remains independently focusable after dragging.
- The handle is large enough to operate reliably without obscuring the editing area.

## Error and Boundary Handling

- Movement is clamped rather than rejected when the pointer travels outside the image.
- Pointer cancellation returns the editor to the position it had when that drag began.
- A lost pointer capture must end the drag cleanly without creating a canvas gesture.
- Disposing the editor removes all drag listeners and leaves no active pointer state.

## Testing

The result-page browser test will first reproduce the bug, then verify that:

1. a new open text editor moves when its handle is dragged;
2. the committed text annotation uses the dragged position;
3. reopened text can be moved and edited together;
4. one Undo restores both the prior text and position;
5. dragging the handle does not create or select another canvas annotation; and
6. the existing image-editor and result-page suites continue to pass.
