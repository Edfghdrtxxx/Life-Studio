/* User-authored recall cards (Life Studio phase 1 — LIFE-STUDIO-SPEC.md).
   The student's own cards live in the progress state at state.userCards:
   id -> { id, subject, front, back, note?, name, kind:'user',
           createdAt, updatedAt }.
   Ids are `user-<subject-tag>-<n>` and NEVER change (SRS state in
   state.cards is keyed by them); a card that changes subject keeps its id —
   its `subject` field then decides membership (PGRE.cardSubject).
   Deletions go through store.tombstone('userCards', id) so a stale sibling
   tab cannot resurrect them (AGENTS.md "Cross-tab persistence"); the id is
   never reused, so `nextId` also scans tombstones and the SRS map.
   These ops only touch the state map + tombstones; js/view-formulas.js and
   PGRE.formulaDeck() (js/store.js) pick saved cards up on the next deck
   read. KaTeX renders $...$ on the faces via the shared formulaHTML path. */
window.PGRE = window.PGRE || {};

PGRE.userCardOps = (function () {
  function state() { return PGRE.store && PGRE.store.state; }
  function map() {
    var s = state();
    if (!s) return {};
    if (!s.userCards || typeof s.userCards !== 'object' || Array.isArray(s.userCards)) {
      s.userCards = {};
    }
    return s.userCards;
  }

  /* Cards as an array, oldest-created first (stable ids keep the order
     meaningful — it is the order the student wrote them). */
  function list() {
    var m = map(), out = [];
    for (var id in m) {
      if (!Object.prototype.hasOwnProperty.call(m, id)) continue;
      var c = m[id];
      if (c && typeof c === 'object') out.push(c);
    }
    out.sort(function (a, b) {
      return ((a.createdAt || '') < (b.createdAt || '') ? -1 :
              (a.createdAt || '') > (b.createdAt || '') ? 1 : 0);
    });
    return out;
  }

  function byId(id) {
    var m = map();
    return (id && Object.prototype.hasOwnProperty.call(m, id)) ? m[id] : null;
  }

  /* Next never-used id for a subject. Tombstoned ids stay burned (a stale
     sibling must not resurrect the old card under a new card's body), and
     ids with SRS history are skipped too. */
  function nextId(tag) {
    var max = 0, s = state() || {};
    var re = new RegExp('^user-' + tag + '-(\\d+)$');
    function scan(obj) {
      if (!obj || typeof obj !== 'object') return;
      for (var k in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
        var m = re.exec(k);
        if (m && +m[1] > max) max = +m[1];
      }
    }
    scan(s.userCards);
    scan(s.tombstones && s.tombstones.userCards);
    scan(s.cards);
    return 'user-' + tag + '-' + (max + 1);
  }

  /* Short display name from the front: a card with no name would render a
     blank deck row. Math spans collapse to 'formula'. */
  function deriveName(front) {
    var t = String(front == null ? '' : front);
    t = t.replace(/\$\$[\s\S]*?\$\$/g, ' formula ').replace(/\$[^$]*\$/g, ' formula ');
    t = t.replace(/[*_`#>]/g, ' ').replace(/\s+/g, ' ').trim();
    if (t.length > 48) t = t.slice(0, 47).trim() + '…';
    return t;
  }

  /* Create or update one card. fields: { id?, subject, front, back, note,
     name? }. Returns { ok:true, card } or { ok:false, error }. Fails closed:
     when the store cannot write, nothing is mutated (AGENTS.md "Fail-closed
     writes"). */
  function save(fields) {
    fields = fields || {};
    var subject = PGRE.subjectById(fields.subject);
    if (!subject) return { ok: false, error: 'Pick a subject.' };
    var front = String(fields.front == null ? '' : fields.front).trim();
    var back = String(fields.back == null ? '' : fields.back).trim();
    var note = String(fields.note == null ? '' : fields.note).trim();
    if (!front) return { ok: false, error: 'The front cannot be empty.' };
    if (!back) return { ok: false, error: 'The back cannot be empty.' };
    if (typeof PGRE.store.canWrite === 'function' && !PGRE.store.canWrite()) {
      if (PGRE.persistWarning) PGRE.persistWarning(true);
      return { ok: false, error: 'Progress cannot be saved right now — nothing was written.' };
    }
    var m = map(), s = state();
    var id = fields.id;
    var existing = id ? byId(id) : null;
    if (id && !existing) return { ok: false, error: 'That card no longer exists.' };
    if (!id) id = nextId(subject.tag);
    var now = new Date().toISOString();
    var name = String(fields.name == null ? '' : fields.name).trim() || deriveName(front);
    var card = existing || {};
    card.id = id;
    card.kind = 'user';
    card.subject = subject.id;
    card.front = front;
    card.back = back;
    if (note) card.note = note; else delete card.note;
    card.name = name;
    if (!card.createdAt) card.createdAt = now;
    card.updatedAt = now;
    m[id] = card;
    PGRE.store.untombstone('userCards', id);
    PGRE.store.save();
    return { ok: true, card: card };
  }

  /* Delete one user card. The SRS record in state.cards stays (review
     history is kept; the id is never reused). Returns true when it was
     removed and persisted. */
  function remove(id) {
    if (!id || !byId(id)) return false;
    if (typeof PGRE.store.canWrite === 'function' && !PGRE.store.canWrite()) {
      if (PGRE.persistWarning) PGRE.persistWarning(true);
      return false;
    }
    delete map()[id];
    PGRE.store.tombstone('userCards', id);
    PGRE.store.save();
    return true;
  }

  return { list: list, byId: byId, nextId: nextId, save: save, remove: remove,
           deriveName: deriveName };
})();
