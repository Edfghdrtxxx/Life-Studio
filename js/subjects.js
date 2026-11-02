/* Subject registry (Life Studio phase 1 — LIFE-STUDIO-SPEC.md).
   The studio is one app of subjects; Physics is one of them and owns every
   card that already exists. Cards join a subject without ever changing id:
     cpgf-*, cpgl-*, supp-*          -> physics (existing deck ids)
     user-<tag>-<n>                  -> the subject whose `tag` matches
     a card's own `subject` field    -> wins when present (editor sets it)
   New subjects start empty; their cards come from chat drops or the in-app
   card editor (the Recall view's Cards tab, js/view-formulas.js). */
window.PGRE = window.PGRE || {};

PGRE.SUBJECTS = [
  { id: 'physics',  name: 'Physics',                    tag: 'physics', code: 'PH' },
  { id: 'english',  name: 'English usage and grammar',  tag: 'english', code: 'EN' },
  { id: 'vocab',    name: 'Vocabulary',                 tag: 'vocab',   code: 'VO' },
  { id: 'nuclear',  name: 'Nuclear physics',            tag: 'nuclear', code: 'NU' },
  { id: 'cs',       name: 'Basic Computer Science',     tag: 'cs',      code: 'CS' }
];

PGRE.subjectById = function (id) {
  var list = PGRE.SUBJECTS || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id || list[i].tag === id) return list[i];
  }
  return null;
};
PGRE.subjectName = function (id) {
  var s = PGRE.subjectById(id);
  return s ? s.name : (id || 'Physics');
};

/* Subject of a deck card. The card's own `subject` field wins (user cards
   carry it); otherwise the id decides: user-<tag>- is parsed against the
   registry tags, everything else the deck already ships is Physics. */
PGRE.cardSubject = function (card) {
  if (!card) return 'physics';
  if (card.subject && PGRE.subjectById(card.subject)) return PGRE.subjectById(card.subject).id;
  var m = String(card.id || '').match(/^user-([a-z]+)-/);
  if (m && PGRE.subjectById(m[1])) return PGRE.subjectById(m[1]).id;
  return 'physics';
};

/* Subject of a card id alone (no card object) — the rule the `subject` field
   and the cardSubject() id branch encode, so history-fold code can file a
   deleted card's reviews under its subject. Book ids and anything unknown
   fold to physics. */
PGRE.cardSubjectId = function (id) {
  var m = String(id || '').match(/^user-([a-z]+)-/);
  if (m && PGRE.subjectById(m[1])) return PGRE.subjectById(m[1]).id;
  return 'physics';
};

/* ——— Round-2 shared memory stats (design §5/§6): one computation behind the
   subject homes, the Recall progress tab, the Today tiles and the sidebar
   counts. Takes the deck (PGRE.formulaDeck()'s result) and returns
   { byId, total } where each entry is:
     cards          deck rows for the subject (active + suspended)
     studied        introduced at least once (st.reviews > 0)
     fresh          never graded and not suspended — the "new cards" pool
     due            due today or earlier, not yet reviewed today, not suspended
                    (round-2 queue: due reviews only; new cards are a choice)
     dueTomorrow    due exactly tomorrow (the streak-safe padding)
     oldestOverdue  whole days the most overdue due card is late (0 when none)
     todayNew       fresh-pool cards graded for the first time today
     held           interval >= srs.matureDays() — "held 3 weeks or more"
     medianIvl      median interval in whole days, 0 with no studied cards
     lifeAcc        correct rate over all reviews of the subject's cards
     acc30          correct rate over the trailing 30 days
     slip           cards at 8+ lapses (PGRE.srs.isLeech), slipping list
     hz             interval mix [never, <1wk, 1-3wk, 3wk-3mo, 3-12mo, >1yr]
     fc             next-7-days due forecast [tomorrow .. +7d]
   `total` is the same shape summed over the whole deck. A card's day counts
   are all "local calendar day" per srs.today(); suspended cards stay in
   `cards` and the interval mix but are never due/fresh. */
