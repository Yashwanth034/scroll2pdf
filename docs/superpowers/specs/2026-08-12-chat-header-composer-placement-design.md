# Chat Header and Composer Placement Design

## Scope

Scrollable Area captures for adapter-detected chats must place persistent chat chrome exactly once:

- the upper channel/name header appears in the first captured frame;
- the lower Message/Broadcast composer appears in the final captured frame;
- neither element appears in intermediate frames.

This change does not alter Full Page, Selected Area, Screenshot, ordinary Scrollable Area panels, PDF pagination, permissions, or output quality.

## Cause

The supplied Telegram PDF shows the composer at the bottom of the first captured viewport and again at the true end. Telegram places this bar farther inside the selected region than the current 24 CSS pixel edge tolerance, so first-frame bottom-chrome suppression does not classify it as the composer. The final-frame restoration then correctly adds a second copy at the end.

## Design

For adapter-detected chats only, edge-bar discovery will inspect rendered points up to 40 CSS pixels from the selected region's top and bottom. The wider tolerance will not be applied to generic scrollable panels.

At capture preparation:

1. identify bottom chat chrome using geometry and rendered hit testing;
2. hide it before the first viewport screenshot;
3. retain its original inline visibility state for restoration.

Before every intermediate screenshot, discovery runs again so a React/SPA-rendered replacement composer is also hidden. Immediately before the final screenshot, the currently hidden bottom chrome is restored. The upper header remains visible for the first screenshot and is hidden for every subsequent screenshot. Normal success, failure, and cancellation cleanup continues to restore all changed styles.

Detection remains independent of text, language, generated class names, and Telegram-specific selectors, so the same rule applies to confidently detected Telegram, WhatsApp, and generic chat targets.

## Tests

Implementation will follow red-green-refactor:

- extend the unit fixture to model a composer 32–40 CSS pixels inside the chat edge and confirm the current code fails to classify it;
- verify the wider boundary is enabled only for detected chats;
- extend the rendered large-DOM fixture to require one upper header at the start and one lower composer at the end, with no middle copy;
- rerun all Stage 1–6, popup, result, and relevant browser-integration suites.

## Acceptance Criteria

- Upper header appears exactly once in the first captured frame.
- Message/Broadcast composer appears exactly once in the final captured frame.
- No header or composer copy appears between them.
- Ordinary non-chat scrollable panels retain their existing behavior.
- Page position and modified styles are restored after success, failure, or cancellation.
- No new permission, dependency, or unrelated production change is introduced.
