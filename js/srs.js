/* Spaced-repetition engine — shared by the mistake book and the formula deck.
   Two schedulers live here:
   - Mistake ladder: fixed intervals for missed questions. A miss (re)sets the
     entry to step 0 (due tomorrow); a correct solve climbs one rung. Entries
     are PERMANENT — solving never removes one, only schedules it further out;
     removal is the user's manual archive action.
   - Formula cards: classic Anki SM-2 with Again/Hard/Good/Easy grades, an
     ease factor per card, and day-granularity due dates. An optional
     exam-date cap (settings.formulaExamCap, default on) squeezes long
     intervals toward exam day without inverting grade order. */
window.PGRE = window.PGRE || {};

PGRE.srs = {

  /* ——— Local-date helpers (same YYYY-MM-DD convention as store.today) ——— */
  dayStr: function (d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  },

  /* The scheduling day starts at 03:00 local, like the study-time day
     (study-time.js studyDayStart): a grade at 01:00 counts for the day
     before, and a card due on a date is due from 03:00 that date. Stored
     due dates stay plain calendar days. setHours, not a fixed 3 h offset,
     so a DST change still lands on civil 03:00. */
  DAY_START_HOUR: 3,
  dayOf: function (d) {
    var start = new Date(d.getTime());
    start.setHours(this.DAY_START_HOUR, 0, 0, 0);
    if (d.getTime() < start.getTime()) start.setDate(start.getDate() - 1);
    return this.dayStr(start);
  },

  today: function () { return this.dayOf(new Date()); },

  addDays: function (n) { return this.addDaysTo(this.today(), n); },

  /* Local-date arithmetic anchored on an arbitrary base 'YYYY-MM-DD' (addDays
     anchors on today). Same local-midday-free construction as store.dayBefore.
     Used by the ITEM 5 Easy migration to re-derive due from each card's own
     last-review day. */
  addDaysTo: function (dayStr, n) {
    var p = String(dayStr).split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    d.setDate(d.getDate() + n);
    return this.dayStr(d);
  },

  /* Whole days from today until dateStr; 0 or negative means due. */
  daysUntil: function (dateStr) {
    var a = new Date(this.today() + 'T12:00:00');
    var b = new Date(dateStr + 'T12:00:00');
    return Math.round((b - a) / 86400000);
  },

  ivlLabel: function (days) {
    if (days <= 0) return 'today';
    if (days === 1) return '1 d';
    if (days < 30) return days + ' d';
    var mo = Math.round(days / 3) / 10;
    return (mo === Math.round(mo) ? Math.round(mo) : mo) + ' mo';
  },

  /* ——— Mistake book ladder ——— */
  MISTAKE_LADDER: [1, 3, 7, 14, 30, 60],

  /* A miss (first or repeat) puts the entry at the bottom rung: due tomorrow. */
  mistakeMissed: function (mk) {
    mk.srs = { step: 0, due: this.addDays(1) };
  },

  /* A correct solve climbs one rung (capped) — never removes the entry. */
  mistakeSolved: function (mk) {
    var cur = (mk.srs && typeof mk.srs.step === 'number') ? mk.srs.step : 0;
    var step = Math.min(cur + 1, this.MISTAKE_LADDER.length - 1);
    mk.srs = { step: step, due: this.addDays(this.MISTAKE_LADDER[step]) };
  },

  /* The review date this answer produced, before any self-assessment chip.
     A chip may halve or pull that wait; unpicking restores this date. A new
     answer replaces the base, including an archived solve that does not climb. */
  noteAssessBase: function (mk) {
    if (!mk || !mk.srs || !mk.srs.due) return;
    mk.srs.baseDue = mk.srs.due;
  },

  /* Whole days from today after the chips on this answer. baseDays is the
     ladder wait recorded with the answer.
     Knew it leaves it alone.
     Guessed and Too slow halve it once — together as well as alone — and
     never land sooner than tomorrow. Whole days round up, so a 3-day wait
     becomes 2 days and is never cut past half.
     A wait already due stays due; moving it to tomorrow would only delay it.
     Forgot something and Keep failing bring a future review back to tomorrow
     and win over a halving chip. Together they still land on tomorrow once. */
  assessWaitDays: function (baseDays, flags) {
    var days = typeof baseDays === 'number' && isFinite(baseDays) ? baseDays : 0;
    flags = flags || {};
    if (flags.forgot || flags.stuck) return days <= 0 ? days : 1;
    if (flags.guess || flags.slow) {
      if (days <= 1) return days;
      return Math.max(1, Math.ceil(days / 2));
    }
    return days;
  },

  /* Rewrite mk.srs.due from the answer's base date and the chips still on.
     Does not touch the ladder step, misses, solves, archive flag, attempts,
     or XP. No schedule yet: no-op — Guessed and Keep failing file their own
     entry before this runs. Refuses when the store cannot persist. */
  applyAssessSchedule: function (qid, flags) {
    if (!(typeof PGRE.store.canWrite === 'function' ? PGRE.store.canWrite() : true)) {
      if (typeof PGRE.persistWarning === 'function') PGRE.persistWarning(true);
      return null;
    }
    var mk = PGRE.store.state.mistakes && PGRE.store.state.mistakes[qid];
    if (!mk || !mk.srs || !mk.srs.due) return null;
    var stamped = false;
    if (!mk.srs.baseDue) { mk.srs.baseDue = mk.srs.due; stamped = true; }
    var baseDays = this.daysUntil(mk.srs.baseDue);
    var days = this.assessWaitDays(baseDays, flags);
    var due = days === baseDays ? mk.srs.baseDue : this.addDays(days);
    if (mk.srs.due === due && !stamped) return mk;
    if (mk.srs.due !== due) mk.lastTouchedAt = new Date().toISOString();
    mk.srs.due = due;
    PGRE.store.save();
    return mk;
  },

  /* What a grading control shows next to its chips: the wait this answer
     produced (base) and the wait after the chips now on it. Read only — the
     dates are the ones applyAssessSchedule wrote. null when nothing is
     scheduled. */
  assessWindow: function (qid) {
    var mk = PGRE.store.state.mistakes && PGRE.store.state.mistakes[qid];
    if (!mk || !mk.srs || !mk.srs.due) return null;
    var baseDue = mk.srs.baseDue || mk.srs.due;
    var days = this.daysUntil(mk.srs.due), baseDays = this.daysUntil(baseDue);
    return { due: mk.srs.due, days: days, baseDue: baseDue, baseDays: baseDays,
             changed: mk.srs.due !== baseDue };
  },

  /* ——— Self-assessment tagging (proposal #6, extended to multi-select) ———
     The answer is recorded first (confidence null, no tags); the assessment
     taps land a beat later, so we stamp the most recent attempt row for this
     qid in place. confidence is 'sure' | 'guess' | null; tags is an array
     drawn from ['slow', 'forgot'] (absent when empty). Re-stamping the same
     row is fine — the chips stay editable until the next question.
     Store-safe: no-op if the row can't be found. */
  setLastAssess: function (qid, confidence, tags) {
    if (!(typeof PGRE.store.canWrite === 'function' ? PGRE.store.canWrite() : true)) {
      PGRE.persistWarning(true);
      return null;   // refused: never re-stamp an older row for this qid
    }
    var arr = PGRE.store.state.attempts;
    for (var i = arr.length - 1; i >= 0; i--) {
      if (arr[i].qid === qid) {
        arr[i].confidence = confidence || null;
        if (tags && tags.length) arr[i].tags = tags.slice();
        else delete arr[i].tags;
        PGRE.store.save();
        return arr[i];
      }
    }
    return null;
  },

  /* A correct-but-guessed answer is a hidden weakness: flag (or create) the
     mistake-book entry as a lucky guess and, if it isn't already scheduled,
     seed it on the normal ladder (bottom rung, due tomorrow) so it resurfaces.
     Never counts as a miss; reopens an archived entry (fresh evidence). */
  markLucky: function (qid) {
    var s = PGRE.store.state, now = new Date().toISOString();
    var mk = s.mistakes[qid];
    if (!mk) {
      mk = s.mistakes[qid] = { firstMissedAt: now, misses: 0, solves: 0,
                               wrongPicks: [], archivedAt: null, srs: null };
    }
    mk.lucky = true;
    mk.lastLuckyAt = now;
    mk.lastTouchedAt = now;
    if (mk.archivedAt) mk.archivedAt = null;
    if (!mk.srs) this.mistakeMissed(mk);
    PGRE.store.save();
    return mk;
  },

  /* Undo a markLucky from the same feedback screen (the user un-toggled
     "Guessed"). An entry that exists ONLY because of that lucky filing
     (never missed, never re-solved, not keep-failing) is removed outright so
     no ghost entry lingers in the book; an older entry just loses the flag. */
  unmarkLucky: function (qid) {
    var s = PGRE.store.state, mk = s.mistakes[qid];
    if (!mk || !mk.lucky) return;
    if (!mk.misses && !mk.solves && !mk.stuck) {
      delete s.mistakes[qid];
    } else {
      delete mk.lucky;
      delete mk.lastLuckyAt;
      mk.lastTouchedAt = new Date().toISOString();
    }
    PGRE.store.save();
  },

  /* Keep failing — the strongest concern level: the captain keeps missing
     this one. Same filing mechanism as a lucky guess: flag (or create) the
     mistake-book entry, reopen an archived one (fresh evidence), and if it
     isn't already scheduled seed the normal ladder (bottom rung, due
     tomorrow) so it resurfaces. An existing interval stays here. The assess
     chip then rewrites it through applyAssessSchedule, which pulls a future
     review to tomorrow. */
  markStuck: function (qid) {
    var s = PGRE.store.state, now = new Date().toISOString();
    var mk = s.mistakes[qid];
    if (!mk) {
      mk = s.mistakes[qid] = { firstMissedAt: now, misses: 0, solves: 0,
                               wrongPicks: [], archivedAt: null, srs: null };
    }
    mk.stuck = true;
    mk.lastStuckAt = now;
    mk.lastTouchedAt = now;
    if (mk.archivedAt) mk.archivedAt = null;
    if (!mk.srs) {
      this.mistakeMissed(mk);
      /* This flag seeded the schedule — either on a fresh entry or on a
         flag-only shell with no ladder. Remember it: unmarkStuck may delete
         only such a filing, never an entry that had a ladder of its own. */
      mk.stuckSole = true;
    }
    PGRE.store.save();
    return mk;
  },

  /* Undo a markStuck (the un-toggled chip or the book's toggle). An entry
     whose schedule exists ONLY because of that filing (stuckSole: markStuck
     created the entry or seeded its ladder) is removed outright while
     misses, solves and lucky stay empty, so no ghost entry lingers; an entry
     with its own ladder — even a step-0 one, or one markLucky seeded — just
     loses the flag and keeps its step and due date. */
  unmarkStuck: function (qid) {
    var s = PGRE.store.state, mk = s.mistakes[qid];
    if (!mk || !mk.stuck) return;
    if (mk.stuckSole && !mk.misses && !mk.solves && !mk.lucky) {
      delete s.mistakes[qid];
    } else {
      delete mk.stuck;
      delete mk.lastStuckAt;
      delete mk.stuckSole;
      mk.lastTouchedAt = new Date().toISOString();
    }
    PGRE.store.save();
  },

  /* Clear the lucky-guess flag once the question is answered correctly AND with
     confidence (a sure practice tag, or a correct mistake re-drill): the earlier
     lucky guess is no longer a blind spot. Leaves the rest of the entry (misses,
     ladder, archive) intact; the chip only renders while mk.lucky is truthy. */
  clearLucky: function (qid) {
    var mk = PGRE.store.state.mistakes[qid];
    if (mk && mk.lucky) {
      delete mk.lucky;
      delete mk.lastLuckyAt;
      mk.lastTouchedAt = new Date().toISOString();
      PGRE.store.save();
    }
  },

  /* Joined view of the book: [{qid, q, mk}], skipping ids that have left the
     question bank (their records stay in state untouched). */
  mistakeEntries: function () {
    var s = PGRE.store.state, out = [];
    for (var qid in s.mistakes) {
      var q = PGRE.questionById(qid);
      if (q) out.push({ qid: qid, q: q, mk: s.mistakes[qid] });
    }
    return out;
  },

  openMistakes: function () {
    return this.mistakeEntries().filter(function (e) { return !e.mk.archivedAt; });
  },

  archivedMistakes: function () {
    return this.mistakeEntries().filter(function (e) { return !!e.mk.archivedAt; });
  },

  dueMistakes: function () {
    var t = this.today();
    return this.openMistakes().filter(function (e) {
      return e.mk.srs && e.mk.srs.due <= t;
    });
  },

  /* Narrow a joined mistake list ({qid, q, mk}) to one topic. 'all' / absent
     leaves the list unchanged. Used by the mistake-book topic filter; due
     badges and other callers keep the unfiltered open/due partitions. */
  filterByTopic: function (entries, topicId) {
    if (!entries || !entries.length) return entries || [];
    if (!topicId || topicId === 'all') return entries;
    return entries.filter(function (e) { return e.q && e.q.topic === topicId; });
  },

  /* Narrow a joined mistake list ({qid, q, mk}) to keep-failing entries.
     'all' / absent leaves the list unchanged; 'stuck' keeps mk.stuck only. */
  filterByConcern: function (entries, concern) {
    if (!entries || !entries.length) return entries || [];
    if (!concern || concern === 'all') return entries;
    return entries.filter(function (e) { return !!e.mk.stuck; });
  },

  /* ——— Formula cards (SM-2 style) ——— */
  EASE_START: 2.5,
  EASE_MIN: 1.3,
  EASE_MAX: 3.0,

  cardState: function (id) {
    var cards = PGRE.store.state && PGRE.store.state.cards;
    // Own keys only. A plain object answers cards['constructor'] with a
    // function, which would hide a real card of that id as if it had state.
    if (!cards || !Object.prototype.hasOwnProperty.call(cards, id)) return null;
    var st = cards[id];
    return st && typeof st === 'object' ? st : null;
  },
  getMnemonic: function (id) {
    if (!id || !PGRE.store || !PGRE.store.state || !PGRE.store.state.cardNotes) return '';
    var n = PGRE.store.state.cardNotes[id];
    return (n && n.text) ? n.text : (typeof n === 'string' ? n : '');
  },

  /* F2 — a leech: a card lapsed so often that more raw reps won't stick; the UI
     nudges the user toward a mnemonic instead. */
  isLeech: function (st) { return !!st && st.lapses >= 8; },

  /* F3 — exam-date interval cap. Whole days until the exam; null when the user
     has turned the cap off (settings.formulaExamCap === false), or the date is
     invalid/past/due within a day. Otherwise the cap is max(1, days - 1):
     a fresh card can't schedule onto or past exam day. Missing/undefined
     formulaExamCap means ON (the default), so older saved states stay
     exam-capped until migrate() backfills the key. */
  examCap: function () {
    var settings = (PGRE.store.state && PGRE.store.state.settings) || {};
    if (settings.formulaExamCap === false) return null;
    var days = this.daysUntil(settings.examDate);
    if (!isFinite(days) || days <= 1) return null;
    return Math.max(1, days - 1);
  },
  /* Whole-day interval at which a card counts as solid / mature in the
     Recall UI. While the exam cap is on, that is min(21, examCap()) — the
     farthest interval the scheduler can still write. When the exam date is
     a valid future day but examCap() is null only because the exam is due
     within a day (tomorrow), the threshold is 1 so a just-passed card is
     solid. Cap off, invalid date, exam day, or a past date: the classic 21.
     Never 0. */
  matureDays: function () {
    var cap = this.examCap();
    if (cap != null) {
      var n = Math.min(21, cap);
      return n < 1 ? 1 : n;
    }
    var settings = (PGRE.store.state && PGRE.store.state.settings) || {};
    if (settings.formulaExamCap === false) return 21;
    var days = this.daysUntil(settings.examDate);
    if (isFinite(days) && days === 1) return 1;
    return 21;
  },
  /* Candidate next intervals (days) for each grade — used both to schedule
     and to preview on the grade buttons, so what you see is what you get.
     Classic Anki SM-2 (day granularity, no fuzz), matching Anki's
     passing_nonearly_review_intervals:
       new cards graduate Hard/Good → 1 day and Easy → 4 days;
       reviews: Hard = interval×1.2, Good = (interval + daysLate/2)×ease,
       Easy = (interval + daysLate)×ease×1.3.
     Anki then floors every passing grade: Hard ≥ current interval + 1,
     Good ≥ Hard + 1, Easy ≥ Good + 1. (FAQ: "all new intervals except Again
     are at least one day longer than the previous interval.") The exam cap
     may still equalize them afterwards. The old "second Good is always 3
     days" shortcut and the 10-day Easy floor are gone — they inverted
     Hard > Good after an Easy. */
  nextIntervals: function (st) {
    var out;
    if (!st || !st.reps) {
      out = { again: 0, hard: 1, good: 1, easy: 4 };
    } else {
      var ease = st.ease || this.EASE_START;
      var ivl = Math.max(1, st.interval || 1);
      var late = 0;
      if (st.due) {
        var until = this.daysUntil(st.due);
        if (until < 0) late = -until;
      }
      var hard = Math.round(ivl * 1.2);
      if (hard < ivl + 1) hard = ivl + 1;
      var good = Math.round((ivl + late / 2) * ease);
      if (good < hard + 1) good = hard + 1;
      var easy = Math.round((ivl + late) * ease * 1.3);
      if (easy < good + 1) easy = good + 1;
      out = { again: 0, hard: hard, good: good, easy: easy };
    }
    // F3: clamp each non-Again interval to the exam cap so the grade-button
    // previews match what gradeCard schedules automatically (Again stays 0).
    // Backward cascade clamping preserves strict monotonicity (Hard < Good < Easy)
    // whenever cap >= 3.
    var cap = this.examCap();
    if (cap != null) {
      if (cap >= 3) {
        out.easy = Math.min(out.easy, cap);
        out.good = Math.min(out.good, out.easy - 1);
        out.hard = Math.min(out.hard, out.good - 1);
        if (out.hard < 1) out.hard = 1;
      } else {
        out.hard = Math.min(out.hard, cap);
        out.good = Math.min(out.good, cap);
        out.easy = Math.min(out.easy, cap);
      }
    }
    return out;
  },

  /* ITEM 3 — "Mark as mastered": a fixed 20-day interval, exam-cap clamped like
     every non-Again grade. Shared by gradeCard and the grade-button preview so
     the button label matches exactly what it schedules. Mastered is the strongest
     grade, so it must never schedule SOONER than Easy: for a maturing card Easy
     can reach the exam cap (e.g. 21 d today), which would exceed the fixed 20 and
     invert the Again<Hard<Good<Easy<Mastered order. Floor Mastered at that card's
     Easy interval (already exam-cap clamped by nextIntervals) before capping, so
     Mastered >= Easy always holds. Pass the card's current state; omitted (null)
     yields the stateless Easy floor and the plain 20-day value as before. */
  MASTERED_DAYS: 20,
  masteredInterval: function (st) {
    var cap = this.examCap();
    var raw = Math.max(this.MASTERED_DAYS, this.nextIntervals(st).easy);
    return cap != null ? Math.min(raw, cap) : raw;
  },

  _newReviewOpId: function () {
    var now = Date.now();
    if (now <= (this._reviewOpAt || 0)) now = this._reviewOpAt + 1;
    this._reviewOpAt = now;
    return now.toString(36) + '-' + Math.random().toString(36).slice(2);
  },

  /* Pin consume and restore are id-level facts. They must not stamp
     formulaDay._opAt: that stamp makes the whole batch win a cross-tab
     merge and drops a sibling's added ids, or puts a consumed pin back.
     fact: { id, op, at, action: 'consumed' | 'restored' } keyed by op. */
  _recordPinFact: function (id, op, action) {
    var s = PGRE.store.state;
    if (!s || !id) return null;
    if (!s.formulaPinFacts || typeof s.formulaPinFacts !== 'object' || Array.isArray(s.formulaPinFacts)) {
      s.formulaPinFacts = {};
    }
    var now = Date.now();
    if (now <= (this._pinFactAt || 0)) now = this._pinFactAt + 1;
    this._pinFactAt = now;
    var opId = op || this._newReviewOpId();
    s.formulaPinFacts[opId] = { id: id, op: opId, at: now, action: action };
    return opId;
  },

  _latestPinAction: function (id) {
    var facts = PGRE.store.state && PGRE.store.state.formulaPinFacts;
    if (!facts || !id) return null;
    var best = null, bestOp = '';
    for (var op in facts) {
      if (!Object.prototype.hasOwnProperty.call(facts, op)) continue;
      var f = facts[op];
      if (!f || f.id !== id) continue;
      var at = Number(f.at) || 0;
      if (!best || at > best.at || (at === best.at && String(op) > bestOp)) {
        best = f;
        bestOp = String(op);
      }
    }
    return best ? best.action : null;
  },

  _clearSoftHold: function (id) {
    var st = this.cardState(id);
    if (st && st.softHold) delete st.softHold;
  },

  /* One door for an id leaving today. wasIn is true only when this call is
     the removal and the id was in reviewIds, newIds, or softIds. A restored
     pin then gets a consumed fact. opts.pin is the grade path: a soft pin
     that had no fact yet is still consumed, on opts.op, so undo can
     overwrite that same op. Already consumed, or never in the batch, records
     nothing. Clears softHold. Does not stamp formulaDay. */
  _noteLeftToday: function (id, wasIn, opts) {
    opts = opts || {};
    if (!id) return false;
    var wrote = false;
    if (wasIn && (opts.pin || this._latestPinAction(id) === 'restored')) {
      this._recordPinFact(id, opts.op || null, 'consumed');
      wrote = true;
    }
    this._clearSoftHold(id);
    return wrote;
  },

  /* Drop this id from today's soft pins in the same state update as the
     grade. Returns true when a pin was removed. A refused grade must not
     call this. The fact and the hold clear go through _noteLeftToday.
     Does not restamp the batch. */
  _consumeSoftPin: function (id, op) {
    var batch = PGRE.store.state && PGRE.store.state.formulaDay;
    var next = [], removed = false, i;
    if (batch && Array.isArray(batch.softIds) && batch.softIds.length) {
      for (i = 0; i < batch.softIds.length; i++) {
        if (batch.softIds[i] === id) { removed = true; continue; }
        next.push(batch.softIds[i]);
      }
    }
    if (removed) {
      if (next.length) batch.softIds = next;
      else delete batch.softIds;
    }
    this._noteLeftToday(id, removed, { pin: true, op: op });
    return removed;
  },

  _restoreSoftPin: function (id, op) {
    var batch = PGRE.store.state && PGRE.store.state.formulaDay;
    if (!batch || !id) return;
    var lists = [batch.reviewIds, batch.newIds], inBatch = false, li, i;
    for (li = 0; li < lists.length; li++) {
      var list = lists[li];
      if (!Array.isArray(list)) continue;
      for (i = 0; i < list.length; i++) if (list[i] === id) inBatch = true;
    }
    if (!inBatch) return;
    if (!Array.isArray(batch.softIds)) batch.softIds = [];
    for (i = 0; i < batch.softIds.length; i++) if (batch.softIds[i] === id) return;
    batch.softIds.push(id);
    this._recordPinFact(id, op, 'restored');
  },

  /* May a grade or an undo write now? After a refused save, try one save
     first: the refused press was taken back, so memory matches storage and
     the retry stores nothing new. Without it grades stay refused until some
     other save works (the study-time tracker saves at most every 30 s).
     When the retry fails too, says the press was not recorded. */
  _retrySave: function () {
    if (typeof PGRE.store.canWrite !== 'function' || PGRE.store.canWrite()) return true;
    if (PGRE.store.save()) return true;
    if (typeof PGRE.persistWarning === 'function') PGRE.persistWarning(true);
    if (typeof PGRE.pressNotRecorded === 'function') PGRE.pressNotRecorded();
    return false;
  },

  /* Grade one formula card. Returns the updated card, or null when the
     write is refused. A null return leaves cards, cardReviews and softIds
     unchanged — callers must not advance a queue, counter or history.
     On success the card's lastReviewOpId and the log row's op name this
     review, and that id is removed from formulaDay.softIds. scheme is
     'current' so the legacy easy10 migration will not stretch this card. */
  gradeCard: function (id, grade) {
    if (!this._retrySave()) return null;
    // Grade on top of a sibling tab's latest review of this card, or the
    // merge keeps the sibling's record (more reviews) and drops this grade.
    if (typeof PGRE.store.adoptDisk === 'function') PGRE.store.adoptDisk();
    var s = PGRE.store.state;
    // Review-log capture (bundle 2) — read BEFORE the default-object creation:
    // hadState (n) separates a real review from a card's first-ever grade;
    // prevIvl / m record whether the card was mature (interval >= matureDays())
    // going in. The stored flag keeps the threshold that was in force that day.
    var hadState = !!(s.cards && Object.prototype.hasOwnProperty.call(s.cards, id));
    var prev = null;
    if (hadState) {
      try { prev = JSON.parse(JSON.stringify(s.cards[id])); } catch (ePrev) { prev = null; }
    }
    var st = hadState ? s.cards[id] : { reps: 0, lapses: 0, interval: 0,
                              ease: this.EASE_START, due: this.today(), reviews: 0 };
    var prevIvl = st.interval || 0;
    // ITEM 3: 'mastered' isn't an SM-2 grade — nextIntervals has no entry for it,
    // so schedule its fixed (capped) 20 days explicitly. It counts as a real
    // review and graduates the card (reps+1) via the non-Again branch below.
    var next = grade === 'mastered' ? this.masteredInterval(st)
                                    : this.nextIntervals(st)[grade];
    if (grade === 'again') {
      st.lapses += 1;
      st.reps = 0;
      st.ease = Math.max(this.EASE_MIN, st.ease - 0.20);
    } else {
      if (grade === 'hard') st.ease = Math.max(this.EASE_MIN, st.ease - 0.15);
      if (grade === 'easy') st.ease = Math.min(this.EASE_MAX, st.ease + 0.15);
      st.reps += 1;
    }
    st.interval = next;
    st.due = this.addDays(next);
    st.reviews += 1;
    st.lastGrade = grade;
    st.lastReviewedAt = new Date().toISOString();
    st.lastReviewedDay = this.today();   // LOCAL date — the studiedToday source of truth
    st.scheme = 'current';
    // The pre-grade clone still carries softHold. _consumeSoftPin clears it
    // only on the card this grade commits, so a snapshot undo keeps the pin.
    var op = this._newReviewOpId();
    st.lastReviewOpId = op;
    s.cards[id] = st;
    var consumedSoft = this._consumeSoftPin(id, op);
    // Append to the capped review log (bundle 2 — stats foundation). Guard: the
    // array may be absent on states saved before this key existed. op names
    // this grade for undoReview; prev is the card before this grade (null if
    // it had no state). soft: 1 means this grade consumed a soft pin.
    var log = s.cardReviews || (s.cardReviews = []);
    var row = { d: this.today(), id: id, g: grade, ivl: prevIvl,
                m: prevIvl >= this.matureDays() ? 1 : 0, n: hadState ? 1 : 0, op: op, prev: prev };
    if (consumedSoft) row.soft = 1;
    log.push(row);
    if (log.length > 8000) log.splice(0, log.length - 8000);
    return st;
  },

  /* Undo the named review and no other. Returns { ok, opId, cardId, card }
     when that op is still the card's latest review. Returns null, and
     leaves cards, the log and softIds unchanged, when the write is refused,
     the op is unknown, it was already undone, or a newer review (this tab
     or a sibling) has superseded it. Does not save — the caller saves.
     card is the restored record, or null when the grade had created the card. */
  undoReview: function (opId) {
    if (!opId) return null;
    if (!this._retrySave()) return null;
    // A sibling's newer review of this card supersedes the op (checked below).
    if (typeof PGRE.store.adoptDisk === 'function') PGRE.store.adoptDisk();
    var s = PGRE.store.state;
    if (s.reviewUndos && Object.prototype.hasOwnProperty.call(s.reviewUndos, opId)) return null;
    var log = s.cardReviews || [];
    var idx = -1, i;
    for (i = log.length - 1; i >= 0; i--) {
      if (log[i] && log[i].op === opId) { idx = i; break; }
    }
    if (idx < 0) return null;
    var row = log[idx];
    var card = s.cards && Object.prototype.hasOwnProperty.call(s.cards, row.id) ? s.cards[row.id] : null;
    if (card && card.lastReviewOpId && card.lastReviewOpId !== opId) return null;
    var prev = null;
    if (row.prev) {
      try { prev = JSON.parse(JSON.stringify(row.prev)); } catch (ePrev) { prev = null; }
    }
    if (!s.reviewUndos || typeof s.reviewUndos !== 'object' || Array.isArray(s.reviewUndos)) {
      s.reviewUndos = {};
    }
    var tombPrev = null;
    if (prev) {
      try { tombPrev = JSON.parse(JSON.stringify(prev)); } catch (eTomb) { tombPrev = prev; }
    }
    s.reviewUndos[opId] = { at: new Date().toISOString(), cardId: row.id, prev: tombPrev };
    log.splice(idx, 1);
    if (prev) s.cards[row.id] = prev;
    else delete s.cards[row.id];
    if (row.soft) this._restoreSoftPin(row.id, opId);
    return { ok: true, opId: opId, cardId: row.id, card: prev };
  },

  /* ITEM 5 — one-time recompute (the user chose "recompute now" over "apply on
     next review"): bring every already-graded Easy card onto the new 10-day
     scheme. For each card with lastGrade === 'easy' and interval < 10, stretch
     the interval to min(10, examCap) and re-derive due from the card's own
     last-review day (fall back to today when that stamp predates it). A
     persistent one-shot flag (state.migrations.easy10) guards it to exactly one
     run per stored state; the flag is stamped and saved unconditionally so it
     never re-runs. No other grade is touched (no legacy card can be 'mastered',
     and Good/Hard/Again due dates are correct as-is). Called from store.load()
     after migrate(), where PGRE.srs and the backfilled settings are ready. */
  migrateEasy10: function () {
    var s = PGRE.store.state;
    if (!s.migrations || typeof s.migrations !== 'object') s.migrations = {};
    if (s.migrations.easy10) return;            // already migrated this state
    var cap = this.examCap();
    var target = Math.min(10, cap || 10);       // clamp to the exam cap when active
    var cards = s.cards || {};
    for (var id in cards) {
      var st = cards[id];
      // scheme 'current' is written by gradeCard. Those intervals already
      // follow the 4-day rule and must not be stretched to 10.
      if (!st || st.scheme === 'current' || st.lastGrade !== 'easy' || (st.interval || 0) >= 10) continue;
      // b7f1d7b (2026-09-07) is the current scheduler: new Easy is 4 days
      // and the review Easy floor is gone. A card reviewed on or after
      // that day, even with no scheme field, must not be stretched to 10.
      var reviewed = st.lastReviewedDay;
      if (typeof reviewed !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(reviewed)) {
        reviewed = '';
        if (typeof st.lastReviewedAt === 'string') {
          var reviewedAt = new Date(st.lastReviewedAt);
          if (!isNaN(reviewedAt.getTime())) reviewed = this.dayStr(reviewedAt);
        }
      }
      if (reviewed >= '2026-09-07') continue;
      st.interval = target;
      st.due = this.addDaysTo(st.lastReviewedDay || this.today(), target);
    }
    // Stamping the flag is itself a state change, so persist once regardless of
    // whether any card moved — that is what makes the run one-shot.
    s.migrations.easy10 = new Date().toISOString();
    PGRE.store.save();
  },

  /* Recall deck curation 2026-10-14 (99_System/Handoff documents/
     recall-deck-curation-2026-10-14/). These ids kept their SRS history but now
     ask a substantially different question, so an old long interval could hide
     the new question until after the exam. Bring each one due today unless it
     has been graded since the curation went live (its lastReviewedAt is then
     newer than the cutoff, so it was already graded on the new wording).
     Condition-based, not a one-shot flag: the cards merge rule prefers the
     later due on a tie, so a stale sibling tab can push a due date back; the
     next load re-applies it. Saves only when something moved. */
  CURATION_REQUEUE_CUTOFF: '2026-10-14T14:45:00.000Z',
  CURATION_REQUEUE_IDS: [
    'cpgf-1.4',
    'cpgf-1.20',
    'cpgf-1.24',
    'cpgf-1.26',
    'cpgf-1.27',
    'cpgf-1.38',
    'cpgf-1.39',
    'cpgf-1.41',
    'cpgf-1.42',
    'cpgf-2.8',
    'cpgf-2.16',
    'cpgf-2.20',
    'cpgf-2.70',
    'cpgf-2.74',
    'cpgf-2.85',
    'cpgf-6.1',
    'cpgf-6.6',
    'cpgf-6.18',
    'cpgf-5.27',
    'cpgf-4.10',
    'cpgl-1.03',
    'cpgl-1.04',
    'cpgl-3.10a',
    'cpgl-4.02',
    'cpgl-4.03h',
    'cpgl-7.04',
    'cpgl-7.05a',
    'cpgl-8.13',
    'cpgl-9.01',
    'cpgl-5.01',
    'cpgl-5.02',
    'cpgl-5.05',
    'cpgl-5.07',
    'cpgl-5.08',
    'cpgl-5.09',
    'cpgl-5.15',
    'cpgl-5.17',
    'supp-newton-momentum',
    'supp-friction',
    'supp-gravity-orbits',
    'supp-image-plane',
    'supp-heat-pump-cop',
    'supp-newton-momentum',
    'cpgf-2.18',
    'cpgf-5.56',
    'supp-counting-distributions',
    'supp-neutrino-oscillation',
    'cpgl-8.11',
    'cpgf-5.15',
    'supp-thin-film'
  ],
  requeueCuratedCards: function () {
    var s = PGRE.store.state;
    var cards = s && s.cards;
    if (!cards || typeof cards !== 'object') return false;
    var today = this.today(), cutoff = this.CURATION_REQUEUE_CUTOFF, moved = false;
    this.CURATION_REQUEUE_IDS.forEach(function (id) {
      if (!Object.prototype.hasOwnProperty.call(cards, id)) return;   // never seen: already new
      var st = cards[id];
      if (!st || typeof st !== 'object') return;
      if (typeof st.lastReviewedAt === 'string' && st.lastReviewedAt >= cutoff) return;
      if (typeof st.due === 'string' && st.due <= today) return;
      st.due = today;
      moved = true;
    });
    if (moved && PGRE.store.canWrite && PGRE.store.canWrite()) PGRE.store.save();
    return moved;
  },

  /* Was this card graded today (scheduling day)? Prefer the lastReviewedDay
     stamp; fall back to the scheduling day of the ISO lastReviewedAt for
     cards graded before the stamp existed. NEVER compares a UTC ISO prefix to a
     local date string (that off-by-a-day bug is exactly what this guards). */
  studiedToday: function (st) {
    if (!st) return false;
    if (st.lastReviewedDay) return st.lastReviewedDay === this.today();
    return !!(st.lastReviewedAt &&
      this.dayOf(new Date(st.lastReviewedAt)) === this.today());
  },

  /* New cards (never graded) count as due — they enter the daily queue. */
  cardDue: function (id) {
    var st = this.cardState(id);
    return !st || st.due <= this.today();
  },

  dueDeck: function (deck) {
    var self = this;
    return deck.filter(function (c) { return self.cardDue(c.id); });
  },

  newInDeck: function (deck) {
    var self = this;
    return deck.filter(function (c) { return !self.cardState(c.id); });
  },

  /* ——— Daily formula batch ———
     formulaDay() itself is prune-only. The picker, browse/search Add, and the
     explicit auto-pick (autoFillFormulaDay) grow the batch.
     The batch PERSISTS across day rolls: un-studied picks carry over,
     completed ones are pruned by reconcile. The daily target (clampTarget)
     is a soft suggestion — never a cap. */

  /* Integer clamp of the daily target to [1, 100]; 10 when it isn't a finite
     number. Every batch read routes the raw setting through here so a corrupt
     or imported value can never poison the queue. */
  clampTarget: function (n) {
    n = Number(n);
    if (!isFinite(n)) return 10;
    n = Math.round(n);
    return n < 1 ? 1 : n > 100 ? 100 : n;
  },

  /* Mark a user-visible batch mutation for cross-tab reconciliation. The
     store can still union legacy/unmarked disjoint additions, while marked
     writes let a newer explicit replace/remove beat a stale tab. */
  _markFormulaDayMutation: function (batch, kind) {
    if (!batch) return;
    var now = Date.now();
    if (now <= (this._formulaMutationAt || 0)) now = this._formulaMutationAt + 1;
    this._formulaMutationAt = now;
    batch._opAt = now;
    batch._opId = now.toString(36) + '-' + Math.random().toString(36).slice(2);
    batch._opKind = kind || 'replace';
  },

  /* True when the last formulaDeck() read was missing a source. Absent
     status means the caller passed its own deck and pruning is allowed. */
  _deckPartial: function () {
    var status = PGRE.formulaDeckStatus;
    return !!(status && status.partial);
  },

  /* In-place reconcile of the persistent batch; returns whether anything
     changed (so the caller only persists on a real edit). The batch is fully
     user-curated: reconcile only prunes — it never adds or re-fills. */
  _reconcileFormulaDay: function (batch, deck, byId, t) {
    var self = this, changed = false;
    var susp = PGRE.store.state.formulaSuspended || {};
    var partial = this._deckPartial();
    if (!Array.isArray(batch.reviewIds)) { batch.reviewIds = []; changed = true; }
    if (!Array.isArray(batch.newIds)) { batch.newIds = []; changed = true; }
    if (batch.softIds && !Array.isArray(batch.softIds)) {
      delete batch.softIds;
      changed = true;
    }

    function inDeck(id) {
      return Object.prototype.hasOwnProperty.call(byId, id);
    }
    function isSusp(id) {
      return !!(susp && Object.prototype.hasOwnProperty.call(susp, id) && susp[id]);
    }

    var beforeIds = Object.create(null);
    (batch.reviewIds || []).concat(batch.newIds || [], batch.softIds || []).forEach(function (id) {
      if (id) beforeIds[id] = 1;
    });

    // (a) soft pins that no longer mean anything: card left the deck, is
    // suspended, or was already studied today (the pin's one job — keeping a
    // not-yet-due add review-eligible — is done once today's grade is in).
    // A partial deck keeps pins whose cards are simply not in this read.
    if (batch.softIds && batch.softIds.length) {
      var beforeS = batch.softIds.length;
      var keptSoft = [];
      for (var si = 0; si < batch.softIds.length; si++) {
        var sid = batch.softIds[si];
        if (partial && !inDeck(sid)) { keptSoft.push(sid); continue; }
        if (inDeck(sid) && !isSusp(sid) && !self.studiedToday(self.cardState(sid))) {
          keptSoft.push(sid);
          continue;
        }
        // A grade from before the hold existed can still sit in softIds.
        // Dropping that pin must also drop the hold, or the card returns
        // on a later queue.
        if (self.studiedToday(self.cardState(sid))) self._clearSoftHold(sid);
      }
      if (keptSoft.length !== beforeS) changed = true;
      if (keptSoft.length) batch.softIds = keptSoft;
      else delete batch.softIds;
    }
    var softSet = Object.create(null);
    if (batch.softIds) batch.softIds.forEach(function (id) { softSet[id] = 1; });

    // (b) drop ids that left the deck or are suspended, and retire completed
    // picks: a card graded on an EARLIER day whose due is now in the future
    // has served its turn. Carry-over keeps never-studied picks, due/overdue
    // reviews, today's again-graded cards (due today) and soft-pinned adds.
    // When a deck source was missing, an id absent from this read is kept.
    function held(id) {
      var st = self.cardState(id);
      return !!(st && st.softHold);
    }
    function drop(id) {
      if (!inDeck(id)) return !partial;
      if (isSusp(id)) return true;
      var st = self.cardState(id);
      // A soft hold is the pin the shipped Undo snapshot still carries.
      return !!st && st.due > t && !softSet[id] && !held(id) && !self.studiedToday(st);
    }
    var beforeR = batch.reviewIds.length, beforeN = batch.newIds.length;
    batch.reviewIds = batch.reviewIds.filter(function (id) { return !drop(id); });
    batch.newIds = batch.newIds.filter(function (id) { return !drop(id); });
    if (batch.reviewIds.length !== beforeR || batch.newIds.length !== beforeN) changed = true;

    // Ids this prune actually removed. An id the batch already omitted is
    // not in beforeIds, so a sibling drop does not become a consumed fact.
    // The fact does not set changed and does not stamp the batch.
    var afterIds = Object.create(null);
    batch.reviewIds.concat(batch.newIds, batch.softIds || []).forEach(function (id) {
      if (id) afterIds[id] = 1;
    });
    for (var leftId in beforeIds) {
      if (!Object.prototype.hasOwnProperty.call(beforeIds, leftId) || afterIds[leftId]) continue;
      self._noteLeftToday(leftId, true);
    }

    // Put a held id back into softIds without stamping the batch. The fact
    // is newer than the grade's consume, so a stale copy cannot drop it.
    function putHoldBack(id) {
      if (!held(id) || self.studiedToday(self.cardState(id)) || softSet[id]) return;
      if (!Array.isArray(batch.softIds)) batch.softIds = [];
      batch.softIds.push(id);
      softSet[id] = 1;
      self._recordPinFact(id, null, 'restored');
    }
    batch.reviewIds.forEach(putHoldBack);
    batch.newIds.forEach(putHoldBack);

    // A newer batch can drop an id without clearing the hold on this tab's
    // card. The hold must not survive that, or it pins the card again when
    // the card rejoins the list. Do not stamp the batch for this clear.
    var stillHeld = Object.create(null);
    batch.reviewIds.concat(batch.newIds, batch.softIds || []).forEach(function (id) {
      stillHeld[id] = 1;
    });
    var heldCards = PGRE.store.state.cards;
    if (heldCards && typeof heldCards === 'object') {
      for (var heldId in heldCards) {
        if (!Object.prototype.hasOwnProperty.call(heldCards, heldId)) continue;
        var heldRec = heldCards[heldId];
        if (!heldRec || !heldRec.softHold || stillHeld[heldId]) continue;
        delete heldRec.softHold;
      }
    }

    return changed;
  },

  /* The picked batch { date, reviewIds, newIds, softIds? }. Never auto-built:
     an absent batch becomes an empty one; an existing batch is only reconciled
     (pruned). Persisted when it changed. An empty deck returns a transient
     empty batch WITHOUT persisting — this path also runs from the nav badge
     before the IndexedDB deck has resolved, and must not stamp an empty batch
     over a real one. softIds pin not-yet-due adds so they stay review-eligible
     until studied today (see formulaDayRemaining). */
  formulaDay: function (deck) {
    deck = deck || [];
    var s = PGRE.store.state, t = this.today();
    if (!deck.length) return { date: t, reviewIds: [], newIds: [] };

    var byId = Object.create(null);
    deck.forEach(function (c) {
      if (c && c.id != null && c.id !== '') byId[c.id] = c;
    });

    var batch = s.formulaDay, changed = false;
    if (batch && (typeof batch !== 'object' || Array.isArray(batch))) {
      batch = null;
      s.formulaDay = null;
      changed = true;
    }
    if (!batch) {
      batch = { date: t, reviewIds: [], newIds: [] };
      s.formulaDay = batch;
      changed = true;
    } else {
      if (PGRE.store._normalizeFormulaDayArrays &&
          PGRE.store._normalizeFormulaDayArrays(batch, s.cards).changed) changed = true;
      if (this._reconcileFormulaDay(batch, deck, byId, t)) changed = true;
    }
    if (changed) {
      this._markFormulaDayMutation(batch, 'remove');
      PGRE.store.save();
    }
    return batch;
  },

  /* Book chapter of a card id (cpgf-<ch>.<eq> or cpgl-<ch>.<NN>); Infinity
     for supplements and anything else, so they sort after the numbered chapters. */
  formulaChapter: function (id) {
    var m = String(id || '').match(/^cpg[fl]-(\d+)\./);
    return m ? parseInt(m[1], 10) : Infinity;
  },

  /* Cards whose "new today" slot is already taken: a never-studied id in
     today's batch plus every card whose FIRST review landed today
     (cardReviews row n:0 on today's date). Manual adds of new cards count
     toward the cap too — the cap is on introductions, not on the picker. */
  newCardsCommittedToday: function () {
    var s = PGRE.store.state || {};
    var seen = Object.create(null), n = 0;
    var batch = s.formulaDay;
    if (batch && Array.isArray(batch.newIds)) {
      batch.newIds.forEach(function (id) {
        if (id && !seen[id]) { seen[id] = 1; n++; }
      });
    }
    var t = this.today();
    (s.cardReviews || []).forEach(function (r) {
      if (r && r.n === 0 && r.d === t && r.id && !seen[r.id]) { seen[r.id] = 1; n++; }
    });
    return n;
  },

  /* Auto-pick — the one rule behind Study on Formula recall home, the
     picker's Fill button and the Today dashboard: due reviews first (most
     overdue, then most lapses, then lowest ease), then never-studied cards in
     book order (chapter, then deck order), up to the daily target. Skips
     suspended cards, cards already chosen, and cards graded today. Adds
     nothing to the batch itself.
     Life Studio: opts.subject limits BOTH pools to one PGRE.SUBJECTS id
     (the batch it fills stays the single mixed list), and new-card
     suggestions stop at settings.newCardsPerDay minus the day's committed
     introductions (settings.recallSubject is a UI choice, not read here).
     opts.have — { id: 1 } already chosen (default: the saved batch);
     opts.room — how many to return (default: target minus remaining picks);
     opts.fresh === false — due reviews only, no new cards.
     @returns {{ reviewIds: string[], newIds: string[] }} */
  suggestFormulaDay: function (deck, opts) {
    deck = deck || [];
    opts = opts || {};
    var self = this, t = this.today();
    var out = { reviewIds: [], newIds: [] };
    if (!deck.length) return out;
    var subject = (opts.subject && opts.subject !== 'all' &&
                   PGRE.subjectById && PGRE.subjectById(opts.subject))
      ? PGRE.subjectById(opts.subject).id : null;
    var inSubject = function (c) {
      return !subject || (PGRE.cardSubject ? PGRE.cardSubject(c) === subject : true);
    };
    var have = opts.have, room = opts.room;
    if (!have) {
      have = Object.create(null);
      var batch = this.formulaDay(deck);
      batch.reviewIds.concat(batch.newIds).forEach(function (id) { have[id] = 1; });
    }
    if (room == null) {
      room = this.clampTarget(PGRE.store.state.settings &&
        PGRE.store.state.settings.formulaDailyTarget) -
        this.formulaDayRemaining(deck).length;
    }
    if (!(room > 0)) return out;
    var due = [], fresh = [];
    deck.forEach(function (c, index) {
      if (!c || !c.id ||
          (have && Object.prototype.hasOwnProperty.call(have, c.id) && have[c.id]) ||
          self.isSuspended(c.id) || !inSubject(c)) return;
      var st = self.cardState(c.id);
      if (!st) fresh.push({ id: c.id, ch: self.formulaChapter(c.id), index: index });
      else if (st.due <= t && !self.studiedToday(st)) due.push({ id: c.id, st: st, index: index });
    });
    due.sort(function (a, b) {
      if (a.st.due !== b.st.due) return a.st.due < b.st.due ? -1 : 1;
      var la = a.st.lapses || 0, lb = b.st.lapses || 0;
      if (la !== lb) return lb - la;
      var ea = a.st.ease || 0, eb = b.st.ease || 0;
      if (ea !== eb) return ea - eb;
      return a.index - b.index;
    });
    fresh.sort(function (a, b) {
      if (a.ch !== b.ch) return a.ch < b.ch ? -1 : 1;
      return a.index - b.index;
    });
    function ids(list) { return list.map(function (x) { return x.id; }); }
    out.reviewIds = ids(due.slice(0, room));
    room -= out.reviewIds.length;
    if (room > 0 && opts.fresh !== false) {
      var freshRoom = room;
      var limit = PGRE.store.state.settings &&
                  PGRE.store.state.settings.newCardsPerDay;
      if (limit != null) {
        var left = this.clampTarget(limit) - this.newCardsCommittedToday();
        if (left < freshRoom) freshRoom = Math.max(0, left);
      }
      out.newIds = ids(fresh.slice(0, freshRoom));
    }
    return out;
  },

  /* An edit of today's list is merged whole (the newest _opAt wins), so it
     must start from a sibling tab's latest list, or it drops that tab's
     Add or Remove. */
  _adoptBeforeListEdit: function () {
    if (typeof PGRE.store.adoptDisk === 'function') PGRE.store.adoptDisk();
  },

  /* Append the auto-pick to the saved batch and persist. Existing picks —
     active, completed-today or deliberate future adds — are never replaced;
     with no room left under the target this is a no-op. The first population
     of the day stamps today's date on a carried-over shell. opts as for
     suggestFormulaDay. The caller owns the Study transition. */
  autoFillFormulaDay: function (deck, opts) {
    deck = deck || [];
    this._adoptBeforeListEdit();
    var batch = this.formulaDay(deck);
    if (!deck.length) return batch;
    var pick = this.suggestFormulaDay(deck, opts);
    if (!pick.reviewIds.length && !pick.newIds.length) return batch;
    batch.reviewIds = batch.reviewIds.concat(pick.reviewIds);
    batch.newIds = batch.newIds.concat(pick.newIds);
    batch.date = this.today();
    this._markFormulaDayMutation(batch, 'add');
    PGRE.store.state.formulaDay = batch;
    PGRE.store.save();
    return batch;
  },

  /* Membership check against the picked batch. Does NOT call formulaDay() —
     search UI uses this and must stay side-effect free until the user
     explicitly clicks Add. */
  isInFormulaDay: function (deck, id) {
    var batch = PGRE.store.state.formulaDay;
    if (!batch || !id) return false;
    return batch.reviewIds.indexOf(id) !== -1 || batch.newIds.indexOf(id) !== -1;
  },

  /* Add cards into the picked batch (search "Add to today", browse chips).
     Classification: no state → newIds; has state → reviewIds (including
     not-yet-due — a deliberate topical add); suspended → unsuspend then add;
     already in batch → idempotent. Not-yet-due learned adds are pinned in
     batch.softIds so they stay review-eligible until studied today.
     @returns {{ batch, added: string[], already: string[], skipped: string[] }} */
  addFormulaDaySoft: function (deck, ids) {
    var self = this;
    deck = deck || [];
    ids = ids || [];
    var added = [], already = [], skipped = [];
    if (!deck.length) {
      return { batch: { date: this.today(), reviewIds: [], newIds: [] },
        added: added, already: already, skipped: skipped };
    }
    this._adoptBeforeListEdit();
    var batch = this.formulaDay(deck);
    var byId = Object.create(null);
    deck.forEach(function (c) {
      if (c && c.id != null && c.id !== '') byId[c.id] = c;
    });
    if (!batch.softIds) batch.softIds = [];
    var softSet = Object.create(null), inBatch = Object.create(null);
    batch.softIds.forEach(function (id) { softSet[id] = 1; });
    batch.reviewIds.concat(batch.newIds).forEach(function (id) { inBatch[id] = 1; });

    var changed = false;
    var seen = Object.create(null);
    ids.forEach(function (id) {
      if (!id || seen[id]) return;
      seen[id] = 1;
      if (!byId[id]) { skipped.push(id); return; }
      if (self.isSuspended(id)) { self.unsuspendCard(id); changed = true; }
      var heldCard = self.cardState(id);
      if (heldCard && !self.studiedToday(heldCard) && !heldCard.softHold) {
        heldCard.softHold = true;
        changed = true;
      }
      if (!softSet[id]) {
        batch.softIds.push(id);
        softSet[id] = 1;
        changed = true;
        // A later explicit pin beats an earlier consume fact. The first
        // pin has no fact, so a plain batch remove still drops it.
        if (self._latestPinAction(id) === 'consumed') self._recordPinFact(id, null, 'restored');
      }
      if (inBatch[id]) { already.push(id); return; }
      if (self.cardState(id)) batch.reviewIds.push(id);
      else batch.newIds.push(id);
      inBatch[id] = 1;
      added.push(id);
      changed = true;
    });

    if (!batch.softIds.length) delete batch.softIds;
    if (changed) {
      // Manual Add is another explicit population boundary. Stamp the batch
      // with the local day in which the user changed it.
      batch.date = self.today();
      self._markFormulaDayMutation(batch, 'add');
      PGRE.store.state.formulaDay = batch;
      PGRE.store.save();
    }
    return { batch: batch, added: added, already: already, skipped: skipped };
  },

  /* Drop soft pins and remove the ids from today's batch lists (if present).
     Studied cards stay put — same rule as clear/reroll of new picks: a grade
     already committed today is not undone by un-pinning. */
  removeFormulaDaySoft: function (deck, ids) {
    var self = this;
    deck = deck || [];
    ids = ids || [];
    if (!deck.length || !ids.length) {
      return this.formulaDay(deck);
    }
    this._adoptBeforeListEdit();
    var batch = this.formulaDay(deck);
    var drop = Object.create(null);
    var changed = false;
    var wasIn = Object.create(null);
    (batch.reviewIds || []).concat(batch.newIds || [], batch.softIds || []).forEach(function (id) {
      if (id) wasIn[id] = 1;
    });
    ids.forEach(function (id) { if (id) drop[id] = 1; });
    if (batch.softIds && batch.softIds.length) {
      var beforeSoft = batch.softIds.length;
      batch.softIds = batch.softIds.filter(function (id) { return !drop[id]; });
      if (!batch.softIds.length) delete batch.softIds;
      changed = (batch.softIds ? batch.softIds.length : 0) !== beforeSoft;
    }
    var beforeReview = batch.reviewIds.length, beforeNew = batch.newIds.length;
    batch.reviewIds = batch.reviewIds.filter(function (id) {
      if (!drop[id]) return true;
      // Keep studiedToday members in the batch even when the pin is cleared.
      return self.studiedToday(self.cardState(id));
    });
    batch.newIds = batch.newIds.filter(function (id) {
      if (!drop[id]) return true;
      return self.studiedToday(self.cardState(id));
    });
    changed = changed || batch.reviewIds.length !== beforeReview || batch.newIds.length !== beforeNew;
    // A hold left on a removed card pins it again when it rejoins the list.
    // Leave the hold when the id stays in the batch.
    ids.forEach(function (id) {
      if (!id || !drop[id]) return;
      if (batch.reviewIds.indexOf(id) !== -1 || batch.newIds.indexOf(id) !== -1) return;
      if (batch.softIds && batch.softIds.indexOf(id) !== -1) return;
      // A restored fact would soft-pin this id again once it rejoins the
      // batch. Consume only when the id actually leaves.
      self._noteLeftToday(id, !!wasIn[id]);
    });
    if (changed) self._markFormulaDayMutation(batch, 'remove');
    PGRE.store.state.formulaDay = batch;
    PGRE.store.save();
    return batch;
  },

  /* Cards from the picked batch still owed: never-studied (no state), due
     today or overdue, or soft-pinned not-yet-due adds not yet studied today
     (without the pin rule a topical add would sit in the batch but never
     surface in Study / the nav badge). An again-graded card (due today) stays
     remaining across reloads; a good/hard/easy card (due later) is done and
     reconcile prunes it. */
  formulaDayRemaining: function (deck) {
    var self = this, t = this.today();
    var batch = this.formulaDay(deck);
    var softSet = Object.create(null);
    if (batch.softIds) batch.softIds.forEach(function (id) { softSet[id] = 1; });
    var byId = Object.create(null);
    (deck || []).forEach(function (c) { byId[c.id] = c; });
    var out = [];
    batch.reviewIds.concat(batch.newIds).forEach(function (id) {
      var c = byId[id];
      if (!c) return;
      var st = self.cardState(id);
      if (!st || st.due <= t ||
          ((softSet[id] || st.softHold) && !self.studiedToday(st))) out.push(c);
    });
    return out;
  },

  /* Count of due reviews held back from today's batch (the overflow line). */
  formulaDayPostponed: function (deck) {
    var self = this, t = this.today();
    var batch = this.formulaDay(deck);
    var byId = Object.create(null);
    (deck || []).forEach(function (c) {
      if (c && c.id != null && c.id !== '') byId[c.id] = c;
    });
    var susp = PGRE.store.state.formulaSuspended || {};
    var allDue = (deck || []).filter(function (c) {
      var st = self.cardState(c.id);
      var held = !!(susp && Object.prototype.hasOwnProperty.call(susp, c.id) && susp[c.id]);
      return st && !held && st.due <= t;
    }).length;
    var inBatchDue = 0;
    batch.reviewIds.concat(batch.newIds).forEach(function (id) {
      var st = self.cardState(id);
      if (byId[id] && st && st.due <= t) inBatchDue++;
    });
    return Math.max(0, allDue - inBatchDue);
  },

  /* Replace the picked batch wholesale (picker Save): the passed ids become
     the batch, classified no-state → newIds / has-state → reviewIds. Cards
     already studied today are locked — they stay in the batch whatever the
     checkbox said (a grade committed today is not undone by un-picking).
     Added cards are unsuspended; not-yet-due learned adds are soft-pinned so
     they surface until studied today. The daily target is advisory — the
     batch may fall below or rise above it freely.
     @returns the updated batch */
  setFormulaDayPicks: function (deck, ids) {
    var self = this;
    this._adoptBeforeListEdit();
    var batch = this.formulaDay(deck);
    var byId = Object.create(null);
    (deck || []).forEach(function (c) {
      if (c && c.id != null && c.id !== '') byId[c.id] = c;
    });
    var unresolvedReview = [], unresolvedNew = [], unresolvedSoft = [];
    if (this._deckPartial()) {
      (batch.reviewIds || []).forEach(function (id) {
        if (typeof id === 'string' && id && !Object.prototype.hasOwnProperty.call(byId, id)) unresolvedReview.push(id);
      });
      (batch.newIds || []).forEach(function (id) {
        if (typeof id === 'string' && id && !Object.prototype.hasOwnProperty.call(byId, id)) unresolvedNew.push(id);
      });
      (batch.softIds || []).forEach(function (id) {
        if (typeof id === 'string' && id && !Object.prototype.hasOwnProperty.call(byId, id)) unresolvedSoft.push(id);
      });
    }
    var keep = Object.create(null);
    batch.reviewIds.concat(batch.newIds).forEach(function (id) {
      if (byId[id] && self.studiedToday(self.cardState(id))) keep[id] = 1;
    });
    var reviewIds = [], newIds = [], softIds = [], seen = Object.create(null);
    function add(id) {
      if (!id || seen[id] || !byId[id]) return;
      seen[id] = 1;
      if (self.isSuspended(id)) self.unsuspendCard(id);
      var st = self.cardState(id);
      if (st) {
        reviewIds.push(id);
        if (!keep[id] && st.due > self.today()) softIds.push(id);
      } else {
        newIds.push(id);
      }
    }
    Object.keys(keep).forEach(add);
    (ids || []).forEach(add);
    unresolvedReview.forEach(function (id) {
      if (seen[id]) return;
      seen[id] = 1;
      reviewIds.push(id);
    });
    unresolvedNew.forEach(function (id) {
      if (seen[id]) return;
      seen[id] = 1;
      newIds.push(id);
    });
    unresolvedSoft.forEach(function (id) {
      if (softIds.indexOf(id) === -1) softIds.push(id);
    });
    var wasIn = Object.create(null);
    (batch.reviewIds || []).concat(batch.newIds || [], batch.softIds || []).forEach(function (id) {
      if (id) wasIn[id] = 1;
    });
    batch.reviewIds = reviewIds;
    batch.newIds = newIds;
    if (softIds.length) batch.softIds = softIds;
    else delete batch.softIds;
    delete batch.skipNew;
    // Re-pinning a consumed id has to outrank that consume. The fact does
    // not stamp the batch; the replace stamp below still does. The hold
    // matches Add, so a snapshot taken before the next grade still has it.
    for (var spi = 0; spi < softIds.length; spi++) {
      var pinned = this.cardState(softIds[spi]);
      if (pinned && !this.studiedToday(pinned) && !pinned.softHold) pinned.softHold = true;
      if (this._latestPinAction(softIds[spi]) === 'consumed') {
        this._recordPinFact(softIds[spi], null, 'restored');
      }
    }
    var staying = Object.create(null);
    reviewIds.concat(newIds, softIds).forEach(function (id) { staying[id] = 1; });
    var noted = Object.create(null);
    function noteLeft(id) {
      if (!id || noted[id] || staying[id]) return;
      noted[id] = 1;
      self._noteLeftToday(id, !!wasIn[id]);
    }
    for (var droppedId in wasIn) {
      if (Object.prototype.hasOwnProperty.call(wasIn, droppedId)) noteLeft(droppedId);
    }
    var heldCards = PGRE.store.state.cards;
    if (heldCards && typeof heldCards === 'object') {
      for (var hid in heldCards) {
        if (Object.prototype.hasOwnProperty.call(heldCards, hid)) noteLeft(hid);
      }
    }
    batch.date = this.today();
    this._markFormulaDayMutation(batch, 'replace');
    PGRE.store.state.formulaDay = batch;
    PGRE.store.save();
    return batch;
  },

  suspendCard: function (id) {
    var s = PGRE.store.state;
    if (!s.formulaSuspended) s.formulaSuspended = {};
    s.formulaSuspended[id] = new Date().toISOString(); // ISO so tombstone ts can compare
    PGRE.store.untombstone('formulaSuspended', id);
    var batch = s.formulaDay;
    if (!batch || !id) return;
    function listed(list) {
      if (!Array.isArray(list)) return false;
      for (var i = 0; i < list.length; i++) if (list[i] === id) return true;
      return false;
    }
    var wasIn = listed(batch.reviewIds) || listed(batch.newIds) || listed(batch.softIds);
    if (Array.isArray(batch.reviewIds)) {
      batch.reviewIds = batch.reviewIds.filter(function (x) { return x !== id; });
    }
    if (Array.isArray(batch.newIds)) {
      batch.newIds = batch.newIds.filter(function (x) { return x !== id; });
    }
    if (Array.isArray(batch.softIds)) {
      batch.softIds = batch.softIds.filter(function (x) { return x !== id; });
      if (!batch.softIds.length) delete batch.softIds;
    }
    // Put away is a real drop. The fact must land here: reconcile cannot
    // tell this removal from a sibling batch that simply omitted the id.
    // Do not stamp the batch.
    if (wasIn) this._noteLeftToday(id, true);
  },

  unsuspendCard: function (id) {
    var susp = PGRE.store.state.formulaSuspended;
    if (susp) { delete susp[id]; PGRE.store.tombstone('formulaSuspended', id); }
  },

  isSuspended: function (id) {
    var susp = PGRE.store.state.formulaSuspended;
    return !!(susp && Object.prototype.hasOwnProperty.call(susp, id) && susp[id]);
  },

  /* ——— Per-card memorizing history (browse peek strip) ———
     Pure derivation over the append-only cardReviews log + optional schedule.
     Read-only: never mutates store, cards, or the log. Day index is 1-based
     whole days since the card's first surviving review date (inclusive),
     matching the Dn@grade reference pattern. The 8000-cap can drop early
     entries — the strip shows what remains, without inventing missing days. */

  /* Grades that gradeCard may write; anything else is corrupt and skipped. */
  MEM_GRADES: { again: 1, hard: 1, good: 1, easy: 1, mastered: 1 },

  /* Own-key only — never treat Object.prototype names (constructor, toString…)
     as grades. Used by the builder and by the view class-name policy. */
  isMemGrade: function (g) {
    return typeof g === 'string' &&
      Object.prototype.hasOwnProperty.call(this.MEM_GRADES, g);
  },

  /* Default max review chips painted per card (DOM bound). count still
     reflects the full filtered total when more exist. */
  MEM_HIST_MAX_CHIPS: 80,

  /* YYYY-MM-DD only — rejects non-strings and malformed stamps. */
  _isDayStr: function (d) {
    return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
  },

  /* 1-based day index of dayStr relative to firstDay (both YYYY-MM-DD). */
  dayIndexFrom: function (firstDay, dayStr) {
    var a = new Date(firstDay + 'T12:00:00');
    var b = new Date(dayStr + 'T12:00:00');
    return Math.round((b - a) / 86400000) + 1;
  },

  /* Build a read-only timeline model for one card.
     reviews — full cardReviews array (or any array of { d, id, g, … })
     cardId  — formula card id to filter on
     opts    — optional {
                 due: 'YYYY-MM-DD'|null,
                 today: 'YYYY-MM-DD',
                 maxChips: number   // default MEM_HIST_MAX_CHIPS; 0 = unlimited
               }
               due paints a trailing scheduled chip; today labels it
               "due today" vs "next due". Missing/invalid opts are fine.
     Returns null when there are no usable reviews for this id.
     Does not mutate reviews or any store state. */
  buildMemHistory: function (reviews, cardId, opts) {
    opts = opts || {};
    if (!cardId || !Array.isArray(reviews)) return null;
    var mine = [];
    for (var i = 0; i < reviews.length; i++) {
      var r = reviews[i];
      if (!r || typeof r !== 'object') continue;
      if (r.id !== cardId) continue;
      if (!this._isDayStr(r.d)) continue;
      if (!this.isMemGrade(r.g)) continue;
      mine.push(r);
    }
    if (!mine.length) return null;

    var firstDay = mine[0].d;
    var lastDay = mine[0].d;
    var j;
    for (j = 0; j < mine.length; j++) {
      var e = mine[j];
      if (e.d < firstDay) firstDay = e.d;
      if (e.d > lastDay) lastDay = e.d;
    }
    // Second pass so day indices use the true earliest surviving day even if
    // the log is not sorted (defensive; gradeCard appends in order).
    var allChips = [];
    for (var k = 0; k < mine.length; k++) {
      var row = mine[k];
      allChips.push({
        kind: 'review',
        day: this.dayIndexFrom(firstDay, row.d),
        grade: row.g,
        d: row.d
      });
    }

    var total = allChips.length;
    var maxChips = opts.maxChips;
    if (maxChips == null || maxChips === undefined) maxChips = this.MEM_HIST_MAX_CHIPS;
    maxChips = Number(maxChips);
    if (!isFinite(maxChips) || maxChips < 0) maxChips = this.MEM_HIST_MAX_CHIPS;
    // 0 = unlimited (tests); otherwise keep the most recent chips.
    var chips = allChips;
    var chipsTruncated = false;
    if (maxChips > 0 && total > maxChips) {
      chips = allChips.slice(total - maxChips);
      chipsTruncated = true;
    }

    var pending = null;
    var due = opts.due;
    if (this._isDayStr(due)) {
      var today = this._isDayStr(opts.today) ? opts.today : null;
      var dueDay = this.dayIndexFrom(firstDay, due);
      var label = (today && due <= today) ? 'due today' : 'next due';
      // When due predates the surviving first day (8000-cap loss or bad due),
      // omit the day number rather than inventing D1 next to a real D1@grade.
      pending = {
        kind: 'pending',
        day: dueDay >= 1 ? dueDay : null,
        label: label,
        d: due
      };
    }

    return {
      firstDay: firstDay,
      lastDay: lastDay,
      count: total,
      chips: chips,
      chipsTruncated: chipsTruncated,
      pending: pending
    };
  },

  /* Date+grade rows for one card, newest first. Walks the append-only
     cardReviews log from the end (gradeCard pushes newest last). Skips
     corrupt rows. Does not mutate reviews. */
  listCardReviews: function (reviews, cardId) {
    if (!cardId || !Array.isArray(reviews)) return [];
    var out = [];
    var i;
    for (i = reviews.length - 1; i >= 0; i--) {
      var r = reviews[i];
      if (!r || typeof r !== 'object') continue;
      if (r.id !== cardId) continue;
      if (!this._isDayStr(r.d)) continue;
      if (!this.isMemGrade(r.g)) continue;
      out.push({ d: r.d, g: r.g });
    }
    return out;
  }
};
