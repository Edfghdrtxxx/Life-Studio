#!/usr/bin/env node
/* Life Studio user cards: PGRE.userCardOps over the real store — create,
   id rules (never reused, tombstones burned), update keeps the id, delete
   tombstones and keeps the SRS record, fail-closed when the store cannot
   write. Run: node tools/test-user-cards.js */
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
var PGRE = sandbox.PGRE;
var ops = PGRE.userCardOps;

PGRE.store.load();   // fresh defaults

/* --- create --------------------------------------------------------------- */
var r1 = ops.save({ subject: 'english', front: 'What does "albeit" mean?',
                    back: 'Although' });
assert(r1.ok === true, 'save() returns ok for a valid card');
assert(r1.card.id === 'user-english-1', 'first english card gets user-english-1');
assert(r1.card.kind === 'user', 'card is marked kind:user');
assert(r1.card.subject === 'english', 'subject is stored');
assert(r1.card.name === 'What does "albeit" mean?', 'name is derived from the front');
assert(r1.card.createdAt && r1.card.updatedAt, 'timestamps are stamped');
assert(disk[PGRE.store.KEY].indexOf('user-english-1') !== -1, 'the card reached disk');

var r2 = ops.save({ subject: 'vocab', front: 'laconic', back: 'using few words' });
assert(r2.card.id === 'user-vocab-1', 'vocab tag ids independently');
var r3 = ops.save({ subject: 'english', front: 'second english', back: 'b' });
assert(r3.card.id === 'user-english-2', 'ids count up per subject');

/* --- validation ----------------------------------------------------------- */
assert(ops.save({ subject: 'english', front: '', back: 'x' }).ok === false,
  'empty front is rejected');
assert(ops.save({ subject: 'english', front: 'x', back: '  ' }).ok === false,
  'blank back is rejected');
assert(ops.save({ subject: 'madeup', front: 'x', back: 'y' }).ok === false,
  'unknown subject is rejected');
assert(Object.keys(PGRE.store.state.userCards).length === 3,
  'rejected saves never entered the map');

/* --- update keeps the id ---------------------------------------------------- */
var upd = ops.save({ id: 'user-english-1', subject: 'vocab',
                     front: 'edited front', back: 'edited back', note: 'n' });
assert(upd.ok === true, 'update with a known id succeeds');
assert(upd.card.id === 'user-english-1', 'the id does not change on subject switch');
assert(upd.card.subject === 'vocab', 'the subject field moved to vocab');
assert(PGRE.cardSubject(upd.card) === 'vocab', 'cardSubject follows the field, not the id');
assert(upd.card.note === 'n', 'note saved');
assert(Object.keys(PGRE.store.state.userCards).length === 3, 'update adds no duplicate');
var forged = ops.save({ id: 'user-english-99', subject: 'english', front: 'f', back: 'b' });
assert(forged.ok === false, 'saving under a foreign id is rejected');

/* --- deriveName ------------------------------------------------------------ */
assert(ops.deriveName('') === '', 'deriveName on a blank front returns empty');
assert(ops.deriveName('$E=mc^2$ rest energy').indexOf('formula') !== -1,
  'math spans collapse to "formula" in the derived name');

/* --- delete ------------------------------------------------------------------ */
PGRE.store.state.cards['user-english-2'] = { ivl: 5, ease: 2.5, due: '2026-11-10',
                                             reps: 2, lapses: 0 };
assert(ops.remove('user-english-2') === true, 'remove() deletes a real card');
assert(ops.byId('user-english-2') === null, 'the card is gone from the map');
assert(PGRE.store.state.cards['user-english-2'].ivl === 5,
  'the SRS record survives the delete');
assert(ops.remove('user-english-2') === false, 'deleting twice is a no-op');
assert(ops.nextId('english') === 'user-english-3',
  'a tombstoned id is never reissued');
assert(ops.nextId('vocab') === 'user-vocab-2',
  'nextId counts live cards of that tag (the english card kept its user-english-1 id when its subject moved to vocab)');

/* --- fail-closed ------------------------------------------------------------ */
PGRE.store._persistFailed = true;   // the flag lives on the store, not state
var blocked = ops.save({ subject: 'english', front: 'x', back: 'y' });
assert(blocked.ok === false && /cannot be saved/.test(blocked.error),
  'save() refuses when the store cannot write');
assert(ops.remove('user-english-1') === false, 'remove() refuses when the store cannot write');
assert(ops.byId('user-english-1') !== null, 'the refused delete left the card in place');
PGRE.store._persistFailed = false;
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
