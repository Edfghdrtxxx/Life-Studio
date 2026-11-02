#!/usr/bin/env node
/* Lane 2: formula search indexes the section tag on its own.
   Run: node tools/test-formula-consumers.js */
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

var window = { PGRE: { topicById: function () { return { id: 'em', name: 'Electromagnetism', short: 'EM' }; } } };
var sandbox = {
  window: window,
  PGRE: window.PGRE,
  console: console,
  Date: Date,
  Math: Math,
  JSON: JSON,
  String: String,
  Number: Number,
  Array: Array,
  Object: Object,
  RegExp: RegExp,
  isFinite: isFinite,
  parseInt: parseInt
};
sandbox.window.PGRE.store = { state: { cardNotes: {}, formulaDay: null } };
sandbox.window.PGRE.srs = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'js/formula-search.js'), 'utf8'), sandbox, {
  filename: 'js/formula-search.js'
});

var fseng = sandbox.window.PGRE.formulaSearch;
var deck = [{
  id: 'cpgf-2.56a',
  topic: 'em',
  name: 'Polarization',
  tag: 'Dielectrics',
  front: 'Bound charge in a linear material.',
  back: '$$P = \\epsilon_0 \\chi E$$',
  eq: '2.56'
}];
var index = fseng.build(deck);

function ids(q) {
  return fseng.run(index, q, {}).hits.map(function (h) { return h.card.id; });
}

console.log('tag filter uses the section tag');
assert(ids('tag:dielectrics').indexOf('cpgf-2.56a') !== -1, 'tag:dielectrics finds the card');
assert(ids('tag:"Dielectrics"').indexOf('cpgf-2.56a') !== -1, 'tag:"Dielectrics" finds the card');
assert(ids('Polarization').indexOf('cpgf-2.56a') !== -1, 'the name query still finds Polarization');
assert(ids('tag:polarization').indexOf('cpgf-2.56a') !== -1,
  'tag: still accepts the display name as an alias');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
