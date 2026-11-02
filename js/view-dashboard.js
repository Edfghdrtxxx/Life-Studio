/* Dashboard — the home view. Today is the first card (greeting, exam
   countdown, prep runway, the Mixed practice launcher, then three equal
   tiles: Mistake book, Recall, Mock exam). The next card is the same Daily
   activity target card as the Study time page, then Intensity (banded
   study-intensity feedback, js/intensity.js), then This week. Level/XP,
   stat tiles, challenges, QOTD, readiness and
   achievements sit behind a Progress disclosure whose summary line carries
   level, streak and accuracy. Recent activity follows Progress on its own
   row; knowledge portals close the page. */
window.PGRE = window.PGRE || {};
PGRE.views = PGRE.views || {};

PGRE.views.dashboard = (function () {
  var LETTERS = ['A', 'B', 'C', 'D', 'E'];

  /* F4: where each daily challenge is actually completed, so its card offers a
     one-click jump there (keyed by CHALLENGE_POOL id). Answering-based challenges
     go to mixed practice; the plan/notes challenges go to their own views. */
  var CHALLENGE_NAV = {
    'c-answer8':  { href: '#/practice/all', label: 'Practice' },
    'c-correct5': { href: '#/practice/all', label: 'Practice' },
    'c-run4':     { href: '#/practice/all', label: 'Practice' },
    'c-topics2':  { href: '#/practice/all', label: 'Practice' },
    'c-plantask': { href: '#/plan',         label: 'Study plan' },
    'c-notes':    { href: '#/topic/cm',     label: 'Open a topic' }
  };
  var qotdStart = 0;                              // per-render answer timer
  var qotdBoundDate = null;                       // today.date when the card was wired
  var keyBound = false;                           // the document keydown listener is installed once
  var qotdCommit = null;                          // select-then-confirm controller for today's Q

  /* ————————————————————————————————————————————————————————————
     #7 Question of the day
     A deterministic pick from the default pool, seeded by the date, so it is
     stable all day and changes tomorrow. Answering runs through the SAME
     pipeline practice uses (gamify.recordAnswer with mode 'qotd'), so it feeds
     the streak, today-counters, challenges and the mistake book. The result is
     stored in today.qotd = {qid, correct}; a second render shows the completed
     state instead of re-asking.
     ———————————————————————————————————————————————————————————— */

  /* The day's question. If one was already answered today, resolve that exact
     question by id and return it — or null if its bank is gone. Crucially, an
     answered-but-unresolvable qid does NOT fall through to a fresh seed-pick:
     re-asking a different question would let it be answered (and counted) twice
     and lose the recorded result. Only an unanswered day seed-picks. */
  function qotdPick() {
    var s = PGRE.store.state;
    if (s.today.qotd && s.today.qotd.qid) {
      return PGRE.questionById(s.today.qotd.qid) || null;
    }
    var pool = PGRE.allQuestions();
    if (!pool.length) return null;
    return PGRE.gamify.seededPick('pgre-qotd-' + s.today.date, pool, 1)[0] || null;
  }

  function qotdSolvedFeedback(q, isCorrect, xp) {
    return '<div class="feedback reveal-in ' + (isCorrect ? 'feedback-good' : 'feedback-bad') + '">' +
        '<span class="fb-icon">' + (isCorrect ? '✓' : '✗') + '</span>' +
        '<strong>' + (isCorrect ? 'Correct' : 'Not quite — the answer is ' + LETTERS[q.answer]) + '</strong>' +
        (xp != null ? '<span class="fb-xp">+' + xp + ' XP</span>' : '') +
      '</div>' +
      '<details class="dash-qotd-sol"><summary>Show solution</summary>' +
        '<div class="solution"><div class="solution-label">Solution</div>' + q.sol + '</div>' +
      '</details>' +
      '<p class="muted dash-qotd-tomorrow">That’s today’s question — come back tomorrow for a new one.</p>';
  }

  /* Inner body of the QOTD card (re-rendered in place after an answer). */
  function qotdBody(q) {
    var s = PGRE.store.state;
    var done = (s.today.qotd && s.today.qotd.qid === q.id) ? s.today.qotd : null;
    var t = PGRE.topicById(q.topic);
    var html = '<div class="dash-qotd-meta">' +
        (t ? '<span class="chip">' + PGRE.ui.esc(t.name) + '</span>' : '') +
        '<span class="chip chip-diff">' + PGRE.ui.diffDots(q.difficulty) + '</span>' +
      '</div>' +
      '<div class="q-text">' + q.q + '</div>' +
      '<div class="choices dash-qotd-choices">';
    q.choices.forEach(function (c, idx) {
      var cls = 'choice';
      if (done && idx === q.answer) cls += ' is-answer';
      // done.picked (added to the schema) lets a reload after a wrong answer show
      // your actual wrong pick, not just the correct choice. Older stored results
      // predate the field (picked undefined) and degrade to answer-only.
      if (done && done.picked != null && idx === done.picked && !done.correct) cls += ' is-wrong';
      html += '<button class="' + cls + '" data-idx="' + idx + '"' + (done ? ' disabled' : '') +
        ' aria-pressed="' + (done && done.picked === idx ? 'true' : 'false') + '">' +
        '<span class="choice-letter">' + LETTERS[idx] + '</span>' +
        '<span class="choice-body">' + c + '</span></button>';
    });
    html += '</div>';
    if (!done) {
      html += '<div class="btn-row choice-commit-row">' +
        '<button type="button" class="btn btn-primary" id="confirm-btn" disabled>Confirm</button>' +
        '<span class="practice-keys muted">or double-click a choice' +
          (PGRE.store.state.settings.keyboard
            ? ' · <span class="key-hint">A</span>–<span class="key-hint">E</span> select · <span class="key-hint">Enter</span> confirm'
            : '') +
        '</span></div>';
    }
    html += done ? qotdSolvedFeedback(q, done.correct, null) : '<div id="qotd-feedback"></div>';
    return html;
  }

  function qotdCard() {
    var s = PGRE.store.state;
    var answered = !!(s.today.qotd && s.today.qotd.qid);
    var q = qotdPick();
    var stamp = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    var inner;
    if (q) inner = qotdBody(q);
    else if (answered) {
      // answered earlier today, but the stored question has since left the bank —
      // show a quiet unavailable note rather than silently re-asking a new one
      inner = '<p class="muted">Today’s question is no longer in the bank — it may have changed since you answered it. A fresh question arrives tomorrow.</p>';
    } else {
      inner = '<p class="muted">The question bank is still loading — the daily question arrives once the book import fills the bank.</p>';
    }
    return '<div class="card dash-qotd-card">' +
      '<div class="dash-qotd-head"><h2>Question of the day</h2>' +
        '<span class="dash-qotd-date">' + stamp + '</span></div>' +
      '<div id="qotd-body">' + inner + '</div></div>';
  }

  /* Record the tapped answer through the shared pipeline, then swap the card to
     its solved state without a full re-route (keeps the feedback on screen). */
  function answerQotd(q, idx) {
    var s = PGRE.store.state;
    if (s.today.qotd) return;                       // guard a double tap
    var isCorrect = idx === q.answer;
    var xp = PGRE.gamify.recordAnswer(q, isCorrect, Date.now() - qotdStart,
                                      { picked: idx, mode: 'qotd' });
    if (xp === null) return;                        // refused: leave the slot open for a retry
    // recordAnswer's rollDay may have started a fresh day mid-interaction: the
    // attempt is already durably logged, but yesterday's question must not
    // claim the NEW day's QOTD slot — re-route so today's question appears.
    if (PGRE.store.state.today.date !== qotdBoundDate) {
      PGRE.toast('A new day started — your answer was logged, and today’s fresh question is ready.', 'info');
      PGRE.route();
      return;
    }
    // schema: today.qotd gains `picked` (the chosen idx) alongside {qid, correct}
    // so a reload can redraw your wrong pick. store.migrate tolerates extra keys.
    s.today.qotd = { qid: q.id, correct: isCorrect, picked: idx };
    PGRE.store.save();

    var body = document.getElementById('qotd-body');
    if (!body) return;
    body.querySelectorAll('.choice').forEach(function (b) {
      var i = parseInt(b.getAttribute('data-idx'), 10);
      b.disabled = true;
      b.classList.remove('is-picked');
      if (i === q.answer) b.classList.add('is-answer');
      if (i === idx && !isCorrect) b.classList.add('is-wrong');
      b.setAttribute('aria-pressed', i === idx ? 'true' : 'false');
    });
    var commitBar = body.querySelector('.choice-commit-row');
    if (commitBar && commitBar.parentNode) commitBar.parentNode.removeChild(commitBar);
    var fb = document.getElementById('qotd-feedback');
    if (fb) { fb.innerHTML = qotdSolvedFeedback(q, isCorrect, xp); PGRE.typesetMath(fb); }
    qotdCommit = null;
  }

  function bindQotd() {
    var q = qotdPick();
    var body = document.getElementById('qotd-body');
    if (!q || !body) return;
    PGRE.typesetMath(body);
    qotdCommit = null;
    if (PGRE.store.state.today.qotd) return;         // already solved: nothing to bind
    qotdStart = Date.now();
    qotdBoundDate = PGRE.store.state.today.date;
    qotdCommit = PGRE.ui.bindChoiceCommit(body, {
      onCommit: function (idx) { answerQotd(q, idx); }
    });
  }

  /* ——— Keyboard (same opt-in setting as practice: settings.keyboard) ———
     A–E / 1–5 select, Enter confirms. Live only while today's question is
     on screen unanswered. */
  function onKey(e) {
    if (!PGRE.store.state.settings.keyboard) return;
    if (PGRE.store.state.today.qotd) return;           // already solved today
    if (!document.getElementById('qotd-body')) return; // not on the dashboard
    var prog = document.querySelector('details.dashboard-progress');
    if (prog && !prog.open) return;
    var tg = (e.target && e.target.tagName) || '';
    if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT' ||
        (e.target && e.target.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key;
    if (k === 'Enter') {
      if (!qotdCommit) return;
      e.preventDefault();
      qotdCommit.commit();
      return;
    }
    var idx = -1;
    if (/^[a-eA-E]$/.test(k)) idx = k.toUpperCase().charCodeAt(0) - 65;
    else if (/^[1-5]$/.test(k)) idx = parseInt(k, 10) - 1;
    if (idx < 0) return;
    var q = qotdPick();
    if (!q || idx >= q.choices.length) return;
    e.preventDefault();
    if (qotdCommit) qotdCommit.select(idx);
  }

  /* ————————————————————————————————————————————————————————————
     #10 Readiness / score estimate  (labeled an ESTIMATE)
     Readiness blends (70%) weight-adjusted per-topic accuracy over the last
     30 days with (30%) coverage of the default pool. Unattempted topics count
     as 0 accuracy; the 2–3 emptiest surface as "blind spots". A projected
     scaled score is mapped onto the reported 200–990 band (naive; see below),
     blended 50/50 toward the latest submitted sim's own scaledEst when sims
     exist. Full sims are the trustworthy signal — this is a rough gauge.
     ———————————————————————————————————————————————————————————— */
  function readinessData() {
    var s = PGRE.store.state;
    var now = Date.now();
    var WINDOW = 30 * 86400000;

    // per-topic right/total over the last 30 days of attempts
    var per = {};
    PGRE.TOPICS.forEach(function (t) { per[t.id] = { right: 0, total: 0 }; });
    s.attempts.forEach(function (a) {
      if (!a.ts || now - new Date(a.ts).getTime() > WINDOW) return;
      var p = per[a.topic];
      if (!p) return;
      p.total += 1;
      if (a.correct) p.right += 1;
    });

    // weight-adjusted accuracy (weights sum to 100; unattempted → acc 0)
    var accSum = 0, totalW = 0;
    PGRE.TOPICS.forEach(function (t) {
      var p = per[t.id];
      accSum += t.weight * (p.total ? p.right / p.total : 0);
      totalW += t.weight;
    });
    var weightedAcc = totalW ? accSum / totalW : 0;   // 0..1

    // coverage: share of the default pool touched at least once (all time)
    var pool = PGRE.allQuestions();
    var touched = 0;
    pool.forEach(function (q) {
      var rec = PGRE.questionRecord(q.id, s);
      if (rec && rec.attempts > 0) touched += 1;
    });
    var coverage = pool.length ? touched / pool.length : 0;

    var readiness = 0.7 * weightedAcc + 0.3 * coverage;  // 0..1

    // blind spots: the emptiest topics in the window (fewest attempts, higher
    // exam weight breaks ties so a big untouched block surfaces first)
    var blind = PGRE.TOPICS.slice().sort(function (a, b) {
      var d = per[a.id].total - per[b.id].total;
      return d !== 0 ? d : b.weight - a.weight;
    }).slice(0, 3);

    // Naive scaled-score mapping. GRE Physics is reported on a 200–990 scale in
    // 10-point steps. We map readiness linearly onto that band — 200 at 0%,
    // 990 at 100% — and round to the nearest 10. This is intentionally crude
    // (a real scaled score needs a raw→scaled lookalike table from actual
    // exam forms). When submitted sims exist we blend 50/50 toward the latest
    // sim's own scaledEst, which is derived from real exam-form scoring.
    var scaled = 200 + readiness * 790;
    var blended = false, latest = null;
    var sims = s.exams.filter(function (x) { return x.submittedAt && typeof x.scaledEst === 'number'; });
    if (sims.length) {
      sims.sort(function (a, b) { return a.submittedAt < b.submittedAt ? -1 : 1; });
      var last = sims[sims.length - 1];
      latest = last.scaledEst;
      if (PGRE.examEngine && typeof PGRE.examEngine.scaleDisplay === 'function') {
        var shown = PGRE.examEngine.scaleDisplay(last);
        if (shown && typeof shown.scaled === 'number') latest = shown.scaled;
      }
      scaled = (scaled + latest) / 2;
      blended = true;
    }
    scaled = Math.max(200, Math.min(990, Math.round(scaled / 10) * 10));

    return { readiness: readiness, scaled: scaled, blended: blended,
             blind: blind, coverage: coverage, touched: touched,
             poolLen: pool.length, hasAny: s.attempts.length > 0 };
  }

  function readinessCard() {
    var d = readinessData();
    var head = '<div class="dash-head"><h2>Exam readiness</h2>' +
      '<span class="dash-est-chip">Estimate</span></div>';

    if (!d.hasAny) {
      return '<div class="card dash-readiness-card">' + head +
        '<p class="muted">Answer a handful of questions and this fills with a readiness ' +
        'gauge and a projected score. Nothing to go on yet.</p>' +
        '<a class="btn btn-ghost" href="#/practice/all">Start practicing →</a></div>';
    }

    var pct = Math.round(100 * d.readiness);
    var tiles = '<div class="dash-tiles">' +
      PGRE.ui.statTile('Readiness', pct + '<span class="stat-unit">%</span>') +
      PGRE.ui.statTile('Projected score', '~' + d.scaled,
        d.blended ? 'blended 50/50 with your latest sim' : 'from accuracy + coverage') +
      '</div>';

    var blind = '<div class="dash-blind"><span class="dash-blind-label">Blind spots</span> ' +
      d.blind.map(function (t) {
        return '<a class="dash-chip" href="#/topic/' + t.id + '" title="' + PGRE.ui.esc(t.name) + '">' +
          PGRE.ui.esc(t.short) + '</a>';
      }).join(' ') + '</div>';

    return '<div class="card dash-readiness-card">' + head + tiles +
      PGRE.ui.meter(pct, 'meter-thin', {
        word: 'ready', meta: d.touched + ' of ' + d.poolLen + ' touched'
      }) +
      '<p class="muted dash-caption">Rough gauge — 70% last-30-day weight-adjusted accuracy, ' +
      '30% bank coverage (' + d.touched + ' of ' + d.poolLen + ' touched). Trust a full timed sim more.</p>' +
      blind +
      '<a class="btn btn-ghost" href="#/exam">Run a full sim →</a></div>';
  }

  /* ————————————————————————————————————————————————————————————
     Intensity card. PGRE.intensity.compute() gives the five readings
     (three banded) and PGRE.intensity.review() their words, their order and the
     next action (js/intensity.js holds both, with the definitions and the
     thresholds). Top to bottom: one headline with one button; the five
     readings, each a button that opens how the number is computed, its
     band limits and what moves it; the last 7 days with every number
     printed; then the topic to work on, with the 14-day table behind a
     disclosure. A band is a word and a shape as well as a colour. Actions
     are plain links into the practice mode that moves the reading.
     ———————————————————————————————————————————————————————————— */
  var INTENSITY_SEEN_KEY = 'pgre-intensity-seen';   // sessionStorage: the readings this tab last showed
  var DASH_FOCUS_KEY = 'pgre-dash-focus';           // sessionStorage: '<card id>|<click time>' to land on after routing home
  var DASH_FOCUS_MS = 5000;                         // a note older than this is from a click that never arrived
  var intensitySig = null;                          // what the card on screen was built from
  var intensityLast = null;                         // render()'s build, handed to mount()
  var intensityBound = false;                       // the delegated listeners are installed once

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  /* The facts review() cannot read from a readout: whether anything was
     ever answered and what is still untried. "Tried" is any attempt row. */
  function intensityContext() {
    var s = PGRE.store.state;
    var rows = Array.isArray(s.attempts) ? s.attempts : [];
    var tried = Object.create(null);
    var any = false;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].qid) { tried[rows[i].qid] = true; any = true; }
    }
    var pool = typeof PGRE.allQuestions === 'function' ? PGRE.allQuestions() : [];
    var unseen = 0, byTopic = {};
    pool.forEach(function (q) {
      if (!q || !q.id || tried[q.id]) return;
      unseen++;
      byTopic[q.topic] = (byTopic[q.topic] || 0) + 1;
    });
    return {
      hasHistory: any,
      unseen: pool.length ? unseen : null,          // an empty pool is "not loaded", not "all tried"
      unseenByTopic: pool.length ? byTopic : null
    };
  }

  /* The readings this tab showed last, for "+11" beside a value after a
     practice set. Session-only and per tab; never part of the saved state. */
  function intensitySeen(date) {
    try {
      var seen = JSON.parse(sessionStorage.getItem(INTENSITY_SEEN_KEY) || 'null');
      return seen && seen.date === date && seen.v && seen.m ? seen : null;
    } catch (e) { return null; }
  }

  function intensityRemember(d, r) {
    var v = {}, m = {};
    r.rows.forEach(function (row) { v[row.key] = d[row.key].value; m[row.key] = row.meter.pct; });
    try { sessionStorage.setItem(INTENSITY_SEEN_KEY, JSON.stringify({ date: d.date, v: v, m: m })); }
    catch (e) { /* storage blocked: no deltas, nothing else changes */ }
  }

  /* "+11", "−6 s": the change in a reading since this tab last showed it. */
  function intensityDelta(key, now, before) {
    if (typeof now !== 'number' || typeof before !== 'number') return '';
    var diff = Math.round((now - before) * 10) / 10;
    if (!diff) return '';
    var unit = key === 'paceSec' ? ' s' : key === 'firstAttemptAccuracy' ? ' points'
      : key === 'repeatMinutes' ? ' min' : '';
    return (diff > 0 ? '+' : '−') + Math.abs(diff) + unit;
  }

  function intensityAction(a, cls) {
    if (!a || !a.href) return '';
    return '<a class="btn ' + cls + '" href="' + PGRE.ui.esc(a.href) + '">' + PGRE.ui.esc(a.label) + ' →</a>';
  }

  /* Neutral fill against a tick at the target. Where less is better (pace,
     repeat time) the track past the tick is hatched: that stretch is over
     the limit. `from` starts the fill at the width this tab showed before,
     so mount can run it to the new one. */
  function intensityMeter(m, from) {
    var start = (typeof from === 'number' && from !== m.pct) ? from : null;
    return '<span class="imeter' + (m.empty ? ' imeter-empty' : '') +
        (m.lowIsGood && m.mark != null ? ' imeter-limit" style="--imeter-mark:' + m.mark + '%' : '') +
        '" aria-hidden="true">' +
      '<span class="imeter-fill" style="width:' + (start == null ? m.pct : start) + '%"' +
        (start == null ? '' : ' data-to="' + m.pct + '"') + '></span>' +
      (m.mark == null ? '' : '<span class="imeter-mark" style="left:' + m.mark + '%"></span>') +
    '</span>';
  }

  /* One reading: a button (name, meter, value against its target in words,
     band chip) that opens the panel under it; a hint with its own link
     when the reading needs attention and the headline has not said it.
     preview = the new-user list: targets only, no value and no judgement. */
  function intensityRowHTML(r, o) {
    var ui = PGRE.ui, I = PGRE.intensity;
    var panelId = 'intensity-more-' + r.key;
    var open = !!(o.open && o.open[r.key]);
    var seen = o.seen;
    var delta = seen ? intensityDelta(r.key, o.d[r.key].value, seen.v[r.key]) : '';
    // The limit the row is shown in; none when it is shown without a judgement.
    var cuts = r.cuts.map(function (c) {
      return '<li' + (!o.preview && c.band === r.show ? ' class="is-now"' : '') + '>' + I.chipHTML(c.band) +
        '<span>' + ui.esc(c.text) + '</span></li>';
    }).join('');
    var links = r.links.map(function (a) { return intensityAction(a, 'btn-ghost btn-sm'); }).join('');
    var head = '<span class="intensity-name"><span class="intensity-label">' + ui.esc(r.label) + '</span>' +
      '<span class="intensity-window">' + ui.esc(r.window) + '</span></span>';
    if (o.preview) {
      head += '<span class="intensity-preview">' + ui.esc(r.preview) + '</span>';
    } else {
      head += intensityMeter(r.meter, seen ? seen.m[r.key] : null) +
        '<span class="intensity-read">' +
          (delta ? '<span class="intensity-delta">' + delta + '<span class="ivh"> since your last look,</span></span>' : '') +
          '<span class="intensity-value"><strong>' + ui.esc(r.value + r.unit) + '</strong> ' +
            '<span class="intensity-target">' + ui.esc(r.target) + '</span></span></span>' +
        I.chipHTML(r.show, r.chip);
    }
    return '<li class="intensity-row' + (o.preview ? ' is-preview' : '') + '" data-metric="' + r.key +
        '" data-band="' + (r.band || 'none') + '" data-show="' + r.show + '">' +
      '<button type="button" class="intensity-toggle" aria-expanded="' + open + '" aria-controls="' + panelId + '">' +
        head + '<span class="intensity-chev" aria-hidden="true"></span></button>' +
      // The leading reading's hint is the headline block above the list.
      (!o.preview && r.hint && !r.lead
        ? '<div class="intensity-next"><p class="intensity-hint">' + ui.esc(r.hint) + '</p>' +
            intensityAction(r.action, 'btn-ghost btn-sm') + '</div>'
        : '') +
      '<div class="intensity-more" id="' + panelId + '"' + (open ? '' : ' hidden') + '>' +
        r.how.map(function (line) { return '<p>' + ui.esc(line) + '</p>'; }).join('') +
        (cuts ? '<ul class="intensity-cuts" aria-label="Band limits">' + cuts + '</ul>' : '') +
        (links ? '<div class="intensity-links">' + links + '</div>' : '') +
      '</div>' +
    '</li>';
  }

  /* Headline, the other readings that need attention, and the one button. */
  function intensityVerdictHTML(v) {
    var ui = PGRE.ui;
    var mark = (v.mark === 'green' || v.mark === 'amber' || v.mark === 'red') ? v.mark : 'none';
    return '<div class="intensity-verdict" data-tone="' + v.tone + '" data-mark="' + mark + '"' +
        (v.focus ? ' data-focus="' + v.focus + '"' : '') + '>' +
      '<div class="intensity-verdict-copy">' +
        '<p class="intensity-headline"><span class="band-dot band-' + mark + '" aria-hidden="true"></span>' +
          '<span id="intensity-headline">' + ui.esc(v.headline) + '</span></p>' +
        (v.detail ? '<p class="intensity-detail">' + ui.esc(v.detail) + '</p>' : '') +
      '</div>' +
      intensityAction(v.action, v.tone === 'attention' || v.tone === 'empty' ? 'btn-primary' : 'btn-ghost') +
    '</div>';
  }

  /* "2 on target · 1 close · 2 without a target", each with its band
     shape. The five readings always add up: one shown without a target
     (New questions, Repeat time, Daily work after its last target day) is
     counted as that. */
  function intensityTallyHTML(tally) {
    var I = PGRE.intensity;
    var parts = [['green', I.LABELS.green], ['amber', I.LABELS.amber], ['red', I.LABELS.red],
                 ['none', 'No data'], ['rest', 'Without a target']]
      .filter(function (p) { return tally[p[0]]; })
      .map(function (p) {
        return '<span class="intensity-tally-item" data-band="' + p[0] + '">' +
          '<span class="band-dot band-' + (p[0] === 'rest' ? 'none' : p[0]) + '" aria-hidden="true"></span>' +
          tally[p[0]] + ' ' + p[1].toLowerCase() + '</span>';
      });
    return '<p class="intensity-tally">' + parts.join('') + '</p>';
  }

  /* Last N days of Daily work in one strip (N: 7, 30 or a custom 2-90,
     kept in settings.intensityTrendDays): the count of mistake-book
     retakes over its bar, the weekday, then the day's band shape with
     "mock" on a day a full mock was submitted. Scale: the larger of 1.25 x
     the target and the tallest bar, so the dashed target line always sits
     inside. A day after the last target day with nothing answered reads
     "no target", not as a missed day. Every value is printed and each day
     carries one sentence for screen readers, so nothing needs hover. Past
     7 days a column shows the day of the month, drops the foot word, and
     the strip scrolls sideways when it runs out of width. */
  function intensityWeekHTML(r, T) {
    var ui = PGRE.ui, LABELS = PGRE.intensity.LABELS;
    var target = T.dailyWork.green;
    var max = target * 1.25;
    r.days.forEach(function (day) { if (day.retakes > max) max = day.retakes; });
    var markPct = (100 * target / max).toFixed(1);
    var nDays = r.days.length;
    var long = nDays > 7;
    var cells = r.days.map(function (day) {
      var n = day.retakes;
      var rest = day.target == null;
      var idle = rest && n === 0 && !day.mocks;
      var h = n > 0 ? Math.max(4, Math.round(100 * n / max)) : 0;
      var foot = day.mocks ? 'mock' : (idle ? 'no target' : '');
      var say = day.full + ': ' + plural(n, 'mistake-book question') +
        (day.mocks ? ', full mock submitted' : '') +
        (day.workBand ? ' (' + LABELS[day.workBand].toLowerCase() + ')' : (rest ? ', no target' : '')) + '.';
      return '<li class="iweek-day' + (day.isToday ? ' is-today' : '') + (rest ? ' is-rest' : '') +
          (idle ? ' is-idle' : '') + (n ? '' : ' is-empty') + '" data-day="' + day.date + '" data-retakes="' + n +
          '" data-mocks="' + day.mocks + '" data-band="' + (day.workBand || 'none') +
          '" data-tip="' + ui.esc(say.replace(': ', '\\n')) + '">' +
        '<span class="iweek-n" aria-hidden="true">' + (idle ? '—' : n) + '</span>' +
        '<span class="iweek-plot" aria-hidden="true"><span class="iweek-mark" style="bottom:' + markPct + '%"></span>' +
          '<span class="iweek-bar" style="height:' + h + '%"></span></span>' +
        '<span class="iweek-wd" aria-hidden="true">' +
          (long ? +day.date.slice(8) : day.isToday ? 'Today' : ui.esc(day.short)) + '</span>' +
        '<span class="iweek-pace" aria-hidden="true">' +
          (day.workBand ? '<span class="band-dot band-' + day.workBand + '"></span>' : '') +
          (foot ? '<span class="iweek-foot">' + foot + '</span>' : '') + '</span>' +
        '<span class="ivh">' + ui.esc(say) + '</span>' +
      '</li>';
    }).join('');
    var custom = nDays !== 7 && nDays !== 30;
    function preset(n) {
      return '<button type="button" class="iweek-range-btn" id="iweek-range-' + n + '" data-trend-days="' + n +
        '" aria-pressed="' + (nDays === n) + '">' + n + ' days</button>';
    }
    var range = '<span class="iweek-range" role="group" aria-label="Days shown">' + preset(7) + preset(30) +
      '<label class="iweek-range-custom' + (custom ? ' is-on' : '') + '">Custom ' +
        '<input type="number" id="iweek-range-custom" inputmode="numeric" min="' + T.trendDaysMin +
          '" max="' + T.trendDaysMax + '" step="1" placeholder="' + T.trendDaysMin + '–' + T.trendDaysMax +
          '" value="' + (custom ? nDays : '') + '" aria-label="Custom number of days, ' + T.trendDaysMin +
          ' to ' + T.trendDaysMax + '"></label></span>';
    var span = long ? ' <span class="iweek-span">' + ui.esc(r.days[0].full.replace(/^\w+, /, '')) + ' – today</span>' : '';
    return '<figure class="iweek' + (long ? ' is-long' : '') + '" id="intensity-week">' +
      '<figcaption class="iweek-cap"><span class="iweek-title"><strong>Last ' + nDays + ' days</strong>' + span +
          range + '</span>' +
        '<span><span class="itrend-key" aria-hidden="true"></span>target ' + target +
          ' mistake-book questions, or a full mock</span></figcaption>' +
      '<ol class="iweek-days" style="--iweek-n:' + nDays + '">' + cells + '</ol>' +
    '</figure>';
  }

  /* "Where to adjust": the first judged topic that is not on target, with a
     link into its untried questions; the full 14-day table opens below
     (settings.intensityTopicsOpen keeps the choice). */
  function intensityTopicsHTML(d, r, tableOpen) {
    var ui = PGRE.ui, I = PGRE.intensity, T = I.THRESHOLDS;
    var focus;
    if (r.topic) {
      focus = '<p class="intensity-focus-line"><a href="#/topic/' + ui.esc(r.topic.topic) + '">' +
          ui.esc(r.topic.name) + '</a> ' + I.chipHTML(r.topic.band) + '</p>' +
        '<p class="intensity-detail">' + ui.esc(r.topic.text) + '</p>';
    } else {
      focus = '<p class="intensity-detail">' + (r.judgedTopics
        ? 'Every topic with ' + T.topicMinNew + ' or more new questions in the last ' + T.topicDays +
          ' days is on target.'
        : 'No topic has ' + T.topicMinNew + ' new questions in the last ' + T.topicDays +
          ' days yet, so none has a band.') + '</p>';
    }
    var rows = d.topics.map(function (t) {
      var acc = t.judged ? t.accuracy + '%' : '—';
      var bandCell = t.judged ? I.chipHTML(t.band) : '<span class="itopic-few">too few to judge</span>';
      return '<tr data-topic="' + ui.esc(t.topic) + '" data-band="' + (t.band || 'none') + '">' +
        '<td><a href="#/topic/' + ui.esc(t.topic) + '">' + ui.esc(t.name) + '</a>' +
          // phone layout: weight and band move under the name (css/style.css)
          '<span class="itopic-sub">' + t.weight + '% of the exam</span>' +
          '<span class="itopic-sub itopic-sub-band">' + bandCell + '</span></td>' +
        '<td class="num col-weight">' + t.weight + '%</td>' +
        '<td class="num">' + t.newQuestions + '</td>' +
        '<td class="num">' + acc + '</td>' +
        '<td class="itopic-band">' + bandCell + '</td></tr>';
    }).join('');
    return '<div class="intensity-adjust" id="intensity-adjust">' +
      '<div class="intensity-focus"><div class="intensity-focus-copy"><h3>Where to adjust</h3>' + focus + '</div>' +
        (r.topic ? intensityAction(r.topic.action, 'btn-ghost btn-sm') : '') + '</div>' +
      '<details class="intensity-topics" id="intensity-topics"' + (tableOpen ? ' open' : '') + '>' +
        '<summary>All ' + d.topics.length + ' topics, last ' + T.topicDays + ' days</summary>' +
        '<p class="muted">New questions per topic and their first-try accuracy. ' +
          'The top row is the topic where better accuracy is worth the most exam points ' +
          '(exam weight times the gap to ' + Math.round(100 * T.topicTargetAcc) + '%). ' +
          'A topic needs ' + T.topicMinNew + ' new questions before it gets a band.</p>' +
        '<div class="intensity-table-wrap"><table class="intensity-table">' +
          '<thead><tr><th scope="col">Topic</th><th scope="col" class="num col-weight">Weight</th>' +
            '<th scope="col" class="num">New, ' + T.topicDays + ' days</th><th scope="col" class="num">Accuracy</th>' +
            '<th scope="col">Band</th></tr></thead>' +
          '<tbody>' + rows + '</tbody></table></div>' +
      '</details>' +
    '</div>';
  }

  /* The card's inner HTML and the string it was built from. o.open keeps
     opened readings open across an in-place refresh. */
  function intensityBuild(o) {
    var I = PGRE.intensity;
    if (!I || typeof I.compute !== 'function' || typeof I.review !== 'function') return null;
    o = o || {};
    var s = PGRE.store.state;
    var d = I.compute(s, { trendDays: s.settings && s.settings.intensityTrendDays });
    var ctx = intensityContext();
    var r = I.review(d, ctx);
    var seen = intensitySeen(d.date);
    var tableOpen = !!(s.settings && s.settings.intensityTopicsOpen);
    var rowOpts = { d: d, open: o.open, seen: seen, preview: r.empty };
    var rows = r.rows.map(function (row) { return intensityRowHTML(row, rowOpts); }).join('');
    var dateLine = new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'short', day: 'numeric'
    });
    var html = '<div class="band-head"><div class="band-head-copy">' +
        '<p class="kicker">' + PGRE.ui.esc(dateLine) + '</p>' +
        '<h2 id="intensity-title" tabindex="-1">Intensity</h2></div>' +
        (r.empty ? '' : intensityTallyHTML(r.tally)) + '</div>' +
      intensityVerdictHTML(r.verdict) +
      '<ul class="intensity-rows" aria-label="' + (r.empty ? 'The five readings and their targets' : 'The five readings') + '">' +
        rows + '</ul>' +
      (r.empty ? '' : intensityWeekHTML(r, I.THRESHOLDS) + intensityTopicsHTML(d, r, tableOpen));
    // Everything the readings depend on. Which readings are open and whether
    // the topic table is open are the reader's choices, not part of it.
    var sig = JSON.stringify([d, ctx.unseen, ctx.hasHistory]);
    return { html: html, sig: sig, d: d, r: r, empty: r.empty };
  }

  function intensityCardHTML() {
    var built = intensityBuild();
    intensityLast = built;
    if (!built) return '';
    intensitySig = built.sig;
    return '<section class="card intensity-card' + (built.empty ? ' is-empty' : '') + '" id="intensity-card"' +
      ' aria-labelledby="intensity-title">' + built.html + '</section>';
  }

  /* After the card is in the page: run each meter from the width this tab
     showed before to the new one, then remember what is on screen now. */
  function intensitySettle(built) {
    var card = document.getElementById('intensity-card');
    if (!card || !built) return;
    var fills = card.querySelectorAll('.imeter-fill[data-to]');
    var run = function () {
      Array.prototype.forEach.call(fills, function (f) { f.style.width = f.getAttribute('data-to') + '%'; });
    };
    if (fills.length) {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function () { requestAnimationFrame(run); });
      else run();
    }
    // A long strip that scrolls opens on today.
    var strip = card.querySelector('.iweek.is-long .iweek-days');
    if (strip) strip.scrollLeft = strip.scrollWidth;
    intensityRemember(built.d, built.r);
  }

  /* Days shown in the strip: a preset button or the custom field. An entry
     outside 2-90, or the length already shown, puts the field back. */
  function intensitySetTrendDays(n) {
    var settings = PGRE.store.state.settings;
    if (!settings) return;
    var I = PGRE.intensity;
    var days = I.trendDays(n);
    var current = I.trendDays(settings.intensityTrendDays);
    if (days === n && days !== current) {
      settings.intensityTrendDays = days;
      PGRE.store.save();
      intensityRefresh();
      return;
    }
    var input = document.getElementById('iweek-range-custom');
    if (input) input.value = current === 7 || current === 30 ? '' : current;
  }

  /* Where keyboard focus sits in the card, in terms that outlive a rebuild:
     an id, or the part of the card plus the kind of control and its link. */
  function intensityFocusPlace(card, el) {
    if (!el || el === card || !card.contains(el)) return null;
    var row = el.closest('.intensity-row');
    return {
      id: el.id || '',
      scope: row ? '.intensity-row[data-metric="' + row.getAttribute('data-metric') + '"]'
        : el.closest('.intensity-verdict') ? '.intensity-verdict'
        : el.closest('.intensity-adjust') ? '.intensity-adjust' : '',
      tag: el.tagName,
      href: el.getAttribute('href')
    };
  }

  /* Back to the same control; failing that, to its neighbour of the same
     kind, its reading's button, or the card's heading, so focus never drops
     out of the card. */
  function intensityRefocus(card, place) {
    if (!place) return;
    var el = place.id ? document.getElementById(place.id) : null;
    if (!el) {
      var scope = place.scope ? card.querySelector(place.scope) : card;
      var kin = scope ? Array.prototype.filter.call(scope.querySelectorAll(place.tag), function (c) {
        return !c.closest('[hidden]');
      }) : [];
      el = kin.filter(function (c) { return c.getAttribute('href') === place.href; })[0] || kin[0] ||
        (scope && scope.querySelector('.intensity-toggle')) || document.getElementById('intensity-title');
    }
    if (el && typeof el.focus === 'function') el.focus({ preventScroll: true });
  }

  /* Rebuild the card where it stands when the answers changed under it (a
     sibling tab recorded a set, or the tab was left open past midnight).
     Opened readings stay open and keyboard focus stays on its control. */
  function intensityRefresh() {
    var card = document.getElementById('intensity-card');
    if (!card) return;
    var open = {};
    Array.prototype.forEach.call(card.querySelectorAll('.intensity-toggle[aria-expanded="true"]'), function (b) {
      var row = b.closest('.intensity-row');
      if (row) open[row.getAttribute('data-metric')] = true;
    });
    var built = intensityBuild({ open: open });
    if (!built || built.sig === intensitySig) return;
    var place = intensityFocusPlace(card, document.activeElement);
    intensitySig = built.sig;
    card.innerHTML = built.html;
    card.classList.toggle('is-empty', built.empty);
    intensityRefocus(card, place);
    intensitySettle(built);
  }

  /* One reading open or shut. The panel is a sibling of the button, so the
     hint and its link stay between them. */
  function intensityToggle(btn) {
    var panel = document.getElementById(btn.getAttribute('aria-controls'));
    if (!panel) return;
    var open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    panel.hidden = !open;
  }

  function bindIntensity() {
    if (intensityBound) return;
    intensityBound = true;
    // A test sandbox may offer a document or a window without events.
    if (typeof document.addEventListener !== 'function') return;
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('#intensity-card .intensity-toggle') : null;
      if (btn) intensityToggle(btn);
      var range = e.target && e.target.closest ? e.target.closest('#intensity-card [data-trend-days]') : null;
      if (range) intensitySetTrendDays(+range.getAttribute('data-trend-days'));
    });
    document.addEventListener('change', function (e) {
      if (e.target && e.target.id === 'iweek-range-custom') intensitySetTrendDays(e.target.valueAsNumber);
    });
    // <details> toggle does not bubble: capture it.
    document.addEventListener('toggle', function (e) {
      var t = e.target;
      if (!t || t.id !== 'intensity-topics') return;
      var settings = PGRE.store.state.settings;
      if (!settings || !!settings.intensityTopicsOpen === !!t.open) return;
      settings.intensityTopicsOpen = !!t.open;
      PGRE.store.save();
    }, true);
    // Coming back to a tab that stayed open: by tab switch, by window focus
    // (a window that was never hidden), or from the back/forward cache.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') intensityRefresh();
    });
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('focus', intensityRefresh);
      window.addEventListener('pageshow', function (e) { if (e.persisted) intensityRefresh(); });
    }
    if (typeof PGRE.subscribeStateAdopted === 'function') PGRE.subscribeStateAdopted(intensityRefresh);
  }

  /* A link that carries data-dash-focus="<card id>" (the practice summary's
     "Intensity on the dashboard") lands on that card, not on the top of the
     page: the click leaves a one-shot note that the next mount reads. */
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('click', function (e) {
      var link = e.target && e.target.closest ? e.target.closest('a[data-dash-focus]') : null;
      if (!link) return;
      try { sessionStorage.setItem(DASH_FOCUS_KEY, link.getAttribute('data-dash-focus') + '|' + Date.now()); }
      catch (err) { /* lands on top */ }
    });
  }

  function landOnRequestedCard() {
    var note = null;
    try {
      note = sessionStorage.getItem(DASH_FOCUS_KEY);
      if (note) sessionStorage.removeItem(DASH_FOCUS_KEY);
    } catch (e) { note = null; }
    var parts = String(note || '').split('|');
    var id = parts[0];
    var age = Date.now() - Number(parts[1]);
    if (id !== 'intensity-card' || !(age >= 0 && age <= DASH_FOCUS_MS)) return;
    // After the router's own scroll-to-top, which follows mount().
    setTimeout(function () {
      var card = document.getElementById(id);
      var title = document.getElementById('intensity-title');
      if (!card) return;
      card.scrollIntoView({ block: 'start' });
      if (title) title.focus({ preventScroll: true });
    }, 0);
  }

  /* ———————————————————————————————————————————————————————————— */


  /* Next unused intact ETS form. Never GR8677/GR9277 as a fresh test.
     A sitting counts as sat only when submittedAt is set (in-progress
     and weighted rows stay unsat).
     Keep the scheduled date with the pointer so the lobby can protect a
     future diagnostic from an accidental early click. When that first
     unsat form has no plan date, or its plan date is already before
     today, jump to the next unsat plan mock on or after today; if none
     remain, keep the first unsat form so a past diagnostic stays the
     lobby's "next mock". */
  function mockScheduleDate(id) {
    var plan = PGRE.PLAN || [];
    for (var pi = 0; pi < plan.length; pi++) {
      var weeks = plan[pi] && plan[pi].weeks || [];
      for (var wi = 0; wi < weeks.length; wi++) {
        var mocks = weeks[wi] && weeks[wi].mocks || [];
        for (var mi = 0; mi < mocks.length; mi++) {
          if (mocks[mi] && String(mocks[mi].id).toLowerCase() === String(id).toLowerCase()) {
            return mocks[mi].date || null;
          }
        }
      }
    }
    return null;
  }

  function mockTodayIso() {
    if (PGRE.store && typeof PGRE.store.today === 'function') return PGRE.store.today();
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function nextMockPointer() {
    var sat = {};
    (PGRE.store.state.exams || []).forEach(function (x) {
      /* Recorded sitting source only — never infer from format or length.
         submittedAt must be set; an in-progress row does not skip the form. */
      if (!x || !x.submittedAt || !x.source || x.source === 'weighted') return;
      sat[String(x.source).toLowerCase()] = true;
    });
    var skip = { gr8677: 1, gr9277: 1 };
    function catalogEntry(id) {
      var list = PGRE.ETS_EXAMS || [];
      var want = String(id).toLowerCase();
      for (var i = 0; i < list.length; i++) {
        if (list[i] && String(list[i].id).toLowerCase() === want) return list[i];
      }
      return null;
    }
    function catalogTitle(id, fallback) {
      var ex = catalogEntry(id);
      return (ex && ex.title) || fallback;
    }
    function catalogId(id) {
      var ex = catalogEntry(id);
      return (ex && ex.id) || id;
    }
    function firstUnsat() {
      // Plan order first: the earliest-dated unsat plan mock, past or not.
      var planFirst = upcomingPlanMock('');
      if (planFirst) return planFirst;
      var list = PGRE.ETS_EXAMS || [];
      for (var i = 0; i < list.length; i++) {
        var ex = list[i];
        if (!ex || !ex.id) continue;
        var id = String(ex.id).toLowerCase();
        if (skip[id] || sat[id]) continue;
        return { id: ex.id, title: ex.title || ex.id, scheduledFor: mockScheduleDate(ex.id) };
      }
      return null;
    }
    function upcomingPlanMock(today) {
      var plan = PGRE.PLAN || [];
      var best = null;
      for (var pi = 0; pi < plan.length; pi++) {
        var weeks = plan[pi] && plan[pi].weeks || [];
        for (var wi = 0; wi < weeks.length; wi++) {
          var mocks = weeks[wi] && weeks[wi].mocks || [];
          for (var mi = 0; mi < mocks.length; mi++) {
            var m = mocks[mi];
            if (!m || !m.id || !m.date) continue;
            var id = String(m.id).toLowerCase();
            if (skip[id] || sat[id]) continue;
            if (m.date < today) continue;
            if (!best || m.date < best.date) best = m;
          }
        }
      }
      if (!best) return null;
      return {
        id: catalogId(best.id),
        title: catalogTitle(best.id, best.id),
        scheduledFor: best.date
      };
    }
    var first = firstUnsat();
    if (!first) return null;
    var today = mockTodayIso();
    if (!first.scheduledFor || first.scheduledFor < today) {
      var upcoming = upcomingPlanMock(today);
      if (upcoming) return upcoming;
    }
    return first;
  }
  PGRE.nextMockPointer = nextMockPointer;


  /* One "today" decision surface: the next move (mixed practice) on its own
     row, then three equal tiles for the SRS dues (mistakes, recall) and the
     next intact mock. Each tile reads label, status line, detail, action. */
  function todayAgendaHTML() {
    var ui = PGRE.ui;
    var s = PGRE.store.state;
    var mock = nextMockPointer();
    var dueM = PGRE.srs.dueMistakes().length;
    var openM = PGRE.srs.openMistakes ? PGRE.srs.openMistakes() : [];
    var stuckM = openM.filter(function (e) { return e.mk && e.mk.stuck; }).length;
    var mixedCount = Math.min(10, PGRE.allQuestions().length);
    var mixedCopy = mixedCount
      ? mixedCount + ' question' + (mixedCount === 1 ? '' : 's') + ' from the daily pool · about ' + Math.max(2, mixedCount * 2) + ' min'
      : 'The daily pool is waiting for questions';
    var mixedLabel = mixedCount ? 'Start ' + mixedCount + ' →' : 'Open practice →';
    var hour = new Date().getHours();
    var greet = hour < 5 ? 'Burning the midnight oil' :
                hour < 12 ? 'Good morning' :
                hour < 18 ? 'Good afternoon' : 'Good evening';
    // Life Studio: the exam is sat — the countdown and prep runway moved to
    // the Study plan page (More group); the dashboard hero keeps the greeting.
    var dateLine = new Date().toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric'
    });
    var streak = PGRE.store.liveStreak ? PGRE.store.liveStreak() : 0;
    var lead = streak
      ? streak + '-day streak. One focused set keeps it moving.'
      : 'One focused set starts a streak.';
    var mistakeDetail = openM.length
      ? openM.length + ' open' + (stuckM ? ' · ' + stuckM + ' keep failing' : '')
      : 'Missed questions land here for spaced retakes.';
    var html = '<div class="card review-queue today-agenda-shell" id="today-agenda">' +
      '<div class="hero">' +
        '<div class="hero-left">' +
          '<p class="today-kicker">' + ui.esc(dateLine) + '</p>' +
          '<h1 class="today-greet">' + ui.esc(greet) + '.</h1>' +
          '<p class="today-lead">' + ui.esc(lead) + '</p>' +
        '</div>' +
      '</div>' +
      '<div class="rq-rows">' +
      '<div class="rq-row rq-primary"><div class="rq-row-copy"><span class="rq-kicker">Next up</span>' +
        '<span class="rq-label">Mixed practice</span>' +
        '<span class="rq-count">' + ui.esc(mixedCopy) + '</span></div>' +
        '<a class="btn btn-primary" href="#/practice/all">' + ui.esc(mixedLabel) + '</a></div>' +
      '<div class="rq-row rq-tile"><div class="rq-row-copy"><span class="rq-kicker">Mistake book</span>' +
        '<span class="rq-label rq-status">' + (dueM ? dueM + ' due now' : 'Nothing due') + '</span>' +
        '<span class="rq-count">' + ui.esc(mistakeDetail) + '</span></div>' +
        '<a class="btn ' + (dueM ? 'btn-primary' : 'btn-ghost') + ' btn-sm" href="#/mistakes">' +
          (dueM ? 'Drill →' : 'Open →') + '</a></div>' +
      '<div class="rq-row rq-tile"><div class="rq-row-copy"><span class="rq-kicker">Recall review</span>' +
        '<span class="rq-label rq-status" id="today-formulas">…</span>' +
        '<p class="rq-count" id="formula-readiness" hidden></p></div>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="today-formulas-btn">Study →</button></div>';
    if (mock) {
      var todayIso = mockTodayIso();
      var mockWhen = (mock.scheduledFor && mock.scheduledFor >= todayIso)
        ? 'Scheduled ' + new Date(mock.scheduledFor + 'T12:00:00').toLocaleDateString('en-US', {
          month: 'short', day: 'numeric'
        })
        : 'Next intact form';
      html += '<div class="rq-row rq-tile"><div class="rq-row-copy"><span class="rq-kicker">Mock exam</span>' +
        '<span class="rq-label rq-status">' + ui.esc(mockWhen) + '</span>' +
        '<span class="rq-count">' + ui.esc(mock.title) + '</span></div>' +
        '<a class="btn btn-ghost btn-sm" href="#/exam">Open →</a></div>';
    } else {
      html += '<div class="rq-row rq-tile"><div class="rq-row-copy"><span class="rq-kicker">Mock exam</span>' +
        '<span class="rq-label rq-status">Every form sat</span>' +
        '<span class="rq-count">Review past sittings or run a weighted draw.</span></div>' +
        '<a class="btn btn-ghost btn-sm" href="#/exam">Open →</a></div>';
    }
    html += '</div></div>';
    return html;
  }

  function formulaStatus(deck) {
    var srs = PGRE.srs;
    var T = srs.clampTarget(PGRE.store.state.settings &&
      PGRE.store.state.settings.formulaDailyTarget);
    if (!deck.length) {
      return { text: 'deck empty — awaits the book', remaining: 0,
        unlearned: 0, picked: 0, target: T };
    }
    var remaining = srs.formulaDayRemaining(deck).length;
    var batch = srs.formulaDay(deck);
    var picked = batch.reviewIds.length + batch.newIds.length;
    var unlearned = srs.newInDeck(deck).length;
    var postponed = srs.formulaDayPostponed(deck);
    // The auto-pick (due first, then new in book order). Once today's list
    // is done, only due work is offered here; more new cards are an explicit
    // "Study more" on Formula recall.
    var fillOpts = picked ? { fresh: false } : null;
    var pick = remaining ? { reviewIds: [], newIds: [] } : srs.suggestFormulaDay(deck, fillOpts);
    var dueN = pick.reviewIds.length, newN = pick.newIds.length;
    var fill = dueN + newN > 0;
    var text;
    if (remaining) {
      text = remaining + ' left today';
      if (postponed) text += ' · ' + postponed + ' due not picked';
    }
    else if (dueN) {
      text = postponed > dueN ? postponed + ' due now · study ' + dueN : dueN + ' due now';
      if (newN) text += ' · +' + newN + ' new';
    }
    else if (picked) text = 'all caught up';
    else if (unlearned) text = unlearned + ' not yet introduced';
    else text = 'all introduced';
    return { text: text, remaining: remaining, unlearned: unlearned,
      picked: picked, postponed: postponed, fill: fill, fillOpts: fillOpts,
      dueN: dueN, newN: newN, target: T };
  }

  /* Names a partial read. Does not touch the daily batch. */
  function deckRecoveryNote(status) {
    if (!status || !status.partial) return '';
    var missing = [];
    var raw = status.missing || [];
    for (var i = 0; i < raw.length; i++) {
      if (raw[i]) missing.push(String(raw[i]));
    }
    var note = 'The deck read is incomplete';
    if (missing.length) note += ' (' + missing.join(', ') + ')';
    return note + ', so this count can be low.';
  }

  /* Read-only. Does not call suggestFormulaDay or autoFillFormulaDay, and
     does not add or remove daily ids. A partial read warns even when every
     loaded card has already been introduced. */
  function formulaReadinessLine(deck, status) {
    var srs = PGRE.srs;
    if (!srs) return '';
    var note = deckRecoveryNote(status);
    var unseen = 0;
    if (deck && deck.length) {
      deck.forEach(function (c) {
        if (c && !srs.cardState(c.id) && !srs.isSuspended(c.id)) unseen++;
      });
    }
    if (!unseen) return note;
    var settings = PGRE.store.state.settings || {};
    var exam = settings.examDate || '';
    var days = exam && srs.daysUntil ? srs.daysUntil(exam) : null;
    var examDays = (typeof days === 'number' && days > 0) ? days : 0;
    var target = srs.clampTarget(settings.formulaDailyTarget);
    var postponed = typeof srs.formulaDayPostponed === 'function' ? srs.formulaDayPostponed(deck) : 0;
    // Pieces are joined with ' · ' so the mount can drop the leading count
    // when the tile's status line already shows the same words.
    var line = unseen + ' not yet introduced · ' +
      examDays + ' day' + (examDays === 1 ? '' : 's') + ' to the exam · ' +
      target + ' a day · ' +
      postponed + ' due review' + (postponed === 1 ? '' : 's') + ' waiting. ' +
      'To cover more, add cards in Recall.';
    if (note) line += ' ' + note;
    return line;
  }

  function startFormulaFromToday(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    var todayBtn = document.getElementById('today-formulas-btn');
    if (todayBtn) todayBtn.disabled = true;
    PGRE.formulaDeck().then(function (deck) {
      // The click takes exactly the auto-pick the button promised.
      var st = formulaStatus(deck);
      if (st.fill) PGRE.srs.autoFillFormulaDay(deck, st.fillOpts);
      if (PGRE.views.formulas && PGRE.views.formulas.armStudyFromFill) {
        PGRE.views.formulas.armStudyFromFill();
      }
      location.hash = '#/formulas';
    }).catch(function () {
      location.hash = '#/formulas';
    });
  }

  function render() {
    var ui = PGRE.ui, g = PGRE.gamify, s = PGRE.store.state;
    var lvl = g.levelInfo(s.xp);

    var m = g.metrics();
    var accuracy = '—';
    var totalAttempts = 0, totalCorrect = 0;
    for (var id in s.questions) { totalAttempts += s.questions[id].attempts; totalCorrect += s.questions[id].correct; }
    if (totalAttempts > 0) accuracy = Math.round(100 * totalCorrect / totalAttempts) + '%';

    var html = (PGRE.sessionPark ? PGRE.sessionPark.reminderHTML() : '') + todayAgendaHTML();

    html += (PGRE.views.studytime && PGRE.views.studytime.activityTargetHTML)
      ? PGRE.views.studytime.activityTargetHTML()
      : '';

    html += intensityCardHTML();

    var cw = PGRE.currentWeek();
    var weekTasks = PGRE.weekTasks(cw.week);
    var doneCount = weekTasks.filter(function (t) { return g.taskDone(t.id); }).length;
    var nextTasks = weekTasks.filter(function (t) { return !g.taskDone(t.id); }).slice(0, 3);
    var firstLaunch = weekTasks.filter(function (t) {
      return (t.kind === 'timed' || t.kind === 'extra-set') && !g.taskDone(t.id);
    })[0];
    html += '<div class="card dash-week">' +
      '<div class="band-head"><div class="band-head-copy">' +
        '<p class="kicker">This week · ' + ui.dateRange(cw.week.start, cw.week.end) + ' · ~' + cw.week.hours + ' h</p>' +
        '<h2>' + ui.esc(cw.week.title) + '</h2></div>' +
        '<a class="btn btn-ghost btn-sm band-head-link" href="#/plan">Study plan →</a></div>' +
      ui.meter(100 * doneCount / Math.max(1, weekTasks.length), 'meter-thin', {
        word: 'complete', meta: doneCount + ' of ' + weekTasks.length + ' tasks'
      });
    if (nextTasks.length) {
      html += '<ul class="next-tasks">';
      nextTasks.forEach(function (t) {
        var launch = (firstLaunch && t.id === firstLaunch.id)
          ? ' <button class="btn btn-primary btn-sm" data-launch-set="' +
              ui.esc(String(t.id || '').replace(/^set-/, '')) + '">Start →</button>'
          : '';
        // "Set 11 · Induction … (n=8) — ~100 min": the time estimate becomes
        // its own quiet column so the task names line up.
        var label = String(t.label || '');
        var mins = label.match(/\s+—\s+(~?\d+\s*min)$/);
        if (mins) label = label.slice(0, mins.index);
        html += '<li><span class="next-task-label">' + ui.esc(label) + '</span>' +
          (mins ? '<span class="next-task-time">' + ui.esc(mins[1]) + '</span>' : '') + launch + '</li>';
      });
      html += '</ul>';
    } else {
      html += '<p class="muted">Everything for this week is done. Get ahead or rest — both count.</p>';
    }
    html += '</div>';

    var progressOpen = !!(s.settings && s.settings.dashboardProgressOpen);
    var liveStreak = PGRE.store.liveStreak();
    html += '<details class="card dashboard-progress"' + (progressOpen ? ' open' : '') + '>' +
      '<summary><span>Progress</span><span class="prog-sum-stats">' +
        'Level ' + lvl.level + ' · ' + liveStreak + '-day streak · ' + accuracy +
        (accuracy === '—' ? ' accuracy' : ' correct') + '</span></summary>';

    html += '<div class="hero">' +
      '<div class="hero-left">' +
        '<div class="hero-level">Level <span class="hero-level-num">' + lvl.level + '</span> · <span class="level-title">' + lvl.title + '</span></div>' +
        ui.meter(lvl.pct, 'meter-xp', {
          word: 'to next level', meta: ui.fmt(lvl.into) + ' / ' + ui.fmt(lvl.span) + ' XP'
        }) +
        '<div class="hero-xp-note">' + ui.fmt(lvl.into) + ' / ' + ui.fmt(lvl.span) + ' XP to Level ' + (lvl.level + 1) + '</div>' +
      '</div>' +
    '</div>';

    html += '<div class="stat-row">' +
      ui.statTile('Total XP', ui.fmt(s.xp)) +
      ui.statTile('Day streak', PGRE.store.liveStreak(), 'best ' + s.streak.best) +
      ui.statTile('Questions answered', ui.fmt(m.answered)) +
      ui.statTile('Accuracy', accuracy) +
      ui.statTile('Days active', s.daysActive.length) +
    '</div>';

    html += '<div class="card"><h2>Today’s challenges</h2><div class="challenge-list">';
    g.todaysChallenges().forEach(function (c) {
      var nav = CHALLENGE_NAV[c.id];
      var jump = (!c.done && nav)
        ? '<a class="btn btn-ghost btn-sm" href="' + nav.href + '">' + nav.label + ' →</a>'
        : '';
      html += '<div class="challenge' + (c.done ? ' done' : '') + '">' +
        '<div class="challenge-top"><span>' + (c.done ? '<span class="check">✓</span> ' : '') + ui.esc(c.label) + '</span>' +
        '<span class="challenge-xp">+' + c.xp + ' XP</span></div>' +
        ui.meter(100 * c.cur / c.max, 'meter-thin') +
        '<div class="challenge-foot">' +
          '<span class="challenge-prog">' + c.cur + ' / ' + c.max + '</span>' + jump +
        '</div>' +
      '</div>';
    });
    html += '</div></div>';

    html += qotdCard();
    html += readinessCard();

    var tiers = ['bronze', 'silver', 'gold', 'platinum'];
    var tierCounts = {};
    tiers.forEach(function (tier) {
      var total = PGRE.ACHIEVEMENTS.filter(function (a) { return a.tier === tier; }).length;
      var got = PGRE.ACHIEVEMENTS.filter(function (a) { return a.tier === tier && s.achievements[a.id]; }).length;
      tierCounts[tier] = got + '/' + total;
    });
    html += '<div class="card"><h2>Achievements</h2><div class="tier-chips">';
    tiers.forEach(function (tier) {
      html += '<span class="tier-chip tier-' + tier + '">' + tier.charAt(0).toUpperCase() + tier.slice(1) + ' ' + tierCounts[tier] + '</span>';
    });
    html += '</div>';
    var recent = PGRE.ACHIEVEMENTS
      .filter(function (a) { return s.achievements[a.id]; })
      .sort(function (a, b) { return s.achievements[b.id] < s.achievements[a.id] ? -1 : 1; })
      .slice(0, 3);
    if (recent.length) {
      html += '<ul class="mini-list">';
      recent.forEach(function (a) {
        html += '<li><span class="tier-dot tier-' + a.tier + '"></span>' + a.name +
          '<span class="muted"> · ' + PGRE.ui.timeAgo(s.achievements[a.id]) + '</span></li>';
      });
      html += '</ul>';
    } else {
      html += '<p class="muted">Nothing unlocked yet — answer your first question to get started.</p>';
    }
    html += '<a class="btn btn-ghost" href="#/achievements">All achievements →</a></div>';
    html += '</details>';

    html += '<div class="card dash-activity"><h2>Recent activity</h2>';
    if (s.log.length === 0) {
      html += '<p class="muted">Your activity will appear here.</p>';
    } else {
      html += '<ul class="activity-list">';
      s.log.slice(0, 6).forEach(function (e) {
        html += '<li><span class="act-dot act-' + ui.esc(e.kind) + '" aria-hidden="true"></span>' +
          '<span class="act-text">' + ui.esc(e.text) + '</span>' +
          (e.xp ? '<span class="act-xp">+' + e.xp + ' XP</span>' : '') +
          '<span class="act-time">' + ui.timeAgo(e.ts) + '</span></li>';
      });
      html += '</ul>';
    }
    html += '</div>';

    html += '<div class="band-head section-head"><h2 class="section-title">Knowledge portals</h2>' +
      '<span class="band-head-note">Exam weight · mastery</span></div><div class="topic-grid">';
    PGRE.TOPICS.forEach(function (t) {
      var rec = s.topics[t.id] || { attempted: 0, correct: 0 };
      var acc = rec.attempted ? Math.round(100 * rec.correct / rec.attempted) + '% correct' : 'not started';
      var mastery = g.mastery(t.id);
      html += '<a class="topic-card card" href="#/topic/' + t.id + '">' +
        '<div class="topic-card-head">' + ui.monogram(t) +
          '<span class="weight-chip">' + t.weight + '%</span></div>' +
        '<div class="topic-card-name">' + t.name + '</div>' +
        ui.meter(mastery, 'meter-thin') +
        '<div class="topic-card-sub">' + mastery + '% mastery · ' + acc + '</div>' +
      '</a>';
    });
    html += '</div>';

    return html;
  }

  /* ——— Views-A: entry motion helpers ———
     countUpText: tweens the first number in a plain-text element up to its
     current value (prefix/suffix preserved, e.g. "1,234" or "85%"). Elements
     with child markup (e.g. <span> units) are left untouched.
     animateMeters: lets every .meter-fill in scope run from 0 to its target. */
  function countUpText(el, duration) {
    if (!el || !(PGRE.motion && PGRE.motion.countUp)) return;
    if (el.children.length === 1 && el.firstElementChild.classList.contains('stat-unit')) {
      var textNode = el.childNodes[0];
      if (textNode && textNode.nodeType === 3) {
        var tm = textNode.textContent.trim().match(/^([^\d-]*)([\d,]+(?:\.\d+)?)(.*)$/);
        if (tm) {
          var tPrefix = tm[1], tSuffix = tm[3];
          var tDec = (tm[2].split('.')[1] || '').length;
          var tTo = parseFloat(tm[2].replace(/,/g, ''));
          if (!isNaN(tTo)) {
            PGRE.motion.countUp({
              set textContent(val) { textNode.textContent = val; },
              get textContent() { return textNode.textContent; }
            }, tTo, {
              duration: duration,
              decimals: tDec,
              format: function (v) {
                return tPrefix + v.toLocaleString('en-US', {
                  minimumFractionDigits: tDec,
                  maximumFractionDigits: tDec
                }) + tSuffix;
              }
            });
            return;
          }
        }
      }
    }
    if (el.children.length > 0) return;
    var m = el.textContent.trim().match(/^([^\d-]*)([\d,]+(?:\.\d+)?)(.*)$/);
    if (!m) return;
    var prefix = m[1], suffix = m[3];
    var decimals = (m[2].split('.')[1] || '').length;
    var to = parseFloat(m[2].replace(/,/g, ''));
    if (isNaN(to)) return;
    PGRE.motion.countUp(el, to, {
      duration: duration,
      decimals: decimals,
      format: function (v) {
        return prefix + v.toLocaleString('en-US', {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals
        }) + suffix;
      }
    });
  }

  function animateMeters(scope) {
    if (!(PGRE.motion && PGRE.motion.animateMeter) || !scope) return;
    scope.querySelectorAll('.meter-fill').forEach(function (f) {
      var pct = parseFloat(f.style.width);
      if (!isNaN(pct)) PGRE.motion.animateMeter(f, pct);
    });
  }

  function mount() {
    if (!keyBound) { document.addEventListener('keydown', onKey); keyBound = true; }
    if (PGRE.sessionPark) PGRE.sessionPark.wireDashboard();
    // Same Daily activity target card as #/study-time, including its chips
    // and focus button. studytime.mount no-ops when that card is absent.
    if (PGRE.views.studytime && PGRE.views.studytime.mount) PGRE.views.studytime.mount();
    // Intensity: open/shut readings, in-place refresh, meters, landing from a link
    bindIntensity();
    intensitySettle(intensityLast);
    landOnRequestedCard();
    // #7 QOTD: typeset the math and wire up the one-tap choices
    bindQotd();
    // Views-A: entry motion — numbers count up, meters fill, challenges cascade
    if (PGRE.motion && !PGRE.motion.reduced) {
      countUpText(document.querySelector('.hero-level-num'), 700);
      countUpText(document.querySelector('.hero-xp-note'), 700);
      // countdown must paint at its final value — do not tween .countdown-num
      document.querySelectorAll('.stat-tile .stat-value').forEach(function (el) {
        countUpText(el, 700);
      });
      document.querySelectorAll('.challenge-list .challenge-prog').forEach(function (el) {
        countUpText(el, 700);
      });
      animateMeters(document.getElementById('view'));
      var challengeList = document.querySelector('.challenge-list');
      if (challengeList) {
        Array.prototype.forEach.call(challengeList.children, function (c) {
          c.classList.add('stagger-in');
        });
        PGRE.motion.stagger(challengeList, { step: 60, max: 6 });
      }
      var view = document.getElementById('view');
      if (view) {
        var cascade = 0;
        Array.prototype.forEach.call(view.children, function (el) {
          if (el.classList.contains('card') || el.classList.contains('stat-row') ||
              el.classList.contains('two-col') ||
              el.classList.contains('review-queue')) {
            el.classList.add('stagger-in');
            el.style.animationDelay = (cascade * 70) + 'ms';
            cascade += 1;
          }
        });
      }
    }
    var prog = document.querySelector('#view details.dashboard-progress');
    if (prog) {
      prog.addEventListener('toggle', function () {
        var settings = PGRE.store.state.settings;
        if (!settings) return;
        settings.dashboardProgressOpen = !!prog.open;
        PGRE.store.save();
      });
    }


    var tfBtn = document.getElementById('today-formulas-btn');
    document.querySelectorAll('#view [data-launch-set]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (PGRE.launchPack(btn.getAttribute('data-launch-set')) == null) {
          PGRE.toast('That set is not available.');
        }
      });
    });
    if (tfBtn) tfBtn.addEventListener('click', startFormulaFromToday);

    // formula due count arrives async from the IndexedDB-backed deck
    PGRE.formulaDeck().then(function (deck) {
      var deckStatus = PGRE.formulaDeckStatus || null;
      var st = formulaStatus(deck);
      var todayEl = document.getElementById('today-formulas');
      var readyEl = document.getElementById('formula-readiness');
      if (readyEl) {
        var readyLine = formulaReadinessLine(deck, deckStatus);
        if (readyLine.indexOf(st.text + ' · ') === 0) readyLine = readyLine.slice(st.text.length + 3);
        if (readyLine) {
          readyEl.hidden = false;
          readyEl.textContent = readyLine + ' ';
          var link = document.createElement('a');
          link.href = '#/formulas';
          link.textContent = 'Open Recall';
          readyEl.appendChild(link);
        }
      }
      if (todayEl) todayEl.textContent = st.text;
      if (tfBtn && !tfBtn.disabled) {
        if (st.remaining || (st.fill && st.dueN)) {
          tfBtn.classList.remove('btn-ghost');
          tfBtn.classList.add('btn-primary');
        }
        if (st.remaining) tfBtn.textContent = 'Study →';
        else if (st.fill && !st.newN) tfBtn.textContent = 'Study ' + st.dueN + ' due →';
        else if (st.fill) tfBtn.textContent = 'Study ' + (st.dueN + st.newN) + ' →';
        else tfBtn.textContent = 'Open →';
      }
      // remaining counts may tween; do not tween "N not yet introduced"
      if (PGRE.motion && !PGRE.motion.reduced && st.remaining) {
        if (todayEl) countUpText(todayEl, 600);
      }
    });
  }

  return { render: render, mount: mount };
})();
