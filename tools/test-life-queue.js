#!/usr/bin/env node
/* Life Studio daily queue: one mixed batch, filtered at fill time.
   suggestFormulaDay(deck, {subject}) narrows BOTH pools (due + fresh) to the
   chosen subject, and fresh picks stop at settings.newCardsPerDay minus the
   day's already-committed introductions. Run: node tools/test-life-queue.js */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.resolve(__dirname, '..');
function src(name) { return fs.readFileSync(path.join(root, 'js', name), 'utf8'); }

var passed = 0;
var failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ok  — ' + msg); }
  else { failed++; console.log('  FAIL — ' + msg); }
}

var disk = {};
var sandbox = {
  console: console,
  localStorage: {
    getItem: function (k) { return k in disk ? disk[k] : null; },
    setItem: function (k, v) { disk[k] = String(v); },
    removeItem: function (k) { delete disk[k]; }
  },
  window: { addEventListener: function () {}, indexedDB: null },
  setTimeout: setTimeout,
  Promise: Promise
};
sandbox.window.PGRE = {};
sandbox.PGRE = sandbox.window.PGRE;
vm.createContext(sandbox);
vm.runInContext(src('data-themes.js'), sandbox);
vm.runInContext(src('subjects.js'), sandbox);
vm.runInContext(src('store.js'), sandbox);
vm.runInContext(src('user-cards.js'), sandbox);
vm.runInContext(src('srs.js'), sandbox);
var PGRE = sandbox.PGRE;
var srs = PGRE.srs;

function today() { return srs.today(); }

PGRE.store.load();   // fresh defaults
var settings = PGRE.store.state.settings;
settings.formulaDailyTarget = 20;   // roomy target so room isn't the limiter
settings.newCardsPerDay = 10;

/* Deck: mixed subjects. Physics uses real deck ids; english/vocab user cards. */
var deck = [
  { id: 'cpgf-1.01', front: 'p1', back: 'a' },
  { id: 'cpgf-1.02', front: 'p2', back: 'a' },
  { id: 'supp-aa',   front: 'p3', back: 'a' },
  { id: 'user-english-1', subject: 'english', front: 'e1', back: 'a', kind: 'user' },
  { id: 'user-english-2', subject: 'english', front: 'e2', back: 'a', kind: 'user' },
  { id: 'user-vocab-1',   subject: 'vocab',   front: 'v1', back: 'a', kind: 'user' }
];

/* --- no subject option: the whole deck is eligible ------------------------ */
var all = srs.suggestFormulaDay(deck);
assert(all.newIds.length === 6, 'all subjects join the suggestion by default');
assert(all.newIds.indexOf('user-vocab-1') !== -1 && all.newIds.indexOf('cpgf-1.01') !== -1,
  'the suggestion mixes subjects');

/* --- subject filter --------------------------------------------------------- */
var eng = srs.suggestFormulaDay(deck, { subject: 'english' });
assert(eng.newIds.length === 2, 'subject filter keeps only that subject\'s fresh cards');
assert(eng.newIds.indexOf('user-english-1') !== -1 &&
       eng.newIds.indexOf('user-english-2') !== -1, 'the two english cards are picked');
assert(eng.newIds.indexOf('cpgf-1.01') === -1, 'physics fresh cards are excluded');

var phy = srs.suggestFormulaDay(deck, { subject: 'physics' });
assert(phy.newIds.length === 3, 'physics filter keeps the physics cards');
assert(phy.newIds.indexOf('user-english-1') === -1, 'english cards are excluded');

assert(srs.suggestFormulaDay(deck, { subject: 'all' }).newIds.length === 6,
  "'all' is the same as no filter");
assert(srs.suggestFormulaDay(deck, { subject: 'bogus' }).newIds.length === 6,
  'an unknown subject falls back to no filter (never an empty study)');

/* --- subject filter also narrows the due pool ------------------------------ */
var t = today();
PGRE.store.state.cards['cpgf-1.01'] = { ivl: 4, ease: 2.5, due: '2026-10-01',
                                        reps: 3, lapses: 0 };
PGRE.store.state.cards['user-english-1'] = { ivl: 4, ease: 2.5, due: '2026-10-01',
                                             reps: 3, lapses: 0 };
var engDue = srs.suggestFormulaDay(deck, { subject: 'english' });
assert(engDue.reviewIds.indexOf('user-english-1') !== -1,
  'a due english card lands in reviewIds');
assert(engDue.reviewIds.indexOf('cpgf-1.01') === -1,
  'a due physics card stays out under the english filter');

/* --- the daily-batch effect: chosen cards are not re-suggested ------------- */
var batch = { date: t, reviewIds: ['user-english-1'], newIds: ['user-english-2'], softIds: [] };
PGRE.store.state.formulaDay = batch;
var eng2 = srs.suggestFormulaDay(deck, { subject: 'english' });
assert(eng2.reviewIds.length === 0 && eng2.newIds.length === 0,
  'cards already in today\'s batch are not suggested again');
PGRE.store.state.formulaDay = null;

/* --- new-cards-per-day cap --------------------------------------------------- */
delete PGRE.store.state.cards['cpgf-1.01'];
delete PGRE.store.state.cards['user-english-1'];
settings.newCardsPerDay = 2;
var capped = srs.suggestFormulaDay(deck);
assert(capped.newIds.length === 2, 'fresh suggestions stop at newCardsPerDay');
settings.newCardsPerDay = 1;
var capped1 = srs.suggestFormulaDay(deck);
assert(capped1.newIds.length === 1, 'the cap follows the setting down');
settings.newCardsPerDay = 10;

/* --- committed introductions eat the cap ------------------------------------- */
/* A first review today (n:0 row) plus a batch newIds entry = 2 committed. */
PGRE.store.state.cardReviews = [
  { id: 'cpgf-1.01', d: t, n: 0, g: 4 },
  { id: 'cpgf-1.02', d: t, n: 1, g: 4 }   // n>0 does not count
];
PGRE.store.state.formulaDay = { date: t, reviewIds: [], newIds: ['supp-aa'], softIds: [] };
assert(srs.newCardsCommittedToday() === 2,
  'committed = today\'s first-reviews + batch newIds (deduped)');
settings.newCardsPerDay = 3;
var after = srs.suggestFormulaDay(deck);
assert(after.newIds.length === 1,
  'cap minus committed (3 - 2) leaves room for exactly one fresh card');
assert(after.newIds[0] === 'cpgf-1.01',
  'the one fresh slot goes to the first fresh card in deck order');

/* --- due reviews are unaffected by the new-card cap --------------------------- */
settings.newCardsPerDay = 0;   // clamped to 1; with 2 committed, fresh room is 0
PGRE.store.state.cards['cpgf-1.02'] = { ivl: 2, ease: 2.5, due: '2026-10-01',
                                        reps: 2, lapses: 1 };
var zeroFresh = srs.suggestFormulaDay(deck);
assert(zeroFresh.newIds.length === 0, 'a saturated cap yields no fresh suggestions');
assert(zeroFresh.reviewIds.indexOf('cpgf-1.02') !== -1,
  'due reviews still come through when the new-card cap is saturated');
settings.newCardsPerDay = 10;
PGRE.store.state.cardReviews = [];
PGRE.store.state.formulaDay = null;

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
