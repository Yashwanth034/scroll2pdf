# Scroll2PDF Stage 5 Design: Difficult Real-World Pages

## Scope

Stage 5 improves Scrollable Area capture for chats, infinite feeds, dynamically growing containers, virtualized lists, changing scroll metrics, sticky app chrome, lazy media, and small layout changes. It preserves Full Page, Selected Area, ordinary Scrollable Area, Long Image, and A4 PDF behavior from Stages 1–4.

Stage 5 does not add automatic conversation capture, private application API access, hidden-state reconstruction, authentication automation, cross-origin frame capture, release packaging, branding work, or other Stage 6 behavior.

## User interaction

Scrollable Area retains explicit selection. Moving over a chat wrapper may resolve to a better underlying message scroller through the adapter registry. The overlay highlights the effective crop and labels it `WhatsApp Chat`, `Telegram Chat`, `Chat / scrollable area`, or the existing `Scrollable area`. Capture begins only after the user clicks the highlighted target.

When adapter confidence is insufficient, selection uses the existing generic manual candidate logic.

## Capability-based adapters

Adapters are isolated content-script modules. They may identify:

- applicability and confidence;
- an effective scroll element and stable content root;
- normal or reverse capture direction;
- lightweight conversation context identity;
- visible stable anchors;
- loading indicators and known history boundaries;
- likely virtualization;
- persistent header, composer, jump-button, or overlay hints.

Adapters never start capture, switch conversations, click content, send messages, inspect authentication data, call private APIs, or transmit DOM data. Adapter failures are contained and fall back to generic selection.

The registry evaluates a confidently matched site adapter first, then the generic chat adapter, then ordinary Scrollable Area selection.

### WhatsApp strategy

The WhatsApp adapter is restricted to `web.whatsapp.com`. It uses several structural signals rather than generated classes: meaningful overflow, repeated rendered message-like descendants, stable data/message attributes, semantic roles, active conversation-pane relationships, and nearby composer/header structure. URL recognition exists only inside the adapter.

### Telegram strategy

The Telegram adapter is restricted to `web.telegram.org` and supports both current WebA- and WebK-like layouts through multiple semantic/structural fallbacks. It does not depend on one permanent class name. Telegram officially ships more than one web client, so variant handling is required.

## Capture strategy selection

Ordinary containers remain on the verified top-to-bottom Stage 3 coordinator.

The difficult-page coordinator is enabled only when the chosen capabilities confidently require dynamic reverse traversal or virtualization-aware capture. A generic container is never treated as a bottom-anchored chat merely because it currently happens to be scrolled near its bottom.

## Frame-chain traversal

Dynamic chat frames form an ordered chain independent of raw `scrollTop`:

- Downward traversal appends frames.
- Upward traversal captures the current viewport before scrolling and prepends newly discovered older frames.
- Each frame retains traversal ordinal, direction, visible anchors, anchor displacement, requested and actual scroll position, settled dimensions, crop geometry, context identity, a visual fingerprint, and row samples.
- Final output order is the logical frame chain, normally oldest-to-newest.

No final bitmap is blindly reversed. The stitcher receives explicit logical order and adjacency metadata.

## Dynamic older-history loading

For a bottom-anchored chat:

1. Preserve original scroll position, visible anchor, context identity, and styles.
2. Capture the currently rendered newest band before it can be recycled.
3. Move upward by an overlapping viewport step.
4. Near the history boundary, observe mutations, loading state, dimensions, and anchors.
5. If content is prepended, use anchor viewport displacement and metric changes to measure progress despite application scroll anchoring.
6. Continue until an adapter reports a beginning marker, three bounded stable attempts find no new history, a safety limit is reached, the context changes, a view repeats after recovery, or the user cancels.

`scrollTop === 0` alone never proves history is complete.

Unknown-length progress uses messages such as `Loading older messages… 8 captured` and `Capturing chat… 12 frames` without an inaccurate denominator.

## Anchors and context identity

Anchor identity sources are preferred in this order:

1. stable DOM ID;
2. stable data/message/timestamp attribute;
3. stable accessible identity;
4. structural path within a rendered group;
5. a per-session WeakMap identity.

Message text is not the primary identity and is never sent or persisted as adapter telemetry.

Before a history load, the content script records one or more visible anchors and their viewport positions. After settling, the displacement of a matching anchor estimates inserted content and logical movement. Restoration first tries the original anchor and viewport Y, then safely falls back to the clamped original `scrollTop`.

Capture context combines origin, pathname, selected-scroller identity, and an adapter-provided structural conversation identity. A material change aborts with `The selected conversation changed during capture.`

