# Popup Settings Label Alignment Design

## Scope

Fix only the visual placement of the `Quality` and `A4 Orientation` labels in the popup. Both labels must sit inside their respective settings cards at the top-left, with the segmented controls aligned beneath them.

Capture behavior, form values, radio semantics, keyboard behavior, colors, typography, popup width, and every non-settings section remain unchanged.

## Cause

The settings cards are semantic `fieldset` elements with native `legend` children. Chromium lays a legend across the fieldset's top border by default. The current full-width legend rule therefore makes each label look detached from or outside its card even though the two-column grid itself fits within the popup.

## Design

Retain the existing fieldset and legend markup. Make each compact settings card a positioned container with enough top padding to reserve a label row. Position its legend inside that reserved row using the same horizontal inset as the card content. The compact segmented control remains in normal flow beneath the label.

Both cards keep equal heights, the existing two-column grid, current colors, border radius, typography, and selected-state styling. No responsive breakpoint or new visual system is introduced.

## Tests

Implementation will follow red-green-refactor. The popup browser test will verify at the real 384 CSS pixel popup width that:

- both label rectangles are fully contained by their card rectangles;
- the labels share the same vertical position;
- each segmented control starts below its label without overlap;
- the two settings cards remain aligned and contained within the popup;
- the popup has no horizontal overflow or runtime exception.

The existing Stage 1–6, popup, and result tests will be rerun.

## Acceptance Criteria

- `Quality` appears inside the left card at its top-left.
- `A4 Orientation` appears inside the right card at its top-left.
- Both controls align beneath the labels.
- Nothing clips or overflows at 384 CSS pixels.
- No HTML semantics, JavaScript behavior, capture feature, permission, or dependency changes.
