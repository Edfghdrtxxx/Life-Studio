#!/usr/bin/env node
/* Parked-session parking: the mistake-drill snapshot + #/mistakes/drill hash,
   the practice snapshot corrections (stage restore, all-answered kept, zip by
   qid), and the top-bar "N unfinished" drawer. Bank-free — PGRE.questionById
   resolves fixture questions. Run: node tools/test-session-park.js */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.resolve(__dirname, '..');

var passed = 0;
var failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log('  ok  — ' + msg);
  } else {
    failed++;
    console.log('  FAIL — ' + msg);
  }
}

var disk = {};
var sessionDisk = {};

function storageFor(map) {
  return {
    getItem: function (k) {
      return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null;
    },
    setItem: function (k, v) { map[k] = String(v); },
    removeItem: function (k) { delete map[k]; }
  };
}

var localStorage = storageFor(disk);
var sessionStorage = storageFor(sessionDisk);

/* Minimal element: innerHTML sink, no-op listeners, recordable click wiring. */
function fakeEl(id) {
  var el = {
    id: id || '',
    innerHTML: '',
    textContent: '',
    hidden: false,
    disabled: false,
    listeners: {},
    parentNode: { removeChild: function () {} },
    appendChild: function () {},
    setAttribute: function () {},
    getAttribute: function () { return null; },
    addEventListener: function (ev, fn) { el.listeners[ev] = fn; },
    removeEventListener: function () {},
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    closest: function () { return null; },
    contains: function () { return false; },
    focus: function () {},
    click: function () { if (el.listeners.click) el.listeners.click({ target: el }); }
  };
  return el;
}

var docEls = {};
function elFor(id) {
  if (!docEls[id]) docEls[id] = fakeEl(id);
  return docEls[id];
}

var docClickHandlers = [];
var docKeyHandlers = [];

var locationStub = { href: 'file:///tmp/index.html', hash: '#/' };

var sandbox = {
  console: console,
  Date: Date,
  JSON: JSON,
  Math: Math,
  Object: Object,
  Array: Array,
  String: String,
  Number: Number,
  parseInt: parseInt,
  parseFloat: parseFloat,
  isFinite: isFinite,
  isNaN: isNaN,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  location: locationStub
};
sandbox.window = sandbox;
sandbox.document = {
  addEventListener: function (ev, fn) {
    if (ev === 'click') docClickHandlers.push(fn);
    if (ev === 'keydown') docKeyHandlers.push(fn);
  },
  getElementById: function (id) { return elFor(id); },
  querySelector: function () { return null; },
  querySelectorAll: function () { return []; },
  activeElement: null
};
sandbox.localStorage = localStorage;
sandbox.sessionStorage = sessionStorage;
sandbox.addEventListener = function () {};
sandbox.scrollTo = function () {};
sandbox.requestAnimationFrame = function (fn) { return 0; };
sandbox.PGRE = {};
vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(path.join(root, 'js', 'store.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'gamify.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'session-park.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'view-practice.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'view-mistakes.js'), 'utf8'), sandbox);

var PGRE = sandbox.PGRE;
var mistakes = PGRE.views.mistakes;
var practice = PGRE.views.practice;
var park = PGRE.sessionPark;

/* ——— Fixture bank + PGRE stubs ——— */
var BANK = {};
function mkQ(id, answer) {
  BANK[id] = { id: id, topic: 'mech', answer: answer == null ? 1 : answer,
               q: '<p>q ' + id + '</p>',
               choices: ['a', 'b', 'c', 'd', 'e'], sol: '<p>sol ' + id + '</p>' };
}
['m1', 'm2', 'm3', 'p1', 'p2', 'p3'].forEach(function (id, n) { mkQ(id, n % 5); });

PGRE.questionById = function (id) { return BANK[id] || null; };
PGRE.questionsForTopic = function () { return Object.keys(BANK).map(function (k) { return BANK[k]; }); };
PGRE.topicById = function () { return { id: 'mech', short: 'ME', name: 'Mechanics' }; };
PGRE.TOPICS = [];
PGRE.toast = function () {};
PGRE.persistWarning = function () {};
PGRE.typesetMath = function () {};
PGRE.refreshNavBadges = function () {};
PGRE.route = function () {};
var hydratedFlags = null;
PGRE.assess = {
  bind: function () {
    return {
      toggle: function () {},
      hydrate: function (flags) { hydratedFlags = JSON.parse(JSON.stringify(flags)); }
    };
  },
  html: function () { return ''; },
  stuckButtonAttrs: function () { return ''; },
  stuckConfirmHTML: function () { return ''; },
  bindStuckConfirm: function () { return function () {}; },
  LABELS: {}
};
PGRE.notes = { isBookmarked: function () { return false; }, get: function () { return ''; },
               set: function () {}, toggleBookmark: function () { return false; } };
