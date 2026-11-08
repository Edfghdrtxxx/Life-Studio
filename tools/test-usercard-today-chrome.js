#!/usr/bin/env node
/* Headless Chrome, end to end: a user card saved outside the Recall page's
   card list must not be pruned from today's list.

   Reproduces the 2026-11-08 incident: the Recall page loads its deck once
   (`deck` in js/view-formulas.js); PGRE.userCardOps.save writes
   state.userCards but does not refresh that list. With a stale list,
   PGRE.srs.formulaDay(deck) ran _reconcileFormulaDay whose drop() treated
   "not in this deck read" as "left the deck" and removed the card from
   today's batch. Two real paths reach it:

   1. Same tab: the page is mounted, an outside caller saves a card and
      adds it with addFormulaDaySoft (which needs a FRESH formulaDeck()),
      then the page's own next list read (an in-page tab switch re-render)
      drops it.
   2. Sibling tab: tab B saves the card and adds it to today's list; tab A
      adopts the write through the storage listener — its state.userCards
      gains the card while its loaded deck stays stale — and A's next list
      read used to drop it the same way.

   The trigger is an in-page .flash-tab switch (Progress -> Review), which
   re-runs renderHome -> formulaDay(deck) on the same deck object; a route
   navigation would remount the view and reload the deck, hiding the bug.

   The test forces formulaDeckStatus.partial = false on tab A (the gitignored
   content/bank sources are absent in this checkout, so a real read reports
   partial and the old code would have kept the id for the wrong reason);
   in the incident environment all sources were present.

   Isolated Chrome profile and ephemeral ports; nothing outside the temp
   profile is read or written. Requests to the OrbitOS status bridge
   (127.0.0.1:4789) are blocked in every tab before the page loads and the
   count of answered bridge responses must stay 0.
   Run: node tools/test-usercard-today-chrome.js
   PGRE_TEST_PORT / PGRE_CDP_PORT pin the ports. */
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

/* CDP page session: send + evaluate helpers on one WebSocket. */
async function attach(wsUrl, bridge, pageErrors) {
  var ws = new WebSocket(wsUrl);
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
  return { ws: ws, send: send, ev: ev };
}

