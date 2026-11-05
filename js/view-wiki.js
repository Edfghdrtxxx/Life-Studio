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

  return { render: render };
})();
