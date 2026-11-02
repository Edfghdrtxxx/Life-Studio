#!/usr/bin/env node
/* Headless Chrome, end to end: Life Studio phase 1 on the shipped page.
   Checks the Life Studio brand, the regrouped sidebar (Studio / Physics /
   More collapsed, Settings present), the theme picker (every named theme
   applies data-theme + data-dark), the subject filter on Recall home, the
   Cards tab editor (create -> list -> persisted in state.userCards), and
   the dashboard without the countdown. Screenshots every theme and the
   new nav for the PR evidence folder (PGRE_ARTIFACT_DIR).

   Isolated Chrome profile and ephemeral ports; nothing outside the temp
   profile is read or written. Requests to the OrbitOS status bridge
   (127.0.0.1:4789) are blocked before the page loads and the count of
   answered bridge responses must stay 0.
   Run: node tools/test-life-studio-chrome.js
   PGRE_ARTIFACT_DIR=<dir> keeps the screenshots (else a temp dir that is
   removed). PGRE_TEST_PORT / PGRE_CDP_PORT pin the ports. */
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
function isBridgeUrl(u) { return /^https?:\/\/(127\.0\.0\.1|localhost):4789\//.test(String(u)); }
var KEEP_ARTIFACTS = !!process.env.PGRE_ARTIFACT_DIR;
var ARTIFACT_DIR = process.env.PGRE_ARTIFACT_DIR ||
  fs.mkdtempSync(path.join(os.tmpdir(), 'pgre-lifestudio-shots-'));
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
  console.log('HTTP ' + base + '  CDP ' + cdpPort + '  shots ' + ARTIFACT_DIR);
  var userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgre-lifestudio-chrome-'));
  var chrome = spawn(chromeBin, ['--headless=new', '--remote-debugging-port=' + cdpPort,
    '--user-data-dir=' + userDataDir, '--no-first-run', '--window-size=1440,900',
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
      await sleep(350);
    }
    async function shot(file) {
      var s = await send('Page.captureScreenshot', { format: 'png' });
      var out = path.join(ARTIFACT_DIR, file);
      fs.writeFileSync(out, Buffer.from(s.data, 'base64'));
      console.log('  screenshot ' + file);
    }

    await send('Runtime.enable', {});
    await send('Page.enable', {});
    /* js/status.js posts the study summary to the OrbitOS bridge on 4789 —
       block it so a test profile never overwrites the user's real status. */
    await send('Network.enable', {});
    await send('Network.setBlockedURLs', { urls: ['*://127.0.0.1:4789/*', '*://localhost:4789/*'] });

    /* --- brand + sidebar --------------------------------------------------- */
    await go(base + '/#/');
    await waitFor('!!window.PGRE && !!PGRE.store && !!PGRE.store.state', 'the app boots');
    await waitFor('document.querySelectorAll("#sidebar-nav .nav-tree-group").length >= 2 &&' +
      ' !!document.getElementById("nav-physics-sub")', 'nav groups');
    check((await ev('document.title')) === 'Life Studio', 'document title is Life Studio');
    check((await ev('(document.querySelector(".brand-name")||{}).textContent || ""')).indexOf('Life') !== -1,
      'sidebar brand reads Life Studio');
    var groups = await ev(
      'Array.prototype.map.call(document.querySelectorAll("#sidebar-nav .nav-tree-group"),' +
      ' function(g){var b=g.querySelector(".nav-group-h");var p=g.querySelector(".nav-tree-items");' +
      ' return {id:g.getAttribute("data-nav-group"),label:b?b.textContent.trim():"",hidden:!p||p.hidden};})');
    var gmap = {};
    groups.forEach(function (g) { gmap[g.id] = g; });
    check(!!gmap.subjects, 'Subjects group exists');
    check(!!gmap.studio, 'Studio group exists');
    check((await ev('!!document.querySelector(\'#sidebar-footer a[data-nav="settings"]\')')),
      'Settings link sits in the sidebar footer');
    check((await ev('(document.querySelector(\'#sidebar-footer a[data-nav="settings"]\')||{}).textContent || ""'))
      .indexOf('Settings') !== -1, 'Settings link is labelled');
    check(await ev('document.querySelectorAll("#sidebar-nav a[data-nav]").length >= 7'),
      'the nav lists subjects and studio pages');
    await shot('nav-life-studio.png');

    /* --- dashboard: countdown and runway are gone --------------------------- */
    check(await ev('!document.querySelector(".countdown")'), 'dashboard shows no countdown');
    check(await ev('!document.querySelector(".runway")'), 'dashboard shows no prep runway');
    check(await ev('document.getElementById("view").textContent.indexOf("to the exam") === -1'),
      'dashboard carries no "days to the exam" wording');
    check(await ev('document.getElementById("view").textContent.indexOf("Until exam") === -1'),
      'the activity card shows no Until exam line');

    /* Study time: the same activity card, checked on its own page too. */
    await ev('location.hash = "#/study-time"');
    await waitFor('!!document.getElementById("st-active-target")', 'the activity target card');
    check(await ev('document.getElementById("st-active-target").textContent.indexOf("runway to the exam") === -1'),
      'the study-time lead drops the runway sentence');
    check(await ev('document.getElementById("st-active-target").textContent.indexOf("Until exam") === -1'),
      'the study-time card drops the Until exam bar');
    check(await ev('document.getElementById("st-active-target").textContent.indexOf("This week") !== -1'),
      'the weekly target band stays');
    await shot('study-time-card.png');
    await ev('location.hash = "#/"');
    await sleep(300);

    /* --- settings: theme picker --------------------------------------------- */
    await ev('location.hash = "#/settings"');
    await waitFor('!!document.getElementById("theme-grid")', 'the theme grid');
    var swatchCount = await ev('document.querySelectorAll("#theme-grid .theme-swatch").length');
    check(swatchCount === 8, 'the picker lists all eight themes');
    await shot('settings-themes.png');

    /* Apply each theme via the picker and screenshot the dashboard in it. */
    var themeIds = await ev('PGRE.THEMES.map(function(t){return t.id})');
    for (var ti = 0; ti < themeIds.length; ti++) {
      var id = themeIds[ti];
      var probe = await ev('(function(){var b=document.querySelector(\'[data-theme-pick="' + id + '"]\');' +
        'if(!b)return {btn:false};' +
        'try{b.click();}catch(e){return {btn:true,throw:String(e)};}' +
        'return {btn:true,theme:PGRE.store.state.settings.theme,' +
        'attr:document.documentElement.getAttribute("data-theme")||"",' +
        'grid:document.querySelectorAll("#theme-grid .theme-swatch").length};})()');
      if (probe && probe.btn === false) console.log('    probe: no button for ' + id);
      if (probe && probe.throw) console.log('    probe: click threw ' + probe.throw);
      var entry = await ev('PGRE.themeEntry(' + JSON.stringify(id) + ')');
      var attr = await ev('document.documentElement.getAttribute("data-theme") || ""');
      var darkAttr = await ev('document.documentElement.hasAttribute("data-dark")');
      var saved = await ev('PGRE.store.state.settings.theme');
      check(saved === id, 'picking ' + id + ' stores the theme id');
      check(attr === entry.attr, id + ' sets data-theme="' + entry.attr + '"');
      check(darkAttr === !!entry.dark, id + ' data-dark=' + !!entry.dark);
    }
    check(await ev('document.querySelector(\'[data-theme-pick="aurora"]\').classList.contains("is-current")'),
      'the current marker moved to the last picked theme');
    /* Screenshot every theme on the dashboard (the page readers see most). */
    for (var sj = 0; sj < themeIds.length; sj++) {
      var sid = themeIds[sj];
      await ev('PGRE.setTheme(' + JSON.stringify(sid) + '); location.hash = "#/"; true');
      await sleep(350);
      await shot('theme-' + sid + '.png');
    }

    /* --- recall: subject chips + today card --------------------------------- */
    await ev('PGRE.setTheme("paper"); location.hash = "#/formulas"; true');
    await waitFor('!!document.getElementById("formulas-root") &&' +
      ' document.querySelectorAll("#formulas-root .subj-chip[data-rsubj]").length >= 2',
      'Recall home with subject chips');
    await sleep(500);
    var chipIds = await ev(
      'Array.prototype.map.call(document.querySelectorAll("#formulas-root .subj-chip[data-rsubj]"),' +
      ' function(b){return b.getAttribute("data-rsubj");})');
    check(chipIds.indexOf('all') === 0 && chipIds.indexOf('physics') !== -1,
      'the subject chips serve every subject with cards, got ' + JSON.stringify(chipIds));
    await ev('(function(){var c=document.querySelector(\'#formulas-root .subj-chip[data-rsubj="physics"]\');' +
      'if(c)c.click();return PGRE.store.state.settings.recallSubject;})()');
    check(await ev('PGRE.store.state.settings.recallSubject') === 'physics',
      'a subject chip narrows Recall to that subject');
    await shot('recall-subject-filter.png');

    /* --- cards tab: create a card -------------------------------------------- */
    await ev('location.hash = "#/formulas/cards"; true');
    await waitFor('!!document.getElementById("ed-form") ||' +
      ' !!document.querySelector("#formulas-root .fcard-skeleton") === false', 'the Cards tab mounts');
    check(await ev('!!document.getElementById("ed-form")'), 'the Cards tab shows the editor');
    await ev('document.getElementById("uec-subject").value = "vocab";' +
      'document.getElementById("uec-front").value = "laconic";' +
      'document.getElementById("uec-back").value = "using few words";' +
      '["uec-front","uec-back"].forEach(function(id){document.getElementById(id).dispatchEvent(new Event("input"));}); true');
    await sleep(150);
    await ev('document.getElementById("uec-save").click(); true');
    await sleep(400);
    var userCard = await ev(
      '(function(){var m=PGRE.store.state.userCards||{};var ks=Object.keys(m);' +
      ' return ks.length ? m[ks[0]] : null;})()');
    check(!!userCard && userCard.id === 'user-vocab-1' && userCard.subject === 'vocab',
      'the editor created user-vocab-1 in state.userCards');
    check(!!userCard && userCard.front === 'laconic', 'the card body persisted');
    check(await ev('PGRE.cardSubject((PGRE.store.state.userCards||{})["user-vocab-1"]||{})') === 'vocab',
      'cardSubject resolves the new card to vocab');
    await shot('cards-editor.png');

    /* The new card joins the deck and the queue filters to it. */
    var deckHas = await ev('PGRE.formulaDeck().then(function(d){return d.some(function(c){return c.id==="user-vocab-1"});})');
    check(deckHas === true, 'the user card joins formulaDeck');
    var filtered = await ev('PGRE.formulaDeck().then(function(d){' +
      'var p=PGRE.srs.suggestFormulaDay(d,{subject:"vocab"});' +
      'return p.newIds.length===1 && p.newIds[0]==="user-vocab-1";})');
    check(filtered === true, 'the subject-filtered queue serves the new card');

    /* --- bridge guard --------------------------------------------------------- */
    check(bridge.answered === 0, 'the status bridge answered nothing (' + bridge.sent + ' requests blocked)');
    check(pageErrors.length === 0, 'no page errors' + (pageErrors.length ? ': ' + pageErrors[0] : ''));

    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    console.log('screenshots in ' + ARTIFACT_DIR);
  } catch (e) {
    failed++;
    console.log('  FAIL — ' + (e && e.message ? e.message : e));
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
  } finally {
    if (ws) { try { ws.close(); } catch (e) {} }
    await stopChrome(chrome);
    server.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
    if (!KEEP_ARTIFACTS) { try { fs.rmSync(ARTIFACT_DIR, { recursive: true, force: true }); } catch (e) {} }
    process.exit(failed ? 1 : 0);
  }
}
main();
