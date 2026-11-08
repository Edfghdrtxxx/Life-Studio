/* App shell: hash router, sidebar nav, shared UI helpers, toasts, boot. */
window.PGRE = window.PGRE || {};
PGRE.views = PGRE.views || {};

/* ——— Shared UI helpers ——— */
PGRE.ui = {
  esc: function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  },
  fmt: function (n) { return Number(n).toLocaleString('en-US'); },

  segmentedMeter: function (segments, extraClass, opts) {
    opts = opts || {};
    segments = Array.isArray(segments) ? segments : [];
    var normalized = [];
    var total = 0;
    segments.forEach(function (seg, i) {
      if (typeof seg === 'number') seg = { value: seg };
      seg = seg || {};
      var value = Math.max(0, Number(seg.value) || 0);
      total += value;
      normalized.push({
        value: value,
        className: seg.className || (i === 0 ? 'meter-fill' : 'meter-segment'),
        label: seg.label || '',
        tip: seg.tip || '',
        dotClass: seg.dotClass || '',
        action: seg.action || '',
        aria: seg.aria || ''
      });
    });
    if (!total) total = 1;
    var layout = opts.layout === 'grow' ? 'grow' : 'width';
    var meterClass = 'meter meter--' + layout + (extraClass ? ' ' + extraClass : '');
    var now = opts.value == null ? (normalized[0] ? normalized[0].value : 0) : Number(opts.value) || 0;
    var html = '';
    if (opts.chrome || opts.word || opts.meta || opts.legend) {
      var pct = opts.percent == null ? Math.round(100 * now / (Number(opts.total) || total)) : opts.percent;
      html += '<div class="meter-chrome">' +
        '<div class="meter-chrome-head">' +
          '<div class="meter-chrome-stat"><span class="meter-chrome-pct">' + Math.max(0, Math.min(100, pct)) + '%</span>' +
            (opts.word ? ' <span class="meter-chrome-word">' + PGRE.ui.esc(opts.word) + '</span>' : '') +
          '</div>' +
          (opts.meta ? '<div class="meter-chrome-meta">' + PGRE.ui.esc(opts.meta) + '</div>' : '') +
        '</div>';
    }
    html += '<div class="' + meterClass + '" role="progressbar" aria-valuemin="0" aria-valuemax="' +
      (Number(opts.total) || total) + '" aria-valuenow="' + Math.max(0, now) + '">';
    normalized.forEach(function (seg) {
      if (seg.value <= 0 && seg.className.indexOf('meter-fill') < 0) return;
      var size = (100 * seg.value / total).toFixed(4) + '%';
      var cls = 'meter-segment ' + seg.className;
      var attrs = ' style="' + (layout === 'grow' ? 'flex-grow:' + seg.value : 'width:' + size) + '"';
      if (seg.label || seg.action) {
        attrs += ' tabindex="0" data-tip="' + PGRE.ui.esc(seg.tip || seg.label || seg.action) + '"';
      }
      if (seg.action) {
        attrs += ' role="button" data-seg-act="' + PGRE.ui.esc(seg.action) + '"' +
          ' aria-label="' + PGRE.ui.esc(seg.aria || seg.label || seg.action) + '"';
      }
      html += '<div class="' + cls + '"' + attrs + '></div>';
    });
    html += '</div>';
    var legend = opts.legend || normalized.filter(function (seg) { return seg.label; });
    if (legend.length) {
      html += '<div class="meter-legend' + (opts.legendClass ? ' ' + opts.legendClass : '') + '">';
      legend.forEach(function (seg) {
        var label = seg.label || '';
        var segTotal = Number(opts.total) || total;
        var segPct = seg.percent == null ? Math.round(100 * (Number(seg.value) || 0) / segTotal) : seg.percent;
        html += '<span class="meter-legend-item"><span class="meter-legend-dot ' +
          (seg.dotClass || '') + '" aria-hidden="true"></span>' + PGRE.ui.esc(label) +
          ' <strong>' + Math.max(0, Math.min(100, segPct)) + '%</strong></span>';
      });
      html += '</div>';
    }
    if (opts.chrome || opts.word || opts.meta || opts.legend) html += '</div>';
    return html;
  },

  meter: function (pct, extraClass, opts) {
    pct = Math.max(0, Math.min(100, Number(pct) || 0));
    return PGRE.ui.segmentedMeter([
      { value: pct, className: 'meter-fill' },
      { value: 100 - pct, className: 'meter-rest' }
    ], extraClass, Object.assign({ total: 100, value: pct }, opts || {}));
  },

  statTile: function (label, value, sub) {
    return '<div class="stat-tile">' +
             '<div class="stat-label">' + label + '</div>' +
             '<div class="stat-value">' + value + '</div>' +
             (sub ? '<div class="stat-sub">' + sub + '</div>' : '') +
           '</div>';
  },

  monogram: function (topic) {
    return '<span class="mono mono-' + topic.id + '">' + topic.short + '</span>';
  },

  /* Difficulty dots, clamped to 1–3: bank data outside the range degrades to
     an odd chip instead of a repeat() RangeError blanking the whole view. */
  diffDots: function (difficulty) {
    var d = Math.max(0, Math.min(3, (Number(difficulty) || 0) | 0));
    return '●'.repeat(d) + '○'.repeat(3 - d);
  },

  timeAgo: function (iso) {
    var s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    var d = Math.floor(s / 86400);
    return d === 1 ? 'yesterday' : d + ' days ago';
  },

  dateRange: function (start, end) {
    var opts = { month: 'short', day: 'numeric' };
    var s = new Date(start + 'T12:00:00').toLocaleDateString('en-US', opts);
    var e = new Date(end + 'T12:00:00').toLocaleDateString('en-US', opts);
    return s + ' – ' + e;
  },

  /* Select-then-commit for practice MCQ (drills, mistake book, QOTD).
     First click / A–E highlights; Confirm or double-click submits. A later
     single click on another choice retargets the pending pick. */
  bindChoiceCommit: function (root, opts) {
    opts = opts || {};
    var selected = null;
    var confirmId = opts.confirmId || 'confirm-btn';
    var confirmBtn = (root && root.querySelector) ? root.querySelector('#' + confirmId) : null;
    if (!confirmBtn) confirmBtn = document.getElementById(confirmId);

    function setConfirmEnabled(on) {
      if (!confirmBtn) return;
      confirmBtn.disabled = !on;
      if (on) confirmBtn.removeAttribute('disabled');
      else confirmBtn.setAttribute('disabled', 'disabled');
    }

    function paint() {
      if (!root || !root.querySelectorAll) return;
      root.querySelectorAll('.choice').forEach(function (b) {
        if (b.disabled) return;
        var i = parseInt(b.getAttribute('data-idx'), 10);
        var on = selected != null && i === selected;
        b.classList.toggle('is-picked', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      setConfirmEnabled(selected != null);
    }

    function select(idx) {
      if (idx == null || idx !== idx || idx < 0) return;
      selected = idx;
      paint();
    }

    function commit(idx) {
      if (idx == null) idx = selected;
      if (idx == null || idx !== idx || idx < 0) return;
      selected = idx;
      paint();
      if (typeof opts.onCommit === 'function') opts.onCommit(idx);
    }

    if (root && root.querySelectorAll) {
      root.querySelectorAll('.choice').forEach(function (b) {
        if (b.disabled) return;
        var down = false;
        function arm() { down = true; }
        b.addEventListener('pointerdown', arm);
        b.addEventListener('mousedown', arm);
        b.addEventListener('touchstart', arm);
        b.addEventListener('click', function (e) {
          if (b.disabled) return;
          var armed = down;
          down = false;
          // Trailing click of a double-click is not a pick — dblclick commits.
          if (e && e.detail > 1) return;
          // Next click-through: mousedown was on the old control, click lands
          // on this choice (detail >= 1, never armed). Synthetic .click()
          // (tests) has no detail and is allowed.
          if (!armed && e && e.detail >= 1) return;
          select(parseInt(b.getAttribute('data-idx'), 10));
        });
        b.addEventListener('dblclick', function (e) {
          if (e && e.preventDefault) e.preventDefault();
          if (b.disabled) return;
          commit(parseInt(b.getAttribute('data-idx'), 10));
        });
      });
    }
    if (confirmBtn) {
      confirmBtn.addEventListener('click', function () {
        if (confirmBtn.disabled) return;
        commit(selected);
      });
    }
    setConfirmEnabled(false);

    return { select: select, commit: commit, selected: function () { return selected; } };
  }
};

/* ——— Markdown + math rendering (vendored, fully offline) ———
   Imported book markdown comes from an external OCR pipeline and legitimately
   relies on raw-HTML passthrough for formatting (<sup>, <br>), so marked's
   output is run through an allowlist sanitizer before any caller injects it:
   unknown tags are unwrapped (their text kept), script-capable elements are
   dropped whole, and event-handler / script-URL attributes never survive. */
PGRE.renderMarkdown = (function () {
  var ALLOWED = { a: 1, b: 1, blockquote: 1, br: 1, code: 1, del: 1, div: 1,
                  em: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, hr: 1, i: 1,
                  img: 1, li: 1, ol: 1, p: 1, pre: 1, s: 1, small: 1, span: 1,
                  strong: 1, sub: 1, sup: 1, table: 1, tbody: 1, td: 1,
                  tfoot: 1, th: 1, thead: 1, tr: 1, u: 1, ul: 1 };
  var DROP = { base: 1, button: 1, embed: 1, form: 1, iframe: 1, input: 1,
               link: 1, math: 1, meta: 1, noscript: 1, object: 1, script: 1,
               select: 1, style: 1, svg: 1, template: 1, textarea: 1, title: 1 };
  var ATTRS = { align: 1, alt: 1, class: 1, colspan: 1, height: 1, href: 1,
                rowspan: 1, src: 1, start: 1, title: 1, width: 1 };

  function safeUrl(v) {
    return !/^(javascript|vbscript|data):/
      .test(String(v).replace(/[\s\u0000-\u001f]+/g, '').toLowerCase());
  }

  function scrub(node) {
    var kids = Array.prototype.slice.call(node.childNodes);
    kids.forEach(function (child) {
      if (child.nodeType === 8) { node.removeChild(child); return; } // comments
      if (child.nodeType !== 1) return;                              // text stays
      var tag = child.tagName.toLowerCase();
      if (DROP[tag]) { node.removeChild(child); return; }
      if (!ALLOWED[tag]) {           // unknown tag (e.g. a stray <E>): keep its text
        scrub(child);
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        node.removeChild(child);
        return;
      }
      Array.prototype.slice.call(child.attributes).forEach(function (a) {
        var name = a.name.toLowerCase();
        if (!ATTRS[name] || ((name === 'href' || name === 'src') && !safeUrl(a.value))) {
          child.removeAttribute(a.name);
        }
      });
      scrub(child);
    });
  }

  function sanitize(html) {
    var doc = new DOMParser().parseFromString(String(html), 'text/html');
    scrub(doc.body);
    return doc.body.innerHTML;
  }

  return function (text) {
    if (window.marked && marked.parse) {
      try { return sanitize(marked.parse(text)); } catch (e) { /* fall through */ }
    }
    return '<pre class="md-fallback">' + PGRE.ui.esc(text) + '</pre>';
  };
})();

/* Enter as a page shortcut. A view that gives Enter its own meaning (next
   question) asks this first: true when the reader has moved focus onto a
   link, a button, or a band heading with Tab, so Enter must press that
   control as the browser does. A control that holds focus after a pointer
   press does not count: Enter after a click on a choice or a toggle is the
   shortcut, and never presses that control a second time. */
(function () {
  var tabbed = false;
  document.addEventListener('keydown', function (e) { if (e.key === 'Tab') tabbed = true; }, true);
  document.addEventListener('pointerdown', function () { tabbed = false; }, true);
  PGRE.enterPressesControl = function () {
    var ae = document.activeElement;
    return tabbed && !!ae && /^(A|BUTTON|SUMMARY)$/.test(ae.tagName);
  };
})();

PGRE.typesetMath = function (el) {
  if (window.renderMathInElement) {
    try {
      renderMathInElement(el, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false }
        ],
        throwOnError: false,
        ignoredClasses: ['fcard-mnemonic'] // user mnemonics are plain text, never math
      });
    } catch (e) { /* math stays as source text */ }
  }
};

