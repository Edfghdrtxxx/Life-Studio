/* Timed mock-exam simulator — setup, exam room, and results/review.
   The scoring/draw model is js/exam-engine.js; this file is the UI: the
   full-screen exam room (countdown, palette, flags, pause, no feedback until
   submit), a custom in-page submit modal, resume-on-reload, and the per-topic
   + question-by-question results screen. Routes (app.js passes sub/sub2):
     #/exam                → setup + history
     #/exam/run            → the active sitting
     #/exam/review/<id>    → results for a submitted exam */
window.PGRE = window.PGRE || {};
PGRE.views = PGRE.views || {};

/* Fallback loader only: index.html lists js/exam-engine.js right before this
   file, so the guard below always finds PGRE.examEngine already present and
   the injector never runs. Kept as a defensive no-op should that <script>
   tag ever disappear. */
(function () {
  if (PGRE.examEngine) return;
  PGRE._examReadyQ = PGRE._examReadyQ || [];
  if (!document.querySelector('script[data-exam-engine]')) {
    var el = document.createElement('script');
    el.src = 'js/exam-engine.js';
    el.setAttribute('data-exam-engine', '1');
    el.onerror = function () { console.error('exam-engine failed to load'); };
    document.head.appendChild(el);
  }
})();

PGRE.views.exam = (function () {
  var LETTERS = ['A', 'B', 'C', 'D', 'E'];
  var timer = null;      // setInterval handle for the countdown
  var lastPersist = 0;   // throttle durationSec writes
  var lastTickAt = 0;    // wall-clock anchor so background-tab throttling can't buy free time
  var meterAnimated = false;  // animateMeter on first paint only — later paints set width

  function motionViewEnter() {
    if (window.PGRE && PGRE.motion && PGRE.motion.viewEnter) {
      PGRE.motion.viewEnter(document.getElementById('view'));
    }
  }

  function whenEngine(cb) {
    if (PGRE.examEngine) { cb(); return; }
    (PGRE._examReadyQ = PGRE._examReadyQ || []).push(cb);
  }

  function root() { return document.getElementById('exam-root'); }

  /* ——— Full-screen takeover + timer lifecycle ——— */
  function setFullscreen(on) { document.body.classList.toggle('exam-fullscreen', !!on); }
  function stopTimer() {
    if (timer) { clearInterval(timer); timer = null; }
    dwellStop();
  }
  function leaveRoom() { stopTimer(); setFullscreen(false); }

  /* ——— Per-question time (model: examEngine.dwellSync, exam.qSec) ———
     The question on screen is timed while the clock runs and the tab is
     visible. Every change that can start or stop that goes through here:
     the countdown starting or stopping (Pause, Resume, leaving the room,
     Submit), another question, and the tab being hidden or shown. */
  function tabVisible() { return !document.hidden; }
  function dwellSync(exam) {
    var eng = PGRE.examEngine;
    if (!eng || typeof eng.dwellSync !== 'function') return;
    eng.dwellSync(exam, { running: !!timer, visible: tabVisible() }, Date.now());
  }
  function dwellStop() {
    var eng = PGRE.examEngine;
    if (eng && typeof eng.dwellClose === 'function') eng.dwellClose(Date.now());
  }

  /* Clean up the takeover whenever we navigate away from the sitting. */
  window.addEventListener('hashchange', function () {
    if (!/^#\/exam\/run\b/.test(location.hash)) leaveRoom();
  });
  window.addEventListener('pagehide', function () {
    var ex = PGRE.examEngine && PGRE.examEngine.active();
    if (ex) { dwellStop(); PGRE.store.save(); } // last unsaved seconds survive a reload
  });
  /* A page restored from the back/forward cache starts counting again. */
  window.addEventListener('pageshow', function (e) {
    if (!e || !e.persisted || !document.body.classList.contains('exam-fullscreen')) return;
    var ex = PGRE.examEngine && PGRE.examEngine.active();
    if (ex) dwellSync(ex);
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.body.classList.contains('exam-fullscreen')) return;
    var ex = PGRE.examEngine && PGRE.examEngine.active();
    if (ex) dwellSync(ex);
  });

  /* Keyboard: A–E / 1–5 to (de)select, ←/→ to navigate, Enter for the next
     question, F to flag, P to pause, T to open/close the Table of
     Information. Registered once; only acts inside the room. Modal keys
     (Esc / Enter) share the existing hide/resume/confirm handlers. T does
     not collide with those keys. */
  document.addEventListener('keydown', function (e) {
    if (!document.body.classList.contains('exam-fullscreen')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return; // ⌘C / ⌘F etc. must never answer or flag
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    var host = document.getElementById('exam-modal-host');
    var modalOpen = !!(host && host.firstChild);
    var exam = PGRE.examEngine && PGRE.examEngine.active();
    if (!exam) return;
    var k = e.key;
    if (exam.paused && (k === 't' || k === 'T')) {
      e.preventDefault();
      return;
    }
    if (tableIsOpen()) {
      if (k === 'Escape' || k === 't' || k === 'T') {
        e.preventDefault();
        hideTable();
      } else {
        e.preventDefault();
      }
      return;
    }
    if (modalOpen) {
      if (k === 'Escape') {
        e.preventDefault();
        if (exam.paused) togglePause(exam);
        else hideModal();
      } else if (k === 'Enter' && host.querySelector('#exam-confirm')) {
        var ae = document.activeElement;
        if (ae && (ae.id === 'exam-confirm' || ae.id === 'exam-cancel')) return;
        e.preventDefault();
        doSubmit(exam, false);
      }
      return;
    }
    if (exam.paused) return;
    if (k === 't' || k === 'T') {
      e.preventDefault();
      showTable();
      return;
    }
    if (/^[a-eA-E]$/.test(k) || /^[1-5]$/.test(k)) {
      var idx = /^[1-5]$/.test(k) ? parseInt(k, 10) - 1 : k.toUpperCase().charCodeAt(0) - 65;
      var q = PGRE.questionById(exam.order[exam.cursor]);
      if (q && idx < q.choices.length) { selectAnswer(exam, idx); e.preventDefault(); }
    } else if (k === 'ArrowRight' && exam.cursor < exam.order.length - 1) {
      goTo(exam, exam.cursor + 1); e.preventDefault();
    } else if (k === 'ArrowLeft' && exam.cursor > 0) {
      goTo(exam, exam.cursor - 1); e.preventDefault();
    } else if (k === 'Enter' && !PGRE.enterPressesControl()) {
      // on the last question too: Enter must not press a clicked choice again, which would clear the answer
      e.preventDefault();
      if (exam.cursor < exam.order.length - 1) goTo(exam, exam.cursor + 1);
    } else if (k === 'f' || k === 'F') {
      toggleFlag(exam); e.preventDefault();
    } else if (k === 'p' || k === 'P') {
      togglePause(exam); e.preventDefault();
    }
  });

  /* ——— Small format helpers ——— */
  function fmtClock(sec) {
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var mm = (h ? String(m).padStart(2, '0') : String(m));
    return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
  }
  function fmtDate(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' +
           d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  function fmtDur(sec) {
    var m = Math.round(sec / 60);
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  }
  function todayIso() {
    var d = new Date();
    function pad(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function scheduleLabel(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T12:00:00');
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  }

  function isScheduledLater(iso) {
    return !!iso && todayIso() < iso;
  }

  function answeredCount(exam) {
    return exam.order.filter(function (qid) { return exam.answers[qid] != null; }).length;
  }

  /* ——————————————————————————— Setup ——————————————————————————— */
  function renderSetup() {
    leaveRoom();
    if (PGRE.nav) PGRE.nav.setTrail([]);   // BUNDLE G: setup is the base exam screen
    var eng = PGRE.examEngine, ui = PGRE.ui;
    var act = eng.active();
    // the number the weighted draw actually samples from: unsat intact exams
    // stay out (spoiler rule); submitted exams join the default pool
    var pool = eng.poolSize();
    var need70 = eng.FORMAT_META['70x120'].questions;
    var bookExams = PGRE.BOOK_EXAMS || [];
    var etsExams = PGRE.ETS_EXAMS || [];
    var nPreview = 0, nBook = 0, nDrill = 0, nCpgExam = 0, nEtsExam = 0;
    (PGRE.allQuestions({ includeExam: true }) || []).forEach(function (q) {
      // a cross-form duplicate is counted once, as its canonical question
      if (!q || PGRE.isDuplicateQuestion(q)) return;
      if (q.src === 'preview') nPreview++;
      else if (q.src === 'cpg') nBook++;
      else if (q.src === 'ets-drill') nDrill++;
      else if (q.src === 'ets-exam') nEtsExam++;
      else if (q.src === 'cpg-exam') nCpgExam++;
    });
    var nSatCpg = 0, nSatEts = 0;
    (PGRE.allQuestions() || []).forEach(function (q) {
      if (!q) return;
      if (q.src === 'cpg-exam') nSatCpg++;
      else if (q.src === 'ets-exam') nSatEts++;
    });
    var satN = nSatCpg + nSatEts;
    var nUnsatCpg = Math.max(0, nCpgExam - nSatCpg);
    var nUnsatEts = Math.max(0, nEtsExam - nSatEts);
    var dailyN = nPreview + nBook + nDrill;
    // same pointer the dashboard's Today card shows — the next unused real exam
    var next = PGRE.nextMockPointer ? PGRE.nextMockPointer() : null;
    var nextExam = next && eng.examById(next.id);

    var html = '<div class="card page-head"><h1>Mock exams</h1>' +
      '<p class="muted">Countdown clock, question palette and flags, with ' +
      '<strong>no feedback until you submit</strong>. Each sitting is scored and feeds ' +
      '<a href="#/analytics">Analytics</a> and the <a href="#/mistakes">mistake book</a>.</p></div>';

    if (act) {
      var doneN = answeredCount(act);
      var remain = Math.max(0, act.limitSec - act.durationSec);
      html += '<div class="card exam-resume">' +
        '<h2>Resume your sitting</h2>' +
        '<p class="muted">A ' + eng.FORMAT_META[act.format].label + ' exam is in progress — ' +
        doneN + ' of ' + act.order.length + ' answered, ' + fmtClock(remain) + ' on the clock' +
        (act.paused ? ' (paused)' : '') + '.</p>' +
        '<div class="btn-row">' +
          '<button class="btn btn-primary" id="exam-resume-go">Resume exam</button>' +
          '<button class="btn btn-danger-ghost" id="exam-resume-drop">Discard it</button>' +
        '</div></div>';
    }

    // Past sittings first (design §6.11 / A29): the archive is the record;
    // replays sit below.
    html += historyCard();
    // Protect the next intact form until its scheduled diagnostic date. The
    // current-format draw remains the safe practice path in the meantime.
    if (nextExam) {
      var nfm = eng.FORMAT_META[nextExam.format];
      var locked = isScheduledLater(next && next.scheduledFor);
      var scheduleNote = locked
        ? ' It is scheduled for ' + scheduleLabel(next.scheduledFor) + '; use the practice set below until then.'
        : '';
      html += '<div class="card exam-format exam-next-mock">' +
        '<div class="exam-format-head"><h2>' + (locked ? 'Next scheduled mock' : 'Your next mock') + '</h2>' +
        '<span class="chip">' + (nfm ? ui.esc(nfm.label) : 'official') + '</span></div>' +
        '<p class="muted">The next real exam you have not sat: <strong>' + ui.esc(next.title) +
        '</strong>. Replayed word for word and scored with the official answer key and ' +
        'ETS’s own published raw-to-scaled table.' + scheduleNote + '</p>' +
        '<div class="btn-row"><button class="btn ' + (locked ? 'btn-ghost' : 'btn-primary') +
        '" data-replay="' + ui.esc(nextExam.id) + '"' +
        (act || locked ? ' disabled' : '') + '>' +
        (locked ? 'Unlocks ' + ui.esc(scheduleLabel(next.scheduledFor)) : 'Start ' + ui.esc(next.title)) +
        '</button></div></div>';
    }

    // Other released ETS exams — verbatim replay, official key + published scaling
    var otherEts = etsExams.filter(function (ex) { return !(nextExam && ex && ex.id === nextExam.id); });
    html += '<div class="card exam-format">' +
      '<div class="exam-format-head"><h2>' + (nextExam ? 'Other released ETS exams' : 'Released ETS exams') + '</h2>' +
      '<span class="chip">official</span></div>' +
      '<p class="muted">Verbatim replays of real exams released by ETS, scored with the official ' +
      'answer key and each exam’s own published raw→scaled table. The exam PDFs stay local-only ' +
      '(ETS copyright — link, don’t republish); sources are listed in the project’s ' +
      'Practice Resources doc.</p>';
    if (otherEts.length) {
      html += '<div class="btn-row">';
      otherEts.forEach(function (ex) {
        var fm = eng.FORMAT_META[ex.format];
        html += '<button class="btn btn-ghost" data-replay="' + ui.esc(ex.id) + '"' +
          (act ? ' disabled' : '') + ' title="' + (fm ? ui.esc(fm.label) : '') + '">' +
          ui.esc(ex.title || ex.id) + '</button>';
      });
      html += '</div>';
    } else if (!etsExams.length) {
      html += '<div class="exam-empty">' +
        '<div><strong>No released exams imported yet.</strong> ' +
        '<span class="muted">They unlock once the extraction pipeline fills ' +
        'content/bank/ets-exams.js from the local exam PDFs.</span></div></div>';
    } else {
      html += '<p class="muted">Every other released exam has been sat — replay one from ' +
        'your past simulations below.</p>';
    }
    html += '</div>';

    // Secondary: a randomised 70-question set in the current format
    html += '<div class="card exam-format">' +
      '<div class="exam-format-head"><h2>Practice set in the current format</h2>' +
      '<span class="chip">70 questions · 120 min</span></div>' +
      '<p class="muted">A random draw across the nine topics at their official exam ' +
      'weights (CM 20 · EM 18 · QM 13 · TS 10 · AP 10 · ST 9 · OW 8 · SR 6 · LM 6), preferring ' +
      'questions you have not seen. The drawable pool is ' + pool + ' question' +
      (pool === 1 ? '' : 's') + ': ' + dailyN + ' in the daily pool (' +
      nPreview + ' preview + ' + nBook + ' book + ' + nDrill + ' drill)' +
      (satN ? (' plus ' + satN + ' from exams already sat') : '') + '. ' +
      nUnsatCpg + ' unsat book sample-exam question' + (nUnsatCpg === 1 ? '' : 's') +
      ' and ' + nUnsatEts + ' unsat released-ETS question' + (nUnsatEts === 1 ? '' : 's') +
      ' stay reserved for verbatim replay until those exams are submitted.</p>';
    if (pool >= need70) {
      html += '<div class="btn-row"><button class="btn ' +
        (nextExam && isScheduledLater(next && next.scheduledFor) ? 'btn-primary' : 'btn-ghost') +
        '" id="start-70"' +
        (act ? ' disabled' : '') + '>Start a 70-question set</button></div>';
    } else {
      html += bankNotReady(need70, pool, false);
    }
    html += '</div>';

    // Legacy format — verbatim sample-exam replay
    html += '<div class="card exam-format">' +
      '<div class="exam-format-head"><h2>Legacy format</h2>' +
      '<span class="chip">100 questions · 170 min</span></div>' +
      '<p class="muted">Replays a full released-style sample exam verbatim, in book order — ' +
      'matching the 100-question paper diagnostic (Oct 4, GR0177/GR0877) your <a href="#/plan">study plan</a> ' +
      'schedules — the Oct 25 rehearsal uses the 70-question format above.</p>';
    if (bookExams.length) {
      html += '<div class="btn-row">';
      bookExams.forEach(function (ex, i) {
        html += '<button class="btn btn-ghost" data-replay="' + ui.esc(ex.id || ('x' + (i + 1))) + '"' +
          (act ? ' disabled' : '') + '>' + ui.esc(ex.title || ('Sample Exam ' + (i + 1))) + '</button>';
      });
      html += '</div>';
    } else {
      html += bankNotReady(100, 0, true);
    }
    html += '</div>';
    root().innerHTML = html;
    PGRE.typesetMath(root());

    var g;
    if ((g = document.getElementById('exam-resume-go'))) g.addEventListener('click', function () { location.hash = '#/exam/run'; });
    if ((g = document.getElementById('exam-resume-drop'))) g.addEventListener('click', function () {
      eng.discard(act); PGRE.toast('In-progress exam discarded.', 'info'); renderSetup();
    });
    if ((g = document.getElementById('start-70'))) g.addEventListener('click', function () { startExam({ format: '70x120' }); });
    root().querySelectorAll('[data-replay]').forEach(function (b) {
      b.addEventListener('click', function () {
        // the engine resolves the exam id and takes the exam's own format
        startExam({ source: b.getAttribute('data-replay') });
      });
    });
    motionViewEnter();
  }

  function bankNotReady(need, have, legacy) {
    return '<div class="exam-empty">' +
      '<div><strong>Bank not imported yet.</strong> ' +
      '<span class="muted">' + (legacy
        ? 'No sample exams are in the bank. This format unlocks once the book’s sample exams are imported into content/bank/.'
        : 'This format needs ' + need + ' questions; the bank currently has ' + have +
          '. It unlocks once the book question bank is imported.') +
      '</span></div></div>';
  }

  function historyCard() {
    var eng = PGRE.examEngine, hist = eng.history();
    var html = '<div class="card"><h2>Past simulations</h2>';
    if (!hist.length) {
      html += '<p class="muted">No mock exams yet. Completed simulations are listed here with ' +
        'scores and a full review.</p>';
    } else {
      html += '<div class="exam-hist-rows">';
      hist.forEach(function (x) {
        var pct = x.total ? Math.round(100 * x.raw / x.total) : 0;
        var scale = eng.scaleDisplay ? eng.scaleDisplay(x) : { scaled: x.scaledEst, official: !!x.scaledOfficial };
        html += '<a class="exam-hist-row" href="#/exam/review/' + PGRE.ui.esc(x.id) + '">' +
          '<span class="exam-hist-when">' + fmtDate(x.submittedAt) + '</span>' +
          '<span class="chip">' + eng.FORMAT_META[x.format].label + '</span>' +
          '<span class="exam-hist-score">' + x.raw + ' / ' + x.total + ' · ' + pct + '%</span>' +
          '<span class="exam-hist-scaled">' + (scale.official ? '' : '~') + scale.scaled + ' scaled</span>' +
        '</a>';
      });
      html += '</div>';
    }
    return html + '</div>';
  }

  function startExam(config) {
    var exam = PGRE.examEngine.create(config);
    if (!exam) { PGRE.toast('Could not build this exam — the bank is too small.', 'error'); return; }
    location.hash = '#/exam/run'; // routes to the room
  }

  /* ——————————————————————————— Exam room ——————————————————————————— */
  function renderRoom() {
    var exam = PGRE.examEngine.active();
    if (!exam) { location.hash = '#/exam'; return; }
    setFullscreen(true);

    var eng = PGRE.examEngine;
    root().innerHTML =
      '<div class="exam-room">' +
        '<div class="exam-bar">' +
          '<div class="exam-bar-left">' +
            '<span class="exam-title">' + PGRE.ui.esc(exam.title || 'Mock exam') + '</span>' +
            '<span class="chip">' + eng.FORMAT_META[exam.format].label + '</span>' +
          '</div>' +
          '<div class="exam-timer" id="exam-timer" role="timer" aria-live="off">–:––</div>' +
          '<div class="exam-bar-right">' +
            PGRE.ui.meter(0, 'meter-thin exam-progress-meter') +
            '<span class="exam-progress" id="exam-progress"></span>' +
            '<button class="btn btn-ghost btn-sm" id="exam-table-btn" type="button" ' +
              'aria-expanded="false" aria-controls="exam-table-dialog" ' +
              'title="Table of Information (T)">Table of Information</button>' +
            '<button class="btn btn-ghost btn-sm" id="exam-pause">Pause</button>' +
            '<button class="btn btn-primary btn-sm" id="exam-submit">Submit</button>' +
          '</div>' +
        '</div>' +
        '<div class="exam-body">' +
          '<div class="exam-main">' +
            '<div id="exam-q"></div>' +
          '</div>' +
          '<aside class="exam-palette">' +
            '<div class="exam-palette-title">Question palette</div>' +
            '<div class="exam-palette-grid" id="exam-palette"></div>' +
            '<div class="exam-legend">' +
              '<span class="exam-legend-item"><span class="pal-swatch sw-unanswered"></span>Unanswered</span>' +
              '<span class="exam-legend-item"><span class="pal-swatch sw-answered"></span>Answered</span>' +
              '<span class="exam-legend-item"><span class="pal-swatch sw-flagged"></span>Flagged</span>' +
            '</div>' +
          '</aside>' +
        '</div>' +
        '<div class="exam-navrow">' +
          '<button class="btn btn-ghost" id="exam-prev" title="Previous question (Left arrow)">Back</button>' +
          '<button class="btn btn-ghost" id="exam-flag" aria-pressed="false">Flag for review</button>' +
          '<button class="btn btn-primary" id="exam-next" title="Next question (Right arrow or Enter)">Next</button>' +
        '</div>' +
      '</div>' +
      '<div id="exam-table-host"></div>' +
      '<div id="exam-modal-host"></div>';

    document.getElementById('exam-table-btn').addEventListener('click', function () { toggleTable(); });
    document.getElementById('exam-pause').addEventListener('click', function () { togglePause(exam); });
    document.getElementById('exam-submit').addEventListener('click', function () { confirmSubmit(exam); });
    document.getElementById('exam-prev').addEventListener('click', function () {
      if (exam.cursor > 0) goTo(exam, exam.cursor - 1);
    });
    document.getElementById('exam-next').addEventListener('click', function () {
      if (exam.cursor < exam.order.length - 1) goTo(exam, exam.cursor + 1);
    });
    document.getElementById('exam-flag').addEventListener('click', function () { toggleFlag(exam); });

    meterAnimated = false;
    renderQuestion(exam);
    renderPalette(exam);
    startTimer(exam);
    if (exam.paused) showPauseOverlay(exam);
    motionViewEnter();
  }

  function renderQuestion(exam) {
    var qid = exam.order[exam.cursor];
    var q = PGRE.questionById(qid);
    var box = document.getElementById('exam-q');
    if (!box) return;
    if (!q) {
      box.innerHTML = '<div class="exam-qmeta"><span>Question ' + (exam.cursor + 1) +
        ' of ' + exam.order.length + '</span></div>' +
        '<p class="muted">This question is no longer in the bank.</p>';
      updateNav(exam);
      return;
    }
    var t = PGRE.topicById(q.topic);
    var picked = exam.answers[qid];
    var flagged = exam.flags.indexOf(qid) !== -1;
    var html = '<div class="exam-qmeta" id="exam-q-heading" tabindex="-1">' +
      '<span>Question ' + (exam.cursor + 1) + ' of ' + exam.order.length + '</span>' +
      (t ? '<span class="chip">' + t.name + '</span>' : '') +
      (flagged ? '<span class="chip exam-flagchip">Flagged for review</span>' : '') +
    '</div>' +
    '<div class="q-text">' + q.q + '</div>' +
    '<div class="choices">';
    q.choices.forEach(function (c, idx) {
      html += '<button class="choice' + (idx === picked ? ' is-picked' : '') +
        '" data-idx="' + idx + '" aria-pressed="' + (idx === picked ? 'true' : 'false') + '">' +
        '<span class="choice-letter">' + LETTERS[idx] + '</span>' +
        '<span class="choice-body">' + c + '</span></button>';
    });
    html += '</div>';
    box.innerHTML = html;
    PGRE.typesetMath(box);
    box.querySelectorAll('.choice').forEach(function (b) {
      b.addEventListener('click', function () { selectAnswer(exam, parseInt(b.getAttribute('data-idx'), 10)); });
    });
    updateNav(exam);
    var heading = document.getElementById('exam-q-heading');
    if (heading && heading.focus) heading.focus();
  }

  function updateNav(exam) {
    var prev = document.getElementById('exam-prev');
    var next = document.getElementById('exam-next');
    var flag = document.getElementById('exam-flag');
    if (prev) prev.disabled = exam.cursor === 0;
    if (next) next.disabled = exam.cursor >= exam.order.length - 1;
    if (flag) {
      var flagged = exam.flags.indexOf(exam.order[exam.cursor]) !== -1;
      flag.textContent = flagged ? 'Unflag' : 'Flag for review';
      flag.setAttribute('aria-pressed', flagged ? 'true' : 'false');
    }
  }

  function selectAnswer(exam, idx) {
    var qid = exam.order[exam.cursor];
    if (PGRE.examEngine && typeof PGRE.examEngine.persistAnswer === 'function') {
      if (!PGRE.examEngine.persistAnswer(exam, idx)) return;
    } else {
      if (exam.answers[qid] === idx) delete exam.answers[qid];
      else exam.answers[qid] = idx;
      if (PGRE.store && PGRE.store.save) PGRE.store.save();
    }
    var box = document.getElementById('exam-q');
    if (box) box.querySelectorAll('.choice').forEach(function (b) {
      var on = parseInt(b.getAttribute('data-idx'), 10) === exam.answers[qid];
      b.classList.toggle('is-picked', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    refreshPaletteCell(exam, exam.cursor);
    updateProgress(exam);
  }

  function toggleFlag(exam) {
    var qid = exam.order[exam.cursor];
    var i = exam.flags.indexOf(qid);
    if (i === -1) exam.flags.push(qid); else exam.flags.splice(i, 1);
    PGRE.store.save();
    var box = document.getElementById('exam-q');
    // refresh the flag chip in the meta line without re-typesetting the choices
    if (box) {
      var meta = box.querySelector('.exam-qmeta');
      var chip = box.querySelector('.exam-flagchip');
      if (exam.flags.indexOf(qid) !== -1 && meta && !chip) {
        meta.insertAdjacentHTML('beforeend', '<span class="chip exam-flagchip">Flagged for review</span>');
      } else if (chip && exam.flags.indexOf(qid) === -1) {
        chip.remove();
      }
    }
    updateNav(exam);
    refreshPaletteCell(exam, exam.cursor);
  }

  function goTo(exam, i) {
    exam.cursor = i;
    dwellSync(exam);   // the question just left keeps its time; the new one starts
    PGRE.store.save();
    renderQuestion(exam);
    refreshPaletteActive(exam);
    var main = document.querySelector('.exam-main');
    if (main) main.scrollTop = 0;
  }

  /* ——— Palette ——— */
  function paletteCell(exam, i) {
    var qid = exam.order[i];
    var cls = 'pal-cell';
    if (i === exam.cursor) cls += ' is-current';
    if (exam.answers[qid] != null) cls += ' is-answered';
    if (exam.flags.indexOf(qid) !== -1) cls += ' is-flagged';
    return '<button class="' + cls + '" data-goto="' + i + '" title="Question ' + (i + 1) + '"' +
      (i === exam.cursor ? ' aria-current="true"' : '') + '>' +
      (i + 1) + '</button>';
  }
  function renderPalette(exam) {
    var grid = document.getElementById('exam-palette');
    if (!grid) return;
    var html = '';
    for (var i = 0; i < exam.order.length; i++) html += paletteCell(exam, i);
    grid.innerHTML = html;
    grid.querySelectorAll('[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () { goTo(exam, parseInt(b.getAttribute('data-goto'), 10)); });
    });
    updateProgress(exam);
  }
  function cellAt(i) {
    var grid = document.getElementById('exam-palette');
    return grid ? grid.querySelectorAll('.pal-cell')[i] : null;
  }
  function refreshPaletteCell(exam, i) {
    var cell = cellAt(i);
    if (!cell) return;
    var qid = exam.order[i];
    cell.classList.toggle('is-answered', exam.answers[qid] != null);
    cell.classList.toggle('is-flagged', exam.flags.indexOf(qid) !== -1);
  }
  function refreshPaletteActive(exam) {
    var grid = document.getElementById('exam-palette');
    if (!grid) return;
    grid.querySelectorAll('.pal-cell').forEach(function (c, i) {
      var on = i === exam.cursor;
      c.classList.toggle('is-current', on);
      if (on) c.setAttribute('aria-current', 'true');
      else c.removeAttribute('aria-current');
    });
  }
  function updateProgress(exam) {
    var el = document.getElementById('exam-progress');
    if (el) el.textContent = answeredCount(exam) + ' / ' + exam.order.length + ' answered';
    var mf = document.querySelector('#exam-progress-meter .meter-fill');
    if (!mf) return;
    var pct = 100 * answeredCount(exam) / exam.order.length;
    if (!meterAnimated && window.PGRE && PGRE.motion && PGRE.motion.animateMeter) {
      meterAnimated = true;
      PGRE.motion.animateMeter(mf, pct);
    } else {
      meterAnimated = true;
      mf.style.width = pct + '%';
    }
  }

  /* ——— Countdown ——— */
  function startTimer(exam) {
    stopTimer();
    lastTickAt = Date.now();  // (re)anchor: paused/hidden spans before this don't count
    updateTimer(exam);
    // a paused sitting resumes when the pause overlay is dismissed
    if (!exam.paused) timer = setInterval(function () { tick(exam); }, 1000);
    dwellSync(exam);
  }
  function tick(exam) {
    // Count real elapsed wall-clock, not one second per fire: a throttled
    // background tab fires late (or rarely), and adding a flat +1s there would
    // gift the sitter extra time. Pause-aware — startTimer re-anchors on resume.
    var now = Date.now();
    var delta = (now - lastTickAt) / 1000;
    lastTickAt = now;
    if (delta > 0) exam.durationSec += delta;   // guard against clock skew
    // keep the question on screen's saved time current (no-op in a hidden tab)
    if (PGRE.examEngine && PGRE.examEngine.dwellFlush) PGRE.examEngine.dwellFlush(now);
    updateTimer(exam);
    if (now - lastPersist > 4000) { lastPersist = now; PGRE.store.save(); }
    if (exam.durationSec >= exam.limitSec) {
      exam.durationSec = exam.limitSec;
      stopTimer();
      PGRE.store.save();
      doSubmit(exam, true);
    }
  }
  function updateTimer(exam) {
    var el = document.getElementById('exam-timer');
    if (!el) return;
    var remaining = Math.max(0, exam.limitSec - exam.durationSec);
    var amber = remaining <= 15 * 60 && remaining > 5 * 60;
    var red = remaining <= 5 * 60;
    // status is a text note + tint, never colour alone (DESIGN §6)
    el.innerHTML =
      '<span class="exam-timer-clock">' + fmtClock(remaining) + '</span>' +
      (red ? '<span class="exam-timer-note">under 5 min</span>'
           : amber ? '<span class="exam-timer-note">under 15 min</span>' : '');
    el.classList.toggle('is-amber', amber);
    if (window.PGRE && PGRE.motion && PGRE.motion.reduced !== undefined) {
      el.classList.toggle('timer-tick', (amber || red) && !PGRE.motion.reduced);
    }
    el.classList.toggle('is-red', red);
  }

  /* ——— Pause (practice-integrity) ——— */
  function togglePause(exam) {
    if (exam.paused) {
      exam.paused = false; PGRE.store.save();
      hideModal(); startTimer(exam);
    } else {
      exam.paused = true; stopTimer(); PGRE.store.save();
      showPauseOverlay(exam);
    }
  }

  /* Counts and clock values already on the sitting. No score, no
     correctness, no pause counter (the record only stores paused). */
  function pauseSnapshot(exam) {
    var total = (exam && exam.order) ? exam.order.length : 0;
    var answered = exam ? answeredCount(exam) : 0;
    var unanswered = Math.max(0, total - answered);
    var used = Math.max(0, exam && exam.durationSec ? exam.durationSec : 0);
    var remain = Math.max(0, ((exam && exam.limitSec) || 0) - used);
    return {
      total: total,
      answered: answered,
      unanswered: unanswered,
      flagged: (exam && exam.flags) ? exam.flags.length : 0,
      used: used,
      remain: remain,
      onQuestion: exam ? exam.cursor + 1 : 0,
      avgSec: answered ? used / answered : null,
      remainEachSec: unanswered ? remain / unanswered : null
    };
  }

  function pauseFact(label, value, id) {
    return '<div class="exam-pause-fact">' +
      '<div class="exam-pause-k">' + label + '</div>' +
      '<div class="exam-pause-v" id="' + id + '">' + value + '</div>' +
    '</div>';
  }

  function pausePaceLine(snap) {
    var parts = [];
    if (snap.avgSec != null) {
      parts.push('Average ' + fmtClock(snap.avgSec) + ' per answered question.');
    }
    if (snap.remainEachSec != null) {
      parts.push('Remaining clock allows ' + fmtClock(snap.remainEachSec) +
        ' per leftover question.');
    }
    if (!parts.length) return '';
    return '<p class="muted exam-pause-pace" id="exam-pause-pace">' + parts.join(' ') + '</p>';
  }

  function pauseCardHTML(exam) {
    var snap = pauseSnapshot(exam);
    var pct = snap.total ? (100 * snap.answered / snap.total) : 0;
    var meter = (PGRE.ui && typeof PGRE.ui.meter === 'function')
      ? PGRE.ui.meter(pct, 'meter-thin exam-pause-meter')
      : '';
    return '<div class="exam-overlay is-pause"><div class="exam-overlay-card card is-pause-card">' +
      '<h2>Paused</h2>' +
      '<p class="muted">The clock is stopped and the questions are hidden. A real GRE can’t be ' +
      'paused — use this sparingly so your practice reflects true test conditions.</p>' +
      '<div class="exam-pause-progress" id="exam-pause-progress">' +
        meter +
        '<span class="exam-pause-count" id="exam-pause-count">' +
          snap.answered + ' of ' + snap.total + ' answered</span>' +
      '</div>' +
      '<div class="exam-pause-facts">' +
        pauseFact('Time used', fmtClock(snap.used), 'exam-pause-used') +
        pauseFact('Time remaining', fmtClock(snap.remain), 'exam-pause-remain') +
        pauseFact('On question', snap.onQuestion + ' of ' + snap.total, 'exam-pause-cursor') +
        pauseFact('Not yet answered', String(snap.unanswered), 'exam-pause-blank') +
        pauseFact('Flagged for review', String(snap.flagged), 'exam-pause-flagged') +
      '</div>' +
      pausePaceLine(snap) +
      '<div class="btn-row"><button class="btn btn-primary" id="exam-resume-btn">Resume exam</button></div>' +
    '</div></div>';
  }

  function showPauseOverlay(exam) {
    var host = document.getElementById('exam-modal-host');
    if (!host) return;
    host.innerHTML = pauseCardHTML(exam);
    var resume = document.getElementById('exam-resume-btn');
    resume.addEventListener('click', function () { togglePause(exam); });
    if (resume.focus) resume.focus();
  }
  function hideModal() { var h = document.getElementById('exam-modal-host'); if (h) h.innerHTML = ''; }

  /* Table of Information — a left drawer over the sitting (same
     transform + --dur/--ease-out as the sidebar drawer). The clock
     keeps running. Opening and closing must not remount the question.
     Kept off exam-modal-host so the pause overlay stays a separate edit. */
  var tableClosing = false;
  function tableIsOpen() {
    var host = document.getElementById('exam-table-host');
    var overlay = document.getElementById('exam-table-overlay');
    return !!(host && host.firstChild && overlay && overlay.classList.contains('is-open'));
  }
  function setTableButtonState(open) {
    var btn = document.getElementById('exam-table-btn');
    if (!btn) return;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function showTable() {
    var exam = PGRE.examEngine && PGRE.examEngine.active();
    if (exam && exam.paused) return;
    var host = document.getElementById('exam-table-host');
    if (!host || host.firstChild || tableClosing) return;
    var html = PGRE.examTableHTML ? PGRE.examTableHTML() : '';
    if (!html) return;
    host.innerHTML = html;
    if (PGRE.typesetMath) PGRE.typesetMath(host);
    setTableButtonState(true);
    var overlay = document.getElementById('exam-table-overlay');
    if (overlay) overlay.addEventListener('click', function (ev) {
      if (ev.target === overlay) hideTable();
    });
    var close = document.getElementById('exam-table-close');
    if (close) {
      close.addEventListener('click', function () { hideTable(); });
      if (close.focus) close.focus();
    }
    if (overlay) {
      overlay.offsetWidth; /* force layout so the closed translateX paints */
      overlay.classList.add('is-open');
    }
  }
  function hideTable() {
    var host = document.getElementById('exam-table-host');
    var overlay = document.getElementById('exam-table-overlay');
    var card = document.getElementById('exam-table-dialog');
    if (!host || !host.firstChild || tableClosing) return;
    tableClosing = true;
    setTableButtonState(false);
    if (overlay) overlay.classList.remove('is-open');
    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      tableClosing = false;
      if (card) card.removeEventListener('transitionend', onEnd);
      if (host) host.innerHTML = '';
      var btn = document.getElementById('exam-table-btn');
      if (btn && btn.focus) btn.focus();
    }
    function onEnd(ev) {
      if (ev && ev.target !== card) return;
      finish();
    }
    if (card) card.addEventListener('transitionend', onEnd);
    setTimeout(finish, 500);
  }
  function toggleTable() {
    if (tableIsOpen()) hideTable();
    else showTable();
  }

  /* ——— Submit (custom in-page modal — never window.confirm) ——— */
  function confirmSubmit(exam) {
    var host = document.getElementById('exam-modal-host');
    if (!host) return;
    var done = answeredCount(exam);
    var blank = exam.order.length - done;
    var flagged = exam.flags.length;
    host.innerHTML = '<div class="exam-overlay"><div class="exam-overlay-card card">' +
      '<h2>Submit exam?</h2>' +
      '<p class="muted">You have answered <strong>' + done + '</strong> of ' + exam.order.length +
      ' questions' + (blank ? ', leaving <strong>' + blank + '</strong> blank' : '') +
      (flagged ? ', with <strong>' + flagged + '</strong> flagged for review' : '') +
      '. Blanks are scored as incorrect, and this can’t be undone.</p>' +
      '<div class="btn-row">' +
        '<button class="btn btn-primary" id="exam-confirm">Submit &amp; score</button>' +
        '<button class="btn btn-ghost" id="exam-cancel">Keep working</button>' +
      '</div></div></div>';
    var confirmBtn = document.getElementById('exam-confirm');
    confirmBtn.addEventListener('click', function () { doSubmit(exam, false); });
    document.getElementById('exam-cancel').addEventListener('click', hideModal);
    if (confirmBtn.focus) confirmBtn.focus();
  }

  function doSubmit(exam, auto) {
    hideModal();
    PGRE.examEngine.submit(exam);
    if (!exam.submittedAt) {
      // the store refused the write: stay in the room so the sitting is
      // neither scored into a void nor torn down under the user. On the
      // time-limit path tick() has already stopped the clock; the sticky
      // persist toast is up from submit(). Manual Submit retries it.
      dwellSync(exam);   // submit() closed the per-question count; the sitting goes on
      if (auto) PGRE.toast('Time is up, but saving failed. Your answers stay on screen; press Submit once saving works again.', 'error', true);
      return;
    }
    stopTimer();
    setFullscreen(false);
    if (auto) PGRE.toast('Time — your exam was submitted automatically.', 'info');
    location.hash = '#/exam/review/' + exam.id;
  }

  /* ——————————————————————————— Results / review ——————————————————————————— */
  function scaleNote(scale) {
    if (scale.stale) {
      return 'This sitting stored a scaled score under the old number-correct lookup; the answers needed for the official rule are not on this record.';
    }
    if (scale.official && scale.rule === 'formula') {
      return 'Scaled with the official table using correct minus a quarter of incorrect.';
    }
    if (scale.official) {
      return 'Scaled with the official table using number correct.';
    }
    return 'Scaled scores run 200–990; this estimate is interpolated from a hand-averaged lookalike ' +
      'of released ETS practice-test tables and is a rough ballpark only.';
  }

  /* Results page, Flagged tile. With at least one flagged question it is a
     toggle: on, the review list shows the flagged questions only. View state
     only; a fresh render starts with every question shown. */
  function flaggedShown(exam) {
    var flags = exam.flags || [];
    return (exam.order || []).filter(function (qid) { return flags.indexOf(qid) !== -1; }).length;
  }

  function flaggedTile(exam) {
    var n = (exam.flags || []).length;
    if (!flaggedShown(exam)) return PGRE.ui.statTile('Flagged', String(n));
    return '<button type="button" class="stat-tile stat-tile-btn" id="exam-flagged-tile"' +
        ' aria-pressed="false" aria-controls="exam-review-head">' +
      '<span class="stat-label">Flagged</span>' +
      '<span class="stat-value">' + n + '</span>' +
      '<span class="stat-sub">Show only these</span>' +
    '</button>';
  }

  function setFlaggedOnly(exam, on) {
    var tile = document.getElementById('exam-flagged-tile');
    if (!tile) return;
    var n = flaggedShown(exam);
    root().classList.toggle('exam-flagged-only', on);
    tile.setAttribute('aria-pressed', on ? 'true' : 'false');
    tile.querySelector('.stat-sub').textContent = on ? 'Show all ' + (exam.order || []).length : 'Show only these';
    document.getElementById('exam-review-filter').hidden = !on;
    document.getElementById('exam-review-filter-text').textContent = on
      ? 'Showing ' + n + ' flagged question' + (n === 1 ? '' : 's') : '';
    var navToggle = document.getElementById('exam-nav-flagged');
    if (navToggle) navToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    root().querySelectorAll('#exam-review-nav .pal-cell:not(.is-flagged)').forEach(function (cell) {
      cell.disabled = on;
    });
    reviewAt = null; // the cards moved under the same scroll position
    paintReviewNav();
  }

  function bindFlaggedFilter(exam) {
    var tile = document.getElementById('exam-flagged-tile');
    if (!tile) return;
    var title = document.getElementById('exam-review-title');
    tile.addEventListener('click', function () {
      var on = tile.getAttribute('aria-pressed') !== 'true';
      setFlaggedOnly(exam, on);
      if (!on) return;
      document.getElementById('exam-review-head').scrollIntoView({ block: 'start' });
      title.focus({ preventScroll: true });
    });
    document.getElementById('exam-review-all').addEventListener('click', function () {
      setFlaggedOnly(exam, false);
      title.focus({ preventScroll: true });
    });
  }

  /* Results page, question navigator: a sticky side panel with one cell per
     question (right or wrong, the flag marker, a ring on the question in
     view). A cell scrolls to its review card. It reuses the room palette's
     .pal-cell look and the drill palette's result tints. */
  var reviewSpy = null;   // scroll listener of the results page on screen
  var reviewAt = null;    // { i, y }: the card last asked for by a key or a cell, and the scroll position that left

  function reviewNavHTML(exam) {
    var order = exam.order || [], flags = exam.flags || [];
    if (!order.length) return '';
    var cells = '';
    order.forEach(function (qid, i) {
      var q = PGRE.questionById(qid);
      var right = !!q && exam.answers[qid] != null && exam.answers[qid] === q.answer;
      var flagged = flags.indexOf(qid) !== -1;
      cells += '<button type="button" class="pal-cell ' + (right ? 'is-correct' : 'is-wrong') +
        (flagged ? ' is-flagged' : '') + '" data-review-goto="' + i + '" aria-label="Question ' + (i + 1) +
        (right ? ', right' : ', wrong') + (flagged ? ', flagged' : '') + '">' + (i + 1) + '</button>';
    });
    return '<aside class="exam-review-nav" id="exam-review-nav" aria-label="Question navigator">' +
      '<div class="exam-review-nav-head">' +
        '<span class="exam-palette-title">Questions</span>' +
        (flaggedShown(exam)
          ? '<button type="button" class="btn btn-ghost btn-sm" id="exam-nav-flagged" aria-pressed="false">Flagged only</button>'
          : '') +
      '</div>' +
      '<div class="exam-palette-grid">' + cells + '</div>' +
      '<div class="exam-legend">' +
        '<span class="exam-legend-item"><span class="pal-swatch sw-correct"></span>Right</span>' +
        '<span class="exam-legend-item"><span class="pal-swatch sw-wrong"></span>Wrong</span>' +
        '<span class="exam-legend-item"><span class="pal-swatch sw-flagged"></span>Flagged</span>' +
      '</div>' +
      '<div class="practice-keys"><span class="key-hint">←</span> previous ' +
        '<span class="key-hint">→</span> or <span class="key-hint">Enter</span> next</div>' +
    '</aside>';
  }

  function reviewCards() {
    var el = root();
    return el ? Array.prototype.slice.call(el.querySelectorAll('.exam-review-q')) : [];
  }

  /* Index of the review card in view: the shown card with the largest
     visible height inside the window below the top bar (the 64 px
     scroll-margin-top of .exam-review-q). Ties go to the earlier card.
     The last shown card at the end of the page. -1 above the list.
     Cards hidden by the flagged filter have no box. */
  function reviewCardInView() {
    var topBar = 64, at = -1, last = -1, best = 0;
    reviewCards().forEach(function (card, i) {
      var box = card.getBoundingClientRect();
      if (!box.height) return;
      last = i;
      var vis = Math.min(box.bottom, window.innerHeight) - Math.max(box.top, topBar);
      if (vis > best) { best = vis; at = i; }
    });
    var atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    return atEnd ? last : at;
  }

  /* The card the reader is on: the one last asked for by a key or a cell while
     the page has not scrolled since, else the card in view. A card near the end
     of the page cannot fill the window, so the scroll position alone would
     name a later card there, and the Left key would never leave the last one. */
  function reviewCurrent() {
    if (reviewAt && Math.abs(window.scrollY - reviewAt.y) < 2) {
      var card = reviewCards()[reviewAt.i];
      if (card && card.getBoundingClientRect().height) return reviewAt.i;
    }
    return reviewCardInView();
  }

  function goReviewCard(i) {
    var card = reviewCards()[i];
    if (!card) return;
    card.scrollIntoView({ block: 'start' });
    reviewAt = { i: i, y: window.scrollY };
    paintReviewNav();
  }

  /* The next (dir 1) or the previous (dir -1) shown card from the one the
     reader is on. Focus follows, so Tab continues from that card and no
     control of an earlier card keeps the keys. */
  function stepReview(dir) {
    var cards = reviewCards();
    for (var i = reviewCurrent() + dir; i >= 0 && i < cards.length; i += dir) {
      if (!cards[i].getBoundingClientRect().height) continue;
      goReviewCard(i);
      cards[i].setAttribute('tabindex', '-1');
      cards[i].focus({ preventScroll: true });
      return;
    }
  }

  /* Results page keys: Right arrow or Enter for the next shown review card,
     Left arrow for the previous one. Registered once; acts only while the
     results page is on screen, outside a text field, and with no dialog up. */
  document.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k !== 'ArrowRight' && k !== 'ArrowLeft' && k !== 'Enter') return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    var el = root();
    if (!el || !el.querySelector('.exam-results')) return;
    var t = e.target, tag = (t && t.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    if (document.querySelector('#viz-modal-backdrop, [aria-modal="true"]')) return;
    if (k === 'Enter' && PGRE.enterPressesControl()) return;
    e.preventDefault();
    stepReview(k === 'ArrowLeft' ? -1 : 1);
  });

  function stopReviewNav() {
    if (reviewSpy) { window.removeEventListener('scroll', reviewSpy); reviewSpy = null; }
  }

  function paintReviewNav() {
    var nav = document.getElementById('exam-review-nav');
    if (!nav) { stopReviewNav(); return; }
    var at = reviewCurrent();
    nav.querySelectorAll('.pal-cell').forEach(function (cell, i) {
      var on = i === at;
      if (cell.classList.contains('is-current') === on) return;
      cell.classList.toggle('is-current', on);
      if (!on) { cell.removeAttribute('aria-current'); return; }
      cell.setAttribute('aria-current', 'true');
      // keep the ring inside the panel's own scroll area
      var top = cell.offsetTop, bottom = top + cell.offsetHeight;
      if (top < nav.scrollTop) nav.scrollTop = top - 8;
      else if (bottom > nav.scrollTop + nav.clientHeight) nav.scrollTop = bottom - nav.clientHeight + 8;
    });
  }

  function bindReviewNav(exam) {
    stopReviewNav();
    var nav = document.getElementById('exam-review-nav');
    if (!nav) return;
    var queued = false;
    reviewSpy = function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; paintReviewNav(); });
    };
    window.addEventListener('scroll', reviewSpy, { passive: true });
    nav.querySelectorAll('[data-review-goto]').forEach(function (cell) {
      cell.addEventListener('click', function () {
        goReviewCard(parseInt(cell.getAttribute('data-review-goto'), 10));
      });
    });
    var toggle = document.getElementById('exam-nav-flagged');
    /* The panel's toggle keeps the reader's place: after the switch the page
       shows the card that was in view, or the next shown card after it. */
    if (toggle) toggle.addEventListener('click', function () {
      var on = toggle.getAttribute('aria-pressed') !== 'true';
      var at = reviewCurrent();
      setFlaggedOnly(exam, on);
      var cards = reviewCards(), to = -1;
      for (var i = at; at !== -1 && i < cards.length && to === -1; i++) {
        if (cards[i].getBoundingClientRect().height) to = i;
      }
      if (to !== -1) goReviewCard(to);
      else if (on) document.getElementById('exam-review-head').scrollIntoView({ block: 'start' });
      paintReviewNav();
    });
    paintReviewNav();
  }

  function renderResults(id) {
    leaveRoom();
    var eng = PGRE.examEngine, ui = PGRE.ui;
    var exam = eng.byId(id);
    if (!exam || !exam.submittedAt) { renderSetup(); return; }
    var pct = exam.total ? Math.round(100 * exam.raw / exam.total) : 0;
    var verdict = pct >= 85 ? 'Exceptional — that would be a very strong scaled score.' :
                  pct >= 65 ? 'Strong sitting. Mine the misses below for the last points.' :
                  pct >= 45 ? 'Solid base — the per-topic table shows where to aim next.' :
                  'A tough one. Every miss below is now in your mistake book for review.';
    var scale = eng.scaleDisplay ? eng.scaleDisplay(exam) : {
      scaled: exam.scaledEst, official: !!exam.scaledOfficial,
      rule: exam.scaledOfficial ? 'correct' : 'estimate', stale: false
    };
    var scaledSub = scale.stale ? 'stored under the old rule' :
      scale.rule === 'formula' ? 'correct minus a quarter of incorrect' :
      'number correct';

    var html = '<div class="card exam-result-hero">' +
      '<div class="exam-result-head">' +
        '<a class="btn btn-ghost btn-sm" href="#/exam">← All simulations</a>' +
        '<span class="chip">' + eng.FORMAT_META[exam.format].label + '</span>' +
        '<span class="muted">' + fmtDate(exam.submittedAt) + '</span>' +
      '</div>' +
      '<div class="summary-score">' + exam.raw + ' / ' + exam.total +
        '<span class="summary-pct">' + pct + '%</span></div>' +
      '<p class="muted">' + verdict + '</p>' +
      '<div class="stat-row exam-result-stats">' +
        ui.statTile('Raw score', exam.raw + ' / ' + exam.total) +
        (scale.official
          ? ui.statTile('Scaled score', String(scale.scaled), scaledSub)
          : ui.statTile('Scaled estimate', '~' + scale.scaled, 'ballpark, not ETS-equated')) +
        ui.statTile('Time used', fmtDur(exam.durationSec), 'of ' + fmtDur(exam.limitSec)) +
        flaggedTile(exam) +
      '</div>' +
      (exam.missing ? '<p class="muted exam-missing-note">' + exam.missing + ' question' +
        (exam.missing === 1 ? '' : 's') + ' could not be matched to the current bank and ' +
        (exam.missing === 1 ? 'was' : 'were') + ' scored as incorrect — the bank changed ' +
        'since this sitting.</p>' : '') +
      '<p class="muted exam-scale-note">' + scaleNote(scale) + '</p>' +
    '</div>';

    // Per-topic breakdown
    html += '<div class="card"><h2>By topic</h2><div class="exam-topic-table">';
    eng.WEIGHTS.forEach(function (w) {
      var pt = exam.perTopic && exam.perTopic[w.topic];
      if (!pt || !pt.total) return;
      var t = PGRE.topicById(w.topic);
      var tp = Math.round(100 * pt.right / pt.total);
      html += '<div class="exam-topic-row">' +
        '<span class="exam-topic-name">' + ui.monogram(t) + ' ' + t.name + '</span>' +
        '<span class="exam-topic-meter">' + ui.meter(tp) + '</span>' +
        '<span class="exam-topic-score">' + pt.right + '/' + pt.total + ' · ' + tp + '%</span>' +
      '</div>';
    });
    html += '</div><p class="muted exam-topic-foot">This breakdown feeds the weak-topic ranking in ' +
      '<a href="#/analytics">analytics</a>.</p></div>';

    // Question-by-question review
    var flaggedRight = eng.flaggedCorrectIds ? eng.flaggedCorrectIds(exam) : [];
    var pendingGuess = flaggedRight.filter(function (qid) { return !eng.isMarkedGuess(exam, qid); });
    html += '<div class="card" id="exam-review-head">' +
      '<h2 id="exam-review-title" tabindex="-1">Question-by-question review</h2>' +
      '<p class="muted">Your pick beside the correct answer, with the full solution. ' +
      'Questions you flagged are marked. On a question you got right, Guessed files it in the mistake book.</p>' +
      (flaggedRight.length
        ? '<div class="btn-row"><button type="button" class="btn btn-ghost btn-sm" id="exam-guess-flagged"' +
            (pendingGuess.length ? '' : ' disabled') + '>' +
            (pendingGuess.length
              ? 'Mark flagged correct as guessed'
              : 'Flagged correct answers are marked as guessed') +
          '</button></div>'
        : '') +
      '<div class="btn-row" id="exam-review-filter" hidden>' +
        '<span class="muted" id="exam-review-filter-text" role="status"></span>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="exam-review-all">Show all ' +
          (exam.order || []).length + '</button>' +
      '</div>' +
      '</div>';
    (exam.order || []).forEach(function (qid, i) {
      html += reviewCard(exam, qid, i);
    });

    html += '<div class="card"><div class="btn-row">' +
      '<a class="btn btn-primary" href="#/exam">Back to simulations</a>' +
      '<a class="btn btn-ghost" href="#/analytics">Open analytics →</a>' +
    '</div></div>';

    root().classList.remove('exam-flagged-only');
    reviewAt = null;
    root().innerHTML = '<div class="exam-results"><div class="exam-results-grid">' +
      '<div class="exam-results-main">' + html + '</div>' + reviewNavHTML(exam) +
      '</div></div>';
    PGRE.typesetMath(root());
    bindReviewNotes();
    bindGuesses(exam);
    bindFlaggedFilter(exam);
    bindReviewNav(exam);
    if (window.PGRE && PGRE.motion) {
      var pctEl = root().querySelector('.summary-pct');
      if (pctEl && PGRE.motion.countUp) PGRE.motion.countUp(pctEl, pct, { duration: 900, format: function (n) { return Math.round(n) + '%'; } });
      root().querySelectorAll('.exam-review-q').forEach(function (c) {
        c.classList.add('stagger-in');
      });
      if (PGRE.motion.stagger) PGRE.motion.stagger(root(), { selector: '.exam-review-q', step: 60 });
    }
    motionViewEnter();
  }

  /* PROPOSAL #12 — "Why the other choices tempt": an expandable list of the
     non-correct choices with their mined per-choice explanation (q.choiceSols[idx]).
     The field is optional (the mining pipeline fills it into the bank over time),
     so an absent or all-null array yields '' and no empty block shows. Choice text
     and explanation are trusted bank HTML/LaTeX, rendered like q.sol / q.choices and
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

  /* ——— Bookmark + margin note in review — the same store API (PGRE.notes) and
     the same .practice-nb markup as the practice feedback panel
     (js/view-practice.js notesBlock), so entries land in the one
     Notes & bookmarks store and share its styling. By-id lookups on exam
     questions are fine here; bookmarking never adds a question to any
     practice pool. ——— */
  var noteTimers = {};   // qid -> debounce timeout id for the review note fields

  function starButton(on) {
    var label = on ? 'Remove bookmark' : 'Bookmark this question';
    return '<button class="nb-star' + (on ? ' on' : '') + '" data-star type="button" ' +
      'aria-pressed="' + (on ? 'true' : 'false') + '" ' +
      'title="' + label + '" aria-label="' + label + '">' + (on ? '★' : '☆') + '</button>';
  }

  function starLabel(on) {
    return on ? 'Bookmarked — saved to Notes &amp; bookmarks' : 'Bookmark this question';
  }

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

  function scheduleNoteSave(qid, ta) {
    clearTimeout(noteTimers[qid]);
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

  function showNoteSaved(ta) {
    var tick = ta.parentNode.querySelector('.nb-saved');
    if (!tick) return;
    tick.textContent = ta.value.trim() === '' ? 'Note cleared' : 'Saved';
    tick.classList.add('show');
    clearTimeout(tick._t);
    tick._t = setTimeout(function () { tick.classList.remove('show'); }, 1600);
  }

  function bindReviewNotes() {
    root().querySelectorAll('.practice-nb').forEach(function (wrap) {
      var qid = wrap.getAttribute('data-qid');
      var star = wrap.querySelector('[data-star]');
      var label = wrap.querySelector('[data-star-label]');
      if (star) star.addEventListener('click', function () {
        var on = PGRE.notes.toggleBookmark(qid);
        star.classList.toggle('on', on);
        star.textContent = on ? '★' : '☆';
        star.setAttribute('aria-pressed', on ? 'true' : 'false');
        var t = on ? 'Remove bookmark' : 'Bookmark this question';
        star.setAttribute('title', t);
        star.setAttribute('aria-label', t);
        if (label) label.innerHTML = starLabel(on);
      });
      var ta = wrap.querySelector('[data-note]');
      if (ta) {
        ta.addEventListener('input', function () { scheduleNoteSave(qid, ta); });
        ta.addEventListener('blur', function () { flushNoteSave(qid, ta); });
      }
    });
  }

  /* Closing/reloading the tab mid-typing fires no blur and kills the debounce
     timers — flush every pending review note (a review page holds many). */
  window.addEventListener('pagehide', function () {
    document.querySelectorAll('#exam-root .practice-nb').forEach(function (wrap) {
      var qid = wrap.getAttribute('data-qid');
      var ta = wrap.querySelector('[data-note]');
      if (qid && ta && noteTimers[qid]) flushNoteSave(qid, ta);
    });
  });

  /* Correct answers only. Wrong and blank questions are already in the book. */
  function guessNote(on, origin) {
    if (!on) return 'Mark this correct answer as a guess';
    if (origin === 'already') return 'already filed as a lucky guess in your mistake book';
    return 'filed as a lucky guess in your mistake book';
  }

  function guessControl(exam, qid) {
    var eng = PGRE.examEngine;
    var on = eng.isMarkedGuess(exam, qid);
    var origin = exam.guessOrigin && exam.guessOrigin[qid];
    return '<div class="conf-row assess-row is-exam-guess">' +
      '<button type="button" class="focus-chip assess-chip' + (on ? ' active' : '') +
      '" data-assess="guess" data-exam-guess="' + PGRE.ui.esc(qid) +
      '" aria-pressed="' + (on ? 'true' : 'false') + '">Guessed</button>' +
      '<span class="assess-note muted" data-guess-note>' + guessNote(on, origin) + '</span></div>';
  }

  function paintGuess(btn, exam) {
    var qid = btn.getAttribute('data-exam-guess');
    var on = PGRE.examEngine.isMarkedGuess(exam, qid);
    var origin = exam.guessOrigin && exam.guessOrigin[qid];
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    var note = btn.parentNode && btn.parentNode.querySelector('[data-guess-note]');
    if (note) note.textContent = guessNote(on, origin);
  }

  function refreshGuessBulk(exam) {
    var bulk = document.getElementById('exam-guess-flagged');
    if (!bulk || !PGRE.examEngine.flaggedCorrectIds) return;
    var pending = PGRE.examEngine.flaggedCorrectIds(exam).filter(function (qid) {
      return !PGRE.examEngine.isMarkedGuess(exam, qid);
    });
    bulk.disabled = pending.length === 0;
    bulk.textContent = pending.length
      ? 'Mark flagged correct as guessed'
      : 'Flagged correct answers are marked as guessed';
  }

  function bindGuesses(exam) {
    var rootEl = root();
    if (!rootEl || !PGRE.examEngine || !PGRE.examEngine.markGuessed) return;
    rootEl.querySelectorAll('[data-exam-guess]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var qid = btn.getAttribute('data-exam-guess');
        var on = PGRE.examEngine.isMarkedGuess(exam, qid);
        var ok = on ? PGRE.examEngine.unmarkGuessed(exam, qid) : PGRE.examEngine.markGuessed(exam, qid);
        if (!ok) return;
        paintGuess(btn, exam);
        refreshGuessBulk(exam);
        if (PGRE.refreshNavBadges) PGRE.refreshNavBadges();
      });
    });
    var bulk = document.getElementById('exam-guess-flagged');
    if (bulk) bulk.addEventListener('click', function () {
      PGRE.examEngine.markFlaggedGuessed(exam);
      rootEl.querySelectorAll('[data-exam-guess]').forEach(function (btn) { paintGuess(btn, exam); });
      refreshGuessBulk(exam);
      if (PGRE.refreshNavBadges) PGRE.refreshNavBadges();
    });
  }

  /* Every choice as the room showed it, in a closed band above the solution.
     Same markup and marks as the practice review (js/view-practice.js renderReview). */
  function choicesBlock(q, picked) {
    var items = '';
    q.choices.forEach(function (c, idx) {
      var cls = 'choice';
      if (idx === q.answer) cls += ' is-answer';
      if (idx === picked && idx !== q.answer) cls += ' is-wrong';
      items += '<button class="' + cls + '" disabled aria-pressed="' +
        (idx === picked ? 'true' : 'false') + '">' +
        '<span class="choice-letter">' + LETTERS[idx] + '</span>' +
        '<span class="choice-body">' + c + '</span></button>';
    });
    return '<details class="miss exam-review-choices"><summary>All choices</summary>' +
      '<div class="choices">' + items + '</div></details>';
  }

  /* Picked and correct answers as closed details.miss bands, same chevron,
     border, and native open/keyboard behaviour as All choices. Folded by
     default; native details does not remember open state. Verdict tint stays
     on the band. The folded summary is the label only (no choice letter);
     the expanded body is the letter, an em dash, and the choice HTML
     (LaTeX included). Left blank has no choice body. Used only by the
     mock-exam results review page. */
  function pickBand(kind, label, bodyHtml) {
    return '<details class="miss exam-review-pick is-' + kind + '">' +
      '<summary><strong>' + label + '</strong></summary>' +
      (bodyHtml ? '<div class="exam-review-pick-body">' + bodyHtml + '</div>' : '') +
      '</details>';
  }

  function pickChoiceBody(idx, q) {
    var letter = LETTERS[idx];
    var text = q && q.choices ? q.choices[idx] : null;
    if (!letter || text == null || text === '') return '';
    return letter + ' — ' + text;
  }

  function reviewPickBandsHTML(q, picked) {
    var html = '';
    var correct = picked === q.answer;
    if (picked == null) {
      html += pickBand('bad', 'Left blank', '');
    } else if (!correct) {
      html += pickBand('bad', 'You picked', pickChoiceBody(picked, q));
    }
    html += pickBand('good',
      correct ? 'You picked' : 'Correct answer',
      pickChoiceBody(q.answer, q));
    return html;
  }

  /* Time spent on one question, from the sitting's own record (exam.qSec).
     A sitting saved before the count existed has none: no chip. */
  function timeChip(exam, qid) {
    var eng = PGRE.examEngine;
    var sec = eng && typeof eng.questionSec === 'function' ? eng.questionSec(exam, qid) : null;
    if (sec == null) return '';
    return '<span class="muted exam-review-time" title="Time on this question">Time ' +
      fmtClock(sec) + '</span>';
  }

  function reviewCard(exam, qid, i) {
    var ui = PGRE.ui, q = PGRE.questionById(qid);
    var flagged = exam.flags.indexOf(qid) !== -1;
    var picked = exam.answers[qid] != null ? exam.answers[qid] : null;
    if (!q) {
      return '<div class="card exam-review-q' + (flagged ? ' is-flagged' : '') + '"><div class="miss-head">' +
        '<span class="muted">Question ' + (i + 1) + ' — no longer in the bank</span></div></div>';
    }
    var t = PGRE.topicById(q.topic);
    var correct = picked === q.answer;
    var html = '<div class="card exam-review-q' + (correct ? ' is-right' : '') +
        (flagged ? ' is-flagged' : '') + '">' +
      '<div class="miss-head">' +
        '<span class="hist-mark ' + (correct ? 'is-good' : 'is-bad') + '">' + (correct ? 'Right' : 'Wrong') + '</span>' +
        (t ? ui.monogram(t) : '') +
        '<span class="muted">Question ' + (i + 1) + '</span>' +
        timeChip(exam, qid) +
        (flagged ? '<span class="chip exam-flagchip">Flagged</span>' : '') +
      '</div>' +
      '<div class="q-text">' + q.q + '</div>' +
      reviewPickBandsHTML(q, picked) +
      (correct ? guessControl(exam, qid) : '') +
      choicesBlock(q, picked) +
      '<details class="miss"><summary>Solution</summary>' +
        '<div class="solution"><div class="solution-label">Solution</div>' + q.sol + '</div></details>' +
      distractorBlock(q) +
      notesBlock(q) +
      '</div>';
    return html;
  }

  /* ——— View entry points ——— */
  return {
    pauseSnapshot: pauseSnapshot,
    pauseCardHTML: pauseCardHTML,
    reviewPickBandsHTML: reviewPickBandsHTML,
    render: function () {
      return '<div id="exam-root"><div class="card"><p class="muted">Loading the exam simulator…</p></div></div>';
    },
    mount: function (params) {
      whenEngine(function () {
        if (params.sub === 'run') renderRoom();
        else if (params.sub === 'review') renderResults(params.sub2);
        else renderSetup();
      });
    }
  };
})();
