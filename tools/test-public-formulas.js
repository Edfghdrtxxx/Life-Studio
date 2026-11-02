#!/usr/bin/env node
/* Public supplemental formula cards in js/data-formulas.js.
   Rewritten for the 2026-10-14 Recall curation (deck cut from 525 to about 300
   cards; see 99_System/Handoff documents/recall-deck-curation-2026-10-14/).
   Locks the card-wording rules from AGENTS.md on every public card: required
   fields, valid topic, supp ids carry eq 'supp', recall-list markup and item
   count, no math written as plain text, no reference to another card, KaTeX on
   every front, back, and note. Also locks the curated id set: the removed ids
   stay gone and the added ids stay present.
   Run: node tools/test-public-formulas.js */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.resolve(__dirname, '..');
var passed = 0;
var failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log('  ok  — ' + msg);
  } else {
    failed++;
    console.log('  FAIL — ' + msg);
  }
}

function load(files) {
  var window = { PGRE: {} };
  var sandbox = { window: window, PGRE: window.PGRE, console: console };
  vm.createContext(sandbox);
  files.forEach(function (rel) {
    vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
  });
  return sandbox.window.PGRE;
}

var PGRE = load(['js/data-topics.js', 'js/data-formulas.js']);
var cards = PGRE.FORMULAS;
var topics = {};
PGRE.TOPICS.forEach(function (t) { topics[t.id] = true; });

/* Removed in the 2026-10-14 curation (merged into a surviving card or dropped
   as low-yield). Re-adding one should be a deliberate decision. */
var REMOVED = [
  'supp-impedance',
  'supp-reactance',
  'supp-reactance-LC',
  'supp-ac-reflection',
  'supp-wave-travel',
  'supp-pec-em',
  'supp-torque-cross',
  'supp-discrete-physical-pendulum',
  'supp-pendulum-mass-shift-shortcut',
  'supp-qm-length-scales',
  'supp-driven-response',
  'supp-material-aux-fields',
  'supp-capacitor-energy-halving',
  'supp-lorentz-fields',
  'supp-max-power-match',
  'supp-equipartition',
  'supp-qm-probability-current',
  'supp-adiabatic-condition',
  'supp-band-mass',
  'supp-scattering-rate',
  'supp-maxwell-speeds',
  'supp-relativistic-velocity-addition',
  'supp-relativistic-doppler',
  'supp-hamilton-principle',
  'supp-magnetic-dipole-far-field',
  'supp-loop-axis-field',
  'supp-parallel-plate-field',
  /* 2026-10-21: merged into supp-counting-distributions. */
  'supp-binomial-counting',
  'supp-poisson-distribution',
  'supp-gaussian-distribution'
];
/* Added in the 2026-10-14 curation. */
var ADDED = [
  'supp-rolling-incline',
  'supp-invariant-mass',
  'supp-cl-switch-limits',
  'supp-lenz-law',
  'supp-sphere-inside-field',
  'supp-rc-filters',
  'supp-laser-operation',
  'supp-motional-emf',
  'supp-scintillation-detector',
  'supp-infinite-well-centered',
  'supp-hydrogen-series',
  'supp-hydrogen-line-1240',
  'supp-two-electron-exchange',
  'supp-spin-half-properties',
  'supp-spin-measurement',
  'supp-stern-gerlach',
  'supp-delta-well-bound',
  'supp-tunneling-scaling',
  'supp-beta-q-value',
  'supp-free-expansion',
  'supp-adiabatic-temperature',
  'supp-cycle-area',
  'supp-decay-bookkeeping',
  'supp-total-internal-reflection',
  'supp-reservoir-entropy',
  'supp-two-level-populations',
  'supp-battery-internal-resistance',
  'supp-kirchhoff-rules',
  'supp-impulse-power',
  'supp-rutherford-scattering',
  /* 2026-10-21 merge of the three counting distributions. */
  'supp-counting-distributions',
  /* 2026-10-27 the table of information gives eps0 but not k. */
  'supp-coulomb-constant',
  /* 2026-10-27 curl components after a vector-potential sign miss. */
  'supp-curl-components',
  /* 2026-10-27 graphene miss: dispersion relations as one list. */
  'supp-dispersion-relations',
  /* 2026-10-27 neutron EDM debrief: P, T and C sign table. */
  'supp-p-t-c-transformations'
];

var byId = {};
var seen = {};
cards.forEach(function (c) {
  if (!c || !c.id) { assert(false, 'every card has an id'); return; }
  assert(!seen[c.id], 'id is unique: ' + c.id);
  seen[c.id] = true;
  byId[c.id] = c;
  ['topic', 'tag', 'name', 'front', 'back'].forEach(function (k) {
    assert(typeof c[k] === 'string' && c[k].length > 0, c.id + ' has ' + k);
  });
  assert(topics[c.topic], c.id + ' topic ' + c.topic + ' is a PGRE.TOPICS id');
  if (String(c.id).indexOf('supp-') === 0) assert(c.eq === 'supp', c.id + ' has eq supp');
});