/* Formula-card imports contain prose as well as equations. Existing equations use
   $...$; this prepares the compact symbols in their prose for KaTeX without
   changing general site text or user mnemonics. */
PGRE.formulaTextHTML = function (text) {
  if (text == null || text === '') return '';
  var greek = {
    alpha: '\\alpha', beta: '\\beta', gamma: '\\gamma', delta: '\\delta',
    epsilon: '\\epsilon', zeta: '\\zeta', eta: '\\eta', theta: '\\theta',
    iota: '\\iota', kappa: '\\kappa', lambda: '\\lambda', mu: '\\mu',
    nu: '\\nu', xi: '\\xi', omicron: 'o', pi: '\\pi', rho: '\\rho',
    sigma: '\\sigma', tau: '\\tau', upsilon: '\\upsilon', phi: '\\phi',
    chi: '\\chi', psi: '\\psi', omega: '\\omega',
    Gamma: '\\Gamma', Delta: '\\Delta', Theta: '\\Theta', Lambda: '\\Lambda',
    Xi: '\\Xi', Pi: '\\Pi', Sigma: '\\Sigma', Upsilon: '\\Upsilon',
    Phi: '\\Phi', Psi: '\\Psi', Omega: '\\Omega',
    nabla: '\\nabla', hbar: '\\hbar'
  };
  // Notation suffixes written as words after a symbol: X-hat, X-dagger,
  // x-bar, phi-tilde, v-vec, X-squared, X-cubed, X-star, X-prime. The base is a
  // single letter or a named symbol (greek word or hbar). h-bar is Planck's
  // constant, not an overbar, so it is folded into the greek lookup above.
  var ACCENT_BASE = '([A-Za-z]|alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|omicron|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|nabla|hbar)';
  var DECOR = '((?:[_^](?:[A-Za-z0-9]+|\\{[^}]+\\}))*)';
  var accentSuffix = new RegExp('\\b' + ACCENT_BASE + DECOR +
    '(-(squared|cubed))?-(hat|bar|tilde|vec|dot|ddot|dagger|star|prime|double-prime|triple-prime|squared|cubed)' + DECOR + '\\b', 'g');
  function accentTeX(base, decor, sq, suffix) {
    var sym = greek[base] || base;
    var tail = sq === 'cubed' ? '^3' : sq === 'squared' ? '^2' : '';
    switch (suffix) {
      case 'hat': return '\\hat{' + sym + '}' + decor + tail;
      case 'bar': return base === 'h' ? '\\hbar' + decor : '\\bar{' + sym + '}' + decor + tail;
      case 'tilde': return '\\tilde{' + sym + '}' + decor + tail;
      case 'vec': return '\\vec{' + sym + '}' + decor + tail;
      case 'dot': return '\\dot{' + sym + '}' + decor + tail;
      case 'ddot': return '\\ddot{' + sym + '}' + decor + tail;
      case 'dagger': return sym + decor + '^{\\dagger}' + tail;
      case 'star': return sym + decor + '^*' + tail;
      case 'prime': return sym + decor + "'" + tail;
      case 'double-prime': return sym + decor + "''" + tail;
      case 'triple-prime': return sym + decor + "'''" + tail;
      case 'squared': return sym + decor + '^2';
      case 'cubed': return sym + decor + '^3';
    }
    return base + decor;
  }
  // Rewrite word-suffix and greek-word tokens inside a bra-ket's inner text so
  // <a|A-dagger b> and <psi|phi> typeset the way the same prose would.
  function innerMath(inner) {
    return inner
      .replace(accentSuffix, function (_, b, d, _sq, sq, s, post) { return accentTeX(b, d || '', sq, s) + (post || ''); })
      .replace(/\b(alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|omicron|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|nabla|hbar)\b/g,
        function (_, w) { return greek[w]; });
  }
  // Angle-bracket expectation/average and Dirac bra-ket notation: <P>_B, <S>,
  // <a|b>, <a|A-hat b>, or a split pair <x| ... |f>. Convert to $\langle...\rangle$
  // before splitting by <[^>]*> so they are not swallowed as unescaped HTML tags
  // (e.g. <S> parsed as a strikethrough, <a|...> as an <a> element). A pipe makes
  // the bracket unambiguous — no real HTML tag contains one — so inner products
  // may carry spaces; a bare <a href=...> still must not.
  var mathOrCodeBlock = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$]*?\$|<code\b[^>]*>[\s\S]*?<\/code>|<pre\b[^>]*>[\s\S]*?<\/pre>)/gi;
  var angleExp = /<([A-Za-z](?:[A-Za-z0-9_^*+()\\-]|\{[^}]*\})*(?:\|[A-Za-z0-9_^*+()\\ -]*[A-Za-z]-(?:hat|bar|tilde|vec|dot|ddot|dagger|star|prime|squared|cubed))?(?:\|[A-Za-z0-9_^*+()\\ -]*)?|\\[A-Za-z]+)>((?:_(?:[A-Za-z0-9]+|\{[^}]+\})|\^(?:[A-Za-z0-9]+|\{[^}]+\}))*)/g;
  var splitBra = /<([A-Za-z](?:[A-Za-z0-9_^*+()\\-]|\{[^}]*\})*)\|/g;
  var splitKet = /\|([A-Za-z](?:[A-Za-z0-9_^*+()\\-]|\{[^}]*\})*)>((?:_(?:[A-Za-z0-9]+|\{[^}]+\})|\^(?:[A-Za-z0-9]+|\{[^}]+\}))*)/g;
  var HTML_TAGS = {
    a: 1, b: 1, i: 1, p: 1, q: 1, s: 1, u: 1, em: 1, strong: 1, code: 1, pre: 1,
    div: 1, span: 1, blockquote: 1, table: 1, thead: 1, tbody: 1, tr: 1, td: 1,
    th: 1, ul: 1, ol: 1, li: 1, img: 1, hr: 1, br: 1, small: 1, sub: 1, sup: 1
  };

  text = String(text).split(mathOrCodeBlock).map(function (part) {
    if (!part || /^(?:\$\$[\s\S]*\$\$|\\\[[\s\S]*\\\]|\\\([\s\S]*\\\)|\$[^$]*\$|<(?:code|pre)\b)/i.test(part)) return part;
    var out = part.replace(angleExp, function (match, inner, decor) {
      if (!decor) {
        var lower = inner.toLowerCase();
        if (HTML_TAGS[lower]) {
          var hasClosing = new RegExp('</' + inner + '>', 'i').test(part);
          if (hasClosing || (/^[a-z]/.test(inner) && !/[_^|\\+-]/.test(inner) && lower !== 'x' && lower !== 'v')) {
            return match;
          }
        }
      }
      return '$\\langle ' + innerMath(inner) + ' \\rangle' + (decor || '') + '$';
    });
    // Split bra/ket pairs that carry prose between them: "<x| with a state |f>".
    // angleExp cannot span the words, so close each half on its own.
    out = out.replace(splitBra, function (_, inner) { return '$\\langle ' + innerMath(inner) + '|$'; });
    out = out.replace(splitKet, function (_, inner, decor) { return '$|' + innerMath(inner) + '\\rangle' + decor + '$'; });
    return out;
  }).join('');

  // Inline markdown bold: **text** -> <strong>text</strong>
  // Cards and formula references use **...** for emphasis. Protect math and code
  // blocks first so equations, multiplication symbols (*), or double-asterisk
  // notation inside math pass through untouched.
  var mathBlocks = [];
  text = text.replace(mathOrCodeBlock, function (m) {
    mathBlocks.push(m);
    return '\u0002MB' + (mathBlocks.length - 1) + '\u0002';
  });
  text = text.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\u0002MB(\d+)\u0002/g, function (_, i) {
    return mathBlocks[Number(i)];
  });

  var protectedPart = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$]*?\$|<[^>]*>)/g;
  function plain(part) {
    // The passes below run in sequence over one string, so a token an earlier
    // pass built is still ordinary prose to a later one: the standalone-symbol
    // pass would re-enter the "$x^0$" it was just handed — the x sits between
    // $ and ^, and both count as word boundaries — and emit "$$x$^0$", which
    // KaTeX rejects outright. (Subscripts escaped this only by accident, since
    // _ is a word character and so suppresses the boundary.) Park each finished
    // token behind a sentinel and restore them all at the end, so every pass
    // only ever sees prose no earlier pass has already claimed.
    var held = [];
    var HOLD = '\u0001';   // control char: cannot occur in prose, so no pass can re-match it
    var HELD_REF = /\u0001(\d+)\u0001/g;
    part = part.replace(/\u0001/g, '');   // so every sentinel below is one we wrote
    function mathToken(tex) {
      // A later pass can swallow an earlier token whole — the braced sub/superscript
      // forms match across anything, sentinel included — so splice those bodies in
      // here. The restore below is one non-rescanning replace, and a sentinel buried
      // inside another token would survive it raw.
      tex = tex.replace(HELD_REF, function (m, i) { return i in held ? held[i] : m; });
      return HOLD + (held.push(tex) - 1) + HOLD;
    }

    // Word-suffix operator decorations: X-hat, A-dagger, x-bar, phi-tilde,
    // v-vec, q-dot, L-squared, x-cubed, A-star, x-prime, plus pre-suffix
    // powers (L-squared-hat). Must run before the greek/letter passes, which
    // would otherwise claim the base and hand back "$H$-hat"/"$A$-dagger".
    // h-bar folds to \hbar, never an overbar. A trailing hyphen-letter pair
    // means a product (L-dot-S), not an accent, so products run first.
    part = part.replace(new RegExp('\\b' + ACCENT_BASE + '-dot-' + ACCENT_BASE + '\\b', 'g'),
      function (_, left, right) {
        return mathToken((greek[left] || left) + ' \\cdot ' + (greek[right] || right));
      });
    // Time derivatives written q-dot / q-ddot / q-dot_i.
    part = part.replace(/\b([A-Za-z]+)-(d?dot)(_(?:[A-Za-z0-9]+|\{[^}]+\}))?(?![\w-])/g,
      function (_, name, kind, sub) {
        var base = greek[name] || name;
        var cmd = kind === 'ddot' ? '\\ddot' : '\\dot';
        return mathToken(cmd + '{' + base + '}' + (sub || ''));
      });
    part = part.replace(accentSuffix,
      function (_, base, decor, _sq, sq, suffix, post) {
        return mathToken(accentTeX(base, decor || '', sq, suffix) + (post || ''));
      });
    // Subscript/superscript written as words: x-sub-0, E-sup-2.
    part = part.replace(new RegExp('\\b' + ACCENT_BASE + '-(sub|sup)-([A-Za-z0-9]+)\\b', 'g'),
      function (_, name, kind, arg) {
        var base = greek[name] || name;
        return mathToken(base + (kind === 'sub' ? '_' : '^') + arg);
      });
    // Bare primes on a symbol: x', t'', S' (frame names). The base must be a
    // single letter or named symbol so English possessives and contractions
    // ('s, particles') never reach this pass.
    part = part.replace(new RegExp('\\b' + ACCENT_BASE + DECOR + "('{1,3})(?![\\w'])", 'g'),
      function (_, name, decor, ticks) {
        var base = greek[name] || name;
        return mathToken(base + (decor || '') + ticks);
      });
    // Parenthesized greek/letter groups carrying an exponent: (Delta x)^2.
    part = part.replace(/\(([A-Za-z]+(?: [A-Za-z]+)*)\)\^(\d+)/g,
      function (_, inner, pow) {
        return mathToken('(' + innerMath(inner) + ')^' + pow);
      });
    // A letter glued to digits is a subscript: n1, n2 -> n_1, n_2.
    part = part.replace(/\b([A-Za-z])([0-9]+)\b/g,
      function (_, name, digits) { return mathToken(name + '_' + digits); });
    // Spin raising/lowering and similar signed operators: S+, S-, J_+.
    part = part.replace(/\b([A-Za-z])((?:[_^](?:[A-Za-z0-9]+|\{[^}]+\}))*)([+-])(?![\w+-])/g,
      function (_, name, decor, sign) {
        return mathToken(name + (decor || '') + '_{' + sign + '}');
      });


    // Handle named Greek variants first so tau_0 is one mathematical span.
    // Tolerates an optional leading backslash in prose (\omega -> $\omega$).
    part = part.replace(/\\?\b(alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|omicron|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|nabla|hbar)(?:_([A-Za-z0-9]+|\{[^}]+\})|\^([A-Za-z0-9]+|\{[^}]+\}))?('?)(\/\d+)?\b/g,
      function (_, name, sub, sup, tick, frac) {
        return mathToken(greek[name] + (sub ? '_' + sub : '') + (sup ? '^' + sup : '') + (tick || '') + (frac || ''));
      });
    // A subscript/superscript makes a one-letter token unambiguously mathematical.
    // A chain such as Y_l^m takes both scripts; stopping after the first leaves "^m" as prose.
    part = part.replace(/\b([A-Za-z])((?:_(?:[A-Za-z0-9]+|\{[^}]+\})|\^(?:[A-Za-z0-9]+|\{[^}]+\}))+)('?)(\/\d+)?\b/g,
      function (_, base, decoration, tick, frac) { return mathToken(base + decoration + (tick || '') + (frac || '')); });
    // These are common standalone physics variables; omit prose words such as a,
    // an, and I so the formula-card prompt remains readable. Sentence-initial
    // 'A' (article) and 'I' (pronoun) followed by a lowercase word are prose —
    // "A particle with charge q…", "I still forget…" — while a variable in the
    // same slot is followed by math: an operator, a unit, another symbol.
    // The start of a part counts as a sentence start: a part begins right after
    // a tag or a math span, such as a display block. The article also comes
    // before an acronym or a name ("A DC source", "A Michelson"), "A 3D", or
    // inline math ("A $\nu_e$", which ends this part). A page reference "p.43"
    // / "p. 43" and the X of "X-ray" are words, not symbols.
    part = part.replace(/\b([A-Z]|[txyzvwrmEgFBpq])\b/g,
      function (m, symbol, offset, str) {
        var after = str.slice(offset + 1);
        // JS \b treats an accented letter as a non-word character, so the M of
        // "Mössbauer" looks like a lone symbol; a letter beside it makes it a word.
        if (/^[À-ɏ]/.test(after) || /[À-ɏ]$/.test(str.slice(0, offset))) return m;
        if (symbol === 'p' && /^\.\s?\d/.test(after)) return m;
        if ((symbol === 'X' || symbol === 'x') && /^-ray/.test(after)) return m;
        if ((symbol === 'A' || symbol === 'I') &&
            /(?:^|[.!?…,;:]|\n)\s*$/.test(str.slice(0, offset)) &&
            (/^\s+[a-z]/.test(after) ||
             (symbol === 'A' && /^\s+(?:[A-Za-z0-9]{2,}|$)/.test(after)))) return m;
        return mathToken(symbol);
      });
    // Bodies are parked bare so they nest cleanly; the delimiters go on last.
    return part.replace(HELD_REF,
      function (m, i) { return i in held ? '$' + held[i] + '$' : m; });
  }

  var parts = String(text).split(protectedPart);
  var codeDepth = 0;
  return parts.map(function (part) {
    if (!part) return part;
    if (part.charAt(0) === '<') {
      if (/^<(code|pre)\b/i.test(part)) codeDepth++;
      else if (/^<\/(code|pre)\b/i.test(part) && codeDepth) codeDepth--;
      return part;
    }
    if (/^(?:\$\$[\s\S]*\$\$|\\\[[\s\S]*\\\]|\\\([\s\S]*\\\)|\$[^$]*\$)$/.test(part)) return part;
    return codeDepth ? part : plain(part);
  }).join('');
};
/* Book-style equation number on a formula card's answer: KaTeX's own \tag puts
   "(2.1)" in the display block's right margin, so no CSS positioning is needed.
   Returns a COPY — never write this back onto the card or the deck file, since
   js/flashmodes.js builds distractors, match keys and cloze offsets out of the
   raw c.back (normText, stripLegend, perturbLatex, clozeParts) and would read
   the tag as part of the formula. \tag is display-only and cannot be doubled,
   so anything that isn't a single leading $$…$$ block (leading whitespace
   tolerated) passes through untouched. */
