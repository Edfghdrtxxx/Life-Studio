#!/usr/bin/env node
/* Headless Chrome, end to end: the "Other apps" connection (report §14.3,
   step M2) on the shipped page. A stub /study-sources route on this test's
   own HTTP server stands in for the status bridge; the page's endpoint is
   pointed at it through window.__PGRE_STUDY_SOURCES_URL. Drives the three
   card states (connected, stale — the helper's 120-minute schedule lapsed —
   and a day without Maimemo numbers), the not-connected states (404 and no
   answer at all), the Today header line and card, the Study time stacked
   bars and 12-month calendar, the Settings section, and the read-only rule
   (nothing of the payload lands in pgre-state-v1). The page must keep
   working when the bridge does not answer.

   Isolated Chrome profile and ephemeral ports; nothing outside the temp
   profile is read or written. Requests to the real OrbitOS status bridge
   (127.0.0.1:4789 and :4790) are blocked. The book bank (content/bank/,
   gitignored) may be absent: no check depends on it.
   Run: node tools/test-study-sources-chrome.js */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');
var net = require('net');
var { spawn } = require('child_process');

var PORT = parseInt(process.env.PGRE_TEST_PORT || '0', 10);
var CDP_PORT = parseInt(process.env.PGRE_CDP_PORT || '0', 10);
var ROOT = path.resolve(__dirname, '..');
var BLOCKED = ['*://127.0.0.1:4789/*', '*://localhost:4789/*',
               '*://127.0.0.1:4790/*', '*://localhost:4790/*'];
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

function pad2(n) { return String(n).padStart(2, '0'); }
function dayKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function dayAgo(k) { var d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - k); return dayKey(d); }
function isoMinAgo(min) { return new Date(Date.now() - min * 60000).toISOString(); }

/* What the stub bridge serves; mutated per scenario. */
var stub = { status: 200, body: null };

function maimemoPayload(daysSpec) {
  var days = {};
  Object.keys(daysSpec).forEach(function (k) {
    var spec = daysSpec[k];
    var e = { updatedAt: spec.updatedAt };
    if (spec.mm) e.maimemo = { finished: spec.mm[0], total: spec.mm[1], studyTimeMs: spec.mm[2] * 60000 };
    if (spec.sessions) e.obsidian = { sessions: spec.sessions };
    days[k] = e;
  });
  return { version: 1, days: days };
}

function session(title, rel) {
  return { title: title, path: '60_Learning_Progress/' + rel + '/' + dayAgo(0) + '-0915 ' + title + '.md' };
}

/* ——— Chrome + CDP plumbing (same pattern as test-intensity-chrome.js) ——— */
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
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

