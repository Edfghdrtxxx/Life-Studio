/* Disk snapshot client for committed progress JSON.
   Posts the value localStorage already accepted, never uncommitted memory.
   A failed snapshot never sets store._persistFailed and never rolls back a grade. */
window.PGRE = window.PGRE || {};

PGRE.backup = (function () {
  'use strict';

  var CLIENT = 'physics-gre-prep-studio';
  var DEFAULT_ENDPOINT = 'http://127.0.0.1:4790/pgre-backup';
  var TOKEN_KEY = 'pgre-backup-token';
  var ACK_KEY = 'pgre-backup-last-ack';
  var INTERVAL_MS = 5 * 60 * 1000;
  var SCHEMA = 1;
  var KIND = 'pgre-progress-snapshot';
  var SNAP_ID = /^snap-\d{8}T\d{6}Z-rev-\d+-[0-9a-f]{12}$/;

  var pendingTimer = null;
  var inFlight = null;
  var queued = false;
  var lastCommittedBlob = null;
  var warnEl = null;

  function endpoint() {
    return PGRE.backup.endpoint || DEFAULT_ENDPOINT;
  }

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }

  function setToken(value) {
    value = String(value || '');
    try {
      if (value) localStorage.setItem(TOKEN_KEY, value);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* quota — pairing can be retried */ }
  }

  function readAck() {
    try {
      var raw = localStorage.getItem(ACK_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function writeAck(ack) {
    PGRE.backup.lastAck = ack;
    PGRE.backup.lastError = null;
    try { localStorage.setItem(ACK_KEY, JSON.stringify(ack)); } catch (e) { /* ignore */ }
  }

  function hexFromBuffer(buf) {
    var bytes = new Uint8Array(buf);
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      var h = bytes[i].toString(16);
      out += h.length === 1 ? '0' + h : h;
    }
    return out;
  }

  function sha256hex(text) {
    if (!window.crypto || !crypto.subtle || typeof TextEncoder !== 'function') {
      return Promise.reject(new Error('SHA-256 is unavailable in this browser'));
    }
    var bytes = new TextEncoder().encode(text);
    return crypto.subtle.digest('SHA-256', bytes).then(hexFromBuffer);
  }

  function committedBlob() {
    if (typeof lastCommittedBlob === 'string' && lastCommittedBlob) return lastCommittedBlob;
    try { return localStorage.getItem(PGRE.store.KEY); } catch (e) { return null; }
  }

  function showWarning(message) {
    PGRE.backup.lastError = message;
    if (typeof PGRE.toast === 'function') {
      if (!warnEl || !warnEl.isConnected) {
        warnEl = PGRE.toast(
          'Disk backup failed — ' + message +
            '. Studying is unchanged. Use Back up now on the Library page.',
          'error',
          true
        );
      }
    }
    paint();
  }

  function clearWarning() {
    PGRE.backup.lastError = null;
    if (warnEl && warnEl.isConnected && typeof warnEl.click === 'function') warnEl.click();
    warnEl = null;
    paint();
  }

  function hasVerifiedSnapshot() {
    var ack = (PGRE.backup && PGRE.backup.lastAck) || readAck();
    return !!(ack && ack.verified && ack.sha256);
  }

  function dropLegacyBackup() {
    if (!hasVerifiedSnapshot()) return;
    if (!PGRE.store || !PGRE.store.KEY) return;
    try { localStorage.removeItem(PGRE.store.KEY + '-backup'); } catch (e) { /* leftover stays */ }
  }

  function ackLooksWritten(ack, digest) {
    return !!(ack
      && ack.ok === true
      && typeof digest === 'string'
      && ack.sha256 === digest
      && typeof ack.id === 'string'
      && SNAP_ID.test(ack.id));
  }

  function headers() {
    return {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token(),
      'X-PGRE-Client': CLIENT,
      'X-PGRE-Backup-Token': token()
    };
  }

  function postSnapshot(blob) {
    if (!blob) return Promise.resolve({ ok: false, error: 'no committed progress to copy' });
    if (!token()) return Promise.resolve({ ok: false, error: 'set a backup token on the Library page' });
    if (typeof window.fetch !== 'function') {
      return Promise.resolve({ ok: false, error: 'fetch is unavailable' });
    }
    var origin = (window.location && window.location.origin && window.location.origin !== 'null')
      ? window.location.origin
      : (window.location && window.location.href) || 'file://';
    var parsed;
    try { parsed = JSON.parse(blob); } catch (e) {
      return Promise.resolve({ ok: false, error: 'committed progress is not JSON' });
    }
    return sha256hex(blob).then(function (digest) {
      var last = PGRE.backup.lastAck;
      if (last && last.verified && last.sha256 === digest) {
        return { ok: true, skipped: true, verified: true, id: last.id, savedAt: last.savedAt || last.at, sha256: digest };
      }
      var body = JSON.stringify({
        schema: SCHEMA,
        kind: KIND,
        client: CLIENT,
        savedAt: new Date().toISOString(),
        origin: origin,
        epoch: parsed && parsed._epoch,
        rev: parsed && parsed._rev,
        sha256: digest,
        blob: blob
      });
      return window.fetch(endpoint(), {
        method: 'POST',
        headers: headers(),
        body: body
      }).then(function (response) {
        return response.json().then(function (payload) {
          payload = payload || {};
          if (!response.ok || payload.ok !== true) {
            return { ok: false, error: payload.error || ('helper HTTP ' + response.status) };
          }
          if (!ackLooksWritten(payload, digest)) {
            return { ok: false, error: 'helper ack is not a written snapshot' };
          }
          var getUrl = endpoint() + (endpoint().indexOf('?') >= 0 ? '&' : '?') +
            'id=' + encodeURIComponent(payload.id);
          return window.fetch(getUrl, { method: 'GET', headers: headers() }).then(function (got) {
            return got.json().then(function (envelope) {
              if (!got.ok || !envelope || envelope.sha256 !== digest) {
                return { ok: false, error: (envelope && envelope.error) || 'snapshot missing after ack' };
              }
              return {
                ok: true,
                verified: true,
                id: payload.id,
                sha256: digest,
                savedAt: payload.savedAt || envelope.writtenAt || envelope.savedAt,
                counts: payload.counts || envelope.counts
              };
            }, function () {
              return { ok: false, error: 'helper returned non-JSON' };
            });
          }, function () {
            return { ok: false, error: 'could not read the snapshot back' };
          });
        }, function () {
          return { ok: false, error: 'helper returned non-JSON' };
        });
      }, function () {
        return { ok: false, error: 'disk backup helper is not running' };
      });
    }, function (err) {
      return { ok: false, error: (err && err.message) || 'checksum failed' };
    }).then(function (result) {
      if (result && result.ok && result.verified) {
        if (!result.skipped) {
          writeAck({
            at: result.savedAt || new Date().toISOString(),
            id: result.id,
            sha256: result.sha256,
            counts: result.counts || null,
            verified: true
          });
          dropLegacyBackup();
        }
        clearWarning();
      } else if (result && result.ok && result.skipped) {
        clearWarning();
      } else {
        showWarning((result && result.error) || 'backup was refused');
      }
      return result;
    });
  }

  function pushNow() {
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    if (inFlight) {
      queued = true;
      return inFlight;
    }
    var blob = committedBlob();
    inFlight = postSnapshot(blob).then(function (result) {
      inFlight = null;
      if (queued) {
        queued = false;
        return pushNow();
      }
      return result;
    }, function (err) {
      inFlight = null;
      showWarning((err && err.message) || 'backup failed');
      if (queued) {
        queued = false;
        return pushNow();
      }
      return { ok: false, error: (err && err.message) || 'backup failed' };
    });
    return inFlight;
  }

  function noteCommitted(blob) {
    if (typeof blob === 'string' && blob) lastCommittedBlob = blob;
    var last = PGRE.backup.lastAck;
    if (!last) {
      pushNow();
      return;
    }
    if (pendingTimer) return;
    pendingTimer = setTimeout(function () {
      pendingTimer = null;
      pushNow();
    }, PGRE.backup.INTERVAL_MS);
  }

  function backupNow() {
    return pushNow();
  }

  function list() {
    if (!token()) return Promise.resolve({ ok: false, error: 'set a backup token on the Library page', snapshots: [] });
    if (typeof window.fetch !== 'function') {
      return Promise.resolve({ ok: false, error: 'fetch is unavailable', snapshots: [] });
    }
    return window.fetch(endpoint(), { method: 'GET', headers: headers() }).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok) {
          return { ok: false, error: (payload && payload.error) || ('helper HTTP ' + response.status), snapshots: [] };
        }
        return { ok: true, snapshots: (payload && payload.snapshots) || [] };
      }, function () {
        return { ok: false, error: 'helper returned non-JSON', snapshots: [] };
      });
    }, function () {
      return { ok: false, error: 'disk backup helper is not running', snapshots: [] };
    });
  }

  function fetchSnapshot(id) {
    if (!id) return Promise.resolve({ ok: false, error: 'snapshot id required' });
    var url = endpoint() + (endpoint().indexOf('?') >= 0 ? '&' : '?') + 'id=' + encodeURIComponent(id);
    return window.fetch(url, { method: 'GET', headers: headers() }).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok) {
          return { ok: false, error: (payload && payload.error) || ('helper HTTP ' + response.status) };
        }
        return payload;
      }, function () {
        return { ok: false, error: 'helper returned non-JSON' };
      });
    }, function () {
      return { ok: false, error: 'disk backup helper is not running' };
    });
  }

  function exportCurrent() {
    if (!PGRE.store || typeof PGRE.store.exportJSON !== 'function') return;
    var blob = new Blob([PGRE.store.exportJSON()], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'life-studio-progress-' + (PGRE.store.today ? PGRE.store.today() : 'export') + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  function restoreSnapshot(id) {
    var current = null;
    try { current = localStorage.getItem(PGRE.store.KEY); } catch (e) { current = null; }
    if (!current) return Promise.resolve({ ok: false, error: 'no committed progress to secure' });
    return postSnapshot(current).then(function (ack) {
      if (!ack || !ack.ok || !ack.verified) {
        return { ok: false, error: 'current progress could not be snapshotted before restore' };
      }
      return fetchSnapshot(id).then(function (envelope) {
        if (!envelope || envelope.ok === false) {
          return { ok: false, error: (envelope && envelope.error) || 'snapshot missing' };
        }
        var blob = envelope.blob;
        var digest = envelope.sha256;
        if (typeof blob !== 'string' || typeof digest !== 'string') {
          return { ok: false, error: 'snapshot envelope incomplete' };
        }
        return sha256hex(blob).then(function (actual) {
          if (actual !== digest) {
            return { ok: false, error: 'checksum mismatch' };
          }
          if (!PGRE.store || typeof PGRE.store.importJSON !== 'function') {
            return { ok: false, error: 'store import is unavailable' };
          }
          PGRE.store.importJSON(blob);
          if (PGRE.store._persistFailed) {
            return { ok: false, error: 'imported into this tab, but saving still fails' };
          }
          var readBack = null;
          try { readBack = localStorage.getItem(PGRE.store.KEY); } catch (e) { readBack = null; }
          if (!readBack) return { ok: false, error: 'saved progress could not be read back' };
          return { ok: true, id: envelope.id || id, savedAt: envelope.savedAt, counts: envelope.counts };
        });
      });
    });
  }

  function formatTime(iso) {
    if (!iso) return 'never';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString();
  }

  function esc(s) {
    if (PGRE.ui && typeof PGRE.ui.esc === 'function') return PGRE.ui.esc(s);
    return String(s).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function paint() {
    if (!document || typeof document.getElementById !== 'function') return;
    var status = document.getElementById('backup-status');
    var warn = document.getElementById('backup-warning');
    var tokenInput = document.getElementById('backup-token-input');
    if (tokenInput && tokenInput !== document.activeElement) tokenInput.value = token();
    if (status) {
      var ack = PGRE.backup.lastAck;
      if (!token()) {
        status.textContent = 'No backup token is set. The browser safety copy still refreshes every 20 saves until a disk snapshot is verified. Paste the helper token to start disk snapshots.';
      } else if (ack && ack.verified) {
        status.textContent = 'Last disk backup: ' + formatTime(ack.at || ack.savedAt);
      } else {
        status.textContent = 'No disk backup has been verified yet. The browser safety copy still refreshes every 20 saves.';
      }
    }
    if (warn) {
      if (PGRE.backup.lastError) {
        warn.hidden = false;
        warn.textContent = 'Disk backup failed — ' + PGRE.backup.lastError +
          '. Studying is unchanged.';
      } else {
        warn.hidden = true;
        warn.textContent = '';
      }
    }
  }

  function renderList(root, snapshots) {
    if (!root) return;
    if (!snapshots || !snapshots.length) {
      root.innerHTML = '<p class="muted">No disk snapshots yet.</p>';
      return;
    }
    var rows = snapshots.map(function (snap) {
      var counts = snap.counts || {};
      return '<li class="backup-snap" data-snapid="' + esc(snap.id) + '">' +
        '<div><strong>' + esc(formatTime(snap.savedAt)) + '</strong>' +
        '<span class="muted"> · rev ' + esc(String(snap.rev)) +
        ' · ' + esc(String(counts.attempts || 0)) + ' attempts · ' +
        esc(String(counts.cards || 0)) + ' cards · ' +
        esc(String(counts.cardReviews || 0)) + ' reviews</span></div>' +
        '<button type="button" class="btn btn-ghost backup-restore-btn" data-restore="' +
        esc(snap.id) + '">Restore</button></li>';
    }).join('');
    root.innerHTML = '<ul class="backup-snap-list">' + rows + '</ul>';
  }

  function refreshList() {
    var root = document.getElementById('backup-list');
    if (!root) return Promise.resolve();
    return list().then(function (result) {
      if (!result.ok) {
        root.innerHTML = '<p class="muted">' + esc(result.error || 'Could not list snapshots.') + '</p>';
        return;
      }
      renderList(root, result.snapshots);
    });
  }

  function showRestorePreview(snap) {
    var box = document.getElementById('backup-restore-confirm');
    if (!box) return;
    var counts = (snap && snap.counts) || {};
    box.hidden = false;
    box.innerHTML =
      '<p class="danger-confirm-text">Restore this disk snapshot? Current progress will be exported first, then replaced.</p>' +
      '<p class="muted">Time ' + esc(formatTime(snap.savedAt)) +
      ' · ' + esc(String(counts.attempts || 0)) + ' attempts · ' +
      esc(String(counts.cards || 0)) + ' cards · ' +
      esc(String(counts.cardReviews || 0)) + ' reviews · ' +
      esc(String(counts.mistakes || 0)) + ' mistakes · ' +
      esc(String(counts.exams || 0)) + ' exams</p>' +
      '<div class="btn-row">' +
        '<button type="button" class="btn btn-danger" id="backup-restore-yes">Yes, restore</button>' +
        '<button type="button" class="btn btn-ghost" id="backup-restore-no">Cancel</button>' +
      '</div>';
    box.setAttribute('data-restore-id', snap.id || '');
    var yes = document.getElementById('backup-restore-yes');
    var no = document.getElementById('backup-restore-no');
    if (no) no.addEventListener('click', function () { box.hidden = true; box.innerHTML = ''; });
    if (yes) yes.addEventListener('click', function () {
      var id = box.getAttribute('data-restore-id');
      exportCurrent();
      restoreSnapshot(id).then(function (result) {
        if (!result || !result.ok) {
          if (PGRE.toast) PGRE.toast('Restore refused: ' + esc((result && result.error) || 'unknown error'), 'error');
          return;
        }
        if (PGRE.applyTheme) PGRE.applyTheme(PGRE.store.state.settings.theme);
        if (PGRE.toast) PGRE.toast('Progress restored.', 'info');
        location.hash = '#/';
        if (PGRE.route) PGRE.route();
      });
    });
  }

  function wireLibrary(root) {
    paint();
    refreshList();
    var tokenInput = document.getElementById('backup-token-input');
    if (tokenInput) {
      tokenInput.value = token();
      tokenInput.addEventListener('change', function () { setToken(tokenInput.value); });
    }
    var nowBtn = document.getElementById('backup-now-btn');
    if (nowBtn) nowBtn.addEventListener('click', function () {
      backupNow().then(function (result) {
        if (result && result.ok) {
          if (PGRE.toast) PGRE.toast('Disk backup saved.', 'info');
          refreshList();
        }
      });
    });
    var refreshBtn = document.getElementById('backup-refresh-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', function () { refreshList(); });
    var listRoot = document.getElementById('backup-list');
    if (listRoot) listRoot.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('[data-restore]') : null;
      if (!btn) return;
      var id = btn.getAttribute('data-restore');
      list().then(function (result) {
        var snaps = (result && result.snapshots) || [];
        var snap = null;
        for (var i = 0; i < snaps.length; i++) if (snaps[i].id === id) snap = snaps[i];
        if (!snap) snap = { id: id, savedAt: '', counts: {} };
        showRestorePreview(snap);
      });
    });
  }

  function flushOnHide() {
    var blob = committedBlob();
    if (!blob || !token()) return;
    var last = PGRE.backup.lastAck;
    sha256hex(blob).then(function (digest) {
      if (last && last.sha256 === digest) return;
      pushNow();
    }, function () { /* hide flush is best-effort */ });
  }

  window.addEventListener('pagehide', flushOnHide);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushOnHide();
  });

  var api = {
    CLIENT: CLIENT,
    DEFAULT_ENDPOINT: DEFAULT_ENDPOINT,
    TOKEN_KEY: TOKEN_KEY,
    ACK_KEY: ACK_KEY,
    INTERVAL_MS: INTERVAL_MS,
    endpoint: DEFAULT_ENDPOINT,
    token: token,
    setToken: setToken,
    sha256hex: sha256hex,
    noteCommitted: noteCommitted,
    backupNow: backupNow,
    list: list,
    fetchSnapshot: fetchSnapshot,
    restoreSnapshot: restoreSnapshot,
    exportCurrent: exportCurrent,
    hasVerifiedSnapshot: hasVerifiedSnapshot,
    dropLegacyBackup: dropLegacyBackup,
    paint: paint,
    wireLibrary: wireLibrary,
    refreshList: refreshList,
    lastAck: readAck(),
    lastError: null
  };
  return api;
})();
