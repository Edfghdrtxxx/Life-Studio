#!/usr/bin/env node
/* Unit tests for PGRE.formulaCheckIn — loads the shipped formula-checkin.js
   (no re-implementation). Run: node tools/test-formula-checkin.js */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.resolve(__dirname, '..');
var modPath = path.join(root, 'js', 'formula-checkin.js');
var src = fs.readFileSync(modPath, 'utf8');

// Mutable store + gamify shims so record() exercises the real side-effect path.
var xpLog = [];
var activityLog = [];
var storeState = {
  formulaCheckIn: { current: 0, best: 0, lastDay: null },
  xp: 0,
  log: []
};

var window = {
  PGRE: {
    store: {
      state: storeState,
      today: function () { return '2026-08-04'; },
      log: function (kind, text, xp) {
        activityLog.push({ kind: kind, text: text, xp: xp || 0 });
      },
      save: function () { /* no-op for unit tests */ }
    },
    gamify: {
      addXP: function (amount, reason, quiet) {
        storeState.xp += amount;
        xpLog.push({ amount: amount, reason: reason, quiet: !!quiet });
      }
    }
  }
};

var sandbox = {
  window: window,
  console: console,
  Date: Date,
  Math: Math,
  String: String,
  Number: Number,
  Array: Array,
  Object: Object,
  isFinite: isFinite,
  parseInt: parseInt,
  parseFloat: parseFloat
};
sandbox.PGRE = window.PGRE;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

var fci = sandbox.PGRE.formulaCheckIn;
if (!fci || typeof fci.apply !== 'function' || typeof fci.record !== 'function') {
  console.error('FAIL: shipped formula-checkin.js did not export PGRE.formulaCheckIn');
  process.exit(1);
}

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

function deepEq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function resetStore(prior) {
  storeState.formulaCheckIn = prior
    ? JSON.parse(JSON.stringify(prior))
    : { current: 0, best: 0, lastDay: null };
  storeState.xp = 0;
  xpLog.length = 0;
  activityLog.length = 0;
}

console.log('formula-checkin unit tests (shipped js/formula-checkin.js)\n');

// ——— pure apply: first day ———
console.log('apply — first claim');
var r0 = fci.apply(fci.emptyState(), '2026-08-01');
assert(r0.claimed === true, 'first day claims');
assert(r0.bonus === fci.BONUS_XP, 'first day grants BONUS_XP (' + fci.BONUS_XP + ')');
assert(r0.current === 1, 'first day streak = 1');
assert(r0.best === 1, 'first day best = 1');
assert(r0.next.lastDay === '2026-08-01', 'lastDay set to today');
assert(r0.checkedToday === true, 'checkedToday after claim');

// ——— consecutive advance ———
console.log('\napply — consecutive days');
var r1 = fci.apply(r0.next, '2026-08-02');
assert(r1.claimed === true, 'day 2 claims');
assert(r1.current === 2, 'consecutive → streak 2');
assert(r1.best === 2, 'best advances to 2');
var r2 = fci.apply(r1.next, '2026-08-03');
assert(r2.current === 3 && r2.best === 3, 'day 3 → streak 3 / best 3');

// ——— same-day double claim ———
console.log('\napply — same-day double claim');
var rDup = fci.apply(r2.next, '2026-08-03');
assert(rDup.claimed === false, 'same day does not re-claim');
assert(rDup.bonus === 0, 'same day grants no bonus');
assert(rDup.current === 3, 'streak unchanged on double claim');
assert(rDup.best === 3, 'best unchanged on double claim');
assert(deepEq(rDup.next, r2.next), 'state identity preserved on double claim');

// ——— gap day resets current, best monotonic ———
console.log('\napply — gap reset');
var rGap = fci.apply(r2.next, '2026-08-05'); // skipped 08-04
assert(rGap.claimed === true, 'after gap still claims');
assert(rGap.current === 1, 'gap → streak resets to 1');
assert(rGap.best === 3, 'best stays at previous peak 3');
assert(rGap.next.lastDay === '2026-08-05', 'lastDay jumps to new day');

