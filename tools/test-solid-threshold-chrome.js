#!/usr/bin/env node
/* Real-page check of the exam-horizon solid-enough threshold on #/formulas.
   Isolated Chrome profile on a throwaway 127.0.0.1 port; never the saved
   studio. The status bridge on 127.0.0.1:4789 is refused by CSP.
   Run: node tools/test-solid-threshold-chrome.js
   PGRE_SOLID_THRESHOLD_SHOTS=<dir> also saves one screenshot per stage. */
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

function staticChecks() {
  function check(condition, message) {
    if (!condition) throw new Error(message);
    console.log('PASS: ' + message);
  }
  var srs = fs.readFileSync(path.join(ROOT, 'js', 'srs.js'), 'utf8');
  var view = fs.readFileSync(path.join(ROOT, 'js', 'view-formulas.js'), 'utf8');
  var search = fs.readFileSync(path.join(ROOT, 'js', 'formula-search.js'), 'utf8');
  var index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check(/matureDays\s*:\s*function/.test(srs), 'srs.js defines matureDays');
  check(srs.indexOf('Math.min(21, cap)') !== -1, 'matureDays is min(21, examCap) while capped');
  check(srs.indexOf('prevIvl >= this.matureDays()') !== -1,
    'gradeCard stores m from the live threshold');
  check(!/\(st\.interval\s*>=\s*21\)/.test(view) &&
    !/\(st\.interval \|\| 0\)\s*>=\s*21/.test(view),
    'view-formulas.js no longer classifies mature at a hard-coded 21');
  check(!/\(st\.interval \|\| 0\)\s*>=\s*21/.test(search) &&
    search.indexOf('Mature (≥ 21 d)') === -1,
    'formula-search.js uses the live threshold for Mature / Young');
  check(/js\/srs\.js\?v=\d{8}[a-z]/.test(index) &&
    /js\/view-formulas\.js\?v=\d{8}[a-z]/.test(index),
    'index.html cache-busts srs.js and view-formulas.js');
  check(view.indexOf('formula-search.js?v=') !== -1,
    'view-formulas.js cache-busts formula-search.js at the inject site');
}

