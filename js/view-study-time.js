/* Study time — a dedicated page at #/study-time, reachable from the sidebar and
   from the dashboard's Study-time card ("Details →"). A deeper read of the same
   local data the dashboard card summarises, honestly labelled:
   - state.studyLog is DAY-granular seconds — passive heartbeat (js/study-time.js)
     PLUS any focus-timer time (js/timer.js), with no topic dimension.
   - state.timerStats / state.focusSessions are FOCUS-only (the timer).
   There is no per-topic time here because the data has none. Charts are a
   snapshot (no live interval). mount() binds the daily-activity-target editor. */

window.PGRE = window.PGRE || {};
PGRE.views = PGRE.views || {};

PGRE.views.studytime = (function () {
  /* The weekly line is the daily goal times 7 (design §6.10); when the goal
     is off there is no weekly line. */
  function weeklyGoalH() {
    var n = parseInt(PGRE.store.state.settings && PGRE.store.state.settings.dailyTargetMin, 10);
    if (!n || n <= 0) return 0;
    return Math.round(n * 7 / 60);
  }

  /* ——— Local date helpers (same Monday-based convention as js/study-time.js) ——— */
  function pad2(n) { return String(n).padStart(2, '0'); }
  function dayStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function dayKey(offset) {
    var d = new Date();
    d.setDate(d.getDate() + (offset || 0));
    return dayStr(d);
  }

  /* Focus-timer seconds keyed by local calendar day of endedAt — used by the
     daily chart's tooltip. */
  function focusSecByDay() {
    var map = {};
    (PGRE.store.state.focusSessions || []).forEach(function (r) {
      if (!r || !r.endedAt) return;
      var k = dayStr(new Date(r.endedAt));
      map[k] = (map[k] || 0) + (r.seconds || 0);
    });
    return map;
  }

  function hrs(sec) { return (sec / 3600).toFixed(1); }
  function monDayShort(d) { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }

  /* Duration clock for a focus session (matches view-focus fmtClock). */
  function fmtClock(sec) {
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return h > 0 ? h + ':' + p(m) + ':' + p(s) : m + ':' + p(s);
  }

  /* Monday that opens the week `offsetWeeks` back (0 = this week). */
  function weekMonday(offsetWeeks) {
    var now = new Date();
    var back = (now.getDay() + 6) % 7;   // Mon = 0 … Sun = 6
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - back - 7 * offsetWeeks);
  }
  function weekTotalSec(offsetWeeks) {
    var mon = weekMonday(offsetWeeks), total = 0, st = PGRE.studyTime;
    for (var i = 0; i < 7; i++) {
      var d = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i);
      total += st.daySec(dayStr(d));     // future days of the current week read 0
    }
    return total;
  }

  /* Total active seconds over the last `n` calendar days (day 0 = today). */
  function totalLastDays(n) {
    var st = PGRE.studyTime, total = 0;
    for (var i = 0; i < n; i++) total += st.daySec(dayKey(-i));
    return total;
  }

  /* Best single day ever, scanned across the whole studyLog. */
  function bestDay() {
    var log = PGRE.store.state.studyLog || {};
    var bestSec = 0, bestKey = null;
    for (var k in log) {
      var v = log[k];
      if (typeof v === 'number' && v > bestSec) { bestSec = v; bestKey = k; }
    }
    return { sec: bestSec, key: bestKey };
  }

  /* ——— Stat tiles ——— */
  function tilesHTML() {
    var ui = PGRE.ui, st = PGRE.studyTime, s = PGRE.store.state;

    var todaySec = st.todaySec();
    var todayMin = Math.round(todaySec / 60);
    var todayDisp = (todaySec > 0 && todayMin === 0) ? '<1' : String(todayMin);

    var total30 = totalLastDays(30);
    var avg30Sec = total30 / 30;

    var best = bestDay();
    var bestVal = best.sec > 0 ? hrs(best.sec) + '<span class="stat-unit"> h</span>' : '—';
    var bestSub = best.key
      ? new Date(best.key + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'no active days yet';

    var live = PGRE.store.liveStreak();
    var best0 = (s.streak && s.streak.best) || 0;

    var ts = s.timerStats || { sessions: 0, seconds: 0 };

    return '<div class="stat-row st-stats">' +
      ui.statTile('Today', todayDisp + '<span class="stat-unit"> min</span>',
        (dailyTargetMin() ? 'of the ' + dailyTargetMin() + ' min goal' : 'active in this tab')) +
      ui.statTile('This week', hrs(st.weekSec()) + '<span class="stat-unit"> h</span>',
        (weeklyGoalH() ? 'of ' + weeklyGoalH() + ' h (goal × 7)' : 'total active time')) +
      ui.statTile('Last 30 days', hrs(total30) + '<span class="stat-unit"> h</span>', 'total active time') +
      ui.statTile('Daily average', hrs(avg30Sec) + '<span class="stat-unit"> h</span>', 'per day, last 30 d') +
      ui.statTile('Best day', bestVal, bestSub) +
      ui.statTile('Current streak', live + '<span class="stat-unit"> d</span>', 'best ' + best0 + ' day' + (best0 === 1 ? '' : 's')) +
      ui.statTile('Focus sessions', ui.fmt(ts.sessions || 0), 'lifetime, on the timer') +
      ui.statTile('Focus hours', hrs(ts.seconds || 0) + '<span class="stat-unit"> h</span>', 'logged on the timer') +
    '</div>';
  }

  /* ——— Daily activity target ——— */

  function clampDailyTargetMin(n) {
    n = parseInt(n, 10);
    if (!n || n <= 0) return 0;
    n = Math.round(n / 15) * 15;
    return Math.max(15, Math.min(480, n));
  }

  function dailyTargetMin() {
    var n = (PGRE.store.state.settings || {}).dailyTargetMin;
    if (typeof n !== 'number' || !isFinite(n) || n <= 0) return 0;
    return n;
  }

  /* Same math as view-focus elapsedSec: live seconds excluding paused time. */
  function liveFocusElapsedSec() {
    var t = PGRE.store.state.timer;
    if (!t || !t.on || !t.startedAt) return 0;
    var ref = t.paused ? (t.lastCredit || t.startedAt) : Date.now();
    return Math.max(0, (ref - t.startedAt - (t.pausedMs || 0)) / 1000);
  }

  function todayActiveSec() {
    if (PGRE.studyTime && typeof PGRE.studyTime.liveTodaySec === 'function') {
      return PGRE.studyTime.liveTodaySec();
    }
    return PGRE.studyTime.todaySec() + liveFocusElapsedSec();
  }

  function weekActiveSec() {
    var st = PGRE.studyTime;
    if (typeof st.liveTodaySec === 'function') {
      return st.weekSec() + (st.liveTodaySec() - st.todaySec());
    }
    return st.weekSec() + liveFocusElapsedSec();
  }

  /* Shared progress line: "Label · done of total unit · remain unit to go"
     (or · target met / · above target). Same shape for today and week. */
  function progressLine(label, doneStr, totalStr, unit, remainStr, state) {
    var status = label + ' · ' + doneStr + ' of ' + totalStr + ' ' + unit;
    if (state === 'met') status += ' · target met';
    else if (state === 'above') status += ' · above target';
    else status += ' · ' + remainStr + ' ' + unit + ' to go';
    return status;
  }

  function weeklyBandHTML() {
    var goalH = weeklyGoalH();
    if (!goalH) return '';
    var weekSec = weekActiveSec();
    var weekH = weekSec / 3600;
    var scaleH = Math.max(goalH, weekH);
    var fillPct = Math.min(100, 100 * weekH / scaleH);
    var markPct = 100 * goalH / scaleH;
    var weekLabel = hrs(weekSec);
    var remainH = Math.max(0, goalH - weekH);
    var state = weekH > goalH + 0.05 ? 'above'
      : (remainH <= 0.05 ? 'met' : 'go');
    var status = progressLine('This week', weekLabel, String(goalH), 'h',
      remainH.toFixed(1), state);
    var tip = 'This week\\n' + weekLabel + ' of ' + goalH + ' h' +
      (state === 'go' ? ' · ' + remainH.toFixed(1) + ' h to go' : ' · ' +
        (state === 'met' ? 'target met' : 'above target'));
    return '<div class="st-at-meter" data-tip="' + PGRE.ui.esc(tip) + '">' +
      PGRE.ui.meter(fillPct, 'meter-thin meter-week') +
      '<div class="st-at-mark" style="left:' + markPct + '%"></div>' +
    '</div>' +
    '<div class="challenge-prog">' + PGRE.ui.esc(status) + '</div>';
  }



  function activityTargetProgressHTML(targetMin, doneSec, timerOn) {
    var html;
    if (!targetMin) {
      html = '<p class="muted">Set a daily activity target to track it here.</p>';
    } else {
      var targetSec = targetMin * 60;
      var pct = Math.min(100, 100 * doneSec / targetSec);
      var pctR = Math.round(pct);
      var doneMin = Math.floor(doneSec / 60);
      var remainSec = Math.max(0, targetSec - doneSec);
      var remainMin = Math.ceil(remainSec / 60);
      var met = remainSec <= 0;
      var status = progressLine('Today', String(doneMin), String(targetMin), 'min',
        String(remainMin), met ? 'met' : 'go');
      var tip = 'Active time today\\n' + doneMin + ' of ' + targetMin + ' min' +
        (met ? ' · target met' : ' · ' + remainMin + ' min to go') + ' (' + pctR + '%)';
      html = '<div data-tip="' + PGRE.ui.esc(tip) + '">' +
        PGRE.ui.meter(pct, 'meter-thin', {
          word: 'today', meta: doneMin + ' of ' + targetMin + ' min'
        }) + '</div>' +
        '<div class="challenge-prog">' + PGRE.ui.esc(status) + '</div>';
    }
    html += weeklyBandHTML();
    if (timerOn && targetMin) html += '<p class="muted st-note">Session in progress.</p>';
    return html;
  }

  function activityTargetActionHTML(timerOn, targetMin, remainMin) {
    if (timerOn) {
      return '<a class="btn btn-ghost" href="#/focus">Focus session running — open timer →</a>';
    }
    if (targetMin > 0 && remainMin > 0) {
      return '<button type="button" class="btn btn-primary" id="st-at-start" data-at-remain="' +
        remainMin + '">Focus ' + remainMin + ' min →</button>';
    }
    return '<button type="button" class="btn btn-primary" id="st-at-start" data-at-remain="">' +
      'Start focus timer →</button>';
  }

  function activityTargetChipsHTML(targetMin) {
    var presets = [60, 120, 180, 300];
    var html = '<button type="button" class="focus-chip' + (targetMin === 0 ? ' active' : '') +
      '" data-atarget="0">Off</button>';
    presets.forEach(function (m) {
      html += '<button type="button" class="focus-chip' + (targetMin === m ? ' active' : '') +
        '" data-atarget="' + m + '">' + m + ' min</button>';
    });
    var isPreset = targetMin === 0 || presets.indexOf(targetMin) >= 0;
    var customVal = (!isPreset && targetMin > 0) ? String(targetMin) : '';
    html += '<span class="focus-chip focus-chip-custom">' +
      '<input id="st-at-custom" class="focus-custom-in" type="number" min="15" max="480" step="15" ' +
      'inputmode="numeric" placeholder="min" aria-label="Custom daily activity minutes" ' +
      'value="' + customVal + '"></span>';
    return html;
  }

  function activityTargetHTML() {
    var targetMin = dailyTargetMin();
    var doneSec = todayActiveSec();
    var timerOn = !!(PGRE.store.state.timer && PGRE.store.state.timer.on);
    var remainMin = targetMin > 0
      ? Math.ceil(Math.max(0, targetMin * 60 - doneSec) / 60) : 0;
    return '<div class="card" id="st-active-target">' +
      '<h2>Daily activity target</h2>' +
      '<p class="muted st-lead">Active minutes today — tab activity plus the focus timer — against a goal you pick. Below: this week against the goal times 7. The same picker is in Settings ▸ Study.</p>' +
      '<div id="st-at-progress">' + activityTargetProgressHTML(targetMin, doneSec, timerOn) + '</div>' +
      '<div class="chip-row" id="st-at-chips">' + activityTargetChipsHTML(targetMin) + '</div>' +
      '<div class="st-at-action" id="st-at-action">' +
        activityTargetActionHTML(timerOn, targetMin, remainMin) + '</div>' +
    '</div>';
  }

  function paintActivityTarget() {
    var progress = document.getElementById('st-at-progress');
    var action = document.getElementById('st-at-action');
    var targetMin = dailyTargetMin();
    var doneSec = todayActiveSec();
    var timerOn = !!(PGRE.store.state.timer && PGRE.store.state.timer.on);
    var remainMin = targetMin > 0
      ? Math.ceil(Math.max(0, targetMin * 60 - doneSec) / 60) : 0;
    if (progress) progress.innerHTML = activityTargetProgressHTML(targetMin, doneSec, timerOn);
    if (action) action.innerHTML = activityTargetActionHTML(timerOn, targetMin, remainMin);
    var chips = document.getElementById('st-at-chips');
    if (!chips) return;
    Array.prototype.forEach.call(chips.querySelectorAll('[data-atarget]'), function (b) {
      var v = parseInt(b.getAttribute('data-atarget'), 10);
      if (isNaN(v)) v = 0;
      b.classList.toggle('active', v === targetMin);
    });
  }

  function setDailyTargetMin(n) {
    PGRE.store.state.settings.dailyTargetMin = n;
    PGRE.store.save();
    paintActivityTarget();
  }


  /* ——— Other apps (report §14.3): Maimemo seconds per day from the bridge
     (js/study-sources.js), {} while disconnected. Render reads the shared
     cache; mount refreshes the two cards when the fetch resolves. ——— */
  function mmData() {
    var c = PGRE.studySources && PGRE.studySources.cached && PGRE.studySources.cached();
    if (c && c.status === 'ok' && c.data) return PGRE.studySources.maimemoSecByDay(c.data);
    return {};
  }
  function mmAny(mmByDay) {
    for (var k in mmByDay) if (mmByDay[k] > 0) return true;
    return false;
  }
  function paintSources(res) {
    var daily = document.getElementById('st-daily-slot');
    var cal = document.getElementById('st-cal-slot');
    if (!daily && !cal) return;             // the route already changed
    var mm = (res && res.status === 'ok')
      ? PGRE.studySources.maimemoSecByDay(res.data) : {};
    if (daily) daily.innerHTML = dailyChartHTML(mm);
    if (cal) cal.innerHTML = yearCalendarHTML(mm);
  }

  /* ——— Last-28-days daily bar chart (pure-div bars; forecastHTML pattern).
     Studio minutes come from state.studyLog; Maimemo minutes stack on top
     (js/study-sources.js, `mmByDay` = day-key -> seconds, {} when the bridge
     has not answered). Every day's tooltip carries both numbers; the printed
     "studio +Maimemo" pair appears only under today's bar — one pair per
     column width stays legible where 28 would crowd. ——— */
  function dailyChartHTML(mmByDay) {
    mmByDay = mmByDay || {};
    var st = PGRE.studyTime, days = [], max = 1, i;
    var focusByDay = focusSecByDay();

    for (i = 27; i >= 0; i--) {
      var key = dayKey(-i);
      var sec = st.daySec(key);
      var mm = mmByDay[key] || 0;
      if (sec + mm > max) max = sec + mm;
      days.push({ key: key, sec: sec, mm: mm, ago: i });
    }
    var total = days.reduce(function (a, d) { return a + d.sec; }, 0);
    var mmTotal = days.reduce(function (a, d) { return a + d.mm; }, 0);

    var body;
    if (total <= 0 && mmTotal <= 0) {
      body = '<p class="muted">No active time logged in the last 28 days — the passive tracker ' +
        'counts seconds as you interact with the app, and the focus timer adds any time you log there.</p>';
    } else {
      var bars = '';
      days.forEach(function (d) {
        var tot = d.sec + d.mm;
        var h = tot > 0 ? Math.max(4, Math.round(100 * tot / max)) : 0;
        var isToday = d.ago === 0;
        var cls = 'stbar' + (d.sec > 0 ? (isToday ? ' stbar-today' : '') : ' stbar-zero');
        var dt = new Date(d.key + 'T12:00:00');
        var dayLbl = dt.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        var studioMin = Math.round(d.sec / 60);
        var mmMin = Math.round(d.mm / 60);
        var totalMin = studioMin + mmMin;
        var line2 = totalMin < 60
          ? totalMin + ' min active'
          : Math.floor(totalMin / 60) + ' h ' + (totalMin % 60) + ' min active';
        line2 += ' · studio ' + studioMin + ' min' + (mmMin ? ' · Maimemo ' + mmMin + ' min' : '');
        var fm = Math.round((focusByDay[d.key] || 0) / 60);
        if (fm > 0) line2 += ' · ' + fm + ' min focus';
        var x = isToday ? 'today' : (d.ago % 7 === 0 ? (d.ago / 7) + 'w' : '');
        /* Maimemo's share is the top segment of the same bar; the studio
           keeps its solid ink (coral today) so the sum reads at a glance. */
        var bar;
        if (d.mm > 0) {
          /* Top segment is Maimemo's share; the studio segment keeps its
             solid ink (coral today) and drops out entirely at 0 min. */
          bar = '<div class="stbar-stack" style="height:' + h + '%">' +
            '<div class="stbar-mm" style="flex:' + Math.round(100 * d.mm / tot) + '"></div>' +
            (d.sec > 0
              ? '<div class="' + cls + '" style="flex:' + Math.round(100 * d.sec / tot) + ';height:auto"></div>'
              : '') +
            '</div>';
        } else {
          bar = '<div class="' + cls + '" style="height:' + h + '%"></div>';
        }
        bars += '<div class="stbar-col" data-tip="' + PGRE.ui.esc(dayLbl + '\\n' + line2) + '">' +
          bar +
          (mmMin > 0 && isToday
            ? '<span class="stbar-mm-n">' + studioMin + '\n&#43;' + mmMin + '</span>'
            : '<span class="stbar-mm-n stbar-mm-n-empty"></span>') +
          '<span class="stbar-x' + (isToday ? ' stbar-x-cur' : '') + '">' + x + '</span></div>';
      });
      body = '<div class="stbar-strip">' + bars + '</div>' +
        (mmTotal > 0
          ? '<div class="stbar-key"><span><i class="st"></i>Studio</span>' +
            '<span><i class="mm"></i>Maimemo</span>' +
            '<span class="muted">Obsidian sessions are counted, not timed.</span></div>'
          : '') +
        (mmTotal > 0
          ? '<p class="muted st-note">Studio and Maimemo minutes per day — "studio + Maimemo" is ' +
            'printed under today\'s bar and in every day\'s tooltip. Studio is the passive heartbeat ' +
            'plus the focus timer; Maimemo comes from the Mac helper. Today is highlighted.</p>'
          : '<p class="muted st-note">Active time each day for the last 28 days — the passive heartbeat ' +
            'plus any focus-timer time, combined. Today is highlighted.</p>');
    }
    return '<div class="card"><h2>Daily activity</h2>' + body + '</div>';
  }


  /* ——— Weekly totals — last 8 Monday-based weeks, marker at goal × 7 ——— */
  function weeklyStripHTML() {
    var goalH = weeklyGoalH();
    var goalSec = goalH * 3600;
    var weeks = [], scale = Math.max(goalSec, 1), w;
    for (w = 7; w >= 0; w--) {
      var sec = weekTotalSec(w);
      if (sec > scale) scale = sec;
      weeks.push({ sec: sec, mon: weekMonday(w), current: w === 0 });
    }
    var markBottom = goalSec > 0 ? 100 * goalSec / scale : 0;

    var bars = '', labs = '';
    weeks.forEach(function (wk) {
      var hh = hrs(wk.sec);
      var pctH = wk.sec > 0 ? Math.max(4, Math.round(100 * wk.sec / scale)) : 0;
      var met = goalSec > 0 && wk.sec >= goalSec;
      var cls = 'stweek-bar' + (met ? ' stweek-met' : '') + (wk.current ? ' stweek-current' : '');
      var sun = new Date(wk.mon.getFullYear(), wk.mon.getMonth(), wk.mon.getDate() + 6);
      var range = PGRE.ui.dateRange(dayStr(wk.mon), dayStr(sun));
      var line2 = hh + ' h active';
      if (wk.current) line2 += ' · in progress';
      else if (goalSec > 0) {
        line2 += met ? ' · on target'
          : ' · ' + ((goalSec - wk.sec) / 3600).toFixed(1) + ' h under ' + goalH + ' h';
      }
      bars += '<div class="stweek-col" data-tip="' + PGRE.ui.esc('Week of ' + range + '\\n' + line2) + '">' +
        '<div class="' + cls + '" style="height:' + pctH + '%"></div></div>';
      labs += '<div class="stweek-lab">' +
        '<span class="stweek-h' + (met ? ' stweek-h-met' : '') + '">' + hh + '</span>' +
        '<span class="stweek-x' + (wk.current ? ' stweek-x-cur' : '') + '">' +
          (wk.current ? 'this wk' : monDayShort(wk.mon)) + '</span></div>';
    });

    return '<div class="card"><h2>Weekly totals</h2>' +
      '<div class="stweek">' +
        '<div class="stweek-plot">' +
          (goalSec > 0 ? '<div class="stweek-mark" style="bottom:' + markBottom.toFixed(1) + '%"></div>' : '') +
          bars +
        '</div>' +
        '<div class="stweek-labels">' + labs + '</div>' +
      '</div>' +
      '<p class="muted st-note">Hours per week, Monday to Sunday, last 8 weeks. ' +
      (goalSec > 0
        ? 'The dashed line is the daily goal times 7 (' + goalH + ' h at ' + dailyTargetMin() + ' min).'
        : 'No daily goal is set, so there is no weekly line.') +
      ' This week is still in progress.</p>' +
    '</div>';
  }

  /* ——— The last 12 months: one square per day, studio minutes from
     state.studyLog plus Maimemo minutes from the bridge (`mmByDay`). ——— */
  function yearCalendarHTML(mmByDay) {
    mmByDay = mmByDay || {};
    var st = PGRE.studyTime, s = PGRE.store.state;
    var log = s.studyLog || {};

    // The grid is column-first weeks (grid-auto-flow: column), so the walk
    // starts on the Monday of the week 52 weeks back.
    var end = new Date();
    var start = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - 7 * 51);

    var cells = '', studied = 0, firstKey = dayStr(start), lastKey = dayStr(end);
    for (var d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      var key = dayStr(d);
      var studioSec = (typeof log[key] === 'number' ? log[key] : 0) +
        (key === lastKey ? Math.max(0, todayActiveSec() - (log[key] || 0)) : 0);
      var mmSec = mmByDay[key] || 0;
      var sec = studioSec + mmSec;
      if (sec > 0) studied++;
      var lvl = 0;
      if (sec > 0) lvl = 1;
      if (sec >= 3600) lvl = 2;
      if (sec >= 3 * 3600) lvl = 3;
      if (sec >= 6 * 3600) lvl = 4;
      var dt = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      var lbl = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      var tip;
      if (sec > 0) {
        tip = lbl + '\\n' + (sec >= 3600 ? hrs(sec) + ' h' : Math.round(sec / 60) + ' min') + ' active';
        if (mmSec > 0) {
          tip += ' · studio ' + Math.round(studioSec / 60) +
            ' min, Maimemo ' + Math.round(mmSec / 60) + ' min';
        }
      } else {
        tip = lbl + '\\nno study';
      }
      cells += '<i class="' + (lvl ? 'l' + lvl : '') + '" data-tip="' + PGRE.ui.esc(tip) + '"></i>';
    }
    var streak = PGRE.store.liveStreak ? PGRE.store.liveStreak() : 0;

    return '<div class="card"><h2>The last 12 months</h2>' +
      '<p class="muted st-lead">One square per day; darker means more hours — ' +
      (mmAny(mmByDay)
        ? 'studio and Maimemo minutes summed, both from the daily logs.'
        : 'from the daily study log, which keeps every day.') + '</p>' +
      '<div class="hm-cal" style="margin-top:10px">' + cells + '</div>' +
      '<p class="meta" style="margin-top:6px">' +
        PGRE.ui.dateRange(firstKey, lastKey) + ' · ' + PGRE.ui.fmt(studied) +
        ' day' + (studied === 1 ? '' : 's') + ' studied' +
        (streak ? ' · streak ' + streak + ' day' + (streak === 1 ? '' : 's') : '') +
      '</p></div>';
  }

  /* ——— Focus vs. app-activity split over the last 30 days ——— */
  function splitHTML() {
    var s = PGRE.store.state;
    var total30 = totalLastDays(30);
    var cutoff = Date.now() - 30 * 86400000;
    var focusSec = 0;
    (s.focusSessions || []).forEach(function (r) {
      var t = r && r.endedAt ? new Date(r.endedAt).getTime() : 0;
      if (t >= cutoff) focusSec += (r.seconds || 0);
    });
    // The timer credits studyLog too, so focus time is a SUBSET of the 30-day
    // active total; the remainder is passive app activity. Clamp so edge cases
    // (a session straddling the window edge, the 4 h cap) can't overrun the bar.
    var focusShown = Math.min(focusSec, total30);
    var passiveSec = Math.max(0, total30 - focusShown);

    var body;
    if (total30 <= 0) {
      body = '<p class="muted">No active time in the last 30 days yet.</p>';
    } else {
      var fPct = 100 * focusShown / total30;
      var pPct = 100 - fPct;
      var seg = '<div class="st-split-bar">' +
        (fPct > 0 ? '<div class="st-split-focus" style="width:' + fPct.toFixed(1) + '%" data-tip="' +
          PGRE.ui.esc('Focus timer\\n' + hrs(focusShown) + ' h · ' + Math.round(fPct) + '% of active time') +
          '"></div>' : '') +
        (pPct > 0 ? '<div class="st-split-passive" style="width:' + pPct.toFixed(1) + '%" data-tip="' +
          PGRE.ui.esc('App activity\\n' + hrs(passiveSec) + ' h · ' + Math.round(pPct) + '% of active time') +
          '"></div>' : '') +
      '</div>';

      var legend = '<div class="st-split-legend">' +
        '<div class="st-split-item"><span class="st-swatch st-swatch-focus"></span>' +
          'Focus timer — <strong>' + hrs(focusShown) + ' h</strong> ' +
          '<span class="muted">(' + Math.round(fPct) + '%)</span></div>' +
        '<div class="st-split-item"><span class="st-swatch st-swatch-passive"></span>' +
          'App activity — <strong>' + hrs(passiveSec) + ' h</strong> ' +
          '<span class="muted">(' + Math.round(pPct) + '%)</span></div>' +
      '</div>';
      body = seg + legend +
        '<p class="muted st-note">"App activity" is time the passive heartbeat credited while you used the ' +
        'app outside a running timer — reading, clicking, answering. "Focus timer" is time you logged on the ' +
        'timer, which also counts reading and derivations you do on paper.</p>';
    }
    return '<div class="card"><h2>Focus vs. app activity</h2>' +
      '<p class="muted st-lead">Last 30 days, split by where the time was counted.</p>' + body + '</div>';
  }

  /* ——— Recent focus sessions (row style borrowed from view-focus) ——— */
  function recentFocusHTML() {
    var list = (PGRE.store.state.focusSessions || []).slice(-6).reverse();
    var head = '<div class="st-recent-head"><h2>Recent focus sessions</h2>' +
      '<a class="btn btn-ghost btn-sm" href="#/focus">Focus timer →</a></div>';
    if (!list.length) {
      return '<div class="card">' + head +
        '<p class="muted">No focus sessions yet — start one on the ' +
        '<a href="#/focus">focus timer</a>. Reading or deriving on paper counts.</p></div>';
    }
    var rows = list.map(function (r) {
      var dur = fmtClock(r.seconds);
      var tag = (r.goalMin == null)
        ? '<span class="focus-tag">stopwatch</span>'
        : (r.met ? '<span class="focus-tag focus-tag-met">' + r.goalMin + ' min · met ✓</span>'
                 : '<span class="focus-tag">' + r.goalMin + ' min · stopped early</span>');
      return '<li class="focus-sess"><span class="focus-sess-dur">' + dur + '</span>' + tag +
        '<span class="focus-sess-when muted">' + PGRE.ui.timeAgo(r.endedAt) + '</span></li>';
    }).join('');
    return '<div class="card">' + head + '<ul class="focus-sess-list">' + rows + '</ul></div>';
  }

  function render() {
    var head = '<div class="card page-head"><h1>Study time</h1>' +
      '<p class="muted">Active time from the tab heartbeat and the focus timer. ' +
      'Counted per day, so there is no per-topic split.</p></div>';

    // Slots repaint when the bridge answer arrives (mount → paintSources).
    var mm = mmData();
    return head +
      tilesHTML() +
      activityTargetHTML() +
      '<div class="two-col"><div id="st-daily-slot">' + dailyChartHTML(mm) + '</div>' +
        weeklyStripHTML() + '</div>' +
      '<div id="st-cal-slot">' + yearCalendarHTML(mm) + '</div>' +
      '<div class="two-col">' + splitHTML() + recentFocusHTML() + '</div>';
  }

  function mount() {
    // Maimemo minutes for the daily bars and the 12-month calendar; the
    // bridge not answering paints the same page with studio time only.
    if (PGRE.studySources && PGRE.studySources.load) {
      PGRE.studySources.load().then(paintSources);
    }

    var card = document.getElementById('st-active-target');
    if (!card) return;


    card.addEventListener('click', function (e) {
      var chip = e.target.closest && e.target.closest('[data-atarget]');
      if (chip && card.contains(chip)) {
        var n = parseInt(chip.getAttribute('data-atarget'), 10);
        if (isNaN(n)) n = 0;
        var input = document.getElementById('st-at-custom');
        if (input) input.value = '';
        setDailyTargetMin(n);
        return;
      }
      var startBtn = e.target.closest && e.target.closest('#st-at-start');
      if (!startBtn || !PGRE.timer) return;
      var remain = startBtn.getAttribute('data-at-remain');
      var goal = remain ? parseInt(remain, 10) : null;
      if (goal != null && (!isFinite(goal) || goal <= 0)) goal = null;
      PGRE.timer.start(goal);
      location.hash = '#/focus';
    });

    var input = document.getElementById('st-at-custom');
    if (!input) return;
    // Live paint only — store.save() is an unthrottled full-blob localStorage
    // write. view-focus's custom-minutes box also uses input for UI and commits
    // on blur (Start blurs the field first).
    input.addEventListener('input', function () {
      var n;
      if (!input.value) n = 0;
      else {
        var raw = parseInt(input.value, 10);
        n = (!raw || raw <= 0) ? 0 : clampDailyTargetMin(raw);
      }
      PGRE.store.state.settings.dailyTargetMin = n;
      paintActivityTarget();
    });
    input.addEventListener('blur', function () {
      var n = dailyTargetMin();
      var presets = [0, 60, 120, 180];
      input.value = (presets.indexOf(n) >= 0) ? '' : String(n);
      PGRE.store.save();
    });

  }


  return { render: render, mount: mount, activityTargetHTML: activityTargetHTML };
})();
