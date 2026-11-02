/* Settings (Life Studio, phase 1 — LIFE-STUDIO-SPEC.md).
   One card today: the theme picker. Every named theme (js/data-themes.js)
   renders as a live swatch — a mini page painted with the theme's own tokens
   — and picking one applies and saves it at once (settings.theme, a named
   id). The sidebar's theme button stays as a light/dark quick flip. */
window.PGRE = window.PGRE || {};
PGRE.views = PGRE.views || {};

PGRE.views.settings = (function () {

  function swatchHTML(theme, current) {
    var ui = PGRE.ui, s = theme.swatch || {};
    return '<button type="button" class="theme-swatch' + (current ? ' is-current' : '') + '"' +
      ' data-theme-pick="' + ui.esc(theme.id) + '" aria-pressed="' + (current ? 'true' : 'false') + '">' +
      '<span class="theme-swatch-page" style="background:' + ui.esc(s.bg || '#fff') + '">' +
        '<span class="theme-swatch-bar" style="background:' + ui.esc(s.accent || '#888') + '"></span>' +
        '<span class="theme-swatch-line" style="background:' + ui.esc(s.ink || '#000') + ';width:70%"></span>' +
        '<span class="theme-swatch-line" style="background:' + ui.esc(s.ink || '#000') + ';width:45%;opacity:.55"></span>' +
      '</span>' +
      '<span class="theme-swatch-name">' + ui.esc(theme.name) +
        (current ? ' <span class="theme-swatch-on">· in use</span>' : '') + '</span>' +
      '</button>';
  }

  return {
    render: function () {
      var current = PGRE.normalizeTheme
        ? PGRE.normalizeTheme(PGRE.store.state.settings.theme)
        : PGRE.store.state.settings.theme;
      var swatches = '';
      (PGRE.THEMES || []).forEach(function (t) {
        swatches += swatchHTML(t, t.id === current);
      });
      return '<div class="card">' +
        '<h1>Settings</h1>' +
        '<h2>Theme</h2>' +
        '<p class="muted">Pick a look for the studio. It applies immediately and ' +
        'is remembered on this profile.</p>' +
        '<div class="theme-grid" id="theme-grid">' + swatches + '</div></div>';
    },
    mount: function () {
      var grid = document.getElementById('theme-grid');
      if (!grid) return;
      grid.querySelectorAll('.theme-swatch').forEach(function (b) {
        b.addEventListener('click', function () {
          PGRE.setTheme(b.getAttribute('data-theme-pick'));
          // Repaint the marks in place — a full re-route would scroll to top.
          grid.querySelectorAll('.theme-swatch').forEach(function (o) {
            var on = o === b;
            o.classList.toggle('is-current', on);
            o.setAttribute('aria-pressed', on ? 'true' : 'false');
            var name = o.querySelector('.theme-swatch-name');
            if (name) {
              var theme = PGRE.themeEntry(o.getAttribute('data-theme-pick'));
              name.innerHTML = PGRE.ui.esc(theme.name) +
                (on ? ' <span class="theme-swatch-on">· in use</span>' : '');
            }
          });
        });
      });
    }
  };
})();
