#!/usr/bin/env node
/* Gating tests for interaction + motion: load SHIPPED js/motion.js and the
   interaction modules actually changed (view-formulas, flashmodes, view-exam,
   view-practice, app.js). No reimplementation of handlers. Run from repo root:
     node tools/test-ux-interaction.js
*/
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.resolve(__dirname, '..');

var passed = 0;
var failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log('  ok  — ' + msg);
  } else {
    failed++;
    console.log('  FAIL — ' + msg);
  }
}

function wait(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

/* -------------------------------------------------------------------------- */
/* Minimal document stub — innerHTML builds a queryable tree.                 */
/* -------------------------------------------------------------------------- */

var VOID_TAGS = {
  area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1,
  link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1
};

function parseAttrs(src) {
  var attrs = {};
  var re = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  var m;
  while ((m = re.exec(src))) {
    var name = m[1];
    var val = m[2] !== undefined ? m[2]
      : (m[3] !== undefined ? m[3]
        : (m[4] !== undefined ? m[4] : ''));
    attrs[name] = val;
  }
  return attrs;
}

function makeClassList(el) {
  function tokens() {
    return String(el.className || '').trim().split(/\s+/).filter(Boolean);
  }
  function write(list) { el.className = list.join(' '); }
  return {
    add: function () {
      var list = tokens();
      for (var i = 0; i < arguments.length; i++) {
        var n = String(arguments[i]);
        if (n && list.indexOf(n) < 0) list.push(n);
      }
      write(list);
    },
    remove: function () {
      var list = tokens();
      for (var i = 0; i < arguments.length; i++) {
        var n = String(arguments[i]);
        list = list.filter(function (x) { return x !== n; });
      }
      write(list);
    },
    contains: function (name) { return tokens().indexOf(String(name)) >= 0; },
    toggle: function (name, force) {
      var has = this.contains(name);
      if (force === undefined) {
        if (has) this.remove(name); else this.add(name);
        return !has;
      }
      if (force) this.add(name); else this.remove(name);
      return !!force;
    }
  };
}

function makeStyle() {
  var bag = {};
  return new Proxy(bag, {
    get: function (t, p) {
      if (p === 'cssText') {
        return Object.keys(t).map(function (k) { return k + ':' + t[k]; }).join(';');
      }
      return t[p] || '';
    },
    set: function (t, p, v) { t[p] = v; return true; }
  });
}

function walk(el, fn) {
  var kids = el.childNodes || [];
  for (var i = 0; i < kids.length; i++) {
    var c = kids[i];
    if (c.nodeType === 1) { fn(c); walk(c, fn); }
  }
}

function matchCompound(el, sel) {
  sel = String(sel || '').trim();
  if (!sel || sel === '*') return true;
  var rest = sel;
  var tagM = rest.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
  if (tagM) {
    if (el.tagName !== tagM[0].toUpperCase()) return false;
    rest = rest.slice(tagM[0].length);
  }
  var tokenRe = /(\.[a-zA-Z0-9_-]+)|(#([a-zA-Z0-9_-]+))|(\[([^\]]+)\])/g;
  var tm;
  var saw = tagM != null;
  while ((tm = tokenRe.exec(rest))) {
    saw = true;
    if (tm[1]) {
      if (!el.classList.contains(tm[1].slice(1))) return false;
    } else if (tm[2]) {
      if (el.id !== tm[3]) return false;
    } else if (tm[4]) {
      var inner = tm[5];
      var eq = inner.match(/^([^\s=~|^$*]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+)))?$/);
      if (!eq) return false;
      var an = eq[1];
      var av = eq[2] !== undefined ? eq[2] : (eq[3] !== undefined ? eq[3] : eq[4]);
      var has = el.getAttribute(an);
      if (av === undefined) { if (has == null) return false; }
      else if (String(has) !== String(av)) return false;
    }
  }
  return saw || rest === '';
}

function makeText(str) {
  return {
    nodeType: 3,
    tagName: '',
    textContent: str == null ? '' : String(str),
    parentNode: null,
    childNodes: []
  };
}

function parseFragment(html, owner) {
  var frag = {
    childNodes: [],
    appendChild: function (c) { this.childNodes.push(c); c.parentNode = this; return c; }
  };
  var i = 0;
  var stack = [frag];
  var s = String(html || '');
  while (i < s.length) {
    if (s.charCodeAt(i) !== 60) {
      var j = s.indexOf('<', i);
      if (j < 0) j = s.length;
      var text = s.slice(i, j);
      if (text) stack[stack.length - 1].appendChild(makeText(text));
      i = j;
      continue;
    }
    if (s.slice(i, i + 4) === '<!--') {
      var endc = s.indexOf('-->', i + 4);
      i = endc < 0 ? s.length : endc + 3;
      continue;
    }
    if (s.slice(i, i + 2) === '</') {
      var gt = s.indexOf('>', i + 2);
      if (gt < 0) break;
      if (stack.length > 1) stack.pop();
      i = gt + 1;
      continue;
    }
    var gt2 = s.indexOf('>', i + 1);
    if (gt2 < 0) break;
    var raw = s.slice(i + 1, gt2);
    var selfClose = raw.charAt(raw.length - 1) === '/';
    if (selfClose) raw = raw.slice(0, -1);
    var sp = raw.search(/\s/);
    var tname = (sp < 0 ? raw : raw.slice(0, sp)).toLowerCase();
    var attrSrc = sp < 0 ? '' : raw.slice(sp);
    if (!/^[a-z][a-z0-9-]*$/.test(tname)) {
      stack[stack.length - 1].appendChild(makeText(s.slice(i, gt2 + 1)));
      i = gt2 + 1;
      continue;
    }
    var node = makeEl(tname, owner);
    var attrs = parseAttrs(attrSrc);
    Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    stack[stack.length - 1].appendChild(node);
    var isVoid = VOID_TAGS[tname] || selfClose;
    if (!isVoid) stack.push(node);
    i = gt2 + 1;
  }
  return frag.childNodes;
}

function makeEl(tag, owner) {
  tag = String(tag || 'div').toLowerCase();
  var el = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    id: '',
    className: '',
    childNodes: [],
    parentNode: null,
    ownerDocument: owner || null,
    attrs: {},
    listeners: {},
    disabled: false,
    hidden: false,
    value: '',
    checked: false,
    selected: false,
    tabIndex: 0,
    type: tag === 'input' ? 'text' : '',
    _text: '',
    _htmlSrc: '',
    scrollWidth: 0,
    clientWidth: 0,
    isContentEditable: false
  };
  el.style = makeStyle();
  el.classList = makeClassList(el);
  el.dataset = {};
  Object.defineProperty(el, 'children', {
    get: function () { return el.childNodes.filter(function (c) { return c.nodeType === 1; }); }
  });
  Object.defineProperty(el, 'firstChild', {
    get: function () { return el.childNodes[0] || null; }
  });
  Object.defineProperty(el, 'isConnected', {
    get: function () {
      var n = el;
      while (n) {
        if (n.nodeType === 9) return true;
        n = n.parentNode;
      }
      return false;
    }
  });
  Object.defineProperty(el, 'offsetWidth', { get: function () { return 1; } });
  Object.defineProperty(el, 'offsetHeight', { get: function () { return 1; } });
  el.getBoundingClientRect = function () {
    return { left: 0, right: 100, top: 0, bottom: 10, width: 100, height: 10 };
  };
  Object.defineProperty(el, 'textContent', {
    get: function () {
      if (el.childNodes.length === 0) return el._text;
      return el.childNodes.map(function (c) {
        return c.nodeType === 3 ? c.textContent : (c.textContent || '');
      }).join('');
    },
    set: function (v) {
      el._text = v == null ? '' : String(v);
      el.childNodes = [];
    }
  });
  el.setAttribute = function (name, value) {
    var n = String(name);
    var v = value == null ? '' : String(value);
    el.attrs[n] = v;
    if (n === 'id') el.id = v;
    else if (n === 'class') el.className = v;
    else if (n === 'type') el.type = v;
    else if (n === 'value') el.value = v;
    else if (n === 'hidden') el.hidden = true;
    else if (n === 'disabled') el.disabled = true;
    else if (n === 'checked') el.checked = true;
    else if (n === 'tabindex') el.tabIndex = parseInt(v, 10) || 0;
    else if (n.slice(0, 5) === 'data-') {
      var dk = n.slice(5).replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
      el.dataset[dk] = v;
    }
  };
  el.getAttribute = function (name) {
    var n = String(name);
    if (n === 'id') return el.id || null;
    if (n === 'class') return el.className || null;
    if (Object.prototype.hasOwnProperty.call(el.attrs, n)) return el.attrs[n];
    return null;
  };
  el.removeAttribute = function (name) {
    delete el.attrs[String(name)];
    if (name === 'id') el.id = '';
    if (name === 'class') el.className = '';
    if (name === 'hidden') el.hidden = false;
    if (name === 'disabled') el.disabled = false;
  };
  el.hasAttribute = function (name) { return el.getAttribute(name) != null; };
  el.contains = function (node) {
    if (node === el) return true;
    var n = node;
    while (n) {
      if (n === el) return true;
      n = n.parentNode;
    }
    return false;
  };
  el.appendChild = function (child) {
    if (!child) return child;
    if (child.parentNode && child.parentNode.removeChild) {
      try { child.parentNode.removeChild(child); } catch (e) { /* already detached */ }
    }
    child.parentNode = el;
    el.childNodes.push(child);
    return child;
  };
  el.removeChild = function (child) {
    var i = el.childNodes.indexOf(child);
    if (i < 0) throw new Error('NotFoundError');
    el.childNodes.splice(i, 1);
    child.parentNode = null;
    return child;
  };
  el.insertBefore = function (child, ref) {
    if (!ref) return el.appendChild(child);
    if (child.parentNode && child.parentNode.removeChild) {
      try { child.parentNode.removeChild(child); } catch (e) { /* already detached */ }
    }
    var i = el.childNodes.indexOf(ref);
    if (i < 0) return el.appendChild(child);
    child.parentNode = el;
    el.childNodes.splice(i, 0, child);
    return child;
  };
  el.remove = function () {
    if (el.parentNode && el.parentNode.removeChild) el.parentNode.removeChild(el);
  };
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return el._htmlSrc; },
    set: function (v) {
      el._htmlSrc = v == null ? '' : String(v);
      el._text = '';
      el.childNodes = [];
      var nodes = parseFragment(el._htmlSrc, el.ownerDocument || owner);
      nodes.forEach(function (n) { el.appendChild(n); });
    }
  });
  el.querySelector = function (sel) {
    var all = el.querySelectorAll(sel);
    return all.length ? all[0] : null;
  };
  el.querySelectorAll = function (sel) {
    sel = String(sel || '').trim();
    if (sel === ':scope > *') return el.children.slice();
    var parts = sel.split(/\s+/).filter(Boolean);
    var out = [];
    walk(el, function (n) {
      if (parts.length === 1) {
        if (matchCompound(n, parts[0])) out.push(n);
        return;
      }
      if (!matchCompound(n, parts[parts.length - 1])) return;
      var ancestor = n.parentNode;
      var need = parts.slice(0, -1);
      var ki = need.length - 1;
      while (ancestor && ki >= 0) {
        if (ancestor.nodeType === 1 && matchCompound(ancestor, need[ki])) ki--;
        ancestor = ancestor.parentNode;
      }
      if (ki < 0) out.push(n);
    });
    return out;
  };
  el.addEventListener = function (type, fn) {
    var t = String(type);
    if (!el.listeners[t]) el.listeners[t] = [];
    el.listeners[t].push(fn);
  };
  el.removeEventListener = function (type, fn) {
    var t = String(type);
    if (!el.listeners[t]) return;
    el.listeners[t] = el.listeners[t].filter(function (f) { return f !== fn; });
  };
  el.click = function () {
    var ev = {
      type: 'click',
      target: el,
      currentTarget: el,
      preventDefault: function () { ev.defaultPrevented = true; },
      stopPropagation: function () { ev._stopped = true; }
    };
    var n = el;
    while (n) {
      ev.currentTarget = n;
      var list = ((n.listeners && n.listeners.click) || []).slice();
      list.forEach(function (fn) { fn(ev); });
      if (ev._stopped) break;
      n = n.parentNode;
    }
  };
  el.focus = function () {
    if (el.ownerDocument) el.ownerDocument.activeElement = el;
  };
  el.blur = function () {
    if (el.ownerDocument && el.ownerDocument.activeElement === el) {
      el.ownerDocument.activeElement = el.ownerDocument.body;
    }
  };
  el.closest = function (sel) {
    var n = el;
    while (n && n.nodeType === 1) {
      if (matchCompound(n, sel)) return n;
      n = n.parentNode;
    }
    return null;
  };
  el.insertAdjacentHTML = function (pos, html) {
    var nodes = parseFragment(html, el.ownerDocument || owner);
    if (pos === 'beforeend') {
      nodes.forEach(function (n) { el.appendChild(n); });
    } else if (pos === 'afterbegin') {
      for (var i = nodes.length - 1; i >= 0; i--) el.insertBefore(nodes[i], el.firstChild);
    }
  };
  return el;
}

function makeDocument() {
  var doc = makeEl('document', null);
  doc.nodeType = 9;
  doc.tagName = '#DOCUMENT';
  doc.ownerDocument = doc;
  doc.hidden = false;
  doc.readyState = 'loading';
  doc.activeElement = null;

  var html = makeEl('html', doc);
  var head = makeEl('head', doc);
  var body = makeEl('body', doc);
  html.dataset = {};
  doc.documentElement = html;
  doc.head = head;
  doc.body = body;
  doc.appendChild(html);
  html.appendChild(head);
  html.appendChild(body);
  doc.activeElement = body;

  doc.createElement = function (tag) { return makeEl(tag, doc); };
  doc.createTextNode = function (str) { return makeText(str); };
  doc.getElementById = function (id) {
    if (html.id === id) return html;
    if (body.id === id) return body;
    var found = null;
    walk(doc, function (n) { if (!found && n.id === id) found = n; });
    return found;
  };
  doc.querySelector = function (sel) {
    var all = doc.querySelectorAll(sel);
    return all.length ? all[0] : null;
  };
  doc.querySelectorAll = function (sel) { return html.querySelectorAll(sel); };
  return doc;
}

function formulaCards(n) {
  var out = [];
  for (var i = 0; i < n; i++) {
    out.push({
      id: 'f' + i,
      topic: 'cm',
      name: 'Card ' + i,
      front: 'Prompt ' + i,
      back: '$$F = ' + (i + 2) + 'ma$$',
      note: '',
      aliases: []
    });
  }
  return out;
}

function practiceQuestions() {
  return [
    { id: 'pq1', topic: 'cm', q: 'First Q?', choices: ['w', 'x', 'y', 'z'], answer: 1, sol: 'S1', difficulty: 2 },
    { id: 'pq2', topic: 'cm', q: 'Second Q?', choices: ['w', 'x', 'y', 'z'], answer: 1, sol: 'S2', difficulty: 1 }
  ];
}