function isBridgeUrl(u) { return /^https?:\/\/(127\.0\.0\.1|localhost):(4789|4790)\//.test(String(u)); }

async function main() {
  var chromeBin = findChrome();
  if (!chromeBin) { console.error('LAUNCHER_UNAVAILABLE: Chrome binary not found'); process.exit(2); }
  await new Promise(function (r) { server.listen(PORT, '127.0.0.1', r); });
  var base = 'http://127.0.0.1:' + server.address().port;
  var stubUrl = base + '/study-sources';
  var cdpPort = CDP_PORT || await freePort();
  var deadUrl = 'http://127.0.0.1:' + (await freePort()) + '/study-sources'; // bound then closed: nothing listens
  console.log('HTTP ' + base + '  CDP ' + cdpPort);
  var userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgre-sources-chrome-'));
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

    await send('Runtime.enable', {});
    await send('Page.enable', {});
    /* js/status.js posts to the OrbitOS status bridge on 127.0.0.1:4789 (and
       the test must never reach 4790 either). Block both ports so a test
       profile never overwrites the snapshot agents read for real study data. */
    await send('Network.enable', {});
    await send('Network.setBlockedURLs', { urls: BLOCKED });

    /* Seed a small state (defaults fill the rest) on a script-free page of
       the same origin, point the endpoint at the stub, then open the app. */
    function seed() {
      var log = {};
      /* state.studyLog is keyed by the studio's study day, which rolls at
         03:00 (js/study-time.js studyDayStart) — near midnight "today" is
         yesterday's calendar key. */
      var studyDay = (new Date().getHours() < 3) ? dayAgo(1) : dayAgo(0);
      log[dayAgo(2)] = 90 * 60;
      log[dayAgo(3)] = 55 * 60;
      log[dayAgo(5)] = 20 * 60;
      log[dayAgo(40)] = 30 * 60;
      log[studyDay] = 42 * 60;
      var iso = new Date().toISOString();
      return {
        created: iso, xp: 0,
        settings: { theme: 'paper', dailyTargetMin: 120, examDate: dayAgo(-30) },
        studyLog: log,
        streak: { current: 3, best: 5, lastDay: dayAgo(0) },
        daysActive: [dayAgo(0), dayAgo(1), dayAgo(2)],
        migrations: { ankiReset2026: iso, planRebuild2026: iso, easy10: iso },
        _epoch: 1, _rev: 1
      };
    }
    var newDocScript = null;
    async function openStudio(endpoint, payload, status) {
      stub.body = payload;
      stub.status = status || 200;
      if (newDocScript) { await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: newDocScript }); newDocScript = null; }
      var r = await send('Page.addScriptToEvaluateOnNewDocument', {
        source: 'window.__PGRE_STUDY_SOURCES_URL=' + JSON.stringify(endpoint) + ';'
      });
      newDocScript = r.identifier;
      await go(base + '/__blank__');
      await waitFor('document.readyState === "complete" && !window.PGRE', 'blank page');
      await ev('localStorage.clear(); sessionStorage.clear(); localStorage.setItem("pgre-state-v1", ' +
        JSON.stringify(JSON.stringify(seed())) + '); true');
      await go(base + '/#/');
      await waitFor('!!document.getElementById("today-other-apps") && !!PGRE.studySources', 'Today');
      await waitFor('document.getElementById("today-other-apps").children.length > 0', 'other-apps card painted', 100);
    }
    function viewText() {
      return ev('document.getElementById("view").innerText.replace(/\\s+/g," ")');
    }
    function cardText() {
      return ev('(document.getElementById("today-other-apps").innerText||"").replace(/\\s+/g," ")');
    }
    async function storedBlob() {
      return ev('localStorage.getItem("pgre-state-v1") || ""');
    }
    function noPayloadInState(blob) {
      return blob.indexOf('studyTimeMs') < 0 && blob.indexOf('maimemo') < 0 &&
        blob.indexOf('Method of images') < 0;
    }

    /* ————— Scenario 1: connected ————— */
    console.log('connected');
    var daysSpec = {};
    daysSpec[dayAgo(0)] = { updatedAt: isoMinAgo(10), mm: [7, 20, 31],
      sessions: [session('Method of images work', 'Electrodynamics')] };
    daysSpec[dayAgo(1)] = { updatedAt: isoMinAgo(60 * 24), mm: [20, 20, 45] };
    daysSpec[dayAgo(2)] = { updatedAt: isoMinAgo(60 * 25), mm: [5, 15, 12] };
    daysSpec[dayAgo(40)] = { updatedAt: isoMinAgo(60 * 24 * 40), mm: [3, 10, 18] };   // calendar-only day
    await openStudio(stubUrl, maimemoPayload(daysSpec));

    var line = await ev('(document.getElementById("today-sources")||{}).innerText || ""');
    check(/Studied today/.test(line) && /Maimemo 31 min/.test(line) && /Studio 4[0-9] min/.test(line),
      'header line sums studio and Maimemo minutes');
    check(/learning session in Obsidian/.test(line), 'header line counts the Obsidian session');
    var ct = await cardText();
    check(/Maimemo/.test(ct) && /7 \/ 20/.test(ct), 'card row shows Maimemo words 7 / 20');
    check(/31 min/.test(ct) && /updated/.test(ct), 'card row shows Maimemo minutes and update time');
    check(/Method of images work/.test(ct) && /1 session/.test(ct), 'card row shows the session title and count');
    var href = await ev('(function(){var a=document.querySelector("#today-other-apps a[href^=\'obsidian://\']");return a?a.getAttribute("href"):"";})()');
    check(/^obsidian:\/\/open\?vault=OrbitOS&file=/.test(href) &&
      /60_Learning_Progress/.test(decodeURIComponent(href)),
      'session title links into Obsidian');
    check(!/Not connected/.test(ct) && !/No update since/.test(ct), 'no state banner when connected');

    /* Study time: stacked bars + summed calendar. */
    await go(base + '/#/study-time');
    await waitFor('!!document.getElementById("st-daily-slot")', 'study time');
    await waitFor('document.querySelectorAll("#st-daily-slot .stbar-mm").length > 0', 'Maimemo bar segments', 100);
    var bars = await ev('(function(){var n=document.querySelectorAll("#st-daily-slot .stbar-mm").length;' +
      'var nums=Array.prototype.map.call(document.querySelectorAll("#st-daily-slot .stbar-mm-n"),' +
      'function(e){return e.textContent.trim();}).filter(Boolean);' +
      'var tips=Array.prototype.map.call(document.querySelectorAll("#st-daily-slot .stbar-col"),' +
      'function(e){return e.getAttribute("data-tip")||"";});' +
      'return {n:n, nums:nums, mmTips:tips.filter(function(t){return /Maimemo/.test(t);}).length};})()');
    check(bars.n >= 3, 'Maimemo segment painted on the days that have it');
    check(bars.nums.length === 1 && /\+/.test(bars.nums[0]),
      '"studio + Maimemo" minutes printed only under today\'s bar');
    check(bars.mmTips >= 3, 'day tooltips carry both numbers');
    var cal = await ev('(function(){var cells=document.querySelectorAll("#st-cal-slot .hm-cal i");' +
      'var mmCells=0,dayCells=0;cells.forEach(function(c){' +
      'if(/Maimemo/.test(c.getAttribute("data-tip")||""))mmCells++;' +
      'if(/active/.test(c.getAttribute("data-tip")||""))dayCells++;});' +
      'return {cells:cells.length,mmCells:mmCells,dayCells:dayCells,' +
      'lead:(document.querySelector("#st-cal-slot .st-lead")||{}).textContent||""};})()');
    check(cal.cells > 350, '12-month calendar painted');
    check(cal.mmCells >= 4, 'calendar tooltips name Maimemo on summed days');
    check(/summed/.test(cal.lead), 'calendar says it sums studio and Maimemo');

    /* Settings: connection state. */
    await go(base + '/#/settings');
    await waitFor('!!document.getElementById("set-other-apps")', 'settings Other apps');
    var setText = await ev('(document.getElementById("set-other-apps").innerText||"").replace(/\\s+/g," ")');
    check(/Connected — last update/.test(setText), 'settings shows the connected state');
    check(/Maimemo: 7 of 20 words/.test(setText) && /Obsidian: 1 session/.test(setText),
      'settings summarizes today from both apps');
    check(/open API|开放 API/.test(setText) && /Keychain/.test(setText) && /launchctl/.test(setText),
      'settings lists the one-time setup steps');

    var blob = await storedBlob();
    check(noPayloadInState(blob), 'read only: no study-sources data in pgre-state-v1');

    /* ————— Scenario 2: stale (helper's 120-minute schedule lapsed) ————— */
    console.log('stale');
    var daysStale = {};
    daysStale[dayAgo(0)] = { updatedAt: isoMinAgo(200), mm: [4, 20, 25],
      sessions: [session('Pendulum normal modes', 'Classical Mechanics')] };
    await openStudio(stubUrl, maimemoPayload(daysStale));
    ct = await cardText();
    check(/No update since/.test(ct), 'stale state: "No update since <time>" on the card');
    check(/25 min/.test(ct) && /4 \/ 20/.test(ct), 'stale keeps the last numbers it received');
    line = await ev('(document.getElementById("today-sources")||{}).innerText || ""');
    check(/Maimemo 25 min/.test(line), 'stale day still counts toward the header total');
    await go(base + '/#/settings');
    await waitFor('!!document.getElementById("set-other-apps")', 'settings Other apps (stale)');
    await waitFor('/No update since/.test(document.getElementById("set-other-apps").innerText)', 'stale text in settings', 60);
    setText = await ev('(document.getElementById("set-other-apps").innerText||"").replace(/\\s+/g," ")');
    check(/No update since/.test(setText) && /120 minutes/.test(setText),
      'settings names the staleness against the 120-minute schedule');

    /* ————— Scenario 3: today entry without Maimemo numbers ————— */
    console.log('no maimemo numbers today');
    var daysNone = {};
    daysNone[dayAgo(0)] = { updatedAt: isoMinAgo(5), sessions: [session('Fourier series drill', 'Mathematical Methods')] };
    await openStudio(stubUrl, maimemoPayload(daysNone));
    ct = await cardText();
    check(/Maimemo has no numbers for today yet: open the app once/.test(ct),
      'missing maimemo block paints the open-the-app note');
    check(/1 session/.test(ct), 'Obsidian sessions still show without Maimemo numbers');

    /* ————— Scenario 4: not connected, 404 ————— */
    console.log('not connected (404)');
    await openStudio(stubUrl, null, 404);
    ct = await cardText();
    check(/Not connected/.test(ct), '404 paints "Not connected"');
    var link = await ev('(function(){var a=document.querySelector("#today-other-apps a[href=\'#/settings\']");return !!a;})()');
    check(link, 'not-connected card links to Settings');
    await go(base + '/#/settings');
    await waitFor('!!document.getElementById("set-other-apps")', 'settings Other apps (404)');
    await waitFor('/Not connected/.test(document.getElementById("set-other-apps").innerText)', 'settings not connected', 60);
    setText = await ev('(document.getElementById("set-other-apps").innerText||"").replace(/\\s+/g," ")');
    check(/Not connected/.test(setText), 'settings shows not connected on 404');

    /* ————— Scenario 5: not connected, no answer — the studio must keep
       working (M2 requirement). ————— */
    console.log('not connected (no answer)');
    await openStudio(deadUrl, null, 200);
    await waitFor('/Not connected/.test((document.getElementById("today-other-apps").innerText||""))', 'no-answer card', 100);
    ct = await cardText();
    check(/Not connected/.test(ct), 'unreachable bridge paints "Not connected"');
    var works = await ev('(function(){return {' +
      'subjects:document.querySelectorAll("#today-subjects .subj-tile").length,' +
      'review:!!document.querySelector("#today-review-slot .card"),' +
      'tiles:document.querySelectorAll("#view .tile").length};})()');
    check(works.subjects >= 5 && works.tiles >= 2, 'Today fully renders while the bridge is down');
    await go(base + '/#/study-time');
    await waitFor('!!document.querySelector("#st-daily-slot .stbar-strip")', 'study time bars (down)', 100);
    var st = await ev('(function(){return {bars:document.querySelectorAll("#st-daily-slot .stbar").length,' +
      'mm:document.querySelectorAll("#st-daily-slot .stbar-mm").length,' +
      'cells:document.querySelectorAll("#st-cal-slot .hm-cal i").length};})()');
    check(st.bars >= 28 && st.mm === 0 && st.cells > 350,
      'Study time shows studio time only, page intact, while the bridge is down');
    var errs = pageErrors.filter(function (e) { return !/fetch|net::|AbortError|Failed to fetch/i.test(e); });
    check(errs.length === 0, 'no page exceptions beyond the refused fetch' +
      (errs.length ? ': ' + errs[0].slice(0, 200) : ''));

    var blob2 = await storedBlob();
    check(noPayloadInState(blob2), 'state still clean of study-sources data after all scenarios');

    check(bridge.answered === 0, 'the real status bridge answered nothing' +
      (bridge.sent ? ' (' + bridge.sent + ' request(s) blocked)' : ''));

  } finally {
    try { if (ws) ws.close(); } catch (e) {}
    await stopChrome(chrome);
    try { server.close(); } catch (e) {}
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) {
  console.error('FATAL — ' + (e && e.stack || e));
  process.exit(1);
});