PGRE.formulaBackTagged = function (back, eq) {
  if (!back || !eq) return back || '';
  var s = String(back);
  var lead = /^\s*/.exec(s)[0].length;
  if (s.slice(lead).indexOf('$$') !== 0) return s;   // inline math: \tag would be a ParseError
  var end = s.indexOf('$$', lead + 2);
  if (end < 0) return s;                    // unterminated block — leave it alone
  var body = s.slice(lead + 2, end);
  if (/\\tag\b/.test(body)) return s;       // "Multiple \tag" is also a ParseError
  // KaTeX supplies the parentheses itself, so the bare number goes in. Leading
  // whitespace before the $$ is preserved, not eaten.
  return s.slice(0, lead) + '$$' + body +
    '\\tag{' + String(eq).replace(/[{}\\$]/g, '') + '}' + s.slice(end);
};

/* ——— Toasts ——— */
PGRE.toast = function (html, kind, sticky) {
  var box = document.getElementById('toasts');
  if (!box) return null;
  var el = document.createElement('div');
  el.className = 'toast toast-' + (kind || 'info');
  el.innerHTML = html;
  el.title = 'Dismiss';
  box.appendChild(el);
  requestAnimationFrame(function () { el.classList.add('show'); });
  var timer = null;
  var dismissed = false;
  var dismiss = function () {
    if (dismissed) return;
    dismissed = true;
    if (timer) { clearTimeout(timer); timer = null; }
    el.classList.remove('show');
    setTimeout(function () { el.remove(); }, 350);
  };
  el.addEventListener('click', dismiss);
  if (!sticky) timer = setTimeout(dismiss, 4200); // sticky stays until clicked
  return el;
};