function loadShipped(reduced, opts) {
  opts = opts || {};
  var document = makeDocument();
  var rafQueue = [];
  var rafId = 1;
  var timeouts = [];
  var intervals = [];
  var timerId = 1;
  var mediaListeners = [];
  var reducedFlag = !!reduced;
  var cards = formulaCards(12);
  var cardStates = {};
  var examObj = {
    id: 'ex-ux',
    title: 'UX exam',
    format: 'full',
    order: ['eq1'],
    cursor: 0,
    answers: {},
    flags: [],
    paused: false,
    durationSec: 0,
    limitSec: 170 * 60
  };
  var examQ = {
    id: 'eq1',
    topic: 'cm',
    q: 'Exam Q?',
    choices: ['A1', 'A2', 'A3', 'A4', 'A5'],
    answer: 2,
    sol: 'Because',
    difficulty: 2
  };
  var pqs = practiceQuestions();

  function setTimeoutFake(fn, ms) {
    var id = timerId++;
    timeouts.push({ id: id, fn: fn, ms: ms == null ? 0 : ms });
    return id;
  }
  function clearTimeoutFake(id) {
    timeouts = timeouts.filter(function (t) { return t.id !== id; });
  }
  function setIntervalFake(fn, ms) {
    var id = timerId++;
    intervals.push({ id: id, fn: fn, ms: ms == null ? 0 : ms });
    return id;
  }
  function clearIntervalFake(id) {
    intervals = intervals.filter(function (t) { return t.id !== id; });
  }

  var locationObj = { hash: '#/', href: 'http://127.0.0.1/', pathname: '/', search: '' };

  var windowObj = {
    matchMedia: function (q) {
      var mq = {
        media: String(q || ''),
        get matches() {
          return /prefers-reduced-motion:\s*reduce/.test(String(q)) ? reducedFlag : false;
        },
        addEventListener: function (type, fn) { mediaListeners.push(fn); },
        addListener: function (fn) { mediaListeners.push(fn); },
        removeEventListener: function () {},
        removeListener: function () {}
      };
      return mq;
    },
    PGRE: null,
    scrollTo: function () {},
    print: function () {},
    listeners: {},
    addEventListener: function (type, fn) {
      var t = String(type);
      if (!windowObj.listeners[t]) windowObj.listeners[t] = [];
      windowObj.listeners[t].push(fn);
    },
    removeEventListener: function (type, fn) {
      var t = String(type);
      if (!windowObj.listeners[t]) return;
      windowObj.listeners[t] = windowObj.listeners[t].filter(function (f) { return f !== fn; });
    },
    requestAnimationFrame: function (cb) {
      var id = rafId++;
      rafQueue.push({ id: id, cb: cb });
      return id;
    },
    cancelAnimationFrame: function (id) {
      rafQueue = rafQueue.filter(function (x) { return x.id !== id; });
    },
    location: locationObj,
    history: { back: function () {}, forward: function () {}, pushState: function () {} },
    localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    sessionStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    confirm: function () { return false; },
    innerWidth: 1280,
    innerHeight: 800
  };

  var pgre = {
    store: {
      state: {
        settings: {
          theme: 'light', keyboard: true, sidebarFolded: false,
          formulaDailyTarget: 20, examDate: '', formulaExamCap: true,
          formulaReverse: false, paceTrainer: false
        },
        cards: cardStates,
        cardReviews: [],
        cardNotes: {},
        questions: {},
        attempts: [],
        mistakes: {},
        flags: {},
        formulaStudy: null,
        formulaStudyEnd: null,
        formulaCheckIn: { current: 0, best: 0, lastDay: null }
      },
      save: function () { return !pgre.store.state._persistFailed; },
      checkpoint: function () { return null; },
      rollback: function () { return false; },
      load: function () {},
      rollDay: function () {},
      touchDay: function () {},
      log: function () {},
      canWrite: function () { return !pgre.store.state._persistFailed; },
      clearFormulaStudy: function (marker) {
        marker = marker || {};
        var prev = this.state.formulaStudy;
        var now = Date.now();
        this.state.formulaStudyEnd = {
          id: marker.id || (prev && prev.id) || null,
          done: marker.done != null ? marker.done : (prev && prev.done) || 0,
          completed: true,
          _opAt: Number(marker._opAt) || now,
          _opId: marker._opId || 'end'
        };
        this.state.formulaStudy = null;
        return this.state.formulaStudyEnd;
      },
      resetFormulaCards: function () { cardStates = {}; this.state.cards = cardStates; }
    },
    srs: {
      today: function () { return '2026-09-07'; },
      newInDeck: function (deck) {
        return (deck || []).filter(function (c) { return !cardStates[c.id]; });
      },
      studiedToday: function () { return false; },
      formulaDay: function () {
        return { reviewIds: [], newIds: cards.map(function (c) { return c.id; }), softIds: [] };
      },
      clampTarget: function (t) { return t || 20; },
      formulaDayRemaining: function (deck) { return (deck || cards).slice(); },
      formulaDayPostponed: function () { return 0; },
      isLeech: function () { return false; },
      isSuspended: function () { return false; },
      cardState: function (id) { return cardStates[id] || null; },
      gradeCard: function (id, g) {
        if (pgre.store.canWrite && !pgre.store.canWrite()) return null;
        var op = 'op-' + (pgre.store.state.cardReviews.length + 1) + '-' + id;
        cardStates[id] = cardStates[id] || { interval: 1, reps: 1, due: '2026-09-08', lastGrade: g, lapses: 0 };
        cardStates[id].lastGrade = g;
        cardStates[id].lastReviewOpId = op;
        var row = { id: id, d: '2026-09-07', g: g, op: op };
        pgre.store.state.cardReviews.push(row);
        return cardStates[id];
      },
      undoReview: function (opId) {
        if (!opId) return null;
        if (pgre.store.canWrite && !pgre.store.canWrite()) return null;
        var log = pgre.store.state.cardReviews || [];
        for (var i = log.length - 1; i >= 0; i--) {
          if (log[i] && log[i].op === opId) {
            var row = log.splice(i, 1)[0];
            return { ok: true, opId: opId, cardId: row.id, card: cardStates[row.id] || null };
          }
        }
        return null;
      },
      nextIntervals: function () { return { again: 0, hard: 1, good: 3, easy: 7 }; },
      ivlLabel: function (n) { return n + 'd'; },
      daysUntil: function () { return 1; },
      dueMistakes: function () { return []; },
      setLastAssess: function () {},
      markLucky: function () {},
      unmarkLucky: function () {},
      clearLucky: function () {},
      /* Same filing contract as the shipped markStuck/unmarkStuck: flag or
         create the entry, reopen an archived one; unmarking removes a filing
         whose schedule exists only because of this flag (stuckSole) while
         misses, solves and lucky stay empty, so no ghost lingers. */
      markStuck: function (qid) {
        var mk = pgre.store.state.mistakes[qid] ||
          (pgre.store.state.mistakes[qid] = { firstMissedAt: 'now', misses: 0,
            solves: 0, wrongPicks: [], archivedAt: null, srs: null });
        mk.stuck = true;
        mk.archivedAt = null;
        if (!mk.srs) { mk.srs = { step: 0, due: '2026-09-08' }; mk.stuckSole = true; }
        return mk;
      },
      unmarkStuck: function (qid) {
        var mk = pgre.store.state.mistakes[qid];
        if (!mk || !mk.stuck) return;
        if (mk.stuckSole && !mk.misses && !mk.solves && !mk.lucky) delete pgre.store.state.mistakes[qid];
        else { delete mk.stuck; delete mk.lastStuckAt; delete mk.stuckSole; }
      },
      MISTAKE_LADDER: [1, 3, 7, 14, 30, 60],
      setFormulaDayPicks: function () {},
      addFormulaDaySoft: function () {},
      removeFormulaDaySoft: function () {},
      formulaChapter: function (id) {
        var m = String(id || '').match(/^cpgf-(\d+)\./);
        return m ? parseInt(m[1], 10) : Infinity;
      },
      suggestFormulaDay: function () { return { reviewIds: [], newIds: [] }; },
      autoFillFormulaDay: function () {}
    },
    visualizers: {},
    openVisualizerModal: function () {},
    views: {},
    formulaDeck: function () { return Promise.resolve(cards); },
    TOPICS: [{ id: 'cm', short: 'CM', name: 'Classical Mechanics', weight: 20 }],
    studyTime: { start: function () {} },
    contentDB: { open: function () {} },
    nav: { route: function () {}, setTrail: function () {} },
    gamify: {
      addXP: function () {},
      checkAchievements: function () {},
      beginSession: function () { return 'sid-1'; },
      recordAnswer: function () { return 10; },
      endSession: function () {},
      recordSession: function () {}
    },
    refreshNavBadges: function () {},
    typesetMath: function () {},
    formulaCheckIn: {
      stripHTML: function () { return ''; },
      celebrateHTML: function () { return ''; },
      alreadyHTML: function () { return ''; },
      record: function () { return { claimed: false }; }
    },
    notes: {
      isBookmarked: function () { return false; },
      get: function () { return ''; },
      set: function () {},
      toggleBookmark: function () { return false; }
    },
    topicById: function (id) {
      return id === 'cm' ? pgre.TOPICS[0] : { id: id || 'xx', short: '?', name: 'Unknown' };
    },
    questionById: function (id) {
      if (id === 'eq1') return examQ;
      for (var i = 0; i < pqs.length; i++) if (pqs[i].id === id) return pqs[i];
      return null;
    },
    questionsForTopic: function () { return pqs.slice(); },
    examEngine: {
      FORMAT_META: { full: { label: 'Full length' } },
      active: function () { return examObj; },
      create: function () { return examObj; },
      history: function () { return []; },
      submit: function () {},
      persistAnswer: function (exam, idx) {
        var qid = exam.order[exam.index || 0];
        if (exam.answers[qid] === idx) delete exam.answers[qid];
        else exam.answers[qid] = idx;
        return true;
      }
    },
    timer: { boot: function () {} }
  };
  windowObj.PGRE = pgre;

  var sandbox = {
    window: windowObj,
    document: document,
    console: console,
    Date: Date,
    Math: Math,
    JSON: JSON,
    String: String,
    Number: Number,
    Array: Array,
    Object: Object,
    Boolean: Boolean,
    RegExp: RegExp,
    Error: Error,
    Promise: Promise,
    isFinite: isFinite,
    parseInt: parseInt,
    parseFloat: parseFloat,
    setTimeout: setTimeoutFake,
    clearTimeout: clearTimeoutFake,
    setInterval: setIntervalFake,
    clearInterval: clearIntervalFake,
    requestAnimationFrame: windowObj.requestAnimationFrame,
    cancelAnimationFrame: windowObj.cancelAnimationFrame,
    PGRE: pgre,
    location: locationObj,
    navigator: { userAgent: 'node-test' },
    history: windowObj.history
  };
  windowObj.window = windowObj;
  windowObj.document = document;
  document.defaultView = windowObj;
  vm.createContext(sandbox);
  delete sandbox.module;
  delete sandbox.require;
  delete sandbox.exports;
  delete sandbox.process;

  function runFile(rel) {
    var src = fs.readFileSync(path.join(root, rel), 'utf8');
    vm.runInContext(src, sandbox, { filename: rel });
    sandbox.PGRE = sandbox.window.PGRE;
  }
  runFile('js/motion.js');
  runFile('js/app.js');
  if (opts.views) {
    runFile('js/bank.js');
    runFile('js/flashmodes.js');
    runFile('js/view-formulas.js');
    runFile('js/data-exam-table.js');
    runFile('js/view-exam.js');
    runFile('js/view-practice.js');
  }
  // bank.js ships the real questionById/allQuestions; the sandbox has no bank
  // data files, so restore the harness stubs that the exam/practice views need.
  pgre.questionById = function (id) {
    if (id === 'eq1') return examQ;
    for (var i = 0; i < pqs.length; i++) if (pqs[i].id === id) return pqs[i];
    return null;
  };
  pgre.questionsForTopic = function () { return pqs.slice(); };
  pgre.allQuestions = function () { return pqs.slice(); };
  sandbox.PGRE = sandbox.window.PGRE;
  return {
    sandbox: sandbox,
    document: document,
    window: windowObj,
    location: locationObj,
    cards: cards,
    exam: examObj,
    cardStates: cardStates,
    rafQueue: function () { return rafQueue; },
    timeouts: function () { return timeouts; },
    setReduced: function (v) {
      reducedFlag = !!v;
      mediaListeners.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
    },
    flushTimeouts: function (maxMs) {
      var cap = maxMs == null ? Infinity : maxMs;
      var ready = timeouts.filter(function (t) { return t.ms <= cap; });
      timeouts = timeouts.filter(function (t) { return ready.indexOf(t) < 0; });
      ready.forEach(function (t) { t.fn(); });
    },
    runRaf: function (now) {
      var q = rafQueue.slice();
      rafQueue.length = 0;
      q.forEach(function (x) { x.cb(now == null ? 0 : now); });
    }
  };
}

function dispatchKeydown(env, opts) {
  var doc = env.document;
  var target = opts.target || doc.activeElement || doc.body;
  var e = {
    type: 'keydown',
    key: opts.key,
    target: target,
    currentTarget: doc,
    preventDefault: function () { e.defaultPrevented = true; },
    stopPropagation: function () {},
    metaKey: !!opts.metaKey,
    ctrlKey: !!opts.ctrlKey,
    altKey: !!opts.altKey,
    shiftKey: !!opts.shiftKey,
    repeat: !!opts.repeat
  };
  var list = (doc.listeners.keydown || []).slice();
  list.forEach(function (fn) { fn(e); });
  if (target && target.listeners && target.listeners.keydown) {
    target.listeners.keydown.slice().forEach(function (fn) { fn(e); });
  }
  return e;
}

function dispatchEl(el, type, extra) {
  extra = extra || {};
  var ev = {
    type: type,
    target: el,
    currentTarget: el,
    detail: extra.detail != null ? extra.detail : 0,
    preventDefault: function () { ev.defaultPrevented = true; },
    stopPropagation: function () {}
  };
  (el.listeners[type] || []).slice().forEach(function (fn) { fn(ev); });
  return ev;
}

function fireChange(el) {
  var ev = {
    type: 'change', target: el, currentTarget: el,
    preventDefault: function () {}, stopPropagation: function () {}
  };
  ((el.listeners && el.listeners.change) || []).slice().forEach(function (fn) { fn(ev); });
}

function fireInput(el) {
  var ev = {
    type: 'input', target: el, currentTarget: el,
    preventDefault: function () {}, stopPropagation: function () {}
  };
  ((el.listeners && el.listeners.input) || []).slice().forEach(function (fn) { fn(ev); });
}

function fireDoc(env, type, extra) {
  extra = extra || {};
  var ev = {
    type: type,
    target: extra.target || null,
    relatedTarget: extra.relatedTarget || null,
    currentTarget: env.document,
    preventDefault: function () {},
    stopPropagation: function () {}
  };
  ((env.document.listeners && env.document.listeners[type]) || [])
    .slice().forEach(function (fn) { fn(ev); });
  return ev;
}

function boxesChecked(list) {
  var on = 0;
  for (var i = 0; i < list.length; i++) if (list[i].checked) on++;
  return on;
}

function ensureView(env, html) {
  var view = env.document.getElementById('view');
  if (!view) {
    view = env.document.createElement('div');
    view.id = 'view';
    view.setAttribute('id', 'view');
    env.document.body.appendChild(view);
  }
  if (html != null) view.innerHTML = html;
  return view;
}

console.log('ux-interaction (shipped motion.js + interaction modules)\n');

/* ——— (a) reduced-motion: loader / viewEnter / stagger / countUp / meter ——— */
console.log('reduced-motion no-ops');
var env = loadShipped(true);
var motion = env.window.PGRE.motion;
assert(!!motion, 'PGRE.motion installed from shipped motion.js');
assert(motion.reduced === true, 'motion.reduced is true when matchMedia reduce matches');

motion.loader.start();
var loaders = env.document.body.querySelectorAll('.motion-loader');
assert(loaders.length === 0, 'loader.start under reduce does not insert a crawl bar');
assert(env.rafQueue().length === 0, 'loader.start under reduce queues no rAF crawl');
motion.loader.done();
assert(env.document.body.querySelectorAll('.motion-loader').length === 0,
  'loader.done under reduce leaves no bar (snap-hidden / no-op)');

var view = env.document.createElement('div');
view.id = 'view';
env.document.body.appendChild(view);
motion.viewEnter(view);
assert(!view.classList.contains('view-enter'), 'viewEnter under reduce does not add .view-enter');

var grid = env.document.createElement('div');
var card = env.document.createElement('div');
card.classList.add('stagger-in');
grid.appendChild(card);
env.document.body.appendChild(grid);
motion.stagger(grid);
assert(!card.style.animationDelay, 'stagger under reduce does not set animation-delay');

var num = env.document.createElement('span');
num.textContent = '0';
motion.countUp(num, 42, { format: function (n) { return '+' + Math.round(n) + ' XP'; } });
assert(num.textContent === '+42 XP', 'countUp under reduce writes the final formatted value immediately');
assert(env.rafQueue().length === 0, 'countUp under reduce queues no tween frames');

var meter = env.document.createElement('div');
meter.className = 'meter-fill';
meter.style.width = '0%';
motion.animateMeter(meter, 75);
assert(meter.style.width === '75%', 'animateMeter under reduce sets final width immediately');
assert(env.rafQueue().length === 0, 'animateMeter under reduce queues no fill frames');

assert(typeof motion.letterSwapNav === 'function', 'motion.letterSwapNav is installed');
var navReduce = env.document.createElement('nav');
var aReduce = env.document.createElement('a');
aReduce.setAttribute('data-nav', 'dashboard');
aReduce.innerHTML = 'Dashboard';
navReduce.appendChild(aReduce);
env.document.body.appendChild(navReduce);
motion.letterSwapNav(navReduce);
assert(aReduce.querySelector('.letter-swap') == null,
  'letterSwapNav under reduce does not wrap labels');

/* ——— (a2) reduced=false control: motion actually runs ——— */
console.log('\nreduced=false control (motion is not always a no-op)');
var envOn = loadShipped(false);
var motionOn = envOn.window.PGRE.motion;
assert(motionOn.reduced === false, 'motion.reduced is false when matchMedia does not match reduce');

motionOn.loader.start();
var liveLoader = envOn.document.body.querySelector('.motion-loader');
assert(!!liveLoader, 'loader.start with motion on creates .motion-loader');
assert(envOn.rafQueue().length > 0, 'loader.start with motion on queues a crawl rAF');
motionOn.loader.done();

var viewOn = envOn.document.createElement('div');
viewOn.id = 'view-on';
envOn.document.body.appendChild(viewOn);
motionOn.viewEnter(viewOn);
assert(viewOn.classList.contains('view-enter'), 'viewEnter with motion on adds .view-enter');

var gridOn = envOn.document.createElement('div');
var cardOn = envOn.document.createElement('div');
cardOn.classList.add('stagger-in');
gridOn.appendChild(cardOn);
envOn.document.body.appendChild(gridOn);
motionOn.stagger(gridOn);
assert(!!cardOn.style.animationDelay, 'stagger with motion on sets animation-delay');

var numOn = envOn.document.createElement('span');
numOn.textContent = '0';
motionOn.countUp(numOn, 42, { format: function (n) { return '+' + Math.round(n) + ' XP'; } });
assert(envOn.rafQueue().length > 0, 'countUp with motion on queues rAF');
assert(numOn.textContent !== '+42 XP', 'countUp with motion on has not snapped to the final value yet');
envOn.runRaf(0);
assert(numOn.textContent !== '+42 XP', 'countUp first frame is an intermediate value, not the final');

var meterOn = envOn.document.createElement('div');
meterOn.className = 'meter-fill';
meterOn.style.width = '10%';
motionOn.animateMeter(meterOn, 75);
assert(meterOn.style.width === '0%', 'animateMeter with motion on zeros width before the fill');
assert(envOn.rafQueue().length > 0, 'animateMeter with motion on queues rAF to apply the target width');

var navLive = envOn.document.createElement('nav');
var aLive = envOn.document.createElement('a');
aLive.setAttribute('data-nav', 'dashboard');
aLive.innerHTML = 'Dashboard';
navLive.appendChild(aLive);
envOn.document.body.appendChild(navLive);
motionOn.letterSwapNav(navLive);
assert(!!aLive.querySelector('.letter-swap'), 'letterSwapNav with motion on wraps the label');
assert(!!aLive.querySelector('.letter-swap-sr'), 'letterSwapNav keeps a screen-reader label');
assert(aLive.querySelectorAll('.letter-swap-cell').length === 9,
  'letterSwapNav splits Dashboard into 9 cells');
assert(aLive.getAttribute('data-letter-swap') === '1', 'letterSwapNav marks the enhanced link');

var navNested = envOn.document.createElement('nav');
var aNested = envOn.document.createElement('a');
aNested.setAttribute('data-nav', 'dashboard');
aNested.innerHTML = '<svg></svg><span class="nav-label">Dashboard</span>';
navNested.appendChild(aNested);
envOn.document.body.appendChild(navNested);
motionOn.letterSwapNav(navNested);
assert(!!aNested.querySelector('.nav-label .letter-swap'),
  'letterSwapNav wraps the nested .nav-label');
assert(aNested.querySelectorAll('.letter-swap-cell').length === 9,
  'letterSwapNav splits nested Dashboard into 9 cells');
assert(aNested.getAttribute('data-letter-swap') === '1',
  'letterSwapNav marks the nested-label link');

var navTopic = envOn.document.createElement('nav');
var aTopic = envOn.document.createElement('a');
aTopic.setAttribute('data-nav', 'topic-cm');
aTopic.innerHTML = '<svg></svg><span class="nav-label"><span class="nav-mono">CM</span>' +
  'Classical Mechanics</span><span class="nav-weight">20%</span>';
navTopic.appendChild(aTopic);
envOn.document.body.appendChild(navTopic);
motionOn.letterSwapNav(navTopic);
var topicChip = aTopic.querySelector('.nav-mono');
assert(!!topicChip && topicChip.textContent === 'CM' &&
       topicChip.parentNode === aTopic.querySelector('.nav-label'),
  'letterSwapNav keeps the topic monogram chip as its own element');
assert(aTopic.querySelector('.letter-swap-sr').textContent === 'Classical Mechanics',
  'letterSwapNav swaps only the topic name, not the chip letters');

var navTopic2 = envOn.document.createElement('nav');
var aTopic2 = envOn.document.createElement('a');
aTopic2.setAttribute('data-nav', 'topic-ow');
aTopic2.innerHTML = '<span class="nav-label"><span class="nav-mono">OW</span>' +
  '<span class="nav-badge">3</span>Optics &amp; Wave Phenomena</span>';
navTopic2.appendChild(aTopic2);
envOn.document.body.appendChild(navTopic2);
motionOn.letterSwapNav(navTopic2);
var chip2 = aTopic2.querySelector('.nav-mono');
assert(!!chip2 && chip2.textContent === 'OW' &&
       chip2.parentNode === aTopic2.querySelector('.nav-label'),
  'letterSwapNav keeps the chip when other element children flatten');
assert(aTopic2.querySelector('.letter-swap-sr').textContent.indexOf('OW') === -1,
  'letterSwapNav swap text excludes the chip letters');

var brandHost = envOn.document.createElement('a');
brandHost.className = 'brand';
brandHost.innerHTML = '<div class="brand-name">Physics <span class="accent">GRE</span></div><div class="brand-sub">Prep Studio</div>';
envOn.document.body.appendChild(brandHost);
motionOn.letterSwapNav(brandHost);
assert(!!brandHost.querySelector('.brand-name .letter-swap'),
  'letterSwapNav wraps the sidebar Physics GRE mark');
assert(brandHost.querySelector('.brand-sub').textContent.indexOf('Prep Studio') !== -1,
  'letterSwapNav leaves the Prep Studio subtitle intact');
assert(brandHost.querySelectorAll('.brand-name .letter-swap-cell').length === 11,
  'letterSwapNav splits Physics GRE into 11 cells');

var titleRoot = envOn.document.createElement('div');
titleRoot.innerHTML = '<h1>Study plan</h1><h1 class="fr-usage-stat">33%</h1><h1>Session complete</h1>';
envOn.document.body.appendChild(titleRoot);
motionOn.letterSwapTitles(titleRoot);
assert(!!titleRoot.querySelector('h1:not(.fr-usage-stat) .letter-swap') ||
       titleRoot.querySelectorAll('h1')[0].getAttribute('data-letter-swap') === '1',
  'letterSwapTitles wraps the page h1');
assert(titleRoot.querySelector('.fr-usage-stat').getAttribute('data-letter-swap') !== '1',
  'letterSwapTitles skips usage-stat h1s');
assert(titleRoot.querySelectorAll('h1')[2].getAttribute('data-letter-swap') !== '1',
  'letterSwapTitles skips Session complete');
/* ——— assess html() markers + bind on a parsed row ——— */
console.log('\nPGRE.assess.html + bind');
var assess = env.window.PGRE.assess;
assert(assess && typeof assess.html === 'function' && typeof assess.bind === 'function',
  'shipped PGRE.assess.html / bind are present');
var assessHtml = assess.html(true);
assert(/id="assess-row"/.test(assessHtml), 'assess.html() contains #assess-row');
assert(/data-assess/.test(assessHtml), 'assess.html() contains data-assess chips');
assert(assessHtml.indexOf('data-assess="stuck"') !== -1 &&
       assessHtml.indexOf('Keep failing') !== -1 &&
       assessHtml.indexOf('assess-stuck') !== -1,
  'assess.html() renders a Keep failing chip');

var box = env.document.createElement('div');
box.innerHTML = assessHtml;
env.document.body.appendChild(box);
var ctrl = assess.bind(box, { id: 'q-ux-1' }, true);
var sure = box.querySelector('[data-assess="sure"]');
var guess = box.querySelector('[data-assess="guess"]');
assert(!!sure && !!guess, 'bind() finds chips parsed from assess.html()');
sure.click();
assert(sure.getAttribute('aria-pressed') === 'true' && sure.classList.contains('active'),
  'click on html()-rendered Knew it sets aria-pressed/active');