PGRE.ui = {
  esc: function (s) { return String(s == null ? '' : s); },
  meter: function () { return ''; },
  diffDots: function () { return ''; },
  bindChoiceCommit: function () {
    return { select: function () {}, commit: function () {}, selected: function () { return null; } };
  }
};
PGRE.nav = { setTrail: function () {} };
PGRE.srs = {
  today: function () { return '2026-10-01'; },
  dayStr: function (d) { return '2026-10-01'; },
  openMistakes: function () { return []; },
  dueMistakes: function () { return []; },
  archivedMistakes: function () { return []; },
  filterByTopic: function (l) { return l; },
  filterByConcern: function (l) { return l; },
  mistakeMissed: function () {},
  mistakeSolved: function () {},
  clearLucky: function () {},
  daysUntil: function () { return 0; },
  ivlLabel: function () { return 'today'; },
  MISTAKE_LADDER: [1, 3, 7]
};
PGRE.examEngine = {
  active: function () {
    var arr = (PGRE.store.state && PGRE.store.state.exams) || [];
    for (var i = arr.length - 1; i >= 0; i--) if (!arr[i].submittedAt) return arr[i];
    return null;
  }
};
// keep the achievement/challenge churn out of the drill path; session rows,
// revert and the attempt log are the real engine under test
PGRE.gamify.checkChallenges = function () {};
PGRE.gamify.checkAchievements = function () {};

PGRE.store.load();

function snap(key) {
  var raw = sessionStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}
function put(key, obj) {
  sessionStorage.setItem(key, JSON.stringify(obj));
}
function choiceAttrs(html, idx) {
  var re = new RegExp('<button class="([^"]*)" data-idx="' + idx + '" aria-pressed="(true|false)">');
  var m = String(html).match(re);
  return m ? { cls: m[1], pressed: m[2] } : null;
}
function hidesAnswerKey(html) {
  return !/<button class="choice[^"]*\bis-answer/.test(html) &&
    !/<button class="choice[^"]*\bis-wrong/.test(html) &&
    !/aria-pressed="true"/.test(html) &&
    !/feedback-good|feedback-bad/.test(html);
}
function lastAttempt() {
  var a = PGRE.store.state.attempts;
  return a.length ? a[a.length - 1] : null;
}
function sessionRow(sid) {
  return PGRE.store.state.sessions.filter(function (s) { return s.id === sid; })[0] || null;
}

/* ================= Mistake drill ================= */

console.log('mistake drill parks a snapshot and resumes without re-recording');

mistakes.mount({ sub: null });                        // book
mistakes._test.startDrill([BANK.m1, BANK.m2, BANK.m3]);
var d1 = mistakes._test.drill;
assert(d1 && d1.qs.length === 3, 'drill started with 3 questions');
assert(snap(park.DRILL_KEY) && snap(park.DRILL_KEY).ids.length === 3,
  'snapshot written to sessionStorage');

var id0 = d1.qs[0].id;
var pick0 = (BANK[id0].answer + 1) % 5;               // a wrong pick
mistakes._test.drillAnswer(pick0);
assert(d1.st[0] && d1.st[0].correct === false, 'answer recorded in live drill');
var attemptsBefore = PGRE.store.state.attempts.length;
var sid1 = d1.sid;

// navigate away and back — mount paints the book, then the drill route resumes
mistakes.mount({ sub: null });
assert(mistakes._test.drill === d1, 'renderBook keeps the parked drill alive (no drill = null)');
mistakes.mount({ sub: 'drill' });
assert(mistakes._test.drill === d1, 'same-tab resume keeps the live drill object');
assert(mistakes._test.drill.st[0].row === lastAttempt(),
  'live result still references the real attempt row');

// simulate a reload: drop the live drill, rebuild from the snapshot only
mistakes._test.dropLive();
mistakes.mount({ sub: 'drill' });
var d2 = mistakes._test.drill;
assert(d2 && d2 !== d1, 'reload rebuilt the drill from the snapshot');
assert(d2.st[0] && d2.st[0].picked === pick0 && d2.st[0].correct === false,
  'stored result repainted (picked + verdict restored)');
assert(d2.st[0].row === lastAttempt(), 'restored result found its real attempt row');
assert(PGRE.store.state.attempts.length === attemptsBefore,
  'resume did not call recordAnswer (no extra attempt row)');

console.log('\nrestored answers can only re-answer while their row is locatable');

// re-answering with the row present reverts exactly that answer and records once
var attemptsPre = PGRE.store.state.attempts.length;
mistakes._test.drillAnswer(BANK[id0].answer);         // new pick: correct this time
assert(PGRE.store.state.attempts.length === attemptsPre, 're-answer replaced, not appended');
assert(mistakes._test.drill.st[0].correct === true, 'replaced answer is the new one');
assert(PGRE.store.state.attempts.some(function (a) { return a.sid === sid1 && a.qid === id0 && a.correct; }),
  'the live attempt row is the replacement');

// a snapshot whose row is gone locks the answer instead of double-counting
var lockedSnap = snap(park.DRILL_KEY);
lockedSnap.sid = 's-ghost';
put(park.DRILL_KEY, lockedSnap);
mistakes._test.dropLive();
mistakes.mount({ sub: 'drill' });
var d3 = mistakes._test.drill;
assert(d3 && d3.st[0] && d3.st[0].row === null, 'ghost sid: no attempt row found');
var attemptsGhost = PGRE.store.state.attempts.length;
mistakes._test.drillAnswer((pick0 + 1) % 5);          // a DIFFERENT pick on the locked cell
assert(PGRE.store.state.attempts.length === attemptsGhost,
  'locked result cannot be replaced — nothing re-recorded');