async function main() {
  var chromeBin = findChrome();
  if (!chromeBin) { console.error('LAUNCHER_UNAVAILABLE: Chrome binary not found'); process.exit(2); }
  await new Promise(function (r) { server.listen(PORT, '127.0.0.1', r); });
  var base = 'http://127.0.0.1:' + server.address().port;
  var cdpPort = CDP_PORT || await freePort();
  console.log('HTTP ' + base + '  CDP ' + cdpPort);
  var userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgre-usercard-chrome-'));
  var chrome = spawn(chromeBin, ['--headless=new', '--remote-debugging-port=' + cdpPort,
    '--user-data-dir=' + userDataDir, '--no-first-run', '--window-size=1440,900',
    base + '/__blank__'], { stdio: 'ignore' });

  var pageErrors = [];
  var bridge = { sent: 0, answered: 0 };
  var wsA = null, wsB = null;
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
    var A = await attach(wsUrl, bridge, pageErrors);
    wsA = A.ws;
    var ev = A.ev, send = A.send;

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
    /* The page's own list read without a reload: an in-page tab switch
       (Progress -> Review) re-runs renderHome -> formulaDay(deck) on the
       same deck object. A route navigation would remount and reload it. */
    async function pageListRead(tag) {
      await ev('document.querySelector(\'.flash-tab[data-mode="progress"]\').click(); true');
      await sleep(150);
      await ev('document.querySelector(\'.flash-tab[data-mode="study"]\').click(); true');
      await waitFor('!!document.querySelector(\'.flash-tab[data-mode="study"].active\')',
        'the Review home repaints (' + tag + ')');
      await sleep(200);
    }
    function inToday(id) {
      return '(function(){var b=PGRE.store.state.formulaDay||{};' +
        ' return (b.newIds||[]).concat(b.reviewIds||[]).indexOf(' + JSON.stringify(id) + ') !== -1;})()';
    }

    await send('Runtime.enable', {});
    await send('Page.enable', {});
    /* js/status.js posts the study summary to the OrbitOS bridge on 4789 —
       block it so a test profile never overwrites the user's real status. */
    await send('Network.enable', {});
    await send('Network.setBlockedURLs', { urls: ['*://127.0.0.1:4789/*', '*://localhost:4789/*'] });

    /* --- tab A: mount Recall, snapshot the deck (stale from now on) -------- */
    await go(base + '/#/formulas');
    await waitFor('!!window.PGRE && !!PGRE.store && !!PGRE.store.state &&' +
      ' !!document.getElementById("formulas-root")', 'Recall mounts');
    await waitFor('PGRE.views.formulas && PGRE.views.formulas.getDeck &&' +
      ' PGRE.views.formulas.getDeck().length > 0', 'the page deck is loaded');
    var deckLen = await ev('PGRE.views.formulas.getDeck().length');
    check(deckLen > 0, 'the page holds a deck of ' + deckLen + ' cards');

    /* The incident ran on a complete deck read. This checkout lacks the
       gitignored content/bank sources, so mark the status complete like
       the real deck had it (the old prune only failed when partial was
       false — with partial true it keeps everything absent). */
    await ev('PGRE.formulaDeckStatus = { partial: false, complete: true, missing: [],' +
      ' sources: { bookFormulas: "present", formulas: "present", bookLists: "present",' +
      ' indexedDB: "empty", userCards: "empty" } }; true');

    /* --- path 1: an outside caller saves a card into this tab -------------- */
    var saved = await ev('PGRE.userCardOps.save({ subject: "physics",' +
      ' front: "State the Bethe-Bloch formula purpose",' +
      ' back: "Mean energy loss of a charged particle in matter" })');
    check(!!(saved && saved.ok && saved.card && saved.card.id === 'user-physics-1'),
      'userCardOps.save created user-physics-1 outside the page editor');

    /* addFormulaDaySoft on a FRESH deck — exactly what the agent did. The
       page's own loaded deck still lacks the card. */
    var addRes = await ev('PGRE.formulaDeck().then(function(d){' +
      ' return PGRE.srs.addFormulaDaySoft(d, ["user-physics-1"]);})');
    check(!!(addRes && addRes.added && addRes.added.indexOf('user-physics-1') !== -1),
      'addFormulaDaySoft put the new card into today\'s list');
    /* addFormulaDaySoft's fresh formulaDeck() refreshed the status — pin it
       back to the incident condition before the page's own list read. */
    await ev('PGRE.formulaDeckStatus.partial = false;' +
      ' PGRE.formulaDeckStatus.complete = true; PGRE.formulaDeckStatus.missing = []; true');
    check(await ev('PGRE.views.formulas.getDeck().some(function(c){return c.id==="user-physics-1"})') === false,
      'the page deck is still stale (the card is absent — incident conditions)');

    await pageListRead('same tab');
    check(await ev('PGRE.views.formulas.getDeck().some(function(c){return c.id==="user-physics-1"})') === false,
      'the page deck stayed stale through the tab switch');
    check(await ev(inToday('user-physics-1')),
      'the new card survives the page\'s list read on a stale deck');
    check(await ev('PGRE.srs.formulaDayRemaining(PGRE.views.formulas.getDeck())' +
      '.some(function(c){return c.id==="user-physics-1"})'),
      'the new card is studyable from today\'s list without a reload');
    check(await ev('!!PGRE.views.formulas.getCard("user-physics-1")'),
      'the page resolves the card body (deckById falls back to the live map)');
    var queue = await ev('PGRE.srs.formulaDayRemaining(PGRE.views.formulas.getDeck())' +
      '.map(function(c){return c.id})');
    check(!!(queue && queue.length), 'a study queue forms from the stale deck');
    check(!!(queue && queue.indexOf('user-physics-1') !== -1),
      'user-physics-1 is in the queue Study would serve');

    /* --- path 2: the card is saved in a SIBLING tab ------------------------- */
    /* Open a real second tab on the same origin; its localStorage writes
       reach tab A through the storage listener (store._adopt). */
    var newTarget = await (await fetch('http://127.0.0.1:' + cdpPort +
      '/json/new?' + encodeURIComponent(base + '/index.html'), { method: 'PUT' })).json();
    var B = await attach(newTarget.webSocketDebuggerUrl, bridge, pageErrors);
    wsB = B.ws;
    var evB = B.ev, sendB = B.send;
    await sendB('Runtime.enable', {});
    await sendB('Page.enable', {});
    await sendB('Network.enable', {});
    await sendB('Network.setBlockedURLs', { urls: ['*://127.0.0.1:4789/*', '*://localhost:4789/*'] });
    async function waitForB(expression, label, tries) {
      for (var t = 0; t < (tries || 80); t++) {
        try { if (await evB(expression)) return true; } catch (e) { /* booting */ }
        await sleep(100);
      }
      throw new Error('timed out waiting for ' + label);
    }
    await waitForB('!!window.PGRE && !!PGRE.store && !!PGRE.store.state', 'the sibling tab boots');

    /* Sibling saves its own card and adds it to today's list. */
    var savedB = await evB('PGRE.userCardOps.save({ subject: "physics",' +
      ' front: "Define cross-section",' +
      ' back: "$\\\\sigma$: effective area per target particle" })');
    check(!!(savedB && savedB.ok && savedB.card && /^user-physics-/.test(savedB.card.id)),
      'the sibling tab saved ' + (savedB && savedB.card ? savedB.card.id : 'a card'));
    var sibId = savedB && savedB.card ? savedB.card.id : null;
    var addB = await evB('PGRE.formulaDeck().then(function(d){' +
      ' return PGRE.srs.addFormulaDaySoft(d, [' + JSON.stringify(sibId) + ']);})');
    check(!!(addB && addB.added && addB.added.indexOf(sibId) !== -1),
      'the sibling added its card to today\'s list');

    /* Tab A adopts the write via the storage event: the card enters
       state.userCards and today's batch while A's deck stays stale. */
    var adopted = false;
    for (var ai = 0; ai < 50 && !adopted; ai++) {
      adopted = await ev('(function(){var s=PGRE.store.state;' +
        ' var inBatch = s.formulaDay && (s.formulaDay.newIds||[]).concat(s.formulaDay.reviewIds||[])' +
        '   .indexOf(' + JSON.stringify(sibId) + ') !== -1;' +
        ' return !!(s.userCards && s.userCards[' + JSON.stringify(sibId) + ']) && inBatch;})()');
      if (!adopted) await sleep(100);
    }
    check(adopted, 'tab A adopted the sibling card into state.userCards and today\'s list');
    check(await ev('PGRE.views.formulas.getDeck().some(function(c){return c.id===' +
      JSON.stringify(sibId) + '})') === false,
      'tab A\'s deck is still stale for the sibling card');

    await pageListRead('sibling adopt');
    check(await ev(inToday(sibId)), 'the adopted card survives tab A\'s list read');
    check(await ev('PGRE.srs.formulaDayRemaining(PGRE.views.formulas.getDeck())' +
      '.some(function(c){return c.id===' + JSON.stringify(sibId) + '})'),
      'the adopted card is studyable from today\'s list');

    /* --- the prunes that must still happen ---------------------------------- */
    /* A card that truly left the deck (no live record anywhere) still drops. */
    await ev('(function(){var b=PGRE.store.state.formulaDay;' +
      ' b.newIds.push("cpgf-9.99","user-physics-zzz"); PGRE.store.save(); true;})()');
    /* A deleted user card: save it, add it, delete it — then the page read
       must still prune it (tombstoned, not just stale). */
    var doomed = await ev('PGRE.userCardOps.save({ subject: "vocab",' +
      ' front: "ephemeral", back: "lasting a day" })');
    var doomedId = doomed && doomed.card ? doomed.card.id : null;
    await ev('PGRE.formulaDeck().then(function(d){' +
      ' PGRE.srs.addFormulaDaySoft(d, [' + JSON.stringify(doomedId) + ']); true;})');
    await ev('PGRE.userCardOps.remove(' + JSON.stringify(doomedId) + ');' +
      ' PGRE.formulaDeckStatus.partial = false;' +
      ' PGRE.formulaDeckStatus.complete = true; PGRE.formulaDeckStatus.missing = []; true');
    await pageListRead('prune checks');
    check(await ev('PGRE.srs.formulaDayRemaining(PGRE.views.formulas.getDeck())' +
      '.every(function(c){return c.id!=="cpgf-9.99" && c.id!=="user-physics-zzz"})'),
      'ids with no live record are never served to Study');
    check(await ev('PGRE.views.formulas.getCard("cpgf-9.99") === null &&' +
      ' PGRE.views.formulas.getCard("user-physics-zzz") === null'),
      'phantom ids still resolve to nothing');
    check(await ev('PGRE.srs.formulaDayRemaining(PGRE.views.formulas.getDeck())' +
      '.every(function(c){return c.id!==' + JSON.stringify(doomedId) + '})'),
      'a tombstoned (deleted) user card is never served to Study');
    check(await ev('PGRE.views.formulas.getCard(' + JSON.stringify(doomedId) + ') === null'),
      'the tombstoned card resolves to nothing');
    check(await ev('(function(){var b=PGRE.store.state.formulaDay||{};' +
      ' var ids=(b.newIds||[]).concat(b.reviewIds||[]);' +
      ' return ids.indexOf("user-physics-1") !== -1 && ids.indexOf(' +
      JSON.stringify(sibId) + ') !== -1;})()'),
      'the live user cards still ride the list after the prunes');

    /* --- bridge guard -------------------------------------------------------- */
    check(bridge.answered === 0, 'the status bridge answered nothing (' + bridge.sent + ' requests blocked)');
    check(pageErrors.length === 0, 'no page errors' + (pageErrors.length ? ': ' + pageErrors[0] : ''));

    console.log('\n' + passed + ' passed, ' + failed + ' failed');
  } catch (e) {
    failed++;
    console.log('  FAIL — ' + (e && e.message ? e.message : e));
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
  } finally {
    if (wsB) { try { wsB.close(); } catch (e) {} }
    if (wsA) { try { wsA.close(); } catch (e) {} }
    await stopChrome(chrome);
    server.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
    process.exit(failed ? 1 : 0);
  }
}
main();
