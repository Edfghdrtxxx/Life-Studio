/* Settings (Life Studio, round 2 — §6.9): one page, three sections with
   jump links. Appearance: the named-theme picker (settings.theme). Study:
   new cards per day, cards per batch, direction, the daily time goal —
   moved out of the Recall Options box (A19, A39). Data: where progress
   lives, export and restore, disk backup, and the danger zone — moved out
   of the Library (A34); each reset downloads an export first, then asks to
   type RESET. Every control names the saved key it writes. */
window.PGRE = window.PGRE || {};
PGRE.views = PGRE.views || {};

PGRE.views.settings = (function () {

  function swatchHTML(theme, current) {
    var ui = PGRE.ui, s = theme.swatch || {};
    return '<button type="button" class="theme-swatch' + (current ? ' is-current' : '') + '"' +
      ' data-theme-pick="' + ui.esc(theme.id) + '" aria-pressed="' + (current ? 'true' : 'false') + '">' +
      '<span class="theme-swatch-page" style="background:' + ui.esc(s.bg || '#fff') + '">' +
        '<span class="theme-swatch-bar" style="background:' + ui.esc(s.accent || '#888') + '"></span>' +
        '<span class="theme-swatch-line" style="background:' + ui.esc(s.ink || '#000') + ';width:70%"></span>' +
        '<span class="theme-swatch-line" style="background:' + ui.esc(s.ink || '#000') + ';width:45%;opacity:.55"></span>' +
      '</span>' +
      '<span class="theme-swatch-name">' + ui.esc(theme.name) +
        (current ? ' <span class="theme-swatch-on">· in use</span>' : '') + '</span>' +
      '</button>';
  }

  function keyNote(k) {
    return '<div class="key">saved as <code>settings.' + k + '</code></div>';
  }

  /* ——— Appearance ——— */

  function appearanceHTML() {
    var current = PGRE.normalizeTheme
      ? PGRE.normalizeTheme(PGRE.store.state.settings.theme)
      : PGRE.store.state.settings.theme;
    var swatches = '';
    (PGRE.THEMES || []).forEach(function (t) {
      swatches += swatchHTML(t, t.id === current);
    });
    return '<div class="card" id="set-appearance"><span class="kicker">Appearance</span>' +
      '<h2>Theme</h2>' +
      '<p class="muted">Applies at once and is remembered in this browser. The sidebar ' +
      '“Light / dark” button flips between your light theme and Warm dark.</p>' +
      '<div class="theme-grid" id="theme-grid">' + swatches + '</div>' +
      keyNote('theme') + '</div>';
  }

  /* ——— Study ——— */

  function stepperHTML(id, value) {
    return '<div class="stepper" data-step="' + id + '">' +
      '<button class="btn btn-ghost btn-sm" data-delta="-1" aria-label="Fewer">−</button>' +
      '<b>' + value + '</b>' +
      '<button class="btn btn-ghost btn-sm" data-delta="1" aria-label="More">+</button></div>';
  }

  function studyHTML() {
    var s = PGRE.store.state.settings;
    var goal = parseInt(s.dailyTargetMin, 10) || 0;
    var presets = [0, 60, 120, 180, 300];
    var chips = presets.map(function (m) {
      return '<button class="focus-chip' + (goal === m ? ' active' : '') +
        '" data-goal="' + m + '">' + (m ? m + ' min' : 'Off') + '</button>';
    }).join('');
    var custom = presets.indexOf(goal) < 0 && goal > 0 ? String(goal) : '';
    chips += '<span class="focus-chip focus-chip-custom">' +
      '<input id="set-goal-custom" class="focus-custom-in" type="number" min="15" max="480" step="15" ' +
      'inputmode="numeric" placeholder="min" aria-label="Custom daily goal minutes" ' +
      'value="' + custom + '"></span>';

    return '<div class="card" id="set-study"><span class="kicker">Study</span>' +
      '<h2>Daily review</h2>' +
      '<div class="set-row"><div><b style="font-weight:500">New cards per day</b>' +
        '<div class="d">Never-studied cards the review may start in one day, across all subjects. ' +
        'They come after the due cards. Due reviews are never capped. From 1 to 100.</div>' +
        keyNote('newCardsPerDay') + '</div>' +
        stepperHTML('newday', s.newCardsPerDay) + '</div>' +
      '<div class="set-row"><div><b style="font-weight:500">Cards per batch</b>' +
        '<div class="d">How many cards Start and Next pick at a time. Was “Formulas per day”. From 1 to 100.</div>' +
        keyNote('formulaDailyTarget') + '</div>' +
        stepperHTML('batch', s.formulaDailyTarget) + '</div>' +
      '<div class="set-row"><div><b style="font-weight:500">Direction</b>' +
        '<div class="d">Front to back: recall the answer. Back to front: see the answer and name what it belongs to.</div>' +
        keyNote('formulaReverse') + '</div>' +
        '<div class="seg" role="group" id="dir-toggle">' +
          '<button aria-pressed="' + (!s.formulaReverse) + '" data-dir="0">Front → back</button>' +
          '<button aria-pressed="' + (!!s.formulaReverse) + '" data-dir="1">Back → front</button></div></div>' +
      '<div class="card" style="margin-top:16px"><h2>Daily time goal</h2>' +
        '<div class="set-row"><div><b style="font-weight:500">Active minutes per day</b>' +
          '<div class="d">Time with a studio tab in use, plus the focus timer. The weekly line ' +
          'on Study time is this goal times 7.</div>' +
          keyNote('dailyTargetMin') + '</div>' +
          '<div class="chip-row" id="goal-chips">' + chips + '</div></div>' +
        '</div></div>';
  }
  /* ——— Other apps (report §14.3/§14.4) ——— */

  /* Connection state for the "Other apps" card: reads the shared
     js/study-sources.js cache only — the one-time setup never asks for the
     Maimemo token, which lives in the macOS Keychain and is never typed
     into or stored by the studio. */
  function otherAppsStatusHTML() {
    var ss = PGRE.studySources;
    var c = ss && ss.cached && ss.cached();
    if (!c) return '<span class="oa-set-state muted">Checking the status bridge…</span>';
    if (c.status !== 'ok') {
      return '<span class="oa-set-state">Not connected — the status bridge did not answer ' +
        'or has no study-sources file yet.</span>';
    }
    var stale = ss.freshness(c.data) === 'stale';
    var when = ss.fmtUpdated(ss.lastUpdatedAt(c.data)) || 'unknown';
    var today = ss.entryFor(c.data);
    var mm = ss.hasMaimemo(today);
    var nSess = ss.sessionsOf(today).length;
    var bits = [];
    bits.push(mm ? 'Maimemo: ' + (typeof today.maimemo.finished === 'number' ? today.maimemo.finished : 0) +
      ' of ' + (typeof today.maimemo.total === 'number' ? today.maimemo.total : '—') +
      ' words, ' + ss.fmtMin(ss.maimemoSec(today) / 60)
      : 'Maimemo: no numbers for today yet — open the app once');
    bits.push('Obsidian: ' + nSess + ' session' + (nSess === 1 ? '' : 's') + ' today');
    return '<span class="oa-set-state">' + (stale ? 'No update since ' + PGRE.ui.esc(when) +
      ' — the helper runs every 120 minutes.' : 'Connected — last update ' + PGRE.ui.esc(when) + '.') +
      ' <span class="muted">' + PGRE.ui.esc(bits.join(' · ')) + '</span></span>';
  }

  function paintOtherApps(res) {
    var el = document.getElementById('oa-set-status');
    if (el) el.innerHTML = otherAppsStatusHTML();
  }

  function otherAppsHTML() {
    return '<div class="card" id="set-other-apps"><span class="kicker">Other apps</span>' +
      '<h2>Maimemo and Obsidian</h2>' +
      '<p id="oa-set-status">' + otherAppsStatusHTML() + '</p>' +
      '<p class="muted">Life Studio can show your Maimemo minutes and words and today’s ' +
      'Obsidian learning sessions on Today and on Study time. A small helper on this Mac ' +
      'reads them every 120 minutes through the local status bridge. It reads only: it ' +
      'writes nothing to Maimemo, Obsidian or this app, and the Maimemo token lives in the ' +
      'macOS Keychain — it is never typed into or saved by the studio.</p>' +
      '<div class="set-row"><div><b style="font-weight:500">One-time setup</b>' +
        '<div class="d"><ol class="oa-steps">' +
        '<li>In Maimemo, turn on automatic sync, and open the app at least once a day.</li>' +
        '<li>Get the token in Maimemo: 我的 › 更多设置 › 实验功能 › 开放 API.</li>' +
        '<li>In Terminal, put the token in the Keychain — it prompts, so the token never ' +
          'lands in a file or in shell history:<br><code class="oa-cmd">security add-generic-password ' +
          '-s orbitos-maimemo-token -a maimemo -U -w</code></li>' +
        '<li>Install the helper’s launch job from the OrbitOS folder; it runs at login and ' +
          'then every 120 minutes:<br><code class="oa-cmd">mkdir -p ~/Library/LaunchAgents &amp;&amp; ' +
          'cp 99_System/Services/pgre-status-bridge/com.orbitos.study-sources.plist ' +
          '~/Library/LaunchAgents/ &amp;&amp; launchctl bootstrap "gui/$(id -u)" ' +
          '~/Library/LaunchAgents/com.orbitos.study-sources.plist</code></li>' +
        '</ol>The full guide is in the OrbitOS vault at ' +
        '<code>99_System/Services/pgre-status-bridge/README.md</code>.</div></div></div>' +
    '</div>';
  }

  /* ——— Data ——— */

  function dataHTML() {
    var origin = '';
    try { origin = location.origin + location.pathname; } catch (e) { origin = 'this address'; }
    return '<div class="card" id="set-data"><span class="kicker">Data</span>' +
      '<h2>Where your progress lives</h2>' +
      '<p class="muted">In this browser, at <code style="font-family:var(--mono);font-size:12px">' +
        PGRE.ui.esc(origin) + '</code>. Another address (localhost, 127.0.0.1) keeps separate, ' +
        'empty progress.</p>' +
      '<div class="btn-row">' +
        '<button class="btn btn-ghost" id="export-btn">Export progress</button>' +
        '<button class="btn btn-ghost" id="import-progress-btn">Restore from a file…</button>' +
        '<button class="btn btn-ghost" id="restore-backup-btn">Restore the browser safety copy</button>' +
        '<input type="file" id="progress-input" accept=".json" hidden>' +
      '</div>' +
      '<p class="meta" style="margin-top:8px">Export downloads one JSON file with every card schedule, ' +
        'review, streak and setting. Restoring a file replaces the progress here after you confirm.</p>' +
    '</div>' +
    '<div class="card" id="disk-backup-card"><h2>Disk backup</h2>' +
      '<p class="muted">Copies committed progress to versioned files on this Mac, outside the browser. ' +
      'A failed copy never undoes a grade.</p>' +
      '<p id="backup-status" class="muted"></p>' +
      '<p id="backup-warning" class="backup-warning" hidden></p>' +
      '<label class="backup-token-label" for="backup-token-input">Backup token</label>' +
      '<input type="password" id="backup-token-input" class="exam-date-input backup-token-input" autocomplete="off">' +
      '<div class="btn-row">' +
        '<button class="btn btn-ghost" id="backup-now-btn" type="button">Back up now</button>' +
        '<button class="btn btn-ghost" id="backup-refresh-btn" type="button">Refresh list</button>' +
      '</div>' +
      '<div id="backup-list"></div>' +
      '<div class="danger-confirm" id="backup-restore-confirm" hidden></div>' +
    '</div>' +
    '<div class="card danger-zone"><h2>Danger zone</h2>' +
      '<p class="muted">Each reset first downloads an export, then asks you to type RESET.</p>' +
      '<div class="set-row"><div><b style="font-weight:500">Reset card schedules</b>' +
        '<div class="d">Every card becomes never studied again. Exam scores and question attempts stay.</div></div>' +
        '<button class="btn btn-danger-ghost btn-sm" id="reset-cards-btn">Reset card schedules</button></div>' +
      '<div class="set-row"><div><b style="font-weight:500">Reset all progress</b>' +
        '<div class="d">XP, achievements, streaks, schedules, the mistake book. No undo except the export.</div></div>' +
        '<button class="btn btn-danger-ghost btn-sm" id="reset-all-btn">Reset all progress</button></div>' +
      '<div class="btn-row danger-confirm" id="reset-confirm" hidden></div>' +
    '</div>';
  }

  /* ——— Wiring ——— */

  function downloadExport() {
    var blob = new Blob([PGRE.store.exportJSON()], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'life-studio-progress-' + PGRE.store.today() + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  function wireAppearance() {
    var grid = document.getElementById('theme-grid');
    if (!grid) return;
    grid.querySelectorAll('.theme-swatch').forEach(function (b) {
      b.addEventListener('click', function () {
        PGRE.setTheme(b.getAttribute('data-theme-pick'));
        grid.querySelectorAll('.theme-swatch').forEach(function (o) {
          var on = o === b;
          o.classList.toggle('is-current', on);
          o.setAttribute('aria-pressed', on ? 'true' : 'false');
          var name = o.querySelector('.theme-swatch-name');
          if (name) {
            var theme = PGRE.themeEntry(o.getAttribute('data-theme-pick'));
            name.innerHTML = PGRE.ui.esc(theme.name) +
              (on ? ' <span class="theme-swatch-on">· in use</span>' : '');
          }
        });
      });
    });
  }

  function wireStudy() {
    document.querySelectorAll('#set-study .stepper').forEach(function (box) {
      var kind = box.getAttribute('data-step');
      box.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          var s = PGRE.store.state.settings;
          var d = parseInt(b.getAttribute('data-delta'), 10);
          if (kind === 'newday') s.newCardsPerDay = PGRE.srs.clampTarget(s.newCardsPerDay + d);
          else s.formulaDailyTarget = PGRE.srs.clampTarget(s.formulaDailyTarget + d);
          PGRE.store.save();
          box.querySelector('b').textContent =
            (kind === 'newday' ? s.newCardsPerDay : s.formulaDailyTarget);
        });
      });
    });
    var dir = document.getElementById('dir-toggle');
    if (dir) dir.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        PGRE.store.state.settings.formulaReverse = b.getAttribute('data-dir') === '1';
        PGRE.store.save();
        dir.querySelectorAll('button').forEach(function (o) {
          o.setAttribute('aria-pressed', String(o === b));
        });
      });
    });
    function clampGoal(n) {
      n = parseInt(n, 10);
      if (!n || n <= 0) return 0;
      n = Math.round(n / 15) * 15;
      return Math.max(15, Math.min(480, n));
    }
    var chips = document.getElementById('goal-chips');
    if (chips) chips.querySelectorAll('[data-goal]').forEach(function (b) {
      b.addEventListener('click', function () {
        PGRE.store.state.settings.dailyTargetMin = parseInt(b.getAttribute('data-goal'), 10) || 0;
        PGRE.store.save();
        chips.querySelectorAll('[data-goal]').forEach(function (o) {
          o.classList.toggle('active', o === b);
        });
        var inp = document.getElementById('set-goal-custom');
        if (inp) inp.value = '';
      });
    });
    var inp = document.getElementById('set-goal-custom');
    if (inp) {
      inp.addEventListener('input', function () {
        var n = !inp.value ? 0 : clampGoal(parseInt(inp.value, 10));
        PGRE.store.state.settings.dailyTargetMin = n;
        if (chips) chips.querySelectorAll('[data-goal]').forEach(function (o) {
          o.classList.remove('active');
        });
      });
      inp.addEventListener('blur', function () {
        var n = PGRE.store.state.settings.dailyTargetMin;
        var presets = [0, 60, 120, 180, 300];
        inp.value = presets.indexOf(n) < 0 && n > 0 ? String(n) : '';
        PGRE.store.save();
      });
    }
  }

  function wireData() {
    var exp = document.getElementById('export-btn');
    if (exp) exp.addEventListener('click', downloadExport);

    var pInput = document.getElementById('progress-input');
    var impBtn = document.getElementById('import-progress-btn');
    if (impBtn && pInput) {
      impBtn.addEventListener('click', function () { pInput.click(); });
      pInput.addEventListener('change', function () {
        if (!pInput.files.length) return;
        var r = new FileReader();
        r.onload = function () {
          try {
            PGRE.store.importJSON(String(r.result));
            if (PGRE.store._persistFailed) {
              PGRE.toast('Backup loaded into this tab, but saving still fails — it is not on disk yet.', 'error', true);
              return;
            }
            var raw = null;
            try { raw = localStorage.getItem(PGRE.store.KEY); } catch (eRead) { raw = null; }
            if (!raw) {
              PGRE.toast('Restore failed: saved progress could not be read back.', 'error');
              return;
            }
            PGRE.applyTheme(PGRE.store.state.settings.theme);
            PGRE.toast('Progress restored.', 'info');
            PGRE.route();
          } catch (e) {
            PGRE.toast('Restore failed: ' + PGRE.ui.esc(e.message), 'error');
          }
        };
        r.readAsText(pInput.files[0]);
        pInput.value = '';
      });
    }

    var rbBtn = document.getElementById('restore-backup-btn');
    if (rbBtn) rbBtn.addEventListener('click', function () {
      if (!confirm('Replace the current progress with the last browser safety copy? Progress saved after that copy will be lost.')) return;
      var ok = typeof PGRE.store.restoreBackup === 'function' && PGRE.store.restoreBackup();
      if (ok && PGRE.store._persistFailed) {
        PGRE.toast('Backup loaded into this tab, but saving still fails — it is not on disk yet.', 'error', true);
      } else if (ok) {
        PGRE.applyTheme(PGRE.store.state.settings.theme);
        PGRE.toast('Backup restored.', 'info');
        location.hash = '#/';
      } else {
        PGRE.toast('No automatic backup found.');
      }
    });

    if (PGRE.backup && typeof PGRE.backup.wireLibrary === 'function') {
      PGRE.backup.wireLibrary(document.getElementById('disk-backup-card'));
    }

    // Danger zone: export first, then type RESET in the inline confirm row.
    var confirmBox = document.getElementById('reset-confirm');
    var pending = null;
    function askReset(which) {
      downloadExport();
      pending = which;
      confirmBox.hidden = false;
      confirmBox.innerHTML =
        '<span class="danger-confirm-text">An export was downloaded. Type <b>RESET</b> to ' +
          (which === 'cards' ? 'reset every card schedule' : 'erase all progress') +
          '.</span>' +
        '<input type="text" id="reset-confirm-in" class="exam-date-input" autocomplete="off" ' +
          'placeholder="RESET" aria-label="Type RESET to confirm">' +
        '<button class="btn btn-danger" id="reset-yes" disabled>Confirm</button>' +
        '<button class="btn btn-ghost" id="reset-no">Cancel</button>';
      var input = document.getElementById('reset-confirm-in');
      var yes = document.getElementById('reset-yes');
      document.getElementById('reset-no').addEventListener('click', function () {
        pending = null;
        confirmBox.hidden = true;
      });
      input.addEventListener('input', function () {
        yes.disabled = input.value.trim() !== 'RESET';
      });
      yes.addEventListener('click', function () {
        var what = pending;
        pending = null;
        confirmBox.hidden = true;
        if (what === 'cards') {
          PGRE.store.resetFormulaCards();
          if (PGRE.refreshNavBadges) PGRE.refreshNavBadges();
          PGRE.toast('Formula cards reset to new.', 'info');
        } else if (what === 'all') {
          PGRE.store.reset();
          PGRE.applyTheme(PGRE.store.state.settings.theme);
          PGRE.toast('Progress reset.', 'info');
          PGRE.route();
        }
      });
      input.focus();
    }
    var rc = document.getElementById('reset-cards-btn');
    if (rc) rc.addEventListener('click', function () { askReset('cards'); });
    var ra = document.getElementById('reset-all-btn');
    if (ra) ra.addEventListener('click', function () { askReset('all'); });
  }

  return {
    render: function () {
      // The toc chips jump to the section cards below.
      return '<h1 class="h1 sm">Settings</h1>' +
        '<p class="lead">Studio-wide choices. The exam date lives in Physics › Exam archive, as text.</p>' +
        '<div class="chip-row" style="margin:14px 0">' +
          '<button type="button" class="focus-chip" data-setgoto="set-appearance">Appearance</button>' +
          '<button type="button" class="focus-chip" data-setgoto="set-study">Study</button>' +
          '<button type="button" class="focus-chip" data-setgoto="set-other-apps">Other apps</button>' +
          '<button type="button" class="focus-chip" data-setgoto="set-data">Data</button>' +
        '</div>' +
        appearanceHTML() + studyHTML() + otherAppsHTML() + dataHTML();
    },
    mount: function () {
      document.querySelectorAll('[data-setgoto]').forEach(function (a) {
        a.addEventListener('click', function () {
          var el = document.getElementById(a.getAttribute('data-setgoto'));
          if (el) el.scrollIntoView({ block: 'start' });
        });
      });
      // Connection state for the "Other apps" card — the shared fetch
      // resolves 'off' when the bridge does not answer; the card then shows
      // "Not connected" above the setup steps.
      if (PGRE.studySources && PGRE.studySources.load) {
        PGRE.studySources.load().then(paintOtherApps);
      }
      wireAppearance();
      wireStudy();
      wireData();
    }
  };
})();