/* ——— Post-answer self-assessment (practice sessions + mistake drills) ———
   A multi-select chip row in the feedback block after every answer:
   Knew it / Guessed (mutually exclusive) plus Too slow / Forgot something /
   Keep failing (combine freely with anything). Every tap re-stamps the newest
   attempt row (srs.setLastAssess), keeps the lucky-guess and keep-failing
   bookkeeping in sync, and rewrites the review date from this answer's base
   (srs.applyAssessSchedule). Knew it leaves that date.
   Guessed and Too slow halve the remaining wait once (minimum tomorrow).
   Forgot something and Keep failing bring a future review back to tomorrow.
   Unpicking restores the base. No extra attempt, miss, or XP. Tapping an active chip
   un-picks it. The chips stay editable until the next question. */
PGRE.assess = (function () {
  var OPTIONS = [
    { key: 'sure',   label: 'Knew it',          kbd: 'K' },
    { key: 'guess',  label: 'Guessed',          kbd: 'G' },
    { key: 'slow',   label: 'Too slow',         kbd: 'T' },
    { key: 'forgot', label: 'Forgot something', kbd: 'F' },
    { key: 'stuck',  label: 'Keep failing',     kbd: 'R' }
  ];
  var LABELS = {};
  OPTIONS.forEach(function (o) { LABELS[o.key] = o.label; });

  function stuckButtonAttrs() {
    return ' aria-controls="assess-stuck-confirm" aria-expanded="false"' +
      ' title="Use for repeated difficulty. This flags the problem for mistake-book retakes."';
  }

  function stuckConfirmHTML() {
    return '<div class="danger-confirm" id="assess-stuck-confirm" role="group"' +
        ' aria-labelledby="assess-stuck-title" aria-describedby="assess-stuck-hint" hidden>' +
        '<strong id="assess-stuck-title">Mark this problem as Keep failing?</strong>' +
        '<p class="muted" id="assess-stuck-hint">Use this for repeated difficulty, not a one-off slip. ' +
          'This flags it in your mistake book for future retakes.</p>' +
        '<div class="btn-row">' +
          '<button type="button" class="btn btn-primary btn-sm" id="assess-stuck-yes">Confirm</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" id="assess-stuck-cancel">Cancel</button>' +
        '</div>' +
      '</div>';
  }

  var pendingEscape = null;

  function bindStuckConfirm(container) {
    var confirmation = container.querySelector('#assess-stuck-confirm');
    var source = null, onConfirm = null;

    function close() {
      confirmation.hidden = true;
      if (source) {
        source.setAttribute('aria-expanded', 'false');
        if (source.isConnected) source.focus();
      }
      onConfirm = null;
    }

    function onPendingEscape(e) {
      if (!confirmation.isConnected) {
        document.removeEventListener('keydown', onPendingEscape, true);
        if (pendingEscape === onPendingEscape) pendingEscape = null;
        return;
      }
      if (e.key !== 'Escape' || confirmation.hidden) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    }

    if (confirmation) {
      confirmation.querySelector('#assess-stuck-yes').addEventListener('click', function () {
        if (confirmation.hidden || !confirmation.isConnected || !source || !source.isConnected || !onConfirm) return;
        var action = onConfirm;
        close();
        action();
      });
      confirmation.querySelector('#assess-stuck-cancel').addEventListener('click', close);
      confirmation.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      });
      if (pendingEscape) document.removeEventListener('keydown', pendingEscape, true);
      pendingEscape = onPendingEscape;
      document.addEventListener('keydown', onPendingEscape, true);
    }

    return function (button, action) {
      if (!confirmation || !confirmation.isConnected || !button.isConnected) return;
      if (source) source.setAttribute('aria-expanded', 'false');
      source = button;
      onConfirm = action;
      confirmation.hidden = false;
      source.setAttribute('aria-expanded', 'true');
      confirmation.querySelector('#assess-stuck-yes').focus();
    };
  }

  var IDLE_NOTE = 'pick any that apply';
  var REVIEW_NOTE = 'tap to change your grading';

  /* opts.review: the row on a review-result page. Same chips and the same
     writes; it adds the review-window strip (what the wait was, what it is
     now) and words the idle note as a regrade. */
  function html(showKeys, opts) {
    var review = !!(opts && opts.review);
    var h = '<div class="conf-row assess-row' + (review ? ' assess-review' : '') + '" id="assess-row"' +
      (review ? ' data-idle-note="' + REVIEW_NOTE + '"' : '') + '>' +
      '<span class="conf-q">How did it go?</span>';
    OPTIONS.forEach(function (o) {
      h += '<button type="button" class="focus-chip assess-chip' +
        (o.key === 'stuck' ? ' assess-stuck' : '') + '" data-assess="' + o.key +
        '" aria-pressed="false"' + (o.key === 'stuck' ? stuckButtonAttrs() : '') + '>' + o.label +
        (showKeys ? ' <span class="key-hint">' + o.kbd + '</span>' : '') + '</button>';
    });
    if (review) {
      h += '<div class="assess-window" id="assess-window" role="status" aria-live="polite">' +
        '<span class="aw-label">Next review</span>' +
        '<span class="aw-value">' +
          '<span class="aw-from" id="assess-window-from" hidden></span>' +
          '<span class="aw-arrow" id="assess-window-arrow" aria-hidden="true" hidden>→</span>' +
          '<strong class="aw-to" id="assess-window-to"></strong>' +
        '</span>' +
        '<span class="aw-date" id="assess-window-date"></span>' +
      '</div>';
    }
    h += '<span class="assess-note muted" id="assess-note">' + (review ? REVIEW_NOTE : IDLE_NOTE) +
      '</span></div>' + stuckConfirmHTML();
    return h;
  }

  /* The attempt row a regrade would stamp, or null when it must stay read
     only. srs.setLastAssess stamps the newest row for the question and the
     review date belongs to that newest answer, so an older answer (the
     question was answered again since) is not regradable from its own page. */
  function regradeRow(qid, row) {
    if (!row) return null;
    var arr = (PGRE.store.state && PGRE.store.state.attempts) || [];
    for (var i = arr.length - 1; i >= 0; i--) {
      var a = arr[i];
      if (!a || a.qid !== qid) continue;
      return (a === row || (a.ts === row.ts && a.sid === row.sid)) ? a : null;
    }
    return null;
  }

  function flagsFromRow(row) {
    var flags = { sure: false, guess: false, slow: false, forgot: false, stuck: false };
    if (!row) return flags;
    if (row.confidence === 'sure') flags.sure = true;
    if (row.confidence === 'guess') flags.guess = true;
    (row.tags || []).forEach(function (tg) { if (tg in flags) flags[tg] = true; });
    return flags;
  }

  /* "Correct" plus the live review interval, when this answer has one.
     The phrase starts hidden when nothing is scheduled yet; a later chip
     that files a ladder (Guessed, Keep failing) reveals it. */
  function reviewTitle(qid) {
    var when = '';
    var mk = PGRE.store.state.mistakes && PGRE.store.state.mistakes[qid];
    if (mk && mk.srs && mk.srs.due && PGRE.srs && typeof PGRE.srs.ivlLabel === 'function') {
      when = PGRE.srs.ivlLabel(PGRE.srs.daysUntil(mk.srs.due));
    }
    var hidden = when ? '' : ' hidden';
    return 'Correct<span id="next-review-phrase"' + hidden +
      '> — next review in <span id="next-review-label">' + when + '</span></span>';
  }

  /* Wire a freshly rendered row for question q. requestToggle is the click
     and shortcut path (Keep failing asks first). hydrate paints a saved row
     and does not write; toggle is the only path that files or saves. */
  function bind(container, q, isCorrect) {
    var row = container.querySelector('#assess-row');
    if (!row) return { toggle: function () {}, requestToggle: function () {}, hydrate: function () {} };
    var on = { sure: false, guess: false, slow: false, forgot: false, stuck: false };
    var luckyFiled = false, stuckFiled = false;
    var stuckButton = row.querySelector('[data-assess="stuck"]');
    var controller = { toggle: toggle, requestToggle: requestToggle, hydrate: hydrate };
    var requestStuck = bindStuckConfirm(container);

    function requestToggle(key) {
      if (key === 'stuck' && !on.stuck) {
        requestStuck(stuckButton, function () { controller.toggle('stuck'); });
        return;
      }
      controller.toggle(key);
    }

    function paint() {
      row.querySelectorAll('[data-assess]').forEach(function (b) {
        var k = b.getAttribute('data-assess');
        b.classList.toggle('active', !!on[k]);
        b.setAttribute('aria-pressed', on[k] ? 'true' : 'false');
      });
      var note = row.querySelector('#assess-note');
      if (note) {
        var parts = [];
        if (luckyFiled) parts.push('filed as a lucky guess in your mistake book');
        if (stuckFiled) parts.push('flagged keep failing in your mistake book');
        note.textContent = parts.length ? parts.join(' · ')
          : (row.getAttribute('data-idle-note') || IDLE_NOTE);
      }
    }

    /* Review-window strip (review rows only), painted from storage like the
       banner. Unchanged: the wait alone. Moved by a chip: the answer's own
       wait struck through, then the wait now. A change pulses once. */
    var unscheduledAtBind = !(PGRE.srs && typeof PGRE.srs.assessWindow === 'function' &&
                              PGRE.srs.assessWindow(q.id));
    function paintWindow(announce) {
      var box = row.querySelector('#assess-window');
      if (!box || !PGRE.srs || typeof PGRE.srs.assessWindow !== 'function') return;
      var from = box.querySelector('#assess-window-from');
      var arrow = box.querySelector('#assess-window-arrow');
      var to = box.querySelector('#assess-window-to');
      var date = box.querySelector('#assess-window-date');
      var win = PGRE.srs.assessWindow(q.id);
      var was = '', now = 'not scheduled', when = '';
      if (win) {
        now = PGRE.srs.ivlLabel(win.days);
        if (win.changed) was = PGRE.srs.ivlLabel(win.baseDays);
        else if (unscheduledAtBind) was = 'not scheduled';
        try {
          when = new Date(win.due + 'T12:00:00').toLocaleDateString(undefined,
            { weekday: 'short', month: 'short', day: 'numeric' });
        } catch (e) { when = win.due; }
      }
      var before = box.getAttribute('data-window');
      var sig = was + '>' + now;
      from.textContent = was;
      from.hidden = arrow.hidden = !was;
      to.textContent = now;
      date.textContent = when;
      box.classList.toggle('is-moved', !!was);
      box.classList.toggle('is-unscheduled', !win);
      box.setAttribute('data-window', sig);
      box.setAttribute('aria-label', 'Next review ' + (was ? 'was ' + was + ', now ' : '') + now +
        (when ? ', ' + when : ''));
      if (announce && before !== sig) {
        box.classList.remove('is-pulse');
        void box.offsetWidth;   // restart the pulse when two taps land back to back
        box.classList.add('is-pulse');
      }
    }

    function commit() {
      var conf = on.sure ? 'sure' : on.guess ? 'guess' : null;
      var tags = [];
      if (on.slow) tags.push('slow');
      if (on.forgot) tags.push('forgot');
      if (on.stuck) tags.push('stuck');
      PGRE.srs.setLastAssess(q.id, conf, tags);
    }

    /* The banner is painted from storage. After a chip changes the due date,
       rewrite the same phrase so the label cannot lag the schedule. */
    function paintReviewLabel() {
      var phrase = container.querySelector('#next-review-phrase');
      var label = container.querySelector('#next-review-label');
      if (!phrase || !label || !PGRE.srs || typeof PGRE.srs.ivlLabel !== 'function') return;
      var mk = PGRE.store.state.mistakes && PGRE.store.state.mistakes[q.id];
      var when = mk && mk.srs && mk.srs.due
        ? PGRE.srs.ivlLabel(PGRE.srs.daysUntil(mk.srs.due)) : '';
      if (!when) {
        phrase.hidden = true;
        label.textContent = '';
        return;
      }
      label.textContent = when;
      phrase.hidden = false;
    }

    /* Saved chips only. Mirrors toggle's mutual exclusion and remembers which
       filings already exist so a later tap does not re-file them. */
    function hydrate(flags) {
      flags = flags || {};
      Object.keys(on).forEach(function (k) { on[k] = false; });
      Object.keys(on).forEach(function (k) {
        if (!flags[k]) return;
        on[k] = true;
        if (k === 'sure') on.guess = false;
        if (k === 'guess') on.sure = false;
      });
      luckyFiled = !!(isCorrect && on.guess);
      stuckFiled = !!on.stuck;
      paint();
      paintWindow(false);
    }

    function toggle(key) {
      if (!(key in on)) return;
      on[key] = !on[key];
      if (key === 'sure' && on.sure) on.guess = false;
      if (key === 'guess' && on.guess) on.sure = false;
      // Lucky-guess bookkeeping applies to correct answers only (a wrong
      // answer already filed a real mistake-book entry when it was recorded).
      if (isCorrect) {
        var luckyChanged = false;
        if (on.guess && !luckyFiled) {
          PGRE.srs.markLucky(q.id); luckyFiled = true; luckyChanged = true;
        } else if (!on.guess && luckyFiled) {
          PGRE.srs.unmarkLucky(q.id); luckyFiled = false; luckyChanged = true;
        }
        if (on.sure) PGRE.srs.clearLucky(q.id); // knew it for real — retire stale flags
        if (luckyChanged) PGRE.refreshNavBadges();
      }
      // Keep failing applies to any answer — it flags the mistake-book entry
      // itself (creating one when needed), the way Guessed files a lucky guess.
      if (on.stuck && !stuckFiled) {
        PGRE.srs.markStuck(q.id); stuckFiled = true;
        PGRE.refreshNavBadges();
      } else if (!on.stuck && stuckFiled) {
        PGRE.srs.unmarkStuck(q.id); stuckFiled = false;
        PGRE.refreshNavBadges();
      }
      if (typeof PGRE.srs.applyAssessSchedule === 'function') PGRE.srs.applyAssessSchedule(q.id, on);
      commit();
      paint();
      paintReviewLabel();
      paintWindow(true);
    }

    row.querySelectorAll('[data-assess]').forEach(function (b) {
      b.addEventListener('click', function () { requestToggle(b.getAttribute('data-assess')); });
    });
    paintWindow(false);

    return controller;
  }

  return { OPTIONS: OPTIONS, LABELS: LABELS, html: html, reviewTitle: reviewTitle, bind: bind,
    regradeRow: regradeRow, flagsFromRow: flagsFromRow,
    stuckButtonAttrs: stuckButtonAttrs, stuckConfirmHTML: stuckConfirmHTML, bindStuckConfirm: bindStuckConfirm };
})();

