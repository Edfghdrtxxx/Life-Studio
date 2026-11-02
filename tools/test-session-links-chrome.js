#!/usr/bin/env node
/* Real-page check of the learning-session links on Recall cards (#/formulas).
   Isolated Chrome profile on a throwaway 127.0.0.1 port; never the saved
   studio. The status bridge on 127.0.0.1:4789 is refused by CSP. A capture
   listener cancels each link's navigation, so the test never opens Obsidian.
   Run: node tools/test-session-links-chrome.js
   PGRE_SESSION_LINKS_SHOTS=<dir> also saves one screenshot per stage. */
'use strict';

var fs = require('fs');
var http = require('http');
var os = require('os');
var path = require('path');
var vm = require('vm');
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
var PHYSICS = ['Classical Mechanics', 'Electrodynamics', 'Quantum Mechanics',
  'Nuclear Physics', 'Mathematical Methods'];
function isBridgeUrl(u) { return /^https?:\/\/(127\.0\.0\.1|localhost):4789(\/|$)/.test(String(u)); }

function staticChecks() {
  function check(condition, message) {
    if (!condition) throw new Error(message);
    console.log('PASS: ' + message);
  }
  var ctx = { window: {} };
  ctx.PGRE = ctx.window.PGRE = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'data-session-links.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'bank.js'), 'utf8'), ctx);
  var P = ctx.PGRE;
  var ids = Object.keys(P.SESSION_LINKS);
  check(P.SESSION_VAULT === 'OrbitOS', 'links open the OrbitOS vault');
  check(ids.length > 0 && ids.every(function (id) { return /^(cpgf|cpgl|supp)-/.test(id); }),
    ids.length + ' linked ids are all Recall card ids');
  var paths = [];
  ids.forEach(function (id) { paths = paths.concat(P.SESSION_LINKS[id]); });
  check(paths.every(function (p) {
    var m = /^60_Learning_Progress\/([^/]+)\/\d{4}-\d{2}-\d{2}-\d{4} [^/]+\.md$/.exec(p);
    return m && PHYSICS.indexOf(m[1]) !== -1;
  }), 'all ' + paths.length + ' links point at dated notes in the five physics folders');
  check(Object.keys(P.SESSION_LABELS).every(function (p) { return paths.indexOf(p) !== -1; }),
    'every LaTeX label belongs to a linked note');
  var html = P.sessionLinksHTML({ id: 'supp-newton-momentum' });
  check(html.indexOf('href="obsidian://open?vault=OrbitOS&amp;file=60_Learning_Progress%2FClassical%20Mechanics' +
    '%2F2026-10-22-1609%20Elastic%20collision%20recoil%20velocities"') !== -1,
    'the href is the vault-relative path without .md, URL-encoded');
  check(html.indexOf('>Elastic collision recoil velocities</span></a>') !== -1 &&
    html.indexOf('>Sessions</span>') !== -1,
    'the link text is the file name without its date stamp, under a Sessions caption');
  check(P.sessionLinksHTML({ id: 'supp-friction' }) === '' && P.sessionLinksHTML(null) === '',
    'an unlinked card renders nothing');
  var vault = '/Users/Reid Hu/OrbitOS';
  if (fs.existsSync(vault)) {
    var missing = paths.filter(function (p) { return !fs.existsSync(path.join(vault, p)); });
    check(!missing.length, 'every linked note exists in the local vault' +
      (missing.length ? ': missing ' + missing.join(', ') : ''));
  } else {
    console.log('SKIP: no local OrbitOS vault to check note paths against');
  }
  var index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check(/js\/data-session-links\.js\?v=\d{8}[a-z]/.test(index), 'index.html loads js/data-session-links.js');
}

