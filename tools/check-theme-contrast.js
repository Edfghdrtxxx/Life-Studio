#!/usr/bin/env node
/* check-theme-contrast.js — verify every named theme in css/style.css
   clears the WCAG contrast floors the design tokens promise.

   Parses the :root token block, the [data-theme="dark"] block and every
   [data-theme="…"] override in css/style.css, resolves var(--token)
   references, and measures sRGB relative-luminance ratios for the pairs
   the tokens guarantee:

     --ink           on --surface and --floor          >= 4.5 (aim 7)
     --ink-2         on --surface and --floor          >= 4.5
     --ink-3         on --surface                      >= 3.0 (aim 4.5)
     --accent-deep   on --surface                      >= 4.5
     --good/-bad/--platinum-deep/--amber
                     on own *-tint and on --surface    >= 4.5
     --accent        on --surface                      >= 3.0 (fills only)
     --on-accent     on --accent                       >= 4.5

   The six named themes (paper, sage, nordic, midnight, aurora, rose) are
   GATED: any miss exits nonzero. :root and dark are reference palettes
   printed for comparison; a known miss there is reported, not failed
   (e.g. white-on-coral --on-accent is a documented exception, 3.28:1).

   Usage:  node tools/check-theme-contrast.js
   Exit:   0 when every gated check passes, 1 otherwise. */

'use strict';

const fs = require('fs');
const path = require('path');

const CSS_PATH = path.join(__dirname, '..', 'css', 'style.css');

/* ---- parsing ---------------------------------------------------------- */

