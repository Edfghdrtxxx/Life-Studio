/* Other study apps (report §14, decision set "All A"): Maimemo minutes and
   words, and today's Obsidian learning sessions, reach the studio through the
   OrbitOS status bridge's read-only route GET /study-sources (one JSON file
   the Mac helper rewrites every 120 minutes; shape in the bridge README).
   This module is the only place that reads it: Today, Study time and Settings
   share one cache. The studio saves nothing of it — the payload lives in
   memory only — and the page keeps working when the bridge does not answer:
   load() resolves with status 'off' and the views show "not connected".
   The endpoint may be overridden for tests by window.__PGRE_STUDY_SOURCES_URL
   before the scripts run; it defaults to the real bridge. */

window.PGRE = window.PGRE || {};

PGRE.studySources = (function () {
  var DEFAULT_URL = 'http://127.0.0.1:4789/study-sources';
  var FETCH_TIMEOUT_MS = 3000;
  var CACHE_MS = 60 * 1000;
  /* Staleness is judged against the helper's 120-minute interval
     (report §14.5, "the helper now runs every 120 minutes"). A run may land
     a little late, so 'stale' starts at 150 minutes, not 120. */
  var STALE_MS = 150 * 60 * 1000;

  var cache = null;    // { at, status, data }
  var inflight = null;

  function url() {
    var w = (typeof window !== 'undefined') ? window : {};
    return (typeof w.__PGRE_STUDY_SOURCES_URL === 'string' && w.__PGRE_STUDY_SOURCES_URL)
      ? w.__PGRE_STUDY_SOURCES_URL
      : DEFAULT_URL;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function dayStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  /* Local day key of a Date or epoch ms; defaults to today. */
  function dayKey(t) {
    if (t == null) return dayStr(new Date());
    var d = (t instanceof Date) ? t : new Date(t);
    return dayStr(d);
  }
  /* The helper's `updatedAt` is a local ISO string with offset (or epoch ms
     in older files). Returns epoch ms, NaN when unparseable. */
  function parseUpdated(v) {
    if (v == null) return NaN;
    if (typeof v === 'number' && isFinite(v)) return v;
    var t = new Date(v).getTime();
    return isFinite(t) ? t : NaN;
  }
  function clockOf(v) {
    var t = parseUpdated(v);
    if (!isFinite(t)) return '';
    var d = new Date(t);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  /* "14:30" today, "Nov 1, 14:30" on another day, "" when unknown. */
  function fmtUpdated(v, now) {
    var t = parseUpdated(v);
    if (!isFinite(t)) return '';
    var d = new Date(t), n = (now instanceof Date) ? now : new Date(now || Date.now());
    var clock = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    if (dayStr(d) === dayStr(n)) return clock;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + clock;
  }
  /* 42 -> "42 min"; 73 -> "1 h 13 min"; 0 -> "0 min". */
  function fmtMin(min) {
    min = Math.max(0, Math.round(min));
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60), m = min % 60;
    return m ? h + ' h ' + m + ' min' : h + ' h';
  }

  function isObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  /* Entry of one day: { updatedAt, maimemo:{finished,total,studyTimeMs},
     obsidian:{sessions:[{title,path}]} }, or null. `date` defaults to today. */
  function entryFor(data, date) {
    if (!isObject(data) || !isObject(data.days)) return null;
    var e = data.days[date || dayKey()];
    return isObject(e) ? e : null;
  }

  /* The newest recorded entry, whatever day it belongs to:
     { date, entry } or null. */
  function latest(data) {
    if (!isObject(data) || !isObject(data.days)) return null;
    var best = null;
    for (var k in data.days) {
      if (!isObject(data.days[k])) continue;
      if (!best || k > best.date) best = { date: k, entry: data.days[k] };
    }
    return best;
  }

  function hasMaimemo(entry) {
    var m = entry && entry.maimemo;
    return !!(m && typeof m.studyTimeMs === 'number');
  }
  /* Maimemo seconds of one day (0 when the day has no maimemo block). */
  function maimemoSec(entry) {
    var ms = hasMaimemo(entry) ? entry.maimemo.studyTimeMs : 0;
    return Math.max(0, ms / 1000);
  }
  /* Day-key -> seconds map over every recorded day (Study time chart,
     calendar). Maimemo days are the helper's local calendar dates; the
     studio's own log keys roll at 03:00 (js/study-time.js studyDayStart),
     so a bar or cell that sums the two can mix two 24 h bases between
     00:00 and 03:00 — accepted, the keys match outside that window.
     Days without a maimemo block are simply absent. */
  function maimemoSecByDay(data) {
    var map = {};
    if (!isObject(data) || !isObject(data.days)) return map;
    for (var k in data.days) {
      var sec = maimemoSec(data.days[k]);
      if (sec > 0) map[k] = sec;
    }
    return map;
  }
  function sessionsOf(entry) {
    var o = entry && entry.obsidian;
    var list = (o && Array.isArray(o.sessions)) ? o.sessions : [];
    return list.filter(function (s) { return isObject(s) && s.path; });
  }

  /* Freshness of the file as a whole: the newest updatedAt across days.
     `now` is epoch ms. 'ok' | 'stale' | 'unknown'. */
  function freshness(data, now) {
    var best = 0;
    if (isObject(data) && isObject(data.days)) {
      for (var k in data.days) {
        var t = parseUpdated(isObject(data.days[k]) && data.days[k].updatedAt);
        if (isFinite(t) && t > best) best = t;
      }
    }
    if (!best) return 'unknown';
    var age = (typeof now === 'number' ? now : Date.now()) - best;
    return age > STALE_MS ? 'stale' : 'ok';
  }
  function lastUpdatedAt(data) {
    var best = 0;
    if (isObject(data) && isObject(data.days)) {
      for (var k in data.days) {
        var t = parseUpdated(isObject(data.days[k]) && data.days[k].updatedAt);
        if (isFinite(t) && t > best) best = t;
      }
    }
    /* 0 is also a valid epoch-ms, so unknown returns NaN — callers must not
       print 1970 for a helper file without timestamps. */
    return best || NaN;
  }

  /* One fetch for all callers; results are cached for CACHE_MS. Resolves
     { status: 'ok' | 'off', data } — never rejects, so a view can always
     paint a state instead of hanging. 'off' covers no answer, a 404 (the
     helper has never written the file) and a malformed payload. */
  function load(opts) {
    opts = opts || {};
    if (!opts.force && cache && (Date.now() - cache.at) < CACHE_MS) {
      return Promise.resolve(cache);
    }
    if (!opts.force && inflight) return inflight;
    var result = { at: Date.now(), status: 'off', data: null };
    /* A newer load() can overtake this fetch; the loser must not write the
       cache or clear the winner's inflight marker. */
    var p;
    var finish = function () {
      if (inflight === p || inflight === null) {
        cache = result;
        inflight = null;
      }
      return result;
    };
    try {
      var req;
      if (typeof window.AbortController === 'function') {
        var ctl = new window.AbortController();
        var to = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, FETCH_TIMEOUT_MS);
        req = window.fetch(url(), { signal: ctl.signal, cache: 'no-store' }).then(function (r) {
          clearTimeout(to);
          return r;
        });
      } else {
        req = window.fetch(url(), { cache: 'no-store' });
      }
      p = req.then(function (r) {
        if (!r || !r.ok) { result.status = 'off'; return finish(); }
        return r.json().then(function (body) {
          if (isObject(body) && isObject(body.days)) {
            result.status = 'ok';
            result.data = body;
          }
          return finish();
        }, function () { return finish(); });
      }, function () { return finish(); });
    } catch (e) {
      return Promise.resolve(finish());
    }
    inflight = p;
    return p;
  }

  return {
    load: load,
    url: url,
    cached: function () { return cache; },
    entryFor: entryFor,
    latest: latest,
    hasMaimemo: hasMaimemo,
    maimemoSec: maimemoSec,
    maimemoSecByDay: maimemoSecByDay,
    sessionsOf: sessionsOf,
    freshness: freshness,
    lastUpdatedAt: lastUpdatedAt,
    fmtUpdated: fmtUpdated,
    fmtMin: fmtMin,
    dayKey: dayKey,
    clockOf: clockOf,
    STALE_MS: STALE_MS,
    /* Test hook: drop the cache so the next load() fetches again. */
    _reset: function () { cache = null; inflight = null; }
  };
}());
