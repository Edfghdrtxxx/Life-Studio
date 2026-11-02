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

  function body() {
    var ui = PGRE.ui, g = PGRE.gamify;
    var today = PGRE.store.today();
    var days = g.daysToExam();

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

    var html = '<div class="card hero page-head">' +
      '<div class="hero-left"><h1>Review plan</h1>' +
      '<p class="muted">Sep 14 → November 1, 2026 · 7 live weeks · ~16 h/wk: 5 timed sets, 6 formula sessions, 2 extras · checkpoint Oct 4 · intact mocks Oct 11 / 18 / 25 · exam-week taper</p>' +
      ui.meter(100 * allDone / Math.max(1, allTasks), '', {
        word: 'complete', meta: allDone + ' of ' + allTasks + ' tasks'
      }) + '</div>' +
      '<div class="hero-right"><div class="countdown"><div class="countdown-num">' + days + '</div>' +
      '<div class="countdown-label">day' + (days === 1 ? '' : 's') + ' to go</div></div></div></div>';
    // Life Studio: the countdown-era surfaces live here behind the More
    // menu — the dashboard no longer shows them. The runway is the same
    // week-track the dashboard used to render (PGRE.planRunwayHTML below).
    html += PGRE.planRunwayHTML ? PGRE.planRunwayHTML() : '';


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
        // F4: each week names the topics it covers — offer a one-click jump to
        // those topic portals (the hub where you read up and drill them).
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
      restoreReturnContext();
      if (PGRE.motion && !PGRE.motion.reduced) animateMeters();
    }
  };
})();
