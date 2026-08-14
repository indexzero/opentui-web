Title: test: engine-relative decoration invariants + non-golden WebKit smoke

From the 2026-07-28 browser-compat audit (`audit/BROWSER.AUDIT.md`, finding
**F1** — the causal finding: Chromium-only automated visual coverage).

Cross-engine pixel goldens are a maintenance tarpit (the grids legitimately
differ per engine — audit F4), so two complementary pieces:

1. **Invariant tests, engine-relative.** For each painter, draw
   underlined/struck text and assert — from the running engine's own
   `actualBoundingBox*` metrics — that the underline lands within
   `[baseline, baseline + 2]`, the strike within the x-height band, and no
   glyph clips at cell edges. These pass or fail identically in any engine
   because the oracle is the engine's own measurement, not pixel identity.
2. **WebKit smoke, explicitly non-golden.** Load each painter in Playwright
   `webkit`, screenshot, publish as artifacts for eyeball review on change.
   Never pixel-diffed — the point is a human seeing WebKit at all.

Together these make the audit's amber rows (supported-but-divergent APIs)
visible to automation for the first time.
