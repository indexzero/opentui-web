#!/usr/bin/env node
// audit/scan.mjs — enumerate browser-platform API usage across the source
// tree. The periodic browser-compat audit's first stage: every hit is a
// file:line fact the report can cite; the curated matrix in data.mjs then
// maps each API to its support/interop status.
//
// Usage:
//   node audit/scan.mjs [rootDir] [--json out.json]
// Defaults to scanning packages/*/src under the repo root.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.argv[2] && !process.argv[2].startsWith('--')
  ? path.resolve(process.argv[2])
  : path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// API surface → detection regexes. Grouped the way the report groups them.
// A hit is evidence of USE, not of correctness — the matrix layer carries
// the support/interop verdicts.
const PROBES = {
  'canvas-2d-context': /getContext\(\s*['"]2d['"]/,
  'canvas-2d-text': /\b(fillText|strokeText)\s*\(/,
  'canvas-2d-measuretext': /\bmeasureText\s*\(/,
  'canvas-2d-textbaseline': /\btextBaseline\b/,
  'canvas-2d-textmetrics-actual': /actualBoundingBox(Ascent|Descent|Left|Right)/,
  'canvas-2d-textmetrics-font': /fontBoundingBox(Ascent|Descent)/,
  'canvas-2d-transform': /\bsetTransform\s*\(/,
  'canvas-2d-fillrect': /\bfillRect\s*\(/,
  'canvas-2d-imagedata': /\b(putImageData|getImageData|createImageData|ImageData)\b/,
  'webgl-context': /getContext\(\s*['"]webgl2?['"]/,
  'webgl-api': /\b(createShader|shaderSource|compileShader|texImage2D|bufferData|drawArrays|drawElements|uniform[1-4][fi]v?)\b/,
  'webgpu': /\b(navigator\.gpu|GPUDevice|GPUCanvasContext|requestAdapter|getContext\(\s*['"]webgpu['"])/,
  'webassembly': /\b(WebAssembly\.(instantiate|instantiateStreaming|compile)|\.wasm\b)/,
  'worker': /\bnew\s+Worker\s*\(/,
  'worker-module': /new\s+Worker\s*\([^)]*type:\s*['"]module['"]/s,
  'offscreencanvas': /\bOffscreenCanvas\b|transferControlToOffscreen/,
  'shared-array-buffer': /\bSharedArrayBuffer\b|\bAtomics\./,
  'device-pixel-ratio': /devicePixelRatio/,
  'raf': /\brequestAnimationFrame\s*\(/,
  'resize-observer': /\bResizeObserver\b/,
  'intersection-observer': /\bIntersectionObserver\b/,
  'font-face-api': /\b(FontFace|document\.fonts|fonts\.ready|fonts\.load)\b/,
  'performance-now': /\bperformance\.now\s*\(/,
  'structured-clone': /\bstructuredClone\s*\(/,
  'text-encoding': /\bText(Encoder|Decoder)\b/,
  'match-media': /\bmatchMedia\s*\(/,
  'pointer-events': /\bon?pointer(down|up|move|cancel)\b|PointerEvent/,
  'touch-events': /\bon?touch(start|end|move|cancel)\b|TouchEvent/,
  'clipboard': /navigator\.clipboard|ClipboardEvent/,
  'visual-viewport': /\bvisualViewport\b/,
  'css-dvh-dvw': /\b\d+dv[hw]\b|100dvh|100dvw/,
  'storage': /\b(localStorage|sessionStorage|indexedDB)\b/,
  'url-history': /\b(history\.(push|replace)State|popstate)\b/,
  'canvas-colorspace': /colorSpace\s*[:=]|display-p3/,
  'css-supports': /@supports\b/,
  'css-env-safe-area': /env\(\s*safe-area-inset/,
  'css-color-fn': /color\(\s*display-p3/,
};

// ABSENCE PROBES — identifier-level sweep for APIs the audit CLAIMS are
// unused. Unlike PROBES (which skip comments and demand usage shapes),
// these count EVERY mention — comments, types, strings — because a claimed
// absence must survive the strictest search we can run. Epistemics: a zero
// here is still only as strong as this list; regex scanning proves
// presence, never absence. See README "What the scanner can and cannot
// prove".
const ABSENCE_PROBES = {
  offscreencanvas: /OffscreenCanvas|transferControlToOffscreen/,
  'fontface-ready': /FontFace|document\.fonts|fonts\.ready|fonts\.load\b/,
  'shared-array-buffer': /SharedArrayBuffer|Atomics\./,
  'canvas-colorspace': /colorSpace|display-p3/,
};

const EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.css', '.html']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-canvas', '.git', 'zig-out', 'test-fixtures']);

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(path.join(dir, e.name));
    } else if (EXT.has(path.extname(e.name))) {
      yield path.join(dir, e.name);
    }
  }
}

const results = {};
const pkgs = path.join(ROOT, 'packages');
const scanRoot = fs.existsSync(pkgs) ? pkgs : ROOT;
for (const file of walk(scanRoot)) {
  const rel = path.relative(ROOT, file);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return; // comments cite APIs; usage is code
    for (const [api, re] of Object.entries(PROBES)) {
      if (re.test(line)) {
        (results[api] ??= []).push({ file: rel, line: i + 1, text: line.trim().slice(0, 120) });
      }
    }
  });
}

// Absence sweep: every mention, including comments/types/strings.
const absences = {};
for (const file of walk(scanRoot)) {
  const rel = path.relative(ROOT, file);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const [id, re] of Object.entries(ABSENCE_PROBES)) {
      if (re.test(line)) {
        (absences[id] ??= []).push({ file: rel, line: i + 1, text: line.trim().slice(0, 120) });
      }
    }
  });
}

const jsonIx = process.argv.indexOf('--json');
if (jsonIx !== -1 && process.argv[jsonIx + 1]) {
  fs.writeFileSync(process.argv[jsonIx + 1], JSON.stringify({ usage: results, absences }, null, 2));
}

console.log('\n== absence sweep (EVERY mention incl. comments/types; zero = no textual trace) ==');
for (const id of Object.keys(ABSENCE_PROBES)) {
  const hits = absences[id] ?? [];
  console.log(`  ${id.padEnd(24)} ${hits.length} mention(s)`);
  for (const h of hits.slice(0, 3)) console.log(`      ${h.file}:${h.line}  ${h.text.slice(0, 80)}`);
}

for (const [api, hits] of Object.entries(results).sort()) {
  console.log(`\n## ${api} (${hits.length})`);
  for (const h of hits.slice(0, 8)) console.log(`  ${h.file}:${h.line}  ${h.text}`);
  if (hits.length > 8) console.log(`  … ${hits.length - 8} more`);
}
console.log(`\nAPIs in use: ${Object.keys(results).length}/${Object.keys(PROBES).length} probed`);