assert(guess.getAttribute('aria-pressed') === 'false', 'click leaves Guessed unpressed');
ctrl.toggle('sure');
assert(sure.getAttribute('aria-pressed') === 'false', 'bind().toggle still shares the click path');

var stuckChipEl = box.querySelector('[data-assess="stuck"]');
assert(!!stuckChipEl, 'bind() finds the Keep failing chip');
stuckChipEl.click();
assert(box.querySelector('#assess-stuck-confirm').hidden === false &&
       stuckChipEl.getAttribute('aria-pressed') === 'false' &&
       !env.window.PGRE.store.state.mistakes['q-ux-1'],
  'click on Keep failing asks for confirmation before flagging');
assert(stuckChipEl.getAttribute('title').indexOf('mistake-book retakes') !== -1,
  'Keep failing includes a native hover tip explaining retakes');
box.querySelector('#assess-stuck-cancel').click();
assert(box.querySelector('#assess-stuck-confirm').hidden === true &&
       !env.window.PGRE.store.state.mistakes['q-ux-1'],
  'Cancel leaves Keep failing unflagged');
ctrl.requestToggle('stuck');
box.querySelector('#assess-stuck-yes').click();
assert(stuckChipEl.getAttribute('aria-pressed') === 'true' &&
       stuckChipEl.classList.contains('active'),
  'Confirm sets Keep failing aria-pressed/active like the other tags');
assert(env.window.PGRE.store.state.mistakes['q-ux-1'] &&
       env.window.PGRE.store.state.mistakes['q-ux-1'].stuck === true,
  'selecting Keep failing files the question into state.mistakes');
assert((box.querySelector('#assess-note') || {}).textContent.indexOf('keep failing') !== -1,
  'the note confirms the keep-failing filing');
stuckChipEl.click();
assert(!env.window.PGRE.store.state.mistakes['q-ux-1'],
  'un-picking Keep failing removes a flag-only entry (no ghost)');

/* ——— Review-result grading row (assess.html review + shipped srs.js) ———
   The same chips, hydrated from the saved row, with the review-window strip:
   a tap regrades the row and moves the date, and never adds an attempt. */
console.log('\nreview-result grading row');
var rx = loadShipped(true, { views: true });
vm.runInContext(fs.readFileSync(path.join(root, 'js/srs.js'), 'utf8'), rx.sandbox,
  { filename: 'js/srs.js' });
var RP = rx.sandbox.PGRE;
assert(assess.html(true).indexOf('assess-window') === -1,
  'the answer-page row carries no review-window strip');
var reviewHtml = RP.assess.html(true, { review: true });
assert(reviewHtml.indexOf('id="assess-window"') !== -1 && reviewHtml.indexOf('assess-review') !== -1 &&
       reviewHtml.indexOf('data-assess="forgot"') !== -1 && reviewHtml.indexOf('id="assess-stuck-confirm"') !== -1,
  'the review row is the same chip set plus the review-window strip');
var rRow = { ts: 't1', sid: 's1', qid: 'rq1', correct: true, confidence: null, tags: ['slow'] };
RP.store.state.attempts.push({ ts: 't0', sid: 's0', qid: 'rq1', correct: false, confidence: 'guess' });
RP.store.state.attempts.push(rRow);
RP.store.state.mistakes.rq1 = { firstMissedAt: 't0', misses: 1, solves: 1, wrongPicks: [1], archivedAt: null,
  srs: { step: 2, due: RP.srs.addDays(4), baseDue: RP.srs.addDays(7) } };
assert(RP.assess.regradeRow('rq1', rRow) === rRow, 'the newest row for the question is regradable');
assert(RP.assess.regradeRow('rq1', { ts: 't1', sid: 's1' }) === rRow,
  'a stale copy of that row resolves to the live attempt object');
assert(RP.assess.regradeRow('rq1', RP.store.state.attempts[0]) === null &&
       RP.assess.regradeRow('rq1', null) === null,
  'an older answer, or a result with no row, stays read only');
var rFlags = RP.assess.flagsFromRow(rRow);
assert(rFlags.slow === true && !rFlags.sure && !rFlags.guess && !rFlags.forgot && !rFlags.stuck,
  'flagsFromRow reads the saved grading off the row');
var rbox = rx.document.createElement('div');
rbox.innerHTML = reviewHtml;
rx.document.body.appendChild(rbox);
var rAttempts = RP.store.state.attempts.length, rXp = RP.store.state.xp;
var rBefore = JSON.stringify(RP.store.state.mistakes.rq1);
var rctrl = RP.assess.bind(rbox, { id: 'rq1' }, true);
rctrl.hydrate(rFlags);
var rWin = rbox.querySelector('#assess-window');
var rFrom = rbox.querySelector('#assess-window-from');
var rTo = rbox.querySelector('#assess-window-to');
assert(rbox.querySelector('[data-assess="slow"]').getAttribute('aria-pressed') === 'true' &&
       JSON.stringify(RP.store.state.mistakes.rq1) === rBefore && rRow.tags.join() === 'slow',
  'opening the review paints the saved chip and writes nothing');
assert(rFrom.hidden === false && rFrom.textContent === '7 d' && rTo.textContent === '4 d' &&
       rWin.classList.contains('is-moved') && !rWin.classList.contains('is-pulse'),
  'the strip opens on the saved window, 7 d before and 4 d now, without a pulse');
rbox.querySelector('[data-assess="forgot"]').click();
assert(rFrom.textContent === '7 d' && rTo.textContent === '1 d' && rWin.classList.contains('is-pulse') &&
       RP.srs.daysUntil(RP.store.state.mistakes.rq1.srs.due) === 1,
  'Forgot something moves the stored date to tomorrow and the strip shows 7 d then 1 d at once');
assert(rRow.tags.join() === 'slow,forgot' && RP.store.state.attempts.length === rAttempts &&
       RP.store.state.xp === rXp && RP.store.state.mistakes.rq1.misses === 1 &&
       RP.store.state.mistakes.rq1.solves === 1 && RP.store.state.mistakes.rq1.srs.step === 2,
  'the regrade stamps the same row and adds no attempt, XP, miss, solve, or ladder step');
rbox.querySelector('[data-assess="forgot"]').click();
rbox.querySelector('[data-assess="slow"]').click();
assert(rFrom.hidden === true && rTo.textContent === '7 d' && !rWin.classList.contains('is-moved') &&
       RP.store.state.mistakes.rq1.srs.due === RP.store.state.mistakes.rq1.srs.baseDue && !rRow.tags,
  'unpicking every chip restores the saved date and the strip shows 7 d alone');
assert(rbox.querySelector('#assess-note').textContent === 'tap to change your grading',
  'the idle note on a review row reads as a regrade');
var ubox = rx.document.createElement('div');
ubox.innerHTML = reviewHtml;
rx.document.body.appendChild(ubox);
RP.store.state.attempts.push({ ts: 't2', sid: 's1', qid: 'rq2', correct: true, confidence: null });
var uctrl = RP.assess.bind(ubox, { id: 'rq2' }, true);
uctrl.hydrate({});
assert(ubox.querySelector('#assess-window-to').textContent === 'not scheduled' &&
       ubox.querySelector('#assess-window').classList.contains('is-unscheduled'),
  'a correct answer with no schedule reads not scheduled');
uctrl.toggle('guess');
assert(ubox.querySelector('#assess-window-from').textContent === 'not scheduled' &&
       ubox.querySelector('#assess-window-to').textContent === '1 d',
  'Guessed on it files the lucky guess and the strip shows not scheduled then 1 d');
uctrl.toggle('guess');
assert(!RP.store.state.mistakes.rq2 &&
       ubox.querySelector('#assess-window-to').textContent === 'not scheduled' &&
       ubox.querySelector('#assess-window-from').hidden === true,
  'unpicking it removes the entry and the strip returns to not scheduled');

/* ——— Keep failing in the shipped mistake-book view ———
   A fresh env running the shipped srs.js + view-mistakes.js: the assess chip
   flags the record, the book renders its chip + per-entry toggle, and the
   Keep failing filter narrows the list to flagged entries. */