console.log('\nskip leaves the skipped id out of the stored queue');

var waitUntil = Date.now() + 310;                     // skip guards on the render clock
while (Date.now() < waitUntil) { /* let the 300 ms settle window pass */ }
mistakes._test.drill.i = 1;                          // park the cursor on an unanswered cell
var skipId = mistakes._test.drill.qs[1].id;
mistakes._test.skipCurrent();
var snap2 = snap(park.DRILL_KEY);
assert(snap2.skipped === 1, 'skipped count recorded');
assert(snap2.ids.length === 2 && snap2.ids.indexOf(skipId) === -1,
  'the stored queue is the queue still in play — skipped id is out');

console.log('\nhash split: the book parks, the drill route owns the drill');

locationStub.hash = '#/mistakes';
mistakes.mount({ sub: null });
assert(/parked-drill-card/.test(elFor('mistakes-root').innerHTML),
  'book shows Resume/Discard banner while a drill is parked');
locationStub.hash = '#/mistakes/drill';
mistakes._test.dropLive();
mistakes.mount({ sub: 'drill' });                     // stale route, snapshot present → rebuild path
assert(mistakes._test.drill !== null, 'drill route rebuilds from a live snapshot');

console.log('\ndiscard closes only the session it owns');

// a real owned sid: re-attach the drill's own session id to the snapshot
var ownSnap = snap(park.DRILL_KEY);
ownSnap.sid = sid1;
put(park.DRILL_KEY, ownSnap);
mistakes._test.dropLive();
var openBefore = PGRE.store.state.sessions.filter(function (s) { return !s.endedAt; })
  .map(function (s) { return s.id; });
mistakes._test.discardParkedDrill();
assert(snap(park.DRILL_KEY) === null, 'discard deletes the snapshot');
assert(sessionRow(sid1) && sessionRow(sid1).endedAt, 'discard ended the owned sid');
assert(PGRE.store.state.sessions.filter(function (s) { return !s.endedAt; }).length ===
    openBefore.length - 1,
  'no other open session row was closed');

console.log('\n#/mistakes/drill with no snapshot does not invent a drill');

locationStub.hash = '#/mistakes/drill';
mistakes._test.dropLive();
mistakes.mount({ sub: 'drill' });
assert(mistakes._test.drill === null && locationStub.hash === '#/mistakes',
  'empty drill route falls back to the book');

console.log('\na finished drill is not painted as parked on the book');

locationStub.hash = '#/';
mistakes._test.startDrill([BANK.m1, BANK.m2, BANK.m3]);
mistakes.mount({ sub: 'drill' });                     // paints the question, binds #drill-finish
assert(mistakes._test.drill && !mistakes._test.drill.done,
  'fresh drill is in flight');
mistakes._test.drillAnswer((BANK[mistakes._test.drill.qs[0].id].answer + 1) % 5);
var finishBtn = elFor('drill-finish');
assert(typeof finishBtn.listeners.click === 'function', 'Finish drill button is wired');
finishBtn.listeners.click({ target: finishBtn, detail: 0 });   // keyboard detail bypasses the settle guard
assert(mistakes._test.drill.done === true, 'finish put the summary up');
assert(snap(park.DRILL_KEY) === null, 'summary cleared the parked snapshot');
locationStub.hash = '#/mistakes';
mistakes.mount({ sub: null });                        // back to the book with the dead drill still live
assert(!/parked-drill-card/.test(elFor('mistakes-root').innerHTML),
  'finished drill does not offer Resume/Discard on the book');
mistakes.mount({ sub: 'drill' });                     // the stale route reopens the summary, not a question
assert(/Drill complete/.test(elFor('mistakes-root').innerHTML),
  'stale drill route repaints the completion screen');
mistakes._test.dropLive();

console.log('\na resumed answered question shows the saved choice and verdict');

locationStub.hash = '#/';
mistakes._test.startDrill([BANK.m1, BANK.m2, BANK.m3]);
var resumeDrill = mistakes._test.drill;
var qWrong = resumeDrill.qs[0];
var qRight = resumeDrill.qs[1];
var qOpen = resumeDrill.qs[2];
var wrongPick = (qWrong.answer + 1) % 5;
var rightPick = qRight.answer;
mistakes.mount({ sub: 'drill' });
var openHtml = elFor('mistakes-root').innerHTML;
assert(hidesAnswerKey(openHtml) && openHtml.indexOf(qWrong.sol) === -1,
  'a fresh unanswered question still hides the key');
