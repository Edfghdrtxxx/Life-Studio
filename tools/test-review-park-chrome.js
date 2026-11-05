#!/usr/bin/env node
/* Real-page check of Park on the answer side of a Study card.
   After Show answer the grade row must carry a Park button; pressing it
   parks the card (formulaSuspended), removes it from the session without a
   grade (no cardReviews row, state.cards untouched), and shows the next
   card. Browse > Status > Parked must list it.
   Isolated Chrome profile on a throwaway 127.0.0.1 port; never the saved
   studio. The status bridge on 127.0.0.1:4789 is refused by CSP.
   Run: node tools/test-review-park-chrome.js
   PGRE_REVIEW_PARK_SHOTS=<dir> also saves a screenshot per stage. */
'use strict';

var fs = require('fs');
var http = require('http');
var os = require('os');
var path = require('path');
var spawn = require('child_process').spawn;
var ROOT = path.resolve(__dirname, '..');
var MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.png': 'image/png', '.svg': 'image/svg+xml'
};
var BRIDGE_PORT = 4789;
var CSP_REPORT_PATH = '/__csp-report';
var PAGE_CSP = "connect-src 'self'; report-uri " + CSP_REPORT_PATH;
function isBridgeUrl(u) { return /^https?:\/\/(127\.0\.0\.1|localhost):4789(\/|$)/.test(String(u)); }

async function helpers(page) {
  var URL = process.env.PGRE_REVIEW_PARK_TEST_URL;
  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  var h = { sleep: sleep };

  h.assert = function (condition, message) {
    if (!condition) throw new Error(message);
    console.log('PASS: ' + message);
  };

  async function wait(selector) {
    for (var attempt = 0; attempt < 100; attempt++) {
      if (await page.eval('!!document.querySelector(' + JSON.stringify(selector) + ')')) return;
      await sleep(100);
    }
    throw new Error('Timeout waiting for ' + selector);
  }
  h.wait = wait;

  h.click = async function (selector) {
    await page.eval('() => { var b = document.querySelector(' + JSON.stringify(selector) +
      '); if (!b) throw new Error("missing " + ' + JSON.stringify(selector) + '); b.click(); }');
  };

  /* Seed two new cards into today's batch and open Study on them.
     The session queue is shuffled, so nothing here assumes an order. */
  h.seedAndStudy = async function () {
    await page.open(URL);
    await wait('#main');
    await page.eval(function () {
      PGRE.FORMULAS = ['test-aaa', 'test-bbb'].map(function (id) {
        return { id: id, topic: 'mech', name: 'Card ' + id,
          front: 'prompt ' + id, back: '$x=1$', note: '' };
      });
      PGRE.BOOK_FORMULAS = []; PGRE.BOOK_LISTS = [];
      var s = PGRE.store.state;
      s.cards = {}; s.cardReviews = []; s.reviewUndos = {};
      s.formulaPinFacts = {}; s.formulaSuspended = {}; s.formulaStudy = null; s.formulaStudyEnd = null;
      s.formulaDay = { date: PGRE.srs.today(), reviewIds: [], newIds: ['test-aaa', 'test-bbb'] };
      s.settings.formulaDailyTarget = 2; s.settings.examDate = ''; s.settings.formulaReverse = false;
      PGRE.store.save(); return PGRE.contentDB.put({ id: 'formula-deck', kind: 'formula-deck', cards: [] });
    });
    await page.eval(function () { location.hash = '#/'; });
    await sleep(250);
    await page.eval(function () { location.hash = '#/formulas'; });
    await wait('#study-btn');
    await h.click('#study-btn');
    await wait('.formula-palette .pal-cell.is-current');
  };

  h.look = async function () {
    return JSON.parse(await page.eval(function () {
      var s = PGRE.store.state;
      var fs = s.formulaStudy || {};
      var card = document.getElementById('fcard');
      return JSON.stringify({
        flipped: !!(document.getElementById('fcard-back') && !document.getElementById('fcard-back').hidden),
        park: !!document.querySelector('#fcard-actions #putaway-btn'),
        parkLabel: (document.querySelector('#fcard-actions #putaway-btn') || { textContent: '' }).textContent.trim(),
        grades: document.querySelectorAll('#fcard-actions [data-grade]').length,
        cardId: card ? card.getAttribute('data-card-id') : null,
        suspended: Object.keys(s.formulaSuspended || {}),
        queueIds: fs.queueIds || [],
        reviewRows: (s.cardReviews || []).length,
        cardSchedule: Object.keys(s.cards || {}),
        summary: !!(document.querySelector('#flash-body h1') &&
          /Review complete/.test(document.querySelector('#flash-body h1').textContent))
      });
    }));
  };

  return h;
}