/* store.save() failure hook: a sticky warning while progress cannot be
   persisted (storage full or blocked), cleared once a save succeeds again. */
PGRE.persistWarning = (function () {
  var el = null;
  return function (failing) {
    if (failing) {
      if (!el || !el.isConnected) {
        el = PGRE.toast('Saving failed — browser storage may be full. Recent progress ' +
          'is <b>not</b> being recorded. Back up from the Library page, then free up space.',
          'error', true);
      }
    } else {
      if (el && el.isConnected) el.click();
      el = null;
      PGRE.toast('Saving works again — your progress is being recorded.', 'info');
    }
  };
})();

/* A grade or undo press whose save failed even after one retry: the card
   stays, and this says the press itself was not recorded. One at a time. */
PGRE.pressNotRecorded = (function () {
  var el = null;
  return function () {
    if (el && el.isConnected) el.remove();
    el = PGRE.toast('That press was <b>not</b> recorded — saving failed. ' +
      'Free up browser storage, then press again.', 'error');
  };
})();

/* ——— Finder-style breadcrumb top bar (BUNDLE G) ———
   A slim bar at the top of #main on every route: ◀ ▶ history arrows (wired at
   boot to history.back()/forward(), always enabled) + a clickable breadcrumb
   trail. route() calls PGRE.nav.route() on every navigation to derive the base
   trail from the current route and repaint the bar; a view may append deeper
   crumbs for an in-view state (formulas "Study" / "Choose new cards", mistakes
   "Drill") via PGRE.nav.setTrail(extra). Those refinements reset naturally on
   the next hashchange because route() rebuilds the base from scratch. */
