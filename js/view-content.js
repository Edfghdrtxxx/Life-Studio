/* Library — import the book markdown, map chapters to topics, manage local data.
   The real content parser is deferred until the actual file arrives
   (20_docs/Project Docs/DESIGN.md → Content pipeline); this view stores the raw markdown in
   IndexedDB, splits it naively on headings, and lets chapters be assigned to
   topic portals so their notes render there. */
window.PGRE = window.PGRE || {};
PGRE.views = PGRE.views || {};

PGRE.views.library = (function () {

  // ——— PDF viewer object-URL lifecycle ———
  // A blob: object URL leaks until revoked, and there is no unmount hook, so we
  // track the single open viewer at module scope and revoke on close / re-render
  // (top of refreshFiles) / leaving #/library (the hashchange listener below).
  var activeURL = null;    // the object URL backing the currently-open viewer
  var openViewer = null;   // its .pdf-viewer element (removed on close)
  var openBtn = null;      // its View button (restore label + detect a toggle-off tap)

  function closeViewer() {
    if (activeURL) { URL.revokeObjectURL(activeURL); activeURL = null; }
    if (openViewer && openViewer.parentNode) openViewer.parentNode.removeChild(openViewer);
    if (openBtn) openBtn.textContent = 'View';
    openViewer = null;
    openBtn = null;
  }

  function fileById(files, id) {
    for (var i = 0; i < files.length; i++) { if (files[i].id === id) return files[i]; }
    return null;
  }

  // The inline viewer: a tall frame around the browser's native PDF viewer plus an
  // "Open in new tab" link. Built as trusted app DOM — NEVER through
  // PGRE.renderMarkdown, whose sanitizer strips iframe/embed. `url` is our own
  // blob: object URL (no quotes/spaces), so it is safe to interpolate directly.
  function buildViewer(url) {
    var div = document.createElement('div');
    div.className = 'pdf-viewer';
    div.innerHTML =
      '<div class="pdf-frame"><iframe class="pdf-iframe" src="' + url + '" title="PDF preview"></iframe></div>' +
      '<div class="pdf-viewer-foot"><a class="btn btn-ghost" href="' + url + '" target="_blank" rel="noopener">Open in new tab ↗</a></div>';
    return div;
  }

  // A PDF record renders its own card (name / size / when + View + Remove) instead
  // of the chapter-mapping fileCard — PDFs are never split into sections.
  function pdfCard(f) {
    var ui = PGRE.ui;
    return '<div class="card file-card pdf-card" data-file="' + ui.esc(f.id) + '">' +
      '<div class="file-head"><h2>' + ui.esc(f.name) + '</h2>' +
      '<span class="muted">PDF · ' + Math.round((f.size || 0) / 1024) + ' KB · imported ' + ui.timeAgo(f.added) + '</span></div>' +
      '<div class="btn-row">' +
        '<button class="btn btn-ghost" data-view="' + ui.esc(f.id) + '">View</button>' +
        '<button class="btn btn-danger-ghost" data-del="' + ui.esc(f.id) + '">Remove file</button>' +
      '</div>' +
    '</div>';
  }

  function fileCard(f) {
    var ui = PGRE.ui;
    var html = '<div class="card file-card" data-file="' + ui.esc(f.id) + '">' +
      '<div class="file-head"><h2>' + ui.esc(f.name) + '</h2>' +
      '<span class="muted">' + Math.round(f.size / 1024) + ' KB · ' + (f.chapters || []).length + ' section' +
      ((f.chapters || []).length === 1 ? '' : 's') + ' · imported ' + ui.timeAgo(f.added) + '</span></div>' +
      '<p class="muted">Assign each section to a knowledge portal — it will render on that topic’s Notes tab.</p>' +
      '<table class="map-table"><thead><tr><th>Section</th><th>Portal</th></tr></thead><tbody>';
    (f.chapters || []).forEach(function (ch, idx) {
      html += '<tr><td>' + ui.esc(ch.title) + '</td><td><select data-ch="' + idx + '">' +
        '<option value="">— unassigned —</option>';
      PGRE.TOPICS.forEach(function (t) {
        var sel = f.mapping && f.mapping[idx] === t.id ? ' selected' : '';
        html += '<option value="' + t.id + '"' + sel + '>' + t.name + '</option>';
      });
      html += '</select></td></tr>';
    });
    html += '</tbody></table>' +
      '<div class="btn-row"><button class="btn btn-danger-ghost" data-del="' + ui.esc(f.id) + '">Remove file</button></div>' +
      '</div>';
    return html;
  }

  function refreshFiles() {
    var box = document.getElementById('files-box');
    if (!box) return;   // called after the user left the Library view
    closeViewer();      // drop any live object URL before the DOM below is rebuilt
    PGRE.contentDB.all().then(function (files) {
      // the formula deck (parser v2 output) shares the store but is not a book file
      files = files.filter(function (f) { return f.kind !== 'formula-deck'; });
      if (!files.length) {
        box.innerHTML = '<div class="card placeholder">' +
          '<p><strong>No content imported yet.</strong></p>' +
          '<p class="muted">This is where <em>Conquering the Physics GRE</em> lands when its markdown is ready. ' +
          'Drop the file above (or keep a copy in the <code>content/</code> folder). ' +
          'A proper parser — chapters, problems, solutions → question bank — is designed and will be built ' +
          'against the real file; see <code>20_docs/Project Docs/DESIGN.md</code>.</p></div>';
        return;
      }
      // PDFs render their own card; everything else keeps the chapter-mapping card.
      box.innerHTML = files.map(function (f) {
        return f.kind === 'pdf' ? pdfCard(f) : fileCard(f);
      }).join('');

      // PDF View buttons: toggle an inline native-PDF viewer open/closed. Only one
      // viewer is open at a time; opening another (or closing this one) revokes the
      // previous object URL via closeViewer().
      box.querySelectorAll('[data-view]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (openBtn === b) { closeViewer(); return; }   // tapping the open one closes it
          closeViewer();                                  // close/revoke any other open viewer
          var card = b.closest('[data-file]');
          if (!card) return;
          var rec = fileById(files, b.getAttribute('data-view'));
          if (!rec || !rec.blob) return;
          activeURL = URL.createObjectURL(rec.blob);
          openViewer = buildViewer(activeURL);
          card.appendChild(openViewer);
          openBtn = b;
          b.textContent = 'Hide';
        });
      });

      box.querySelectorAll('select[data-ch]').forEach(function (sel) {
        sel.addEventListener('change', function () {
          var fileId = sel.closest('[data-file]').getAttribute('data-file');
          PGRE.contentDB.get(fileId).then(function (f) {
            if (!f) return;
            f.mapping = f.mapping || {};
            var idx = parseInt(sel.getAttribute('data-ch'), 10);
            if (sel.value) f.mapping[idx] = sel.value; else delete f.mapping[idx];
            PGRE.contentDB.put(f).then(function () {
              PGRE.toast('Section mapping saved', 'info');
            }).catch(function () {
              PGRE.toast('Could not save the mapping — storage unavailable.', 'error');
              refreshFiles();   // snap the select back to what is actually stored
            });
          });
        });
      });

      box.querySelectorAll('[data-del]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('Remove this imported file? (Your XP and progress are unaffected.)')) return;
          PGRE.contentDB.del(b.getAttribute('data-del')).then(refreshFiles);
        });
      });
    });
  }

  function isPdf(file) {
    return /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
  }

  // PDFs are stored, not parsed: IndexedDB keeps the Blob natively, and the native
  // browser viewer renders it later. No text extraction, no chapter split, and no
  // tome badge (that badge is about importing the book *text* that powers Notes) —
  // but the import is still logged like any other.
  function importPdf(file) {
    var rec = {
      id: 'f-' + Date.now(),
      kind: 'pdf',
      name: file.name,
      size: file.size,
      added: new Date().toISOString(),
      blob: file
    };
    PGRE.contentDB.put(rec).then(function () {
      PGRE.store.log('import', 'Imported ' + file.name, 0);
      PGRE.store.save();
      PGRE.toast('<strong>' + PGRE.ui.esc(file.name) + '</strong> imported — PDF ready to view', 'info');
      refreshFiles();
    }).catch(function () {
      PGRE.toast('Import failed — IndexedDB unavailable in this browser context.', 'error');
    });
  }

  function importFile(file) {
    if (isPdf(file)) { importPdf(file); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result || '');
      var rec = {
        id: 'f-' + Date.now(),
        name: file.name,
        size: file.size,
        added: new Date().toISOString(),
        text: text,
        chapters: PGRE.splitChapters(text),
        mapping: {}
      };
      PGRE.contentDB.put(rec).then(function () {
        PGRE.store.log('import', 'Imported ' + file.name, 0);
        PGRE.gamify.markTomeImported();
        PGRE.store.save();
        PGRE.toast('<strong>' + PGRE.ui.esc(file.name) + '</strong> imported — ' +
          rec.chapters.length + ' sections found', 'info');
        refreshFiles();
      }).catch(function () {
        PGRE.toast('Import failed — IndexedDB unavailable in this browser context.', 'error');
      });
    };
    reader.readAsText(file);
  }

  // Registered ONCE at module eval (like view-focus's zen cleanup): whenever the
  // hash leaves #/library, revoke any open PDF object URL — there is no unmount hook.
  window.addEventListener('hashchange', function () {
    if (!/^#\/library\b/.test(location.hash)) closeViewer();
  });

  return {
    render: function () {
      return '' +
      '<div class="card page-head"><h1>Library</h1>' +
        '<p class="muted">The physics book and handouts live here — imported markdown chapters and ' +
        'PDFs in IndexedDB, on this machine only. Data controls (export, restore, disk backup, ' +
        'resets) moved to <a href="#/settings">Settings › Data</a>.</p>' +
        '<div id="dropzone" class="dropzone">' +
          '<p><strong>Drop the book markdown or a PDF here</strong> (.md / .txt / .pdf)</p>' +
          '<p class="muted">or</p>' +
          '<button class="btn btn-primary" id="pick-btn">Choose a file…</button>' +
          '<input type="file" id="file-input" accept=".md,.markdown,.txt,.pdf" hidden>' +
        '</div>' +
      '</div>' +
      '<div id="files-box"></div>';
    },

    mount: function () {
      refreshFiles();

      var dz = document.getElementById('dropzone');
      var input = document.getElementById('file-input');
      document.getElementById('pick-btn').addEventListener('click', function () { input.click(); });
      input.addEventListener('change', function () {
        if (input.files.length) importFile(input.files[0]);
        input.value = '';
      });
      ['dragover', 'dragenter'].forEach(function (ev) {
        dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag'); });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag'); });
      });
      dz.addEventListener('drop', function (e) {
        if (e.dataTransfer.files.length) importFile(e.dataTransfer.files[0]);
      });
    }
  };
})();
