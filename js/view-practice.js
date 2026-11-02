/* Practice session: config → questions (immediate feedback + solution) → summary.
   Answering feeds the XP engine, daily challenges and achievements.

   Feature-wave additions (proposals #3/#4/#6/#14):
   - #3 Custom quiz: #/practice/custom consumes sessionStorage['pgre-quiz-config']
     ({ ids, label, criteria? }) written by the builder (js/view-build.js) or
     PGRE.launchPack (js/packs.js; also #/practice/pack/<NN>) and runs it as a
     labelled session. A criteria-built quiz stores its filter snapshot so
     the summary's replay can resample a fresh draw; ID-based sets replay exactly.
   - #4 Pace trainer: a live per-question timer chip (state.settings.paceTrainer)
     against the target pace (state.settings.paceTargetSec), with over/under-pace
     marking in the feedback block.
   - #6 Confidence tagging: after each answer, a one-tap "Knew it / Guessed"
     (keyboard g / k, t / f / r for too slow, forgot, keep failing) that stamps
     the just-written attempt row and files correct-but-guessed answers as
     lucky guesses in the mistake book; keep-failing flags the entry directly.
   - #14 Keyboard-first: A–E / 1–5 select, Enter confirms, Enter/Space/N advance, g/k/t/f/r tag. */
window.PGRE = window.PGRE || {};
PGRE.views = PGRE.views || {};

