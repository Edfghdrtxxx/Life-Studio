#!/usr/bin/env node
/* Headless Chrome, end to end: the Intensity feedback (js/intensity.js) on
   the shipped page. Five seeded study histories put each of the three
   banded readings (Daily work, first-try accuracy, pace) in each band
   (green, amber, red), with a full mock submitted today, and a day after
   the last Daily work target day. For each history the test loads the
   dashboard and checks every row's value and band, the headline and its
   one action, the 7-day strip, the "Where to adjust" topic order, and
   PGRE.buildStatusSummary().intensity. In the first history it also uses
   the card: opens a reading with the mouse and the keyboard, opens the
   topic table, checks the phone layout, sits a timed pack, follows the
   summary's link back and checks where it lands and what changed, then
   lets a sibling tab write. Two more loads cover a new user and the
   Sunday mock day (page clock moved forward). Expected numbers are worked
   out here from the seed, not read back from the module under test. The
   question bank (content/bank/, gitignored) may be absent, as in a fresh
   worktree: no expected number here depends on it.

   Isolated Chrome profile and ephemeral ports; nothing outside the temp
   profile is read or written. Requests to the OrbitOS status bridge
   (127.0.0.1:4789) are blocked. Run: node tools/test-intensity-chrome.js
   PGRE_ARTIFACT_DIR=<dir> keeps the screenshots (otherwise they are
   written to a temp dir that is removed). PGRE_TEST_PORT / PGRE_CDP_PORT
   pin the ports. */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');
var net = require('net');
var vm = require('vm');
var { spawn } = require('child_process');

var PORT = parseInt(process.env.PGRE_TEST_PORT || '0', 10);
var CDP_PORT = parseInt(process.env.PGRE_CDP_PORT || '0', 10);
var ROOT = path.resolve(__dirname, '..');
var BRIDGE_PORT = 4789; // js/status.js ENDPOINT
function isBridgeUrl(u) { return /^https?:\/\/(127\.0\.0\.1|localhost):4789\//.test(String(u)); }
var KEEP_ARTIFACTS = !!process.env.PGRE_ARTIFACT_DIR;
var ARTIFACT_DIR = process.env.PGRE_ARTIFACT_DIR ||
  fs.mkdtempSync(path.join(os.tmpdir(), 'pgre-intensity-shots-'));
var MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.png': 'image/png', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.json': 'application/json'
};

var passed = 0;
var failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  — ' + msg); }
  else { failed++; console.log('  FAIL — ' + msg); }
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* ——— Dates: local calendar days, the Studio's day key ——— */
function pad2(n) { return String(n).padStart(2, '0'); }
function dayKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
/* DAY_SHIFT moves "today" forward for the mock-day scenario, where the page
   clock is shifted by the same number of days. */
var DAY_SHIFT = 0;
function dayAgo(k) { var d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + DAY_SHIFT - k); return dayKey(d); }
function dayAhead(k) { return dayAgo(-k); }
/* ISO timestamp k days ago at local hour h, minute m, second s. */
function tsAgo(k, h, m, s) {
  var d = new Date();
  d.setDate(d.getDate() + DAY_SHIFT - k);
  d.setHours(h, m || 0, s || 0, 0);
  return d.toISOString();
}
/* Sunday is the full-mock day: an unmet Daily work target then links to
   the mock exam, otherwise to the mistake book (js/intensity.js review()). */