var attemptsBeforeResume = PGRE.store.state.attempts.length;
mistakes._test.drillAnswer(wrongPick);
resumeDrill.i = 1;
mistakes._test.drillAnswer(rightPick);
var attemptsAfterAnswers = PGRE.store.state.attempts.length;
assert(attemptsAfterAnswers === attemptsBeforeResume + 2, 'the two drill answers were recorded once');
var attemptsFrozen = JSON.stringify(PGRE.store.state.attempts);
var mistakesFrozen = JSON.stringify(PGRE.store.state.mistakes);
var sessionsFrozen = JSON.stringify(PGRE.store.state.sessions);
mistakes._test.dropLive();
mistakes.mount({ sub: 'drill' });
var resumed = mistakes._test.drill;
assert(resumed && resumed.i === 1 && resumed.st[1].picked === rightPick && resumed.st[1].correct === true,
  'reload restored the saved cursor, choice, and verdict');
var rightHtml = elFor('mistakes-root').innerHTML;
var rightChoice = choiceAttrs(rightHtml, rightPick);
assert(rightChoice && rightChoice.pressed === 'true' && /is-answer/.test(rightChoice.cls),
  'resumed correct question shows the saved choice');
assert(/feedback-good/.test(rightHtml) && /<strong>Correct/.test(rightHtml),
  'resumed correct question shows the correct verdict');
assert(rightHtml.indexOf(qRight.sol) !== -1, 'resumed question reuses the stored solution');
assert(!/blank again|hidden for recall|View saved answer|Leave and come back/.test(rightHtml),
  'resume adds no recall explanation and no extra button');
assert(PGRE.store.state.attempts.length === attemptsAfterAnswers,
  'painting the saved answer did not record another attempt');

resumed.i = 0;
mistakes.mount({ sub: 'drill' });
var wrongHtml = elFor('mistakes-root').innerHTML;
var wrongChoice = choiceAttrs(wrongHtml, wrongPick);
var keyChoice = choiceAttrs(wrongHtml, qWrong.answer);
assert(wrongChoice && wrongChoice.pressed === 'true' && /is-wrong/.test(wrongChoice.cls),
  'revisited missed question shows the saved choice');
assert(keyChoice && /is-answer/.test(keyChoice.cls) && keyChoice.pressed === 'false',
  'revisited miss still marks the right choice without pressing it');
assert(/feedback-bad/.test(wrongHtml) && /Incorrect —/.test(wrongHtml),
  'revisited missed question shows the missed verdict');

resumed.i = 2;
mistakes.mount({ sub: 'drill' });
var unansweredHtml = elFor('mistakes-root').innerHTML;
assert(hidesAnswerKey(unansweredHtml) && unansweredHtml.indexOf(qOpen.sol) === -1,
  'an unanswered question in the resumed drill still hides the key');
assert(JSON.stringify(PGRE.store.state.attempts) === attemptsFrozen, 'resume paints left the attempt log unchanged');
assert(JSON.stringify(PGRE.store.state.mistakes) === mistakesFrozen, 'resume paints left mistake schedules unchanged');
assert(JSON.stringify(PGRE.store.state.sessions) === sessionsFrozen, 'resume paints left session rows unchanged');
mistakes._test.dropLive();

console.log('\nhistory archive reconstructs a past drill without touching the live one');

PGRE.store.state.sessions.push({
  id: 's-hist-old', mode: 'mistakes', topicId: 'mistakes',
  startedAt: '2026-09-01T12:00:00.000Z', endedAt: '2026-09-01T12:20:00.000Z',
  planned: 2, answered: 2, correct: 1, xp: 12
});
PGRE.store.state.attempts.push(
  { ts: '2026-09-01T12:01:00.000Z', qid: 'm1', topic: 'mech', picked: 0, answer: 1,
    correct: false, ms: 4000, sid: 's-hist-old', mode: 'mistakes',
    confidence: 'guess', tags: ['slow'] },
  { ts: '2026-09-01T12:02:00.000Z', qid: 'gone-q', topic: 'mech', picked: 2, answer: 3,
    correct: false, ms: 5000, sid: 's-hist-old', mode: 'mistakes' }
);
var recon = mistakes._test.reconstructArchive('s-hist-old');
assert(recon && recon.readonly && recon.qs.length === 2, 'archive reconstructs two stored questions');
assert(recon.qs[1].missing && /no longer in the bank/.test(recon.qs[1].q),
  'a question missing from the bank becomes a stub');
assert(recon.st[0].picked === 0 && recon.st[0].row.confidence === 'guess',
  'stored pick and self-assessment stay on the attempt row');
assert(mistakes._test.reconstructArchive('no-such-sid') === null, 'unknown sid is not a drill');
PGRE.store.state.sessions.push({
  id: 's-prac-hist', mode: 'practice', topicId: 'all',
  startedAt: '2026-09-02T12:00:00.000Z', endedAt: '2026-09-02T12:10:00.000Z',
  planned: 1, answered: 1, correct: 1, xp: 15
});
assert(mistakes._test.reconstructArchive('s-prac-hist') === null,
  'a practice session is not opened as a mistake-drill archive');

mistakes._test.startDrill([BANK.m2]);
var liveObj = mistakes._test.drill;
var parkedBefore = JSON.stringify(snap(park.DRILL_KEY));
var attemptsN = PGRE.store.state.attempts.length;
var xpN = PGRE.store.state.xp;
var saveN = 0;
var realSave = PGRE.store.save;
PGRE.store.save = function () { saveN++; return realSave.apply(this, arguments); };
mistakes.mount({ sub: 'drill', sub2: 's-hist-old' });
assert(mistakes._test.drill === liveObj, 'opening a past drill leaves the live drill object');
assert(mistakes._test.archive && mistakes._test.archive.sid === 's-hist-old',
  'the archive object is the reconstructed drill');