// ——— best stays peak after longer streak rebuild ———
console.log('\napply — best monotonic across rebuild');
var s = rGap.next;
s = fci.apply(s, '2026-08-06').next;
s = fci.apply(s, '2026-08-07').next;
s = fci.apply(s, '2026-08-08').next; // current 4 > prior best 3
assert(s.current === 4 && s.best === 4, 'rebuilt streak 4 becomes new best');
var s2 = fci.apply(s, '2026-08-10').next; // gap
assert(s2.current === 1 && s2.best === 4, 'gap again: current 1, best 4 preserved');

// ——— invalid / missing today ———
console.log('\napply — invalid inputs');
var rBad = fci.apply({ current: 5, best: 5, lastDay: '2026-08-01' }, null);
assert(rBad.claimed === false && rBad.bonus === 0, 'null today → no claim');
assert(rBad.next.current === 5, 'invalid today leaves prior current intact');
var rJunk = fci.apply(fci.emptyState(), 'not-a-date');
assert(rJunk.claimed === false, 'junk date → no claim');

// ——— coerce sanitizes garbage ———
console.log('\ncoerce');
var c1 = fci.coerce(null);
assert(c1.current === 0 && c1.best === 0 && c1.lastDay === null, 'null → empty');
var c2 = fci.coerce({ current: -3, best: 'x', lastDay: 'nope' });
assert(c2.current === 0 && c2.best === 0 && c2.lastDay === null, 'neg/junk coerced');
var c3 = fci.coerce({ current: 4.7, best: 2, lastDay: '2026-07-01' });
assert(c3.current === 4 && c3.best === 4 && c3.lastDay === '2026-07-01',
  'floor current, raise best to match, keep valid lastDay');

// ——— dayBefore pure ———
console.log('\ndayBefore');
assert(fci.dayBefore('2026-08-04') === '2026-08-03', 'simple dayBefore');
assert(fci.dayBefore('2026-03-01') === '2026-02-28', 'month boundary (non-leap)');
assert(fci.dayBefore('2024-03-01') === '2024-02-29', 'leap year Feb boundary');
assert(fci.dayBefore('2026-01-01') === '2025-12-31', 'year boundary');
assert(fci.dayBefore('bad') === null, 'junk dayBefore → null');

// ——— liveStreak / statusFrom ———
console.log('\nliveStreak + statusFrom');
var prior = { current: 5, best: 9, lastDay: '2026-08-03' };
assert(fci.liveStreak(prior, '2026-08-03') === 5, 'live on lastDay');
assert(fci.liveStreak(prior, '2026-08-04') === 5, 'live when lastDay was yesterday');
assert(fci.liveStreak(prior, '2026-08-05') === 0, 'gap → live streak 0');
var st = fci.statusFrom(prior, '2026-08-03');
assert(st.checkedToday === true && st.current === 5 && st.best === 9, 'status checked today');
var st2 = fci.statusFrom(prior, '2026-08-04');
assert(st2.checkedToday === false && st2.current === 5, 'status not checked, streak still live');

// ——— celebrateMessage fixed product copy ———
console.log('\ncelebrateMessage');
assert(fci.celebrateMessage({ claimed: false }) === '', 'no claim → empty message');
assert(/Day 1/.test(fci.celebrateMessage({ claimed: true, current: 1, best: 1 })),
  'day 1 celebrate copy');
assert(/week/i.test(fci.celebrateMessage({ claimed: true, current: 7, best: 7 })),
  'day 7 celebrate copy');
assert(/New best/.test(fci.celebrateMessage({ claimed: true, current: 5, best: 5 })),
  'new best celebrate copy');

// ——— record() side effects: first claim awards once ———
console.log('\nrecord — apply check-in path with fixed today');
resetStore({ current: 0, best: 0, lastDay: null });
window.PGRE.store.today = function () { return '2026-08-04'; };
var rec1 = fci.record('2026-08-04');
assert(rec1.claimed === true, 'record first claim of day');
assert(rec1.bonus === fci.BONUS_XP, 'record grants bonus');
assert(storeState.formulaCheckIn.lastDay === '2026-08-04', 'state.lastDay persisted');
assert(storeState.formulaCheckIn.current === 1, 'state.current = 1');
assert(storeState.xp === fci.BONUS_XP, 'XP increased by bonus');
assert(xpLog.length === 1 && /check-in/.test(xpLog[0].reason), 'gamify.addXP once with check-in reason');
assert(activityLog.length === 1 && activityLog[0].kind === 'checkin', 'activity log checkin line');

