#!/usr/bin/env node
/* Screenshot capture for the "Other apps" connection (report §14.3, step
   M2): Today, Study time and Settings full-page, in two named themes
   (paper, warm-dark), at 1280 and 400 px, in the connected / stale /
   not-connected states. A stub /study-sources on this script's own server
   stands in for the status bridge (window.__PGRE_STUDY_SOURCES_URL). The
   real status bridge (127.0.0.1:4789, :4790) is blocked. Uses the copy of
   content/bank in the worktree (the captain's real deck, copied read-only).
   Run: node tools/shot-study-sources.js <out-dir> */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');
var net = require('net');
var { spawn } = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'pgre-sources-shots-'));
var MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.png': 'image/png', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.json': 'application/json'
};
var BLOCKED = ['*://127.0.0.1:4789/*', '*://localhost:4789/*',
               '*://127.0.0.1:4790/*', '*://localhost:4790/*'];

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function pad2(n) { return String(n).padStart(2, '0'); }
function dayKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function dayAgo(k) { var d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - k); return dayKey(d); }
function isoMinAgo(min) { return new Date(Date.now() - min * 60000).toISOString(); }

var stub = { status: 200, body: null };

var server = http.createServer(function (req, res) {
  var reqPath = req.url.split('?')[0];
  if (reqPath === '/study-sources') {
    res.writeHead(stub.status, { 'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*' });
    res.end(stub.status === 200 ? JSON.stringify(stub.body) : JSON.stringify({ error: 'study sources unavailable' }));
    return;
  }
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
  var filePath = path.join(ROOT, decodeURIComponent(reqPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

function freePort() {
  return new Promise(function (resolve, reject) {
    var srv = net.createServer();
    srv.listen(0, '127.0.0.1', function () { var p = srv.address().port; srv.close(function () { resolve(p); }); });
    srv.on('error', reject);
  });
}
function isBridgeUrl(u) { return /^https?:\/\/(127\.0\.0\.1|localhost):(4789|4790)\//.test(String(u)); }

/* Scenarios: connected, stale (200 with an old update), nonumbers (today's
   entry without the maimemo block), off (404). */
function daysFor(state) {
  var d = {};
  var sess = [
    { title: 'Method of images work', path: '60_Learning_Progress/Electrodynamics/' + dayAgo(0) + '-0915 Method of images work.md' }
  ];
  if (state === 'connected') {
    d[dayAgo(0)] = { updatedAt: isoMinAgo(10), maimemo: { finished: 7, total: 20, studyTimeMs: 31 * 60000 },
      obsidian: { sessions: sess } };
  }
  if (state === 'stale') {
    d[dayAgo(0)] = { updatedAt: isoMinAgo(200), maimemo: { finished: 4, total: 20, studyTimeMs: 25 * 60000 },
      obsidian: { sessions: sess } };
  }
  if (state === 'nonumbers') {
    /* The helper ran, Maimemo's API had no day counts yet — the card's
       third state: "open the app once". */
    d[dayAgo(0)] = { updatedAt: isoMinAgo(8), obsidian: { sessions: sess } };
  }
  if (state !== 'off') {
    d[dayAgo(1)] = { updatedAt: isoMinAgo(60 * 24), maimemo: { finished: 20, total: 20, studyTimeMs: 45 * 60000 } };
    d[dayAgo(3)] = { updatedAt: isoMinAgo(60 * 26), maimemo: { finished: 5, total: 15, studyTimeMs: 12 * 60000 } };
    d[dayAgo(9)] = { updatedAt: isoMinAgo(60 * 24 * 9), maimemo: { finished: 12, total: 15, studyTimeMs: 38 * 60000 } };
    d[dayAgo(40)] = { updatedAt: isoMinAgo(60 * 24 * 40), maimemo: { finished: 8, total: 10, studyTimeMs: 55 * 60000 } };
  }
  return { version: 1, days: d };
}

function seed(theme) {
  var log = {};
  var studyDay = (new Date().getHours() < 3) ? dayAgo(1) : dayAgo(0);
  log[studyDay] = 42 * 60;
  var mins = [0, 90, 55, 0, 20, 75, 40, 0, 60, 30, 0, 50, 80, 35, 0, 45, 25, 0, 70, 55, 0, 30, 60, 0, 15, 40, 65, 50];
  for (var i = 1; i < 28; i++) if (mins[i]) log[dayAgo(i)] = mins[i] * 60;
  for (var j = 30; j < 360; j += 3 + (j % 5)) log[dayAgo(j)] = (15 + (j * 7) % 110) * 60;
  var iso = new Date().toISOString();
  return {
    created: iso, xp: 1840,
    settings: { theme: theme, dailyTargetMin: 120, examDate: dayAgo(-60) },
    studyLog: log,
    streak: { current: 6, best: 12, lastDay: dayAgo(0) },
    daysActive: [dayAgo(0), dayAgo(1), dayAgo(2), dayAgo(3)],
    migrations: { ankiReset2026: iso, planRebuild2026: iso, easy10: iso },
    _epoch: 1, _rev: 1
  };
}

async function main() {
  var chromeBin = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    .find(function (p) { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch (e) { return false; } });
  if (!chromeBin) { console.error('no Chrome'); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  var base = 'http://127.0.0.1:' + server.address().port;
  var cdpPort = await freePort();
  var userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgre-shot-'));
  var chrome = spawn(chromeBin, ['--headless=new', '--remote-debugging-port=' + cdpPort,
    '--user-data-dir=' + userDataDir, '--no-first-run', '--window-size=1280,900',
    base + '/__blank__'], { stdio: 'ignore' });
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
      } catch (e) {}
    }
    ws = new WebSocket(wsUrl);
    var idSeq = 1, pending = new Map();
    ws.onmessage = function (ev) {
      var msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        var p = pending.get(msg.id); pending.delete(msg.id);
        msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
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
      if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 300));
      return res.result.value;
    }
    async function go(url) { await send('Page.navigate', { url: url }); await sleep(300); }
    async function waitFor(expr, tries) {
      for (var t = 0; t < (tries || 80); t++) {
        try { if (await ev(expr)) return; } catch (e) {}
        await sleep(100);
      }
    }
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: BLOCKED });

    var newDoc = await send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'window.__PGRE_STUDY_SOURCES_URL=' + JSON.stringify(base + '/study-sources') + ';'
    });

    async function shot(file) {
      var toasts = await ev('(function(){var t=document.getElementById("toasts");if(t)t.style.visibility="hidden";return 1;})()');
      var s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      fs.writeFileSync(path.join(OUT, file), Buffer.from(s.data, 'base64'));
      console.log('  ' + file);
    }
    async function waitReady(state) {
      if (state === 'off') {
        await waitFor('/Not connected|Checking/.test((document.getElementById("today-other-apps")||{innerText:""}).innerText)', 100);
      } else {
        await waitFor('/Maimemo/.test((document.getElementById("today-other-apps")||{innerText:""}).innerText)', 100);
      }
      await sleep(700); // deck + tiles settle, motion ends
    }

    var THEMES = ['paper', 'warm-dark'];
    var WIDTHS = [1280, 400];
    var STATES = ['connected', 'stale', 'nonumbers', 'off'];
    for (var ti = 0; ti < THEMES.length; ti++) {
      for (var wi = 0; wi < WIDTHS.length; wi++) {
        var w = WIDTHS[wi];
        await send('Emulation.setDeviceMetricsOverride', {
          width: w, height: 900, deviceScaleFactor: 1, mobile: w < 500 });
        for (var si = 0; si < STATES.length; si++) {
          var state = STATES[si];
          stub.status = (state === 'off') ? 404 : 200;
          stub.body = daysFor(state);
          var tag = THEMES[ti] + '-' + w + '-' + state;
          await go(base + '/__blank__');
          await waitFor('document.readyState === "complete"', 30);
          await ev('localStorage.clear(); sessionStorage.clear(); localStorage.setItem("pgre-state-v1", ' +
            JSON.stringify(JSON.stringify(seed(THEMES[ti]))) + '); true');
          await go(base + '/#/');
          await waitReady(state);
          await shot('today-' + tag + '.png');
          await go(base + '/#/study-time');
          await waitFor('!!document.querySelector("#st-daily-slot .stbar-strip")', 80);
          await sleep(600);
          await shot('studytime-' + tag + '.png');
          await go(base + '/#/settings');
          await waitFor('!!document.getElementById("set-other-apps")', 60);
          await waitFor(state === 'off'
            ? '/Not connected/.test(document.getElementById("set-other-apps").innerText)'
            : '/update|Connected/.test(document.getElementById("set-other-apps").innerText)', 60);
          await sleep(400);
          await shot('settings-' + tag + '.png');
        }
      }
    }
    console.log('bridge answered: ' + bridge.answered + ' (sent ' + bridge.sent + ', blocked)');
    if (bridge.answered > 0) { console.error('GUARD FAILED: the real bridge answered'); process.exit(3); }
  } finally {
    try { if (ws) ws.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    try { server.close(); } catch (e) {}
    setTimeout(function () {
      try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
      process.exit(0);
    }, 800).unref();
  }
}

main().catch(function (e) { console.error('FATAL — ' + (e && e.stack || e)); process.exit(1); });
