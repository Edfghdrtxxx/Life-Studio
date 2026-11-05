# PR 131 evidence — Wiki section: MATE research

Real-page checks run in headless Chrome (`--headless=new`, isolated temp
profile, `file://` origin, `--allow-file-access-from-files` for iframe DOM
asserts). The 4789 status bridge was blocked before page load and answered
0 requests (1 blocked request seen).

| Check | Result |
|---|---|
| `#/wiki/mate` mounts `.wiki-iframe`; explainer title + h1 visible | PASS |
| `#/wiki/mate/src-122` scrolls iframe to `id="src-122"` (bounding top 0px) | PASS |
| `data-nav-group="wiki"` section, label "Wiki", between Subjects and Studio | PASS |
| `a[data-nav="wiki-mate"]` → `#/wiki/mate`, `.active`, `aria-current="page"` | PASS |
| Breadcrumbs: Home ▸ Wiki ▸ MATE research | PASS |
| `Runtime.exceptionThrown` / console errors | 0 |

`node tools/test-wiki.js`: 18/18. `node tools/test-file-structure.js`: PASS.
`node tools/check-theme-contrast.js`: all gated checks pass (two pre-existing
reference-palette notes on cream/warm-dark `--on-accent`).

## Screenshots

- `wiki-cream.png` — `#/wiki/mate` at page top in the default Cream and coral
  theme; sidebar shows the WIKI group with the MATE research row highlighted.
- `wiki-dark.png` — same page in Warm dark; shell is dark, the framed
  explainer keeps its own light styling.
