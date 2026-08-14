#!/usr/bin/env node
// audit/summarize.mjs — roll up scan.mjs output (usage.json) into the
// per-package usage summary the report cites: total hits per API, hits in
// the production-critical opentui-browser package, and the first few
// citation sites for each.
//
// Usage:
//   node audit/summarize.mjs [usage.json] [--pkg packages/opentui-browser/] [--top 3]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const jsonPath = args[0] && !args[0].startsWith('--') ? args[0] : path.join(HERE, 'usage.json');
const pkgIx = args.indexOf('--pkg');
const PKG = pkgIx !== -1 ? args[pkgIx + 1] : 'packages/opentui-browser/';
const topIx = args.indexOf('--top');
const TOP = topIx !== -1 ? Number(args[topIx + 1]) : 3;

const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const data = raw.usage ?? raw; // scan.mjs emits { usage, absences } since the absence sweep landed

console.log(`=== API usage (total | in ${PKG}):`);
for (const api of Object.keys(data).sort()) {
  const hits = data[api];
  const inPkg = hits.filter((h) => h.file.startsWith(PKG));
  console.log(`${api.padEnd(34)} ${String(hits.length).padStart(4)} | ${String(inPkg.length).padStart(3)}`);
}

console.log(`\n=== ${PKG} citation sites (first ${TOP} per API):`);
for (const api of Object.keys(data).sort()) {
  const inPkg = data[api].filter((h) => h.file.startsWith(PKG));
  if (!inPkg.length) continue;
  console.log(`\n${api}:`);
  for (const h of inPkg.slice(0, TOP)) {
    console.log(`  ${h.file}:${h.line}  ${h.text.slice(0, 90)}`);
  }
}

if (raw.absences) {
  console.log('\n=== absence sweep (every mention incl. comments/types; 0 = no textual trace):');
  for (const id of Object.keys(raw.absences).length ? Object.keys(raw.absences) : []) {
    const hits = raw.absences[id];
    console.log(`\n${id}: ${hits.length} mention(s)`);
    for (const h of hits.slice(0, TOP)) console.log(`  ${h.file}:${h.line}  ${h.text.slice(0, 90)}`);
  }
}
