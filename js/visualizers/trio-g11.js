/* Formula visualizers — G11 lens & mirror / Lorentz time / Faraday / Fermi-Dirac / Doppler */
(function (global) {
  'use strict';
  global.PGRE = global.PGRE || {};
  global.PGRE.visualizers = global.PGRE.visualizers || {};
  var PGRE = global.PGRE;
  var CV = PGRE.CV;

  var CREAM = '#faf9f5';
  var PANEL = '#f5f0e8';
  var LINE = '#e6dfd8';
  var INK = '#141413';
  var MUTED = '#6c6a64';
  var CORAL = '#cc785c';
  var GOLD = '#d4a017';
  var TEAL = '#5db8a6';
  var AXIS = '#8e8b82';
  var ROSE = '#e05666';
  var VIOLET = '#9d7cd8';
  var GRID = 'rgba(20, 20, 19, 0.08)';
  var SANS = '11px Inter, -apple-system, sans-serif';
  var SANS_B = '600 11px Inter, -apple-system, sans-serif';
  var MATH_FACE = 'KaTeX_Math, "Times New Roman", serif';
  var MAIN_FACE = 'KaTeX_Main, "Times New Roman", serif';
  var CAL_FACE = 'KaTeX_Caligraphic, "Times New Roman", serif';
  var MINUS = '−';

  function stageTheme() {
    if (PGRE.vizStageTheme) return PGRE.vizStageTheme();
    return {
      bg: CREAM, ink: INK, muted: MUTED, line: LINE, panel: PANEL,
      gridMid: GRID,
      inkFade: function (a) { return 'rgba(20, 20, 19, ' + a + ')'; },
      chipFade: function (a) { return 'rgba(250, 249, 245, ' + a + ')'; }
    };
  }

  function syncStageTheme() {
    var t = PGRE.vizStageTheme ? PGRE.vizStageTheme() : null;
    if (!t) return;
    CREAM = t.bg; PANEL = t.panel; LINE = t.line; INK = t.ink; MUTED = t.muted; GRID = t.gridMid;
  }

  function fillStage(ctx, width, height) {
    syncStageTheme();
    ctx.fillStyle = (CV && CV.colors && CV.colors.bg) || CREAM;
    ctx.fillRect(0, 0, width, height);
  }

  function isDark() {
    // Life Studio named themes: [data-dark] marks every dark theme; the
    // literal 'dark' attr stays warm-dark's own value.
    var el = typeof document !== 'undefined' ? document.documentElement : null;
    if (!el || typeof el.getAttribute !== 'function') return false;
    if (el.hasAttribute && el.hasAttribute('data-dark')) return true;
    return el.getAttribute('data-theme') === 'dark';
  }

  // Site --accent-deep: the coral that is legible as text, lighter on the dark stage.
  function deepCoral() {
    return isDark() ? '#e0997d' : '#964b32';
  }

  function tint(hex, a) {
    var n = parseInt(String(hex).slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ', ' + a + ')';
  }

  function vizLegend(title, rows) {
    if (PGRE.appendVizLegend) PGRE.appendVizLegend(title, rows);
  }

  function numParam(state, key, fallback) {
    var n = parseFloat(state && state[key]);
    return isFinite(n) ? n : fallback;
  }

  function flagParam(state, key, fallback) {
    var v = state ? state[key] : undefined;
    if (v === undefined || v === null || v === '') return !!fallback;
    if (v === true || v === 1 || v === '1' || v === 'true' || v === 'on') return true;
    if (v === false || v === 0 || v === '0' || v === 'false' || v === 'off') return false;
    return !!v;
  }

  function speedParam(state) {
    var n = numParam(state, 'simSpeed', 1);
    return (isFinite(n) && n > 0) ? n : 1;
  }

  function safeDt(dt) {
    var n = parseFloat(dt);
    if (!isFinite(n) || n < 0) return 0;
    if (n > 0.05) return 0.05;
    return n;
  }

  function canvasSize(width, height) {
    var w = parseFloat(width);
    var h = parseFloat(height);
    return {
      w: isFinite(w) && w > 0 ? w : 640,
      h: isFinite(h) && h > 0 ? h : 420
    };
  }

  function clampNum(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function inkFade(a) {
    var t = stageTheme();
    return t.inkFade ? t.inkFade(a) : ('rgba(20, 20, 19, ' + a + ')');
  }

  function chipFade(a) {
    var t = stageTheme();
    return t.chipFade ? t.chipFade(a) : ('rgba(250, 249, 245, ' + a + ')');
  }

  // Number for canvas text: a true minus sign, fixed decimals.
  function plain(n, digits) {
    var s = Math.abs(n).toFixed(digits == null ? 0 : digits);
    return (n < 0 && parseFloat(s) !== 0 ? MINUS : '') + s;
  }

  function haloLabel(ctx, text, x, y, opts) {
    opts = opts || {};
    ctx.save();
    ctx.font = opts.font || SANS_B;
    ctx.textAlign = opts.align || 'center';
    ctx.textBaseline = opts.baseline || 'middle';
    var w = ctx.measureText ? ctx.measureText(text).width : String(text).length * 6.5;
    var ax = opts.align === 'left' ? x : (opts.align === 'right' ? x - w : x - w / 2);
    var ay = opts.baseline === 'top' ? y : (opts.baseline === 'bottom' ? y - 12 : y - 7);
    ctx.fillStyle = chipFade(0.92);
    ctx.fillRect(ax - 3, ay - 1, w + 6, 14);
    ctx.fillStyle = opts.color || INK;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  // Canvas text cannot run KaTeX, so a symbol is set in the faces KaTeX itself
  // uses: letters in math italic, digits and operators upright, "'" as a raised
  // prime, "_x" as a one-character subscript, U+2130 as a calligraphic E.
  function symRuns(text, size, roman) {
    var runs = [];
    var s = String(text);
    var i, ch;
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i);
      if (ch === '_' && i + 1 < s.length) {
        i++;
        runs.push({ t: s.charAt(i), font: 'italic ' + Math.round(size * 0.74) + 'px ' + MATH_FACE, dy: size * 0.26 });
      } else if (ch === "'") {
        runs.push({ t: '′', font: Math.round(size * 0.86) + 'px ' + MAIN_FACE, dy: -size * 0.2 });
      } else if (ch === 'ℰ') {
        runs.push({ t: 'E', font: size + 'px ' + CAL_FACE, dy: 0 });
      } else if (!roman && /[A-Za-zα-ωϵ]/.test(ch)) {
        runs.push({ t: ch, font: 'italic ' + size + 'px ' + MATH_FACE, dy: 0 });
      } else {
        runs.push({ t: ch, font: size + 'px ' + MAIN_FACE, dy: 0 });
      }
    }
    return runs;
  }

  function symLabel(ctx, text, x, y, opts) {
    opts = opts || {};
    var size = opts.size || 14;
    var runs = symRuns(text, size, opts.roman);
    var total = 0;
    var i;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (i = 0; i < runs.length; i++) {
      ctx.font = runs[i].font;
      runs[i].w = ctx.measureText ? ctx.measureText(runs[i].t).width : size * 0.55;
      total += runs[i].w;
    }
    var left = opts.align === 'left' ? x : (opts.align === 'right' ? x - total : x - total / 2);
    if (opts.halo !== false) {
      ctx.fillStyle = chipFade(0.9);
      ctx.fillRect(left - 3, y - size * 0.62, total + 6, size * 1.24);
    }
    ctx.fillStyle = opts.color || INK;
    var pen = left;
    for (i = 0; i < runs.length; i++) {
      ctx.font = runs[i].font;
      ctx.fillText(runs[i].t, pen, y + runs[i].dy);
      pen += runs[i].w;
    }
    ctx.restore();
    return total;
  }

  function arrowHead(ctx, x, y, ang, len, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-len, -len * 0.45);
    ctx.lineTo(-len, len * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function arrowLine(ctx, x0, y0, x1, y1, color, lw, dash) {
    var dx = x1 - x0;
    var dy = y1 - y0;
    var len = Math.hypot(dx, dy);
    if (len < 2) return;
    var head = Math.min(9, len * 0.6);
    var ux = dx / len;
    var uy = dy / len;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw == null ? 2.2 : lw;
    ctx.lineCap = 'round';
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1 - ux * head * 0.7, y1 - uy * head * 0.7);
    ctx.stroke();
    ctx.restore();
    arrowHead(ctx, x1, y1, Math.atan2(dy, dx), head, color);
  }

  function dot(ctx, x, y, r, fill, stroke, lw) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1.5; ctx.stroke(); }
    ctx.restore();
  }

  function segment(ctx, x0, y0, x1, y1, color, lw, dash) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw || 1;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
  }

  // Part of the segment that lies inside rectangle r, or null when none does.
  function clipSeg(x1, y1, x2, y2, r) {
    var t0 = 0;
    var t1 = 1;
    var dx = x2 - x1;
    var dy = y2 - y1;
    var p = [-dx, dx, -dy, dy];
    var q = [x1 - r.x, r.x + r.w - x1, y1 - r.y, r.y + r.h - y1];
    var i;
    for (i = 0; i < 4; i++) {
      if (p[i] === 0) {
        if (q[i] < 0) return null;
      } else {
        var u = q[i] / p[i];
        if (p[i] < 0) {
          if (u > t1) return null;
          if (u > t0) t0 = u;
        } else {
          if (u < t0) return null;
          if (u < t1) t1 = u;
        }
      }
    }
    return { x1: x1 + t0 * dx, y1: y1 + t0 * dy, x2: x1 + t1 * dx, y2: y1 + t1 * dy };
  }

  function clipRect(ctx, r) {
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
  }

  // 1, 1.5, 2, 3, 4, 5, 6, 8 times a power of ten: the first that covers v.
  function niceCeil(v) {
    if (!(v > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
    var steps = [1, 1.5, 2, 3, 4, 5, 6, 8, 10];
    var i;
    for (i = 0; i < steps.length; i++) {
      if (steps[i] * p >= v * 0.999) return steps[i] * p;
    }
    return 10 * p;
  }


  // Full-scale value of a plot axis as text.
  function scaleText(v) {
    if (v >= 1) return v % 1 === 0 ? v.toFixed(0) : v.toFixed(1);
    return v.toFixed(2);
  }


  /* ====================================================================== */
  /* cpgf-3.26 — thin lens and mirror equation                              */
  /* ====================================================================== */

  var ELEMENT_NAMES = {
    'lens-conv': 'converging lens',
    'lens-div': 'diverging lens',
    'mirror-conc': 'concave mirror',
    'mirror-conv': 'convex mirror'
  };

  PGRE.visualizers['cpgf-3.26'] = {
    id: 'cpgf-3.26',
    topic: 'ow',
    title: "Thin Lens & Mirror Equation: $1/s + 1/s' = 1/f$",
    formulaLatex: "\\frac{1}{s} + \\frac{1}{s'} = \\frac{1}{f}, \\qquad m = -\\frac{s'}{s}",
    physicalStory: `
Every ray that leaves one point of the object and passes through a thin lens, or reflects from a spherical mirror, meets the others again at one point: the image. Three rays are easy to trace. A ray parallel to the axis leaves through the focal point. A ray through the center of a lens, or to the vertex of a mirror, keeps its angle to the axis. A ray through the focal point leaves parallel to the axis. The point where the three cross is the tip of the image, and its distance from the element is $s'$.

The equation $\\frac{1}{s} + \\frac{1}{s'} = \\frac{1}{f}$ is that crossing point written as algebra. A positive $s'$ means the outgoing rays cross on the side where the light leaves: behind a lens, in front of a mirror. That is a real image. A negative $s'$ means the outgoing rays spread apart and only their backward extensions, drawn dashed, cross on the other side. That is a virtual image.

Move the object toward the focal point of a converging element and $s'$ grows without limit. Move it inside the focal length and the image appears on the other side: virtual, upright and enlarged. A diverging element ($f \\lt 0$) gives a virtual, upright, reduced image at every object distance. The plot of $s'$ against $s$ shows the whole dependence in one curve.
    `.trim(),
    derivationSteps: [
      {
        step: 1,
        title: 'Similar triangles through the center',
        latex: "\\frac{h'}{h} = -\\frac{s'}{s}",
        description: "The ray through the center of the lens is not bent. The object height $h$ and the image height $h'$ are sides of two similar triangles with bases $s$ and $s'$. The minus sign records that a real image is inverted."
      },
      {
        step: 2,
        title: 'Similar triangles through the focal point',
        latex: "\\frac{h'}{h} = -\\frac{s' - f}{f}",
        description: "The ray that arrives parallel to the axis crosses the lens at height $h$ and then passes through the far focal point. Beyond the lens it forms a triangle of base $f$ and height $h$, similar to the triangle of base $s' - f$ and height $|h'|$."
      },
      {
        step: 3,
        title: 'Equate the two ratios',
        latex: "\\frac{s'}{s} = \\frac{s' - f}{f} \\implies \\frac{1}{s} + \\frac{1}{s'} = \\frac{1}{f}",
        description: "Divide both sides by $s'$ and rearrange."
      },
      {
        step: 4,
        title: 'Magnification',
        latex: "m = \\frac{h'}{h} = -\\frac{s'}{s}",
        description: 'A negative $m$ is an inverted image. $|m| \\gt 1$ is an enlarged image.'
      },
      {
        step: 5,
        title: 'Spherical mirror',
        latex: 'f = \\frac{R}{2}',
        description: 'The same equation holds for a spherical mirror for rays near the axis, with $f = R/2$: concave $f \\gt 0$, convex $f \\lt 0$.'
      }
    ],
    limitingCases: [
      {
        name: 'Distant object',
        condition: 's \\to \\infty',
        formula: "s' \\to f",
        description: 'Parallel rays meet at the focal point. This is the definition of $f$.'
      },
      {
        name: 'Object at twice the focal length',
        condition: 's = 2f',
        formula: "s' = 2f, \\quad m = -1",
        description: 'Real, inverted, same size. For $s \\gt 2f$ the image is reduced. For $f \\lt s \\lt 2f$ it is enlarged.'
      },
      {
        name: 'Object at the focal point',
        condition: 's = f',
        formula: "s' \\to \\infty",
        description: 'The outgoing rays are parallel and no image forms at a finite distance.'
      },
      {
        name: 'Object inside the focal length',
        condition: '0 \\lt s \\lt f',
        formula: "s' = -\\frac{sf}{f - s} \\lt 0, \\quad m \\gt 1",
        description: 'Virtual, upright, enlarged: a magnifying glass or a shaving mirror.'
      },
      {
        name: 'Plane mirror',
        condition: 'f \\to \\infty',
        formula: "s' = -s, \\quad m = +1",
        description: 'The image is virtual and as far behind the mirror as the object is in front of it.'
      }
    ],
    greTraps: [
      {
        trap: "Sign of $s'$ for a mirror",
        warning: "For a mirror the outgoing light is on the same side as the object. A real image ($s' \\gt 0$) is in front of the mirror and a virtual image ($s' \\lt 0$) is behind it. For a lens the sides are the other way round.",
        strategy: "Ask where the light goes after the element. Positive $s'$ is on that side."
      },
      {
        trap: 'Diverging elements',
        warning: 'A diverging lens or a convex mirror has $f \\lt 0$. For a real object the image is always virtual, upright and reduced, and it lies between the element and the focal point.',
        strategy: "Put the minus sign on $f$ before solving. Then $s' = sf/(s - f)$ is negative for every $s \\gt 0$."
      },
      {
        trap: 'Two elements in a row',
        warning: 'The image of the first element is the object of the second. If that image would form beyond the second element, the second object distance is negative (a virtual object).',
        strategy: "Compute $s_2 = d - s_1'$ with its sign, where $d$ is the separation. Apply the equation again. The total magnification is $m_1 m_2$."
      },
      {
        trap: 'Radius versus focal length',
        warning: 'A mirror problem often gives the radius of curvature $R$ and not $f$.',
        strategy: 'Convert with $f = R/2$ first.'
      }
    ],
    parameters: [
      { id: 'element', label: 'Optical element', type: 'select', options: [
        { value: 'lens-conv', label: 'Converging lens' },
        { value: 'lens-div', label: 'Diverging lens' },
        { value: 'mirror-conc', label: 'Concave mirror' },
        { value: 'mirror-conv', label: 'Convex mirror' }
      ], default: 'lens-conv', hint: "Converging elements have $f \\gt 0$ and diverging elements have $f \\lt 0$. A lens sends the light on to the far side, so a real image ($s' \\gt 0$) forms there. A mirror sends the light back, so a real image forms in front of it." },
      { id: 'focal', label: 'Focal length $|f|$', min: 2, max: 8, step: 0.5, default: 4, unit: 'cm', hint: 'Distance from the element to its focal point. The sign of $f$ comes from the element: positive for a converging lens or a concave mirror, negative for a diverging lens or a convex mirror. For a mirror, $|f| = R/2$.' },
      { id: 'objDist', label: 'Object distance $s$', min: 1, max: 24, step: 0.5, default: 10, unit: 'cm', hint: "Distance from the object to the element, on the side the light comes from. Move it through $s = 2f$ (image the same size) and through $s = f$ (image at infinity) and watch $s'$ change sign." },
      { id: 'showRays', label: 'Principal rays', type: 'toggle', default: true, hint: 'Show the three rays that locate the image: parallel to the axis, through the center or vertex, and through the focal point. Dashed lines are backward extensions of outgoing rays; no light travels along them.' },
      { id: 'simSpeed', label: 'Simulation Speed', min: 0.2, max: 3.0, step: 0.2, default: 1.0, unit: 'x' }
    ],

    init: function (container, state) {
      state._t = 0;
    },

    draw: function (ctx, width, height, state, dt) {
      state = state || {};
      var size = canvasSize(width, height);
      width = size.w;
      height = size.h;
      fillStage(ctx, width, height);

      var element = ELEMENT_NAMES[state.element] ? String(state.element) : 'lens-conv';
      var isMirror = element.indexOf('mirror') === 0;
      var converging = element === 'lens-conv' || element === 'mirror-conc';
      var fAbs = clampNum(numParam(state, 'focal', 4), 0.5, 20);
      var f = converging ? fAbs : -fAbs;
      var s = clampNum(numParam(state, 'objDist', 10), 0.25, 60);
      var showRays = flagParam(state, 'showRays', true);
      dt = safeDt(dt);
      state._t = (state._t || 0) + dt * speedParam(state);

      var atInf = Math.abs(s - f) < 1e-9;
      var sp = atInf ? Infinity : (s * f) / (s - f);
      var mag = atInf ? Infinity : -sp / s;
      var hObj = 3;
      var hImg = atInf ? Infinity : mag * hObj;
      var real = !atInf && sp > 0;

      var pad = 12;
      var wide = width >= height * 1.9;
      var dia;
      var plot;
      if (wide) {
        var pw = clampNum(Math.round(width * 0.27), 190, 300);
        dia = { x: pad, y: pad, w: width - pw - 3 * pad, h: height - 2 * pad };
        plot = { x: dia.x + dia.w + pad, y: pad, w: pw, h: height - 2 * pad };
      } else {
        var ph = clampNum(Math.round(height * 0.34), 100, 170);
        dia = { x: pad, y: pad, w: width - 2 * pad, h: height - ph - 3 * pad };
        plot = { x: pad, y: dia.y + dia.h + pad, w: width - 2 * pad, h: ph };
      }

      // Ray diagram, lengths in cm, element at x = 0, light arrives from the left.
      // Heights are stretched on a wide stage: straight rays stay straight and
      // still cross at the image, and the 3 cm object becomes large enough to read.
      var XW = 26;
      var sc = dia.w / (2 * XW);
      var scY = Math.max(sc, dia.h / 20);
      var cx = dia.x + dia.w / 2;
      var cy = dia.y + dia.h / 2;
      var halfH = dia.h / 2 / scY;
      var ap = Math.max(2, Math.min(7, halfH - 0.8));
      function X(x) { return cx + x * sc; }
      function Y(y) { return cy - y * scY; }
      var dir = isMirror ? -1 : 1;
      var xi = isMirror ? -sp : sp;
      var xe = dir * XW * 1.1;
      var spots = [];

      ctx.save();
      clipRect(ctx, dia);

      // optical axis
      segment(ctx, dia.x, cy, dia.x + dia.w, cy, AXIS, 1);
      // the plane where every ray turns in the thin-element approximation,
      // shown over the full height because a ray can meet it beyond the drawn rim
      segment(ctx, cx, dia.y, cx, dia.y + dia.h, tint(TEAL, 0.34), 1, [2, 5]);

      // element
      var topY = Y(ap);
      var botY = Y(-ap);
      function mirrorX(y) {
        var maxSag = (ap * ap) / (4 * fAbs);
        var k = maxSag > 2.2 ? 2.2 / maxSag : 1;
        return (converging ? -1 : 1) * (y * y) / (4 * fAbs) * k;
      }
      ctx.save();
      if (isMirror) {
        var yi;
        ctx.strokeStyle = AXIS;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (yi = -ap; yi <= ap + 1e-6; yi += ap / 8) {
          ctx.moveTo(X(mirrorX(yi)), Y(yi));
          ctx.lineTo(X(mirrorX(yi)) + 7, Y(yi) - 5);
        }
        ctx.stroke();
        ctx.strokeStyle = TEAL;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (yi = -ap; yi <= ap + 1e-6; yi += ap / 24) {
          if (yi === -ap) ctx.moveTo(X(mirrorX(yi)), Y(yi));
          else ctx.lineTo(X(mirrorX(yi)), Y(yi));
        }
        ctx.stroke();
      } else {
        ctx.fillStyle = tint(TEAL, 0.16);
        ctx.strokeStyle = TEAL;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        if (converging) {
          ctx.moveTo(cx, topY);
          ctx.quadraticCurveTo(cx + 16, cy, cx, botY);
          ctx.quadraticCurveTo(cx - 16, cy, cx, topY);
        } else {
          ctx.moveTo(cx - 9, topY);
          ctx.lineTo(cx + 9, topY);
          ctx.quadraticCurveTo(cx - 3, cy, cx + 9, botY);
          ctx.lineTo(cx - 9, botY);
          ctx.quadraticCurveTo(cx + 3, cy, cx - 9, topY);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        segment(ctx, cx, topY, cx, botY, tint(TEAL, 0.7), 1, [3, 3]);
      }
      ctx.restore();

      // focal points, and the center of curvature for a mirror
      var marks = isMirror
        ? [{ x: -f, name: 'F' }, { x: -2 * f, name: 'C' }]
        : [{ x: -fAbs, name: 'F' }, { x: fAbs, name: 'F' }];
      marks.forEach(function (mk) {
        dot(ctx, X(mk.x), cy, 3, AXIS);
        symLabel(ctx, mk.name, X(mk.x), cy + 13, { color: MUTED, size: 13 });
      });

      // principal rays
      var rays = [];
      if (showRays) {
        rays.push({
          id: 'rayParallel', color: CORAL, y1: hObj, k: (isMirror ? 1 : -1) * hObj / f,
          title: 'Ray parallel to the axis',
          body: 'Arrives parallel to the axis at height $h$. It leaves along the line through the focal point' + (converging ? '' : (isMirror ? ' behind the mirror' : ' on the incoming side') + ', so it spreads away from the axis') + '. Slope after the element: $' + (isMirror ? '' : '-') + 'h/f$.'
        });
        rays.push({
          id: 'rayCenter', color: TEAL, y1: 0, k: (isMirror ? 1 : -1) * hObj / s,
          title: isMirror ? 'Ray to the vertex' : 'Ray through the center',
          body: isMirror
            ? 'Hits the mirror on the axis and reflects at the same angle on the other side of the axis.'
            : 'Passes through the center of the thin lens and is not bent. It fixes the ratio $h\'/h = -s\'/s$.'
        });
        var yC = atInf ? Infinity : -hObj * f / (s - f);
        if (isFinite(yC) && Math.abs(yC) <= halfH * 1.6) {
          rays.push({
            id: 'rayFocal', color: GOLD, y1: yC, k: 0,
            title: 'Ray along the line through the focal point',
            body: (converging
              ? 'Travels along the line through the focal point on the incoming side.'
              : (isMirror ? 'Aims at the focal point behind the mirror.' : 'Aims at the focal point on the far side.')) + ' It leaves parallel to the axis at the image height $h\' = ' + hImg.toFixed(2) + '\\,\\mathrm{cm}$.'
          });
        }
        var phase = state._t * 46;
        rays.forEach(function (ry) {
          var x0 = X(-s);
          var y0 = Y(hObj);
          var x1 = X(0);
          var y1 = Y(ry.y1);
          var x2 = X(xe);
          var y2 = Y(ry.y1 + ry.k * xe);
          ctx.save();
          ctx.strokeStyle = ry.color;
          ctx.lineJoin = 'round';
          ctx.globalAlpha = 0.5;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.lineWidth = 2.4;
          ctx.setLineDash([7, 17]);
          ctx.lineDashOffset = -phase;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          ctx.restore();
          if (!atInf && !real) {
            segment(ctx, x1, y1, X(xi), Y(hImg), tint(ry.color, 0.75), 1.2, [4, 4]);
          }
          spots.push({ id: ry.id, kind: 'segment', x1: x0, y1: y0, x2: x1, y2: y1, halfW: 6, title: ry.title, body: ry.body });
        });
      }

      // object
      var objX = X(-s);
      arrowLine(ctx, objX, cy, objX, Y(hObj), INK, 2.8);
      haloLabel(ctx, 'object', objX, Math.max(dia.y + 10, Y(hObj) - 13), { color: INK });
      spots.push({
        id: 'object', kind: 'segment', x1: objX, y1: cy, x2: objX, y2: Y(hObj), halfW: 9,
        title: 'Object',
        body: 'An upright arrow of height $h = ' + hObj.toFixed(1) + '\\,\\mathrm{cm}$ at $s = ' + s.toFixed(1) + '\\,\\mathrm{cm}$ from the element. $s$ is positive because the object is on the side the light comes from.'
      });

      // image
      var imgOnStage = !atInf && Math.abs(xi) <= XW * 0.985;
      var imgWord = atInf ? 'at infinity' : ((real ? 'real' : 'virtual') + ', ' + (mag < 0 ? 'inverted' : 'upright') + ', ' +
        (Math.abs(Math.abs(mag) - 1) < 0.005 ? 'same size' : (Math.abs(mag) > 1 ? 'enlarged' : 'reduced')));
      if (imgOnStage) {
        var imgX = X(xi);
        var tipY = Y(hImg);
        arrowLine(ctx, imgX, cy, imgX, tipY, ROSE, 2.8, real ? null : [5, 4]);
        var lblY = hImg < 0 ? Math.min(dia.y + dia.h - 10, tipY + 13) : Math.max(dia.y + 10, tipY - 13);
        haloLabel(ctx, real ? 'real image' : 'virtual image', imgX, lblY, { color: ROSE });
        spots.push({
          id: 'image', kind: 'segment', x1: imgX, y1: cy, x2: imgX, y2: clampNum(tipY, dia.y, dia.y + dia.h), halfW: 9,
          title: real ? 'Real image' : 'Virtual image',
          body: "$s' = " + sp.toFixed(2) + "\\,\\mathrm{cm}$, $m = -s'/s = " + mag.toFixed(2) + '$: ' + imgWord + '. ' +
            (real ? 'The outgoing rays cross here, so a screen at this place shows the image.' : 'The outgoing rays only appear to come from here. A screen at this place shows nothing.')
        });
      } else {
        var edgeRight = atInf ? (dir > 0) : (xi > 0);
        var ex0 = edgeRight ? dia.x + dia.w - 10 : dia.x + 10;
        haloLabel(ctx, atInf ? 'image at infinity' : 'image beyond the stage', ex0, dia.y + dia.h - 14,
          { color: ROSE, align: edgeRight ? 'right' : 'left' });
      }

      // which side counts as positive s'
      var posRight = !isMirror;
      symLabel(ctx, posRight ? "s' < 0" : "s' > 0", dia.x + 8, dia.y + 12, { color: MUTED, size: 13, align: 'left' });
      symLabel(ctx, posRight ? "s' > 0" : "s' < 0", dia.x + dia.w - 8, dia.y + 12, { color: MUTED, size: 13, align: 'right' });
      arrowLine(ctx, dia.x + 10, dia.y + dia.h - 14, dia.x + 40, dia.y + dia.h - 14, MUTED, 1.4);
      haloLabel(ctx, 'incoming light', dia.x + 46, dia.y + dia.h - 14, { color: MUTED, align: 'left', font: SANS });

      ctx.restore();

      spots.push({
        id: 'element', kind: 'rect', x: cx - 12, y: topY, w: 24, h: botY - topY,
        title: ELEMENT_NAMES[element].charAt(0).toUpperCase() + ELEMENT_NAMES[element].slice(1),
        body: '$f = ' + f.toFixed(1) + '\\,\\mathrm{cm}$' + (isMirror ? ', radius of curvature $R = 2|f| = ' + (2 * fAbs).toFixed(1) + '\\,\\mathrm{cm}$' : '') +
          '. In the thin-element approximation every ray changes direction at one plane, the dotted vertical line, also where that plane lies beyond the drawn rim.'
      });
      marks.forEach(function (mk, i) {
        spots.push({
          id: 'mark' + i, kind: 'circle', x: X(mk.x), y: cy, r: 9,
          title: mk.name === 'C' ? 'Center of curvature $C$' : 'Focal point $F$',
          body: mk.name === 'C'
            ? 'Center of the sphere the mirror is part of, at distance $R = 2|f|$ from the vertex. A ray along a radius reflects back along itself.'
            : 'At distance $|f| = ' + fAbs.toFixed(1) + '\\,\\mathrm{cm}$ from the element. Rays that arrive parallel to the axis leave along lines through a focal point.'
        });
      });

      // s' against s
      var gx = plot.x + 34;
      var gy = plot.y + 16;
      var gw = Math.max(40, plot.w - 46);
      var gh = Math.max(40, plot.h - 38);
      var S_MAX = 24;
      var SP_MAX = 24;
      function GX(v) { return gx + (v / S_MAX) * gw; }
      function GY(v) { return gy + gh / 2 - (v / SP_MAX) * (gh / 2); }

      ctx.save();
      ctx.fillStyle = tint(TEAL, 0.05);
      ctx.fillRect(gx, gy, gw, gh / 2);
      ctx.font = SANS;
      ctx.fillStyle = MUTED;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText('real', gx + gw - 4, gy + 9);
      ctx.fillText('virtual', gx + gw - 4, gy + gh - 9);
      ctx.fillText(plain(SP_MAX), gx - 5, gy + 4);
      ctx.fillText('0', gx - 5, GY(0));
      ctx.fillText(plain(-SP_MAX), gx - 5, gy + gh - 4);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('0', gx, gy + gh + 5);
      ctx.fillText('12', GX(12), gy + gh + 5);
      ctx.fillText('24', GX(24), gy + gh + 5);
      ctx.restore();

      segment(ctx, gx, gy, gx, gy + gh, AXIS, 1.4);
      segment(ctx, gx, GY(0), gx + gw, GY(0), AXIS, 1.4);
      if (f > 0 && f < S_MAX) segment(ctx, GX(f), gy, GX(f), gy + gh, AXIS, 1, [4, 4]);
      segment(ctx, gx, GY(f), gx + gw, GY(f), AXIS, 1, [4, 4]);

      ctx.save();
      clipRect(ctx, { x: gx, y: gy, w: gw, h: gh });
      ctx.strokeStyle = CORAL;
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      var prev = null;
      var si;
      for (si = 0.1; si <= S_MAX + 1e-6; si += 0.1) {
        if (Math.abs(si - f) < 0.04) { prev = null; continue; }
        var spv = si * f / (si - f);
        var px = GX(si);
        var py = GY(clampNum(spv, -SP_MAX * 3, SP_MAX * 3));
        if (prev === null || (prev > 0) !== (spv > 0)) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
        prev = spv;
      }
      ctx.stroke();
      ctx.restore();

      var mkX = GX(Math.min(s, S_MAX));
      var mkOff = atInf || Math.abs(sp) > SP_MAX;
      var mkY = atInf ? gy : GY(clampNum(sp, -SP_MAX, SP_MAX));
      dot(ctx, mkX, mkY, 5, mkOff ? CREAM : ROSE, ROSE, 2);
      symLabel(ctx, 's', gx + gw - 2, GY(0) - 10, { color: MUTED, size: 13, align: 'right' });
      symLabel(ctx, "s'", gx + 12, gy + 2, { color: MUTED, size: 13, align: 'left' });

      spots.push({
        id: 'plotMarker', kind: 'circle', x: mkX, y: mkY, r: 11,
        title: 'Current object distance',
        body: '$s = ' + s.toFixed(1) + '\\,\\mathrm{cm}$ gives ' + (atInf ? "$s' \\to \\infty$" : "$s' = " + sp.toFixed(2) + '\\,\\mathrm{cm}$') +
          (mkOff ? ', beyond the range of this plot' : '') + '. Above the axis the image is real; below it the image is virtual.'
      });
      spots.push({
        id: 'plotHoriz', kind: 'segment', x1: gx, y1: GY(f), x2: gx + gw, y2: GY(f), halfW: 5,
        title: "Asymptote $s' = f$",
        body: "A very distant object gives $s' \\to f = " + f.toFixed(1) + '\\,\\mathrm{cm}$: parallel light meets at the focal point.'
      });
      if (f > 0 && f < S_MAX) {
        spots.push({
          id: 'plotVert', kind: 'segment', x1: GX(f), y1: gy, x2: GX(f), y2: gy + gh, halfW: 5,
          title: 'Asymptote $s = f$',
          body: "An object at the focal point gives outgoing rays that are parallel, so $s' \\to \\pm\\infty$. The image changes from real to virtual across this line."
        });
      }
      spots.push({
        id: 'plot', kind: 'rect', x: gx, y: gy, w: gw, h: gh,
        title: "Image distance $s'$ against object distance $s$",
        body: "The curve is $s' = sf/(s - f)$ for $f = " + f.toFixed(1) + '\\,\\mathrm{cm}$, both axes in $\\mathrm{cm}$. ' +
          (f > 0 ? 'It has two branches that meet at infinity where $s = f$.' : "For $f \\lt 0$ it stays below the axis: every image is virtual and $|s'| \\lt |f|$.")
      });
      spots.push({
        id: 'diagram', kind: 'rect', x: dia.x, y: dia.y, w: dia.w, h: dia.h,
        title: 'Ray diagram',
        body: 'Light arrives from the left. ' + (isMirror
          ? "It reflects back to the left, so $s' \\gt 0$ (real image) is on the left and $s' \\lt 0$ (virtual image) is behind the mirror."
          : "It continues to the right, so $s' \\gt 0$ (real image) is on the right and $s' \\lt 0$ (virtual image) is on the left.")
      });
      PGRE.setVizHotspots(spots);

      var invSum = atInf ? (1 / s).toFixed(3) + ' + 0' : (1 / s).toFixed(3) + (1 / sp < 0 ? ' - ' : ' + ') + Math.abs(1 / sp).toFixed(3);
      vizLegend('Image formation', [
        { label: 'Element', value: ELEMENT_NAMES[element] + ', $f ' + (f > 0 ? '\\gt' : '\\lt') + ' 0$', hint: 'Converging lens and concave mirror: $f \\gt 0$. Diverging lens and convex mirror: $f \\lt 0$.' },
        { label: '$f$', value: '$' + f.toFixed(1) + '\\,\\mathrm{cm}$', hint: 'Focal length with its sign.' + (isMirror ? ' For this mirror $R = 2|f| = ' + (2 * fAbs).toFixed(1) + '\\,\\mathrm{cm}$.' : '') },
        { label: '$s$', value: '$' + s.toFixed(1) + '\\,\\mathrm{cm}$', hint: 'Object distance. Positive for a real object on the incoming side.' },
        { label: "$s'$", value: atInf ? '$\\infty$' : '$' + sp.toFixed(2) + '\\,\\mathrm{cm}$', hint: "Image distance from $1/s' = 1/f - 1/s$. Positive on the side where the light leaves the element, negative on the other side." },
        { label: "$m = -s'/s$", value: atInf ? '$\\infty$' : '$' + mag.toFixed(2) + '$', hint: 'Magnification. Negative means inverted. $|m| \\gt 1$ means larger than the object.' },
        { label: 'Image', value: imgWord, hint: "Real when $s' \\gt 0$, virtual when $s' \\lt 0$. For a single element a real image is always inverted and a virtual image is always upright." },
        { label: "$1/s + 1/s'$", value: '$' + invSum + ' \\approx ' + (1 / f).toFixed(3) + '\\,\\mathrm{cm^{-1}} = 1/f$', hint: 'The equation checked with the live numbers. The two reciprocals add to $1/f$ exactly; each printed value is rounded to three decimals, so the last digit of the printed sum can differ by one.' },
        { label: 'Coral / teal / gold', value: 'parallel / center / focal ray', hint: 'The three principal rays. Any two of them locate the image; the third is a check.' }
      ]);
    },

    challenge: {
      question: 'An object is placed $6\\,\\mathrm{cm}$ in front of a concave mirror whose radius of curvature is $24\\,\\mathrm{cm}$. Which statement describes the image?',
      options: [
        'Real, inverted, $12\\,\\mathrm{cm}$ in front of the mirror',
        'Virtual, upright, $12\\,\\mathrm{cm}$ behind the mirror, twice the height of the object',
        'Virtual, upright, $4\\,\\mathrm{cm}$ behind the mirror, two thirds of the height of the object',
        'Real, inverted, $4\\,\\mathrm{cm}$ in front of the mirror',
        'No image forms, because the reflected rays are parallel'
      ],
      correct: 1,
      explanation: "The focal length is $f = R/2 = 12\\,\\mathrm{cm}$, positive for a concave mirror. Then $1/s' = 1/f - 1/s = 1/12 - 1/6 = -1/12$, so $s' = -12\\,\\mathrm{cm}$. The negative sign puts the image behind the mirror: it is virtual. The magnification is $m = -s'/s = +2$: upright and twice the height. Choice (C) is the result for a convex mirror ($f = -12\\,\\mathrm{cm}$). Choice (E) would need the object at the focal point, $s = 12\\,\\mathrm{cm}$."
    }
  };


  /* ====================================================================== */
  /* cpgf-6.1 — Lorentz transformation of time                              */
  /* ====================================================================== */

  PGRE.visualizers['cpgf-6.1'] = {
    id: 'cpgf-6.1',
    topic: 'sr',
    title: "Lorentz Transformation of Time: $t' = \\gamma(t - vx/c^2)$",
    formulaLatex: "t' = \\gamma\\left(t - \\frac{v}{c^2}\\,x\\right), \\qquad x' = \\gamma\\,(x - vt)",
    physicalStory: `
The diagram plots events with position $x$ across and time $ct$ upward, as measured in frame $S$. Light moves along the dashed $45^\\circ$ lines. Frame $S'$ moves at speed $v = \\beta c$ along $x$. Its time axis is the path of its own origin, $x = \\beta\\,ct$. Its space axis is the set of events to which $S'$ assigns the time $t' = 0$, which is the line $ct = \\beta x$. Both axes tilt toward the light line by the same angle $\\arctan\\beta$.

The term $vx/c^2$ in $t' = \\gamma(t - vx/c^2)$ is that tilt. Two events with the same $t$ and different $x$ lie on one horizontal line, and they get different values of $t'$. Events that are simultaneous in $S$ are not simultaneous in $S'$.

Turn on the sweep. The horizontal line collects the events that $S$ calls simultaneous as its clock advances, and the tilted line does the same for $S'$. Watch which line reaches event $E$ first. When $E$ lies outside the light lines through $O$ (a spacelike separation), the two frames can disagree about the order of $O$ and $E$. When $E$ lies inside them (a timelike separation), the order is the same in every frame.
    `.trim(),
    derivationSteps: [
      {
        step: 1,
        title: 'Linear transformation and its inverse',
        latex: "x' = \\gamma\\,(x - vt), \\qquad x = \\gamma\\,(x' + vt')",
        description: "The origin of $S'$ moves along $x = vt$, so $x'$ must be proportional to $x - vt$. The inverse has the same form with $v \\to -v$. The same factor $\\gamma$ appears in both because neither frame is preferred."
      },
      {
        step: 2,
        title: "Solve the pair for $t'$",
        latex: "t' = \\gamma\\left(t - \\frac{x}{v}\\left(1 - \\frac{1}{\\gamma^2}\\right)\\right)",
        description: "Substitute the first relation into the second and isolate $t'$."
      },
      {
        step: 3,
        title: 'Fix $\\gamma$ with a light signal',
        latex: "x = ct \\ \\text{ and } \\ x' = ct' \\implies 1 - \\frac{1}{\\gamma^2} = \\frac{v^2}{c^2}",
        description: "A flash from the common origin obeys $x = ct$ in $S$ and $x' = ct'$ in $S'$, because both frames measure the same speed of light. This requires $\\gamma = 1/\\sqrt{1 - v^2/c^2}$."
      },
      {
        step: 4,
        title: 'Result',
        latex: "t' = \\gamma\\left(t - \\frac{v}{c^2}\\,x\\right)",
        description: "The second term makes $t'$ depend on where an event is, not only on when it is."
      },
      {
        step: 5,
        title: 'Separation of two events',
        latex: "\\Delta t' = \\gamma\\left(\\Delta t - \\frac{v}{c^2}\\,\\Delta x\\right)",
        description: "The transformation is linear, so the same formula holds for the differences between two events. With $\\Delta t = 0$ it gives $\\Delta t' = -\\gamma v\\,\\Delta x/c^2$."
      }
    ],
    limitingCases: [
      {
        name: 'Slow frame',
        condition: 'v \\ll c',
        formula: "t' \\approx t - \\frac{vx}{c^2} \\approx t",
        description: "The Galilean result $t' = t$. The shift $vx/c^2$ is first order in $v/c$ and matters only when $x$ is large."
      },
      {
        name: 'Two events at the same place in $S$',
        condition: '\\Delta x = 0',
        formula: "\\Delta t' = \\gamma\\,\\Delta t",
        description: "A clock at rest in $S$ records the proper time $\\Delta t$. Frame $S'$ measures the longer interval $\\gamma\\,\\Delta t$: time dilation."
      },
      {
        name: 'Two events at the same time in $S$',
        condition: '\\Delta t = 0',
        formula: "\\Delta t' = -\\gamma\\,\\frac{v}{c^2}\\,\\Delta x",
        description: "Relativity of simultaneity. The event that is farther along the direction of motion happens earlier in $S'$."
      },
      {
        name: 'Invariant interval',
        condition: 'every $v$',
        formula: "(c\\,\\Delta t')^2 - (\\Delta x')^2 = (c\\,\\Delta t)^2 - (\\Delta x)^2",
        description: 'Positive is timelike, negative is spacelike, zero is lightlike. The sign is the same in every frame.'
      }
    ],
    greTraps: [
      {
        trap: 'Dropping the $vx/c^2$ term',
        warning: "Writing $t' = \\gamma t$ is correct only for events at $x = 0$. For two events separated in space, the position term changes the answer and can change its sign.",
        strategy: "Write both $\\Delta t$ and $\\Delta x$ before transforming, then use $\\Delta t' = \\gamma(\\Delta t - v\\,\\Delta x/c^2)$."
      },
      {
        trap: 'Which interval is the proper time',
        warning: 'Time dilation $\\Delta t = \\gamma\\,\\Delta\\tau$ applies when the two events happen at the same place in one frame. That frame measures the proper time $\\Delta\\tau$, which is the shortest.',
        strategy: 'Find the frame in which both events are at one position. Every other frame measures a longer time.'
      },
      {
        trap: 'Order of events',
        warning: 'Two frames can disagree about which of two events came first only if the separation is spacelike. In that case neither event can cause the other.',
        strategy: 'Compute $(c\\,\\Delta t)^2 - (\\Delta x)^2$. If it is positive, the order is the same in every frame.'
      },
      {
        trap: 'Direction of $v$',
        warning: "The formula assumes that $S'$ moves in the $+x$ direction of $S$ with speed $v$. The inverse is $t = \\gamma(t' + vx'/c^2)$.",
        strategy: 'To invert, exchange primed and unprimed symbols and change $v$ to $-v$.'
      }
    ],
    parameters: [
      { id: 'beta', label: "Velocity of $S'$: $\\beta = v/c$", min: -0.9, max: 0.9, step: 0.05, default: 0.6, unit: '', hint: "Speed of frame $S'$ along $+x$ in units of $c$. It sets the tilt $\\arctan\\beta$ of both primed axes and the factor $\\gamma = (1 - \\beta^2)^{-1/2}$. At $\\beta = 0.6$, $\\gamma = 1.25$." },
      { id: 'ex', label: 'Event position $x$', min: -4, max: 4, step: 0.25, default: 3, unit: '', hint: "Position of event $E$ in frame $S$, in light-seconds. Moving $E$ sideways at fixed $ct$ changes $ct'$ by $-\\gamma\\beta$ per unit of $x$: the $vx/c^2$ term." },
      { id: 'et', label: 'Event time $ct$', min: -4, max: 4, step: 0.25, default: 1, unit: '', hint: "Time of event $E$ in frame $S$, multiplied by $c$, in light-seconds. Event $O$ stays at the origin, so these two sliders are also the separations $\\Delta x$ and $c\\,\\Delta t$." },
      { id: 'nowLines', label: 'Sweep lines of simultaneity', type: 'toggle', default: true, hint: "Animate one line of constant $t$ (horizontal) and one line of constant $t'$ (tilted). Each line collects the events that its own frame calls simultaneous." },
      { id: 'grid', label: "Coordinate grid of $S'$", type: 'toggle', default: true, hint: "Draw the lines of constant $ct'$ and constant $x'$ at unit spacing. Read the primed coordinates of $E$ by counting grid lines along the tilted axes." },
      { id: 'simSpeed', label: 'Simulation Speed', min: 0.2, max: 3.0, step: 0.2, default: 1.0, unit: 'x' }
    ],

    init: function (container, state) {
      state._t = 0;
    },

    draw: function (ctx, width, height, state, dt) {
      state = state || {};
      var size = canvasSize(width, height);
      width = size.w;
      height = size.h;
      fillStage(ctx, width, height);

      var beta = clampNum(numParam(state, 'beta', 0.6), -0.95, 0.95);
      var gamma = 1 / Math.sqrt(1 - beta * beta);
      var ex = clampNum(numParam(state, 'ex', 3), -8, 8);
      var et = clampNum(numParam(state, 'et', 1), -8, 8);
      var showNow = flagParam(state, 'nowLines', true);
      var showGrid = flagParam(state, 'grid', true);
      dt = safeDt(dt);
      state._t = (state._t || 0) + dt * speedParam(state);

      var etp = gamma * (et - beta * ex);
      var exp = gamma * (ex - beta * et);
      var interval = et * et - ex * ex;
      var kind = Math.abs(interval) < 1e-9 ? 'lightlike' : (interval > 0 ? 'timelike' : 'spacelike');

      var pad = 12;
      var tlW = clampNum(Math.round(width * 0.24), 150, 270);
      var dia = { x: pad, y: pad, w: width - tlW - 3 * pad, h: height - 2 * pad };
      var tl = { x: dia.x + dia.w + pad, y: pad, w: tlW, h: height - 2 * pad };
      var R = 4.8;
      // fit the swept time range in the height and the event slider range in the width
      var sc = Math.min((dia.h - 8) / (2 * R), dia.w / 8.8);
      var ox = dia.x + dia.w / 2;
      var oy = dia.y + dia.h / 2;
      var XR = dia.w / 2 / sc;
      var YR = dia.h / 2 / sc;
      function X(x) { return ox + x * sc; }
      function Y(ct) { return oy - ct * sc; }
      var spots = [];
      var n;
      // The diagram is drawn clipped, so a hover target is published only where its object shows.
      function inDia(x, y) { return x >= dia.x && x <= dia.x + dia.w && y >= dia.y && y <= dia.y + dia.h; }
      function lineSpot(id, x1, y1, x2, y2, halfW, title, body) {
        var c = clipSeg(x1, y1, x2, y2, dia);
        if (c) spots.push({ id: id, kind: 'segment', x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2, halfW: halfW, title: title, body: body });
      }

      // sweep time, the same reading on both frames' clocks
      var period = 9;
      var tau = -R + 2 * R * ((state._t % period) / period);

      ctx.save();
      clipRect(ctx, dia);

      // grid of S
      ctx.save();
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (n = -Math.floor(XR); n <= Math.floor(XR); n++) {
        ctx.moveTo(X(n), dia.y);
        ctx.lineTo(X(n), dia.y + dia.h);
      }
      for (n = -Math.floor(YR); n <= Math.floor(YR); n++) {
        ctx.moveTo(dia.x, Y(n));
        ctx.lineTo(dia.x + dia.w, Y(n));
      }
      ctx.stroke();
      ctx.restore();

      // grid of S'
      if (showGrid) {
        ctx.save();
        ctx.strokeStyle = tint(TEAL, 0.24);
        ctx.lineWidth = 1;
        ctx.beginPath();
        var nMax = Math.ceil((XR + YR) * gamma) + 1;
        for (n = -nMax; n <= nMax; n++) {
          // ct' = n
          ctx.moveTo(X(-XR), Y(-beta * XR + n / gamma));
          ctx.lineTo(X(XR), Y(beta * XR + n / gamma));
          // x' = n
          ctx.moveTo(X(-beta * YR + n / gamma), Y(-YR));
          ctx.lineTo(X(beta * YR + n / gamma), Y(YR));
        }
        ctx.stroke();
        ctx.restore();
      }

      // light lines through O
      var lm = Math.max(YR, XR);
      segment(ctx, X(-lm), Y(-lm), X(lm), Y(lm), ROSE, 1.4, [5, 4]);
      segment(ctx, X(-lm), Y(lm), X(lm), Y(-lm), ROSE, 1.4, [5, 4]);

      // axes of S
      var sxEnd = XR - 0.25;
      var stEnd = YR - 0.25;
      arrowLine(ctx, X(-XR), oy, X(sxEnd), oy, AXIS, 1.6);
      arrowLine(ctx, ox, Y(-YR), ox, Y(stEnd), AXIS, 1.6);

      // axes of S'
      var absB = Math.max(Math.abs(beta), 1e-6);
      var tEnd = YR * 0.93;
      var xEnd = Math.min(XR * 0.95, (YR * 0.93) / absB);
      arrowLine(ctx, X(-beta * tEnd), Y(-tEnd), X(beta * tEnd), Y(tEnd), TEAL, 2.2);
      arrowLine(ctx, X(-xEnd), Y(-beta * xEnd), X(xEnd), Y(beta * xEnd), TEAL, 2.2);
      for (n = 1; gamma * n < tEnd * 0.97; n++) {
        dot(ctx, X(gamma * beta * n), Y(gamma * n), 2.4, TEAL);
        dot(ctx, X(-gamma * beta * n), Y(-gamma * n), 2.4, TEAL);
      }
      for (n = 1; gamma * n < xEnd * 0.97; n++) {
        dot(ctx, X(gamma * n), Y(gamma * beta * n), 2.4, TEAL);
        dot(ctx, X(-gamma * n), Y(-gamma * beta * n), 2.4, TEAL);
      }

      // coordinates of E in S: perpendicular drops onto the axes
      var eX = X(ex);
      var eY = Y(et);
      segment(ctx, eX, eY, ox, eY, inkFade(0.45), 1.2, [3, 4]);
      segment(ctx, eX, eY, eX, oy, inkFade(0.45), 1.2, [3, 4]);
      dot(ctx, ox, eY, 2.8, AXIS);
      dot(ctx, eX, oy, 2.8, AXIS);

      // coordinates of E in S': drops parallel to the primed axes
      var a1x = X(gamma * beta * etp);
      var a1y = Y(gamma * etp);
      var a2x = X(gamma * exp);
      var a2y = Y(gamma * beta * exp);
      segment(ctx, eX, eY, a1x, a1y, TEAL, 1.4, [3, 4]);
      segment(ctx, eX, eY, a2x, a2y, TEAL, 1.4, [3, 4]);
      dot(ctx, a1x, a1y, 3.6, CREAM, TEAL, 2);
      dot(ctx, a2x, a2y, 3.6, CREAM, TEAL, 2);

      // sweeping lines of simultaneity
      var sNowY = Y(tau);
      var pNowL = { x: X(-XR), y: Y(-beta * XR + tau / gamma) };
      var pNowR = { x: X(XR), y: Y(beta * XR + tau / gamma) };
      if (showNow) {
        segment(ctx, dia.x, sNowY, dia.x + dia.w, sNowY, inkFade(0.55), 1.8);
        segment(ctx, pNowL.x, pNowL.y, pNowR.x, pNowR.y, tint(TEAL, 0.9), 2.2);
        symLabel(ctx, 't', dia.x + 12, clampNum(sNowY - 10, dia.y + 10, dia.y + dia.h - 10), { color: MUTED, size: 13 });
        var tagX = dia.x + dia.w - 16;
        var tagY = Y(beta * ((tagX - ox) / sc) + tau / gamma);
        if (tagY > dia.y + 10 && tagY < dia.y + dia.h - 10) {
          symLabel(ctx, "t'", tagX, tagY - 10, { color: TEAL, size: 13 });
        }
      }

      // events
      dot(ctx, ox, oy, 4.6, INK);
      dot(ctx, eX, eY, 6, CORAL, deepCoral(), 1.6);
      symLabel(ctx, 'O', ox - 13, oy + 13, { size: 14 });
      symLabel(ctx, 'E', eX + (eX > dia.x + dia.w - 26 ? -13 : 13), eY + (eY < dia.y + 26 ? 13 : -13), { size: 14, color: deepCoral() });

      // axis names
      symLabel(ctx, 'x', X(sxEnd) - 6, oy + 13, { color: MUTED, size: 14 });
      symLabel(ctx, 'ct', ox - 15, Y(stEnd) + 8, { color: MUTED, size: 14 });
      symLabel(ctx, "ct'", X(beta * tEnd) + (beta >= 0 ? 17 : -17), Y(tEnd) + 8, { color: TEAL, size: 14 });
      symLabel(ctx, "x'", X(xEnd) - 6, Y(beta * xEnd) + (beta >= 0 ? 14 : -14), { color: TEAL, size: 14 });

      ctx.restore();

      // timelines: when each frame says the two events happen
      var c1 = tl.x + tl.w * 0.3;
      var c2 = tl.x + tl.w * 0.72;
      var span = 4.32;
      segment(ctx, c1, Y(-span), c1, Y(span), AXIS, 1.6);
      segment(ctx, c2, Y(-span), c2, Y(span), TEAL, 1.8);
      ctx.save();
      ctx.font = '10px Inter, -apple-system, sans-serif';
      ctx.fillStyle = MUTED;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (n = -4; n <= 4; n++) {
        segment(ctx, c1 - 4, Y(n), c1 + 4, Y(n), AXIS, 1);
        segment(ctx, c2 - 4, Y(n), c2 + 4, Y(n), TEAL, 1);
        if (n % 2 === 0 && sc >= 22) ctx.fillText(plain(n), c1 - 9, Y(n));
      }
      ctx.restore();
      symLabel(ctx, 'ct', c1, tl.y + 8, { color: MUTED, size: 13 });
      symLabel(ctx, "ct'", c2, tl.y + 8, { color: TEAL, size: 13 });

      var etpShown = clampNum(etp, -span, span);
      var etShown = clampNum(et, -span, span);
      segment(ctx, c1, Y(0), c2, Y(0), inkFade(0.3), 1.2);
      segment(ctx, c1, Y(etShown), c2, Y(etpShown), tint(CORAL, 0.6), 1.4);
      if (showNow) {
        segment(ctx, c1 - 11, sNowY, c1 + 11, sNowY, inkFade(0.7), 2);
        segment(ctx, c2 - 11, sNowY, c2 + 11, sNowY, TEAL, 2.4);
      }
      function mark(x, tVal, shown, color, ring) {
        var past = !showNow || tau >= tVal;
        dot(ctx, x, Y(shown), 5, past ? color : CREAM, ring, 1.8);
      }
      mark(c1, 0, 0, INK, INK);
      mark(c2, 0, 0, INK, INK);
      mark(c1, et, etShown, CORAL, deepCoral());
      mark(c2, etp, etpShown, CORAL, deepCoral());
      function orderWord(tE) {
        if (Math.abs(tE) < 1e-9) return 'same time';
        return tE > 0 ? 'O first' : 'E first';
      }
      haloLabel(ctx, orderWord(et), c1, tl.y + tl.h - 8, { color: MUTED });
      haloLabel(ctx, orderWord(etp), c2, tl.y + tl.h - 8, { color: TEAL });

      spots.push({
        id: 'E', kind: 'circle', x: eX, y: eY, r: 12,
        title: 'Event $E$',
        body: "In $S$: $(x, ct) = (" + ex.toFixed(2) + ',\\ ' + et.toFixed(2) + ")$. In $S'$: $(x', ct') = (" + exp.toFixed(2) + ',\\ ' + etp.toFixed(2) + ')$. One event, two sets of coordinates.'
      });
      spots.push({
        id: 'O', kind: 'circle', x: ox, y: oy, r: 11,
        title: 'Event $O$',
        body: "The shared origin: $x = ct = 0$ and $x' = ct' = 0$. Every separation in this picture is measured from it."
      });
      if (inDia(a1x, a1y)) {
        spots.push({
          id: 'readT', kind: 'circle', x: a1x, y: a1y, r: 10,
          title: "Reading $ct'$",
          body: "Go from $E$ parallel to the $x'$ axis until the $ct'$ axis. The mark is at $ct' = \\gamma(ct - \\beta x) = " + gamma.toFixed(3) + '\\,(' + et.toFixed(2) + (beta * ex < 0 ? ' + ' : ' - ') + Math.abs(beta * ex).toFixed(2) + ') = ' + etp.toFixed(2) + '$.'
        });
      }
      if (inDia(a2x, a2y)) {
        spots.push({
          id: 'readX', kind: 'circle', x: a2x, y: a2y, r: 10,
          title: "Reading $x'$",
          body: "Go from $E$ parallel to the $ct'$ axis until the $x'$ axis. The mark is at $x' = \\gamma(x - \\beta\\,ct) = " + exp.toFixed(2) + '$.'
        });
      }
      lineSpot('tAxis', X(-beta * tEnd), Y(-tEnd), X(beta * tEnd), Y(tEnd), 6,
        "The $ct'$ axis",
        "Path of the origin of $S'$: $x = \\beta\\,ct$, the events with $x' = 0$. The dots are $ct' = 1, 2, \\dots$; they sit at $ct = \\gamma, 2\\gamma, \\dots$, which is time dilation.");
      lineSpot('xAxis', X(-xEnd), Y(-beta * xEnd), X(xEnd), Y(beta * xEnd), 6,
        "The $x'$ axis",
        "The events with $t' = 0$: $ct = \\beta x$. In $S$ these events are not simultaneous. This tilt is the term $vx/c^2$.");
      lineSpot('light1', X(-lm), Y(-lm), X(lm), Y(lm), 5,
        'Light line $x = ct$',
        "A flash emitted at $O$ in the $+x$ direction. It obeys $x' = ct'$ as well: the primed axes tilt symmetrically about this line.");
      lineSpot('light2', X(-lm), Y(lm), X(lm), Y(-lm), 5,
        'Light line $x = -ct$',
        'A flash emitted at $O$ in the $-x$ direction. Events between the two light lines, above or below $O$, are timelike separated from $O$.');
      if (showNow) {
        lineSpot('nowS', dia.x, sNowY, dia.x + dia.w, sNowY, 5,
          'Simultaneous in $S$',
          'All events with $ct = ' + tau.toFixed(2) + '$. Frame $S$ assigns them one time.');
        lineSpot('nowP', pNowL.x, pNowL.y, pNowR.x, pNowR.y, 5,
          "Simultaneous in $S'$",
          "All events with $ct' = " + tau.toFixed(2) + "$. Frame $S'$ assigns them one time, although their values of $ct$ differ by $\\beta\\,\\Delta x$.");
      }
      spots.push({
        id: 'tlE1', kind: 'circle', x: c1, y: Y(etShown), r: 9,
        title: 'Time of $E$ in $S$',
        body: '$ct = ' + et.toFixed(2) + '$. ' + (et > 0 ? '$E$ happens after $O$.' : (et < 0 ? '$E$ happens before $O$.' : '$E$ and $O$ happen at the same time.'))
      });
      spots.push({
        id: 'tlE2', kind: 'circle', x: c2, y: Y(etpShown), r: 9,
        title: "Time of $E$ in $S'$",
        body: "$ct' = " + etp.toFixed(2) + '$' + (Math.abs(etp) > span ? ' (beyond the end of this scale)' : '') + '. ' + (etp > 1e-9 ? '$E$ happens after $O$.' : (etp < -1e-9 ? '$E$ happens before $O$.' : '$E$ and $O$ happen at the same time.'))
      });
      spots.push({
        id: 'timelines', kind: 'rect', x: tl.x, y: tl.y, w: tl.w, h: tl.h,
        title: 'Clock readings in each frame',
        body: "Left scale: $ct$ of events $O$ (dark) and $E$ (coral) in $S$. Right scale: $ct'$ of the same events in $S'$. A filled dot has already happened at the time the sweep line shows."
      });
      spots.push({
        id: 'diagram', kind: 'rect', x: dia.x, y: dia.y, w: dia.w, h: dia.h,
        title: 'Spacetime diagram of frame $S$',
        body: "Grey grid: unit steps of $x$ and $ct$. Teal grid: unit steps of $x'$ and $ct'$. Units with $c = 1$, lengths in light-seconds."
      });
      PGRE.setVizHotspots(spots);

      var orderS = Math.abs(et) < 1e-9 ? 'simultaneous' : (et > 0 ? '$O$ first' : '$E$ first');
      var orderP = Math.abs(etp) < 1e-9 ? 'simultaneous' : (etp > 0 ? '$O$ first' : '$E$ first');
      vizLegend('Lorentz transformation', [
        { label: 'Units', value: '$c = 1$, light-seconds', hint: 'Times are multiplied by $c$, so $ct$ and $x$ have the same unit and light travels at $45^\\circ$.' },
        { label: '$\\beta,\\ \\gamma$', value: '$' + beta.toFixed(2) + ',\\ ' + gamma.toFixed(3) + '$', hint: '$\\gamma = 1/\\sqrt{1 - \\beta^2}$. The values $\\beta = 0.6$ and $\\beta = 0.8$ give $\\gamma = 1.25$ and $\\gamma = 5/3$.' },
        { label: '$E$ in $S$: $(x, ct)$', value: '$(' + ex.toFixed(2) + ',\\ ' + et.toFixed(2) + ')$', hint: 'Coordinates of event $E$ in the frame of the diagram, set with the two sliders.' },
        { label: "$ct' = \\gamma(ct - \\beta x)$", value: '$' + etp.toFixed(2) + '$', hint: "The formula of this card with $c = 1$. The term $-\\gamma\\beta x$ is the part that a Galilean transformation does not have." },
        { label: "$x' = \\gamma(x - \\beta\\,ct)$", value: '$' + exp.toFixed(2) + '$', hint: "Position of $E$ in $S'$. Together with $ct'$ it keeps the interval unchanged." },
        { label: '$(ct)^2 - x^2$', value: '$' + interval.toFixed(2) + '$ (' + kind + ')', hint: "The invariant interval between $O$ and $E$. It has the same value from the primed coordinates: $(ct')^2 - x'^2 = " + (etp * etp - exp * exp).toFixed(2) + '$.' },
        { label: 'Order in $S$', value: orderS, hint: 'Which event has the smaller $t$.' },
        { label: "Order in $S'$", value: orderP, hint: "Which event has the smaller $t'$. It can differ from the order in $S$ only when the interval is spacelike." },
        { label: 'Axis tilt $\\arctan\\beta$', value: '$' + (Math.atan(beta) * 180 / Math.PI).toFixed(1) + '^\\circ$', hint: "Angle of the $ct'$ axis from the $ct$ axis, and of the $x'$ axis from the $x$ axis. Both close toward the light line as $\\beta \\to 1$." }
      ]);
    },

    challenge: {
      question: "In frame $S$, two flashes occur at the same time. Flash $A$ is at $x = 0$ and flash $B$ is at $x = 3$ light-seconds. Frame $S'$ moves in the $+x$ direction at $v = 0.6c$. In frame $S'$:",
      options: [
        'The flashes are simultaneous.',
        '$B$ occurs $1.8\\,\\mathrm{s}$ before $A$.',
        '$B$ occurs $2.25\\,\\mathrm{s}$ before $A$.',
        '$A$ occurs $2.25\\,\\mathrm{s}$ before $B$.',
        '$B$ occurs $3.75\\,\\mathrm{s}$ before $A$.'
      ],
      correct: 2,
      explanation: "$\\gamma = 1/\\sqrt{1 - 0.36} = 1.25$. With $\\Delta t = 0$ and $\\Delta x = x_B - x_A = 3$ light-seconds, $\\Delta t' = \\gamma(\\Delta t - v\\,\\Delta x/c^2) = 1.25\\,(0 - 0.6 \\times 3\\,\\mathrm{s}) = -2.25\\,\\mathrm{s}$. The negative sign means $t'_B \\lt t'_A$: flash $B$, the one farther along the direction of motion, occurs first in $S'$. Choice (B) leaves out the factor $\\gamma$. Choice (E) is $\\gamma\\,\\Delta x/c$, the separation in space in $S'$ divided by $c$."
    }
  };


  /* ====================================================================== */
  /* cpgf-2.42 — Faraday's law                                              */
  /* ====================================================================== */

  var FARADAY_SCENARIOS = {
    cross: 'loop crosses a field region',
    ramp: 'field strength oscillates',
    rotate: 'loop rotates in the field'
  };

  // Field seen end-on: a dot in a ring points at the viewer, a cross points away.
  function fieldMark(ctx, x, y, out, strength, color, r) {
    r = r || 5;
    ctx.save();
    ctx.globalAlpha = 0.22 + 0.78 * clampNum(strength, 0, 1);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = r > 6 ? 1.8 : 1.3;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    if (strength > 0.04) {
      if (out) {
        ctx.beginPath();
        ctx.arc(x, y, r * 0.34, 0, Math.PI * 2);
        ctx.fill();
      } else {
        var d = r * 0.62;
        ctx.beginPath();
        ctx.moveTo(x - d, y - d);
        ctx.lineTo(x + d, y + d);
        ctx.moveTo(x + d, y - d);
        ctx.lineTo(x - d, y + d);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  PGRE.visualizers['cpgf-2.42'] = {
    id: 'cpgf-2.42',
    topic: 'em',
    title: "Faraday's Law of Induction: $\\mathcal{E} = -d\\Phi_B/dt$",
    formulaLatex: '\\mathcal{E} = -\\frac{d\\Phi_B}{dt}, \\qquad \\Phi_B = \\int_S \\mathbf{B} \\cdot d\\mathbf{a}',
    physicalStory: `
The magnetic flux $\\Phi_B$ through a loop measures how much field passes through its area. Faraday's law says that an emf appears around the loop only while the flux is changing, and that the size of the emf is the rate of change. A large, steady flux gives no emf.

For a uniform field the flux is $\\Phi_B = BA\\cos\\theta$, and it can change in three ways. The menu shows one of each: the area inside the field changes (a loop that crosses the edge of a field region), the field strength changes (a fixed loop in an oscillating field), or the angle changes (a loop that rotates in a steady field). In every case the lower graph is minus the slope of the upper graph.

The minus sign is Lenz's law. The induced current produces its own field through the loop, and that field opposes the change in flux, not the flux itself. When the flux out of the page grows, the induced field points into the page, so the current is clockwise. When the flux out of the page shrinks, the induced field points out of the page, so the current is counterclockwise.
    `.trim(),
    derivationSteps: [
      {
        step: 1,
        title: 'Flux through the loop',
        latex: '\\Phi_B = \\int_S \\mathbf{B} \\cdot d\\mathbf{a} = BA\\cos\\theta \\quad (\\text{uniform } \\mathbf{B})',
        description: 'Choose a direction for the area vector. The right-hand rule then fixes the positive sense of circulation around the loop.'
      },
      {
        step: 2,
        title: 'Loop that enters a field region',
        latex: '\\Phi_B = B\\ell x \\implies \\frac{d\\Phi_B}{dt} = B\\ell v',
        description: 'A length $x$ of the loop is inside the field and grows at speed $v$. The emf has magnitude $B\\ell v$ and does not depend on the width of the loop.'
      },
      {
        step: 3,
        title: 'The same result from the magnetic force',
        latex: '\\mathcal{E} = \\oint (\\mathbf{v} \\times \\mathbf{B}) \\cdot d\\mathbf{l} = B\\ell v',
        description: 'Only the side of length $\\ell$ that is inside the field contributes. On the two sides parallel to $\\mathbf{v}$, the force $q\\,\\mathbf{v} \\times \\mathbf{B}$ is perpendicular to the wire.'
      },
      {
        step: 4,
        title: 'Field that changes in time',
        latex: '\\mathcal{E} = -A\\,\\frac{dB}{dt}',
        description: 'No part of the loop moves. The emf comes from the electric field that obeys $\\nabla \\times \\mathbf{E} = -\\partial\\mathbf{B}/\\partial t$.'
      },
      {
        step: 5,
        title: 'Rotating loop',
        latex: '\\Phi_B = BA\\cos\\omega t \\implies \\mathcal{E} = BA\\omega\\sin\\omega t',
        description: 'The emf is largest when the flux passes through zero, because the flux changes fastest there.'
      }
    ],
    limitingCases: [
      {
        name: 'Loop completely inside a uniform field',
        condition: 'd\\Phi_B/dt = 0',
        formula: '\\mathcal{E} = 0',
        description: 'The flux is large and constant. The emfs in the leading side and the trailing side cancel.'
      },
      {
        name: 'Coil of $N$ turns',
        condition: '$N$ turns in series',
        formula: '\\mathcal{E} = -N\\,\\frac{d\\Phi_B}{dt}',
        description: 'Each turn contributes the same emf.'
      },
      {
        name: 'Peak emf of a generator',
        condition: '\\theta = \\omega t',
        formula: '\\mathcal{E}_{\\max} = NBA\\omega',
        description: 'Doubling the rotation rate doubles the peak emf and also doubles its frequency.'
      },
      {
        name: 'Charge that flows',
        condition: 'loop resistance $R$',
        formula: 'Q = \\int I\\,dt = \\frac{|\\Delta\\Phi_B|}{R}',
        description: 'The total charge depends only on the net change in flux, not on how fast the change happens.'
      }
    ],
    greTraps: [
      {
        trap: 'Flux is not emf',
        warning: 'For the rotating loop the emf is zero at the instant the flux is largest. For a loop that is completely inside a uniform field the emf is zero the whole time.',
        strategy: 'Use the slope of $\\Phi_B(t)$, not its value.'
      },
      {
        trap: 'Lenz opposes the change',
        warning: 'The induced field does not always point opposite to $\\mathbf{B}$. When the flux is decreasing, the induced field points along $\\mathbf{B}$ and replaces part of the lost flux.',
        strategy: 'State two things in order: the direction of $\\mathbf{B}$ through the loop, and whether the flux is growing or shrinking. Then apply the right-hand rule to the induced field.'
      },
      {
        trap: 'Emf against time for a loop through a field region',
        warning: 'The graph is two rectangular pulses of opposite sign with zero between them. It is not one bump and not a triangle.',
        strategy: 'The pulse height is $B\\ell v$. Each pulse lasts $w/v$, the time the loop takes to cross one edge of the region.'
      },
      {
        trap: 'Which length matters',
        warning: 'For a loop that enters a field, the emf depends on the side perpendicular to the velocity, not on the side along the velocity.',
        strategy: 'Use the length of the side that moves across the field lines.'
      }
    ],
    parameters: [
      { id: 'scenario', label: 'How the flux changes', type: 'select', options: [
        { value: 'cross', label: 'Loop crosses a field region' },
        { value: 'ramp', label: 'Field strength oscillates' },
        { value: 'rotate', label: 'Loop rotates in the field' }
      ], default: 'cross', hint: 'Three ways to change $\\Phi_B = BA\\cos\\theta$: change the area inside the field, change $B$, or change $\\theta$. The rule $\\mathcal{E} = -d\\Phi_B/dt$ is the same for all three.' },
      { id: 'fieldDir', label: 'Field direction', type: 'select', options: [
        { value: 'out', label: 'Out of the page' },
        { value: 'in', label: 'Into the page' }
      ], default: 'out', hint: 'A dot in a ring is a field that points out of the page, toward you. A cross in a ring points into the page. Reversing the field reverses the sign of $\\Phi_B$ and the sense of the induced current.' },
      { id: 'B0', label: 'Field strength $B_0$', min: 0.2, max: 2.0, step: 0.1, default: 1.0, unit: 'T', hint: 'Magnitude of the field (its peak value when the field oscillates). The flux and the emf are both proportional to it.' },
      { id: 'speed', label: 'Loop speed $v$', min: 0.5, max: 3.0, step: 0.1, default: 1.5, unit: 'm/s', hint: 'Used when the loop crosses the field region. The emf pulse has height $B\\ell v$ and lasts $w/v$: a faster loop gives a taller, shorter pulse of the same area.' },
      { id: 'omega', label: 'Angular frequency $\\omega$', min: 0.5, max: 4.0, step: 0.1, default: 2.0, unit: 'rad/s', hint: 'Used when the field oscillates or the loop rotates. The peak emf is $B_0 A\\omega$: a faster change gives a larger emf for the same peak flux.' },
      { id: 'loopW', label: 'Loop width $w$', min: 0.5, max: 3.0, step: 0.1, default: 2.0, unit: 'm', hint: 'Side of the loop along the direction of motion. The other side is fixed at $\\ell = 1.5\\,\\mathrm{m}$. For the crossing loop, $w$ changes how long each pulse lasts and not how tall it is.' },
      { id: 'simSpeed', label: 'Simulation Speed', min: 0.2, max: 3.0, step: 0.2, default: 1.0, unit: 'x' }
    ],

    init: function (container, state) {
      state._t = 0;
      state._ph = 0;
    },

    onParamChange: function (id, val, state) {
      if (state && id === 'scenario') state._t = 0;
    },

    draw: function (ctx, width, height, state, dt) {
      state = state || {};
      var size = canvasSize(width, height);
      width = size.w;
      height = size.h;
      fillStage(ctx, width, height);

      var scenario = FARADAY_SCENARIOS[state.scenario] ? String(state.scenario) : 'cross';
      var dirSign = String(state.fieldDir) === 'in' ? -1 : 1;
      var B0 = clampNum(numParam(state, 'B0', 1), 0.05, 5);
      var v = clampNum(numParam(state, 'speed', 1.5), 0.1, 6);
      var omega = clampNum(numParam(state, 'omega', 2), 0.1, 10);
      var w = clampNum(numParam(state, 'loopW', 2), 0.3, 3);
      var ell = 1.5;
      var area = ell * w;
      var D = 3.5;
      var lead = 1.2;
      var spd = speedParam(state);
      dt = safeDt(dt);
      state._t = (state._t || 0) + dt * spd;

      var T = scenario === 'cross' ? (D + w + 2 * lead) / v : (2 * Math.PI) / omega;
      var t = state._t % T;

      // B, Phi and emf are signed with "out of the page" (toward the viewer) positive.
      function overlap(tt) {
        var xr = -lead + v * tt;
        return clampNum(Math.min(xr, D) - Math.max(xr - w, 0), 0, w);
      }
      function phi(tt) {
        if (scenario === 'cross') return dirSign * B0 * ell * overlap(tt);
        if (scenario === 'ramp') return dirSign * B0 * area * Math.sin(omega * tt);
        return dirSign * B0 * area * Math.cos(omega * tt);
      }
      function emf(tt) {
        if (scenario === 'cross') {
          var xr = -lead + v * tt;
          if (xr > 0 && xr < w) return -dirSign * B0 * ell * v;
          if (xr > D && xr < D + w) return dirSign * B0 * ell * v;
          return 0;
        }
        if (scenario === 'ramp') return -dirSign * B0 * area * omega * Math.cos(omega * tt);
        return dirSign * B0 * area * omega * Math.sin(omega * tt);
      }
      var phiMax = scenario === 'cross' ? B0 * ell * w : B0 * area;
      var emfMax = scenario === 'cross' ? B0 * ell * v : B0 * area * omega;
      var phiNow = phi(t);
      var emfNow = emf(t);
      var theta = scenario === 'rotate' ? omega * t : 0;
      var cosT = Math.cos(theta);
      var face = cosT >= 0 ? 1 : -1;
      // Sense of the current as seen in the picture (+ is counterclockwise).
      var emfView = scenario === 'rotate' ? emfNow * face : emfNow;
      var fluxView = scenario === 'rotate' ? phiNow * face : phiNow;
      var sense = Math.abs(emfView) < emfMax * 0.02 ? 0 : (emfView > 0 ? 1 : -1);
      state._ph = (state._ph || 0) + dt * spd * 70 * clampNum(emfView / Math.max(emfMax, 1e-9), -1, 1);

      var pad = 12;
      var wide = width >= height * 1.9;
      var scene;
      var graphs;
      if (wide) {
        var gwid = clampNum(Math.round(width * 0.42), 260, 480);
        scene = { x: pad, y: pad, w: width - gwid - 3 * pad, h: height - 2 * pad };
        graphs = { x: scene.x + scene.w + pad, y: pad, w: gwid, h: height - 2 * pad };
      } else {
        var ghei = Math.round(height * 0.46);
        scene = { x: pad, y: pad, w: width - 2 * pad, h: height - ghei - 3 * pad };
        graphs = { x: pad, y: scene.y + scene.h + pad, w: width - 2 * pad, h: ghei };
      }

      var sc = Math.min(scene.w / 8.7, scene.h / 3.4);
      var scx = scene.x + scene.w / 2;
      var scy = scene.y + scene.h / 2;
      var spots = [];
      var i;
      var j;

      ctx.save();
      clipRect(ctx, scene);

      var loopCx;
      var loopW = w * sc;
      var loopH = ell * sc;
      var bNow = scenario === 'ramp' ? dirSign * B0 * Math.sin(omega * t) : dirSign * B0;
      var strength = Math.abs(bNow) / 2.0;

      if (scenario === 'cross') {
        var rx = scx - (D / 2) * sc;
        var ry = scy - 1.3 * sc;
        var rw = D * sc;
        var rh = 2.6 * sc;
        ctx.fillStyle = tint(TEAL, 0.09);
        ctx.fillRect(rx, ry, rw, rh);
        ctx.save();
        ctx.strokeStyle = tint(TEAL, 0.8);
        ctx.lineWidth = 1.2;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.restore();
        for (i = 0; i < 5; i++) {
          for (j = 0; j < 4; j++) {
            fieldMark(ctx, rx + (0.35 + 0.7 * i) * sc, ry + (0.25 + 0.7 * j) * sc, dirSign > 0, 0.25 + 0.75 * strength, TEAL);
          }
        }
        haloLabel(ctx, 'uniform field', rx + rw / 2, Math.max(scene.y + 9, ry - 10), { color: TEAL });
        var xrNow = -lead + v * t;
        loopCx = rx + (xrNow - w / 2) * sc;
        spots.push({
          id: 'region', kind: 'rect', x: rx, y: ry, w: rw, h: rh,
          title: 'Field region',
          body: 'Uniform field $B = ' + (dirSign * B0).toFixed(1) + '\\,\\mathrm{T}$ (' + (dirSign > 0 ? 'out of' : 'into') + ' the page) over a width of $' + D.toFixed(1) + '\\,\\mathrm{m}$, and zero outside. The flux is $B\\ell$ times the length of the loop that is inside.'
        });
      } else {
        var cols = Math.ceil(scene.w / (0.7 * sc) / 2) + 1;
        var rows = Math.ceil(scene.h / (0.7 * sc) / 2) + 1;
        ctx.fillStyle = tint(TEAL, 0.03 + 0.07 * strength);
        ctx.fillRect(scene.x, scene.y, scene.w, scene.h);
        for (i = -cols; i <= cols; i++) {
          for (j = -rows; j <= rows; j++) {
            fieldMark(ctx, scx + (i + 0.5) * 0.7 * sc, scy + (j + 0.5) * 0.7 * sc, bNow > 0, scenario === 'ramp' ? Math.abs(bNow) / B0 * (0.25 + 0.75 * B0 / 2) : 0.25 + 0.75 * strength, TEAL);
          }
        }
        loopCx = scx;
      }

      // the conducting loop
      var drawnW = scenario === 'rotate' ? Math.max(3, loopW * Math.abs(cosT)) : loopW;
      var lx0 = loopCx - drawnW / 2;
      var ly0 = scy - loopH / 2;
      if (scenario === 'rotate') {
        segment(ctx, loopCx, ly0 - 16, loopCx, ly0 + loopH + 16, AXIS, 1, [7, 3, 2, 3]);
      }
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.fillStyle = chipFade(0.35);
      ctx.fillRect(lx0, ly0, drawnW, loopH);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3.4;
      ctx.strokeRect(lx0, ly0, drawnW, loopH);
      if (sense !== 0) {
        // path runs counterclockwise on screen; the dash offset carries the direction
        ctx.strokeStyle = CORAL;
        ctx.lineWidth = 3.4;
        ctx.setLineDash([9, 11]);
        ctx.lineDashOffset = -state._ph;
        ctx.beginPath();
        ctx.moveTo(lx0, ly0 + loopH);
        ctx.lineTo(lx0 + drawnW, ly0 + loopH);
        ctx.lineTo(lx0 + drawnW, ly0);
        ctx.lineTo(lx0, ly0);
        ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();
      if (sense !== 0) {
        var up = -Math.PI / 2;
        var dn = Math.PI / 2;
        arrowHead(ctx, lx0 + drawnW, scy + (sense > 0 ? -6 : 6), sense > 0 ? up : dn, 11, deepCoral());
        arrowHead(ctx, lx0, scy + (sense > 0 ? 6 : -6), sense > 0 ? dn : up, 11, deepCoral());
        if (drawnW > 30) {
          arrowHead(ctx, loopCx + (sense > 0 ? 6 : -6), ly0 + loopH, sense > 0 ? 0 : Math.PI, 11, deepCoral());
          arrowHead(ctx, loopCx + (sense > 0 ? -6 : 6), ly0, sense > 0 ? Math.PI : 0, 11, deepCoral());
        }
        if (drawnW > 34) {
          fieldMark(ctx, loopCx, scy, sense > 0, 0.4 + 0.6 * Math.abs(emfView) / Math.max(emfMax, 1e-9), CORAL, 9);
        }
      }
      var senseWord = sense === 0 ? 'no current' : (sense > 0 ? 'counterclockwise current' : 'clockwise current');
      haloLabel(ctx, senseWord, clampNum(loopCx, scene.x + 70, scene.x + scene.w - 70), Math.min(scene.y + scene.h - 9, ly0 + loopH + 15), { color: sense === 0 ? MUTED : deepCoral() });

      if (scenario === 'cross') {
        var vx0 = lx0 + drawnW + 8;
        var vx1 = vx0 + 14 + 12 * v;
        arrowLine(ctx, vx0, ly0 + 10, vx1, ly0 + 10, INK, 2);
        symLabel(ctx, 'v', vx1 + 9, ly0 + 10, { size: 14 });
        spots.push({
          id: 'velocity', kind: 'segment', x1: vx0, y1: ly0 + 10, x2: vx1, y2: ly0 + 10, halfW: 8,
          title: 'Loop velocity $v$',
          body: 'The loop moves at a constant $v = ' + v.toFixed(1) + '\\,\\mathrm{m/s}$. The length inside the field changes at this rate while the loop crosses an edge of the region.'
        });
      }

      if (scenario === 'rotate') {
        // view from above, looking down the rotation axis; the viewer of the main picture is at the bottom
        var ix = scene.x + 46;
        var iy = scene.y + 46;
        dot(ctx, ix, iy, 31, chipFade(0.9), LINE, 1);
        var bx = Math.cos(theta) * 22;
        var by = -Math.sin(theta) * 22;
        segment(ctx, ix - bx, iy - by, ix + bx, iy + by, INK, 3.2);
        arrowLine(ctx, ix, iy, ix + Math.sin(theta) * 26, iy + Math.cos(theta) * 26, deepCoral(), 1.8);
        arrowLine(ctx, ix + 44, iy - dirSign * 14, ix + 44, iy + dirSign * 14, TEAL, 2);
        symLabel(ctx, 'B', ix + 57, iy, { color: TEAL, size: 13, roman: true });
        haloLabel(ctx, 'top view', ix, iy + 42, { color: MUTED, font: SANS });
        spots.push({
          id: 'topView', kind: 'circle', x: ix, y: iy, r: 31,
          title: 'View from above',
          body: 'The dark bar is the loop seen edge-on and the coral arrow is its area vector. You look at the main picture from the bottom of this view. The area vector has turned by $\\theta = \\omega t = ' + (Math.round(theta * 180 / Math.PI) % 360) + '^\\circ$ from the direction out of the page, so $\\Phi_B = BA\\cos\\theta$ with $B$ signed: positive out of the page.'
        });
      }
      ctx.restore();

      spots.push({
        id: 'loop', kind: 'rect', x: clampNum(lx0, scene.x, scene.x + scene.w - 4), y: ly0, w: Math.max(4, Math.min(drawnW, scene.x + scene.w - lx0)), h: loopH,
        title: 'Conducting loop',
        body: 'Area $A = \\ell w = ' + area.toFixed(2) + '\\,\\mathrm{m^2}$. Now $\\Phi_B = ' + phiNow.toFixed(2) + '\\,\\mathrm{Wb}$ and $\\mathcal{E} = ' + emfNow.toFixed(2) + '\\,\\mathrm{V}$. ' +
          (sense === 0 ? 'The flux is not changing, so there is no current.' : (drawnW > 34 ? 'The coral ring symbol at the center is the field made by the induced current.' : 'The coral dashes on the wire move in the direction of the induced current.'))
      });

      // graphs of flux and emf over one cycle
      var gL = graphs.x + 46;
      var gR = graphs.x + graphs.w - 10;
      var gW = Math.max(40, gR - gL);
      var half = (graphs.h - 22) / 2;
      var p1 = { y: graphs.y + 2, h: half - 6 };
      var p2 = { y: graphs.y + 2 + half + 6, h: half - 6 };
      var phiScale = niceCeil(phiMax);
      var emfScale = niceCeil(emfMax);
      function GX(tt) { return gL + (tt / T) * gW; }

      if (scenario === 'cross') {
        var bands = [[lead / v, (lead + w) / v, 'entering'], [(lead + D) / v, (lead + D + w) / v, 'leaving']];
        bands.forEach(function (b) {
          ctx.fillStyle = tint(GOLD, 0.12);
          ctx.fillRect(GX(b[0]), p1.y, GX(b[1]) - GX(b[0]), p2.y + p2.h - p1.y);
          ctx.save();
          ctx.font = '10px Inter, -apple-system, sans-serif';
          ctx.fillStyle = MUTED;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          if (GX(b[1]) - GX(b[0]) > 40) ctx.fillText(b[2], (GX(b[0]) + GX(b[1])) / 2, p1.y + 2);
          ctx.restore();
        });
      }

      function drawPlot(p, fn, scale, color, name, unit, nowVal) {
        var mid = p.y + p.h / 2;
        var amp = p.h / 2 - 5;
        segment(ctx, gL, p.y, gL, p.y + p.h, AXIS, 1.2);
        segment(ctx, gL, mid, gR, mid, AXIS, 1.2);
        segment(ctx, gL, mid - amp, gR, mid - amp, inkFade(0.14), 1, [2, 4]);
        segment(ctx, gL, mid + amp, gR, mid + amp, inkFade(0.14), 1, [2, 4]);
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.3;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        var k;
        var N = 320;
        for (k = 0; k <= N; k++) {
          var tt = T * k / N;
          var yy = mid - (fn(tt) / scale) * amp;
          if (k === 0) ctx.moveTo(GX(tt), yy);
          else ctx.lineTo(GX(tt), yy);
        }
        ctx.stroke();
        ctx.restore();
        var ny = mid - (nowVal / scale) * amp;
        symLabel(ctx, name, gL - 22, mid, { size: 14, color: color === CORAL ? deepCoral() : color });
        symLabel(ctx, scaleText(scale) + ' ' + unit, gR - 2, mid - amp - 1, { size: 11, roman: true, color: MUTED, align: 'right' });
        return { mid: mid, amp: amp, ny: ny };
      }
      var g1 = drawPlot(p1, phi, phiScale, TEAL, 'Φ_B', 'Wb', phiNow);
      var g2 = drawPlot(p2, emf, emfScale, CORAL, 'ℰ', 'V', emfNow);
      var curX = GX(t);
      segment(ctx, curX, p1.y, curX, p2.y + p2.h, inkFade(0.45), 1.2);
      dot(ctx, curX, g1.ny, 4.6, TEAL, CREAM, 1.5);
      dot(ctx, curX, g2.ny, 4.6, CORAL, CREAM, 1.5);
      symLabel(ctx, 't', gR - 4, p2.y + p2.h + 10, { size: 13, color: MUTED, halo: false });

      spots.push({
        id: 'phiDot', kind: 'circle', x: curX, y: g1.ny, r: 10,
        title: 'Flux now',
        body: '$\\Phi_B = ' + phiNow.toFixed(2) + '\\,\\mathrm{Wb}$. Its slope at this instant is $d\\Phi_B/dt = ' + (-emfNow).toFixed(2) + '\\,\\mathrm{Wb/s}$.'
      });
      spots.push({
        id: 'emfDot', kind: 'circle', x: curX, y: g2.ny, r: 10,
        title: 'Emf now',
        body: '$\\mathcal{E} = -d\\Phi_B/dt = ' + emfNow.toFixed(2) + '\\,\\mathrm{V}$: minus the slope of the upper curve at the same instant.'
      });
      spots.push({
        id: 'phiPlot', kind: 'rect', x: gL, y: p1.y, w: gW, h: p1.h,
        title: 'Flux $\\Phi_B(t)$',
        body: 'One cycle of the motion. The dotted lines are $\\pm ' + scaleText(phiScale) + '\\,\\mathrm{Wb}$. ' + (scenario === 'rotate' ? 'Positive flux is along the area vector of the loop, which points out of the page only while the front of the loop faces you.' : 'Positive flux points out of the page.')
      });
      spots.push({
        id: 'emfPlot', kind: 'rect', x: gL, y: p2.y, w: gW, h: p2.h,
        title: 'Emf $\\mathcal{E}(t)$',
        body: 'Minus the slope of the flux curve. The dotted lines are $\\pm ' + scaleText(emfScale) + '\\,\\mathrm{V}$. ' +
          (scenario === 'cross' ? 'It is zero while the loop is completely inside or completely outside the field.' : 'It is a quarter of a cycle out of step with the flux: largest where the flux crosses zero.')
      });
      spots.push({
        id: 'scene', kind: 'rect', x: scene.x, y: scene.y, w: scene.w, h: scene.h,
        title: 'Loop and field, seen face-on',
        body: 'Teal ring symbols show $\\mathbf{B}$: a dot points out of the page and a cross points into the page. Coral dashes on the wire move in the direction of the induced current.'
      });
      PGRE.setVizHotspots(spots);

      var rate = -emfView;
      var lenz;
      if (sense === 0) {
        lenz = 'flux is constant: no induced field';
      } else if (rate > 0) {
        lenz = (fluxView >= 0 ? 'flux out of the page grows' : 'flux into the page shrinks') + ': induced field points into the page';
      } else {
        lenz = (fluxView > 0 ? 'flux out of the page shrinks' : 'flux into the page grows') + ': induced field points out of the page';
      }
      vizLegend("Faraday's law", [
        { label: 'Scenario', value: FARADAY_SCENARIOS[scenario], hint: 'Which factor of $\\Phi_B = BA\\cos\\theta$ changes: the area inside the field, the field strength, or the angle.' },
        { label: (scenario === 'cross' ? '$B$ inside the region' : '$B$') + ' (out of the page is $+$)', value: '$' + bNow.toFixed(2) + '\\,\\mathrm{T}$', hint: (scenario === 'cross' ? 'Field inside the dashed region, with its sign. Outside the region the field is zero.' : 'Field at the loop, with its sign.') + ' Positive points out of the page, toward you.' },
        { label: '$\\Phi_B$', value: '$' + phiNow.toFixed(2) + '\\,\\mathrm{Wb}$', hint: 'Flux through the loop at this instant' + (scenario === 'rotate' ? ', measured along the area vector of the loop, which turns with it' : '') + '. The teal curve.' },
        { label: '$d\\Phi_B/dt$', value: '$' + (-emfNow).toFixed(2) + '\\,\\mathrm{Wb/s}$', hint: 'Slope of the teal curve at the cursor.' },
        { label: '$\\mathcal{E} = -d\\Phi_B/dt$', value: '$' + emfNow.toFixed(2) + '\\,\\mathrm{V}$', hint: 'Induced emf. With the area vector toward you, a positive value drives current counterclockwise. The coral curve.' },
        { label: 'Induced current', value: sense === 0 ? 'none' : (sense > 0 ? 'counterclockwise' : 'clockwise'), hint: 'Sense of circulation as seen in the picture.' + (scenario === 'rotate' ? ' For the rotating loop it also reverses each time the loop turns its other face toward you.' : '') },
        { label: 'Lenz', value: lenz, hint: 'The induced field opposes the change in flux. Apply the right-hand rule to that field to get the sense of the current.' },
        { label: 'Peak $|\\mathcal{E}|$', value: scenario === 'cross' ? '$B\\ell v = ' + emfMax.toFixed(2) + '\\,\\mathrm{V}$' : '$B_0 A\\omega = ' + emfMax.toFixed(2) + '\\,\\mathrm{V}$', hint: scenario === 'cross'
          ? 'With $\\ell = 1.5\\,\\mathrm{m}$. It does not contain the loop width $w$.'
          : 'With $A = \\ell w = ' + area.toFixed(2) + '\\,\\mathrm{m^2}$. It is proportional to $\\omega$.' }
      ]);
    },

    challenge: {
      question: 'A square loop of side $0.20\\,\\mathrm{m}$ and resistance $2.0\\,\\Omega$ moves at $5.0\\,\\mathrm{m/s}$ from a field-free region into a region of uniform field $B = 0.40\\,\\mathrm{T}$ that points out of the page. While the loop is partly inside the field, the induced current is:',
      options: [
        '$0.20\\,\\mathrm{A}$, clockwise',
        '$0.20\\,\\mathrm{A}$, counterclockwise',
        '$0.40\\,\\mathrm{A}$, clockwise',
        '$0.040\\,\\mathrm{A}$, counterclockwise',
        'zero, because the field is uniform'
      ],
      correct: 0,
      explanation: 'The flux is $\\Phi_B = B\\ell x$, where $x$ is the length of the loop inside the field, so $|\\mathcal{E}| = B\\ell v = (0.40)(0.20)(5.0) = 0.40\\,\\mathrm{V}$ and $I = |\\mathcal{E}|/R = 0.20\\,\\mathrm{A}$. The flux out of the page is growing, so the induced field points into the page, and that needs a clockwise current. Choice (C) is the emf in volts, not the current. Choice (E) is correct only after the loop is completely inside the field.'
    }
  };


  /* ====================================================================== */
  /* cpgf-4.42 — Fermi-Dirac occupation number                              */
  /* ====================================================================== */

  var FD_E_MAX = 10;

  PGRE.visualizers['cpgf-4.42'] = {
    id: 'cpgf-4.42',
    topic: 'th',
    title: 'Fermi–Dirac Occupation Number: $F_{\\mathrm{FD}} = 1/(e^{(\\epsilon - \\mu)/k_B T} + 1)$',
    formulaLatex: 'F_{\\mathrm{FD}}(\\epsilon) = \\frac{1}{e^{(\\epsilon - \\mu)/k_B T} + 1}',
    physicalStory: `
$F_{\\mathrm{FD}}(\\epsilon)$ is the average number of fermions in one single-particle state of energy $\\epsilon$. The Pauli exclusion principle allows zero or one fermion in a state, so the average lies between $0$ and $1$, and it is also the probability that the state is filled.

At $T = 0$ the curve is a step: every state below $\\mu$ is filled and every state above $\\mu$ is empty. Raising the temperature does not shift the whole distribution. It rounds the step inside a band a few $k_B T$ wide around $\\mu$. States far below $\\mu$ stay full, because every state within a few $k_B T$ above them is already occupied, and states far above $\\mu$ stay empty. The curve passes through $\\frac{1}{2}$ at $\\epsilon = \\mu$ at every temperature, and it is symmetric about that point: $F_{\\mathrm{FD}}(\\mu + \\delta) + F_{\\mathrm{FD}}(\\mu - \\delta) = 1$.

Each dot in the strip under the plot is one state. A filled dot holds a fermion. The dots are redrawn at random with probability $F_{\\mathrm{FD}}$, so the fraction that is filled in each column follows the curve. Only the columns inside the thermal band change from one moment to the next.
    `.trim(),
    derivationSteps: [
      {
        step: 1,
        title: 'One state as a system',
        latex: 'n = 0 \\ \\text{or} \\ 1, \\qquad E_n = n\\,\\epsilon',
        description: 'Treat a single state as a system that exchanges energy and particles with the rest of the gas. Exclusion leaves two configurations: empty, or occupied by one fermion.'
      },
      {
        step: 2,
        title: 'Grand partition function',
        latex: '\\mathcal{Z} = \\sum_{n=0}^{1} e^{-n(\\epsilon - \\mu)/k_B T} = 1 + e^{-(\\epsilon - \\mu)/k_B T}',
        description: 'Each configuration is weighted by the Gibbs factor $e^{-(E - \\mu N)/k_B T}$.'
      },
      {
        step: 3,
        title: 'Average occupation',
        latex: '\\langle n \\rangle = \\frac{0 \\cdot 1 + 1 \\cdot e^{-(\\epsilon - \\mu)/k_B T}}{1 + e^{-(\\epsilon - \\mu)/k_B T}} = \\frac{1}{e^{(\\epsilon - \\mu)/k_B T} + 1}',
        description: 'Multiply the numerator and the denominator by $e^{(\\epsilon - \\mu)/k_B T}$.'
      },
      {
        step: 4,
        title: 'Bosons for comparison',
        latex: '\\mathcal{Z} = \\sum_{n=0}^{\\infty} e^{-n(\\epsilon - \\mu)/k_B T} \\implies \\langle n \\rangle = \\frac{1}{e^{(\\epsilon - \\mu)/k_B T} - 1}',
        description: 'With no limit on $n$ the sum is a geometric series, and the $+1$ becomes $-1$.'
      }
    ],
    limitingCases: [
      {
        name: 'Zero temperature',
        condition: 'T \\to 0',
        formula: 'F_{\\mathrm{FD}} = 1 \\ (\\epsilon \\lt \\mu), \\qquad F_{\\mathrm{FD}} = 0 \\ (\\epsilon \\gt \\mu)',
        description: 'A sharp step at $\\mu$. At $T = 0$ the chemical potential equals the Fermi energy $E_F$.'
      },
      {
        name: 'At the chemical potential',
        condition: '\\epsilon = \\mu',
        formula: 'F_{\\mathrm{FD}} = \\frac{1}{2}',
        description: 'True at every temperature.'
      },
      {
        name: 'Classical limit',
        condition: '\\epsilon - \\mu \\gg k_B T',
        formula: 'F_{\\mathrm{FD}} \\approx e^{-(\\epsilon - \\mu)/k_B T}',
        description: 'The $+1$ is negligible. Fermi–Dirac, Bose–Einstein and Boltzmann statistics agree when the occupation is much less than one.'
      },
      {
        name: 'Width of the rounded step',
        condition: 'T \\gt 0',
        formula: 'F_{\\mathrm{FD}}(\\mu \\mp 2k_B T) = 0.88,\\ 0.12',
        description: 'The occupation falls from $0.88$ to $0.12$ across $4k_B T$. Only a fraction of about $k_B T/E_F$ of the fermions can be thermally excited, which is why the electrons add little to the heat capacity of a metal.'
      }
    ],
    greTraps: [
      {
        trap: 'Plus one or minus one',
        warning: 'The two quantum distributions differ in one sign. With $-1$ the occupation grows without limit as $\\epsilon \\to \\mu$: that is the boson formula.',
        strategy: 'The occupation of a fermion state can never exceed $1$, so the denominator must be at least $1$. That requires $+1$.'
      },
      {
        trap: 'Value at $\\epsilon = \\mu$',
        warning: 'The occupation at the chemical potential is $\\frac{1}{2}$. It is not $1$ and it is not $1/e$.',
        strategy: 'Set the exponent to zero: $1/(1 + 1)$.'
      },
      {
        trap: 'Temperature does not empty the low states',
        warning: 'At room temperature $k_B T \\approx 0.025\\,\\mathrm{eV}$, and $E_F$ in a metal is several $\\mathrm{eV}$. The distribution is almost a perfect step.',
        strategy: 'Compare $k_B T$ with $E_F$ first. If $k_B T \\ll E_F$, only the states within a few $k_B T$ of $E_F$ change.'
      },
      {
        trap: 'Chemical potential and temperature',
        warning: 'For a fixed number of fermions, $\\mu$ equals $E_F$ only at $T = 0$ and decreases slowly as $T$ rises.',
        strategy: 'In this picture $\\mu$ is set directly with a slider. In a problem with a fixed number $N$, find $\\mu$ from $N = \\int \\rho(\\epsilon)\\,F_{\\mathrm{FD}}(\\epsilon)\\,d\\epsilon$.'
      }
    ],
    parameters: [
      { id: 'temp', label: 'Thermal energy $k_B T$', min: 0, max: 2, step: 0.05, default: 0.5, unit: '', hint: 'Temperature expressed as an energy, in the same unit as $\\epsilon$ and $\\mu$. At $0$ the curve is a step. The step rounds off over a width of about $4k_B T$.' },
      { id: 'mu', label: 'Chemical potential $\\mu$', min: 1, max: 9, step: 0.1, default: 5, unit: '', hint: 'The energy at which the occupation is exactly $\\frac{1}{2}$. Raising $\\mu$ adds fermions: the step moves to the right without changing its shape.' },
      { id: 'probe', label: 'Probe energy $\\epsilon$', min: 0, max: 10, step: 0.1, default: 6, unit: '', hint: 'Energy at which the readouts report the occupation. Place it at $\\mu + k_B T$ or $\\mu + 2k_B T$ to read the standard values $0.27$ and $0.12$.' },
      { id: 'compare', label: 'Compare Bose–Einstein and Boltzmann', type: 'toggle', default: false, hint: 'Overlay $1/(e^{x} - 1)$ and $e^{-x}$ with $x = (\\epsilon - \\mu)/k_B T$ for the same $\\mu$ and $T$. The three curves agree where the occupation is small and differ near $\\epsilon = \\mu$.' },
      { id: 'simSpeed', label: 'Simulation Speed', min: 0.2, max: 3.0, step: 0.2, default: 1.0, unit: 'x' }
    ],

    init: function (container, state) {
      state._t = 0;
      state._occ = null;
      state._key = '';
    },

    draw: function (ctx, width, height, state, dt) {
      state = state || {};
      var size = canvasSize(width, height);
      width = size.w;
      height = size.h;
      fillStage(ctx, width, height);

      var kT = clampNum(numParam(state, 'temp', 0.5), 0, 5);
      var mu = clampNum(numParam(state, 'mu', 5), 0, FD_E_MAX);
      var probe = clampNum(numParam(state, 'probe', 6), 0, FD_E_MAX);
      var compare = flagParam(state, 'compare', false);
      var cold = kT < 1e-6;
      dt = safeDt(dt);
      var step = dt * speedParam(state);
      state._t = (state._t || 0) + step;

      function xOf(e) { return cold ? (e > mu ? Infinity : (e < mu ? -Infinity : 0)) : (e - mu) / kT; }
      function fd(e) {
        var x = xOf(e);
        if (x > 40) return 0;
        if (x < -40) return 1;
        return 1 / (Math.exp(x) + 1);
      }
      function be(e) {
        var x = xOf(e);
        if (!(x > 0)) return NaN;
        if (x > 40) return 0;
        return 1 / (Math.exp(x) - 1);
      }
      function mb(e) {
        var x = xOf(e);
        if (x > 40) return 0;
        if (x < -12) return 1e5;
        return Math.exp(-x);
      }

      var padL = 44;
      var padR = 16;
      var padT = 14;
      var stripH = clampNum(Math.round(height * 0.3), 80, 128);
      var axisH = 22;
      var plot = { x: padL, y: padT, w: Math.max(60, width - padL - padR), h: Math.max(50, height - padT - stripH - axisH - 14) };
      var strip = { x: plot.x, y: plot.y + plot.h + 10, w: plot.w, h: stripH };
      var yMax = compare ? 2.2 : 1.12;
      function EX(e) { return plot.x + (e / FD_E_MAX) * plot.w; }
      function FY(v) { return plot.y + plot.h - (v / yMax) * plot.h; }
      var spots = [];
      var i;
      var e;

      // thermal band, in the plot and in the strip
      var bandL = clampNum(mu - 2 * kT, 0, FD_E_MAX);
      var bandR = clampNum(mu + 2 * kT, 0, FD_E_MAX);
      var bandCut = mu - 2 * kT < 0 || mu + 2 * kT > FD_E_MAX;
      if (!cold) {
        ctx.fillStyle = tint(GOLD, 0.13);
        ctx.fillRect(EX(bandL), plot.y, EX(bandR) - EX(bandL), plot.h);
        ctx.fillRect(EX(bandL), strip.y, EX(bandR) - EX(bandL), strip.h);
      }

      // occupation axis
      ctx.save();
      ctx.font = '10px Inter, -apple-system, sans-serif';
      ctx.fillStyle = MUTED;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      var levels = compare ? [0, 0.5, 1, 2] : [0, 0.5, 1];
      levels.forEach(function (lv) {
        segment(ctx, plot.x, FY(lv), plot.x + plot.w, FY(lv), lv === 0 ? AXIS : GRID, lv === 0 ? 1.4 : 1);
        ctx.fillText(lv === 0.5 ? '0.5' : String(lv), plot.x - 6, FY(lv));
      });
      ctx.restore();
      segment(ctx, plot.x, plot.y, plot.x, plot.y + plot.h, AXIS, 1.4);
      symLabel(ctx, 'F', plot.x - 24, plot.y + 8, { size: 14, color: MUTED });

      ctx.save();
      clipRect(ctx, plot);

      // T = 0 step for reference
      ctx.save();
      ctx.strokeStyle = AXIS;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(EX(0), FY(1));
      ctx.lineTo(EX(mu), FY(1));
      ctx.lineTo(EX(mu), FY(0));
      ctx.lineTo(EX(FD_E_MAX), FY(0));
      ctx.stroke();
      ctx.restore();

      function curve(fn, color, lw, dash) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        ctx.lineJoin = 'round';
        ctx.setLineDash(dash || []);
        ctx.beginPath();
        var started = false;
        var k;
        var N = 400;
        for (k = 0; k <= N; k++) {
          var ee = FD_E_MAX * k / N;
          var val = fn(ee);
          if (!isFinite(val)) { started = false; continue; }
          var yy = FY(Math.min(val, yMax * 1.5));
          if (!started) { ctx.moveTo(EX(ee), yy); started = true; }
          else ctx.lineTo(EX(ee), yy);
        }
        ctx.stroke();
        ctx.restore();
      }
      if (compare) {
        curve(mb, GOLD, 1.8, [6, 4]);
        curve(be, VIOLET, 2);
      }
      if (cold) {
        ctx.save();
        ctx.strokeStyle = CORAL;
        ctx.lineWidth = 2.8;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(EX(0), FY(1));
        ctx.lineTo(EX(mu), FY(1));
        ctx.lineTo(EX(mu), FY(0));
        ctx.lineTo(EX(FD_E_MAX), FY(0));
        ctx.stroke();
        ctx.restore();
      } else {
        curve(fd, CORAL, 2.8);
      }
      ctx.restore();

      // chemical potential and probe
      segment(ctx, EX(mu), plot.y, EX(mu), strip.y + strip.h, TEAL, 1.4, [4, 4]);
      segment(ctx, EX(probe), plot.y, EX(probe), strip.y + strip.h, inkFade(0.4), 1.1);
      dot(ctx, EX(mu), FY(0.5), 4.6, TEAL, CREAM, 1.5);
      var fProbe = fd(probe);
      var beProbe = be(probe);
      var mbProbe = mb(probe);
      if (compare) {
        if (isFinite(beProbe) && beProbe <= yMax) dot(ctx, EX(probe), FY(beProbe), 4.2, CREAM, VIOLET, 2);
        if (mbProbe <= yMax && !(cold && probe === mu)) dot(ctx, EX(probe), FY(mbProbe), 4.2, CREAM, GOLD, 2);
      }
      dot(ctx, EX(probe), FY(fProbe), 5.2, CREAM, CORAL, 2.4);
      symLabel(ctx, '\u03bc', clampNum(EX(mu), plot.x + 12, plot.x + plot.w - 12), plot.y + 9, { size: 14, color: TEAL });
      symLabel(ctx, '\u03f5', clampNum(EX(probe) + 11, plot.x + 12, plot.x + plot.w - 8), plot.y + plot.h - 12, { size: 14, color: MUTED });

      if (compare) {
        var lx = plot.x + plot.w - 10;
        haloLabel(ctx, 'Bose–Einstein', lx, plot.y + 10, { color: VIOLET, align: 'right' });
        haloLabel(ctx, 'Boltzmann', lx, plot.y + 26, { color: GOLD, align: 'right' });
        haloLabel(ctx, 'Fermi–Dirac', lx, plot.y + 42, { color: deepCoral(), align: 'right' });
      }

      // strip of states: columns share the energy axis of the plot
      var nCols = width >= 900 ? 50 : (width >= 560 ? 32 : 24);
      var nRows = 5;
      var total = nCols * nRows;
      var key = nCols + '|' + kT.toFixed(3) + '|' + mu.toFixed(3);
      var occ = state._occ;
      var fresh = !occ || occ.length !== total || state._key !== key;
      if (fresh) {
        occ = new Array(total);
        state._occ = occ;
        state._key = key;
      }
      var flip = 1 - Math.exp(-2.4 * step);
      var cw = strip.w / nCols;
      var ch = strip.h / nRows;
      var rad = Math.min(7, Math.min(cw, ch) * 0.36);
      var filled = 0;
      var expected = 0;
      var c;
      var r;
      ctx.save();
      ctx.lineWidth = 1.2;
      for (c = 0; c < nCols; c++) {
        e = (c + 0.5) * FD_E_MAX / nCols;
        // at T = 0 the strip is the step itself: a column exactly at mu counts as filled
        var pFill = cold ? (e <= mu ? 1 : 0) : fd(e);
        expected += pFill * nRows;
        for (r = 0; r < nRows; r++) {
          i = c * nRows + r;
          if (fresh || Math.random() < flip) occ[i] = Math.random() < pFill ? 1 : 0;
          var px = strip.x + (c + 0.5) * cw;
          var py = strip.y + (r + 0.5) * ch;
          ctx.beginPath();
          ctx.arc(px, py, rad, 0, Math.PI * 2);
          if (occ[i]) {
            filled++;
            ctx.fillStyle = CORAL;
            ctx.fill();
          } else {
            ctx.strokeStyle = inkFade(0.26);
            ctx.stroke();
          }
        }
      }
      ctx.restore();

      // energy axis under the strip
      var ay = strip.y + strip.h + 4;
      segment(ctx, strip.x, ay, strip.x + strip.w, ay, AXIS, 1.2);
      ctx.save();
      ctx.font = '10px Inter, -apple-system, sans-serif';
      ctx.fillStyle = MUTED;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (i = 0; i <= FD_E_MAX; i += 2) {
        segment(ctx, EX(i), ay, EX(i), ay + 4, AXIS, 1);
        ctx.fillText(String(i), EX(i), ay + 6);
      }
      ctx.restore();
      ctx.save();
      ctx.translate(plot.x - 24, strip.y + strip.h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.font = SANS;
      ctx.fillStyle = MUTED;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('states', 0, 0);
      ctx.restore();

      var xProbe = xOf(probe);
      // at T = 0 with the probe on mu the exponent is 0/0: only the limit of F_FD exists
      var indet = cold && probe === mu;
      var xText = indet ? '0/0' : (isFinite(xProbe) ? xProbe.toFixed(2) : (xProbe > 0 ? '+\\infty' : '-\\infty'));
      var mbText = indet ? null : (mbProbe > 999 ? '\\gt 999' : mbProbe.toFixed(3));
      spots.push({
        id: 'half', kind: 'circle', x: EX(mu), y: FY(0.5), r: 10,
        title: 'Half filling at $\\epsilon = \\mu$',
        body: cold
          ? 'At $T = 0$ the curve jumps from $1$ to $0$ at $\\epsilon = \\mu = ' + mu.toFixed(1) + '$. The value $\\frac{1}{2}$ marked here is the limit as $T \\to 0$. The curve is symmetric about this point.'
          : 'At $\\epsilon = \\mu = ' + mu.toFixed(1) + '$ the exponent is zero and $F_{\\mathrm{FD}} = \\frac{1}{2}$, at every temperature above zero. The curve is symmetric about this point.'
      });
      spots.push({
        id: 'probe', kind: 'circle', x: EX(probe), y: FY(fProbe), r: 11,
        title: 'Occupation at the probe energy',
        body: '$\\epsilon = ' + probe.toFixed(1) + '$, $(\\epsilon - \\mu)/k_B T = ' + xText + '$' + (indet ? ' at $T = 0$; the value there is the limit' : ', so') + ' $F_{\\mathrm{FD}} = ' + fProbe.toFixed(3) + '$.' +
          (compare ? ' Bose–Einstein: ' + (isFinite(beProbe) ? '$' + beProbe.toFixed(3) + '$' : 'not defined for $\\epsilon \\le \\mu$') + '. Boltzmann: ' + (indet ? 'not defined for $0/0$' : '$' + mbText + '$') + '.' : '')
      });
      if (!cold) {
        spots.push({
          id: 'band', kind: 'rect', x: EX(bandL), y: plot.y, w: Math.max(4, EX(bandR) - EX(bandL)), h: plot.h,
          title: 'Thermal band $\\mu \\pm 2k_B T$',
          body: 'From $\\epsilon = \\mu - 2k_B T = ' + (mu - 2 * kT).toFixed(2) + '$ to $\\mu + 2k_B T = ' + (mu + 2 * kT).toFixed(2) + '$ the occupation falls from $0.88$ to $0.12$.' + (bandCut ? ' The axis shows the part of the band between $0$ and $' + FD_E_MAX + '$.' : '') + ' Outside this band the states are almost completely full or completely empty.'
        });
      }
      spots.push({
        id: 'muLine', kind: 'segment', x1: EX(mu), y1: plot.y, x2: EX(mu), y2: strip.y + strip.h, halfW: 5,
        title: 'Chemical potential $\\mu$',
        body: '$\\mu = ' + mu.toFixed(1) + '$. The dashed step is the distribution at $T = 0$: filled below $\\mu$, empty above.'
      });
      spots.push({
        id: 'strip', kind: 'rect', x: strip.x, y: strip.y, w: strip.w, h: strip.h,
        title: 'Single-particle states',
        body: 'Each column holds $' + nRows + '$ states at one energy. A filled dot is an occupied state. Now $' + filled + '$ of $' + total + '$ are filled; the average is $\\sum F_{\\mathrm{FD}} = ' + expected.toFixed(1) + '$.'
      });
      spots.push({
        id: 'plot', kind: 'rect', x: plot.x, y: plot.y, w: plot.w, h: plot.h,
        title: 'Occupation number against energy',
        body: 'Coral: $F_{\\mathrm{FD}}(\\epsilon)$ for $k_B T = ' + kT.toFixed(2) + '$ and $\\mu = ' + mu.toFixed(1) + '$. Dashed grey: the step at $T = 0$.' +
          (compare ? ' Violet: Bose–Einstein, defined only for $\\epsilon \\gt \\mu$. Dashed gold: Boltzmann factor.' : '')
      });
      PGRE.setVizHotspots(spots);

      var rows = [
        { label: 'Units', value: 'one energy unit for $\\epsilon$, $\\mu$, $k_B T$', hint: 'Only the ratio $(\\epsilon - \\mu)/k_B T$ enters the formula, so any energy unit works as long as all three use it.' },
        { label: '$k_B T$', value: '$' + kT.toFixed(2) + '$', hint: 'Thermal energy. It sets the width of the rounded part of the step and nothing else.' },
        { label: '$\\mu$', value: '$' + mu.toFixed(1) + '$', hint: 'Chemical potential: the energy where the occupation is $\\frac{1}{2}$.' },
        { label: 'Probe: $(\\epsilon - \\mu)/k_B T$', value: '$' + xText + '$', hint: 'The exponent in the formula at the probe energy $\\epsilon = ' + probe.toFixed(1) + '$. Positive above $\\mu$, negative below.' },
        { label: '$F_{\\mathrm{FD}}(\\epsilon)$', value: '$' + fProbe.toFixed(3) + '$' + (indet ? ' (limit as $T \\to 0$)' : ''), hint: 'Probability that a state at the probe energy is occupied. Check: $F_{\\mathrm{FD}}(\\epsilon)$ and the value at the mirror energy $2\\mu - \\epsilon$ add to $1$.' }
      ];
      if (compare) {
        rows.push({ label: '$F_{\\mathrm{BE}}(\\epsilon)$', value: isFinite(beProbe) ? '$' + beProbe.toFixed(3) + '$' : 'not defined for $\\epsilon \\le \\mu$', hint: 'Bose–Einstein occupation $1/(e^{x} - 1)$ at the same $x$. It exceeds the Fermi–Dirac value and diverges as $\\epsilon \\to \\mu$, so for bosons $\\mu$ must lie below every state.' });
        rows.push({ label: '$e^{-(\\epsilon - \\mu)/k_B T}$', value: indet ? 'not defined for $0/0$' : '$' + mbText + '$', hint: 'Boltzmann factor. It lies between the two quantum results and all three agree when it is much less than $1$.' });
      }
      rows.push({ label: 'Band $\\mu \\pm 2k_B T$', value: cold ? 'zero width' : '$' + (mu - 2 * kT).toFixed(2) + '$ to $' + (mu + 2 * kT).toFixed(2) + '$', hint: 'The gold band. Inside it the occupation goes from $0.88$ to $0.12$; only these states change when the temperature changes.' + (bandCut ? ' The axis shows the part of the band between $0$ and $' + FD_E_MAX + '$.' : '') });
      rows.push({ label: 'Filled states', value: '$' + filled + '$ of $' + total + '$, average $' + expected.toFixed(1) + '$', hint: 'Count of filled dots in the strip at this instant, and its average value $\\sum F_{\\mathrm{FD}}$ over all the states shown.' });
      vizLegend('Fermi–Dirac occupation', rows);
    },

    challenge: {
      question: 'A state lies $0.10\\,\\mathrm{eV}$ above the chemical potential of an electron gas at a temperature where $k_B T = 0.050\\,\\mathrm{eV}$. What is the probability that the state is occupied?',
      options: [
        '$\\dfrac{1}{e^{2} + 1} \\approx 0.12$',
        '$e^{-2} \\approx 0.14$',
        '$\\dfrac{1}{e^{2} - 1} \\approx 0.16$',
        '$\\dfrac{1}{e^{1/2} + 1} \\approx 0.38$',
        '$\\dfrac{1}{2}$'
      ],
      correct: 0,
      explanation: 'The exponent is $(\\epsilon - \\mu)/k_B T = 0.10/0.050 = 2$, so $F_{\\mathrm{FD}} = 1/(e^{2} + 1) \\approx 0.12$. Choice (B) is the Boltzmann factor, which leaves out the $+1$. Choice (C) is the Bose–Einstein value. Choice (D) inverts the ratio in the exponent. Choice (E) holds only at $\\epsilon = \\mu$.'
    }
  };


  /* ====================================================================== */
  /* cpgf-3.32 — Doppler effect in a medium                                 */
  /* ====================================================================== */

  var DOPPLER_FADE = 0.3;

  function motionWord(vn) {
    if (Math.abs(vn) < 1e-9) return 'at rest';
    return vn > 0 ? 'approaching' : 'receding';
  }

  PGRE.visualizers['cpgf-3.32'] = {
    id: 'cpgf-3.32',
    topic: 'ow',
    title: 'Doppler Effect in a Medium: $f = f_0\\,(v + v_r)/(v - v_s)$',
    formulaLatex: 'f = \\left(\\frac{v + v_r}{v - v_s}\\right) f_0',
    physicalStory: `
A source emits one crest in every period $1/f_0$, and each crest spreads through the medium as a circle at the wave speed $v$. The center of each circle is the place where the source was when it emitted that crest. The medium, not the source, sets the speed of every crest.

A moving source changes the wavelength. It follows the crests that it sends forward, so they are closer together ahead of it, $\\lambda = (v - v_s)/f_0$, and farther apart behind it. This is why $v_s$ is in the denominator.

A moving receiver does not change the wavelength. It changes how fast the crests go past: a receiver that moves toward the source meets the crests at the relative speed $v + v_r$. This is why $v_r$ is in the numerator. The received frequency is that relative speed divided by the wavelength, $f = (v + v_r)/\\lambda$. Both $v_s$ and $v_r$ are positive when the motion reduces the distance between source and receiver.

The two motions are not equivalent. Compare a source that approaches at half the wave speed ($f = 2f_0$) with a receiver that approaches at half the wave speed ($f = 1.5f_0$).
    `.trim(),
    derivationSteps: [
      {
        step: 1,
        title: 'Wavelength in front of a moving source',
        latex: '\\lambda = \\frac{v - v_s}{f_0}',
        description: 'In one period $1/f_0$ a crest travels $v/f_0$ and the source follows it by $v_s/f_0$. The next crest starts that much closer.'
      },
      {
        step: 2,
        title: 'Rate at which a moving receiver meets crests',
        latex: 'f = \\frac{v + v_r}{\\lambda}',
        description: 'Relative to a receiver that moves toward the source at $v_r$, the crests approach at $v + v_r$ and are $\\lambda$ apart.'
      },
      {
        step: 3,
        title: 'Combine',
        latex: 'f = \\left(\\frac{v + v_r}{v - v_s}\\right) f_0',
        description: 'Each speed is positive for approach and negative for recession.'
      },
      {
        step: 4,
        title: 'Small speeds',
        latex: 'f \\approx f_0\\left(1 + \\frac{v_s + v_r}{v}\\right) \\qquad (v_s,\\ v_r \\ll v)',
        description: 'To first order only the closing speed $v_s + v_r$ matters, and the two kinds of motion give the same shift.'
      }
    ],
    limitingCases: [
      {
        name: 'Source and receiver move together',
        condition: 'v_r = -v_s',
        formula: 'f = f_0',
        description: 'Both have the same velocity through the medium. The distance between them does not change and there is no shift.'
      },
      {
        name: 'Source at the wave speed',
        condition: 'v_s \\to v',
        formula: 'f \\to \\infty',
        description: 'The crests ahead of the source arrive together. For $v_s \\gt v$ the formula does not apply: the crests form a cone of half-angle $\\theta$ with $\\sin\\theta = v/v_s$.'
      },
      {
        name: 'Receiver recedes at the wave speed',
        condition: 'v_r = -v',
        formula: 'f = 0',
        description: 'No crest reaches the receiver.'
      },
      {
        name: 'Reflection from a slowly approaching wall',
        condition: 'wall speed $u \\ll v$',
        formula: 'f \\approx f_0\\left(1 + \\frac{2u}{v}\\right)',
        description: 'The wall acts first as a moving receiver and then as a moving source, so the shift is applied twice.'
      },
      {
        name: 'Light in vacuum',
        condition: 'no medium',
        formula: 'f = f_0\\sqrt{\\frac{1 + \\beta}{1 - \\beta}}',
        description: 'For light only the relative velocity $\\beta c$ of approach is defined, and the result is the same whichever one is said to move.'
      }
    ],
    greTraps: [
      {
        trap: 'Which speed goes where',
        warning: 'Four sign combinations are possible. Source and receiver are not interchangeable: the source speed belongs in the denominator and the receiver speed in the numerator.',
        strategy: 'Check with one fact: approach raises the frequency. A larger numerator and a smaller denominator both do that, so approach means $+v_r$ above and $-v_s$ below.'
      },
      {
        trap: 'Speeds are relative to the medium',
        warning: 'With wind, $v_s$ and $v_r$ must be measured relative to the air and not relative to the ground.',
        strategy: 'Subtract the wind velocity from every velocity first. Then apply the formula.'
      },
      {
        trap: 'Wavelength versus frequency',
        warning: 'Motion of the receiver changes the received frequency and does not change the wavelength in the medium. Motion of the source changes both.',
        strategy: 'If the question asks for the wavelength, use $\\lambda = (v - v_s)/f_0$ and leave out $v_r$.'
      },
      {
        trap: 'Using the formula for light on sound',
        warning: 'The relativistic formula $\\sqrt{(1 + \\beta)/(1 - \\beta)}$ is for light. Sound, water waves and waves on a string need the formula with a medium.',
        strategy: 'If the wave has a medium, use $v$, $v_s$ and $v_r$ measured in that medium.'
      }
    ],
    parameters: [
      { id: 'vs', label: 'Source speed $v_s/v$', min: -0.8, max: 0.8, step: 0.05, default: 0.5, unit: '', hint: 'Speed of the source through the medium as a fraction of the wave speed. Positive is toward the receiver. It changes the spacing of the crests: $\\lambda = (v - v_s)/f_0$ on the side of the receiver.' },
      { id: 'vr', label: 'Receiver speed $v_r/v$', min: -0.8, max: 0.8, step: 0.05, default: 0, unit: '', hint: 'Speed of the receiver through the medium as a fraction of the wave speed. Positive is toward the source. It leaves the crests where they are and changes how fast the receiver crosses them: $v + v_r$.' },
      { id: 'f0', label: 'Emitted frequency $f_0$', min: 1.0, max: 3.0, step: 0.25, default: 1.5, unit: 'Hz', hint: 'Number of crests the source emits each second. The ratio $f/f_0$ does not depend on it.' },
      { id: 'simSpeed', label: 'Simulation Speed', min: 0.2, max: 3.0, step: 0.2, default: 1.0, unit: 'x' }
    ],

    // The picture fades in over the first DOPPLER_FADE seconds of each cycle. A fresh
    // start skips that part, so a paused stage is never blank after Reset or a slider move.
    init: function (container, state) {
      state._t = DOPPLER_FADE;
    },

    onParamChange: function (id, val, state) {
      if (state && (id === 'vs' || id === 'vr' || id === 'f0')) state._t = DOPPLER_FADE;
    },

    draw: function (ctx, width, height, state, dt) {
      state = state || {};
      var size = canvasSize(width, height);
      width = size.w;
      height = size.h;
      fillStage(ctx, width, height);

      var vsN = clampNum(numParam(state, 'vs', 0.5), -0.9, 0.9);
      var vrN = clampNum(numParam(state, 'vr', 0), -0.9, 0.9);
      var f0 = clampNum(numParam(state, 'f0', 1.5), 0.5, 4);
      var T0 = 1 / f0;
      dt = safeDt(dt);
      state._t = (state._t || 0) + dt * speedParam(state);

      var pad = 12;
      var chartH = clampNum(Math.round(height * 0.26), 74, 108);
      var scene = { x: pad, y: pad, w: width - 2 * pad, h: height - chartH - 3 * pad };
      var chart = { x: pad, y: scene.y + scene.h + pad, w: width - 2 * pad, h: chartH };

      // Pixel kinematics: the wave crosses the scene in 7.5 s at 1x.
      var vpx = scene.w / 7.5;
      var us = vsN * vpx;       // source velocity, +x points at the receiver
      var ur = -vrN * vpx;      // receiver velocity, -x points at the source
      var closing = us - ur;
      var L = 6;
      if (Math.abs(us) > 1e-6) L = Math.min(L, 0.5 * scene.w / Math.abs(us));
      if (Math.abs(ur) > 1e-6) L = Math.min(L, 0.46 * scene.w / Math.abs(ur));
      // keep the receiver on the +x side of the source for the whole cycle,
      // whether the two approach (gap shrinks) or recede (gap is smallest at the start)
      if (Math.abs(closing) > 1e-6) L = Math.min(L, 0.62 * scene.w / Math.abs(closing));
      L = Math.max(T0, Math.floor(L / T0 + 1e-9) * T0);
      var t = state._t % L;
      var xs0 = scene.x + 0.3 * scene.w - us * L / 2;
      var xr0 = scene.x + 0.72 * scene.w - ur * L / 2;
      var ys = scene.y + scene.h / 2;
      var xs = xs0 + us * t;
      var xr = xr0 + ur * t;
      var fade = Math.min(1, t / DOPPLER_FADE, (L - t) / DOPPLER_FADE);
      if (!(fade > 0)) fade = 0;

      var ratio = (1 + vrN) / (1 - vsN);
      var lamAhead = (vpx - us) * T0;      // crest spacing between source and receiver
      var lamBehind = (vpx + us) * T0;     // crest spacing on the far side of the source
      var spots = [];
      var i;

      ctx.save();
      clipRect(ctx, scene);
      ctx.globalAlpha = fade;

      segment(ctx, scene.x, ys, scene.x + scene.w, ys, inkFade(0.12), 1, [2, 5]);

      // crests: circles centered where the source was at each emission
      // old enough that the crests ahead of an approaching source reach the stage edge
      var maxAge = 1.15 * scene.w / (vpx - Math.abs(us));
      var iNew = Math.floor(t / T0 + 1e-9);
      ctx.save();
      ctx.lineWidth = 1.6;
      for (i = iNew; t - i * T0 <= maxAge; i--) {
        var age = t - i * T0;
        var rad = vpx * age;
        if (rad < 1) continue;
        ctx.strokeStyle = tint(CORAL, 0.14 + 0.5 * (1 - age / maxAge));
        ctx.beginPath();
        ctx.arc(xs0 + us * i * T0, ys, rad, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      // wavelength brackets on the axis
      var edge0 = xs0 + us * iNew * T0 + vpx * (t - iNew * T0);
      var kA = Math.max(0, Math.round(((xs + xr) / 2 - edge0) / lamAhead - 0.5));
      var a0 = edge0 + kA * lamAhead;
      var a1 = a0 + lamAhead;
      var back0 = xs0 + us * iNew * T0 - vpx * (t - iNew * T0);
      var kB = back0 - lamBehind * 2 > scene.x + 8 ? 1 : 0;
      var b1 = back0 - kB * lamBehind;
      var b0 = b1 - lamBehind;
      var by = ys - 24;
      function bracket(x0, x1, id, title, body) {
        if (x0 < scene.x + 2 || x1 > scene.x + scene.w - 2) return;
        var col = deepCoral();
        segment(ctx, x0, by, x1, by, col, 1.6);
        segment(ctx, x0, by - 5, x0, by + 5, col, 1.6);
        segment(ctx, x1, by - 5, x1, by + 5, col, 1.6);
        symLabel(ctx, '\u03bb', (x0 + x1) / 2, by - 12, { size: 14, color: col });
        spots.push({ id: id, kind: 'segment', x1: x0, y1: by, x2: x1, y2: by, halfW: 9, title: title, body: body });
      }
      if (a1 < xr - 6) {
        bracket(a0, a1, 'lamAhead', 'Wavelength between source and receiver',
          '$\\lambda = (v - v_s)/f_0 = ' + (1 - vsN).toFixed(2) + '\\,\\lambda_0$, where $\\lambda_0 = v/f_0$ is the spacing for a source at rest. Only the source speed changes it.');
      }
      bracket(b0, b1, 'lamBehind', 'Wavelength on the far side of the source',
        'Behind the source the spacing is $(v + v_s)/f_0 = ' + (1 + vsN).toFixed(2) + '\\,\\lambda_0$. A receiver on that side would use $v_s \\to -v_s$.');

      // source and receiver
      if (Math.abs(vsN) > 0.01) {
        arrowLine(ctx, xs, ys + 16, xs + (vsN > 0 ? 1 : -1) * (14 + 50 * Math.abs(vsN)), ys + 16, deepCoral(), 2);
      }
      if (Math.abs(vrN) > 0.01) {
        arrowLine(ctx, xr, ys + 16, xr - (vrN > 0 ? 1 : -1) * (14 + 50 * Math.abs(vrN)), ys + 16, TEAL, 2);
      }
      // arrival times at the receiver: crest i reaches it at tA(i)
      var gap0 = xr0 - xs0;
      var iArr = Math.floor((t * (vpx - ur) - gap0) / ((vpx - us) * T0) + 1e-9);
      var tArr = (gap0 + (vpx - us) * iArr * T0) / (vpx - ur);
      var since = t - tArr;
      if (since >= 0 && since < 0.22) {
        dot(ctx, xr, ys, 9 + 70 * since, null, tint(TEAL, 0.9 * (1 - since / 0.22)), 2.2);
      }
      dot(ctx, xs, ys, 7.5, CORAL, deepCoral(), 1.6);
      dot(ctx, xr, ys, 7.5, TEAL, CREAM, 1.6);
      haloLabel(ctx, 'source', xs, ys + 32, { color: deepCoral() });
      haloLabel(ctx, 'receiver', xr, ys + 32, { color: TEAL });
      ctx.restore();

      // pulse trains: emission times and arrival times over the last few seconds
      var Wt = 4;
      var labelW = 66;
      var cx0 = chart.x + labelW;
      var cw = Math.max(40, chart.w - labelW - 8);
      function CX(time) { return cx0 + ((time - (t - Wt)) / Wt) * cw; }
      var yE = chart.y + chart.h * 0.3;
      var yR = chart.y + chart.h * 0.74;
      segment(ctx, cx0, yE, cx0 + cw, yE, LINE, 1.2);
      segment(ctx, cx0, yR, cx0 + cw, yR, LINE, 1.2);
      segment(ctx, cx0 + cw, chart.y + 2, cx0 + cw, chart.y + chart.h - 2, inkFade(0.35), 1.2);
      haloLabel(ctx, 'emitted', chart.x + 2, yE, { color: deepCoral(), align: 'left' });
      haloLabel(ctx, 'received', chart.x + 2, yR, { color: TEAL, align: 'left' });
      haloLabel(ctx, 'now', cx0 + cw - 4, chart.y + 7, { color: MUTED, align: 'right', font: SANS });
      ctx.save();
      clipRect(ctx, { x: cx0, y: chart.y, w: cw, h: chart.h });
      // the marks fade with the scene when the picture restarts, where the received row shifts
      ctx.globalAlpha = fade;
      ctx.lineCap = 'round';
      var nEm = 0;
      var nRx = 0;
      for (i = Math.ceil((t - Wt) / T0); i * T0 <= t + 1e-9; i++) {
        segment(ctx, CX(i * T0), yE - 9, CX(i * T0), yE + 9, CORAL, 2.6);
        nEm++;
      }
      var perRx = T0 * (vpx - us) / (vpx - ur);
      for (i = iArr; ; i--) {
        var ta = (gap0 + (vpx - us) * i * T0) / (vpx - ur);
        if (ta < t - Wt) break;
        segment(ctx, CX(ta), yR - 9, CX(ta), yR + 9, TEAL, 2.6);
        nRx++;
        if (nRx > 400) break;
      }
      ctx.restore();

      spots.push({
        id: 'source', kind: 'circle', x: xs, y: ys, r: 12,
        title: 'Source',
        body: 'Emits a crest every $1/f_0 = ' + T0.toFixed(2) + '\\,\\mathrm{s}$ while moving at $v_s = ' + vsN.toFixed(2) + '\\,v$ (' + motionWord(vsN) + '). Each circle keeps the center where it was emitted.'
      });
      spots.push({
        id: 'receiver', kind: 'circle', x: xr, y: ys, r: 12,
        title: 'Receiver',
        body: 'Moves at $v_r = ' + vrN.toFixed(2) + '\\,v$ (' + motionWord(vrN) + '). Crests pass it at the relative speed $v + v_r = ' + (1 + vrN).toFixed(2) + '\\,v$. The ring flashes each time a crest arrives.'
      });
      spots.push({
        id: 'emitted', kind: 'rect', x: cx0, y: yE - 12, w: cw, h: 24,
        title: 'Emitted crests',
        body: 'One mark for each crest that left the source in the last $' + Wt + '\\,\\mathrm{s}$: spacing $1/f_0 = ' + T0.toFixed(2) + '\\,\\mathrm{s}$, $' + nEm + '$ marks.'
      });
      spots.push({
        id: 'received', kind: 'rect', x: cx0, y: yR - 12, w: cw, h: 24,
        title: 'Received crests',
        body: 'One mark for each crest that reached the receiver in the last $' + Wt + '\\,\\mathrm{s}$: spacing $1/f = ' + perRx.toFixed(2) + '\\,\\mathrm{s}$, $' + nRx + '$ marks. Compare the count with the row above.'
      });
      spots.push({
        id: 'scene', kind: 'rect', x: scene.x, y: scene.y, w: scene.w, h: scene.h,
        title: 'Crests in the medium',
        body: 'The medium is at rest in this picture and every crest expands at the same speed $v$. The picture starts again before the source and the receiver meet or leave the stage.'
      });
      PGRE.setVizHotspots(spots);

      var swapped = (1 + vsN) / (1 - vrN);
      vizLegend('Doppler shift', [
        { label: '$v_s/v$', value: '$' + vsN.toFixed(2) + '$ (' + motionWord(vsN) + ')', hint: 'Source speed as a fraction of the wave speed. Positive when the source moves toward the receiver.' },
        { label: '$v_r/v$', value: '$' + vrN.toFixed(2) + '$ (' + motionWord(vrN) + ')', hint: 'Receiver speed as a fraction of the wave speed. Positive when the receiver moves toward the source.' },
        { label: '$f/f_0$', value: '$' + (1 + vrN).toFixed(2) + '/' + (1 - vsN).toFixed(2) + ' = ' + ratio.toFixed(3) + '$', hint: 'The formula of this card with every speed divided by $v$: $f/f_0 = (1 + v_r/v)/(1 - v_s/v)$. Above $1$ the pitch rises; below $1$ it falls.' },
        { label: '$f$', value: '$' + (ratio * f0).toFixed(2) + '\\,\\mathrm{Hz}$', hint: 'Received frequency for the emitted frequency $f_0 = ' + f0.toFixed(2) + '\\,\\mathrm{Hz}$. It is the rate of the teal marks.' },
        { label: '$\\lambda/\\lambda_0$ toward the receiver', value: '$' + (1 - vsN).toFixed(2) + '$', hint: 'Crest spacing between source and receiver, relative to a source at rest: $(v - v_s)/v$. It contains the source speed only.' },
        { label: 'Crest speed past the receiver', value: '$' + (1 + vrN).toFixed(2) + '\\,v$', hint: 'Relative speed $v + v_r$ between the crests and the receiver. It contains the receiver speed only.' },
        { label: 'Speeds exchanged', value: '$f/f_0 = ' + swapped.toFixed(3) + '$', hint: 'The ratio if the source had the speed of the receiver and the receiver had the speed of the source. It differs from the line above unless $|v_s| = |v_r|$: the two motions are not equivalent.' }
      ]);
    },

    challenge: {
      question: 'A siren emits sound at $f_0 = 600\\,\\mathrm{Hz}$. The speed of sound is $340\\,\\mathrm{m/s}$. The siren moves at $40\\,\\mathrm{m/s}$ toward an observer, and the observer moves at $20\\,\\mathrm{m/s}$ toward the siren. What frequency does the observer hear?',
      options: [
        '$500\\,\\mathrm{Hz}$',
        '$680\\,\\mathrm{Hz}$',
        '$713\\,\\mathrm{Hz}$',
        '$720\\,\\mathrm{Hz}$',
        '$760\\,\\mathrm{Hz}$'
      ],
      correct: 3,
      explanation: 'Both motions reduce the distance, so both speeds are positive: $f = f_0\\,\\dfrac{v + v_r}{v - v_s} = 600 \\times \\dfrac{340 + 20}{340 - 40} = 600 \\times \\dfrac{360}{300} = 720\\,\\mathrm{Hz}$. Choice (C) exchanges the two speeds, $600 \\times 380/320$. Choice (B) leaves out the motion of the observer. Choice (A) inverts the ratio.'
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