assert(JSON.stringify(snap(park.DRILL_KEY)) === parkedBefore, 'opening a past drill leaves the parked snapshot');
assert(PGRE.store.state.attempts.length === attemptsN, 'archive does not record answers');
assert(PGRE.store.state.xp === xpN, 'archive does not change XP');
assert(saveN === 0, 'archive does not call store.save');
assert(/How this drill went/.test(elFor('mistakes-root').innerHTML),
  'archive paints the results palette');
assert(/Back to History/.test(elFor('mistakes-root').innerHTML),
  'archive offers a way back to History');
assert(!/id="assess-row"/.test(elFor('mistakes-root').innerHTML),
  'archive results do not mount grading chips');
PGRE.store.save = realSave;
mistakes._test.dropLive();
sessionStorage.removeItem(park.DRILL_KEY);

console.log('\nhistory archive reconstructs a past practice set without touching the parked one');

PGRE.store.state.sessions.push({
  id: 's-hist-prac', mode: 'practice', topicId: 'all',
  startedAt: '2026-09-03T12:00:00.000Z', endedAt: '2026-09-03T12:15:00.000Z',
  planned: 2, answered: 2, correct: 1, xp: 17
});
PGRE.store.state.attempts.push(
  { ts: '2026-09-03T12:01:00.000Z', qid: 'p1', topic: 'mech', picked: 1, answer: 1,
    correct: true, ms: 2800, sid: 's-hist-prac', mode: 'practice', confidence: 'sure' },
  { ts: '2026-09-03T12:02:00.000Z', qid: 'gone-prac', topic: 'mech', picked: 2, answer: 0,
    correct: false, ms: 5100, sid: 's-hist-prac', mode: 'practice', tags: ['forgot'] }
);
var pracRecon = practice._test.reconstructArchive('s-hist-prac');
assert(pracRecon && pracRecon.readonly && pracRecon.qs.length === 2,
  'practice archive reconstructs two stored questions');
assert(pracRecon.qs[1].missing && /no longer in the bank/.test(pracRecon.qs[1].q),
  'a missing practice question becomes a stub');
assert(practice._test.reconstructArchive('s-hist-old') === null,
  'a mistake drill is not opened as a practice archive');
put(park.PRACTICE_KEY, {
  topicId: 'all', filter: null, label: null, custom: false, learnDrill: false,
  sid: 's-live-prac', stage: 'question',
  ids: ['p2'], i: 0, correct: 0, xpEarned: 0, answers: [null], savedAt: Date.now()
});
var parkedPrac = JSON.stringify(snap(park.PRACTICE_KEY));
var pracSaveN = 0;
var pracRealSave = PGRE.store.save;
PGRE.store.save = function () { pracSaveN++; return pracRealSave.apply(this, arguments); };
practice.mount({ id: 'session', sub2: 's-hist-prac' });
assert(practice._test.archive && practice._test.archive.sid === 's-hist-prac',
  'the practice archive object is the reconstructed set');
assert(JSON.stringify(snap(park.PRACTICE_KEY)) === parkedPrac,
  'opening a past practice set leaves the parked snapshot');
assert(pracSaveN === 0, 'practice archive does not call store.save');
assert(/How this set went/.test(elFor('practice-root').innerHTML),
  'practice archive paints How this set went');
assert(/Back to History/.test(elFor('practice-root').innerHTML),
  'practice archive offers a way back to History');
assert(!/id="assess-row"/.test(elFor('practice-root').innerHTML),
  'practice archive results do not mount grading chips');
PGRE.store.save = pracRealSave;
sessionStorage.removeItem(park.PRACTICE_KEY);

/* ================= Practice corrections ================= */

console.log('\npractice: a feedback-stage snapshot restores the read solution');

var fbSnap = {
  topicId: 'all', filter: null, label: null, custom: false, learnDrill: false,
  sid: 's-p1', stage: 'feedback',
  ids: ['p1', 'p2', 'p3'],
  i: 0, correct: 1, xpEarned: 15,
  answers: [{ qid: 'p1', picked: 1, correct: true, xp: 15, ms: 9000 }],
  savedAt: Date.now()
};
put(park.PRACTICE_KEY, fbSnap);
practice.mount({ id: 'all', sub2: null });
assert(/You left a set part-way/.test(elFor('practice-root').innerHTML),
  'plain mount still offers the resume card');
sessionStorage.setItem(park.RESUME_KEY, '1');
practice.mount({ id: 'all', sub2: null });
assert(/Incorrect|Correct/.test(elFor('practice-root').innerHTML) &&
       /Solution/.test(elFor('practice-root').innerHTML),
  'armed resume opens on the stored feedback, not a blank question');
assert(sessionStorage.getItem(park.RESUME_KEY) === null, 'resume flag is one-shot');