console.log('\nkeep failing in the mistake book (shipped view-mistakes.js)');
var mx = loadShipped(true, { views: true });
vm.runInContext(fs.readFileSync(path.join(root, 'js/srs.js'), 'utf8'), mx.sandbox,
  { filename: 'js/srs.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'js/view-mistakes.js'), 'utf8'), mx.sandbox,
  { filename: 'js/view-mistakes.js' });
var MP = mx.sandbox.PGRE;
var mbox = mx.document.createElement('div');
mbox.innerHTML = MP.assess.html(false);
mx.document.body.appendChild(mbox);
var mctrl = MP.assess.bind(mbox, { id: 'pq1' }, false);
MP.store.state.attempts.push({ qid: 'pq1', correct: false });   // the row setLastAssess re-stamps
mctrl.toggle('stuck');
assert(MP.store.state.mistakes['pq1'] && MP.store.state.mistakes['pq1'].stuck === true,
  'shipped markStuck files the assess toggle into the mistake book');
assert(MP.store.state.attempts[MP.store.state.attempts.length - 1].tags.indexOf('stuck') !== -1,
  'the keep-failing tag is stamped on the attempt row with the other tags');
MP.store.state.mistakes['pq2'] = { firstMissedAt: '2026-09-05', lastMissedAt: '2026-09-06',
  misses: 1, solves: 0, wrongPicks: [0], lastPick: 0, archivedAt: null,
  srs: { step: 0, due: '2026-09-08' } };
var mview = ensureView(mx, MP.views.mistakes.render());
MP.views.mistakes.mount();
var mroot = mx.document.getElementById('mistakes-root');
assert(!!mroot, 'mistake book mounted');
assert(mroot.querySelectorAll('.miss-card').length === 2,
  'both entries render before any concern filter');
assert(mroot.querySelectorAll('.stuck-chip').length === 1,
  'only the flagged entry shows the keep failing chip');
assert(mroot.querySelectorAll('[data-stuck]').length === 2,
  'every entry carries the Keep failing toggle');
var concernChip = mroot.querySelector('[data-concern="stuck"]');
assert(!!concernChip, 'the Keep failing filter chip renders');
var toggles = mroot.querySelectorAll('[data-stuck]');
for (var ti = 0; ti < toggles.length; ti++) {
  if (toggles[ti].getAttribute('data-stuck') === 'pq2') { toggles[ti].click(); break; }
}
assert(MP.store.state.mistakes['pq2'].stuck !== true &&
       mroot.querySelector('#assess-stuck-confirm').hidden === false,
  'the per-entry Keep failing button opens the shared reminder before flagging');
assert(mx.document.querySelector('[data-stuck="pq2"]').getAttribute('title').indexOf('mistake-book retakes') !== -1,
  'the mistake-book button includes the shared hover tip');
mroot.querySelector('#assess-stuck-cancel').click();
assert(MP.store.state.mistakes['pq2'].stuck !== true,
  'mistake-book Cancel leaves the entry unflagged');
mx.document.querySelector('[data-stuck="pq2"]').click();
mroot.querySelector('#assess-stuck-yes').click();
assert(MP.store.state.mistakes['pq2'].stuck === true,
  'the per-entry Confirm flags the record');
assert(mx.document.querySelectorAll('#mistakes-root .stuck-chip').length === 2,
  'the book re-renders with both entries flagged');
mx.document.querySelector('#mistakes-root [data-concern="stuck"]').click();
assert(mx.document.querySelectorAll('#mistakes-root .miss-card').length === 2 &&
       mx.document.querySelectorAll('#mistakes-root .stuck-chip').length === 2,
  'the Keep failing filter keeps both flagged entries');
MP.store.state.mistakes['pq1'].misses = 1;   // a real miss: un-flagging must keep the entry
var pq1Toggle = mx.document.querySelectorAll('#mistakes-root [data-stuck]');
for (var tj = 0; tj < pq1Toggle.length; tj++) {
  if (pq1Toggle[tj].getAttribute('data-stuck') === 'pq1') { pq1Toggle[tj].click(); break; }
}
assert(MP.store.state.mistakes['pq1'] && MP.store.state.mistakes['pq1'].stuck !== true,
  'un-toggling from the book clears the flag but keeps a real miss in the book');
assert(mx.document.querySelectorAll('#mistakes-root .miss-card').length === 1,
  'the filter narrows the book as soon as a flag is cleared');

/* Keep failing must never eat a ladder it did not create. */
MP.store.state.mistakes['pq3'] = { firstMissedAt: '2026-09-01', misses: 0,
  solves: 0, wrongPicks: [], archivedAt: null,
  srs: { step: 3, due: '2026-11-01' } };
MP.srs.markStuck('pq3');
assert(MP.store.state.mistakes['pq3'].srs.step === 3 &&
       MP.store.state.mistakes['pq3'].srs.due === '2026-11-01',
  'markStuck leaves a pre-existing ladder alone');
MP.srs.unmarkStuck('pq3');
assert(MP.store.state.mistakes['pq3'] &&
       MP.store.state.mistakes['pq3'].srs.step === 3 &&
       MP.store.state.mistakes['pq3'].srs.due === '2026-11-01' &&
       MP.store.state.mistakes['pq3'].stuck !== true,
  'unmarkStuck keeps an entry that already had a ladder (step 3 intact, flag cleared)');

MP.srs.markLucky('pq4');
MP.srs.clearLucky('pq4');
MP.srs.markStuck('pq4');
MP.srs.unmarkStuck('pq4');
assert(MP.store.state.mistakes['pq4'] &&
       MP.store.state.mistakes['pq4'].srs &&
       MP.store.state.mistakes['pq4'].srs.step === 0 &&
       MP.store.state.mistakes['pq4'].stuck !== true,
  'unmarkStuck keeps the step-0 ladder markLucky seeded (flag cleared)');

MP.srs.markStuck('pq5');
MP.srs.unmarkStuck('pq5');
assert(!MP.store.state.mistakes['pq5'],
  'unmarkStuck still removes an entry this flag created (no ghost)');

console.log('\nPGRE.ui.bindChoiceCommit');
var ui = env.window.PGRE.ui;
assert(ui && typeof ui.bindChoiceCommit === 'function', 'bindChoiceCommit is on PGRE.ui');
assert(typeof ui.segmentedMeter === 'function', 'segmentedMeter is on PGRE.ui');
var zeroMeter = ui.meter(0, 'meter-test');
assert(zeroMeter.indexOf('meter-fill') >= 0 && zeroMeter.indexOf('meter-rest') >= 0,
  'meter zero total keeps an empty fill and remainder track');
var zeroTotalMeter = ui.segmentedMeter([], 'meter-test', { total: 0 });
assert((zeroTotalMeter.match(/meter-segment/g) || []).length === 0, 'segmentedMeter zero total renders an empty pill track');
var fullMeter = ui.segmentedMeter([{ value: 100, className: 'meter-fill' }], 'meter-test', { total: 100 });
assert(fullMeter.indexOf('meter-fill') >= 0 && fullMeter.indexOf('meter-rest') < 0, 'segmentedMeter 100% omits the remainder');
var oneMeter = ui.segmentedMeter([{ value: 4, className: 'meter-segment-solid', label: 'Solid enough', percent: 100 }], 'meter-test', { total: 4, value: 4 });
assert((oneMeter.match(/class="meter-segment/g) || []).length === 1 && oneMeter.indexOf('Solid enough') >= 0,
  'segmentedMeter supports a single named segment and legend');
var splitMeter = ui.segmentedMeter([
  { value: 3, className: 'meter-segment-solid', label: 'Solid enough', percent: 3 },
  { value: 30, className: 'meter-segment-young', label: 'Learning', percent: 30 },
  { value: 67, className: 'meter-segment-rest' }
], 'meter-test', { layout: 'grow', total: 100, value: 33 });
assert((splitMeter.match(/class="meter-segment/g) || []).length === 3 &&
  splitMeter.indexOf('Solid enough') >= 0 && splitMeter.indexOf('Learning') >= 0,
  'segmentedMeter renders two named segments plus remainder');
var commitBox = env.document.createElement('div');
commitBox.innerHTML =
  '<div class="choices">' +
    '<button class="choice" data-idx="0" aria-pressed="false">A</button>' +
    '<button class="choice" data-idx="1" aria-pressed="false">B</button>' +
  '</div>' +
  '<button type="button" class="btn btn-primary" id="confirm-btn" disabled>Confirm</button>';
env.document.body.appendChild(commitBox);
var commits = [];
ui.bindChoiceCommit(commitBox, { onCommit: function (i) { commits.push(i); } });
var c0 = commitBox.querySelector('.choice[data-idx="0"]');
var c1 = commitBox.querySelector('.choice[data-idx="1"]');
var cBtn = commitBox.querySelector('#confirm-btn');
assert(!!c0 && !!c1 && !!cBtn, 'commit fixture rendered choices and Confirm');
assert(cBtn.disabled === true, 'Confirm starts disabled');
c1.click();
assert(commits.length === 0, 'first click does not submit');
assert(c1.classList.contains('is-picked') && c1.getAttribute('aria-pressed') === 'true',
  'first click marks the choice picked');
assert(c0.getAttribute('aria-pressed') === 'false', 'unpicked choice stays unpressed');
assert(cBtn.disabled === false, 'Confirm enables after a pick');
c0.click();
assert(commits.length === 0, 'retargeting click still does not submit');
assert(c0.classList.contains('is-picked') && !c1.classList.contains('is-picked'),
  'a later click retargets the pending pick');
cBtn.click();
assert(commits.length === 1 && commits[0] === 0, 'Confirm submits the pending pick');
c1.click();
dispatchEl(c1, 'dblclick');
  assert(commits.length === 2 && commits[1] === 1, 'double-click submits that choice');
dispatchEl(c0, 'click', { detail: 2 });
assert(!c0.classList.contains('is-picked') && c1.classList.contains('is-picked'),
  'click detail>1 does not retarget the pending pick');
dispatchEl(c0, 'click', { detail: 1 });
assert(!c0.classList.contains('is-picked') && c1.classList.contains('is-picked'),
  'click-through (detail>=1, no mousedown) does not pick');
commitBox.remove();

/* sidebar aria-current + theme aria-pressed (same shipped functions the UI calls) */
console.log('\nshell aria');
var sidebar = env.document.createElement('aside');
sidebar.id = 'sidebar';
sidebar.setAttribute('id', 'sidebar');
['dashboard', 'exam', 'formulas'].forEach(function (id) {
  var a = env.document.createElement('a');
  a.setAttribute('data-nav', id);
  a.setAttribute('href', '#/' + (id === 'dashboard' ? '' : id));
  sidebar.appendChild(a);
});
env.document.body.appendChild(sidebar);
env.window.PGRE.setActiveNav('exam', {});
var examLink = sidebar.querySelector('a[data-nav="exam"]');
var dashLink = sidebar.querySelector('a[data-nav="dashboard"]');
assert(examLink.getAttribute('aria-current') === 'page', 'setActiveNav sets aria-current=page on the active link');
assert(dashLink.getAttribute('aria-current') == null, 'setActiveNav clears aria-current on inactive links');
assert(examLink.classList.contains('active'), 'setActiveNav still toggles .active');

var themeBtn = env.document.createElement('button');
themeBtn.id = 'theme-toggle';
themeBtn.setAttribute('id', 'theme-toggle');
env.document.body.appendChild(themeBtn);
env.window.PGRE.applyTheme('dark');
assert(themeBtn.getAttribute('aria-pressed') === 'true', 'applyTheme(dark) sets aria-pressed=true');
assert(themeBtn.textContent === 'Theme', 'the theme button reads Theme (named themes in Settings)');
assert((themeBtn.getAttribute('title') || '').indexOf('Theme:') === 0,
  'applyTheme names the current theme in the button title');
env.window.PGRE.applyTheme('light');
assert(themeBtn.getAttribute('aria-pressed') === 'false', 'applyTheme(light) sets aria-pressed=false');

/* structural: reduced-motion CSS covers toast / shake / topic-card / meter / grade / tile */
console.log('\nreduced-motion CSS coverage');
var motionCss = fs.readFileSync(path.join(root, 'css', 'motion.css'), 'utf8');
var styleCss = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
assert(/prefers-reduced-motion:\s*reduce/.test(motionCss), 'motion.css has a reduce block');
var motionFlat = motionCss.replace(/\s+/g, ' ');
var reduceAt = motionFlat.search(/prefers-reduced-motion:\s*reduce/);
var reduceFlat = reduceAt >= 0 ? motionFlat.slice(reduceAt) : '';
assert(/\.toast\s*\{[^}]*transition:\s*none/.test(motionFlat),
  'reduce block sets .toast { transition: none }');
assert(/\.flash-tile-shake\s*\{[^}]*animation:\s*none/.test(motionFlat),
  'reduce block sets .flash-tile-shake { animation: none }');
assert(/\.topic-card:hover\s*\{[^}]*transform:\s*none/.test(motionFlat),
  'reduce block sets .topic-card:hover { transform: none }');
assert(/\.grade-btn\s*\{[^}]*transition:\s*none/.test(reduceFlat),
  'reduce block sets .grade-btn { transition: none }');
assert(/\.flash-tile\s*\{[^}]*transition:\s*none/.test(reduceFlat),
  'reduce block sets .flash-tile { transition: none }');
assert(/\.letter-swap-a/.test(reduceFlat) && /letter-swap-b/.test(reduceFlat),
  'reduce block covers letter-swap layers');
assert(/width:\s*var\(--dur-slow\)\s+var\(--ease-out\)/.test(styleCss.replace(/\s+/g, ' ')) ||
  /width var\(--dur-slow\) var\(--ease-out\)/.test(styleCss),
  '.meter-fill uses duration/easing tokens, not 0.4s ease');

var indexSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var appAt = indexSrc.indexOf('js/app.js');
var motionAt = indexSrc.indexOf('js/motion.js');
assert(appAt >= 0 && motionAt > appAt, 'index.html loads motion.js after app.js');
assert(!/\stype=["']module["']/.test(indexSrc), 'index.html has no type=module scripts');
var motionSrc = fs.readFileSync(path.join(root, 'js', 'motion.js'), 'utf8');
assert(!/^\s*module\.exports\s*=/m.test(motionSrc), 'motion.js has no unguarded module.exports');

function runAsync() {
  console.log('\nshipped interaction modules');
  var ix = loadShipped(true, { views: true });
  var PGRE = ix.window.PGRE;
  assert(!!PGRE.flashmodes && typeof PGRE.flashmodes.startMatch === 'function',
    'loaded shipped js/flashmodes.js');
  assert(!!PGRE.views.formulas && typeof PGRE.views.formulas.mount === 'function',
    'loaded shipped js/view-formulas.js');
  assert(!!PGRE.views.exam && typeof PGRE.views.exam.mount === 'function',
    'loaded shipped js/view-exam.js');
  assert(!!PGRE.views.practice && typeof PGRE.views.practice.mount === 'function',
    'loaded shipped js/view-practice.js');
  /* Type-to-recall accepts notation-only differences without dropping
     semantic operators: rho_b/rho, nabla·/div, and vector decorations. */
  console.log('\ntype notation equivalence and sign safety');
  function typeVerdict(typed) {
    var host = ix.document.createElement('div');
    ix.document.body.appendChild(host);
    PGRE.flashmodes.startType({
      el: host,
      cards: [{
        id: 'repro-2.57',
        name: 'Dielectrics',
        front: 'What is the bound volume charge density rho_b in terms of the polarization P?',
        back: '$$\\rho_b = -\\nabla\\cdot\\mathbf{P}$$',
        eq: '2.57'
      }],
      onReplay: function () {},
      onExit: function () {}
    });
    host.querySelector('#flash-input').value = typed;
    host.querySelector('#flash-submit').click();
    var verdict = host.querySelector('.flash-auto');
    var matched = !!verdict && verdict.classList.contains('is-hit');
    host.remove();
    return matched;
  }
  assert(typeVerdict('rho = - divP vector'), 'notation-equivalent dielectric recall matches');
  assert(!typeVerdict('rho = divP vector'), 'wrong-sign dielectric recall misses');
  assert(!typeVerdict('rho_b = divP vector'), 'missing-minus dielectric recall misses');
  assert(!typeVerdict('sigma = - divE vector'), 'unrelated dielectric recall misses');


  /* PGRE.formulaTextHTML: angle-bracket expectation/average notation */
  console.log('\nformulaTextHTML: angle-bracket math notation');
  assert(typeof PGRE.formulaTextHTML === 'function', 'formulaTextHTML is exposed on PGRE');
  var dipolePrompt = 'What is the total average power <P>_B radiated by an oscillating magnetic dipole of amplitude m_0 at frequency \\omega?';
  var dipoleHTML = PGRE.formulaTextHTML(dipolePrompt);
  assert(dipoleHTML.indexOf('$\\langle P \\rangle_B$') !== -1,
    'formulaTextHTML converts <P>_B to $\\langle P \\rangle_B$, got: ' + dipoleHTML);
  assert(dipoleHTML.indexOf('<p>') === -1 && dipoleHTML.indexOf('<P>') === -1,
    'formulaTextHTML does not emit raw or unescaped HTML <p>/<P> tags');
  assert(dipoleHTML.indexOf('_B radiated') === -1,
    'formulaTextHTML leaves no orphaned subscript _B');
  assert(dipoleHTML.indexOf('$m_0$') !== -1 && dipoleHTML.indexOf('$\\omega$') !== -1,
    'formulaTextHTML formats $m_0$ and $\\omega$ in math');

  var eDipolePrompt = 'What is the total average power <P>_E radiated by an oscillating electric dipole of amplitude p_0 at frequency omega?';
  var eDipoleHTML = PGRE.formulaTextHTML(eDipolePrompt);
  assert(eDipoleHTML.indexOf('$\\langle P \\rangle_E$') !== -1,
    'formulaTextHTML converts <P>_E to $\\langle P \\rangle_E$');

  var poyntingPrompt = 'What is the time-averaged radiated intensity <S> of an oscillating electric dipole of amplitude p_0 at frequency omega, at distance r and polar angle theta?';
  var poyntingHTML = PGRE.formulaTextHTML(poyntingPrompt);
  assert(poyntingHTML.indexOf('$\\langle S \\rangle$') !== -1,
    'formulaTextHTML converts <S> to $\\langle S \\rangle$');
  assert(poyntingHTML.indexOf('<s>') === -1 && poyntingHTML.indexOf('<S>') === -1,
    'formulaTextHTML emits no raw <s>/<S> strikethrough tag');

  var hermitianPrompt = 'How is the Hermitian conjugate A-dagger of an operator defined through its action inside the bracket <a|A-hat b>?';
  var hermitianHTML = PGRE.formulaTextHTML(hermitianPrompt);
  assert(hermitianHTML.indexOf('$\\langle a|\\hat{A} b \\rangle$') !== -1,
    'formulaTextHTML converts a spaced inner product <a|A-hat b> with the hat on A, got: ' + hermitianHTML);
  assert(hermitianHTML.indexOf('<a|') === -1,
    'formulaTextHTML emits no raw <a| tag opener');
  var diracHTML = PGRE.formulaTextHTML('Matrix elements <a|A-hat|b> and <a|A-dagger|b> and expectation <psi|H-hat|psi>.');
  assert(diracHTML.indexOf('$\\langle a|\\hat{A}|b \\rangle$') !== -1,
    'formulaTextHTML converts a three-part bra-ket <a|A-hat|b>, got: ' + diracHTML);
  assert(diracHTML.indexOf('$\\langle a|A^{\\dagger}|b \\rangle$') !== -1,
    'formulaTextHTML converts <a|A-dagger|b>, got: ' + diracHTML);
  assert(diracHTML.indexOf('$\\langle \\psi|\\hat{H}|\\psi \\rangle$') !== -1,
    'formulaTextHTML converts <psi|H-hat|psi>, got: ' + diracHTML);
  assert(diracHTML.indexOf('-hat') === -1 && diracHTML.indexOf('-dagger') === -1,
    'formulaTextHTML leaves no bare accent suffix inside bra-kets, got: ' + diracHTML);

  var overlapPrompt = 'In Dirac notation, what does the overlap of a position eigenbra <x| with a state |f> equal?';
  var overlapHTML = PGRE.formulaTextHTML(overlapPrompt);
  assert(overlapHTML.indexOf('$\\langle x|$') !== -1 && overlapHTML.indexOf('$|f\\rangle$') !== -1,
    'formulaTextHTML converts a split bra/ket pair <x| ... |f>');
  assert(overlapHTML.indexOf('<x|') === -1 && overlapHTML.indexOf('|f>') === -1,
    'formulaTextHTML emits no raw <x| or |f> tag fragments');

  var expectations = PGRE.formulaTextHTML('Expectations <x>, <v>, and <x^2>');
  assert(expectations.indexOf('$\\langle x \\rangle$') !== -1 &&
         expectations.indexOf('$\\langle v \\rangle$') !== -1 &&
         expectations.indexOf('$\\langle x^2 \\rangle$') !== -1,
    'formulaTextHTML converts <x>, <v>, and <x^2>');

  var psiPrompt = 'When a wavefunction Psi(x,t) is expanded in an orthonormal eigenbasis {f_n(x)} of an observable, how is the expansion coefficient c_n obtained?';
  var psiHTML = PGRE.formulaTextHTML(psiPrompt);
  assert(psiHTML.indexOf('$\\Psi$') !== -1,
    'formulaTextHTML converts named Psi to $\\Psi$, got: ' + psiHTML);
  assert(psiHTML.replace(/\\Psi/g, '').indexOf('Psi') === -1,
    'formulaTextHTML leaves no bare Psi, got: ' + psiHTML);
  assert(psiHTML.indexOf('$\\Psi$(') !== -1,
    'formulaTextHTML keeps the parenthesized argument outside the Psi token, got: ' + psiHTML);

  var hhatPrompt = 'What is the time-dependent Schrodinger equation governing the evolution of Psi(x,t) under the Hamiltonian operator H-hat?';
  var hhatHTML = PGRE.formulaTextHTML(hhatPrompt);
  assert(hhatHTML.indexOf('$\\hat{H}$') !== -1,
    'formulaTextHTML converts H-hat to $\\hat{H}$, got: ' + hhatHTML);
  assert(hhatHTML.indexOf('-hat') === -1,
    'formulaTextHTML leaves no bare -hat suffix, got: ' + hhatHTML);
  var hatForms = PGRE.formulaTextHTML('position operator x-hat, momentum p-hat, L_z-hat, L-squared-hat, direction n-hat');
  ['$\\hat{x}$', '$\\hat{p}$', '$\\hat{L}_z$', '$\\hat{L}^2$', '$\\hat{n}$'].forEach(function (want) {
    assert(hatForms.indexOf(want) !== -1,
      'formulaTextHTML converts hat suffixes, wanted ' + want + ' in: ' + hatForms);
  });

  /* PGRE.formulaTextHTML: word-suffix accents beyond -hat
     (A-dagger, x-bar, phi-tilde, v-vec, -squared/-cubed/-star/-prime) */
  console.log('\nformulaTextHTML: word-suffix accents');
  var daggerPrompt = 'How is the Hermitian conjugate A-dagger of an operator defined through its action inside the bracket <a|A-hat b>?';
  var daggerHTML = PGRE.formulaTextHTML(daggerPrompt);
  assert(daggerHTML.indexOf('$A^{\\dagger}$') !== -1,
    'formulaTextHTML converts A-dagger to $A^{\\dagger}$, got: ' + daggerHTML);
  assert(daggerHTML.indexOf('-dagger') === -1,
    'formulaTextHTML leaves no bare -dagger suffix, got: ' + daggerHTML);
  var daggerInnerHTML = PGRE.formulaTextHTML('matrix elements <a|A-dagger b> and <a|A_i-dagger b>');
  assert(daggerInnerHTML.indexOf('$\\langle a|A^{\\dagger} b \\rangle$') !== -1 &&
         daggerInnerHTML.indexOf('$\\langle a|A_i^{\\dagger} b \\rangle$') !== -1,
    'formulaTextHTML renders dagger inside angle brackets, got: ' + daggerInnerHTML);
  var accentForms = PGRE.formulaTextHTML('average P-bar, density rho-bar_0, amplitude phi-tilde, velocity v-vec, Planck h-bar');
  ['$\\bar{P}$', '$\\bar{\\rho}_0$', '$\\tilde{\\phi}$', '$\\vec{v}$', '$\\hbar$'].forEach(function (want) {
    assert(accentForms.indexOf(want) !== -1,
      'formulaTextHTML converts accent suffixes, wanted ' + want + ' in: ' + accentForms);
  });
  var powerForms = PGRE.formulaTextHTML('spin operators J-squared and S-squared, chi-squared statistic, x-cubed term, conjugate a-star, slope x-prime');
  ['$J^2$', '$S^2$', '$\\chi^2$', '$x^3$', '$a^*$', "$x'$"].forEach(function (want) {
    assert(powerForms.indexOf(want) !== -1,
      'formulaTextHTML converts power/star/prime suffixes, wanted ' + want + ' in: ' + powerForms);
  });

  /* PGRE.formulaTextHTML: bare primes, word sub/sup, digit subscripts, +/- suffixes */
  var primePrompt = 'In a frame S\u0027 the primed coordinates x\u0027 and t\u0027 read differently; lambda\u0027/lambda gives the shift.';
  var primeHTML = PGRE.formulaTextHTML(primePrompt);
  ['$S\u0027$', '$x\u0027$', '$t\u0027$', '$\\lambda\u0027$'].forEach(function (want) {
    assert(primeHTML.indexOf(want) !== -1,
      'formulaTextHTML converts bare primes, wanted ' + want + ' in: ' + primeHTML);
  });
  assert(PGRE.formulaTextHTML("Newton's laws and particles' spins").indexOf('$') === -1,
    'formulaTextHTML leaves English apostrophes alone');
  var wordScripts = PGRE.formulaTextHTML('equilibrium x-sub-0, energy E-sup-2, levels n1 and n2, operators S+ and S-');
  ['$x_0$', '$E^2$', '$n_1$', '$n_2$', '$S_{+}$', '$S_{-}$'].forEach(function (want) {
    assert(wordScripts.indexOf(want) !== -1,
      'formulaTextHTML converts word/digit/sign scripts, wanted ' + want + ' in: ' + wordScripts);
  });

  /* PGRE.formulaTextHTML: products, parenthesized powers, wider greek map */
  var productHTML = PGRE.formulaTextHTML('how can the operator L-dot-S be expressed in terms of J-squared, L-squared, and S-squared?');
  assert(productHTML.indexOf('$L \\cdot S$') !== -1 && productHTML.indexOf('-dot-') === -1,
    'formulaTextHTML converts L-dot-S to $L \\cdot S$, got: ' + productHTML);
  var intervalHTML = PGRE.formulaTextHTML('Sign condition on the invariant interval (Delta x)^2 for two events to be timelike-separated?');
  assert(intervalHTML.indexOf('$(\\Delta x)^2$') !== -1,
    'formulaTextHTML converts (Delta x)^2 to $(\\Delta x)^2$, got: ' + intervalHTML);
  var greekHTML = PGRE.formulaTextHTML('a dielectric of constant kappa and interval Delta t read by the clock');
  assert(greekHTML.indexOf('$\\kappa$') !== -1 && greekHTML.indexOf('$\\Delta$') !== -1,
    'formulaTextHTML converts kappa and Delta, got: ' + greekHTML);
  var greekInnerHTML = PGRE.formulaTextHTML('overlap <psi|phi> of two states');
  assert(greekInnerHTML.indexOf('$\\langle \\psi|\\phi \\rangle$') !== -1,
    'formulaTextHTML converts greek words inside angle brackets, got: ' + greekInnerHTML);

  /* PGRE.formulaTextHTML: inline markdown bold (**text** -> <strong>text</strong>) */
  console.log('\nformulaTextHTML: inline markdown bold');
  var polCard = PGRE.FORMULAS ? PGRE.FORMULAS.find(function (c) { return c.id === 'cpgf-2.56a'; }) : null;
  var polBack = polCard ? polCard.back : 'Definition: $$\\mathbf{P} = \\frac{d\\mathbf{p}}{dV}$$\nDirection: Points from **negative to positive** bound charge';
  var polHTML = PGRE.formulaTextHTML(polBack);
  assert(polHTML.indexOf('<strong>negative to positive</strong>') !== -1,
    'formulaTextHTML renders **negative to positive** as <strong>negative to positive</strong>, got: ' + polHTML);
  assert(polHTML.indexOf('**negative to positive**') === -1 && polHTML.indexOf('**') === -1,
    'formulaTextHTML leaves no literal ** markdown asterisks');

  var mathBoldHTML = PGRE.formulaTextHTML('1. **$H = E$** requires a time-independent map');
  assert(mathBoldHTML.indexOf('<strong>$H = E$</strong>') !== -1,
    'formulaTextHTML renders bold containing math: ' + mathBoldHTML);

  var multHTML = PGRE.formulaTextHTML('Calculate 2 * 3 * 4 and check $A * B$');
  assert(multHTML.indexOf('2 * 3 * 4') !== -1 && multHTML.indexOf('$A * B$') !== -1,
    'formulaTextHTML preserves literal asterisks in multiplication and math, got: ' + multHTML);
  assert(multHTML.indexOf('<strong>') === -1 && multHTML.indexOf('<em>') === -1,
    'formulaTextHTML does not convert single asterisks to HTML tags');

  /* Match: click and keyboard share onPick */
  console.log('\nmatch click vs keyboard (shipped onKey → onPick)');
  var matchHost = ix.document.createElement('div');
  matchHost.id = 'flash-body';
  matchHost.setAttribute('id', 'flash-body');
  ix.document.body.appendChild(matchHost);
  ix.location.hash = '#/formulas';
  var matchCtrl = PGRE.flashmodes.startMatch({
    el: matchHost,
    cards: ix.cards.slice(0, 2),
    onReplay: function () {},
    onExit: function () {}
  });
  var tiles = matchHost.querySelectorAll('.flash-tile');
  assert(tiles.length >= 4, 'startMatch rendered flash tiles from shipped flashmodes');

  /* Q4: a Match formula tile shows the back's leading formula only */
  var q4Host = ix.document.createElement('div');
  ix.document.body.appendChild(q4Host);
  PGRE.flashmodes.startMatch({
    el: q4Host,
    cards: [{ id: 'q4m', topic: 'cm', front: 'Match prompt',
      back: '$$F = ma$$<p class="card-key"><strong>Key takeaway</strong></p>' +
        '<ul class="recall-list"><li><strong>Labelled point:</strong> net force</li></ul>' }],
    onReplay: function () {}, onExit: function () {}
  });
  var q4Formula = '';
  q4Host.querySelectorAll('.flash-tile').forEach(function (t) {
    var kind = t.querySelector('.flash-tile-kind');
    if (kind && kind.textContent === 'Formula') q4Formula = t.querySelector('.flash-tile-body').textContent;
  });
  assert(q4Formula.indexOf('F = ma') !== -1, 'Q4 Match formula tile keeps the leading formula, got: ' + q4Formula);
  assert(q4Formula.indexOf('Key takeaway') === -1 && q4Formula.indexOf('Labelled point') === -1,
    'Q4 Match formula tile drops the takeaway and labelled points, got: ' + q4Formula);
  PGRE.flashmodes.startMatch({
    el: q4Host,
    cards: [{ id: 'q4p', topic: 'cm', front: 'Prose prompt',
      back: '<strong>Prose lead</strong><br>then $v$' }],
    onReplay: function () {}, onExit: function () {}
  });
  var q4Prose = q4Host.textContent;
  assert(q4Prose.indexOf('Prose lead') !== -1 && q4Prose.indexOf('then') !== -1,
    'Q4 Match tile keeps a back with no leading math block whole');
  tiles[0].click();
  assert(tiles[0].classList.contains('selected') && tiles[0].getAttribute('aria-pressed') === 'true',
    'click path calls onPick (tile 0 selected)');
  /* Motion-on so a mismatch still leaves .selected/.bad on tile 1 (under reduce,
     onPick reverts immediately and a no-op onKey would look the same). */
  ix.setReduced(false);
  var t1 = matchHost.querySelector('[data-tile="1"]');
  assert(!!t1, 'tile 1 exists for keyboard 2 → onPick(1)');
  var before = {
    pressed: t1.getAttribute('aria-pressed'),
    selected: t1.classList.contains('selected'),
    matched: t1.classList.contains('matched'),
    bad: t1.classList.contains('bad')
  };
  assert(typeof matchCtrl.onKey === 'function', 'startMatch returned the shipped Match onKey');
  var keyEv = {
    key: '2',
    preventDefault: function () { keyEv.defaultPrevented = true; },
    metaKey: false,
    ctrlKey: false,
    altKey: false
  };
  matchCtrl.onKey(keyEv);
  t1 = matchHost.querySelector('[data-tile="1"]');
  var after = {
    pressed: t1 ? t1.getAttribute('aria-pressed') : null,
    selected: !!(t1 && t1.classList.contains('selected')),
    matched: !!(t1 && t1.classList.contains('matched')),
    bad: !!(t1 && t1.classList.contains('bad'))
  };
  assert(after.pressed !== before.pressed || after.selected !== before.selected ||
    after.matched !== before.matched || after.bad !== before.bad,
    'keyboard 2 reaches shipped Match onKey → onPick (tile 1 aria-pressed/.selected/.matched/.bad changed)');
  var t0 = matchHost.querySelector('[data-tile="0"]');
  var samePair = t0 && t1 && (
    (t0.classList.contains('matched') && t1.classList.contains('matched')) ||
    (t0.classList.contains('bad') && t1.classList.contains('bad')) ||
    (t0.classList.contains('selected') && t1.classList.contains('selected'))
  );
  assert(samePair,
    'click tile 0 and keyboard 2 share onPick (same selected/matched/mismatch pair state)');
  ix.setReduced(true);
  if (matchCtrl && matchCtrl.stop) matchCtrl.stop();
  ix.flushTimeouts(600);

  /* Match mismatch delay under reduced vs motion-on */
  console.log('\nmatch mismatch delay (reduced vs motion-on)');
  function pickTwoPrompts(host) {
    var idxs = [];
    host.querySelectorAll('.flash-tile').forEach(function (t) {
      var kind = t.querySelector('.flash-tile-kind');
      if (kind && kind.textContent.indexOf('Prompt') !== -1) {
        idxs.push(parseInt(t.getAttribute('data-tile'), 10));
      }
    });
    return idxs;
  }
  var mmHost = ix.document.createElement('div');
  ix.document.body.appendChild(mmHost);
  ix.setReduced(true);
  PGRE.flashmodes.startMatch({
    el: mmHost, cards: ix.cards.slice(0, 2), onReplay: function () {}, onExit: function () {}
  });
  var prompts = pickTwoPrompts(mmHost);
  assert(prompts.length >= 2, 'match grid has two prompt tiles to force a mismatch');
  mmHost.querySelector('[data-tile="' + prompts[0] + '"]').click();
  mmHost.querySelector('[data-tile="' + prompts[1] + '"]').click();
  var has600 = ix.timeouts().some(function (t) { return t.ms === 600; });
  var a = mmHost.querySelector('[data-tile="' + prompts[0] + '"]');
  var b = mmHost.querySelector('[data-tile="' + prompts[1] + '"]');
  assert(!has600, 'mismatch under reduce does not schedule the 600ms hold');
  assert(a && !a.classList.contains('selected') && a.getAttribute('aria-pressed') === 'false',
    'mismatch under reduce reverts selected/aria-pressed immediately');
  assert(b && !b.classList.contains('selected') && b.getAttribute('aria-pressed') === 'false',
    'mismatch partner also unselected immediately under reduce');

  var mmHostOn = ix.document.createElement('div');
  ix.document.body.appendChild(mmHostOn);
  ix.setReduced(false);
  PGRE.flashmodes.startMatch({
    el: mmHostOn, cards: ix.cards.slice(0, 2), onReplay: function () {}, onExit: function () {}
  });
  var promptsOn = pickTwoPrompts(mmHostOn);
  mmHostOn.querySelector('[data-tile="' + promptsOn[0] + '"]').click();
  mmHostOn.querySelector('[data-tile="' + promptsOn[1] + '"]').click();
  var aOn = mmHostOn.querySelector('[data-tile="' + promptsOn[0] + '"]');
  assert(ix.timeouts().some(function (t) { return t.ms === 600; }),
    'mismatch with motion on keeps the 600ms revert timer');
  assert(aOn && (aOn.classList.contains('selected') || aOn.classList.contains('bad')),
    'mismatch with motion on still holds selected/bad until the timer fires');
  ix.setReduced(true);

  /* Cloze auto-advance under reduced-motion */
  console.log('\ncloze auto-advance (reduced vs motion-on)');
  var clozeHost = ix.document.createElement('div');
  clozeHost.id = 'cloze-host';
  clozeHost.setAttribute('id', 'cloze-host');
  ix.document.body.appendChild(clozeHost);
  ix.setReduced(true);
  var clozeCards = ix.cards.slice(0, 3);
  PGRE.flashmodes.startCloze({
    el: clozeHost, cards: clozeCards, deck: clozeCards,
    onReplay: function () {}, onExit: function () {}
  });
  var opt0 = clozeHost.querySelector('.cloze-option');
  assert(!!opt0, 'startCloze rendered option chips from shipped flashmodes');
  var hudBefore = (clozeHost.querySelector('.chip') || {}).textContent || '';
  opt0.click();
  var clozeDelay = ix.timeouts().some(function (t) { return t.ms === 650 || t.ms === 1200; });
  assert(!clozeDelay, 'cloze under reduce does not wait 650/1200ms');
  var hudAfter = (clozeHost.querySelector('.chip') || {}).textContent || '';
  var advanced = hudAfter !== hudBefore || /complete/i.test(clozeHost.textContent || '');
  assert(advanced, 'cloze under reduce advances (or finishes) immediately after painting tints');

  var clozeHostOn = ix.document.createElement('div');
  ix.document.body.appendChild(clozeHostOn);
  ix.setReduced(false);
  PGRE.flashmodes.startCloze({
    el: clozeHostOn, cards: clozeCards, deck: clozeCards,
    onReplay: function () {}, onExit: function () {}
  });
  var optOn = clozeHostOn.querySelector('.cloze-option');
  optOn.click();
  assert(ix.timeouts().some(function (t) { return t.ms === 650 || t.ms === 1200; }),
    'cloze with motion on keeps the 650/1200ms auto-advance timer');
  ix.setReduced(true);

  /* Exam: 1–5 / A–E keyboard and click share selectAnswer */
  console.log('\nexam 1–5 / A–E vs click (shipped selectAnswer)');
  ix.document.body.classList.remove('exam-fullscreen');
  var examView = ensureView(ix, PGRE.views.exam.render());
  PGRE.views.exam.mount({ sub: 'run' });
  var examChoice0 = ix.document.querySelector('#exam-q .choice[data-idx="0"]');
  var examChoice1 = ix.document.querySelector('#exam-q .choice[data-idx="1"]');
  assert(!!examChoice0 && !!examChoice1, 'exam room rendered choices from shipped view-exam.js');
  dispatchKeydown(ix, { key: 'B' });
  assert(examChoice1.classList.contains('is-picked') && examChoice1.getAttribute('aria-pressed') === 'true',
    'keyboard B reaches shipped exam key handler → selectAnswer');
  assert(ix.exam.answers.eq1 === 1, 'keyboard B stored answers[qid]=1');
  examChoice1.click();
  assert(ix.exam.answers.eq1 == null && examChoice1.getAttribute('aria-pressed') === 'false',
    'click on the same choice runs the same selectAnswer (toggle off)');
  examChoice0.click();
  assert(examChoice0.classList.contains('is-picked') && ix.exam.answers.eq1 === 0,
    'click path lands on the same is-picked / answers state as keyboard');
  dispatchKeydown(ix, { key: '3' });
  var examChoice2 = ix.document.querySelector('#exam-q .choice[data-idx="2"]');
  assert(examChoice2 && examChoice2.classList.contains('is-picked') && ix.exam.answers.eq1 === 2,
    'keyboard 3 (1–5) shares selectAnswer with A–E / click');

  /* Practice: first click / A–E select; Confirm or double-click commits */
  console.log('\npractice onKey vs click (select then confirm)');
  ix.document.body.classList.remove('exam-fullscreen');
  ensureView(ix, PGRE.views.practice.render());
  PGRE.views.practice.mount({ id: 'all' });
  var startAll = ix.document.querySelector('[data-count]');
  assert(!!startAll, 'practice config rendered a start-count button');
  var counts = ix.document.querySelectorAll('[data-count]');
  counts[counts.length - 1].click();
  return wait(350).then(function () {
    var pChoice1 = ix.document.querySelector('#practice-root .choice[data-idx="1"]');
    assert(!!pChoice1, 'practice question rendered choices');
    var promptOn1 = (ix.document.querySelector('#practice-root .q-text') || {}).textContent || '';
    var liveCells = ix.document.querySelectorAll('.practice-live .practice-palette .pal-cell');
    assert(liveCells.length === 2, 'live palette has a box per question');
    assert(!liveCells[0].disabled && !liveCells[1].disabled,
      'live palette cells are clickable during the drill');
    liveCells[1].click();
    var metaAfterJump = ix.document.querySelector('#practice-root .practice-meta');
    assert(metaAfterJump && metaAfterJump.textContent.indexOf('Question 2 of 2') !== -1,
      'clicking box 2 during the drill opens question 2');
    var promptOn2 = (ix.document.querySelector('#practice-root .q-text') || {}).textContent || '';
    assert(promptOn2 !== promptOn1, 'live palette jump changes the current question');
    var curLive = ix.document.querySelector('.practice-live .practice-palette .pal-cell.is-current');
    assert(curLive && curLive.textContent === '2', 'box 2 is marked is-current after live jump');
    liveCells = ix.document.querySelectorAll('.practice-live .practice-palette .pal-cell');
    liveCells[0].click();
    assert(ix.document.querySelector('#practice-root .practice-meta').textContent.indexOf('Question 1 of 2') !== -1,
      'clicking box 1 during the drill returns to question 1');
    assert(((ix.document.querySelector('#practice-root .q-text') || {}).textContent || '') === promptOn1,
      'returning via the palette restores question 1');
    dispatchKeydown(ix, { key: 'B' });
    pChoice1 = ix.document.querySelector('#practice-root .choice[data-idx="1"]');
    assert(pChoice1 && pChoice1.getAttribute('aria-pressed') === 'true',
      'keyboard B reaches shipped practice onKey → select, not answer()');
    assert(pChoice1.classList.contains('is-picked'), 'keyboard B paints is-picked');
    assert(!ix.document.getElementById('assess-row'),
      'keyboard B does not grade until Confirm');
    var confirmBtn = ix.document.getElementById('confirm-btn');
    assert(!!confirmBtn && confirmBtn.disabled === false, 'Confirm enables after B');
    confirmBtn.click();
    var assessRow = ix.document.getElementById('assess-row');
    assert(!!assessRow, 'Confirm commits through answer() (#assess-row present)');
    dispatchKeydown(ix, { key: 'k' });
    var sureChip = ix.document.querySelector('[data-assess="sure"]');
    assert(sureChip && sureChip.getAttribute('aria-pressed') === 'true',
      'keyboard K reaches shipped practice onKey → assess.toggle (same as click)');
    var guessChip = ix.document.querySelector('[data-assess="guess"]');
    guessChip.click();
    assert(guessChip.getAttribute('aria-pressed') === 'true',
      'click on Guessed uses the same bind().toggle the K key just used');
    assert(sureChip.getAttribute('aria-pressed') === 'false',
      'Knew it / Guessed stay mutually exclusive on mixed keyboard+click');

    liveCells = ix.document.querySelectorAll('.practice-live .practice-palette .pal-cell');
    liveCells[1].click();
    assert(ix.document.querySelector('#practice-root .practice-meta').textContent.indexOf('Question 2 of 2') !== -1,
      'palette jump from feedback opens the unanswered question');
    liveCells = ix.document.querySelectorAll('.practice-live .practice-palette .pal-cell');
    liveCells[0].click();
    assert(ix.document.querySelector('#practice-root .practice-meta').textContent.indexOf('Question 1 of 2') !== -1,
      'palette jump returns to the answered question');
    assessRow = ix.document.getElementById('assess-row');
    assert(!!assessRow, 'returning to an answered live question still shows Knew it / Guessed');
    guessChip = ix.document.querySelector('[data-assess="guess"]');
    assert(guessChip && guessChip.getAttribute('aria-pressed') === 'true',
      'Guessed tag survives the palette jump');
    dispatchKeydown(ix, { key: 'k' });
    sureChip = ix.document.querySelector('[data-assess="sure"]');
    assert(sureChip && sureChip.getAttribute('aria-pressed') === 'true',
      'keyboard K still toggles assess after returning via the palette');

    var nextBtn = ix.document.getElementById('next-btn');
    if (nextBtn) nextBtn.click();
    return wait(350);
  }).then(function () {
    var pChoice1b = ix.document.querySelector('#practice-root .choice[data-idx="1"]');
    if (pChoice1b) {
      pChoice1b.click();
      assert(pChoice1b.getAttribute('aria-pressed') === 'true',
        'click on a practice choice selects without grading');
      assert(!ix.document.getElementById('assess-row'),
        'first click does not open feedback');
      dispatchEl(pChoice1b, 'dblclick');
      assert(!!ix.document.getElementById('assess-row'),
        'double-click on a practice choice runs the same answer() as Confirm');
    } else {
      assert(false, 'second practice question rendered a choice to click');
    }

    var finishBtn = ix.document.getElementById('next-btn');
    assert(finishBtn && finishBtn.textContent === 'Finish session', 'second question shows Finish session button');
    if (finishBtn) finishBtn.click();
    var revButtons = ix.document.querySelectorAll('[data-review]');
    assert(revButtons.length === 2, 'summary renders data-review buttons for completed questions');
    revButtons[0].click();
    var reviewMeta = ix.document.querySelector('#practice-root .practice-meta');
    assert(reviewMeta && reviewMeta.textContent.indexOf('Review — 1 of 2') !== -1, 'clicking box 1 renders review card for question 1');
    var curCell = ix.document.querySelector('.practice-palette .pal-cell.is-current');
    assert(curCell && curCell.textContent === '1', 'box 1 is marked is-current in review');
    var reviewNext = ix.document.getElementById('review-next');
    assert(!!reviewNext, 'review renders review-next button');
    if (reviewNext) reviewNext.click();
    assert(ix.document.querySelector('#practice-root .practice-meta').textContent.indexOf('Review — 2 of 2') !== -1, 'review-next navigates to question 2');
    var reviewBack = ix.document.getElementById('review-summary');
    assert(!!reviewBack, 'review renders Back to results button');
    if (reviewBack) reviewBack.click();
    assert(ix.document.querySelector('#practice-root h1').textContent === 'Session complete', 'Back to results returns to summary');
    var revBtn0 = ix.document.querySelector('[data-review="0"]');
    if (revBtn0) revBtn0.click();
    dispatchKeydown(ix, { key: 'ArrowRight' });
    assert(ix.document.querySelector('#practice-root .practice-meta').textContent.indexOf('Review — 2 of 2') !== -1, 'ArrowRight advances to question 2 in review');
    dispatchKeydown(ix, { key: 'ArrowLeft' });
    assert(ix.document.querySelector('#practice-root .practice-meta').textContent.indexOf('Review — 1 of 2') !== -1, 'ArrowLeft returns to question 1 in review');
    dispatchKeydown(ix, { key: 'Escape' });
    assert(ix.document.querySelector('#practice-root h1').textContent === 'Session complete', 'Escape returns to summary');

    /* Formulas portal: Type undo (click + Ctrl+Z through the document handler)
       and checkpoint overlay (focused Finish must not Keep going). */
    console.log('\nformulas: type undo + overlay (shipped document key listener)');
    ix.location.hash = '#/formulas';
    /* Cloze earlier in this file calls reviewCard → gradeCard on shuffled cards.
       Clear the log so Type undo asserts the row it just wrote, not a leftover
       same-id review from that prior game. */
    PGRE.store.state.cardReviews = [];
    ensureView(ix, PGRE.views.formulas.render());
    PGRE.views.formulas.mount();
    return Promise.resolve()
      .then(function () { return Promise.resolve(); })
      .then(function () { return Promise.resolve(); })
      .then(function () { return wait(0); });
  }).then(function () {
    var typeTab = ix.document.querySelector('[data-mode="type"]');
    assert(!!typeTab, 'formulas shell rendered the Type tab from shipped view-formulas.js');
    typeTab.click();
    var startBtn = ix.document.getElementById('game-start');
    assert(!!startBtn, 'Type intro rendered Start from shipped launch path');
    startBtn.click();
    var inp = ix.document.getElementById('flash-input');
    assert(!!inp, 'startType rendered #flash-input');
    inp.value = 'nope';
    inp.focus();
    ix.document.getElementById('flash-submit').click();
    var gradeGood = ix.document.querySelector('[data-grade="good"]');
    assert(!!gradeGood, 'type reveal rendered grade buttons');
    gradeGood.click();
    var undoBtn = ix.document.getElementById('flash-undo');
    assert(!!undoBtn, 'grading a type card shows #flash-undo');
    var reviews = PGRE.store.state.cardReviews;
    assert(reviews.length > 0, 'gradeCard wrote a cardReviews entry (click path about to undo it)');
    var reviewsBefore = reviews.length;
    var clickRow = reviews[reviews.length - 1];
    undoBtn.click();
    assert(!ix.document.getElementById('flash-undo'), 'click on #flash-undo calls undoLast (link removed)');
    assert(PGRE.store.state.cardReviews.length === reviewsBefore - 1,
      'click undoLast popped the same cardReviews entry gradeCard wrote');
    assert(PGRE.store.state.cardReviews.indexOf(clickRow) === -1,
      'click undoLast restored SRS (the review object gradeCard just wrote is gone)');

    var inp2 = ix.document.getElementById('flash-input');
    if (inp2) { inp2.value = 'stillnope'; inp2.focus(); }
    var sub2 = ix.document.getElementById('flash-submit');
    if (sub2) sub2.click();
    var gradeAgain = ix.document.querySelector('[data-grade="again"]') ||
      ix.document.querySelector('[data-grade="good"]');
    if (gradeAgain) gradeAgain.click();
    var undo2 = ix.document.getElementById('flash-undo');
    assert(!!undo2, 'second grade restored an #flash-undo for the keyboard path');
    var reviewsBefore2 = PGRE.store.state.cardReviews.length;
    var keyRow = PGRE.store.state.cardReviews[reviewsBefore2 - 1];
    var inp3 = ix.document.getElementById('flash-input');
    if (inp3) inp3.focus();
    dispatchKeydown(ix, {
      key: 'z',
      ctrlKey: true,
      target: inp3 || ix.document.activeElement
    });
    assert(!ix.document.getElementById('flash-undo'),
      'Ctrl+Z while INPUT focused reaches shipped undoLast (same as click)');
    assert(PGRE.store.state.cardReviews.length === reviewsBefore2 - 1,
      'keyboard undoLast popped the same cardReviews entry the click path pops');
    assert(keyRow && PGRE.store.state.cardReviews.indexOf(keyRow) === -1,
      'keyboard undoLast restored the same SRS state the click path restored');

    /* Overlay: drive study to a checkpoint via Easy × 10 with cards remaining */
    var studyTab = ix.document.querySelector('[data-mode="study"]');
    studyTab.click();
    var studyBtn = ix.document.getElementById('study-btn');
    assert(!!studyBtn, 'Study home rendered #study-btn from remaining cards');
    studyBtn.click();
    var i;
    for (i = 0; i < 10; i++) {
      var flip = ix.document.getElementById('flip-btn');
      if (!flip) break;
      flip.click();
      var easy = ix.document.querySelector('[data-grade="easy"]');
      if (!easy) break;
      easy.click();
    }
    var finish = ix.document.getElementById('cp-finish');
    var keep = ix.document.getElementById('cp-keep');
    assert(!!finish && !!keep, '10 Easy grades with cards left opened the checkpoint overlay');
    finish.focus();
    assert(ix.document.activeElement && ix.document.activeElement.id === 'cp-finish',
      'Finish is the activeElement');
    dispatchKeydown(ix, { key: 'Enter', target: finish });
    assert(!!ix.document.getElementById('cp-finish'),
      'focused #cp-finish + Enter does not call Keep-going (runNextOverlay)');
    dispatchKeydown(ix, { key: ' ', target: finish });
    assert(!!ix.document.getElementById('cp-finish'),
      'focused #cp-finish + Space does not call Keep-going (runNextOverlay)');
    ix.document.body.focus();
    dispatchKeydown(ix, { key: 'Enter', target: ix.document.body });
    assert(!ix.document.getElementById('cp-finish'),
      'unfocused Enter on the overlay does Keep-going (shipped runNextOverlay)');

    console.log('\nformulas: Open Simulation from session peek');
    var vz = loadShipped(true, { views: true });
    var VP = vz.sandbox.PGRE;
    var openedViz = [];
    var closedViz = 0;
    VP.visualizers = {};
    VP.openVisualizerModal = function (id) { openedViz.push(id); };
    VP.closeVisualizerModal = function () { closedViz++; };
    vz.location.hash = '#/formulas';
    ensureView(vz, VP.views.formulas.render());
    VP.views.formulas.mount();
    return wait(0).then(function () {
      var studyBtn = vz.document.getElementById('study-btn');
      assert(!!studyBtn, 'Study remaining button rendered');
      studyBtn.click();
      vz.document.getElementById('flip-btn').click();
      var easy = vz.document.querySelector('[data-grade="easy"]');
      assert(!!easy, 'grade buttons rendered after flip');
      easy.click();
      var back = vz.document.getElementById('session-back');
      assert(!!back, 'Back appears after a graded press');
      back.click();
      assert(!vz.document.getElementById('peek-viz'),
        'peek overlay omits Open Simulation when the reviewed card has no sim');
      assert(!!vz.document.getElementById('peek-resume'),
        'Resume study still present without a visualizer');
      var i;
      for (i = 0; i < 12; i++) {
        VP.visualizers['f' + i] = { draw: function () {} };
      }
      vz.document.getElementById('peek-resume').click();
      vz.document.getElementById('session-back').click();
      var peekViz = vz.document.getElementById('peek-viz');
      assert(!!peekViz, 'peek overlay shows Open Simulation when the reviewed card has a sim');
      assert(peekViz.textContent === 'Open Simulation', 'peek CTA uses the Lab label');
      assert(peekViz.getAttribute('aria-haspopup') === 'dialog',
        'Open Simulation declares it opens a dialog');
      assert(!!peekViz.closest('.viz-open-strip'), 'peek Open Simulation uses the designed strip');
      assert(!peekViz.closest('.session-peek-bar'), 'peek Open Simulation is not in the resume-bar');
      openedViz = [];
      peekViz.click();
      assert(openedViz.length === 1 && openedViz[0] === peekViz.getAttribute('data-viz-open'),
        'peek Open Simulation calls openVisualizerModal with the reviewed card id');
      var closedBeforeResume = closedViz;
      vz.document.getElementById('peek-resume').click();
      assert(closedViz > closedBeforeResume, 'Resume study closes an open visualizer modal');
      assert(!vz.document.getElementById('peek-resume'),
        'Resume returns to the live study card');
    });
  }).then(function () {
    console.log('\nformulas: study flip Open Simulation, no inline canvas');
    var st = loadShipped(true, { views: true });
    var SP = st.sandbox.PGRE;
    var openedStudy = [];
    var si;
    for (si = 0; si < 12; si++) {
      SP.visualizers['f' + si] = { draw: function () {} };
    }
    SP.openVisualizerModal = function (id) { openedStudy.push(id); };
    st.location.hash = '#/formulas';
    ensureView(st, SP.views.formulas.render());
    SP.views.formulas.mount();
    return wait(0).then(function () {
      st.document.getElementById('study-btn').click();
      st.document.getElementById('flip-btn').click();
      assert(!st.document.querySelector('.viz-inline-container'),
        'study flip does not mount inline visualizer');
      assert(!st.document.getElementById('viz-inline-canvas'),
        'study flip does not mount inline canvas');
      var studyViz = st.document.getElementById('study-viz');
      assert(!!studyViz, 'flipped viz card shows Open Simulation');
      assert(studyViz.textContent === 'Open Simulation', 'study CTA uses Open Simulation');
      assert(!!studyViz.closest('#fcard-back'), 'Open Simulation sits on the card back');
      assert(!!studyViz.closest('.viz-open-strip'), 'study Open Simulation uses the designed strip');
      var grades = st.document.querySelectorAll('#fcard-actions [data-grade]');
      assert(grades.length === 4, 'grade row is Again/Hard/Good/Easy only');
      assert(!st.document.querySelector('#fcard-actions [data-viz-open]'),
        'Open Simulation is not in the grade row');
      openedStudy = [];
      studyViz.click();
      assert(openedStudy.length === 1 && openedStudy[0] === studyViz.getAttribute('data-viz-open'),
        'study Open Simulation calls openVisualizerModal');
      assert(!!st.document.getElementById('study-viz') &&
        st.document.querySelectorAll('#fcard-actions [data-grade]').length === 4,
        'Open Simulation click does not grade or leave the card');
    });
  }).then(function () {
    console.log('\nformulas: study flip omits Open Simulation without a sim');
    var nv = loadShipped(true, { views: true });
    var NP = nv.sandbox.PGRE;
    nv.location.hash = '#/formulas';
    ensureView(nv, NP.views.formulas.render());
    NP.views.formulas.mount();
    return wait(0).then(function () {
      nv.document.getElementById('study-btn').click();
      nv.document.getElementById('flip-btn').click();
      assert(!nv.document.getElementById('study-viz'),
        'non-viz study card has no Open Simulation');
      assert(!nv.document.querySelector('#fcard-back .viz-open-strip'),
        'non-viz card back has no simulation strip');
      assert(nv.document.querySelectorAll('#fcard-actions [data-grade]').length === 4,
        'non-viz grade row is still Again/Hard/Good/Easy only');
    });
  }).then(function () {
    console.log('\nformulas: F5 reverse Open Simulation on card back');
    var rv = loadShipped(true, { views: true });
    var RV = rv.sandbox.PGRE;
    RV.store.state.settings.formulaReverse = true;
    var ri;
    for (ri = 0; ri < 12; ri++) {
      RV.visualizers['f' + ri] = { draw: function () {} };
    }
    var openedRev = [];
    RV.openVisualizerModal = function (id) { openedRev.push(id); };
    rv.cards.forEach(function (c) {
      c.back += '<p class="card-key"><strong>Key takeaway</strong></p>' +
        '<ul class="recall-list"><li><strong>Labelled point:</strong> net force</li></ul>';
    });
    rv.location.hash = '#/formulas';
    ensureView(rv, RV.views.formulas.render());
    RV.views.formulas.mount();
    return wait(0).then(function () {
      rv.document.getElementById('study-btn').click();
      var revQ = rv.document.getElementById('fcard-front').textContent;
      assert(/F = \d+ma/.test(revQ), 'Q4 reverse question shows the leading formula, got: ' + revQ);
      assert(revQ.indexOf('Key takeaway') === -1 && revQ.indexOf('Labelled point') === -1,
        'Q4 reverse question drops the takeaway and labelled points, got: ' + revQ);
      rv.document.getElementById('flip-btn').click();
      var revQFlipped = rv.document.getElementById('fcard-front').textContent;
      assert(/F = \d+ma/.test(revQFlipped) && revQFlipped.indexOf('Key takeaway') === -1,
        'Q4 reverse question stays formula-only after the flip, got: ' + revQFlipped);
      var revA = rv.document.getElementById('fcard-back').textContent;
      assert(revA.indexOf('Key takeaway') !== -1 && revA.indexOf('Labelled point') !== -1,
        'Q4 reverse answer face shows the takeaway and labelled points, got: ' + revA);
      var revViz = rv.document.getElementById('study-viz');
      assert(!!revViz, 'F5 reverse flipped viz card shows Open Simulation');
      assert(!!revViz.closest('#fcard-back'), 'F5 reverse Open Simulation sits on the card back');
      assert(!rv.document.querySelector('#fcard-actions [data-viz-open]'),
        'F5 reverse keeps Open Simulation out of the grade row');
      assert(!rv.document.querySelector('.viz-inline-container'),
        'F5 reverse flip does not mount inline visualizer');
      openedRev = [];
      revViz.click();
      assert(openedRev.length === 1 && openedRev[0] === revViz.getAttribute('data-viz-open'),
        'F5 reverse Open Simulation calls openVisualizerModal');
    });
  }).then(function () {
    console.log('\nformulas: search Open Simulation vs Complete view');
    var sr = loadShipped(true, { views: true });
    var RP = sr.sandbox.PGRE;
    RP.srs.isInFormulaDay = function () { return false; };
    RP.visualizers = { f0: { draw: function () {} } };
    vm.runInContext(
      fs.readFileSync(path.join(root, 'js/formula-search.js'), 'utf8'),
      sr.sandbox,
      { filename: 'js/formula-search.js' }
    );
    sr.location.hash = '#/formulas';
    ensureView(sr, RP.views.formulas.render());
    RP.views.formulas.mount();
    return wait(0).then(function () {
      var searchTab = sr.document.querySelector('.flash-tab[data-mode="search"]');
      assert(!!searchTab, 'Search tab rendered');
      searchTab.click();
      var vizBtn = sr.document.querySelector('[data-fs-modal="f0"]');
      var plainBtn = sr.document.querySelector('[data-fs-modal="f1"]');
      assert(!!vizBtn && vizBtn.textContent === 'Open Simulation',
        'search viz card labels Open Simulation');
      assert(vizBtn.getAttribute('aria-haspopup') === 'dialog',
        'search viz CTA declares it opens a dialog');
      assert(!!plainBtn && plainBtn.textContent === 'Complete view',
        'search non-viz card keeps Complete view');
    });
  }).then(function () {
    console.log('\nformulas: Today card studies the shipped auto-pick');
    var tc = autoPickEnv();
    tc.env.location.hash = '#/formulas';
    ensureView(tc.env, tc.P.views.formulas.render());
    tc.P.views.formulas.mount();
    return wait(0).then(function () {
      var doc = tc.env.document;
      var card = doc.querySelector('.fm-landing');
      assert(!!card, 'Today card rendered');
      var study = doc.getElementById('study-btn');
      assert(!!study && study.textContent === 'Study 6 cards',
        'one primary Study button for the auto-pick, got: ' + (study && study.textContent));
      assert(card.textContent.indexOf('3 due reviews + 3 new cards') !== -1,
        'Today line names the due/new mix, got: ' + card.textContent);
      var pick = doc.getElementById('pick-btn');
      assert(!!pick && pick.textContent === 'Choose cards', 'secondary control opens the composer');
      assert(!doc.getElementById('fill-study-btn') && !doc.getElementById('landing-pick-btn'),
        'no second landing control set');
      assert(tc.P.store.state.formulaDay.reviewIds.length === 0 &&
        tc.P.store.state.formulaDay.newIds.length === 0,
        'rendering the suggestion writes nothing to the batch');
      study.click();
      var fd = tc.P.store.state.formulaDay;
      assert(fd.reviewIds.join(',') === 'cpgf-2.3,cpgf-2.1,cpgf-1.2',
        'due reviews first: most overdue, then most lapses, got: ' + fd.reviewIds.join(','));
      assert(fd.newIds.join(',') === 'cpgf-1.1,cpgf-2.2,f0',
        'new cards fill the rest in book (chapter) order, got: ' + fd.newIds.join(','));
      assert(!!doc.getElementById('flip-btn'), 'Study starts on the auto-picked list');
    });
  }).then(function () {
    console.log('\nformulas: composer — draft list, lazy groups, fill, clear, save');
    var cp = autoPickEnv();
    var P = cp.P;
    var savedIds = null;
    var realSet = P.srs.setFormulaDayPicks;
    P.srs.setFormulaDayPicks = function (deck, ids) {
      savedIds = ids.slice();
      return realSet.call(P.srs, deck, ids);
    };
    cp.env.location.hash = '#/formulas';
    ensureView(cp.env, P.views.formulas.render());
    P.views.formulas.mount();
    return wait(0).then(function () {
      var doc = cp.env.document;
      doc.getElementById('pick-btn').click();

      function cartIds() {
        var out = [];
        doc.querySelectorAll('#picker-list .pick-cart-row').forEach(function (r) {
          out.push(r.getAttribute('data-cardid'));
        });
        return out;
      }
      function text(id) { var el = doc.getElementById(id); return el ? el.textContent : null; }

      assert(cartIds().join(',') === 'cpgf-2.3,cpgf-2.1,cpgf-1.2,cpgf-1.1,cpgf-2.2,f0',
        'empty list opens pre-filled with the auto-pick, got: ' + cartIds().join(','));
      assert(!doc.getElementById('picker-note').hidden, 'pre-filled draft says it is a suggestion');
      assert(text('picker-count') === '6 / 6', 'count is list / target, got: ' + text('picker-count'));
      assert(text('picker-mix') === '3 reviews · 3 new',
        'mix line splits reviews and new; an off-list card graded today is not a fixed done row, got: ' + text('picker-mix'));
      assert(text('picker-fill') === 'Add 6 more', 'full list offers another round, got: ' + text('picker-fill'));
      assert(text('picker-study') === 'Study 6 cards', 'Study names the list size');
      assert(savedIds === null && P.store.state.formulaDay.newIds.length === 0,
        'opening the composer persists nothing');

      var groups = doc.querySelectorAll('#picker-groups .picker-topic');
      assert(groups.length === 4 && groups[0].getAttribute('data-group') === 'due',
        'Due now group leads three chapter groups, got ' + groups.length);
      assert(groups[0].querySelector('.picker-ch-count').textContent === '3 cards',
        'Due now meta counts the due cards, got: ' + groups[0].querySelector('.picker-ch-count').textContent);
      var ch1 = doc.querySelector('.picker-topic[data-ch="1"]');
      var ch2 = doc.querySelector('.picker-topic[data-ch="2"]');
      var other = doc.querySelector('.picker-topic[data-ch="other"]');
      assert(ch2.querySelector('.picker-ch-count').textContent === '2 due · 1 new · 4 cards',
        'chapter meta shows due and new counts, got: ' + ch2.querySelector('.picker-ch-count').textContent);
      assert(other.querySelector('.picker-ch-title').textContent === 'Supplements',
        'un-numbered cards group as Supplements');
      assert(doc.querySelectorAll('.picker-row').length === 0, 'groups start collapsed with no rows in the DOM');

      ch2.querySelector('.picker-ch-toggle').click();
      var rows = ch2.querySelectorAll('.picker-row');
      assert(rows.length === 4, 'opening a chapter paints its rows');
      function row(id) {
        var sel = '.picker-row[data-cardid="' + id + '"]';
        return ch1.querySelector(sel) || ch2.querySelector(sel) || other.querySelector(sel);
      }
      assert(row('cpgf-2.1').querySelector('.picker-box').checked && row('cpgf-2.1').classList.contains('is-picked'),
        'a card in the list is ticked');
      assert(!row('cpgf-2.4').querySelector('.picker-box').checked,
        'a learned card outside the list is NOT ticked — one checkbox, one meaning');
      assert(row('cpgf-2.4').querySelector('.picker-meta').textContent.indexOf('due in 5 d') !== -1,
        'row meta carries the schedule status');
      var r24 = row('cpgf-2.4');
      assert(r24.classList.contains('is-scheduled'),
        'a card in the queue with a future due date is marked scheduled');
      assert(r24.querySelector('.picker-status').classList.contains('is-scheduled'),
        'the due-in status reads as a scheduled pill');
      assert(!row('cpgf-2.1').classList.contains('is-scheduled') &&
        !row('cpgf-2.2').classList.contains('is-scheduled'),
        'due-now and new cards are not marked scheduled');
      assert(!r24.hasAttribute('title'), 'picker row no longer carries a native title tooltip');
      // Styled tooltip: delegated document mouseover + delay before paint.
      fireDoc(cp.env, 'mouseover', { target: r24.querySelector('.picker-text') });
      var tipEl = doc.querySelector('.srs-tip');
      assert(!tipEl || !tipEl.classList.contains('is-on'),
        'hover does not flash the tip before the delay');
      cp.env.flushTimeouts(230);
      tipEl = doc.querySelector('.srs-tip');
      assert(tipEl && tipEl.classList.contains('is-on'), 'hover delay shows the styled tip');
      assert(tipEl.textContent.indexOf('due ' + P.srs.addDays(5)) !== -1 &&
        tipEl.textContent.indexOf('ease 2.50') !== -1 &&
        tipEl.textContent.indexOf('lapses 0') !== -1 &&
        tipEl.textContent.indexOf('reps 2') !== -1,
        'tip pills carry the SRS fields, got: ' + tipEl.textContent);
      assert(!!tipEl.querySelector('.srs-tip-pill'), 'stats render as pills, not flat text');
      var r21 = row('cpgf-2.1');
      fireDoc(cp.env, 'mouseover', { target: r21.querySelector('.picker-text') });
      fireDoc(cp.env, 'mouseout', { target: r21, relatedTarget: r24 });
      cp.env.flushTimeouts(0);
      assert(tipEl.textContent.indexOf('due today') !== -1 &&
        tipEl.textContent.indexOf('lapses 2') !== -1 &&
        tipEl.classList.contains('is-on'),
        'sliding to a neighbouring row re-aims the tip, got: ' + tipEl.textContent);
      fireDoc(cp.env, 'mouseout', { target: r24, relatedTarget: doc.body });
      assert(!tipEl.classList.contains('is-on'), 'leaving the rows dismisses the tip');
      // Keyboard focus shows it without the delay.
      fireDoc(cp.env, 'focusin', { target: r21.querySelector('.picker-peek-btn') });
      assert(tipEl.classList.contains('is-on') &&
        tipEl.textContent.indexOf('due today') !== -1,
        'focus inside a row shows the tip at once');
      fireDoc(cp.env, 'focusout', { target: r21, relatedTarget: doc.body });
      assert(!tipEl.classList.contains('is-on'), 'focus leaving the row hides the tip');

      assert(ch2.querySelector('.picker-preview').hidden, 'formula stays hidden until asked for');
      var fbtn = row('cpgf-2.1').querySelector('.picker-peek-btn');
      fbtn.click();
      var prev = ch2.querySelector('.picker-preview');
      assert(!prev.hidden && prev.textContent.indexOf('Phi') !== -1, 'Formula reveals the answer face');
      assert(!!prev.querySelector('.similar-problem-btn'), 'preview carries the similar-problem control');
      assert(row('cpgf-2.1').querySelector('.picker-box').checked, 'Formula does not toggle the pick');

      ch1.querySelector('.picker-ch-toggle').click();
      var lockBox = row('cpgf-1.3').querySelector('.picker-box');
      assert(!lockBox.disabled && !lockBox.checked && !row('cpgf-1.3').classList.contains('is-locked'),
        'an off-list card graded today is selectable; only an in-list grade stays locked');
      assert(cartIds().indexOf('cpgf-1.3') === -1, 'an off-list done card is not inserted on its own');
      var r11 = row('cpgf-1.1'), r13 = row('cpgf-1.3');
      assert(!r11.hasAttribute('title') && !r13.hasAttribute('title'),
        'no row carries a native title tooltip');
      fireDoc(cp.env, 'focusin', { target: r11.querySelector('.picker-box') });
      assert(tipEl.classList.contains('is-on') &&
        tipEl.textContent.indexOf('No grades yet') !== -1,
        'new card tip says it has no grades, got: ' + tipEl.textContent);
      fireDoc(cp.env, 'focusout', { target: r11, relatedTarget: doc.body });
      fireDoc(cp.env, 'focusin', { target: r13.querySelector('.picker-box') });
      var status13 = r13.querySelector('.picker-status');
      assert(tipEl.classList.contains('is-on') &&
        status13 && status13.textContent.indexOf('due in') !== -1 &&
        tipEl.textContent.indexOf('ease ') !== -1 &&
        tipEl.textContent.indexOf('Already graded today') === -1,
        'an off-list card graded today shows its schedule, got: ' +
          (status13 && status13.textContent) + ' / ' + tipEl.textContent);
      fireDoc(cp.env, 'focusout', { target: r13, relatedTarget: doc.body });

      doc.querySelector('#picker-list [data-rm="cpgf-2.1"]').click();
      assert(cartIds().indexOf('cpgf-2.1') === -1 && !row('cpgf-2.1').querySelector('.picker-box').checked,
        'removing from the list unticks the row');
      assert(text('picker-count') === '5 / 6' && text('picker-fill') === 'Fill to 6',
        'count drops and Fill offers to top up, got: ' + text('picker-count') + ' / ' + text('picker-fill'));
      assert(doc.getElementById('picker-note').hidden, 'the suggestion note goes once the user edits');

      row('cpgf-2.4').querySelector('.picker-text').click();
      assert(cartIds()[cartIds().length - 1] === 'cpgf-2.4', 'row click adds to the end of the list');
      var box24 = row('cpgf-2.4').querySelector('.picker-box');
      box24.checked = false;
      fireChange(box24);
      assert(cartIds().indexOf('cpgf-2.4') === -1, 'unticking the box removes it');

      doc.getElementById('picker-clear').click();
      assert(cartIds().length === 0 && text('picker-count') === '0 / 6', 'Clear empties the list');
      assert(doc.getElementById('picker-study').disabled, 'Study is disabled on an empty list');
      doc.getElementById('picker-fill').click();
      assert(cartIds().join(',') === 'cpgf-2.3,cpgf-2.1,cpgf-1.2,cpgf-1.1,cpgf-2.2,f0',
        'Fill re-applies the auto-pick, got: ' + cartIds().join(','));

      var saOther = other.querySelector('.picker-selall-box');
      saOther.checked = true;
      fireChange(saOther);
      assert(text('picker-count') === '17 / 6', 'group All adds every card in the group, got: ' + text('picker-count'));
      saOther.checked = false;
      fireChange(saOther);
      assert(text('picker-count') === '5 / 6', 'group All off removes them again, got: ' + text('picker-count'));

      var filter = doc.getElementById('picker-filter');
      filter.value = 'ampere';
      fireInput(filter);
      assert(groups[0].hidden && ch1.hidden && other.hidden && !ch2.hidden,
        'search keeps only matching groups and drops the Due repeat');
      assert(ch2.querySelectorAll('.picker-row').length === 1, 'search shows only matching rows');
      filter.value = '';
      fireInput(filter);
      assert(!groups[0].hidden && !other.hidden && ch2.querySelectorAll('.picker-row').length === 4,
        'clearing search restores groups and their open state');

      row('cpgf-2.4').querySelector('.picker-text').click();
      doc.getElementById('picker-save').click();
      assert(savedIds && savedIds.join(',') === 'cpgf-2.3,cpgf-2.1,cpgf-1.2,cpgf-1.1,cpgf-2.2,cpgf-2.4',
        'Save writes the list in order, got: ' + (savedIds && savedIds.join(',')));
      var fd = P.store.state.formulaDay;
      assert(fd.softIds && fd.softIds.indexOf('cpgf-2.4') !== -1,
        'a not-yet-due add is soft-pinned so Study still shows it');
      assert(!!doc.querySelector('.fm-landing') && text('study-btn') === 'Study 6 cards',
        'Save returns home with the saved list ready, got: ' + text('study-btn'));
      assert(text('pick-btn') === 'Edit today’s list', 'home now offers to edit the list');
    });
  }).then(function () {
    console.log('\nformulas: composer Cancel drops the draft; Study saves and starts');
    var cx = autoPickEnv();
    var P = cx.P;
    cx.env.location.hash = '#/formulas';
    ensureView(cx.env, P.views.formulas.render());
    P.views.formulas.mount();
    return wait(0).then(function () {
      var doc = cx.env.document;
      doc.getElementById('pick-btn').click();
      doc.getElementById('picker-clear').click();
      doc.getElementById('picker-cancel').click();
      var fd = P.store.state.formulaDay;
      assert(fd.reviewIds.length === 0 && fd.newIds.length === 0, 'Cancel persists nothing');
      assert(!!doc.getElementById('study-btn'), 'Cancel returns to the Today card');
      doc.getElementById('pick-btn').click();
      doc.getElementById('picker-study').click();
      fd = P.store.state.formulaDay;
      assert(fd.reviewIds.length + fd.newIds.length === 6, 'Study saves the draft list');
      assert(!!doc.getElementById('flip-btn'), 'Study starts the session straight from the composer');
    });
  }).then(function () {
    console.log('\nformulas: composer keeps an Again-today card as a fixed row');
    var ag = autoPickEnv();
    var P = ag.P, t = P.srs.today();
    ag.env.cardStates['cpgf-1.3'].due = t;   // graded today, Again: due again today
    P.store.state.formulaDay = { date: t, reviewIds: ['cpgf-1.3'], newIds: [] };
    ag.env.location.hash = '#/formulas';
    ensureView(ag.env, P.views.formulas.render());
    P.views.formulas.mount();
    return wait(0).then(function () {
      var doc = ag.env.document;
      assert(doc.getElementById('study-btn').textContent === 'Study 1 card' &&
        doc.getElementById('pick-btn').textContent === 'Edit today’s list',
        'home studies the remaining Again card, no auto-pick on top');
      doc.getElementById('pick-btn').click();
      var rows = doc.querySelectorAll('#picker-list .pick-cart-row');
      assert(rows.length === 1 && rows[0].classList.contains('is-locked') &&
        !rows[0].querySelector('.pick-cart-rm'),
        'the Again card is a fixed row with no remove control');
      assert(rows[0].textContent.indexOf('again today') !== -1, 'fixed row says it is due again today');
      // The same styled tip serves the right-pane list rows.
      fireDoc(ag.env, 'mouseover', { target: rows[0].querySelector('.pick-cart-text') });
      ag.env.flushTimeouts(230);
      var cartTip = doc.querySelector('.srs-tip');
      assert(cartTip && cartTip.classList.contains('is-on') &&
        cartTip.textContent.indexOf('again today') !== -1,
        'today’s-list row shows the same styled tip, got: ' + (cartTip && cartTip.textContent));
      fireDoc(ag.env, 'mouseout', { target: rows[0], relatedTarget: doc.body });
      assert(doc.getElementById('picker-note').hidden, 'a list with remaining cards is not pre-filled');
      assert(doc.getElementById('picker-count').textContent === '1 / 6' &&
        doc.getElementById('picker-study').textContent === 'Study 1 card',
        'count and Study include the Again card');
      doc.getElementById('picker-fill').click();
      assert(doc.querySelectorAll('#picker-list .pick-cart-row').length === 6,
        'Fill tops up around the fixed row to the target');
      doc.getElementById('picker-clear').click();
      assert(doc.querySelectorAll('#picker-list .pick-cart-row').length === 1,
        'Clear leaves the fixed row in place');
    });
  }).then(function () {
    console.log('\nformulas: resume count follows mid-session list edits');
    var ms = autoPickEnv();
    var P = ms.P;
    ms.env.location.hash = '#/formulas';
    ensureView(ms.env, P.views.formulas.render());
    P.views.formulas.mount();
    return wait(0).then(function () {
      var doc = ms.env.document;
      doc.getElementById('study-btn').click();          // auto-picks 6, starts
      doc.getElementById('flip-btn').click();
      doc.querySelector('#fcard-actions [data-grade="good"]').click();
      // Mid-session: one card leaves the list (unpick), three join it
      // (e.g. search "Add to today" / a late Fill). Before the fix the saved
      // queue stayed frozen and "Resume — N left" no longer counted the list.
      var queued = P.store.state.formulaStudy.queueIds;
      P.srs.addFormulaDaySoft(ms.env.cards, ['f1', 'f2', 'f3']);
      P.srs.setFormulaDayPicks(ms.env.cards,
        queued.filter(function (id) { return id !== 'cpgf-2.3'; })
          .concat(['f1', 'f2', 'f3']));
      var want = P.srs.formulaDayRemaining(ms.env.cards).length;
      P.views.formulas.mount();                         // exit → home re-render
      return wait(0).then(function () {
        var rb = doc.getElementById('resume-btn');
        assert(!!rb && rb.textContent === 'Resume session — ' + want + ' left',
          'resume count matches the edited list, got: ' +
            (rb ? rb.textContent : 'no resume button') + ' vs ' + want);
        assert(P.store.state.formulaStudy.queueIds.indexOf('cpgf-2.3') === -1,
          'a card removed mid-session leaves the saved queue');
        doc.getElementById('pick-btn').click();
        assert(doc.getElementById('picker-count').textContent === want + ' / 6',
          'composer header agrees with resume, got: ' +
            doc.getElementById('picker-count').textContent);
      });
    });
  }).then(function () { return consumerCases(); });
}

/* Lane 2 selection and session-contract checks. Each one fails on the
   pre-fix consumers: a reset study, an off-list Again lock, a stale queue
   grade, a one-choice quiz is covered in test-recall-lists.js. */
function pinDate(box, y, m, d, hh, mm) {
  var env = box && box.sandbox ? box : box.env;
  var Real = env._realDate || env.sandbox.Date;
  env._realDate = Real;
  function D() {
    if (!(this instanceof D)) return new D();
    if (arguments.length === 0) return new Real(y, m - 1, d, hh || 0, mm || 0, 0);
    var args = [null];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    return new (Function.prototype.bind.apply(Real, args));
  }
  D.now = function () { return new Real(y, m - 1, d, hh || 0, mm || 0, 0).getTime(); };
  D.parse = Real.parse;
  D.UTC = Real.UTC;
  D.prototype = Real.prototype;
  env.sandbox.Date = D;
  if (env.sandbox.window) env.sandbox.window.Date = D;
}

function mountFormulas(box) {
  box.env.location.hash = '#/formulas';
  ensureView(box.env, box.P.views.formulas.render());
  box.P.views.formulas.mount();
  return wait(0);
}

function consumerCases() {
  console.log('\nformulas: lane 2 consumers');
  var introduced = autoPickEnv();
  return mountFormulas(introduced).then(function () {
    var doc = introduced.env.document;
    var P = introduced.P;
    var word = doc.querySelector('.fr-usage-word');
    assert(word && word.textContent === 'introduced',
      'recall band says introduced, got: ' + (word && word.textContent));
    var band = doc.querySelector('.formula-recall-band');
    assert(band && band.getAttribute('aria-label').indexOf('0 of ') !== -1 &&
      band.getAttribute('aria-label').indexOf('introduced') !== -1,
      'two-or-more new cards with no reviews read 0 introduced, got: ' +
        (band && band.getAttribute('aria-label')));
    P.store.state.cards['cpgf-1.1'] = P.store.state.cards['cpgf-1.1'] || {};
    P.store.state.cards['cpgf-1.1'].reviews = 1;
    P.views.formulas.mount();
    return wait(0);
  }).then(function () {
    var band = introduced.env.document.querySelector('.formula-recall-band');
    assert(band && /1 of \d+ introduced/.test(band.getAttribute('aria-label')),
      'one reviewed card counts as 1 introduced, got: ' +
        (band && band.getAttribute('aria-label')));
    var toggle = introduced.env.document.getElementById('exam-cap-toggle');
    toggle.click();
    toggle = introduced.env.document.getElementById('exam-cap-toggle');
    assert(toggle && toggle.textContent === 'Uncapped',
      'cap-off label, got: ' + (toggle && toggle.textContent));
    assert(introduced.env.document.body.textContent.indexOf('1-day intervals') === -1,
      'the options no longer mention 1-day intervals');

    console.log('\nformulas: session stamps, refused grade, duplicate queue');
    var sess = autoPickEnv();
    var stepped = null;
    var t = sess.P.srs.today();
    sess.P.store.state.formulaDay = { date: t, reviewIds: [], newIds: ['f0', 'f1'] };
    return mountFormulas(sess).then(function () {
      var doc = sess.env.document;
      doc.getElementById('study-btn').click();
      var saved = sess.P.store.state.formulaStudy;
      assert(saved && saved.id && saved._opAt && saved._opId &&
        saved.completed === false && typeof saved.done === 'number' &&
        typeof saved.pressCount === 'number',
        'an open session stamps id, _opAt, _opId, done, pressCount, completed false');
      stepped = saved.queueIds[0];
      doc.getElementById('flip-btn').click();
      doc.querySelector('#fcard-actions [data-grade="good"]').click();
      saved = sess.P.store.state.formulaStudy;
      assert(saved.history && saved.history[0] && saved.history[0].day === t,
        'a press records its local day, got: ' + (saved.history && saved.history[0] && saved.history[0].day));
      assert(saved.steps && saved.steps[stepped] === 1 && saved.pressCount === 1,
        'a new card Good is a learning step, not a reset');
      sess.P.views.formulas.armStudyFromFill();
      sess.P.views.formulas.mount();
      return wait(0);
    }).then(function () {
      var doc = sess.env.document;
      var saved = sess.P.store.state.formulaStudy;
      assert(saved && saved.pressCount === 1 && saved.steps && saved.steps[stepped] === 1,
        'dashboard Study resumes the same-day session instead of resetting it');
      var refused = autoPickEnv();
      var rt = refused.P.srs.today();
      refused.P.store.state.formulaDay = { date: rt, reviewIds: ['cpgf-1.2'], newIds: ['f0'] };
      return mountFormulas(refused).then(function () {
        var rdoc = refused.env.document;
        rdoc.getElementById('study-btn').click();
        var front = refused.P.store.state.formulaStudy.queueIds[0];
        var before = refused.P.store.state.cardReviews.length;
        refused.P.store.state._persistFailed = true;
        rdoc.getElementById('flip-btn').click();
        rdoc.querySelector('#fcard-actions [data-grade="easy"]').click();
        assert(refused.P.store.state.cardReviews.length === before,
          'a refused grade writes no review');
        assert(refused.P.store.state.formulaStudy.queueIds[0] === front &&
          refused.P.store.state.formulaStudy.done === 0,
          'a refused grade leaves the queue and the done count');
        var dup = autoPickEnv();
        var dt = dup.P.srs.today();
        dup.P.store.state.formulaDay = { date: dt, reviewIds: [], newIds: ['f0'] };
        dup.P.store.state.formulaStudy = {
          id: 'dup', date: dt, dayBound: true, queueIds: ['f0', 'f0'],
          done: 0, pressCount: 0, steps: {}, history: [], completed: false,
          _opAt: 1, _opId: 'dup'
        };
        return mountFormulas(dup).then(function () {
          var ddoc = dup.env.document;
          ddoc.getElementById('resume-btn').click();
          ddoc.getElementById('flip-btn').click();
          ddoc.querySelector('#fcard-actions [data-grade="easy"]').click();
          var rows = dup.P.store.state.cardReviews.filter(function (r) { return r.id === 'f0'; });
          assert(rows.length === 1, 'a duplicated queue id is graded once, got ' + rows.length);
        });
      });
    });
  }).then(function () {
    console.log('\nformulas: off-list Again, stale queue, overdue add, readiness');
    var ag = autoPickEnv();
    var P = ag.P, t = P.srs.today();
    P.store.state.cards['cpgf-2.4'].due = t;
    P.store.state.cards['cpgf-2.4'].lastReviewedDay = t;
    P.store.state.formulaDay = { date: t, reviewIds: ['cpgf-1.3'], newIds: [] };
    return mountFormulas(ag).then(function () {
      var doc = ag.env.document;
      doc.getElementById('pick-btn').click();
      doc.querySelector('.picker-topic[data-ch="2"] .picker-ch-toggle').click();
      var box = doc.querySelector('.picker-row[data-cardid="cpgf-2.4"] .picker-box');
      assert(box && !box.disabled, 'an off-list Again is selectable');
      box.checked = true;
      fireChange(box);
      doc.getElementById('picker-save').click();
      var ids = P.store.state.formulaDay.reviewIds;
      assert(ids.indexOf('cpgf-2.4') !== -1, 'saving the draft adds the off-list Again');
      assert(P.srs.formulaDayRemaining(ag.env.cards).some(function (c) { return c.id === 'cpgf-2.4'; }),
        'that Again is studyable the same day');
      doc.querySelector('.picker-topic[data-ch="1"]') || null;
      var stale = autoPickEnv();
      var st = stale.P.srs.today();
      stale.P.store.state.formulaDay = { date: st, reviewIds: ['cpgf-1.2'], newIds: ['f0'] };
      return mountFormulas(stale).then(function () {
        var sdoc = stale.env.document;
        sdoc.getElementById('study-btn').click();
        var front = stale.P.store.state.formulaStudy.queueIds[0];
        var keep = stale.P.store.state.formulaStudy.queueIds.filter(function (id) { return id !== front; });
        stale.P.srs.setFormulaDayPicks(stale.env.cards, keep);
        var before = stale.P.store.state.cardReviews.length;
        sdoc.getElementById('flip-btn').click();
        sdoc.querySelector('#fcard-actions [data-grade="easy"]').click();
        assert(stale.P.store.state.cardReviews.length === before,
          'a card removed from the list is not graded');
        assert(stale.P.store.state.formulaStudy.queueIds[0] !== front,
          'the live queue drops the card that left the list');
        var late = autoPickEnv();
        var lt = late.P.srs.today();
        late.P.store.state.settings.formulaDailyTarget = 1;
        late.P.store.state.settings.examDate = '2026-11-01';
        late.P.store.state.formulaDay = { date: lt, reviewIds: [], newIds: ['f0'] };
        return mountFormulas(late).then(function () {
          var ldoc = late.env.document;
          var ready = ldoc.getElementById('formula-readiness');
          assert(ready && ready.textContent.indexOf('not yet introduced') !== -1 &&
            ready.textContent.indexOf('to the exam') !== -1 &&
            ready.textContent.indexOf('final week') === -1,
            'home shows a read-only unseen-card warning, got: ' + (ready && ready.textContent));
          ldoc.getElementById('readiness-choose').click();
          assert(!!ldoc.getElementById('picker-study'), 'the warning opens the picker');
          ldoc.getElementById('picker-cancel').click();
          var add = ldoc.getElementById('add-overdue-btn');
          assert(!!add && ldoc.body.textContent.indexOf('Oldest overdue:') !== -1,
            'a full list of new picks shows the oldest overdue age and Add');
          add.click();
          var batch = late.P.store.state.formulaDay;
          assert(batch.newIds.indexOf('f0') !== -1 && batch.reviewIds.indexOf('cpgf-2.3') !== -1,
            'Add overdue appends the overdue card and keeps the new pick, got ' +
              JSON.stringify(batch));
        });
      });
    });
  }).then(function () {
    console.log('\nformulas: ad-hoc replace, partial hold, midnight, check-in day, match');
    var ad = autoPickEnv();
    var t = ad.P.srs.today();
    ad.P.store.state.formulaStudy = {
      id: 'adhoc-1', date: t, dayBound: false, queueIds: ['f0'],
      done: 0, pressCount: 3, steps: { f0: 1 }, history: [],
      completed: false, _opAt: Date.now(), _opId: 'adhoc'
    };
    ad.P.views.formulas.armStudyFromFill();
    return mountFormulas(ad).then(function () {
      var doc = ad.env.document;
      assert(!!doc.getElementById('resume-btn') && !!doc.getElementById('replace-daily-btn'),
        'an ad-hoc session offers resume and an explicit replace');
      assert(ad.P.store.state.formulaStudy.id === 'adhoc-1',
        'opening Study from the dashboard does not replace the ad-hoc session');
      doc.getElementById('replace-daily-btn').click();
      assert(ad.P.store.state.formulaStudy.id !== 'adhoc-1' &&
        ad.P.store.state.formulaStudy.dayBound !== false,
        'Replace starts a new day-bound session');
      var hold = autoPickEnv();
      var ht = hold.P.srs.today();
      hold.P.store.state.formulaStudy = {
        id: 'hold', date: ht, dayBound: true,
        queueIds: ['cpgf-1.1', 'missing-card'], done: 2, pressCount: 2,
        history: [], steps: {}, completed: false, _opAt: 5, _opId: 'hold'
      };
      var realDeck = hold.P.formulaDeck;
      hold.P.formulaDeck = function () {
        return realDeck().then(function (d) {
          hold.P.formulaDeckStatus = {
            sources: ['book'], missing: ['bookLists'], partial: true, complete: false
          };
          return d;
        });
      };
      return mountFormulas(hold).then(function () {
        var saved = hold.P.store.state.formulaStudy;
        assert(saved && saved.queueIds.indexOf('missing-card') !== -1,
          'a partial deck does not drop a saved queue id');
        assert(hold.env.document.body.textContent.indexOf('incomplete') !== -1,
          'a partial deck shows a waiting note');
        var night = autoPickEnv();
        // 02:59 is still October 24: the scheduling day starts at 03:00.
        pinDate(night, 2026, 10, 25, 2, 59);
        var day = night.P.srs.today();
        assert(day === '2026-10-24', '02:59 counts as the day before, got ' + day);
        night.P.store.state.settings.examDate = '2026-11-01';
        night.P.store.state.formulaDay = { date: day, reviewIds: [], newIds: ['f0'] };
        // A learned card due October 28, three days after the day change.
        night.env.cardStates['cpgf-2.4'].due = '2026-10-28';
        return mountFormulas(night).then(function () {
          var ndoc = night.env.document;
          ndoc.getElementById('study-btn').click();
          pinDate(night, 2026, 10, 25, 3, 1);
          ndoc.getElementById('flip-btn').click();
          ndoc.querySelector('#fcard-actions [data-grade="easy"]').click();
          var batch = night.P.store.state.formulaDay;
          var queued = (night.P.store.state.formulaStudy && night.P.store.state.formulaStudy.queueIds) || [];
          assert(batch.reviewIds.indexOf('cpgf-2.4') === -1,
            'a week before the exam the day change does not add a learned card that is not due');
          assert(queued.indexOf('cpgf-2.4') === -1,
            'the open session does not take that card in, got ' + queued.join(','));
          var seen = [];
          var ck = autoPickEnv();
          pinDate(ck, 2026, 10, 24, 12, 0);
          var ct = ck.P.srs.today();
          ck.P.store.state.formulaDay = { date: ct, reviewIds: ['cpgf-1.2', 'cpgf-2.1'], newIds: [] };
          return mountFormulas(ck).then(function () {
            var cdoc = ck.env.document;
            cdoc.getElementById('study-btn').click();
            var graded = ck.P.store.state.formulaStudy.queueIds[0];
            cdoc.getElementById('flip-btn').click();
            cdoc.querySelector('#fcard-actions [data-grade="good"]').click();
            ck.P.formulaCheckIn.record = function (day) {
              seen.push(day);
              return { claimed: true, day: day };
            };
            pinDate(ck, 2026, 10, 25, 8, 0);
            ck.env.location.hash = '#/';
            (ck.env.window.listeners.hashchange || []).forEach(function (fn) { fn(); });
            assert(seen.length === 1 && seen[0] === '2026-10-24',
              'check-in uses the press day, got ' + JSON.stringify(seen));
            var receipt = ck.P.views.formulas.buildFormulaReceipt('today');
            var ids = (receipt.recalled || receipt.recalledToday || []).map(function (c) { return c.id; });
            if (!ids.length && receipt.formulas) ids = receipt.formulas.map(function (c) { return c.id; });
            assert(ids.indexOf(graded) === -1,
              'a press from yesterday is not recalled today, got ' + JSON.stringify(receipt).slice(0, 240));
            var match = autoPickEnv();
            var mt = match.P.srs.today();
            match.P.store.state.formulaDay = { date: mt, reviewIds: [], newIds: ['f0', 'f1'] };
            var grades = 0;
            var records = 0;
            var orig = match.P.srs.gradeCard;
            match.P.srs.gradeCard = function () { grades++; return orig.apply(match.P.srs, arguments); };
            match.P.formulaCheckIn.record = function () { records++; return { claimed: true }; };
            var reviewsBefore = match.P.store.state.cardReviews.length;
            return mountFormulas(match).then(function () {
              var mdoc = match.env.document;
              mdoc.querySelector('.flash-tab[data-mode="match"]').click();
              assert(mdoc.body.textContent.indexOf('does not record a Good') !== -1,
                'Match intro says the round does not record a Good');
              mdoc.getElementById('game-start').click();
              assert(!!mdoc.getElementById('match-practice-note'), 'Match HUD says practice only');
              function pair(promptText) {
                var tiles = mdoc.querySelectorAll('.flash-tile');
                var prompt = null, formula = null;
                for (var i = 0; i < tiles.length; i++) {
                  var body = tiles[i].textContent;
                  if (body.indexOf(promptText) !== -1 && body.indexOf('Prompt') !== -1) prompt = tiles[i];
                }
                var num = promptText.replace('Prompt ', '');
                var needle = 'F = ' + (Number(num) + 2);
                for (var j = 0; j < tiles.length; j++) {
                  if (tiles[j].textContent.indexOf(needle) !== -1) formula = tiles[j];
                }
                if (prompt) prompt.click();
                if (formula) formula.click();
              }
              pair('Prompt 0');
              pair('Prompt 1');
              assert(grades === 0 && records === 0 &&
                match.P.store.state.cardReviews.length === reviewsBefore,
                'finishing Match does not grade or check in');
              assert(mdoc.body.textContent.indexOf('does not record a Good') !== -1,
                'Match finish repeats the practice-only line');
              match.env.cards.push({
                id: 'constructor', topic: 'cm', name: 'Ctor', tag: 'Dielectrics',
                front: 'Polarization prompt', back: '$$P$$', note: '', aliases: []
              });
              var tag = autoPickEnv();
              tag.env.cards.push({
                id: 'die-1', topic: 'cm', name: 'Polarization', tag: 'Dielectrics',
                front: 'A prompt', back: '$$P$$', eq: '2.56', note: '', aliases: []
              });
              return mountFormulas(tag).then(function () {
                var tdoc = tag.env.document;
                tdoc.querySelector('.browse-tab[data-btab="upcoming"]').click();
                tag.env.cards.push({
                  id: 'constructor', topic: 'cm', name: 'Ctor',
                  front: 'ctor prompt', back: '$$C$$', note: '', aliases: []
                });
                tag.P.views.formulas.mount();
                return wait(0).then(function () {
                  tdoc.querySelector('.browse-tab[data-btab="upcoming"]').click();
                  var btn = tdoc.querySelector('.browse-batch-btn[data-bid="constructor"]');
                  assert(btn && btn.getAttribute('data-batch') === 'add',
                    'id constructor is not treated as already in the batch, got ' +
                      (btn && btn.getAttribute('data-batch')));
                  tdoc.getElementById('pick-btn').click();
                  var filter = tdoc.getElementById('picker-filter');
                  filter.value = 'dielectrics';
                  fireInput(filter);
                  var row = tdoc.querySelector('.picker-row[data-cardid="die-1"]');
                  assert(!!row, 'composer search finds a card by its section tag');
                });
              });
            });
          });
        });
      });
    });
  }).then(function () {
    console.log('\nformulas: composer Study keeps an ad-hoc session');
    var comp = autoPickEnv();
    var ct = comp.P.srs.today();
    comp.P.store.state.formulaStudy = {
      id: 'search-1', date: ct, dayBound: false, queueIds: ['f0'],
      done: 0, pressCount: 1, steps: { f0: 1 }, history: [],
      completed: false, _opAt: Date.now(), _opId: 'search'
    };
    return mountFormulas(comp).then(function () {
      var doc = comp.env.document;
      doc.getElementById('pick-btn').click();
      doc.getElementById('picker-study').click();
      var saved = comp.P.store.state.formulaStudy;
      assert(saved && saved.id === 'search-1' && saved.dayBound === false &&
        saved.steps && saved.steps.f0 === 1 &&
        saved.queueIds && saved.queueIds[0] === 'f0',
        'composer Study leaves the ad-hoc session and its learning step, got ' +
          JSON.stringify(saved && { id: saved.id, dayBound: saved.dayBound, steps: saved.steps, queueIds: saved.queueIds }));
      assert(!!doc.getElementById('resume-btn') && !!doc.getElementById('replace-daily-btn') &&
        !doc.getElementById('flip-btn'),
        'composer Study returns to Resume and Replace');
      var bound = autoPickEnv();
      var bt = bound.P.srs.today();
      bound.P.store.state.formulaDay = { date: bt, reviewIds: ['cpgf-1.2'], newIds: [] };
      bound.P.store.state.formulaStudy = {
        id: 'day-1', date: bt, dayBound: true, queueIds: ['cpgf-1.2'],
        done: 0, pressCount: 2, steps: { 'cpgf-1.2': 1 }, history: [],
        completed: false, _opAt: 3, _opId: 'day'
      };
      return mountFormulas(bound).then(function () {
        var bdoc = bound.env.document;
        bdoc.getElementById('pick-btn').click();
        bdoc.getElementById('picker-study').click();
        var daySaved = bound.P.store.state.formulaStudy;
        assert(daySaved && daySaved.id === 'day-1' &&
          daySaved.steps && daySaved.steps['cpgf-1.2'] === 1,
          'composer Study resumes a day-bound session with its step, got ' +
            JSON.stringify(daySaved && { id: daySaved.id, steps: daySaved.steps }));
        assert(!!bdoc.getElementById('flip-btn'),
          'the resumed day-bound session stays on the card');
      });
    });
  }).then(function () {
    console.log('\nformulas: recall band segments hint and navigate');
    var band = autoPickEnv();
    var BP = band.P, t0 = BP.srs.today();
    // recallMix: selected = reviews > 0; solid = interval >= matureDays()
    // (21 when examDate is unset, as in autoPickEnv).
    band.env.cardStates['cpgf-2.3'] = { due: BP.srs.addDays(30), interval: 30, reps: 5, reviews: 5, lapses: 0, lastReviewedDay: t0 };
    band.env.cardStates['cpgf-1.2'] = { due: t0, interval: 2, reps: 2, reviews: 2, lapses: 0, lastReviewedDay: t0 };
    // A saved state with reviews 0 (the normalizeRecallState repair shape):
    // introduced means reviews > 0, so this counts in the rest segment only.
    band.env.cardStates['cpgf-2.2'] = { due: t0, interval: 0, reps: 0, reviews: 0, lapses: 0, lastReviewedDay: t0 };
    vm.runInContext(fs.readFileSync(path.join(root, 'js/formula-search.js'), 'utf8'),
      band.env.sandbox, { filename: 'js/formula-search.js' });
    BP.store.state.formulaDay = { date: t0, reviewIds: [], newIds: [] };
    return mountFormulas(band).then(function () {
      var doc = band.env.document;
      var solidSeg = doc.querySelector('.fr-seg-solid');
      var youngSeg = doc.querySelector('.fr-seg-young');
      var restSeg = doc.querySelector('.fr-seg-rest');
      assert(!!solidSeg && !!youngSeg && !!restSeg,
        'recall band renders its three segments');
      var solidTip = solidSeg.getAttribute('data-tip') || '';
      assert(solidTip.indexOf('≥ ' + BP.srs.matureDays() + ' d') !== -1,
        'solid tooltip names the live threshold, got: ' + solidTip);
      assert(solidSeg.getAttribute('tabindex') === '0' && restSeg.getAttribute('tabindex') === '0',
        'labelled and unlabelled segments are focusable');
      assert(solidSeg.getAttribute('role') === 'button' &&
        (solidSeg.getAttribute('aria-label') || '').indexOf('Solid enough') === 0 &&
        (restSeg.getAttribute('aria-label') || '').indexOf('Not yet introduced') === 0,
        'segments carry button role and aria-labels');
      var hint = doc.getElementById('fr-seg-hint');
      assert(!!hint && hint.hidden === true, 'click hint starts hidden');
      solidSeg.click();
      assert(hint.hidden === false && hint.textContent.indexOf('double-click') !== -1,
        'single click shows the double-click hint, got: ' + hint.textContent);
      assert(!!doc.getElementById('study-btn'), 'a single click does not navigate');
      dispatchEl(solidSeg, 'dblclick');
      assert(doc.querySelector('.flash-tab[data-mode="search"]').classList.contains('active') &&
        !!doc.getElementById('fs-input'),
        'double-click switches to the Search tab');
      var matureOpt = doc.querySelector('#fs-status-sel option[value="mature"]');
      assert(!!matureOpt && matureOpt.getAttribute('selected') !== null,
        'double-click on Solid enough filters status:mature');
      assert((matureOpt.textContent || '').indexOf('≥ ' + BP.srs.matureDays() + ' d') !== -1,
        'search mature chip names the live threshold, got: ' + matureOpt.textContent);
      assert(doc.getElementById('fs-status').textContent.indexOf('1') !== -1,
        'the mature filter lists the one solid card, status line: ' +
          (doc.getElementById('fs-status') || {}).textContent);
      doc.querySelector('.flash-tab[data-mode="study"]').click();
      var rest2 = doc.querySelector('.fr-seg-rest');
      assert(!!rest2, 'back on Study the band rest segment is there');
      dispatchKeydown(band.env, { key: 'Enter', target: rest2 });
      var newOpt = doc.querySelector('#fs-status-sel option[value="new"]');
      assert(doc.querySelector('.flash-tab[data-mode="search"]').classList.contains('active') &&
        !!newOpt && newOpt.getAttribute('selected') !== null,
        'Enter on the rest segment opens Search filtered to not-yet-introduced');
      function listedIds() {
        return [].map.call(doc.querySelectorAll('.fs-card[data-fsid]'),
          function (el) { return el.getAttribute('data-fsid'); });
      }
      var newIds = listedIds();
      var restN = parseInt(/:\s*(\d+)\s*of/.exec(
        rest2.getAttribute('aria-label'))[1], 10);
      assert(newIds.indexOf('cpgf-2.2') !== -1,
        'a saved state with reviews 0 lists under not-yet-introduced, got: ' + newIds.join(','));
      assert(newIds.length === restN,
        'the not-yet-introduced list length equals the rest segment count, list ' +
          newIds.length + ' vs segment ' + restN);
      doc.querySelector('.flash-tab[data-mode="study"]').click();
      var young2 = doc.querySelector('.fr-seg-young');
      assert(!!young2, 'back on Study the band Learning segment is there');
      var youngN = parseInt(/:\s*(\d+)\s*of/.exec(
        young2.getAttribute('aria-label'))[1], 10);
      dispatchEl(young2, 'dblclick');
      var youngOpt = doc.querySelector('#fs-status-sel option[value="young"]');
      assert(doc.querySelector('.flash-tab[data-mode="search"]').classList.contains('active') &&
        !!youngOpt && youngOpt.getAttribute('selected') !== null,
        'double-click on Learning opens Search filtered to status:young');
      var youngIds = listedIds();
      assert(youngIds.indexOf('cpgf-2.2') === -1,
        'a saved state with reviews 0 is absent from the Learning list, got: ' +
          youngIds.join(','));
      assert(youngIds.length === youngN,
        'the Learning list length equals the Learning segment count, list ' +
          youngIds.length + ' vs segment ' + youngN);
    });
  }).then(function () {
    console.log('\nformulas: partial deck warns when every loaded card is introduced');
    var part = autoPickEnv();
    var pt = part.P.srs.today();
    part.env.cards.forEach(function (c) {
      if (!part.env.cardStates[c.id]) {
        part.env.cardStates[c.id] = {
          due: part.P.srs.addDays(4), interval: 4, ease: 2.5, reps: 2,
          lapses: 0, reviews: 1, lastReviewedDay: part.P.srs.addDays(-4)
        };
      }
    });
    part.P.store.state.formulaDay = { date: pt, reviewIds: [], newIds: [] };
    part.P.store.state.formulaStudy = null;
    var fills = 0;
    var origFill = part.P.srs.autoFillFormulaDay;
    part.P.srs.autoFillFormulaDay = function () {
      fills++;
      return origFill.apply(part.P.srs, arguments);
    };
    var realDeck = part.P.formulaDeck;
    part.P.formulaDeck = function () {
      return realDeck().then(function (d) {
        part.P.formulaDeckStatus = {
          sources: ['book'], missing: ['bookLists'], partial: true, complete: false
        };
        return d;
      });
    };
    return mountFormulas(part).then(function () {
      var ready = part.env.document.getElementById('formula-readiness');
      var batch = part.P.store.state.formulaDay;
      assert(ready && ready.textContent.indexOf('incomplete') !== -1 &&
        ready.textContent.indexOf('bookLists') !== -1,
        'a partial deck warns when unseen is 0, got: ' + (ready && ready.textContent));
      assert(!part.env.document.getElementById('deck-hold'),
        'the warning shows when no session is held');
      assert(batch.reviewIds.length === 0 && batch.newIds.length === 0 && fills === 0,
        'the warning does not add daily cards, got ' + JSON.stringify(batch) + ' fills ' + fills);
    });
  }).then(function () {
    console.log('\nformulas: card review history lists dates and grades');
    var hx = autoPickEnv();
    var P = hx.P;
    P.store.state.cardReviews = [
      { d: '2026-08-01', id: 'cpgf-2.1', g: 'again' },
      { d: '2026-09-01', id: 'cpgf-2.1', g: 'hard' },
      { d: '2026-09-15', id: 'cpgf-2.1', g: 'good' },
      { d: '2026-09-15', id: 'cpgf-2.3', g: 'easy' }
    ];
    vm.runInContext(fs.readFileSync(path.join(root, 'js/formula-search.js'), 'utf8'),
      hx.env.sandbox, { filename: 'js/formula-search.js' });
    return mountFormulas(hx).then(function () {
      var doc = hx.env.document;
      doc.querySelector('.flash-tab[data-mode="search"]').click();
      return wait(0).then(function () {
        var art = doc.querySelector('.fs-card[data-fsid="cpgf-2.1"]');
        assert(!!art, 'search lists cpgf-2.1');
        var wrap = art && art.querySelector('.card-review-hist-wrap');
        assert(!!wrap && wrap.hidden, 'search history stays hidden until Show formula');
        art.querySelector('.fs-flip').click();
        assert(!wrap.hidden, 'search history appears after Show formula');
        var hist = art.querySelector('.card-review-hist');
        assert(!!hist, 'search card shows review history after reveal');
        var items = [].map.call((hist && hist.querySelectorAll('li')) || [], function (li) {
          return li.textContent.replace(/\s+/g, ' ').trim();
        });
        assert(items.length === 3, 'only this card’s three reviews, got ' + items.length);
        assert(items[0].indexOf('2026-09-15') !== -1 && items[0].indexOf('Good') !== -1,
          'newest first: first row is 2026-09-15 Good, got ' + items[0]);
        assert(items[1].indexOf('2026-09-01') !== -1 && items[1].indexOf('Hard') !== -1,
          'second row is 2026-09-01 Hard, got ' + items[1]);
        assert(items[2].indexOf('2026-08-01') !== -1 && items[2].indexOf('Again') !== -1,
          'third row is 2026-08-01 Again, got ' + items[2]);
        assert(hist.textContent.indexOf('Newest first') !== -1,
          'the list says newest first');
        var emptyArt = doc.querySelector('.fs-card[data-fsid="cpgf-2.2"]');
        var emptyWrap = emptyArt && emptyArt.querySelector('.card-review-hist-wrap');
        assert(!!emptyWrap && emptyWrap.hidden,
          'empty-card history stays hidden until Show formula');
        emptyArt.querySelector('.fs-flip').click();
        assert(!emptyWrap.hidden, 'empty-card history appears after Show formula');
        var empty = emptyArt.querySelector('.card-review-hist');
        assert(empty && empty.textContent.indexOf('No reviews recorded') !== -1 &&
          empty.textContent.indexOf('cannot be recovered') !== -1,
          'a card with no log shows the empty line, got: ' + (empty && empty.textContent));
        var emptyItems = empty && empty.querySelectorAll('li');
        assert(emptyItems && emptyItems.length === 0,
          'the empty card has no list rows');
        doc.querySelector('.flash-tab[data-mode="study"]').click();
        doc.getElementById('study-btn').click();
        var liveId = (P.store.state.formulaStudy && P.store.state.formulaStudy.queueIds || [])[0];
        var liveWrap = doc.querySelector('.card-review-hist-wrap');
        assert(!!liveWrap && liveWrap.hidden,
          'study history stays hidden until Show answer');
        doc.getElementById('flip-btn').click();
        assert(!liveWrap.hidden, 'study history appears after Show answer');
        var live = doc.querySelector('.card-review-hist');
        assert(!!live, 'study card shows review history after reveal');
        assert(live.getAttribute('data-card-hist') === liveId,
          'study history is for the live card, got ' + live.getAttribute('data-card-hist'));
      });
    });
  });
}

/* A formulas env running the SHIPPED js/srs.js (auto-pick, setFormulaDayPicks)
   over the harness store. Deck: f0-f11 (no chapter) + book cards in two
   chapters. Target 6. Due: cpgf-2.3 (3 days late), cpgf-2.1 (today, 2
   lapses), cpgf-1.2 (today). cpgf-2.4 due in 5 days. cpgf-1.3 graded today. */
function autoPickEnv() {
  var env = loadShipped(true, { views: true });
  vm.runInContext(fs.readFileSync(path.join(root, 'js/srs.js'), 'utf8'), env.sandbox,
    { filename: 'js/srs.js' });
  var P = env.sandbox.PGRE;
  var srs = P.srs;
  var t = srs.today();
  function add(id, name, back) {
    env.cards.push({ id: id, topic: 'cm', name: name, front: name + ' prompt', back: back, note: '', aliases: [] });
  }
  add('cpgf-2.1', 'Gauss', '$$\\Phi = Q/\\epsilon_0$$');
  add('cpgf-2.2', 'Ampere', '$$\\oint B = \\mu_0 I$$');
  add('cpgf-2.3', 'Faraday', '$$\\mathcal{E} = -d\\Phi/dt$$');
  add('cpgf-2.4', 'Lenz', '$$\\mathcal{E} = -L\\,dI/dt$$');
  add('cpgf-1.1', 'Newton', '$$F = ma$$');
  add('cpgf-1.2', 'Kinematics', '$$v = v_0 + at$$');
  add('cpgf-1.3', 'Energy', '$$K = mv^2/2$$');
  var old = srs.addDays(-5);
  env.cardStates['cpgf-2.3'] = { due: srs.addDays(-3), interval: 4, ease: 2.5, reps: 2, lapses: 0, lastReviewedDay: old };
  env.cardStates['cpgf-2.1'] = { due: t, interval: 2, ease: 2.2, reps: 3, lapses: 2, lastReviewedDay: old };
  env.cardStates['cpgf-1.2'] = { due: t, interval: 2, ease: 2.5, reps: 2, lapses: 0, lastReviewedDay: old };
  env.cardStates['cpgf-2.4'] = { due: srs.addDays(5), interval: 6, ease: 2.5, reps: 2, lapses: 0, lastReviewedDay: old };
  env.cardStates['cpgf-1.3'] = { due: srs.addDays(1), interval: 1, ease: 2.5, reps: 1, lapses: 0, lastReviewedDay: t };
  P.store.state.settings.formulaDailyTarget = 6;
  P.store.state.formulaDay = null;
  P.srs.buildMemHistory = function () { return null; };
  return { env: env, P: P };
}

runAsync().then(function () {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
  console.log('ALL OK');
}).catch(function (err) {
  console.error('FAIL — uncaught: ' + (err && err.stack ? err.stack : err));
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(1);
});