PGRE.nav = (function () {
  // Human labels for each sidebar route, keyed by the router's view name. These
  // match the sidebar wording exactly (esc'd at paint time).
  var LABELS = {
    plan: 'Exam archive', history: 'History', analytics: 'Analytics',
    build: 'Custom quiz', search: 'Search', notes: 'Notes & bookmarks',
    mistakes: 'Mistake book', formulas: 'Recall',
    concepts: 'Concept visualization',
    focus: 'Focus timer',
    studytime: 'Study time', achievements: 'Achievements', library: 'Library',
    exam: 'Mock exams', settings: 'Settings'
  };
  var HREF = {
    plan: '#/plan', history: '#/history', analytics: '#/analytics',
    build: '#/build', search: '#/search', notes: '#/notes',
    mistakes: '#/mistakes', formulas: '#/formulas',
    concepts: '#/concepts',
    focus: '#/focus',
    studytime: '#/study-time', achievements: '#/achievements',
    library: '#/library', exam: '#/exam', settings: '#/settings'
  };
  // Router view names that belong to the Physics subject — their base trail
  // carries a "Physics" ancestor crumb pointing at the subject home, and the
  // sidebar's physics sub-nav stays open while they are on screen.
  var PHYSICS_VIEWS = { topic: 1, practice: 1, mistakes: 1, history: 1,
    analytics: 1, concepts: 1, exam: 1, plan: 1, build: 1, notes: 1,
    library: 1, search: 1 };

  var base = [{ label: 'Home', href: '#/' }];   // base trail for the active route

  // Render a trail: every crumb except the last is an <a>; the last (current
  // page) is plain text with aria-current. A crumb with no href is never a link.
  function paint(trail) {
    var el = document.getElementById('breadcrumbs');
    if (!el) return;
    // Delegated once on the stable #breadcrumbs container (paint only swaps its
    // innerHTML, so this survives repaints). The in-view deep states — the formula
    // Study session and "Choose new cards" picker (both at #/formulas) and the
    // mistake Drill (at #/mistakes) — are entered WITHOUT a hash change, so an
    // ancestor crumb whose href equals the current hash would assign the same
    // fragment and fire NO hashchange: the router never reruns and the deep state
    // never clears. Detect that exact case and force a re-route, which re-mounts
    // the base view (settling/clearing the deep state) and rebuilds the base trail.
    // Letter-swap wraps crumb glyphs in spans, so resolve the <a> via closest.
    if (!el._pgreCrumbBound) {
      el._pgreCrumbBound = true;
      el.addEventListener('click', function (e) {
        var a = e.target;
        if (a && a.closest) a = a.closest('a');
        if (!a || a.tagName !== 'A') return;
        if (el.contains && !el.contains(a)) return;
        var href = a.getAttribute('href');
        if (href && href.charAt(0) === '#' && href === location.hash) {
          e.preventDefault();
          PGRE.route();
        }
      });
    }
    var ui = PGRE.ui, h = '';
    trail.forEach(function (c, i) {
      var last = i === trail.length - 1;
      if (i) h += '<span class="crumb-sep" aria-hidden="true">▸</span>';
      if (last) {                       // current page — emphasised, never a link
        h += '<span class="crumb crumb-here" aria-current="page">' + ui.esc(c.label) + '</span>';
      } else if (c.href) {              // ancestor with a destination
        h += '<a class="crumb" href="' + c.href + '">' + ui.esc(c.label) + '</a>';
      } else {                          // ancestor with no page (e.g. "All topics")
        h += '<span class="crumb">' + ui.esc(c.label) + '</span>';
      }
    });
    el.innerHTML = h;
    if (PGRE.motion && typeof PGRE.motion.letterSwapNav === 'function') {
      PGRE.motion.letterSwapNav(el);
    }
  }

  return {
    // Rebuild the base trail from the freshly-routed view + params and paint it.
    // Called by route() on every navigation.
    route: function (view, params) {
      var trail = [{ label: 'Home', href: '#/' }];
      params = params || {};
      if (view === 'dashboard') {
        /* Home alone. */
      } else if (view === 'subject') {
        var s = PGRE.subjectById(params.id);
        trail.push({ label: s ? s.name : 'Subject' });
        if (params.sub === 'cards') trail.push({ label: 'All cards' });
        else if (params.sub === 'lab') trail.push({ label: 'Visualizers' });
      } else if (view === 'topic') {
        trail.push({ label: 'Physics', href: '#/subject/physics' });
        var t = PGRE.topicById(params.id);
        trail.push({ label: t ? t.name : 'Topic' });
      } else if (view === 'practice' && params.id === 'session' && params.sub2) {
        trail.push({ label: 'Physics', href: '#/subject/physics' });
        trail.push({ label: 'History', href: '#/history' });
        trail.push({ label: 'Practice' });
      } else if (view === 'practice') {
        trail.push({ label: 'Physics', href: '#/subject/physics' });
        var pt = params.id && params.id !== 'all' ? PGRE.topicById(params.id) : null;
        trail.push(pt ? { label: pt.name, href: '#/topic/' + pt.id }
                      : { label: 'All topics' });
        // sub2 carries the portal's done-status filter (#/practice/<id>/new|done)
        trail.push({ label: params.sub2 === 'new' ? 'Practice · not yet done'
                          : params.sub2 === 'done' ? 'Practice · done before'
                          : 'Practice' });
      } else if (view === 'mistakes' && params.sub === 'drill' && params.sub2) {
        trail.push({ label: 'Physics', href: '#/subject/physics' });
        trail.push({ label: 'History', href: '#/history' });
        trail.push({ label: 'Drill' });
      } else if (view === 'wiki') {
        var wp = PGRE.wikiPage ? PGRE.wikiPage(params.id) : null;
        trail.push({ label: 'Wiki', href: '#/wiki/' + params.id });
        trail.push({ label: wp ? wp.title : 'Wiki' });
      } else if (LABELS[view]) {
        if (PHYSICS_VIEWS[view]) trail.push({ label: 'Physics', href: '#/subject/physics' });
        trail.push({ label: LABELS[view], href: HREF[view] });
        if (view === 'exam' && params.sub === 'run') trail.push({ label: 'Run' });
        else if (view === 'exam' && params.sub === 'review') trail.push({ label: 'Review' });
        else if (view === 'mistakes' && params.sub === 'drill') trail.push({ label: 'Drill' });
        else if (view === 'concepts' && params.sub === 'search') trail.push({ label: 'Search' });
        else if (view === 'concepts' && params.sub === 'visualizers') trail.push({ label: 'Visualizers' });
        else if (view === 'concepts' && (params.sub === 'spherical' || params.sub === 'azimuth')) {
          trail.push({ label: 'Concepts', href: '#/concepts/spherical' });
          if (params.sub === 'azimuth') trail.push({ label: 'Direction of azimuth' });
          else trail.push({ label: 'Spherical coordinates' });
        }
        else if (view === 'concepts' && params.sub === 'single-slit') {
          trail.push({ label: 'Visualizers', href: '#/concepts/visualizers' });
          trail.push({ label: 'Single-slit diffraction: what is θ?' });
        }
      }
      base = trail;
      paint(base);
    },

    // A view appends deeper crumbs for an in-view state. `extra` is an array of
    // label strings (or {label,href} objects); passing [] / nothing resets to
    // the base trail. Kept a one-liner at each view-internal transition.
    setTrail: function (extra) {
      var trail = base.slice();
      (extra || []).forEach(function (c) {
        trail.push(typeof c === 'string' ? { label: c } : c);
      });
      paint(trail);
    }
  };
})();

/* ——— Router ———
   Every view receives the generic sub-path params sub/sub2
   (#/exam/run → sub 'run'; #/exam/review/<id> → sub 'review', sub2 <id>);
   topic and practice additionally keep their id param. */
