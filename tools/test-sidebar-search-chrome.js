#!/usr/bin/env node
/* Real-page check of the sidebar search box (js/sidebar-search.js): lazy
   engine load, the two shortcuts, grouped and marked results, arrow keys,
   Enter and the route it opens, the hand-over to #/search, Escape, the empty
   and no-results states, the folded sidebar, the narrow drawer, where the
   shortcut must stay out (fields, a live question, the exam room, Recall's own
   "/"), the sealed-exam rule, a touch screen, a page that boots off the Mac,
   and reduced motion. Synthetic questions in an isolated Chrome profile on a
   throwaway port; never the saved profile. Requests to the OrbitOS status
   bridge (127.0.0.1:4789) are refused by the page's Content-Security-Policy.
   Run: node tools/test-sidebar-search-chrome.js
   PGRE_SBS_SHOTS=<dir> also saves one screenshot per named state. */
'use strict';

var fs = require('fs');
var http = require('http');
var os = require('os');
var path = require('path');
var spawn = require('child_process').spawn;
var ROOT = path.resolve(__dirname, '..');
var MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };
/* js/status.js posts the status summary to the OrbitOS status bridge on
   127.0.0.1:4789. chrome-devtools-axi cannot block a URL, so the test server
   sends a Content-Security-Policy that lets the page connect to this server
   only. Chrome then refuses the bridge request, so these fixture questions
   never replace the snapshot agents read, and reports the refusal to
   CSP_REPORT_PATH. */
var BRIDGE_PORT = 4789; // js/status.js ENDPOINT
var CSP_REPORT_PATH = '/__csp-report';
var PAGE_CSP = "connect-src 'self'; report-uri " + CSP_REPORT_PATH;
function isBridgeUrl(u) { return /^https?:\/\/(127\.0\.0\.1|localhost):4789(\/|$)/.test(String(u)); }
var DESKTOP = '1280x860x2', NARROW = '700x800x2', PHONE = '390x800x2,mobile,touch';

/* Runs inside `chrome-devtools-axi run` before every stage (each stage is a
   separate run against the same page, so nothing here may hold state). */
async function helpers(page) {
  var URL = process.env.PGRE_SBS_TEST_URL;

  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  var h = { sleep: sleep };

  h.assert = function (condition, message) {
    if (!condition) throw new Error(message);
    console.log('PASS: ' + message);
  };

  h.until = async function (expression, what) {
    for (var attempt = 0; attempt < 100; attempt++) {
      if (await page.eval(expression)) return;
      await sleep(50);
    }
    throw new Error('Timeout waiting for ' + what);
  };

  /* Cmd+K on a Mac, Ctrl+K elsewhere — the page decides the same way. */
  async function chord() {
    return (await page.eval('/Mac|iPhone|iPad/.test(navigator.platform || "")')) ? 'Meta+k' : 'Control+k';
  }
  h.CHORD = await chord();

  h.load = async function (opts) {
    opts = opts || {};
    await page.open(URL + (opts.query || '') + (opts.hash || ''));
    await h.until('!!document.getElementById("sbs-input")', 'the sidebar search box');
    h.CHORD = await chord();
    await page.eval('() => { var dark = ' + !!opts.dark + ', folded = ' + !!opts.folded + ';' +
      'if ((document.documentElement.dataset.theme === "dark") !== dark) document.getElementById("theme-toggle").click();' +
      'if (!PGRE.isNarrow() && document.body.classList.contains("sidebar-folded") !== folded) PGRE.toggleSidebar(); }');
    await sleep(450);   // the sidebar's own fade (.35s) has ended
  };

  /* Everything the assertions read, in one snapshot of the real DOM. */
  h.ui = async function () {
    return JSON.parse(await page.eval(function () {
      function shown(node) {
        return !!node && !node.closest('[hidden]') && getComputedStyle(node).display !== 'none';
      }
      var input = document.getElementById('sbs-input');
      var panel = document.getElementById('sbs-panel');
      var button = document.getElementById('sbs-open');
      var open = !panel.hidden;
      var note = panel.querySelector('.sbs-note');
      var all = panel.querySelector('.sbs-all a');
      var rect = panel.getBoundingClientRect();
      var live = '.sbs-results:not([hidden]) ';
      var list = function (selector) {
        return open ? Array.prototype.slice.call(panel.querySelectorAll(live + selector)) : [];
      };
      return JSON.stringify({
        hash: location.hash,
        focus: document.activeElement ? document.activeElement.id : '',
        open: open,
        expanded: input.getAttribute('aria-expanded'),
        descendant: input.getAttribute('aria-activedescendant'),
        query: input.value,
        wholeSelected: input.selectionStart === 0 && input.selectionEnd === input.value.length,
        home: input.closest('#sidebar') ? 'sidebar' : input.closest('.sbs-head') ? 'panel' : 'none',
        note: open && shown(note) ? note.textContent : '',
        groups: list('.sbs-group').map(function (g) {
          return {
            label: g.querySelector('.sbs-group-head span').textContent,
            count: Number(g.querySelector('.sbs-count').textContent.replace(/\D/g, '')),
            rows: g.querySelectorAll('.sbs-row').length
          };
        }),
        rows: list('.sbs-row').map(function (r) {
          return {
            id: r.id, href: r.getAttribute('href'), text: r.textContent,
            selected: r.getAttribute('aria-selected') === 'true',
            marks: r.querySelectorAll('mark').length
          };
        }),
        last: open && shown(all) ? { href: all.getAttribute('href'), text: all.textContent } : null,
        keys: open && shown(panel.querySelector('.sbs-keys')),
        button: shown(button),
        buttonExpanded: button.getAttribute('aria-expanded'),
        buttonBox: (function (b) { return { left: b.left, bottom: b.bottom }; })(button.getBoundingClientRect()),
        body: document.body.className,
        panel: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        vw: document.documentElement.clientWidth,
        vh: window.innerHeight,
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        instances: document.querySelectorAll('#sbs-input').length + document.querySelectorAll('#sbs-panel').length
      });
    }));
  };

  h.selected = function (u) {
    var on = u.rows.filter(function (r) { return r.selected; });
    return on.length === 1 ? u.rows.indexOf(on[0]) : -1;
  };

  /* Type with real key presses, then wait for the rows (or the note) that
     answer exactly this query. */
  h.search = async function (text, expectRows) {
    await page.type(text);
    if (expectRows === false) {
      await h.until('document.querySelector("#sbs-panel .sbs-note").textContent.indexOf(' +
        JSON.stringify('“' + text + '”') + ') !== -1', 'the no-results note for ' + text);
    } else {
      await h.until('(function () { var re = new RegExp(' + JSON.stringify(text.split(/\s+/)[0]) + ', "i");' +
        'var rows = document.querySelectorAll("#sbs-panel .sbs-results:not([hidden]) .sbs-scroll .sbs-row");' +
        'return rows.length > 0 && Array.prototype.every.call(rows, function (r) { return re.test(r.textContent); }); })()',
        'results for ' + text);
    }
    return h.ui();
  };

  h.blur = async function () {
    await page.eval('() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }');
  };

  /* A pointer press as the page sees it: mousedown, then click. (The tool's
     own page.click is not usable inside a run script.) */
  h.press = async function (selector) {
    await page.eval('() => { var node = document.querySelector(' + JSON.stringify(selector) + ');' +
      'node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));' +
      'node.click(); }');
    await sleep(120);
  };

  h.pressOutside = async function () {
    await page.eval('() => { document.getElementById("view").dispatchEvent(' +
      'new MouseEvent("mousedown", { bubbles: true, cancelable: true })); }');
    await sleep(120);
  };

  /* Resolves once the box's index is ready, without building anything the
     box did not already start. */
  h.indexBuilt = async function () {
    await h.until('!!(window.PGRE && PGRE.search)', 'the engine script');
    await page.eval('() => { window.__sbsBuilt = false;' +
      'PGRE.search.buildIndex().then(function () { window.__sbsBuilt = true; }); }');
    await h.until('window.__sbsBuilt === true', 'the search index');
    await sleep(60);
  };

  /* Records every storage write made from inside js/sidebar-search.js. */
  h.installWriteProbe = async function () {
    await page.eval(function () {
      if (window.__sbsWrites) return;
      window.__sbsWrites = [];
      ['setItem', 'removeItem', 'clear'].forEach(function (name) {
        var orig = Storage.prototype[name];
        Storage.prototype[name] = function (key) {
          if (String(new Error().stack).indexOf('sidebar-search.js') !== -1) {
            window.__sbsWrites.push(name + ':' + key);
          }
          return orig.apply(this, arguments);
        };
      });
    });
  };

  return h;
}