async function helpers(page) {
  var URL = process.env.PGRE_SOLID_THRESHOLD_TEST_URL;
  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  var h = { sleep: sleep };

  function assert(condition, message) {
    if (!condition) throw new Error(message);
    console.log('PASS: ' + message);
  }
  h.assert = assert;

  async function wait(selector) {
    for (var attempt = 0; attempt < 100; attempt++) {
      if (await page.eval('!!document.querySelector(' + JSON.stringify(selector) + ')')) return;
      await sleep(100);
    }
    throw new Error('Timeout waiting for ' + selector);
  }
  h.wait = wait;

  async function click(selector) {
    await page.eval('() => { var b = document.querySelector(' + JSON.stringify(selector) +
      '); if (!b) throw new Error("missing ' + selector.replace(/"/g, '\\"') +
      '"); b.focus(); b.click(); }');
  }
  h.click = click;

  h.openFormulas = async function () {
    await page.open(URL);
    await wait('#main');
    await page.eval(function () { location.hash = '#/formulas'; if (PGRE.route) PGRE.route(); });
    await wait('#formulas-root, #subj-root');
    for (var i = 0; i < 50; i++) {
      if (await page.eval('!!document.querySelector(".mem-grid, #study-btn")')) return;
      await sleep(100);
    }
    throw new Error('Timeout waiting for the Recall page');
  };

  /* Round 2: the held-interval threshold shows in the Memory block's
     "Held 3 weeks or more" tile sub-line — open the physics subject home. */
  h.seedAndShow = async function (daysOut) {
    await page.eval('() => { window.__solidDaysOut = ' + (+daysOut) + '; }');
    await page.eval(function () {
      var daysOut = window.__solidDaysOut;
      var s = PGRE.store.state;
      s.settings.examDate = PGRE.srs.addDays(daysOut);
      s.settings.formulaExamCap = true;
      var deck = PGRE.FORMULAS || [];
      if (!deck.length) throw new Error('no public formula cards to seed');
      s.cards = {};
      deck.forEach(function (c, i) {
        if (i < 8) {
          s.cards[c.id] = { interval: 18, reviews: 4, reps: 4, ease: 2.5,
            due: PGRE.srs.addDays(18), lapses: 0 };
        } else if (i < 14) {
          s.cards[c.id] = { interval: 10, reviews: 3, reps: 3, ease: 2.5,
            due: PGRE.srs.addDays(10), lapses: 0 };
        } else if (i < 19) {
          s.cards[c.id] = { interval: 1, reviews: 2, reps: 2, ease: 2.5,
            due: PGRE.srs.today(), lapses: 0 };
        }
      });
      s.formulaDay = { date: PGRE.srs.today(), reviewIds: [], newIds: [] };
      s.formulaStudy = null;
      PGRE.store.save();
      location.hash = '#/';
      if (PGRE.route) PGRE.route();
    });
    await sleep(250);
    await page.eval(function () { location.hash = '#/subject/physics'; if (PGRE.route) PGRE.route(); });
    await wait('#subj-root .mem-grid');
    await page.eval(function () {
      var mem = document.querySelector('#subj-root .mem-grid');
      if (mem && mem.scrollIntoView) mem.scrollIntoView({ block: 'start' });
    });
  };

  h.panel = async function () {
    return JSON.parse(await page.eval(function () {
      var tiles = [].map.call(document.querySelectorAll('.mem-grid .stat-tile'), function (el) {
        return el.textContent.replace(/\s+/g, ' ').trim();
      });
      var matureOpt = document.querySelector('#fs-status-sel option[value="mature"]');
      var youngOpt = document.querySelector('#fs-status-sel option[value="young"]');
      return JSON.stringify({
        thresh: PGRE.srs.matureDays(),
        cap: PGRE.srs.examCap(),
        examDate: PGRE.store.state.settings.examDate,
        daysUntil: PGRE.srs.daysUntil(PGRE.store.state.settings.examDate),
        tiles: tiles,
        matureChip: matureOpt ? matureOpt.textContent : '',
        youngChip: youngOpt ? youngOpt.textContent : ''
      });
    }));
  };

  h.expectPanel = function (p, thresh, name) {
    h.assert(p.thresh === thresh, name + ': matureDays is ' + thresh + ' (got ' + p.thresh + ')');
    var held = p.tiles.filter(function (t) { return /Held 3 weeks or more/.test(t); })[0] || '';
    h.assert(held.indexOf('interval ≥ ' + thresh + ' d') !== -1,
      name + ': the Held tile reads "interval ≥ ' + thresh + ' d", got ' + JSON.stringify(held));
  };

  return h;
}

var STAGES = [
  { name: '19 days left: threshold 18 d', shot: '01-recall-19d-threshold-18d', size: '1100x1500',
    run: async function (page, h) {
      await h.openFormulas();
      await h.seedAndShow(19);
      var p = await h.panel();
      h.expectPanel(p, 18, '19 days left');
      h.assert(p.daysUntil === 19, 'fixture exam date is 19 days out');
    } },

  { name: '5 days left: threshold 4 d', shot: '02-recall-5d-threshold-4d',
    run: async function (page, h) {
      await h.seedAndShow(5);
      var p = await h.panel();
      h.expectPanel(p, 4, '5 days left');
      await page.eval(function () { location.hash = '#/formulas'; if (PGRE.route) PGRE.route(); });
      await h.click('button.flash-tab[data-mode="browse"]');
      await h.wait('#fs-status-sel');
      p = await h.panel();
      h.assert(p.matureChip.indexOf('≥ 4 d') !== -1,
        'search Mature chip is Mature (≥ 4 d), got ' + p.matureChip);
      h.assert(p.youngChip.indexOf('< 4 d') !== -1,
        'search Young chip is Young (< 4 d), got ' + p.youngChip);
    } },

  { name: 'exam eve: threshold 1 d', shot: '03-recall-exam-eve-threshold-1d',
    run: async function (page, h) {
      await h.seedAndShow(1);
      var p = await h.panel();
      h.expectPanel(p, 1, 'exam eve');
      h.assert(p.cap == null, 'exam eve: examCap is null');
    } }
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
  staticChecks();
  var profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pgre-solid-threshold-chrome-'));
  var shots = process.env.PGRE_SOLID_THRESHOLD_SHOTS ? path.resolve(process.env.PGRE_SOLID_THRESHOLD_SHOTS) : '';
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
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404); response.end(); return;
    }
    response.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Content-Security-Policy': PAGE_CSP
    });
    fs.createReadStream(file).pipe(response);
  });
  var env = Object.assign({}, process.env, {
    CHROME_DEVTOOLS_AXI_SESSION: 'pgre-solid-threshold-' + process.pid,
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
    env.PGRE_SOLID_THRESHOLD_TEST_URL = 'http://127.0.0.1:' + server.address().port + '/';
    await run(['open', env.PGRE_SOLID_THRESHOLD_TEST_URL], env);
    var size = '';
    for (var i = 0; i < STAGES.length; i++) {
      console.log('\n' + STAGES[i].name);
      if (STAGES[i].size && STAGES[i].size !== size) {
        size = STAGES[i].size;
        await run(['emulate', '--viewport', size], env);
      }
      await run(['run'], env, 'try { var h = await (' + helpers.toString() + ')(page); await (' +
        STAGES[i].run.toString() + ')(page, h); } catch (error) { console.log("BROWSER_TEST_FAILED: " + error.stack); }');
      if (shots && STAGES[i].shot) await run(['screenshot', path.join(shots, STAGES[i].shot + '.png')], env);
    }
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