async function helpers(page) {
  var URL = process.env.PGRE_SESSION_LINKS_TEST_URL;
  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  var h = { sleep: sleep };
  h.LINKED = 'supp-newton-momentum';
  h.UNLINKED = 'supp-friction';
  h.TWO = 'cpgf-2.15';
  h.HREF = 'obsidian://open?vault=OrbitOS&file=60_Learning_Progress%2FClassical%20Mechanics' +
    '%2F2026-10-22-1609%20Elastic%20collision%20recoil%20velocities';

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
      '); b.focus(); b.click(); }');
  }
  h.click = click;

  // The links inside one container: href, visible label, KaTeX present.
  h.links = async function (selector) {
    return JSON.parse(await page.eval('() => { var root = document.querySelector(' +
      JSON.stringify(selector) + '); var out = []; if (root) root.querySelectorAll("[data-session-link]")' +
      '.forEach(function (a) { out.push({ href: a.getAttribute("href"), text: a.textContent.trim(), ' +
      'katex: !!a.querySelector(".katex"), w: a.getBoundingClientRect().width }); }); ' +
      'return JSON.stringify(out); }'));
  };

  // Review state on RAM and disk: SRS records, review log, Study session.
  h.state = async function () {
    return await page.eval(function () {
      var st = PGRE.store.state;
      var disk = JSON.parse(localStorage.getItem('pgre-state-v1') || '{}');
      return JSON.stringify({
        cards: st.cards, reviews: st.cardReviews, study: st.formulaStudy,
        diskCards: disk.cards, diskReviews: disk.cardReviews, diskStudy: disk.formulaStudy
      });
    });
  };

  h.flipped = async function () {
    return await page.eval(function () {
      var b = document.getElementById('fcard-back');
      return !!(b && !b.hidden);
    });
  };

  h.currentId = async function () {
    return await page.eval(function () {
      var cell = document.querySelector('.formula-palette .pal-cell.is-current');
      return cell ? cell.getAttribute('data-id') : '';
    });
  };

  h.showCard = async function (id) {
    if ((await h.currentId()) === id) return;
    var sel = '.formula-palette .pal-cell[data-id="' + id + '"]';
    await wait(sel);
    await click(sel);
    for (var i = 0; i < 30; i++) {
      if ((await h.currentId()) === id) return;
      await sleep(100);
    }
    throw new Error('palette did not open ' + id);
  };

  // Clicks the first link in the container with the mouse path, then Enter
  // on the focused link. The capture listener cancels the navigation.
  h.pressLink = async function (selector) {
    return await page.eval('() => { window.__sessionClicks = 0;' +
      'if (!window.__sessionGuard) { window.__sessionGuard = true;' +
      ' window.addEventListener("click", function (e) { var a = e.target.closest && ' +
      'e.target.closest("[data-session-link]"); if (a) { window.__sessionClicks++; e.preventDefault(); } }, true); }' +
      'var a = document.querySelector(' + JSON.stringify(selector + ' [data-session-link]') + ');' +
      'a.click(); a.focus();' +
      'a.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));' +
      'a.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));' +
      'a.blur(); return window.__sessionClicks; }');
  };

  h.openFormulas = async function () {
    await page.open(URL);
    await wait('#main');
    await page.eval(function () { location.hash = '#/formulas'; });
    await wait('#formulas-root');
    await wait('#study-btn, #resume-btn');
  };

  // Three cards: one linked supplemental card, one unlinked supplemental card,
  // and cpgf-2.15 (two sessions, one LaTeX label). The book card comes from
  // content/bank when present, else a stand-in with the same id.
  h.seed = async function () {
    await page.eval(function () {
      function pick(list, id) { return (list || []).filter(function (c) { return c.id === id; })[0]; }
      var linked = pick(PGRE.FORMULAS, 'supp-newton-momentum');
      var unlinked = pick(PGRE.FORMULAS, 'supp-friction');
      var two = pick(PGRE.BOOK_FORMULAS, 'cpgf-2.15') || {
        id: 'cpgf-2.15', eq: '2.15', topic: 'em', tag: 'Boundary conditions',
        front: 'Stand-in card: how does the normal component of $\\mathbf{E}$ change across a surface charge $\\sigma$?',
        back: '$$E^\\perp_{\\rm above} - E^\\perp_{\\rm below} = \\frac{\\sigma}{\\epsilon_0}$$'
      };
      if (!linked || !unlinked) throw new Error('missing supplemental cards in PGRE.FORMULAS');
      PGRE.FORMULAS = [linked, unlinked, two];
      PGRE.BOOK_FORMULAS = [];
      PGRE.BOOK_LISTS = [];
      var s = PGRE.store.state;
      s.cards = {};
      s.cardReviews = [];
      s.reviewUndos = {};
      s.formulaDay = { date: PGRE.srs.today(), reviewIds: [],
        newIds: ['supp-newton-momentum', 'supp-friction', 'cpgf-2.15'] };
      s.formulaStudy = null;
      s.formulaStudyEnd = null;
      s.formulaSuspended = {};
      s.settings.formulaDailyTarget = 3;
      s.settings.examDate = '';
      s.settings.keyboard = true;
      s.settings.formulaReverse = false;
      s.settings.theme = 'light';
      PGRE.store.save();
      if (PGRE.applyTheme) PGRE.applyTheme('light');
      return PGRE.contentDB && PGRE.contentDB.put
        ? PGRE.contentDB.put({ id: 'formula-deck', kind: 'formula-deck', cards: [] }) : null;
    });
    await page.eval(function () { location.hash = '#/'; });
    await sleep(250);
    await page.eval(function () { location.hash = '#/formulas'; });
    await wait('#study-btn');
    await click('#study-btn');
    await wait('#fcard');
  };

  return h;
}

