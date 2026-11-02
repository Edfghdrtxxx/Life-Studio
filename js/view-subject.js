/* Subject home (Life Studio round-2 layout, design §5–§6). One page per
   registry subject at #/subject/<id>: a Recall block (cards, interval mix,
   slipping list), a Memory block (stats + forecast + review calendar), and —
   for Physics — the physics tools the subject still owns. The shared blocks
   are exported as PGRE.subjectRecallHTML / PGRE.subjectMemoryHTML so the
   Recall progress tab and the Today tiles draw the same picture.

   Routes:
     #/subject/<id>          the subject home
     #/subject/<id>/cards    its full card list (the home shows the first 10)
     #/subject/physics/lab   the Formula Lab (delegated to the Recall view's
                             lab renderer — same page, new address) */
window.PGRE = window.PGRE || {};
PGRE.views = PGRE.views || {};

(function () {

  var ui = function () { return PGRE.ui; };
  function esc(s) { return PGRE.ui.esc(s); }
  function fmt(n) { return PGRE.ui.fmt(n); }

  /* ——— Shared renderers ——— */

  /* Interval-mix bar + key. Buckets per PGRE.subjectMemory.hz:
     [never, <1wk, 1-3wk, 3wk-3mo, 3-12mo, >1yr]. */
  function hzHTML(mem, subjectId) {
    var labels = ['Never studied', 'Under 1 week', '1 to 3 weeks',
                  '3 weeks to 3 months', '3 to 12 months', 'Over 1 year'];
    var total = 0;
    mem.hz.forEach(function (n) { total += n; });
    var bar = '', key = '';
    mem.hz.forEach(function (n, i) {
      var w = total ? (100 * n / total) : 0;
      bar += '<span class="b' + i + '" style="width:' + Math.max(w, n ? 1.5 : 0) + '%"' +
        (n ? ' title="' + esc(labels[i]) + ': ' + n + '"' : '') + '></span>';
      key += '<span><b>' + n + '</b>' + esc(labels[i]) + '</span>';
    });
    return '<div class="hz" role="img" aria-label="Interval mix: ' + esc(labels.map(function (l, i) {
      return mem.hz[i] + ' ' + l.toLowerCase();
    }).join(', ')) + '">' + bar + '</div>' +
      '<div class="hz-key">' + key + '</div>';
  }

  /* Next-7-days due forecast bar. fc[0] is tomorrow's count. */
  function forecastHTML(mem) {
    var max = 1;
    mem.fc.forEach(function (n) { if (n > max) max = n; });
    var bars = '', axis = '';
    for (var i = 0; i < 7; i++) {
      var h = Math.max(mem.fc[i] ? (mem.fc[i] / max) * 100 : 0, 3);
      bars += '<span style="height:' + h + '%" title="' + mem.fc[i] + ' due"></span>';
      var day = PGRE.srs.addDays(i + 1);
      axis += '<span>' + esc(day.slice(8)) + '</span>';   // DD of the date
    }
    return '<div class="forecast" role="img" aria-label="Due forecast: ' +
      esc(mem.fc.join(', ')) + '">' + bars + '</div>' +
      '<div class="fc-x">' + axis + '</div>';
  }

  /* The card's next-review chip: "new" when never graded, otherwise the
     relative due label. */
  function cardDueChip(c) {
    var st = PGRE.srs.cardState(c.id);
    if (!st || !st.reviews) {
      if (PGRE.srs.isSuspended(c.id)) return '<span class="duechip">away</span>';
      return '<span class="duechip">new</span>';
    }
    if (PGRE.srs.isSuspended(c.id)) return '<span class="duechip">away</span>';
    var d = PGRE.srs.daysUntil(st.due);
    if (PGRE.srs.studiedToday(st)) return '<span class="duechip">today</span>';
    var label = d <= 0 ? 'now' : d === 1 ? '1 d' : PGRE.srs.ivlLabel(d);
    return '<span class="duechip' + (d <= 0 ? ' now' : '') + '">' + esc(label) + '</span>';
  }

  /* Plain-text one-line card name for list rows (front may carry markup). */
  function cardLine(c) {
    if (c.name) return c.name;
    var txt = PGRE.formulaCheckin && PGRE.formulaCheckin.stripHTML
      ? PGRE.formulaCheckin.stripHTML(c.front || '')
      : String(c.front || '').replace(/<[^>]*>/g, '');
    txt = txt.replace(/[$]/g, '').replace(/\s+/g, ' ').trim();
    return txt || c.id;
  }

  /* Recall block shared by subject home + Progress tab per-subject section.
     `opts.collapse` renders it inside a <details>. */
  function recallBlockHTML(subjectId, mem, opts) {
    opts = opts || {};
    var sub = PGRE.subjectById(subjectId);
    var name = sub ? sub.name : subjectId;
    var duePhrase = mem.due
      ? fmt(mem.due) + ' due today' + (mem.dueTomorrow ? ', ' + fmt(mem.dueTomorrow) + ' due tomorrow' : '')
      : 'Nothing due';
    var freshPhrase = mem.fresh
      ? fmt(mem.fresh) + ' cards never studied' + (mem.studied ? '' : ' — pick some to begin')
      : mem.studied ? 'All ' + fmt(mem.studied) + ' cards introduced' : '';
    var lead = mem.cards
      ? duePhrase + ' · ' + (freshPhrase || 'no new cards')
      : 'No ' + esc(name) + ' cards yet';

    var html = '';
    var inner =
      '<div class="subj-recall">' +
        '<p class="subj-recall-lead">' + lead + '</p>' +
        hzHTML(mem, subjectId) +
        (mem.slip
          ? '<p class="slip-line">' + fmt(mem.slip) + ' card' + (mem.slip === 1 ? ' keeps' : 's keep') +
            ' slipping — each has lapsed 8 or more times and needs a slower interval. ' +
            '<button type="button" class="ls-link" data-drill-slips="' + esc(subjectId) + '">Drill ' +
            (mem.slip === 1 ? 'it' : 'them') + '</button></p>'
          : '') +
      '</div>';
    if (opts.collapse) {
      html += '<details class="subj-recall-details"' + (opts.open ? ' open' : '') + '>' +
        '<summary><span class="mono-chip">' + esc((sub && sub.code) || '') + '</span> ' +
        esc(name) + ' — ' + fmt(mem.cards) + ' cards · ' +
        (mem.due ? fmt(mem.due) + ' due' : 'nothing due') + '</summary>' + inner + '</details>';
    } else {
      html += inner;
    }
    return html;
  }

  /* Memory block: four stat tiles + interval mix + forecast. Shared by the
     subject home and the Recall progress tab. */
  function memoryBlockHTML(mem, subjectId) {
    var acc = mem.acc30 == null ? '—' : mem.acc30 + '%';
    var accSub = mem.acc30 == null
      ? 'Collecting — a 30-day read arrives after more reviews'
      : '30-day retention';
    var life = mem.lifeAcc == null ? '—' : mem.lifeAcc + '%';
    var stat = function (v, small, k, s) {
      return '<div class="stat-tile"><div class="stat-big">' + v +
        (small ? '<small>' + esc(small) + '</small>' : '') + '</div>' +
        '<div class="stat-k">' + esc(k) + '</div>' +
        (s ? '<div class="stat-s">' + esc(s) + '</div>' : '') + '</div>';
    };
    return '<div class="mem-grid">' +
        stat(fmt(mem.studied), 'of ' + fmt(mem.cards), 'Introduced',
             mem.fresh ? fmt(mem.fresh) + ' never studied' : '') +
        stat(fmt(mem.held), '', 'Held 3 weeks or more',
             'interval ≥ ' + (PGRE.srs.matureDays ? PGRE.srs.matureDays() : 21) + ' d') +
        stat(acc, '', 'Recall, 30 days', accSub) +
        stat(String(mem.medianIvl) + ' d', '', 'Median interval', 'lifetime ' + life) +
      '</div>' +
      '<h3 class="mem-h">Interval mix</h3>' + hzHTML(mem, subjectId) +
      '<h3 class="mem-h">Coming due</h3>' + forecastHTML(mem);
  }

  /* The physics tools (design §6.4): Practice, Mistake book, History and
     analytics, Visualizers, Book and notes, Exam archive — then the nine
     topic tiles, and Question of the day beside Today's challenges (D4). */
  function physicsToolsHTML(deck) {
    var s = PGRE.store.state;
    var dueM = PGRE.srs.dueMistakes().length;
    var openM = (PGRE.srs.openMistakes ? PGRE.srs.openMistakes() : []).length;
    var answers = 0, right = 0;
    for (var id in s.questions) {
      answers += s.questions[id].attempts;
      right += s.questions[id].correct;
    }
    var acc = answers ? Math.round(100 * right / answers) + '%' : '—';
    var examLabel = s.settings && s.settings.examDate
      ? 'GRE sat ' + new Date(s.settings.examDate + 'T12:00:00')
          .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'Past sittings and the review plan';
    function tile(kicker, title, line, btns) {
      return '<div class="tile ls-tool"><span class="kicker">' + esc(kicker) + '</span>' +
        '<div class="sec-title" style="margin:4px 0">' + title + '</div>' +
        '<div class="muted">' + line + '</div>' +
        '<div class="btn-row">' + btns + '</div></div>';
    }
    var pool = Math.min(10, PGRE.allQuestions().length);
    var html = '<div class="sec-title"><span class="t">Physics tools</span>' +
      '<span class="meta">Everything from the exam months, kept and grouped here</span></div>' +
      '<div class="ls-grid3">' +
      tile('Practice', 'Mixed practice',
        pool + ' questions from the daily pool, about ' + Math.max(2, pool * 2) +
        ' min. Custom quiz and the question of the day sit here too.',
        '<a class="btn btn-primary btn-sm" href="#/practice/all">Start ' + Math.max(1, pool) + '</a>' +
        '<a class="btn btn-ghost btn-sm" href="#/build">Custom quiz</a>') +
      tile('Mistake book', dueM + ' due · ' + fmt(openM) + ' open',
        'Missed questions on the 1, 3, 7, 14, 30 and 60 day ladder.',
        '<a class="btn btn-ghost btn-sm" href="#/mistakes">Drill due</a>') +
      tile('History and analytics', fmt(answers) + ' answers · ' + acc,
        'Every practice session, weekly accuracy, time per question.',
        '<a class="btn btn-ghost btn-sm" href="#/history">History</a>' +
        '<a class="btn btn-ghost btn-sm" href="#/analytics">Analytics</a>') +
      tile('Visualizers', 'Concepts and Formula Lab',
        'Concept visualization and the formula simulations (the Lab tab that sat in Recall).',
        '<a class="btn btn-ghost btn-sm" href="#/concepts">Concepts</a>' +
        '<a class="btn btn-ghost btn-sm" href="#/subject/physics/lab">Formula Lab</a>') +
      tile('Book and notes', 'Library, notes, bookmarks',
        'Book import for the topic pages, question notes and bookmarks.',
        '<a class="btn btn-ghost btn-sm" href="#/library">Library</a>' +
        '<a class="btn btn-ghost btn-sm" href="#/notes">Notes</a>') +
      tile('Exam archive', esc(examLabel),
        'Review plan, runway, mock exams, readiness, intensity.',
        '<a class="btn btn-ghost btn-sm" href="#/exam">Mock exams</a>' +
        '<a class="btn btn-ghost btn-sm" href="#/plan">Review plan</a>') +
      '</div>';
    if (PGRE.views.dashboard && PGRE.views.dashboard.topicsStripHTML) {
      html += PGRE.views.dashboard.topicsStripHTML(deck);
    }
    html += '<div class="ls-grid2" style="margin-top:16px">' +
      '<div id="subj-qotd-slot"></div>' +
      '<div class="card"><div class="sec-title" style="margin:0">Today’s challenges</div>' +
      '<div id="subj-physics-challenges"></div></div>' +
    '</div>';
    return html;
  }

  /* Card rows shared by the home strip and the cards sub-page. `rows` already
     sorted (due-first). */
  function cardRowsHTML(cards) {
    return '<ul class="list subj-card-list">' + cards.map(function (c) {
      return '<li data-card="' + esc(c.id) + '" role="button" tabindex="0">' +
        '<span class="mono-chip">' + esc((PGRE.subjectById(PGRE.cardSubject(c)) || {}).code || '') + '</span>' +
        '<span class="grow clamp">' + esc(cardLine(c)) + '</span>' +
        cardDueChip(c) + '</li>';
    }).join('') + '</ul>';
  }

  /* Due-first ordering: due now (most overdue first), then by due day, then
     fresh cards, then suspended. */
  function cardSort(cards) {
    var today = PGRE.srs.today();
    function key(c) {
      var st = PGRE.srs.cardState(c.id);
      if (!st || !st.reviews) return PGRE.srs.isSuspended(c.id) ? '~away' : '~new';
      if (PGRE.srs.isSuspended(c.id)) return '~away';
      return st.due || '~';
    }
    return cards.slice().sort(function (a, b) {
      var ka = key(a), kb = key(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  }

  function homeHTML(subject, deck, mem, cardsCount) {
    var s = PGRE.store.state;
    var sub = mem.byId[subject.id];
    var myCards = deck.filter(function (c) { return PGRE.cardSubject(c) === subject.id; });
    var userMine = (PGRE.userCardDeck ? PGRE.userCardDeck() : []).filter(function (c) {
      return PGRE.cardSubject(c) === subject.id;
    });
    var deckPartial = PGRE.formulaDeckStatus && PGRE.formulaDeckStatus.partial;

    var html = '<div id="subj-root">';

    if (deckPartial) {
      html += '<div class="ls-notice warn"><b>Progress cannot be saved right now — nothing was written.</b> ' +
        'Part of the card deck failed to load, so this subject may be missing cards.</div>';
    }

    html += '<div class="sec-head">' +
      '<div><span class="kicker">Subject</span>' +
      '<h1 class="h1 sm">' + esc(subject.name) + '</h1>' +
      (subject.id === 'physics'
        ? '<p class="lead">Physics is the studio\'s first subject — the question bank, ' +
          'mock exams and the review queue all live here.</p>'
        : '<p class="lead">' +
          (sub.cards
            ? fmt(sub.cards) + ' cards · ' + (sub.due ? fmt(sub.due) + ' due today' : 'nothing due')
            : 'No cards yet — make the first one below.') + '</p>') +
      '</div>' +
      '<div class="btn-row">' +
        (subject.id !== 'physics' || sub.cards
          ? '<a class="btn btn-primary" href="#/formulas" data-study-subject="' + esc(subject.id) + '">Study ' + esc(subject.name) + '</a>'
          : '') +
        '<a class="btn btn-ghost" href="#/formulas/browse">Browse cards</a>' +
        '<button class="btn btn-ghost" id="subj-add-card">+ Add card</button>' +
      '</div></div>';

    /* Cards */
    html += '<div class="sec-title"><span class="t">Cards</span>' +
      '<a class="muted" href="#/subject/' + esc(subject.id) + '/cards">Show all ' + fmt(sub.cards) + ' cards ›</a></div>';
    if (!sub.cards) {
      html += '<div class="card empty-state"><p class="muted">No ' + esc(subject.name) +
        ' cards yet. Write the first one — or drop a card into chat and it lands here.</p>' +
        '<div class="btn-row" style="justify-content:center">' +
        '<button class="btn btn-primary" id="subj-add-card-empty">+ Add ' + esc(subject.name) + ' card</button>' +
        '</div></div>';
    } else {
      html += '<div class="card">' +
        '<p class="muted">' + fmt(sub.cards) + ' cards · ' + fmt(sub.fresh) + ' never studied' +
        (sub.due ? ' · ' + fmt(sub.due) + ' due now' : '') + '</p>' +
        cardRowsHTML(cardSort(myCards).slice(0, 10)) + '</div>';
      if (userMine.length) {
        html += '<div class="card"><p class="muted">Your ' + esc(subject.name.toLowerCase()) +
          ' cards — ' + fmt(userMine.length) + ' of ' + fmt(sub.cards) +
          '. <a href="#/formulas/cards">Open the card editor ›</a></p></div>';
      }
    }

    /* Memory */
    html += '<div class="sec-title"><span class="t">Memory</span></div>';
    html += '<div class="card">' + memoryBlockHTML(sub, subject.id) + '</div>';
    if (sub.slip) {
      html += '<p class="slip-line">' + fmt(sub.slip) + ' card' +
        (sub.slip === 1 ? ' keeps' : 's keep') +
        ' slipping — each has lapsed 8 or more times and needs a slower interval. ' +
        '<button type="button" class="ls-link" data-drill-slips="' + esc(subject.id) + '">Drill ' +
        (sub.slip === 1 ? 'it' : 'them') + '</button></p>';
    }
    html += reviewCalendarHTML(subject.id);

    /* Physics extras */
    if (subject.id === 'physics') {
      html += '<div class="sec-title"><span class="t">Tools</span></div>';
      html += physicsToolsHTML(deck);
    }

    html += '</div>';
    return html;
  }

  /* Monthly review calendar for the subject: last ~5 months of reviewed
     counts from reviewLog + folded reviewMonths (design §7.5). */
  function reviewCalendarHTML(subjectId) {
    var s = PGRE.store.state;
    var log = s.cardReviews || [];
    var months = {};
    // folded months — state.reviewMonths: {YYYY-MM: {subject: {yR,yA,mR,mA}}}
    var folded = s.reviewMonths || {};
    Object.keys(folded).forEach(function (mk) {
      var row = folded[mk] && folded[mk][subjectId];
      if (row && ((row.yR || 0) + (row.mR || 0)) > 0) {
        months[mk] = (row.yR || 0) + (row.mR || 0);
      }
    });
    var byId = {};
    (PGRE.deck || []).forEach(function (c) { byId[c.id] = PGRE.cardSubject(c); });
    log.forEach(function (r) {
      if (r.n !== 1) return;          // real reviews only (re-reviews don't count)
      if ((byId[r.id] || PGRE.cardSubjectId(r.id)) !== subjectId) return;
      var mk = String(r.d || '').slice(0, 7);
      months[mk] = (months[mk] || 0) + 1;
    });
    var keys = Object.keys(months).sort();
    if (!keys.length) {
      return '<div class="card"><p class="muted">Review calendar — reviews land here month by month once the subject has been studied.</p></div>';
    }
    var html = '<div class="card"><h3 class="mem-h" style="margin-top:0">Review calendar</h3>' +
      '<table class="ls-tbl"><tbody>';
    keys.slice(-5).forEach(function (mk) {
      var p = mk.split('-');
      var name = new Date(+p[0], +p[1] - 1, 1)
        .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      html += '<tr><td>' + esc(name) + '</td><td class="n">' + fmt(months[mk]) +
        ' review' + (months[mk] === 1 ? '' : 's') + '</td></tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  /* ——— Wiring ——— */

  function wireHome(subject) {
    var rootEl = document.getElementById('subj-root');
    if (!rootEl) return;
    function addCard(btnId) {
      var b = document.getElementById(btnId);
      if (b) b.addEventListener('click', function () {
        if (PGRE.views.formulas && PGRE.views.formulas.armEditor) {
          PGRE.views.formulas.armEditor({ subject: subject.id });
        }
        location.hash = '#/formulas/cards';
      });
    }
    addCard('subj-add-card');
    addCard('subj-add-card-empty');

    var study = rootEl.querySelector('[data-study-subject]');
    if (study) study.addEventListener('click', function (e) {
      var s = PGRE.store.state.settings;
      s.recallSubject = subject.id;
      PGRE.store.save();
      if (PGRE.views.formulas && PGRE.views.formulas.armStudyFromFill) {
        PGRE.views.formulas.armStudyFromFill();
      }
      // href navigates to #/formulas
    });

    rootEl.querySelectorAll('.subj-card-list li').forEach(function (li) {
      function open() {
        var id = li.getAttribute('data-card');
        if (window.PGRE && PGRE.openVisualizerModal) PGRE.openVisualizerModal(id);
      }
      li.addEventListener('click', open);
      li.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
    });

    var drill = rootEl.querySelector('[data-drill-slips]');
    if (drill) drill.addEventListener('click', function () {
      var sid = drill.getAttribute('data-drill-slips');
      var mem = PGRE.subjectMemory(PGRE.deck || []);
      var ids = (mem.byId[sid] || { slipList: [] }).slipList;
      if (ids.length && PGRE.views.formulas && PGRE.views.formulas.armDrill) {
        PGRE.views.formulas.armDrill(ids);
        location.hash = '#/formulas';
      }
    });

    // Physics tools: QOTD + daily challenges render from the Today view's
    // building blocks (design §6.4 — same cards, new home).
    var qSlot = document.getElementById('subj-qotd-slot');
    if (qSlot && PGRE.views.dashboard && PGRE.views.dashboard.qotdCard) {
      qSlot.innerHTML = PGRE.views.dashboard.qotdCard();
      if (PGRE.views.dashboard.bindQotd) PGRE.views.dashboard.bindQotd();
    }
    var host = document.getElementById('subj-physics-challenges');
    if (host && PGRE.views.dashboard && PGRE.views.dashboard.challengesHTML) {
      host.innerHTML = PGRE.views.dashboard.challengesHTML();
      if (PGRE.views.dashboard.wireChallenges) PGRE.views.dashboard.wireChallenges(host);
    }
  }

  function cardsPageHTML(subject, deck) {
    var myCards = cardSort(deck.filter(function (c) {
      return PGRE.cardSubject(c) === subject.id;
    }));
    var html = '<div id="subj-root">' +
      '<div class="sec-head"><div><span class="kicker">' + esc(subject.name) + '</span>' +
      '<h1 class="h1 sm">All ' + fmt(myCards.length) + ' cards</h1>' +
      '<p class="lead">Sorted by next review — due first, then new cards.</p></div>' +
      '<div class="btn-row"><a class="btn btn-ghost" href="#/subject/' + esc(subject.id) + '">‹ ' + esc(subject.name) + '</a>' +
      '<a class="btn btn-ghost" href="#/formulas/browse">Find a card</a></div></div>' +
      '<div class="card">' + cardRowsHTML(myCards) + '</div></div>';
    return html;
  }

  /* ——— The view ——— */

  PGRE.views.subject = (function () {
    var deck = [];

    function subjectFromParams(params) {
      var id = (params && params.id) || 'physics';
      return PGRE.subjectById(id) || null;
    }

    return {
      render: function (params) {
        return '<div id="subject-root"><div class="card practice-card fcard-skeleton">' +
          '<div class="skel-bar" style="width:35%"></div>' +
          '<div class="skel-bar" style="width:82%"></div>' +
          '<div class="skel-bar" style="width:64%"></div></div></div>';
      },
      mount: function (params) {
        params = params || {};
        var subject = subjectFromParams(params);
        var host = document.getElementById('subject-root');
        if (!host) return;
        if (!subject) {
          host.innerHTML = '<div class="card"><h1>Unknown subject</h1>' +
            '<p class="muted">There is no subject with that id.</p></div>';
          return;
        }
        if (PGRE.motion && PGRE.motion.loader) PGRE.motion.loader.start();
        PGRE.formulaDeck().then(function (d) {
          deck = d || [];
          PGRE.deck = deck;
          if (!document.getElementById('subject-root')) return;
          if (params.sub === 'lab' && subject.id === 'physics') {
            if (PGRE.views.formulas && PGRE.views.formulas.renderLab) {
              PGRE.views.formulas.renderLab(deck, host);
            } else {
            }
          } else if (params.sub === 'cards') {
            host.innerHTML = cardsPageHTML(subject, deck);
            wireHome(subject);
          } else {
            var mem = PGRE.subjectMemory(deck);
            host.innerHTML = homeHTML(subject, deck, mem);
            wireHome(subject);
          }
          if (PGRE.typesetMath) PGRE.typesetMath(host);
          if (PGRE.motion && PGRE.motion.loader) PGRE.motion.loader.done();
          if (PGRE.motion && PGRE.motion.viewEnter) {
            PGRE.motion.viewEnter(document.getElementById('view'));
          }
        });
      },
      getDeck: function () { return deck; }
    };
  })();

  /* Exports for the Recall progress tab and Today tiles. */
  PGRE.subjectRecallHTML = recallBlockHTML;
  PGRE.subjectMemoryHTML = memoryBlockHTML;
  PGRE.subjectHzHTML = hzHTML;
  PGRE.subjectForecastHTML = forecastHTML;
})();