REMOVED.forEach(function (id) { assert(!byId[id], 'removed id stays absent: ' + id); });
ADDED.forEach(function (id) { assert(!!byId[id], 'added id is present: ' + id); });

/* Recall lists: one <ul class="recall-list">, front ends with (N), N = items. */
cards.forEach(function (c) {
  if (c.kind !== 'list') {
    assert(String(c.back).indexOf('<ul class="recall-list">') !== 0, c.id + ' is not a list, so its back is not a recall list');
    return;
  }
  var lis = (String(c.back).match(/<li>/g) || []).length;
  assert(String(c.back).indexOf('<ul class="recall-list">') === 0, c.id + ' back starts with the recall-list markup');
  var count = /\((\d+)\)\s*(<ul[\s\S]*)?$/.exec(c.front);
  assert(!!count && Number(count[1]) === lis, c.id + ' front count matches its ' + lis + ' list items');
});

/* Text outside $...$ (tags stripped): no math written as plain text, no raw < or >,
   and no reference to another card (AGENTS.md "Recall card wording" rule 1). */
function outsideMath(s) {
  return String(s).replace(/<[^>]*>/g, ' ').replace(/\$\$[\s\S]*?\$\$/g, ' ').replace(/\$(?:\\\$|[^$])*?\$/g, ' ');
}
var PLAIN = /\b(omega|epsilon(_0)?|theta|lambda|sigma|hbar|Psi|psi|alpha|beta|gamma|Delta|delta|mu_0|rho|kappa|tau|phi|nabla|sqrt)\b|[A-Za-z]_[A-Za-z0-9{]|[A-Za-z0-9)]\^[A-Za-z0-9{(-]|\b[A-Za-z]-hat\b/;
var XREF = /\b(cpg[fl]-\d|supp-[a-z])|\b(another|other|above|previous|next|sibling|companion) cards?\b|\bon card\b|\bas above\b/i;
cards.forEach(function (c) {
  ['front', 'back', 'note'].forEach(function (k) {
    if (!c[k]) return;
    var txt = outsideMath(c[k]);
    var pm = txt.match(PLAIN);
    assert(!pm, c.id + ' ' + k + ' has no plain-text math' + (pm ? ' (found "' + pm[0] + '")' : ''));
    assert(!/[<>]/.test(txt), c.id + ' ' + k + ' has no raw < or > outside math');
    var xm = String(c[k]).replace(/\$[^$]*\$/g, ' ').match(XREF);
    assert(!xm, c.id + ' ' + k + ' does not refer to another card' + (xm ? ' (found "' + xm[0] + '")' : ''));
  });
});

/* Two fixes from the curation that must not regress. */
var hz = byId['supp-hydrogenic-z-scaling'];
assert(!!hz && /Z\^2/.test(hz.back) && /\\mu/.test(hz.back),
  'the hydrogenic scaling card states the mu Z^2 energy scaling');
var series = byId['supp-hydrogen-series'];
assert(!!series && /Lyman/.test(series.back) && /Balmer/.test(series.back) && /Paschen/.test(series.back),
  'the hydrogen series card names Lyman, Balmer, and Paschen');

var katex = require(path.join(root, 'vendor/katex/katex.min.js'));
var DELIMS = [['$$', '$$', true], ['\\[', '\\]', true], ['$', '$', false], ['\\(', '\\)', false]];

function extractMath(text) {
  var out = [];
  var i = 0;
  var n = text.length;
  while (i < n) {
    var best = -1;
    var bestIdx = -1;
    for (var d = 0; d < DELIMS.length; d++) {
      var idx = text.indexOf(DELIMS[d][0], i);
      if (idx === -1) continue;
      if (bestIdx === -1 || idx < bestIdx ||
          (idx === bestIdx && DELIMS[d][0].length > DELIMS[best][0].length)) {
        best = d;
        bestIdx = idx;
      }
    }
    if (best === -1) break;
    var left = DELIMS[best][0];
    var right = DELIMS[best][1];
    var end = text.indexOf(right, bestIdx + left.length);
    if (end === -1) return null;
    out.push({ tex: text.slice(bestIdx + left.length, end), display: DELIMS[best][2] });
    i = end + right.length;
  }
  return out;
}


var katexFail = 0;
cards.forEach(function (c) {
  ['front', 'back', 'note'].forEach(function (k) {
    if (!c[k]) return;
    var segs = extractMath(String(c[k]));
    if (!segs) {
      katexFail++;
      console.log('  FAIL — ' + c.id + ' ' + k + ' has an unclosed math delimiter');
      return;
    }
    segs.forEach(function (seg) {
      try {
        katex.renderToString(seg.tex, { throwOnError: true, displayMode: seg.display });
      } catch (err) {
        katexFail++;
        console.log('  FAIL — ' + c.id + ' ' + k + ': ' + String(err.message).split('\n')[0]);
      }
    });
  });
});
assert(katexFail === 0, 'every public formula math segment parses in KaTeX (' + katexFail + ' failures)');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed || katexFail ? 1 : 0);