/* Each stage ends in the state its screenshot names. */
var STAGES = [
  { name: 'empty-focused', shot: '01-empty-focused', size: DESKTOP, run: async function (page, h) {
    await h.load();
    h.assert(await page.eval(function () {
      var box = document.querySelector('#sidebar > .sbs');
      return !!box && box.nextElementSibling.id === 'sidebar-nav' && box.getAttribute('role') === 'search' &&
        !!box.querySelector('#sbs-input') && getComputedStyle(box).display !== 'none';
    }), 'the box sits in the sidebar, above the navigation');
    h.assert(await page.eval(function () {
      return typeof PGRE.search === 'undefined' && !document.querySelector('script[src*="js/search.js"]');
    }), 'page load neither fetches the search engine nor builds an index');
    await h.installWriteProbe();

    await page.press('/');
    var u = await h.ui();
    h.assert(u.focus === 'sbs-input' && u.open && u.expanded === 'true' && u.home === 'sidebar',
      '"/" focuses the box and opens its panel under it');
    h.assert(u.note.indexOf('Search the studio') === 0 && u.note.indexOf('Type two or more characters') !== -1 &&
      !u.rows.length && !u.keys,
      'the empty state names what is searched and how to start, with no rows and no key legend');
    await h.indexBuilt();
    h.assert(await page.eval(function () {
      return document.querySelectorAll('script[src*="js/search.js"]').length === 1;
    }), 'the first focus loads the engine once, through the search view\'s inject site');

    await page.type('e');
    await h.sleep(350);
    u = await h.ui();
    h.assert(u.query === 'e' && u.note.indexOf('Search the studio') === 0 && !u.rows.length,
      'one character runs no query');
    await page.press('Backspace');
    await h.sleep(250);
  } },

  { name: 'results', shot: '02-results', size: DESKTOP, run: async function (page, h) {
    var u = await h.search('energy');
    var labels = u.groups.map(function (g) { return g.label; });
    h.assert(u.groups.length >= 3 && labels[0] === 'Pages' && labels.indexOf('Questions') !== -1 &&
      labels.indexOf('Formula cards') !== -1,
      '"energy" finds at least three groups, the Studio\'s pages first: ' + labels.join(', '));
    h.assert(u.groups.every(function (g) { return g.rows >= 1 && g.rows <= 4 && g.count >= g.rows; }),
      'each group shows at most four rows under a heading that counts every hit');
    h.assert(u.rows.slice(0, -1).every(function (r) { return r.marks >= 1; }) &&
      await page.eval(function () {
        return Array.prototype.every.call(document.querySelectorAll('#sbs-panel .sbs-scroll mark'), function (m) {
          return m.textContent.toLowerCase() === 'energy';
        });
      }), 'every result row marks the matched word');
    h.assert(h.selected(u) === 0 && u.descendant === u.rows[0].id,
      'the first row starts highlighted and is announced through aria-activedescendant');
    h.assert(u.last && u.last.href === '#/search/energy' &&
      u.last.text.indexOf('Open “energy” on the Search page') === 0 &&
      u.rows[u.rows.length - 1].href === u.last.href,
      'the last row opens the Search page with the same query');
    h.assert(u.keys, 'the key legend shows with the rows');
    h.assert(await page.eval('getComputedStyle(document.getElementById("sbs-panel")).animationName') === 'sbs-in',
      'the panel opens with its short rise');
    h.assert(u.panel.left >= 0 && u.panel.right <= u.vw && u.panel.bottom <= u.vh && u.overflowX <= 0,
      'the panel stays inside the window and adds no horizontal scroll');
    h.assert(u.rows.every(function (r) { return !/\$|\\[a-zA-Z]+|\\\(/.test(r.text); }),
      'no row shows raw LaTeX');
    h.assert(await page.eval(function () {
      var pages = Array.prototype.slice.call(document.querySelectorAll('#sbs-panel .sbs-group')).filter(function (g) {
        return g.querySelector('.sbs-group-head span').textContent === 'Pages';
      })[0];
      return Array.prototype.every.call(pages.querySelectorAll('.sbs-row'), function (r) {
        return /^#\/[a-z]/.test(r.getAttribute('href')) && !!r.querySelector('.sbs-meta').textContent;
      });
    }), 'each Pages row leads to a route and names where it lives');
    await page.eval(function () {
      var m = getComputedStyle(document.querySelector('#sbs-panel .sbs-row[aria-selected="false"] mark'));
      window.__sbsMark = m.backgroundColor + '|' + m.fontWeight + '|' + m.color;
    });

    // typing never blocks: a burst of input events runs nothing until it settles
    await page.eval(function () {
      window.__sbsMatches = 0;
      window.__sbsMatchOrig = PGRE.search.match;
      PGRE.search.match = function () { window.__sbsMatches++; return window.__sbsMatchOrig.apply(this, arguments); };
    });
    var during = await page.eval(function () {
      var input = document.getElementById('sbs-input');
      for (var i = 0; i < 6; i++) input.dispatchEvent(new Event('input', { bubbles: true }));
      return window.__sbsMatches;
    });
    await h.sleep(450);
    var after = await page.eval(function () {
      PGRE.search.match = window.__sbsMatchOrig;
      return window.__sbsMatches;
    });
    h.assert(during === 0 && after === 3,
      'six input events in one task run no match; the settled burst runs one (pages, index, sealed titles): ' +
      during + ', ' + after);
    h.assert(h.selected(await h.ui()) === 0, 'results for "energy" stay on screen with the first row highlighted');
  } },

  { name: 'keyboard-selected-row', shot: '03-keyboard-selected-row', size: DESKTOP, run: async function (page, h) {
    var u = await h.ui();
    var n = u.rows.length;
    await page.press('ArrowDown');
    u = await h.ui();
    h.assert(h.selected(u) === 1 && u.descendant === u.rows[1].id && u.focus === 'sbs-input',
      'ArrowDown highlights the second row while the caret stays in the box');
    await page.press('ArrowDown');
    await page.press('ArrowUp');
    h.assert(h.selected(await h.ui()) === 1, 'ArrowUp steps back');
    await page.press('ArrowUp');
    await page.press('ArrowUp');
    u = await h.ui();
    h.assert(h.selected(u) === n - 1 && u.rows[n - 1].href === '#/search/energy',
      'ArrowUp from the first row wraps to the Search-page row');
    await page.press('ArrowDown');
    h.assert(h.selected(await h.ui()) === 0, 'ArrowDown from the last row wraps to the first');

    await page.eval(function () {
      var row = document.querySelectorAll('#sbs-panel .sbs-row')[3];
      var box = row.getBoundingClientRect();
      row.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: box.left + 20, clientY: box.top + 8 }));
    });
    u = await h.ui();
    h.assert(h.selected(u) === 3 && u.descendant === u.rows[3].id,
      'the pointer and the arrow keys share one highlighted row');

    for (var i = 3; i < n - 2; i++) await page.press('ArrowDown');
    u = await h.ui();
    h.assert(h.selected(u) === n - 2 && await page.eval(function () {
      var row = document.querySelector('#sbs-panel .sbs-row[aria-selected="true"]').getBoundingClientRect();
      var scroller = document.querySelector('#sbs-panel .sbs-scroll').getBoundingClientRect();
      return row.top >= scroller.top - 0.5 && row.bottom <= scroller.bottom + 0.5;
    }), 'arrowing to the last result scrolls it fully into the list');
    for (var j = n - 2; j > 4; j--) await page.press('ArrowUp');
    u = await h.ui();
    h.assert(h.selected(u) === 4 && await page.eval(function () {
      var row = document.querySelector('#sbs-panel .sbs-row[aria-selected="true"]');
      var panel = document.getElementById('sbs-panel');
      return getComputedStyle(row).backgroundColor !== getComputedStyle(panel).backgroundColor;
    }), 'the highlighted row carries its own background');
  } },

  { name: 'open-and-hand-over', shot: '04-search-page-hand-over', size: DESKTOP, run: async function (page, h) {
    var u = await h.ui();
    var target = u.rows[h.selected(u)].href;
    await page.press('Enter');
    await h.until('location.hash === ' + JSON.stringify(target), 'the route ' + target);
    u = await h.ui();
    h.assert(u.hash === target && /^#\/topic\//.test(target) && !u.open && u.expanded === 'false' &&
      u.focus === 'main' && u.query === '',
      'Enter opens the highlighted result (' + target + '), closes the panel, empties the box and hands ' +
      'the keyboard to the page');

    // the Search page itself, opened the old way, is as it was
    await page.eval('() => { location.hash = "#/search"; }');
    await h.until('!!document.querySelector(".srch-statcard")', 'the Search page');
    h.assert(await page.eval(function () {
      return document.getElementById('srch-input').value === '' && document.activeElement.id === 'srch-input' &&
        !document.querySelector('.srch-hit') &&
        !document.querySelector('#sidebar-nav a[href="#/search"]');
    }), 'the Search page is unchanged: empty box, stats card; round 2 leaves it out of the nav');

    // the shortcut stays out of fields
    await page.press('/');
    await page.press(h.CHORD);
    u = await h.ui();
    h.assert(!u.open && u.focus === 'srch-input' &&
      await page.eval('document.getElementById("srch-input").value') === '/',
      'in an input "/" types a slash and neither shortcut moves focus');
    await page.eval(function () {
      var view = document.getElementById('view');
      view.insertAdjacentHTML('beforeend', '<textarea id="sbs-test-area"></textarea>' +
        '<div id="sbs-test-edit" contenteditable="true"></div>');
      document.getElementById('sbs-test-area').focus();
    });
    await page.press('/');
    await page.press(h.CHORD);
    u = await h.ui();
    h.assert(!u.open && u.focus === 'sbs-test-area' &&
      await page.eval('document.getElementById("sbs-test-area").value') === '/',
      'in a textarea "/" types a slash and neither shortcut moves focus');
    await page.eval('() => { document.getElementById("sbs-test-edit").focus(); }');
    await page.press('/');
    await page.press(h.CHORD);
    u = await h.ui();
    h.assert(!u.open && u.focus === 'sbs-test-edit', 'in an editable block neither shortcut moves focus');
    await page.eval(function () {
      document.getElementById('sbs-test-area').remove();
      document.getElementById('sbs-test-edit').remove();
    });

    // the chord, then the last row
    await h.blur();
    await page.press(h.CHORD);
    u = await h.ui();
    h.assert(u.focus === 'sbs-input' && u.open && u.note.indexOf('Search the studio') === 0,
      h.CHORD + ' focuses the box, back in its empty state');
    u = await h.search('energy');
    await page.press('ArrowUp');
    await page.press('Enter');
    await h.until('location.hash === "#/search/energy" && !!document.querySelector(".srch-hit")',
      'the Search page with results');
    h.assert(await page.eval(function () {
      var heads = Array.prototype.map.call(document.querySelectorAll('.srch-group-head h2'), function (x) {
        return x.textContent;
      });
      return document.getElementById('srch-input').value === 'energy' &&
        heads.indexOf('Questions') !== -1 && heads.indexOf('Formula cards') !== -1 &&
        !document.querySelector('#sidebar-nav a[href="#/search"]');
    }), 'the last row lands on #/search/energy with the query already searched');
    h.assert(await page.eval(function () {
      var m = getComputedStyle(document.querySelector('.srch-hit mark'));
      return window.__sbsMark === m.backgroundColor + '|' + m.fontWeight + '|' + m.color;
    }), 'the box marks a match exactly as the Search page does (same background, weight and colour)');
    u = await h.ui();
    h.assert(!u.open && u.query === '', 'the query moved to the Search page: the panel is closed and the box is empty');
  } },

  { name: 'no-results', shot: '05-no-results', size: DESKTOP, run: async function (page, h) {
    await page.eval('() => { location.hash = "#/"; }');
    await h.until('!document.getElementById("srch-input")', 'the dashboard');
    await h.blur();
    await page.press('/');
    var u = await h.search('zzqxv', false);
    h.assert(u.query === 'zzqxv' && u.note.indexOf('No matches for “zzqxv”.') === 0 &&
      u.note.indexOf('every word must appear') !== -1 && !u.rows.length && !u.last && !u.keys,
      'a query nothing matches says so, with no rows, no Search-page row and no key legend');
  } },

  { name: 'escape-and-the-rest', size: DESKTOP, run: async function (page, h) {
    await page.press('Escape');
    var u = await h.ui();
    h.assert(!u.open && u.query === '' && u.expanded === 'false' && u.descendant === null && u.focus !== 'sbs-input',
      'Escape clears the query and closes the panel');

    await page.eval('() => { document.querySelector("#sidebar-nav a[href=\\"#/study-time\\"]").focus(); }');
    await page.press('/');
    await page.press('Escape');
    h.assert(await page.eval('document.activeElement.getAttribute("href")') === '#/study-time',
      'Escape returns focus to where it was before the shortcut');

    await h.blur();
    await page.press('/');
    u = await h.search('analytics');
    h.assert(u.groups.length === 1 && u.groups[0].label === 'Pages' && u.rows.length === 1 && !u.last,
      'a query only a page matches offers that page and no Search-page row (that page lists no pages)');
    await h.pressOutside();
    u = await h.ui();
    h.assert(!u.open && u.query === 'analytics', 'a press outside closes the panel and keeps the query');
    await h.blur();   // a real press would also have taken focus out of the box
    await page.press('/');
    u = await h.ui();
    h.assert(u.open && u.query === 'analytics' && u.wholeSelected && h.selected(u) === 0,
      'the shortcut comes back to the kept query, selected for typing over, its first row highlighted');
    await h.press('.sbs-clear');
    u = await h.ui();
    h.assert(u.open && u.query === '' && u.focus === 'sbs-input' && u.note.indexOf('Search the studio') === 0,
      'the clear button empties the box and leaves it focused');
    await page.type('analytics');
    await h.until('document.querySelectorAll("#sbs-panel .sbs-results:not([hidden]) .sbs-row").length === 1', 'the page row');
    await h.press('#sbs-panel .sbs-row');
    await h.until('location.hash === "#/analytics"', 'the Analytics route');
    h.assert(!(await h.ui()).open, 'a click on a row opens it and closes the panel');

    await h.blur();
    await page.press('/');
    u = await h.search('harmonic oscillator');
    await page.press('ArrowUp');
    await page.press('Enter');
    await h.until('!!document.querySelector(".srch-hit")', 'the Search page with results');
    h.assert(u.last.href === '#/search/harmonic%20oscillator' && u.hash !== u.last.href &&
      await page.eval('location.hash') === u.last.href &&
      await page.eval('document.getElementById("srch-input").value') === 'harmonic oscillator',
      'a query of two words reaches the Search page whole');

    h.assert(await page.eval('window.__sbsWrites.length') === 0,
      'the box wrote nothing to localStorage or sessionStorage through all of the above');
    h.assert((await h.ui()).instances === 2, 'there is one box and one panel');
  } },

  { name: 'folded-sidebar', shot: '06-folded-sidebar', size: DESKTOP, run: async function (page, h) {
    await h.load({ folded: true });
    var u = await h.ui();
    h.assert(/\bsidebar-folded\b/.test(u.body) && u.button &&
      await page.eval('getComputedStyle(document.getElementById("sidebar")).display') === 'none',
      'with the sidebar folded a search button stands in the top bar');
    await page.press(h.CHORD);
    u = await h.ui();
    h.assert(u.open && u.focus === 'sbs-input' && u.home === 'panel' && u.buttonExpanded === 'true',
      'the shortcut opens the panel under that button with the box in its head, focused');
    h.assert(Math.abs(u.panel.left - u.buttonBox.left) <= 1 && u.panel.top > u.buttonBox.bottom &&
      u.panel.right <= u.vw && u.panel.bottom <= u.vh,
      'the panel hangs from the button and stays inside the window');
    u = await h.search('wave');
    h.assert(u.groups.length >= 3 && h.selected(u) === 0 && u.last.href === '#/search/wave',
      'typing there gives the same grouped results: ' +
      u.groups.map(function (g) { return g.label + ' ' + g.count; }).join(', '));
    await page.press('ArrowDown');
    h.assert(h.selected(await h.ui()) === 1, 'the arrow keys work there too');
  } },

  { name: 'folded-actions', size: DESKTOP, run: async function (page, h) {
    var u = await h.ui();
    var target = u.rows[h.selected(u)].href;
    await page.press('Enter');
    await h.until('location.hash === ' + JSON.stringify(target), 'the route ' + target);
    u = await h.ui();
    h.assert(!u.open && u.home === 'sidebar' && u.buttonExpanded === 'false' && u.focus === 'main' && u.query === '',
      'Enter opens the result; the box goes back, empty, to its place in the sidebar');
    await h.press('#sbs-open');
    u = await h.ui();
    h.assert(u.open && u.home === 'panel' && u.focus === 'sbs-input' && u.buttonExpanded === 'true',
      'a press on the button opens the panel and focuses the box');
    await h.press('#sbs-open');
    u = await h.ui();
    h.assert(!u.open && u.focus === 'sbs-open', 'a second press closes it and keeps focus on the button');
    await page.press('/');
    await page.press('Escape');
    u = await h.ui();
    h.assert(!u.open && u.query === '' && u.focus === 'sbs-open',
      'Escape clears and closes there as well, back to the button');
    await page.eval('() => { PGRE.toggleSidebar(); }');
    await h.sleep(450);
    await h.blur();
    await page.press('/');
    u = await h.ui();
    h.assert(!u.button && u.open && u.home === 'sidebar', 'unfolded, the button is gone and the box is in the sidebar');
    await page.press('Escape');
  } },

  { name: 'dark-theme', shot: '07-dark-theme', size: DESKTOP, run: async function (page, h) {
    await h.load({ dark: true });
    await page.press('/');
    var u = await h.search('energy');
    await page.press('ArrowDown');
    await page.press('ArrowDown');
    u = await h.ui();
    h.assert(h.selected(u) === 2 && await page.eval(function () {
      function lum(colour) {
        var c = colour.match(/[\d.]+/g).slice(0, 3).map(function (v) {
          v = Number(v) / 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      }
      var panel = lum(getComputedStyle(document.getElementById('sbs-panel')).backgroundColor);
      var row = lum(getComputedStyle(document.querySelector('#sbs-panel .sbs-row[aria-selected="true"]')).backgroundColor);
      return document.documentElement.dataset.theme === 'dark' && (row + 0.05) / (panel + 0.05) >= 1.15;
    }), 'on the dark theme the highlighted row stands off the panel (contrast 1.15 or more)');
  } },

  { name: 'narrow-window', shot: '08-narrow-window', size: NARROW, run: async function (page, h) {
    await h.load();
    var u = await h.ui();
    h.assert(await page.eval('PGRE.isNarrow()') && !/\bsidebar-open\b/.test(u.body) && u.button,
      'in a narrow window the drawer is closed and the search button is in the top bar');
    await h.press('#sbs-open');
    u = await h.search('wave');
    h.assert(u.home === 'panel' && u.groups.length >= 3 && u.panel.left >= 0 && u.panel.right <= u.vw &&
      u.overflowX <= 0, 'the button opens the same panel, inside the window, with no horizontal scroll');
  } },

  { name: 'narrow-drawer', shot: '09-narrow-drawer', size: NARROW, run: async function (page, h) {
    await page.press('Escape');
    h.assert(!(await h.ui()).open, 'Escape closes it');
    await page.eval('() => { document.getElementById("sidebar-toggle").click(); }');
    await h.sleep(450);
    var u = await h.ui();
    h.assert(/\bsidebar-open\b/.test(u.body) && !u.button, 'with the drawer open the button gives way to the box');
    await page.eval('() => { document.getElementById("sbs-input").focus(); }');
    u = await h.search('wave');
    h.assert(u.home === 'sidebar' && u.groups.length >= 3 && u.panel.right <= u.vw &&
      await page.eval(function () {
        var panel = document.getElementById('sbs-panel').getBoundingClientRect();
        var top = document.elementFromPoint(panel.right - 30, panel.top + 30);
        return !!top && !!top.closest('#sbs-panel');
      }), 'the panel hangs under the box and lies over the drawer and its scrim');
  } },

  { name: 'narrow-escape', size: NARROW, run: async function (page, h) {
    await page.press('Escape');
    var u = await h.ui();
    h.assert(!u.open && u.query === '' && /\bsidebar-open\b/.test(u.body),
      'the first Escape clears and closes the search; the drawer stays');
    await page.press('Escape');
    h.assert(!/\bsidebar-open\b/.test((await h.ui()).body), 'the next Escape closes the drawer');
  } },

  { name: 'phone-width', shot: '10-phone-width', size: PHONE, run: async function (page, h) {
    await h.load();
    await h.press('#sbs-open');
    var u = await h.search('energy');
    h.assert(u.home === 'panel' && u.groups.length >= 3 && u.panel.left >= 0 && u.panel.right <= u.vw &&
      u.panel.bottom <= u.vh && u.overflowX <= 0,
      'at 390 px the panel fits the window: ' + Math.round(u.panel.left) + ' to ' + Math.round(u.panel.right) +
      ' of ' + u.vw);
    h.assert(await page.eval('matchMedia("(pointer: coarse)").matches') && !u.keys &&
      await page.eval('getComputedStyle(document.querySelector(".sbs-kbd")).display') === 'none',
      'on a touch screen the key legend and the shortcut chip are left out');
  } },

  { name: 'where-the-shortcut-stays-out', size: DESKTOP, run: async function (page, h) {
    await h.load({ hash: '#/formulas' });
    await h.until('!!document.querySelector("#view .flash-tab[data-mode=\"browse\"]")', 'Recall\'s tabs');
    await page.eval(function () {
      document.querySelector('#view .flash-tab[data-mode="browse"]').click();
    });
    await h.until('!!document.getElementById("fs-input")', 'Recall\'s Search tab');
    await h.blur();
    await page.press('/');
    var u = await h.ui();
    h.assert(u.focus === 'fs-input' && !u.open, 'on Recall\'s Search tab "/" still focuses that tab\'s own box');
    await h.blur();
    await page.press(h.CHORD);
    u = await h.ui();
    h.assert(u.focus === 'sbs-input' && u.open, 'and ' + h.CHORD + ' reaches the sidebar box from there');
    await page.press('Escape');

    await page.eval(function () {
      ['sbs-live-a', 'sbs-live-b'].forEach(function (id) {
        PGRE.QUESTIONS.push({
          id: id, topic: 'em', difficulty: 1,
          q: '<p>Choose the first option for this sidebar-search test (zyxwlive): ' + id + '.</p>',
          choices: ['First option', 'Second option'], answer: 0,
          sol: '<p>The first option is the test answer.</p>'
        });
      });
      PGRE._resetBankCache();
      sessionStorage.setItem('pgre-quiz-config', JSON.stringify({
        ids: ['sbs-live-a', 'sbs-live-b'], label: 'Sidebar search test', purpose: 'similar'
      }));
      location.hash = '#/practice/custom';
    });
    await h.until('!!document.querySelector("#practice-root #confirm-btn") && !!document.querySelector(".choice[data-idx=\\"0\\"]")',
      'a live practice question');
    await h.blur();
    await page.press('/');
    await page.press(h.CHORD);
    u = await h.ui();
    h.assert(!u.open && u.focus !== 'sbs-input', 'on a question whose clock is running neither shortcut fires');
    await page.eval('() => { document.getElementById("sbs-input").focus(); }');
    h.assert((await h.ui()).open, 'the box itself still opens there when it is clicked into');
    await page.press('Escape');
    await page.eval(function () {
      var choice = document.querySelector('.choice[data-idx="0"]');
      choice.focus(); choice.click();
      document.getElementById('confirm-btn').click();
    });
    await h.until('!document.querySelector("#practice-root #confirm-btn")', 'the answered question');
    await h.blur();
    await page.press('/');
    u = await h.ui();
    h.assert(u.open && u.focus === 'sbs-input', 'once the question is answered the shortcut works again');
    u = await h.search('zyxwlive');
    h.assert(u.groups.length === 1 && u.groups[0].label === 'Questions' && u.groups[0].count === 2,
      'and finds the two questions added after the box was first opened: each open refreshes the index');
    await page.press('Escape');

    await h.blur();
    await page.eval('() => { document.body.insertAdjacentHTML("beforeend", "<div id=\\"sbs-test-modal\\" aria-modal=\\"true\\"></div>"); }');
    await page.press('/');
    await page.press(h.CHORD);
    u = await h.ui();
    await page.eval('() => { document.getElementById("sbs-test-modal").remove(); }');
    h.assert(!u.open && u.focus !== 'sbs-input', 'while a dialog is open neither shortcut fires');
  } },

  /* Unsat intact exams (src 'cpg-exam' or 'ets-exam') are omitted from the
     shared index the same way: no sample-exam group, no solution hit, no
     title-only exam row. A leftover mistake or note on an unsat id still
     seals to title only. Sat exam questions index as ordinary questions.
     Sealed leftovers stay out while a practice set or a mock exam is
     unfinished. */
  { name: 'sealed-exam-questions', size: DESKTOP, run: async function (page, h) {
    await h.load();
    var stem = await page.eval(function () {
      function sealed(id, word) {
        return { id: id, title: 'Sidebar search test exam', questions: [{
          id: id + '-q1', topic: 'cm', difficulty: 1,
          q: '<p>A sealed stem that mentions ' + word + ' once and then runs on for long enough that the ' +
            'window cut around the match cannot reach the choices or the worked solution below it.</p>',
          choices: ['sealedchoiceone', 'sealedchoicetwo'], answer: 0,
          sol: '<p>sealedsolutiontext</p>'
        }] };
      }
      PGRE.BOOK_EXAMS = (PGRE.BOOK_EXAMS || []).concat([sealed('sbs-book-exam', 'zyxwbook')]);
      PGRE.ETS_EXAMS = (PGRE.ETS_EXAMS || []).concat([sealed('sbs-ets-exam', 'zyxwets')]);
      PGRE._resetBankCache();
      // the book question missed once (a mistake-book entry that names the wrong pick),
      // and a note on the ETS question (an entry whose body is that question's stem)
      var q = PGRE.questionById('sbs-book-exam-q1');
      PGRE.gamify.recordAnswer(q, false, 30000, { mode: 'practice', picked: 1 });
      PGRE.notes.set('sbs-ets-exam-q1', 'zyxwnote reminder');
      return q.q.replace(/<[^>]*>/g, '');
    });
    var shown = async function () {
      return JSON.parse(await page.eval(function () {
        return JSON.stringify(Array.prototype.map.call(
          document.querySelectorAll('#sbs-panel .sbs-scroll .sbs-row'), function (r) {
            var snip = r.querySelector('.sbs-snip');
            return { title: r.querySelector('.sbs-title').textContent, snip: snip ? snip.textContent : '',
              all: r.textContent };
          }));
      }));
    };
    var fromStem = function (text) {
      return stem.indexOf(text.replace(/^(…|\.\.\.)\s*|\s*(…|\.\.\.)$/g, '')) !== -1;
    };
    var again = async function () { await page.press('Escape'); await h.blur(); await page.press('/'); };
    h.assert(await page.eval('location.hash === "" && !PGRE.examEngine.active()'),
      'on the dashboard, with no mock exam unfinished');

    await page.press('/');
    await h.indexBuilt();
    var u = await h.search('zyxwets', false);
    h.assert(!u.rows.length,
      'a released ETS exam question is not in the box, and the note on it is not found through the question\'s words');
    await again();
    u = await h.search('zyxwnote');
    var rows = await shown();
    h.assert(u.groups.length === 1 && u.groups[0].label === 'Notes' && rows.length === 1 &&
      rows[0].all.indexOf('sealed stem') === -1,
      'that note is found by its own words and shows only them');

    await again();
    u = await h.search('zyxwbook');
    rows = await shown();
    h.assert(u.groups.map(function (g) { return g.label + ' ' + g.count; }).join(', ') ===
      'Mistakes 1' && rows.length === 1 && u.last.text.indexOf('1 result') !== -1,
      'an unsat book sample-exam question is omitted from the index; only a leftover mistake on that id remains');
    h.assert(rows.every(function (r) {
      return fromStem(r.title) && (!r.snip || fromStem(r.snip)) && r.all.replace(/^CM/, '') === r.title + r.snip;
    }), 'that leftover row shows words of the question\'s stem and nothing else');
    h.assert(rows.every(function (r) { return !/sealedchoice|sealedsolutiontext|wrong picks/.test(r.all); }),
      'no choice, no solution and no wrong pick is on screen');

    await again();
    u = await h.search('sealedsolutiontext', false);
    var none = !u.rows.length;
    await again();
    u = await h.search('sealedchoicetwo', false);
    h.assert(none && !u.rows.length, 'a word of the solution, of a choice or of the wrong pick finds nothing in the box');
    await page.press('Escape');
    await page.eval('() => { location.hash = "#/search/sealedsolutiontext"; }');
    await h.until('!!document.querySelector(".srch-empty, .srch-hit")', 'the Search page answer');
    h.assert(await page.eval('!!document.querySelector(".srch-empty") && !document.querySelector(".srch-hit")'),
      'the Search page also omits the unsat book exam, so a word of its solution finds nothing');

    await page.eval(function () {
      sessionStorage.setItem('pgre-quiz-config', JSON.stringify({
        ids: [PGRE.QUESTIONS[0].id, PGRE.QUESTIONS[1].id], label: 'Sidebar search test', purpose: 'similar'
      }));
      location.hash = '#/practice/custom';
    });
    await h.until('!!document.querySelector("#practice-root #confirm-btn")', 'a live practice question');
    await page.eval('() => { document.getElementById("sbs-input").focus(); }');
    u = await h.search('zyxwbook', false);
    h.assert(!u.rows.length, 'on a practice set the box shows no sealed question');
    await page.press('Escape');
    await page.eval('() => { location.hash = "#/"; }');
    await h.until('!document.getElementById("practice-root")', 'the dashboard');
    await h.blur();
    await page.press('/');
    u = await h.search('zyxwbook');
    h.assert(u.groups.length === 1 && u.groups[0].label === 'Mistakes',
      'once the practice page is left the leftover mistake is back, still without a sample-exam row');
  } },

  /* The box reads navigator.platform once, at load: the test server hands
     this stage a page whose platform is not a Mac's. */
  { name: 'off-the-mac', size: DESKTOP, run: async function (page, h) {
    await h.load({ query: '?platform=Win32' });
    h.assert(await page.eval('navigator.platform') === 'Win32' &&
      await page.eval('document.querySelector(".sbs-kbd").textContent') === 'Ctrl K' &&
      await page.eval('document.getElementById("sbs-open").title') === 'Search (Ctrl K)',
      'off the Mac the box names Ctrl K as its shortcut');
    await page.press('Control+k');
    var u = await h.ui();
    h.assert(u.open && u.focus === 'sbs-input', 'and Ctrl+K focuses it');
    await page.press('Escape');
    await h.blur();
    await page.press('Meta+k');
    u = await h.ui();
    h.assert(!u.open && u.focus !== 'sbs-input', 'while the Mac\'s chord does nothing there');
  } },

  /* The real room (js/view-exam.js). The 70-question format needs a bank of
     70, so the public questions are copied under new ids, in page memory. */
  { name: 'mock-exam-room', size: DESKTOP, run: async function (page, h) {
    await h.load();
    await page.eval(function () {
      var base = PGRE.QUESTIONS.slice();
      for (var round = 1; round <= 4; round++) {
        base.forEach(function (q) {
          var copy = {};
          for (var key in q) copy[key] = q[key];
          copy.id = q.id + '-sbs' + round;
          PGRE.QUESTIONS.push(copy);
        });
      }
      PGRE._resetBankCache();
      location.hash = '#/exam';
    });
    await h.until('!!document.getElementById("start-70")', 'the 70-question mock exam');
    await page.eval('() => { document.getElementById("start-70").click(); }');
    await h.until('location.hash === "#/exam/run" && document.body.classList.contains("exam-fullscreen") && ' +
      '!!document.getElementById("exam-q-heading")', 'the mock-exam room');
    var exam = function () {
      return page.eval(function () {
        var e = PGRE.examEngine.active();
        var host = document.getElementById('exam-modal-host');
        return JSON.stringify([e.cursor, e.paused, e.answers, e.flags, !!(host && host.firstChild)]);
      });
    };
    var before = await exam();
    await page.press('/');
    await page.press('Meta+k');
    await page.press('Control+k');
    await h.sleep(200);
    var u = await h.ui();
    h.assert(!u.open && u.focus !== 'sbs-input' && !u.button && u.hash === '#/exam/run',
      'in the mock-exam room "/", Cmd+K and Ctrl+K do nothing, and the top bar\'s search button is not on screen');
    h.assert(before === '[0,false,{},[],false]' && await exam() === before,
      'and the exam is as it was: first question, clock running, no answer, no flag, no dialog');

    // the room left with the exam unfinished: sealed questions stay out of the box
    await page.eval(function () {
      PGRE.BOOK_EXAMS = (PGRE.BOOK_EXAMS || []).concat([{ id: 'sbs-room-exam', title: 'Sidebar search test exam',
        questions: [{ id: 'sbs-room-exam-q1', topic: 'cm', difficulty: 1,
          q: '<p>A sealed stem that mentions zyxwroom.</p>', choices: ['one', 'two'], answer: 0, sol: '<p>three</p>' }] }]);
      PGRE._resetBankCache();
      location.hash = '#/';
    });
    await h.until('!document.body.classList.contains("exam-fullscreen")', 'the dashboard');
    await h.blur();
    await page.press('/');
    await h.indexBuilt();
    u = await h.search('zyxwroom', false);
    h.assert(await page.eval('!!PGRE.examEngine.active()') && !u.rows.length,
      'with that exam left unfinished the box shows no sealed question');
    await page.press('Escape');
    await page.eval('() => { PGRE.examEngine.discard(PGRE.examEngine.active()); }');
    await h.blur();
    await page.press('/');
    await h.indexBuilt();
    u = await h.search('zyxwroom', false);
    h.assert(!u.rows.length && !(await page.eval('!!PGRE.examEngine.active()')),
      'once that sitting is discarded the unsat book exam stays omitted from the box');
  } },

  { name: 'reduced-motion', size: DESKTOP, chrome: '--force-prefers-reduced-motion', run: async function (page, h) {
    await h.load();
    await page.press('/');
    var u = await h.search('energy');
    var motion = JSON.parse(await page.eval(function () {
      function of(selector) { return getComputedStyle(document.querySelector(selector)); }
      return JSON.stringify({
        asked: matchMedia('(prefers-reduced-motion: reduce)').matches,
        panel: of('#sbs-panel').animationName,
        field: of('.sbs-field').transitionDuration,
        clear: of('.sbs-clear').transitionDuration
      });
    }));
    h.assert(motion.asked && u.open && u.rows.length > 0 && motion.panel === 'none' &&
      motion.field === '0s' && motion.clear === '0s',
      'with reduced motion asked for, the panel opens with no animation and the box changes with no transition');
  } }
];

/* Source-level guards: nothing persisted, no second engine. */
function staticChecks() {
  var source = fs.readFileSync(path.join(ROOT, 'js', 'sidebar-search.js'), 'utf8');
  var code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  function check(condition, message) {
    if (!condition) throw new Error(message);
    console.log('PASS: ' + message);
  }
  check(!/localStorage|sessionStorage|indexedDB|PGRE\.store|pgre-state/.test(code),
    'js/sidebar-search.js touches no storage and no saved state');
  check((code.match(/PGRE\.search\.match\(/g) || []).length === 3 && !/\.hay\b|\.score\b/.test(code),
    'js/sidebar-search.js matches through PGRE.search.match (pages, index, sealed titles) and reads no haystack or score itself');
  var index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check(/<script src="js\/sidebar-search\.js\?v=\d{8}[a-z]" defer><\/script>/.test(index) &&
    !/<script[^>]+js\/search\.js/.test(index),
    'index.html loads the box with a cache token and still does not script-tag the engine');
}

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
      else reject(new Error('chrome-devtools-axi ' + args[0] + ' exited ' + code));
    });
    child.stdin.end(input || '');
  });
}

