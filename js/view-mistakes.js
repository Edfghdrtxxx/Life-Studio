/* Mistake book — every missed question, kept permanently: your wrong pick
   beside the solution, re-drillable anytime, resurfaced on the spaced-
   repetition ladder (js/srs.js). Solving never removes an entry; only the
   manual Archive action hides it (a fresh miss reopens it). */
window.PGRE = window.PGRE || {};
PGRE.views = PGRE.views || {};

PGRE.views.mistakes = (function () {
  var LETTERS = ['A', 'B', 'C', 'D', 'E'];
  var drill = null; // { qs, st, i, skipped, done, reviewing, sid, qStart, assess } — see startDrill
  var archive = null; // read-only History reconstruction; never replaces `drill`
  var lastRenderAt = 0; // stamps each drill render so a double-click can't click through
  var keyBound = false; // the document keydown listener is installed once
  var paceTimer = null; // live per-question chip; same contract as view-practice.js
  var topicFilter = 'all'; // additional book filter; 'all' or a PGRE.TOPICS id
  var concernFilter = 'all'; // 'all' or 'stuck' (keep-failing entries only)
  var BOOK_PAGE = 20;        // open entries rendered per page of the book
  var bookShown = BOOK_PAGE; // grows with "Show more"; resets when a filter changes
  var openIds = {};          // qid -> true while an entry's choices + solution are shown

  function settings() { return PGRE.store.state.settings || {}; }

  /* ——— Pace trainer (mirrors js/view-practice.js #4) ———
     Mistake drills already stamp attempt.ms via recordAnswer; this is the
     missing live chip + post-answer over/under mark gated by paceTrainer. */
  var PACE_GRACE_MS = 5000; // a click inside the first 5 s is not pace data

  function clearPace() {
    if (paceTimer) { clearInterval(paceTimer); paceTimer = null; }
  }

  function startPaceTimer() {
    clearPace();
    if (!settings().paceTrainer) return;
    if (!drill || drill.done) return;
    paceTimer = setInterval(tickPace, 1000);
  }

  function tickPace() {
    var chip = document.getElementById('pace-chip');
    if (!chip || !drill || drill.done) { clearPace(); return; }
    var sec = Math.round((Date.now() - drill.qStart) / 1000);
    var target = settings().paceTargetSec || 103;
    chip.textContent = sec + ' s';
    chip.classList.toggle('pace-over', sec > target);
  }

  function paceMark(elapsedMs) {
    if (!settings().paceTrainer) return '';
    if (elapsedMs == null || elapsedMs < PACE_GRACE_MS) return '';
    var sec = Math.round(elapsedMs / 1000);
    var target = settings().paceTargetSec || 103;
    var over = sec > target;
    return '<div class="pace-mark ' + (over ? 'pace-over' : 'pace-under') + '">' +
      sec + ' s — ' + (over ? 'over pace' : 'under pace') +
      ' <span class="pace-target">(target ' + target + ' s)</span></div>';
  }

  function root() { return document.getElementById('mistakes-root'); }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  /* ——— ITEM 8: user-set drill size ———
     How many questions "Drill due" / "Drill all" pull from the pool. Persisted in
     state.settings.mistakeDrillSize via PGRE.store.save(). Read defensively: an
     absent / 0 / invalid value all mean "draw the whole pool" (the original
     behaviour). A custom value is clamped to 1–99 to match the number input. */
  function drillSize() {
    var s = PGRE.store.state.settings || {};
    var n = parseInt(s.mistakeDrillSize, 10);
    if (!n || n < 1) return 0;          // 0 = the whole pool
    return n > 99 ? 99 : n;
  }
  function setDrillSize(n) {
    var s = PGRE.store.state.settings || (PGRE.store.state.settings = {});
    s.mistakeDrillSize = (n && n > 0) ? Math.min(99, n) : 0;
    PGRE.store.save();
  }
  /* Draw a random min(N, pool) sample; 0 or N≥pool keeps the whole pool.
     startDrill() reshuffles anyway, so the extra shuffle here is harmless. */
  function sampleForDrill(qs) {
    var n = drillSize();
    if (!n || n >= qs.length) return qs;
    return shuffle(qs).slice(0, n);
  }
  /* Honest button caption: "Drill due (5 of 7)" when a size caps the pool,
     plain "Drill due (7)" when the whole pool will be drawn. An empty pool
     gets plain-language copy instead of a "(0)" that looks like a live action. */
  function drillLabel(base, pool, emptyText) {
    if (!pool) return emptyText;
    var n = drillSize();
    return (n && n < pool) ? (base + ' (' + n + ' of ' + pool + ')')
                           : (base + ' (' + pool + ')');
  }
  function filterByTopic(list) {
    return PGRE.srs.filterByTopic(list, topicFilter);
  }
  function filterByConcern(list) {
    return PGRE.srs.filterByConcern(list, concernFilter);
  }

  /* Topic dropdown plus the Keep failing concern chip — same .filter-row
     strip; either can narrow the book, independently. */
  function topicFilterHTML() {
    var opts = '<option value="all"' + (topicFilter === 'all' ? ' selected' : '') +
      '>All topics</option>';
    PGRE.TOPICS.forEach(function (t) {
      opts += '<option value="' + t.id + '"' + (topicFilter === t.id ? ' selected' : '') +
        '>' + PGRE.ui.esc(t.name) + '</option>';
    });
    return '<div class="filter-row" id="miss-topic-row">' +
      '<select id="miss-topic" class="hist-select" aria-label="Filter by topic">' +
        opts + '</select>' +
      '<button type="button" class="focus-chip miss-concern-chip' +
        (concernFilter === 'stuck' ? ' active' : '') +
        '" data-concern="stuck" aria-pressed="' + (concernFilter === 'stuck') +
        '">Keep failing</button>' +
      '</div>';
  }

  /* Preset chips (All / 5 / 10 / 15) + a custom number input, reusing the focus
     page's .focus-chip / .focus-custom-in look. Active preset reflects the saved
     size; a non-preset size prefills the custom box. */
  function drillSizeHTML() {
    var n = drillSize();
    var presets = [[0, 'All'], [5, '5'], [10, '10'], [15, '15']];
    var isPreset = false, chips = '';
    presets.forEach(function (p) {
      var on = (p[0] === n);
      if (on) isPreset = true;
      chips += '<button type="button" class="focus-chip' + (on ? ' active' : '') +
        '" data-size="' + p[0] + '">' + p[1] + '</button>';
    });
    var customVal = (!isPreset && n > 0) ? String(n) : '';
    return '<div class="chip-row" id="drill-size-row">' +
      '<span class="muted" style="align-self:center;">Questions per drill</span>' +
      chips +
      '<span class="focus-chip focus-chip-custom">' +
        '<input id="drill-size-custom" class="focus-custom-in" type="number" min="1" max="99" ' +
          'inputmode="numeric" placeholder="custom" aria-label="Custom questions per drill" ' +
          'value="' + customVal + '"></span>' +
    '</div>';
  }

  function dueChip(mk) {
    if (mk.archivedAt) return '<span class="due-chip due-archived">archived</span>';
    if (!mk.srs) return '';
    var d = PGRE.srs.daysUntil(mk.srs.due);
    if (d <= 0) return '<span class="due-chip due-now">due now</span>';
    return '<span class="due-chip">due in ' + PGRE.srs.ivlLabel(d) + '</span>';
  }

  /* Keep-failing entries carry a mk.stuck flag — the strongest concern level,
     so its chip gets the red danger treatment above the neutral lucky chip. */
  function stuckChip(mk) {
    return mk.stuck ? '<span class="due-chip stuck-chip">keep failing</span>' : '';
  }
  /* Lucky-guess entries (correct-but-guessed) carry a mk.lucky flag. */
  function luckyChip(mk) {
    return mk.lucky ? '<span class="due-chip lucky-chip">⚑ lucky guess</span>' : '';
  }

  /* PROPOSAL #12 — "Why the other choices tempt": an expandable list of the
     non-correct choices with their mined per-choice explanation (q.choiceSols[idx]).
     The field is optional (a pipeline fills it into the bank over time), so an
     absent or all-null array yields '' and no empty block shows. Choice text and
     explanation are trusted bank HTML/LaTeX, rendered like q.sol / q.choices and
     typeset by the caller's PGRE.typesetMath pass. */
  function distractorBlock(q) {
    var sols = q && q.choiceSols;
    if (!sols || !sols.length) return '';
    var items = '';
    for (var idx = 0; idx < q.choices.length; idx++) {
      if (idx === q.answer) continue;                 // only the tempting wrong choices
      var why = sols[idx];
      if (why == null || String(why).replace(/\s+/g, '') === '') continue;  // skip absent
      items += '<div class="distractor-item">' +
        '<div class="miss-pick is-bad"><span class="fb-icon">✗</span>' +
          '<strong>' + LETTERS[idx] + '</strong> — ' +
          '<span class="miss-pick-body">' + q.choices[idx] + '</span></div>' +
        '<div class="solution"><div class="solution-label">Why it tempts</div>' + why + '</div>' +
      '</div>';
    }
    if (!items) return '';
    return '<details class="miss distractors"><summary>Why the other choices tempt</summary>' +
      '<div class="distractor-list">' + items + '</div></details>';
  }

  /* Most recent recorded self-assessment for a question (confidence and/or
     tags — 'slow'/'forgot'), if any. Returns the attempt row or null. */
  function lastAssess(qid) {
    var arr = PGRE.store.state.attempts;
    for (var i = arr.length - 1; i >= 0; i--) {
      if (arr[i].qid === qid &&
          (arr[i].confidence || (arr[i].tags && arr[i].tags.length))) return arr[i];
    }
    return null;
  }

  /* ——— The book ——— */
  function missCard(e) {
    var ui = PGRE.ui, q = e.q, mk = e.mk;
    var t = PGRE.topicById(q.topic) || { id: 'xx', short: '?', name: 'Unknown topic' };
    var wrong = mk.lastPick != null ? mk.lastPick : mk.wrongPicks[mk.wrongPicks.length - 1];
    var metaBits = [];
    if (mk.misses > 0) metaBits.push('missed ×' + mk.misses);
    if (mk.solves) metaBits.push('re-solved ×' + mk.solves);
    if (mk.lucky && !(mk.misses > 0)) metaBits.push('correct but guessed');
    var lastTs = mk.lastMissedAt || mk.lastSolvedAt || mk.lastLuckyAt || mk.lastStuckAt;
    if (lastTs) metaBits.push('last ' + ui.timeAgo(lastTs));
    var isOpen = !!openIds[q.id];
    var html = '<div class="card miss-card' + (mk.archivedAt ? ' is-archived' : '') +
      (isOpen ? ' is-open' : '') + '">' +
      '<div class="miss-head">' + ui.monogram(t) + dueChip(mk) + stuckChip(mk) + luckyChip(mk) +
        '<span class="muted miss-meta">' + metaBits.join(' · ') + '</span>' +
        '<span class="miss-actions">' +
          // the same Keep failing flag the answer screen's assess chip sets —
          // settable on any existing entry right from the book
          '<button class="btn btn-ghost btn-sm' + (mk.stuck ? ' stuck-on' : '') +
            '" data-stuck="' + q.id + '" aria-pressed="' + (!!mk.stuck) + '"' +
            PGRE.assess.stuckButtonAttrs() + '>' +
            (mk.stuck ? '✓ Keep failing' : 'Keep failing') + '</button>' +
          (mk.archivedAt
            ? '<button class="btn btn-ghost btn-sm" data-restore="' + q.id + '">Restore</button>'
            : '<button class="btn btn-ghost btn-sm" data-drill-one="' + q.id + '">Re-drill</button>' +
              '<button class="btn btn-danger-ghost btn-sm" data-archive="' + q.id + '">Archive</button>') +
        '</span>' +
      '</div>' +
      '<div class="q-text">' + q.q + '</div>' +
      // Collapsed by default: the stem shows (clamped), the choices, last
      // self-assessment and solution open with the toggle under the card.
      '<div class="miss-more">';
    // ITEM 7 — the book (list) page must NOT reveal the answer. Show the five
    // choices as a plain, non-interactive list: disabled .choice buttons (the
    // exact look practice leaves behind after answering) get no hover, no pointer,
    // and — crucially — NO is-answer / is-wrong marker, so nothing on the always-
    // visible card signals the key, not even by elimination. The reveal now lives
    // one click away, inside the <details> Solution block below.
    html += '<div class="choices miss-choices">';
    q.choices.forEach(function (c, idx) {
      html += '<button class="choice" disabled>' +
        '<span class="choice-letter">' + LETTERS[idx] + '</span>' +
        '<span class="choice-body">' + c + '</span></button>';
    });
    html += '</div>';
    var la = lastAssess(q.id);
    if (la) {
      var bits = [];
      if (la.confidence) bits.push(la.confidence === 'guess' ? 'Guessed' : 'Knew it');
      (la.tags || []).forEach(function (tg) { bits.push(PGRE.assess.LABELS[tg] || tg); });
      html += '<div class="conf-note muted">Your last self-assessment on this question: ' +
        '<strong>' + bits.join(' · ') + '</strong></div>';
    }
    html += '<details class="miss"><summary>Solution</summary>';
    if (wrong != null) {
      // moved here from the always-visible card body: your pick + the correct
      // letter are now gated behind the same one click as the worked solution.
      html += '<div class="miss-picks">' +
        '<div class="miss-pick is-bad"><span class="fb-icon">✗</span><strong>You picked ' +
          LETTERS[wrong] + '</strong> — <span class="miss-pick-body">' + q.choices[wrong] + '</span></div>' +
        '<div class="miss-pick is-good"><span class="fb-icon">✓</span><strong>Correct: ' +
          LETTERS[q.answer] + '</strong> — <span class="miss-pick-body">' + q.choices[q.answer] + '</span></div>' +
      '</div>';
    }
    html += '<div class="solution"><div class="solution-label">Solution</div>' + q.sol + '</div></details>' +
    distractorBlock(q) +
    '</div>' +
    '<button type="button" class="miss-expand" data-expand="' + q.id + '" aria-expanded="' + isOpen + '">' +
      (isOpen ? 'Hide choices and solution' : 'Show choices and solution') + '</button>' +
    '</div>';
    return html;
  }

  function bookStatsHTML(dueN, openN, stuckN, archivedN) {
    function stat(n, label) {
      return '<span class="miss-stat"><span class="miss-stat-num">' + n + '</span>' + label + '</span>';
    }
    return '<div class="miss-stats">' + stat(dueN, 'due now') + stat(openN, 'open') +
      stat(stuckN, 'keep failing') + stat(archivedN, 'archived') + '</div>';
  }

  /* The review ladder on its own line under the intro: small numerals joined
     by drawn hairline arrows, so the arrow weight does not depend on the
     text font and the run never breaks mid-sentence. */
  function ladderHTML() {
    var steps = PGRE.srs.MISTAKE_LADDER;
    var arrow = '<svg class="ladder-arrow" viewBox="0 0 12 8" aria-hidden="true" focusable="false">' +
      '<path d="M0.5 4h10.5M8 1.2 11 4 8 6.8"/></svg>';
    return '<div class="review-ladder" role="img" aria-label="Review after ' + steps.join(', then ') + ' days">' +
      '<span class="ladder-kicker">Review after</span>' +
      '<span class="ladder-run">' +
        steps.map(function (n) { return '<span class="ladder-step">' + n + '</span>'; }).join(arrow) +
      '</span><span class="ladder-unit">days</span></div>';
  }

  function renderBook() {
    clearPace();
    // NOTE: the live `drill` is deliberately NOT nulled here — a parked drill
    // (its sessionStorage snapshot still present) stays resumable; only
    // finishing, discarding, or starting a new drill ends it.
    if (PGRE.nav) PGRE.nav.setTrail([]);   // BUNDLE G: book list is the base screen
    var openAll = PGRE.srs.openMistakes();
    var dueAll = PGRE.srs.dueMistakes();
    var archivedAll = PGRE.srs.archivedMistakes();
    var hasBook = openAll.length || archivedAll.length;
    var open = filterByConcern(filterByTopic(openAll));
    var due = filterByConcern(filterByTopic(dueAll));
    var archived = filterByConcern(filterByTopic(archivedAll));

    // due first (oldest due date first), then upcoming by due date
    open.sort(function (a, b) {
      return (a.mk.srs ? a.mk.srs.due : '9999') < (b.mk.srs ? b.mk.srs.due : '9999') ? -1 : 1;
    });

    var stuckAll = openAll.filter(function (e) { return e.mk.stuck; }).length;
    var html = '<div class="card page-head"><h1>Mistake book</h1>' +
      '<p class="muted">Every miss stays until <em>you</em> archive it. Each correct re-solve moves ' +
      'the next review one step out; a new miss starts the ladder again.</p>' +
      ladderHTML() +
      (hasBook ? bookStatsHTML(dueAll.length, openAll.length, stuckAll, archivedAll.length) : '') +
      (hasBook ? topicFilterHTML() : '') +
      '<div class="btn-row">' +
        '<button class="btn btn-primary" id="drill-due"' + (due.length ? '' : ' disabled') + '>' +
          drillLabel('Drill due', due.length, 'Nothing due today') + '</button>' +
        '<button class="btn btn-ghost" id="drill-all"' + (open.length ? '' : ' disabled') + '>' +
          drillLabel('Drill all', open.length, 'Nothing to drill') + '</button>' +
        (open.length ? '<button class="btn btn-ghost" id="print-mistakes">Print / PDF</button>' : '') +
      '</div>' +
      // The size picker only means something once there is a pool to draw from.
      (open.length ? drillSizeHTML() : '') +
      '</div>';

    // a finished drill keeps its object for the summary/review, but its parked
    // slot is gone — the book card is only for a drill still in flight
    var parked = (drill && !drill.done) ? drill : readDrillSaved();
    if (parked) {
      var parkedIds = parked.qs
        ? parked.qs.length
        : (parked.ids || []).length;
      var parkedDone = 0;
      (parked.st || parked.results || []).forEach(function (r) { if (r) parkedDone++; });
      html += '<div class="card parked-drill-card">' +
        '<strong>A mistake drill is parked</strong>' +
        '<p class="muted">' + parkedDone + ' of ' + parkedIds + ' answered — it is waiting on ' +
          'the question you left.</p>' +
        '<div class="btn-row">' +
          '<a class="btn btn-primary" href="#/mistakes/drill">Resume the drill</a>' +
          '<button class="btn btn-ghost" id="drill-discard">Discard it</button>' +
        '</div></div>';
    }

    if (!open.length && !archived.length) {
      if (!hasBook) {
        html += '<div class="card placeholder">' +
          '<p><strong>Nothing in the book yet.</strong></p>' +
          '<p class="muted">Miss a question in <a href="#/practice/all">practice</a> and it lands here — ' +
          'with your wrong pick, the solution, and a review schedule.</p></div>';
      } else if (concernFilter === 'stuck') {
        html += '<div class="card placeholder" id="miss-empty-topic">' +
          '<p class="muted">Nothing flagged keep failing' +
          (topicFilter !== 'all' ? ' in this topic' : '') +
          ' — tap Keep failing on an entry or after an answer.</p></div>';
      } else {
        html += '<div class="card placeholder" id="miss-empty-topic">' +
          '<p class="muted">No mistakes in this topic.</p></div>';
      }
    }

    // Due entries first under their own heading, then the rest; one page at a
    // time so a long book stays a short page.
    var dueIds = {};
    due.forEach(function (e) { dueIds[e.qid] = true; });
    var shown = open.slice(0, bookShown);
    var lastGroup = null;
    shown.forEach(function (e) {
      var group = dueIds[e.qid] ? 'due' : 'later';
      if (group !== lastGroup) {
        var n = group === 'due' ? due.length : open.length - due.length;
        html += '<h2 class="miss-group-head">' + (group === 'due' ? 'Due now' : 'Coming up') +
          ' <span class="miss-group-count">' + n + '</span></h2>';
        lastGroup = group;
      }
      html += missCard(e);
    });
    if (open.length > shown.length) {
      var left = open.length - shown.length;
      html += '<div class="miss-pager"><button type="button" class="btn btn-ghost" id="miss-show-more">' +
        'Show ' + Math.min(BOOK_PAGE, left) + ' more</button>' +
        '<span class="muted">' + shown.length + ' of ' + open.length + ' shown</span></div>';
    }

    if (archived.length) {
      html += '<details class="card archived-block"><summary>Archived (' + archived.length +
        ') — hidden from drills and due counts</summary>';
      archived.forEach(function (e) { html += missCard(e); });
      html += '</details>';
    }

    root().innerHTML = html + PGRE.assess.stuckConfirmHTML();
    PGRE.typesetMath(root());
    // Fade the stem's last line only when the collapsed height cuts it off.
    root().querySelectorAll('.miss-card .q-text').forEach(function (qt) {
      if (qt.scrollHeight > qt.clientHeight + 2) qt.classList.add('is-clamped');
    });
    PGRE.refreshNavBadges(); // due counts change without a route change

    var dd = document.getElementById('drill-due');
    var da = document.getElementById('drill-all');
    if (dd) dd.addEventListener('click', function () {
      startDrill(sampleForDrill(filterByConcern(filterByTopic(PGRE.srs.dueMistakes())).map(function (e) { return e.q; })));
    });
    if (da) da.addEventListener('click', function () {
      startDrill(sampleForDrill(filterByConcern(filterByTopic(PGRE.srs.openMistakes())).map(function (e) { return e.q; })));
    });
    var topicSel = document.getElementById('miss-topic');
    if (topicSel) topicSel.addEventListener('change', function () {
      topicFilter = topicSel.value || 'all';
      bookShown = BOOK_PAGE;
      renderBook();
    });
    root().querySelectorAll('[data-concern]').forEach(function (b) {
      b.addEventListener('click', function () {
        concernFilter = concernFilter === b.getAttribute('data-concern')
          ? 'all' : b.getAttribute('data-concern');
        bookShown = BOOK_PAGE;
        renderBook();
      });
    });
    var moreBtn = document.getElementById('miss-show-more');
    if (moreBtn) moreBtn.addEventListener('click', function () {
      bookShown += BOOK_PAGE;
      var y = window.scrollY;
      renderBook();
      window.scrollTo(0, y);
    });
    root().querySelectorAll('[data-expand]').forEach(function (b) {
      b.addEventListener('click', function () {
        var card = b.closest('.miss-card');
        var qid = b.getAttribute('data-expand');
        var open = !card.classList.contains('is-open');
        card.classList.toggle('is-open', open);
        if (open) openIds[qid] = true; else delete openIds[qid];
        b.setAttribute('aria-expanded', open ? 'true' : 'false');
        b.textContent = open ? 'Hide choices and solution' : 'Show choices and solution';
      });
    });

    // ITEM 8 — drill-size control: preset chips + custom input, saved on change.
    // Labels update in place (mirrors the focus page's goal picker) so editing the
    // custom box never re-renders the book and steals the input's focus. due/open
    // are captured from this render; the disabled state depends only on the pool,
    // so it never changes with size — only the caption does.
    function applyLabels() {
      if (dd) dd.textContent = drillLabel('Drill due', due.length, 'Nothing due today');
      if (da) da.textContent = drillLabel('Drill all', open.length, 'Nothing to drill');
    }
    var sizeCustom = document.getElementById('drill-size-custom');
    root().querySelectorAll('.focus-chip[data-size]').forEach(function (b) {
      b.addEventListener('click', function () {
        setDrillSize(parseInt(b.getAttribute('data-size'), 10) || 0);
        if (sizeCustom) sizeCustom.value = '';
        root().querySelectorAll('.focus-chip[data-size]').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        applyLabels();
      });
    });
    if (sizeCustom) {
      sizeCustom.addEventListener('input', function () {
        var n = parseInt(sizeCustom.value, 10);
        setDrillSize((n > 0) ? Math.min(99, n) : 0);   // empty/≤0 falls back to "all"
        root().querySelectorAll('.focus-chip[data-size]').forEach(function (x) { x.classList.remove('active'); });
        applyLabels();
      });
      // Snap an out-of-range / fractional / non-positive entry to what was saved
      // once focus leaves the box, so the number shown matches what drills draw.
      sizeCustom.addEventListener('blur', function () {
        var n = parseInt(sizeCustom.value, 10);
        var norm = (n > 0) ? String(Math.min(99, n)) : '';
        if (sizeCustom.value !== norm) sizeCustom.value = norm;
      });
    }
    root().querySelectorAll('[data-drill-one]').forEach(function (b) {
      b.addEventListener('click', function () {
        var q = PGRE.questionById(b.getAttribute('data-drill-one'));
        if (q) startDrill([q]);
      });
    });
    root().querySelectorAll('[data-archive]').forEach(function (b) {
      b.addEventListener('click', function () {
        var mk = PGRE.store.state.mistakes[b.getAttribute('data-archive')];
        if (!mk) return;
        mk.archivedAt = mk.lastTouchedAt = new Date().toISOString();
        PGRE.gamify.checkAchievements(); // before save() so a just-unlocked badge persists now
        PGRE.store.save();
        PGRE.toast('Archived — it stays in the book, hidden from drills. A new miss reopens it.', 'info');
        renderBook();
      });
    });
    root().querySelectorAll('[data-restore]').forEach(function (b) {
      b.addEventListener('click', function () {
        var mk = PGRE.store.state.mistakes[b.getAttribute('data-restore')];
        if (!mk) return;
        mk.archivedAt = null;
        mk.lastTouchedAt = new Date().toISOString();
        PGRE.store.save();
        PGRE.toast('Restored to the active book.', 'info');
        renderBook();
      });
    });

    // Keep failing toggle on every entry — same flag the post-answer assess
    // chip sets; markStuck reopens an archived entry (fresh evidence).
    var stuckConfirmation = root().querySelector('#assess-stuck-confirm');
    var requestStuck = PGRE.assess.bindStuckConfirm(root());
    root().querySelectorAll('[data-stuck]').forEach(function (b) {
      b.addEventListener('click', function () {
        var qid = b.getAttribute('data-stuck');
        var mk = PGRE.store.state.mistakes[qid];
        if (!mk || !mk.stuck) {
          var card = b.closest('.miss-card');
          card.insertBefore(stuckConfirmation, card.querySelector('.q-text'));
          requestStuck(b, function () {
            PGRE.srs.markStuck(qid);
            PGRE.toast('Flagged keep failing — it shows under that filter and stays loud in drills.', 'info');
            renderBook();
          });
          return;
        } else {
          PGRE.srs.unmarkStuck(qid);
          PGRE.toast('Removed the keep-failing flag.', 'info');
        }
        renderBook();
      });
    });

    buildPrintSheet();
    var pb = document.getElementById('print-mistakes');
    if (pb) pb.addEventListener('click', printBook);
    var disc = document.getElementById('drill-discard');
    if (disc) disc.addEventListener('click', discardParkedDrill);
  }

  /* ——— Print / PDF (proposal #13) ———
     Builds a self-contained paper mistake book — every open entry's question,
     wrong pick(s), correct answer and full solution — into a hidden
     `.print-sheet` beside the interactive DOM; css/print.css lays it out and
     hides everything else at print time. Rebuilt on every renderBook so it is
     always current, and auto-discarded when the router repaints #view. */
  function printDate() {
    return new Date().toLocaleDateString('en-US',
      { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function missPrintEntry(e) {
    var ui = PGRE.ui, q = e.q, mk = e.mk, t = PGRE.topicById(q.topic);
    var meta = [];
    if (mk.misses > 0) meta.push('missed ×' + mk.misses);
    if (mk.solves) meta.push('re-solved ×' + mk.solves);
    if (mk.lucky && !(mk.misses > 0)) meta.push('correct but guessed');
    var metaLine = (t ? t.name : '') + (meta.length ? ' · ' + meta.join(' · ') : '');
    var h = '<article class="ps-miss">' +
      '<div class="ps-miss-head">' +
        '<span class="ps-mono">' + ui.esc(t ? t.short : '?') + '</span>' +
        '<span class="ps-meta">' + ui.esc(metaLine) + '</span>' +
      '</div>' +
      '<div class="ps-q">' + q.q + '</div>' +
      '<div class="ps-picks">';
    var picks = (mk.wrongPicks && mk.wrongPicks.length)
      ? mk.wrongPicks
      : (mk.lastPick != null ? [mk.lastPick] : []);
    picks.forEach(function (w) {
      if (w == null || w === q.answer || !q.choices[w]) return;
      h += '<div class="ps-pick ps-wrong"><span class="ps-ic">✗</span>' +
        '<strong>You picked ' + LETTERS[w] + '</strong> — ' + q.choices[w] + '</div>';
    });
    h += '<div class="ps-pick ps-right"><span class="ps-ic">✓</span>' +
        '<strong>Correct: ' + LETTERS[q.answer] + '</strong> — ' + q.choices[q.answer] + '</div>' +
      '</div>' +
      '<div class="ps-sol"><span class="ps-sol-label">Solution</span>' + q.sol + '</div>' +
    '</article>';
    return h;
  }

  function buildPrintSheet() {
    var view = document.getElementById('view');
    if (!view) return;
    var old = document.getElementById('mistakes-print');
    if (old) old.parentNode.removeChild(old);
    var open = filterByConcern(filterByTopic(PGRE.srs.openMistakes()));
    if (!open.length) return;
    open.sort(function (a, b) {
      return (a.mk.srs ? a.mk.srs.due : '9999') < (b.mk.srs ? b.mk.srs.due : '9999') ? -1 : 1;
    });
    var topicName = topicFilter !== 'all'
      ? ((PGRE.topicById(topicFilter) || {}).name || topicFilter)
      : '';
    var html = '<header class="ps-head"><h1>Physics mistake book</h1>' +
      '<p class="ps-sub">' + open.length + ' entr' + (open.length === 1 ? 'y' : 'ies') +
      (topicName ? ' · ' + PGRE.ui.esc(topicName) : '') +
      ' · printed ' + printDate() + '</p></header>';
    open.forEach(function (e) { html += missPrintEntry(e); });
    var sheet = document.createElement('section');
    sheet.className = 'print-sheet';
    sheet.id = 'mistakes-print';
    sheet.innerHTML = html;
    view.appendChild(sheet);
    PGRE.typesetMath(sheet);
  }

  function printBook() {
    buildPrintSheet();
    document.body.classList.add('pgre-printing');
    window.print();
  }

  window.addEventListener('afterprint', function () {
    document.body.classList.remove('pgre-printing');
  });

  /* ——— Parked-drill snapshot ———
     The drill used to live only in the `drill` closure, so leaving #/mistakes
     (or clicking the "Mistake book" crumb) destroyed it. The in-flight drill is
     mirrored to sessionStorage['pgre-mistake-drill']: the queue still in play
     (ids after skips), the cursor, per-question results with their revert
     records, the skipped count and the gamify session id. Written on every
     render; deleted on finish, discard, or a fresh drill. Tab-scoped like the
     practice snapshot: a reload resumes it, a second tab never sees it. */
  function drillSaveKey() {
    return (PGRE.sessionPark && PGRE.sessionPark.DRILL_KEY) || 'pgre-mistake-drill';
  }

  function paintPark() {
    if (PGRE.sessionPark && PGRE.sessionPark.paint) PGRE.sessionPark.paint();
  }

  function saveDrill() {
    if (!drill || drill.done) return;
    var snap = {
      v: 1,
      sid: drill.sid,
      i: drill.i,
      skipped: drill.skipped,
      ids: drill.qs.map(function (q) { return q.id; }),
      results: drill.st.map(function (st) {
        if (!st) return null;
        return { qid: st.q.id, picked: st.picked, correct: st.correct,
                 xp: st.xp, ms: st.ms, day: st.day,
                 mkBefore: st.mkBefore, qRecBefore: st.qRecBefore };
      }),
      savedAt: Date.now()
    };
    try { sessionStorage.setItem(drillSaveKey(), JSON.stringify(snap)); }
    catch (e) { /* storage blocked — the live drill still works */ }
    paintPark();
  }

  function readDrillSaved() {
    var raw = null;
    try { raw = sessionStorage.getItem(drillSaveKey()); } catch (e) { return null; }
    if (!raw) return null;
    var snap = null;
    try { snap = JSON.parse(raw); } catch (e2) { return null; }
    if (!snap || !Array.isArray(snap.ids) || !snap.ids.length) return null;
    return snap;
  }

  function clearDrillSaved() {
    try { sessionStorage.removeItem(drillSaveKey()); } catch (e) { /* blocked */ }
    paintPark();
  }

  /* The real attempt row a stored result recorded, found by sid+qid. Resume
     can only offer a REPLACING answer while this row is locatable: without it
     revertAnswer has nothing to splice and the re-answer would double-count.
     mkBefore/qRecBefore ride the snapshot so the revert still restores the
     exact pre-answer book/question state. */
  function findDrillRow(sid, qid) {
    var arr = (PGRE.store.state && PGRE.store.state.attempts) || [];
    for (var i = arr.length - 1; i >= 0; i--) {
      var a = arr[i];
      if (a && a.sid === sid && a.qid === qid) return a;
    }
    return null;
  }

  /* Rebuild the live drill from a snapshot after a reload. Paints stored
     results only — nothing here calls recordAnswer or gradeCard. */
  function restoreDrill() {
    var snap = readDrillSaved();
    if (!snap) return false;
    var qs = [];
    snap.ids.forEach(function (id) {
      var q = PGRE.questionById(id);
      if (q) qs.push(q);
    });
    if (!qs.length) { clearDrillSaved(); return false; }   // bank changed under us
    var st = qs.map(function () { return null; });
    qs.forEach(function (q, n) {
      var r = (snap.results || []).filter(function (x) { return x && x.qid === q.id; })[0];
      if (!r) return;
      var row = findDrillRow(snap.sid, q.id);   // null when the row is gone
      st[n] = { q: q, picked: r.picked, correct: r.correct, xp: r.xp,
                ms: r.ms, row: row, day: r.day, sid: snap.sid,
                mkBefore: r.mkBefore || null, qRecBefore: r.qRecBefore || null };
    });
    var i = Math.max(0, Math.min(snap.i || 0, qs.length - 1));
    drill = { qs: qs, st: st, i: i, skipped: snap.skipped || 0,
              done: false, reviewing: false, sid: snap.sid };
    return true;
  }

  /* History: rebuild a finished or unfinished mistake drill from the stored
     session and its attempts. Read-only — never writes, never touches `drill`
     or the parked snapshot. A question that left the bank is a stub that
     names the missing id instead of throwing. */
  function questionForAttempt(row) {
    var q = PGRE.questionById(row.qid);
    if (q) return q;
    var choices = LETTERS.slice();
    var ans = typeof row.answer === 'number' ? row.answer : 0;
    var pick = typeof row.picked === 'number' ? row.picked : -1;
    var need = Math.max(choices.length, ans + 1, pick + 1);
    while (choices.length < need) choices.push(String(choices.length + 1));
    return {
      id: row.qid,
      topic: row.topic,
      q: '<p>Question ' + PGRE.ui.esc(row.qid) + ' is no longer in the bank.</p>',
      choices: choices,
      answer: ans,
      sol: '',
      missing: true
    };
  }

  function recordKicker(sess, kind, extra) {
    var when = '';
    if (sess && sess.startedAt) {
      var d = new Date(sess.startedAt);
      when = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' +
             d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    var parts = [kind];
    if (extra) parts.push(extra);
    if (when) parts.push(when);
    return '<div class="record-kicker">' +
      '<span class="record-kicker-line">' + PGRE.ui.esc(parts.join(' · ')) + '</span>' +
      '<span class="chip record-past">Past record</span></div>';
  }

  function assessBits(row) {
    var bits = [];
    if (!row) return bits;
    if (row.confidence) bits.push(row.confidence === 'guess' ? 'Guessed' : 'Knew it');
    (row.tags || []).forEach(function (tg) {
      bits.push((PGRE.assess && PGRE.assess.LABELS && PGRE.assess.LABELS[tg]) || tg);
    });
    return bits;
  }

  function assessChipHTML(row) {
    var bits = assessBits(row);
    if (!bits.length) return '';
    return '<span class="chip record-assess">Self-assessment: ' +
      PGRE.ui.esc(bits.join(' · ')) + '</span>';
  }

  function letterOf(i) {
    return (typeof i === 'number' && i >= 0 && LETTERS[i]) ? LETTERS[i] : '—';
  }

  function missingBankNote(q, st) {
    return '<div class="record-missing" id="missing-q-note">' +
      'This question has left the bank. Your pick: ' + letterOf(st && st.picked) +
      ' · Correct answer: ' + letterOf(q && q.answer) +
      '. Its wording and solution were not stored.</div>';
  }

  function reconstructArchive(sid) {
    if (!sid || !PGRE.gamify || typeof PGRE.gamify._session !== 'function') return null;
    var sess = PGRE.gamify._session(sid);
    if (!sess || sess.mode !== 'mistakes') return null;
    var arr = (PGRE.store.state && PGRE.store.state.attempts) || [];
    var lastByQid = {};
    var order = [];
    arr.forEach(function (a) {
      if (!a || a.sid !== sid) return;
      if (!lastByQid[a.qid]) order.push(a.qid);
      lastByQid[a.qid] = a;
    });
    var qs = [];
    var st = [];
    order.forEach(function (qid) {
      var row = lastByQid[qid];
      var q = questionForAttempt(row);
      qs.push(q);
      st.push({
        q: q, picked: row.picked, correct: !!row.correct,
        xp: null, ms: row.ms, row: row, sid: sid
      });
    });
    return {
      qs: qs, st: st, i: 0, skipped: 0, done: true, reviewing: false,
      sid: sid, readonly: true, sess: sess
    };
  }

  function openArchive(sid) {
    try { sid = decodeURIComponent(sid); } catch (e) { /* keep raw */ }
    archive = reconstructArchive(sid);
    if (!archive) {
      root().innerHTML = '<div class="card practice-card"><h1>Drill not found</h1>' +
        '<p class="muted">This History entry has no stored mistake-drill session.</p>' +
        '<div class="btn-row"><a class="btn btn-primary" href="#/history">Back to History</a></div></div>';
      return;
    }
    renderDrillSummary();
  }

  /* Discard ends ONLY the session row this drill owns — older abandoned rows
     have no queue and stay untouched. */
  function discardParkedDrill() {
    var sid = drill ? drill.sid : (readDrillSaved() || {}).sid;
    if (sid) PGRE.gamify.endSession(sid);
    drill = null;
    clearDrillSaved();
    PGRE.toast('Parked drill discarded — answered questions stay recorded.', 'info');
    if (location.hash === '#/mistakes/drill') location.hash = '#/mistakes';
    else if (root()) renderBook();
  }

  /* ——— Re-drill: same answering pipeline as practice (mode: mistakes) ———
     The drill is browsable, not a one-way conveyor:
     - drill.qs holds the questions in play, drill.st the parallel per-question
       result (null while unanswered), drill.i the cursor.
     - ← Back / Next → and the question palette move the cursor freely, so a
       question can be revisited (and re-answered) or left for later.
     - Skip DROPS the question from this drill for good (spliced out of both
       arrays, mirroring the formula deck's skipCard) — nothing is recorded, so
       the question keeps its place in the book and its existing review date.
     - Re-answering REPLACES the earlier answer: gamify.revertAnswer() unwinds
       the first attempt (row, XP, tallies, mistake-book/SRS entry) before the
       new one is recorded, so one question never moves the ladder twice. */
  /* A new drill replaces the one parked slot: any earlier snapshot is gone as
     soon as this drill is mirrored below. */
  function startDrill(qs) {
    if (!qs.length) return;
    var order = shuffle(qs);
    drill = { qs: order, st: order.map(function () { return null; }), i: 0,
              skipped: 0, done: false, reviewing: false,
              sid: PGRE.gamify.beginSession('mistakes', 'mistakes', qs.length) };
    saveDrill();
    // The drill has its own hash now; routing mounts it on the question. If we
    // are already on #/mistakes/drill (resume → new drill) force the re-mount.
    if (location.hash === '#/mistakes/drill') PGRE.route();
    else location.hash = '#/mistakes/drill';
  }

  /* Live drill, or the History reconstruction when that route is up.
     Archive takes priority so a parked live drill stays in `drill` untouched. */
  function currentDrill() { return archive || drill; }

  function answeredCount() {
    var d = currentDrill(), n = 0;
    if (!d) return 0;
    d.st.forEach(function (s) { if (s) n++; });
    return n;
  }

  function correctCount() {
    var d = currentDrill(), n = 0;
    if (!d) return 0;
    d.st.forEach(function (s) { if (s && s.correct) n++; });
    return n;
  }

  function earnedXP() {
    var d = currentDrill(), n = 0;
    if (!d) return 0;
    d.st.forEach(function (s) { if (s) n += s.xp; });
    return n;
  }

  function fmtAttemptMs(ms) {
    if (ms == null) return '';
    var s = ms / 1000;
    return (s < 10 ? s.toFixed(1) : Math.round(s)) + ' s';
  }

  /* Numbered jump grid — reuses the exam room's .pal-cell look.
     While the drill runs the cells only say answered / not answered: a
     correct-vs-missed tint would tell you, from across the card, whether the
     answer you are about to walk back to was the right one, which is exactly
     what revisiting is supposed to make you recall. The results palette (with
     the tints) belongs to the summary. Answered cells open a read-only review
     of that question; unanswered stay inert. Nothing is re-recorded. */
  function paletteHTML(results, current) {
    var d = currentDrill();
    if (!d) return '';
    if (!results && current == null) current = d.i;
    var cells = '';
    d.qs.forEach(function (q, n) {
      var st = d.st[n];
      var cls = 'pal-cell';
      if (st) cls += results ? (st.correct ? ' is-correct' : ' is-wrong') : ' is-answered';
      if (current != null && n === current) cls += ' is-current';
      var label = 'Question ' + (n + 1);
      if (st) label += results ? (st.correct ? ', correct' : ', missed') : ', answered';
      else label += results ? ', not answered' : ', unanswered';
      if (current != null && n === current) label += ', current';
      var attrs;
      if (results) {
        if (st) {
          attrs = ' data-review="' + n + '" title="Review this question"';
          label += ', review';
        } else {
          attrs = ' disabled';
        }
      } else {
        attrs = ' data-goto="' + n + '"';
      }
      cells += '<button type="button" class="' + cls + '"' + attrs +
        ' aria-label="' + label + '">' + (n + 1) + '</button>';
    });
    return '<div class="drill-palette">' +
      '<div class="exam-palette-title">' +
        (results ? 'How this drill went' : 'Questions in this drill') + '</div>' +
      '<div class="exam-palette-grid">' + cells + '</div>' +
      '<div class="exam-legend drill-legend">' +
        (results
          ? '<span class="exam-legend-item"><span class="pal-swatch sw-correct"></span>Correct</span>' +
            '<span class="exam-legend-item"><span class="pal-swatch sw-wrong"></span>Missed</span>' +
            '<span class="exam-legend-item"><span class="pal-swatch"></span>Not answered</span>'
          : '<span class="exam-legend-item"><span class="pal-swatch"></span>Unanswered</span>' +
            '<span class="exam-legend-item"><span class="pal-swatch sw-answered"></span>Answered</span>') +
      '</div></div>';
  }

  function neighborAnswered(from, dir) {
    var d = currentDrill();
    if (!d) return -1;
    for (var i = from + dir; i >= 0 && i < d.qs.length; i += dir) {
      if (d.st[i]) return i;
    }
    return -1;
  }

  function bindReviewJumps() {
    root().querySelectorAll('[data-review]').forEach(function (b) {
      b.addEventListener('click', function () {
        renderDrillReview(parseInt(b.getAttribute('data-review'), 10));
      });
    });
  }

  /* The feedback panel under an answered question. `fresh` (just answered) gets
     the blank self-assessment row. A result put back on screen (reveal, or the
     review page from the results) gets the same chips painted from its row,
     with the review window; re-reading writes nothing, a tap regrades. Only a
     result whose row is gone or superseded falls back to the read-only line. */
  function correctTitle(q) {
    if (PGRE.assess && typeof PGRE.assess.reviewTitle === 'function') return PGRE.assess.reviewTitle(q.id);
    return 'Correct';
  }

  function reanswerHint() {
    return '<div class="drill-reanswer-hint muted">Select a different choice, then Confirm or double-click — ' +
      'it replaces this answer.</div>';
  }

  /* The row a regrade stamps (see PGRE.assess.regradeRow), re-pointed at the
     live attempt object. null keeps the read-only line. */
  function regradeRow(q, st) {
    var row = PGRE.assess && typeof PGRE.assess.regradeRow === 'function'
      ? PGRE.assess.regradeRow(q.id, st.row) : null;
    if (row) st.row = row;
    return row;
  }

  /* Wire the chips under an answered question. A fresh answer starts blank;
     a result put back on screen is painted from its row without writing. */
  function bindAssess(q, st, fresh) {
    var fb = document.getElementById('feedback');
    if (!fb || !fb.querySelector('#assess-row')) return null;
    var ctrl = PGRE.assess.bind(fb, q, st.correct);
    if (!fresh && typeof ctrl.hydrate === 'function') ctrl.hydrate(PGRE.assess.flagsFromRow(st.row));
    return ctrl;
  }

  function feedbackHTML(q, st, fresh, locked) {
    var readonly = !!(currentDrill() && currentDrill().readonly);
    var title = st.correct
      ? (readonly ? 'Correct' : correctTitle(q))
      : 'Incorrect — the answer is ' + LETTERS[q.answer] +
        (readonly ? '' : '; back to the bottom of the ladder');
    var html = '<div class="feedback reveal-in ' + (st.correct ? 'feedback-good' : 'feedback-bad') + '">' +
      '<span class="fb-icon">' + (st.correct ? '✓' : '✗') + '</span>' +
      '<strong>' + title + '</strong>' +
      (st.xp != null ? '<span class="fb-xp">+' + st.xp + ' XP</span>' : '') +
    '</div>';
    if (!readonly) html += paceMark(st.ms != null ? st.ms : (st.row && st.row.ms));
    if (fresh && !readonly) {
      html += PGRE.assess.html(PGRE.store.state.settings.keyboard);
    } else if (!readonly && regradeRow(q, st)) {
      // the same chips, painted from this drill's own row, plus the review
      // window; a tap regrades that row and never records a new attempt
      html += PGRE.assess.html(PGRE.store.state.settings.keyboard, { review: true });
      if (!locked) html += reanswerHint();
    } else if (!readonly) {
      // read the assessment off THIS drill's own attempt row (st.row, which
      // PGRE.assess stamps in place) — lastAssess() would happily surface a
      // tag from some practice session weeks ago as if it belonged here
      var bits = assessBits(st.row);
      if (bits.length) {
        html += '<div class="conf-note muted">Your self-assessment: <strong>' +
          bits.join(' · ') + '</strong></div>';
      }
      if (!locked) html += reanswerHint();
    }
    if (q.missing) {
      if (!readonly) {
        html += '<p class="muted" id="missing-q-note">This question is no longer in the bank. ' +
          'The original wording and solution are not stored.</p>';
      }
    } else {
      html += '<div class="solution"><div class="solution-label">Solution</div>' + q.sol + '</div>' +
        distractorBlock(q);
    }
    return html;
  }

  /* opts:
       fresh  — rendered right after an answer: markers, solution and the
                interactive assessment row, and no scroll back to the top.
       reveal — the stored result put back on screen because you re-picked the
                choice you had already committed to (nothing is re-recorded).
     A plain visit uses that same result whenever the question is already
     answered, so resuming a drill shows the saved choice and verdict. An
     unanswered question still hides the key. */
  function renderDrillQuestion(opts) {
    opts = opts || {};
    if (PGRE.nav) PGRE.nav.setTrail([]);   // plain view resets the Review crumb
    lastRenderAt = Date.now();
    var q = drill.qs[drill.i];
    var st = drill.st[drill.i];
    var show = !!st;   // saved choice and verdict, including a resumed drill
    var t = PGRE.topicById(q.topic) || { id: 'xx', short: '?', name: 'Unknown topic' };
    var done = answeredCount();
    var keys = PGRE.store.state.settings.keyboard;
    var html = '<div class="card practice-card">' +
      '<div class="practice-meta">' +
        '<span>Mistake drill — ' + (drill.i + 1) + ' of ' + drill.qs.length + '</span>' +
        '<span class="chip">' + t.name + '</span>' +
        '<span class="chip">' + done + ' answered</span>' +
        (drill.skipped ? '<span class="chip">' + drill.skipped + ' skipped</span>' : '') +
        (settings().paceTrainer && !show
          ? '<span class="chip pace-chip" id="pace-chip" title="Time on this question">0 s</span>'
          : '') +
      '</div>' +
      PGRE.ui.meter(100 * done / drill.qs.length, 'meter-thin') +
      '<div class="q-text">' + q.q + '</div>' +
      '<div class="choices">';
    q.choices.forEach(function (c, idx) {
      var cls = 'choice';
      if (show) {
        if (idx === q.answer) cls += ' is-answer';
        if (idx === st.picked && !st.correct) cls += ' is-wrong';
      }
      html += '<button class="' + cls + '" data-idx="' + idx + '" aria-pressed="' +
        (show && idx === st.picked ? 'true' : 'false') + '">' +
        '<span class="choice-letter">' + LETTERS[idx] + '</span>' +
        '<span class="choice-body">' + c + '</span></button>';
    });
    html += '</div>';
    html += '<div class="btn-row choice-commit-row">' +
      '<button type="button" class="btn btn-primary" id="confirm-btn" disabled>Confirm</button>' +
      '<span class="practice-keys muted">or double-click a choice</span></div>';
    if (keys) {
      html += '<div class="practice-keys muted">' +
        '<span class="key-hint">A</span>–<span class="key-hint">E</span> select · ' +
        '<span class="key-hint">Enter</span> confirm · ' +
        '<span class="key-hint">←</span> back · <span class="key-hint">→</span> next · ' +
        '<span class="key-hint">S</span> skip</div>';
    }
    html += '<div id="feedback">' + (show ? feedbackHTML(q, st, !!opts.fresh, !st.row) : '') + '</div>' +
      '<div class="btn-row drill-navrow">' +
        '<button class="btn btn-ghost" id="drill-prev"' + (drill.i === 0 ? ' disabled' : '') +
          '>← Back</button>' +
        // Skip keeps its slot (disabled) on an answered question: dropping the
        // button would slide Next → into its place, and a slow double-click on
        // Next would then land on Skip — irreversible, on the next question.
        '<button class="btn btn-ghost" id="drill-skip"' + (st ? ' disabled' : '') +
          '>Skip</button>' +
        '<button class="btn ' + (st ? 'btn-primary' : 'btn-ghost') + '" id="drill-next"' +
          (drill.i + 1 >= drill.qs.length ? ' disabled' : '') + '>Next →</button>' +
        '<button class="btn ' + (done >= drill.qs.length ? 'btn-primary' : 'btn-ghost') +
          ' drill-finish" id="drill-finish">Finish drill</button>' +
      '</div>' +
      paletteHTML() +
      '</div>';
    root().innerHTML = html;
    PGRE.typesetMath(root());
    if (window.PGRE && PGRE.motion && PGRE.motion.animateMeter) {
      var mf = root().querySelector('.meter-thin .meter-fill');
      if (mf) PGRE.motion.animateMeter(mf, 100 * done / drill.qs.length);
    }
    if (window.PGRE && PGRE.motion && PGRE.motion.countUp) {
      var xpEl = root().querySelector('.fb-xp');
      if (xpEl) PGRE.motion.countUp(xpEl, st.xp, { duration: 600, format: function (n) { return '+' + Math.round(n) + ' XP'; } });
    }
    // in-place swap: route()'s reset doesn't run here. Answering or revealing
    // keeps your place; only actually moving to another question scrolls up.
    if (!opts.fresh && !opts.reveal) window.scrollTo(0, 0);
    drill.qStart = Date.now();
    if (show) clearPace();
    else startPaceTimer();

    drill.choiceCommit = PGRE.ui.bindChoiceCommit(root(), { onCommit: drillAnswer });
    // the controller is per-render: a later re-render orphans the old chip
    // row, so shortcuts stay live only while a result is on screen
    drill.assess = show ? bindAssess(q, st, !!opts.fresh) : null;

    document.getElementById('drill-prev').addEventListener('click', function () { goTo(drill.i - 1); });
    document.getElementById('drill-next').addEventListener('click', function () { goTo(drill.i + 1); });
    document.getElementById('drill-finish').addEventListener('click', function (e) {
      // guard real clicks against the render's settling window, but never a
      // keyboard activation (detail 0) — Finish takes focus after the last
      // answer, and a swallowed Enter looks like a dead button
      if (e && e.detail > 0 && Date.now() - lastRenderAt < 300) return;
      renderDrillSummary();
    });
    var sk = document.getElementById('drill-skip');
    if (sk) sk.addEventListener('click', skipCurrent);
    root().querySelectorAll('[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () { goTo(parseInt(b.getAttribute('data-goto'), 10)); });
    });
    saveDrill();   // cursor/results mirror — the parked snapshot stays live
    if (opts.fresh) {
      var nb = document.getElementById('drill-next');
      (nb && !nb.disabled ? nb : document.getElementById('drill-finish')).focus();
    }
  }

  function goTo(idx) {
    if (!drill || idx < 0 || idx >= drill.qs.length || idx === drill.i) return;
    drill.i = idx;
    renderDrillQuestion();
  }

  /* Skip: drop the question from this drill entirely. Nothing is recorded, so
     it keeps its rung on the ladder and shows up again whenever it next falls
     due — it simply is not part of this run any more. */
  function skipCurrent() {
    if (!drill || drill.st[drill.i]) return;    // an answered question has nothing to skip
    if (Date.now() - lastRenderAt < 300) return;
    drill.qs.splice(drill.i, 1);
    drill.st.splice(drill.i, 1);
    drill.skipped++;
    PGRE.toast('Skipped — it stays in the book with its review date untouched.', 'info');
    if (!drill.qs.length) { renderDrillSummary(); return; }
    if (drill.i >= drill.qs.length) drill.i = drill.qs.length - 1;
    renderDrillQuestion();
  }

  /* Record one answer, replacing any earlier answer to the same question in
     this drill (see gamify.revertAnswer for exactly what a replacement undoes). */
  function commitAnswer(idx) {
    var q = drill.qs[drill.i];
    var prev = drill.st[drill.i];
    if (prev) PGRE.gamify.revertAnswer(prev);

    var s = PGRE.store.state;
    var mkBefore = s.mistakes[q.id] ? JSON.parse(JSON.stringify(s.mistakes[q.id])) : null;
    var qRecBefore = s.questions[q.id] ? JSON.parse(JSON.stringify(s.questions[q.id])) : null;
    var isCorrect = idx === q.answer;
    var elapsed = Date.now() - drill.qStart;
    var xp = PGRE.gamify.recordAnswer(q, isCorrect, elapsed,
                                      { picked: idx, sid: drill.sid, mode: 'mistakes' });
    if (xp === null) { drill.st[drill.i] = null; return; }   // refused: nothing to revert later
    if (isCorrect) PGRE.srs.clearLucky(q.id);   // a correct re-drill retires the lucky flag
    drill.st[drill.i] = {
      q: q, picked: idx, correct: isCorrect, xp: xp, ms: elapsed,
      row: s.attempts[s.attempts.length - 1],   // the row recordAnswer just pushed
      day: s.today.date, sid: drill.sid,
      mkBefore: mkBefore, qRecBefore: qRecBefore
    };
  }

  function drillAnswer(idx) {
    if (!drill) return;
    var prev = drill.st[drill.i];
    // Standing by the answer you already gave records nothing — it just puts
    // the verdict and solution back on screen, which is the only way to re-read
    // them without replacing the answer.
    if (prev && prev.picked === idx) { renderDrillQuestion({ reveal: true }); return; }
    // A result restored after a reload whose attempt row can no longer be found
    // is read-only: replacing it would have no row to revert, so the re-answer
    // would double-count. Reveal the stored result instead.
    if (prev && !prev.row) {
      renderDrillQuestion({ reveal: true });
      PGRE.toast('This saved answer is locked — the row it recorded is no longer in the log.', 'info');
      return;
    }
    commitAnswer(idx);
    if (!drill.st[drill.i]) {
      renderDrillQuestion();
      return;
    }
    renderDrillQuestion({ fresh: true });
  }

  function renderDrillReview(idx) {
    var d = currentDrill();
    if (!d || idx < 0 || idx >= d.qs.length) return;
    var st = d.st[idx];
    if (!st) return;
    if (d.reviewing && d.i === idx) return;
    clearPace();
    d.i = idx;
    d.reviewing = true;
    d.choiceCommit = null;
    lastRenderAt = Date.now();
    if (PGRE.nav) PGRE.nav.setTrail(['Review']);
    var q = d.qs[idx];
    var t = PGRE.topicById(q.topic) || { id: 'xx', short: '?', name: 'Unknown topic' };
    var prev = neighborAnswered(idx, -1);
    var next = neighborAnswered(idx, 1);
    var readonly = !!d.readonly;
    var gone = readonly && q.missing;
    var html = '<div class="card practice-card">' +
      '<div class="practice-meta">' +
        '<span>Review — ' + (idx + 1) + ' of ' + d.qs.length + '</span>' +
        '<span class="chip">' + t.name + '</span>' +
        '<span class="chip">' + (st.correct ? 'Correct' : 'Missed') + '</span>' +
        (st.ms != null ? '<span class="chip">' + fmtAttemptMs(st.ms) + '</span>' : '') +
        (readonly ? assessChipHTML(st.row) : '') +
      '</div>';
    if (!gone) {
      html += '<div class="q-text">' + q.q + '</div>' +
        '<div class="choices">';
      q.choices.forEach(function (c, cidx) {
        var cls = 'choice';
        if (cidx === q.answer) cls += ' is-answer';
        if (cidx === st.picked && !st.correct) cls += ' is-wrong';
        html += '<button class="' + cls + '" disabled aria-pressed="' +
          (cidx === st.picked ? 'true' : 'false') + '">' +
          '<span class="choice-letter">' + LETTERS[cidx] + '</span>' +
          '<span class="choice-body">' + c + '</span></button>';
      });
      html += '</div>';
    }
    html += '<div id="feedback">' + feedbackHTML(q, st, false, true) +
      (gone ? missingBankNote(q, st) : '') + '</div>' +
      '<div class="btn-row drill-navrow">' +
        '<button class="btn btn-ghost" id="review-prev" title="Previous question (Left arrow)"' +
          (prev < 0 ? ' disabled' : '') + '>← Back</button>' +
        '<button class="btn btn-ghost" id="review-next" title="Next question (Right arrow or Enter)"' +
          (next < 0 ? ' disabled' : '') + '>Next →</button>' +
        '<button class="btn btn-primary drill-finish" id="review-summary" title="Back to results (Esc)">' +
          'Back to results</button>' +
      '</div>' +
      paletteHTML(true, idx) +
      '</div>';
    root().innerHTML = html;
    PGRE.typesetMath(root());
    window.scrollTo(0, 0);
    document.getElementById('review-prev').addEventListener('click', function () {
      if (prev >= 0) renderDrillReview(prev);
    });
    document.getElementById('review-next').addEventListener('click', function () {
      if (next >= 0) renderDrillReview(next);
    });
    document.getElementById('review-summary').addEventListener('click', renderDrillSummary);
    d.assess = d.readonly ? null : bindAssess(q, st, false);
    bindReviewJumps();
    if (!d.readonly) saveDrill();
  }

  function renderDrillSummary() {
    var d = currentDrill();
    if (!d) return;
    clearPace();
    var readonly = !!d.readonly;
    if (PGRE.nav) PGRE.nav.setTrail([]);   // BUNDLE G: drill over — back to base
    lastRenderAt = Date.now();
    d.reviewing = false;
    d.assess = null;
    if (!readonly) {
      clearDrillSaved();                   // the parked slot ends with the drill
      var firstClose = !d.done;
      d.done = true;                       // the keys stop answering from here on
      if (firstClose) {
        PGRE.gamify.endSession(d.sid);
        PGRE.store.log('mistake', 'Mistake drill: ' + correctCount() + '/' + answeredCount() + ' correct' +
          (d.skipped ? ' · ' + d.skipped + ' skipped' : ''), 0);
        PGRE.gamify.checkAchievements(); // before save() so a just-unlocked badge persists now
        PGRE.store.save();
      }
    }
    var done = answeredCount(), correct = correctCount();
    var xp = readonly && d.sess ? (d.sess.xp || 0) : earnedXP();
    var left = d.qs.length - done;
    var stillDue = readonly ? 0 : filterByConcern(filterByTopic(PGRE.srs.dueMistakes())).length;
    var untouched = [];
    if (d.skipped) untouched.push(d.skipped + ' skipped');
    if (left) untouched.push(left + ' left unanswered');
    var heading = readonly
      ? recordKicker(d.sess, 'Mistake drill')
      : '<h1>Drill complete</h1>';
    root().innerHTML = '<div class="card practice-card">' +
      heading +
      // every question skipped or left behind: a score of 0 / 0 would read as a
      // wipeout rather than as "nothing was answered, so nothing changed"
      (done ? '<div class="summary-score">' + correct + ' / ' + done +
                '<span class="summary-pct">+' + xp + ' XP</span></div>'
            : '<p class="muted">You did not answer anything this time — the book is exactly ' +
              'as you left it.</p>') +
      (untouched.length
        ? '<p class="muted">' + untouched.join(' · ') + ' — those kept their place in the book ' +
          'and their existing review date.</p>'
        : '') +
      (!readonly && done
        ? '<p class="muted">Solved mistakes stay in the book — their next review just moved ' +
          'further out. ' +
          (stillDue ? stillDue + ' still due now.' : 'Nothing else is due right now.') + '</p>'
        : '') +
      // tinted map: answered cells open read-only review; nothing is re-recorded
      (d.qs.length ? paletteHTML(true) : '') +
      '<div class="btn-row">' +
        (readonly
          ? '<a class="btn btn-primary" id="back-history" href="#/history">Back to History</a>'
          : '<button class="btn btn-primary" id="back-book">Back to the book</button>') +
        '<a class="btn btn-ghost" href="#/">Dashboard</a>' +
      '</div></div>';
    var backBook = document.getElementById('back-book');
    if (backBook) backBook.addEventListener('click', function () {
      // a real route change: the drill finished on #/mistakes/drill, the book
      // lives at #/mistakes
      if (location.hash === '#/mistakes') renderBook();
      else location.hash = '#/mistakes';
      window.scrollTo(0, 0);
    });
    bindReviewJumps();
  }

  /* ——— Keyboard (same opt-in setting as practice: settings.keyboard) ———
     A–E / 1–5 select, Enter confirms (or re-answers), ← / → browse, S skip,
     Enter/Space/N advance when nothing is pending, K / G / T / F / R self-assess
     (while a result's chip row is on screen, the review page included). The
     review page: ← / → / Enter browse the results, Esc back to them. */
  function onKey(e) {
    var d = currentDrill();
    if (!d) return;
    if (d.done && !d.reviewing) return;                     // the summary is up
    if (!document.getElementById('mistakes-root')) return;  // not on the mistake-book view
    if (!PGRE.store.state.settings.keyboard) return;
    var tg = (e.target && e.target.tagName) || '';
    if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT' ||
        (e.target && e.target.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key;

    // Review page: questions are not re-answerable; the nav takes the practice
    // review's keys and the grading chips keep the answer page's letters.
    if (d.reviewing) { reviewKey(e, k); return; }
    if (d.readonly) return;

    if (/^[a-eA-E]$/.test(k) || /^[1-5]$/.test(k)) {
      var idx = /^[1-5]$/.test(k) ? parseInt(k, 10) - 1 : k.toUpperCase().charCodeAt(0) - 65;
      if (idx < drill.qs[drill.i].choices.length) {
        e.preventDefault();
        if (drill.choiceCommit) drill.choiceCommit.select(idx);
      }
    } else if (k === 'ArrowLeft') {
      e.preventDefault(); goTo(drill.i - 1);
    } else if (k === 'ArrowRight') {
      e.preventDefault(); goTo(drill.i + 1);
    } else if (k === 's' || k === 'S') {
      e.preventDefault(); skipCurrent();
    } else if (k === 'Enter' && drill.choiceCommit && drill.choiceCommit.selected() != null) {
      // Only Confirm's native activation is the commit path. After a fresh
      // answer, Next/Finish is focused — A–E then Enter must still confirm
      // the pending re-pick, not advance.
      if (document.activeElement && document.activeElement.id === 'confirm-btn') return;
      e.preventDefault();
      drill.choiceCommit.commit();
    } else if (k === 'Enter' || k === ' ' || k === 'n' || k === 'N') {
      // Enter/Space on a focused button already activates it — don't double-fire
      if ((k === 'Enter' || k === ' ') && document.activeElement &&
          document.activeElement.tagName === 'BUTTON') return;
      e.preventDefault();
      var nb = document.getElementById('drill-next');
      if (nb && !nb.disabled) nb.click();
      else document.getElementById('drill-finish').click();
    } else {
      assessKey(e, k);
    }
  }

  /* Review page keys, as on the practice review (js/view-practice.js onKey):
     ← / → the previous / next answered question, Enter the next one (unless a
     Tab-focused control owns it), Esc back to the results. */
  function reviewKey(e, k) {
    var d = currentDrill();
    if (!d) return;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      var to = neighborAnswered(d.i, k === 'ArrowLeft' ? -1 : 1);
      if (to >= 0) { e.preventDefault(); renderDrillReview(to); }
    } else if (k === 'Enter' && !PGRE.enterPressesControl()) {
      // on the last question too: Enter must not press a chip a click left focused
      e.preventDefault();
      var after = neighborAnswered(d.i, 1);
      if (after >= 0) renderDrillReview(after);
    } else if (k === 'Escape') {
      e.preventDefault();
      renderDrillSummary();
    } else {
      assessKey(e, k);
    }
  }

  /* Self-assessment chips, same keys as practice: K knew it, G guessed,
     T too slow, F forgot something, R keep failing (asks first). Only while
     the chip row this controller was bound to is still on screen. */
  var ASSESS_KEYS = { k: 'sure', g: 'guess', t: 'slow', f: 'forgot', r: 'stuck' };
  function assessKey(e, k) {
    var d = currentDrill();
    var key = ASSESS_KEYS[String(k).toLowerCase()];
    if (!key || !d || !d.assess || !document.getElementById('assess-row')) return;
    e.preventDefault();
    d.assess.requestToggle(key);
  }

  return {
    render: function () { return '<div id="mistakes-root"></div>'; },
    mount: function (params) {
      clearPace();
      if (drill) drill.assess = null;   // the chip row it was bound to is gone
      topicFilter = 'all';
      concernFilter = 'all';
      bookShown = BOOK_PAGE;
      if (!keyBound) { document.addEventListener('keydown', onKey); keyBound = true; }
      if (params && params.sub === 'drill' && params.sub2) {
        // History reconstruction: leave the live / parked drill exactly as it is.
        openArchive(params.sub2);
        return;
      }
      archive = null;
      if (params && params.sub === 'drill') {
        // Same-tab resume keeps the LIVE drill (its st rows still reference the
        // real attempt objects); only a reload rebuilds from the snapshot.
        if (drill && !drill.done) { drill.reviewing = false; renderDrillQuestion(); return; }
        if (drill && drill.done) { renderDrillSummary(); return; }
        if (restoreDrill()) { renderDrillQuestion(); return; }
        // #/mistakes/drill with no parked drill must not invent one.
        if (location.hash === '#/mistakes/drill') location.hash = '#/mistakes';
        else renderBook();
        return;
      }
      renderBook();
    },
    // opened up for tools/test-session-park.js (bank-free round-trip)
    _test: { readDrillSaved: readDrillSaved, restoreDrill: restoreDrill,
             discardParkedDrill: discardParkedDrill, drillAnswer: drillAnswer,
             startDrill: startDrill, skipCurrent: skipCurrent,
             dropLive: function () { drill = null; },
             get drill() { return drill; },
             get archive() { return archive; },
             reconstructArchive: reconstructArchive,
             saveDrill: saveDrill }
  };
})();
