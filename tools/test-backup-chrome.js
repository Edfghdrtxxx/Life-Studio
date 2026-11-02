#!/usr/bin/env node
/* Real-page disk-backup checks: success, failed backup while studying
   continues, checksum-mismatch restore refused, successful restore, refused
   import message, leftover browser copy removed only after an ack.
   Isolated Chrome profile, throwaway 127.0.0.1 port, synthetic data, CSP
   blocks the status bridge on 4789. Snapshots go to a temp directory.
   Run: node tools/test-backup-chrome.js
   PGRE_BACKUP_SHOTS=<dir> saves screenshots of the changed Library states. */
'use strict';

var crypto = require('crypto');
var fs = require('fs');
var http = require('http');
var os = require('os');
var path = require('path');
var spawn = require('child_process').spawn;

var ROOT = path.resolve(__dirname, '..');
var HELPER = path.join(ROOT, 'tools', 'pgre-backup-helper.py');
var MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.svg': 'image/svg+xml'
};
var BRIDGE_PORT = 4789;
var CSP_REPORT_PATH = '/__csp-report';

function isBridgeUrl(u) { return /^https?:\/\/(127\.0\.0\.1|localhost):4789(\/|$)/.test(String(u)); }

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

async function helpers(page) {
  var URL = process.env.PGRE_BACKUP_TEST_URL;
  var ENDPOINT = process.env.PGRE_BACKUP_HELPER_URL;
  var FAKE = process.env.PGRE_BACKUP_FAKE_URL;
  var TOKEN = process.env.PGRE_BACKUP_TEST_TOKEN;
  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  var h = { sleep: sleep };

  h.assert = function (condition, message) {
    if (!condition) throw new Error(message);
    console.log('PASS: ' + message);
  };

  h.wait = async function (expression, what) {
    for (var attempt = 0; attempt < 100; attempt++) {
      if (await page.eval(expression)) return;
      await sleep(100);
    }
    throw new Error('Timeout waiting for ' + what);
  };

  h.openLibrary = async function () {
    await page.eval('() => { location.hash = "#/settings"; if (PGRE.route) PGRE.route(); }');
    await h.wait('!!document.getElementById("disk-backup-card")', 'the disk backup card');
    await page.eval('() => { var el = document.getElementById("disk-backup-card"); if (el) el.scrollIntoView(); }');
  };

  h.configure = async function () {
    await h.wait('!!(window.PGRE && PGRE.store && PGRE.backup)', 'PGRE.backup');
    await page.eval('() => { PGRE.backup.endpoint = ' + JSON.stringify(ENDPOINT) +
      '; PGRE.backup.setToken(' + JSON.stringify(TOKEN) + '); }');
  };

  h.configureFake = async function () {
    await h.wait('!!(window.PGRE && PGRE.store && PGRE.backup)', 'PGRE.backup');
    await page.eval('() => { PGRE.backup.endpoint = ' + JSON.stringify(FAKE) +
      '; PGRE.backup.setToken(' + JSON.stringify(TOKEN) + '); }');
  };

  h.seed = async function () {
    await page.eval(function () {
      var st = PGRE.store.state;
      st.migrations = st.migrations || {};
      st.migrations.ankiReset2026 = st.migrations.ankiReset2026 || 'x';
      st.migrations.planRebuild2026 = st.migrations.planRebuild2026 || 'x';
      st.migrations.easy10 = st.migrations.easy10 || 'x';
      st.xp = 42;
      st.attempts = [{ qid: 'bk-q1', ts: '2026-10-20T00:00:00Z', correct: true, picked: 0, answer: 0 }];
      st.cards = { 'bk-c1': { reviews: 2, due: '2026-10-21', interval: 1, ease: 2.5, lastGrade: 'good' } };
      st.cardReviews = [{ id: 'bk-r1', cardId: 'bk-c1', grade: 'good', ts: '2026-10-20T00:00:00Z' }];
      st.mistakes = {};
      st.exams = [];
      try { localStorage.setItem(PGRE.store.KEY + '-backup', JSON.stringify(st)); } catch (e) {}
    });
  };

  h.toasts = async function () {
    return page.eval('() => Array.prototype.map.call(document.querySelectorAll("#toasts .toast"), function (el) { return el.textContent; }).join(" | ")');
  };

  return h;
}

