/* Formula search — the matching engine behind the Search tab of the formula
   portal (#/formulas). Deliberately separate from js/search.js: that one indexes
   the whole studio and returns text snippets, this one indexes ONLY the formula
   deck and returns cards, so the view can render them as flashcards.

   Nothing here touches the schedule — the engine reads card state (via PGRE.srs)
   for the status filters and the chips, never writes it.

   Matching runs several algorithms over each query term and keeps the best hit
   per term (see planTerm/scoreRecord):
     • exact       — the term is a whole word on the card
     • prefix      — a card word starts with the term ("cap" → "capacitance")
     • substring   — the term sits inside a card word ("hertz" → "gigahertz")
     • stem        — light suffix stripping, so "oscillating" finds "oscillation"
     • synonym     — a physics thesaurus: emf ↔ electromotive force, λ ↔ wavelength
     • acronym     — "shm" → "Simple Harmonic Motion" via the card's initials
     • fuzzy       — bounded Damerau–Levenshtein, so "capacitence" still lands
     • equation    — the query's math shape matched against the formula's:
                     "v^2/r" finds a = v²/r
   Terms are ANDed. If nothing matches every term the engine retries in OR mode
   and flags the result `loose`, so the view can say so rather than show nothing.

   Field filters (topic:, tag:, eq:, status:, is:) and "quoted phrases" are
   parsed out of the query string before matching. */
window.PGRE = window.PGRE || {};

