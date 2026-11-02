#!/usr/bin/env node
/* Dashboard mount must wire today's question of the day: mount() has to call
   bindQotd(), which is the only place qotdCommit is assigned. Without that call
   the choices never bind and the A–E / Enter keyboard path has no controller.
   Bank-free — PGRE.questionById/allQuestions resolve fixture questions.
   Run: node tools/test-dashboard-qotd.js */
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

/* Minimal element: innerHTML sink, no-op listeners, recordable click wiring. */
function fakeEl(id) {
  var el = {
    id: id || '',
    innerHTML: '',
    textContent: '',
    hidden: false,
    disabled: false,
    listeners: {},
    children: [],
    parentNode: { removeChild: function () {} },
    appendChild: function () {},
    setAttribute: function () {},
    getAttribute: function () { return null; },
    addEventListener: function (ev, fn) { el.listeners[ev] = fn; },
    removeEventListener: function () {},
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    closest: function () { return null; },
    contains: function () { return false; },
    classList: { add: function () {}, remove: function () {}, contains: function () { return false; } },
    style: {},
    focus: function () {},
    click: function () { if (el.listeners.click) el.listeners.click({ target: el }); }
  };
  return el;
}

var docEls = {};
function elFor(id) {
  if (!docEls[id]) docEls[id] = fakeEl(id);
  return docEls[id];
}

var docKeyHandlers = [];

var sandbox = {
  console: console,
  Date: Date,
  JSON: JSON,
  Math: Math,
  Object: Object,
  Array: Array,
  String: String,
  Number: Number,
  parseInt: parseInt,
  parseFloat: parseFloat,
  isFinite: isFinite,
  isNaN: isNaN,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  location: { href: 'file:///tmp/index.html', hash: '#/' }
};
sandbox.window = sandbox;
sandbox.document = {
  addEventListener: function (ev, fn) {
    if (ev === 'keydown') docKeyHandlers.push(fn);
  },
  getElementById: function (id) {
    // qotd-body exists (the card is on screen); everything else absent keeps
    // mount's optional wiring quiet
    return id === 'qotd-body' ? elFor('qotd-body') : null;
  },
  querySelector: function () { return null; },
  querySelectorAll: function () { return []; },
  createElement: function () { return fakeEl(); },
  activeElement: null
};
sandbox.localStorage = {
  getItem: function () { return null; },
  setItem: function () {},
  removeItem: function () {}
};
sandbox.sessionStorage = sandbox.localStorage;
sandbox.addEventListener = function () {};
vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(path.join(root, 'js', 'view-dashboard.js'), 'utf8'), sandbox);

var PGRE = sandbox.PGRE;
var dashboard = PGRE.views.dashboard;

/* ——— Fixture bank + PGRE stubs (mount never calls render) ——— */
var Q = { id: 'q1', topic: 'mech', answer: 1,
          q: '<p>q</p>', choices: ['a', 'b', 'c', 'd', 'e'], sol: '<p>s</p>' };

var bindCalls = [];
var lastCommit = null;
var recordCalls = [];
var wireCalls = 0;

PGRE.store = {
  state: {
    today: { date: '2026-10-01', qotd: null },
    settings: { keyboard: true }
  },
  save: function () {}
};
PGRE.allQuestions = function () { return [Q]; };
PGRE.questionById = function (id) { return id === 'q1' ? Q : null; };
PGRE.gamify = {
  seededPick: function (seed, pool, n) { return pool.slice(0, n); },
  recordAnswer: function (q, isCorrect, ms, opts) {
    recordCalls.push({ q: q, isCorrect: isCorrect, opts: opts });
    return 10;
  }
};
PGRE.ui = {
  esc: function (s) { return String(s == null ? '' : s); },
  bindChoiceCommit: function (body, opts) {
    var sel = null;
    bindCalls.push({ body: body, opts: opts });
    lastCommit = {
      select: function (idx) { sel = idx; },
      commit: function () { if (sel != null) opts.onCommit(sel); },
      selected: function () { return sel; }
    };
    return lastCommit;
  }
};
PGRE.sessionPark = { wireDashboard: function () { wireCalls++; } };
PGRE.motion = { reduced: true };                 // skip the entry-motion block
PGRE.typesetMath = function () {};
PGRE.toast = function () {};
PGRE.route = function () {};
PGRE.formulaDeck = function () { return { then: function () {} }; };

function key(k) {
  var prevented = false;
  docKeyHandlers.forEach(function (fn) {
    fn({ key: k, target: { tagName: 'DIV' },
         preventDefault: function () { prevented = true; } });
  });
  return prevented;
}

console.log('bindQotd (Physics home) binds today’s question');

// The QOTD card moved to the Physics subject home (round 2); view-subject
// renders qotdCard() and calls this same bindQotd() export.
dashboard.mount();
dashboard.bindQotd();

assert(wireCalls === 1, 'mount calls sessionPark.wireDashboard() once');
assert(bindCalls.length === 1, 'bindQotd binds the QOTD choices via bindChoiceCommit');
assert(bindCalls.length && bindCalls[0].body === elFor('qotd-body'),
       'bindChoiceCommit receives the qotd-body element');
assert(typeof (bindCalls[0] && bindCalls[0].opts.onCommit) === 'function',
       'bindChoiceCommit receives an onCommit handler');
console.log('A–E select + Enter commits through the recorded controller');

key('b');                                        // select choice B (idx 1)
assert(lastCommit && lastCommit.selected() === 1,
       'letter key selects a choice through the bound controller');
key('Enter');
assert(recordCalls.length === 1, 'Enter commits the pick to recordAnswer');
assert(recordCalls.length === 1 && recordCalls[0].q === Q && recordCalls[0].isCorrect === true,
       'recordAnswer sees the day’s question and the correct pick');
assert(recordCalls.length === 1 && recordCalls[0].opts && recordCalls[0].opts.mode === 'qotd',
       'the answer is logged with mode qotd');
assert(PGRE.store.state.today.qotd && PGRE.store.state.today.qotd.qid === 'q1' &&
       PGRE.store.state.today.qotd.picked === 1,
       'today.qotd records qid and the picked index');

console.log('an already-answered day does not rebind');

bindCalls.length = 0;
dashboard.bindQotd();
assert(bindCalls.length === 0, 're-bind with today.qotd set does not rebind choices');
key('Enter');
assert(recordCalls.length === 1, 'Enter after a solved day is ignored');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