var STAGES = [
  { name: 'without a disk helper, 25 saves still refresh the browser copy', size: '1100x900', shot: 'backup-no-token', run: async function (page, h) {
    await page.open(process.env.PGRE_BACKUP_TEST_URL + '#/settings');
    await h.wait('!!document.getElementById("main")', '#main');
    await h.seed();
    await h.openLibrary();
    var line = await page.eval('() => document.getElementById("backup-status") ? document.getElementById("backup-status").textContent : ""');
    h.assert(line.indexOf('No backup token is set') !== -1, 'Library says no backup token is set');
    await page.eval(function () {
      for (var n = 0; n < 25; n++) {
        PGRE.store.state.xp = 100 + n;
        PGRE.store.save();
      }
    });
    var info = JSON.parse(await page.eval(function () {
      var raw = localStorage.getItem(PGRE.store.KEY + '-backup');
      return JSON.stringify({
        copy: raw ? JSON.parse(raw).xp : null,
        primary: JSON.parse(localStorage.getItem(PGRE.store.KEY)).xp
      });
    }));
    h.assert(info.primary === 124, 'primary reached the last of 25 saves');
    h.assert(info.copy != null && info.copy !== 42,
      'the browser copy refreshed during those saves, got ' + info.copy);
  } },
  { name: 'a bare ok true reply does not delete the browser copy', size: '1100x900', shot: 'backup-fake-ok', run: async function (page, h) {
    await h.configureFake();
    await h.seed();
    await page.eval('() => { PGRE.store.state.xp = 50; PGRE.store.save(); }');
    await h.sleep(600);
    var info = JSON.parse(await page.eval(function () {
      return JSON.stringify({
        leftover: localStorage.getItem(PGRE.store.KEY + '-backup'),
        verified: !!(PGRE.backup.hasVerifiedSnapshot && PGRE.backup.hasVerifiedSnapshot()),
        error: PGRE.backup.lastError
      });
    }));
    h.assert(!!info.leftover, 'the browser copy remains after a fake ok:true reply');
    h.assert(!info.verified, 'a fake ok:true reply is not a verified snapshot');
  } },
  { name: 'backup success and leftover copy removed after ack', size: '1100x900', shot: 'backup-success', run: async function (page, h) {
    await page.open(process.env.PGRE_BACKUP_TEST_URL + '#/settings');
    await h.wait('!!document.getElementById("main")', '#main');
    await h.configure();
    await h.seed();
    await page.eval('() => { PGRE.store.save(); }');
    await h.wait('!!(PGRE.backup.lastAck && PGRE.backup.lastAck.verified)', 'a verified disk backup');
    await h.openLibrary();
    var info = JSON.parse(await page.eval(function () {
      return JSON.stringify({
        leftover: localStorage.getItem(PGRE.store.KEY + '-backup'),
        primary: !!localStorage.getItem(PGRE.store.KEY),
        persistFailed: !!PGRE.store._persistFailed,
        status: document.getElementById('backup-status') ? document.getElementById('backup-status').textContent : '',
        warningHidden: !!(document.getElementById('backup-warning') && document.getElementById('backup-warning').hidden),
        list: document.getElementById('backup-list') ? document.getElementById('backup-list').textContent : '',
        ack: PGRE.backup.lastAck
      });
    }));
    h.assert(!info.leftover, 'the leftover browser copy is gone after an acknowledged snapshot');
    h.assert(info.primary && !info.persistFailed, 'primary progress is still saved');
    h.assert(info.status.indexOf('Last disk backup:') !== -1, 'Library shows the last acknowledged backup time');
    h.assert(info.list.indexOf('attempts') !== -1, 'the snapshot list shows preview counts');
  } },
  { name: 'backup failure while studying continues', size: '1100x900', shot: 'backup-failure', run: async function (page, h) {
    await page.eval('() => { PGRE.backup.endpoint = "http://127.0.0.1:9/pgre-backup"; PGRE.backup.lastAck = null; try { localStorage.removeItem(PGRE.backup.ACK_KEY); } catch (e) {} }');
    await page.eval('() => { PGRE.store.state.xp = 88; PGRE.store.save(); }');
    await h.sleep(400);
    var info = JSON.parse(await page.eval(function () {
      var raw = localStorage.getItem(PGRE.store.KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return JSON.stringify({
        persistFailed: !!PGRE.store._persistFailed,
        xp: parsed.xp,
        liveXp: PGRE.store.state.xp,
        error: PGRE.backup.lastError,
        warning: document.getElementById('backup-warning') ? document.getElementById('backup-warning').textContent : '',
        toast: Array.prototype.map.call(document.querySelectorAll('#toasts .toast'), function (el) { return el.textContent; }).join(' | ')
      });
    }));
    h.assert(!info.persistFailed, 'a failed disk backup does not set _persistFailed');
    h.assert(info.xp === 88 && info.liveXp === 88, 'the grade-like save is still on disk');
    h.assert(!!info.error, 'the client records a backup error');
    h.assert(
      (info.warning && info.warning.indexOf('Disk backup failed') !== -1) ||
      (info.toast && info.toast.indexOf('Disk backup failed') !== -1),
      'a visible warning reports the failed backup'
    );
    await h.openLibrary();
  } },
  { name: 'restore with checksum mismatch is refused', size: '1100x900', shot: 'restore-mismatch', run: async function (page, h) {
    await h.configure();
    await page.eval('() => { PGRE.backup.lastError = null; }');
    var listed = JSON.parse(await page.eval('() => PGRE.backup.list().then(function (r) { return JSON.stringify(r); })'));
    h.assert(listed.ok && listed.snapshots && listed.snapshots.length, 'snapshots are listed for restore');
    var id = process.env.PGRE_BACKUP_TAMPER_ID || listed.snapshots[0].id;
    var result = JSON.parse(await page.eval('() => PGRE.backup.restoreSnapshot(' +
      JSON.stringify(id) + ').then(function (r) { return JSON.stringify(r); })'));
    h.assert(!result.ok, 'a tampered snapshot is not restored');
    h.assert(String(result.error || '').toLowerCase().indexOf('checksum') !== -1,
      'the refusal names a checksum mismatch, got ' + result.error);
    var xp = JSON.parse(await page.eval('() => JSON.stringify(JSON.parse(localStorage.getItem(PGRE.store.KEY)).xp)'));
    h.assert(xp === 88, 'current progress is unchanged after the refused restore');
    await h.openLibrary();
    await page.eval('() => { var btn = document.querySelector("[data-restore]"); if (btn) btn.click(); }');
    await h.sleep(200);
    var preview = await page.eval('() => { var b = document.getElementById("backup-restore-confirm"); return b && !b.hidden ? b.textContent : ""; }');
    h.assert(preview.indexOf('Restore this disk snapshot') !== -1, 'restore shows a time/count preview before confirm');
  } },
  { name: 'successful restore through the import path', size: '1100x900', shot: 'restore-success', run: async function (page, h) {
    await h.configure();
    var listed = JSON.parse(await page.eval('() => PGRE.backup.list().then(function (r) { return JSON.stringify(r); })'));
    var good = null;
    for (var i = 0; i < listed.snapshots.length; i++) {
      if (listed.snapshots[i].id !== process.env.PGRE_BACKUP_TAMPER_ID) good = listed.snapshots[i];
    }
    if (!good) good = listed.snapshots[listed.snapshots.length - 1];
    await page.eval('() => { PGRE.store.state.xp = 1; PGRE.store.save(); }');
    await h.sleep(300);
    var result = JSON.parse(await page.eval('() => PGRE.backup.restoreSnapshot(' +
      JSON.stringify(good.id) + ').then(function (r) { return JSON.stringify(r); })'));
    h.assert(result.ok === true, 'a valid snapshot restores, got ' + JSON.stringify(result));
    var after = JSON.parse(await page.eval(function () {
      return JSON.stringify({
        persistFailed: !!PGRE.store._persistFailed,
        xp: JSON.parse(localStorage.getItem(PGRE.store.KEY)).xp,
        toast: Array.prototype.map.call(document.querySelectorAll('#toasts .toast'), function (el) { return el.textContent; }).join(' | ')
      });
    }));
    h.assert(!after.persistFailed, 'restore reports success only when _persistFailed is false');
    h.assert(after.xp !== 1, 'the saved progress reads back the restored value');
    await h.openLibrary();
  } },
  { name: 'refused import never says Progress restored', size: '1100x900', shot: 'import-refused', run: async function (page, h) {
    await h.openLibrary();
    var msg = JSON.parse(await page.eval(function () {
      return new Promise(function (resolve) {
        var original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key === PGRE.store.KEY) {
            var err = new Error('QuotaExceededError');
            err.name = 'QuotaExceededError';
            throw err;
          }
          return original.apply(this, arguments);
        };
        var payload = PGRE.store.exportJSON();
        var file = new File([payload], 'progress.json', { type: 'application/json' });
        var input = document.getElementById('progress-input');
        var dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change'));
        setTimeout(function () {
          Storage.prototype.setItem = original;
          var toasts = Array.prototype.map.call(document.querySelectorAll('#toasts .toast'), function (el) {
            return el.textContent;
          });
          resolve(JSON.stringify({
            toasts: toasts,
            persistFailed: !!PGRE.store._persistFailed,
            saidRestored: toasts.some(function (t) { return t.indexOf('Progress restored.') !== -1; })
          }));
        }, 400);
      });
    }));
    h.assert(!msg.saidRestored, 'the import handler does not say Progress restored. after a refused write');
    h.assert(msg.toasts.join(' ').indexOf('saving still fails') !== -1 ||
      msg.toasts.join(' ').indexOf('Restore failed') !== -1,
      'the import handler reports that saving failed');
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
        (output.indexOf('BROWSER_TEST_FAILED:') !== -1
          ? '\n' + output.split('BROWSER_TEST_FAILED:').pop()
          : '')));
    });
    child.stdin.end(input || '');
  });
}