// same-day second record — no bonus / no state change
var xpBefore = storeState.xp;
var stateSnap = JSON.stringify(storeState.formulaCheckIn);
var rec2 = fci.record('2026-08-04');
assert(rec2.claimed === false && rec2.bonus === 0, 'same-day record does not re-claim');
assert(storeState.xp === xpBefore, 'XP unchanged on second record');
assert(JSON.stringify(storeState.formulaCheckIn) === stateSnap, 'state unchanged on second record');
assert(xpLog.length === 1, 'addXP not called again');

// resume after gap
console.log('\nrecord — resume after gap');
resetStore({ current: 4, best: 6, lastDay: '2026-08-01' });
var recGap = fci.record('2026-08-04');
assert(recGap.claimed === true && recGap.current === 1, 'gap record resets current to 1');
assert(storeState.formulaCheckIn.best === 6, 'gap record keeps best');
assert(storeState.xp === fci.BONUS_XP, 'gap record still grants daily bonus once');

// consecutive via record
console.log('\nrecord — consecutive yesterday+today');
resetStore({ current: 2, best: 2, lastDay: '2026-08-03' });
var recCon = fci.record('2026-08-04');
assert(recCon.claimed === true && recCon.current === 3, 'consecutive record advances streak');
assert(storeState.formulaCheckIn.best === 3, 'consecutive record raises best');

// no prior check-in status
console.log('\nstatus / stripHTML structural');
resetStore({ current: 0, best: 0, lastDay: null });
var st0 = fci.status('2026-08-04');
assert(st0.checkedToday === false && st0.current === 0, 'status empty state');
var strip = fci.stripHTML(st0);
assert(/formula-checkin-card/.test(strip) && /Not yet today/.test(strip),
  'stripHTML shows pending surface');
var strip2 = fci.stripHTML({ checkedToday: true, current: 3, best: 5, lastDay: '2026-08-04' });
assert(/Checked in today/.test(strip2) && /data-to="3"/.test(strip2) && /day streak/.test(strip2),
  'stripHTML shows checked + streak');
var cel = fci.celebrateHTML(recCon);
assert(/formula-checkin-celebrate/.test(cel) && /data-to="15"/.test(cel) && /XP/.test(cel),
  'celebrateHTML paints reward moment');
var alr = fci.alreadyHTML({ checkedToday: true, current: 3, best: 5 });
assert(/Already checked in today/.test(alr), 'alreadyHTML for re-entry');

// ——— structural wiring: settle paths call record ———
console.log('\nstructural — settle path wiring');
var viewSrc = fs.readFileSync(path.join(root, 'js', 'view-formulas.js'), 'utf8');
var flashSrc = fs.readFileSync(path.join(root, 'js', 'flashmodes.js'), 'utf8');
var storeSrc = fs.readFileSync(path.join(root, 'js', 'store.js'), 'utf8');
var indexSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert(/formulaCheckIn\.record/.test(viewSrc), 'view-formulas settleStudy calls formulaCheckIn.record');
assert(/formulaCheckIn\.status/.test(viewSrc), 'view-formulas portal footnote reads check-in status');
assert(/celebrateHTML/.test(viewSrc), 'view-formulas summary uses celebrateHTML');
assert(/formulaCheckIn\.record/.test(flashSrc), 'flashmodes awardReviewXP calls formulaCheckIn.record');
assert(/checkInSummaryHTML/.test(flashSrc), 'flashmodes summaries wire check-in feedback');
assert(/formulaCheckIn:\s*\{\s*current:\s*0/.test(storeSrc),
  'store defaults include formulaCheckIn');
assert(/formula-checkin\.js/.test(indexSrc), 'index.html loads formula-checkin.js');
// Cache-buster must not leave games on a pre-check-in flashmodes build
assert(/flashmodes\.js\?v=/.test(viewSrc) && !/flashmodes\.js\?v=20260725b/.test(viewSrc),
  'ensureFlashmodes loads flashmodes with post-check-in cache buster');
assert(!/flashmodes\.js\?v=20260725b/.test(viewSrc),
  'stale flashmodes?v=20260725b cache buster removed');

console.log('\n────────────────────────────────');
console.log('passed: ' + passed + '  failed: ' + failed);
if (failed) process.exit(1);
console.log('ALL GREEN');
