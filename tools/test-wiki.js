#!/usr/bin/env node
/* Wiki section: the page registry, iframe render (route anchor -> file
   fragment), and the nav/route wiring in js/app.js + index.html.
   Run: node tools/test-wiki.js */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.resolve(__dirname, '..');
var sandbox = { console: console, window: {} };
sandbox.window.PGRE = {};
sandbox.PGRE = sandbox.window.PGRE;
sandbox.PGRE.ui = {
  esc: function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'view-wiki.js'), 'utf8'), sandbox);
var PGRE = sandbox.PGRE;

var passed = 0;
var failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ok  — ' + msg); }
  else { failed++; console.log('  FAIL — ' + msg); }
}

// ——— registry ———
assert(Array.isArray(PGRE.WIKI_PAGES) && PGRE.WIKI_PAGES.length === 1,
  'one wiki page is registered');
var mate = PGRE.wikiPage('mate');
assert(mate && mate.title === 'MATE research', 'wikiPage(\'mate\') resolves');
assert(/^file:\/\/\//.test(mate.file), 'mate page file is a file:// URL');
assert(mate.file.indexOf('MATE_Research_Explainer_2026-11-03.html') !== -1,
  'mate page points at the vault explainer file');
assert(PGRE.wikiPage('nope') === null, 'wikiPage unknown id -> null');

// ——— render ———
var html = PGRE.views.wiki.render({ id: 'mate' });
assert(html.indexOf('<iframe class="wiki-iframe"') !== -1, 'render builds an iframe');
assert(html.indexOf('src="' + mate.file + '"') !== -1,
  'iframe src is the page file with no fragment');
assert(html.indexOf('Open on its own') !== -1 &&
       html.indexOf('href="' + mate.file + '"') !== -1 &&
       html.indexOf('target="_blank"') !== -1,
  'an Open-on-its-own link to the file opens in a new tab');
assert(html.indexOf('MATE research') !== -1, 'the page title renders');

var anchored = PGRE.views.wiki.render({ id: 'mate', sub2: 'src-122' });
assert(anchored.indexOf(mate.file + '#src-122') !== -1,
  'route anchor becomes the iframe fragment (#/wiki/mate/src-122)');

var missing = PGRE.views.wiki.render({ id: 'nope' });
assert(missing.indexOf('wiki-iframe') === -1,
  'an unknown page renders a message, not an iframe');

// ——— shell wiring (js/app.js + index.html) ———
var app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
assert(app.indexOf("parts[0] === 'wiki' && parts[1]") !== -1,
  'the router dispatches #/wiki/<id>');
assert(app.indexOf("data-nav-group=\"") !== -1 && app.indexOf("renderGroup('wiki'") !== -1,
  'buildNav emits a data-nav-group="wiki" section');
assert(app.indexOf("wiki: 'Wiki'") !== -1, 'the group is labelled Wiki');
assert(app.indexOf("'#src-122'") === -1 && app.indexOf("key = 'wiki-' + params.id") !== -1,
  'the active nav key is wiki-<id>');
assert(app.indexOf("renderGroup('subjects'") !== -1 &&
       app.indexOf("renderGroup('subjects'") < app.indexOf("renderGroup('wiki'") &&
       app.indexOf("renderGroup('wiki'") < app.indexOf("renderGroup('studio'"),
  'the Wiki group sits between SUBJECTS and STUDIO');

var icons = fs.readFileSync(path.join(root, 'js', 'sidebar-icons.js'), 'utf8');
assert(icons.indexOf('book:') !== -1, 'a book icon exists for the wiki row');

var index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert(/js\/view-wiki\.js\?v=\d+[a-z]?/.test(index),
  'index.html loads js/view-wiki.js with a ?v= token');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
