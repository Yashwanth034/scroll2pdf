# Chat Header and Composer Placement Implementation Plan

1. Extend unit and rendered fixtures from a 16 px inset to a 36 px inset and assert that default non-chat classification remains unchanged while chat classification finds the bars; run them and confirm failure.
2. Add a chat-only edge tolerance option to rendered hit discovery and edge classification.
3. Pass that option only for adapter-detected chats and suppress initial bottom chrome based on the active interactive flow rather than stale legacy adapter metadata.
4. Run focused unit and rendered dedup tests, then all Stage 1–6, popup, result, and production browser-integration suites.

No output, pagination, permission, Screenshot, Full Page, Selected Area, or ordinary panel behavior is in scope.