async function main() {
  staticChecks();
  var profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pgre-sidebar-search-chrome-'));
  var shots = process.env.PGRE_SBS_SHOTS ? path.resolve(process.env.PGRE_SBS_SHOTS) : '';
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
    var platform = pathname === '/' && /[?&]platform=(\w+)/.exec(request.url);
    if (platform) {   // the same page, on a machine that is not a Mac
      response.end(fs.readFileSync(file, 'utf8').replace('<head>', '<head><script>' +
        'Object.defineProperty(Navigator.prototype, "platform", { get: function () { return "' +
        platform[1] + '"; } });</script>'));
      return;
    }
    fs.createReadStream(file).pipe(response);
  });
  var flags = process.env.CHROME_DEVTOOLS_AXI_CHROME_ARGS || '';
  var env = Object.assign({}, process.env, {
    CHROME_DEVTOOLS_AXI_SESSION: 'pgre-sidebar-search-' + process.pid,
    CHROME_DEVTOOLS_AXI_AUTO_CONNECT: '0',
    CHROME_DEVTOOLS_AXI_BROWSER_URL: '',
    CHROME_DEVTOOLS_AXI_USER_DATA_DIR: profile
  });
  try {
    await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
    env.PGRE_SBS_TEST_URL = 'http://127.0.0.1:' + server.address().port + '/';
    await run(['open', env.PGRE_SBS_TEST_URL], env);
    var size = '', chrome = '';
    for (var i = 0; i < STAGES.length; i++) {
      console.log('\n' + STAGES[i].name);
      if ((STAGES[i].chrome || '') !== chrome) {   // a stage that needs its own Chrome flag: a fresh browser
        chrome = STAGES[i].chrome || '';
        await run(['stop'], env);
        env.CHROME_DEVTOOLS_AXI_CHROME_ARGS = (flags + ' ' + chrome).trim();
        await run(['open', env.PGRE_SBS_TEST_URL], env);
        size = '';
      }
      if (STAGES[i].size !== size) {
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
