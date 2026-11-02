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
  { id: 'physics',  name: 'Physics',                    tag: 'physics' },
  { id: 'english',  name: 'English usage and grammar',  tag: 'english' },
  { id: 'vocab',    name: 'Vocabulary',                 tag: 'vocab' },
  { id: 'nuclear',  name: 'Nuclear physics',            tag: 'nuclear' },
  { id: 'cs',       name: 'Basic Computer Science',     tag: 'cs' }
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