console.log('\npractice: an all-answered snapshot survives until the summary');

var sidP2 = PGRE.gamify.beginSession('all', 'practice', 2);
var doneSnap = {
  topicId: 'all', filter: null, label: null, custom: false, learnDrill: false,
  sid: sidP2, stage: 'question',
  ids: ['p1', 'p2'],
  i: 1, correct: 2, xpEarned: 25,
  answers: [{ qid: 'p1', picked: 1, correct: true, xp: 15, ms: 8000 },
            { qid: 'p2', picked: 2, correct: true, xp: 10, ms: 9000 }],
  savedAt: Date.now()
};
put(park.PRACTICE_KEY, doneSnap);
sessionStorage.setItem(park.RESUME_KEY, '1');
practice.mount({ id: 'all', sub2: null });
assert(/Session complete/.test(elFor('practice-root').innerHTML),
  'all-answered snapshot lands on the summary (endSession + tick run there)');
assert(sessionStorage.getItem(park.PRACTICE_KEY) === null,
  'summary cleared the parked snapshot');
assert(sessionRow(sidP2) && sessionRow(sidP2).endedAt, 'resume closed the session row');

console.log('\npractice: a missing bank id realigns answers and cursor by qid');

var holeSnap = {
  topicId: 'all', filter: null, label: null, custom: false, learnDrill: false,
  sid: 's-p3', stage: 'question',
  ids: ['p1', 'gone', 'p3'],
  i: 2, correct: 1, xpEarned: 15,
  answers: [{ qid: 'p1', picked: 1, correct: true, xp: 15, ms: 8000 },
            null,
            null],
  savedAt: Date.now()
};
put(park.PRACTICE_KEY, holeSnap);
sessionStorage.setItem(park.RESUME_KEY, '1');
practice.mount({ id: 'all', sub2: null });
var live = snap(park.PRACTICE_KEY);
assert(live && live.ids.join(',') === 'p1,p3', 'dropped id left the queue');
assert(live.i === 1 && live.ids[live.i] === 'p3', 'cursor realigned to the same question id');
assert(live.answers[0] && live.answers[0].qid === 'p1' && live.answers[1] === null,
  'answers stayed zipped to their question');

console.log('\npractice: a resumed answer paints the chips on the stored attempt');

var dueBefore = '2026-10-04';
var baseBefore = '2026-10-05';
PGRE.store.state.mistakes.p1 = {
  firstMissedAt: '2026-10-01T00:00:00.000Z', misses: 1, solves: 1,
  wrongPicks: [], archivedAt: '2026-10-01T00:00:00.000Z',
  lastTouchedAt: '2026-10-02T00:00:00.000Z',
  srs: { step: 1, due: dueBefore, baseDue: baseBefore }
};
PGRE.store.state.attempts.push({
  ts: '2026-10-02T00:00:00.000Z', qid: 'p1', topic: 'mech',
  picked: 1, answer: 1, correct: true, ms: 9000,
  sid: 's-chip', mode: 'practice', confidence: 'guess', tags: ['slow']
});
var attemptsBefore = PGRE.store.state.attempts.length;
var xpBefore = PGRE.store.state.xp;
var chipSnap = {
  topicId: 'all', filter: null, label: null, custom: false, learnDrill: false,
  sid: 's-chip', stage: 'feedback',
  ids: ['p1'],
  i: 0, correct: 1, xpEarned: 15,
  answers: [{ qid: 'p1', picked: 1, correct: true, xp: 15, ms: 9000,
              assess: { sure: false, guess: false, slow: false, forgot: false, stuck: false } }],
  savedAt: Date.now()
};
put(park.PRACTICE_KEY, chipSnap);
hydratedFlags = null;
var resumeSaves = 0;
var origSave = PGRE.store.save;
PGRE.store.save = function () { resumeSaves++; return origSave.apply(PGRE.store, arguments); };
sessionStorage.setItem(park.RESUME_KEY, '1');
practice.mount({ id: 'all', sub2: null });
PGRE.store.save = origSave;
assert(hydratedFlags && hydratedFlags.guess === true && hydratedFlags.slow === true &&
       hydratedFlags.sure === false && hydratedFlags.forgot === false,
  'resume paints Guessed and Too slow from the attempt, not the all-false snapshot');
assert(resumeSaves === 0, 'resume does not write the store');
assert(PGRE.store.state.mistakes.p1.srs.due === dueBefore &&
       PGRE.store.state.mistakes.p1.srs.baseDue === baseBefore,
  'resume leaves the stored review date on its base');
assert(PGRE.store.state.attempts.length === attemptsBefore && PGRE.store.state.xp === xpBefore,
  'resume adds no attempt and no XP');

var fbEl = elFor('feedback');
fbEl.querySelectorAll = function (sel) {
  if (sel !== '[data-assess]') return [];
  return [{
    getAttribute: function (name) {
      if (name === 'data-assess') return 'guess';
      if (name === 'aria-pressed') return 'true';
      return null;
    }
  }];
};
docKeyHandlers.forEach(function (fn) {
  fn({ key: 'g', preventDefault: function () {}, target: {} });
});
var parked = snap(park.PRACTICE_KEY);
assert(parked && parked.answers[0] && parked.answers[0].assess &&
       parked.answers[0].assess.guess === true,
  'a chip tap saves the practice snapshot with Guessed on');
