/* Wiki — reference pages that live outside this repo, framed inside the
   studio. Each entry is one line: id, title, file URL. The file stays in its
   own home; this repo never copies it. Routes: #/wiki/<id> and
   #/wiki/<id>/<anchor> (opens the file at that in-page anchor). */
window.PGRE = window.PGRE || {};
PGRE.views = PGRE.views || {};

PGRE.WIKI_PAGES = [
  { id: 'mate', title: 'MATE research',
    file: 'file:///Users/Reid%20Hu/OrbitOS/20_Project/Auto_Research/MATE_Research_Explainer_2026-11-03.html' }
];

PGRE.wikiPage = function (id) {
  for (var i = 0; i < PGRE.WIKI_PAGES.length; i++) {
    if (PGRE.WIKI_PAGES[i].id === id) return PGRE.WIKI_PAGES[i];
  }
  return null;
};

PGRE.views.wiki = (function () {

  function render(params) {
    params = params || {};
    var page = PGRE.wikiPage(params.id);
    if (!page) {
      return '<div class="card"><h2>Wiki</h2><p class="muted">No such wiki page.</p></div>';
    }
    var esc = PGRE.ui.esc;
    var src = page.file + (params.sub2 ? '#' + encodeURIComponent(params.sub2) : '');
    return '<div class="wiki-head"><h2>' + esc(page.title) + '</h2>' +
        '<a class="btn btn-ghost btn-sm" href="' + esc(page.file) + '"' +
        ' target="_blank" rel="noopener">Open on its own</a></div>' +
      '<div class="wiki-frame">' +
        '<iframe class="wiki-iframe" src="' + esc(src) + '" title="' + esc(page.title) + '"></iframe>' +
      '</div>';
  }

  /* The framed file cannot read our styles (two file:// pages cannot reach
     each other's documents), so we post it the theme colours its own
     highlight should use. A file:// frame's origin is "null", so the target
     origin is '*'; the payload holds only public colour values. */
  var themeObserver = null;

  function themeMessage() {
    var cs = getComputedStyle(document.documentElement);
    return {
      type: 'studio-theme',
      dark: document.documentElement.dataset.dark === '1',
      accent: (cs.getPropertyValue('--accent') || '').trim(),
      accentTint: (cs.getPropertyValue('--accent-tint') || '').trim(),
      accentDeep: (cs.getPropertyValue('--accent-deep') || '').trim()
    };
  }

  function sendTheme(iframe) {
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage(themeMessage(), '*');
    }
  }

  function mount() {
    if (themeObserver) { themeObserver.disconnect(); themeObserver = null; }
    var iframe = document.querySelector('.wiki-iframe');
    if (!iframe) return;
    iframe.addEventListener('load', function () { sendTheme(iframe); });
    if (window.MutationObserver) {
      themeObserver = new MutationObserver(function () {
        if (!iframe.isConnected) { themeObserver.disconnect(); themeObserver = null; return; }
        sendTheme(iframe);
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme', 'data-dark']
      });
    }
  }

  return { render: render, mount: mount };
})();
