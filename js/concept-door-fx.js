/* Concept Visualization Door Effect — Physics GRE Prep Studio
   Dotted-surface particle wave (port of the Three.js Points field).
   Self-terminating rAF loop, reduced-motion compliance, dark-mode. */
window.PGRE = window.PGRE || {};
var PGRE = window.PGRE;
PGRE.conceptDoorFx = (function () {
  'use strict';

  var canvas = null;
  var ctx = null;
  var raf = 0;
  var boundHost = null;
  var count = 0;
  var lastNow = 0;
  var listenersAttached = false;
  var reduceMq = null;

  var SEPARATION = 150;
  var AMOUNTX = 40;
  var AMOUNTY = 60;
  var POINT_SIZE = 8;
  var OPACITY = 0.8;
  var CAM_Y = 355;
  var CAM_Z = 1220;
  var FOV = 60 * Math.PI / 180;
  var FOG_NEAR = 2000;
  var FOG_FAR = 10000;
  /* Original rAF steps count by 0.1 at ~60fps. */
  var COUNT_PER_SEC = 6;

  function reduced() {
    return !!(typeof window !== 'undefined' && window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function reqAnim(fn) {
    if (typeof requestAnimationFrame !== 'undefined') return requestAnimationFrame(fn);
    if (typeof window !== 'undefined' && window.requestAnimationFrame) return window.requestAnimationFrame(fn);
    return 0;
  }

  function cancelAnim(id) {
    if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(id);
    else if (typeof window !== 'undefined' && window.cancelAnimationFrame) window.cancelAnimationFrame(id);
  }

  function isDark() {
    // Life Studio named themes: any theme marked dark sets [data-dark];
    // the literal 'dark' attr stays the warm-dark theme's own value.
    if (typeof document === 'undefined' || !document.documentElement) return false;
    var el = document.documentElement;
    if (el.hasAttribute && el.hasAttribute('data-dark')) return true;
    return el.getAttribute('data-theme') === 'dark';
  }

  function syncCanvas() {
    if (!canvas || !boundHost || !ctx) return { w: 0, h: 0 };
    var w = boundHost.clientWidth || 300;
    var h = boundHost.clientHeight || 300;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var rw = Math.round(w * dpr);
    var rh = Math.round(h * dpr);
    if (canvas.width !== rw || canvas.height !== rh) {
      canvas.width = rw;
      canvas.height = rh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: w, h: h };
  }

  function paint(w, h, wave) {
    if (!ctx || w <= 0 || h <= 0) return;

    ctx.clearRect(0, 0, w, h);

    var aspect = w / h;
    var py = 1 / Math.tan(FOV / 2);
    var px = py / aspect;
    var dark = isDark();
    /* Match the source component: dark 200/200/200, light black. */
    var rgb = dark ? '200,200,200' : '0,0,0';
    var halfX = (AMOUNTX * SEPARATION) / 2;
    var halfY = (AMOUNTY * SEPARATION) / 2;
    var margin = POINT_SIZE * 4;

    var ix, iy, x, y, z, xC, yC, zC, dist, fog, ndcX, ndcY, sx, sy, diam, alpha;

    ctx.fillStyle = 'rgb(' + rgb + ')';

    for (ix = 0; ix < AMOUNTX; ix++) {
      for (iy = 0; iy < AMOUNTY; iy++) {
        x = ix * SEPARATION - halfX;
        y = Math.sin((ix + wave) * 0.3) * 50 + Math.sin((iy + wave) * 0.5) * 50;
        z = iy * SEPARATION - halfY;

        xC = x;
        yC = y - CAM_Y;
        zC = z - CAM_Z;
        if (zC >= -1) continue;

        dist = Math.sqrt(xC * xC + yC * yC + zC * zC);
        fog = 1;
        if (dist > FOG_NEAR) {
          fog = (FOG_FAR - dist) / (FOG_FAR - FOG_NEAR);
          if (fog <= 0) continue;
          if (fog > 1) fog = 1;
        }

        ndcX = px * xC / -zC;
        ndcY = py * yC / -zC;
        sx = (ndcX + 1) * 0.5 * w;
        sy = (1 - ndcY) * 0.5 * h;
        if (sx < -margin || sx > w + margin || sy < -margin || sy > h + margin) continue;

        /* THREE.PointsMaterial sizeAttenuation: gl_PointSize = size * ((h/2) / -zC). */
        diam = POINT_SIZE * (h * 0.5) / -zC;
        if (diam < 0.4) continue;
        if (diam > 24) diam = 24;

        alpha = OPACITY * fog;
        if (alpha < 0.02) continue;
        ctx.globalAlpha = alpha;
        ctx.fillRect(sx - diam * 0.5, sy - diam * 0.5, diam, diam);
      }
    }

    ctx.globalAlpha = 1;
  }

  function paintStill() {
    var dims = syncCanvas();
    paint(dims.w, dims.h, 0);
  }

  function frame(now) {
    raf = 0;
    if (!canvas || !canvas.isConnected) {
      hardStop();
      return;
    }
    if (reduced()) {
      paintStill();
      return;
    }
    if (typeof document !== 'undefined' && (document.hidden || document.visibilityState === 'hidden')) {
      return;
    }
    if (!lastNow) lastNow = now;
    var dt = (now - lastNow) / 1000;
    if (dt > 0.1) dt = 0.016;
    lastNow = now;
    count += dt * COUNT_PER_SEC;

    var dims = syncCanvas();
    paint(dims.w, dims.h, count);

    raf = reqAnim(frame);
  }

  function kick() {
    if (!raf && canvas && canvas.isConnected && !reduced()) {
      if (typeof document === 'undefined' || !(document.hidden || document.visibilityState === 'hidden')) {
        lastNow = 0;
        raf = reqAnim(frame);
      }
    }
  }

  function hardStop() {
    if (raf) {
      cancelAnim(raf);
      raf = 0;
    }
    lastNow = 0;
  }

  function onVisibilityChange() {
    if (!canvas || !canvas.isConnected) {
      hardStop();
      return;
    }
    if (document.hidden || document.visibilityState === 'hidden') {
      if (raf) {
        cancelAnim(raf);
        raf = 0;
      }
    } else {
      kick();
    }
  }

  function onResize() {
    if (!canvas || !canvas.isConnected) return;
    if (reduced()) paintStill();
  }

  function onTheme() {
    if (!canvas || !canvas.isConnected) return;
    if (reduced()) paintStill();
  }

  function onReduceChange() {
    if (!canvas || !canvas.isConnected) return;
    if (reduced()) {
      hardStop();
      paintStill();
    } else {
      kick();
    }
  }

  function mount(hostEl) {
    if (!hostEl) return;
    if (canvas && canvas.isConnected && canvas.parentElement === hostEl) {
      if (reduced()) {
        hardStop();
        paintStill();
      } else {
        kick();
      }
      return;
    }

    hardStop();
    if (canvas && canvas.parentElement) {
      canvas.parentElement.removeChild(canvas);
    }

    canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';

    hostEl.appendChild(canvas);
    ctx = canvas.getContext('2d');
    boundHost = hostEl;
    count = 0;

    if (!listenersAttached && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
      window.addEventListener('resize', onResize);
      if (window.MutationObserver) {
        new MutationObserver(onTheme).observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['data-theme', 'data-dark']
        });
      }
      if (window.matchMedia) {
        reduceMq = window.matchMedia('(prefers-reduced-motion: reduce)');
        if (reduceMq.addEventListener) reduceMq.addEventListener('change', onReduceChange);
        else if (reduceMq.addListener) reduceMq.addListener(onReduceChange);
      }
      listenersAttached = true;
    }

    if (reduced()) {
      paintStill();
    } else {
      kick();
    }
  }

  return {
    mount: mount,
    stop: hardStop
  };
})();