function startHelper(dir, port, token) {
  return new Promise(function (resolve, reject) {
    var child = spawn('python3', [HELPER], {
      env: Object.assign({}, process.env, {
        PGRE_BACKUP_DIR: dir,
        PGRE_BACKUP_PORT: String(port),
        PGRE_BACKUP_TOKEN: token,
        PYTHONDONTWRITEBYTECODE: '1'
      }),
      stdio: ['ignore', 'ignore', 'pipe']
    });
    var err = '';
    child.stderr.on('data', function (c) { err += c; });
    var tries = 0;
    function ping() {
      http.get({ host: '127.0.0.1', port: port, path: '/pgre-backup' }, function (res) {
        res.resume();
        resolve(child);
      }).on('error', function () {
        tries += 1;
        if (tries > 50) {
          child.kill('SIGTERM');
          reject(new Error('helper did not start: ' + err));
          return;
        }
        setTimeout(ping, 50);
      });
    }
    setTimeout(ping, 80);
  });
}

function freePort() {
  return new Promise(function (resolve) {
    var s = http.createServer();
    s.listen(0, '127.0.0.1', function () {
      var p = s.address().port;
      s.close(function () { resolve(p); });
    });
  });
}

function writeTamperedCopy(dir) {
  var files = fs.readdirSync(dir).filter(function (n) { return n.startsWith('snap-') && n.endsWith('.json'); });
  if (!files.length) throw new Error('no snapshot to tamper');
  files.sort();
  var envelope = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
  var parsed = JSON.parse(envelope.blob);
  parsed.xp = 9999;
  envelope.blob = JSON.stringify(parsed);
  var id = 'snap-20261020T235959Z-rev-' + envelope.rev + '-' + String(envelope.sha256).slice(0, 12);
  fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify(envelope));
  return id;
}

