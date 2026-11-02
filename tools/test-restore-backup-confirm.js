#!/usr/bin/env node
/* Library "Restore last browser safety copy" asks confirm() first.
   Cancel leaves saved progress untouched; OK runs restoreBackup().
   Run: node tools/test-restore-backup-confirm.js */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var crypto = require('crypto');

var root = path.resolve(__dirname, '..');
var storeSrc = fs.readFileSync(path.join(root, 'js', 'store.js'), 'utf8');
var viewSrc = fs.readFileSync(path.join(root, 'js', 'view-settings.js'), 'utf8');
var indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

var passed = 0;
var failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ok  — ' + msg); }
  else { failed++; console.log('  FAIL — ' + msg); }
}

var CONFIRM_TEXT = 'Replace the current progress with the last browser safety copy? Progress saved after that copy will be lost.';

function fakeEl(id) {
  var el = {
    id: id || '',
    innerHTML: '',
    textContent: '',
    hidden: false,
    files: [],
    value: '',
    listeners: {},
    classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
    addEventListener: function (ev, fn) { el.listeners[ev] = fn; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    focus: function () {},
    click: function () { if (el.listeners.click) el.listeners.click({ target: el }); }
  };
  return el;
}

function todayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function makeSandbox() {
  var disk = {};
  var toasts = [];
  var confirmReply = false;
  var confirmCalls = [];
  var els = {};
  function elFor(id) {
    if (!els[id]) els[id] = fakeEl(id);
    return els[id];
  }
  var sandbox = {
    console: console,
    localStorage: {
      getItem: function (k) { return k in disk ? disk[k] : null; },
      setItem: function (k, v) { disk[k] = String(v); },
      removeItem: function (k) { delete disk[k]; }
    },
    confirm: function (msg) {
      confirmCalls.push(msg);
      return confirmReply;
    },
    URL: { createObjectURL: function () { return 'blob:test'; }, revokeObjectURL: function () {} },
    crypto: crypto.webcrypto,
    TextEncoder: TextEncoder,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Promise: Promise,
    Date: Date,
    JSON: JSON,
    Uint8Array: Uint8Array,
    location: { hash: '#/library', href: 'http://127.0.0.1:9/#/library' }
  };
  sandbox.window = sandbox;
  sandbox.document = {
    addEventListener: function () {},
    getElementById: function (id) { return elFor(id); },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    createElement: function () { return fakeEl(); },
    visibilityState: 'visible'
  };
  sandbox.window.document = sandbox.document;
  sandbox.window.localStorage = sandbox.localStorage;
  sandbox.window.crypto = sandbox.crypto;
  sandbox.window.location = sandbox.location;
  sandbox.window.addEventListener = function () {};
  sandbox.window.PGRE = {};
  sandbox.PGRE = sandbox.window.PGRE;
  vm.createContext(sandbox);
  vm.runInContext(storeSrc, sandbox);
  vm.runInContext(viewSrc, sandbox);
  sandbox.PGRE.contentDB = {
    all: function () { return Promise.resolve([]); },
    get: function () { return Promise.resolve(null); },
    put: function () { return Promise.resolve(); },
    del: function () { return Promise.resolve(); }
  };
  sandbox.PGRE.toast = function (msg) { toasts.push(msg); };
  sandbox.PGRE.applyTheme = function () {};
  sandbox.PGRE.route = function () {};
  sandbox.PGRE.ui = { esc: function (s) { return String(s == null ? '' : s); } };
  return {
    tab: sandbox,
    disk: disk,
    toasts: toasts,
    confirmCalls: confirmCalls,
    setConfirm: function (v) { confirmReply = v; },
    clickRestore: function () { elFor('restore-backup-btn').click(); }
  };
}

function seed(tab) {
  tab.PGRE.store.load();
  tab.PGRE.store.state.today.date = todayStr();
  tab.PGRE.store.state.migrations = { ankiReset2026: 'x', planRebuild2026: 'x', easy10: 'x' };
}

console.log('\nindex.html cache token for view-settings.js');
/* The assert only proves the script tag carries a cache-buster so a changed
   view-settings.js ships fresh — pin nothing: the value moves every time
   the view changes (PRs bump it independently). */
var tokenMatch = indexHtml.match(/<script src="js\/view-settings\.js\?v=([^"]+)"/);
assert(tokenMatch && tokenMatch[1].length >= 4,
  'view-settings.js is loaded with a cache-busting ?v= token, got ' + (tokenMatch ? tokenMatch[1] : 'none'));

console.log('\nCancel leaves the saved state untouched');
var cancel = makeSandbox();
seed(cancel.tab);
cancel.tab.PGRE.store.state.xp = 900;
cancel.tab.PGRE.store.save();
var leftover = JSON.parse(cancel.disk['pgre-state-v1']);
leftover.xp = 111;
leftover.migrations = { ankiReset2026: 'x', planRebuild2026: 'x', easy10: 'x' };
cancel.disk['pgre-state-v1-backup'] = JSON.stringify(leftover);
cancel.tab.PGRE.views.settings.mount();
cancel.setConfirm(false);
cancel.clickRestore();
assert(cancel.confirmCalls.length === 1 && cancel.confirmCalls[0] === CONFIRM_TEXT,
  'Cancel is asked with the safety-copy warning');
assert(cancel.tab.PGRE.store.state.xp === 900, 'Cancel leaves live xp unchanged');
assert(JSON.parse(cancel.disk['pgre-state-v1']).xp === 900, 'Cancel leaves the saved blob unchanged');
assert(cancel.toasts.length === 0, 'Cancel shows nothing');

console.log('\nOK restores the browser safety copy');
var ok = makeSandbox();
seed(ok.tab);
ok.tab.PGRE.store.state.xp = 900;
ok.tab.PGRE.store.save();
var copy = JSON.parse(ok.disk['pgre-state-v1']);
copy.xp = 111;
copy.migrations = { ankiReset2026: 'x', planRebuild2026: 'x', easy10: 'x' };
ok.disk['pgre-state-v1-backup'] = JSON.stringify(copy);
ok.tab.PGRE.views.settings.mount();
ok.setConfirm(true);
ok.clickRestore();
assert(ok.confirmCalls.length === 1 && ok.confirmCalls[0] === CONFIRM_TEXT,
  'OK is asked with the same safety-copy warning');
assert(ok.tab.PGRE.store.state.xp === 111, 'OK restores the safety-copy xp');
assert(JSON.parse(ok.disk['pgre-state-v1']).xp === 111, 'OK writes the safety copy to the saved blob');
assert(ok.toasts.indexOf('Backup restored.') !== -1, 'OK runs the existing restore toast');
assert(ok.tab.location.hash === '#/', 'OK follows the existing restore navigation');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