assert(PGRE.store.state.mistakes.p1.srs.due === dueBefore,
  'the snapshot save does not move the review date');
fbEl.querySelectorAll = function () { return []; };

/* ================= Top-bar drawer ================= */

console.log('\nthe drawer lists only real parked slots and opens from the count');

// the wrapper elements the module binds on
var wrap = elFor('session-park'), btn = elFor('parked-btn'), panel = elFor('parked-panel');
wrap.hidden = false; panel.hidden = true;

function parkedNow() { return park.collect(); }

// clear every slot
sessionStorage.removeItem(park.PRACTICE_KEY);
sessionStorage.removeItem(park.DRILL_KEY);
PGRE.store.state.formulaStudy = null;
PGRE.store.state.exams = [];

var savesBefore = (function () {
  var n = 0, orig = PGRE.store.save;
  PGRE.store.save = function () { n++; return orig.apply(PGRE.store, arguments); };
  park.paint();
  var calls = n;
  PGRE.store.save = orig;
  return calls;
})();
assert(savesBefore === 0, 'painting the drawer never writes the store');
assert(wrap.hidden === true, 'button hidden when nothing is parked');

put(park.DRILL_KEY, { ids: ['m1', 'm2'], i: 1, skipped: 1, sid: 's-d',
                      results: [{ qid: 'm1', picked: 0, correct: true, xp: 10, ms: 1 }] });
put(park.PRACTICE_KEY, fbSnap);
PGRE.store.state.formulaStudy = { id: 'fs1', date: '2026-10-01', queueIds: ['f1', 'f2'], dayBound: true };
PGRE.store.state.exams = [{ id: 'ex-1', submittedAt: null, order: [1, 2, 3], answers: { a: 1 },
                            paused: false }];
// a stale (yesterday) Recall queue must not list
var staleBands = (function () {
  PGRE.store.state.formulaStudy.date = '2026-09-30';
  var b = parkedNow();
  PGRE.store.state.formulaStudy.date = '2026-10-01';
  return b;
})();
assert(staleBands.length === 3, 'yesterday’s Recall queue stays off the list');

var bands = parkedNow();
assert(bands.length === 4, 'four real slots list four bands');
assert(bands[0].kind === 'mistakes' && /1 of 2/.test(bands[0].detail),
  'mistake band names kind and place');
assert(bands[1].kind === 'practice' && bands[1].hash === '#/practice/all',
  'practice band points at its topic route');
assert(bands[2].kind === 'formulas' && bands[2].detail === '2 cards left',
  'Recall band counts the saved queue');
assert(bands[3].kind === 'exam' && bands[3].hash === '#/exam/run',
  'mock band opens the exam room directly (same route as Resume exam)');

park.paint();
assert(wrap.hidden === false && btn.textContent === '4 unfinished',
  'count button shows the parked total');
assert(btn.listeners.click, 'count button is wired');
btn.listeners.click({ target: btn });
assert(panel.hidden === false, 'click rolls the drawer down');
assert(/Mistake drill/.test(panel.innerHTML) && /Mock exam/.test(panel.innerHTML),
  'the drawer lists the bands');

// outside click + Escape close it
docClickHandlers.forEach(function (fn) { fn({ target: { closest: function () { return null; } } }); });
assert(panel.hidden === true, 'outside click closes the drawer');
btn.listeners.click({ target: btn });
docKeyHandlers.forEach(function (fn) { fn({ key: 'Escape' }); });
assert(panel.hidden === true && btn.getAttribute && true, 'Escape closes the drawer');

// clicking a band resumes that session
btn.listeners.click({ target: btn });
var bandBtns = panel.listeners && true;
var clicked = panel.listeners.click;
assert(typeof clicked === 'function', 'panel has a delegated band handler');
var bandTarget = { closest: function (sel) {
  return sel === '.parked-band' ? { getAttribute: function () { return 'mistakes'; } } : null;
} };
panel.contains = function () { return true; };
clicked({ target: bandTarget });
assert(locationStub.hash === '#/mistakes/drill', 'mistake band resumes on the drill route');
assert(panel.hidden === true, 'drawer closes after choosing a band');

btn.listeners.click({ target: btn });
clicked({ target: { closest: function (sel) {
  return sel === '.parked-band' ? { getAttribute: function () { return 'practice'; } } : null;
} } });
assert(sessionStorage.getItem(park.RESUME_KEY) === '1', 'practice band arms the one-shot resume');
assert(locationStub.hash === '#/practice/all', 'practice band navigates to its route');
clicked({ target: { closest: function (sel) {
  return sel === '.parked-band' ? { getAttribute: function () { return 'exam'; } } : null;
} } });
assert(locationStub.hash === '#/exam/run', 'exam band opens the room directly');

console.log('\nIgnore takes a session off the drawer and keeps its progress');

