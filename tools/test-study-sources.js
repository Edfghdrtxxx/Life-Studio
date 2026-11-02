#!/usr/bin/env node
/* js/study-sources.js — the one module that reads GET /study-sources from the
   OrbitOS status bridge (report §14.5 step M2). Covers the three card states
   of §14.3 (no answer/404 → 'off'; last update older than the helper's
   120-minute schedule + 30 min grace → 'stale'; a day entry without the
   maimemo block → "open the app once"), the per-day Maimemo seconds map the
   Study time bars and calendar sum, session filtering, endpoint override,
   fetch caching, and the fail-closed paths (no fetch, abort, bad JSON,
   malformed payload). Read only: asserts nothing is persisted.
   Run: node tools/test-study-sources.js */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.resolve(__dirname, '..');
var src = fs.readFileSync(path.join(root, 'js', 'study-sources.js'), 'utf8');

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

/* Fresh module per scenario: fetch stub and endpoint under test control. */
function makeEnv(fetchImpl, overrideUrl) {
  var storeWrites = [];
  var win = {
    fetch: fetchImpl,
    AbortController: (typeof AbortController === 'function' ? AbortController : undefined),
    __PGRE_STUDY_SOURCES_URL: overrideUrl,
    localStorage: {
      setItem: function (k, v) { storeWrites.push([k, v]); },
      getItem: function () { return null; },
      removeItem: function () {}
    },
    sessionStorage: {
      setItem: function (k, v) { storeWrites.push(['sess:' + k, v]); },
      getItem: function () { return null; }
    },
    PGRE: {}
  };
  var ctx = { window: win, Promise: Promise, Date: Date, console: console,
              Math: Math, JSON: JSON, isFinite: isFinite, Array: Array, Object: Object,
              String: String, Number: Number, setTimeout: setTimeout, clearTimeout: clearTimeout,
              encodeURIComponent: encodeURIComponent };
  vm.createContext(ctx);
  vm.runInContext('var window = this.window; var PGRE = window.PGRE;\n' + src, ctx);
  return { ss: win.PGRE.studySources, storeWrites: storeWrites, win: win };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status: status,
    json: function () {
      return (typeof body === 'string')
        ? Promise.reject(new Error('bad json'))
        : Promise.resolve(body);
    }
  };
}

var TODAY = new Date();
function localDay(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
    '-' + String(d.getDate()).padStart(2, '0');
}
var todayKey = localDay(TODAY);
var y = new Date(TODAY); y.setDate(y.getDate() - 1);
var yestKey = localDay(y);
var h3ago = new Date(TODAY.getTime() - 3 * 3600 * 1000).toISOString();
var h26ago = new Date(TODAY.getTime() - 26 * 3600 * 1000).toISOString();
var fresh = new Date(TODAY.getTime() - 10 * 60 * 1000).toISOString();

function payload(days) { return { version: 1, days: days }; }

