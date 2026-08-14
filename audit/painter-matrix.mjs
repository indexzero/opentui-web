#!/usr/bin/env node
// audit/painter-matrix.mjs — the painter-dimension view of the audit:
// which painters each audited API impacts, and the per-painter subset an
// embedder actually needs to read. Emits GitHub markdown (paste into
// BROWSER.AUDIT.md's "Painter impact" section after regeneration).
//
// The painters facet is curated in features.mjs ('2d' | 'gl' | 'gpu' —
// or 'lib' for painter-independent library surface, 'demo' for the
// web-demo tier); this script only re-shapes data.json.
//
// Usage: node audit/painter-matrix.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = JSON.parse(fs.readFileSync(path.join(HERE, 'data.json'), 'utf8'));

const COLS = [
  ['2d', 'Canvas2D'],
  ['gl', 'WebGL2'],
  ['gpu', 'WebGPU'],
  ['lib', 'painter-independent'],
  ['demo', 'demo tier'],
];

const GLYPH = { y: '✓', a: '⚠', r: '◷', n: '✗' };

function worstGrade(f) {
  const order = ['n', 'a', 'r', 'y'];
  return f.cells.map((c) => c.status).sort((x, y2) => order.indexOf(x) - order.indexOf(y2))[0];
}

const KIND_LABEL = {
  'fix-in-flight': 'fix in flight',
  'issue-drafted': 'issue drafted',
  'mitigation-seam': 'is the mitigation',
  'policy-guard': 'policy guard',
  // A risk is only "accepted" once the OWNER rules on it — the audit can
  // propose acceptance, never grant it. Rows carry this label until each
  // risk's outline has an explicit owner sign-off recorded in features.mjs
  // (kind: 'accepted-risk' with signedOff: '<date> <owner>').
  'open-risk': 'risk — owner ruling pending',
  'accepted-risk': 'accepted risk (owner signed off)',
  'issue-filed': 'issue filed',
};

function resolution(f) {
  const g = worstGrade(f);
  if (!f.disposition) return g === 'y' ? '—' : 'UNRESOLVED';
  const d = f.disposition;
  const findings = d.findings?.length ? ` (${d.findings.join(', ')})` : '';
  const drafts = [...(d.detail.match(/charlie\.dev#\d+/g) ?? []), ...(d.detail.match(/issues\/\d\d/g) ?? [])].join(', ');
  return `${KIND_LABEL[d.kind]}${findings}${drafts ? ` — ${drafts}` : ''}`;
}

console.log('| API | grade |' + COLS.map(([, l]) => ` ${l} |`).join('') + ' resolution |');
console.log('|---|---|' + COLS.map(() => '---|').join('') + '---|');
for (const f of DATA.features) {
  const cells = COLS.map(([k]) => (f.painters.includes(k) ? '●' : ' ')).map((v) => ` ${v} |`).join('');
  console.log(`| ${f.name.split('(')[0].trim()} | ${GLYPH[worstGrade(f)]} |${cells} ${resolution(f)} |`);
}

// A hazard row with no disposition is a build error of the audit itself.
const dangling = DATA.features.filter((f) => worstGrade(f) !== 'y' && !f.disposition);
if (dangling.length) {
  console.error(`\nERROR: hazard rows without dispositions: ${dangling.map((f) => f.id).join(', ')}`);
  process.exitCode = 1;
}

for (const [key, label] of COLS.slice(0, 3)) {
  const rows = DATA.features.filter((f) => f.painters.includes(key));
  const exclusive = rows.filter((f) => f.painters.length === 1);
  const hazards = rows.filter((f) => f.cells.some((c) => c.status === 'a' || c.status === 'r'));
  console.log(`\n**${label}-only embedder reads:** ${rows.length} rows (${exclusive.length} exclusive to it), of which ${hazards.length} carry hazards: ${hazards.map((f) => f.id).join(', ')}`);
}
