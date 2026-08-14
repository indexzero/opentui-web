# audit/ — the periodic browser-compatibility audit

This directory holds the recurring browser-compat audit of opentui-web:
an inventory of every browser-platform API the codebase touches, a
caniuse-style support matrix for each, and a findings list of potential
cross-engine defects. It exists because this library draws its entire UI
through canvas — a domain where the dangerous differences are not missing
APIs but **APIs that are supported everywhere and implemented
differently** (font metrics, baseline anchoring, alpha handling, color
management, fractional-DPR rasterization). Support tables alone
under-report that class, so the audit tracks *interop hazards* as
first-class rows, and states the structural fact that shapes priorities:
on iOS every browser is WebKit, so WebKit divergences are
population-shaped, not version-shaped.

**Last performed:** 2026-07-28, against `washe/hack/07` (`f432616`) — the
fully-patched tip that embedders vendor. Findings and matrices:
[BROWSER.AUDIT.md](./BROWSER.AUDIT.md).

## How it works

Four stages, each a durable script here:

1. **Scan** — [`scan.mjs`](./scan.mjs) walks `packages/*/src` and matches
   curated API-detection regexes, emitting every usage site as a
   `file:line` fact plus an **absence sweep** (`usage.json`). Evidence of
   *use*, deliberately dumb: a hit means a human looks.
2. **Summarize** — [`summarize.mjs`](./summarize.mjs) rolls `usage.json`
   up per package, foregrounding `packages/opentui-browser` (Tier A), and
   prints the absence-sweep evidence.
3. **Generate** — [`gen-data.mjs`](./gen-data.mjs) merges the
   hand-curated [`features.mjs`](./features.mjs) (tiers, hazard grades,
   interop notes, fleet guidance, BCD key mapping) with mechanical
   support versions from the **pinned `@mdn/browser-compat-data`**
   (see `package.json` — the pin is the audit's data snapshot; bumping it
   is the version-refresh step). Output: `data.json`. Version numbers are
   never hand-typed; if you are editing one by hand you are in the wrong
   file. When BCD renames a key, [`bcd-find.mjs`](./bcd-find.mjs) locates
   its new home.
4. **Facet** — [`painter-matrix.mjs`](./painter-matrix.mjs) re-shapes
   `data.json` along the painter dimension (Canvas2D / WebGL2 / WebGPU /
   painter-independent / demo), emitting the "Painter impact" table and
   per-embedder-profile quick reads. The facet itself is curated per
   feature in `features.mjs` (`painters:`).
5. **Render** — [`render-svg.mjs`](./render-svg.mjs) turns `data.json`
   into the grids embedded in the report (SVG files referenced by `<img>`
   — GitHub sanitizes raw inline `<svg>` but renders linked SVG files).
   Cells carry status glyphs (✓ ! ◷ ✗) so color is never the only
   carrier, alt text carries the full verdict, and the palette is chosen
   to survive GitHub light and dark themes.

## What the scanner can and cannot prove

Regex scanning proves **presence** (citable `file:line`), never
**absence** — aliasing, wrappers, and the WASM boundary are invisible to
it. Claimed absences rest on the stricter `ABSENCE_PROBES` sweep in
`scan.mjs` (every mention, all file kinds, comments and types included),
which is still only as strong as its probe list. If an absence claim ever
becomes load-bearing, the sound proof is compiling against a restricted
DOM lib subset — scripted work for a future audit.

## Re-running the audit

```sh
node audit/scan.mjs . --json audit/usage.json   # 1. inventory + absence sweep
node audit/summarize.mjs                        # 2. per-package rollup
npm --prefix audit install @mdn/browser-compat-data@latest  # 3a. refresh data snapshot
node audit/gen-data.mjs                         # 3b. regenerate matrix (fails loud on moved keys)
node audit/render-svg.mjs                       # 4. regenerate grids
# 5. review features.mjs hazard grades/notes; update BROWSER.AUDIT.md
#    findings against the severity rubric; re-date the header
```

Point the scanner at any checkout of the audited ref — audit the current
`washe/hack/NN` tip, not `main`: the tip is what ships.

**Drift guard (recommended CI wiring):** run stage 1 in CI and fail when
`usage.json` differs from the committed one — a new platform API in use
means the audit is stale, and the failure message should say exactly that.

## Reading the report

- **Tier A/B/C** — production-critical / demo-site / core-reachable.
  Version floors only matter at the tier that ships.
- **Amber cells ("caveat")** — supported at that version *and* carrying an
  interop hazard described in the feature's note. These rows are the
  audit's payload: exactly the defects a Chromium-only rig cannot see
  (finding F1).
- **Baseline lines** — each feature also carries its
  [Baseline](https://web-platform-dx.github.io/web-features/) status and a
  caniuse link as the standardized second signal beside the audit's own
  hazard grading.
- **Fleet lines** — versions are not users; amber/recent rows say which
  population is at risk and how to measure it at audit time.
- **Severity rubric** — findings are graded tier-reach × visual-severity ×
  affected-fleet, and the rubric is in the report so the next auditor
  inherits calibration, not conclusions.
- **Notable absences** — APIs verified unused by the identifier-level
  sweep, recorded so the choice stays deliberate.

## Cadence

Run it when: a painter gains a new platform API; a browser ships a major
engine change; an embedder reports an engine-specific rendering defect;
the CI drift guard fires; or two quarters have passed — whichever comes
first.