function parseBlocks(css) {
  // Find every rule whose selector list is exactly :root or
  // [data-theme="x"] (possibly comma-joined / :root[data-…]).
  const blocks = {}; // themeKey -> {token -> rawValue}
  const ruleRe = /(?:(?<=^)|(?<=\}))\s*([^{}]+)\{/g;
  let m;
  while ((m = ruleRe.exec(css))) {
    const sels = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const open = m.index + m[0].length;
    // body runs to the matching close brace (no nesting in token blocks);
    // comments are stripped first — inline notes like "/* = --line */"
    // would otherwise read as declarations.
    const close = css.indexOf('}', open);
    if (close === -1) break;
    const body = css.slice(open, close).replace(/\/\*[\s\S]*?\*\//g, '');
    for (let sel of sels.split(',')) {
      sel = sel.trim();
      let key = null;
      if (sel === ':root') key = 'root';
      else if (sel === ':root[data-theme="dark"]') key = null; // --ink-meta tweak; still fold into root map under its own key
      else {
        const dm = sel.match(/^\[data-theme="([a-z-]+)"\]$/);
        if (dm) key = dm[1];
        const rm = sel.match(/^:root\[data-theme="([a-z-]+)"\]$/);
        if (rm) key = rm[1];
      }
      if (!key) continue;
      const map = blocks[key] || (blocks[key] = {});
      const declRe = /(--[a-z0-9-]+)\s*:\s*([^;]+);/g;
      let d;
      while ((d = declRe.exec(body))) map[d[1]] = d[2].trim();
    }
    ruleRe.lastIndex = close + 1;
  }
  return blocks;
}

/* ---- colour math ------------------------------------------------------ */

function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function luminance(hex) {
  const lin = c => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(fg, bg) {
  const a = luminance(fg), b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/* ---- token resolution ------------------------------------------------- */

// Resolve a token to a hex colour within a theme block, chasing var()
// through the block then :root. Returns null for non-hex (rgba etc.).
function resolve(blocks, theme, token, seen) {
  const map = blocks[theme] || {};
  let raw = map[token];
  if (raw === undefined) raw = (blocks.root || {})[token];
  if (raw === undefined) return null;
  const vm = raw.match(/^var\((--[a-z0-9-]+)\)$/);
  if (vm) {
    seen = seen || new Set();
    if (seen.has(token)) return null;
    seen.add(token);
    return resolve(blocks, theme, vm[1], seen);
  }
  const hm = raw.match(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/);
  return hm ? '#' + hm[1].toLowerCase() : null;
}

/* ---- checks ------------------------------------------------------------ */

const PAIRS = [
  ['--ink', '--surface', 4.5],
  ['--ink', '--floor', 4.5],
  ['--ink-2', '--surface', 4.5],
  ['--ink-2', '--floor', 4.5],
  ['--ink-3', '--surface', 3.0],
  ['--accent-deep', '--surface', 4.5],
  ['--good', '--good-tint', 4.5],
  ['--good', '--surface', 4.5],
  ['--bad', '--bad-tint', 4.5],
  ['--bad', '--surface', 4.5],
  ['--platinum-deep', '--platinum-tint', 4.5],
  ['--platinum-deep', '--surface', 4.5],
  ['--amber', '--amber-tint', 4.5],
  ['--amber', '--surface', 4.5],
  ['--accent', '--surface', 3.0],
  ['--on-accent', '--accent', 4.5],
];

const TOKENS = [
  '--bg', '--floor', '--panel', '--surface', '--ivory',
  '--ink', '--ink-2', '--ink-3', '--line',
  '--accent', '--accent-deep', '--accent-tint', '--accent-track',
  '--good', '--good-tint', '--bad', '--bad-tint',
  '--bronze', '--silver', '--gold',
  '--platinum', '--platinum-tint', '--platinum-deep',
  '--amber', '--amber-tint',
  '--heat-0', '--heat-1', '--heat-2', '--heat-3', '--heat-4', '--heat-edge',
  '--on-accent', '--btn-primary-hover', '--scrim', '--shadow',
];

// Every palette that must exist, in display order; gated = exit-nonzero on miss.
const THEMES = [
  { key: 'root', name: 'cream (root)', gated: false },
  { key: 'dark', name: 'warm-dark', gated: false },
  { key: 'paper', name: 'paper', gated: true },
  { key: 'sage', name: 'sage', gated: true },
  { key: 'nordic', name: 'nordic', gated: true },
  { key: 'midnight', name: 'midnight', gated: true },
  { key: 'aurora', name: 'aurora', gated: true },
  { key: 'rose', name: 'rose', gated: true },
];

/* ---- run --------------------------------------------------------------- */

const css = fs.readFileSync(CSS_PATH, 'utf8');
const blocks = parseBlocks(css);

let failures = 0;
const problems = [];

for (const t of THEMES) {
  if (!blocks[t.key]) {
    problems.push(`MISSING THEME BLOCK: ${t.name} (${t.key === 'root' ? ':root' : `[data-theme="${t.key}"]`})`);
    if (t.gated) failures++;
    continue;
  }
  // Every gated theme must define the full token union itself.
  const map = blocks[t.key];
  const missing = TOKENS.filter(tok => map[tok] === undefined);
  if (missing.length) {
    problems.push(`${t.name}: missing tokens: ${missing.join(', ')}`);
    if (t.gated) failures += missing.length;
  }
}

/* ---- table ------------------------------------------------------------- */

const header = ['check'.padEnd(30), 'need'].concat(THEMES.map(t => t.name.padStart(11))).join('  ');
console.log(header);
console.log('-'.repeat(header.length));

for (const [fg, bg, need] of PAIRS) {
  const label = `${fg} on ${bg}`.padEnd(30);
  const cells = THEMES.map(t => {
    if (!blocks[t.key]) return '       —  ';
    const f = resolve(blocks, t.key, fg);
    const b = resolve(blocks, t.key, bg);
    if (!f || !b) {
      const tag = `${t.name}: ${fg} on ${bg} — unresolvable token (${!f ? fg : bg})`;
      problems.push(tag);
      if (t.gated) failures++;
      return '       ?  ';
    }
    const r = ratio(f, b);
    const ok = r >= need;
    if (!ok) {
      const tag = `${t.name}: ${fg} ${f} on ${bg} ${b} = ${r.toFixed(2)}:1 < ${need}:1`;
      if (t.gated) { problems.push(tag); failures++; }
      else problems.push(tag + ' [reference palette — reported only]');
    }
    return (ok ? '  ' : '! ') + r.toFixed(2).padStart(5) + '   ';
  });
  console.log(label + String(need).padStart(4) + '  ' + cells.join('  '));
}

console.log('-'.repeat(header.length));
if (problems.length) {
  console.log('Findings:');
  for (const p of problems) console.log('  ' + p);
}
if (failures) {
  console.error(`\n${failures} gated contrast check(s) FAILED.`);
  process.exit(1);
}
console.log('\nAll gated theme contrast checks passed. (! = reference-palette miss, reported only)');
