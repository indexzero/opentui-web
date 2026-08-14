#!/usr/bin/env node
// audit/bcd-find.mjs — search @mdn/browser-compat-data for keys matching a
// substring (case-insensitive). The companion to gen-data.mjs's fail-loud
// resolver: when a key errors, find its new home with this.
//
// Usage: node audit/bcd-find.mjs colorSpace [maxResults]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const bcd = JSON.parse(
  fs.readFileSync(path.join(HERE, 'node_modules/@mdn/browser-compat-data/data.json'), 'utf8'),
);

const needle = (process.argv[2] ?? '').toLowerCase();
const max = Number(process.argv[3] ?? 25);
if (!needle) {
  console.error('usage: node audit/bcd-find.mjs <substring> [maxResults]');
  process.exit(2);
}

const out = [];
function walk(node, prefix) {
  if (out.length >= max || typeof node !== 'object' || node === null) return;
  for (const k of Object.keys(node)) {
    if (k === '__compat' || k === '__meta') continue;
    const full = prefix ? `${prefix}.${k}` : k;
    if (k.toLowerCase().includes(needle)) out.push(full);
    if (out.length >= max) return;
    walk(node[k], full);
  }
}
walk(bcd, '');
console.log(out.length ? out.join('\n') : `(no keys matching "${needle}")`);