PGRE.route = function () {
  var hash = location.hash.replace(/^#\/?/, '');
  var parts = hash.split('/').filter(Boolean);
  var view, params = { sub: parts[1] || null, sub2: parts[2] || null };

  if (parts.length === 0) { view = 'dashboard'; }
  else if (parts[0] === 'topic' && parts[1]) { view = 'topic'; params.id = parts[1]; }
  else if (parts[0] === 'practice') { view = 'practice'; params.id = parts[1] || 'all'; }
  else if (parts[0] === 'plan') { view = 'plan'; }
  else if (parts[0] === 'history') { view = 'history'; }
  else if (parts[0] === 'analytics') { view = 'analytics'; }
  else if (parts[0] === 'build') { view = 'build'; }
  else if (parts[0] === 'search') { view = 'search'; }
  else if (parts[0] === 'notes') { view = 'notes'; }
  else if (parts[0] === 'mistakes') { view = 'mistakes'; }
  else if (parts[0] === 'formulas') { view = 'formulas'; }
  else if (parts[0] === 'concepts') { view = 'concepts'; }
  else if (parts[0] === 'focus') { view = 'focus'; }
  else if (parts[0] === 'study-time') { view = 'studytime'; }
  else if (parts[0] === 'achievements') { view = 'achievements'; }
  else if (parts[0] === 'library') { view = 'library'; }
  else if (parts[0] === 'settings') { view = 'settings'; }
  else if (parts[0] === 'exam') { view = 'exam'; }
  else if (parts[0] === 'wiki' && parts[1]) { view = 'wiki'; params.id = parts[1]; }
  else if (parts[0] === 'subject' && parts[1]) {
    view = 'subject'; params.id = parts[1];
    params.sub = parts[2] || null; params.sub2 = parts[3] || null;
  }
  else { view = 'dashboard'; }

  var v = PGRE.views[view];
  var main = document.getElementById('view');
  if (!v) { main.innerHTML = '<p>Unknown view.</p>'; return; }

  PGRE.motion && PGRE.motion.loader.start();

  PGRE.store.rollDay();
  PGRE.nav.route(view, params);   // base breadcrumb trail before the view mounts
  main.innerHTML = v.render(params);
  if (v.mount) v.mount(params);
  main.scrollTop = 0;
  window.scrollTo(0, 0);
  PGRE.setActiveNav(view, params);
  if (PGRE.isNarrow()) PGRE.applySidebarDrawer(false);
  else {
    var sb = document.getElementById('sidebar');
    if (sb && (sb.hasAttribute('inert') || sb.getAttribute('aria-hidden') === 'true')) {
      PGRE.applySidebar(PGRE.store.state.settings.sidebarFolded);
    }
  }


  PGRE.refreshNavBadges();
  if (PGRE.sessionPark) PGRE.sessionPark.paint();

  // Exam and formulas paint a placeholder/skeleton first; they call viewEnter
  // after the real content mounts so we don't animate the loading stand-in.
  if (view !== 'exam' && view !== 'formulas') {
    PGRE.motion && PGRE.motion.viewEnter && PGRE.motion.viewEnter(main);
  }
  ['topic-grid', 'stat-row', 'two-col', 'ach-grid'].forEach(function (cls) {
    var grid = main.querySelector('.' + cls);
    if (grid) {
      Array.prototype.forEach.call(grid.children, function (c) {
        c.classList.add('stagger-in');
      });
      PGRE.motion && PGRE.motion.stagger(grid);
    }
  });
  requestAnimationFrame(function () {
    PGRE.motion && PGRE.motion.loader.done();
  });
};

/* Due counts on the sidebar (mistakes are synchronous; the formula deck
   loads from IndexedDB, so the Recall and subject counts fill in a beat
   later). Each subject row carries its due count; the Recall row carries
   the studio-wide due count. */
PGRE.refreshNavBadges = function () {
  var m = PGRE.srs.dueMistakes().length;
  var el = document.getElementById('nav-mist-due');
  if (el) { el.textContent = m; el.hidden = m === 0; PGRE.syncBadgeShimmer(el); }
  PGRE.formulaDeck().then(function (deck) {
    var mem = PGRE.subjectMemory ? PGRE.subjectMemory(deck) : null;
    if (!mem) return;
    var tot = document.getElementById('nav-form-due');
    if (tot) {
      tot.textContent = mem.total.due ? mem.total.due + ' due' : '';
      tot.hidden = mem.total.due === 0;
      PGRE.syncBadgeShimmer(tot);
    }
    (PGRE.SUBJECTS || []).forEach(function (s) {
      var chip = document.getElementById('nav-due-' + s.id);
      if (!chip) return;
      var n = (mem.byId[s.id] || { due: 0 }).due;
      chip.textContent = n;
      chip.hidden = n === 0;
      PGRE.syncBadgeShimmer(chip);
    });
  });
};

/* The badges shimmer (`due-shimmer` in css/style.css) and appear at different
   moments, so each sweep is counted from the page's time zero: every badge on
   screen then moves in step. No-op where the animation is off or absent. */
PGRE.syncBadgeShimmer = function (el) {
  if (!el || el.hidden || typeof el.getAnimations !== 'function') return;
  try {
    el.getAnimations().forEach(function (a) {
      if (a.animationName === 'due-shimmer') a.startTime = 0;
    });
  } catch (e) { /* the badge keeps its own beat */ }
};

PGRE.setActiveNav = function (view, params) {
  params = params || {};
  var physics = view === 'topic' || view === 'practice' || view === 'mistakes' ||
    view === 'history' || view === 'analytics' || view === 'concepts' ||
    view === 'exam' || view === 'plan' || view === 'build' || view === 'notes' ||
    view === 'library' || view === 'search' ||
    (view === 'subject' && params.id === 'physics');
  var sub = document.getElementById('nav-physics-sub');
  if (sub) sub.hidden = !physics;

  // The physics sub-nav rows highlight by their tool page: a topic portal
  // lights "Practice", everything else lights its own row.
  var key = view;
  if (view === 'dashboard') key = 'dashboard';
  else if (view === 'formulas') key = 'formulas';
  else if (view === 'subject') key = 'subject-' + params.id;
  else if (view === 'topic') key = 'practice';
  else if (view === 'practice') key = 'practice';
  else if (view === 'exam' || view === 'plan') key = 'exam';
  else if (view === 'wiki') key = 'wiki-' + params.id;

  document.querySelectorAll('#sidebar a[data-nav]').forEach(function (a) {
    var k = a.getAttribute('data-nav');
    var active = k === key;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
};

/* Sidebar tree (design §5, round 2): Today + Recall up top, one row per
   subject under SUBJECTS (Physics opens a five-tool sub-nav on physics
   pages), Studio pages under STUDIO, and Settings + the theme flip in the
   footer. Groups are plain headings — nothing collapses. */
PGRE.buildNav = function () {
  var el = document.getElementById('sidebar-nav');
  var icon = function (name) {
    return PGRE.sidebarIcon ? PGRE.sidebarIcon(name) : '';
  };
  var items = {
    top: [
      { href: '#/', key: 'dashboard', label: 'Today', icon: 'home' },
      { href: '#/formulas', key: 'formulas', label: 'Recall', icon: 'cards',
        badge: 'nav-form-due' }
    ],
    studio: [
      { href: '#/achievements', key: 'achievements', label: 'Achievements', icon: 'award' },
      { href: '#/focus', key: 'focus', label: 'Focus timer', icon: 'timer' },
      { href: '#/study-time', key: 'studytime', label: 'Study time', icon: 'hourglass' }
    ]
  };
  var groupLabels = {
    top: 'Now',
    subjects: 'Subjects',
    studio: 'Studio',
    wiki: 'Wiki',
    topics: 'Physics'   // sidebar search groups portal hits under the subject
  };
  var renderItem = function (item) {
    var badge = item.badge
      ? '<span class="nav-badge nav-badge-due" id="' + item.badge + '" hidden></span>'
      : '';
    return '<a href="' + item.href + '" data-nav="' + item.key + '">' +
      icon(item.icon) + '<span class="nav-label">' + item.label + '</span>' +
      badge + '</a>';
  };
  var renderGroup = function (id, children) {
    return '<section class="nav-tree-group" data-nav-group="' + id + '">' +
      '<h3 class="nav-group-h">' + groupLabels[id] + '</h3>' +
      '<div class="nav-tree-items">' + children + '</div>' +
      '</section>';
  };
  var physicsSub = [
    ['#/practice/all', 'practice', 'Practice'],
    ['#/mistakes', 'mistakes', 'Mistake book'],
    ['#/history', 'history', 'History'],
    ['#/subject/physics/lab', 'lab', 'Visualizers'],
    ['#/plan', 'plan', 'Exam archive']
  ].map(function (l) {
    var badge = l[1] === 'mistakes'
      ? '<span class="nav-badge nav-badge-due" id="nav-mist-due" hidden></span>' : '';
    return '<a href="' + l[0] + '" data-nav="' + l[1] + '">' +
      '<span class="nav-label">' + l[2] + '</span>' + badge + '</a>';
  }).join('');

  var wikiItems = (PGRE.WIKI_PAGES || []).map(function (p) {
    return { href: '#/wiki/' + p.id, key: 'wiki-' + p.id, label: p.title, icon: 'book' };
  });
  var subjectItems = (PGRE.SUBJECTS || []).map(function (s) {
    var row = '<a href="#/subject/' + s.id + '" data-nav="subject-' + s.id + '">' +
      '<span class="nav-mono">' + s.code + '</span>' +
      '<span class="nav-label">' + s.name + '</span>' +
      '<span class="nav-badge nav-badge-due" id="nav-due-' + s.id + '" hidden></span></a>';
    if (s.id === 'physics') {
      row += '<div class="nav-sub" id="nav-physics-sub" hidden>' + physicsSub + '</div>';
    }
    return row;
  }).join('');
  var html = '<div class="nav-tree">' +
    items.top.map(renderItem).join('') +
    renderGroup('subjects', subjectItems) +
    renderGroup('wiki', wikiItems.map(renderItem).join('')) +
    renderGroup('studio', items.studio.map(renderItem).join('')) +
    '</div>';
  el.innerHTML = html;
  if (PGRE.motion && typeof PGRE.motion.letterSwapNav === 'function') {
    PGRE.motion.letterSwapNav(el);
  }
  // the search box above the tree finds these same destinations (js/sidebar-search.js)
  var pages = {
    top: items.top,
    subjects: (PGRE.SUBJECTS || []).map(function (s) {
      return { href: '#/subject/' + s.id, key: 'subject-' + s.id, label: s.name, icon: null };
    }),
    studio: items.studio.concat(wikiItems.concat([
      { href: '#/practice/all', key: 'practice', label: 'Practice', icon: 'play' },
      { href: '#/mistakes', key: 'mistakes', label: 'Mistake book', icon: 'mistake' },
      { href: '#/history', key: 'history', label: 'History', icon: 'history' },
      { href: '#/analytics', key: 'analytics', label: 'Analytics', icon: 'chart' },
      { href: '#/exam', key: 'exam', label: 'Mock exams', icon: 'stopwatch' },
      { href: '#/plan', key: 'plan', label: 'Exam archive', icon: 'calendar' },
      { href: '#/build', key: 'build', label: 'Custom quiz', icon: 'sliders' },
      { href: '#/notes', key: 'notes', label: 'Notes &amp; bookmarks', icon: 'note' },
      { href: '#/concepts', key: 'concepts', label: 'Concept visualization', icon: 'atom' },
      { href: '#/library', key: 'library', label: 'Library', icon: 'folder' },
      { href: '#/search', key: 'search', label: 'Search', icon: 'search' },
      { href: '#/settings', key: 'settings', label: 'Settings', icon: 'gear' }
    ])),
    wiki: wikiItems
  };
  var pageLabels = { top: 'Now', subjects: 'Subjects', studio: 'Studio', wiki: 'Wiki', topics: 'Physics' };
  if (PGRE.sidebarSearch) PGRE.sidebarSearch.mount(pages, pageLabels);
};


/* ——— Foldable sidebar ———
   Desktop: the ☰ button hides/shows #sidebar (body.sidebar-folded).
   Persisted in settings.sidebarFolded so the choice survives reloads.
   Below 860px: overlay drawer (body.sidebar-open), closed by default.
   Never write sidebarFolded while the viewport is narrow. The test harness
   matchMedia stub returns false for non-reduce queries, so isNarrow() is
   false there and the desktop persist path is what tests exercise. */
PGRE.isNarrow = function () {
  return !!(window.matchMedia && window.matchMedia('(max-width: 860px)').matches);
};

PGRE.ensureSidebarScrim = function () {
  var el = document.getElementById('sidebar-scrim');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'sidebar-scrim';
  el.setAttribute('aria-hidden', 'true');
  el.addEventListener('click', function () {
    if (PGRE.isNarrow()) PGRE.applySidebarDrawer(false);
  });
  document.body.appendChild(el);
  return el;
};

PGRE.applySidebarDrawer = function (open) {
  var wasOpen = document.body.classList.contains('sidebar-open');
  document.body.classList.toggle('sidebar-open', !!open);
  document.body.classList.remove('sidebar-folded');
  PGRE.ensureSidebarScrim();
  var sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) sidebar.removeAttribute('inert');
    else sidebar.setAttribute('inert', '');
  }
  var btn = document.getElementById('sidebar-toggle');
  if (btn) {
    var label = open ? 'Hide sidebar' : 'Show sidebar';
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
  }
  if (open) {
    var current = document.querySelector('#sidebar a[aria-current="page"]') ||
                  document.querySelector('#sidebar-nav a');
    if (current && current.focus) current.focus();
  } else if (wasOpen && btn && btn.focus) {
    btn.focus();
  }
};

PGRE.applySidebar = function (folded) {
  if (PGRE.isNarrow()) {
    PGRE.applySidebarDrawer(false);
    return;
  }
  document.body.classList.remove('sidebar-open');
  var sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.removeAttribute('aria-hidden');
    sidebar.removeAttribute('inert');
  }
  document.body.classList.toggle('sidebar-folded', !!folded);
  var btn = document.getElementById('sidebar-toggle');
  if (btn) {
    var label = folded ? 'Show sidebar' : 'Hide sidebar';
    btn.setAttribute('aria-expanded', folded ? 'false' : 'true');
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
  }
};