var MOCK_TODAY = new Date().getDay() === 0;
var DAYS_TO_SUNDAY = (7 - new Date().getDay()) % 7 || 7;
function median(list) {
  var a = list.slice().sort(function (x, y) { return x - y; });
  var mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/* ——— Bands, written out from the spec table (not from js/intensity.js) ——— */
function bandWork(v, mock) { return mock || v >= 60 ? 'green' : v >= 25 ? 'amber' : 'red'; }
function bandPace(v) { return v == null ? 'none' : v <= 103 ? 'green' : v <= 130 ? 'amber' : 'red'; }
function bandAcc(v) { return v == null ? 'none' : v >= 75 ? 'green' : v >= 60 ? 'amber' : 'red'; }
var CHIP = { green: 'On target', amber: 'Close', red: 'Off target', none: 'No data', rest: 'No target' };

/* ——— Pack question ids, read from the shipped data file ———
   The seeds draw question ids from the packs, and history 1 sits a pack. */
var dataCtx = { window: {} };
vm.createContext(dataCtx);
vm.runInContext('var window = this.window; window.PGRE = {}; var PGRE = window.PGRE;\n' +
  fs.readFileSync(path.join(ROOT, 'js', 'data-packs.js'), 'utf8'), dataCtx);
var PACKS = dataCtx.window.PGRE.PACKS;
var PACK_UNION = [];
(function () {
  var seen = {};
  Object.keys(PACKS).forEach(function (k) {
    PACKS[k].ids.forEach(function (id) { if (!seen[id]) { seen[id] = 1; PACK_UNION.push(id); } });
  });
}());
var SIT_PACK = '09';                       // the pack the test sits; the seeds never use its ids
var SIT_IDS = {};
PACKS[SIT_PACK].ids.forEach(function (id) { SIT_IDS[id] = 1; });
var SEED_POOL = PACK_UNION.filter(function (id) { return !SIT_IDS[id]; });

/* ——— Seed builder ———
   news: [dayAgo, topic, correct, seconds]; every entry is the first attempt
   of a fresh pack qid in mode 'practice'.
   retakes: [dayAgo, count, seconds each]; mistake-book retakes (mode
   'mistakes') of fresh qids.
   mocks: [dayAgo]; a submitted weighted 70-question sitting. */
function buildSeed(spec) {
  var pool = SEED_POOL.slice();
  var attempts = [];
  var seq = 0;
  function take() { var id = pool.shift(); if (!id) throw new Error('seed pool exhausted'); return id; }
  function push(k, qid, topic, correct, sec, mode) {
    seq++;
    attempts.push({
      ts: tsAgo(k, 1, 0, seq % 3600), qid: qid, topic: topic, picked: correct ? 0 : 1, answer: 0,
      correct: correct, ms: sec * 1000, sid: 'seed-' + k, mode: mode, confidence: null, tags: []
    });
  }
  spec.news.forEach(function (n) { push(n[0], take(), n[1], n[2], n[3], 'practice'); });
  (spec.extra || []).forEach(function (fn) { fn({ take: take, push: push }); });
  (spec.retakes || []).forEach(function (r) {
    for (var i = 0; i < r[1]; i++) push(r[0], take(), 'cm', true, r[2], 'mistakes');
  });
  var exams = (spec.mocks || []).map(function (k, i) {
    return {
      id: 'ex-seed-' + i, startedAt: tsAgo(k, 2), submittedAt: tsAgo(k, 4), format: '70x120', source: 'weighted',
      title: null, seed: 1, order: [], answers: {}, flags: [], cursor: 0, paused: false, durationSec: 7200,
      limitSec: 7200, raw: 40, total: 70, scaledEst: 800, perTopic: {}
    };
  });
  var iso = new Date().toISOString();
  return {
    created: iso, xp: 0, attempts: attempts, exams: exams,
    settings: { theme: 'light', examDate: spec.examDate, keyboard: true, paceTrainer: true,
                paceTargetSec: 103, dailyTargetMin: 120 },
    migrations: { ankiReset2026: iso, planRebuild2026: iso, easy10: iso },
    _epoch: 1000 + spec.n, _rev: 1
  };
}

/* What the card prints beside each number: the target in words. */
function workText(n, mock, hasTarget) {
  return n + ' ' + (!hasTarget ? 'no target today' : (mock ? 'full mock submitted' : 'of 60'));
}
/* The reading the headline is about: off target before close, and within
   one band Daily work, accuracy, pace. New questions and Repeat time never
   lead. Written out here, not read from js/intensity.js. */
var LEAD_ORDER = ['dailyWork', 'firstAttemptAccuracy', 'paceSec'];
function leadOf(want) {
  var reds = LEAD_ORDER.filter(function (m) { return want[m].band === 'red'; });
  var ambers = LEAD_ORDER.filter(function (m) { return want[m].band === 'amber'; });
  return reds[0] || ambers[0] || null;
}

/* Expected readout for a seed, from the definitions in the spec. */
function expectFor(spec) {
  var news = spec.news;
  var today = news.filter(function (n) { return n[0] === 0; });
  var pace = today.length ? Math.round(median(today.map(function (n) { return n[3]; }))) : null;
  var last7 = news.filter(function (n) { return n[0] <= 6; });
  var right7 = last7.filter(function (n) { return n[2]; }).length;
  var acc = last7.length ? Math.round(100 * right7 / last7.length) : null;
  var lastTargetDay = dayAhead(spec.examAhead - 3);
  function retakesOn(k) {
    return (spec.retakes || []).filter(function (r) { return r[0] === k; }).reduce(function (s, r) { return s + r[1]; }, 0);
  }
  function mocksOn(k) { return (spec.mocks || []).filter(function (m) { return m === k; }).length; }
  var repSec = (spec.retakes || []).filter(function (r) { return r[0] === 0; })
    .reduce(function (s, r) { return s + r[1] * r[2]; }, 0);
  var repMin = Math.round(repSec / 60);
  var hasTarget = dayAgo(0) <= lastTargetDay;
  var work = retakesOn(0);
  var mock = mocksOn(0) > 0;
  var strip = [];
  for (var d = 6; d >= 0; d--) {
    var target = dayAgo(d) <= lastTargetDay;
    strip.push({ retakes: retakesOn(d), mocks: mocksOn(d),
                 band: target ? bandWork(retakesOn(d), mocksOn(d) > 0) : 'none' });
  }
  return {
    dailyWork: { value: work, band: hasTarget ? bandWork(work, mock) : 'none', mock: mock, hasTarget: hasTarget,
                 text: workText(work, mock, hasTarget), lastTargetDay: lastTargetDay },
    paceSec: { value: pace, band: bandPace(pace), text: (pace == null ? '—' : pace + ' s') + ' target 103 s or under' },
    firstAttemptAccuracy: { value: acc, band: bandAcc(acc), text: (acc == null ? '—' : acc + '%') + ' target 75% or more',
                            n: last7.length, correct: right7 },
    repeatMinutes: { value: repMin, band: 'none', text: repMin + ' min no limit' },
    newQuestions: { value: today.length, band: 'none', text: today.length + ' no target' },
    strip: strip
  };
}
/* What a row's chip shows: readings without a target read "No target";
   a reading without data reads "No data". */
function shownAs(m, bandName) {
  if (m === 'newQuestions' || m === 'repeatMinutes' || (m === 'dailyWork' && bandName === 'none')) {
    return { band: 'none', chip: CHIP.rest, show: 'rest' };
  }
  return { band: bandName, chip: CHIP[bandName], show: bandName };
}

/* ——— The histories ——— */
var EXAM_AHEAD = 20;   // exam 20 days out, last target day 17 days out
var T = true, F = false;
var SPECS = [
  {
    n: 1, name: 'mixed',
    examAhead: EXAM_AHEAD,
    news: [
      // today: 11 new, median 128 s; 8 right
      [0, 'cm', F, 60], [0, 'cm', T, 90], [0, 'em', T, 100], [0, 'em', F, 110], [0, 'qm', T, 120],
      [0, 'qm', T, 128], [0, 'th', T, 130], [0, 'at', T, 135], [0, 'sp', F, 140], [0, 'cm', T, 150],
      [0, 'em', T, 170],
      [1, 'cm', T, 100], [1, 'cm', F, 100], [1, 'em', T, 100], [1, 'em', T, 100], [1, 'qm', T, 100],
      [1, 'th', T, 100], [1, 'at', F, 100], [1, 'ow', T, 100],
      [2, 'cm', F, 100], [2, 'em', F, 100], [2, 'qm', T, 100], [2, 'th', F, 100], [2, 'sp', T, 100],
      [2, 'sr', T, 100],
      [4, 'cm', T, 100], [4, 'em', T, 100], [4, 'qm', T, 100], [4, 'at', T, 100], [4, 'lb', T, 100],
      // 7-9 days back: inside the 14-day topic window only
      [7, 'cm', F, 100], [7, 'cm', T, 100], [7, 'em', F, 100],
      [8, 'cm', F, 100], [8, 'qm', T, 100], [8, 'th', T, 100],
      [9, 'th', T, 100], [9, 'at', T, 100], [9, 'sp', T, 100], [9, 'ow', F, 100]
    ],
    extra: [
      // first tried 21 days ago in practice, again today: not new today
      function (h) { var q = h.take(); h.push(21, q, 'cm', T, 100, 'practice'); h.push(0, q, 'cm', T, 800, 'practice'); },
      // first try today is the question of the day: never a new question
      function (h) { var q = h.take(); h.push(0, q, 'em', T, 30, 'qotd'); h.push(0, q, 'em', T, 700, 'practice'); },
      // first try in a mock exam 2 days ago, practice today: not new
      function (h) { var q = h.take(); h.push(2, q, 'qm', F, 90, 'exam'); h.push(0, q, 'qm', T, 600, 'practice'); }
    ],
    retakes: [[0, 30, 90], [1, 45, 60], [3, 12, 60]],   // today 30 retakes, 45 min
    mocks: [5],
    topicOrder: ['cm', 'em', 'th', 'qm', 'at', 'sp', 'ow', 'sr', 'lb'],
    topicBands: { cm: 'red', em: 'amber', th: 'green', qm: 'green', at: 'none', sp: 'none', ow: 'none', sr: 'none', lb: 'none' },
    topicNew: { cm: 10, em: 8, th: 5, qm: 6, at: 4, sp: 3, ow: 2, sr: 1, lb: 1 },
    topicAcc: { cm: '50%', em: '63%', th: '80%', qm: '100%' },
    bands: { dailyWork: 'amber', paceSec: 'amber', firstAttemptAccuracy: 'amber' },
    // all three judged readings are close: Daily work leads
    lead: 'dailyWork', headline: '30 mistake-book questions to go today.', tone: 'attention'
  },
  {
    n: 2, name: 'all green',
    examAhead: EXAM_AHEAD,
    news: (function () {
      var out = [];
      for (var i = 0; i < 16; i++) out.push([0, ['cm', 'em', 'qm', 'th'][i % 4], i < 13, 90]);
      for (var j = 0; j < 20; j++) out.push([1 + (j % 6), ['cm', 'em', 'qm', 'th', 'at'][j % 5], j < 17, 95]);
      return out;
    }()),
    retakes: [[0, 60, 45]],             // 60 retakes, 45 min
    bands: { dailyWork: 'green', paceSec: 'green', firstAttemptAccuracy: 'green' },
    lead: null, headline: 'Daily work done: 60 mistake-book questions.', tone: 'good'
  },
  {
    n: 3, name: 'slow and short',
    examAhead: EXAM_AHEAD,
    news: (function () {
      var out = [[0, 'cm', T, 140], [0, 'em', F, 150], [0, 'qm', T, 160], [0, 'th', F, 170], [0, 'at', F, 180]];
      for (var j = 0; j < 19; j++) out.push([1 + (j % 6), ['cm', 'em', 'qm'][j % 3], j < 10, 120]);
      return out;
    }()),
    retakes: [[0, 10, 60]],             // 10 retakes, 10 min
    bands: { dailyWork: 'red', paceSec: 'red', firstAttemptAccuracy: 'red' },
    // all three off target: Daily work leads; accuracy is 2 + 10 right of 24 = 50%
    lead: 'dailyWork', headline: '50 mistake-book questions to go today.', tone: 'attention'
  },
  {
    n: 4, name: 'mock today',
    examAhead: EXAM_AHEAD,
    news: (function () {
      var out = [];
      for (var i = 0; i < 16; i++) out.push([1, ['cm', 'em', 'qm', 'th'][i % 4], true, 95]);
      return out;
    }()),
    mocks: [0],
    bands: { dailyWork: 'green', paceSec: 'none', firstAttemptAccuracy: 'green' },
    lead: null, headline: 'Full mock submitted today.', tone: 'good'
  },
  {
    n: 5, name: 'after the last target day',
    examAhead: 2,                       // exam in 2 days: the last target day was yesterday
    news: [[1, 'cm', T, 95], [1, 'em', T, 95]],
    retakes: [[0, 5, 60], [1, 41, 60]],
    bands: { dailyWork: 'none', paceSec: 'none', firstAttemptAccuracy: 'green' },
    lead: null, headline: 'No daily target today.', tone: 'rest'
  },
  {
    n: 6, name: 'one short of the new minimum',
    examAhead: EXAM_AHEAD,
    news: [[1, 'cm', T, 95], [1, 'em', T, 95]],
    retakes: [[0, 59, 60]],
    bands: { dailyWork: 'amber', paceSec: 'none', firstAttemptAccuracy: 'green' },
    lead: 'dailyWork', headline: '1 mistake-book question to go today.', tone: 'attention'
  },
  {
    n: 7, name: 'the old minimum no longer meets the target',
    examAhead: EXAM_AHEAD,
    news: [[1, 'cm', T, 95], [1, 'em', T, 95]],
    retakes: [[0, 40, 60]],
    bands: { dailyWork: 'amber', paceSec: 'none', firstAttemptAccuracy: 'green' },
    lead: 'dailyWork', headline: '20 mistake-book questions to go today.', tone: 'attention'
  }
];

/* Runs in the page: every clock read moves forward by `off` ms. */
function clockShim(off) {
  var R = Date;
  function F() {
    if (!(this instanceof F)) return new R(R.now() + off).toString();
    if (arguments.length === 0) return new R(R.now() + off);
    return new (Function.prototype.bind.apply(R, [null].concat([].slice.call(arguments))))();
  }
  F.prototype = R.prototype;
  F.now = function () { return R.now() + off; };
  F.parse = R.parse;
  F.UTC = R.UTC;
  window.Date = F;
}

/* ——— Chrome + CDP plumbing (same pattern as test-pack-launch-chrome.js) ——— */
function freePort() {
  return new Promise(function (resolve, reject) {
    var srv = net.createServer();
    srv.listen(0, '127.0.0.1', function () { var p = srv.address().port; srv.close(function () { resolve(p); }); });
    srv.on('error', reject);
  });
}
function findChrome() {
  var c = [process.env.CHROME_BIN, process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  for (var i = 0; i < c.length; i++) { try { fs.accessSync(c[i], fs.constants.X_OK); return c[i]; } catch (e) {} }
  return null;
}
function stopChrome(proc) {
  return new Promise(function (resolve) {
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return resolve();
    var done = false;
    var finish = function () { if (done) return; done = true; clearTimeout(timer); resolve(); };
    var timer = setTimeout(function () { try { proc.kill('SIGKILL'); } catch (e) {} setTimeout(finish, 1000); }, 5000);
    proc.once('exit', finish);
    try { proc.kill(); } catch (e) { finish(); }
  });
}
var server = http.createServer(function (req, res) {
  var reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
  var filePath = path.join(ROOT, decodeURIComponent(reqPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

async function main() {
  var chromeBin = findChrome();
  if (!chromeBin) { console.error('LAUNCHER_UNAVAILABLE: Chrome binary not found'); process.exit(2); }
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  await new Promise(function (r) { server.listen(PORT, '127.0.0.1', r); });
  var base = 'http://127.0.0.1:' + server.address().port;
  var cdpPort = CDP_PORT || await freePort();
  console.log('HTTP ' + base + '  CDP ' + cdpPort);
  var userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgre-intensity-chrome-'));
  var chrome = spawn(chromeBin, ['--headless=new', '--remote-debugging-port=' + cdpPort,
    '--user-data-dir=' + userDataDir, '--no-first-run', '--window-size=1280,900',
    base + '/__blank__'], { stdio: 'ignore' });

  var pageErrors = [];
  var bridge = { sent: 0, answered: 0 };
  var ws = null;
  try {
    var wsUrl = null;
    for (var i = 0; i < 50 && !wsUrl; i++) {
      await sleep(200);
      try {
        var list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json/list')).json();
        var page = list.find(function (t) { return t.type === 'page'; });
        if (page && page.webSocketDebuggerUrl) wsUrl = page.webSocketDebuggerUrl;
      } catch (e) { /* not up yet */ }
    }
    if (!wsUrl) throw new Error('no CDP page target');
    ws = new WebSocket(wsUrl);
    var idSeq = 1;
    var pending = new Map();
    ws.onmessage = function (ev) {
      var msg = JSON.parse(ev.data);
      if (msg.method === 'Runtime.exceptionThrown') {
        var d = msg.params && msg.params.exceptionDetails;
        pageErrors.push((d && d.exception && d.exception.description) || (d && d.text) || JSON.stringify(d));
      }
      if (msg.method === 'Network.requestWillBeSent' && isBridgeUrl(msg.params.request.url)) bridge.sent++;
      if (msg.method === 'Network.responseReceived' && isBridgeUrl(msg.params.response.url)) bridge.answered++;
      if (msg.id && pending.has(msg.id)) {
        var p = pending.get(msg.id); pending.delete(msg.id);
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error))); else p.resolve(msg.result);
      }
    };
    await new Promise(function (res, rej) { ws.onopen = res; ws.onerror = rej; });
    function send(method, params) {
      return new Promise(function (resolve, reject) {
        var id = idSeq++;
        pending.set(id, { resolve: resolve, reject: reject });
        ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
      });
    }
    async function ev(expression) {
      var res = await send('Runtime.evaluate', { expression: expression, returnByValue: true, awaitPromise: true });
      if (res.exceptionDetails) throw new Error('evaluate: ' + JSON.stringify(res.exceptionDetails).slice(0, 600));
      return res.result.value;
    }
    async function waitFor(expression, label, tries) {
      for (var t = 0; t < (tries || 80); t++) {
        try { if (await ev(expression)) return true; } catch (e) { /* page mid-navigation */ }
        await sleep(100);
      }
      throw new Error('timed out waiting for ' + label);
    }
    async function go(url) {
      await send('Page.navigate', { url: url });
      await sleep(250);
    }
    /* Clip from the top of `selector` to the bottom of `untilSelector`
       (default: the same element). The page is scrolled so the element
       starts below the sticky top bar. */
    async function shotOf(selector, file, untilSelector) {
      var rect = await ev('(function(){var el=document.querySelector(' + JSON.stringify(selector) + ');' +
        'var end=document.querySelector(' + JSON.stringify(untilSelector || selector) + ');' +
        'var toasts=document.getElementById("toasts");if(toasts)toasts.style.visibility="hidden";' +
        'var r=el.getBoundingClientRect();var top=r.top+window.scrollY;' +
        'window.scrollTo(0,Math.max(0,top-90));r=el.getBoundingClientRect();var e=end.getBoundingClientRect();' +
        'return {x:r.left+window.scrollX,y:r.top+window.scrollY,w:r.width,h:e.bottom-r.top};})()');
      await sleep(400);
      var shot = await send('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: true,
        clip: { x: Math.max(0, rect.x - 12), y: Math.max(0, rect.y - 12), width: rect.w + 24, height: rect.h + 24, scale: 1 }
      });
      var out = path.join(ARTIFACT_DIR, file);
      fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
      console.log('  screenshot ' + out);
    }

    await send('Runtime.enable', {});
    await send('Page.enable', {});
    /* js/status.js posts the status summary to the OrbitOS status bridge on
       127.0.0.1:4789. Block that port, so a seeded test history never
       replaces the snapshot that agents read for the real study data. */
    await send('Network.enable', {});
    await send('Network.setBlockedURLs', { urls: ['*://127.0.0.1:' + BRIDGE_PORT + '/*', '*://localhost:' + BRIDGE_PORT + '/*'] });

    /* Seed on a script-free page of the same origin, then open the app. */
    async function seedAndOpen(seed) {
      await go(base + '/__blank__');
      await waitFor('document.readyState === "complete" && !window.PGRE', 'blank page');
      await ev('localStorage.clear(); sessionStorage.clear(); localStorage.setItem("pgre-state-v1", ' +
        JSON.stringify(JSON.stringify(seed)) + '); true');
      await go(base + '/#/plan');
      await waitFor('!!document.getElementById("intensity-card")', 'the Intensity card');
      // Round 2: the card sits inside a folded archive card — open it first.
      await ev('(function(){var c=document.getElementById("intensity-card");var d=c&&c.closest("details");if(d&&!d.open)d.open=true;return true;})()');
      await sleep(300);
    }
    /* The card as a reader meets it. A row's own chip is the direct child of
       its button (the opened panel lists all three bands). The topic table
       sits in a closed disclosure, so its cells are read as textContent. */
    async function readCard() {
      return ev('(function(){var out={rows:{},strip:[],topics:[]};' +
        'function t(el){return el?el.textContent.replace(/\\s+/g," ").trim():"";}' +
        'var card=document.getElementById("intensity-card");' +
        'card.querySelectorAll(".intensity-row").forEach(function(r){' +
          'var chip=r.querySelector(".intensity-toggle > .band-chip");var hint=r.querySelector(".intensity-hint");' +
          'var link=r.querySelector(".intensity-next a");var delta=r.querySelector(".intensity-delta");' +
          'var btn=r.querySelector(".intensity-toggle");var val=r.querySelector(".intensity-value");' +
          'out.rows[r.getAttribute("data-metric")]={band:r.getAttribute("data-band"),show:r.getAttribute("data-show"),' +
          'value:t(val),preview:t(r.querySelector(".intensity-preview")),chip:chip?t(chip):null,' +
          'chipBand:chip&&chip.getAttribute("data-band"),hint:t(hint),link:link?link.getAttribute("href"):null,' +
          'delta:delta?t(delta).replace(" since your last look,",""):"",expanded:btn.getAttribute("aria-expanded"),' +
          'meter:!!r.querySelector(".imeter")};});' +
        'card.querySelectorAll(".iweek-day").forEach(function(c){out.strip.push({retakes:Number(c.getAttribute("data-retakes")),' +
          'mocks:Number(c.getAttribute("data-mocks")),band:c.getAttribute("data-band")});});' +
        'card.querySelectorAll("#intensity-adjust tbody tr").forEach(function(tr){var td=tr.querySelectorAll("td");' +
          'out.topics.push({topic:tr.getAttribute("data-topic"),band:tr.getAttribute("data-band"),' +
          'weight:t(td[1]),n:Number(t(td[2])),acc:t(td[3]),bandText:t(td[4])});});' +
        'var v=card.querySelector(".intensity-verdict");var a=v.querySelector("a");' +
        'out.verdict={tone:v.getAttribute("data-tone"),mark:v.getAttribute("data-mark"),focus:v.getAttribute("data-focus"),' +
          'headline:t(v.querySelector(".intensity-headline")),detail:t(v.querySelector(".intensity-detail")),' +
          'href:a?a.getAttribute("href"):null,label:a?t(a):null,primary:a?a.classList.contains("btn-primary"):false};' +
        'out.tally=Array.prototype.map.call(card.querySelectorAll(".intensity-tally-item"),t).join(" ");' +
        'out.empty=card.classList.contains("is-empty");' +
        'out.week=!!card.querySelector("#intensity-week");out.adjust=!!card.querySelector("#intensity-adjust");' +
        'out.tabindex0=card.querySelectorAll("[tabindex=\\"0\\"]").length;' +
        'var ids=Array.prototype.map.call(document.getElementById("view").children,function(c){return c.id||c.className;});' +
        'out.order=ids;return out;})()');
    }
    /* A real mouse click in the middle of an element. */
    async function clickOn(selector) {
      var p = await ev('(function(){var e=document.querySelector(' + JSON.stringify(selector) + ');' +
        'e.scrollIntoView({block:"center"});var r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()');
      await sleep(150);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
      await sleep(250);
    }
    async function pressKey(key, code, vk) {
      // No nativeVirtualKeyCode: 13 is the W key on macOS, and headless Chrome
      // then floods the page with key events that starve the toggle event.
      var base = { key: key, code: code, windowsVirtualKeyCode: vk };
      await send('Input.dispatchKeyEvent', Object.assign({ type: 'rawKeyDown' }, base));
      if (key === 'Enter') await send('Input.dispatchKeyEvent', Object.assign({ type: 'char', text: '\r' }, base));
      if (key === ' ') await send('Input.dispatchKeyEvent', Object.assign({ type: 'char', text: ' ' }, base));
      await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
      await sleep(150);
    }
    function rowSel(metric) { return '#intensity-card .intensity-row[data-metric="' + metric + '"]'; }
    /* How the readings are laid out: stacked or one line, and how many
       names touch their meter or are cut off. */
    function rowLayout() {
      return ev('(function(){var card=document.getElementById("intensity-card");var clash=0;' +
        'card.querySelectorAll(".intensity-toggle").forEach(function(b){var n=b.querySelector(".intensity-label"),m=b.querySelector(".imeter"),' +
        'box=b.querySelector(".intensity-name");if(!n||!m)return;var a=n.getBoundingClientRect(),q=m.getBoundingClientRect();' +
        'if(a.right>q.left+0.5&&a.bottom>q.top&&a.top<q.bottom)clash++;if(box.scrollWidth>box.clientWidth+1)clash++;});' +
        'var side=document.getElementById("sidebar");var sr=side?side.getBoundingClientRect():null;' +
        'return {stacked:/read read read/.test(getComputedStyle(card.querySelector(".intensity-toggle")).gridTemplateAreas),clash:clash,' +
        'card:Math.round(card.getBoundingClientRect().width),sidebar:sr&&sr.right>0&&getComputedStyle(side).display!=="none"?Math.round(sr.width):0,' +
        'overflow:document.documentElement.scrollWidth-window.innerWidth};})()');
    }
    /* Per reading: how many band limits are marked as current, and whether
       the marked one carries the same word as the row's chip. */
    function bandMarks() {
      return ev('(function(){var out={};document.querySelectorAll("#intensity-card .intensity-row").forEach(function(row){' +
        'var chip=row.querySelector(".intensity-toggle > .band-chip");var now=row.querySelectorAll(".intensity-cuts li.is-now");' +
        'out[row.getAttribute("data-metric")]={n:now.length,show:row.getAttribute("data-show"),' +
        'same:now.length===1&&!!chip&&now[0].querySelector(".band-chip").textContent.trim()===chip.textContent.trim()};});return out;})()');
    }
    async function panelOf(metric) {
      return ev('(function(){var b=document.querySelector(' + JSON.stringify(rowSel(metric) + ' .intensity-toggle') + ');' +
        'var p=document.getElementById(b.getAttribute("aria-controls"));' +
        'return {expanded:b.getAttribute("aria-expanded"),hidden:p.hidden,height:p.offsetHeight,' +
        'text:p.innerText.replace(/\\s+/g," ").trim(),' +
        'links:Array.prototype.map.call(p.querySelectorAll("a"),function(a){return a.getAttribute("href");})};})()');
    }

    var METRICS = ['dailyWork', 'firstAttemptAccuracy', 'paceSec', 'repeatMinutes', 'newQuestions'];
    var WORK_ADVICE = MOCK_TODAY ? 'Today is the full-mock day: a submitted mock meets the target on its own.'
      : 'A full mock submitted today also meets the target.';
    var WORK_HREF = MOCK_TODAY ? '#/exam' : '#/mistakes';

    for (var s = 0; s < SPECS.length; s++) {
      var spec = SPECS[s];
      spec.examDate = dayAhead(spec.examAhead);
      var seed = buildSeed(spec);
      var want = expectFor(spec);
      pageErrors.length = 0;
      console.log('\nhistory ' + spec.n + ' (' + spec.name + ')');
      await seedAndOpen(seed);
      var card = await readCard();

      if (s === 0) {
        check(await ev('(function(){var d=document.getElementById("intensity-card")&&document.getElementById("intensity-card").closest("details");' +
          'return !!d && !!d.querySelector("#intensity-card");})()'),
          'the Intensity card sits inside the folded archive card');
        check(Object.keys(card.rows).join(',') === METRICS.join(','),
          'five readings, Daily work first: ' + Object.keys(card.rows).join(', '));
      }
      var lead = leadOf(want);
      METRICS.forEach(function (m) {
        var row = card.rows[m] || {};
        var shown = shownAs(m, want[m].band);
        check(row.value === want[m].text, m + ' shows "' + want[m].text + '" (got "' + row.value + '")');
        check(row.band === want[m].band && row.chipBand === shown.band && row.chip === shown.chip && row.show === shown.show,
          m + ' band is ' + want[m].band + ' with the label "' + shown.chip + '" (got ' +
          row.band + ' / ' + row.chip + ')');
        if (spec.bands[m]) {
          check(want[m].band === spec.bands[m], m + ' lands in the ' + spec.bands[m] + ' band this history was built for');
        }
        // The headline block speaks for the leading row, so that row prints no hint.
        var off = shown.show === 'amber' || shown.show === 'red';
        check((off && m !== lead) === (row.hint !== '') || (m === 'dailyWork' && !want.dailyWork.hasTarget && row.hint !== ''),
          m + (!off ? ' has no hint when ' + shown.show
            : (m === lead ? ' is the headline, so it prints no second hint' : ' carries a hint when ' + shown.show)));
        check(row.meter && row.expanded === 'false', m + ' has a meter and starts closed');
      });
      check(lead === spec.lead && (card.verdict.focus || null) === lead && card.verdict.tone === spec.tone &&
        card.verdict.headline === spec.headline,
        'headline: "' + spec.headline + '" (got "' + card.verdict.headline + '", about ' + card.verdict.focus + ')');
      check(card.verdict.mark === (lead ? want[lead].band : (spec.tone === 'good' ? 'green' : 'none')),
        'the headline carries the band shape of the reading it is about (' + card.verdict.mark + ')');
      if (lead === 'dailyWork') {
        check(card.verdict.href === WORK_HREF && card.verdict.primary === true &&
          card.verdict.label === (MOCK_TODAY ? 'Open Mock exam →' : 'Open Mistake book →'),
          'the one button opens ' + (MOCK_TODAY ? 'the mock exam (today is Sunday)' : 'the mistake book') +
          ' (got ' + card.verdict.href + ')');
        check(card.verdict.detail.indexOf(WORK_ADVICE) === 0,
          'the detail says a full mock also meets the target (got "' + card.verdict.detail + '")');
        check(METRICS.every(function (m) { return card.rows[m].link !== card.verdict.href; }),
          'no row repeats the headline button');
      } else {
        check(card.verdict.href === null, 'with nothing to do the headline has no button (' + card.verdict.href + ')');
      }
      var counts = { green: 0, amber: 0, red: 0, none: 0, rest: 0 };
      METRICS.forEach(function (m) { counts[shownAs(m, want[m].band).show]++; });
      var tallyWant = [[counts.green, 'on target'], [counts.amber, 'close'], [counts.red, 'off target'],
                       [counts.none, 'no data'], [counts.rest, 'without a target']]
        .filter(function (x) { return x[0]; }).map(function (x) { return x[0] + ' ' + x[1]; }).join(' ');
      check(card.tally === tallyWant, 'tally: "' + tallyWant + '" (got "' + card.tally + '")');
      check(card.tabindex0 === 0, 'no chart bar is a tab stop');
      var stripWant = want.strip.map(function (x) { return x.retakes + ':' + x.mocks + ':' + x.band; }).join(' ');
      var stripGot = card.strip.map(function (x) { return x.retakes + ':' + x.mocks + ':' + x.band; }).join(' ');
      check(stripGot === stripWant, 'Daily work strip (retakes:mocks:band), oldest first: ' + stripWant + ' (got ' + stripGot + ')');

      var payload = await ev('PGRE.buildStatusSummary().intensity');
      METRICS.forEach(function (m) {
        check(payload[m].value === want[m].value && payload[m].band === (want[m].band === 'none' ? null : want[m].band),
          'status payload ' + m + ' = ' + want[m].value + ' (' + want[m].band + ')');
      });
      check(payload.dailyWork.lastTargetDay === want.dailyWork.lastTargetDay &&
        payload.dailyWork.threshold === (want.dailyWork.hasTarget ? 60 : null) &&
        payload.dailyWork.mocks.length === (want.dailyWork.mock ? 1 : 0) &&
        payload.newQuestions.threshold === null && payload.repeatMinutes.threshold === null,
        'status payload: last target day ' + want.dailyWork.lastTargetDay + ', target ' +
        (want.dailyWork.hasTarget ? 60 : 'none') + '; no target for new questions or repeat time');
      check(payload.firstAttemptAccuracy.n === want.firstAttemptAccuracy.n &&
        payload.firstAttemptAccuracy.correct === want.firstAttemptAccuracy.correct,
        'status payload accuracy counts ' + want.firstAttemptAccuracy.correct + ' of ' + want.firstAttemptAccuracy.n);
      check(payload.topics.map(function (t) { return t.topic; }).join(',') ===
        card.topics.map(function (t) { return t.topic; }).join(','),
        'status payload topic rows are in the same order as the table');

      if (spec.n === 4) {
        var foot = await ev('document.querySelector("#intensity-card .iweek-day.is-today .iweek-pace").textContent.trim()');
        check(foot === 'mock' && card.rows.dailyWork.value === '0 full mock submitted',
          'a mock submitted today: the row reads "0 full mock submitted" and the strip marks today "mock"');
      }
      if (spec.n === 5) {
        var rest = await ev('Array.prototype.map.call(document.querySelectorAll("#intensity-card .iweek-day"),function(c){' +
          'return c.classList.contains("is-rest")?"rest":"target";}).join(" ")');
        check(rest === 'target target target target target target rest',
          'the strip steps back on the day without a target (got "' + rest + '")');
        check(card.verdict.detail.indexOf('The daily target ended on ' +
          new Date(want.dailyWork.lastTargetDay + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
          ', 3 days before the exam on ') === 0, 'the detail gives the end date (got "' + card.verdict.detail + '")');
      }

      if (s === 0) {
        /* Use the card: open a reading with the mouse, then with the keyboard. */
        console.log('\nopening a reading (history 1)');
        var workBefore = await panelOf('dailyWork');
        check(workBefore.expanded === 'false' && workBefore.hidden === true && workBefore.height === 0,
          'the Daily work explanation is closed and takes no room at first');
        await clickOn(rowSel('dailyWork') + ' .intensity-toggle');
        var workOpen = await panelOf('dailyWork');
        check(workOpen.expanded === 'true' && workOpen.hidden === false && workOpen.height > 40,
          'a click on the Daily work row opens how it is computed');
        check(workOpen.text.indexOf('Counts your answers in the mistake book today (30 retakes). ' +
            'A full mock submitted today meets the target on its own.') >= 0 &&
          workOpen.text.indexOf('New material comes from the Sunday full mocks; the other days go to the mistake book.') >= 0 &&
          workOpen.text.indexOf('The target of 60 a day runs through ' +
            new Date(want.dailyWork.lastTargetDay + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
            ', 3 days before the exam on ') >= 0,
          'it says what counts, why, and through which date');
        check(/On target 60 or more, or a full mock Close 25 to 59 Off target under 25/.test(workOpen.text),
          'it lists the three bands and their limits');
        check(workOpen.links.indexOf('#/mistakes') >= 0 && workOpen.links.indexOf('#/exam') >= 0,
          'it links to the mistake book and the mock exam');
        var marks = await bandMarks();
        check(METRICS.every(function (m) {
          var judged = marks[m].show === 'green' || marks[m].show === 'amber' || marks[m].show === 'red';
          return judged ? marks[m].n === 1 && marks[m].same : marks[m].n === 0;
        }), 'in each reading the one band limit marked as current is the band on its chip; a reading without a band marks none');
        var daySay = await ev('Array.prototype.map.call(document.querySelectorAll("#intensity-card .iweek-day .ivh"),' +
          'function(e){return e.textContent;})');
        check(daySay.length === 7 && daySay.every(function (t) {
          return /^\w+, \w+ \d+: \d+ mistake-book questions?(, full mock submitted)? \((on target|close|off target)\)\.$/.test(t);
        }) && daySay.some(function (t) { return /full mock submitted \(on target\)/.test(t); }),
          'each day\'s sentence for screen readers gives the count and the band as a word, for example "' + daySay[6] + '"');
        await clickOn(rowSel('newQuestions') + ' .intensity-toggle');
        var nqOpen = await panelOf('newQuestions');
        check(nqOpen.expanded === 'true' && (await panelOf('dailyWork')).expanded === 'true',
          'a second reading opens without closing the first');
        check(/No daily target: new material comes from the Sunday full mocks\./.test(nqOpen.text) &&
          /Mistake-book retakes, the question of the day and mock exams do not count/.test(nqOpen.text) &&
          !/On target|Off target/.test(nqOpen.text),
          'New questions explains what counts and why it has no target, and prints no band limits');
        await shotOf('#intensity-card', 'intensity-card-open.png');
        await clickOn(rowSel('newQuestions') + ' .intensity-toggle');
        await clickOn(rowSel('dailyWork') + ' .intensity-toggle');
        check((await panelOf('dailyWork')).hidden === true && (await panelOf('newQuestions')).hidden === true,
          'a second click closes each one again');
        await ev('document.querySelector(' + JSON.stringify(rowSel('paceSec') + ' .intensity-toggle') + ').focus(); true');
        await pressKey('Enter', 'Enter', 13);
        var paceOpen = await panelOf('paceSec');
        check(paceOpen.expanded === 'true' && /103 s or under Close 104 to 130 s Off target over 130 s/.test(paceOpen.text),
          'Enter on a focused reading opens it: pace limits 103, 104 to 130, over 130');
        await pressKey(' ', 'Space', 32);
        check((await panelOf('paceSec')).expanded === 'false', 'Space closes it');
        var tabOrder = await ev('(function(){var card=document.getElementById("intensity-card");' +
          'return Array.prototype.filter.call(card.querySelectorAll("a[href],button,summary"),function(e){' +
          'return e.offsetParent!==null && !e.closest("[hidden]") && !(e.closest("details:not([open])") && e.tagName!=="SUMMARY");})' +
          '.map(function(e){return e.tagName.toLowerCase()+(e.classList.contains("intensity-toggle")?":reading":"");});})()');
        check(tabOrder.filter(function (x) { return x === 'button:reading'; }).length === 5 && tabOrder.length <= 12,
          'the card has ' + tabOrder.length + ' tab stops: the five readings, the links and the topic table');

        /* The topic table: closed at first, and it remembers being opened. */
        var topicsOpen0 = await ev('document.getElementById("intensity-topics").open');
        await clickOn('#intensity-topics > summary');
        var topicsOpen1 = await ev('document.getElementById("intensity-topics").open');
        var savedOpen = await ev('JSON.parse(localStorage.getItem("pgre-state-v1")).settings.intensityTopicsOpen');
        check(topicsOpen0 === false && topicsOpen1 === true && savedOpen === true,
          'the 9-topic table opens on request and the choice is saved as settings.intensityTopicsOpen');
        var focusLine = await ev('document.querySelector("#intensity-adjust .intensity-focus").innerText.replace(/\\s+/g," ").trim()');
        check(/^Where to adjust Classical Mechanics Off target 50% on 10 new questions in 14 days, 20% of the exam\./.test(focusLine),
          'above the table one line names the topic to work on: Classical Mechanics, 50% on 10 (got "' + focusLine + '")');
        var focusHref = await ev('(function(){var a=document.querySelector("#intensity-adjust .intensity-focus a.btn");return a?a.getAttribute("href"):null;})()');
        check(focusHref === '#/practice/cm/new' || focusHref === '#/topic/cm',
          'with a link into that topic (' + focusHref + ')');
        await go(base + '/#/plan');
        await waitFor('!!document.getElementById("intensity-card")', 'the Intensity card after a reload');
        await ev('(function(){var c=document.getElementById("intensity-card");var d=c&&c.closest("details");if(d&&!d.open)d.open=true;return true;})()');
        await sleep(300);
        check(await ev('document.getElementById("intensity-topics").open') === true, 'the table is still open after a reload');
        var stateKeys = await ev('Object.keys(JSON.parse(localStorage.getItem("pgre-state-v1")).settings).sort().join(",")');
        check(/(^|,)intensityTopicsOpen(,|$)/.test(stateKeys) && /(^|,)examDate(,|$)/.test(stateKeys) && /(^|,)paceTargetSec(,|$)/.test(stateKeys),
          'the new preference sits beside the existing settings, which are kept');

        /* Days shown in the strip: 7 by default, 30 or a custom 2-90 on request, kept across a reload. */
        function strip() {
          return ev('(function(){var f=document.getElementById("intensity-week"),l=f.querySelector(".iweek-days");' +
            'return {n:f.querySelectorAll(".iweek-day").length,title:f.querySelector(".iweek-title strong").textContent,' +
            'long:f.classList.contains("is-long"),p7:document.getElementById("iweek-range-7").getAttribute("aria-pressed"),' +
            'p30:document.getElementById("iweek-range-30").getAttribute("aria-pressed"),' +
            'custom:document.getElementById("iweek-range-custom").value,last:f.querySelector(".iweek-day:last-child").getAttribute("data-day"),' +
            'atEnd:l.scrollLeft+l.clientWidth>=l.scrollWidth-1,' +
            'saved:JSON.parse(localStorage.getItem("pgre-state-v1")).settings.intensityTrendDays};})()');
        }
        var r7 = await strip();
        check(r7.n === 7 && r7.title === 'Last 7 days' && r7.p7 === 'true' && r7.p30 === 'false' && r7.custom === '',
          'the strip shows 7 days by default with "7 days" pressed (got ' + JSON.stringify(r7) + ')');
        await clickOn('#iweek-range-30');
        var r30 = await strip();
        check(r30.n === 30 && r30.title === 'Last 30 days' && r30.long && r30.p30 === 'true' && r30.p7 === 'false' &&
          r30.saved === 30 && r30.last === dayAgo(0) && r30.atEnd,
          '"30 days" shows 30 columns ending today, scrolled to today, saved as settings.intensityTrendDays (got ' +
          JSON.stringify(r30) + ')');
        await shotOf('#intensity-week', 'intensity-strip-30.png');
        await clickOn('#iweek-range-custom');
        await send('Input.insertText', { text: '14' });
        await ev('document.getElementById("iweek-range-custom").blur(); true');
        await sleep(250);
        var r14 = await strip();
        check(r14.n === 14 && r14.title === 'Last 14 days' && r14.custom === '14' && r14.p7 === 'false' &&
          r14.p30 === 'false' && r14.saved === 14,
          'a custom 14 shows 14 days and keeps 14 in the field (got ' + JSON.stringify(r14) + ')');
        await ev('(function(){var i=document.getElementById("iweek-range-custom");i.value="200";' +
          'i.dispatchEvent(new Event("change",{bubbles:true}));return true;})()');
        await sleep(250);
        var rBad = await strip();
        check(rBad.n === 14 && rBad.custom === '14' && rBad.saved === 14,
          'a custom 200 (over 90) changes nothing and puts 14 back in the field (got ' + JSON.stringify(rBad) + ')');
        await go(base + '/#/plan');
        await waitFor('!!document.getElementById("intensity-week")', 'the strip after a reload');
        await ev('(function(){var c=document.getElementById("intensity-card");var d=c&&c.closest("details");if(d&&!d.open)d.open=true;return true;})()');
        await sleep(300);
        var rReload = await strip();
        check(rReload.n === 14 && rReload.custom === '14', 'the custom 14 days survive a reload');
        await clickOn('#iweek-range-7');
        var rBack = await strip();
        check(rBack.n === 7 && !rBack.long && rBack.p7 === 'true' && rBack.custom === '' && rBack.saved === 7,
          '"7 days" goes back to the week strip and clears the field (got ' + JSON.stringify(rBack) + ')');
      }

      if (spec.topicOrder) {
        check(card.topics.map(function (t) { return t.topic; }).join(',') === spec.topicOrder.join(','),
          'Where to adjust order: ' + spec.topicOrder.join(', '));
        card.topics.forEach(function (t) {
          var wantBand = spec.topicBands[t.topic];
          var okBand = t.band === wantBand &&
            (wantBand === 'none' ? t.bandText === 'too few to judge' : t.bandText === CHIP[wantBand]);
          var okAcc = wantBand === 'none' ? t.acc === '—' : t.acc === spec.topicAcc[t.topic];
          check(okBand && okAcc && t.n === spec.topicNew[t.topic],
            t.topic + ': ' + spec.topicNew[t.topic] + ' new, ' +
            (wantBand === 'none' ? 'too few to judge' : spec.topicAcc[t.topic] + ', ' + wantBand) +
            ' (got ' + t.n + ', ' + t.acc + ', ' + t.bandText + ')');
        });
        check(card.topics[0].weight === '20%' && card.topics[1].weight === '18%',
          'topic rows show the ETS weight');
      }

      if (s === 0) {
        await shotOf('#intensity-card', 'intensity-card-light.png');
        // Phone width: no horizontal page scroll.
        await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
        await sleep(500);
        var overflow = await ev('document.documentElement.scrollWidth - window.innerWidth');
        check(overflow <= 0, 'at 375 px the page has no horizontal scroll (overflow ' + overflow + ' px)');
        var cardFits = await ev('(function(){var r=document.getElementById("intensity-card").getBoundingClientRect();' +
          'return r.right <= window.innerWidth + 0.5 && r.left >= -0.5;})()');
        check(cardFits, 'at 375 px the Intensity card fits the viewport');
        // The topic table is open here (see above); open one reading too.
        await ev('document.querySelector(' + JSON.stringify(rowSel('dailyWork') + ' .intensity-toggle') + ').click(); true');
        await sleep(250);
        var tableFits = await ev('(function(){var c=document.getElementById("intensity-card").getBoundingClientRect();' +
          'var bad=[];document.querySelectorAll("#intensity-card .intensity-table td, #intensity-card .intensity-toggle > *, ' +
          '#intensity-card .intensity-next > *, #intensity-card .intensity-more > *, #intensity-card .intensity-verdict > *, ' +
          '#intensity-card .iweek-day, #intensity-card .iweek-day > *, #intensity-card .intensity-focus > *, #intensity-card .intensity-tally-item")' +
          '.forEach(function(el){if(el.classList.contains("ivh"))return;var r=el.getBoundingClientRect();' +
          'if(r.width&&(r.right>c.right-1||r.left<c.left+1))bad.push(el.className);});return bad;})()');
        check(tableFits.length === 0, 'at 375 px every row, strip cell, opened panel and table cell stays inside the card' +
          (tableFits.length ? ' (outside: ' + tableFits.join(', ') + ')' : ''));
        var overflow2 = await ev('document.documentElement.scrollWidth - window.innerWidth');
        check(overflow2 <= 0, 'with a reading and the table open the page still has no horizontal scroll (overflow ' + overflow2 + ' px)');
        var touch = await ev('(function(){var small=[];document.querySelectorAll("#intensity-card .intensity-toggle, ' +
          '#intensity-card a.btn, #intensity-card summary, #intensity-card .iweek-range-btn, #intensity-card .iweek-range-custom").forEach(function(el){if(el.closest("[hidden]"))return;' +
          'var r=el.getBoundingClientRect();if(r.height&&r.height<43.5)small.push(el.className+":"+Math.round(r.height));});return small;})()');
        check(touch.length === 0, 'on a touch screen every control in the card is at least 44 px tall' +
          (touch.length ? ' (short: ' + touch.join(', ') + ')' : ''));
        await shotOf('#intensity-card', 'intensity-card-phone.png');
        await clickOn('#iweek-range-30');
        var phone30 = await ev('(function(){var c=document.getElementById("intensity-card").getBoundingClientRect(),' +
          'l=document.querySelector("#intensity-week .iweek-days").getBoundingClientRect();' +
          'return {page:document.documentElement.scrollWidth-window.innerWidth,inside:l.left>=c.left-0.5&&l.right<=c.right+0.5};})()');
        check(phone30.page <= 0 && phone30.inside,
          'at 375 px the 30-day strip scrolls inside the card and the page has no horizontal scroll (got ' +
          JSON.stringify(phone30) + ')');
        await shotOf('#intensity-week', 'intensity-strip-30-phone.png');
        await clickOn('#iweek-range-7');
        await ev('document.querySelector(' + JSON.stringify(rowSel('dailyWork') + ' .intensity-toggle') + ').click();' +
          'document.querySelector("#intensity-topics > summary").click(); true');
        await sleep(250);
        check(await ev('JSON.parse(localStorage.getItem("pgre-state-v1")).settings.intensityTopicsOpen') === false,
          'closing the table saves that too');
        await send('Emulation.clearDeviceMetricsOverride', {});
        await sleep(300);

        /* 900 px with the sidebar open: the card, not the window, is narrow. */
        var wide = await rowLayout();
        await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 800, deviceScaleFactor: 1, mobile: false });
        await sleep(500);
        var mid = await rowLayout();
        check(wide.stacked === false && wide.clash === 0,
          'at the full window width the readings are one line each (card ' + wide.card + ' px)');
        check(mid.sidebar > 200 && mid.card < wide.card && mid.stacked === true && mid.clash === 0 && mid.overflow <= 0,
          'at 900 px with the ' + mid.sidebar + ' px sidebar open the card is ' + mid.card + ' px wide: the readings stack, ' +
          'no name runs into its meter and the page does not scroll sideways (clashes ' + mid.clash + ', overflow ' + mid.overflow + ' px)');
        await send('Emulation.clearDeviceMetricsOverride', {});
        await sleep(300);

        /* Sit the pack: each answer takes 120 s on the page clock. */
        console.log('\npractice summary after a timed pack (history 1)');
        await ev('(function(){var real=Date.now;window.__pgreRealNow=real;window.__pgreOffset=0;' +
          'Date.now=function(){return real.call(Date)+window.__pgreOffset;};return true;})()');
        var launched = await ev('!!PGRE.launchPack(' + JSON.stringify(SIT_PACK) + ')');
        check(launched, 'PGRE.launchPack("' + SIT_PACK + '") opens the pack');
        await waitFor('!!document.getElementById("confirm-btn")', 'the first question');
        var sat = 0;
        for (var q = 0; q < 40; q++) {
          var state = await ev('document.getElementById("intensity-summary") ? "summary" : ' +
            '(document.getElementById("confirm-btn") ? "question" : (document.getElementById("next-btn") ? "feedback" : "wait"))');
          if (state === 'summary') break;
          if (state === 'question') {
            await ev('(function(){window.__pgreOffset+=120000;' +
              'document.querySelector(".choice[data-idx=\\"0\\"]").click();' +
              'document.getElementById("confirm-btn").click();return true;})()');
            sat++;
            await waitFor('!!document.getElementById("next-btn")', 'feedback ' + sat);
          } else if (state === 'feedback') {
            await ev('document.getElementById("next-btn").click(); true');
            await sleep(150);
          } else {
            await sleep(150);
          }
        }
        await waitFor('!!document.getElementById("intensity-summary")', 'the session summary');
        var summary = await ev('(function(){function line(k){var l=document.querySelector("[data-line=\\""+k+"\\"]");' +
          'return {band:l.getAttribute("data-band"),value:l.querySelector(".intensity-line-value").innerText.trim(),' +
          'label:l.querySelector(".intensity-line-label").innerText.trim(),chip:l.querySelector(".band-chip").innerText.trim()};}' +
          'return {pace:line("pace"),work:line("work"),heading:document.querySelector("#practice-root h1").innerText};})()');
        await sleep(1000); // the score percentage counts up for 900 ms
        await shotOf('#practice-root .practice-card', 'practice-summary-light.png', '#intensity-summary');
        var newAfter = want.newQuestions.value + sat;
        check(sat >= 1, 'answered ' + sat + ' question(s) of pack ' + SIT_PACK);
        check(/^Median seconds per question/.test(summary.pace.label) && /this pack/.test(summary.pace.label),
          'summary line 1 reads "Median seconds per question" for this pack');
        check(summary.pace.value === '120 / 103' && summary.pace.band === 'amber' && summary.pace.chip === CHIP.amber,
          'summary pace line: 120 / 103, amber (got ' + summary.pace.value + ', ' + summary.pace.band + ')');
        check(/^Mistake book today/.test(summary.work.label) && summary.work.value === '30 / 60' &&
          summary.work.band === 'amber' && summary.work.chip === CHIP.amber,
          'summary line 2: Mistake book today 30 / 60, amber; a pack does not move it (got ' +
          summary.work.value + ', ' + summary.work.band + ')');

        var receipts = await ev('(function(){var st=PGRE.store.state;return {last:st.lastAgentReceipt&&st.lastAgentReceipt.medianSec,' +
          'pack:st.packReceipts&&st.packReceipts[' + JSON.stringify(SIT_PACK) + ']&&st.packReceipts[' + JSON.stringify(SIT_PACK) + '].medianSec,' +
          'keys:st.packReceipts&&st.packReceipts[' + JSON.stringify(SIT_PACK) + ']?Object.keys(st.packReceipts[' + JSON.stringify(SIT_PACK) + ']):[]};})()');
        check(receipts.last === 120 && receipts.pack === 120,
          'the agent receipt and packReceipts["' + SIT_PACK + '"] carry medianSec 120');
        check(['pack', 'score', 'durationMin', 'missQids', 'ids', 'completedAt'].every(function (k) {
          return receipts.keys.indexOf(k) >= 0; }), 'the pack receipt keeps its existing fields');

        // Today's pace now includes the pack's answers, read from the log.
        var todayMs = await ev('(function(){var out=[];var seen={};var rows=PGRE.store.state.attempts.slice()' +
          '.map(function(r,i){return {r:r,i:i,t:Date.parse(r.ts)};}).sort(function(a,b){return (a.t-b.t)||(a.i-b.i);});' +
          'var d=new Date();var today=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");' +
          'rows.forEach(function(x){var r=x.r;var first=!seen[r.qid];seen[r.qid]=1;var t=new Date(r.ts);' +
          'var k=t.getFullYear()+"-"+String(t.getMonth()+1).padStart(2,"0")+"-"+String(t.getDate()).padStart(2,"0");' +
          'if(first&&r.mode==="practice"&&k===today)out.push(r.ms);});return out;})()');
        var paceAfter = Math.round(median(todayMs) / 1000);
        var after = await ev('PGRE.buildStatusSummary().intensity');
        check(after.newQuestions.value === newAfter && after.paceSec.value === paceAfter,
          'status payload after the pack: ' + newAfter + ' new today, pace ' + paceAfter + ' s');
        /* Follow the summary's own link back to the dashboard. */
        var link = await ev('(function(){var a=document.querySelector(".intensity-summary-link");' +
          'return {href:a.getAttribute("href"),focus:a.getAttribute("data-dash-focus")};})()');
        check(link.href === '#/plan' && link.focus === 'intensity-card', 'the summary link points at the Intensity card');
        await clickOn('.intensity-summary-link');
        await waitFor('!!document.getElementById("intensity-card") && location.hash === "#/plan"',
          'the Intensity card after the pack');
        await sleep(900);
        var landed = await ev('(function(){var r=document.getElementById("intensity-card").getBoundingClientRect();' +
          'var bar=document.getElementById("topbar").getBoundingClientRect();var a=document.activeElement;' +
          'return {top:Math.round(r.top),bar:Math.round(bar.bottom),scrollY:Math.round(window.scrollY),focus:a&&a.id,' +
          'flag:sessionStorage.getItem("pgre-dash-focus")};})()');
        check(landed.scrollY > 200 && landed.top >= landed.bar && landed.top <= landed.bar + 40,
          'the link lands on the card, just under the top bar (card top ' + landed.top + ' px, bar ends ' + landed.bar +
          ' px, page scrolled ' + landed.scrollY + ' px)');
        check(landed.focus === 'intensity-title' && landed.flag === null,
          'keyboard focus moves to the card heading, and the one-shot note is cleared');
        var card2 = await readCard();
        check(card2.rows.newQuestions.value === newAfter + ' no target' &&
          card2.rows.paceSec.value === paceAfter + ' s target 103 s or under',
          'the dashboard agrees with the summary and the payload after the pack');
        var paceDelta = paceAfter - want.paceSec.value;
        check(card2.rows.newQuestions.delta === '+' + sat &&
          card2.rows.paceSec.delta === (paceDelta ? (paceDelta > 0 ? '+' : '−') + Math.abs(paceDelta) + ' s' : ''),
          'each reading shows what the pack changed: new questions +' + sat + ', pace ' +
          (paceDelta ? (paceDelta > 0 ? '+' : '−') + Math.abs(paceDelta) + ' s' : 'unchanged') +
          ' (got "' + card2.rows.newQuestions.delta + '", "' + card2.rows.paceSec.delta + '")');
        check(card2.rows.repeatMinutes.delta === '' && card2.rows.dailyWork.delta === '',
          'a reading the pack did not move shows no change');
        await shotOf('#intensity-card', 'intensity-card-after-pack.png', rowSel('newQuestions'));
        await ev('location.hash = "#/"; true');
        await waitFor('!document.getElementById("intensity-card")', 'another page');
        await ev('location.hash = "#/plan"; true');
        await waitFor('!!document.getElementById("intensity-card")', 'the archive again');
        await ev('(function(){var c=document.getElementById("intensity-card");var d=c&&c.closest("details");if(d&&!d.open)d.open=true;return true;})()');
        await sleep(400);
        var card3 = await readCard();
        check(METRICS.every(function (m) { return card3.rows[m].delta === ''; }) &&
          await ev('window.scrollY') === 0,
          'the next visit opens at the top of the page with no change markers');

        /* A sibling tab records two more retakes; this tab repaints the card
           in place and keeps the opened reading and the focus. */
        await ev('(function(){var b=document.querySelector(' + JSON.stringify(rowSel('dailyWork') + ' .intensity-toggle') + ');' +
          'b.click();b.focus();return true;})()');
        var siblingSave = function (n) {
          return ev('(function(){var raw=localStorage.getItem("pgre-state-v1");var st=JSON.parse(raw);' +
            'var qid=st.attempts[0].qid;for(var i=0;i<' + n + ';i++){st.attempts.push({ts:new Date(window.__pgreRealNow.call(Date)-i*1000).toISOString(),' +
            'qid:qid,topic:"cm",picked:0,answer:0,correct:true,ms:60000,sid:"sibling",mode:"mistakes",confidence:null,tags:[]});}' +
            'st._rev=(st._rev||0)+3;var next=JSON.stringify(st);localStorage.setItem("pgre-state-v1",next);' +
            'window.dispatchEvent(new StorageEvent("storage",{key:"pgre-state-v1",oldValue:raw,newValue:next,' +
            'storageArea:localStorage,url:location.href}));return true;})()');
        };
        await siblingSave(2);
        await sleep(700);
        var card4 = await readCard();
        var keptFocus = await ev('(function(){var a=document.activeElement;var r=a&&a.closest&&a.closest(".intensity-row");' +
          'return r?r.getAttribute("data-metric"):null;})()');
        check(card4.rows.dailyWork.value === '32 of 60' && card4.rows.dailyWork.delta === '+2',
          'after a sibling tab saves 2 retakes the card reads 32 of 60 with "+2", without a reload (got "' +
          card4.rows.dailyWork.value + '", "' + card4.rows.dailyWork.delta + '")');
        check(card4.rows.dailyWork.expanded === 'true' && keptFocus === 'dailyWork',
          'the opened reading stays open and keeps the keyboard focus through that repaint');
        // Focus on a control that is not a reading: the topic disclosure, then a link in the opened panel.
        await ev('document.querySelector("#intensity-topics > summary").focus(); true');
        await siblingSave(1);
        await sleep(700);
        var card4b = await readCard();
        var keptTag = await ev('document.activeElement ? document.activeElement.tagName : null');
        check(card4b.rows.dailyWork.value === '33 of 60' && keptTag === 'SUMMARY',
          'focus on the topic disclosure survives a repaint too (now on ' + keptTag + ')');
        await ev('document.querySelector(' + JSON.stringify(rowSel('dailyWork') + ' .intensity-links a[href="#/exam"]') + ').focus(); true');
        await siblingSave(1);
        await sleep(700);
        var keptLink = await ev('(function(){var a=document.activeElement;return a&&a.closest("#intensity-card")?' +
          'a.tagName+" "+a.getAttribute("href"):(a?a.tagName:null);})()');
        check(keptLink === 'A #/exam', 'and so does focus on a link inside an opened reading (now on ' + keptLink + ')');
        await ev('Date.now = window.__pgreRealNow; true');

        /* The tab stays open past midnight: coming back to the window
           repaints the card for the new day. (The focus event is used here
           because a headless page may report itself hidden.) */
        await ev('(' + clockShim.toString() + ')(86400000); window.dispatchEvent(new Event("focus")); true');
        await sleep(600);
        var card5 = await readCard();
        var kicker = await ev('document.querySelector("#intensity-card .kicker").innerText');
        var tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
        var tomorrowLine = tomorrow.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase();
        check(kicker.toUpperCase() === tomorrowLine && card5.rows.dailyWork.value === '0 of 60' &&
          card5.rows.newQuestions.value === '0 no target' && card5.rows.paceSec.value === '— target 103 s or under',
          'after midnight the card shows the new day (' + kicker + ') with 0 retakes, 0 new questions and no pace, without a reload');
      }

      check(pageErrors.length === 0, 'no page errors' + (pageErrors.length ? ': ' + pageErrors.join(' | ') : ''));
      check(bridge.answered === 0, 'the status bridge on port ' + BRIDGE_PORT + ' received nothing (' + bridge.sent +
        ' request(s) blocked, ' + bridge.answered + ' answered)');
    }

    /* ——— A new user: nothing answered yet ——— */
    console.log('\nnew user (no answers)');
    pageErrors.length = 0;
    await seedAndOpen(buildSeed({ n: 8, news: [], examDate: dayAhead(EXAM_AHEAD) }));
    var fresh0 = await readCard();
    check(fresh0.empty === true && fresh0.verdict.tone === 'empty' && fresh0.verdict.headline === 'Nothing measured yet.',
      'the card says "Nothing measured yet."');
    check(fresh0.verdict.href === '#/exam' && fresh0.verdict.primary === true,
      'its one button opens the mock exam (' + fresh0.verdict.href + ')');
    check(METRICS.every(function (m) { return fresh0.rows[m].chip === null && fresh0.rows[m].meter === false &&
      fresh0.rows[m].value === '' && fresh0.rows[m].hint === ''; }),
      'no reading is judged: no band chip, no meter, no value and no hint');
    check(fresh0.rows.dailyWork.preview === '60 mistake-book questions a day, or a full mock' &&
      fresh0.rows.paceSec.preview === 'target 103 s or under' &&
      fresh0.rows.firstAttemptAccuracy.preview === 'target 75% or more' &&
      fresh0.rows.repeatMinutes.preview === 'no limit' && fresh0.rows.newQuestions.preview === 'no target',
      'each row shows its target instead: 60 a day or a full mock, 103 s or under, 75% or more, no limit, no target');
    check(fresh0.week === false && fresh0.adjust === false && fresh0.tally === '',
      'the 7-day strip, the topic table and the tally wait for the first answers');
    await clickOn(rowSel('repeatMinutes') + ' .intensity-toggle');
    var repOpen = await panelOf('repeatMinutes');
    check(repOpen.expanded === 'true' && /No limit: the daily target counts retakes, not minutes \(see Daily work\)\./.test(repOpen.text),
      'a reading still opens to explain itself');
    var freshMarks = await bandMarks();
    check(METRICS.every(function (m) { return freshMarks[m].n === 0; }),
      'and marks none of its band limits as the current one');
    await shotOf('#intensity-card', 'intensity-card-new-user.png');
    var emptyPayload = await ev('PGRE.buildStatusSummary().intensity');
    check(emptyPayload.dailyWork.band === 'red' && emptyPayload.dailyWork.value === 0 &&
      emptyPayload.newQuestions.band === null && emptyPayload.paceSec.band === null,
      'the status payload still reports 0 retakes as red; the card only waits for the first answers');
    check(pageErrors.length === 0, 'no page errors' + (pageErrors.length ? ': ' + pageErrors.join(' | ') : ''));

    /* ——— The mock day: the page clock is moved to the next Sunday ——— */
    console.log('\nmock day (page clock +' + DAYS_TO_SUNDAY + ' days, a Sunday)');
    pageErrors.length = 0;
    DAY_SHIFT = DAYS_TO_SUNDAY;
    var shim = await send('Page.addScriptToEvaluateOnNewDocument',
      { source: '(' + clockShim.toString() + ')(' + (DAYS_TO_SUNDAY * 86400000) + ');' });
    var sunSpec = { n: 9, examAhead: EXAM_AHEAD, news: [[1, 'cm', T, 95], [1, 'em', T, 95]], retakes: [[1, 60, 60]] };
    sunSpec.examDate = dayAhead(EXAM_AHEAD);
    await seedAndOpen(buildSeed(sunSpec));
    var sun = await readCard();
    var pageDay = await ev('new Date().getDay()');
    check(pageDay === 0, 'the page clock reads Sunday');
    check(sun.rows.dailyWork.value === '0 of 60' && sun.rows.dailyWork.band === 'red' &&
      sun.verdict.headline === 'No mistake-book questions yet today.' && sun.verdict.href === '#/exam' &&
      sun.verdict.label === 'Open Mock exam →' && sun.verdict.primary === true &&
      sun.verdict.detail.indexOf('Today is the full-mock day: a submitted mock meets the target on its own.') === 0,
      'Sunday with nothing done: the button opens the mock exam and the detail says the mock meets the target (got "' +
      sun.verdict.detail + '")');
    var sunPackLinks = await ev('document.querySelectorAll(\'#intensity-card a[href^="#/practice/pack/"]\').length');
    check(sunPackLinks === 0, 'no link on the card starts a timed pack (' + sunPackLinks + ')');
    await shotOf('#intensity-card', 'intensity-card-mock-day.png');
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: shim.identifier });
    DAY_SHIFT = 0;
    check(pageErrors.length === 0, 'no page errors' + (pageErrors.length ? ': ' + pageErrors.join(' | ') : ''));
    check(bridge.answered === 0, 'the status bridge on port ' + BRIDGE_PORT + ' received nothing (' + bridge.sent +
      ' request(s) blocked, ' + bridge.answered + ' answered)');
  } finally {
    if (ws) try { ws.close(); } catch (e) {}
    await stopChrome(chrome);
    server.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (e2) {}
    if (!KEEP_ARTIFACTS) {
      try { fs.rmSync(ARTIFACT_DIR, { recursive: true, force: true }); } catch (e3) {}
    }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
}

main().catch(function (err) {
  console.error('Error during intensity chrome test:', err && err.stack || err);
  process.exit(1);
});
