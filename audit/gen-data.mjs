#!/usr/bin/env node
// audit/gen-data.mjs — merge the hand-curated features (features.mjs) with
// MECHANICAL support versions from @mdn/browser-compat-data, emitting
// data.json for render-svg.mjs and the report. Version numbers are never
// hand-typed: the pinned BCD version in package.json is the audit's data
// snapshot, and bumping it IS the version-refresh step of the audit.
//
// Fails loud on a missing/renamed BCD key and prints sibling candidates so
// maintenance is a rename, not archaeology.
//
// Usage: node audit/gen-data.mjs   (writes audit/data.json)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER_COLUMNS, FEATURES, ABSENCES, DISPOSITIONS } from './features.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const bcd = JSON.parse(
  fs.readFileSync(path.join(HERE, 'node_modules/@mdn/browser-compat-data/data.json'), 'utf8'),
);

function resolve(key) {
  const parts = key.split('.');
  let node = bcd;
  for (let i = 0; i < parts.length; i++) {
    if (node[parts[i]] === undefined) {
      const siblings = Object.keys(node).filter((k) => k !== '__compat').slice(0, 30);
      throw new Error(
        `BCD key not found: ${key} (failed at "${parts[i]}").\n` +
        `Siblings at ${parts.slice(0, i).join('.') || '(root)'}: ${siblings.join(', ')}`,
      );
    }
    node = node[parts[i]];
  }
  if (!node.__compat) throw new Error(`BCD node has no __compat: ${key}`);
  return node.__compat;
}

function firstStable(support) {
  // BCD support entries may be an array (newest first) or a single object;
  // take the oldest entry that has a plain version_added and no flags.
  const entries = Array.isArray(support) ? support : [support];
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.flags || e.partial_implementation) continue;
    if (typeof e.version_added === 'string') return e.version_added.replace(/^[≤~]/, '≤');
    if (e.version_added === true) return 'yes';
  }
  // fall back to the newest entry's verdict
  const v = entries[0].version_added;
  return typeof v === 'string' ? v : v === true ? 'yes' : null;
}

const features = FEATURES.map((f) => {
  const compat = resolve(f.bcdKey);
  const cells = BROWSER_COLUMNS.map(([bcdName, label]) => {
    const support = compat.support[bcdName];
    const since = support ? firstStable(support) : null;
    const grade = since === null ? 'n' : (f.gradeOverrides?.[bcdName] ?? f.grade);
    return { b: label, status: grade, since: since ?? '—' };
  });
  return {
    id: f.id,
    name: f.name,
    tier: f.tier,
    painters: f.painters ?? [],
    disposition: DISPOSITIONS[f.id] ?? null,
    caniuse: f.caniuse,
    baseline: f.baseline,
    mdn: compat.mdn_url ?? null,
    interop: f.interop,
    fleet: f.fleet,
    usage: f.usage,
    cells,
  };
});

const out = {
  bcdVersion: bcd.__meta.version,
  features,
  absences: ABSENCES,
};
fs.writeFileSync(path.join(HERE, 'data.json'), JSON.stringify(out, null, 2));
console.log(`data.json: ${features.length} features from BCD ${bcd.__meta.version}`);
for (const f of features) {
  console.log(`  ${f.id.padEnd(28)} ${f.cells.map((c) => `${c.b}:${c.since}(${c.status})`).join('  ')}`);
}
