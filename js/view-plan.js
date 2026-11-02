/* Study plan — vault calendar (Week 0 historical + 7 live weeks Sep 14–Nov 1).
   Checking a task grants its XP (once) and counts as study activity. */
window.PGRE = window.PGRE || {};
PGRE.views = PGRE.views || {};

/* Prep runway: one segment per plan week from the first plan week to exam
   week. Past weeks are solid, the current week fills by the day, later
   weeks are track. Each segment carries a chart-tip with its dates and
   focus. Moved from the dashboard for Life Studio phase 1. */
PGRE.planRunwayHTML = function () {
    var ui = PGRE.ui;
    var weeks = PGRE.planWeeks ? PGRE.planWeeks() : [];
    if (!weeks.length) return '';
    var today = PGRE.store.today();
    var nowIdx = -1;
    var segs = '';
    weeks.forEach(function (pw, i) {
      var w = pw.week;
      var cls = 'runway-wk';
      var fill = '';
      if (today > w.end) cls += ' is-past';
      else if (today >= w.start) {
        cls += ' is-now';
        nowIdx = i;
        var day = Math.round((new Date(today + 'T12:00:00') - new Date(w.start + 'T12:00:00')) / 86400000);
        fill = ' style="--wk-fill:' + Math.round(100 * (day + 1) / 7) + '%"';
      }
      segs += '<span class="' + cls + '"' + fill + ' tabindex="0" data-tip="' +
        ui.esc(ui.dateRange(w.start, w.end) + '\n' + w.title) + '"></span>';
    });
    var short = function (iso) {
      return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };
    var last = weeks[weeks.length - 1].week;
    var meta = nowIdx >= 0
      ? 'Week ' + (nowIdx + 1) + ' of ' + weeks.length
      : (today < weeks[0].week.start ? 'Plan starts ' + short(weeks[0].week.start) : 'Plan complete');
    var side = (nowIdx >= 0 && nowIdx < weeks.length - 1) ? 'Exam week starts ' + short(last.start) : '';
    return '<div class="runway">' +
      '<div class="runway-track" role="img" aria-label="' + ui.esc(meta + (side ? ', ' + side : '')) + '">' + segs + '</div>' +
      '<div class="runway-meta"><span>' + meta + '</span>' + (side ? '<span>' + side + '</span>' : '') + '</div>' +
    '</div>';
};
PGRE.views.plan = (function () {

  function weekProgress(w) {
    var tasks = PGRE.weekTasks(w);
    var done = tasks.filter(function (t) { return PGRE.gamify.taskDone(t.id); }).length;
    var total = tasks.length;
    return { done: done, total: total, pct: total ? Math.round(100 * done / total) : 0 };
  }

  function fmtSat(iso) {
    var d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }
  function fmtDate(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /* The exam archive (design §6.11): the prep months, kept as they were.
     Review plan first, then mock sittings, readiness, intensity folded
     shut, the exam date as text. Nothing here asks for work. */
  function body() {
    var ui = PGRE.ui, g = PGRE.gamify;
    var today = PGRE.store.today();
    var s = PGRE.store.state;
    var examIso = s.settings && s.settings.examDate;

    var allTasks = 0, allDone = 0, seen = {};
    PGRE.PLAN.forEach(function (ph) {
      ph.weeks.forEach(function (w) {
        PGRE.weekTasks(w).forEach(function (t) {
          if (seen[t.id]) return;
          seen[t.id] = true;
          allTasks++;
          if (g.taskDone(t.id)) allDone++;
        });
      });
    });

    var html = '<span class="kicker">Physics · Exam archive</span>' +
      '<h1 class="h1 sm">GRE Physics</h1>' +
      '<p class="lead">' + (examIso
        ? 'Sat ' + ui.esc(fmtSat(examIso)) + '. The prep months, kept as they were. Nothing here asks for work.'
        : 'The prep months, kept as they were. Nothing here asks for work.') + '</p>';

    // Review plan: totals and the runway stay visible; the week cards sit
    // behind a toggle since the plan is done.
    var firstStart = PGRE.PLAN[0] && PGRE.PLAN[0].weeks[0] ? PGRE.PLAN[0].weeks[0].start : '';
    var lastEnd = '';
    PGRE.PLAN.forEach(function (ph) {
      ph.weeks.forEach(function (w) { if (w.end > lastEnd) lastEnd = w.end; });
    });
    html += '<div class="card" style="margin-top:16px"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap">' +
      '<div><div class="sec-title" style="margin:0"><span class="t">Review plan</span></div>' +
      '<div class="meta">' + ui.esc(ui.dateRange(firstStart, lastEnd)) + ' · ' +
        allDone + ' of ' + allTasks + ' tasks done</div></div>' +
      '<span class="chip">' + (examIso ? 'Exam sat' : 'In progress') + '</span></div>' +
      (PGRE.planRunwayHTML ? PGRE.planRunwayHTML() : '') +
      '<div class="btn-row"><button class="btn btn-ghost btn-sm" id="plan-weeks-toggle" ' +
        'aria-expanded="false" aria-controls="plan-weeks">Open the plan weeks</button></div>' +
      '<div id="plan-weeks" hidden>';

    PGRE.PLAN.forEach(function (phase) {
      var phTasks = 0, phDone = 0;
      phase.weeks.forEach(function (w) {
        var tasks = PGRE.weekTasks(w);
        phTasks += tasks.length;
        phDone += tasks.filter(function (t) { return g.taskDone(t.id); }).length;
      });
      html += '<div class="phase"><div class="phase-head"><h2>' + ui.esc(phase.name) + '</h2>' +
        '<span class="muted">' + phDone + '/' + phTasks + '</span></div>' +
        '<p class="muted phase-desc">' + ui.esc(phase.desc) + '</p>';

      phase.weeks.forEach(function (w) {
        var p = weekProgress(w);
        var tasks = PGRE.weekTasks(w);
        var isCurrent = today >= w.start && today <= w.end;
        var isPast = today > w.end;
        var state = isCurrent ? 'current' : isPast ? (p.pct === 100 ? 'done' : 'past') : 'future';
        var openWeek = isCurrent && !(w.historical || w.id === 'w0');
        html += '<details class="week card week-' + state + '"' + (openWeek ? ' open' : '') + ' data-week="' + w.id + '">' +
          '<summary><div class="week-sum">' +
            '<span class="week-badge">' + (isCurrent ? 'This week' : ui.dateRange(w.start, w.end)) + '</span>' +
            '<span class="week-title">' + ui.esc(w.title) + '</span>' +
            '<span class="week-meta">~' + w.hours + ' h · ' + p.done + '/' + p.total + '</span>' +
          '</div>' + ui.meter(p.pct, 'meter-thin') + '</summary>' +
          '<p class="muted week-focus">' + ui.esc(w.focus || '') +
            (w.notes ? ' — ' + ui.esc(w.notes) : '') + '</p>' +
          '<ul class="task-list">';
        tasks.forEach(function (t) {
          var done = g.taskDone(t.id);
          html += '<li class="task' + (done ? ' done' : '') + '">' +
            '<label><input type="checkbox" data-task="' + t.id + '" data-xp="' + t.xp + '"' + (done ? ' checked' : '') + '>' +
            '<span class="task-label">' + ui.esc(t.label) + '</span></label>' +
            (t.kind === 'mock' ? ' <a class="btn btn-ghost btn-sm" href="#/exam">Open simulator →</a>' : '') +
            ((t.kind === 'timed' || t.kind === 'extra-set')
              ? ' <button class="btn btn-primary btn-sm" data-launch-set="' +
                  ui.esc(String(t.id || '').replace(/^set-/, '')) + '">Start →</button>'
              : '') +
            '<span class="task-meta">' + t.hours + ' h</span></li>';
        });
        html += '</ul>';
        if (w.topics && w.topics.length) {
          html += '<div class="week-links"><span class="week-links-label">Study:</span>';
          w.topics.forEach(function (tid) {
            var t = PGRE.topicById(tid);
            if (t) html += '<a class="btn btn-ghost btn-sm" href="#/topic/' + t.id + '">' + ui.esc(t.short) + ' →</a>';
          });
          html += '</div>';
        }
        html += '</details>';
      });
      html += '</div>';
    });
    html += '</div></div>';

    // Mock exams: past sittings first, newest on top (§6.11).
    var hist = (PGRE.examEngine && PGRE.examEngine.history) ? PGRE.examEngine.history() : [];
    var list = hist.slice(0, 5).map(function (x) {
      var pct = x.total ? Math.round(100 * x.raw / x.total) : 0;
      var scale = PGRE.examEngine.scaleDisplay ? PGRE.examEngine.scaleDisplay(x)
        : { scaled: x.scaledEst, official: !!x.scaledOfficial };
      return '<a class="exam-hist-row" href="#/exam/review/' + ui.esc(x.id) + '">' +
        '<span class="exam-hist-when">' + ui.esc(fmtDate(x.submittedAt)) + '</span>' +
        '<span class="chip">' + ui.esc(PGRE.examEngine.FORMAT_META[x.format].label) + '</span>' +
        '<span class="exam-hist-score">' + x.raw + ' / ' + x.total + ' · ' + pct + '%</span>' +
        '<span class="exam-hist-scaled">' + (scale.official ? '' : '~') + scale.scaled + ' scaled</span>' +
        '</a>';
    }).join('');
    html += '<div class="ls-grid2">' +
      '<div class="card"><div class="sec-title" style="margin:0"><span class="t">Mock exams</span></div>' +
        (list ? '<div class="exam-hist-rows" style="margin-top:10px">' + list + '</div>'
             : '<p class="muted" style="margin-top:10px">No submitted sittings on this profile.</p>') +
        '<div class="btn-row"><a class="btn btn-ghost btn-sm" href="#/exam">All sittings and replays</a></div></div>' +
      ((PGRE.views.dashboard && PGRE.views.dashboard.readinessCard)
        ? PGRE.views.dashboard.readinessCard() : '') +
      '</div>';

    // Intensity, folded shut; the Today wiring still works inside a details.
    if (PGRE.views.dashboard && PGRE.views.dashboard.intensityCardHTML) {
      html += '<details class="card"><summary class="sec-title" style="margin:0;cursor:pointer">' +
        '<span class="t">Intensity</span></summary>' +
        '<p class="muted" style="margin-top:8px">The banded study-intensity card from Today. ' +
        'The agent status summary keeps computing it.</p>' +
        '<div style="margin-top:10px">' + PGRE.views.dashboard.intensityCardHTML() + '</div></details>';
    }

    // Exam date as text, with the reason the control is gone (A44).
    if (examIso) {
      var passed = examIso <= today;
      html += '<div class="card"><div class="sec-title" style="margin:0"><span class="t">Exam date</span></div>' +
        '<p class="muted" style="margin-top:8px">' + ui.esc(fmtSat(examIso)) + '. ' +
        (passed
          ? 'Until exam day the scheduler kept every card interval short of this date; that cap stopped on ' +
            ui.esc(fmtSat(examIso)) + ', so intervals now grow freely. The date control is not shown any more, ' +
            'because a future date would shorten every subject’s intervals.'
          : 'The scheduler keeps every card interval short of this date.') +
        '</p></div>';
    }
    return html;
  }

  function wire() {
    document.querySelectorAll('#plan-root input[data-task]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var taskId = cb.getAttribute('data-task');
        var taskXp = parseInt(cb.getAttribute('data-xp'), 10);
        var weekDetails = cb.closest('details[data-week]');
        var weekId = weekDetails ? weekDetails.getAttribute('data-week') : null;
        var scrollY = window.scrollY;
        var focusTask = document.activeElement === cb ? taskId : null;

        // Capture previous widths of hero and affected week meters before re-render
        var prevWeekFill = weekDetails ? weekDetails.querySelector('summary .meter-fill') : null;
        var prevWeekWidth = prevWeekFill ? prevWeekFill.style.width : null;
        var prevHeroFill = document.querySelector('#plan-root .hero .meter-fill');
        var prevHeroWidth = prevHeroFill ? prevHeroFill.style.width : null;

        PGRE.gamify.toggleTask(taskId, taskXp);

        // re-render, preserving which <details> are open
        var open = {};
        document.querySelectorAll('#plan-root details[data-week]').forEach(function (d) {
          open[d.getAttribute('data-week')] = d.open;
        });
        var root = document.getElementById('plan-root');
        root.innerHTML = body();
        document.querySelectorAll('#plan-root details[data-week]').forEach(function (d) {
          var id = d.getAttribute('data-week');
          if (id in open) d.open = open[id];
        });
        PGRE.typesetMath(root);
        wire();
        window.scrollTo(0, scrollY);
        if (focusTask) {
          var focusAgain = document.querySelector('#plan-root input[data-task="' +
            CSS.escape(focusTask) + '"]');
          if (focusAgain) {
            try { focusAgain.focus({ preventScroll: true }); } catch (e) { focusAgain.focus(); }
          }
        }

        // Views-A: smoothly glide affected meters from previous to new value, and flash row
        if (PGRE.motion && !PGRE.motion.reduced) {
          var newHeroFill = document.querySelector('#plan-root .hero .meter-fill');
          var newWeekDetails = weekId ? document.querySelector('#plan-root details[data-week="' + weekId + '"]') : null;
          var newWeekFill = newWeekDetails ? newWeekDetails.querySelector('summary .meter-fill') : null;

          if (prevHeroWidth && newHeroFill) {
            var targetHeroWidth = newHeroFill.style.width;
            newHeroFill.style.transition = 'none';
            newHeroFill.style.width = prevHeroWidth;
            requestAnimationFrame(function () {
              requestAnimationFrame(function () {
                if (newHeroFill) {
                  newHeroFill.style.transition = '';
                  newHeroFill.style.width = targetHeroWidth;
                }
              });
            });
          }

          if (prevWeekWidth && newWeekFill) {
            var targetWeekWidth = newWeekFill.style.width;
            newWeekFill.style.transition = 'none';
            newWeekFill.style.width = prevWeekWidth;
            requestAnimationFrame(function () {
              requestAnimationFrame(function () {
                if (newWeekFill) {
                  newWeekFill.style.transition = '';
                  newWeekFill.style.width = targetWeekWidth;
                }
              });
            });
          }

          var input = document.querySelector(
            '#plan-root input[data-task="' + taskId + '"]');
          if (input && input.checked) {
            var row = input.closest('li.task');
            if (row) {
              row.classList.add('task-just-done');
              setTimeout(function () { row.classList.remove('task-just-done'); }, 300);
            }
          }
        }
      });
    });
    document.querySelectorAll('#plan-root [data-launch-set]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var week = btn.closest('details[data-week]');
        try {
          sessionStorage.setItem('pgre-plan-return', JSON.stringify({
            week: week ? week.getAttribute('data-week') : null,
            at: Date.now()
          }));
        } catch (e) {}
        if (PGRE.launchPack(btn.getAttribute('data-launch-set')) == null) {
          PGRE.toast('That set is not available.');
        }
      });
    });
  }

  function restoreReturnContext() {
    var raw = null;
    try { raw = sessionStorage.getItem('pgre-plan-return'); } catch (e) {}
    if (!raw) return;
    var info = null;
    try { info = JSON.parse(raw); } catch (e2) { info = null; }
    try { sessionStorage.removeItem('pgre-plan-return'); } catch (e3) {}
    if (!info || !info.week || !info.at || Date.now() - info.at > 6 * 3600000) return;
    var details = document.querySelector('#plan-root details[data-week="' + CSS.escape(info.week) + '"]');
    if (!details) return;
    var weeksBox = document.getElementById('plan-weeks');
    if (weeksBox) {
      weeksBox.hidden = false;
      var tg = document.getElementById('plan-weeks-toggle');
      if (tg) { tg.setAttribute('aria-expanded', 'true'); tg.textContent = 'Hide the plan weeks'; }
    }
    details.open = true;
    requestAnimationFrame(function () {
      details.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  /* Views-A: run all plan meters (hero + weeks) from 0 to their value on initial paint. */
  function animateMeters() {
    if (!(PGRE.motion && PGRE.motion.animateMeter)) return;
    document.querySelectorAll('#plan-root .meter-fill').forEach(function (f) {
      var pct = parseFloat(f.style.width);
      if (!isNaN(pct)) PGRE.motion.animateMeter(f, pct);
    });
  }

  return {
    render: function () { return '<div id="plan-root">' + body() + '</div>'; },
    mount: function () {
      PGRE.typesetMath(document.getElementById('plan-root'));
      wire();
      var tg = document.getElementById('plan-weeks-toggle');
      if (tg) tg.addEventListener('click', function () {
        var box = document.getElementById('plan-weeks');
        if (!box) return;
        var open = box.hidden;
        box.hidden = !open;
        tg.setAttribute('aria-expanded', open ? 'true' : 'false');
        tg.textContent = open ? 'Hide the plan weeks' : 'Open the plan weeks';
      });
      restoreReturnContext();
      if (PGRE.views.dashboard && PGRE.views.dashboard.mountIntensity) {
        PGRE.views.dashboard.mountIntensity();
      }
      if (PGRE.motion && !PGRE.motion.reduced) animateMeters();
    }
  };
})();
