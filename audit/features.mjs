// audit/features.mjs — the HAND-CURATED half of the audit matrix.
//
// Division of labor (audit governance): version numbers are MECHANICAL and
// come from @mdn/browser-compat-data via gen-data.mjs (the pinned BCD
// version in package.json is the audit's data snapshot); humans curate only
// what machines cannot know — which BCD key each usage maps to, the tier,
// the hazard grade, the interop notes, fleet-reality guidance, and usage
// citations. If you are editing a version number in this file, you are in
// the wrong file.
//
// grade: 'y' supported | 'a' supported-with-interop-caveat | 'r' recent —
// check fleet | 'n' unsupported. `grade` sets the default for all cells;
// `gradeOverrides` adjusts per browser (BCD still supplies the version).

export const BROWSER_COLUMNS = [
  ['chrome', 'Chrome'],
  ['edge', 'Edge'],
  ['firefox', 'Firefox'],
  ['safari', 'Safari'],
  ['safari_ios', 'iOS Safari'],
];

export const FEATURES = [
  {
    id: 'canvas-2d-text',
    painters: ['2d','gl','gpu'],
    name: 'Canvas 2D text (fillText / fillRect / setTransform)',
    tier: 'A',
    bcdKey: 'api.CanvasRenderingContext2D.fillText',
    caniuse: 'https://caniuse.com/canvas-text',
    baseline: 'Widely available',
    grade: 'y',
    interop: null,
    fleet: null,
    usage: ['opentui-browser/src/canvas-painter.ts', 'canvas-gl-painter.ts (atlas)', 'canvas-gpu-painter.ts (atlas)'],
  },
  {
    id: 'canvas-textbaseline-top',
    painters: ['2d','gl','gpu'],
    name: "textBaseline: 'top' (anchor-relative glyph placement)",
    tier: 'A',
    bcdKey: 'api.CanvasRenderingContext2D.textBaseline',
    caniuse: 'https://caniuse.com/mdn-api_canvasrenderingcontext2d_textbaseline',
    baseline: 'Widely available',
    grade: 'a',
    interop:
      "Universally 'supported', divergently IMPLEMENTED: the anchor→alphabetic-baseline distance derives from font ascent metrics the spec does not pin to specific font tables, so identical (font, size, y) places glyphs at different heights per engine. Any absolute offset from the 'top' anchor (underlines, strikes, vertical centering) is engine-dependent. WPT interop#159 / interop#427 (declined 2023 & 2024), whatwg/html#6731.",
    fleet: 'Affects 100% of WebKit traffic — on iOS that is every browser (see the engine-mandate note).',
    usage: ['all three painters set it for measurement and atlas/main-canvas drawing'],
  },
  {
    id: 'textmetrics-actual',
    painters: ['2d','gl','gpu'],
    name: 'TextMetrics actualBoundingBox{Ascent,Descent,Left,Right}',
    tier: 'A',
    bcdKey: 'api.TextMetrics.actualBoundingBoxAscent',
    caniuse: 'https://caniuse.com/mdn-api_textmetrics_actualboundingboxascent',
    baseline: 'Widely available',
    grade: 'y',
    interop:
      'Values are per-engine rasterizer truth — that is their value: they describe what THIS engine will draw, with ±1px rounding variance across engines (Chrome rounds nearest, Firefox rounds up; Mozilla bug 1801198). Use for self-calibration, never for cross-engine pixel identity.',
    fleet: null,
    usage: ['measureCell() self-calibration in all painters (remediation seam for F1/F2)'],
  },
  {
    id: 'textmetrics-font',
    painters: ['2d','gl','gpu'],
    name: 'TextMetrics fontBoundingBox{Ascent,Descent} — deliberately unused',
    tier: 'A',
    bcdKey: 'api.TextMetrics.fontBoundingBoxAscent',
    caniuse: 'https://caniuse.com/mdn-api_textmetrics_fontboundingboxascent',
    baseline: 'Widely available (since 2023-08)',
    grade: 'a',
    interop:
      'The poster child of supported-but-not-interoperable: three engines return three different value sets for the same font (WPT interop#427: "you have to pick one browser to display it right"). Policy: do not adopt for layout math; prefer actualBoundingBox self-calibration.',
    fleet: null,
    usage: ['none — listed because it is the tempting wrong tool for baseline math'],
  },
  {
    id: 'canvas-measuretext-width',
    painters: ['2d','gl','gpu'],
    name: 'measureText().width (cell-grid sizing)',
    tier: 'A',
    bcdKey: 'api.CanvasRenderingContext2D.measureText',
    caniuse: 'https://caniuse.com/canvas-text',
    baseline: 'Widely available',
    grade: 'a',
    interop:
      "Advance width of 'M' differs sub-pixel per engine/OS rasterizer, so rounded cell width — and column count at a given viewport — can differ by one across engines. fit() floors cols/rows, which contains but does not eliminate the divergence.",
    fleet: null,
    usage: ['canvas-painter.ts measureCell()', 'canvas-gl-painter.ts:193', 'canvas-gpu-painter.ts:219'],
  },
  {
    id: 'webgl2',
    painters: ['gl'],
    name: "WebGL2 ('webgl2' context, glyph-atlas instancing)",
    tier: 'A',
    bcdKey: 'api.WebGL2RenderingContext',
    caniuse: 'https://caniuse.com/webgl2',
    baseline: 'Widely available',
    grade: 'y',
    gradeOverrides: { safari: 'a', safari_ios: 'a' },
    interop:
      'Safari shipped WebGL2 only in 15 (2021) — older WebKit returns null from getContext. Context requests { alpha:false, antialias:false, premultipliedAlpha:false }: premultiplied-alpha handling and texImage2D-from-canvas color management have a history of WebKit-specific differences; verify visually on WebKit, do not assume.',
    fleet:
      'Pre-iOS-15 devices are the at-risk tail (2021 floor; small, shrinking). Check StatCounter iOS-version split at each audit before treating as zero.',
    usage: ['canvas-gl-painter.ts:122 (context)', ':225 (texImage2D from atlas canvas)'],
  },
  {
    id: 'webgpu',
    painters: ['gpu'],
    name: 'WebGPU (navigator.gpu, GPUCanvasContext)',
    tier: 'A',
    bcdKey: 'api.GPU',
    caniuse: 'https://caniuse.com/webgpu',
    baseline: 'Newly available',
    grade: 'r',
    gradeOverrides: { chrome: 'y', edge: 'y' },
    interop:
      'Chromium-stable since 113 (2023); recent everywhere else — Safari 26 (2025), Firefox 141+ (initially Windows-only). canvas-gpu-painter.ts:123 THROWS when navigator.gpu is absent — the embedder owns the gpu → gl → 2d fallback chain (finding F4).',
    fleet:
      'The sub-26 iOS tail is the at-risk fleet for any embedder defaulting to the GPU painter; measure with caniuse usage-relative mode before promoting this painter. Chromium-only fleets unaffected.',
    usage: ['canvas-gpu-painter.ts:123 (hard throw when unavailable)'],
  },
  {
    id: 'wasm-streaming',
    painters: ['lib'],
    name: 'WebAssembly.instantiateStreaming (+ ArrayBuffer fallback)',
    tier: 'A',
    bcdKey: 'webassembly.api.instantiateStreaming_static',
    caniuse: 'https://caniuse.com/wasm',
    baseline: 'Widely available',
    grade: 'y',
    interop:
      'instantiateStreaming requires the server to send application/wasm — historically the most common WASM breakage class. wasm.ts holds the correct pattern: streaming first, non-streaming instantiate fallback. Keep the fallback; hosting configs regress.',
    fleet: null,
    usage: ['opentui-browser/src/wasm.ts:82-87'],
  },
  {
    id: 'text-encoding',
    painters: ['lib'],
    name: 'TextEncoder / TextDecoder',
    tier: 'A',
    bcdKey: 'api.TextEncoder',
    caniuse: 'https://caniuse.com/textencoder',
    baseline: 'Widely available',
    grade: 'y',
    interop: null,
    fleet: null,
    usage: ['ansi.ts:10', 'buffer.ts:12', 'edit-buffer.ts:8'],
  },
  {
    id: 'device-pixel-ratio',
    painters: ['2d','gl','gpu'],
    name: 'window.devicePixelRatio (backing-store scaling)',
    tier: 'A',
    bcdKey: 'api.Window.devicePixelRatio',
    caniuse: 'https://caniuse.com/mdn-api_window_devicepixelratio',
    baseline: 'Widely available',
    grade: 'a',
    interop:
      'Universal API; the hazard is fractional DPR (browser zoom, Windows scale factors) interacting with per-engine rasterization. The 2D painter derives its transform from measured device pixels (setTransform(deviceW/cssW, …)) — the right shape; GL/GPU painters snapshot devicePixelRatio at init (finding F5).',
    fleet: null,
    usage: ['canvas-gl-painter.ts:121', 'canvas-gpu-painter.ts:121', 'canvas-painter.ts setViewport()'],
  },
  {
    id: 'canvas-colorspace',
    painters: ['2d','gl','gpu'],
    name: "Canvas colorSpace / display-P3 — unused, unmanaged",
    tier: 'A',
    bcdKey: 'api.HTMLCanvasElement.getContext.2d_context.options_colorSpace_parameter',
    caniuse: 'https://caniuse.com/mdn-api_htmlcanvaselement_getcontext_2d_context_colorspace',
    baseline: 'Widely available (2023+)',
    grade: 'a',
    interop:
      'The painters never pass colorSpace, so every canvas is sRGB — and on wide-gamut displays (all current iPhones, most Macs) the ENGINE decides how sRGB canvas content maps to the P3 panel. Color-critical output (brand colors, subtle fades) can render measurably differently per engine/OS. Recorded as an audited absence: revisit whenever color fidelity becomes a requirement.',
    fleet: 'Wide-gamut panels are the majority of Apple-device traffic.',
    usage: ['none — absence verified by identifier-level sweep (scan.mjs absence check)'],
  },
  {
    id: 'module-workers',
    painters: ['demo'],
    name: "Workers with { type: 'module' } (web-demo)",
    tier: 'B',
    bcdKey: 'api.Worker.Worker.ecmascript_modules',
    caniuse: 'https://caniuse.com/mdn-api_worker_worker_ecmascript_modules',
    baseline: 'Widely available (since 2023)',
    grade: 'y',
    gradeOverrides: { firefox: 'a' },
    interop: 'Firefox only since 114 (mid-2023) — old-ESR/derivative fleets still trip this. Demo-tier acceptable; needs a fallback if promoted to Tier A.',
    fleet: 'ESR stragglers only; negligible and shrinking.',
    usage: ['web-demo/src/routes/*.tsx (8 demo workers)'],
  },
  {
    id: 'resize-observer',
    painters: ['demo'],
    name: 'ResizeObserver (web-demo)',
    tier: 'B',
    bcdKey: 'api.ResizeObserver',
    caniuse: 'https://caniuse.com/resizeobserver',
    baseline: 'Widely available',
    grade: 'y',
    interop: null,
    fleet: null,
    usage: ['web-demo/src/demo-lib/variants.tsx'],
  },
  {
    id: 'dvh-units',
    painters: ['demo'],
    name: 'CSS dynamic viewport units (dvh/dvw) (web-demo)',
    tier: 'B',
    bcdKey: 'css.types.length.viewport_percentage_units_dynamic',
    caniuse: 'https://caniuse.com/viewport-unit-variants',
    baseline: 'Widely available',
    grade: 'y',
    gradeOverrides: { safari_ios: 'a' },
    interop:
      'Supported in all current engines; the behavioral variance (iOS URL-bar collapse timing changing when dv* values settle) is a device-class difference, not a support gap.',
    fleet: null,
    usage: ['web-demo styles'],
  },
  {
    id: 'tree-sitter-wasm',
    painters: ['lib'],
    name: 'tree-sitter WASM grammars over fetch + classic Worker (core lib)',
    tier: 'C',
    bcdKey: 'webassembly.api',
    caniuse: 'https://caniuse.com/wasm',
    baseline: 'Widely available',
    grade: 'y',
    interop: 'Classic Worker (no module type) — broad support; grammar downloads are cross-origin fetches with the usual CORS/MIME constraints.',
    fleet: null,
    usage: ['core/src/lib/tree-sitter/client.ts:107'],
  },
];

