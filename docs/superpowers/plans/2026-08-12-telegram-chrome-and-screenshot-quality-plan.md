# Telegram Chrome and Screenshot Quality Implementation Plan

1. Add regressions for Telegram's stale capture mode and edge chrome located outside the bounded DOM sample; run them against current code and confirm the expected failures.
2. Add regressions for Screenshot UI naming/control visibility and background configuration normalization; run them and confirm the expected failures.
3. Implement geometry-based edge discovery and align Telegram with the ordinary downward capture path, preserving existing classification and restoration behavior.
4. Rename Screenshot UI/result metadata and normalize Screenshot captures to the existing lossless High/PNG path.
5. Run the focused tests, all Stage 1-6 suites, popup/result E2E, and the existing rendered chrome-dedup browser integration where the local browser permits it.

No other production modules or behaviors are in scope.