PGRE.views.practice = (function () {
  var LETTERS = ['A', 'B', 'C', 'D', 'E'];
  // { topicId, qs, i, correct, xpEarned, answers[], qStart, sid, label, custom,
  //   criteria, stage: 'question'|'feedback'|'summary', tagged }
  var session = null;
  var archive = null; // read-only History reconstruction; never replaces `session`
  var autoResume = false;   // parked-session drawer armed a one-shot direct resume
  var paceTimer = null;   // module-scoped so it survives a session reset
  var keyBound = false;   // the document keydown listener is installed once
  var noteTimers = {};    // qid -> debounce timeout id for the feedback note field
  var lastRenderAt = 0;   // stamps each render so a double-click can't click through

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function el() { return document.getElementById('practice-root'); }

  function settings() { return PGRE.store.state.settings; }

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
        '<div class="miss-pick is-bad">' +
          '<strong>' + LETTERS[idx] + '</strong> — ' +
          '<span class="miss-pick-body">' + q.choices[idx] + '</span></div>' +
        '<div class="solution"><div class="solution-label">Why it tempts</div>' + why + '</div>' +
      '</div>';
    }
    if (!items) return '';
    return '<details class="miss distractors"><summary>Why the other choices tempt</summary>' +
      '<div class="distractor-list">' + items + '</div></details>';
  }

  /* PROPOSAL #6 — bookmark + margin note straight from the feedback panel.
     This is the only bootstrap entry point for the Notes & bookmarks feature:
     starring a question or typing a note here creates the first entry that the
     #/notes browser then lists. Reuses the storage API (PGRE.notes) and the
     shared .nb-star / .nb-note styling so the two surfaces stay consistent.
     q.id is a bank id (escaped for the attribute); the note is user text and is
     escaped before it lands in the textarea. */
  function notesBlock(q) {
    var on = PGRE.notes.isBookmarked(q.id);
    var note = PGRE.notes.get(q.id);
    return '<div class="practice-nb" data-qid="' + PGRE.ui.esc(q.id) + '">' +
      '<div class="practice-nb-bar">' +
        starButton(on) +
        '<span class="practice-nb-hint muted" data-star-label>' + starLabel(on) + '</span>' +
      '</div>' +
      '<div class="nb-noteblock">' +
        '<textarea class="nb-note" data-note rows="2" ' +
          'placeholder="Jot a note for this question…">' + PGRE.ui.esc(note) + '</textarea>' +
        '<span class="nb-saved" aria-live="polite"></span>' +
      '</div>' +
    '</div>';
  }

  function starButton(on) {
    var label = on ? 'Remove bookmark' : 'Bookmark this question';
    return '<button class="nb-star' + (on ? ' on' : '') + '" data-star type="button" ' +
      'aria-pressed="' + (on ? 'true' : 'false') + '" ' +
      'title="' + label + '" aria-label="' + label + '">' + (on ? '★' : '☆') + '</button>';
  }

  function starLabel(on) {
    return on ? 'Bookmarked — saved to Notes &amp; bookmarks' : 'Bookmark this question';
  }

  function bindNotes(fb, q) {
    var wrap = fb.querySelector('.practice-nb');
    if (!wrap) return;
    var star = wrap.querySelector('[data-star]');
    var label = wrap.querySelector('[data-star-label]');
    if (star) {
      star.addEventListener('click', function () {
        var on = PGRE.notes.toggleBookmark(q.id);
        star.classList.toggle('on', on);
        star.textContent = on ? '★' : '☆';
        star.setAttribute('aria-pressed', on ? 'true' : 'false');
        var t = on ? 'Remove bookmark' : 'Bookmark this question';
        star.setAttribute('title', t);
        star.setAttribute('aria-label', t);
        if (label) label.innerHTML = starLabel(on);
      });
    }
    var ta = wrap.querySelector('[data-note]');
    if (ta) {
      ta.addEventListener('input', function () { scheduleNoteSave(q.id, ta); });
      ta.addEventListener('blur', function () { flushNoteSave(q.id, ta); });
    }
  }

  function scheduleNoteSave(qid, ta) {
    if (noteTimers[qid]) clearTimeout(noteTimers[qid]);
    noteTimers[qid] = setTimeout(function () { doNoteSave(qid, ta); }, 500);
  }

  function flushNoteSave(qid, ta) {
    if (noteTimers[qid]) { clearTimeout(noteTimers[qid]); noteTimers[qid] = null; }
    doNoteSave(qid, ta);
  }

  function doNoteSave(qid, ta) {
    noteTimers[qid] = null;
    if (String(ta.value).trim() === String(PGRE.notes.get(qid)).trim()) return; // no change
    PGRE.notes.set(qid, ta.value);
    showNoteSaved(ta);
  }

  /* Closing/reloading the tab mid-typing fires no blur and kills the debounce
     timer — flush the visible note field so the edit survives (same pagehide
     pattern as js/study-time.js). */
  window.addEventListener('pagehide', function () {
    var ta = document.querySelector('.practice-nb [data-note]');
    if (!ta) return;
    var wrap = ta.closest('.practice-nb');
    var qid = wrap && wrap.getAttribute('data-qid');
    if (qid) flushNoteSave(qid, ta);
  });

  function showNoteSaved(ta) {
    var tick = ta.parentNode.querySelector('.nb-saved');
    if (!tick) return;
    tick.textContent = ta.value.trim() === '' ? 'Note cleared' : 'Saved';
    tick.classList.add('show');
    clearTimeout(tick._t);
    tick._t = setTimeout(function () { tick.classList.remove('show'); }, 1600);
  }

  /* ——— Pace trainer (#4) ——— */
  var PACE_GRACE_MS = 5000; // a click inside the first 5 s is not pace data

  function clearPace() {
    if (paceTimer) { clearInterval(paceTimer); paceTimer = null; }
  }

  function startPaceTimer() {
    clearPace();
    if (!settings().paceTrainer) return;
    paceTimer = setInterval(tickPace, 1000);
  }

  function tickPace() {
    var chip = document.getElementById('pace-chip');
    if (!chip || !session) { clearPace(); return; }
    var sec = Math.round((Date.now() - session.qStart) / 1000);
    var target = settings().paceTargetSec || 103;
    chip.textContent = sec + ' s';
    chip.classList.toggle('pace-over', sec > target);
  }

  function paceMark(elapsedMs) {
    if (!settings().paceTrainer) return '';
    if (elapsedMs < PACE_GRACE_MS) return '';
    var sec = Math.round(elapsedMs / 1000);
    var target = settings().paceTargetSec || 103;
    var over = sec > target;
    return '<div class="pace-mark ' + (over ? 'pace-over' : 'pace-under') + '">' +
      sec + ' s — ' + (over ? 'over pace' : 'under pace') +
      ' <span class="pace-target">(target ' + target + ' s)</span></div>';
  }

  /* ——— Question palette (same overview as mistake drill) ———
     Live cells jump to that question (answered or not). Summary / review
     keep data-review jumps. answers[n] is qs[n] or empty so skips leave holes;
     resume restores the cursor, or the next unanswered if that cell is done. */
  function answerAt(n, sess) {
    sess = sess || session;
    if (!sess || !sess.answers) return null;
    return sess.answers[n] || null;
  }

  function answeredCount(sess) {
    sess = sess || session;
    if (!sess || !sess.qs || !sess.answers) return 0;
    var n = 0;
    for (var i = 0; i < sess.qs.length; i++) if (sess.answers[i]) n++;
    return n;
  }

  function snapAnsweredCount(snap) {
    var n = 0;
    ((snap && snap.answers) || []).forEach(function (a) {
      if (a && a.qid) n++;
    });
    return n;
  }

  function currentSession() { return archive || session; }

  function fmtAttemptMs(ms) {
    if (ms == null) return '';
    var s = ms / 1000;
    return (s < 10 ? s.toFixed(1) : Math.round(s)) + ' s';
  }

  function paletteHTML(results, current) {
    var s = currentSession();
    if (!s || !s.qs || !s.qs.length) return '';
    var cells = '';
    s.qs.forEach(function (q, n) {
      var ans = answerAt(n, s);
      var cls = 'pal-cell';
      if (ans) cls += results ? (ans.correct ? ' is-correct' : ' is-wrong') : ' is-answered';
      if (current != null ? n === current : (!results && n === s.i)) cls += ' is-current';
      var label = 'Question ' + (n + 1);
      if (ans) label += results ? (ans.correct ? ', correct' : ', missed') : ', answered';
      else label += results ? ', not answered' : ', unanswered';
      if (current != null ? n === current : (!results && n === s.i)) label += ', current';
      var attrs;
      if (results) {
        if (ans) {
          attrs = ' data-review="' + n + '" title="Review this question"';
          label += ', review';
        } else {
          attrs = ' disabled';
        }
      } else {
        attrs = ' data-goto="' + n + '" title="Go to this question"';
      }
      cells += '<button type="button" class="' + cls + '"' + attrs +
        ' aria-label="' + label + '">' + (n + 1) + '</button>';
    });
    return '<div class="drill-palette practice-palette">' +
      '<div class="exam-palette-title">' +
        (results ? 'How this set went' : 'Questions in this set') + '</div>' +
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

  function paintPalette() {
    var root = el().querySelector('.practice-palette');
    if (!root || !session) return;
    var buttons = root.querySelectorAll('.pal-cell');
    for (var n = 0; n < buttons.length; n++) {
      var btn = buttons[n];
      var ans = answerAt(n);
      btn.classList.toggle('is-answered', !!ans);
      btn.classList.toggle('is-current', n === session.i);
      btn.setAttribute('aria-label', 'Question ' + (n + 1) +
        (ans ? ', answered' : ', unanswered') +
        (n === session.i ? ', current' : ''));
    }
  }

  function neighborAnswered(from, dir) {
    var s = currentSession();
    if (!s || !s.answers) return -1;
    for (var i = from + dir; i >= 0 && i < s.qs.length; i += dir) {
      if (answerAt(i, s)) return i;
    }
    return -1;
  }

  function bindReviewJumps() {
    el().querySelectorAll('[data-review]').forEach(function (b) {
      b.addEventListener('click', function () {
        renderReview(parseInt(b.getAttribute('data-review'), 10));
      });
    });
  }

  function bindLiveJumps() {
    var root = el();
    if (!root || root._pgreGotoBound) return;
    root._pgreGotoBound = true;
    root.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-goto]') : null;
      if (!t || t.disabled || !root.contains(t)) return;
      var n = parseInt(t.getAttribute('data-goto'), 10);
      if (n !== n) return;
      openLive(n);
    });
  }

  /* A planned set should always have an obvious exit back to the calendar.
     Store the current week before leaving so the plan can reopen the same
     section after the session summary or an intentional mid-session exit. */
  function bindPlanReturn() {
    var btn = el() && el().querySelector('[data-plan-return]');
    if (!btn || btn._pgrePlanReturnBound) return;
    btn._pgrePlanReturnBound = true;
    btn.addEventListener('click', function () {
      try {
        var cw = PGRE.currentWeek && PGRE.currentWeek();
        var week = cw && cw.week;
        sessionStorage.setItem('pgre-plan-return', JSON.stringify({
          week: week && week.id ? week.id : null,
          at: Date.now()
        }));
      } catch (e) {}
    });
  }

  function planReturnLink() {
    var pack = session && inferPackId(session.qs.map(function (q) { return q.id; }), session.label);
    return pack ? '<a class="btn btn-ghost btn-sm session-back" data-plan-return href="#/plan">Back to plan</a>' : '';
  }

  function nextLabel() {
    if (!session) return 'Next question';
    if (session.i + 1 < session.qs.length) return 'Next question';
    if (answeredCount() < session.qs.length) return 'Next question';
    return 'Finish session';
  }

  function openLive(n) {
    if (!session || n < 0 || n >= session.qs.length) return;
    if (session.stage === 'summary' || session.reviewing) return;
    if (n === session.i) {
      if (session.stage === 'question' && !answerAt(n)) return;
      if (session.stage === 'feedback' && answerAt(n)) return;
    }
    session.i = n;
    if (answerAt(n)) renderAnsweredLive();
    else renderQuestion();
  }

  function correctTitle(q) {
    if (PGRE.assess && typeof PGRE.assess.reviewTitle === 'function') return PGRE.assess.reviewTitle(q.id);
    return 'Correct';
  }

  function reviewAssessNote(ans) {
    var bits = assessBits(ans && ans.row);
    if (bits.length) {
      return '<div class="conf-note muted">Your self-assessment: <strong>' +
        bits.join(' · ') + '</strong></div>';
    }
    return '';
  }

  /* Latest attempt for this answer. The chip writes confidence and tags onto
     that row in the same turn as the review date, so the row is what a resume
     has to paint. Prefer the row from this parked session, then any row for
     the question. */
  function attemptFor(qid, sid) {
    var arr = (PGRE.store && PGRE.store.state && PGRE.store.state.attempts) || [];
    var any = null;
    for (var i = arr.length - 1; i >= 0; i--) {
      var row = arr[i];
      if (!row || row.qid !== qid) continue;
      if (!any) any = row;
      if (sid && row.sid === sid) return row;
    }
    return any;
  }

  function flagsFromRow(row) {
    var flags = { sure: false, guess: false, slow: false, forgot: false, stuck: false };
    if (!row) return flags;
    if (row.confidence === 'sure') flags.sure = true;
    if (row.confidence === 'guess') flags.guess = true;
    (row.tags || []).forEach(function (tg) { if (tg in flags) flags[tg] = true; });
    return flags;
  }

  /* Paint the chips that match the stored review date. A snapshot taken
     before the tap is all false and must not hide the attempt row. */
  function assessFlags(ans) {
    var row = ans && ans.row;
    if (!row && ans && ans.q) row = attemptFor(ans.q.id, session && session.sid);
    if (row) return flagsFromRow(row);
    if (ans && ans.assess) return ans.assess;
    return flagsFromRow(null);
  }

  function snapshotAssess(fb, ans) {
    if (!fb || !ans) return;
    var flags = { sure: false, guess: false, slow: false, forgot: false, stuck: false };
    fb.querySelectorAll('[data-assess]').forEach(function (b) {
      var k = b.getAttribute('data-assess');
      if (k in flags) flags[k] = b.getAttribute('aria-pressed') === 'true';
    });
    ans.assess = flags;
  }

  function bindSessionAssess(fb, q, ans) {
    var ctrl = PGRE.assess.bind(fb, q, ans.correct);
    var flags = assessFlags(ans);
    if (typeof ctrl.hydrate === 'function') ctrl.hydrate(flags);
    var inner = ctrl.toggle;
    ctrl.toggle = function (key) {
      inner(key);
      snapshotAssess(fb, ans);
      // The tap already rewrote the attempt and the date. Park that chip
      // state too, so a later resume is not stuck with the pre-tap snapshot.
      saveSession();
    };
    fb.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-assess]') : null;
      if (t && fb.contains(t)) snapshotAssess(fb, ans);
    });
    snapshotAssess(fb, ans);
    session.assess = ctrl;
  }


  /* ——— Mid-session persistence ———
     Leaving #/practice/<id> mid-set used to drop the queue silently. The
     in-flight session is mirrored to sessionStorage (same transient handoff
     the custom-quiz builder uses for 'pgre-quiz-config'): question ids, the
     position, the answered rows and the gamify session id. The config screen
     for the same topic/filter then offers Resume / Start over. Cleared when
     the summary renders or the user starts over. Attempts themselves are
     already in the saved profile, so nothing is double-counted on resume. */
  var SAVE_KEY = 'pgre-practice-session';

  function paintPark() {
    if (PGRE.sessionPark && PGRE.sessionPark.paint) PGRE.sessionPark.paint();
  }

  function saveSession() {
    if (!session || session.stage === 'summary' || session.stage === 'review') return;
    var snap = {
      topicId: session.topicId, filter: session.filter, label: session.label,
      custom: session.custom, learnDrill: !!session.learnDrill,
      purpose: session.purpose || null,
      topicIds: Array.isArray(session.topicIds) ? session.topicIds.slice() : [],
      subtopics: Array.isArray(session.subtopics) ? session.subtopics.slice() : [],
      concepts: Array.isArray(session.concepts) ? session.concepts.slice() : [],
      weakSpots: Array.isArray(session.weakSpots) ? session.weakSpots.slice() : [],
      difficulty: session.difficulty == null ? null : session.difficulty,
      criteria: session.criteria,
      sid: session.sid,
      stage: session.stage,   // 'question' | 'feedback' — resume must not skip a read solution
      ids: session.qs.map(function (q) { return q.id; }),
      // cursor is session.i; answers[n] matches qs[n] (null holes if skipped)
      i: session.i, correct: session.correct, xpEarned: session.xpEarned,
      answers: session.qs.map(function (q, n) {
        var a = session.answers[n];
        if (!a) return null;
        return { qid: a.q.id, picked: a.picked, correct: a.correct, xp: a.xp,
                 ms: a.ms, assess: a.assess || null };
      }),
      savedAt: Date.now()
    };
    try { sessionStorage.setItem(SAVE_KEY, JSON.stringify(snap)); } catch (e) { /* storage blocked */ }
    paintPark();
  }

  function clearSaved() {
    try { sessionStorage.removeItem(SAVE_KEY); } catch (e) { /* storage blocked */ }
    paintPark();
  }

  /* History: rebuild a finished or unfinished practice set from the stored
     session and its attempts. Read-only — never writes, never touches
     `session` or the parked snapshot. A question that left the bank is a
     stub that names the missing id instead of throwing. */
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
      difficulty: 1,
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

  function practiceRecordExtra(s) {
    if (s.label) return s.label;
    if (s.custom || s.topicId === 'custom') return 'Custom quiz';
    if (s.topicId && s.topicId !== 'all') {
      var t = PGRE.topicById(s.topicId);
      return t ? t.name : s.topicId;
    }
    return 'All topics';
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

  function missingBankNote(q, ans) {
    return '<div class="record-missing" id="missing-q-note">' +
      'This question has left the bank. Your pick: ' + letterOf(ans && ans.picked) +
      ' · Correct answer: ' + letterOf(q && q.answer) +
      '. Its wording and solution were not stored.</div>';
  }

  function reconstructArchive(sid) {
    if (!sid || !PGRE.gamify || typeof PGRE.gamify._session !== 'function') return null;
    var sess = PGRE.gamify._session(sid);
    if (!sess || sess.mode !== 'practice') return null;
    var arr = (PGRE.store.state && PGRE.store.state.attempts) || [];
    var lastByQid = {};
    var order = [];
    arr.forEach(function (a) {
      if (!a || a.sid !== sid) return;
      if (!lastByQid[a.qid]) order.push(a.qid);
      lastByQid[a.qid] = a;
    });
    var qs = [];
    var answers = [];
    var correct = 0;
    order.forEach(function (qid) {
      var row = lastByQid[qid];
      var q = questionForAttempt(row);
      qs.push(q);
      answers.push({
        q: q, picked: row.picked, correct: !!row.correct,
        xp: null, ms: row.ms, row: row
      });
      if (row.correct) correct++;
    });
    return {
      topicId: sess.topicId || 'all',
      qs: qs, answers: answers, i: 0,
      correct: sess.correct != null ? sess.correct : correct,
      xpEarned: sess.xp || 0,
      sid: sid,
      label: sess.label || null,
      custom: sess.topicId === 'custom',
      stage: 'summary', reviewing: false, done: true,
      readonly: true, sess: sess
    };
  }

  function openArchive(sid) {
    try { sid = decodeURIComponent(sid); } catch (e) { /* keep raw */ }
    archive = reconstructArchive(sid);
    if (!el()) return;
    if (!archive) {
      el().innerHTML = '<div class="card practice-card"><h1>Set not found</h1>' +
        '<p class="muted">This History entry has no stored practice session.</p>' +
        '<div class="btn-row"><a class="btn btn-primary" href="#/history">Back to History</a></div></div>';
      return;
    }
    renderSummary();
  }

  /* A snapshot stays parked until the summary is painted — even when every
     question is answered. Deleting an all-answered set here is what used to
     lose the timed-pack tick and the endSession close when the captain stepped
     away after the last question. */
  function loadSaved(topicId, filter) {
    var raw = null;
    try { raw = sessionStorage.getItem(SAVE_KEY); } catch (e) { return null; }
    if (!raw) return null;
    var snap = null;
    try { snap = JSON.parse(raw); } catch (e2) { return null; }
    if (!snap || !snap.ids || !snap.ids.length) return null;
    if (snap.topicId !== topicId || (snap.filter || null) !== (filter || null)) return null;
    return snap;
  }

  function resumeSaved(snap) {
    // Zip by qid, not position: a question dropped from the bank mid-session
    // leaves a hole, and index-matching would slide every later answer onto
    // the wrong question and mis-aim the cursor.
    var qs = [];
    snap.ids.forEach(function (id) { var q = PGRE.questionById(id); if (q) qs.push(q); });
    if (!qs.length) { clearSaved(); return false; }  // bank changed under us
    var byQid = {};
    (snap.answers || []).forEach(function (a) {
      if (a && a.qid != null && !byQid[a.qid]) byQid[a.qid] = a;
    });
    var answers = qs.map(function (q) {
      var a = byQid[q.id];
      return a ? { q: q, picked: a.picked, correct: a.correct, xp: a.xp,
                   ms: a.ms, assess: a.assess || null,
                   row: attemptFor(q.id, snap.sid) } : null;
    });
    // Realign the cursor by its question id (snap.i indexes the old ids list,
    // so a dropped id would otherwise point at the next question).
    var i = 0;
    var cursorId = snap.ids[snap.i];
    for (var k = 0; k < qs.length; k++) { if (qs[k].id === cursorId) { i = k; break; } }
    var allDone = qs.every(function (q, n) { return !!answers[n]; });
    // Restore the stage he left on: feedback repaints the solution he was
    // reading (even on the last question); all-answered with no feedback goes
    // straight to the summary, where clearSaved/endSession/the set-NN tick run.
    var stage = snap.stage === 'feedback' && answers[i] ? 'feedback' : 'question';
    session = { topicId: snap.topicId, qs: qs, i: i, correct: snap.correct || 0,
                xpEarned: snap.xpEarned || 0, answers: answers, qStart: Date.now(),
                custom: !!snap.custom, learnDrill: !!snap.learnDrill,
                purpose: snap.purpose || null,
                topicIds: Array.isArray(snap.topicIds) ? snap.topicIds.slice() : [],
                subtopics: Array.isArray(snap.subtopics) ? snap.subtopics.slice() : [],
                concepts: Array.isArray(snap.concepts) ? snap.concepts.slice() : [],
                weakSpots: Array.isArray(snap.weakSpots) ? snap.weakSpots.slice() : [],
                difficulty: snap.difficulty == null ? null : snap.difficulty,
                criteria: snap.criteria || null,
                filter: snap.filter || null, stage: 'question', assess: null,
                done: false, reviewing: false, sid: snap.sid };
    if (stage === 'feedback') renderAnsweredLive();
    else if (allDone) renderSummary();   // clearSaved + endSession + the set-NN tick live there
    else renderQuestion();
    return true;
  }

  function resumeCard(snap, name, onStartOver) {
    var left = snap.ids.length - snapAnsweredCount(snap);
    var html = '<div class="card practice-card practice-resume">' +
      '<h1>Practice — ' + name + '</h1>' +
      '<p class="muted">You left a set part-way through: ' + left + ' of ' + snap.ids.length +
      ' question' + (snap.ids.length === 1 ? '' : 's') + ' left, ' + snap.correct + ' correct so far.</p>' +
      '<div class="btn-row">' +
        '<button class="btn btn-primary" id="resume-btn">Resume session (' + left + ' of ' + snap.ids.length + ' left)</button>' +
        '<button class="btn btn-ghost" id="startover-btn">Start over</button>' +
      '</div></div>';
    lastRenderAt = Date.now();
    el().innerHTML = html;
    window.scrollTo(0, 0);
    document.getElementById('resume-btn').addEventListener('click', function () {
      if (!resumeSaved(snap)) onStartOver();
    });
    document.getElementById('startover-btn').addEventListener('click', function () {
      clearSaved();
      onStartOver();
    });
  }

  /* ——— Config (topic / all modes; optional done-status filter) ———
     filter 'new' keeps never-attempted questions, 'done' keeps those attempted
     at least once (state.questions — practice, drills and mock exams all
     count); anything else means the whole bank. The topic portal's split
     buttons land here via #/practice/<topic>/new and /done. */
  function isDone(q) {
    var r = PGRE.questionRecord(q.id);
    return !!(r && r.attempts > 0);
  }

  function filteredBank(topicId, filter) {
    var bank = PGRE.questionsForTopic(topicId);
    if (filter === 'new') return bank.filter(function (q) { return !isDone(q); });
    if (filter === 'done') return bank.filter(isDone);
    return bank;
  }

  function renderConfig(topicId, filter, ignoreSaved) {
    if (filter !== 'new' && filter !== 'done') filter = null;
    var t = topicId === 'all' ? null : PGRE.topicById(topicId);
    var bank = filteredBank(topicId, filter);
    var name = (t ? t.name : 'All topics (mixed)') +
      (filter === 'new' ? ' · not yet done' : filter === 'done' ? ' · done before' : '');
    var saved = ignoreSaved ? null : loadSaved(topicId, filter);
    // The parked-session drawer armed a one-shot resume: open on the question
    // (or the read solution) directly, not on this "left part-way" card.
    if (saved && autoResume) { autoResume = false; if (resumeSaved(saved)) return; }
    if (saved) {
      resumeCard(saved, name, function () { renderConfig(topicId, filter, true); });
      return;
    }
    var counts = [3, 5, 10, 20].filter(function (n) { return n <= bank.length; });
    var preferred = counts.indexOf(10) !== -1 ? 10 :
      (counts.length ? counts[counts.length - 1] : null);
    var html = '<div class="card practice-card">' +
      '<h1>Practice — ' + name + '</h1>';
    if (!bank.length && filter) {
      html += '<p class="muted">' + (filter === 'new'
          ? 'Nothing left in this group — every question in this bank has been done at least once.'
          : 'Nothing here yet — a question joins this group once you have done it once.') + '</p>' +
        '<div class="btn-row">' +
          (t ? '<a class="btn btn-primary" href="#/topic/' + t.id + '">Back to the portal</a>' : '') +
          '<a class="btn btn-ghost" href="#/practice/' + topicId + '">Practice the whole bank</a>' +
        '</div></div>';
      lastRenderAt = Date.now();
      el().innerHTML = html;
      window.scrollTo(0, 0);
      return;
    }
    html += '<p class="muted">' + bank.length + ' question' + (bank.length === 1 ? '' : 's') +
      ' available. Correct answers earn 10 XP (15 the first time); a wrong answer still earns 2 XP for the attempt.</p>' +
      '<div class="btn-row">';
    counts.forEach(function (n) {
      html += '<button class="btn ' + (n === preferred ? 'btn-primary' : 'btn-ghost') +
        '" data-count="' + n + '">' + n + ' questions</button>';
    });
    html += '<button class="btn ' + (preferred == null ? 'btn-primary' : 'btn-ghost') +
      '" data-count="' + bank.length + '"' +
      (bank.length ? '' : ' disabled') + '>All ' + bank.length + '</button>' +
      '</div>' +
      '<p class="muted build-link-note">Start with a short session; choose a different size when you have more time. ' +
      'Want unseen / missed / slowest / bookmarked filters? Build a set in the <a href="' + (topicId === 'all' ? '#/build' : '#/build/topic-' + topicId) +
      '">custom quiz builder</a>.</p>' +
      '</div>';
    lastRenderAt = Date.now();
    el().innerHTML = html;
    window.scrollTo(0, 0);
    el().querySelectorAll('[data-count]').forEach(function (b) {
      b.addEventListener('click', function () {
        start(topicId, filter, parseInt(b.getAttribute('data-count'), 10));
      });
    });
  }

  function start(topicId, filter, count) {
    var qs = shuffle(filteredBank(topicId, filter)).slice(0, count);
    beginPractice(qs, { topicId: topicId, filter: filter,
                        label: filter === 'new' ? 'Not yet done'
                             : filter === 'done' ? 'Done before' : null });
  }
  function renderLearnGate(cfg, qs) {
    var label = cfg.label || 'Learn transfer · 3 GRE questions';
    var html = '<div class="card practice-card practice-resume">' +
      '<h1>Learn transfer</h1>' +
      '<p class="muted">' + PGRE.ui.esc(label) + '</p>' +
      '<p>Three targeted Physics GRE questions are ready. Start when you are ready to answer them in Life Studio.</p>' +
      '<div class="btn-row">' +
      '<button class="btn btn-primary" id="learn-start-btn">Start transfer</button>' +
      '<a class="btn btn-ghost" href="#/">Not now</a>' +
      '</div></div>';
    lastRenderAt = Date.now();
    el().innerHTML = html;
    window.scrollTo(0, 0);
    document.getElementById('learn-start-btn').addEventListener('click', function () {
      if (Date.now() - lastRenderAt < 300) return;
      beginPractice(shuffle(qs), { topicId: 'custom', label: label, custom: true,
                                   learnDrill: true, purpose: 'learn-drill',
                                   topicIds: cfg.topicIds, subtopics: cfg.subtopics,
                                   concepts: cfg.concepts, weakSpots: cfg.weakSpots,
                                   difficulty: cfg.difficulty });
    });
  }


  /* ——— Custom quiz (#3): consume the builder's handoff ——— */
  function startCustom(resample, ignoreSaved) {
    var raw = null;
    try { raw = sessionStorage.getItem('pgre-quiz-config'); } catch (e) { raw = null; }
    var cfg = null;
    if (raw) { try { cfg = JSON.parse(raw); } catch (e2) { cfg = null; } }
    if (!cfg || !cfg.ids || !cfg.ids.length) { renderNoCustom(); return; }
    // a custom set left part-way through resumes too, as long as the builder's
    // handoff still describes the same questions
    var saved = (resample || ignoreSaved) ? null : loadSaved('custom', null);
    // The parked-session drawer armed a one-shot resume: open on the question
    // (or the read solution) directly, not on this "left part-way" card.
    if (saved && autoResume && sameIds(saved.ids, cfg.ids) &&
        (!!saved.learnDrill === !!cfg.learnDrill) &&
        (saved.purpose || null) === (cfg.purpose || (cfg.learnDrill ? 'learn-drill' : null))) {
      autoResume = false;
      if (resumeSaved(saved)) return;
    }
    if (saved && sameIds(saved.ids, cfg.ids) &&
        (!!saved.learnDrill === !!cfg.learnDrill) &&
        (saved.purpose || null) === (cfg.purpose || (cfg.learnDrill ? 'learn-drill' : null))) {
      resumeCard(saved, PGRE.ui.esc(cfg.label || 'Custom quiz'), function () { startCustom(false, true); });
      return;
    }
    var qs = [];
    // Replay ("Draw a fresh set") of a criteria-built quiz resamples from the
    // original criteria against the current pool; mounting #/practice/custom
    // or replaying an ID-based set (no criteria) reuses the exact ids.
    if (resample && cfg.criteria && PGRE.views.build && PGRE.views.build.resample) {
      PGRE.views.build.resample(cfg.criteria, cfg.ids.length).forEach(function (id) {
        var q = PGRE.questionById(id); if (q) qs.push(q);
      });
    } else {
      cfg.ids.forEach(function (id) { var q = PGRE.questionById(id); if (q) qs.push(q); });
    }
    if (!qs.length) { renderNoCustom(); return; }
    if (cfg.learnDrill) {
      renderLearnGate(cfg, qs);
      return;
    }
    beginPractice(shuffle(qs), { topicId: 'custom', label: cfg.label || 'Custom quiz', custom: true,
                                 criteria: cfg.criteria || null, purpose: cfg.purpose || null });
  }

  function sameIds(a, b) {
    if (a.length !== b.length) return false;
    var set = {};
    a.forEach(function (id) { set[id] = true; });
    return b.every(function (id) { return set[id]; });
  }

  function renderNoCustom() {
    el().innerHTML = '<div class="card practice-card">' +
      '<h1>Custom quiz</h1>' +
      '<p class="muted">No custom set is ready. Choose topics, difficulty and status ' +
      'filters in the builder, then start your set.</p>' +
      '<div class="btn-row"><a class="btn btn-primary" href="#/build">Open the quiz builder</a>' +
      '<a class="btn btn-ghost" href="#/practice/all">Mixed practice instead</a></div></div>';
  }

  function beginPractice(qs, opts) {
    opts = opts || {};
    var topicId = opts.topicId || 'all';
    clearSaved(); // a fresh set replaces whatever was left part-way
    var packId = inferPackId(qs.map(function (q) { return q.id; }), opts.label);
    session = { topicId: topicId, qs: qs, i: 0, correct: 0, xpEarned: 0, answers: [],
                qStart: Date.now(), label: opts.label || null, custom: !!opts.custom,
                learnDrill: !!opts.learnDrill, purpose: opts.purpose || null,
                topicIds: Array.isArray(opts.topicIds) ? opts.topicIds.slice() : [],
                subtopics: Array.isArray(opts.subtopics) ? opts.subtopics.slice() : [],
                concepts: Array.isArray(opts.concepts) ? opts.concepts.slice() : [],
                weakSpots: Array.isArray(opts.weakSpots) ? opts.weakSpots.slice() : [],
                difficulty: opts.difficulty == null ? null : opts.difficulty,
                criteria: opts.criteria || null,
                filter: opts.filter || null, stage: 'question', assess: null,
                done: false, reviewing: false,
                sid: PGRE.gamify.beginSession(topicId, 'practice', qs.length,
                  { label: opts.label || null, pack: packId }) };
    renderQuestion();
  }

  /* ——— Question stage ——— */
  function renderQuestion() {
    var q = session.qs[session.i];
    var t = PGRE.topicById(q.topic) || { id: 'xx', short: '?', name: 'Unknown topic' };
    session.stage = 'question';
    session.assess = null;
    lastRenderAt = Date.now();
    var html = '<div class="card practice-card practice-live">' +
      '<div class="practice-scroll">' +
      '<div class="practice-meta">' +
        '<span>Question ' + (session.i + 1) + ' of ' + session.qs.length + '</span>' +
        (session.label ? '<span class="chip chip-session">' + PGRE.ui.esc(session.label) + '</span>' : '') +
        '<span class="chip">' + t.name + '</span>' +
        '<span class="chip chip-diff">' + PGRE.ui.diffDots(q.difficulty) + '</span>' +
        planReturnLink() +
        (settings().paceTrainer ? '<span class="chip pace-chip" id="pace-chip" title="Time on this question">0 s</span>' : '') +
      '</div>' +
      PGRE.ui.meter(100 * session.i / session.qs.length, 'meter-thin') +
      '<div class="q-text">' + q.q + '</div>' +
      '<div class="choices">';
    q.choices.forEach(function (c, idx) {
      html += '<button class="choice" data-idx="' + idx + '" aria-pressed="false">' +
        '<span class="choice-letter">' + LETTERS[idx] + '</span><span class="choice-body">' + c + '</span></button>';
    });
    html += '</div>';
    html += '<div id="feedback"></div>' + paletteHTML(false) + '</div>' +
      '<div class="btn-row practice-actions">' +
        '<button type="button" class="btn btn-primary" id="confirm-btn" disabled>Confirm</button>' +
        '<span class="practice-keys muted">or double-click a choice' +
          (settings().keyboard
            ? ' · <span class="key-hint">A</span>–<span class="key-hint">E</span> select · <span class="key-hint">Enter</span> confirm'
            : '') +
        '</span></div></div>';
    el().innerHTML = html;
    PGRE.typesetMath(el());
    if (window.PGRE && PGRE.motion && PGRE.motion.animateMeter) {
      var mf = el().querySelector('.meter-thin .meter-fill');
      if (mf) PGRE.motion.animateMeter(mf, 100 * session.i / session.qs.length);
    }
    window.scrollTo(0, 0); // in-place swap: route()'s reset doesn't run here
    session.qStart = Date.now();
    startPaceTimer();
    saveSession();

    session.choiceCommit = PGRE.ui.bindChoiceCommit(el(), { onCommit: answer });
    bindLiveJumps();
    bindPlanReturn();
  }

  function renderAnsweredLive() {
    var q = session.qs[session.i];
    var ans = answerAt(session.i);
    if (!q || !ans) { renderQuestion(); return; }
    var t = PGRE.topicById(q.topic) || { id: 'xx', short: '?', name: 'Unknown topic' };
    session.stage = 'feedback';
    session.assess = null;
    session.choiceCommit = null;
    lastRenderAt = Date.now();
    clearPace();
    var html = '<div class="card practice-card practice-live">' +
      '<div class="practice-scroll">' +
      '<div class="practice-meta">' +
        '<span>Question ' + (session.i + 1) + ' of ' + session.qs.length + '</span>' +
        (session.label ? '<span class="chip chip-session">' + PGRE.ui.esc(session.label) + '</span>' : '') +
        '<span class="chip">' + t.name + '</span>' +
        '<span class="chip chip-diff">' + PGRE.ui.diffDots(q.difficulty) + '</span>' +
        planReturnLink() +
      '</div>' +
      PGRE.ui.meter(100 * session.i / session.qs.length, 'meter-thin') +
      '<div class="q-text">' + q.q + '</div>' +
      '<div class="choices">';
    q.choices.forEach(function (c, cidx) {
      var cls = 'choice';
      if (cidx === q.answer) cls += ' is-answer';
      if (cidx === ans.picked && !ans.correct) cls += ' is-wrong';
      html += '<button class="' + cls + '" disabled aria-pressed="' +
        (cidx === ans.picked ? 'true' : 'false') + '">' +
        '<span class="choice-letter">' + LETTERS[cidx] + '</span>' +
        '<span class="choice-body">' + c + '</span></button>';
    });
    html += '</div>';
    html += '<div id="feedback">' +
      '<div class="feedback reveal-in ' + (ans.correct ? 'feedback-good' : 'feedback-bad') + '">' +
        '<strong>' + (ans.correct ? correctTitle(q) : 'Incorrect — the answer is ' + LETTERS[q.answer]) + '</strong>' +
        (ans.xp != null ? '<span class="fb-xp">+' + ans.xp + ' XP</span>' : '') +
      '</div>' +
      (ans.ms != null ? paceMark(ans.ms) : '') +
      PGRE.assess.html(settings().keyboard) +
      '<div class="solution"><div class="solution-label">Solution</div>' + q.sol + '</div>' +
      distractorBlock(q) +
      notesBlock(q) +
      '</div>' + paletteHTML(false) + '</div>' +
      '<div class="btn-row practice-actions"><button class="btn btn-primary" id="next-btn">' +
        nextLabel() + '</button>' +
        (settings().keyboard ? '<span class="practice-keys muted"><span class="key-hint">Enter</span> next</span>' : '') +
      '</div></div>';
    el().innerHTML = html;
    PGRE.typesetMath(el());
    window.scrollTo(0, 0);
    var fb = document.getElementById('feedback');
    if (fb) {
      bindSessionAssess(fb, q, ans);
      bindNotes(fb, q);
    }
    saveSession();
    bindLiveJumps();
    bindPlanReturn();
    var nb = document.getElementById('next-btn');
    if (nb) {
      nb.addEventListener('click', next);
      try { nb.focus({ preventScroll: true }); } catch (e) { nb.focus(); }
    }
  }

  /* ——— Answer + feedback stage ——— */
  function answer(idx) {
    if (!session || session.stage !== 'question' || answerAt(session.i)) return;
    var q = session.qs[session.i];
    var isCorrect = idx === q.answer;
    var elapsed = Date.now() - session.qStart;
    clearPace();
    var xp = PGRE.gamify.recordAnswer(q, isCorrect, elapsed,
                                      { picked: idx, sid: session.sid, mode: 'practice' });
    var refused = xp === null;
    if (refused) xp = 0;
    session.xpEarned += xp;
    if (isCorrect) session.correct++;
    var attempts = (PGRE.store && PGRE.store.state && PGRE.store.state.attempts) || [];
    var row = attempts.length ? attempts[attempts.length - 1] : null;
    session.answers[session.i] = {
      q: q,
      picked: idx,
      correct: isCorrect,
      xp: xp,
      ms: elapsed,
      row: row
    };
    session.stage = 'feedback';
    paintPalette();

    el().querySelectorAll('.choice').forEach(function (b) {
      var i = parseInt(b.getAttribute('data-idx'), 10);
      b.disabled = true;
      b.classList.remove('is-picked');
      if (i === q.answer) {
        b.classList.add('is-answer');
        if (PGRE.motion && !PGRE.motion.reduced) b.classList.add('answer-settle');
      }
      if (i === idx && !isCorrect) {
        b.classList.add('is-wrong');
        if (PGRE.motion && !PGRE.motion.reduced) b.classList.add('answer-shake');
      }
      b.setAttribute('aria-pressed', i === idx ? 'true' : 'false');
    });

    var commitBar = el().querySelector('.practice-actions');
    if (commitBar && commitBar.parentNode) commitBar.parentNode.removeChild(commitBar);

    var fb = document.getElementById('feedback');
    fb.innerHTML =
      '<div class="feedback reveal-in ' + (isCorrect ? 'feedback-good' : 'feedback-bad') + '">' +
        '<strong>' + (isCorrect ? correctTitle(q) : 'Incorrect — the answer is ' + LETTERS[q.answer]) + '</strong>' +
        (refused
          ? '<span class="fb-xp">not recorded — saving failed</span>'
          : '<span class="fb-xp">+' + xp + ' XP</span>') +
      '</div>' +
      paceMark(elapsed) +
      PGRE.assess.html(settings().keyboard) +
      '<div class="solution"><div class="solution-label">Solution</div>' + q.sol + '</div>' +
      distractorBlock(q) +
      notesBlock(q);
    var card = el().querySelector('.practice-card');
    if (card) {
      card.insertAdjacentHTML('beforeend',
        '<div class="btn-row practice-actions"><button class="btn btn-primary" id="next-btn">' +
          nextLabel() + '</button>' +
          (settings().keyboard ? '<span class="practice-keys muted"><span class="key-hint">Enter</span> next</span>' : '') +
        '</div>');
    }
    PGRE.typesetMath(fb);
    bindSessionAssess(fb, q, session.answers[session.i]);
    bindNotes(fb, q);
    saveSession();
    if (sittingComplete()) persistAgentReceipt(buildAgentReceipt());
    if (window.PGRE && PGRE.motion && PGRE.motion.countUp) {
      var xpEl = fb.querySelector('.fb-xp');
      if (xpEl) PGRE.motion.countUp(xpEl, xp, { duration: 600, format: function (n) { return '+' + Math.round(n) + ' XP'; } });
    }
    if (PGRE.motion && !PGRE.motion.reduced) {
      var xpPop = fb.querySelector('.fb-xp');
      if (xpPop) xpPop.classList.add('xp-pop');
    }
    var nb = document.getElementById('next-btn');
    nb.addEventListener('click', next);
    // the action row is pinned to the bottom of the screen, so focusing Next
    // must not yank the page down past the feedback and solution
    try { nb.focus({ preventScroll: true }); } catch (e) { nb.focus(); }
  }

  /* Self-assessment (#6, multi-select): rendering, storage and the lucky-guess
     bookkeeping all live in the shared PGRE.assess component (js/app.js) —
     session.assess is the per-question controller it returns. */

  function next() {
    if (!session) return;
    if (session.i + 1 < session.qs.length) {
      openLive(session.i + 1);
      return;
    }
    var wrap = -1;
    for (var k = 0; k < session.qs.length; k++) {
      if (!answerAt(k)) { wrap = k; break; }
    }
    if (wrap >= 0) openLive(wrap);
    else renderSummary();
  }

  /* ——— Agent receipt (OrbitOS /practice-physics-gre-set log path) ———
     Builds a stable JSON payload the user copies into chat after a set.
     Durable write: sessionStorage + localStorage['pgre-agent-receipt'] +
     state.lastAgentReceipt (+ state.packReceipts[NN] for two-digit packs). */
  function sittingComplete(sess) {
    sess = sess || session;
    return !!(sess && sess.qs && sess.qs.length &&
              answeredCount(sess) === sess.qs.length);
  }

  function inferPackId(ids, label) {
    if (PGRE.PACKS && ids && ids.length) {
      for (var k in PGRE.PACKS) {
        if (!Object.prototype.hasOwnProperty.call(PGRE.PACKS, k)) continue;
        var p = PGRE.PACKS[k];
        if (p && p.ids && sameIds(p.ids, ids)) return k;
      }
    }
    var m = String(label || '').match(/\b(?:pack|set)\s*0*(\d{1,2})\b/i);
    if (!m) return null;
    var n = parseInt(m[1], 10);
    if (n < 1 || n > 35) return null;
    return n < 10 ? '0' + n : String(n);
  }

  function sessionSpanMin(sid) {
    var arr = (PGRE.store && PGRE.store.state && PGRE.store.state.sessions) || [];
    for (var i = arr.length - 1; i >= 0; i--) {
      if (arr[i].id !== sid) continue;
      if (!arr[i].startedAt || !arr[i].endedAt) return null;
      var ms = new Date(arr[i].endedAt) - new Date(arr[i].startedAt);
      if (!isFinite(ms) || ms < 0) return null;
      return Math.max(1, Math.round(ms / 60000));
    }
    return null;
  }

  function buildAgentReceipt() {
    if (!session) return null;
    var ids = session.qs.map(function (q) { return q.id; });
    var learn = !!session.learnDrill;
    var miss = session.answers.filter(function (a) { return !a.correct; }).map(function (a) {
      return {
        qid: a.q.id,
        topic: a.q.topic || null,
        picked: typeof a.picked === 'number' ? a.picked : null
      };
    });
    var n = session.qs.length;
    var correct = session.correct;
    var pct = n ? Math.round(100 * correct / n) : 0;
    var pack = inferPackId(ids, session.label);
    var durationMin = sessionSpanMin(session.sid);
    var receipt = {
      v: 1,
      kind: learn ? 'pgre-learn-drill-receipt' : 'pgre-agent-receipt',
      pack: learn ? null : pack,
      label: session.label || null,
      score: { correct: correct, n: n, pct: pct },
      durationMin: durationMin,
      // median seconds per answered question in this sitting (js/intensity.js)
      medianSec: PGRE.intensity ? PGRE.intensity.sessionMedianSec(session.answers) : null,
      missQids: miss.map(function (m) { return m.qid; }),
      misses: miss,
      ids: ids,
      origin: (typeof location !== 'undefined' && location.href) ? location.href.split('#')[0] : null,
      sessionId: session.sid || null,
      purpose: learn ? 'learn-drill' : null,
      topicIds: learn && Array.isArray(session.topicIds) ? session.topicIds.slice() : [],
      subtopics: learn && Array.isArray(session.subtopics) ? session.subtopics.slice() : [],
      concepts: learn && Array.isArray(session.concepts) ? session.concepts.slice() : [],
      weakSpots: learn && Array.isArray(session.weakSpots) ? session.weakSpots.slice() : [],
      difficulty: learn && session.difficulty != null ? session.difficulty : null,
      xp: session.xpEarned || 0,
      completedAt: new Date().toISOString()
    };
    if (learn) {
      receipt.questions = session.qs.map(function (q) {
        return {
          qid: q.id,
          topic: q.topic || null,
          subtopic: q.subtopic || null,
          prompt: q.q || '',
          choices: (q.choices || []).slice()
        };
      });
    }
    return receipt;
  }

  function persistAgentReceipt(receipt, sess) {
    sess = sess || session;
    if (!receipt || !sittingComplete(sess)) return;
    var json = JSON.stringify(receipt);
    var learn = receipt.kind === 'pgre-learn-drill-receipt';
    var key = learn ? 'pgre-learn-drill-receipt' : 'pgre-agent-receipt';
    try { sessionStorage.setItem(key, json); } catch (e) { /* quota / private mode */ }
    try { localStorage.setItem(key, json); } catch (e2) { /* quota / private mode */ }
    if (learn) return;
    var st = PGRE.store && PGRE.store.state;
    if (!st) return;
    st.lastAgentReceipt = receipt;
    var pack = receipt.pack;
    if (pack != null && /^\d{2}$/.test(String(pack))) {
      if (!st.packReceipts || typeof st.packReceipts !== 'object') st.packReceipts = {};
      st.packReceipts[String(pack)] = receipt;
    }
    PGRE.store.save();
  }


  function receiptFileName(receipt) {
    var day = '';
    if (PGRE.store && typeof PGRE.store.today === 'function') {
      day = String(PGRE.store.today()).replace(/-/g, '');
    }
    if (!/^\d{8}$/.test(day)) {
      var d = new Date();
      day = String(d.getFullYear()) +
        ('0' + (d.getMonth() + 1)).slice(-2) +
        ('0' + d.getDate()).slice(-2);
    }
    if (receipt && receipt.pack) return 'pgre-receipt-pack-' + receipt.pack + '-' + day + '.json';
    if (receipt && receipt.kind === 'pgre-learn-drill-receipt') return 'pgre-learn-drill-receipt-' + day + '.json';
    return 'pgre-receipt-' + day + '.json';
  }

  function downloadAgentReceipt(receipt) {
    if (!receipt) return;
    var blob = new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = receiptFileName(receipt);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  function copyAgentReceipt(receipt, btn) {
    var text = JSON.stringify(receipt, null, 2);
    function ok() {
      if (!btn) return;
      btn.textContent = 'Copied — paste in chat (“done” / log GRE set)';
      btn.classList.add('btn-ok');
      setTimeout(function () {
        btn.textContent = 'Copy agent receipt';
        btn.classList.remove('btn-ok');
      }, 3500);
    }
    function fail() {
      if (btn) btn.textContent = 'Copy failed — select JSON below';
      // last resort: show a selectable block once
      if (el().querySelector('#agent-receipt-fallback')) return;
      var pre = document.createElement('pre');
      pre.id = 'agent-receipt-fallback';
      pre.className = 'agent-receipt-fallback';
      pre.textContent = text;
      el().querySelector('.btn-row').insertAdjacentElement('afterend', pre);
      try {
        var range = document.createRange();
        range.selectNodeContents(pre);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (e2) { /* ignore */ }
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(ok).catch(function () {
        // file:// often blocks clipboard — execCommand fallback
        try {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          var worked = document.execCommand('copy');
          document.body.removeChild(ta);
          if (worked) ok(); else fail();
        } catch (e) { fail(); }
      });
      return;
    }
    try {
      var ta2 = document.createElement('textarea');
      ta2.value = text;
      ta2.setAttribute('readonly', '');
      ta2.style.position = 'fixed';
      ta2.style.left = '-9999px';
      document.body.appendChild(ta2);
      ta2.select();
      var worked2 = document.execCommand('copy');
      document.body.removeChild(ta2);
      if (worked2) ok(); else fail();
    } catch (e3) { fail(); }
  }

  /* ——— Question review (post-checkout box navigation) ———
     Card for any question completed in this session: choices with the user's
     pick and correct answer (not re-answerable), the grading chips with the
     review window (PGRE.assess review row — regrades, never a new attempt),
     solution, distractors, notes, and the palette grid for free jumping. Reuses .drill-navrow geometry from mistakes. */
  function renderReview(idx) {
    var s = currentSession();
    if (!s || idx < 0 || idx >= s.qs.length) return;
    var ans = answerAt(idx, s);
    if (!ans) return;
    if (s.reviewing && s.i === idx) return;
    clearPace();
    s.i = idx;
    s.stage = 'review';
    s.reviewing = true;
    lastRenderAt = Date.now();
    if (PGRE.nav) PGRE.nav.setTrail(['Review']);
    var q = s.qs[idx];
    var t = PGRE.topicById(q.topic) || { id: 'xx', short: '?', name: 'Unknown topic' };
    var prev = neighborAnswered(idx, -1);
    var next = neighborAnswered(idx, 1);
    var readonly = !!s.readonly;
    // The chips regrade the row this answer recorded. When that row is gone,
    // or the question was answered again since, the line stays read only.
    var liveRow = (!readonly && PGRE.assess) ? PGRE.assess.regradeRow(q.id, ans.row) : null;
    var regradable = !!liveRow;
    if (liveRow) ans.row = liveRow;
    s.assess = null;
    var title = ans.correct
      ? (readonly ? 'Correct' : correctTitle(q))
      : 'Incorrect — the answer is ' + LETTERS[q.answer];
    var gone = readonly && q.missing;
    var html = '<div class="card practice-card">' +
      '<div class="practice-meta">' +
        '<span>Review — ' + (idx + 1) + ' of ' + s.qs.length + '</span>' +
        (s.label ? '<span class="chip chip-session">' + PGRE.ui.esc(s.label) + '</span>' : '') +
        '<span class="chip">' + t.name + '</span>' +
        '<span class="chip chip-diff">' + PGRE.ui.diffDots(q.difficulty) + '</span>' +
        '<span class="chip">' + (ans.correct ? 'Correct' : 'Missed') + '</span>' +
        (ans.ms != null ? '<span class="chip">' + fmtAttemptMs(ans.ms) + '</span>' : '') +
        (readonly ? assessChipHTML(ans.row) : '') +
      '</div>';
    if (!gone) {
      html += '<div class="q-text">' + q.q + '</div>' +
        '<div class="choices">';
      q.choices.forEach(function (c, cidx) {
        var cls = 'choice';
        if (cidx === q.answer) cls += ' is-answer';
        if (cidx === ans.picked && !ans.correct) cls += ' is-wrong';
        html += '<button class="' + cls + '" disabled aria-pressed="' +
          (cidx === ans.picked ? 'true' : 'false') + '">' +
          '<span class="choice-letter">' + LETTERS[cidx] + '</span>' +
          '<span class="choice-body">' + c + '</span></button>';
      });
      html += '</div>';
    }
    html += '<div id="feedback">' +
        '<div class="feedback reveal-in ' + (ans.correct ? 'feedback-good' : 'feedback-bad') + '">' +
          '<span class="fb-icon">' + (ans.correct ? '✓' : '✗') + '</span>' +
          '<strong>' + title + '</strong>' +
          (ans.xp != null ? '<span class="fb-xp">+' + ans.xp + ' XP</span>' : '') +
        '</div>' +
        ((!readonly && ans.ms != null) ? paceMark(ans.ms) : '') +
        (readonly ? '' : (regradable ? PGRE.assess.html(settings().keyboard, { review: true }) : reviewAssessNote(ans)));
    if (gone) {
      html += missingBankNote(q, ans);
    } else if (q.missing) {
      html += '<p class="muted" id="missing-q-note">This question is no longer in the bank. ' +
        'The original wording and solution are not stored.</p>';
    } else {
      html += '<div class="solution"><div class="solution-label">Solution</div>' + q.sol + '</div>' +
        distractorBlock(q) +
        (readonly ? '' : notesBlock(q));
    }
    html += '</div>' +
      '<div class="btn-row drill-navrow">' +
        '<button class="btn btn-ghost" id="review-prev" title="Previous question (Left arrow)"' +
          (prev < 0 ? ' disabled' : '') + '>← Back</button>' +
        '<button class="btn btn-ghost" id="review-next" title="Next question (Right arrow or Enter)"' +
          (next < 0 ? ' disabled' : '') + '>Next →</button>' +
        '<button class="btn btn-primary drill-finish" id="review-summary">Back to results</button>' +
      '</div>' +
      paletteHTML(true, idx) +
      '</div>';
    el().innerHTML = html;
    PGRE.typesetMath(el());
    window.scrollTo(0, 0);
    var fb = document.getElementById('feedback');
    if (fb && !readonly) {
      if (regradable) bindSessionAssess(fb, q, ans);
      bindNotes(fb, q);
    }
    document.getElementById('review-prev').addEventListener('click', function () {
      if (prev >= 0) renderReview(prev);
    });
    document.getElementById('review-next').addEventListener('click', function () {
      if (next >= 0) renderReview(next);
    });
    document.getElementById('review-summary').addEventListener('click', renderSummary);
    bindReviewJumps();
  }

  /* ——— Summary: instant intensity feedback ———
     Two banded lines (js/intensity.js): this sitting's median seconds per
     answered question against the 103 s exam pace, and today's Daily work
     (mistake-book retakes) against the daily target. The second line reads
     the same PGRE.intensity.compute() as the dashboard Intensity card, after
     this sitting's attempts are already in the log. */
  function intensityLineHTML(key, label, note, value, bandName, chipText) {
    return '<div class="intensity-line" data-line="' + key + '" data-band="' + (bandName || 'none') + '">' +
      '<span class="intensity-line-label">' + label +
        (note ? ' <span class="intensity-line-note">' + PGRE.ui.esc(note) + '</span>' : '') + '</span>' +
      '<span class="intensity-line-value">' + value + '</span>' +
      PGRE.intensity.chipHTML(bandName, chipText) +
    '</div>';
  }

  function intensitySummaryHTML(isPack) {
    var I = PGRE.intensity;
    if (!I) return '';
    var med = I.sessionMedianSec(session.answers);
    var today = I.compute(PGRE.store.state);
    var work = today.dailyWork;
    return '<div class="intensity-summary" id="intensity-summary">' +
      intensityLineHTML('pace', 'Median seconds per question', isPack ? 'this pack' : 'this set',
        (med == null ? '—' : med) + ' / ' + I.THRESHOLDS.paceSec.green, I.band('paceSec', med)) +
      intensityLineHTML('work', 'Mistake book today', work.mocks.length ? 'full mock submitted' : 'retakes',
        work.value + (work.threshold == null ? '' : ' / ' + work.threshold), work.band,
        work.band ? null : 'No target') +
      // data-dash-focus: the archive page lands on this card, not on its top
      '<a class="intensity-summary-link" href="#/plan" data-dash-focus="intensity-card">Intensity in the exam archive →</a>' +
    '</div>';
  }

  /* ——— Summary ——— */
  function renderSummary() {
    var s = currentSession();
    if (!s) return;
    clearPace();
    if (PGRE.nav) PGRE.nav.setTrail([]);
    s.stage = 'summary';
    s.reviewing = false;
    s.assess = null;
    var readonly = !!s.readonly;
    lastRenderAt = Date.now();
    var receipt = null, pack = null, isPack = false, isLearnDrill = false, planLine = '';
    if (!readonly) {
      clearSaved();
      var firstClose = !s.done;
      s.done = true;
      receipt = buildAgentReceipt();
      persistAgentReceipt(receipt);
      pack = receipt.pack;
      isPack = pack != null && /^\d{2}$/.test(String(pack));
      isLearnDrill = !!s.learnDrill;
      if (firstClose) {
        PGRE.gamify.endSession(s.sid);
        PGRE.gamify.recordSession(s.qs.length, s.correct);
        if (isPack) {
          var taskId = 'set-' + pack;
          var already = PGRE.gamify.taskDone(taskId);
          if (!already) {
            var xpKind = 'timed';
            var cw = PGRE.currentWeek();
            var weekTasks = PGRE.weekTasks(cw && cw.week);
            for (var wi = 0; wi < weekTasks.length; wi++) {
              if (weekTasks[wi].id === taskId && weekTasks[wi].kind === 'extra-set') {
                xpKind = 'extra-set';
                break;
              }
            }
            PGRE.gamify.toggleTask(taskId, PGRE.planSetXp(xpKind));
          }
          s.alreadyPlan = already;
        }
      }
      if (isPack || isLearnDrill) {
        planLine = isPack
          ? (s.alreadyPlan
            ? 'Set ' + pack + ' was already done in your plan.'
            : 'Set ' + pack + ' marked done in your plan.')
          : 'Learn transfer complete; timed-pack progress was not changed.';
      }
    }
    var nQ = s.qs.length;
    var pct = nQ ? Math.round(100 * s.correct / nQ) : 0;
    var verdict = pct === 100 ? 'Flawless.' :
                  pct >= 80 ? 'Strong work.' :
                  pct >= 60 ? 'Solid — review the misses below.' :
                  'Rough set — the reworking is where the learning happens.';
    var heading = readonly
      ? recordKicker(s.sess, 'Practice', practiceRecordExtra(s))
      : '<h1>Session complete</h1>';

    var html = '<div class="card practice-card">' +
      heading +
      ((!readonly && s.label) ? '<p class="muted session-label-line">' + PGRE.ui.esc(s.label) + '</p>' : '') +
      (nQ
        ? '<div class="summary-score">' + s.correct + ' / ' + nQ +
            '<span class="summary-pct">' + pct + '%</span></div>' +
          '<p class="muted">' + verdict + ' You earned <strong>' + s.xpEarned + ' XP</strong> this session.</p>'
        : '<p class="muted">You did not answer anything this time — nothing was recorded for this set.</p>');
    if (!readonly) {
      if (planLine) html += '<p class="muted">' + planLine + '</p>';
      html += intensitySummaryHTML(isPack);
    }
    html += paletteHTML(true);

    var misses = (s.answers || []).filter(function (a) { return a && !a.correct; });
    if (misses.length) {
      html += '<h2>Review your misses</h2>';
      misses.forEach(function (a) {
        // One wrapper child: the summary is a flex row, so bare text runs and
        // math spans would each become their own column.
        html += '<details class="miss"><summary><span class="miss-title">' + a.q.q + '</span></summary>' +
          '<div class="solution"><div class="solution-label">Solution</div>' + a.q.sol + '</div></details>';
      });
    }
    var custom = s.custom;
    var backLink = custom ? '#/build' : (s.topicId === 'all' ? '#/' : '#/topic/' + s.topicId);
    if (isPack) backLink = '#/plan';
    html += '<div class="btn-row">';
    if (readonly) {
      html += '<a class="btn btn-primary" id="back-history" href="#/history">Back to History</a>';
    } else {
      html += '<button class="btn btn-primary" id="again-btn">' +
        (custom ? (s.criteria ? 'Draw a fresh set' : 'Run this set again') : 'Practice again') + '</button>';
      if (isPack || isLearnDrill) {
        html +=
          '<button class="btn btn-ghost" type="button" id="agent-receipt-btn" title="Copy JSON for the Learn session or OrbitOS agent log">' +
            'Copy agent receipt</button>' +
          '<button class="btn btn-ghost" type="button" id="agent-receipt-download-btn" title="Download JSON receipt">' +
            'Download .json</button>';
      }
      html += '<a class="btn btn-ghost" href="' + backLink + '">Done</a>';
    }
    html += '</div>';
    if (!readonly && (isPack || isLearnDrill)) {
      html += '<p class="muted agent-receipt-hint">' +
        (isPack
          ? 'Your plan task here is already ticked. To log this set in the OrbitOS vault too (daily note and misses log), copy or download the receipt and say you are done in chat, or paste the JSON.'
          : 'Copy or download the receipt and return it to the Learn session so the tutor can record the transfer result and rework any misses.') +
        '</p>';
    }
    html += '</div>';
    var topicId = s.topicId, filter = s.filter;
    el().innerHTML = html;
    PGRE.typesetMath(el());
    if (window.PGRE && PGRE.motion && PGRE.motion.countUp) {
      var pctEl = el().querySelector('.summary-pct');
      if (pctEl) PGRE.motion.countUp(pctEl, pct, { duration: 900, format: function (n) { return Math.round(n) + '%'; } });
    }
    var againBtn = document.getElementById('again-btn');
    if (againBtn) againBtn.addEventListener('click', function () {
      if (Date.now() - lastRenderAt < 300) return; // Finish double-click guard
      if (custom) startCustom(true);
      else renderConfig(topicId, filter);
    });
    var receiptBtn = document.getElementById('agent-receipt-btn');
    if (receiptBtn && receipt) {
      receiptBtn.addEventListener('click', function () {
        if (Date.now() - lastRenderAt < 300) return;
        persistAgentReceipt(receipt);
        copyAgentReceipt(receipt, receiptBtn);
      });
    }
    var dlBtn = document.getElementById('agent-receipt-download-btn');
    if (dlBtn && receipt) {
      dlBtn.addEventListener('click', function () {
        if (Date.now() - lastRenderAt < 300) return;
        persistAgentReceipt(receipt);
        downloadAgentReceipt(receipt);
      });
    }
    bindReviewJumps();
  }

  /* ——— Keyboard-first practice (#14) ——— */
  var REVIEW_ASSESS_KEYS = { k: 'sure', g: 'guess', t: 'slow', f: 'forgot', r: 'stuck' };
  function onKey(e) {
    if (!settings().keyboard) return;
    var s = currentSession();
    if (!s) return;
    if (!document.getElementById('practice-root')) return; // not on the practice view
    var tg = (e.target && e.target.tagName) || '';
    if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT' ||
        (e.target && e.target.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key;

    if (s.readonly) {
      if (s.stage === 'review') {
        if (k === 'ArrowLeft') {
          var prevR = neighborAnswered(s.i, -1);
          if (prevR >= 0) { e.preventDefault(); renderReview(prevR); }
        } else if (k === 'ArrowRight') {
          var nextR = neighborAnswered(s.i, 1);
          if (nextR >= 0) { e.preventDefault(); renderReview(nextR); }
        } else if (k === 'Enter' && !PGRE.enterPressesControl()) {
          e.preventDefault();
          var afterR = neighborAnswered(s.i, 1);
          if (afterR >= 0) renderReview(afterR);
        } else if (k === 'Escape') {
          e.preventDefault();
          renderSummary();
        }
      }
      return;
    }
    if (!session) return;

    if (session.stage === 'question') {
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        var step = k === 'ArrowLeft' ? -1 : 1;
        var target = session.i + step;
        if (target >= 0 && target < session.qs.length) {
          e.preventDefault();
          openLive(target);
        }
        return;
      }
      var idx = -1;
      if (/^[a-eA-E]$/.test(k)) idx = k.toUpperCase().charCodeAt(0) - 65;
      else if (/^[1-5]$/.test(k)) idx = parseInt(k, 10) - 1;
      if (idx >= 0 && idx < session.qs[session.i].choices.length) {
        e.preventDefault();
        if (session.choiceCommit) session.choiceCommit.select(idx);
      } else if (k === 'Enter') {
        e.preventDefault();
        if (session.choiceCommit) session.choiceCommit.commit();
      }
    } else if (session.stage === 'feedback') {
      if (k === 'Enter' || k === ' ' || k === 'n' || k === 'N') {
        // Enter/Space on the focused Next button advances natively — don't double-fire.
        if ((k === 'Enter' || k === ' ') &&
            document.activeElement && document.activeElement.id === 'next-btn') return;
        e.preventDefault();
        var nb = document.getElementById('next-btn');
        if (nb) nb.click();
      } else if (session.assess && (k === 'g' || k === 'G')) {
        e.preventDefault(); session.assess.toggle('guess');
      } else if (session.assess && (k === 'k' || k === 'K')) {
        e.preventDefault(); session.assess.toggle('sure');
      } else if (session.assess && (k === 't' || k === 'T')) {
        e.preventDefault(); session.assess.toggle('slow');
      } else if (session.assess && (k === 'f' || k === 'F')) {
        e.preventDefault(); session.assess.toggle('forgot');
      } else if (session.assess && (k === 'r' || k === 'R')) {
        e.preventDefault(); session.assess.requestToggle('stuck');
      }
    } else if (session.stage === 'review') {
      if (k === 'ArrowLeft') {
        var prev = neighborAnswered(session.i, -1);
        if (prev >= 0) { e.preventDefault(); renderReview(prev); }
      } else if (k === 'ArrowRight') {
        var next = neighborAnswered(session.i, 1);
        if (next >= 0) { e.preventDefault(); renderReview(next); }
      } else if (k === 'Enter' && !PGRE.enterPressesControl()) {
        // on the last question too: Enter must not press a tag that a click left focused
        e.preventDefault();
        var after = neighborAnswered(session.i, 1);
        if (after >= 0) renderReview(after);
      } else if (k === 'Escape') {
        e.preventDefault();
        renderSummary();
      } else if (session.assess && REVIEW_ASSESS_KEYS[String(k).toLowerCase()]) {
        // same letters as the answer page: K G T F toggle, R asks first
        e.preventDefault();
        session.assess.requestToggle(REVIEW_ASSESS_KEYS[String(k).toLowerCase()]);
      }
    }
  }

  return {
    render: function () { return '<div id="practice-root"></div>'; },
    mount: function (params) {
      clearPace();
      if (!keyBound) { document.addEventListener('keydown', onKey); keyBound = true; }
      if (params && params.id === 'session' && params.sub2) {
        // History reconstruction: leave the live / parked set exactly as it is.
        openArchive(params.sub2);
        return;
      }
      archive = null;
      session = null;
      // one-shot flag the parked-session drawer sets before navigating here
      try {
        autoResume = !!sessionStorage.getItem(
          (PGRE.sessionPark && PGRE.sessionPark.RESUME_KEY) || 'pgre-practice-resume');
        sessionStorage.removeItem(
          (PGRE.sessionPark && PGRE.sessionPark.RESUME_KEY) || 'pgre-practice-resume');
      } catch (e) { autoResume = false; }
      var id = params.id || 'all';
      if (id === 'custom') startCustom();
      else if (id === 'pack') {
        // #/practice/pack/<NN> writes the pack config and jumps to custom.
        if (PGRE.launchPack(params.sub2)) return;
        renderNoCustom();
      } else renderConfig(id, params.sub2); // #/practice/<id>/new | /done
    },
    persistAgentReceipt: persistAgentReceipt,
    inferPackId: inferPackId,
    sittingComplete: sittingComplete,
    _test: {
      reconstructArchive: reconstructArchive,
      get session() { return session; },
      get archive() { return archive; }
    }
  };
})();