// DISPOSITIONS — every hazard row (grade 'a'/'r' anywhere) resolves to
// exactly one disposition, so a warning is never left dangling: either a
// fix is in flight, an issue draft exists in ./issues/, the policy row IS
// the mitigation, or the risk is accepted with reasons. gen-data merges
// this by feature id; painter-matrix renders it as the "resolution" column.
export const DISPOSITIONS = {
  'canvas-textbaseline-top': { kind: 'fix-in-flight', detail: 'washe/hack/08 (2D rules) + issues/05 (atlas parity) + issues/01 (invariant tests) + issues/04 (lint guard)', findings: ['F2', 'F3'] },
  'textmetrics-actual': { kind: 'mitigation-seam', detail: 'this API IS the remediation for F2/F3 — self-calibration source', findings: [] },
  'textmetrics-font': { kind: 'policy-guard', detail: 'do-not-adopt policy row; the listing is the mitigation', findings: [] },
  'canvas-measuretext-width': { kind: 'accepted-risk', detail: 'floored fit contains it; cross-engine layout identity must not be asserted (F4)', findings: ['F4'], signedOff: '2026-07-29 indexzero — "Risk 1 - accepted" (cure options judged worse than the drift)' },
  webgl2: { kind: 'issue-filed', detail: 'charlie.dev#447 (full GL parity gap memorialized) + issues/01 (WebKit smoke covers premultiplied-alpha/texImage2D verification)', findings: [] },
  webgpu: { kind: 'issue-filed', detail: 'charlie.dev#448 (GPU-specific parity deltas) + issues/03 (supportsPainter capability export)', findings: ['F5'] },
  'device-pixel-ratio': { kind: 'issue-drafted', detail: 'issues/06 (GL/GPU DPR re-measure); 2D painter already mitigates via measured setViewport', findings: ['F6'] },
  'canvas-colorspace': { kind: 'issue-filed', detail: 'charlie.dev#446 — measure sRGB-on-P3 divergence via painter swatch check, then decide display-p3 adoption (owner ruling 2026-07-29: not accepted as-is; tracked instead)', findings: [] },
  'module-workers': { kind: 'open-risk', detail: 'demo tier; fallback required only if promoted to Tier A', findings: [] },
  'dvh-units': { kind: 'open-risk', detail: 'device-class behavior, not a support gap', findings: [] },
};

// Notable ABSENCES — APIs verified NOT in use by the identifier-level sweep
// (scan.mjs absence check reports every mention including types/comments, so
// these claims rest on more than the usage regexes).
export const ABSENCES = [
  {
    id: 'offscreencanvas',
    name: 'OffscreenCanvas',
    note: 'Not used. Worker rendering snapshots the cell grid to the main thread instead. Adoption would move the floor to Safari 16.4 / Firefox 105 — a deliberate trade to re-evaluate each audit, not an accident.',
  },
  {
    id: 'fontface-ready',
    name: 'FontFace API / document.fonts.ready',
    note: 'Not used inside the library. measureCell() measures whatever font is active at construction; engines DIFFER in fallback-font metrics, so un-gated construction is differently wrong per engine (finding F6). The primary embedder gates fonts host-side before constructing the painter.',
  },
  {
    id: 'shared-array-buffer',
    name: 'SharedArrayBuffer / Atomics',
    note: 'Type-level references only (bun-ffi structs d.ts); no runtime use. Any future adoption drags in COOP/COEP cross-origin-isolation requirements.',
  },
];