PGRE.formulaSearch = (function () {

  /* Every lookup table keyed by text that comes from a card or from the search
     box is built with a null prototype. A plain `{}` inherits Object.prototype,
     so the word "constructor" (or "toString", "valueOf" …) is a truthy hit that
     yields a FUNCTION where the code expects a weight or an array — which threw
     inside the debounce callback and left the results panel frozen on the
     previous query. `dict(seed)` copies a literal into such an object. */
  function dict(seed) {
    var o = Object.create(null);
    if (seed) {
      for (var k in seed) {
        if (Object.prototype.hasOwnProperty.call(seed, k)) o[k] = seed[k];
      }
    }
    return o;
  }

  /* ——— Weights ———
     A field weight says how much a hit in that part of the card is worth; a kind
     weight says how trustworthy that kind of match is. One term's score is the
     product of the two, so an exact hit on the tag beats a fuzzy hit in the
     variable glossary by a wide margin. */
  var FIELD_W = { name: 5, tag: 5, eq: 4.5, front: 3, back: 2.6, mnem: 2.2, topic: 2, note: 1.6 };
  var KIND_W = {
    exact: 1, acronym: 0.9, prefix: 0.8, stem: 0.72, substr: 0.6,
    synonym: 0.55, equation: 1.1, fuzzy: 0.34
  };
  var FIELD_LABEL = { name: 'tag', eq: 'equation no.', front: 'prompt',
                      back: 'formula', mnem: 'mnemonic', topic: 'topic', note: 'note' };
  var KIND_LABEL = { exact: 'exact', acronym: 'acronym', prefix: 'prefix',
                     stem: 'word form', substr: 'partial', synonym: 'synonym',
                     equation: 'equation shape', fuzzy: 'close spelling' };

  /* ——— LaTeX → words ——— */

  var GREEK = dict({
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
    zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'θ', iota: 'ι', kappa: 'κ',
    lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ',
    tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
    Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω'
  });
  var GREEK_NAME = dict();   // 'α' → 'alpha', so a typed Greek letter reads as its name
  (function () {
    for (var k in GREEK) if (!GREEK_NAME[GREEK[k]]) GREEK_NAME[GREEK[k]] = k.toLowerCase();
  })();

  /* LaTeX commands worth keeping as searchable words; anything not listed here
     (and not Greek) is dropped rather than left as letter soup. */
  var TEX_WORD = dict({
    frac: ' / ', dfrac: ' / ', tfrac: ' / ', over: ' / ',
    sqrt: ' sqrt ', int: ' integral ', oint: ' integral ', iint: ' integral ',
    sum: ' sum ', prod: ' product ', partial: ' partial ', nabla: ' del gradient ',
    hbar: ' hbar planck ', infty: ' infinity ', times: ' times ', cdot: ' dot ',
    approx: ' approx ', propto: ' proportional ', equiv: ' equals ', neq: ' not equals ',
    langle: ' bra ', rangle: ' ket ', pm: ' plus minus ', mp: ' plus minus ',
    leq: ' less ', geq: ' greater ', ll: ' much less ', gg: ' much greater ',
    ln: ' ln log ', log: ' log ', exp: ' exp ', sin: ' sin ', cos: ' cos ',
    tan: ' tan ', sinh: ' sinh ', cosh: ' cosh ', tanh: ' tanh ',
    det: ' determinant ', dagger: ' dagger adjoint ', ast: ' conjugate '
  });

  function stripTags(s) {
    return String(s == null ? '' : s)
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
  }

  /* \frac{a}{b} → (a)/(b), innermost pair first. Four passes clear the deepest
     nesting the deck actually uses; the loop stops early once nothing changes. */
  function unfrac(s) {
    var re = /\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, prev;
    for (var i = 0; i < 4; i++) {
      prev = s;
      s = s.replace(re, '($1)/($2)');
      if (s === prev) break;
    }
    return s;
  }

  /* Reduce authored text (prose + LaTeX) to plain searchable words. Greek is
     folded to its English name in BOTH directions — a card's \omega and a typed
     "ω" both come out as "omega" — so either spelling finds the other. */
  function plain(s) {
    s = unfrac(stripTags(s));
    s = s.replace(/\\([a-zA-Z]+)/g, function (_, cmd) {
      if (GREEK[cmd] !== undefined) return ' ' + cmd.toLowerCase() + ' ';
      if (TEX_WORD[cmd] !== undefined) return TEX_WORD[cmd];
      return ' ';
    });
    s = s.replace(/[Ͱ-Ͽ]/g, function (ch) {
      return GREEK_NAME[ch] ? ' ' + GREEK_NAME[ch] + ' ' : ' ';
    });
    return s.replace(/\$+/g, ' ')
      .replace(/[{}\\^_~`#*>|[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* The *shape* of one equation, normalised so a typed fragment can be matched
     against it: `a = \frac{v^2}{r}` → `a=v^2/r`. Case-folded, because a search
     box that insists on the right case is no use; subscripts survive, so `v_0`
     still finds `v_{0x}`; grouping parentheses go, since nobody types the ones
     \frac implies. */
  function sigOf(s) {
    s = unfrac(stripTags(s));
    s = s.replace(/\\([a-zA-Z]+)/g, function (_, cmd) {
      if (GREEK[cmd] !== undefined) return GREEK[cmd];
      if (cmd === 'cdot' || cmd === 'times') return '*';
      if (cmd === 'approx' || cmd === 'equiv') return '=';
      if (cmd === 'propto') return '~';
      if (cmd === 'sqrt' || cmd === 'hbar') return cmd;
      if (cmd === 'partial') return 'd';
      return '';
    });
    return s.replace(/\$+/g, '')
      .replace(/[{}()\[\]\\,;!&]/g, '')
      .replace(/\s+/g, '')
      .toLowerCase();
  }

  /* A card's whole formula side reduced to signatures — one per $…$ / $$…$$
     span, joined by a separator no query can contain. Only the math is taken:
     the variable glossary that shares the field is prose, and folding its letters
     in would turn every card into a soup that matches any shape. */
  function mathSig(s) {
    var re = /\$\$([\s\S]*?)\$\$|\$([^$]+)\$/g, out = [], m;
    while ((m = re.exec(String(s == null ? '' : s))) !== null) {
      var sig = sigOf(m[1] !== undefined ? m[1] : m[2]);
      if (sig) out.push(sig);
    }
    return out.join('#');
  }

  /* ——— Tokens, stems, synonyms ——— */

  var SPLIT = /[^a-z0-9]+/;

  function tokens(s) {
    return plain(s).toLowerCase().split(SPLIT).filter(function (t) { return !!t; });
  }

  /* Query-side noise words. Card text keeps every word — the deck's prompts are
     full questions, and dropping words there would cost real matches. */
  var STOP = dict();
  ('a an and are as at be by can do does for from give given how in into is it ' +
   'its of on or that the their then there these this to was what whats when ' +
   'where which with you your').split(' ').forEach(function (w) { STOP[w] = 1; });

  /* Light suffix stripping — enough that "oscillating"/"oscillations" and
     "oscillation" collapse together, conservative enough not to merge words that
     mean different things. Applied identically to both sides, so any collision it
     does create is at least symmetric. */
  function stem(w) {
    if (w.length <= 3) return w;
    var s = w, special = false;
    if (/ization$/.test(s)) { s = s.slice(0, -7) + 'ize'; special = true; }
    else if (/ivity$/.test(s)) { s = s.slice(0, -5) + 'ive'; special = true; }
    if (!special) {
      if (/ies$/.test(s) && s.length > 4) s = s.slice(0, -3) + 'y';
      else if (/(sses|shes|ches|xes|zes)$/.test(s)) s = s.slice(0, -2);
      else if (/s$/.test(s) && !/(ss|us|is|as)$/.test(s)) s = s.slice(0, -1);
      if (/ing$/.test(s) && s.length > 5) s = s.slice(0, -3);
      else if (/ed$/.test(s) && s.length > 4) s = s.slice(0, -2);
      // A trailing doubled consonant collapses UNCONDITIONALLY — "runn" ← running
      // and "run" both land on "run", and so do "fall"/"falling" ("fal"). Doing
      // this only after an -ing/-ed cut used to break exactly the words whose root
      // already ends doubled: "falling" → "fal" never met "fall" → "fall".
      if (s.length > 3 && /([bdfglmnprt])\1$/.test(s)) s = s.slice(0, -1);
    }
    return s;
  }

  /* Physics thesaurus. Every member of a group expands to all the others, so the
     table only has to be written once per idea. Multi-word members are matched as
     phrases against the card text; single words go through the token index. */
  var SYN_GROUPS = [
    ['emf', 'electromotive', 'electromotive force'],
    ['shm', 'simple harmonic motion', 'simple harmonic oscillator', 'harmonic oscillator'],
    ['ke', 'kinetic energy'], ['pe', 'potential energy'],
    ['moi', 'moment of inertia', 'rotational inertia'],
    ['com', 'center of mass', 'centre of mass', 'barycenter'],
    ['bfield', 'magnetic field', 'magnetic flux density', 'magnetic induction'],
    ['efield', 'electric field', 'electrostatic field'],
    ['cap', 'capacitor', 'capacitance'],
    ['inductor', 'inductance', 'henry'],
    ['resistor', 'resistance', 'resistivity', 'ohm'],
    ['voltage', 'potential difference', 'volt'],
    ['current', 'ampere', 'amp'],
    ['emwave', 'electromagnetic wave', 'em wave', 'light wave', 'radiation'],
    ['lorentz factor', 'gamma factor', 'time dilation'],
    ['rest energy', 'rest mass', 'invariant mass'],
    ['wavefunction', 'psi', 'state vector', 'eigenstate'],
    ['operator', 'observable', 'hermitian'],
    ['commutator', 'commutation relation'],
    ['eigenvalue', 'eigenstate', 'eigenfunction'],
    ['sho', 'quantum harmonic oscillator', 'ladder operator'],
    ['uncertainty', 'heisenberg'],
    ['partition function', 'boltzmann factor', 'canonical ensemble'],
    ['entropy', 'disorder', 'second law'],
    ['ideal gas', 'gas law', 'equation of state'],
    ['heat engine', 'carnot', 'efficiency'],
    ['specific heat', 'heat capacity'],
    ['blackbody', 'black body', 'planck law', 'stefan boltzmann'],
    ['photoelectric', 'work function'],
    ['halflife', 'half life', 'decay constant', 'radioactivity'],
    ['index of refraction', 'refractive index', 'snell'],
    ['dof', 'degrees of freedom'],
    ['freq', 'frequency', 'hertz'],
    ['accel', 'acceleration'], ['vel', 'velocity', 'speed'],
    ['temp', 'temperature'], ['grav', 'gravity', 'gravitation', 'gravitational'],
    ['thermo', 'thermodynamics', 'thermodynamic'],
    ['statmech', 'statistical mechanics'],
    ['qm', 'quantum mechanics', 'quantum'],
    ['em', 'electromagnetism', 'electromagnetic'],
    ['sr', 'special relativity', 'relativistic'],
    /* Greek letters and what they usually stand for in this deck. */
    ['lambda', 'wavelength'], ['nu', 'frequency'], ['omega', 'angular frequency', 'angular velocity'],
    ['mu', 'permeability', 'reduced mass'], ['epsilon', 'permittivity'],
    ['rho', 'density', 'charge density', 'resistivity'],
    ['sigma', 'conductivity', 'surface charge', 'cross section'],
    ['tau', 'torque', 'time constant'], ['phi', 'flux', 'potential'],
    ['psi', 'wavefunction'], ['theta', 'angle'], ['kappa', 'dielectric constant'],
    ['beta', 'velocity parameter'], ['gamma', 'lorentz factor'],
    ['hbar', 'reduced planck constant', 'planck']
  ];
  var SYN = dict();
  SYN_GROUPS.forEach(function (g) {
    g.forEach(function (a) {
      var key = a.replace(/\s+/g, ' ');
      var list = SYN[key] || (SYN[key] = []);
      g.forEach(function (b) { if (b !== a && list.indexOf(b) === -1) list.push(b); });
    });
  });

  /* Optimal-string-alignment distance (Levenshtein + adjacent transposition),
     abandoned as soon as every cell in a row exceeds `max`. */
  function editDist(a, b, max) {
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    var prev2 = [], prev = [], cur = [], i, j;
    for (j = 0; j <= lb; j++) prev[j] = j;
    for (i = 1; i <= la; i++) {
      cur[0] = i;
      var rowMin = i;
      for (j = 1; j <= lb; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        var v = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) &&
            a.charAt(i - 2) === b.charAt(j - 1)) {
          v = Math.min(v, prev2[j - 2] + 1);
        }
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev.slice(); prev = cur.slice();
    }
    return prev[lb];
  }

  /* ——— Index ———
     Rebuilt each time the Search tab is opened: it is a few milliseconds over a
     few hundred cards, and it keeps user mnemonics (which live in the store, not
     the deck) current without any invalidation bookkeeping. */

  function cardName(c) { return (c && (c.name || c.tag)) || ''; }

  /* First letters of the significant words of the card's tag and topic, so
     "shm" reaches "Simple Harmonic Motion" and "me" reaches "Maxwell's
     equations". Stored as one string per source, joined by spaces. */
  function initialsOf(parts) {
    return parts.map(function (p) {
      var ws = String(p || '').toLowerCase().split(SPLIT).filter(function (w) {
        return w.length > 1 && !STOP[w];
      });
      return ws.length > 1 ? ws.map(function (w) { return w.charAt(0); }).join('') : '';
    }).filter(Boolean).join(' ');
  }

  function record(c) {
    var t = PGRE.topicById ? PGRE.topicById(c.topic) : null;
    var notes = PGRE.store && PGRE.store.state.cardNotes;
    var mnem = (notes && notes[c.id] && notes[c.id].text) || '';
    var f = {
      name: plain(cardName(c)).toLowerCase(),
      // Section tag is its own field. cardName() prefers name, so a tag:
      // query must not depend on the display name containing the section.
      tag: plain(c && c.tag).toLowerCase(),
      eq: String(c.eq || '').toLowerCase(),
      front: plain(c.front).toLowerCase(),
      back: plain(c.back).toLowerCase(),
      mnem: String(mnem).toLowerCase(),
      topic: t ? (t.name + ' ' + t.short).toLowerCase() : String(c.topic || '').toLowerCase(),
      note: plain(c.note).toLowerCase()
    };
    var tok = dict(), stems = dict(), list = [];
    for (var key in f) {
      if (!f[key]) continue;
      var w = FIELD_W[key];
      f[key].split(SPLIT).forEach(function (word) {
        if (!word) return;
        if (tok[word] === undefined) { tok[word] = w; list.push(word); }
        else if (w > tok[word]) tok[word] = w;
        var st = stem(word);
        if (stems[st] === undefined || w > stems[st]) stems[st] = w;
      });
    }
    var sig = mathSig(c.back);
    return {
      card: c, id: c.id, topic: c.topic || '', tag: cardName(c), eq: String(c.eq || ''),
      f: f, tok: tok, stems: stems, toks: list,
      initials: initialsOf([cardName(c), c && c.tag, t ? t.name : '']),
      sig: sig, sigLoose: sig.replace(/[\^_]/g, ''),
      hay: f.name + ' ' + f.topic + ' ' + f.front + ' ' + f.back + ' ' + f.note + ' ' + f.mnem
    };
  }

  function build(deck) {
    var recs = (deck || []).filter(Boolean).map(record);
    var vocabMap = dict(), vocab = [];
    recs.forEach(function (r) {
      r.toks.forEach(function (t) {
        if (!vocabMap[t]) { vocabMap[t] = 1; vocab.push(t); }
      });
    });
    return { records: recs, vocab: vocab, size: recs.length };
  }

  /* ——— Query parsing ——— */

  var FILTERS = ['topic', 'tag', 'eq', 'status', 'is'];
  // Quoted values first (tag:"thin films"), bare values second. Splitting the two
  // lets quoted phrases be lifted out in between, so `"the eq:5 case"` stays one
  // phrase instead of having a filter torn out of its middle.
  var FILTER_QUOTED_RE = new RegExp('\\b(' + FILTERS.join('|') + '):"([^"]*)"', 'gi');
  var FILTER_BARE_RE = new RegExp('\\b(' + FILTERS.join('|') + '):(\\S+)', 'gi');

  function parseQuery(qstr) {
    var raw = String(qstr || '');
    var out = { topic: '', tag: '', eq: '', status: '', phrases: [], terms: [], text: '' };
    function take(key, val) {
      key = key.toLowerCase();
      val = String(val).replace(/^"|"$/g, '').toLowerCase();
      if (key === 'is') out.status = val;
      else out[key] = val;
      return ' ';
    }
    raw = raw.replace(FILTER_QUOTED_RE, function (_, key, val) { return take(key, val); });
    raw = raw.replace(/"([^"]+)"/g, function (_, p) {
      var ph = plain(p).toLowerCase().trim();
      if (ph) out.phrases.push(ph);
      return ' ';
    });
    raw = raw.replace(FILTER_BARE_RE, function (_, key, val) { return take(key, val); });
    out.text = raw.trim();
    var all = tokens(raw);
    // Noise words are dropped — unless that would leave nothing, in which case a
    // one-word query like "work" has to stand on its own.
    var kept = all.filter(function (t) { return !STOP[t]; });
    (kept.length ? kept : all).forEach(function (t) {
      if (out.terms.indexOf(t) === -1) out.terms.push(t);
    });
    return out;
  }

  /* ——— Filters ——— */

  /* Card status predicates, shared by the `status:` keyword and the view's
     dropdown. Read-only: every one of these only inspects srs state. */
  var STATUSES = [
    { key: '', label: 'Any status' },
    { key: 'new', label: 'Not yet introduced' },
    { key: 'learned', label: 'Introduced' },
    { key: 'due', label: 'Due now' },
    { key: 'today', label: 'In today’s batch' },
    { key: 'mature', label: 'Mature' },
    { key: 'young', label: 'Young' },
    { key: 'leech', label: 'Keeps slipping' },
    { key: 'away', label: 'Parked' },
    { key: 'mnemonic', label: 'Has a mnemonic' }
  ];
  var STATUS_ALIAS = dict({ unseen: 'new', seen: 'learned', introduced: 'learned',
                            suspended: 'away', leeches: 'leech', struggling: 'leech',
                            batch: 'today' });

  function matureDays() {
    return (PGRE.srs && typeof PGRE.srs.matureDays === 'function') ? PGRE.srs.matureDays() : 21;
  }

  /* Live chip copy for the status dropdown. Mature / Young carry the
     current solid-enough threshold (srs.matureDays), e.g. "≥ 18 d". */
  function statusLabel(entry) {
    var n = matureDays();
    if (entry.key === 'mature') return 'Mature (≥ ' + n + ' d)';
    if (entry.key === 'young') return 'Young (< ' + n + ' d)';
    return entry.label;
  }

  function statusOk(rec, status, batchSet) {
    if (!status) return true;
    status = STATUS_ALIAS[status] || status;
    var srs = PGRE.srs, st = srs.cardState(rec.id);
    var thresh = matureDays();
    switch (status) {
      case 'new': return !(st && st.reviews > 0);
      case 'learned': return !!(st && st.reviews > 0);
      case 'due': return !!st && srs.daysUntil(st.due) <= 0;
      case 'today': return !!batchSet && !!batchSet[rec.id];
      case 'mature': return !!st && (st.interval || 0) >= thresh;
      // Learning = introduced (reviews > 0) minus solid, matching the recall
      // band's recallMix: a saved state with reviews 0 (a normalizeRecallState
      // repair) is not introduced, so it lists under new, not young.
      case 'young': return !!st && st.reviews > 0 && (st.interval || 0) < thresh;
      case 'leech': return srs.isLeech(st);
      case 'away': return srs.isSuspended(rec.id);
      case 'mnemonic': return !!rec.f.mnem;
      default: return true;      // an unknown status: filter nothing out
    }
  }

  /* ——— Per-term match plan ———
     Everything a term can match is worked out ONCE against the deck vocabulary,
     then each card is scored with plain dictionary lookups. That is what keeps
     fuzzy matching affordable: the expensive edit-distance sweep runs over the
     few thousand distinct words in the deck, not over every card. */
  function planTerm(vocab, term) {
    var p = { term: term, stem: stem(term), prefix: [], substr: [],
              syn: [], synPhrase: [], fuzzy: [] };
    var i, t;
    for (i = 0; i < vocab.length; i++) {
      t = vocab[i];
      if (t === term) continue;
      if (term.length >= 3 && t.indexOf(term) === 0) p.prefix.push(t);
      else if (term.length >= 4 && t.indexOf(term) !== -1) p.substr.push(t);
    }
    var syn = SYN[term] || (p.stem !== term ? SYN[p.stem] : null);
    if (syn) {
      syn.forEach(function (e) {
        if (e.indexOf(' ') === -1) p.syn.push(e);
        else p.synPhrase.push(e);
      });
    }
    // Typo tolerance is a last resort: skip it when the term already prefixes a
    // real deck word, or every short query would drag in its neighbours.
    if (term.length >= 4 && !p.prefix.length) {
      var maxD = term.length >= 7 ? 2 : 1;
      for (i = 0; i < vocab.length; i++) {
        t = vocab[i];
        if (Math.abs(t.length - term.length) > maxD) continue;
        var d = editDist(term, t, maxD);
        if (d > 0 && d <= maxD) p.fuzzy.push({ t: t, d: d });
      }
    }
    return p;
  }

  /* Does a card's formula carry the shape the query typed? The whole fragment as
     a substring is the clean hit. Failing that, a query written as an equation is
     also satisfied when each side turns up somewhere in the card's math — so
     "e=mc^2" finds $E = \gamma mc^2$, which no substring test would reach. The
     caret-free forms let "v2/r" stand in for "v^2/r". */
  function sigHit(rec, p) {
    if (!rec.sig || !p.sig) return false;
    if (rec.sig.indexOf(p.sig) !== -1) return true;
    // An empty needle is a substring of everything: `^^^` strips to '' in the
    // caret-free form, which would otherwise report the whole deck as a match.
    if (p.sigLoose && rec.sigLoose.indexOf(p.sigLoose) !== -1) return true;
    function all(parts, hay) {
      if (parts.length < 2) return false;
      for (var i = 0; i < parts.length; i++) {
        if (!parts[i] || hay.indexOf(parts[i]) === -1) return false;
      }
      return true;
    }
    return all(p.parts, rec.sig) || all(p.partsLoose, rec.sigLoose);
  }

  /* Which field a phrase lives in, and how much that field is worth. */
  function phraseField(rec, phrase) {
    var best = 0;
    for (var key in rec.f) {
      if (rec.f[key] && rec.f[key].indexOf(phrase) !== -1 && FIELD_W[key] > best) {
        best = FIELD_W[key];
      }
    }
    return best;
  }

  /* Score one card against the planned terms. Returns null when the card matches
     nothing at all, or (in strict mode) fewer than every term. */
  function scoreRecord(rec, plans, ctx) {
    var total = 0, covered = 0, marks = [], kinds = {}, fields = {};
    var best, bestKind, bestField;

    function bid(kind, fieldW, mark, fieldKey) {
      if (!fieldW) return;
      var s = KIND_W[kind] * fieldW;
      if (s > best) { best = s; bestKind = kind; bestField = fieldKey || null; }
      if (mark && marks.indexOf(mark) === -1) marks.push(mark);
    }
    /* Which field a token sits in — only needed for the "matched in" chips, so a
       linear scan over seven short strings is cheap enough. Highest-weight field
       wins, matching how rec.tok scored the token in the first place. */
    function fieldOfToken(tok) {
      var key = null, w = 0;
      for (var k in rec.f) {
        if (rec.f[k] && FIELD_W[k] > w && rec.f[k].split(SPLIT).indexOf(tok) !== -1) {
          key = k; w = FIELD_W[k];
        }
      }
      return key;
    }

    for (var i = 0; i < plans.length; i++) {
      var p = plans[i], j;
      best = 0; bestKind = null; bestField = null;

      if (p.math) {                                  // the equation-shape pseudo-term
        if (sigHit(rec, p)) bid('equation', FIELD_W.back, null, 'back');
      } else {
        if (rec.tok[p.term] !== undefined) bid('exact', rec.tok[p.term], p.term, fieldOfToken(p.term));
        for (j = 0; j < p.prefix.length; j++) {
          if (rec.tok[p.prefix[j]] !== undefined) {
            bid('prefix', rec.tok[p.prefix[j]], p.prefix[j], fieldOfToken(p.prefix[j]));
          }
        }
        for (j = 0; j < p.substr.length; j++) {
          if (rec.tok[p.substr[j]] !== undefined) {
            bid('substr', rec.tok[p.substr[j]], p.substr[j], fieldOfToken(p.substr[j]));
          }
        }
        if (rec.stems[p.stem] !== undefined) bid('stem', rec.stems[p.stem], null, null);
        if (p.term.length >= 2 && rec.initials &&
            (' ' + rec.initials + ' ').indexOf(' ' + p.term + ' ') !== -1) {
          bid('acronym', FIELD_W.name, null, 'name');
        }
        for (j = 0; j < p.syn.length; j++) {
          if (rec.tok[p.syn[j]] !== undefined) {
            bid('synonym', rec.tok[p.syn[j]], p.syn[j], fieldOfToken(p.syn[j]));
          }
        }
        for (j = 0; j < p.synPhrase.length; j++) {
          var pw = phraseField(rec, p.synPhrase[j]);
          if (pw) bid('synonym', pw, p.synPhrase[j], null);
        }
        if (!best) {
          for (j = 0; j < p.fuzzy.length; j++) {
            var fz = p.fuzzy[j];
            if (rec.tok[fz.t] === undefined) continue;
            // a 2-character slip is worth less than a 1-character one
            bid('fuzzy', rec.tok[fz.t] * (1 - fz.d / (p.term.length + 1)), fz.t, fieldOfToken(fz.t));
          }
        }
      }

      if (best > 0) {
        covered++;
        total += best;
        kinds[bestKind] = 1;
        if (bestField) fields[bestField] = 1;
      }
    }

    // Required quoted phrases are absolute — a card missing one is not a result.
    for (i = 0; i < ctx.phrases.length; i++) {
      var w = phraseField(rec, ctx.phrases[i]);
      if (!w) return null;
      total += KIND_W.exact * w * 1.5;
      if (marks.indexOf(ctx.phrases[i]) === -1) marks.push(ctx.phrases[i]);
    }

    if (!covered && !ctx.phrases.length) return null;
    if (ctx.strict && covered < plans.length) return null;

    // The whole query appearing verbatim outranks the same words scattered about.
    if (ctx.whole && ctx.whole.indexOf(' ') !== -1) {
      var ww = phraseField(rec, ctx.whole);
      if (ww) total += 4 * ww;
    }
    // Partial coverage is penalised so loose-mode results still rank sensibly.
    var coverage = plans.length ? covered / plans.length : 1;
    total *= 0.4 + 0.6 * coverage;

    return { card: rec.card, rec: rec, score: total, marks: marks,
             kinds: Object.keys(kinds), fields: Object.keys(fields), coverage: coverage };
  }

  /* ——— Sorting ——— */

  function eqKey(rec) {
    // "12.3" → 12.0003, so equation numbers sort like the book prints them
    var m = String(rec.eq).match(/^(\d+)(?:\.(\d+))?/);
    if (!m) return Number.MAX_VALUE;
    return parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) / 10000 : 0);
  }

  var TOPIC_ORDER = dict();
  (function () {
    (PGRE.TOPICS || []).forEach(function (t, i) { TOPIC_ORDER[t.id] = i; });
  })();

  function sortHits(hits, mode) {
    if (mode === 'order') {
      hits.sort(function (a, b) {
        var ta = TOPIC_ORDER[a.rec.topic], tb = TOPIC_ORDER[b.rec.topic];
        if (ta === undefined) ta = 99;
        if (tb === undefined) tb = 99;
        if (ta !== tb) return ta - tb;
        return eqKey(a.rec) - eqKey(b.rec);
      });
    } else if (mode === 'due') {
      var srs = PGRE.srs;
      hits.sort(function (a, b) {
        var sa = srs.cardState(a.rec.id), sb = srs.cardState(b.rec.id);
        // never-introduced cards sort last — there is no due date to be soonest
        var da = sa ? srs.daysUntil(sa.due) : 1e6, db = sb ? srs.daysUntil(sb.due) : 1e6;
        if (da !== db) return da - db;
        return eqKey(a.rec) - eqKey(b.rec);
      });
    } else {
      hits.sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return eqKey(a.rec) - eqKey(b.rec);
      });
    }
    return hits;
  }

  /* ——— Public query ———
     opts: { topic, status, sort } — the view's dropdowns. A dropdown OVERRIDES
     the matching keyword in the query string rather than narrowing it further:
     the control the reader can see wins over text they may have forgotten is
     still in the box. */
  function run(index, qstr, opts) {
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    opts = opts || {};
    var q = parseQuery(qstr);
    var topic = opts.topic || q.topic;
    var status = opts.status || q.status;

    /* status:today reads the batch that has ALREADY been picked — it never calls
       srs.formulaDay(). Rendering a filter must never mutate the store. The
       batch persists across day rolls (un-studied picks carry over), so any
       saved batch counts; only a truly absent batch matches nothing. */
    var batchSet = null, notice = null;
    if ((STATUS_ALIAS[status] || status) === 'today') {
      var saved = PGRE.store.state.formulaDay;
      batchSet = dict();
      if (saved) {
        saved.reviewIds.concat(saved.newIds).forEach(function (id) { batchSet[id] = 1; });
      } else {
        notice = 'No cards picked yet — pick today’s batch in Recall.';
      }
    }

    var pool = index.records.filter(function (r) {
      if (topic && r.topic !== topic) return false;
      // tag: matches the section tag. The display name stays a compatibility
      // alias so older queries that named the card still hit.
      if (q.tag && (r.f.tag || '').indexOf(q.tag) === -1 &&
          (r.f.name || '').indexOf(q.tag) === -1) return false;
      // eq:1.3 means that equation; eq:1 means all of chapter 1
      if (q.eq) {
        var re = String(r.eq).toLowerCase();
        if (q.eq.indexOf('.') !== -1 ? re !== q.eq : re.indexOf(q.eq + '.') !== 0 && re !== q.eq) return false;
      }
      return statusOk(r, status, batchSet);
    });

    var plans = q.terms.map(function (t) { return planTerm(index.vocab, t); });
    // An equation-shaped query ("v^2/r", "e=mc^2") is matched against formula
    // bodies directly. It needs an operator to qualify — otherwise an ordinary
    // word would be compared against every formula's letter soup and match noise.
    var sig = sigOf(q.text);
    // Operators alone are not a shape: `^^^` or `___` carry no symbol to look
    // for, so they must not qualify as an equation query at all.
    if (sig.length >= 3 && /[=^\/_*~]/.test(q.text) && /[a-z0-9]/.test(sig)) {
      // A query that is ONLY math drops its word terms: the single letters of
      // "v^2/r" appear in half the deck, and letting them vote buries the very
      // equation the shape was meant to find.
      var hasProse = q.terms.some(function (t) { return t.length >= 3 && /^[a-z]+$/.test(t); });
      if (!hasProse) plans = [];
      var loose = sig.replace(/[\^_]/g, '');
      // Sides of an equation, kept only when at least one of them is specific
      // enough to be worth ANDing — "a=b" would otherwise match every formula.
      function sides(x) {
        var parts = x.split('=').filter(function (s) { return s.length > 0; });
        var meaty = parts.some(function (s) { return s.length >= 2; });
        return (parts.length >= 2 && meaty) ? parts : [];
      }
      plans.push({ math: true, sig: sig, sigLoose: loose,
                   parts: sides(sig), partsLoose: sides(loose) });
    }

    // No words to match on — the box is empty (or holds only filters), so this
    // is a browse of whatever the filters left standing.
    var browsing = !plans.length && !q.phrases.length;
    var hits = [], loose = false, i, h;

    if (browsing) {
      for (i = 0; i < pool.length; i++) {
        hits.push({ card: pool[i].card, rec: pool[i], score: 0, marks: [],
                    kinds: [], fields: [], coverage: 1 });
      }
    } else {
      var ctx = { phrases: q.phrases, strict: true, whole: plain(q.text).toLowerCase() };
      for (i = 0; i < pool.length; i++) {
        h = scoreRecord(pool[i], plans, ctx);
        if (h) hits.push(h);
      }
      // Nothing matched every word — retry accepting any word, and let the view
      // say so, rather than showing a bare "no results" for a near miss.
      if (!hits.length && plans.length > 1) {
        ctx.strict = false;
        for (i = 0; i < pool.length; i++) {
          h = scoreRecord(pool[i], plans, ctx);
          if (h) hits.push(h);
        }
        loose = hits.length > 0;
      }
    }

    // "Best match" means nothing when there is no query to match: a browse falls
    // back to book order so the deck reads the way the book prints it.
    var sort = opts.sort || 'relevance';
    if (browsing && sort === 'relevance') sort = 'order';
    sortHits(hits, sort);

    var t1 = (window.performance && performance.now) ? performance.now() : Date.now();
    return {
      hits: hits, total: hits.length, ms: Math.max(0, t1 - t0), sort: sort,
      loose: loose, browsing: browsing, pool: pool.length, notice: notice,
      terms: browsing ? [] : q.terms, parsed: q,
      suggestion: (!browsing && !hits.length) ? suggest(index, q.terms) : null
    };
  }

  /* "Did you mean" — the deck word closest to whichever query term is furthest
     from anything in the deck. Only offered when it is a genuine near miss. */
  function suggest(index, terms) {
    var best = null;
    terms.forEach(function (term) {
      // too short to be a confident typo, or part of an equation rather than a word
      if (term.length < 4 || /\d/.test(term)) return;
      /* What counts as a near miss has to scale with the word. Three edits inside
         "gravitionall" is a slip worth offering; the same three inside a five-letter
         word is simply a different word, and a flat cap of 3 offered nonsense for
         short queries while a flat cap of 2 refused the long typos people make. */
      var cap = term.length >= 10 ? 3 : (term.length >= 6 ? 2 : 1);
      var localBest = null, localD = cap + 1;
      for (var i = 0; i < index.vocab.length; i++) {
        var w = index.vocab[i];
        if (Math.abs(w.length - term.length) > cap) continue;
        var d = editDist(term, w, cap);
        if (d > 0 && d < localD) { localD = d; localBest = w; }
        if (d === 1) break;
      }
      // Rank across terms by RELATIVE closeness, so a short word's one-letter slip
      // beats a long word's three-letter one instead of losing on raw distance.
      if (localBest) {
        var rel = localD / term.length;
        if (!best || rel < best.rel) best = { from: term, to: localBest, rel: rel };
      }
    });
    return best ? { from: best.from, to: best.to } : null;
  }

  return {
    build: build,
    run: run,
    plain: plain,
    stem: stem,
    editDist: editDist,
    STATUSES: STATUSES,
    statusLabel: statusLabel,
    FIELD_LABEL: FIELD_LABEL,
    KIND_LABEL: KIND_LABEL
  };
})();
