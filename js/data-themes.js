/* Named studio themes (Life Studio phase 1 — LIFE-STUDIO-SPEC.md).
   The single source of truth for the theme list. Each theme:
     id    — stored in state.settings.theme
     name  — shown in the Settings picker
     dark  — true themes also set [data-dark] on <html> so dark-only CSS
             (focus page, chart tips, visualizer strips) applies to every dark
             theme, not just warm-dark
     attr  — the data-theme value put on <html>; '' removes the attribute
             ('cream' is the :root palette itself)
     swatch— {bg, ink, accent} used by the Settings picker preview
   The token blocks live in css/style.css:
     attr ''        → :root (Cream and coral)
     attr 'dark'    → [data-theme="dark"] (Warm dark — kept literal so
                      existing selectors/tests still match)
     others         → [data-theme="<attr>"] blocks. */
window.PGRE = window.PGRE || {};

PGRE.THEMES = [
  { id: 'cream',     name: 'Cream and coral',  dark: false, attr: '',
    swatch: { bg: '#f5f0e8', ink: '#141413', accent: '#cc785c' } },
  { id: 'paper',     name: 'Paper and ink',    dark: false, attr: 'paper',
    swatch: { bg: '#f6f6f4', ink: '#1a1a18', accent: '#3f4d63' } },
  { id: 'sage',      name: 'Sage forest',      dark: false, attr: 'sage',
    swatch: { bg: '#eef1e8', ink: '#1d241b', accent: '#4a7043' } },
  { id: 'nordic',    name: 'Nordic slate',     dark: false, attr: 'nordic',
    swatch: { bg: '#eceff2', ink: '#1b2026', accent: '#4a6785' } },
  { id: 'rose',      name: 'Rose dawn',        dark: false, attr: 'rose',
    swatch: { bg: '#f7f0ec', ink: '#251b18', accent: '#a34d5c' } },
  { id: 'warm-dark', name: 'Warm dark',        dark: true,  attr: 'dark',
    swatch: { bg: '#181715', ink: '#faf9f5', accent: '#cc785c' } },
  { id: 'midnight',  name: 'Midnight and gold', dark: true, attr: 'midnight',
    swatch: { bg: '#101627', ink: '#ece8d8', accent: '#d4a017' } },
  { id: 'aurora',    name: 'Aurora night',     dark: true,  attr: 'aurora',
    swatch: { bg: '#0e1f1d', ink: '#e4efe9', accent: '#54c9a2' } }
];
PGRE.THEME_DEFAULT = 'paper';

/* Saved-theme id -> theme entry. Legacy values migrate:
   'light' -> Paper and ink (the student's chosen new default),
   'dark'  -> Warm dark (the same palette it always was).
   Missing/unknown -> the default. */
PGRE.themeEntry = function (id) {
  if (id === 'light') id = 'paper';
  else if (id === 'dark') id = 'warm-dark';
  var list = PGRE.THEMES || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i];
  }
  for (var j = 0; j < list.length; j++) {
    if (list[j].id === PGRE.THEME_DEFAULT) return list[j];
  }
  return { id: PGRE.THEME_DEFAULT, name: 'Paper and ink', dark: false, attr: 'paper' };
};
PGRE.normalizeTheme = function (id) { return PGRE.themeEntry(id).id; };

/* Is the named (or applied) theme dark? Accepts a settings id, or a
   data-theme attribute value ('' means the :root theme). The visuals check
   the applied value so a hand-set data-theme="dark" still counts. */
PGRE.themeIsDark = function (idOrAttr) {
  if (idOrAttr === 'dark') return true;
  var list = PGRE.THEMES || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === idOrAttr || list[i].attr === idOrAttr) return !!list[i].dark;
  }
  return false;
};