var STAGES = [
  { name: 'linked card, front', shot: '01-linked-front', size: '1280x860',
    run: async function (page, h) {
      await h.openFormulas();
      await h.seed();
      await h.showCard(h.LINKED);
      h.assert(!(await h.flipped()), 'the linked card shows its front');
      var links = await h.links('#fcard-actions');
      h.assert(links.length === 1, 'the front action row has one session link (got ' + links.length + ')');
      h.assert(links[0].href === h.HREF, 'the link opens the session note: ' + links[0].href);
      h.assert(links[0].text === 'Elastic collision recoil velocities',
        'the link is labelled with the session title');
      var place = JSON.parse(await page.eval(function () {
        var sim = document.querySelector('#fcard-actions .similar-problem-btn').getBoundingClientRect();
        var row = document.querySelector('#fcard-actions .session-links').getBoundingClientRect();
        return JSON.stringify({ simBottom: sim.bottom, rowTop: row.top });
      }));
      h.assert(place.rowTop >= place.simBottom,
        'the Sessions line sits under the action buttons (' + place.rowTop + ' >= ' + place.simBottom + ')');
    } },

  { name: 'clicking the link on the front changes nothing',
    run: async function (page, h) {
      var before = await h.state();
      var hash = await page.eval('location.hash');
      var clicks = await h.pressLink('#fcard-actions');
      await h.sleep(400);
      h.assert(clicks === 3, 'click, Enter and Space each activate the link (' + clicks + ')');
      h.assert(!(await h.flipped()), 'the card did not flip');
      h.assert((await h.currentId()) === h.LINKED, 'the same card is still on screen');
      h.assert((await page.eval('location.hash')) === hash, 'the page stayed on ' + hash);
      h.assert((await h.state()) === before, 'SRS records, review log and Study session are unchanged on RAM and disk');
    } },

  { name: 'linked card, back', shot: '02-linked-back',
    run: async function (page, h) {
      await h.click('#flip-btn');
      await h.wait('[data-grade="good"]');
      var links = await h.links('#fcard-actions');
      h.assert(links.length === 1 && links[0].href === h.HREF,
        'the revealed grade row carries the same session link');
      var before = await h.state();
      var clicks = await h.pressLink('#fcard-actions');
      await h.sleep(400);
      h.assert(clicks === 3, 'the back link activates (' + clicks + ')');
      h.assert(!!(await page.eval('!!document.querySelector("[data-grade=\\"good\\"]")')),
        'the grade buttons are still waiting for a grade');
      h.assert((await h.currentId()) === h.LINKED, 'the card was not graded away');
      h.assert((await h.state()) === before, 'no grade, review row or session change was written');
    } },

  { name: 'card with two sessions', shot: '03-two-sessions',
    run: async function (page, h) {
      await h.showCard(h.TWO);
      await h.click('#flip-btn');
      await h.wait('[data-grade="good"]');
      var links = await h.links('#fcard-actions');
      h.assert(links.length === 2, 'cpgf-2.15 shows one link per session (got ' + links.length + ')');
      h.assert(links[0].href.indexOf('2026-09-15-0916%20Boundary%20condition%20on%20normal%20E') !== -1 &&
        links[1].href.indexOf('2026-09-20-1803%20Electric%20displacement%20D%20and%20linear%20dielectrics') !== -1,
        'the two links open the two session notes');
      h.assert(links[0].katex && links[1].katex, 'the LaTeX labels are typeset in the grade row');
    } },

  { name: 'dark theme', shot: '04-two-sessions-dark',
    run: async function (page, h) {
      await page.eval(function () { PGRE.setTheme('dark'); });
      await h.sleep(100);
      var c = JSON.parse(await page.eval(function () {
        var a = document.querySelector('#fcard-actions [data-session-link]');
        var probe = document.createElement('span');
        probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--ink-2').trim();
        document.body.appendChild(probe);
        var ink2 = getComputedStyle(probe).color;
        probe.remove();
        return JSON.stringify({ link: getComputedStyle(a).color, ink2: ink2,
          theme: document.documentElement.getAttribute('data-theme') });
      }));
      h.assert(c.theme === 'dark' && c.link === c.ink2,
        'in dark theme the links take the dark --ink-2 (' + c.link + ')');
    } },

  { name: 'unlinked card', shot: '05-unlinked',
    run: async function (page, h) {
      await page.eval(function () { PGRE.setTheme('light'); });
      await h.showCard(h.UNLINKED);
      h.assert(!(await h.flipped()), 'the unlinked card shows its front');
      h.assert((await h.links('#main')).length === 0, 'no session link on the unlinked card front');
      await h.click('#flip-btn');
      await h.wait('[data-grade="good"]');
      h.assert((await h.links('#main')).length === 0, 'no session link on the unlinked card back');
    } },

  { name: 'Search card browser', shot: '06-search',
    run: async function (page, h) {
      await h.click('button.flash-tab[data-mode="browse"]');
      await h.wait('article.fs-card[data-fsid="' + h.LINKED + '"]');
      var linked = await h.links('article.fs-card[data-fsid="' + h.LINKED + '"]');
      var unlinked = await h.links('article.fs-card[data-fsid="' + h.UNLINKED + '"]');
      h.assert(linked.length === 1 && linked[0].href === h.HREF, 'the Search card for the linked card has the link');
      h.assert(unlinked.length === 0, 'the Search card for the unlinked card has none');
      await page.eval('() => { document.querySelector(\'article.fs-card[data-fsid="' + h.LINKED +
        '"]\').scrollIntoView({ block: "center" }); }');
      await h.sleep(200);
    } },

  { name: 'Match tiles stay without links',
    run: async function (page, h) {
      await h.click('button.flash-tab[data-mode="practice"]');
      await h.wait('[data-game="match"]');
      await h.click('[data-game="match"]');
      await h.wait('#game-start');
      await h.click('#game-start');
      await h.wait('.flash-tile');
      h.assert((await h.links('#main')).length === 0,
        'Match tiles carry no session label that would pair them');
      h.assert(!!(await page.eval('!!document.querySelector(".flash-tile-wrap .similar-problem-btn")')),
        'Match tiles keep the similar-problem control');
    } },

  { name: 'narrow window', shot: '07-search-420', size: '420x860',
    run: async function (page, h) {
      await h.click('button.flash-tab[data-mode="browse"]');
      await h.wait('article.fs-card[data-fsid="' + h.TWO + '"]');
      var links = await h.links('article.fs-card[data-fsid="' + h.TWO + '"]');
      var sc = JSON.parse(await page.eval(function () {
        var root = document.scrollingElement || document.documentElement;
        return JSON.stringify({ client: root.clientWidth, scroll: root.scrollWidth });
      }));
      h.assert(links.length === 2 && links.every(function (l) { return l.w <= sc.client; }),
        'at 420 px each link fits the window');
      h.assert(sc.scroll <= sc.client + 1, 'no horizontal page scroll (' + sc.scroll + ' / ' + sc.client + ')');
      await page.eval('() => { document.querySelector(\'article.fs-card[data-fsid="' + h.TWO +
        '"] .session-links\').scrollIntoView({ block: "center" }); }');
      await h.sleep(200);
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
  var profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pgre-session-links-chrome-'));
  var shots = process.env.PGRE_SESSION_LINKS_SHOTS ? path.resolve(process.env.PGRE_SESSION_LINKS_SHOTS) : '';
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
    CHROME_DEVTOOLS_AXI_SESSION: 'pgre-session-links-' + process.pid,
    CHROME_DEVTOOLS_AXI_AUTO_CONNECT: '0',
    CHROME_DEVTOOLS_AXI_BROWSER_URL: '',
    CHROME_DEVTOOLS_AXI_USER_DATA_DIR: profile
  });
  try {
    await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
    env.PGRE_SESSION_LINKS_TEST_URL = 'http://127.0.0.1:' + server.address().port + '/';
    await run(['open', env.PGRE_SESSION_LINKS_TEST_URL], env);
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