async function main() {

  /* ——— Connected: numbers, sessions, day map, formatting ——— */
  var days = {};
  days[todayKey] = {
    updatedAt: fresh,
    maimemo: { finished: 7, total: 20, studyTimeMs: 31 * 60000 },
    obsidian: { sessions: [
      { title: 'Method of images work', path: '60_Learning_Progress/Electrodynamics/2026-11-03-0915 Method of images work.md' },
      { title: 'Bad row without path' },
      { title: 'Second session', path: '60_Learning_Progress/Quantum Mechanics/2026-11-03-1010 Second session.md' }
    ] }
  };
  days[yestKey] = { updatedAt: h3ago, maimemo: { finished: 20, total: 20, studyTimeMs: 45 * 60000 } };

  var env = makeEnv(function () { return Promise.resolve(jsonResponse(200, payload(days))); });
  var ss = env.ss;
  var res = await ss.load();
  assert(res.status === 'ok', 'load() resolves ok on a 200 payload');
  assert(ss.entryFor(res.data).maimemo.finished === 7, 'today entry read by local day key');
  assert(Math.round(ss.maimemoSec(ss.entryFor(res.data)) / 60) === 31, 'maimemoSec: 31 min today');
  var map = ss.maimemoSecByDay(res.data);
  assert(Math.round(map[todayKey] / 60) === 31 && Math.round(map[yestKey] / 60) === 45,
    'maimemoSecByDay carries both days');
  var sess = ss.sessionsOf(ss.entryFor(res.data));
  assert(sess.length === 2, 'sessionsOf drops the entry without a path');
  assert(ss.freshness(res.data) === 'ok', 'a 10-minute-old update is fresh');
  assert(ss.latest(res.data).date === todayKey, 'latest() finds the newest day');
  assert(ss.fmtMin(31) === '31 min' && ss.fmtMin(73) === '1 h 13 min' && ss.fmtMin(120) === '2 h',
    'fmtMin formats minutes and hours');
  assert(env.storeWrites.length === 0, 'read only: nothing written to web storage');

  /* ——— Stale: newest update older than 120 min schedule + 30 min grace ——— */
  days[todayKey].updatedAt = h3ago;
  days[yestKey].updatedAt = h26ago;
  var env2 = makeEnv(function () { return Promise.resolve(jsonResponse(200, payload(days))); });
  var res2 = await env2.ss.load();
  assert(env2.ss.freshness(res2.data) === 'stale', 'a 3+ h old update is stale (helper runs every 120 min)');
  assert(/:\d{2}/.test(env2.ss.fmtUpdated(env2.ss.lastUpdatedAt(res2.data))),
    'fmtUpdated prints a clock for the stale line');

  /* ——— Day entry without maimemo → "open the app once" state ——— */
  var days3 = {};
  days3[todayKey] = { updatedAt: fresh, obsidian: { sessions: [{ title: 'x', path: 'p/x.md' }] } };
  var env3 = makeEnv(function () { return Promise.resolve(jsonResponse(200, payload(days3))); });
  var res3 = await env3.ss.load();
  assert(!env3.ss.hasMaimemo(env3.ss.entryFor(res3.data)),
    'entry without a maimemo block reports hasMaimemo false');
  assert(env3.ss.sessionsOf(env3.ss.entryFor(res3.data)).length === 1,
    'sessions still read on a no-maimemo day');

  /* ——— Not connected: no answer, 404, bad body ——— */
  var env4 = makeEnv(function () { return Promise.reject(new Error('ECONNREFUSED')); });
  var res4 = await env4.ss.load();
  assert(res4.status === 'off' && res4.data === null, 'connection refused resolves off, never rejects');

  var env5 = makeEnv(function () { return Promise.resolve(jsonResponse(404, { error: 'study sources unavailable' })); });
  var res5 = await env5.ss.load();
  assert(res5.status === 'off', 'bridge 404 (helper never wrote the file) resolves off');

  var env6 = makeEnv(function () { return Promise.resolve(jsonResponse(200, 'not json')); });
  var res6 = await env6.ss.load();
  assert(res6.status === 'off', 'unparseable body resolves off');

  var env7 = makeEnv(function () { return Promise.resolve(jsonResponse(200, { version: 1 })); });
  var res7 = await env7.ss.load();
  assert(res7.status === 'off', 'payload without days resolves off');

  /* ——— Endpoint override is honoured ——— */
  var hits = [];
  var env8 = makeEnv(function (u) { hits.push(u); return Promise.resolve(jsonResponse(404, {})); },
    'http://127.0.0.1:9911/study-sources');
  await env8.ss.load();
  assert(hits[0] === 'http://127.0.0.1:9911/study-sources', 'window.__PGRE_STUDY_SOURCES_URL override is used');
  var env9 = makeEnv(function (u) { hits.push(u); return Promise.resolve(jsonResponse(404, {})); });
  await env9.ss.load();
  assert(hits[1] === 'http://127.0.0.1:4789/study-sources', 'default endpoint is the status bridge');

  /* ——— Cache: one fetch serves every caller for the TTL ——— */
  var calls = 0;
  var env10 = makeEnv(function () { calls++; return Promise.resolve(jsonResponse(404, {})); });
  var a = env10.ss.load();
  var b = env10.ss.load();
  await a; await b;
  await env10.ss.load();
  assert(calls === 1, 'concurrent + cached loads share one fetch');
  env10.ss._reset();
  await env10.ss.load();
  assert(calls === 2, '_reset() clears the cache for the next load');

  /* ——— Abort path: the module aborts a fetch at FETCH_TIMEOUT_MS ——— */
  var env12 = makeEnv(function (u, opts) {
    return new Promise(function (resolve, reject) {
      /* Never settles on its own; the module's abort signal rejects it. */
      opts.signal.addEventListener('abort', function () {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    });
  });
  var res12 = await env12.ss.load();
  assert(res12.status === 'off', 'a hung fetch is aborted at the timeout and resolves off');
  var env13 = makeEnv(function () {
    return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  });
  var res13 = await env13.ss.load();
  assert(res13.status === 'off', 'an aborted fetch resolves off');
  /* ——— No fetch at all (old browser / stubbed out) ——— */
  var env11 = makeEnv(undefined);
  var res11 = await env11.ss.load();
  assert(res11.status === 'off', 'no window.fetch resolves off without throwing');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) {
  console.error('FATAL — ' + (e && e.stack || e));
  process.exit(1);
});
