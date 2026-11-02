#!/usr/bin/env node
/* Today's "This week" (Time-today tile) and Study time's "This week"
   stat tile must be one number: the Monday-03:00 studio week from
   PGRE.studyTime.weekSec(). Before the fix the dashboard summed the
   trailing 7 days, so a profile that studied before this week's
   Monday showed a larger week total on Today than on Study time.
   Isolated Chrome profile on a throwaway 127.0.0.1 port; never the
   saved studio. The status bridge on 127.0.0.1:4789 is refused by CSP.
   Run: node tools/test-week-total-chrome.js */
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
  var URL = process.env.PGRE_WEEK_TOTAL_TEST_URL;
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

  /* Loads a hash route in the already-open app. */
  h.go = async function (hash, sel) {
    await page.eval('() => { location.hash = ' + JSON.stringify(hash) + '; if (PGRE.route) PGRE.route(); }');
    await wait(sel);
  };

  /* Seeds the studyLog so the trailing-7-day sum and the Monday-week
     total cannot agree: heavy study before this Monday, 1 h on every
     day of this week. Returns the weekSec the studio should show. */
  h.seedWeek = async function () {
    return JSON.parse(await page.eval(function () {
      var s = PGRE.store.state;
      var today = PGRE.srs.today();
      var mondayIdx = (new Date(today + 'T12:00:00').getDay() + 6) % 7;
      var monday = PGRE.srs.addDaysTo(today, -mondayIdx);
      s.studyLog = {};
      for (var i = 0; i < 7; i++) {
        s.studyLog[PGRE.srs.addDaysTo(monday, i)] = 3600;
        s.studyLog[PGRE.srs.addDaysTo(monday, -1 - i)] = 90000; // 25 h, pre-week
      }
      PGRE.store.save();
      var expected = PGRE.studyTime.weekSec();
      return JSON.stringify({ expected: expected, today: today, mondayIdx: mondayIdx });
    }));
  };

  /* 'This week N h' as shown on the page, parsed to a number. */
  h.todayWeekH = async function () {
    return await page.eval(function () {
      var tile = [].filter.call(document.querySelectorAll('#view .tile'), function (t) {
        return /Time today/.test(t.textContent);
      })[0];
      var m = tile && /This week\s*([\d.]+)\s*h/.exec(tile.textContent);
      return m ? parseFloat(m[1]) : null;
    });
  };

  h.studyTimeWeekH = async function () {
    return await page.eval(function () {
      var tile = [].filter.call(document.querySelectorAll('#view .stat-tile'), function (t) {
        return /This week/.test(t.textContent);
      })[0];
      var m = tile && /([\d.]+)\s*h/.exec(tile.textContent);
      return m ? parseFloat(m[1]) : null;
    });
  };

  return h;
}

var STAGES = [
  { name: 'same Monday-week total on Today and Study time', run: async function (page, h) {
    await page.open(process.env.PGRE_WEEK_TOTAL_TEST_URL);
    await h.wait('#main');
    var seed = await h.seedWeek();
    var expectedH = Math.round(seed.expected / 3600 * 10) / 10;
    h.assert(seed.expected === (seed.mondayIdx + 1) * 3600,
      'weekSec counts only Monday-to-today (got ' + seed.expected + ' s on ' + seed.today + ')');

    await h.go('#/', '#today-subjects');
    await h.wait('#view .tile');
    var dashH = await h.todayWeekH();
    h.assert(dashH === expectedH,
      'Today\'s Time-today tile shows the Monday-week total ' + expectedH +
      ' h, not the trailing-7-day sum (got ' + dashH + ' h)');

    await h.go('#/study-time', '#view .stat-tile');
    var studyH = await h.studyTimeWeekH();
    h.assert(studyH === expectedH,
      'Study time shows the same ' + expectedH + ' h (got ' + studyH + ' h)');
    h.assert(dashH === studyH,
      'both pages agree: ' + dashH + ' h === ' + studyH + ' h');
    h.assert(seed.mondayIdx < 4, 'weekday guard: Monday index ' + seed.mondayIdx +
      ' must stay under 4 so the last-7 window cannot reach this Monday');
  } }
];

function run(args, env, input) {
  return new Promise(function (resolve, reject) {
    var child = spawn('chrome-devtools-axi', args, { env: env });
    var output = '';
    child.stdout.on('data', function (d) { output += d; process.stdout.write(d); });
    child.stderr.on('data', function (d) { output += d; process.stderr.write(d); });
    child.on('exit', function (code) {
      if (code === 0 && output.indexOf('BROWSER_TEST_FAILED:') === -1) resolve();
      else reject(new Error('chrome-devtools-axi ' + args[0] + ' exited ' + code +
        (output ? '\n' + output : '')));
    });
    child.stdin.end(input || '');
  });
}

async function main() {
  var profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pgre-week-total-chrome-'));
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
    CHROME_DEVTOOLS_AXI_SESSION: 'pgre-week-total-' + process.pid,
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
    env.PGRE_WEEK_TOTAL_TEST_URL = 'http://127.0.0.1:' + server.address().port + '/';
    await run(['open', env.PGRE_WEEK_TOTAL_TEST_URL], env);
    for (var i = 0; i < STAGES.length; i++) {
      console.log('\n' + STAGES[i].name);
      await run(['run'], env, 'try { var h = await (' + helpers.toString() + ')(page); await (' +
        STAGES[i].run.toString() + ')(page, h); } catch (error) { console.log("BROWSER_TEST_FAILED: " + error.stack); }');
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