async function main() {
  var profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pgre-backup-chrome-'));
  var backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgre-backup-snaps-'));
  var shots = process.env.PGRE_BACKUP_SHOTS ? path.resolve(process.env.PGRE_BACKUP_SHOTS) : '';
  if (shots) fs.mkdirSync(shots, { recursive: true });
  var token = 'chrome-' + crypto.randomBytes(8).toString('hex');
  var helperPort = await freePort();
  var helper = await startHelper(backupDir, helperPort, token);
  var helperUrl = 'http://127.0.0.1:' + helperPort + '/pgre-backup';
  var fake = http.createServer(function (req, res) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-PGRE-Client, X-PGRE-Backup-Token',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });
    if (req.method === 'OPTIONS') { res.end(); return; }
    var sink = '';
    req.on('data', function (chunk) { sink += chunk; });
    req.on('end', function () { res.end(JSON.stringify({ ok: true })); });
  });
  await new Promise(function (resolve) { fake.listen(0, '127.0.0.1', resolve); });
  var fakePort = fake.address().port;
  var PAGE_CSP = "connect-src 'self' http://127.0.0.1:" + helperPort +
    ' http://127.0.0.1:' + fakePort + '; report-uri ' + CSP_REPORT_PATH;
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
    CHROME_DEVTOOLS_AXI_SESSION: 'pgre-backup-' + process.pid,
    CHROME_DEVTOOLS_AXI_AUTO_CONNECT: '0',
    CHROME_DEVTOOLS_AXI_BROWSER_URL: '',
    CHROME_DEVTOOLS_AXI_USER_DATA_DIR: profile,
    PGRE_BACKUP_HELPER_URL: helperUrl,
    PGRE_BACKUP_FAKE_URL: 'http://127.0.0.1:' + fakePort + '/pgre-backup',
    PGRE_BACKUP_TEST_TOKEN: token
  });
  if (!env.CHROME_DEVTOOLS_AXI_MCP_PATH) {
    env.CHROME_DEVTOOLS_AXI_MCP_PATH =
      '/Users/leyi/.npm/_npx/15c61037b1978c83/node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js';
  }
  try {
    await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
    env.PGRE_BACKUP_TEST_URL = 'http://127.0.0.1:' + server.address().port + '/';
    await run(['open', env.PGRE_BACKUP_TEST_URL], env);
    var size = '';
    for (var i = 0; i < STAGES.length; i++) {
      if (STAGES[i].name.indexOf('checksum') !== -1) {
        env.PGRE_BACKUP_TAMPER_ID = writeTamperedCopy(backupDir);
      }
      console.log('\n' + STAGES[i].name);
      if (STAGES[i].size !== size) {
        size = STAGES[i].size;
        await run(['emulate', '--viewport', size], env);
      }
      await run(['run'], env, 'try { var h = await (' + helpers.toString() + ')(page); await (' +
        STAGES[i].run.toString() +
        ')(page, h); } catch (error) { console.log("BROWSER_TEST_FAILED: " + error.stack); }');
      if (shots && STAGES[i].shot) {
        await run(['screenshot', path.join(shots, STAGES[i].shot + '.png')], env);
        console.log('screenshot ' + STAGES[i].shot + '.png');
      }
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
    try { helper.kill('SIGTERM'); } catch (e) {}
    await new Promise(function (resolve) { fake.close(resolve); });
    fs.rmSync(profile, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
}

main().catch(function (error) { console.error(error.stack || error.message); process.exitCode = 1; });