## Virtualization handling

Virtualization is treated as a signal when child counts remain bounded while anchor identities change, nodes appear recycled, scroll metrics remain similar despite logical progress, or large movement occurs within a stable-size rendered window.

Already captured frame image data remains in the offscreen pipeline after the corresponding DOM nodes disappear. Logical anchor transitions and frame-chain order, rather than total `scrollHeight`, determine coverage.

A bounded fingerprint history detects repeated rendered states. A repeated state triggers one recovery sequence: extra settle, loading-state check, fresh metrics, and one small corrective scroll. Three repeated observations after recovery abort with `Scroll2PDF detected a repeating virtualized view.`

## Fingerprints and seam planning

At frame ingestion the offscreen document calculates a heavily downsampled grayscale fingerprint and horizontally sampled row signatures for the selected crop.

Coordinates and anchor movement remain authoritative when reliable. The row signatures are a secondary seam refinement:

1. derive predicted overlap from logical movement;
2. search a bounded vertical range around that overlap;
3. compare sampled rows from adjacent frame edges;
4. choose a substantially better match when one exists;
5. trim duplicate rows at that exact boundary.

Frames are never crossfaded or geometrically distorted.

## Sticky chrome, animation, and media

The content session classifies persistent app chrome separately from content-level sticky elements:

- selected scroller, messages, and media are never hidden;
- persistent headers, composers, jump buttons, and adapter-hinted controls are hidden for intermediate frames;
- a composer included in the crop is retained at most once at the natural newest edge;
- sticky date separators are captured once, while repeated pinned copies with the same stable identity are suppressed conservatively;
- every modified inline style or temporary attribute is restored exactly.

A uniquely scoped temporary stylesheet disables animations, transitions, smooth scrolling, and caret blinking inside the selected capture root. Relevant scroll ancestors also receive reversible `scroll-behavior: auto` overrides.

Visible incomplete images inside the crop receive a bounded wait. Failed or permanently incomplete media never blocks capture indefinitely.

## Geometry tolerance

The initial crop defines the normalized output width. Small position and size changes caused by loading bars or controls are accepted and clamped to a common safe crop. Changes beyond explicit absolute and relative tolerances abort with `The selected chat area changed too much during capture.`

Adapters may redirect a cosmetic wrapper to one actual scrolling descendant, but capture never recursively combines multiple independent scrollers.

## Cancellation and recovery

Cancellation is checked during selection, mutation/history waiting, media settling, scrolling, recovery, screenshot capture, stitching, and PDF generation. Cleanup disconnects observers, removes temporary CSS and attributes, restores styles and scroll/anchor position when possible, discards frames and partial PDFs, opens no result, and reports `Capture cancelled`.

Site-adapter exceptions do not bypass cleanup. When safe, detection falls back to generic behavior; capture-time context or reliability failures abort rather than producing a mixed or misleading result.

## Safety limits

- difficult capture duration: 10 minutes;
- dynamic or virtualized frames: 300;
- history-load attempts: 40;
- stable no-more-history retries: 3;
- mutation/history wait: 4 seconds per attempt;
- stable measurement interval: 200 ms with three stable checks;
- lazy-media wait: 1.5 seconds per frame;
- repeated viewport threshold: 3;
- corrective scroll attempts: 1;
- recent fingerprint history: 64;
- seam search: at most 160 CSS pixels around predicted overlap.

Existing screenshot-rate, canvas, pixel-area, and PDF-page limits remain.

## Tests

Dependency-free unit tests cover adapter confidence/fallback, scroller scoring, anchor identities and displacement, history settling, direction-independent frame ordering, virtualization signals, fingerprints, seam selection/fallback, repeated-state recovery, context changes, geometry normalization, limits, cancellation, and cleanup.

Rendered Chrome fixtures cover prepend history, virtualized history, sticky dates/header/composer, lazy media, small dynamic resizing, conversation navigation changes, substantial overlap seams, sanitized WhatsApp structure, and Telegram WebA/WebK-like structures.

Automated output analysis verifies oldest/newest markers, ordered message/color markers, excluded surrounding UI, non-repeated chrome, included bottoms, plausible dimensions, no repeating viewport loop, Long Image output, PDF structure/order, cancellation, restoration, and runtime exceptions. Every Stage 1–4 test remains green.

## Privacy and permissions

All inspection, anchors, screenshots, stitching, and PDF generation remain local. No chat text, DOM content, credentials, tokens, screenshots, or analytics are transmitted. Temporary capture data lives only through the existing result/download flow.

Stage 5 requires no new Chrome permission.
