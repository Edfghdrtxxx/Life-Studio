#!/usr/bin/env node
/* Browse-row Park/Unpark (Recall > Search results): the button's calls —
   suspendCard / unsuspendCard + store.save() — must put the card into
   state.formulaSuspended, take it out of today's batch (reviewIds, newIds,
   softIds), and on Unpark remove the entry without touching state.cards.
   Works for any card id, user cards included. Run: node tools/test-browse-park.js */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.resolve(__dirname, '..');
var storeSrc = fs.readFileSync(path.join(root, 'js', 'store.js'), 'utf8');
var srsSrc = fs.readFileSync(path.join(root, 'js', 'srs.js'), 'utf8');

var disk = {};
var window = { PGRE: {}, addEventListener: function () {}, indexedDB: null };
var sandbox = {
  window: window,
  PGRE: window.PGRE,
  localStorage: {
    getItem: function (k) { return k in disk ? disk[k] : null; },
    setItem: function (k, v) { disk[k] = String(v); },
    removeItem: function (k) { delete disk[k]; }
  },
  console: console,
  Date: Date, Math: Math, String: String, Number: Number,
  Array: Array, Object: Object,
  isFinite: isFinite, parseInt: parseInt, parseFloat: parseFloat,
  setTimeout: setTimeout, Promise: Promise
};
vm.createContext(sandbox);
vm.runInContext(storeSrc, sandbox);
vm.runInContext(srsSrc, sandbox);

var store = sandbox.PGRE.store;
var srs = sandbox.PGRE.srs;
store.load();
var s = store.state;

var passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ok  — ' + msg); }
  else { failed++; console.log('  FAIL — ' + msg); }
}
function listed(list, id) {
  return Array.isArray(list) && list.indexOf(id) !== -1;
}

/* --- park a scheduled card ------------------------------------------------- */
s.cards['cpgf-cm-1'] = { ivl: 7, ease: 2.5, due: srs.today(), reps: 3,
                       lapses: 0, last: srs.today() };
s.cards['user-english-1'] = { ivl: 3, ease: 2.5, due: srs.today(), reps: 1,
                            lapses: 0 };
s.formulaDay = { date: srs.today(),
                 reviewIds: ['cpgf-cm-1', 'cpgf-em-2'],
                 newIds: ['user-english-1'],
                 softIds: ['cpgf-ow-3', 'cpgf-cm-1'] };
var cardsBefore = JSON.stringify(s.cards);

/* What the new [data-fs-park] click handler does, verbatim. */
function parkToggle(id) {
  if (srs.isSuspended(id)) srs.unsuspendCard(id); else srs.suspendCard(id);
  store.save();
}

parkToggle('cpgf-cm-1');
assert(srs.isSuspended('cpgf-cm-1') === true, 'park puts the card in formulaSuspended');
assert(typeof s.formulaSuspended['cpgf-cm-1'] === 'string',
  'the suspended entry carries its ISO timestamp');
assert(!listed(s.formulaDay.reviewIds, 'cpgf-cm-1'), 'park takes the card out of reviewIds');
assert(!listed(s.formulaDay.softIds, 'cpgf-cm-1'), 'park takes the card out of softIds');
assert(listed(s.formulaDay.reviewIds, 'cpgf-em-2'), 'other review cards stay in the batch');
assert(listed(s.formulaDay.softIds, 'cpgf-ow-3'), 'other soft pins stay in the batch');
assert(disk[store.KEY].indexOf('cpgf-cm-1') !== -1, 'the park reached disk');

parkToggle('user-english-1');
assert(srs.isSuspended('user-english-1') === true, 'park works for a user card');
assert(!listed(s.formulaDay.newIds, 'user-english-1'), 'park takes the user card out of newIds');

/* --- unpark restores the schedule, not today -------------------------------- */
parkToggle('cpgf-cm-1');
assert(srs.isSuspended('cpgf-cm-1') === false, 'unpark removes the suspended entry');
assert(!Object.prototype.hasOwnProperty.call(s.formulaSuspended, 'cpgf-cm-1'),
  'unpark deletes the map key');
assert(JSON.stringify(s.cards) === cardsBefore,
  'unpark leaves state.cards unchanged — the saved schedule survives');
assert(!listed(s.formulaDay.reviewIds, 'cpgf-cm-1') &&
       !listed(s.formulaDay.newIds, 'cpgf-cm-1') &&
       !listed(s.formulaDay.softIds, 'cpgf-cm-1'),
  'unpark does not sneak the card back into today');

parkToggle('user-english-1');
assert(srs.isSuspended('user-english-1') === false, 'unpark works for a user card');
assert(JSON.stringify(s.cards) === cardsBefore, 'state.cards still untouched');

/* --- parking a card that was never in the batch ----------------------------- */
parkToggle('cpgf-qm-9');
assert(srs.isSuspended('cpgf-qm-9') === true, 'park works on an unbatched card');
assert(s.formulaDay.reviewIds.join(',') === 'cpgf-em-2',
  'the batch is unchanged when the card was not in it');
parkToggle('cpgf-qm-9');
assert(srs.isSuspended('cpgf-qm-9') === false, 'unpark again leaves the card live');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