PGRE.toggleSidebar = function () {
  if (PGRE.isNarrow()) {
    PGRE.applySidebarDrawer(!document.body.classList.contains('sidebar-open'));
    return;
  }
  var s = PGRE.store.state.settings;
  s.sidebarFolded = !s.sidebarFolded;
  PGRE.store.save();
  PGRE.applySidebar(s.sidebarFolded);
};


/* ——— Themes (Life Studio): named themes on <html data-theme>.
   js/data-themes.js is the registry: each theme carries an `attr` value
   ('' = the :root palette; 'dark' = the legacy warm-dark selector the CSS
   and tests already key on) and a `dark` flag that sets [data-dark] so
   dark-only CSS applies to every dark theme. Legacy saved values are
   normalized by store.migrate() and again here. ——— */
PGRE.applyTheme = function (t) {
  var theme = PGRE.themeEntry ? PGRE.themeEntry(t)
                              : { attr: t || '', dark: t === 'dark', name: t || 'default' };
  if (theme.attr) document.documentElement.dataset.theme = theme.attr;
  else delete document.documentElement.dataset.theme;
  if (theme.dark) document.documentElement.dataset.dark = '1';
  else delete document.documentElement.dataset.dark;
  var btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.textContent = 'Light / dark';
    btn.setAttribute('aria-pressed', theme.dark ? 'true' : 'false');
    btn.setAttribute('title', 'Theme: ' + theme.name + ' — pick in Settings');
  }
};

/* Persist + apply — the sidebar toggle and the Settings picker call this. */
PGRE.setTheme = function (t) {
  var id = PGRE.normalizeTheme ? PGRE.normalizeTheme(t) : t;
  PGRE.store.state.settings.theme = id;
  PGRE.store.save();
  PGRE.applyTheme(id);
};

/* Content column width (Settings › Appearance): one --page-w custom property
   feeds both the #view and .topbar-inner max-width rules in css/style.css.
   Default 1040px matches the old fixed value; a window narrower than the
   saved width still fits because max-width only caps the column. */
PGRE.applyPageWidth = function (w) {
  var px = parseInt(w, 10);
  if (!(px >= 760 && px <= 1600)) px = 1040;
  document.documentElement.style.setProperty('--page-w', px + 'px');
};

/* The store is origin-scoped: file://, localhost, and 127.0.0.1 are separate
   profiles. Keep the active profile visible so an empty store cannot look like
   lost progress after switching launch methods. */
PGRE.updateOriginLine = function () {
  var el = document.getElementById('origin-line');
  if (!el) return;
  var origin = (window.location && window.location.origin !== 'null')
    ? window.location.origin
    : 'file://';
  // The chip shows the short form (host for a served copy, plain words for a
  // file opened from disk); the tooltip and the label keep the full origin.
  var served = !/^file:/.test(origin);
  var name = served ? origin.replace(/^https?:\/\//, '') : 'Local file';
  // The pill is one wrapping item of #origin-line, so the chip is shown whole
  // or not at all (see .origin-line in css/style.css).
  el.innerHTML = '<span class="origin-pill">' +
    '<svg class="origin-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<ellipse cx="12" cy="6" rx="7" ry="2.8"/>' +
      '<path d="M5 6v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6"/>' +
      '<path d="M5 12v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6"/></svg>' +
    '<span class="origin-kicker">Profile</span>' +
    '<span class="origin-name' + (served ? ' is-host' : '') + '">' + PGRE.ui.esc(name) + '</span>' +
    '</span>';
  // role="img" makes a screen reader announce the label (the full origin) in
  // place of the short text; a plain span's label is not announced reliably.
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Profile: ' + origin);
  el.title = 'Progress is stored separately for each browser origin. This profile is ' +
    origin + '.';
};

/* ——— Boot ——— */
PGRE.boot = function () {
  PGRE.store.load();
  PGRE.updateOriginLine();
  if (PGRE.store._recoveredFromCorruption) {
    var corruptKey = PGRE.store._corruptKey;
    PGRE.toast('Saved progress could not be read' +
      (corruptKey ? '; a copy was kept as ' + PGRE.ui.esc(corruptKey) : ' and could not be copied aside') +
      '. Restore from Library if this looks wrong.', 'error', true);
  }
  PGRE.applyTheme(PGRE.store.state.settings.theme);
  PGRE.applyPageWidth(PGRE.store.state.settings.pageWidth);
  PGRE.ensureSidebarScrim();
  PGRE.applySidebar(PGRE.store.state.settings.sidebarFolded);
  var sbToggle = document.getElementById('sidebar-toggle');
  if (sbToggle) sbToggle.addEventListener('click', PGRE.toggleSidebar);
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!PGRE.isNarrow()) return;
    if (!document.body.classList.contains('sidebar-open')) return;
    PGRE.applySidebarDrawer(false);
  });
  PGRE._narrow = PGRE.isNarrow();
  var onBreak = function () {
    var n = PGRE.isNarrow();
    if (n === PGRE._narrow && n) return;
    PGRE._narrow = n;
    PGRE.applySidebar(PGRE.store.state.settings.sidebarFolded);
  };
  if (window.matchMedia) {
    var mq = window.matchMedia('(max-width: 860px)');
    if (mq.addEventListener) mq.addEventListener('change', onBreak);
    else if (mq.addListener) mq.addListener(onBreak);
  }
  window.addEventListener('resize', onBreak);

  PGRE.buildNav();
  if (PGRE.motion && typeof PGRE.motion.letterSwapNav === 'function') {
    var brand = document.getElementById('brand-home');
    if (brand) PGRE.motion.letterSwapNav(brand);
    var topBrand = document.getElementById('topbar-brand');
    if (topBrand) PGRE.motion.letterSwapNav(topBrand);
  }
  PGRE.studyTime.start();       // passive active-minutes heartbeat
  if (PGRE.timer) PGRE.timer.boot();   // F3 focus timer: resume/credit + wire the top-bar widget
  // Sidebar theme button: quick light/dark flip (warm-dark <-> the default
  // Paper and ink); the full picker lives in Settings (Life Studio).
  var toggle = document.getElementById('theme-toggle');
  if (toggle) toggle.addEventListener('click', function () {
    var cur = PGRE.store.state.settings.theme;
    var dark = PGRE.themeIsDark ? PGRE.themeIsDark(cur)
                                : (cur === 'dark' || cur === 'warm-dark');
    PGRE.setTheme(dark ? 'paper' : 'warm-dark');
  });
  // Finder-style history arrows — hash routes ride the browser session history,
  // so back/forward are always meaningful; a no-op click is harmless.
  var tbBack = document.getElementById('topbar-back');
  var tbFwd = document.getElementById('topbar-fwd');
  if (tbBack) tbBack.addEventListener('click', function () { history.back(); });
  if (tbFwd) tbFwd.addEventListener('click', function () { history.forward(); });
  // Skip link: its href="#main" must never reach the hash router — PGRE.route
  // strips /^#\/?/ and would read "main" as an unknown view, remounting the
  // dashboard and destroying any in-progress session. Intercept activation
  // (the click event fires for mouse AND keyboard Enter) and move focus to
  // #main (tabindex="-1") without touching location.hash.
  var skipLink = document.querySelector('a.skip-link');
  if (skipLink) skipLink.addEventListener('click', function (e) {
    e.preventDefault();
    var target = document.getElementById('main');
    if (target) target.focus();
  });
  window.addEventListener('hashchange', PGRE.route);
  PGRE.route();                 // first paint never waits on IndexedDB
  PGRE.contentDB.open();        // warm the connection in the background
};

window.addEventListener('unhandledrejection', function (e) {
  console.error('Unhandled rejection:', e.reason);
});

// index.html loads scripts with `defer`: they run with readyState
// 'interactive', before DOMContentLoaded, and motion.js comes after this file.
// Waiting for DOMContentLoaded (fired after ALL deferred scripts) keeps
// PGRE.motion present when boot() first routes. 'complete' only happens when
// app.js is injected late (tests, devtools); then boot at once.
if (document.readyState === 'complete') {
  PGRE.boot();
} else {
  document.addEventListener('DOMContentLoaded', PGRE.boot);
}
