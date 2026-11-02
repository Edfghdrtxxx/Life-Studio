#!/usr/bin/env node
/* Life Studio themes: js/data-themes.js registry + store.migrate() remap,
   and the additive-state guarantee — an old-shape state (no userCards, no
   new settings keys, a legacy 'dark' theme) must load with every SRS
   schedule intact. Run: node tools/test-themes.js */
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
vm.runInContext(src('store.js'), sandbox);
var PGRE = sandbox.PGRE;

/* --- registry ------------------------------------------------------------ */
var names = PGRE.THEMES.map(function (t) { return t.name; });
['Cream and coral', 'Paper and ink', 'Sage forest', 'Nordic slate',
 'Midnight and gold', 'Aurora night'].forEach(function (n) {
  assert(names.indexOf(n) !== -1, 'registry includes "' + n + '"');
});
assert(PGRE.THEMES.length >= 8, 'registry has the six confirmed themes plus at least two extra');
assert(PGRE.THEME_DEFAULT === 'paper', 'default theme is Paper and ink');
var darks = PGRE.THEMES.filter(function (t) { return t.dark; }).map(function (t) { return t.id; });
assert(darks.indexOf('warm-dark') !== -1 && darks.indexOf('midnight') !== -1 &&
       darks.indexOf('aurora') !== -1, 'warm-dark, midnight, aurora are marked dark');
var warm = PGRE.themeEntry('warm-dark');
assert(warm.attr === 'dark', 'warm-dark keeps the legacy attr "dark" so old selectors still match');
var cream = PGRE.themeEntry('cream');
assert(cream.attr === '', 'cream is the :root palette (attr "")');

/* --- normalization -------------------------------------------------------- */
assert(PGRE.normalizeTheme('light') === 'paper', "legacy 'light' normalizes to paper");
assert(PGRE.normalizeTheme('dark') === 'warm-dark', "legacy 'dark' normalizes to warm-dark");
assert(PGRE.normalizeTheme('nordic') === 'nordic', 'a real id passes through');
assert(PGRE.normalizeTheme('bogus') === 'paper', 'an unknown id falls back to the default');
assert(PGRE.normalizeTheme(undefined) === 'paper', 'a missing value falls back to the default');
assert(PGRE.themeIsDark('warm-dark') && PGRE.themeIsDark('midnight') && PGRE.themeIsDark('aurora'),
  'themeIsDark recognizes every dark theme by id');
assert(!PGRE.themeIsDark('paper') && !PGRE.themeIsDark('cream') && !PGRE.themeIsDark('rose'),
  'themeIsDark is false for the light themes');
assert(PGRE.themeIsDark('dark') === true, "themeIsDark still honors the attr value 'dark'");
assert(PGRE.themeIsDark('sage') === false, 'themeIsDark accepts an attr value too');

/* --- migrate(): legacy values on a load ----------------------------------- */
function freshState() {
  var s = PGRE.store.defaults();
  s.migrations = { ankiReset2026: 'x', planRebuild2026: 'x', easy10: 'x' };
  return s;
}

var st = freshState();
st.settings.theme = 'dark';
PGRE.store.state = st;
PGRE.store.migrate();
assert(st.settings.theme === 'warm-dark', "migrate remaps a saved 'dark' to warm-dark");

var st2 = freshState();
st2.settings.theme = 'light';
PGRE.store.state = st2;
PGRE.store.migrate();
assert(st2.settings.theme === 'paper', "migrate remaps a saved 'light' to paper");

var st3 = freshState();
st3.settings.theme = 'aurora';
PGRE.store.state = st3;
PGRE.store.migrate();
assert(st3.settings.theme === 'aurora', 'migrate leaves a named theme untouched');

/* --- additive state: an old-shape blob keeps every schedule --------------- */
/* Shape before phase 1: no userCards key, settings without theme/
   newCardsPerDay/recallSubject, cards carrying real schedules. */
var old = freshState();
delete old.userCards;
old.settings = { dailyTargetMin: 120, formulaDailyTarget: 10 };   // pre-1: no theme at all
old.cards = {
  'cpgf-1.01': { ivl: 12, ease: 2.5, due: '2026-10-30', reps: 8, lapses: 1,
                 hist: { '2026-10-20': 'g' }, seen: 9 },
  'supp-abc':  { ivl: 3, ease: 2.1, due: '2026-11-05', reps: 2, lapses: 0, seen: 3 }
};
old.formulaDay = { date: '2026-11-02', reviewIds: ['cpgf-1.01'], newIds: ['supp-abc'], softIds: [] };
disk[PGRE.store.KEY] = JSON.stringify(old);

PGRE.store.load();
var loaded = PGRE.store.state;
assert(loaded.cards['cpgf-1.01'].ivl === 12 && loaded.cards['cpgf-1.01'].due === '2026-10-30',
  'old-shape load keeps every schedule field');
assert(loaded.cards['supp-abc'].ease === 2.1 && loaded.cards['supp-abc'].reps === 2,
  'second schedule survives intact');
assert(loaded.formulaDay.reviewIds[0] === 'cpgf-1.01' && loaded.formulaDay.newIds[0] === 'supp-abc',
  'the saved daily batch survives the load');
assert(loaded.userCards && typeof loaded.userCards === 'object',
  'userCards appears on the old state without touching the rest');
assert(loaded.settings.theme === 'paper', 'a state with no theme migrates to the default');
assert(loaded.settings.newCardsPerDay === 10, 'newCardsPerDay default fills in');
assert(loaded.settings.recallSubject === 'all', 'recallSubject default fills in');

/* tombstone plumbing for userCards */
assert(typeof PGRE.store.tombstone === 'function', 'store.tombstone exists');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