// the rendered band carries Continue, the caret, and the Ignore item
btn.listeners.click({ target: btn });
assert(/data-park-act="continue"/.test(panel.innerHTML) &&
       /data-park-act="menu"/.test(panel.innerHTML) &&
       /data-park-act="ignore"/.test(panel.innerHTML),
  'each band renders Continue, the caret, and Ignore');

function actTarget(kind, act) {
  return { closest: function (sel) {
    if (sel === '.parked-band') return { getAttribute: function () { return kind; } };
    if (sel === '[data-park-act]') return { getAttribute: function () { return act; } };
    return null;
  } };
}
var drillBefore = sessionStorage.getItem(park.DRILL_KEY);
var hashBefore = locationStub.hash;
var savesOnIgnore = (function () {
  var n = 0, orig = PGRE.store.save;
  PGRE.store.save = function () { n++; return orig.apply(PGRE.store, arguments); };
  clicked({ target: actTarget('mistakes', 'ignore') });
  PGRE.store.save = orig;
  return n;
})();
assert(savesOnIgnore === 0, 'Ignore never writes the durable store');
assert(sessionStorage.getItem(park.DRILL_KEY) === drillBefore, 'Ignore keeps the drill snapshot (progress preserved)');
assert(locationStub.hash === hashBefore, 'Ignore does not navigate');
assert(parkedNow().length === 3 && parkedNow().every(function (b) { return b.kind !== 'mistakes'; }),
  'the ignored session leaves the drawer list');
assert(park.collectAll().length === 4, 'collectAll still sees the ignored session');
assert(btn.textContent === '3 unfinished', 'the count drops by one');
assert(!/Mistake drill/.test(panel.innerHTML), 'the open drawer repaints without the ignored band');
assert(JSON.parse(localStorage.getItem(park.IGNORE_KEY)).join() === 'mistakes:s-d', 'the ignore is keyed to kind + session id');
assert(!/Mistake drill/.test(park.reminderHTML()) && /3 sessions/.test(park.reminderHTML()),
  'the dashboard reminder stops counting the ignored session');

// Continue through the explicit button still resumes
clicked({ target: actTarget('exam', 'continue') });
assert(locationStub.hash === '#/exam/run', 'the Continue button resumes its session');

// a replacement session of the same kind (new id) lists again
put(park.DRILL_KEY, { ids: ['m1', 'm2'], i: 0, skipped: 0, sid: 's-d2', results: [] });
assert(parkedNow().some(function (b) { return b.kind === 'mistakes'; }),
  'a new drill with a different id lists again');
// ignoring another band drops the key of the session that no longer exists
park.ignoreBand(parkedNow().filter(function (b) { return b.kind === 'exam'; })[0]);
assert(JSON.parse(localStorage.getItem(park.IGNORE_KEY)).join() === 'exam:ex-1',
  'keys of sessions that no longer exist are pruned');

// ignoring everything hides the button
parkedNow().forEach(function (b) { park.ignoreBand(b); });
assert(parkedNow().length === 0 && wrap.hidden === true, 'the button hides when every session is ignored');
assert(park.reminderHTML() === '', 'no dashboard reminder when every session is ignored');
localStorage.removeItem(park.IGNORE_KEY);

console.log('\nshell cache tokens for the review-date scripts');

var indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
function scriptToken(file) {
  var m = indexHtml.match(new RegExp('<script src="' + file.replace(/\./g, '\\.') + '\\?v=([^"]+)"'));
  return m ? m[1] : '';
}
assert(scriptToken('js/srs.js') === '20261102a', 'srs.js cache token is 20261102a, got ' + scriptToken('js/srs.js'));
assert(scriptToken('js/gamify.js') === '20261025a', 'gamify.js cache token is 20261025a, got ' + scriptToken('js/gamify.js'));
assert(scriptToken('js/view-practice.js') === '20261025a', 'view-practice.js cache token is 20261025a, got ' + scriptToken('js/view-practice.js'));
assert(scriptToken('js/view-mistakes.js') === '20261020m', 'view-mistakes.js cache token is 20261020m, got ' + scriptToken('js/view-mistakes.js'));
assert(scriptToken('js/app.js') === '20261102a', 'app.js cache token is 20261102a, got ' + scriptToken('js/app.js'));
assert(indexHtml.indexOf('js/srs.js?v=20261001j') < 0 &&
       indexHtml.indexOf('js/srs.js?v=20261002a') < 0 &&
       indexHtml.indexOf('js/srs.js?v=20261009a') < 0 &&
       indexHtml.indexOf('js/gamify.js?v=20260918c') < 0 &&
       indexHtml.indexOf('js/gamify.js?v=20261002a') < 0 &&
       indexHtml.indexOf('js/view-practice.js?v=20261002c') < 0 &&
       indexHtml.indexOf('js/view-practice.js?v=20261004b') < 0 &&
       indexHtml.indexOf('js/view-mistakes.js?v=20261002b') < 0 &&
       indexHtml.indexOf('js/view-mistakes.js?v=20261002c') < 0 &&
       indexHtml.indexOf('js/app.js?v=20261002c') < 0 &&
       indexHtml.indexOf('js/app.js?v=20261002d') < 0,
  'the pre-fix cache tokens are gone');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