var STAGES = [
  {
    name: 'answer side holds a Park button',
    shot: 'review-park-answer-side',
    run: async function (page, h) {
      await h.seedAndStudy();
      var first = await h.look();
      var ids = ['test-aaa', 'test-bbb'];
      h.assert(ids.indexOf(first.cardId) !== -1, 'a seeded card is on screen');
      h.assert(first.park, 'front side has the Park button');
      h.assert(!first.flipped, 'card starts unflipped');
      await h.click('#flip-btn');
      await h.wait('#fcard-actions [data-grade="good"]');
      var flipped = await h.look();
      h.assert(flipped.flipped, 'Show answer revealed the back');
      h.assert(flipped.grades === 4, 'grade row has the four grade buttons');
      h.assert(flipped.park, 'grade row holds a Park button');
      h.assert(flipped.parkLabel === 'Park', 'the button is labelled Park');
    }
  },
  {
    name: 'answer-side Park removes the card ungraded',
    shot: 'review-park-next-card',
    run: async function (page, h) {
      // The page state survives between stages; the card on screen is the one
      // this Park press removes (the queue is shuffled, so read it, don't guess).
      var before = await h.look();
      var parked = before.cardId;
      var other = parked === 'test-aaa' ? 'test-bbb' : 'test-aaa';
      await h.click('#fcard-actions #putaway-btn');
      await h.sleep(300);
      var after = await h.look();
      h.assert(after.cardId === other, 'the next card ' + other + ' is on screen');
      h.assert(!after.flipped, 'the next card is back on its front');
      h.assert(after.suspended.indexOf(parked) !== -1,
        parked + ' is in formulaSuspended');
      h.assert(after.queueIds.indexOf(parked) === -1,
        parked + ' left the session queue');
      h.assert(after.queueIds.length === 1 && after.queueIds[0] === other,
        'only ' + other + ' remains queued');
      h.assert(after.reviewRows === 0, 'parking recorded no review grade');
      h.assert(after.cardSchedule.indexOf(parked) === -1,
        'parking left state.cards untouched');
    }
  },
  {
    name: 'session ends and the card stays parked',
    run: async function (page, h) {
      var parked = JSON.parse(await page.eval(
        'JSON.stringify(Object.keys(PGRE.store.state.formulaSuspended || {})[0] || "")'));
      // A stateless card's first Good is a learning pass: it requeues in-session
      // (writes no grade). Grade it again once it returns so the session ends.
      await h.click('#flip-btn');
      await h.wait('#fcard-actions [data-grade="good"]');
      await h.click('#fcard-actions [data-grade="good"]');
      await h.sleep(300);
      var live = await h.look();
      h.assert(live.reviewRows === 0, 'the learning pass still recorded no grade');
      if (!live.flipped) {
        await h.click('#flip-btn');
        await h.wait('#fcard-actions [data-grade="good"]');
      }
      await h.click('#fcard-actions [data-grade="good"]');
      await h.sleep(300);
      live = await h.look();
      h.assert(live.summary, 'session ended after the second pass');
      h.assert(live.reviewRows === 1, 'one review row for the graded card');
      h.assert(live.suspended.indexOf(parked) !== -1, parked + ' stays parked');
    }
  },
  {
    name: 'Browse lists the parked card',
    run: async function (page, h) {
      var parked = JSON.parse(await page.eval(
        'JSON.stringify(Object.keys(PGRE.store.state.formulaSuspended || {})[0] || "")'));
      h.assert(parked === 'test-aaa' || parked === 'test-bbb', 'a parked card id is in state');
      await page.eval(function () { location.hash = '#/formulas/search'; });
      await h.wait('#fs-status-sel');
      await page.eval(function () {
        var sel = document.getElementById('fs-status-sel');
        sel.value = 'away';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await h.sleep(400);
      var listed = await page.eval(function () {
        var ids = Object.keys(PGRE.store.state.formulaSuspended || {});
        var text = document.getElementById('fs-results').textContent;
        return ids.some(function (id) { return text.indexOf(id) !== -1; });
      });
      h.assert(listed, 'Browse > Status > Parked shows ' + parked);
    }
  }
];

function run(args, env, input) {
  return new Promise(function (resolve, reject) {
    var child = spawn('chrome-devtools-axi', args, { env: env, stdio: ['pipe', 'pipe', 'pipe'] });
    var output = '';
    child.stdout.on('data', function (chunk) { output += chunk; });
    if (args[0] === 'run') child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    child.on('error', reject);
    child.on('exit', function (code) {
      if (code === 0 && output.indexOf('BROWSER_TEST_FAILED:') === -1) resolve();
      else reject(new Error('chrome-devtools-axi ' + args[0] + ' exited ' + code +
        (output ? '\n' + output : '')));
    });
    child.stdin.end(input || '');
  });
}

async function main() {
  var profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pgre-review-park-chrome-'));
  var shots = process.env.PGRE_REVIEW_PARK_SHOTS ? path.resolve(process.env.PGRE_REVIEW_PARK_SHOTS) : '';
  if (shots) fs.mkdirSync(shots, { recursive: true });
  var bridge = { refused: 0 };
  var server = http.createServer(function (request, response) {
    var pathname = decodeURIComponent(request.url.split('?')[0]);
    if (request.method === 'POST' && pathname === CSP_REPORT_PATH) {
      var report = '';
      request.on('data', function (chunk) { report += chunk; });
      request.on('end', function () {
        try { if (isBridgeUrl(JSON.parse(report)['csp-report']['blocked-uri'])) bridge.refused++; } catch (e) {}
        response.writeHead(204); response.end();
      });
      return;
    }
    var file = path.resolve(ROOT, '.' + (pathname === '/' ? '/index.html' : pathname));
    // Synthetic cards only: never serve the gitignored book deck.
    if (/^\/content\/bank\//.test(pathname) || !file.startsWith(ROOT + path.sep) ||
        !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404); response.end(); return;
    }
    response.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Content-Security-Policy': PAGE_CSP
    });
    fs.createReadStream(file).pipe(response);
  });
  var env = Object.assign({}, process.env, {
    CHROME_DEVTOOLS_AXI_SESSION: 'pgre-review-park-' + process.pid,
    CHROME_DEVTOOLS_AXI_AUTO_CONNECT: '0',
    CHROME_DEVTOOLS_AXI_BROWSER_URL: '',
    CHROME_DEVTOOLS_AXI_USER_DATA_DIR: profile
  });
  if (!env.CHROME_DEVTOOLS_AXI_MCP_PATH) {
    env.CHROME_DEVTOOLS_AXI_MCP_PATH =
      '/Users/leyi/.npm/_npx/15c61037b1978c83/node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js';
  }
  try {
    await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
    env.PGRE_REVIEW_PARK_TEST_URL = 'http://127.0.0.1:' + server.address().port + '/';
    await run(['open', env.PGRE_REVIEW_PARK_TEST_URL], env);
    var failed = [];
    for (var i = 0; i < STAGES.length; i++) {
      console.log('\n' + STAGES[i].name);
      try {
        await run(['run'], env, 'try { var h = await (' + helpers.toString() + ')(page); ' +
          'await (' + STAGES[i].run.toString() + ')(page, h); } catch (error) { console.log("BROWSER_TEST_FAILED: " + error.stack); }');
      } catch (stageError) {
        failed.push(STAGES[i].name);
      }
      if (shots && STAGES[i].shot) await run(['screenshot', path.join(shots, STAGES[i].shot + '.png')], env);
    }
    if (failed.length) throw new Error('FAILED stages: ' + failed.join('; '));
    if (!bridge.refused) {
      throw new Error('Chrome reported no refused request to the status bridge on port ' + BRIDGE_PORT);
    }
    console.log('\nPASS: the status bridge on port ' + BRIDGE_PORT + ' received nothing (Chrome refused the request on ' +
      bridge.refused + ' page load(s))');
    console.log('\nALL OK');
  } finally {
    await run(['stop'], env).catch(function (error) { console.error(error.message); });
    await new Promise(function (resolve) { server.close(resolve); });
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch(function (error) { console.error(error.message); process.exitCode = 1; });
