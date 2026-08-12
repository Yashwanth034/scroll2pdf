# Popup Settings Label Alignment Implementation Plan

1. Add real-browser geometry assertions for contained legends, aligned cards, controls below labels, and no overflow; run them against the current popup and confirm the containment failure.
2. Make only the compact settings cards positioned containers, reserve an internal label row, and position each legend inside it.
3. Rerun popup E2E, inspect the generated screenshot, then run all Stage 1–6 and result regressions.

No HTML, JavaScript, capture behavior, permissions, or non-settings styling is in scope.
