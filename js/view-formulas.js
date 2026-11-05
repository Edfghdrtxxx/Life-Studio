/* Recall — five tabs on one portal, chosen with the top tab bar (round-2
   layout, design §5–§6):
   • Review   — the daily queue: due reviews in batches of 10, most overdue
     first; new cards only after the due cards are done (decision D2).
   • Browse   — find a card by the words in its front, back or note, across
     every subject; result rows open a peek and can join today's batch.
   • Cards    — the card editor: write and edit the student's own cards in
     any subject (PGRE.userCardOps, js/user-cards.js).
   • Progress — memory horizon by subject, retention by month, the forecast,
     and the recall settings.
   • Practice — Match / Type / Quiz / Cloze against the deck.
   The Match/Type/Quiz/Cloze game logic lives in js/flashmodes.js and the
   browse matching in js/formula-search.js; this file owns the tabs, the
   Study flow, and loading both helpers on demand. */
window.PGRE = window.PGRE || {};
PGRE.views = PGRE.views || {};

PGRE.views.formulas = (function () {
  var deck = [];
  var mode = 'study';
  // Study session: { queue, total, done, again, xp, flipped, history, peek,
  //   overlay: null|'peek'|'scaffold'|'checkpoint', steps: {id->learningStep},
  //   undo: [snapshots], pressCount, pendingOverlays: [], settled,
  //   roster: unique session cards in start order, currentId, reviewing,
  //   liveId: the live card while a graded card is open for review }
  var study = null;
  var lastCompletedStudy = null;
  var activeGame = null; // Match/Type/Quiz controller { onKey, stop } or null
  var studyFromFill = false;  // one-shot: dashboard CTA starts Study, not picker
  var studySeq = 0;
  var sessionHeld = false;     // partial deck: do not shorten a saved session
  var lastDeckStatus = null;   // formulaDeckStatus from the load that filled `deck`
  var ROUND_SIZE = 10;   // F11: grade presses per round (every press counts)
  // Study-card recall clock: 2:00 down, then +m:ss overtime. RAM only.
  var RECALL_LIMIT_SEC = 120;
  var RECALL_TICK_MS = 250;
  var recallTimer = null; // { startedAt, frozen, id }
  // Classic Anki SM-2: four grades. (A legacy 'mastered' value may still
  // appear in cardReviews / lastGrade from older sessions; history chips
  // keep rendering it. Key 5 no longer grades.)
  var GRADES = [
    { key: 'again', label: 'Again', hint: '1' },
    { key: 'hard',  label: 'Hard',  hint: '2' },
    { key: 'good',  label: 'Good',  hint: '3' },
    { key: 'easy',  label: 'Easy',  hint: '4' }
  ];
  var GRADE_LABEL = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy', mastered: 'Mastered' };
  // F8: generic reconstruction prompts — used by "Rebuild hints" (pre-flip) and
  // the post-Again interstitial. Deriving beats re-reading.
  var SCAFFOLD_PROMPTS = [
    'Units of the result?',
    'Limiting behavior as each variable → 0 or ∞?',
    'How does it scale with each quantity?',
    'Expected sign?',
    'One-sentence physical story?'
  ];

  function root() { return document.getElementById('formulas-root'); }
  function body() { return document.getElementById('flash-body'); }
  /* The landing's recall band sits above Options, outside #flash-body. Only
     renderHome fills it; every other screen that paints the body empties it. */
  function setMasthead(html) {
    var m = document.getElementById('formulas-masthead');
    if (m) m.innerHTML = html || '';
  }

  /* Interactive sims are keyed by card id in PGRE.visualizers. About 30 book
     cards have a draw() — the rest have none, so the nav button stays off. */
  function hasInteractiveVisualizer(id) {
    var v = window.PGRE && PGRE.visualizers && PGRE.visualizers[id];
    return !!(v && typeof v.draw === 'function');
  }

  function openVisualizerFor(id) {
    if (!id || !window.PGRE || typeof PGRE.openVisualizerModal !== 'function') return;
    PGRE.openVisualizerModal(id);
  }

  function vizNavButtonHTML(id, extraClass, btnId) {
    if (!hasInteractiveVisualizer(id)) return '';
    var cls = 'btn btn-ghost viz-nav-btn' + (extraClass ? ' ' + extraClass : '');
    var idAttr = btnId ? ' id="' + btnId + '"' : '';
    return '<div class="viz-open-strip">' +
      '<button type="button" class="' + cls + '"' + idAttr +
      ' data-viz-open="' + PGRE.ui.esc(id) + '" aria-haspopup="dialog">Open Simulation</button>' +
      '</div>';
  }

  function wireVizNav(scope) {
    var rootEl = scope || document;
    if (!rootEl || !rootEl.querySelectorAll) return;
    rootEl.querySelectorAll('[data-viz-open]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openVisualizerFor(b.getAttribute('data-viz-open'));
      });
    });
  }

  /* "Similar problem" — every flashcard surface carries a control that jumps
     to the practice-pool question closest to the card. The matcher, button
     markup and delegated wiring live in js/bank.js
     (PGRE.similarProblemButtonHTML / wireSimilarProblemButtons); the click
     hands the card to PGRE.openSimilarProblem → PGRE.launchSimilarProblem
     (js/packs.js). A card with no qualifying match renders an inert
     "No similar problem" label rather than an unrelated question.
     The control is followed by the card's OrbitOS learning-session links
     (PGRE.sessionLinksHTML, also js/bank.js), which take their own row; the
     Search card passes noSessions and puts them under its footer instead. */
  function similarButton(card, extraClass, noSessions) {
    return (PGRE.similarProblemButtonHTML
      ? PGRE.similarProblemButtonHTML(card, extraClass) : '') +
      (!noSessions && PGRE.sessionLinksHTML ? PGRE.sessionLinksHTML(card) : '');
  }

  function wireSimilar(rootEl) {
    if (PGRE.wireSimilarProblemButtons) PGRE.wireSimilarProblemButtons(rootEl);
    if (PGRE.wireSessionLinks) PGRE.wireSessionLinks(rootEl);
  }


  function visualizerModalOpen() {
    return !!document.getElementById('viz-modal-backdrop');
  }

  function closeVisualizerIfOpen() {
    if (window.PGRE && typeof PGRE.closeVisualizerModal === 'function') {
      PGRE.closeVisualizerModal();
    }
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  /* F9 — topic interleaving: group by topic, shuffle within each group, then
     round-robin one card per topic per cycle in a freshly-shuffled topic order,
     avoiding a same-topic repeat across the cycle boundary. Consecutive cards
     therefore differ in topic whenever more than one topic still has cards. */
  function interleaveByTopic(cards) {
    var groups = {};
    cards.forEach(function (c) {
      var k = c.topic || '_';
      (groups[k] = groups[k] || []).push(c);
    });
    var keys = Object.keys(groups);
    keys.forEach(function (k) { groups[k] = shuffle(groups[k]); });
    var out = [], last = null;
    while (out.length < cards.length) {
      var avail = keys.filter(function (k) { return groups[k].length; });
      if (!avail.length) break;
      var cycle = shuffle(avail);
      if (cycle.length > 1 && cycle[0] === last) {  // don't repeat across boundary
        var sw = cycle[1]; cycle[1] = cycle[0]; cycle[0] = sw;
      }
      cycle.forEach(function (k) {
        if (groups[k].length) { out.push(groups[k].shift()); last = k; }
      });
    }
    return out;
  }

  /* F8: the 5-prompt reconstruction list, shared by the pre-flip scaffold and
     the post-Again interstitial. */
  function scaffoldPromptsHTML() {
    var h = '<ul class="scaffold-list">';
    SCAFFOLD_PROMPTS.forEach(function (p) { h += '<li>' + PGRE.ui.esc(p) + '</li>'; });
    return h + '</ul>';
  }

  /* Card heading: hand-authored cards carry a `name`, book-import cards a `tag`
     (SPEC bank contract — real formula cards have no `name`). Fall back through
     both so the deck never renders the literal string "undefined". */
  function cardName(c) { return (c && (c.name || c.tag)) || ''; }

  function deckById(id) {
    var pool = (deck && deck.length) ? deck : ((PGRE.deck && PGRE.deck.length) ? PGRE.deck : (PGRE.FORMULAS || []));
    for (var i = 0; i < pool.length; i++) if (pool[i] && pool[i].id === id) return pool[i];
    return null;
  }

  /* ——— F2 mnemonic notes (state.cardNotes: id -> { text, updatedAt }) ——— */
  function mnemonicNote(id) {
    var m = PGRE.store.state.cardNotes;
    return (m && m[id]) || null;
  }
  /* Plain text, trimmed; an empty save clears the note. */
  function setMnemonic(id, text) {
    var s = PGRE.store.state;
    if (!s.cardNotes) s.cardNotes = {};
    if (!text) { delete s.cardNotes[id]; PGRE.store.tombstone('cardNotes', id); }
    else { s.cardNotes[id] = { text: text, updatedAt: new Date().toISOString() }; PGRE.store.untombstone('cardNotes', id); }
    PGRE.gamify.checkAchievements(); // before save() so a just-unlocked badge persists now
    PGRE.store.save();
  }
  /* Rendered mnemonic block (plain text — ui.esc, never typeset), shown under the
     card note after a flip. Empty string when the card has no mnemonic. */
  function mnemonicHTML(id) {
    var n = mnemonicNote(id);
    if (!n || !n.text) return '';
    return '<div class="fcard-mnemonic"><span class="mnemonic-label">Mnemonic</span>' +
      PGRE.ui.esc(n.text) + '</div>';
  }

  /* js/flashmodes.js is not linked from the (infra-owned) index.html, so it is
     loaded on first entry with a dynamic <script> — the game logic stays in
     its own file without editing the shell. Resolves even on failure so Study
     mode keeps working; a failed load clears the cached promise so the game
     tabs' Retry (and the next mount) can try again. */
  var flashLoad = null;
  function ensureFlashmodes() {
    if (PGRE.flashmodes) return Promise.resolve();
    if (flashLoad) return flashLoad;
    flashLoad = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = 'js/flashmodes.js?v=20261023a';
      s.onload = function () { resolve(); };
      s.onerror = function () { flashLoad = null; resolve(); };
      document.head.appendChild(s);
    });
    return flashLoad;
  }

  /* js/formula-search.js is loaded the same way, on first entry to the Search
     tab — the matching engine is dead weight for every other mode. */
  var searchLoad = null, searchFailed = false;
  function ensureSearchEngine() {
    if (PGRE.formulaSearch) return Promise.resolve();
    if (searchLoad) return searchLoad;
    searchLoad = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = 'js/formula-search.js?v=20261105a';
      s.onload = function () { resolve(); };
      s.onerror = function () { searchLoad = null; searchFailed = true; resolve(); };
      document.head.appendChild(s);
    });
    return searchLoad;
  }

  function teardownGame() {
    if (activeGame && activeGame.stop) activeGame.stop();
    activeGame = null;
  }
  function tabsBarHTML() {
    var empty = !deck.length;
    var tabs = [['study', 'Review'], ['browse', 'Browse'], ['cards', 'Cards'],
                ['progress', 'Progress'], ['practice', 'Practice']];
    // Games keep the Practice tab lit; the search engine is the Browse tab;
    // a study session keeps Review lit.
    var on = (mode === 'match' || mode === 'type' || mode === 'quiz' ||
              mode === 'cloze') ? 'practice'
             : mode === 'search' ? 'browse' : mode;
    var html = '<div class="flash-tabs-bar"><div class="flash-tabs" role="tablist">';
    tabs.forEach(function (t) {
      // The Cards editor works on an empty deck: new subjects start empty
      // and the student writes their first card there (Life Studio).
      var dis = empty && (t[0] === 'browse' || t[0] === 'practice' || t[0] === 'progress');
      var selected = on === t[0];
      html += '<button class="flash-tab' + (selected ? ' active' : '') + '" role="tab"' +
        ' data-mode="' + t[0] + '"' +
        ' aria-selected="' + (selected ? 'true' : 'false') + '"' +
        ' tabindex="' + (selected ? '0' : '-1') + '"' +
        (dis ? ' disabled' : '') + '>' + t[1] + '</button>';
    });
    html += '</div>';
    if (empty) {
      html += '<p class="flash-tab-note muted">The drills and Browse arrive with the ' +
        'book import — they light up once the deck fills.</p>';
    }
    html += '</div>';
    return html;
  }

  function bindFlashTabs() {
    var host = root();
    if (!host) return;
    function revealTab(tab) {
      var strip = tab && tab.parentNode;
      if (!strip || !strip.clientWidth) return;
      var left = tab.offsetLeft, right = left + tab.offsetWidth;
      if (left < strip.scrollLeft) strip.scrollLeft = left - 3;
      else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth + 3;
    }
    revealTab(host.querySelector('.flash-tab.active'));
    host.querySelectorAll('.flash-tab').forEach(function (b) {
      if (b.disabled) return;
      b.addEventListener('click', function () {
        var m = b.getAttribute('data-mode');
        if (m === 'browse') m = 'search';        // the Browse tab hosts the find box
        host.querySelectorAll('.flash-tab').forEach(function (tab) {
          var on = tab.getAttribute('data-mode') === b.getAttribute('data-mode');
          tab.classList.toggle('active', on);
          tab.setAttribute('aria-selected', on ? 'true' : 'false');
          tab.tabIndex = on ? 0 : -1;
        });
        revealTab(b);
        switchMode(m);
      });
    });
    var pf = document.getElementById('print-formulas');
    if (pf) pf.addEventListener('click', printSheet);
  }

  /* ——— Shell: masthead slot (the Review tab's recall band), the always-on
     tab bar, then a persistent body ——— */
  function renderShell() {
    var html = '<div id="formulas-masthead"></div>' + tabsBarHTML();
    html += '<div id="flash-body"></div>';
    root().innerHTML = html;
    bindFlashTabs();
    renderMode();
    if (window.PGRE && PGRE.motion && PGRE.motion.viewEnter) {
      PGRE.motion.viewEnter(document.getElementById('view'));
    }
  }

  /* ——— Print / PDF (proposal #13) ———
     A compact per-topic formula sheet — every card's front + back, grouped by
     topic in a two-column print layout — built into a hidden `.print-sheet`
     beside the interactive DOM. css/print.css shows only the sheet at print
     time; the router discards it when #view repaints. Rendering ALL cards (not
     just the on-screen browse list, which shows names only) is the whole point,
     so it is generated from the full loaded deck. */
  function printDate() {
    return new Date().toLocaleDateString('en-US',
      { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function formulaHTML(text) {
    return PGRE.formulaTextHTML ? PGRE.formulaTextHTML(text) : (text || '');
  }

  /* The answer face of a card: the same formula with its book equation number
     tagged on at RENDER time. Tag first, then formulaHTML — the prose mangler
     treats $$…$$ as a protected part, so the tag rides through untouched. Cards
     without an eq (hand-seeded PGRE.FORMULAS, imported decks) render bare. */
  function taggedBackHTML(c, back) {
    if (back == null) back = c.back;
    return formulaHTML(PGRE.formulaBackTagged ? PGRE.formulaBackTagged(back, c.eq) : back);
  }

  /* F5 reverse asks with the back's leading formula alone (flashmodes' stripLegend,
     the text a Quiz option shows); the takeaway and labelled points after it move to
     the answer face. A back with no leading math block (book lists) stays whole.
     mount() awaits ensureFlashmodes(); if that load failed, the whole back is asked. */
  function reverseParts(c) {
    var back = String(c.back == null ? '' : c.back).trim();
    var q = PGRE.flashmodes ? PGRE.flashmodes.stripLegend(back) : back;
    return { q: q, rest: back.slice(q.length) };
  }

  /* A card may carry `braced`: its leading display formula rewritten with
     \underbrace labels under each term. The answer face shows that version in
     place of the plain one. Quiz, Match, Type, Cloze and the reverse question
     keep the plain formula (they read c.back or reverseParts), so a label never
     names the formula being asked for. */
  function bracedBack(c) {
    var back = String(c.back == null ? '' : c.back);
    if (!c.braced) return back;
    var lead = /^\s*/.exec(back)[0].length;
    if (back.slice(lead).indexOf('$$') !== 0) return back;
    var end = back.indexOf('$$', lead + 2);
    if (end < 0) return back;
    return back.slice(0, lead) + '$$' + c.braced + back.slice(end);
  }

  function backHTML(c) {
    var html = taggedBackHTML(c, bracedBack(c));
    if (c && c.id && PGRE.replaceRecallListWithDiagram) {
      html = PGRE.replaceRecallListWithDiagram(html, c.id);
    }
    return html;
  }

  function topicCardsHTML(cards) {
    var ui = PGRE.ui, h = '<div class="ps-cards">';
    cards.forEach(function (c) {
      var nm = cardName(c);
      h += '<div class="ps-card" data-card-id="' + PGRE.ui.esc(c.id) + '">' +
        (nm ? '<div class="ps-card-tag">' + ui.esc(nm) + '</div>' : '') +
        '<div class="ps-card-front">' + formulaHTML(c.front) + '</div>' +
        '<div class="ps-card-back">' + backHTML(c) + '</div>' +
      '</div>';
    });
    return h + '</div>';
  }

  function buildPrintSheet() {
    var view = document.getElementById('view');
    if (!view) return;
    var old = document.getElementById('formulas-print');
    if (old) old.parentNode.removeChild(old);
    if (!deck.length) return;
    var ui = PGRE.ui, known = {};
    var html = '<header class="ps-head"><h1>Physics GRE — Formula Sheet</h1>' +
      '<p class="ps-sub">' + deck.length + ' card' + (deck.length === 1 ? '' : 's') +
      ' · printed ' + printDate() + '</p></header>';
    PGRE.TOPICS.forEach(function (t) {
      known[t.id] = 1;
      var cards = deck.filter(function (c) { return c.topic === t.id; });
      if (!cards.length) return;
      html += '<div class="ps-topic"><h2 class="ps-topic-head">' +
        ui.esc(t.short) + ' · ' + ui.esc(t.name) + '</h2>' + topicCardsHTML(cards) + '</div>';
    });
    var others = deck.filter(function (c) { return !known[c.topic]; });
    if (others.length) {
      html += '<div class="ps-topic"><h2 class="ps-topic-head">Other</h2>' +
        topicCardsHTML(others) + '</div>';
    }
    var sheet = document.createElement('section');
    sheet.className = 'print-sheet';
    sheet.id = 'formulas-print';
    sheet.innerHTML = html;
    view.appendChild(sheet);
    PGRE.typesetMath(sheet);
    flagWideCards();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(flagWideCards); // re-measure with real metrics
    }
  }

  function printSheet() {
    buildPrintSheet();
    document.body.classList.add('pgre-printing');
    window.print();
  }

  window.addEventListener('afterprint', function () {
    document.body.classList.remove('pgre-printing');
  });

  /* Flag cards too wide for print.css's 2-column grid so they span both
     columns (.ps-card.wide) instead of clipping. The sheet can't be measured
     in place: it is display:none on screen, and Chromium fires beforeprint
     BEFORE switching to print-media layout, so every width reads 0 there.
     Instead `.measuring` (css/style.css) lays the sheet out offscreen at one
     print column's card metrics. An overlong equation shows up as overflow of
     its .katex-display box — style.css gives those overflow-x:auto, which
     keeps the card's own scrollWidth put — so the boxes are checked directly;
     the card-level check still catches wide inline math. Runs at build time
     (headless Page.printToPDF fires no print events) and again on beforeprint
     so real prints re-measure after webfonts settle. */
  function flagWideCards() {
    var sheet = document.getElementById('formulas-print');
    if (!sheet) return;
    sheet.classList.add('measuring');
    var cards = sheet.querySelectorAll('.ps-card'), flags = [];
    cards.forEach(function (card) {
      var over = card.scrollWidth > card.clientWidth + 1;
      if (!over) {
        var maths = card.querySelectorAll('.katex-display');
        for (var i = 0; i < maths.length; i++) {
          if (maths[i].scrollWidth > maths[i].clientWidth + 1) { over = true; break; }
        }
      }
      flags.push(over);
    });
    cards.forEach(function (card, i) { card.classList.toggle('wide', flags[i]); });
    sheet.classList.remove('measuring');
  }

  window.addEventListener('beforeprint', function () {
    if (/^#\/formulas/.test(location.hash) && !document.getElementById('formulas-print')) {
      buildPrintSheet();
    }
    flagWideCards();
  });

  function switchMode(m) {
    closeVisualizerIfOpen();
    if (m === mode) {
      /* Re-clicking the tab you are already on is normally a no-op — but a live
         Study session has taken the body over, and its own tab is the obvious
         "back to the deck" affordance. Nothing is lost: the round was persisted
         on every grade, so the home screen meets you with Resume. */
      if (m === 'study' && study) { settleStudy(); stopRecallTimer(); study = null; renderMode(); }
      return;
    }
    teardownGame();
    settleStudy();
    stopRecallTimer();
    study = null;
    mode = m;
    renderShell();
  }

  function renderMode() {
    if (mode === 'cards') return renderCardEditor();
    if (mode === 'practice') return renderPractice();
    if (mode === 'progress') return renderProgress();
    if (mode === 'match' || mode === 'type' || mode === 'quiz' || mode === 'cloze') return renderGameIntro(mode);
    if (mode === 'search' || mode === 'browse') return renderSearch();
    return renderHome();
  }

  /* ——— Cards tab (Life Studio round 2, design §6.5): the in-app editor for
     the student's own cards, two panes. Left: the list — subject chips, a
     find box, "Added today" then per-subject groups, 50 rows at a time.
     Right: the card form with a live typeset preview and content checks.
     Create/edit/delete all go through PGRE.userCardOps (js/user-cards.js):
     ids user-<tag>-<n> never change, deletes are tombstoned. The deck
     reloads after each write so Study, Browse and the games see the card
     at once. ——— */
  var editorOpen = null;   // card id being edited; null = new-card form
  var editorSubject = 'all'; // side-list subject chip
  var editorQuery = '';      // side-list find box
  var editorShown = 50;      // side-list rows on screen ("Show 50 more")
  var EDITOR_PAGE = 50;

  function editorDueChip(c) {
    var st = PGRE.srs.cardState(c.id);
    if (PGRE.srs.isSuspended(c.id)) return '<span class="duechip">away</span>';
    if (!st || !st.reviews) return '<span class="duechip">new</span>';
    var du = PGRE.srs.daysUntil(st.due);
    var label = du <= 0 ? 'due now' : 'due in ' + PGRE.srs.ivlLabel(du);
    return '<span class="duechip' + (du <= 0 ? ' now' : '') + '">' + label + '</span>';
  }

  function editorListHTML(sel) {
    var ui = PGRE.ui, ops = PGRE.userCardOps;
    var all = ops ? ops.list() : [];
    var today = PGRE.srs.today();
    var counts = {};
    all.forEach(function (c) {
      var sid = PGRE.cardSubject ? PGRE.cardSubject(c) : 'physics';
      counts[sid] = (counts[sid] || 0) + 1;
    });
    var q = editorQuery.trim().toLowerCase();
    function keep(c) {
      var sid = PGRE.cardSubject ? PGRE.cardSubject(c) : 'physics';
      if (sel !== 'all' && sid !== sel) return false;
      if (!q) return true;
      return ((c.front || '') + ' ' + (c.back || '') + ' ' + (c.note || '') + ' ' + c.id)
        .toLowerCase().indexOf(q) !== -1;
    }
    var chips = '<div class="subj-chips" style="margin:10px 0" role="group" aria-label="Subject">' +
      '<button class="subj-chip" data-edsubj="all" aria-pressed="' + (sel === 'all') +
        '">All <span class="n">' + all.length + '</span></button>';
    (PGRE.SUBJECTS || []).forEach(function (s) {
      if (!counts[s.id]) return;
      chips += '<button class="subj-chip" data-edsubj="' + ui.esc(s.id) +
        '" aria-pressed="' + (sel === s.id) + '">' + ui.esc(s.code || s.name) +
        ' <span class="n">' + counts[s.id] + '</span></button>';
    });
    chips += '</div>';

    var groups = '', shown = 0, rest = 0;
    var editing = editorOpen;
    function row(u) {
      if (shown >= editorShown) { rest++; return ''; }
      shown++;
      return '<li class="' + (u.id === editing ? 'on' : '') + '" data-edit="' + ui.esc(u.id) +
        '" role="button" tabindex="0"><span class="id"><span>' + ui.esc(u.id) + '</span>' +
        editorDueChip(u) + '</span><span class="clamp">' + formulaHTML(cardName(u) || u.id) + '</span></li>';
    }
    var todayCards = all.filter(function (u) {
      return keep(u) && String(u.createdAt || '').slice(0, 10) === today;
    });
    if (todayCards.length) {
      groups += '<div class="ed-grp">Added today</div><ul class="list ed-list">' +
        todayCards.map(row).join('') + '</ul>';
    }
    (PGRE.SUBJECTS || []).forEach(function (s) {
      var grp = all.filter(function (u) {
        var sid = PGRE.cardSubject ? PGRE.cardSubject(u) : 'physics';
        return sid === s.id && keep(u) && String(u.createdAt || '').slice(0, 10) !== today;
      });
      if (!grp.length) return;
      var rows = grp.map(row).join('');
      if (!rows && !rest) return;
      groups += '<div class="ed-grp">' + ui.esc(s.name) + '</div>' +
        '<ul class="list ed-list">' + rows + '</ul>';
    });
    if (!groups) {
      groups = '<p class="muted" style="margin:10px">' +
        (q ? 'No card matches “' + ui.esc(editorQuery) + '”.' :
         'None yet. Write one on the right — it joins today’s queue under its ' +
         'subject and is graded with the same Again / Hard / Good / Easy scheduler.') + '</p>';
    }
    return '<div class="card ed-side"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px">' +
      '<h2 class="sec-title" style="margin:0">Your cards <span class="num">' + all.length + '</span></h2>' +
      '<button class="btn btn-primary btn-sm" id="ed-new">New card</button></div>' +
      chips +
      '<div class="form"><input type="text" id="ed-find" placeholder="Find one of your cards" value="' +
        ui.esc(editorQuery) + '"></div>' +
      groups +
      (rest ? '<div class="btn-row" style="margin:10px"><button class="btn btn-ghost btn-sm" id="ed-more">Show ' +
        Math.min(EDITOR_PAGE, rest) + ' more</button></div>' : '') +
      '<p class="meta" style="margin:10px 0 0">Book and supplement cards are not edited here.</p></div>';
  }

  /* Content checks under the preview (design §6.5): the same wording rules
     every card follows — closed math, no raw <, no cross-card references,
     no duplicate front in the subject. */
  function editorChecks(front, back, note, subject, id) {
    var out = [], all = front + ' ' + back + ' ' + note;
    var dollars = all.replace(/\\\$/g, '').match(/\$/g);
    if (dollars && dollars.length % 2) {
      out.push('An odd number of $ signs: one math span is not closed.');
    }
    if (/<\s*[A-Za-z|]/.test(all.replace(/<\/?(b|i|br|ul|li|strong|em|p)\b[^>]*>/g, ''))) {
      out.push('A raw &lt; followed by a letter: the browser reads it as a tag. ' +
        'Write it in math, for example $\\langle P \\rangle$.');
    }
    var ops = PGRE.userCardOps;
    var mine = front.replace(/['"]/g, '').trim().toLowerCase();
    if (mine && ops) {
      var dup = ops.list().filter(function (c) {
        var sid = PGRE.cardSubject ? PGRE.cardSubject(c) : 'physics';
        return c.id !== id && sid === subject &&
          (c.front || '').replace(/['"]/g, '').trim().toLowerCase() === mine;
      })[0];
      if (dup) out.push('Same front as ' + dup.id + ' in this subject.');
    }
    if (/\b(as above|that step|the same limit|previous card|see card)\b/i.test(all)) {
      out.push('Refers to something outside this card. Each card must make sense on its own.');
    }
    return out;
  }

  function editorSubjectOptions(sel) {
    var html = '';
    (PGRE.SUBJECTS || []).forEach(function (s) {
      html += '<option value="' + PGRE.ui.esc(s.id) + '"' +
        (s.id === sel ? ' selected' : '') + '>' + PGRE.ui.esc(s.name) + '</option>';
    });
    return html;
  }
  function editorFormHTML(card) {
    var ui = PGRE.ui;
    var c = card || {};
    var subject = c.subject || 'physics';
    return '<div class="card form" id="ed-form">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap">' +
        '<h2 class="sec-title" style="margin:0" id="ed-title">' + (c.id ? 'Edit card' : 'New card') + '</h2>' +
        (c.id ? '<span class="badge" id="ed-id">' + ui.esc(c.id) + '</span>' : '') + '</div>' +
      '<div class="ed-cols"><div>' +
        '<label class="f" for="uec-subject">Subject</label>' +
        '<select id="uec-subject">' + editorSubjectOptions(subject) + '</select>' +
        (c.id ? '<div class="hint">Changing the subject keeps the id, so the review schedule follows the card.</div>' : '') +
        '<label class="f" for="uec-front">Front: the question</label>' +
        '<textarea id="uec-front" rows="3" placeholder="e.g. The force between two charges $q_1$, $q_2$ at distance $r$">' +
        ui.esc(c.front || '') + '</textarea>' +
        '<label class="f" for="uec-back">Back: the answer</label>' +
        '<textarea id="uec-back" rows="3" placeholder="e.g. $$F = \\frac{q_1 q_2}{4\\pi\\varepsilon_0 r^2}$$">' +
        ui.esc(c.back || '') + '</textarea>' +
        '<label class="f" for="uec-note">Note <span class="meta">(optional)</span></label>' +
        '<textarea id="uec-note" rows="2" placeholder="A memory hook, an example, a trap">' +
        ui.esc(c.note || '') + '</textarea>' +
        '<div class="hint">Math goes between dollar signs and renders in the preview as you type.</div>' +
      '</div><div><div class="meta" style="margin:12px 0 4px">Preview: the card as it shows after you reveal the answer</div>' +
        '<div class="fcard"><div class="top"><span><span class="mono-chip" id="pv-chip">' +
          ui.esc((PGRE.subjectById(subject) || {}).code || '') + '</span> ' +
          '<span id="pv-subj">' + ui.esc(PGRE.subjectName(subject)) + '</span></span>' +
          '<span>Front → back</span></div>' +
        '<div class="front" id="uec-pv-front"></div>' +
        '<div class="back" id="uec-pv-back"></div>' +
        '<div class="note" id="uec-pv-note"></div></div>' +
        '<div class="checks" id="ed-checks"></div></div></div>' +
      '<p class="uec-error" id="uec-error" role="alert" hidden></p>' +
      '<div class="btn-row">' +
        '<button class="btn btn-primary" id="uec-save">' + (c.id ? 'Save changes' : 'Add card') + '</button>' +
        (c.id ? '<button class="btn btn-ghost" id="uec-cancel">Done editing</button>' : '') +
        (c.id ? '<button class="btn btn-danger" style="margin-left:auto" id="uec-del">Delete</button>' : '') +
      '</div>' +
      '<p class="meta" id="ed-status" style="margin-top:8px">' +
        'Delete asks first. A deleted card leaves every queue; its review history ' +
        'is kept and its id is never reused.</p></div>';
  }

  function renderCardEditor() {
    setMasthead('');
    teardownGame();
    if (PGRE.nav) PGRE.nav.setTrail([{ label: 'Cards' }]);
    var ops = PGRE.userCardOps;
    var editing = editorOpen && ops ? ops.byId(editorOpen) : null;
    if (editorOpen && !editing) editorOpen = null;
    if (editorSubject !== 'all' && !(PGRE.subjectById && PGRE.subjectById(editorSubject))) {
      editorSubject = 'all';
    }
    body().innerHTML = '<div class="ed">' + editorListHTML(editorSubject) +
      '<div>' + editorFormHTML(editing) + '</div></div>';
    updateEditorPreview();
    ['uec-front', 'uec-back', 'uec-note'].forEach(function (id) {
      var ta = document.getElementById(id);
      if (ta) ta.addEventListener('input', updateEditorPreview);
    });
    var subj = document.getElementById('uec-subject');
    if (subj) subj.addEventListener('change', updateEditorPreview);
    var save = document.getElementById('uec-save');
    if (save) save.addEventListener('click', saveEditorCard);
    var cancel = document.getElementById('uec-cancel');
    if (cancel) cancel.addEventListener('click', function () {
      editorOpen = null;
      renderCardEditor();
    });
    var del = document.getElementById('uec-del');
    if (del) del.addEventListener('click', function () {
      var c = ops.byId(editorOpen);
      if (!c) return;
      if (!confirm('Delete "' + cardName(c) + '"? Its review history is kept, but the card leaves every queue.')) return;
      if (ops.remove(c.id)) {
        editorOpen = null;
        reloadDeck(renderCardEditor);
      }
    });
    body().querySelectorAll('.ed-list li[data-edit]').forEach(function (li) {
      function open() {
        editorOpen = li.getAttribute('data-edit');
        renderCardEditor();
      }
      li.addEventListener('click', open);
      li.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
    });
    body().querySelectorAll('[data-edsubj]').forEach(function (b) {
      b.addEventListener('click', function () {
        editorSubject = b.getAttribute('data-edsubj');
        editorShown = EDITOR_PAGE;
        renderCardEditor();
      });
    });
    var find = document.getElementById('ed-find');
    if (find) {
      var t = 0;
      find.addEventListener('input', function () {
        clearTimeout(t);
        t = setTimeout(function () {
          editorQuery = find.value;
          editorShown = EDITOR_PAGE;
          renderCardEditor();
          var f2 = document.getElementById('ed-find');
          if (f2) { f2.focus(); f2.setSelectionRange(f2.value.length, f2.value.length); }
        }, 200);
      });
    }
    var more = document.getElementById('ed-more');
    if (more) more.addEventListener('click', function () {
      editorShown += EDITOR_PAGE;
      renderCardEditor();
    });
    var nw = document.getElementById('ed-new');
    if (nw) nw.addEventListener('click', function () {
      editorOpen = null;
      renderCardEditor();
      var f = document.getElementById('uec-front');
      if (f) f.focus();
    });
  }

  function updateEditorPreview() {
    var f = document.getElementById('uec-front'), b = document.getElementById('uec-back'),
        n = document.getElementById('uec-note');
    var pf = document.getElementById('uec-pv-front'), pb = document.getElementById('uec-pv-back'),
        pn = document.getElementById('uec-pv-note');
    if (!f || !b || !pf || !pb) return;
    var subject = (document.getElementById('uec-subject') || {}).value || 'physics';
    pf.innerHTML = formulaHTML(f.value) || '<span class="muted">The question shows here.</span>';
    pb.innerHTML = formulaHTML(b.value) || '<span class="muted">The answer shows here.</span>';
    if (pn) pn.innerHTML = n && n.value ? formulaHTML(n.value) : '';
    var chip = document.getElementById('pv-chip'), sub = document.getElementById('pv-subj');
    var se = PGRE.subjectById && PGRE.subjectById(subject);
    if (chip) chip.textContent = (se && se.code) || '';
    if (sub) sub.textContent = se ? se.name : subject;
    var checks = document.getElementById('ed-checks');
    if (checks) {
      var issues = editorChecks(f.value, b.value, n ? n.value : '', subject, editorOpen);
      checks.innerHTML = issues.length
        ? issues.map(function (s) { return '<p class="ed-check">' + s + '</p>'; }).join('')
        : '';
    }
    PGRE.typesetMath(document.getElementById('ed-form'));
  }

  function saveEditorCard() {
    var err = document.getElementById('uec-error');
    function fail(msg) {
      if (err) { err.textContent = msg; err.hidden = false; }
      if (PGRE.toast) PGRE.toast(msg, 'error');
    }
    var res = PGRE.userCardOps.save({
      id: editorOpen || undefined,
      subject: (document.getElementById('uec-subject') || {}).value,
      front: (document.getElementById('uec-front') || {}).value,
      back: (document.getElementById('uec-back') || {}).value,
      note: (document.getElementById('uec-note') || {}).value
    });
    if (!res.ok) { fail(res.error || 'The card could not be saved.'); return; }
    if (PGRE.toast) PGRE.toast('Card saved — ' + res.card.id, 'info');
    editorOpen = res.card.id;
    reloadDeck(renderCardEditor);
  }

  /* The deck is built from committed sources; a saved user card only joins it
     on a fresh read, so the editor reloads after each write. */
  function reloadDeck(after) {
    PGRE.formulaDeck().then(function (d) {
      deck = d;
      PGRE.deck = d;
      lastDeckStatus = (PGRE.formulaDeckStatus && typeof PGRE.formulaDeckStatus === 'object')
        ? PGRE.formulaDeckStatus : null;
      if (PGRE.refreshNavBadges) PGRE.refreshNavBadges();
      after();
    });
  }

  /* `host` lets the subject view render the lab into its own root when the
     formulas shell (#flash-body) is not mounted. */
  function renderVisualizerLab(host) {
    host = host || body();
    if (!host) return;
    setMasthead('');
    teardownGame();
    if (PGRE.nav) PGRE.nav.setTrail([{ label: 'Visualizer Lab' }]);
    var filterTopic = 'all';

    function formatThumbFormula(formula) {
      if (!formula) return '';
      var latex = String(formula).trim();
      if (!latex.startsWith('$$') && !latex.startsWith('$') && !latex.startsWith('\\(') && !latex.startsWith('\\[')) {
        latex = '$$' + latex + '$$';
      }
      return latex;
    }

    function formatThumbStory(text, maxLen) {
      if (!text) return '';
      var clean = String(text).trim().replace(/\s+/g, ' ');
      var tokenRegex = /(\$\$[\s\S]*?\$\$|\$[^$]*?\$|\*\*[^*]+?\*\*|[^\s$*]+|\s+)/g;
      var match;
      var result = '';
      var limit = maxLen || 135;
      while ((match = tokenRegex.exec(clean)) !== null) {
        var token = match[0];
        if (result.length + token.length > limit && result.length >= 60) {
          break;
        }
        result += token;
      }
      result = result.trim();
      if (result.length < clean.length) {
        result = result.replace(/[,;:\s]+$/, '') + '...';
      }
      return result.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
    }

    function renderLabContent() {
      var allVizIds = Object.keys((window.PGRE && window.PGRE.visualizers) || {}).filter(function (k) {
        return k.startsWith('cpgf-') || k.startsWith('supp-');
      });
      var cards = allVizIds.map(function (id) {
        var v = PGRE.visualizers[id];
        var c = deckById(id) || { id: id, topic: (v && v.topic) || 'cm', name: (v && v.title) || id, front: (v && v.title) || id, back: (v && v.formulaLatex) || '' };
        return { id: id, viz: v, card: c };
      });

      var topicsList = [
        { id: 'all', name: 'All (' + cards.length + ')' },
        { id: 'cm', name: 'Classical Mechanics' },
        { id: 'em', name: 'Electromagnetism' },
        { id: 'ow', name: 'Optics & Waves' },
        { id: 'th', name: 'Thermodynamics' },
        { id: 'qm', name: 'Quantum Mechanics' },
        { id: 'at', name: 'Atomic Physics' },
        { id: 'sr', name: 'Special Relativity' },
        { id: 'lb', name: 'Lab Methods' },
        { id: 'sp', name: 'Special Topics' }
      ];

      var filtered = cards.filter(function (item) {
        return (filterTopic === 'all' || item.card.topic === filterTopic || (item.viz && item.viz.topic === filterTopic));
      });

      var html = '<div class="viz-lab-container">' +
        '<div class="viz-lab-header">' +
          '<h1 class="viz-lab-title">Interactive Formula Visualizer Laboratory</h1>' +
          '<p class="viz-lab-sub">Hands-on simulations, vector fields, phase-space flows, and limiting cases for Physics GRE formulas.</p>' +
        '</div>' +
        '<div class="viz-filter-bar">' +
          topicsList.map(function (tp) {
            return '<button class="viz-filter-chip' + (filterTopic === tp.id ? ' active' : '') + '" data-topic="' + tp.id + '">' + tp.name + '</button>';
          }).join('') +
        '</div>' +
        '<div class="viz-cards-grid">';

      filtered.forEach(function (item) {
        var v = item.viz, c = item.card;
        var tObj = PGRE.topicById(c.topic);
        var tName = tObj ? tObj.name : c.topic.toUpperCase();
        var rawStory = (v && v.physicalStory) || (c && c.front) || '';
        var shortStory = formatThumbStory(rawStory, 135);
        var rawFormula = (v && v.formulaLatex) || (c && c.back) || '';
        var formulaLatex = formatThumbFormula(rawFormula);
        var titleText = (v && v.title) || (c && c.name) || '';

        html += '<div class="viz-thumb-card" data-viz-id="' + item.id + '">' +
          '<div class="viz-thumb-head">' +
            '<span class="viz-inline-badge">' + tName + '</span>' +
            '<span class="viz-thumb-eq">' + (c.eq ? ('Eq ' + c.eq) : item.id) + '</span>' +
          '</div>' +
          '<div class="viz-thumb-title">' + PGRE.ui.esc(titleText) + '</div>' +
          '<div class="viz-thumb-formula">' + formulaLatex + '</div>' +
          '<div class="viz-thumb-desc">' + shortStory + '</div>' +
          '<button class="btn btn-primary btn-sm" style="margin-top:auto;">Open Simulation</button>' +
        '</div>';
      });

      html += '</div></div>';
      host.innerHTML = html;
      PGRE.typesetMath(host);

      host.querySelectorAll('.viz-filter-chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
          filterTopic = chip.getAttribute('data-topic');
          renderLabContent();
        });
      });

      host.querySelectorAll('.viz-thumb-card').forEach(function (cardEl) {
        cardEl.addEventListener('click', function () {
          var id = cardEl.getAttribute('data-viz-id');
          if (window.PGRE.openVisualizerModal) window.PGRE.openVisualizerModal(id);
        });
      });
    }

    renderLabContent();
  }


  /* Live solid-enough threshold (whole days). Falls back to 21 if the helper
     is missing so an older srs.js still paints the band. */
  function matureDays() {
    return (PGRE.srs && typeof PGRE.srs.matureDays === 'function') ? PGRE.srs.matureDays() : 21;
  }


  /* Life Studio — the study-session subject filter (settings.recallSubject).
     The daily batch stays one mixed list; the filter only narrows which of
     its cards the Study flow serves and which fresh picks are suggested. */
  function subjectFilter() {
    var f = PGRE.store.state.settings && PGRE.store.state.settings.recallSubject;
    return (f && f !== 'all' && PGRE.subjectById && PGRE.subjectById(f)) ? f : 'all';
  }
  function subjectFiltered(cards) {
    var f = subjectFilter();
    if (f === 'all' || !PGRE.cardSubject) return cards;
    return (cards || []).filter(function (c) { return PGRE.cardSubject(c) === f; });
  }

  /* ——— Today card: one line on what Study will do, one primary button ———
     remaining = cards still owed from the saved list. When nothing remains the
     Study button takes the auto-pick (srs.suggestFormulaDay: due reviews
     first, then new cards in book order, up to the daily target). A subject
     filter narrows both to that subject. */
  function todayState() {
    var srs = PGRE.srs;
    var subject = subjectFilter();
    var batch = srs.formulaDay(deck);
    var remaining = subjectFiltered(srs.formulaDayRemaining(deck));
    var done = 0, unseen = 0, left = Object.create(null);
    remaining.forEach(function (c) { left[c.id] = 1; });
    batch.reviewIds.concat(batch.newIds).forEach(function (id) {
      if (!left[id] && srs.studiedToday(srs.cardState(id))) done++;
    });
    deck.forEach(function (c) {
      if (!srs.cardState(c.id) && !srs.isSuspended(c.id) &&
          (subject === 'all' || PGRE.cardSubject(c) === subject)) unseen++;
    });
    var remNew = remaining.filter(function (c) { return !srs.cardState(c.id); }).length;
    return {
      target: srs.clampTarget(PGRE.store.state.settings.formulaDailyTarget),
      subject: subject,
      remaining: remaining,
      remReviews: remaining.length - remNew,
      remNew: remNew,
      done: done,
      unseen: unseen,
      postponed: postponedOverdue(subject).ids.length,
      sug: remaining.length ? { reviewIds: [], newIds: [] }
                            : srs.suggestFormulaDay(deck, { subject: subject }),
      resume: rehydrateSavedStudy(),
      adhoc: savedStudyIsAdhoc()
    };
  }

  /* A same-day ad-hoc round (search drill, leech drill) is not today's list.
     Replacing it takes an explicit button. */
  function savedStudyIsAdhoc() {
    var saved = PGRE.store.state.formulaStudy;
    return !!(saved && saved.dayBound === false && saved.date === PGRE.srs.today() &&
      Array.isArray(saved.queueIds) && saved.queueIds.length);
  }

  /* Due reviews that are not in today's batch, oldest first. With a subject
     arg ('all' or a PGRE.SUBJECTS id) only that subject's overdue count. */
  function postponedOverdue(subject) {
    var srs = PGRE.srs;
    var batch = srs.formulaDay(deck);
    var inB = Object.create(null);
    (batch.reviewIds || []).concat(batch.newIds || []).forEach(function (id) { inB[id] = 1; });
    var ids = [], age = 0;
    deck.forEach(function (c) {
      if (!c || inB[c.id] || srs.isSuspended(c.id)) return;
      if (subject && subject !== 'all' && PGRE.cardSubject &&
          PGRE.cardSubject(c) !== subject) return;
      var st = srs.cardState(c.id);
      if (!st || !st.due) return;
      var du = srs.daysUntil(st.due);
      if (du > 0) return;
      ids.push(c.id);
      if (-du > age) age = -du;
    });
    return { ids: ids, age: age };
  }


  /* Subject chips for the Review card (Life Studio round 2). 'All' plus
     every subject with cards; the count is that subject's due reviews.
     The choice persists in settings.recallSubject. */
  function subjectChipsHTML(t, mem) {
    var html = '<div class="subj-chips" role="group" aria-label="Subject">';
    html += '<button class="subj-chip" data-rsubj="all" aria-pressed="' +
      (t.subject === 'all') + '">All <span class="n">' + mem.total.due + '</span></button>';
    (PGRE.SUBJECTS || []).forEach(function (s) {
      var e = mem.byId[s.id];
      if (!e || !e.cards) return;
      html += '<button class="subj-chip" data-rsubj="' + PGRE.ui.esc(s.id) +
        '" aria-pressed="' + (t.subject === s.id) + '">' + PGRE.ui.esc(s.name) +
        ' <span class="n">' + e.due + '</span></button>';
    });
    return html + '</div>';
  }

  /* The Review card: one title, one line, one row of buttons for every state
     of the day (design §6.5, decision D2 — due reviews in batches of the
     daily target, most overdue first; new cards only after them). */
  function todayCardHTML(t, mem) {
    var ui = PGRE.ui;
    var cur = t.subject === 'all'
      ? { name: 'all subjects', due: mem.total.due, oldest: mem.total.oldestOverdue }
      : { name: PGRE.subjectName(t.subject), due: (mem.byId[t.subject] || {}).due || 0,
          oldest: (mem.byId[t.subject] || {}).oldestOverdue || 0 };
    var T = t.target;
    var M = t.remaining.length;
    var sugR = t.sug.reviewIds.length, sugN = t.sug.newIds.length, sugAll = sugR + sugN;
    var newUsed = (PGRE.srs.newCardsCommittedToday ? PGRE.srs.newCardsCommittedToday() : 0);
    var newCap = PGRE.srs.clampTarget(PGRE.store.state.settings.newCardsPerDay);

    var edit = '<button class="btn btn-ghost" id="pick-btn">' +
      (M || t.resume ? 'Edit today’s list' : 'Choose cards') + '</button>';
    var exp = '<button class="btn btn-ghost" id="home-export-btn" ' +
      'title="Export learning status for agent">Export data</button>';
    function study(label) {
      return '<button class="btn btn-primary" id="study-btn">' + label + '</button>';
    }

    var title = 'Today’s review', line = '', buttons = '';
    var big = 0;
    if (t.resume) {
      title = 'Review in progress';
      big = t.resume.length;
      buttons = '<button class="btn btn-primary" id="resume-btn">' +
        'Resume — ' + t.resume.length + ' left</button>' + edit;
      if (t.adhoc) {
        buttons += '<button class="btn btn-ghost" id="replace-daily-btn">' +
          'Replace with today’s list</button>';
      }
      line = (t.done ? t.done + ' reviewed today. ' : '') + (t.adhoc
        ? 'A separate study session is in progress. It stays until you resume it or replace it.'
        : 'A study session is in progress.');
    } else if (M) {
      big = M;
      buttons = study((t.done ? 'Next ' : 'Study ') + M + ' card' + (M === 1 ? '' : 's')) + edit;
      line = M + ' card' + (M === 1 ? '' : 's') + ' left in today’s list' +
        (t.done ? ' · ' + t.done + ' reviewed today' : '') + '.';
      if (t.postponed) {
        line += ' ' + t.postponed + ' more due ' + (t.postponed === 1 ? 'is' : 'are') +
          ' not in the list.';
        var late = postponedOverdue(t.subject);
        if (late.age > 0) {
          line += ' Oldest overdue: ' + late.age + ' day' + (late.age === 1 ? '' : 's') + '.';
        }
        if (late.ids.length) {
          buttons += '<button class="btn btn-ghost" id="add-overdue-btn">Add overdue</button>';
        }
      }
    } else if (cur.due || sugAll) {
      // Fresh batch math: due reviews first, then (only under the cap) new
      // cards — exactly what autoFillFormulaDay will commit.
      var batch = Math.min(T, sugAll || cur.due);
      big = batch;
      buttons = study((t.done ? 'Next ' : 'Study ') + batch + ' card' + (batch === 1 ? '' : 's')) + edit;
      line = cur.due + ' due in ' + cur.name + '. This batch: ' + batch +
        ' card' + (batch === 1 ? '' : 's') + (sugR ? ', most overdue first' : '') +
        (cur.due > batch ? '; ' + (cur.due - batch) + ' more due after it.' : '.') +
        (cur.oldest ? ' Oldest overdue: ' + cur.oldest + ' day' +
          (cur.oldest === 1 ? '' : 's') + '.' : '') +
        (sugN && sugR ? ' New cards fill the rest.' : (sugN ? ' New cards in book order.' : ''));
      if (t.done) line = t.done + ' reviewed today. ' + line;
      if (cur.due >= T) {
        line += ' New cards wait until the due reviews are done.';
      } else {
        line += ' New cards: ' + newUsed + ' of ' + newCap + ' used; ' +
          'they come after the due reviews.';
      }
    } else {
      title = 'All due reviews are done';
      var fresh = mem.total.fresh;
      var room = Math.max(0, newCap - newUsed);
      line = (t.done ? t.done + ' reviewed today. ' : '') +
        (mem.total.dueTomorrow
          ? 'Next due: ' + mem.total.dueTomorrow + ' card' +
            (mem.total.dueTomorrow === 1 ? '' : 's') + ' tomorrow. '
          : 'Nothing is due — the next cards return on their schedule. ');
      if (fresh) {
        var n = Math.min(room, fresh);
        line += fresh + ' card' + (fresh === 1 ? '' : 's') +
          ' were never studied' + (n ? '; up to ' + n + ' can start today.' : '.');
        big = n;
        buttons = (n ? study('Learn ' + n + ' new card' + (n === 1 ? '' : 's')) : '') +
          edit + exp;
      } else {
        line += 'Every card has been introduced.';
        buttons = edit + exp;
      }
    }
    return '<div class="card review-card"><div class="rc-head"><div>' +
      '<h2 style="font-size:22px;font-weight:500;margin:0">' + title + '</h2>' +
      (big ? '<div class="rc-num">' + big + '<small>card' + (big === 1 ? '' : 's') + '</small></div>' : '') +
      '</div>' + subjectChipsHTML(t, mem) + '</div>' +
      '<p class="muted fm-today-line">' + line + '</p>' +
      '<div class="btn-row">' + buttons + '</div></div>';
  }

  /* Same-day day-bound session resumes (steps, history, press count). An
     ad-hoc session is left in place unless opts.replace is set. Returns true
     when a session is on screen. */
  function beginDailyStudy(opts) {
    opts = opts || {};
    var saved = PGRE.store.state.formulaStudy;
    var today = PGRE.srs.today();
    var live = !!(saved && saved.date === today && Array.isArray(saved.queueIds) &&
      saved.queueIds.length);
    if (live && saved.dayBound !== false) {
      var resumed = rehydrateSavedStudy();
      if (sessionHeld) return false;
      if (resumed && resumed.length) { resumeStudy(resumed); return true; }
    }
    if (live && saved.dayBound === false && !opts.replace) return false;
    if (sessionHeld) return false;
    var subject = subjectFilter();
    var cards = subjectFiltered(PGRE.srs.formulaDayRemaining(deck));
    if (!cards.length && opts.fill && PGRE.srs.autoFillFormulaDay) {
      PGRE.srs.autoFillFormulaDay(deck, { subject: subject });
      cards = subjectFiltered(PGRE.srs.formulaDayRemaining(deck));
    }
    if (!cards.length) return false;
    startStudy(cards, true);
    return true;
  }

  /* ——— Review tab home — the daily queue card + the slipping card ——— */
  function renderHome() {
    stopRecallTimer();
    study = null;
    if (studyFromFill) {
      studyFromFill = false;
      if (PGRE.refreshNavBadges) PGRE.refreshNavBadges();
      if (beginDailyStudy()) return;
    }
    if (PGRE.nav) PGRE.nav.setTrail([]);   // back to base (Home ▸ Recall)
    var ui = PGRE.ui, srs = PGRE.srs;

    setMasthead('');
    var html = '';

    if (!deck.length) {
      html += '<div class="card placeholder">' +
        '<p><strong>No cards yet.</strong></p>' +
        '<p class="muted">Cards arrive with the book import in the ' +
        '<a href="#/library">Library</a>, or write your own in the Cards tab — ' +
        'each new subject starts empty.</p></div>';
      body().innerHTML = html;
      PGRE.typesetMath(body());
      PGRE.refreshNavBadges();
      return;
    }

    var mem = PGRE.subjectMemory ? PGRE.subjectMemory(deck) : null;
    if (!mem) {
      mem = { total: { due: 0, dueTomorrow: 0, fresh: 0, oldestOverdue: 0, studied: 0 },
              byId: {} };
    }
    var today = todayState();
    html += todayCardHTML(today, mem);

    if (sessionHeld) {
      var heldMissing = (lastDeckStatus && lastDeckStatus.missing) || [];
      html += '<div class="card" id="deck-hold"><p>The deck read is incomplete' +
        (heldMissing.length ? ' (' + PGRE.ui.esc(heldMissing.join(', ')) + ')' : '') +
        '. This session is waiting so a missing card is not dropped.</p></div>';
    }

    // ——— Cards that keep slipping ———
    var leeches = deck.filter(function (c) {
      return srs.isLeech(srs.cardState(c.id)) && !srs.isSuspended(c.id);
    });
    if (leeches.length) {
      html += '<div class="card"><b style="font-weight:500">' + leeches.length +
        ' card' + (leeches.length === 1 ? ' keeps' : 's keep') + ' slipping</b> ' +
        '<span class="muted">— each has lapsed 8 or more times; a memory hook ' +
        'in its note helps more than another repetition.</span>' +
        '<div class="btn-row"><button class="btn btn-ghost btn-sm" id="leech-drill">Review the ' +
        leeches.length + '</button></div></div>';
    }

    // ——— Check-in footnote ———
    var fci = PGRE.formulaCheckIn && PGRE.formulaCheckIn.status
      ? PGRE.formulaCheckIn.status() : null;
    var foot = '';
    if (fci && fci.current > 0) {
      foot += 'Recall check-in: ' + fci.current + ' day' +
        (fci.current === 1 ? '' : 's') + (fci.best ? ', best ' + fci.best : '') + '. ';
    }
    foot += 'The subject choice stays until you change it; Today always counts every subject.';
    html += '<p class="meta" style="border-top:1px solid var(--line);padding-top:10px">' +
      ui.esc(foot) + '</p>';

    body().innerHTML = html;
    PGRE.typesetMath(body());
    PGRE.refreshNavBadges(); // remaining counts change without a route change

    // Study: the list's remaining cards, or — when nothing is left — the
    // auto-pick the button label promised (srs.suggestFormulaDay).
    var sb = document.getElementById('study-btn');
    if (sb) sb.addEventListener('click', function () {
      if (sessionHeld) return;
      beginDailyStudy({ fill: true });
    });
    var rep = document.getElementById('replace-daily-btn');
    if (rep) rep.addEventListener('click', function () {
      if (sessionHeld) return;
      beginDailyStudy({ replace: true, fill: true });
    });
    var addLate = document.getElementById('add-overdue-btn');
    if (addLate) addLate.addEventListener('click', function () {
      var late = postponedOverdue(subjectFilter());
      if (!late.ids.length || !PGRE.srs.addFormulaDaySoft) return;
      PGRE.srs.addFormulaDaySoft(deck, late.ids);
      renderHome();
    });
    // Life Studio: a subject chip repaints home (queue, counts, picks).
    body().querySelectorAll('.subj-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        PGRE.store.state.settings.recallSubject = chip.getAttribute('data-rsubj');
        PGRE.store.save();
        renderHome();
      });
    });
    var readyBtn = document.getElementById('readiness-choose');
    if (readyBtn) readyBtn.addEventListener('click', renderPicker);
    // Resume the persisted session (re-rehydrate at click time in case the
    // deck/session shifted; fall back to a home refresh if it vanished).
    var rsb = document.getElementById('resume-btn');
    if (rsb) rsb.addEventListener('click', function () {
      var cards = rehydrateSavedStudy();
      if (cards) resumeStudy(cards);
      else renderHome();
    });
    var pb = document.getElementById('pick-btn');
    if (pb) pb.addEventListener('click', renderPicker);
    var heb = document.getElementById('home-export-btn');
    if (heb) heb.addEventListener('click', openFormulaExportModal);
    // Drill the leeches — a normal-grading session independent of the daily
    // batch (these cards may already be studied today; they still surface here).
    // Put-away cards are excluded: a shelved card is very often also a leech,
    // and grading it here would rewrite the schedule the user shelved it to avoid.
    var ld = document.getElementById('leech-drill');
    if (ld) ld.addEventListener('click', function () {
      startStudy(deck.filter(function (c) {
        return PGRE.srs.isLeech(PGRE.srs.cardState(c.id)) && !PGRE.srs.isSuspended(c.id);
      }), false);
    });
  }



  /* Retention over the last 30 days for one maturity bucket (mFlag: 1 = mature,
     0 = young). Only real reviews (n === 1) count; fewer than 20 qualifying
     entries returns null → the caller shows "collecting data". */
  function retentionRate(mFlag) {
    var revs = PGRE.store.state.cardReviews || [];
    var cutoff = PGRE.srs.addDays(-30);
    var pass = 0, total = 0;
    revs.forEach(function (r) {
      if (r.n !== 1 || r.m !== mFlag || r.d < cutoff) return;
      total++;
      if (r.g !== 'again') pass++;
    });
    return total < 20 ? null : pass / total;
  }

  /* 14-day due forecast as pure-div bars. Day 0 = today INCLUDING overdue; days
     1–13 read future due dates from state.cards. Plus a 30-day total line. */
  function forecastHTML() {
    var srs = PGRE.srs;
    var days = [], i;
    for (i = 0; i < 14; i++) days.push(0);
    var total30 = 0;
    var overdue = 0;
    deck.forEach(function (c) {
      var st = srs.cardState(c.id);
      if (!st) return;
      var du = srs.daysUntil(st.due);
      if (du <= 0) {
        days[0]++;
        total30++;
        if (du < 0) overdue++;
      } else {
        if (du <= 13) days[du]++;
        if (du <= 29) total30++;
      }
    });
    var max = 1;
    for (i = 0; i < 14; i++) if (days[i] > max) max = days[i];
    var bars = '';
    var today = new Date(srs.today() + 'T12:00:00');   // the scheduling day, not the clock's
    for (i = 0; i < 14; i++) {
      var n = days[i];
      var pctH = Math.round(100 * n / max);
      var dt = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      var dayLbl = dt.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
      var line2 = n === 1 ? '1 card due' : n + ' cards due';
      if (i === 0 && overdue > 0) line2 += ' · includes ' + overdue + ' overdue';
      bars += '<div class="fc-col" data-tip="' + PGRE.ui.esc(dayLbl + '\\n' + line2) + '">' +
        '<div class="fc-bar' + (n ? '' : ' fc-empty') + '" style="height:' +
        (n ? Math.max(4, pctH) : 0) + '%"></div>' +
        '<span class="fc-x">' + (i === 0 ? 'now' : (i % 7 === 0 ? '+' + i : '')) + '</span></div>';
    }
    return '<div class="mem-forecast"><h3>14-day forecast</h3>' +
      '<div class="forecast-strip">' + bars + '</div>' +
      '<p class="muted forecast-total">' + total30 + ' review' +
      (total30 === 1 ? '' : 's') + ' due in the next 30 days.</p></div>';
  }

  /* ——— Progress tab (design §6.5): the deck's memory picture — headline
     stats, interval mix by subject, retention by month, the 14-day
     forecast, and the recall settings card. ——— */

  /* Retention by month, all subjects: live cardReviews rows grouped by
     month + the folded reviewMonths totals for months that aged out of the
     log. Returns rows [{key, label, n, young, held}] newest last; each
     bucket is null when it has no reviews ("collecting"). */
  function retentionByMonth() {
    var months = {};
    function slot(d) {
      var mk = String(d || '').slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(mk)) return null;
      return months[mk] || (months[mk] = { key: mk, n: 0, yR: 0, yA: 0, mR: 0, mA: 0 });
    }
    var folded = PGRE.store.state.reviewMonths || {};
    Object.keys(folded).forEach(function (mk) {
      var m = folded[mk];
      Object.keys(m).forEach(function (sid) {
        var r = m[sid];
        var s = slot(mk);
        if (!s || !r) return;
        s.yR += r.yR || 0; s.yA += r.yA || 0;
        s.mR += r.mR || 0; s.mA += r.mA || 0;
      });
    });
    (PGRE.store.state.cardReviews || []).forEach(function (r) {
      if (!r || r.n !== 1) return;
      var s = slot(r.d);
      if (!s) return;
      if (r.m) { s.mR++; if (r.g === 'again') s.mA++; }
      else { s.yR++; if (r.g === 'again') s.yA++; }
    });
    var rows = [];
    Object.keys(months).sort().forEach(function (mk) {
      var s = months[mk];
      s.n = s.yR + s.mR;
      if (!s.n) return;
      var p = mk.split('-');
      s.label = new Date(+p[0], +p[1] - 1, 1)
        .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      s.young = s.yR < 20 ? null : Math.round(100 * (s.yR - s.yA) / s.yR) + '%';
      s.held = s.mR < 20 ? null : Math.round(100 * (s.mR - s.mA) / s.mR) + '%';
      rows.push(s);
    });
    return rows;
  }

  function renderProgress() {
    setMasthead('');
    teardownGame();
    if (PGRE.nav) PGRE.nav.setTrail([{ label: 'Progress' }]);
    var ui = PGRE.ui;
    var mem = PGRE.subjectMemory ? PGRE.subjectMemory(deck) : null;
    var html = '';

    if (!mem || !deck.length) {
      html += '<div class="card"><p class="muted">No cards yet — progress shows up once the first card is studied.</p></div>';
      body().innerHTML = html;
      return;
    }

    var t = mem.total;
    var acc30 = t.acc30 == null ? '—'
      : '<span>' + t.acc30 + '%</span>';
    var acc30sub = t.acc30 == null
      ? 'collecting — a read arrives after more reviews'
      : 'of real reviews not graded Again';
    function stat(v, k, s) {
      return '<div class="stat-tile"><div class="stat-big">' + v + '</div>' +
        '<div class="stat-k">' + ui.esc(k) + '</div>' +
        (s ? '<div class="stat-s">' + ui.esc(s) + '</div>' : '') + '</div>';
    }
    html += '<div class="ls-grid4">' +
      stat(ui.fmt(t.held), 'Held 3 weeks or more', 'of ' + ui.fmt(t.studied) + ' cards studied') +
      stat(acc30, '30-day retention', acc30sub) +
      stat(t.medianIvl + ' d', 'Median interval', 'all subjects') +
      stat(ui.fmt(t.lifeDen), 'Lifetime reviews', 'real reviews only, every subject') +
    '</div>';

    // Memory horizon by subject: one row per subject, interval mix inline.
    var rows = '';
    (PGRE.SUBJECTS || []).forEach(function (s) {
      var e = mem.byId[s.id];
      var chip = '<span class="mono-chip">' + ui.esc(s.code || '') + '</span>';
      if (!e || !e.cards) {
        rows += '<tr class="dim"><td>' + chip + '</td><td>' + ui.esc(s.name) +
          '</td><td class="bar-col">No cards yet</td><td class="n">–</td>' +
          '<td class="n">–</td><td class="n">–</td></tr>';
        return;
      }
      rows += '<tr><td>' + chip + '</td>' +
        '<td><a class="ls-link" href="#/subject/' + ui.esc(s.id) + '">' + ui.esc(s.name) + '</a></td>' +
        '<td class="bar-col" style="min-width:200px">' +
          (PGRE.subjectHzHTML ? PGRE.subjectHzHTML(e, s.id) : '') + '</td>' +
        '<td class="n">' + e.medianIvl + ' d</td>' +
        '<td class="n">' + (e.acc30 == null ? 'collecting' : e.acc30 + '%') + '</td>' +
        '<td class="n">' + ui.fmt(e.lifeDen) + '</td></tr>';
    });
    html += '<div class="card" style="margin-top:16px"><div class="sec-title">Memory horizon by subject</div>' +
      '<p class="muted">Each card’s interval is how long the scheduler waits before ' +
      'asking it again; every success stretches it. The bar is the mix of intervals ' +
      'today. Over the years it should move right.</p>' +
      '<table class="ls-tbl"><thead><tr><th></th><th>Subject</th>' +
      '<th class="bar-col">Interval mix</th><th>Median</th><th>30-day retention</th>' +
      '<th>Lifetime reviews</th></tr></thead><tbody>' + rows + '</tbody></table></div>';

    // Retention by month: live log + folded months (reviewMonths, decision 7).
    var mrows = retentionByMonth();
    html += '<div class="card"><div class="sec-title">Retention by month</div>' +
      '<p class="muted">Share of real reviews not graded Again, split by cards ' +
      'under and over ' + matureDays() + ' days. Read from the review log plus its ' +
      'monthly summary — older months stay counted after the log trims itself.</p>';
    if (!mrows.length) {
      html += '<p class="muted">No reviews yet — the first month appears after cards are studied.</p></div>';
    } else {
      html += '<table class="ls-tbl"><thead><tr><th>Month</th><th>Reviews</th>' +
        '<th>Young cards</th><th>Held ' + matureDays() + ' days or more</th></tr></thead><tbody>' +
        mrows.map(function (m) {
          return '<tr><td>' + ui.esc(m.label) + '</td><td class="n">' + ui.fmt(m.n) + '</td>' +
            '<td class="n">' + (m.young == null ? 'collecting' : m.young) + '</td>' +
            '<td class="n">' + (m.held == null ? 'collecting' : m.held) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }

    // Next 14 days + a pointer to the study-time page.
    html += '<div class="ls-grid2">' +
      '<div class="card"><div class="sec-title">Next 14 days</div>' +
        '<div class="muted">Cards due per day, all subjects</div>' + forecastHTML() + '</div>' +
      '<div class="card"><div class="sec-title">Study days</div>' +
        '<p class="muted">Days studied and hours per day for the last 12 months are ' +
        'on the Study time page; the daily study log keeps every day.</p>' +
        '<div class="btn-row"><a class="btn btn-ghost btn-sm" href="#/study-time">Open Study time</a></div></div>' +
    '</div>';

    // Per-subject recall sections (collapsed), then the settings card.
    var sections = '';
    (PGRE.SUBJECTS || []).forEach(function (s) {
      var e = mem.byId[s.id];
      if (!e || !e.cards) return;
      sections += '<div class="card">' +
        (PGRE.subjectRecallHTML ? PGRE.subjectRecallHTML(s.id, e, { collapse: true }) : '') +
        '</div>';
    });
    if (sections) html += sections;

    html += '<div class="card"><div class="sec-title">Recall settings</div>' +
      '<p class="muted" style="margin-top:8px">Limits, direction and resets live in ' +
      '<a href="#/settings">Settings › Study</a> and Settings › Data now.</p></div>';

    body().innerHTML = html;
    PGRE.typesetMath(body());
    // The collapsed subject sections' slip drill opens an ad-hoc round here.
    body().querySelectorAll('[data-drill-slips]').forEach(function (b) {
      b.addEventListener('click', function () {
        var sid = b.getAttribute('data-drill-slips');
        var ids = (mem.byId[sid] || { slipList: [] }).slipList;
        var cards = deck.filter(function (c) {
          return ids.indexOf(c.id) !== -1 && !PGRE.srs.isSuspended(c.id);
        });
        if (cards.length) startStudy(cards, false);
      });
    });
    PGRE.refreshNavBadges();
  }

  /* ——— Practice tab: the four game modes as tiles (design §6.5). ——— */
  function renderPractice() {
    setMasthead('');
    teardownGame();
    if (PGRE.nav) PGRE.nav.setTrail([{ label: 'Practice' }]);
    var games = [
      ['match', 'Match', 'Timed pairing of fronts and backs.'],
      ['type', 'Type', 'See the front, type the answer, then grade yourself.'],
      ['quiz', 'Quiz', 'Multiple choice drawn from the deck. List cards are asked only against list cards.'],
      ['cloze', 'Cloze', 'One blanked term; pick what goes in the box. Formula cards only.']
    ];
    var html = '<div class="ls-grid2">' + games.map(function (g) {
      return '<div class="card ls-tool"><div class="sec-title" style="margin:0">' + g[1] + '</div>' +
        '<div class="muted">' + g[2] + '</div>' +
        '<div class="btn-row"><button class="btn btn-ghost btn-sm" data-game="' + g[0] + '">Play ' + g[1] + '</button></div></div>';
    }).join('') + '</div>' +
      '<p class="meta" style="margin-top:10px">The subject chips from Review apply ' +
      'here too. Match, Type and Cloze skip book list cards, as today. The Lab ' +
      'moved to <a class="ls-link" href="#/subject/physics/lab">Physics › Visualizers</a>.</p>';
    body().innerHTML = html;
    body().querySelectorAll('[data-game]').forEach(function (b) {
      b.addEventListener('click', function () {
        switchMode(b.getAttribute('data-game'));
      });
    });
  }



  /* Date + grade list from the append-only cardReviews log. Newest first.
     Empty shows a short line (never a blank gap). Viewing never mutates. */
  function reviewHistoryHTML(id) {
    var ui = PGRE.ui;
    var log = (PGRE.store.state && PGRE.store.state.cardReviews) || [];
    var rows = [];
    if (PGRE.srs && typeof PGRE.srs.listCardReviews === 'function') {
      rows = PGRE.srs.listCardReviews(log, id) || [];
    }
    var wrap = '<div class="card-review-hist" data-card-hist="' + ui.esc(id) + '">' +
      '<div class="card-review-hist-head">Review history</div>';
    if (!rows.length) {
      return wrap +
        '<p class="muted card-review-hist-empty-line">No reviews recorded. Reviews from before this log cannot be recovered.</p></div>';
    }
    var items = '';
    rows.forEach(function (r) {
      var g = r.g;
      var label = Object.prototype.hasOwnProperty.call(GRADE_LABEL, g) ? GRADE_LABEL[g] : g;
      var cls = (PGRE.srs && typeof PGRE.srs.isMemGrade === 'function' && PGRE.srs.isMemGrade(g))
        ? (' grade-' + g) : '';
      items += '<li><time datetime="' + ui.esc(r.d) + '">' + ui.esc(r.d) +
        '</time> <span class="grade-chip' + cls + '">' + ui.esc(label) + '</span></li>';
    });
    var cap = log.length >= 8000
      ? '<p class="muted card-review-hist-note">Recent reviews only — the log keeps the latest 8000 across all cards.</p>'
      : '';
    return wrap +
      '<p class="muted card-review-hist-order">Newest first.</p>' +
      cap +
      '<ol class="card-review-hist-list">' + items + '</ol></div>';
  }

  /* ——— Picker SRS tooltip ———
     One shared fixed popover for .picker-row / .pick-cart-row (reuses the
     .chart-tip chrome with .srs-tip pill content). renderPicker() assigns
     pickTipFor — a card → pill-rows HTML closure — each render; document
     listeners are delegated so group re-paints and list reorders never need
     rewiring. A short hover delay keeps a fast pass over the rows quiet;
     focus shows it at once for keyboard users. pointer-events:none so it
     can never steal hover or clicks from the row. */
  var pickTipEl = null, pickTipRow = null, pickTipTimer = 0, pickTipFor = null;
  var PICK_TIP_MS = 220;

  function pickTipHost() {
    if (pickTipEl && pickTipEl.isConnected) return pickTipEl;
    pickTipEl = document.createElement('div');
    pickTipEl.className = 'chart-tip srs-tip';
    pickTipEl.setAttribute('role', 'tooltip');
    pickTipEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(pickTipEl);
    return pickTipEl;
  }
  function pickTipTarget(node) {
    if (!node || node.nodeType !== 1) node = node && node.parentNode;
    if (!node || typeof node.closest !== 'function') return null;
    var row = node.closest('.picker-row') || node.closest('.pick-cart-row');
    return row && row.getAttribute('data-cardid') ? row : null;
  }
  function hidePickTip() {
    clearTimeout(pickTipTimer);
    pickTipTimer = 0;
    pickTipRow = null;
    if (!pickTipEl) return;
    pickTipEl.classList.remove('is-on');
    pickTipEl.setAttribute('aria-hidden', 'true');
  }
  function showPickTip(row) {
    var el = pickTipHost();
    el.innerHTML = pickTipFor(row.getAttribute('data-cardid'));
    pickTipRow = row;
    var r = row.getBoundingClientRect();
    var pad = 8, w = el.offsetWidth, h = el.offsetHeight;
    var left = r.left + 12;
    if (left + w > window.innerWidth - pad) left = window.innerWidth - w - pad;
    if (left < pad) left = pad;
    var top = r.bottom + 8;
    if (top + h > window.innerHeight - pad) top = r.top - h - 8;
    if (top < pad) top = pad;
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
    el.classList.add('is-on');
    el.setAttribute('aria-hidden', 'false');
  }
  function wantPickTip(row) {
    if (!row) { hidePickTip(); return; }
    clearTimeout(pickTipTimer);
    if (pickTipRow === row) return;              // already showing for this row
    // A tip already on-screen hops to the next row without the delay.
    if (pickTipRow && pickTipRow.isConnected) { showPickTip(row); return; }
    pickTipTimer = setTimeout(function () {
      pickTipTimer = 0;
      if (!row.isConnected) return;
      showPickTip(row);
    }, PICK_TIP_MS);
  }
  document.addEventListener('mouseover', function (e) {
    if (!pickTipFor) return;
    wantPickTip(pickTipTarget(e.target));
  });
  document.addEventListener('mouseout', function (e) {
    if (!pickTipFor) return;
    if (pickTipTarget(e.relatedTarget)) return;  // slid onto a neighbouring row
    hidePickTip();
  });
  document.addEventListener('focusin', function (e) {
    if (!pickTipFor) return;
    var row = pickTipTarget(e.target);
    if (!row) return;
    clearTimeout(pickTipTimer);
    pickTipTimer = 0;
    showPickTip(row);
  });
  document.addEventListener('focusout', function (e) {
    if (!pickTipFor) return;
    if (pickTipTarget(e.relatedTarget)) return;
    hidePickTip();
  });
  document.addEventListener('scroll', hidePickTip, true);
  document.addEventListener('pointerdown', hidePickTip);

  /* ——— Today's list composer ("Choose cards" / "Edit today's list") ———
     Two panes over one draft list. Left: every card, grouped as Due now plus
     the book chapters — groups start collapsed and paint their rows only when
     opened, so the 350-card deck is never one wall. Right: today's list
     itself, always in view, with Fill (the srs.suggestFormulaDay auto-pick)
     and Clear. A checkbox means exactly one thing: in today's list. Cards
     graded today are locked. Nothing persists until Study or Save
     (srs.setFormulaDayPicks); Cancel drops the draft. With no active picks
     the draft opens pre-filled with the auto-pick, so the default is a
     sensible day's work rather than a blank list. */
  function renderPicker() {
    setMasthead('');
    if (PGRE.nav) PGRE.nav.setTrail(['Today’s cards']);   // BUNDLE G
    var ui = PGRE.ui, srs = PGRE.srs;
    var batch = srs.formulaDay(deck);
    var T = srs.clampTarget(PGRE.store.state.settings.formulaDailyTarget);
    var byId = Object.create(null);
    deck.forEach(function (c) { byId[c.id] = c; });

    var list = [], inList = Object.create(null), locked = Object.create(null);
    function addId(id) {
      if (!id || inList[id] || locked[id] || !byId[id]) return false;
      inList[id] = 1;
      list.push(id);
      return true;
    }
    function removeId(id) {
      if (!inList[id]) return false;
      delete inList[id];
      list.splice(list.indexOf(id), 1);
      return true;
    }
    // Lock only a card graded today that is already in the batch. An Again
    // that is due today but was not in the list stays selectable, so it can
    // be added and studied. In-list Again / Good stay fixed.
    var today = srs.today();
    var batchIds = Object.create(null);
    batch.reviewIds.concat(batch.newIds).forEach(function (id) { batchIds[id] = 1; });
    deck.forEach(function (c) {
      var st = srs.cardState(c.id);
      if (batchIds[c.id] && srs.studiedToday(st)) {
        locked[c.id] = st.due <= today ? 'again' : 'done';
      }
    });
    var againIds = [], doneN = 0;
    batch.reviewIds.concat(batch.newIds).forEach(function (id) {
      if (locked[id] === 'again' && byId[id]) againIds.push(id);
      else addId(id);
    });
    Object.keys(locked).forEach(function (id) { if (locked[id] === 'done') doneN++; });

    function suggestion(room) {
      return srs.suggestFormulaDay(deck, { have: inList, room: room });
    }
    function takeSuggestion(room) {
      var sug = suggestion(room);
      sug.reviewIds.concat(sug.newIds).forEach(addId);
      return sug.reviewIds.length + sug.newIds.length;
    }
    // Same rule as the home Study button: auto-pick only when nothing remains.
    var prefilled = !list.length && !againIds.length && takeSuggestion(T) > 0;

    // ——— groups: Due now (most overdue first) + book chapters ———
    var dueCards = [];
    deck.forEach(function (c, idx) {
      var st = srs.cardState(c.id);
      if (st && !srs.isSuspended(c.id) && srs.daysUntil(st.due) <= 0) {
        dueCards.push({ c: c, due: st.due, idx: idx });
      }
    });
    dueCards.sort(function (x, y) {
      if (x.due !== y.due) return x.due < y.due ? -1 : 1;
      return x.idx - y.idx;
    });
    dueCards = dueCards.map(function (x) { return x.c; });

    var byChapter = {}, chOrder = [];
    deck.forEach(function (c) {
      var ch = srs.formulaChapter(c.id);
      var key = isFinite(ch) ? String(ch) : 'other';
      if (!byChapter[key]) { byChapter[key] = []; chOrder.push(key); }
      byChapter[key].push(c);
    });
    chOrder.sort(function (a, b) {
      if (a === 'other') return 1;
      if (b === 'other') return -1;
      return parseInt(a, 10) - parseInt(b, 10);
    });

    function chapterTopic(cards) {
      var counts = {}, best = '', n = -1;
      cards.forEach(function (c) { counts[c.topic || ''] = (counts[c.topic || ''] || 0) + 1; });
      Object.keys(counts).forEach(function (t) {
        if (counts[t] > n) { n = counts[t]; best = t; }
      });
      return PGRE.topicById(best);
    }
    function chapterTitle(key, cards) {
      if (key === 'other') return 'Supplements';
      var topic = chapterTopic(cards);
      return 'Chapter ' + key + (topic ? ' · ' + topic.name : '');
    }
    function groupCards(tp) {
      return tp.getAttribute('data-group') === 'due'
        ? dueCards : (byChapter[tp.getAttribute('data-ch')] || []);
    }
    function groupMeta(cards) {
      var due = 0, fresh = 0;
      cards.forEach(function (c) {
        var st = srs.cardState(c.id);
        if (srs.isSuspended(c.id)) return;
        if (!st) fresh++;
        else if (srs.daysUntil(st.due) <= 0) due++;
      });
      var bits = [];
      if (due) bits.push(due + ' due');
      if (fresh) bits.push(fresh + ' new');
      if (!bits.length) bits.push('all learned');
      return bits.join(' · ') + ' · ' + cards.length + ' cards';
    }

    var hay = Object.create(null);
    deck.forEach(function (c) {
      hay[c.id] = (c.id + ' ' + cardName(c) + ' ' + (c.tag || '') + ' ' + (c.eq || '') + ' ' +
        (c.front || '') + ' ' + (c.back || '')).toLowerCase();
    });
    var filterQ = '';
    function cardMatches(c) {
      return !filterQ || (hay[c.id] && hay[c.id].indexOf(filterQ) !== -1);
    }

    function cardLabel(c) {
      var eq = c.eq && c.eq !== 'supp' ? 'Eq ' + c.eq : '';
      var name = cardName(c);
      return [name, eq].filter(Boolean).join(' · ') || c.id;
    }
    function statusText(c) {
      var st = srs.cardState(c.id);
      if (locked[c.id]) return locked[c.id] === 'again' ? 'again today' : 'done today';
      if (srs.isSuspended(c.id)) return 'parked';
      if (!st) return 'new';
      var du = srs.daysUntil(st.due);
      return du <= 0 ? 'due now' : 'due in ' + srs.ivlLabel(du);
    }
    function metaHTML(c) {
      var status = statusText(c);
      var sched = status.slice(0, 6) === 'due in';
      return '<div class="picker-meta">' + ui.esc(cardLabel(c)) + ' · ' +
        '<span class="picker-status' + (status === 'due now' ? ' is-due' : '') +
          (sched ? ' is-scheduled' : '') + '">' +
        status + '</span></div>';
    }
    /* Styled popover content (pickTip component above): the same
       srs.cardState fields the title= tooltip carried, laid out as the
       app's pill rows — status chip first, then stat pills. */
    function tipHTML(id) {
      var c = byId[id];
      if (!c) return '';
      var chips, note = '';
      if (locked[id]) {
        chips = '<span class="grade-chip grade-' + locked[id] + '">' +
          (locked[id] === 'again' ? 'again today' : 'done today') + '</span>';
        note = locked[id] === 'again'
          ? 'Due again today — stays in today’s list'
          : 'Already graded today';
      } else if (srs.isSuspended(id)) {
        chips = '<span class="due-chip suspended-chip">parked</span>';
        note = 'No scheduled reviews';
      } else {
        var st = srs.cardState(id);
        if (!st) {
          chips = '<span class="due-chip">new</span>';
          note = 'No grades yet';
        } else {
          var du = srs.daysUntil(st.due);
          chips = '<span class="due-chip' + (du <= 0 ? ' due-now' : '') + '">' +
            (du < 0 ? 'overdue ' + (-du) + 'd' : du === 0 ? 'due today' : 'due ' + ui.esc(st.due)) +
            '</span>' +
            '<span class="srs-tip-pill">ease ' + (st.ease || 0).toFixed(2) + '</span>' +
            '<span class="srs-tip-pill">interval ' + ui.esc(srs.ivlLabel(st.interval)) + '</span>' +
            '<span class="srs-tip-pill">lapses ' + (st.lapses || 0) + '</span>' +
            '<span class="srs-tip-pill">reps ' + (st.reps || 0) + '</span>';
          if (st.reviews) chips += '<span class="srs-tip-pill">reviews ' + st.reviews + '</span>';
          if (st.lastGrade) chips += '<span class="grade-chip grade-' + ui.esc(st.lastGrade) +
            '">last ' + ui.esc(st.lastGrade) + '</span>';
        }
      }
      return '<div class="srs-tip-row">' + chips + '</div>' +
        (note ? '<div class="srs-tip-note">' + ui.esc(note) + '</div>' : '');
    }
    pickTipFor = tipHTML;

    function rowHTML(c) {
      var id = ui.esc(c.id), on = !!inList[c.id], isLocked = !!locked[c.id];
      var label = ui.esc(cardLabel(c));
      var st = srs.cardState(c.id);
      var sched = !isLocked && st && srs.daysUntil(st.due) > 0;  // in the queue, not due yet
      return '<div class="picker-item">' +
        '<div class="picker-row' + (isLocked ? ' is-locked' : '') + (on ? ' is-picked' : '') +
          (sched ? ' is-scheduled' : '') +
          '" data-cardid="' + id + '">' +
          '<label class="picker-check"><input type="checkbox" class="picker-box" value="' + id + '"' +
            ' aria-label="' + (isLocked ? label + ' — ' + statusText(c) : 'Today’s list: ' + label) + '"' +
            (on || isLocked ? ' checked' : '') + (isLocked ? ' disabled' : '') + '></label>' +
          '<div class="picker-text">' +
            '<div class="picker-prompt">' + formulaHTML(c.front) + '</div>' +
            metaHTML(c) +
          '</div>' +
          '<button type="button" class="btn btn-ghost btn-sm picker-peek-btn" ' +
            'aria-expanded="false">Formula</button>' +
        '</div>' +
        '<div class="browse-peek picker-peek picker-preview" hidden></div>' +
      '</div>';
    }

    function groupHTML(attrs, title, meta, mono) {
      return '<div class="picker-topic" ' + attrs + '>' +
        '<div class="picker-topic-head">' +
          '<span class="picker-ch-toggle" role="button" tabindex="0" aria-expanded="false">' +
            (mono ? mono + ' ' : '') + '<span class="picker-ch-title">' + ui.esc(title) + '</span>' +
            '<span class="muted picker-ch-count">' + ui.esc(meta) + '</span>' +
          '</span>' +
          '<label class="picker-selall"><input type="checkbox" class="picker-selall-box"> All</label>' +
        '</div>' +
        '<div class="picker-chapter-body" hidden></div>' +
      '</div>';
    }


    var html = '<div class="card picker">' +
      '<h2>Today’s cards</h2>' +
      '<p class="muted picker-intro">Tick any card to add it to today’s list. ' +
      'Fill tops the list up the way Study would: due reviews first, then new cards in book order.</p>' +
      '<div class="picker-grid">' +
      '<section class="picker-lib" aria-label="All cards">' +
        '<input type="search" class="picker-filter" id="picker-filter" ' +
          'placeholder="Find a card — words from the prompt, a name, or an eq. number" ' +
          'aria-label="Find a card">' +
        '<div id="picker-groups">';
    if (dueCards.length) {
      html += groupHTML('data-group="due"', 'Due now', dueCards.length + ' cards', '');
    }
    chOrder.forEach(function (key) {
      var cards = byChapter[key];
      var topic = key === 'other' ? null : chapterTopic(cards);
      html += groupHTML('data-group="chapter" data-ch="' + ui.esc(key) + '"',
        chapterTitle(key, cards), groupMeta(cards), topic ? ui.monogram(topic) : '');
    });
    html += '</div><p class="muted picker-empty" id="picker-empty" hidden>No card matches.</p>' +
      '</section>' +
      '<aside class="pick-cart" aria-label="Today’s list">' +
        '<div class="pick-cart-head"><h3>Today’s list</h3>' +
          '<span class="pick-cart-count" id="picker-count"></span></div>' +
        '<p class="pick-cart-mix" id="picker-mix"></p>' +
        '<div class="pick-cart-tools">' +
          '<button type="button" class="btn btn-ghost btn-sm" id="picker-fill"></button>' +
          '<button type="button" class="btn btn-ghost btn-sm" id="picker-add-overdue">Add overdue</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" id="picker-clear">Clear</button>' +
        '</div>' +
        '<p class="pick-cart-note" id="picker-note"' + (prefilled ? '' : ' hidden') + '>' +
          'Suggested for today — remove anything, or tick more cards.</p>' +
        '<ol class="pick-cart-list" id="picker-list"></ol>' +
        '<div class="pick-cart-actions">' +
          '<button type="button" class="btn btn-primary" id="picker-study"></button>' +
          '<button type="button" class="btn btn-ghost" id="picker-save">Save</button>' +
          '<button type="button" class="btn btn-ghost" id="picker-cancel">Cancel</button>' +
        '</div>' +
      '</aside></div></div>';

    body().innerHTML = html;

    // ——— right pane: today's list ———
    function cartRowHTML(id) {
      var c = byId[id], fixed = !!locked[id];
      var label = ui.esc(cardLabel(c));
      return '<li class="pick-cart-row' + (fixed ? ' is-locked' : '') + '" data-cardid="' + ui.esc(id) + '">' +
        '<div class="pick-cart-text">' +
          '<div class="pick-cart-prompt">' + formulaHTML(c.front) + '</div>' +
          metaHTML(c) +
        '</div>' +
        (fixed ? '' : '<button type="button" class="pick-cart-rm" data-rm="' + ui.esc(id) + '" ' +
          'aria-label="Remove ' + label + ' from today’s list">&times;</button>') +
      '</li>';
    }

    function paintCart(scrollToEnd) {
      var box = document.getElementById('picker-list');
      if (!box) return;
      var keep = box.scrollTop;
      var rows = list.concat(againIds);
      box.innerHTML = rows.length ? rows.map(cartRowHTML).join('')
        : '<li class="pick-cart-empty muted">Nothing in the list yet. Use Fill, or tick any card.</li>';
      if (PGRE.typesetMath) PGRE.typesetMath(box);
      box.querySelectorAll('[data-rm]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (removeId(b.getAttribute('data-rm'))) changed(false);
        });
      });
      box.scrollTop = scrollToEnd ? box.scrollHeight : keep;
    }

    function refreshCart(scrollToEnd) {
      var n = list.length + againIds.length, rev = againIds.length;
      list.forEach(function (id) { if (srs.cardState(id)) rev++; });
      var cc = document.getElementById('picker-count');
      if (cc) cc.textContent = n + ' / ' + T;
      var mix = document.getElementById('picker-mix');
      if (mix) {
        var bits = [rev + ' review' + (rev === 1 ? '' : 's'), (n - rev) + ' new'];
        if (doneN) bits.push(doneN + ' done today');
        mix.textContent = bits.join(' · ');
      }
      var room = T - n;
      var more = room <= 0;
      var fill = document.getElementById('picker-fill');
      if (fill) {
        var sug = suggestion(more ? T : room);
        fill.textContent = more ? 'Add ' + T + ' more' : 'Fill to ' + T;
        fill.disabled = !(sug.reviewIds.length + sug.newIds.length);
        fill.title = fill.disabled ? 'Nothing left to add — no due reviews or new cards' : '';
      }
      var clr = document.getElementById('picker-clear');
      if (clr) clr.disabled = !list.length;
      var sb = document.getElementById('picker-study');
      if (sb) {
        sb.textContent = n ? 'Study ' + n + ' card' + (n === 1 ? '' : 's') : 'Study';
        sb.disabled = !n;
      }
      paintCart(scrollToEnd);
    }

    // ——— left pane: groups + rows ———
    function isOpen(tp) { return tp.getAttribute('data-open') === '1' || filterQ.length >= 2; }

    function syncRow(row) {
      var id = row.getAttribute('data-cardid');
      var on = !!inList[id] || !!locked[id];
      var box = row.querySelector('.picker-box');
      if (box) box.checked = on;
      row.classList.toggle('is-picked', !!inList[id]);
    }

    function syncHead(tp) {
      var cards = groupCards(tp).filter(function (c) { return !locked[c.id] && cardMatches(c); });
      var sa = tp.querySelector('.picker-selall-box');
      if (!sa) return;
      var n = 0;
      cards.forEach(function (c) { if (inList[c.id]) n++; });
      sa.disabled = !cards.length;
      sa.checked = cards.length > 0 && n === cards.length;
      sa.indeterminate = n > 0 && n < cards.length;
    }

    function groups() { return body().querySelectorAll('#picker-groups .picker-topic'); }

    function changed(scrollToEnd) {
      body().querySelectorAll('#picker-groups .picker-row').forEach(syncRow);
      groups().forEach(syncHead);
      var note = document.getElementById('picker-note');
      if (note) note.hidden = true;   // the draft is the user's own now
      refreshCart(scrollToEnd);
    }

    function toggleCard(id) {
      if (!id || locked[id]) return;
      if (inList[id]) { removeId(id); changed(false); }
      else { addId(id); changed(true); }
    }

    function openPreview(item, btn) {
      var peek = item.querySelector('.picker-preview');
      if (!peek) return;
      var open = peek.hidden;
      if (open && !peek.getAttribute('data-filled')) {
        var c = byId[item.querySelector('.picker-row').getAttribute('data-cardid')];
        peek.innerHTML = '<div class="fcard-back">' + backHTML(c) + '</div>' +
          '<div class="btn-row peek-similar-row">' + similarButton(c, 'btn-sm') + '</div>';
        peek.setAttribute('data-filled', '1');
        if (PGRE.typesetMath) PGRE.typesetMath(peek);
        wireSimilar(peek);
      }
      peek.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.textContent = open ? 'Hide' : 'Formula';
    }

    function wireRows(wrap) {
      wrap.querySelectorAll('.picker-item').forEach(function (item) {
        var row = item.querySelector('.picker-row');
        var box = row.querySelector('.picker-box');
        if (box && !box.disabled) box.addEventListener('change', function () { toggleCard(box.value); });
        var pbtn = row.querySelector('.picker-peek-btn');
        if (pbtn) pbtn.addEventListener('click', function (e) {
          e.stopPropagation();
          openPreview(item, pbtn);
        });
        row.addEventListener('click', function (e) {
          if (e.target.closest('.picker-check') || e.target.closest('button')) return;
          if (box && !box.disabled) toggleCard(box.value);
        });
      });
    }

    function paintGroup(tp) {
      var wrap = tp.querySelector('.picker-chapter-body');
      var toggle = tp.querySelector('.picker-ch-toggle');
      var open = isOpen(tp);
      if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (!wrap) return;
      if (!open) { wrap.innerHTML = ''; wrap.hidden = true; return; }
      var rows = '';
      groupCards(tp).forEach(function (c) { if (cardMatches(c)) rows += rowHTML(c); });
      wrap.innerHTML = rows;
      wrap.hidden = false;
      if (PGRE.typesetMath) PGRE.typesetMath(wrap);
      wireRows(wrap);
    }

    function applyFilter() {
      var any = false;
      groups().forEach(function (tp) {
        var isDue = tp.getAttribute('data-group') === 'due';
        // While searching, the Due group would only repeat chapter rows.
        var show = filterQ.length >= 2 ? (!isDue && groupCards(tp).some(cardMatches)) : true;
        tp.hidden = !show;
        if (show) any = true;
        if (show) paintGroup(tp);
        syncHead(tp);
      });
      var empty = document.getElementById('picker-empty');
      if (empty) empty.hidden = any;
    }

    groups().forEach(function (tp) {
      var toggle = tp.querySelector('.picker-ch-toggle');
      function flip() {
        if (filterQ.length >= 2) return;   // search results stay expanded
        if (tp.getAttribute('data-open') === '1') tp.removeAttribute('data-open');
        else tp.setAttribute('data-open', '1');
        paintGroup(tp);
      }
      if (toggle) {
        toggle.addEventListener('click', function (e) { e.preventDefault(); flip(); });
        toggle.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          flip();
        });
      }
      var sa = tp.querySelector('.picker-selall-box');
      if (sa) sa.addEventListener('change', function () {
        var on = sa.checked;
        groupCards(tp).forEach(function (c) {
          if (locked[c.id] || !cardMatches(c)) return;
          if (on) addId(c.id); else removeId(c.id);
        });
        changed(on);
      });
    });

    var filter = document.getElementById('picker-filter');
    if (filter) filter.addEventListener('input', function () {
      var q = filter.value.trim().toLowerCase();
      filterQ = q.length >= 2 ? q : '';
      applyFilter();
    });

    document.getElementById('picker-fill').addEventListener('click', function () {
      var room = T - list.length - againIds.length;
      if (takeSuggestion(room > 0 ? room : T)) changed(true);
    });
    var addOver = document.getElementById('picker-add-overdue');
    if (addOver) addOver.addEventListener('click', function () {
      var added = 0;
      deck.forEach(function (c) {
        if (inList[c.id] || locked[c.id] || srs.isSuspended(c.id)) return;
        var st = srs.cardState(c.id);
        if (!st || srs.daysUntil(st.due) > 0) return;
        if (addId(c.id)) added++;
      });
      if (added) changed(true);
    });
    document.getElementById('picker-clear').addEventListener('click', function () {
      list.slice().forEach(removeId);
      changed(false);
    });
    document.getElementById('picker-cancel').addEventListener('click', renderHome);
    function save() {
      PGRE.srs.setFormulaDayPicks(deck, list);
    }
    document.getElementById('picker-save').addEventListener('click', function () {
      save();
      renderHome();
    });
    document.getElementById('picker-study').addEventListener('click', function () {
      save();
      // A same-day day-bound session resumes, steps included. An ad-hoc
      // session is left in place; home already offers Resume and Replace.
      if (!beginDailyStudy()) renderHome();
    });

    groups().forEach(syncHead);
    refreshCart(false);
  }

  /* dayBound === false marks an ad-hoc session (leech drill, search "Study
     these N") whose queue is independent of today's list. List sessions keep
     the default true so a resume follows mid-session batch edits. */
  function startStudy(cards, dayBound) {
    if (!cards.length) return;
    if (PGRE.nav) PGRE.nav.setTrail(['Study']);   // BUNDLE G: session is live
    var queue = interleaveByTopic(cards);
    var known = Object.create(null);
    queue.forEach(function (c) { if (c && c.id) known[c.id] = 1; });
    study = { id: newStudyId(), queue: queue, total: cards.length, done: 0,
              doneBase: 0, again: 0, againBase: 0, xp: 0, flipped: false,
              history: [], peek: null,
              overlay: null, steps: {}, undo: [], pressCount: 0,
              dayBound: dayBound !== false,
              sessionDate: PGRE.srs.today(),
              knownIds: known,
              pendingOverlays: [], settled: false,
              roster: [], seenRoster: Object.create(null),
              currentId: queue[0] && queue[0].id, reviewing: false };
    rememberRoster(queue);
    persistStudy();          // ITEM 2: snapshot the fresh order so a resume matches
    PGRE.store.save();
    renderCard();
  }

  function padRecall(n) {
    n = Math.abs(n) | 0;
    return (n < 10 ? '0' : '') + n;
  }

  function formatRecallTimer(elapsedSec) {
    elapsedSec = Math.max(0, elapsedSec | 0);
    if (elapsedSec <= RECALL_LIMIT_SEC) {
      var rem = RECALL_LIMIT_SEC - elapsedSec;
      return Math.floor(rem / 60) + ':' + padRecall(rem % 60);
    }
    var over = elapsedSec - RECALL_LIMIT_SEC;
    return '+' + Math.floor(over / 60) + ':' + padRecall(over % 60);
  }

  function stopRecallTimer() {
    if (recallTimer && recallTimer.id) {
      clearInterval(recallTimer.id);
      recallTimer.id = null;
    }
    recallTimer = null;
  }

  function paintRecallTimer() {
    var el = document.getElementById('recall-timer');
    if (!el || !recallTimer || recallTimer.frozen) return;
    var elapsed = Math.floor((Date.now() - recallTimer.startedAt) / 1000);
    if (elapsed < 0) elapsed = 0;
    el.textContent = formatRecallTimer(elapsed);
    if (elapsed > RECALL_LIMIT_SEC) el.classList.add('is-over');
    else el.classList.remove('is-over');
  }

  function startRecallTimer() {
    stopRecallTimer();
    recallTimer = { startedAt: Date.now(), frozen: false, id: null };
    paintRecallTimer();
    recallTimer.id = setInterval(paintRecallTimer, RECALL_TICK_MS);
  }

  function freezeRecallTimer() {
    if (!recallTimer) return;
    if (recallTimer.id) {
      clearInterval(recallTimer.id);
      recallTimer.id = null;
    }
    recallTimer.frozen = true;
  }

  function newStudyId() {
    studySeq++;
    return 'fs-' + Date.now().toString(36) + '-' + studySeq;
  }

  function endFormulaStudy(done) {
    var prev = PGRE.store.state.formulaStudy;
    var marker = {
      id: (study && study.id) || (prev && prev.id) || null,
      done: done != null ? done : (study ? study.done : (prev && prev.done)),
      _opAt: Date.now(),
      _opId: ((study && study.id) || 'end') + ':end'
    };
    if (typeof PGRE.store.clearFormulaStudy === 'function') {
      PGRE.store.clearFormulaStudy(marker);
    } else {
      PGRE.store.state.formulaStudy = null;
    }
  }

  /* ——— ITEM 2: in-session persistence ———
     Mirror the live session into state.formulaStudy so an exit/re-enter resumes
     it instead of restarting. Card objects are stored as ids only (rehydrated
     from the deck on resume); counters, learning steps and history ride along.
     The undo stack is deliberately NOT persisted — it stays session-only.
     persistStudy() only stages state; the caller's existing store.save() writes
     it, so there is no extra save churn. leech-drill sessions persist too (they
     go through startStudy like every other session — the resume simply restores
     whatever queue was mid-flight). */
  function persistStudy() {
    if (!study) return;
    if (!study.id) study.id = newStudyId();
    var stepsCopy = {};
    for (var k in study.steps) stepsCopy[k] = study.steps[k];
    var now = Date.now();
    var end = PGRE.store.state.formulaStudyEnd;
    var floor = end && end._opAt ? Number(end._opAt) : 0;
    var prevAt = Number(study._opAt) || 0;
    var at = now;
    if (at <= floor) at = floor + 1;
    if (at <= prevAt) at = prevAt + 1;
    study._opAt = at;
    studySeq++;
    var opId = study.id + ':' + studySeq;
    PGRE.store.state.formulaStudy = {
      id: study.id,
      date: study.sessionDate || PGRE.srs.today(),
      dayBound: study.dayBound !== false,
      queueIds: study.queue.map(function (c) { return c.id; }),
      done: Number(study.done) || 0,
      again: study.again,
      steps: stepsCopy,
      pressCount: Number(study.pressCount) || 0,
      history: study.history.map(function (h) {
        return { id: h.c.id, grade: h.grade, day: h.day || '' };
      }),
      _opAt: at,
      _opId: opId,
      completed: false
    };
  }

  /* Rebuild the card list for a session saved earlier TODAY, or null. Drops ids
     that have left the deck; drops (and clears) the whole saved session when it
     is from another day or rehydrates to an empty queue. Never touches the
     schedule — it only reads the deck.
     For a day-list session (dayBound, the default) the queue is reconciled
     against the batch first: ids the list dropped (unpicked, suspended) leave
     the queue and ids added mid-session (Fill after Study, search Add) join it — in batch order, after the queued ones —
     so "Resume session — N left" counts the same work "Today's list" does.
     Ad-hoc sessions (dayBound === false: leech drill, search "Study these N")
     keep their frozen queue — their cards may never have been on the list. */
  function dropSavedStudy() {
    endFormulaStudy();
    PGRE.store.save();
  }

  function rehydrateSavedStudy() {
    var saved = PGRE.store.state.formulaStudy;
    // Array.isArray (not a truthy check): a corrupt/hand-edited backup may carry a
    // same-day formulaStudy whose queueIds is a non-array (e.g. a string) — that has
    // a .length so a truthy guard would pass, then .forEach below throws and aborts
    // renderHome. Requiring a real array drops such a session as unresumable.
    var queueList = saved && Array.isArray(saved.queueIds) ? saved.queueIds : null;
    var missing = [];
    if (queueList) {
      queueList.forEach(function (id) { if (!deckById(id)) missing.push(id); });
    }
    // A partial read must not drop ids this load never saw, and must not
    // clear the session — the next complete read may still have them.
    if (lastDeckStatus && lastDeckStatus.partial && missing.length) {
      sessionHeld = true;
      return null;
    }
    sessionHeld = false;
    if (!saved || saved.date !== PGRE.srs.today() || !queueList || !queueList.length) {
      if (saved) dropSavedStudy();
      return null;
    }
    var queueIds = queueList;
    if (saved.dayBound !== false) {
      var remaining = PGRE.srs.formulaDayRemaining(deck), remIds = Object.create(null);
      remaining.forEach(function (c) { remIds[c.id] = 1; });
      var kept = Object.create(null), keptIds = [];
      queueIds.forEach(function (id) {
        if (remIds[id]) { kept[id] = 1; keptIds.push(id); }
      });
      // Learning-step requeues are real duplicates: a kept id keeps every
      // queue entry. New list members append once each, in batch order.
      // A card this session already graded and let go stays out, as it does
      // while the page stays open (knownIds): after the day changes it is due
      // again, and it comes back in the next session.
      var graded = Object.create(null);
      (Array.isArray(saved.history) ? saved.history : []).forEach(function (h) {
        if (h && h.id) graded[h.id] = 1;
      });
      remaining.forEach(function (c) {
        if (!kept[c.id] && !graded[c.id]) { kept[c.id] = 1; keptIds.push(c.id); }
      });
      if (keptIds.join('') !== queueIds.join('')) {
        queueIds = keptIds;
        saved.queueIds = keptIds;
        saved.completed = false;
        if (typeof saved.done !== 'number') saved.done = 0;
        if (typeof saved.pressCount !== 'number') saved.pressCount = 0;
        var stamp = Date.now();
        if (saved._opAt && stamp <= Number(saved._opAt)) stamp = Number(saved._opAt) + 1;
        saved._opAt = stamp;
        saved._opId = (saved.id || 'fs') + ':reconcile';
        PGRE.store.save();
      }
    }
    var cards = [];
    queueIds.forEach(function (id) {
      var c = deckById(id);
      if (c) cards.push(c);
    });
    if (!cards.length) {
      dropSavedStudy();
      return null;
    }
    return cards;
  }

  /* Resume the saved session: restore the exact queue order, learning steps,
     counters and history (card objects rehydrated from the deck by id). Per the
     brief, XP restarts at 0 for the resumed segment — the earlier segment's XP
     already settled on exit — and settled resets to false so this segment settles
     too. The undo stack starts empty (it never crossed the exit). */
  function resumeStudy(cards) {
    if (PGRE.nav) PGRE.nav.setTrail(['Study']);   // BUNDLE G: resumed session is live
    var saved = PGRE.store.state.formulaStudy || {};
    var history = [];
    // Guard against a corrupt backup where history/steps are the wrong type: a
    // truthy non-array history would throw on .forEach, and a non-object steps
    // would enumerate garbage. Both fall back to empty rather than aborting.
    (Array.isArray(saved.history) ? saved.history : []).forEach(function (h) {
      var c = deckById(h.id);
      if (c) history.push({ c: c, grade: h.grade, day: h.day || '' });
    });
    var stepsCopy = {};
    var savedSteps = (saved.steps && typeof saved.steps === 'object') ? saved.steps : {};
    for (var k in savedSteps) stepsCopy[k] = savedSteps[k];
    var known = Object.create(null);
    cards.forEach(function (c) { if (c && c.id) known[c.id] = 1; });
    study = { id: saved.id || newStudyId(), queue: cards,
              total: (saved.done || 0) + cards.length,
              done: saved.done || 0, doneBase: saved.done || 0,
              again: saved.again || 0, againBase: saved.again || 0, xp: 0,
              flipped: false, history: history, peek: null, overlay: null,
              steps: stepsCopy, undo: [], pressCount: saved.pressCount || 0,
              dayBound: saved.dayBound !== false,
              sessionDate: saved.date || PGRE.srs.today(),
              knownIds: known,
              _opAt: Number(saved._opAt) || 0,
              pendingOverlays: [], settled: false,
              roster: [], seenRoster: Object.create(null),
              currentId: cards[0] && cards[0].id, reviewing: false };
    rememberRoster(history.map(function (h) { return h && h.c; }).concat(cards));
    renderCard();
  }

  function rememberRoster(cards) {
    if (!study) return;
    if (!study.roster) study.roster = [];
    if (!study.seenRoster) study.seenRoster = Object.create(null);
    (cards || []).forEach(function (c) {
      if (!c || !c.id || study.seenRoster[c.id]) return;
      study.seenRoster[c.id] = 1;
      study.roster.push(c);
    });
  }

  function dropFromRoster(id) {
    if (!study || !id) return;
    if (study.seenRoster) delete study.seenRoster[id];
    if (study.roster) {
      study.roster = study.roster.filter(function (c) { return c && c.id !== id; });
    }
  }

  function lastHistoryEntry(id) {
    if (!study || !id || !study.history) return null;
    for (var i = study.history.length - 1; i >= 0; i--) {
      var h = study.history[i];
      if (h && h.c && h.c.id === id) return h;
    }
    return null;
  }

  function committedReviewRow(id) {
    if (!id) return null;
    var log = (PGRE.store.state && PGRE.store.state.cardReviews) || [];
    for (var i = log.length - 1; i >= 0; i--) {
      if (log[i] && log[i].id === id) return log[i];
    }
    return null;
  }

  function canRegrade(id) {
    var entry = lastHistoryEntry(id);
    if (!entry) return false;
    var row = committedReviewRow(id);
    if (!row || !row.op) return false;
    var card = PGRE.store.state.cards && PGRE.store.state.cards[id];
    if (card && card.lastReviewOpId && card.lastReviewOpId !== row.op) return false;
    return true;
  }

  function shownCard() {
    if (!study) return null;
    var id = study.currentId, i;
    if (id) {
      for (i = 0; i < study.queue.length; i++) {
        if (study.queue[i] && study.queue[i].id === id) return study.queue[i];
      }
      if (study.reviewing && study.roster) {
        for (i = 0; i < study.roster.length; i++) {
          if (study.roster[i] && study.roster[i].id === id) return study.roster[i];
        }
      }
    }
    return study.queue[0] || null;
  }

  function takeQueueCard(id) {
    if (!study || !id) return null;
    for (var i = 0; i < study.queue.length; i++) {
      if (study.queue[i] && study.queue[i].id === id) {
        return study.queue.splice(i, 1)[0];
      }
    }
    return null;
  }

  function rosterIndexOf(id) {
    if (!study || !study.roster || !id) return -1;
    for (var i = 0; i < study.roster.length; i++) {
      if (study.roster[i] && study.roster[i].id === id) return i;
    }
    return -1;
  }

  /* Count line above the card. The position is the card's number in the
     navigator, not how many are finished, so done and left are named beside
     it — the same two values the meter under the line draws. */
  function studyCountText(pos, rosterN) {
    return 'Card ' + pos + ' of ' + rosterN + ' · ' + study.done + ' done · ' +
      study.queue.length + ' left';
  }

  /* Stored SM-2 interval on this card, in days. "new" when the scheduler
     has never written one. Reads st.interval as gradeCard left it — not
     a days-until-due guess. */
  function boxIntervalText(id) {
    var st = PGRE.srs.cardState(id);
    if (!st || typeof st.interval !== 'number' || !isFinite(st.interval)) return 'new';
    if (!(st.reviews > 0) && !(st.interval > 0)) return 'new';
    return st.interval === 1 ? '1 day' : st.interval + ' days';
  }

  /* Hard or Good on a card with no schedule is the first of its two passes
     (F7): it writes no schedule, and the card comes back in this session. */
  var LEARNING_PASS_TEXT = 'Learning pass, returns this session';
  function isLearningPass(id, g) {
    return (g === 'hard' || g === 'good') && !PGRE.srs.cardState(id);
  }

  function boxHoverText(id, g) {
    if (isLearningPass(id, g)) return LEARNING_PASS_TEXT;
    var grade = (g && GRADE_LABEL[g]) ? GRADE_LABEL[g] : 'not graded yet';
    return grade + ', ' + boxIntervalText(id);
  }

  /* Numbered jump grid — same .pal-cell / .exam-palette-grid as practice. */
  function paletteHTML() {
    if (!study || !study.roster || !study.roster.length) return '';
    var current = shownCard();
    var currentId = (current && current.id) || study.currentId;
    var cells = '';
    study.roster.forEach(function (c, n) {
      if (!c) return;
      var entry = lastHistoryEntry(c.id);
      var g = entry && entry.grade;
      var cls = 'pal-cell';
      if (isLearningPass(c.id, g)) cls += ' is-learning';
      else if (g && GRADE_LABEL[g]) cls += ' is-graded is-' + g;
      if (c.id === currentId) cls += ' is-current';
      var facts = boxHoverText(c.id, g);
      var label = 'Card ' + (n + 1) + ', ' + facts;
      if (c.id === currentId) label += ', current';
      cells += '<button type="button" class="' + cls + '" data-goto="' + n +
        '" data-id="' + PGRE.ui.esc(c.id) +
        '" data-box-tip="' + PGRE.ui.esc(facts) +
        '" aria-label="' + PGRE.ui.esc(label) + '">' + (n + 1) + '</button>';
    });
    return '<div class="drill-palette practice-palette formula-palette">' +
      '<div class="exam-palette-title">Cards in this set</div>' +
      '<div class="exam-palette-grid">' + cells + '</div>' +
      '<div class="exam-legend drill-legend">' +
        '<span class="exam-legend-item"><span class="pal-swatch"></span>Not yet graded</span>' +
        '<span class="exam-legend-item"><span class="pal-swatch sw-learning"></span>Learning pass</span>' +
        '<span class="exam-legend-item"><span class="pal-swatch sw-again"></span>Again</span>' +
        '<span class="exam-legend-item"><span class="pal-swatch sw-hard"></span>Hard</span>' +
        '<span class="exam-legend-item"><span class="pal-swatch sw-good"></span>Good</span>' +
        '<span class="exam-legend-item"><span class="pal-swatch sw-easy"></span>Easy</span>' +
      '</div></div>';
  }

  function bindPalette() {
    var root = body();
    if (!root || root._pgreGotoBound) return;
    root._pgreGotoBound = true;
    root.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-goto]') : null;
      if (!t || t.disabled || !root.contains(t)) return;
      var n = parseInt(t.getAttribute('data-goto'), 10);
      if (n !== n) return;
      jumpTo(n);
    });
  }

  function jumpTo(n) {
    if (!study || study.overlay) return;
    var roster = study.roster || [];
    if (n < 0 || n >= roster.length) return;
    var c = roster[n];
    if (!c) return;
    if (canRegrade(c.id)) {
      renderGradedCard(c);
      return;
    }
    study.reviewing = false;
    var inQueue = false, i;
    for (i = 0; i < study.queue.length; i++) {
      if (study.queue[i] && study.queue[i].id === c.id) { inQueue = true; break; }
    }
    study.currentId = inQueue ? c.id : (study.queue[0] && study.queue[0].id);
    renderCard();
  }

  function jumpNeighbor(dir) {
    if (!study || !study.roster) return;
    var cur = shownCard();
    var i = rosterIndexOf(cur && cur.id);
    if (i < 0) return;
    jumpTo(i + dir);
  }

  function forgetUndoOp(opId) {
    if (!study || !opId || !study.undo) return;
    study.undo = study.undo.filter(function (e) { return !e || e.opId !== opId; });
  }

  /* Replace the last committed review for this card. XP, streaks and the
     done count stay put; the SRS row is undone and rewritten the way
     practice review chips stamp an existing attempt. The queue and the
     Again count follow the new grade as a live press would: Again brings
     the card back once at the end of this session, a passing grade takes
     it out. */
  function regrade(g) {
    if (!study || study.overlay) return;
    var c = shownCard();
    if (!c || !canRegrade(c.id)) return;
    var entry = lastHistoryEntry(c.id);
    if (!entry || entry.grade === g) return;
    var row = committedReviewRow(c.id);
    var opId = row && row.op;
    if (!opId || typeof PGRE.srs.undoReview !== 'function') return;
    var before = PGRE.store.checkpoint();
    var undoBefore = study.undo.slice();
    var queueBefore = study.queue.slice();
    var againBefore = study.again;
    var hadStep = Object.prototype.hasOwnProperty.call(study.steps, c.id);
    var stepBefore = study.steps[c.id];
    var undone = PGRE.srs.undoReview(String(opId));
    if (undone == null) return;
    forgetUndoOp(String(opId));
    // The undone review created this card's schedule. Again on a card with
    // no schedule is the live Again on a new card: nothing is committed and
    // its learning steps start over.
    var relearn = g === 'again' && !undone.card;
    var committed = relearn ? '' : commitReview(c.id, g);
    if (committed === null) {
      persistStudy();
      PGRE.store.save();
      renderGradedCard(c);
      return;
    }
    var gradeBefore = entry.grade;
    entry.grade = g;
    if (relearn) study.steps[c.id] = (c.kind === 'list') ? 1 : 0;
    if (g === 'again' && gradeBefore !== 'again') study.again++;
    if (g !== 'again' && gradeBefore === 'again') study.again = Math.max(0, study.again - 1);
    while (takeQueueCard(c.id)) { /* drop every queued copy */ }
    if (g === 'again') study.queue.push(c);
    persistStudy();
    if (!PGRE.store.save()) {
      // Not stored: the earlier grade stands in memory and on screen too.
      PGRE.store.rollback(before);
      study.undo = undoBefore;
      study.queue = queueBefore;
      study.again = againBefore;
      if (hadStep) study.steps[c.id] = stepBefore;
      else delete study.steps[c.id];
      entry.grade = gradeBefore;
    }
    renderGradedCard(c);
  }

  function renderCard() {
    setMasthead('');
    closeVisualizerIfOpen();
    if (window.PGRE && window.PGRE.teardownInlineVisualizer) {
      window.PGRE.teardownInlineVisualizer();
    }
    // Leaving a graded card opened for review: back to the card that was
    // live, not the reviewed one, even when an Again put it back in the queue.
    if (study.reviewing && study.liveId) study.currentId = study.liveId;
    study.reviewing = false;
    study.liveId = null;
    if (!study.currentId || !shownCard()) {
      study.currentId = study.queue[0] && study.queue[0].id;
    }
    var c = shownCard();
    if (!c) { renderStudySummary(); return; }
    study.currentId = c.id;
    var t = PGRE.topicById(c.topic);
    var nm = cardName(c);
    var step = study.steps[c.id] || 0;   // F7 learning step (0 or 1)
    var learnChip = step === 1 ? '<span class="chip learn-chip">learning 1/2</span>' : '';
    var undoBtn = study.undo.length ?      // F1a ghost undo when the stack is live
      '<button class="btn btn-ghost btn-sm study-undo" id="study-undo">Undo ' +
        '<span class="key-hint">⌘Z</span></button>' : '';
    var noteHTML = c.note ? '<div class="fcard-note">' + formulaHTML(c.note) + '</div>' : '';
    var mnem = mnemonicHTML(c.id);         // F2: shown under the note after a flip
    // F5: reverse direction shows the formula as the question ("what is this?")
    // and reveals name + prompt + note + mnemonic. Same SM-2 state and grading —
    // only the two faces swap; learning steps / undo / scaffold / rounds untouched.
    var reverse = !!PGRE.store.state.settings.formulaReverse;
    var frontFace, backFace;
    if (reverse) {
      var rp = reverseParts(c);
      frontFace = '<div class="fcard-rev-q">What is this? When does it apply?</div>' +
        '<div class="fcard-front" id="fcard-front">' + formulaHTML(rp.q) + '</div>';
      backFace = (nm ? '<div class="fcard-name">' + PGRE.ui.esc(nm) + '</div>' : '') +
        '<div class="fcard-rev-prompt">' + formulaHTML(c.front) + '</div>' +
        (rp.rest ? formulaHTML(rp.rest) : '') + noteHTML + mnem +
        vizNavButtonHTML(c.id, 'btn-sm', 'study-viz');
    } else {
      frontFace = (nm ? '<div class="fcard-name">' + PGRE.ui.esc(nm) + '</div>' : '') +
        '<div class="fcard-front" id="fcard-front">' + formulaHTML(c.front || 'Recall the formula.') + '</div>';
      backFace = backHTML(c) + noteHTML + mnem + vizNavButtonHTML(c.id, 'btn-sm', 'study-viz');
    }
    var ri = rosterIndexOf(c.id);
    var rosterN = (study.roster && study.roster.length) || (study.done + study.queue.length);
    var html = '<div class="card practice-card formula-study-live">' +
      '<div class="study-scroll">' +
      '<div class="study-main">' +
      '<div class="practice-meta">' +
        '<span>' + studyCountText(ri >= 0 ? ri + 1 : study.done + 1, rosterN) + '</span>' +
        '<span class="recall-timer" id="recall-timer" role="timer" aria-live="off">2:00</span>' +
        (study.history.length ? '<button class="btn btn-ghost btn-sm session-back" id="session-back">' +
          'Back <span class="key-hint">←</span></button>' : '') +
        undoBtn +
        (t ? '<span class="chip">' + t.name + '</span>' : '') +
        learnChip +
        '<button class="btn btn-ghost btn-sm session-export-btn" id="session-export-btn" title="Export learning status for agent">Export status</button>' +
        '<button class="btn btn-ghost btn-sm" id="session-shuffle-btn">Shuffle</button>' +
      '</div>' +
      PGRE.ui.meter(100 * study.done / (study.done + study.queue.length), 'meter-thin') +
      '<div class="fcard" id="fcard" data-card-id="' + PGRE.ui.esc(c.id) + '">' +
        frontFace +
        '<div class="fcard-back" id="fcard-back" hidden>' + backFace + '</div>' +
      '</div>' +
      '<div class="btn-row" id="fcard-actions">' +
        '<button class="btn btn-primary" id="flip-btn">Show answer <span class="key-hint">space</span></button>' +
        // F8 scaffold prompts reconstruct a formula, so they only fit the
        // forward face of a formula card — suppress in reverse (F5), where the
        // formula IS the prompt, and on book-list cards (kind 'list').
        (reverse || c.kind === 'list' ? '' : '<button class="btn btn-ghost" id="rebuild-btn">Rebuild hints</button>') +
        '<button class="btn btn-ghost" id="skip-btn">Skip</button>' +
        '<button class="btn btn-ghost" id="putaway-btn">Park</button>' +
        similarButton(c, 'btn-sm') +
      '</div>' +
      '<div class="card-review-hist-wrap" hidden>' + reviewHistoryHTML(c.id) + '</div>' +
      '</div>' +
      paletteHTML() +
      '</div></div>';
    body().innerHTML = html;
    PGRE.typesetMath(body());
    if (window.PGRE && PGRE.motion && PGRE.motion.animateMeter) {
      var mf = body().querySelector('.meter-thin .meter-fill');
      if (mf) PGRE.motion.animateMeter(mf, 100 * study.done / (study.done + study.queue.length));
    }
    study.flipped = false;
    study.peek = null;
    study.overlay = null;
    document.getElementById('flip-btn').addEventListener('click', flip);
    document.getElementById('fcard').addEventListener('click', function () {
      if (!study.flipped) flip();
    });
    var bk = document.getElementById('session-back');
    if (bk) bk.addEventListener('click', function (e) { e.stopPropagation(); openPeek(); });
    var ub = document.getElementById('study-undo');
    if (ub) ub.addEventListener('click', function (e) { e.stopPropagation(); undoGrade(); });
    var rb = document.getElementById('rebuild-btn');
    if (rb) rb.addEventListener('click', function (e) { e.stopPropagation(); showRebuildHints(); });
    var sb = document.getElementById('skip-btn');
    if (sb) sb.addEventListener('click', function (e) { e.stopPropagation(); skipCard(); });
    var pa = document.getElementById('putaway-btn');
    if (pa) pa.addEventListener('click', function (e) { e.stopPropagation(); putAwayCard(); });
    var eb = document.getElementById('session-export-btn');
    if (eb) eb.addEventListener('click', function (e) { e.stopPropagation(); openFormulaExportModal(); });
    var shuf = document.getElementById('session-shuffle-btn');
    if (shuf) shuf.addEventListener('click', function (e) { e.stopPropagation(); shuffleRemaining(); });
    wireVizNav(body());
    wireSimilar(body());
    bindPalette();
    startRecallTimer();
  }

  function renderGradedCard(c) {
    if (!study || !c) return;
    stopRecallTimer();
    setMasthead('');
    closeVisualizerIfOpen();
    if (window.PGRE && window.PGRE.teardownInlineVisualizer) {
      window.PGRE.teardownInlineVisualizer();
    }
    if (!study.reviewing) study.liveId = study.currentId;
    study.reviewing = true;
    study.flipped = true;
    study.peek = null;
    study.overlay = null;
    study.currentId = c.id;
    var t = PGRE.topicById(c.topic);
    var nm = cardName(c);
    var entry = lastHistoryEntry(c.id);
    var chosen = entry ? entry.grade : '';
    var undoBtn = study.undo.length ?
      '<button class="btn btn-ghost btn-sm study-undo" id="study-undo">Undo ' +
        '<span class="key-hint">⌘Z</span></button>' : '';
    var noteHTML = c.note ? '<div class="fcard-note">' + formulaHTML(c.note) + '</div>' : '';
    var mnem = mnemonicHTML(c.id);
    var reverse = !!PGRE.store.state.settings.formulaReverse;
    var frontFace, backFace;
    if (reverse) {
      var rp = reverseParts(c);
      frontFace = '<div class="fcard-rev-q">What is this? When does it apply?</div>' +
        '<div class="fcard-front" id="fcard-front">' + taggedBackHTML(c, rp.q) + '</div>';
      backFace = (nm ? '<div class="fcard-name">' + PGRE.ui.esc(nm) + '</div>' : '') +
        '<div class="fcard-rev-prompt">' + formulaHTML(c.front) + '</div>' +
        (rp.rest ? formulaHTML(rp.rest) : '') + noteHTML + mnem +
        vizNavButtonHTML(c.id, 'btn-sm', 'study-viz');
    } else {
      frontFace = (nm ? '<div class="fcard-name">' + PGRE.ui.esc(nm) + '</div>' : '') +
        '<div class="fcard-front" id="fcard-front">' + formulaHTML(c.front || 'Recall the formula.') + '</div>';
      backFace = backHTML(c) + noteHTML + mnem + vizNavButtonHTML(c.id, 'btn-sm', 'study-viz');
    }
    var row = committedReviewRow(c.id);
    var previewSt = null;
    if (row && row.prev) {
      try { previewSt = JSON.parse(JSON.stringify(row.prev)); } catch (ePrev) { previewSt = row.prev; }
    }
    var ivls = PGRE.srs.nextIntervals(previewSt);
    var gradeHtml = '';
    GRADES.forEach(function (g) {
      var pressed = g.key === chosen;
      gradeHtml += '<button class="btn grade-btn grade-' + g.key +
        (pressed ? ' chosen' : '') + '" data-grade="' + g.key +
        '" aria-pressed="' + (pressed ? 'true' : 'false') + '">' +
        '<span class="grade-top">' + g.label + ' <span class="key-hint">' + g.hint + '</span></span>' +
        '<span class="grade-ivl">' + PGRE.srs.ivlLabel(ivls[g.key]) + '</span></button>';
    });
    gradeHtml += similarButton(c, 'btn-sm');
    var ri = rosterIndexOf(c.id);
    var rosterN = (study.roster && study.roster.length) || 0;
    var html = '<div class="card practice-card formula-study-live">' +
      '<div class="study-scroll">' +
      '<div class="study-main">' +
      '<div class="practice-meta">' +
        '<span>' + studyCountText(ri >= 0 ? ri + 1 : 1, rosterN) + '</span>' +
        (study.history.length ? '<button class="btn btn-ghost btn-sm session-back" id="session-back">' +
          'Back <span class="key-hint">←</span></button>' : '') +
        undoBtn +
        (t ? '<span class="chip">' + t.name + '</span>' : '') +
        (chosen ? '<span class="grade-chip grade-' + chosen + ' peek-grade">Graded ' +
          (GRADE_LABEL[chosen] || chosen) + '</span>' : '') +
        '<button class="btn btn-ghost btn-sm session-export-btn" id="session-export-btn" title="Export learning status for agent">Export status</button>' +
      '</div>' +
      PGRE.ui.meter(100 * study.done / Math.max(1, study.done + study.queue.length), 'meter-thin') +
      '<div class="fcard" id="fcard" data-card-id="' + PGRE.ui.esc(c.id) + '">' +
        frontFace +
        '<div class="fcard-back" id="fcard-back">' + backFace + '</div>' +
      '</div>' +
      '<div class="btn-row" id="fcard-actions">' + gradeHtml + '</div>' +
      '<div class="card-review-hist-wrap">' + reviewHistoryHTML(c.id) + '</div>' +
      '</div>' +
      paletteHTML() +
      '</div></div>';
    body().innerHTML = html;
    PGRE.typesetMath(body());
    var bk = document.getElementById('session-back');
    if (bk) bk.addEventListener('click', function (e) { e.stopPropagation(); openPeek(); });
    var ub = document.getElementById('study-undo');
    if (ub) ub.addEventListener('click', function (e) { e.stopPropagation(); undoGrade(); });
    var eb = document.getElementById('session-export-btn');
    if (eb) eb.addEventListener('click', function (e) { e.stopPropagation(); openFormulaExportModal(); });
    var box = document.getElementById('fcard-actions');
    if (box) {
      box.querySelectorAll('[data-grade]').forEach(function (b) {
        b.addEventListener('click', function () { regrade(b.getAttribute('data-grade')); });
      });
    }
    wireVizNav(body());
    wireSimilar(body());
    bindPalette();
  }

  /* F8 pre-flip scaffold: swap the card front for the generic prompt list; the
     answer is still one flip away. One-way for this card view. */
  function showRebuildHints() {
    if (!study || study.flipped) return;
    var front = document.getElementById('fcard-front');
    if (front) front.innerHTML = scaffoldPromptsHTML();
    var rb = document.getElementById('rebuild-btn');
    if (rb && rb.parentNode) rb.parentNode.removeChild(rb);
    var fc = document.getElementById('fcard');
    if (fc) PGRE.typesetMath(fc);
  }

  /* ——— In-session back-stepping: a view-only look at already-graded cards.
     Grades stand — this never re-schedules anything. ——— */
  function openPeek() {
    if (!study || !study.history.length || study.overlay) return;
    study.overlay = 'peek';   // F8: peek is now one of the overlay states
    study.peek = { idx: study.history.length - 1 };
    renderPeek();
  }

  function renderPeek() {
    stopRecallTimer();
    setMasthead('');
    closeVisualizerIfOpen();
    var n = study.history.length, idx = study.peek.idx;
    var entry = study.history[idx], c = entry.c;
    var t = PGRE.topicById(c.topic), nm = cardName(c);
    var atNewest = idx >= n - 1;
    var html = '<div class="card practice-card">' +
      '<div class="practice-meta">' +
        '<span>Reviewed ' + (idx + 1) + ' of ' + n + '</span>' +
        (t ? '<span class="chip">' + t.name + '</span>' : '') +
        '<span class="grade-chip grade-' + entry.grade + ' peek-grade">Graded ' + entry.grade + '</span>' +
      '</div>' +
      '<div class="fcard" data-card-id="' + PGRE.ui.esc(c.id) + '">' +
        (nm ? '<div class="fcard-name">' + PGRE.ui.esc(nm) + '</div>' : '') +
        '<div class="fcard-front">' + formulaHTML(c.front) + '</div>' +
        '<div class="fcard-back">' + backHTML(c) +
          (c.note ? '<div class="fcard-note">' + formulaHTML(c.note) + '</div>' : '') +
          vizNavButtonHTML(c.id, 'btn-sm', 'peek-viz') + '</div>' +
      '</div>' +
      reviewHistoryHTML(c.id) +
      '<div class="btn-row session-peek-bar">' +
        '<button class="btn btn-ghost" id="peek-older"' + (idx <= 0 ? ' disabled' : '') +
          '>← Older</button>' +
        '<button class="btn btn-ghost" id="peek-newer"' + (atNewest ? ' disabled' : '') +
          '>Newer →</button>' +
        '<span class="session-peek-actions">' +
          similarButton(c, 'btn-sm') +
          '<button class="btn btn-primary" id="peek-resume">Resume study</button>' +
        '</span>' +
      '</div></div>';
    body().innerHTML = html;
    PGRE.typesetMath(body());
    var ob = document.getElementById('peek-older');
    var nb = document.getElementById('peek-newer');
    if (ob) ob.addEventListener('click', function () { peekStep(-1); });
    if (nb) nb.addEventListener('click', function () { peekStep(1); });
    document.getElementById('peek-resume').addEventListener('click', resumePeek);
    wireVizNav(body());
    wireSimilar(body());
  }

  function peekStep(d) {
    if (!study || study.overlay !== 'peek' || !study.peek) return;
    var n = study.history.length, idx = study.peek.idx + d;
    if (idx < 0) idx = 0;
    if (idx > n - 1) idx = n - 1;
    study.peek.idx = idx;
    renderPeek();
  }

  function resumePeek() {
    if (!study) return;
    study.peek = null;
    study.overlay = null;
    renderCard();
  }

  function flip() {
    freezeRecallTimer();
    var c = shownCard();
    if (!c) return;
    study.flipped = true;
    var backEl = document.getElementById('fcard-back');
    if (backEl) {
      backEl.hidden = false;
      backEl.classList.add('fcard-reveal');   // clip-path wipe via motion tokens
    }
    // F5 reverse: the equation is the QUESTION, so its book number would give the
    // answer away. It is withheld until here, then the front is re-rendered with
    // the tag and typeset on its own (re-running it over the whole card would
    // re-typeset the already-rendered back).
    if (PGRE.store.state.settings.formulaReverse) {
      var front = document.getElementById('fcard-front');
      if (front) { front.innerHTML = taggedBackHTML(c, reverseParts(c).q); PGRE.typesetMath(front); }
    }
    var rb = document.getElementById('rebuild-btn');
    if (rb && rb.parentNode) rb.parentNode.removeChild(rb);
    var st = PGRE.srs.cardState(c.id);
    var ivls = PGRE.srs.nextIntervals(st);      // already exam-cap clamped (F3)
    var stateless = !st, step = study.steps[c.id] || 0;
    var html = '';
    GRADES.forEach(function (g) {
      // F7: a stateless card at step 0 requeues in-session on Hard/Good (a learning
      // step, not a scheduled interval) — say it returns this session; Easy commits
      // its real interval, and a step-1 card shows real committed intervals for all grades.
      var lbl;
      if (stateless && step === 0 && (g.key === 'hard' || g.key === 'good')) lbl = 'returns this session';
      else lbl = PGRE.srs.ivlLabel(ivls[g.key]);
      html += '<button class="btn grade-btn grade-' + g.key + '" data-grade="' + g.key +
        '" aria-pressed="false">' +
        '<span class="grade-top">' + g.label + ' <span class="key-hint">' + g.hint + '</span></span>' +
        '<span class="grade-ivl">' + lbl + '</span></button>';
    });
    // The grade row replaces the whole action strip, so the Park and
    // similar-problem controls are re-emitted here to stay visible after the
    // reveal. Park runs the same putAwayCard as the front-side button: the card
    // leaves the session ungraded and its SRS schedule is untouched.
    html += '<button class="btn btn-ghost btn-sm" id="putaway-btn">Park</button>' +
      similarButton(c, 'btn-sm');
    var box = document.getElementById('fcard-actions');
    box.innerHTML = html;
    var histWrap = body().querySelector('.card-review-hist-wrap');
    if (histWrap) histWrap.hidden = false;
    box.querySelectorAll('[data-grade]').forEach(function (b, i) {
      b.addEventListener('click', function () { grade(b.getAttribute('data-grade')); });
      if (PGRE.motion && !PGRE.motion.reduced) {
        b.classList.add('grade-cascade');
        b.style.animationDelay = (i * 60) + 'ms';
      }
    });
    var pa = document.getElementById('putaway-btn');
    if (pa) pa.addEventListener('click', function (e) { e.stopPropagation(); putAwayCard(); });
    wireSimilar(box);
  }

  /* Still owed by this session. Suspended cards are never graded.
     Day-bound cards must still be in formulaDayRemaining. Ad-hoc keeps its
     explicit queue aside from suspension. */
  function cardEligible(id) {
    if (!id || !study) return false;
    if (PGRE.srs.isSuspended && PGRE.srs.isSuspended(id)) return false;
    if (study.dayBound === false) return true;
    if (!PGRE.srs.formulaDayRemaining) return true;
    var rem = PGRE.srs.formulaDayRemaining(deck) || [];
    for (var i = 0; i < rem.length; i++) {
      if (rem[i] && rem[i].id === id) return true;
    }
    return false;
  }

  function reconcileLiveQueue(joinNew) {
    if (!study) return;
    if (!study.knownIds) study.knownIds = Object.create(null);
    study.queue.forEach(function (c) { if (c && c.id) study.knownIds[c.id] = 1; });
    var next = [];
    study.queue.forEach(function (c) {
      if (c && cardEligible(c.id)) next.push(c);
    });
    if (joinNew && study.dayBound !== false && PGRE.srs.formulaDayRemaining) {
      PGRE.srs.formulaDayRemaining(deck).forEach(function (c) {
        if (!c || !c.id || study.knownIds[c.id]) return;
        study.knownIds[c.id] = 1;
        next.push(c);
      });
    }
    study.queue = next;
    rememberRoster(next);
  }

  /* The day changes (03:00) while a session is open: run the same allocator
     home would, then let newly eligible cards join. A learning requeue that
     is still remaining stays. */
  function onLiveClock(joinNew) {
    if (!study) return false;
    var today = PGRE.srs.today();
    if (!study.sessionDate) study.sessionDate = today;
    var rolled = study.sessionDate !== today;
    if (rolled) {
      study.sessionDate = today;
      if (study.dayBound !== false && PGRE.srs.autoFillFormulaDay) PGRE.srs.autoFillFormulaDay(deck);
    }
    var before = study.queue.map(function (c) { return c && c.id; }).join('\n');
    reconcileLiveQueue(!!joinNew);
    var after = study.queue.map(function (c) { return c && c.id; }).join('\n');
    if (rolled || before !== after) {
      persistStudy();
      PGRE.store.save();
    }
    return rolled || before !== after;
  }

  function commitReview(id, g) {
    var card = PGRE.srs.gradeCard(id, g);
    if (card === null) return null;
    var opId = (card && card.lastReviewOpId != null && card.lastReviewOpId !== '')
      ? String(card.lastReviewOpId) : '';
    return opId;
  }

  function clearChosenGrade() {
    var nodes = document.querySelectorAll('#fcard-actions [data-grade]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.remove('chosen');
      nodes[i].setAttribute('aria-pressed', 'false');
    }
  }

  /* F7 learning steps live ONLY in Study mode. Match/Type/Quiz commit gradeCard
     directly (no steps) — see js/flashmodes.js. */
  function grade(g) {
    if (!study || study.overlay) return;        // no grading while an overlay is up
    if (study.reviewing) { regrade(g); return; }
    // The press belongs to the card on screen. Reconcile may drop it when
    // the list changed; that same click must not grade the card that slides up.
    var shown = shownCard();
    var shownId = shown && shown.id;
    var rolled = study.sessionDate && study.sessionDate !== PGRE.srs.today();
    onLiveClock(rolled && study.dayBound !== false);
    if (!study.queue.length) { renderStudySummary(); return; }
    var c = null, qi;
    if (shownId) {
      for (qi = 0; qi < study.queue.length; qi++) {
        if (study.queue[qi] && study.queue[qi].id === shownId) { c = study.queue[qi]; break; }
      }
    }
    if (!c) c = study.queue[0];
    var id = c.id;
    if (id !== shownId || !cardEligible(id)) {
      if (shownId && id === shownId) {
        takeQueueCard(id);
        persistStudy();
        PGRE.store.save();
      }
      study.currentId = study.queue[0] && study.queue[0].id;
      if (study.queue.length) renderCard();
      else renderStudySummary();
      return;
    }
    var stateless = !PGRE.srs.cardState(id);
    var pressed = document.querySelector('#fcard-actions [data-grade="' + g + '"]');
    if (pressed) {
      pressed.classList.add('chosen');   // instant tint, no delay — keyboard flow unaffected
      pressed.setAttribute('aria-pressed', 'true');
    }
    var step = study.steps[id] || 0;
    var needsCommit = !stateless || g === 'easy' || (stateless && step !== 0 && g !== 'again');
    var opId = '';
    // Every press, a learning pass too: its step lives only in the saved session.
    var before = PGRE.store.checkpoint();
    if (needsCommit) {
      var committed = commitReview(id, g);
      if (committed === null) {
        clearChosenGrade();
        return;
      }
      opId = committed;
    }

    // Snapshot the session BEFORE the queue moves. The op id was copied from
    // the card gradeCard just returned. Undo names that string.
    pushUndo(id, opId);
    study.pressCount++;                         // F11: every press counts toward a round

    var recycled = false;                       // an Again press → post-Again scaffold

    if (stateless) {
      if (g === 'easy') {                        // Anki: Easy graduates immediately
        delete study.steps[id];
        takeQueueCard(id);
        study.done++;
      } else if (g === 'again') {               // no commit, no lapse
        // Formula cards go back to step 0. A book list's next Hard/Good is
        // the say-it-back pass and commits gradeCard, so that Good stores due.
        study.steps[id] = (c.kind === 'list') ? 1 : 0;
        study.again++;
        recycled = true;
        reinsertCard(c);
      } else if (step === 0) {                  // Hard/Good step 0 → learning step 1
        study.steps[id] = 1;
        reinsertCard(c);
      } else {                                  // Hard/Good step 1 → graduate
        delete study.steps[id];
        takeQueueCard(id);
        study.done++;
      }
    } else {                                    // review card: commit directly
      takeQueueCard(id);
      study.done++;
      if (g === 'again') { study.queue.push(c); study.again++; recycled = true; }
    }
    study.currentId = study.queue[0] && study.queue[0].id;
    // A second copy of a card that just graduated is no longer remaining.
    // A learning requeue is still remaining, so it stays.
    reconcileLiveQueue(false);

    PGRE.store.touchDay();          // reviewing formulas counts as a study day
    study.xp += 2;                  // every press rewards effort (unchanged from before)
    study.history.push({ c: c, grade: g, day: PGRE.srs.today() });
    persistStudy();                 // ITEM 2: stage the resume snapshot into the same save
    if (!PGRE.store.save() && before) {
      // The press did not reach storage. Take it back from memory too and
      // keep this card on screen: moving on would leave a card that a
      // reload brings back, graded only in this tab's memory.
      PGRE.store.rollback(before);
      restoreSession(study.undo.pop());
      study.currentId = id;
      clearChosenGrade();
      // Say so for this press: the saving-failed warning stays up unchanged,
      // and a learning pass never reaches gradeCard's own message.
      if (typeof PGRE.pressNotRecorded === 'function') PGRE.pressNotRecorded();
      return;
    }

    // F8 + F11: queue overlays. When the round-closing press is an Again, the
    // scaffold shows first and the checkpoint after it.
    study.pendingOverlays = [];
    if (recycled) study.pendingOverlays.push({ type: 'scaffold', card: c });
    if (study.pressCount % ROUND_SIZE === 0 && study.queue.length) {
      study.pendingOverlays.push({ type: 'checkpoint' });
    }
    if (study.pendingOverlays.length) runNextOverlay();
    else if (study.queue.length) renderCard();
    else renderStudySummary();
  }

  /* Reorder cards still to come. Once the answer is on screen the current
     card stays and only the cards behind it move; otherwise the current card
     joins the shuffle and a different card is shown. Grades, streaks,
     schedules, mistakes and notes are untouched. The saved session queue
     keeps the new order so a resume matches the screen. */
  function shuffleRemaining() {
    if (!study || study.overlay || study.reviewing || !study.queue || study.queue.length < 2) return;
    var keep = !!study.flipped;
    var cur = shownCard() || study.queue[0];
    var others = [];
    study.queue.forEach(function (card) {
      if (card && cur && card.id === cur.id) return;
      others.push(card);
    });
    var next;
    if (keep) {
      if (others.length < 2) return;
      var beforeTail = others.map(function (card) { return card.id; }).join('\n');
      var shuffledTail = others;
      var guard = 0;
      do {
        shuffledTail = shuffle(others);
        guard++;
      } while (guard < 8 && shuffledTail.map(function (card) { return card.id; }).join('\n') === beforeTail);
      if (shuffledTail.map(function (card) { return card.id; }).join('\n') === beforeTail) return;
      next = [cur].concat(shuffledTail);
    } else {
      if (others.length < 1) return;
      var shuffled = shuffle(others);
      var rest = shuffle(shuffled.slice(1).concat([cur]));
      next = [shuffled[0]].concat(rest);
    }
    if (next.map(function (c) { return c.id; }).join('\n') ===
        study.queue.map(function (c) { return c.id; }).join('\n')) return;
    study.queue = next;
    study.currentId = (keep ? cur : next[0]).id;
    persistStudy();
    PGRE.store.save();
    if (!keep) renderCard();
  }

  /* F7: pull the current card off the front and reinsert it a few cards back so a
     learning card returns within the session without immediately repeating. */
  function skipCard() {
    if (!study || study.overlay || study.reviewing) return;
    var c = shownCard();
    if (!c) return;
    takeQueueCard(c.id);
    dropFromRoster(c.id);
    study.total--;
    study.undo = [];
    study.currentId = study.queue[0] && study.queue[0].id;
    persistStudy();
    PGRE.store.save();
    if (study.queue.length) renderCard();
    else renderStudySummary();
  }

  function putAwayCard() {
    if (!study || study.overlay || study.reviewing) return;
    var c = shownCard();
    if (!c) return;
    takeQueueCard(c.id);
    dropFromRoster(c.id);
    PGRE.srs.suspendCard(c.id);
    study.total--;
    study.undo = [];
    study.currentId = study.queue[0] && study.queue[0].id;
    persistStudy();
    PGRE.store.save();
    if (study.queue.length) renderCard();
    else renderStudySummary();
  }

  function reinsertCard(c) {
    if (!c) c = shownCard();
    if (!c) return;
    takeQueueCard(c.id);
    var p = Math.min(study.queue.length, 3 + Math.floor(Math.random() * 3));
    study.queue.splice(p, 0, c);
  }

  /* F1a: undo stack, max 10, dies with the session. Snapshot BEFORE the mutation
     so a pop restores the exact pre-press session + card state. */
  function sessionSnapshot(id, opId) {
    var stepsCopy = {};
    for (var k in study.steps) stepsCopy[k] = study.steps[k];
    return {
      id: id,
      day: PGRE.srs.today(),
      opId: opId ? String(opId) : '',
      queueIds: study.queue.slice(),          // shallow copy of the queue (card refs)
      done: study.done, xp: study.xp, again: study.again,
      historyLen: study.history.length,
      steps: stepsCopy,
      pressCount: study.pressCount
    };
  }

  function pushUndo(id, opId) {
    study.undo.push(sessionSnapshot(id, opId));
    if (study.undo.length > 10) study.undo.shift();
  }

  function restoreSession(e) {
    study.queue = e.queueIds.slice();
    study.done = e.done;
    study.xp = e.xp;
    study.again = e.again;
    study.history.length = e.historyLen;
    study.steps = {};
    for (var k in e.steps) study.steps[k] = e.steps[k];
    study.pressCount = e.pressCount;
  }

  /* Undo the named review, then the session. A null undoReview leaves the
     screen where it is. This does not pop cardReviews or write a card snapshot. */
  function undoGrade() {
    if (!study || study.overlay || !study.undo.length) return;
    var e = study.undo[study.undo.length - 1];
    var before = PGRE.store.checkpoint();
    var now = sessionSnapshot(study.currentId, '');
    var historyNow = study.history.slice();
    var wasReviewing = study.reviewing;
    if (e.opId) {
      if (typeof PGRE.srs.undoReview !== 'function') return;
      var res = PGRE.srs.undoReview(String(e.opId));
      if (res == null) return;
    }
    study.undo.pop();
    restoreSession(e);
    study.overlay = null;
    study.pendingOverlays = [];
    study.reviewing = false;
    study.currentId = study.queue[0] && study.queue[0].id;
    persistStudy();
    if (!PGRE.store.save()) {
      // The undo did not reach storage: the stored grade or learning pass
      // stands, so memory and the screen keep it too, and the Undo entry
      // stays for the next try. A learning pass has no op id, but its step
      // and history live in the saved session all the same.
      PGRE.store.rollback(before);
      restoreSession(now);
      study.history = historyNow;
      study.undo.push(e);
      study.reviewing = wasReviewing;
      study.currentId = now.id;
      if (typeof PGRE.pressNotRecorded === 'function') PGRE.pressNotRecorded();
      return;
    }
    renderCard();
  }

  /* F8/F11 overlay pump: run one queued overlay at a time; when the queue drains,
     resume the live card (or the summary if the batch is done). */
  function runNextOverlay() {
    var p = study.pendingOverlays.shift();
    if (!p) {
      study.overlay = null;
      if (study.queue.length) renderCard();
      else renderStudySummary();
      return;
    }
    if (p.type === 'scaffold') renderScaffold(p.card);
    else renderCheckpoint();
  }

  /* F8 post-Again interstitial: the formula + the same 5 prompts, then Continue.
     A book list has no formula to rebuild: show the list and ask for each point. */
  function renderScaffold(c) {
    stopRecallTimer();
    setMasthead('');
    study.overlay = 'scaffold';
    var list = c && c.kind === 'list';
    body().innerHTML = '<div class="card practice-card scaffold-card">' +
      '<h2>' + (list ? 'Say it back' : 'Reconstruct it') + '</h2>' +
      '<p class="muted">' + (list
        ? 'Missed. Read the list, then say each point back before moving on.'
        : 'Missed — rebuild this one from the ground up before moving on.') + '</p>' +
      '<div class="fcard-back scaffold-back">' + backHTML(c) + '</div>' +
      (list ? '' : scaffoldPromptsHTML()) +
      '<div class="btn-row"><button class="btn btn-primary" id="scaffold-continue">' +
      'Continue <span class="key-hint">space</span></button>' +
      similarButton(c, 'btn-sm') + '</div></div>';
    PGRE.typesetMath(body());
    document.getElementById('scaffold-continue').addEventListener('click', runNextOverlay);
    wireSimilar(body());
  }

  /* F11 round checkpoint: pause after ROUND_SIZE presses with cards still queued. */
  function renderCheckpoint() {
    stopRecallTimer();
    setMasthead('');
    study.overlay = 'checkpoint';
    // study.done is cumulative across a resume (doneBase carries the earlier
    // segment's cards forward) but study.xp resets to 0 on resume, so pairing
    // them understates the session's XP. Use the session-wide pressCount * 2 —
    // the same honest basis renderStudySummary uses — beside the card count.
    var totalXp = study.pressCount * 2;
    body().innerHTML = '<div class="card practice-card checkpoint-card">' +
      '<h2>' + ROUND_SIZE + ' grades done</h2>' +
      '<p class="muted">' + study.done + ' card' + (study.done === 1 ? '' : 's') +
        ' graded · ' + study.queue.length + ' left in queue · +' + totalXp + ' XP so far.</p>' +
      '<div class="btn-row">' +
      '<button class="btn btn-primary" id="cp-keep">Keep going <span class="key-hint">space</span></button>' +
      '<button class="btn btn-ghost" id="cp-export" title="Export learning status for agent">Export status</button>' +
      '<button class="btn btn-ghost" id="cp-finish">Finish for now</button></div></div>';
    PGRE.typesetMath(body());
    document.getElementById('cp-keep').addEventListener('click', runNextOverlay);
    document.getElementById('cp-export').addEventListener('click', function () {
      openFormulaExportModal();
    });
    document.getElementById('cp-finish').addEventListener('click', function () {
      study.overlay = null;
      renderStudySummary();
    });
  }

  /* Settle the session's XP + activity-log line exactly once. The summary
     path calls it on a natural finish; switchMode / hashchange / mount call
     it when a round is abandoned after grades were already committed. */
  function settleStudy() {
    if (!study || study.settled || study.xp === 0) return;
    study.settled = true;
    PGRE.gamify.addXP(study.xp, '· formula review', true);
    // Log only the cards graded in THIS segment. done is cumulative across a
    // resume (resumeStudy carries saved.done forward), so subtract the segment's
    // starting count — otherwise a resumed segment re-counts the earlier segment's
    // cards in the recent-activity feed (which already logged them on exit).
    var segDone = study.done - (study.doneBase || 0);
    var segAgain = study.again - (study.againBase || 0);
    PGRE.store.log('review', 'Formula review: ' + segDone + ' card' +
      (segDone === 1 ? '' : 's') + (segAgain ? ' (' + segAgain + ' repeated)' : ''), study.xp);
    // Claim each local day a press was accepted, not the later exit date.
    if (PGRE.formulaCheckIn && typeof PGRE.formulaCheckIn.record === 'function') {
      var pressDays = [];
      (study.history || []).forEach(function (h) {
        if (h && h.day && pressDays.indexOf(h.day) === -1) pressDays.push(h.day);
      });
      for (var di = 0; di < pressDays.length; di++) {
        study.checkInResult = PGRE.formulaCheckIn.record(pressDays[di]);
      }
    }
    if (study.done >= 20 && study.again === 0) PGRE.store.state.flags.cleanRecall = true;
    PGRE.gamify.checkAchievements();
    PGRE.store.save();
  }

  function renderStudySummary() {
    stopRecallTimer();
    setMasthead('');
    if (PGRE.nav) PGRE.nav.setTrail([]);   // BUNDLE G: session over — back to base
    settleStudy();
    if (study) {
      lastCompletedStudy = {
        done: study.done || 0,
        again: study.again || 0,
        pressCount: study.pressCount || 0,
        history: Array.isArray(study.history) ? study.history.slice() : []
      };
    }
    // The session is finished (queue drained or "Finish for now"). A finish
    // marker keeps a stale snapshot from restoring it.
    endFormulaStudy(study ? study.done : 0);
    PGRE.store.save();
    // study.done/again are cumulative across the whole logical session, but study.xp
    // resets to 0 on a resume (each segment settles its own XP on exit). Pairing the
    // cumulative card count with the segment-only XP reads as if the whole session
    // earned only the resumed segment's XP. Every press awards a flat +2 XP and
    // pressCount carries across resumes, so pressCount * 2 is the session-wide XP —
    // the honest figure to sit beside the cumulative card count.
    var totalXp = (study ? study.pressCount : (lastCompletedStudy ? lastCompletedStudy.pressCount : 0)) * 2;
    var doneCount = study ? study.done : (lastCompletedStudy ? lastCompletedStudy.done : 0);
    var againCount = study ? study.again : (lastCompletedStudy ? lastCompletedStudy.again : 0);
    var checkInHtml = '';
    if (PGRE.formulaCheckIn) {
      if (study && study.checkInResult && study.checkInResult.claimed) {
        checkInHtml = PGRE.formulaCheckIn.celebrateHTML(study.checkInResult);
      } else {
        checkInHtml = PGRE.formulaCheckIn.alreadyHTML();
      }
    }
    body().innerHTML = '<div class="card practice-card">' +
      '<h1>Review complete</h1>' +
      '<div class="summary-score">' + doneCount + ' card' + (doneCount === 1 ? '' : 's') +
        '<span class="summary-pct">+' + totalXp + ' XP</span></div>' +
      '<p class="muted">' + (againCount ? againCount + ' came back for another pass this session. ' : '') +
      'What is left stays due — it returns in the next batch on Today.</p></div>' +
      checkInHtml +
      '<div class="card practice-card"><div class="btn-row">' +
      '<button class="btn btn-primary" id="back-deck">Back to the deck</button>' +
      '<button class="btn btn-ghost" id="summary-export-btn" title="Export learning status for agent">Export status</button>' +
      '<a class="btn btn-ghost" href="#/">Dashboard</a></div>' +
      '<p class="muted agent-receipt-hint" style="margin-top: 12px;">Export your learning status or copy the receipt for your OrbitOS agent to perceive today\'s formula recall.</p></div>';
    document.getElementById('back-deck').addEventListener('click', function () {
      study = null;
      renderHome();
    });
    var sEb = document.getElementById('summary-export-btn');
    if (sEb) sEb.addEventListener('click', function () {
      openFormulaExportModal();
    });
    study = null;
  }

  /* ——— Formula Learning Status Export (OrbitOS agent perception) ———
     Builds a structured snapshot payload of formulas recalled today and overall
     deck mastery for AI agent perception and daily logs.
     Persists to sessionStorage, localStorage['pgre-formula-receipt'], and
     state.lastFormulaReceipt. */

  function addDays(dayStr, n) {
    if (PGRE.srs && typeof PGRE.srs.addDaysTo === 'function') {
      return PGRE.srs.addDaysTo(dayStr, n);
    }
    var p = String(dayStr).split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    d.setDate(d.getDate() + n);
    var mm = String(d.getMonth() + 1);
    if (mm.length < 2) mm = '0' + mm;
    var dd = String(d.getDate());
    if (dd.length < 2) dd = '0' + dd;
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  function getScopeLabels(scope) {
    if (scope === '7d') {
      return {
        tile: 'Recalled (7 days)',
        head: 'Recalled in last 7 days',
        empty: 'No formulas reviewed in the last 7 days.',
        summary: 'Recalled in last 7 days',
        subhead: 'Recalled formulas (last 7 days):'
      };
    }
    if (scope === '30d') {
      return {
        tile: 'Recalled (30 days)',
        head: 'Recalled in last 30 days',
        empty: 'No formulas reviewed in the last 30 days.',
        summary: 'Recalled in last 30 days',
        subhead: 'Recalled formulas (last 30 days):'
      };
    }
    if (scope === 'all') {
      return {
        tile: 'Recalled (all time)',
        head: 'Recalled (all time)',
        empty: 'No formulas reviewed yet.',
        summary: 'Recalled (all time)',
        subhead: 'Recalled formulas (all time):'
      };
    }
    return {
      tile: 'Recalled today',
      head: 'Today\'s recalled formulas',
      empty: 'No formulas reviewed yet today. Complete recall cards to log today\'s practice.',
      summary: 'Recalled today',
      subhead: 'Today\'s recalled formulas:'
    };
  }

  function gatherRecalled(targetScope, fromDay, toDay) {
    var s = (PGRE.store && PGRE.store.state) || {};
    var today = toDay || ((PGRE.srs && typeof PGRE.srs.today === 'function') ? PGRE.srs.today() : (new Date().toISOString().slice(0, 10)));

    function inWindow(d) {
      if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
      if (fromDay && d < fromDay) return false;
      if (d > today) return false;
      return true;
    }

    var recalledMap = {};
    var recalledList = [];

    // Source A: live session presses whose own day falls in the window.
    // A missing day is not "today".
    if (study && Array.isArray(study.history) && study.history.length) {
      study.history.forEach(function (h) {
        if (!h || !h.c || !h.c.id || !inWindow(h.day)) return;
        var cid = h.c.id;
        if (!recalledMap[cid]) {
          var item = {
            id: cid,
            name: cardName(h.c),
            topic: h.c.topic || '',
            topicName: ((PGRE.topicById && PGRE.topicById(h.c.topic)) || {}).name || h.c.topic || '',
            chapter: h.c.chapter != null ? h.c.chapter : '',
            eq: h.c.eq || '',
            front: h.c.front || '',
            back: h.c.back || '',
            grades: h.grade ? [h.grade] : [],
            lastGrade: h.grade || ''
          };
          recalledMap[cid] = item;
          recalledList.push(item);
        } else if (h.grade) {
          recalledMap[cid].grades.push(h.grade);
          recalledMap[cid].lastGrade = h.grade;
        }
      });
    }

    // Source B: last completed session in this page, same day rule as source A.
    if (lastCompletedStudy && Array.isArray(lastCompletedStudy.history) && lastCompletedStudy.history.length) {
      lastCompletedStudy.history.forEach(function (h) {
        if (!h || !h.c || !h.c.id || !inWindow(h.day)) return;
        var cid = h.c.id;
        if (!recalledMap[cid]) {
          var item = {
            id: cid,
            name: cardName(h.c),
            topic: h.c.topic || '',
            topicName: ((PGRE.topicById && PGRE.topicById(h.c.topic)) || {}).name || h.c.topic || '',
            chapter: h.c.chapter != null ? h.c.chapter : '',
            eq: h.c.eq || '',
            front: h.c.front || '',
            back: h.c.back || '',
            grades: h.grade ? [h.grade] : [],
            lastGrade: h.grade || ''
          };
          recalledMap[cid] = item;
          recalledList.push(item);
        } else if (h.grade && recalledMap[cid].grades.indexOf(h.grade) < 0) {
          recalledMap[cid].grades.push(h.grade);
        }
      });
    }

    // Source C: cards studied in window according to store.cards and srs.studiedToday
    if (s.cards && typeof s.cards === 'object') {
      Object.keys(s.cards).forEach(function (cid) {
        var st = s.cards[cid];
        if (!st) return;
        var studied = false;
        if (st.lastReviewedDay) {
          studied = inWindow(st.lastReviewedDay);
        } else if (targetScope === 'today' && PGRE.srs && typeof PGRE.srs.studiedToday === 'function') {
          studied = PGRE.srs.studiedToday(st);
        }
        if (!studied) return;

        var c = deckById(cid) || ((PGRE.getFormulaCard && PGRE.getFormulaCard(cid)) || null);
        if (!recalledMap[cid]) {
          var item = {
            id: cid,
            name: c ? cardName(c) : cid,
            topic: (c && c.topic) || '',
            topicName: ((c && PGRE.topicById && PGRE.topicById(c.topic)) || {}).name || (c && c.topic) || '',
            chapter: (c && c.chapter != null) ? c.chapter : '',
            eq: (c && c.eq) || '',
            front: (c && c.front) || '',
            back: (c && c.back) || '',
            grades: st.lastGrade ? [st.lastGrade] : [],
            lastGrade: st.lastGrade || ''
          };
          recalledMap[cid] = item;
          recalledList.push(item);
        }
      });
    }

    // Source D: cardReviews entries in window
    if (Array.isArray(s.cardReviews)) {
      for (var rIdx = s.cardReviews.length - 1; rIdx >= 0; rIdx--) {
        var rev = s.cardReviews[rIdx];
        if (!rev || !rev.id || !inWindow(rev.d)) continue;
        var rCid = rev.id;
        var rC = deckById(rCid) || ((PGRE.getFormulaCard && PGRE.getFormulaCard(rCid)) || null);
        if (!recalledMap[rCid]) {
          var rItem = {
            id: rCid,
            name: rC ? cardName(rC) : rCid,
            topic: (rC && rC.topic) || '',
            topicName: ((rC && PGRE.topicById && PGRE.topicById(rC.topic)) || {}).name || (rC && rC.topic) || '',
            chapter: (rC && rC.chapter != null) ? rC.chapter : '',
            eq: (rC && rC.eq) || '',
            front: (rC && rC.front) || '',
            back: (rC && rC.back) || '',
            grades: rev.g ? [rev.g] : [],
            lastGrade: rev.g || ''
          };
          recalledMap[rCid] = rItem;
          recalledList.push(rItem);
        } else if (rev.g && recalledMap[rCid].grades.indexOf(rev.g) < 0) {
          recalledMap[rCid].grades.unshift(rev.g);
        }
      }
    }

    // Enrich every recalled item with latest SRS state
    recalledList.forEach(function (item) {
      var st = s.cards && s.cards[item.id];
      if (st) {
        item.interval = st.interval != null ? st.interval : 0;
        item.due = st.due || '';
        item.reps = st.reps || 0;
        item.lapses = st.lapses || 0;
        item.reviews = st.reviews || 0;
        item.ease = st.ease != null ? Math.round(st.ease * 100) / 100 : 2.5;
        item.status = (st.interval >= matureDays()) ? 'mature' : ((st.interval > 0) ? 'learning' : 'new');
        item.lastReviewedAt = st.lastReviewedAt || '';
        if (!item.lastGrade && st.lastGrade) item.lastGrade = st.lastGrade;
      } else {
        item.interval = 0;
        item.status = 'new';
      }
    });

    return recalledList;
  }

  function buildFormulaReceipt(scope) {
    var s = (PGRE.store && PGRE.store.state) || {};
    var today = (PGRE.srs && typeof PGRE.srs.today === 'function') ? PGRE.srs.today() : (new Date().toISOString().slice(0, 10));
    var allCards = (deck && deck.length) ? deck : ((PGRE.deck && PGRE.deck.length) ? PGRE.deck : (PGRE.FORMULAS || []));

    var validScope = (scope === '7d' || scope === '30d' || scope === 'all') ? scope : 'today';
    var fromDay = null;
    if (validScope === 'today') fromDay = today;
    else if (validScope === '7d') fromDay = addDays(today, -6);
    else if (validScope === '30d') fromDay = addDays(today, -29);

    var recalledList = gatherRecalled(validScope, fromDay, today);
    var recalledTodayList = (validScope === 'today') ? recalledList : gatherRecalled('today', today, today);
    // 2. Overall deck mastery and learning status
    var totalDeck = allCards.length;
    var learnedCount = 0;
    var matureCount = 0;
    var learningCount = 0;
    var dueTodayCount = 0;
    var byTopic = {};

    if (Array.isArray(PGRE.TOPICS)) {
      PGRE.TOPICS.forEach(function (t) {
        byTopic[t.id] = { name: t.name, total: 0, learned: 0, mature: 0 };
      });
    }

    allCards.forEach(function (c) {
      if (!c || !c.id) return;
      var top = byTopic[c.topic];
      if (top) top.total++;
      var st = s.cards && s.cards[c.id];
      if (st && st.reviews > 0) {
        learnedCount++;
        if (top) top.learned++;
        if (st.interval >= matureDays()) {
          matureCount++;
          if (top) top.mature++;
        } else {
          learningCount++;
        }
        if (st.due && st.due <= today) dueTodayCount++;
      } else {
        dueTodayCount++;
      }
    });

    var unseenCount = Math.max(0, totalDeck - learnedCount);
    var pctLearned = totalDeck > 0 ? Math.round((learnedCount / totalDeck) * 1000) / 10 : 0;

    // Daily streak & check-in
    var checkIn = null;
    if (s.formulaCheckIn && typeof s.formulaCheckIn === 'object') {
      checkIn = {
        currentStreak: s.formulaCheckIn.current || 0,
        bestStreak: s.formulaCheckIn.best || 0,
        checkedToday: s.formulaCheckIn.lastDay === today
      };
    }

    // 3. Session info
    var sessionInfo = null;
    if (study) {
      sessionInfo = {
        state: 'in-progress',
        done: study.done || 0,
        again: study.again || 0,
        queueRemaining: Array.isArray(study.queue) ? study.queue.length : 0,
        pressCount: study.pressCount || 0,
        xpEarned: (study.pressCount || 0) * 2
      };
    } else if (lastCompletedStudy) {
      sessionInfo = {
        state: 'completed',
        done: lastCompletedStudy.done || 0,
        again: lastCompletedStudy.again || 0,
        queueRemaining: 0,
        pressCount: lastCompletedStudy.pressCount || 0,
        xpEarned: (lastCompletedStudy.pressCount || 0) * 2
      };
    } else {
      sessionInfo = {
        state: 'idle',
        recalledTodayCount: recalledTodayList.length
      };
    }

    // 4. Human / agent readable summary text
    var labels = getScopeLabels(validScope);
    var summaryLines = [
      '# Formula Recall · ' + today,
      labels.summary + ': ' + recalledList.length + ' formula' + (recalledList.length === 1 ? '' : 's') + '.',
      'Overall mastery: ' + learnedCount + '/' + totalDeck + ' learned (' + pctLearned + '%), ' + matureCount + ' mature, ' + unseenCount + ' unseen' + (checkIn ? ' (streak ' + checkIn.currentStreak + ' d)' : '') + '.'
    ];
    if (recalledList.length) {
      summaryLines.push('\n' + labels.subhead);
      recalledList.forEach(function (r, idx) {
        var gradeTag = r.lastGrade ? ' [' + r.lastGrade.toUpperCase() + ']' : '';
        var ivlTag = r.interval != null ? ' (ivl: ' + r.interval + 'd)' : '';
        summaryLines.push((idx + 1) + '. ' + r.id + ': ' + (r.name || r.id) + ' — ' + (r.topicName || r.topic) + gradeTag + ivlTag);
      });
    }
    // 2b. Collect full list of all learned formulas in the deck
    var allLearned = [];
    if (s.cards && typeof s.cards === 'object') {
      Object.keys(s.cards).forEach(function (cid) {
        var st = s.cards[cid];
        if (!st || !st.reviews) return;
        var c = deckById(cid) || ((PGRE.getFormulaCard && PGRE.getFormulaCard(cid)) || null);
        allLearned.push({
          id: cid,
          name: c ? cardName(c) : cid,
          topic: (c && c.topic) || '',
          topicName: ((c && PGRE.topicById && PGRE.topicById(c.topic)) || {}).name || (c && c.topic) || '',
          chapter: (c && c.chapter != null) ? c.chapter : '',
          eq: (c && c.eq) || '',
          front: (c && c.front) || '',
          back: (c && c.back) || '',
          interval: st.interval || 0,
          due: st.due || '',
          reps: st.reps || 0,
          lapses: st.lapses || 0,
          reviews: st.reviews || 0,
          ease: st.ease != null ? Math.round(st.ease * 100) / 100 : 2.5,
          status: (st.interval >= matureDays()) ? 'mature' : ((st.interval > 0) ? 'learning' : 'new'),
          lastGrade: st.lastGrade || '',
          lastReviewedDay: st.lastReviewedDay || ''
        });
      });
    }

    return {
      v: 1,
      kind: 'pgre-formula-receipt',
      scope: validScope,
      range: {
        from: fromDay,
        to: today
      },
      exportedAt: new Date().toISOString(),
      date: today,
      origin: (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : ((typeof location !== 'undefined' && location.origin) ? location.origin : 'file://'),
      session: sessionInfo,
      recalled: recalledList,
      recalledToday: recalledTodayList,
      overallStatus: {
        deckSize: totalDeck,
        learned: learnedCount,
        pctLearned: pctLearned,
        mature: matureCount,
        learning: learningCount,
        unseen: unseenCount,
        dueToday: dueTodayCount,
        streak: checkIn,
        byTopic: byTopic
      },
      allLearnedCards: allLearned,
      summaryText: summaryLines.join('\n')
    };
  }

  function persistFormulaReceipt(receipt) {
    if (!receipt) return;
    var json = JSON.stringify(receipt);
    try { sessionStorage.setItem('pgre-formula-receipt', json); } catch (e) {}
    try { localStorage.setItem('pgre-formula-receipt', json); } catch (e2) {}
    var st = PGRE.store && PGRE.store.state;
    if (st) {
      st.lastFormulaReceipt = receipt;
      PGRE.store.save();
    }
  }

  function copyFormulaReceipt(receipt, btn) {
    if (!receipt) return;
    var text = JSON.stringify(receipt, null, 2);
    function ok() {
      if (btn) {
        btn.textContent = 'Copied — paste in chat';
        btn.classList.add('btn-ok');
        setTimeout(function () {
          if (btn) {
            btn.textContent = 'Copy status for agent';
            btn.classList.remove('btn-ok');
          }
        }, 3000);
      }
      if (PGRE.toast) {
        PGRE.toast('Learning status copied — paste in chat for agent', 'info');
      }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, fallback);
    } else {
      fallback();
    }
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        ok();
      } catch (err) {
        var pre = document.getElementById('export-json-preview');
        if (pre) {
          var det = pre.closest('details');
          if (det) det.open = true;
          pre.scrollIntoView();
        }
        if (PGRE.toast) PGRE.toast('Could not write clipboard automatically. Select and copy from JSON view.', 'info');
      }
    }
  }

  function downloadFormulaReceipt(receipt) {
    if (!receipt) return;
    var day = (receipt.date || (PGRE.srs && PGRE.srs.today()) || '').replace(/-/g, '');
    var suffix = (receipt.scope && receipt.scope !== 'today') ? ('-' + receipt.scope) : '';
    var filename = 'pgre-formula-status-' + (day || 'today') + suffix + '.json';
    var blob = new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    if (PGRE.toast) {
      PGRE.toast('Downloaded ' + filename, 'info');
    }
  }

  function openFormulaExportModal() {
    var receipt = buildFormulaReceipt('today');
    persistFormulaReceipt(receipt);

    var old = document.getElementById('formula-export-overlay');
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var overlay = document.createElement('div');
    overlay.className = 'exam-overlay';
    overlay.id = 'formula-export-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Formula learning status');

    function renderModalContent(rcpt) {
      var recalled = (rcpt && (rcpt.recalled || rcpt.recalledToday)) || [];
      var recalledCount = recalled.length;
      var overall = (rcpt && rcpt.overallStatus) || {};
      var learned = overall.learned || 0;
      var total = overall.deckSize || 0;
      var pct = overall.pctLearned != null ? overall.pctLearned : 0;
      var mature = overall.mature || 0;
      var labels = getScopeLabels((rcpt && rcpt.scope) || 'today');

      var listHtml = '';
      if (recalledCount > 0) {
        listHtml = '<div class="export-recalled-wrap">' +
          '<div class="export-recalled-head">' +
            '<span>' + labels.head + ' (' + recalledCount + ')</span>' +
            '<span class="muted" style="font-size: 11px;">topic · grade · interval</span>' +
          '</div>' +
          '<div class="export-recalled-list">';
        recalled.forEach(function (item) {
          var topChip = item.topic ? '<span class="chip" style="font-size: 11px; padding: 1px 6px;">' + PGRE.ui.esc(item.topic) + '</span>' : '';
          var gradeClass = item.lastGrade ? 'grade-' + item.lastGrade : '';
          var gradeBadge = item.lastGrade ? '<span class="grade-chip ' + gradeClass + '" style="font-size: 10px; padding: 1px 6px;">' + PGRE.ui.esc(item.lastGrade) + '</span>' : '';
          var ivlStr = item.interval != null ? '<span style="font-size: 11px; font-family: var(--mono); color: var(--muted);">' + item.interval + 'd</span>' : '';
          listHtml += '<div class="export-recalled-item">' +
            '<div class="export-recalled-item-left">' +
              '<span class="export-item-id">' + PGRE.ui.esc(item.id) + '</span>' +
              '<span class="export-item-name">' + PGRE.ui.esc(item.name || item.id) + '</span>' +
            '</div>' +
            '<div class="export-recalled-item-right">' +
              topChip + gradeBadge + ivlStr +
            '</div>' +
          '</div>';
        });
        listHtml += '</div></div>';
      } else {
        listHtml = '<div class="export-recalled-wrap" style="padding: 14px; text-align: center;">' +
          '<p class="muted" style="margin: 0; font-size: 13px;">' + labels.empty + '</p>' +
        '</div>';
      }

      var jsonStr = JSON.stringify(rcpt, null, 2);

      return '<div class="export-stats-grid">' +
          '<div class="export-stat-tile">' +
            '<div class="stat-num">' + recalledCount + '</div>' +
            '<div class="stat-label">' + labels.tile + '</div>' +
          '</div>' +
          '<div class="export-stat-tile">' +
            '<div class="stat-num">' + learned + '<span style="font-size: 12px; color: var(--muted); font-weight: normal;"> / ' + total + '</span></div>' +
            '<div class="stat-label">' + pct + '% learned</div>' +
          '</div>' +
          '<div class="export-stat-tile">' +
            '<div class="stat-num">' + mature + '</div>' +
            '<div class="stat-label">Mature (≥ ' + matureDays() + ' d)</div>' +
          '</div>' +
        '</div>' +
        listHtml +
        '<details class="export-json-details" style="margin-top: 10px;">' +
          '<summary class="muted" style="cursor: pointer; font-size: 11px;">View full JSON payload</summary>' +
          '<pre class="agent-receipt-fallback" id="export-json-preview" style="max-height: 120px; margin-top: 6px;">' + PGRE.ui.esc(jsonStr) + '</pre>' +
        '</details>';
    }

    overlay.innerHTML = '<div class="card exam-overlay-card formula-export-card">' +
      '<div class="export-modal-header">' +
        '<div>' +
          '<h2 style="margin: 0 0 2px;">Formula learning status</h2>' +
          '<div class="muted" style="font-size: 12px;">' + receipt.date + ' · for your OrbitOS agent</div>' +
        '</div>' +
        '<div class="export-modal-header-actions">' +
          '<select id="export-scope-sel" class="export-scope-sel" aria-label="Export time scope">' +
            '<option value="today" selected>Today</option>' +
            '<option value="7d">Last 7 days</option>' +
            '<option value="30d">Last 30 days</option>' +
            '<option value="all">All time</option>' +
          '</select>' +
          '<button type="button" class="btn btn-ghost btn-sm" id="export-modal-close" aria-label="Close">&times;</button>' +
        '</div>' +
      '</div>' +
      '<div id="export-modal-body">' +
        renderModalContent(receipt) +
      '</div>' +
      '<div class="btn-row" style="margin-top: 14px; justify-content: flex-end;">' +
        '<button type="button" class="btn btn-primary" id="export-copy-btn">Copy status for agent</button>' +
        '<button type="button" class="btn btn-ghost" id="export-download-btn">Download .json</button>' +
        '<button type="button" class="btn btn-ghost" id="export-done-btn">Done</button>' +
      '</div>' +
    '</div>';

    document.body.appendChild(overlay);

    function closeModal() {
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      document.removeEventListener('keydown', handleKey);
    }

    function handleKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
      }
    }
    document.addEventListener('keydown', handleKey);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });

    var scopeSel = document.getElementById('export-scope-sel');
    if (scopeSel) {
      scopeSel.addEventListener('change', function () {
        var newScope = scopeSel.value || 'today';
        receipt = buildFormulaReceipt(newScope);
        persistFormulaReceipt(receipt);
        var bodyEl = document.getElementById('export-modal-body');
        if (bodyEl) {
          var detailsEl = (typeof bodyEl.querySelector === 'function') ? bodyEl.querySelector('details') : null;
          var wasOpen = detailsEl ? detailsEl.open : false;
          bodyEl.innerHTML = renderModalContent(receipt);
          if (wasOpen && typeof bodyEl.querySelector === 'function') {
            var newDetails = bodyEl.querySelector('details');
            if (newDetails) newDetails.open = true;
          }
        }
      });
    }

    var closeBtn = document.getElementById('export-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    var doneBtn = document.getElementById('export-done-btn');
    if (doneBtn) doneBtn.addEventListener('click', closeModal);

    var copyBtn = document.getElementById('export-copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        copyFormulaReceipt(receipt, copyBtn);
      });
    }

    var dlBtn = document.getElementById('export-download-btn');
    if (dlBtn) {
      dlBtn.addEventListener('click', function () {
        downloadFormulaReceipt(receipt);
      });
    }
  }

  /* ——— Match / Type / Quiz intros ——— */
  var INTRO = {
    match: { title: 'Match',
      desc: 'Pair each prompt with its formula against the clock — a wrong pair shakes and flips back. Practice only: this round does not clear scheduled reviews and does not record a Good. +2 XP per pair.' },
    type: { title: 'Type-to-recall',
      desc: 'See the prompt, type the formula, then grade yourself Again / Hard / Good / Easy — an auto-check preselects the default. Your grade schedules the card just like flip mode.' },
    quiz: { title: 'Auto-quiz',
      desc: 'Multiple choice built from your deck. Answer with 1–4 or a click; a right answer schedules the card Good, a miss Again.' },
    cloze: { title: 'Cloze',
      desc: 'One term of the formula is blanked — pick what goes in the box. The detail you’d fumble on exam day.' }
  };

  function renderGameIntro(kind) {
    setMasthead('');
    if (PGRE.nav) PGRE.nav.setTrail([]);   // BUNDLE G: game tabs sit at base
    teardownGame();
    if (!PGRE.flashmodes) {
      // load failed earlier (mount already tried): say so and offer a retry
      body().innerHTML = '<div class="card"><p class="muted">Game modes are unavailable — ' +
        'flashmodes failed to load. Study mode still works.</p>' +
        '<div class="btn-row"><button class="btn btn-ghost" id="flash-retry">Retry</button></div></div>';
      var rt = document.getElementById('flash-retry');
      if (rt) rt.addEventListener('click', function () {
        ensureFlashmodes().then(function () { renderGameIntro(kind); });
      });
      return;
    }
    var ui = PGRE.ui, m = INTRO[kind];
    var remaining = PGRE.srs.formulaDayRemaining(deck).length;
    var metNote = 'Today’s list is empty — start Study or choose cards in Recall ' +
      'first; games drill only today’s list.';
    var listOnly = 'Today’s remaining cards are all book lists. ' +
      'Study and Quiz drill lists; Match, Type and Cloze drill formulas only.';
    var html = '<div class="card"><h2>' + m.title + '</h2><p class="muted">' + m.desc + '</p>';

    if (kind === 'match') {
      // Pair count comes from the ACTUAL pooled pick, not min(6, deck.length).
      var mcards = PGRE.flashmodes.pickMatchCards(deck);
      var pairs = mcards.length;
      var best = PGRE.flashmodes.matchBest(pairs);
      html += '<div class="stat-row stat-row-4">' +
        ui.statTile('Pairs this game', ui.fmt(pairs)) +
        ui.statTile('Best · ' + pairs + ' pairs', best != null ? PGRE.flashmodes.fmtTime(best) : '—') +
      '</div>';
      if (!pairs) {
        html += '<p class="muted">' + (remaining ? listOnly : metNote) + '</p></div>';
        body().innerHTML = html; return;
      }
      if (pairs < 2) {
        html += '<p class="muted">Match needs at least two cards to play.</p></div>';
        body().innerHTML = html; return;
      }
      html += '<div class="btn-row"><button class="btn btn-primary" id="game-start">Start ' +
        pairs + '-pair game</button></div>';
    } else if (kind === 'cloze') {
      // Round size is the ACTUAL cloze-able pool (pickQueue policy, filtered, cap 12).
      var cpool = PGRE.flashmodes.clozePool(deck);
      html += '<div class="stat-row stat-row-4">' +
        ui.statTile('This round', ui.fmt(cpool.length)) + '</div>';
      if (!cpool.length) {
        html += '<p class="muted">No cloze-able cards in today’s pool yet.</p></div>';
        body().innerHTML = html; return;
      }
      html += '<div class="btn-row"><button class="btn btn-primary" id="game-start">Start</button></div>';
    } else {
      var q = PGRE.flashmodes.pickQueue(deck, kind);
      html += '<div class="stat-row stat-row-4">' +
        ui.statTile('Today remaining', ui.fmt(remaining)) +
        ui.statTile('This round', ui.fmt(q.length)) +
      '</div>' +
      '<p class="muted">' + (q.length ? 'Drawn from today’s picked batch.' : (remaining ? listOnly : metNote)) + '</p>';
      if (kind === 'quiz' && deck.length < 2) {
        html += '<p class="muted">Quiz needs at least two cards to build choices.</p></div>';
        body().innerHTML = html; return;
      }
      var quizable = q;
      if (kind === 'quiz' && PGRE.flashmodes && PGRE.flashmodes.quizOptions) {
        var unquizzable = q.filter(function (c) {
          var built = PGRE.flashmodes.quizOptions(c, deck);
          return !built || !built.opts || built.opts.length < 2;
        });
        if (unquizzable.length) {
          html += '<p class="muted" id="quiz-unquizzable">' + unquizzable.length +
            ' card' + (unquizzable.length === 1 ? '' : 's') +
            ' cannot be quizzed until two same-kind choices exist. ' +
            (unquizzable.length === 1 ? 'It stays' : 'They stay') +
            ' in today’s list — use Study.</p>';
        }
        quizable = q.filter(function (c) {
          var built = PGRE.flashmodes.quizOptions(c, deck);
          return built && built.opts && built.opts.length >= 2;
        });
      }
      if (!q.length || (kind === 'quiz' && !quizable.length)) {
        html += '</div>';
        body().innerHTML = html; return;
      }
      html += '<div class="btn-row"><button class="btn btn-primary" id="game-start">Start</button></div>';
    }
    html += '</div>';
    body().innerHTML = html;
    PGRE.typesetMath(body());
    var b = document.getElementById('game-start');
    if (b) b.addEventListener('click', function () { launchGame(kind); });
  }

  function launchGame(kind) {
    teardownGame();
    var base = {
      el: body(),
      onReplay: function () { launchGame(kind); },
      onExit: function () { teardownGame(); renderGameIntro(kind); }
    };
    if (kind === 'match') {
      base.cards = PGRE.flashmodes.pickMatchCards(deck);
      activeGame = PGRE.flashmodes.startMatch(base);
    } else if (kind === 'type') {
      base.cards = PGRE.flashmodes.pickQueue(deck, 'type');
      activeGame = PGRE.flashmodes.startType(base);
    } else if (kind === 'cloze') {
      base.cards = PGRE.flashmodes.clozePool(deck);
      base.deck = deck;
      activeGame = PGRE.flashmodes.startCloze(base);
    } else {
      base.cards = PGRE.flashmodes.pickQueue(deck, 'quiz');
      base.deck = deck;
      activeGame = PGRE.flashmodes.startQuiz(base);
    }
  }

  /* ——————————————— Search mode ———————————————
     The box drives js/formula-search.js; the results are rendered as face-down
     flashcards. Search itself is side-effect free (status:today never builds a
     batch). Explicit Add buttons add hits into the picked batch via
     srs.addFormulaDaySoft. "Study these N" remains a separate ad-hoc session
     that grades SRS but does not edit the daily batch. */

  var SEARCH_PAGE = 30;                 // cards rendered before "show more"
  // Survives tab switches within a visit (the query is usually still wanted) but
  // is reset by mount(); `open` remembers which result cards were flipped face-up.
  var searchQ = { q: '', topic: '', status: '', sort: 'relevance' };
  var searchShown = SEARCH_PAGE;
  var searchOpen = Object.create(null);
  var searchIndex = null;
  var searchLast = null;                // last result set, for paging + the drill
  // Module-scoped so a re-render (or Clear) can cancel a keystroke still in
  // flight — a stray timer from a discarded panel used to fire afterwards and
  // repopulate the fresh one with the old query's results.
  var searchTimer = null;

  var WHY_ORDER = ['equation', 'acronym', 'synonym', 'fuzzy', 'substr', 'stem'];
  var SEARCH_EXAMPLES = [
    'centripetal', 'capacitence', 'shm', 'v^2/r', 'emf',
    'topic:qm uncertainty', 'status:new', '"time dilation"'
  ];

  function searchResultsEl() { return document.getElementById('fs-results'); }

  function renderSearch() {
    setMasthead('');
    if (PGRE.nav) PGRE.nav.setTrail([]);
    teardownGame();
    clearTimeout(searchTimer);          // no stale keystroke may outlive this panel
    // The portal's DOM is gone once the route changes; the async engine-load path
    // below can land here after that, and writing into a null body would throw.
    if (!body()) return;
    if (!PGRE.formulaSearch) {
      if (searchFailed) {
        body().innerHTML = '<div class="card"><p class="muted">Search is unavailable — ' +
          'the matching engine failed to load. Every other mode still works.</p>' +
          '<div class="btn-row"><button class="btn btn-ghost" id="fs-retry">Retry</button></div></div>';
        var rt = document.getElementById('fs-retry');
        if (rt) rt.addEventListener('click', function () {
          searchFailed = false;
          renderSearch();
        });
        return;
      }
      body().innerHTML = '<div class="card"><p class="muted">Loading search…</p></div>';
      ensureSearchEngine().then(function () {
        // A script that loads but defines nothing (a parse error inside it) still
        // resolves, so failure has to be judged on the engine — not on onerror
        // alone, or this would re-render into the same load attempt forever.
        if (!PGRE.formulaSearch) { searchFailed = true; searchLoad = null; }
        if (mode === 'search') renderSearch();
      });
      return;
    }

    // Rebuilt on every entry to the tab: it costs a few milliseconds over a few
    // hundred cards and keeps mnemonics (which live in the store, not the deck)
    // in the index without any invalidation bookkeeping.
    searchIndex = PGRE.formulaSearch.build(deck);

    var ui = PGRE.ui;
    var topicOpts = '<option value="">All topics</option>';
    PGRE.TOPICS.forEach(function (t) {
      topicOpts += '<option value="' + ui.esc(t.id) + '"' +
        (searchQ.topic === t.id ? ' selected' : '') + '>' + ui.esc(t.name) + '</option>';
    });
    var statusOpts = '';
    PGRE.formulaSearch.STATUSES.forEach(function (s) {
      var label = (typeof PGRE.formulaSearch.statusLabel === 'function')
        ? PGRE.formulaSearch.statusLabel(s) : s.label;
      statusOpts += '<option value="' + ui.esc(s.key) + '"' +
        (searchQ.status === s.key ? ' selected' : '') + '>' + ui.esc(label) + '</option>';
    });
    var sortOpts = '';
    [['relevance', 'Best match'], ['order', 'Book order'], ['due', 'Due soonest']]
      .forEach(function (o) {
        sortOpts += '<option value="' + o[0] + '"' +
          (searchQ.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      });

    var egs = SEARCH_EXAMPLES.map(function (e) {
      return '<button type="button" class="fs-eg" data-q="' + ui.esc(e) + '">' +
        ui.esc(e) + '</button>';
    }).join('');

    var html = '<div class="card fs-box">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap">' +
      '<h2 style="margin:0">Browse the deck</h2>' +
      '<button class="btn btn-ghost btn-sm" id="print-formulas">Print the formula sheet</button></div>' +
      '<p class="muted">Find a card by its name, by the words in its prompt, or by the ' +
      'shape of the equation itself — <code>v^2/r</code> finds the one that <em>is</em> ' +
      'that. Misspellings and word endings are forgiven, and shorthand like ' +
      '<strong>SHM</strong> or <strong>emf</strong> finds what it stands for. ' +
      'Leave the box empty to browse the whole deck.</p>' +
      '<input type="search" id="fs-input" class="fs-input" autocomplete="off" ' +
        'spellcheck="false" placeholder="Search ' + deck.length + ' formula cards…" ' +
        'value="' + ui.esc(searchQ.q) + '">' +
      '<div class="fs-controls">' +
        '<label class="fs-ctl"><span>Topic</span><select id="fs-topic">' + topicOpts + '</select></label>' +
        '<label class="fs-ctl"><span>Status</span><select id="fs-status-sel">' + statusOpts + '</select></label>' +
        '<label class="fs-ctl"><span>Sort</span><select id="fs-sort">' + sortOpts + '</select></label>' +
        '<button class="btn btn-ghost btn-sm fs-reset" id="fs-clear">Clear</button>' +
      '</div>' +
      '<div class="fs-statusline muted" id="fs-status" aria-live="polite"></div>' +
      '<details class="fs-help"><summary>Search tips</summary>' +
        '<p class="muted">Every word has to appear somewhere on the card. If nothing ' +
        'matches them all, the closest cards are shown instead and labelled as such.</p>' +
        '<ul class="fs-tips">' +
          '<li><code>"exact phrase"</code> — quotes demand the words together</li>' +
          '<li><code>topic:qm</code> — one of ' +
            PGRE.TOPICS.map(function (t) { return '<code>' + ui.esc(t.id) + '</code>'; }).join(', ') + '</li>' +
          '<li><code>tag:optics</code> — the card’s section name</li>' +
          '<li><code>eq:5.16</code> one equation, <code>eq:5</code> a whole chapter</li>' +
          '<li><code>status:new</code> · <code>due</code> · <code>leech</code> · ' +
            '<code>away</code> · <code>mnemonic</code> — same list as the dropdown</li>' +
        '</ul>' +
        '<div class="fs-egs">' + egs + '</div>' +
      '</details>' +
    '</div>' +
    '<div id="fs-actions"></div>' +
    '<div id="fs-results"></div>';

    body().innerHTML = html;
    wireSearch();
    runSearch(true);
    var inp = document.getElementById('fs-input');
    if (inp) inp.focus();
  }

  function wireSearch() {
    var inp = document.getElementById('fs-input');
    inp.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        if (!inp.isConnected) return;   // this panel was replaced mid-keystroke
        searchQ.q = inp.value;
        runSearch(true);
      }, 180);
    });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { clearTimeout(searchTimer); searchQ.q = inp.value; runSearch(true); }
      else if (e.key === 'Escape' && inp.value) {
        e.preventDefault();
        clearTimeout(searchTimer);
        inp.value = ''; searchQ.q = ''; runSearch(true);
      }
    });
    function bindSel(id, key) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', function () {
        searchQ[key] = el.value;
        runSearch(true);
      });
    }
    bindSel('fs-topic', 'topic');
    bindSel('fs-status-sel', 'status');
    bindSel('fs-sort', 'sort');
    var cl = document.getElementById('fs-clear');
    if (cl) cl.addEventListener('click', function () {
      clearTimeout(searchTimer);
      searchQ = { q: '', topic: '', status: '', sort: 'relevance' };
      renderSearch();
    });

    // One delegated handler for the whole result list — it survives every
    // re-render, so paging and re-queries never need to re-wire anything.
    searchResultsEl().addEventListener('click', function (e) {
      if (e.target.closest('#fs-more')) {
        searchShown += SEARCH_PAGE;
        renderSearchList();
        return;
      }
      var fix = e.target.closest('[data-fsfix]');
      if (fix) {
        var box = document.getElementById('fs-input');
        box.value = fix.getAttribute('data-fsfix');
        searchQ.q = box.value;
        runSearch(true);
        box.focus();
        return;
      }
      // Open visualizer / complete view modal without toggling the card.
      var modalBtn = e.target.closest('[data-fs-modal]');
      if (modalBtn) {
        e.preventDefault();
        e.stopPropagation();
        var cardId = modalBtn.getAttribute('data-fs-modal');
        if (cardId && window.PGRE && window.PGRE.openVisualizerModal) {
          window.PGRE.openVisualizerModal(cardId);
        }
        return;
      }
      // The similar-problem control handles its own click (and the inert
      // "No similar problem" label must not toggle the card either).
      if (e.target.closest('.similar-problem-btn')) return;
      if (e.target.closest('.card-review-hist')) return;
      // Soft-add one card into today's batch without flipping the card.
      var addBtn = e.target.closest('[data-fs-add]');
      if (addBtn) {
        e.preventDefault();
        e.stopPropagation();
        softAddToToday([addBtn.getAttribute('data-fs-add')]);
        return;
      }
      // Park / unpark the card in one click — the same suspendCard path the
      // study session's Park uses, without entering a session.
      var parkBtn = e.target.closest('[data-fs-park]');
      if (parkBtn) {
        e.preventDefault();
        e.stopPropagation();
        var parkId = parkBtn.getAttribute('data-fs-park');
        if (parkId) {
          if (PGRE.srs.isSuspended(parkId)) PGRE.srs.unsuspendCard(parkId);
          else PGRE.srs.suspendCard(parkId);
          PGRE.store.save();
          // Re-run (not just re-render) so a status filter drops or picks up
          // the row whose put-away flag just flipped.
          runSearch(false);
        }
        return;
      }
      // The revealed face is for reading, not a second toggle: collapsing the
      // card out from under the formula you are studying (or mid text-selection)
      // is never what was meant. The button and the prompt still flip it.
      if (e.target.closest('.fs-back')) return;
      var sel = window.getSelection && window.getSelection();
      if (sel && !sel.isCollapsed && String(sel).trim()) return;
      var art = e.target.closest('.fs-card');
      if (art) toggleSearchCard(art);
    });
    // Example chips live in the tips block, above the results.
    body().querySelectorAll('.fs-eg').forEach(function (b) {
      b.addEventListener('click', function () {
        var box = document.getElementById('fs-input');
        box.value = b.getAttribute('data-q');
        searchQ.q = box.value;
        runSearch(true);
        box.focus();
      });
    });
  }

  function runSearch(reset) {
    if (reset) searchShown = SEARCH_PAGE;
    searchLast = PGRE.formulaSearch.run(searchIndex, searchQ.q, {
      topic: searchQ.topic, status: searchQ.status, sort: searchQ.sort
    });
    var st = document.getElementById('fs-status');
    var r = searchLast;
    if (st) {
      if (r.notice) {
        st.textContent = r.notice;
      } else if (r.browsing) {
        st.textContent = 'Browsing ' + PGRE.ui.fmt(r.total) + ' card' +
          (r.total === 1 ? '' : 's') + ' — type to search.';
      } else {
        st.textContent = PGRE.ui.fmt(r.total) + ' card' + (r.total === 1 ? '' : 's') +
          ' · ' + (r.ms < 10 ? r.ms.toFixed(1) : Math.round(r.ms)) + ' ms' +
          (r.loose ? ' · no card had every word — showing the closest' : '');
      }
    }
    renderSearchActions();
    renderSearchList();
  }

  function renderSearchActions() {
    var box = document.getElementById('fs-actions');
    if (!box) return;
    // Rehydrate before the zero-hit return. A partial read can hold the
    // session, and that note must still show when the search has no hits.
    var pending = rehydrateSavedStudy();
    if (sessionHeld) {
      var heldMissing = (lastDeckStatus && lastDeckStatus.missing) || [];
      var heldNames = [];
      for (var hi = 0; hi < heldMissing.length; hi++) {
        if (heldMissing[hi]) heldNames.push(PGRE.ui.esc(String(heldMissing[hi])));
      }
      box.innerHTML = '<div class="card fs-actionbar"><p id="deck-hold">The deck read is incomplete' +
        (heldNames.length ? ' (' + heldNames.join(', ') + ')' : '') +
        '. Study is waiting so a missing card is not dropped.</p></div>';
      return;
    }
    var n = searchLast ? searchLast.total : 0;
    if (!n) { box.innerHTML = ''; return; }
    /* Starting a drill overwrites whatever session was saved mid-flight (the
       leech drill has always done the same). Search makes that one click away
       from a browse of the entire deck, so say it plainly BEFORE the click
       rather than letting a half-finished daily round vanish unannounced. */
    var warn = pending ?
      '<span class="fs-actionwarn">Replaces the session you have in progress (' +
        pending.length + ' left).</span>' : '';
    var addLabel = n === 1 ? 'Add to today' : 'Add these ' + n + ' to today';
    box.innerHTML = '<div class="card fs-actionbar">' +
      '<button class="btn btn-primary" id="fs-drill">Study these ' + n +
        ' card' + (n === 1 ? '' : 's') + '</button>' +
      '<button class="btn btn-ghost" id="fs-add-today" type="button">' +
        addLabel + '</button>' +
      '<span class="muted fs-actionnote">Study grades without editing today’s list. ' +
      'Add soft-pins into the daily batch (may exceed your target)' +
      (n > 50 ? '. That is a long queue; a round checkpoint lets you stop at any point' : '') +
      '.</span>' + warn + '</div>';
    var b = document.getElementById('fs-drill');
    if (b) b.addEventListener('click', drillSearchResults);
    var add = document.getElementById('fs-add-today');
    if (add) add.addEventListener('click', function () {
      if (!searchLast || !searchLast.total) return;
      softAddToToday(searchLast.hits.map(function (h) { return h.card.id; }));
    });
  }

  /* Soft-pin card ids into today's formulaDay batch (may exceed T). Re-renders
     action/result chrome so "In today" chips update, and refreshes nav badges. */
  function softAddToToday(ids) {
    if (!ids || !ids.length) return;
    var srs = PGRE.srs;
    var res = srs.addFormulaDaySoft(deck, ids);
    var batch = res.batch;
    var N = batch.reviewIds.length + batch.newIds.length;
    var T = srs.clampTarget(PGRE.store.state.settings.formulaDailyTarget);
    var parts = [];
    if (res.added.length) {
      parts.push('Added ' + res.added.length);
    }
    if (res.already.length) {
      parts.push(res.already.length + ' already in today');
    }
    if (res.skipped.length) {
      parts.push(res.skipped.length + ' skipped');
    }
    if (!parts.length) parts.push('No change');
    var msg = parts.join(' · ') + ' · batch now ' + N + ' (target ' + T + ')';
    if (PGRE.toast) PGRE.toast(msg, 'info');
    if (PGRE.refreshNavBadges) PGRE.refreshNavBadges();
    renderSearchActions();
    renderSearchList();
  }

  /* Hand the matched cards to the ordinary Study flow. Going through switchMode
     (rather than assigning `mode` by hand) is what keeps the tab bar honest:
     setting the variable directly left switchMode's `m === mode` guard thinking
     the Study tab was already showing, so clicking it afterwards did nothing at
     all. switchMode renders the Study home first; startStudy then replaces it. */
  function drillSearchResults() {
    if (sessionHeld) return;
    if (!searchLast || !searchLast.total) return;
    var cards = searchLast.hits.map(function (h) { return h.card; });
    switchMode('study');
    startStudy(cards, false);
  }

  /* The "why did this card come back" chip — only for the matches a reader would
     not otherwise explain to themselves. An exact or prefix hit needs no caption. */
  function whyChipHTML(h) {
    var fs = PGRE.formulaSearch, bits = [];
    for (var i = 0; i < WHY_ORDER.length; i++) {
      if (h.kinds.indexOf(WHY_ORDER[i]) !== -1) { bits.push(fs.KIND_LABEL[WHY_ORDER[i]]); break; }
    }
    var where = h.fields.filter(function (f) { return f !== 'front'; });
    if (where.length) {
      bits.push('in the ' + where.map(function (f) { return fs.FIELD_LABEL[f] || f; }).join(' + '));
    }
    return bits.length ? '<span class="fs-why">' + PGRE.ui.esc(bits.join(' · ')) + '</span>' : '';
  }

  /* Schedule chips, matching the ones the browse list uses. */
  function searchChipsHTML(c) {
    var srs = PGRE.srs, ui = PGRE.ui, st = srs.cardState(c.id), chips = '';
    if (st) {
      if (st.lastGrade) {
        chips += '<span class="grade-chip grade-' + st.lastGrade + '">' +
          ui.esc(st.lastGrade) + '</span>';
      }
      var du = srs.daysUntil(st.due);
      chips += '<span class="due-chip' + (du <= 0 ? ' due-now' : '') + '">' +
        (du <= 0 ? 'due now' : 'due in ' + srs.ivlLabel(du)) + '</span>';
      if (srs.isLeech(st)) chips += '<span class="grade-chip leech-chip">leech</span>';
    } else {
      chips += '<span class="due-chip">new</span>';
    }
    if (srs.isSuspended(c.id)) chips += '<span class="due-chip suspended-chip">parked</span>';
    if (mnemonicNote(c.id)) chips += '<span class="due-chip fs-mnem-chip">mnemonic</span>';
    return chips;
  }

  function searchCardHTML(h) {
    var c = h.card, ui = PGRE.ui;
    var t = PGRE.topicById(c.topic);
    var open = !!searchOpen[c.id];
    var nm = cardName(c);
    // isInFormulaDay reads the saved batch only — never formulaDay() — so
    // rendering search results stays side-effect free.
    var inToday = PGRE.srs.isInFormulaDay(deck, c.id);
    var addCtrl = inToday
      ? '<span class="due-chip today-chip">In today</span>'
      : '<button type="button" class="btn btn-ghost btn-sm" data-fs-add="' +
          ui.esc(c.id) + '">Add to today</button>';
    var hasViz = hasInteractiveVisualizer(c.id);
    var modalLabel = hasViz ? 'Open Simulation' : 'Complete view';
    var modalAria = hasViz ? ' aria-haspopup="dialog"' : '';
    // The id is read straight back with getAttribute (never as a CSS selector),
    // so HTML-escaping is the only escaping it needs.
    var parkCtrl = '<button type="button" class="btn btn-ghost btn-sm" data-fs-park="' +
        ui.esc(c.id) + '">' + (PGRE.srs.isSuspended(c.id) ? 'Unpark' : 'Park') + '</button>';
    return '<article class="fs-card' + (open ? ' is-open' : '') +
        '" data-fsid="' + ui.esc(c.id) + '">' +
      '<div class="fs-card-head">' +
        (t ? ui.monogram(t) : '') +
        (nm ? '<span class="fs-tag">' + ui.esc(nm) + '</span>' : '') +
        (c.eq ? '<span class="fs-eq">eq ' + ui.esc(c.eq) + '</span>' : '') +
        whyChipHTML(h) +
      '</div>' +
      '<div class="fs-front">' + formulaHTML(c.front || 'Recall the formula.') + '</div>' +
      '<div class="fs-back"' + (open ? '' : ' hidden') + '></div>' +
      '<div class="fs-card-foot">' +
        '<button type="button" class="btn btn-ghost btn-sm fs-flip" aria-expanded="' +
          (open ? 'true' : 'false') + '">' +
          (open ? 'Hide formula' : 'Show formula') + '</button>' +
        '<span class="fs-card-actions">' +
          '<button type="button" class="btn btn-ghost btn-sm fs-modal-btn" data-fs-modal="' +
            ui.esc(c.id) + '"' + modalAria + '>' + modalLabel + '</button>' +
          similarButton(c, 'btn-sm', true) +
          addCtrl + parkCtrl +
        '</span>' +
        '<span class="fs-chips">' + searchChipsHTML(c) + '</span>' +
      '</div>' +
      (PGRE.sessionLinksHTML ? PGRE.sessionLinksHTML(c) : '') +
      '<div class="card-review-hist-wrap"' + (open ? '' : ' hidden') + '>' +
        reviewHistoryHTML(c.id) + '</div>' +
    '</article>';
  }

  function renderSearchList() {
    var el = searchResultsEl();
    if (!el || !searchLast) return;
    var r = searchLast, ui = PGRE.ui;

    if (!r.total) {
      var fix = '';
      if (r.suggestion) {
        // Case-insensitively: the misspelling is reported lower-cased by the
        // tokenizer, so a literal replace silently no-ops on "Gravitionall" and
        // the button just re-runs the same failing query.
        var swapped = String(searchQ.q).replace(
          new RegExp(escRe(r.suggestion.from), 'i'), r.suggestion.to);
        fix = '<p class="muted">Did you mean <button type="button" class="fs-fix" ' +
          'data-fsfix="' + ui.esc(swapped) + '">' + ui.esc(r.suggestion.to) + '</button>?</p>';
      }
      el.innerHTML = '<div class="card fs-empty"><p><strong>No card matches that.</strong></p>' +
        fix + '<p class="muted">Spelling is already forgiven, so try fewer words, or a ' +
        'symbol from the formula itself.</p></div>';
      return;
    }

    var slice = r.hits.slice(0, searchShown);
    var html = '';
    // Book order reads better grouped — and that is what an empty box falls back
    // to, so a plain browse comes out as the deck's own table of contents.
    if (r.sort === 'order') {
      var curTopic = null;
      slice.forEach(function (h) {
        if (h.card.topic !== curTopic) {
          if (curTopic !== null) html += '</div>';
          curTopic = h.card.topic;
          var t = PGRE.topicById(curTopic);
          html += '<div class="fs-group"><h3 class="fs-group-head">' +
            (t ? ui.monogram(t) + ' ' + ui.esc(t.name) : 'Other') + '</h3>';
        }
        html += searchCardHTML(h);
      });
      if (curTopic !== null) html += '</div>';
    } else {
      slice.forEach(function (h) { html += searchCardHTML(h); });
    }
    if (r.total > slice.length) {
      html += '<div class="btn-row fs-morerow"><button class="btn btn-ghost" id="fs-more">' +
        'Show ' + Math.min(SEARCH_PAGE, r.total - slice.length) + ' more · ' +
        (r.total - slice.length) + ' still hidden</button></div>';
    }
    el.innerHTML = html;
    PGRE.typesetMath(el);
    wireSimilar(el);
    // Re-fill the faces of cards the reader had already flipped open.
    el.querySelectorAll('.fs-card.is-open').forEach(function (art) { fillSearchBack(art); });
    markSearchHits(el, collectMarks(slice));
  }

  /* Every literal word the engine actually matched, across the rendered slice —
     these are real card words (a fuzzy hit contributes the card's spelling, not
     the reader's), so highlighting them is always truthful. */
  function collectMarks(slice) {
    var seen = Object.create(null), out = [];   // a card word may be "constructor"
    slice.forEach(function (h) {
      h.marks.forEach(function (m) {
        if (m && !seen[m]) { seen[m] = 1; out.push(m); }
      });
    });
    // Longest first: regex alternation takes the first branch that matches, so
    // without this "harmonic oscillator" loses to a bare "harmonic" listed earlier
    // and the same phrase highlights inconsistently from card to card.
    return out.sort(function (a, b) { return b.length - a.length; });
  }

  function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* Highlight matched words in the prompts. Done on the DOM AFTER KaTeX has run,
     walking text nodes and skipping anything inside a .katex subtree — building
     the marks into the HTML string instead would corrupt the LaTeX before it is
     ever typeset. Text nodes are rewritten as text, so nothing can inject HTML. */
  function markSearchHits(root, marks) {
    if (!marks || !marks.length) return;
    var pattern = '\\b(' + marks.map(escRe).join('|') + ')';
    root.querySelectorAll('.fs-front, .fs-tag').forEach(function (host) {
      var walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, null, false);
      var nodes = [], n;
      while ((n = walker.nextNode())) {
        if (n.parentNode && n.parentNode.closest && n.parentNode.closest('.katex')) continue;
        if (n.nodeValue && n.nodeValue.trim()) nodes.push(n);
      }
      nodes.forEach(function (node) {
        var re = new RegExp(pattern, 'gi'), text = node.nodeValue;
        var frag = null, last = 0, m;
        while ((m = re.exec(text)) !== null) {
          if (!frag) frag = document.createDocumentFragment();
          if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
          var mk = document.createElement('mark');
          mk.textContent = m[0];
          frag.appendChild(mk);
          last = m.index + m[0].length;
          if (m.index === re.lastIndex) re.lastIndex++;   // never loop on a zero-length hit
        }
        if (!frag) return;
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        node.parentNode.replaceChild(frag, node);
      });
    });
  }

  /* Fill a result card's hidden face on first reveal — same content as a browse
     peek (formula, the card's own note, your mnemonic), typeset once. */
  function fillSearchBack(art) {
    var back = art.querySelector('.fs-back');
    if (!back || back.getAttribute('data-filled')) return;
    var c = deckById(art.getAttribute('data-fsid'));
    if (!c) return;
    back.innerHTML = '<div class="fcard-back">' + backHTML(c) +
      (c.note ? '<div class="fcard-note">' + formulaHTML(c.note) + '</div>' : '') + '</div>' +
      mnemonicHTML(c.id);
    back.setAttribute('data-filled', '1');
    PGRE.typesetMath(back);
  }

  function toggleSearchCard(art) {
    var id = art.getAttribute('data-fsid');
    var back = art.querySelector('.fs-back');
    if (!back) return;
    var open = !searchOpen[id];
    searchOpen[id] = open;
    if (open) fillSearchBack(art);
    back.hidden = !open;
    art.classList.toggle('is-open', open);
    var histWrap = art.querySelector('.card-review-hist-wrap');
    if (histWrap) histWrap.hidden = !open;
    var btn = art.querySelector('.fs-flip');
    if (btn) {
      btn.textContent = open ? 'Hide formula' : 'Show formula';
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
  }

  /* One persistent, guarded keyboard handler (the view is a singleton). Study
     keeps its space/1–4 flow; the game modes route through their controller.
     While a text input is focused (Type mode), the input handles its own keys. */
  document.addEventListener('keydown', function (e) {
    if (!/^#\/formulas/.test(location.hash)) return;
    var typing = e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName);
    if (mode === 'study') {
      if (!study || typing) return;
      // The visualizer modal owns Escape / pointer while it is up — do not
      // resume, step, flip, or grade the card underneath it.
      if (visualizerModalOpen()) return;
      // F8: route strictly by the single overlay field — exactly one overlay at a
      // time, and each consumes only its own keys (never flipping/grading a hidden
      // live card underneath).
      var ov = study.overlay;
      if (ov === 'peek') {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key === 'ArrowLeft') { e.preventDefault(); peekStep(-1); }
        else if (e.key === 'ArrowRight') {
          e.preventDefault();
          if (study.peek.idx >= study.history.length - 1) resumePeek();
          else peekStep(1);
        } else if (e.key === 'Escape') { e.preventDefault(); resumePeek(); }
        return;
      }
      if (ov === 'scaffold' || ov === 'checkpoint') {   // space/Enter = continue
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key === ' ' || e.key === 'Enter') {
          var ae = document.activeElement;
          // Focused Finish / Keep / Continue fire natively — don't double-run.
          if (ae && (ae.id === 'cp-finish' || ae.id === 'cp-keep' ||
                     ae.id === 'scaffold-continue')) return;
          e.preventDefault();
          runNextOverlay();   // unfocused: Keep going
        }
        return;
      }
      // ov === null: normal flip/grade flow + F1a undo. ⌘Z is the only chord
      // that acts — any other held modifier (⌘1…4 tab switching etc.) is inert.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault(); undoGrade();
      } else if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      } else if (study.reviewing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        jumpNeighbor(e.key === 'ArrowRight' ? 1 : -1);
      } else if ((e.key === ' ' || e.key === 'Enter') && !study.flipped) {
        e.preventDefault(); flip();
      } else if (study.flipped && e.key >= '1' && e.key <= '4') {
        e.preventDefault(); grade(GRADES[parseInt(e.key, 10) - 1].key);
      } else if (e.key === 'ArrowLeft' && study.history.length) {
        e.preventDefault(); openPeek();
      }
      return;
    }
    // Search: the box owns every key while it has focus; "/" from anywhere else
    // on the page puts the cursor back in it.
    if (mode === 'search') {
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') {
        e.preventDefault();
        var box = document.getElementById('fs-input');
        if (box) box.focus();
      }
      return;
    }
    // Type-to-recall keeps the prompt INPUT focused; still let Ctrl/Meta+Z
    // reach the game's undoLast. Other keys stay with the input (Enter submits).
    if (typing) {
      if (activeGame && activeGame.onKey &&
          (e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        activeGame.onKey(e);
      }
      return;
    }
    if (activeGame && activeGame.onKey) activeGame.onKey(e);
  });

  /* Leaving the portal mid-game stops any timers/intervals promptly (and
     settles an abandoned Study round's earned XP). */
  window.addEventListener('hashchange', function () {
    if (!/^#\/formulas/.test(location.hash)) {
      teardownGame();
      settleStudy();
      stopRecallTimer();
      study = null;
      var sheet = document.getElementById('formulas-print');
      if (sheet && sheet.parentNode) sheet.parentNode.removeChild(sheet);
    }
  });

  /* A tab/window close fires neither hashchange nor mount, so a mid-session
     segment's earned XP would otherwise never reach the total — and the
     summary's session-wide pressCount * 2 figure would then overstate what was
     actually awarded once a later segment resumes. Settle on pagehide to close
     that gap; settleStudy is a no-op once a segment is settled or has no XP. */
  window.addEventListener('pagehide', function () { settleStudy(); });

  document.addEventListener('visibilitychange', function () {
    if (!study) return;
    if (document.visibilityState && document.visibilityState !== 'visible') return;
    var changed = onLiveClock(study.dayBound !== false);
    if (!changed || study.overlay) return;
    if (study.queue.length) renderCard();
    else renderStudySummary();
  });

  /* bfcache twist: a same-tab cross-document Back/Forward (or a mobile
     freeze/restore) fires pagehide — settling the live segment (settled=true,
     xp awarded) — then restores THIS document from memory with the graded card
     DOM still interactive. settleStudy can't null study here (the preserved grade
     buttons dereference it), so post-restore grades would keep accumulating
     pressCount/xp that a later settleStudy short-circuits away on the settled
     flag — yet renderCheckpoint/renderStudySummary read pressCount * 2, re-
     overstating the awarded total. Treat the restore like a resume: re-open the
     already-settled segment exactly as resumeStudy does (fresh xp, rebased
     done/again bases, pressCount carried forward) so post-restore grades settle
     on their own and pressCount * 2 stays honest. The pagehide award stays
     awarded; only the new segment's XP is added on the next settle. */
  window.addEventListener('pageshow', function (e) {
    if (e.persisted && study && study.settled) {
      study.settled = false;
      study.xp = 0;
      study.doneBase = study.done;
      study.againBase = study.again;
    }
    if (!study) return;
    var changed = onLiveClock(study.dayBound !== false);
    if (!changed || study.overlay) return;
    if (study.queue.length) renderCard();
    else renderStudySummary();
  });

  if (typeof PGRE.subscribeStateAdopted === 'function') {
    PGRE.subscribeStateAdopted(function () {
      if (!study || mode !== 'study') return;
      var changed = onLiveClock(study.dayBound !== false);
      if (!changed || study.overlay) return;
      if (study.queue.length) renderCard();
      else renderStudySummary();
    });
  }

  /* Arm flags consumed on the next mount (subject-home CTAs and the
     sidebar search can point here from any view). */
  var armedDrillIds = null;      // ids → one ad-hoc round when home paints
  var armedEditorSubject = null; // preselect the new-card form's subject
  var armedPicker = false;       // open the daily-list picker on mount

  return {
    render: function () { return '<div id="formulas-root"></div>'; },
    mount: function (params) {
      settleStudy();
      stopRecallTimer();
      study = null;
      teardownGame();
      // The route's second segment names the tab (#/formulas/cards). Unknown
      // and empty subs fall back to the Review tab; the old Lab deep-link
      // lives at Physics › Visualizers now.
      var sub = params && params.sub;
      if (sub === 'lab' || sub === 'visual') {
        location.hash = '#/subject/physics/lab';
        return;
      }
      var MODES = { study: 1, browse: 1, cards: 1, progress: 1, practice: 1,
                    search: 1, match: 1, type: 1, quiz: 1, cloze: 1 };
      mode = MODES[sub] ? (sub === 'browse' ? 'search' : sub) : 'study';
      // Search starts fresh each visit — a query and a set of flipped-open
      // cards from an hour ago are not context worth restoring when you walk
      // back into the portal.
      clearTimeout(searchTimer);
      searchQ = { q: '', topic: '', status: '', sort: 'relevance' };
      searchShown = SEARCH_PAGE;
      searchOpen = Object.create(null);
      searchLast = null;
      editorSubject = 'all';
      editorQuery = '';
      editorShown = EDITOR_PAGE;
      var r = root();
      if (r) {
        r.innerHTML = '<div class="card practice-card fcard-skeleton">' +
          '<div class="skel-bar" style="width:35%"></div>' +
          '<div class="skel-bar" style="width:82%"></div>' +
          '<div class="skel-bar" style="width:64%"></div></div>';
      }
      if (window.PGRE && PGRE.motion && PGRE.motion.loader) PGRE.motion.loader.start();
      ensureFlashmodes().then(function () {
        return PGRE.formulaDeck();
      }).then(function (d) {
        deck = d;
        PGRE.deck = d;
        PGRE.getFormulaCard = deckById;
        lastDeckStatus = (PGRE.formulaDeckStatus && typeof PGRE.formulaDeckStatus === 'object')
          ? PGRE.formulaDeckStatus : null;
        if (!root()) return;
        renderShell();
        // An armed ad-hoc drill starts once the deck is in place (subject
        // home's "Drill them" slip line points here).
        if (armedDrillIds && armedDrillIds.length) {
          var ids = armedDrillIds;
          armedDrillIds = null;
          var cards = deck.filter(function (c) { return ids.indexOf(c.id) !== -1; });
          if (cards.length) startStudy(cards, false);
        }
        // An armed editor request preselects the new-card form's subject.
        if (armedEditorSubject) {
          var sel = document.getElementById('uec-subject');
          if (sel && PGRE.subjectById && PGRE.subjectById(armedEditorSubject)) {
            sel.value = armedEditorSubject;
            updateEditorPreview();
          }
          armedEditorSubject = null;
        }
        if (armedPicker) {
          armedPicker = false;
          if (deck.length && mode === 'study') renderPicker();
        }
        if (window.PGRE && PGRE.motion && PGRE.motion.loader) PGRE.motion.loader.done();
      });
    },
    getCard: deckById,
    armStudyFromFill: function () { studyFromFill = true; },
    armDrill: function (ids) { armedDrillIds = (ids || []).slice(); },
    armEditor: function (opts) {
      editorOpen = null;
      if (opts && opts.subject) armedEditorSubject = opts.subject;
    },
    armPicker: function () { armedPicker = true; },
    /* The Formula Lab lives on Physics › Visualizers now (#/subject/physics/lab);
       the subject view delegates here so the renderer stays in one file. A
       deck may be passed when the formulas view has not mounted yet; `host`
       is its root (#subject-root) so the lab paints outside this shell. */
    renderLab: function (d, host) {
      if (d && d.length) deck = d;
      renderVisualizerLab(host);
    },
    getDeck: function () { return deck; },
    buildFormulaReceipt: buildFormulaReceipt,
    exportFormulaStatus: openFormulaExportModal
  };
})();

PGRE.buildFormulaReceipt = PGRE.views.formulas.buildFormulaReceipt;
PGRE.exportFormulaStatus = PGRE.views.formulas.exportFormulaStatus;
