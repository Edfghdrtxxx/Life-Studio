/* Inline 3D diagrams drawn on a recall-card back in place of that card's
   .recall-list. Registry is keyed by card id. Not a visualizer: no Lab
   entry, no js/visualizers/ file. Drag rotates about the view centre;
   shift-drag, right-drag, two-finger drag, or Move pans. Wheel / pinch
   zoom toward the pointer. Reset restores the default view. */
window.PGRE = window.PGRE || {};
PGRE.cardDiagrams = PGRE.cardDiagrams || {};

PGRE.replaceRecallListWithDiagram = function (html, cardId) {
  if (!cardId || !PGRE.cardDiagrams[cardId]) return html;
  return String(html).replace(
    /<ul class="recall-list">[\s\S]*?<\/ul>/,
    '<div class="card-diagram-host" data-card-diagram="' +
      String(cardId).replace(/"/g, '') + '"></div>'
  );
};

PGRE.mountCardDiagrams = function (root) {
  if (!root) return;
  var hosts = [];
  if (root.getAttribute && root.getAttribute('data-card-diagram')) hosts.push(root);
  if (root.querySelectorAll) {
    var found = root.querySelectorAll('[data-card-diagram]');
    for (var i = 0; i < found.length; i++) hosts.push(found[i]);
  }
  for (var j = 0; j < hosts.length; j++) {
    var host = hosts[j];
    if (host.getAttribute('data-mounted') === '1') continue;
    var id = host.getAttribute('data-card-diagram');
    var fn = PGRE.cardDiagrams[id];
    if (typeof fn !== 'function') continue;
    host.setAttribute('data-mounted', '1');
    fn(host);
  }
};

(function wrapTypesetMath() {
  function wrap() {
    var prev = PGRE.typesetMath;
    if (typeof prev !== 'function' || prev._pgreCardDiagrams) return;
    var wrapped = function (el) {
      prev.call(PGRE, el);
      PGRE.mountCardDiagrams(el);
    };
    wrapped._pgreCardDiagrams = true;
    PGRE.typesetMath = wrapped;
  }
  wrap();
  document.addEventListener('DOMContentLoaded', wrap);
})();

/* ——— Vector helpers (3-vectors as [x,y,z]) ——— */
function vadd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function vsub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function vscale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function vdot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function vcross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function vlen(a) { return Math.sqrt(vdot(a, a)); }
function vnorm(a) {
  var n = vlen(a);
  return n < 1e-12 ? [0, 0, 0] : vscale(a, 1 / n);
}

/* Nonrelativistic radiation field of an accelerating point charge (v << c).
   a along +z; r-hat in the xz plane at polar angle theta from a.
   E_rad at the field point is -a_perp for q > 0. */
function radiationFieldVectors() {
  var theta = 50 * Math.PI / 180;
  var aLen = 1.38;
  var R = 2.85;
  var a = [0, 0, aLen];
  var rHat = [Math.sin(theta), 0, Math.cos(theta)];
  var aPar = vscale(rHat, vdot(a, rHat));
  var aPerp = vsub(a, aPar);
  var field = vscale(rHat, R);
  var eDir = vnorm(vscale(aPerp, -1));
  var eRad = vscale(eDir, 1.45);
  return {
    theta: theta,
    origin: [0, 0, 0],
    a: a,
    rHat: rHat,
    aPar: aPar,
    aPerp: aPerp,
    field: field,
    eRad: eRad,
    R: R
  };
}
PGRE.radiationFieldDiagramVectors = radiationFieldVectors;

var CD_YAW0 = 1.08;
var CD_PITCH0 = 0.42;
var CD_ZOOM_MIN = 0.6;
var CD_ZOOM_MAX = 3;
var CD_ZOOM_0 = 1;
var CD_OPT_Y = 0.56;
var CD_DOUGHNUT_DASH = [2.8, 5.4];
PGRE.cardDiagramStroke = {
  doughnutDash: CD_DOUGHNUT_DASH.slice(),
  vectorDash: []
};
PGRE.clampCardDiagramZoom = function (z) {
  z = Number(z);
  if (!isFinite(z) || z < CD_ZOOM_MIN) return CD_ZOOM_MIN;
  if (z > CD_ZOOM_MAX) return CD_ZOOM_MAX;
  return z;
};

function cssVar(el, name, fallback) {
  var raw = '';
  try { raw = getComputedStyle(el).getPropertyValue(name); } catch (e) { raw = ''; }
  raw = String(raw || '').trim();
  return raw || fallback;
}

function renderTex(el, tex, display) {
  if (!el) return;
  if (window.katex) {
    try {
      window.katex.render(tex, el, { throwOnError: false, displayMode: !!display });
      return;
    } catch (e) { /* fall through */ }
  }
  el.textContent = tex;
}

PGRE.cardDiagrams['supp-radiation-field'] = function (host) {
  var vec = radiationFieldVectors();
  var yaw = CD_YAW0;
  var pitch = CD_PITCH0;
  var zoom = CD_ZOOM_0;
  var viewCenter = [0, 0, 0];
  var panMode = false;
  var dragging = false;
  var gesture = 'rotate';
  var lastX = 0;
  var lastY = 0;
  var pointerId = null;
  var pointers = {};
  var pinching = false;
  var pinchWorld = null;
  var pinchStartDist = 0;
  var pinchStartZoom = CD_ZOOM_0;
  var lastNarrow = null;
  var lastShortVec = null;
  var lastTapAt = 0;
  var lastTapX = 0;
  var lastTapY = 0;
  var eradLong = '\\mathbf{E}_{\\mathrm{rad}}\\ (q>0:\\ \\text{opp. }\\mathbf{a}_\\perp)';
  var eradShort = '\\mathbf{E}_{\\mathrm{rad}}';
  var patternLong = '\\text{power pattern }dP/d\\Omega\\sim\\sin^{2}\\theta\\text{ (not field lines)}';
  var patternShort = 'dP/d\\Omega\\sim\\sin^{2}\\theta\\text{ (not field lines)}';
  var hintLong = 'Drag rotate. Shift/right-drag or Move pans. Scroll zooms at pointer.';
  var hintShort = 'Drag rotate. Move pans. Scroll zooms here.';
  var centreLong = 'Centre on field point';
  var centreShort = 'Centre';

  host.setAttribute('role', 'img');
  host.setAttribute('aria-label',
    'Nonrelativistic radiation field of a positive accelerating point charge. ' +
    'The radiation electric field at the field point points opposite the component ' +
    'of acceleration perpendicular to the line of sight. It lies in the plane of ' +
    'the line of sight and the acceleration, and is perpendicular to the line of ' +
    'sight. Its magnitude is proportional to sine of theta and the power per solid ' +
    'angle is proportional to sine squared theta: both are zero on the acceleration ' +
    'axis and largest at ninety degrees. The dashed rings are the angular power ' +
    'pattern, not electric field lines. Drag to rotate about the view centre. ' +
    'Shift-drag, right-drag, two-finger drag, or Move pans. Scroll or pinch zooms ' +
    'toward the pointer. Centre on field point or double-click the field point to ' +
    'inspect it. Reset returns centre, zoom, and rotation to the default view.');
  host.innerHTML =
    '<canvas></canvas>' +
    '<div class="card-diagram-labels" aria-hidden="true">' +
      '<span class="cd-lab" data-lab="q"></span>' +
      '<span class="cd-lab" data-lab="a"></span>' +
      '<span class="cd-lab" data-lab="apar"></span>' +
      '<span class="cd-lab" data-lab="aperp"></span>' +
      '<span class="cd-lab" data-lab="rhat"></span>' +
      '<span class="cd-lab" data-lab="erad"></span>' +
      '<span class="cd-lab" data-lab="theta"></span>' +
      '<span class="cd-lab cd-lab-muted cd-lab-pattern" data-lab="pattern"></span>' +
      '<span class="cd-lab cd-lab-sm cd-lab-plane" data-lab="plane"></span>' +
      '<span class="cd-lab cd-lab-muted cd-lab-corner" data-lab="ang"></span>' +
    '</div>' +
    '<p class="card-diagram-hint">Drag rotate. Shift/right-drag or Move pans. Scroll zooms at pointer.</p>' +
    '<div class="card-diagram-zoom" role="group" aria-label="View">' +
      '<button type="button" class="cd-zoom-btn" data-cd-zoom="in" aria-label="Zoom in">+</button>' +
      '<button type="button" class="cd-zoom-btn" data-cd-zoom="out" aria-label="Zoom out">\u2212</button>' +
      '<button type="button" class="cd-zoom-btn cd-zoom-reset" data-cd-zoom="reset" aria-label="Reset view">Reset</button>' +
      '<button type="button" class="cd-zoom-btn" data-cd-pan aria-pressed="false" aria-label="Move view">Move</button>' +
      '<button type="button" class="cd-zoom-btn cd-zoom-centre" data-cd-centre aria-label="Centre on field point">Centre on field point</button>' +
    '</div>';

  var canvas = host.querySelector('canvas');
  var labels = {};
  host.querySelectorAll('.cd-lab').forEach(function (el) {
    labels[el.getAttribute('data-lab')] = el;
  });
  var hintEl = host.querySelector('.card-diagram-hint');
  var panBtn = host.querySelector('[data-cd-pan]');
  var centreBtn = host.querySelector('[data-cd-centre]');
  renderTex(labels.q, 'q');
  renderTex(labels.a, '\\mathbf{a}');
  renderTex(labels.apar, '\\mathbf{a}_\\parallel');
  renderTex(labels.aperp, '\\mathbf{a}_\\perp');
  renderTex(labels.rhat, '\\hat{\\mathbf{r}}');
  renderTex(labels.erad, eradLong);
  renderTex(labels.theta, '\\theta');
  renderTex(labels.pattern, patternLong);
  renderTex(labels.plane, '\\text{plane of }\\hat{\\mathbf{r}},\\,\\mathbf{a}');
  renderTex(labels.ang,
    '\\begin{array}{c}|\\mathbf{E}_{\\mathrm{rad}}|\\propto\\sin\\theta\\\\' +
    'dP/d\\Omega\\propto\\sin^{2}\\theta\\\\' +
    '\\text{null at }0^{\\circ},180^{\\circ}\\text{; max at }90^{\\circ}\\end{array}');

  var ctx = canvas.getContext('2d');
  var W = 480, H = 384;

  function measure() {
    var w = host.clientWidth;
    var h = host.clientHeight;
    if (w < 40) {
      var node = host.parentElement;
      while (node && node.clientWidth < 40) node = node.parentElement;
      w = node ? Math.max(220, node.clientWidth - 8) : 480;
      h = Math.round(w * 0.8);
    }
    if (h < 40) h = Math.round(w * 0.8);
    return { w: w, h: h };
  }

  function scaleOf() {
    return Math.min(W, H) / (W < 420 ? 6.0 : 7.3) * zoom;
  }

  function camToWorldDelta(cam) {
    var x1 = cam[0], y2 = cam[1], z2 = cam[2];
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var y1 = y2 * cp + z2 * sp;
    var z1 = -y2 * sp + z2 * cp;
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    return [x1 * cy + y1 * sy, -x1 * sy + y1 * cy, z1];
  }

  function worldToCam(p) {
    var q = vsub(p, viewCenter);
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var x1 = q[0] * cy - q[1] * sy;
    var y1 = q[0] * sy + q[1] * cy;
    var z1 = q[2];
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    return [x1, y1 * cp - z1 * sp, y1 * sp + z1 * cp];
  }

  function camToWorld(cam) {
    return vadd(viewCenter, camToWorldDelta(cam));
  }

  function project(p) {
    var cam = worldToCam(p);
    var sc = scaleOf();
    var persp = 7.4 / (7.4 + cam[1]);
    return {
      x: W / 2 + cam[0] * sc * persp,
      y: H * CD_OPT_Y - cam[2] * sc * persp,
      z: cam[1],
      k: persp
    };
  }

  function unprojectViewPlane(sx, sy) {
    var sc = scaleOf();
    if (sc < 1e-9) return viewCenter.slice();
    return camToWorld([(sx - W / 2) / sc, 0, (H * CD_OPT_Y - sy) / sc]);
  }

  function token() {
    return {
      ink: cssVar(host, '--ink', '#141413'),
      ink2: cssVar(host, '--ink-2', '#6c6a64'),
      ink3: cssVar(host, '--ink-3', '#8e8b82'),
      accent: cssVar(host, '--accent', '#cc785c'),
      accentDeep: cssVar(host, '--accent-deep', '#964b32'),
      line: cssVar(host, '--line', '#e6dfd8'),
      good: cssVar(host, '--good', '#3b6d11')
    };
  }

  function place(el, p, dx, dy) {
    if (!el) return;
    var s = project(p);
    var pad = 10;
    if (s.k <= 0.15 || s.x < -pad || s.x > W + pad || s.y < -pad || s.y > H + pad) {
      el.style.visibility = 'hidden';
      return;
    }
    el.style.visibility = 'visible';
    el.style.left = (s.x + (dx || 0)) + 'px';
    el.style.top = (s.y + (dy || 0)) + 'px';
  }

  function boxesOverlap(a, b) {
    return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
  }

  function resolveLabels() {
    /* Teaching quantities first so the power caption yields space rather
       than suppressing acceleration / angle names. Collision tries another
       screen position; a label is hidden only when no on-panel seat remains. */
    var order = ['erad', 'a', 'aperp', 'theta', 'rhat', 'q', 'apar', 'pattern'];
    var hostR = host.getBoundingClientRect();
    var inset = 2;
    function boxOf(el) {
      if (!el || el.style.visibility === 'hidden' || !el.getClientRects().length) return null;
      var r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }
    var chrome = [];
    (function collectChrome() {
      var els = [hintEl, host.querySelector('.card-diagram-zoom'), labels.plane, labels.ang];
      var k, b;
      for (k = 0; k < els.length; k++) {
        b = boxOf(els[k]);
        if (b) chrome.push(b);
      }
    })();
    function overlapsList(a, list) {
      var k;
      for (k = 0; k < list.length; k++) {
        if (boxesOverlap(a, list[k])) return true;
      }
      return false;
    }
    function seatOk(a, placed) {
      if (!a) return false;
      if (a.left < hostR.left + inset || a.right > hostR.right - inset ||
          a.top < hostR.top + inset || a.bottom > hostR.bottom - inset) return false;
      if (overlapsList(a, chrome)) return false;
      if (overlapsList(a, placed)) return false;
      return true;
    }
    var radii = [0, 10, 18, 26, 36, 48, 62, 78];
    var nAng = 12;
    var i, el, a, left0, top0, ok, ri, ai, rad, ang, dx, dy, placed = [];
    for (i = 0; i < order.length; i++) {
      el = labels[order[i]];
      a = boxOf(el);
      if (!a) continue;
      left0 = parseFloat(el.style.left) || 0;
      top0 = parseFloat(el.style.top) || 0;
      ok = false;
      for (ri = 0; ri < radii.length && !ok; ri++) {
        rad = radii[ri];
        var turns = rad === 0 ? 1 : nAng;
        for (ai = 0; ai < turns; ai++) {
          ang = (2 * Math.PI * ai) / turns;
          dx = Math.round(rad * Math.cos(ang));
          dy = Math.round(rad * Math.sin(ang));
          el.style.left = (left0 + dx) + 'px';
          el.style.top = (top0 + dy) + 'px';
          a = boxOf(el);
          if (seatOk(a, placed)) {
            ok = true;
            placed.push(a);
            break;
          }
        }
      }
      if (!ok) {
        el.style.left = left0 + 'px';
        el.style.top = top0 + 'px';
        el.style.visibility = 'hidden';
      }
    }
  }

  function drawArrow(from, to, color, width, dashed) {
    var a = project(from), b = project(to);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (dashed) ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = Math.hypot(dx, dy) || 1;
    var ux = dx / len, uy = dy / len;
    var ah = Math.max(7, 9 * b.k);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - ux * ah + uy * ah * 0.42, b.y - uy * ah - ux * ah * 0.42);
    ctx.lineTo(b.x - ux * ah - uy * ah * 0.42, b.y - uy * ah + ux * ah * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawPolyline(pts, color, width, alpha, dashed) {
    if (pts.length < 2) return;
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (dashed) ctx.setLineDash(CD_DOUGHNUT_DASH);
    ctx.beginPath();
    var p0 = project(pts[0]);
    ctx.moveTo(p0.x, p0.y);
    for (var i = 1; i < pts.length; i++) {
      var p = project(pts[i]);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function doughnutCurves() {
    var R0 = 0.88;
    var curves = [];
    var nPhi = 6, nTh = 32;
    var i, j, phi, th, r, pts;
    for (i = 0; i < nPhi; i++) {
      phi = i * Math.PI / nPhi;
      pts = [];
      for (j = 0; j <= nTh; j++) {
        th = j * Math.PI / nTh;
        r = R0 * Math.sin(th) * Math.sin(th);
        pts.push([
          r * Math.sin(th) * Math.cos(phi),
          r * Math.sin(th) * Math.sin(phi),
          r * Math.cos(th)
        ]);
      }
      curves.push(pts);
    }
    var lats = [Math.PI / 2, Math.PI / 3];
    for (i = 0; i < lats.length; i++) {
      th = lats[i];
      r = R0 * Math.sin(th) * Math.sin(th);
      pts = [];
      var n = 48;
      for (j = 0; j <= n; j++) {
        phi = j * 2 * Math.PI / n;
        pts.push([
          r * Math.sin(th) * Math.cos(phi),
          r * Math.sin(th) * Math.sin(phi),
          r * Math.cos(th)
        ]);
      }
      curves.push(pts);
    }
    return curves;
  }
  var doughnut = doughnutCurves();

  function planeQuad() {
    var rHat = vec.rHat, aHat = vnorm(vec.a);
    var p0 = vadd(vscale(rHat, -0.2), vscale(aHat, -0.15));
    var p1 = vadd(vscale(rHat, 1.85), vscale(aHat, -0.15));
    var p2 = vadd(vscale(rHat, 1.85), vscale(aHat, 1.2));
    var p3 = vadd(vscale(rHat, -0.2), vscale(aHat, 1.2));
    return [p0, p1, p2, p3];
  }

  function angleArc() {
    var pts = [];
    var rad = 0.46;
    var n = 18;
    for (var i = 0; i <= n; i++) {
      var t = vec.theta * i / n;
      pts.push([rad * Math.sin(t), 0, rad * Math.cos(t)]);
    }
    return pts;
  }

  function rightAngle() {
    var s = 0.2;
    var eHat = vnorm(vec.eRad);
    var a0 = vec.field;
    var a1 = vadd(a0, vscale(vec.rHat, -s));
    var a2 = vadd(a1, vscale(eHat, s));
    var a3 = vadd(a0, vscale(eHat, s));
    return [a1, a2, a3];
  }

  function draw() {
    var size = measure();
    W = size.w;
    H = size.h;
    var dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    clampPan();
    var narrow = W < 420;
    if (narrow) host.classList.add('is-narrow');
    else host.classList.remove('is-narrow');
    var shortVec = narrow || zoom < 0.85;
    if (narrow !== lastNarrow) {
      lastNarrow = narrow;
      if (hintEl) hintEl.textContent = panMode ? 'Drag to pan.' : (narrow ? hintShort : hintLong);
      if (centreBtn) centreBtn.textContent = narrow ? centreShort : centreLong;
      renderTex(labels.pattern, narrow ? patternShort : patternLong);
    }
    if (shortVec !== lastShortVec) {
      lastShortVec = shortVec;
      renderTex(labels.erad, shortVec ? eradShort : eradLong);
    }
    var c = token();
    host.setAttribute('data-yaw', String(yaw));
    host.setAttribute('data-pitch', String(pitch));
    host.setAttribute('data-zoom', zoom.toFixed(3));
    host.setAttribute('data-cx', viewCenter[0].toFixed(4));
    host.setAttribute('data-cy', viewCenter[1].toFixed(4));
    host.setAttribute('data-cz', viewCenter[2].toFixed(4));
    host.setAttribute('data-pan', panMode ? '1' : '0');
    host.setAttribute('data-ink', c.ink);
    host.classList.toggle('is-move', panMode);

    var i;
    for (i = 0; i < doughnut.length; i++) {
      drawPolyline(doughnut[i], c.ink3, 1.15, 0.55, true);
    }

    var quad = planeQuad();
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    var q0 = project(quad[0]);
    ctx.moveTo(q0.x, q0.y);
    for (i = 1; i < quad.length; i++) {
      var qi = project(quad[i]);
      ctx.lineTo(qi.x, qi.y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    drawPolyline([vec.origin, vec.field], c.ink2, 1.4, 1, false);
    drawArrow(vec.origin, vec.aPar, c.ink2, 1.6, false);
    drawArrow(vec.origin, vec.aPerp, c.good, 2.1, false);
    drawArrow(vec.origin, vec.a, c.ink, 2.4, false);
    var rHatTip = vadd(vec.field, vscale(vec.rHat, 0.72));
    drawArrow(vec.field, rHatTip, c.ink, 2.0, false);
    drawArrow(vec.field, vadd(vec.field, vec.eRad), c.accentDeep, 2.6, false);
    drawPolyline(angleArc(), c.ink, 1.5, 1);
    drawPolyline(rightAngle(), c.accentDeep, 1.6, 1);

    var o = project(vec.origin);
    ctx.save();
    ctx.fillStyle = c.accent;
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(o.x, o.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    var f = project(vec.field);
    ctx.fillStyle = c.ink;
    ctx.beginPath();
    ctx.arc(f.x, f.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    place(labels.q, vec.origin, -22, 18);
    place(labels.a, vscale(vec.a, 0.62), -24, -10);
    place(labels.aperp, vec.aPerp, -32, -6);
    place(labels.apar, vscale(vec.aPar, narrow ? 0.32 : 1), narrow ? 14 : 22, narrow ? 22 : 12);
    place(labels.rhat, rHatTip, 18, -12);
    if (narrow) {
      place(labels.erad, vadd(vec.field, vec.eRad), 22, 28);
    } else {
      place(labels.erad, vadd(vec.field, vec.eRad), zoom < 0.85 ? 28 : 36, zoom < 0.85 ? 18 : 6);
    }
    var thLab = [0.78 * Math.sin(vec.theta * 0.5), 0, 0.78 * Math.cos(vec.theta * 0.5)];
    place(labels.theta, thLab, narrow ? 8 : 10, narrow ? 18 : (zoom < 0.85 ? 16 : -6));
    /* Equatorial +y lobe of the power doughnut, off the xz vector plane. */
    var pat = [0, 0.92, 0];
    place(labels.pattern, pat, 0, narrow ? -20 : -16);

    var oScr = project(vec.origin);
    var fScr = project(vec.field);
    host.setAttribute('data-ox', oScr.x.toFixed(2));
    host.setAttribute('data-oy', oScr.y.toFixed(2));
    host.setAttribute('data-fx', fScr.x.toFixed(2));
    host.setAttribute('data-fy', fScr.y.toFixed(2));
    host.setAttribute('data-ocx', (W / 2).toFixed(2));
    host.setAttribute('data-ocy', (H * CD_OPT_Y).toFixed(2));
    resolveLabels();
  }

  function pointerCount() {
    var n = 0, id;
    for (id in pointers) {
      if (Object.prototype.hasOwnProperty.call(pointers, id)) n++;
    }
    return n;
  }
  function pinchDist() {
    var ids = Object.keys(pointers);
    if (ids.length < 2) return 0;
    var a = pointers[ids[0]], b = pointers[ids[1]];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  function pinchMid() {
    var ids = Object.keys(pointers);
    if (ids.length < 2) return { x: 0, y: 0 };
    var a = pointers[ids[0]], b = pointers[ids[1]];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  function isZoomControl(el) {
    return !!(el && el.closest && el.closest('.card-diagram-zoom'));
  }

  function clientToLocal(cx, cy) {
    var r = canvas.getBoundingClientRect();
    var rw = r.width || 1, rh = r.height || 1;
    return {
      x: (cx - r.left) * (W / rw),
      y: (cy - r.top) * (H / rh)
    };
  }

  function panByScreen(dsx, dsy, skipClamp) {
    var sc = scaleOf();
    if (sc < 1e-9) return;
    viewCenter = vadd(viewCenter, camToWorldDelta([-dsx / sc, 0, dsy / sc]));
    if (!skipClamp) clampPan();
  }

  function keepWorldAt(world, sx, sy, skipClamp) {
    var i, cur, dsx, dsy, cam, sc, persp, k;
    for (i = 0; i < 6; i++) {
      cur = project(world);
      dsx = sx - cur.x;
      dsy = sy - cur.y;
      if (Math.hypot(dsx, dsy) < 0.05) break;
      cam = worldToCam(world);
      sc = scaleOf();
      persp = 7.4 / (7.4 + cam[1]);
      k = sc * persp;
      if (Math.abs(k) < 1e-9) break;
      viewCenter = vadd(viewCenter, camToWorldDelta([-dsx / k, 0, dsy / k]));
    }
    if (!skipClamp) clampPan();
  }

  function keyWorldPoints() {
    return [vec.origin, vec.field];
  }

  function pointOnPanel(s, pad) {
    return s && s.k > 0.25 &&
      s.x >= pad && s.x <= W - pad &&
      s.y >= pad && s.y <= H - pad;
  }

  function clampPan() {
    var pad = 24;
    var pts = keyWorldPoints();
    var i, s, bestI = 0, bestD = Infinity, cx = W / 2, cy = H * CD_OPT_Y;
    var visible = false;
    for (i = 0; i < pts.length; i++) {
      s = project(pts[i]);
      if (pointOnPanel(s, pad)) visible = true;
      var d = Math.hypot(s.x - cx, s.y - cy);
      if (s.k > 0.15 && d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    if (visible) return;
    s = project(pts[bestI]);
    var tx = s.x, ty = s.y;
    if (tx > W - pad) tx = W - pad;
    if (tx < pad) tx = pad;
    if (ty > H - pad) ty = H - pad;
    if (ty < pad) ty = pad;
    keepWorldAt(pts[bestI], tx, ty, true);
    if (pointOnPanel(project(pts[0]), pad) || pointOnPanel(project(pts[1]), pad)) return;
    keepWorldAt(vec.origin, cx, cy, true);
    if (pointOnPanel(project(vec.origin), pad) || pointOnPanel(project(vec.field), pad)) return;
    viewCenter = vec.origin.slice();
  }

  function worldUnderPointer(sx, sy) {
    var hits = [
      { p: vec.field, r: 28 },
      { p: vec.origin, r: 18 },
      { p: viewCenter, r: 18 }
    ];
    var best = null, bestD = 1e9, i, s, d;
    for (i = 0; i < hits.length; i++) {
      s = project(hits[i].p);
      d = Math.hypot(s.x - sx, s.y - sy);
      if (d < hits[i].r && d < bestD) {
        best = hits[i].p;
        bestD = d;
      }
    }
    if (best) return best.slice();
    return unprojectViewPlane(sx, sy);
  }

  function zoomAtScreen(sx, sy, newZoom) {
    newZoom = PGRE.clampCardDiagramZoom(newZoom);
    if (newZoom === zoom) return;
    var world = worldUnderPointer(sx, sy);
    var before = project(world);
    zoom = newZoom;
    keepWorldAt(world, before.x, before.y);
  }

  function centreOnField() {
    viewCenter = vec.field.slice();
    draw();
  }

  function resetView() {
    zoom = CD_ZOOM_0;
    yaw = CD_YAW0;
    pitch = CD_PITCH0;
    viewCenter = [0, 0, 0];
    draw();
  }

  function setPanMode(on) {
    panMode = !!on;
    if (panBtn) panBtn.setAttribute('aria-pressed', panMode ? 'true' : 'false');
    if (hintEl) hintEl.textContent = panMode ? 'Drag to pan.' : (W < 420 ? hintShort : hintLong);
    host.classList.toggle('is-move', panMode);
    host.setAttribute('data-pan', panMode ? '1' : '0');
  }

  function nearFieldClient(cx, cy) {
    var loc = clientToLocal(cx, cy);
    var f = project(vec.field);
    if (Math.hypot(loc.x - f.x, loc.y - f.y) < 28) return true;
    var ids = ['rhat', 'erad'];
    var i, el, r;
    for (i = 0; i < ids.length; i++) {
      el = labels[ids[i]];
      if (!el || el.style.visibility === 'hidden') continue;
      r = el.getBoundingClientRect();
      if (cx >= r.left - 4 && cx <= r.right + 4 && cy >= r.top - 4 && cy <= r.bottom + 4) return true;
    }
    return false;
  }

  function onDown(ev) {
    if (ev.button != null && ev.button !== 0 && ev.button !== 2) return;
    if (isZoomControl(ev.target)) return;
    pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
    if (pointerCount() >= 2) {
      dragging = false;
      pinching = true;
      pinchStartDist = pinchDist();
      pinchStartZoom = zoom;
      var mid = pinchMid();
      var loc = clientToLocal(mid.x, mid.y);
      pinchWorld = worldUnderPointer(loc.x, loc.y);
      host.classList.remove('is-dragging');
      if (ev.cancelable) ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    var now = Date.now();
    if ((ev.pointerType === 'touch' || ev.pointerType === 'pen') &&
        now - lastTapAt < 350 &&
        Math.hypot(ev.clientX - lastTapX, ev.clientY - lastTapY) < 28 &&
        nearFieldClient(ev.clientX, ev.clientY)) {
      lastTapAt = 0;
      centreOnField();
      if (ev.cancelable) ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    lastTapAt = now;
    lastTapX = ev.clientX;
    lastTapY = ev.clientY;
    dragging = true;
    gesture = (ev.button === 2 || ev.shiftKey || panMode) ? 'pan' : 'rotate';
    lastX = ev.clientX;
    lastY = ev.clientY;
    pointerId = ev.pointerId;
    try { host.setPointerCapture(ev.pointerId); } catch (eCap) { /* older */ }
    host.classList.add('is-dragging');
    if (ev.cancelable) ev.preventDefault();
    ev.stopPropagation();
  }
  function onMove(ev) {
    if (pointers[ev.pointerId]) {
      pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
    }
    if (pinching && pointerCount() >= 2) {
      var d = pinchDist();
      var mid = pinchMid();
      var loc = clientToLocal(mid.x, mid.y);
      if (pinchStartDist > 1 && d > 1) {
        zoom = PGRE.clampCardDiagramZoom(pinchStartZoom * (d / pinchStartDist));
      }
      if (pinchWorld) keepWorldAt(pinchWorld, loc.x, loc.y);
      draw();
      if (ev.cancelable) ev.preventDefault();
      return;
    }
    if (!dragging) return;
    if (pointerId != null && ev.pointerId !== pointerId) return;
    var dx = ev.clientX - lastX;
    var dy = ev.clientY - lastY;
    lastX = ev.clientX;
    lastY = ev.clientY;
    var r = canvas.getBoundingClientRect();
    var sx = dx * (W / (r.width || 1));
    var sy = dy * (H / (r.height || 1));
    if (gesture === 'pan') {
      panByScreen(sx, sy);
    } else {
      yaw += dx * 0.008;
      pitch += dy * 0.008;
      if (pitch > 1.2) pitch = 1.2;
      if (pitch < -1.2) pitch = -1.2;
      clampPan();
    }
    draw();
    if (ev.cancelable) ev.preventDefault();
  }
  function onUp(ev) {
    delete pointers[ev.pointerId];
    if (pointerCount() < 2) {
      pinching = false;
      pinchWorld = null;
    }
    if (pointerId != null && ev.pointerId !== pointerId && pointerCount() > 0) return;
    dragging = false;
    pointerId = null;
    host.classList.remove('is-dragging');
  }

  function onWheel(ev) {
    if (ev.cancelable) ev.preventDefault();
    ev.stopPropagation();
    var dy = ev.deltaY;
    if (ev.deltaMode === 1) dy *= 16;
    if (ev.deltaMode === 2) dy *= 120;
    var k = ev.ctrlKey ? 0.012 : 0.0022;
    var next = PGRE.clampCardDiagramZoom(zoom * Math.exp(-dy * k));
    var rect = host.getBoundingClientRect();
    var cx = ev.clientX, cy = ev.clientY;
    if (cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom &&
        (cx !== 0 || cy !== 0)) {
      var loc = clientToLocal(cx, cy);
      zoomAtScreen(loc.x, loc.y, next);
    } else {
      zoom = next;
    }
    draw();
  }

  function onDblClick(ev) {
    if (isZoomControl(ev.target)) return;
    if (nearFieldClient(ev.clientX, ev.clientY)) {
      ev.preventDefault();
      centreOnField();
    }
  }

  function onContextMenu(ev) {
    ev.preventDefault();
  }

  function applyZoomOp(op) {
    if (op === 'in') zoom = PGRE.clampCardDiagramZoom(zoom * 1.25);
    else if (op === 'out') zoom = PGRE.clampCardDiagramZoom(zoom / 1.25);
    else if (op === 'reset') {
      resetView();
      return;
    }
    draw();
  }

  host.addEventListener('pointerdown', onDown);
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerup', onUp);
  host.addEventListener('pointercancel', onUp);
  host.addEventListener('lostpointercapture', onUp);
  host.addEventListener('wheel', onWheel, { passive: false });
  host.addEventListener('dblclick', onDblClick);
  host.addEventListener('contextmenu', onContextMenu);
  host.querySelectorAll('.card-diagram-zoom button').forEach(function (btn) {
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (btn.hasAttribute('data-cd-pan')) {
        setPanMode(!panMode);
        return;
      }
      if (btn.hasAttribute('data-cd-centre')) {
        centreOnField();
        return;
      }
      applyZoomOp(btn.getAttribute('data-cd-zoom'));
    });
    btn.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
  });

  var ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(function () {
      if (!host.isConnected) {
        if (ro) ro.disconnect();
        if (themeObs) themeObs.disconnect();
        return;
      }
      draw();
    });
    ro.observe(host);
  }
  var themeObs = null;
  if (typeof MutationObserver === 'function' && document.documentElement) {
    themeObs = new MutationObserver(function () {
      if (host.isConnected) draw();
    });
    themeObs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });
  }
  draw();
};

/* ——— Parity, time reversal and charge conjugation lab ———
   Not 3D: an HTML lab in place of the card's .recall-list. Buttons apply
   P, T or C to seven quantities (coral arrows flip, teal arrows stay), a
   term tester multiplies the factors' signs, and a predict-first quiz
   draws one quantity and one transformation at a time. */
(function () {
  var ROWS = [
    { k: 'r', sym: '\\mathbf{r}', name: 'Position',
      P: [1, 'it points to a place'], T: [0, 'a snapshot: no time in it'], C: [0, 'no charge in it'] },
    { k: 'p', sym: '\\mathbf{p} = m\\mathbf{v}', name: 'Momentum',
      P: [1, '$\\mathbf{v} = d\\mathbf{r}/dt$ and $\\mathbf{r}$ flips'], T: [1, 'the motion runs backward'], C: [0, 'no charge in it'] },
    { k: 'S', sym: '\\mathbf{S},\\ \\mathbf{L} = \\mathbf{r}\\times\\mathbf{p}', name: 'Spin and orbital angular momentum', axial: true,
      P: [0, '$\\mathbf{r}$ and $\\mathbf{p}$ both flip, so the rotation keeps its sense'], T: [1, 'the rotation runs backward'], C: [0, 'no charge in it'] },
    { k: 'E', sym: '\\mathbf{E}', name: 'Electric field',
      P: [1, '$\\mathbf{F} = q\\mathbf{E}$ and $\\mathbf{F}$ flips'], T: [0, 'charges at rest make it: a snapshot'], C: [1, 'its source charges flip'] },
    { k: 'B', sym: '\\mathbf{B}', name: 'Magnetic field', axial: true,
      P: [0, 'in $\\mathbf{F} = q\\mathbf{v}\\times\\mathbf{B}$, $\\mathbf{F}$ and $\\mathbf{v}$ both flip'], T: [1, 'currents make it, and they reverse'], C: [1, 'its currents carry flipped charges'] },
    { k: 'd', sym: '\\mathbf{d} = q\\mathbf{r}', name: 'Electric dipole moment',
      P: [1, '$\\mathbf{r}$ flips'], T: [0, 'charge positions: a snapshot'], C: [1, '$q$ flips'] },
    { k: 'mu', sym: '\\boldsymbol{\\mu} \\propto q\\mathbf{L}', name: 'Magnetic moment', axial: true,
      P: [0, 'a current loop keeps its sense, like a spin'], T: [1, 'the loop current reverses'], C: [1, '$q$ flips'] }
  ];
  var TERMS = [
    { id: 'SE', tex: '\\mathbf{S}\\cdot\\mathbf{E}', label: 'electric dipole moment, $\\mathbf{d} \\propto \\mathbf{S}$', a: 'S', b: 'E', cA: 'd', neutral: true },
    { id: 'SB', tex: '\\mathbf{S}\\cdot\\mathbf{B}', label: 'magnetic moment, $\\boldsymbol{\\mu} \\propto \\mathbf{S}$', a: 'S', b: 'B', cA: 'mu', neutral: true },
    { id: 'Sp', tex: '\\mathbf{S}\\cdot\\mathbf{p}', label: 'helicity, as in the weak interaction', a: 'S', b: 'p' },
    { id: 'EB', tex: '\\mathbf{E}\\cdot\\mathbf{B}', label: 'the product of the two fields', a: 'E', b: 'B' }
  ];
  var NAMES = { P: 'parity $P$ (mirror)', T: 'time reversal $T$ (rewind)', C: 'charge conjugation $C$ (antimatter)' };
  var SLOGAN = {
    P: 'Mirror, $\\mathbf{r} \\to -\\mathbf{r}$: arrows that point to places flip; arrows that spin stay.',
    T: 'Rewind, $t \\to -t$: anything moving flips; snapshots stay.',
    C: 'Antimatter, $q \\to -q$: anything made of charge flips; pure mechanics stays.'
  };

  function row(k) {
    for (var i = 0; i < ROWS.length; i++) if (ROWS[i].k === k) return ROWS[i];
    return null;
  }
  function term(id) {
    for (var i = 0; i < TERMS.length; i++) if (TERMS[i].id === id) return TERMS[i];
    return null;
  }
  /* true when quantity k changes sign under t ('P' | 'T' | 'C'). */
  PGRE.ptcFlips = function (k, t) {
    var r = row(k);
    return r && r[t] ? r[t][0] === 1 : null;
  };
  /* The two factors used under t. A dipole term is written with S, which
     fixes its P and T signs; under C the dipole's own charge flips, so C
     uses d or mu (cA) instead of S. */
  function factors(x, t) { return [t === 'C' && x.cA ? x.cA : x.a, x.b]; }
  /* true when the scalar term changes sign under t, so t is violated. */
  PGRE.ptcTermOdd = function (id, t) {
    var x = term(id);
    if (!x) return null;
    var f = factors(x, t);
    return PGRE.ptcFlips(f[0], t) !== PGRE.ptcFlips(f[1], t);
  };
  PGRE.ptcRows = ROWS;
  PGRE.ptcTerms = TERMS;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function tex(t) {
    if (window.katex) {
      try { return window.katex.renderToString(t, { throwOnError: false }); } catch (e) { /* fall through */ }
    }
    return esc(t);
  }
  /* Text with $...$ segments typeset inline. */
  function rich(s) {
    return String(s).split(/(\$[^$]+\$)/).map(function (seg) {
      return /^\$[^$]+\$$/.test(seg) ? tex(seg.slice(1, -1)) : esc(seg);
    }).join('');
  }

  var CSS =
    '.card-diagram-host.ptc-lab{aspect-ratio:auto;cursor:auto;touch-action:auto;user-select:text;-webkit-user-select:text;overflow:visible;padding:12px}' +
    '.ptc-lab .ptc-row{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 6px}' +
    '.ptc-lab .ptc-on{border-color:var(--ink);font-weight:600}' +
    '.ptc-lab .ptc-say{font-size:13px;color:var(--muted);margin:2px 0 10px;min-height:20px}' +
    '.ptc-lab .ptc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}' +
    '.ptc-lab .ptc-q{border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--bg);min-width:0;color:var(--muted)}' +
    '.ptc-lab .ptc-q.is-flip{color:#D85A30}.ptc-lab .ptc-q.is-stay{color:#1D9E75}' +
    '.ptc-lab .ptc-nm{font-size:12px;color:var(--muted)}' +
    '.ptc-lab .ptc-sy{font-size:15px;color:var(--ink);margin:2px 0}' +
    '.ptc-lab .ptc-why{font-size:12px;color:var(--muted);min-height:32px;line-height:1.4}' +
    '.ptc-lab .ptc-arr{transition:transform .5s ease;transform-origin:50px 10px}' +
    '.ptc-lab .ptc-q.is-flip .ptc-arr{transform:rotate(180deg)}' +
    '.ptc-lab .ptc-sec{margin-top:12px;padding-top:10px;border-top:1px solid var(--line)}' +
    '.ptc-lab .ptc-h{font-size:13px;font-weight:600;color:var(--ink);margin-bottom:6px}' +
    '.ptc-lab .ptc-out{font-size:13px;line-height:1.7;min-height:22px;color:var(--ink)}' +
    '.ptc-lab .ptc-bad{color:#D85A30}.ptc-lab .ptc-ok{color:#1D9E75}';
  function ensureStyle() {
    if (document.getElementById('ptc-lab-style')) return;
    var st = document.createElement('style');
    st.id = 'ptc-lab-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function btn(attr, html) {
    return '<button type="button" class="btn btn-ghost btn-sm" ' + attr + '>' + html + '</button>';
  }

  PGRE.cardDiagrams['supp-p-t-c-transformations'] = function (host) {
    ensureStyle();
    host.classList.add('ptc-lab');
    var html = '<div class="ptc-row">' +
      btn('data-ptc-t="P"', 'Mirror&nbsp;' + tex('P')) +
      btn('data-ptc-t="T"', 'Rewind&nbsp;' + tex('T')) +
      btn('data-ptc-t="C"', 'Antimatter&nbsp;' + tex('C')) + '</div>' +
      '<div class="ptc-say" data-ptc-say>Choose a transformation. Coral arrows flip, teal arrows stay.</div>' +
      '<div class="ptc-grid">';
    ROWS.forEach(function (r) {
      html += '<div class="ptc-q" data-ptc-q="' + r.k + '">' +
        '<div class="ptc-nm">' + esc(r.name) + (r.axial ? ' (axial)' : '') + '</div>' +
        '<div class="ptc-sy">' + tex(r.sym) + '</div>' +
        '<svg width="100" height="20" viewBox="0 0 100 20" aria-hidden="true"><g class="ptc-arr">' +
        '<line x1="12" y1="10" x2="84" y2="10" stroke="currentColor" stroke-width="3"/>' +
        '<polygon points="84,4 96,10 84,16" fill="currentColor"/></g></svg>' +
        '<div class="ptc-why" data-ptc-why></div></div>';
    });
    html += '</div>' +
      '<div class="ptc-sec"><div class="ptc-h">Term tester: multiply the signs of the factors</div><div class="ptc-row">';
    TERMS.forEach(function (x) { html += btn('data-ptc-term="' + x.id + '"', tex(x.tex)); });
    html += '</div><div class="ptc-out" data-ptc-termout></div></div>' +
      '<div class="ptc-sec"><div class="ptc-h">Predict first</div>' +
      '<div class="ptc-out" data-ptc-quiz></div><div class="ptc-row">' +
      btn('data-ptc-ans="1"', 'Flips') + btn('data-ptc-ans="0"', 'Stays') + btn('data-ptc-next', 'Next') +
      '</div><div class="ptc-out" data-ptc-fb></div><div class="ptc-nm" data-ptc-score></div></div>';
    host.innerHTML = html;

    function q(sel) { return host.querySelector(sel); }
    function apply(t) {
      var b = host.querySelectorAll('[data-ptc-t]');
      for (var i = 0; i < b.length; i++) b[i].classList.toggle('ptc-on', b[i].getAttribute('data-ptc-t') === t);
      q('[data-ptc-say]').innerHTML = rich(SLOGAN[t]);
      ROWS.forEach(function (r) {
        var el = q('[data-ptc-q="' + r.k + '"]');
        var f = r[t][0] === 1;
        el.classList.remove('is-flip', 'is-stay');
        void el.offsetWidth;
        el.classList.add(f ? 'is-flip' : 'is-stay');
        el.querySelector('[data-ptc-why]').innerHTML =
          '<span class="' + (f ? 'ptc-bad' : 'ptc-ok') + '">' + (f ? 'flips' : 'stays') + '</span>: ' + rich(r[t][1]);
      });
    }
    function sign(f) { return f ? '(-)' : '(+)'; }
    function showTerm(id) {
      var x = term(id);
      var b = host.querySelectorAll('[data-ptc-term]');
      for (var i = 0; i < b.length; i++) b[i].classList.toggle('ptc-on', b[i].getAttribute('data-ptc-term') === id);
      var out = rich('$' + x.tex + '$, ' + x.label + ':') + '<br>';
      out += ['P', 'T', 'C'].map(function (t) {
        var odd = PGRE.ptcTermOdd(id, t), f = factors(x, t);
        return tex(t + ':\\ ' + sign(PGRE.ptcFlips(f[0], t)) + sign(PGRE.ptcFlips(f[1], t)) + ' = ' + (odd ? '-' : '+')) +
          ' <span class="' + (odd ? 'ptc-bad' : 'ptc-ok') + '">' + (odd ? 'violates ' + tex(t) : 'allowed') + '</span>';
      }).join('&nbsp;&nbsp;|&nbsp;&nbsp;');
      if (x.neutral) {
        out += '<br><span class="ptc-nm">' + rich('Under $C$ the dipole itself flips with its charge, so the $C$ row uses $' + (x.cA === 'd' ? '\\mathbf{d}' : '\\boldsymbol{\\mu}') + '$, not $\\mathbf{S}$. $C$ also turns a neutron into an antineutron, so measuring the neutron alone does not test $C$.') + '</span>';
      }
      q('[data-ptc-termout]').innerHTML = out;
    }
    var cur = null, done = false, right = 0, asked = 0;
    function nextQuiz() {
      var r = ROWS[Math.floor(Math.random() * ROWS.length)];
      var t = 'PTC'.charAt(Math.floor(Math.random() * 3));
      cur = { r: r, t: t };
      done = false;
      q('[data-ptc-quiz]').innerHTML = rich('Under ' + NAMES[t] + ', what happens to ' + r.name.toLowerCase() + ' $' + r.sym + '$?');
      q('[data-ptc-fb]').innerHTML = '';
    }
    function answer(f) {
      if (done || !cur) return;
      done = true;
      asked++;
      var truth = cur.r[cur.t][0] === 1;
      var ok = truth === f;
      if (ok) right++;
      q('[data-ptc-fb]').innerHTML = '<span class="' + (ok ? 'ptc-ok' : 'ptc-bad') + '">' + (ok ? 'Right' : 'Not quite') + '</span>: it ' +
        (truth ? 'flips' : 'stays') + ', because ' + rich(cur.r[cur.t][1]) + '.';
      q('[data-ptc-score]').textContent = right + ' of ' + asked + ' right';
    }
    host.addEventListener('click', function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest('button') : null;
      if (el && host.contains(el)) {
        if (el.hasAttribute('data-ptc-t')) apply(el.getAttribute('data-ptc-t'));
        else if (el.hasAttribute('data-ptc-term')) showTerm(el.getAttribute('data-ptc-term'));
        else if (el.hasAttribute('data-ptc-ans')) answer(el.getAttribute('data-ptc-ans') === '1');
        else if (el.hasAttribute('data-ptc-next')) nextQuiz();
      }
      ev.stopPropagation();
    });
    nextQuiz();
  };
})();
