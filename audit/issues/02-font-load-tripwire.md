Title: feat(browser): font-load tripwire + opt-in re-measure hook

From the 2026-07-28 browser-compat audit (`audit/BROWSER.AUDIT.md`, finding
**F7**).

`measureCell()` measures whatever font is active at construction. Before
the embedder's webfont loads, engines measure *different fallback fonts* —
wrong cell size and wrong baseline, differently wrong per engine, silently.

1. **Tripwire.** At `measureCell()`, when `document.fonts?.check(font)` is
   available and returns false, `console.warn` once — turning a silent
   cross-engine drift into a visible embedder bug.
2. **Hook.** Opt-in `document.fonts` `loadingdone` re-measure, so the
   "re-measure on font swap" contract has a paved implementation instead of
   prose.
3. **Test.** Construct a painter before a `FontFace` resolves; assert the
   warn fires; resolve the font; assert the hook re-measures.
