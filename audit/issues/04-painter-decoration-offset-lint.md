Title: chore(browser): lint painters — ban numeric literals in decoration offsets

From the 2026-07-28 browser-compat audit (`audit/BROWSER.AUDIT.md` —
prevention for finding **F2**'s class).

F2 (underline at `fontSize − 4`) and its atlas sibling F3 share one root
cause: absolute offset constants measured from the `textBaseline:'top'`
anchor, which are engine-dependent by construction — the anchor→baseline
distance is derived from font ascent metrics the spec does not pin down.

Add a lint rule scoped to the painter files: numeric literals are banned in
decoration-offset expressions; vertical placement must flow from
`measureCell()`-derived fields (`actualBoundingBox*` self-calibration, the
seam the audit's TextMetrics row designates).

One afternoon, works forever. The quarterly audit is a confession; this is
a control.