PGRE.subjectMemory = function (deck) {
  var srs = PGRE.srs, st = PGRE.store.state;
  var today = srs.today(), mature = (srs.matureDays ? srs.matureDays() : 21);
  var log = st.cardReviews || [];
  var empty = function () {
    return { cards: 0, studied: 0, fresh: 0, due: 0, dueTomorrow: 0,
             oldestOverdue: 0, todayNew: 0, held: 0, medianIvl: 0,
             lifeNum: 0, lifeDen: 0, accNum: 0, accDen: 0,
             slip: 0, slipList: [], hz: [0, 0, 0, 0, 0, 0], fc: [0, 0, 0, 0, 0, 0, 0] };
  };
  var byId = {}, total = empty();
  (PGRE.SUBJECTS || []).forEach(function (s) { byId[s.id] = empty(); });
  var ivls = {}, seen = {};
  (deck || []).forEach(function (c) {
    var sid = (PGRE.cardSubject ? PGRE.cardSubject(c) : 'physics');
    var e = byId[sid] || (byId[sid] = empty());
    seen[c.id] = sid;
    var stc = srs.cardState(c.id), susp = srs.isSuspended(c.id);
    e.cards++; total.cards++;
    var studied = !!(stc && stc.reviews > 0);
    if (studied) { e.studied++; total.studied++; }
    if (!stc && !susp) { e.fresh++; total.fresh++; }
    // interval mix: fresh cards own bucket 0; suspended keep their interval.
    var ivl = studied ? (stc.interval || 0) : 0;
    var b = !studied ? 0 : ivl < 7 ? 1 : ivl < 21 ? 2 : ivl < 90 ? 3 : ivl < 365 ? 4 : 5;
    e.hz[b]++; total.hz[b]++;
    if (ivl >= mature) { e.held++; total.held++; }
    if (studied) (ivls[sid] || (ivls[sid] = [])).push(ivl);
    if (studied && !susp && stc.due) {
      var d = srs.daysUntil(stc.due);
      if (!srs.studiedToday(stc)) {
        if (d <= 0) {
          e.due++; total.due++;
          if (-d > e.oldestOverdue) e.oldestOverdue = -d;
          if (-d > total.oldestOverdue) total.oldestOverdue = -d;
        } else if (d === 1) { e.dueTomorrow++; total.dueTomorrow++; }
      }
      if (d >= 1 && d <= 7) { e.fc[d - 1]++; total.fc[d - 1]++; }
    }
    if (stc && srs.studiedToday(stc) && stc.reviews === 1 && !susp) {
      e.todayNew++; total.todayNew++;
    }
  });
  var t30 = srs.addDays(-30);
  log.forEach(function (r) {
    if (r.n !== 1) return;              // real reviews only
    var sid = seen[r.id];
    if (!sid) return;            // deleted cards fold only into reviewMonths
    var e = byId[sid];
    var ok = r.g !== 'again';
    e.lifeDen++; total.lifeDen++;
    if (ok) { e.lifeNum++; total.lifeNum++; }
    if (r.d > t30 && r.d <= today) {
      e.accDen++; total.accDen++;
      if (ok) { e.accNum++; total.accNum++; }
    }
  });
  function pct(num, den) { return den ? Math.round(100 * num / den) : null; }
  function median(a) {
    if (!a || !a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
  }
  var allIvls = [];
  Object.keys(byId).forEach(function (sid) {
    var e = byId[sid], list = ivls[sid] || [];
    e.medianIvl = median(list);
    e.lifeAcc = pct(e.lifeNum, e.lifeDen);
    e.acc30 = pct(e.accNum, e.accDen);
    allIvls = allIvls.concat(list);
  });
  // leech count needs the card states once more (isLeech reads lapses).
  (deck || []).forEach(function (c) {
    var stc = PGRE.srs.cardState(c.id);
    if (!PGRE.srs.isLeech || !PGRE.srs.isLeech(stc)) return;
    var sid = seen[c.id] || 'physics';
    byId[sid].slip++; total.slip++;
    byId[sid].slipList.push(c.id);
    total.slipList.push(c.id);
  });
  total.medianIvl = median(allIvls);
  total.lifeAcc = pct(total.lifeNum, total.lifeDen);
  total.acc30 = pct(total.accNum, total.accDen);
  return { byId: byId, total: total };
};
