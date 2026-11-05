# Session links: Recall cards → OrbitOS learning sessions

How to add, or re-check, the links from Recall flashcards to the learner's
learning-session notes in Obsidian. Written for an agent with no other context.
Run every command from the Studio repo root.

## 1. The feature

A Recall card (one entry of `PGRE.formulaDeck()`) that a learning session works
through shows a quiet line under its action buttons:

`SESSIONS  [note icon] <session title>  [note icon] <session title>`

Each link opens the session note in Obsidian. A card with no session shows
nothing. Clicking a link never flips, grades, or reschedules the card, and
writes nothing to saved progress.

- Shown on: Study (front and back), the session peek, the scaffold after Again,
  browse and picker previews, Search, Type, Quiz, Cloze. These are the surfaces
  that render the similar-problem control.
- Not shown on: Match tiles (both halves of a pair would carry the same label
  and give the pairing away), mock-exam questions, mistake-book questions.
- Code: `PGRE.sessionLinksHTML(card)` and `PGRE.wireSessionLinks(root)` in
  `js/bank.js`; called through `similarButton` / `wireSimilar` in
  `js/view-formulas.js` and `similarProblemButton` / `wireSimilar` in
  `js/flashmodes.js`; styles under `.session-links` in `css/style.css`.

## 2. The data file

`js/data-session-links.js` is the only place a link is stored. It is hand-edited;
no generator writes it, and new sessions are not linked automatically.

```js
PGRE.SESSION_VAULT = 'OrbitOS';             // Obsidian vault name (folder /Users/Reid Hu/OrbitOS)
var bernoulli = CM + '2026-09-10-1522 Bernoulli equation.md';   // one var per note
PGRE.SESSION_LINKS = {
  'cpgf-1.51': [continuity, bernoulli],     // card id -> note paths, oldest first
  ...
};
PGRE.SESSION_LABELS[normalE] = 'Boundary condition on normal $E$';  // optional
```

- Keys are card ids. Values are note paths relative to the vault root, with
  `.md`, for example `60_Learning_Progress/Electrodynamics/2026-09-15-0916 Boundary condition on normal E.md`.
  The folder constants `CM`, `ED`, `QM`, `NP`, `MM` hold the folder prefixes.
- The file holds ids and paths only, never card text: the book cards are
  copyrighted and gitignored, this file is committed to a public repo.
- The link label is the file name without the `YYYY-MM-DD-HHMM ` stamp. When
  the file name writes a symbol as a plain letter (`E`, `D`, `rho`, `3-2`), add
  a LaTeX label to `PGRE.SESSION_LABELS` (project rule: all math is LaTeX).
- The link is `obsidian://open?vault=OrbitOS&file=<URL-encoded path without .md>`
  (format: https://obsidian.md/help/Extending+Obsidian/Obsidian+URI).
- After any edit, bump `js/data-session-links.js?v=` in `index.html`.

## 3. Where the sessions and the cards live

| What | Where |
|---|---|
| Session notes | `/Users/Reid Hu/OrbitOS/60_Learning_Progress/` subfolders `Classical Mechanics`, `Electrodynamics`, `Quantum Mechanics`, `Nuclear Physics`, `Mathematical Methods`. Only these five count; `English Learning`, `Vocabulary`, `Archives` and the `assets/` folders never do. Read-only: never edit the vault. |
| Book formula cards `cpgf-*` | `content/bank/cpg-formulas.js` (`PGRE.BOOK_FORMULAS`) |
| Book list cards `cpgl-*` | `content/bank/cpg-lists.js` (`PGRE.BOOK_LISTS`) |
| Supplementary cards `supp-*` | `js/data-formulas.js` (`PGRE.FORMULAS`) |

`content/bank/` is gitignored, so a worktree does not have it. Read it from the
learner's live checkout `/Users/Reid Hu/Life Studio/content/bank/`, read-only.
Never write to `/Users/Reid Hu/Life Studio`, and never commit `content/bank/`.

A learning session often creates a `supp-*` card in the live checkout's
`js/data-formulas.js` before that card is committed. Link a `supp-*` card only
once it is on `main` (or in the same PR); until then the session counts as new
in step 2 of section 5 and waits for the next pass.

Card ids are stable; SRS progress is keyed by them. A session may name an id
that the 2026-10-14 deck cut removed or merged; look the id up in
`99_System/Handoff documents/recall-deck-curation-2026-10-14/README.md` and
link the card it was merged into, if that card still holds the content.

## 4. The matching rule

Link a card to a session only when the session works through the card's
content: it teaches, derives, or practises what the card asks the learner to
recall. Precision beats recall; a wrong link is worse than a missing one.

- Not a match: a passing mention; the card's formula used only as a tool for
  another result; a topic queued, deferred, or listed as prior knowledge; a
  related but different formula.
- Partial match: the session works through one main part of the card over
  several turns (for example the centrifugal half of a Coriolis-and-centrifugal
  card). Link it, and mark it "Partial" in the review table.
- A session that names a card id (`cpgf-1.38`, `supp-newton-momentum`) is a
  strong hint, not proof: check that the card is what the session works on.
- One session may link to several cards; one card may link to several sessions.

## 5. Procedure: link new sessions

1. Branch off `main` in your worktree.
2. List the physics notes that have no link:

   ```sh
   node -e '
   const fs = require("fs"), path = require("path"), vm = require("vm");
   const ctx = { window: {} }; ctx.PGRE = ctx.window.PGRE = {}; vm.createContext(ctx);
   vm.runInContext(fs.readFileSync("js/data-session-links.js", "utf8"), ctx);
   const linked = new Set([].concat(...Object.values(ctx.PGRE.SESSION_LINKS)));
   const vault = "/Users/Reid Hu/OrbitOS";
   for (const d of ["Classical Mechanics", "Electrodynamics", "Quantum Mechanics", "Nuclear Physics", "Mathematical Methods"])
     for (const f of fs.readdirSync(path.join(vault, "60_Learning_Progress", d)).filter(f => f.endsWith(".md")).sort()) {
       const p = "60_Learning_Progress/" + d + "/" + f;
       if (!linked.has(p)) console.log(p);
     }'
   ```

   Remove the notes in section 7 (already checked, no card matches). What
   remains is new.
3. Dump the live deck to a scratch file outside the repo (it contains book text):

   ```sh
   node -e '
   const fs = require("fs"), vm = require("vm");
   const ctx = { window: {} }; ctx.PGRE = ctx.window.PGRE = {}; vm.createContext(ctx);
   const live = "/Users/Reid Hu/Life Studio/";
   for (const f of ["content/bank/cpg-formulas.js", "js/data-formulas.js", "content/bank/cpg-lists.js"])
     vm.runInContext(fs.readFileSync(live + f, "utf8"), ctx);
   const P = ctx.PGRE, out = [];
   for (const c of [].concat(P.BOOK_FORMULAS || [], P.FORMULAS || [], P.BOOK_LISTS || []))
     out.push("### " + c.id + " [" + c.topic + "] " + (c.tag || "") + (c.name ? " — " + c.name : "") +
       "\nFRONT: " + c.front + "\nBACK: " + String(c.back).replace(/<[^>]+>/g, " ") + "\n");
   fs.writeFileSync(process.argv[1], out.join("\n"));
   console.log(out.length + " cards");' /path/to/scratch/cards.txt
   ```

4. For each new note: `grep -oE "cpg[fl]-[0-9]+\.[0-9]+[a-z]?|supp-[a-z0-9-]+"` for
   named ids, then read the whole note and search the card dump for its topic.
   Apply section 4. For many notes, read them in parallel with subagents, then
   check every proposed match yourself against the note text.
5. Edit `js/data-session-links.js`: add one `var` per new note, add its path to
   each matched card's array (keys grouped by subject, sorted by id; paths
   oldest first), add a `SESSION_LABELS` entry if the file name needs LaTeX.
   Confirm each new key is a card id in the dump from step 3 and, for `supp-*`,
   in this branch's `js/data-formulas.js`. Add notes that match no card to
   section 7 of this document.
6. Bump the `?v=` token of `js/data-session-links.js` in `index.html`.
7. Run the test (section 6).
8. Open a PR. Its description carries a review table, one row per new link:
   card id | card title | session file | one-line reason (and "Partial" where it
   applies), plus the test output.

To re-check old links, read each note listed in `PGRE.SESSION_LINKS` against
its cards with the same rule, and remove a path that fails it.

## 6. Test

```sh
node tools/test-session-links-chrome.js
```

Needs `chrome-devtools-axi`. It runs the real page in an isolated Chrome profile
on a throwaway port and blocks the status bridge on port 4789, so it never
touches the learner's file:// Studio or saved progress. It checks:

- the data: every key starts `cpgf-`, `cpgl-` or `supp-` (it does not check
  that the card exists; that is your job in step 5); every path is a dated note
  in one of the five physics folders; every note exists in the local vault
  (skipped when the vault is absent); every LaTeX label belongs to a linked
  note; the href format;
- Study front and back of a linked card: the link, its href and label, its
  place under the action buttons; click, Enter and Space do not flip, grade, or
  change SRS records, the review log, or the Study session, in memory or in
  localStorage;
- a card with two sessions (typeset LaTeX labels), dark theme, an unlinked card
  (no line), Search, Match (no links), and a 420 px window (no overflow).

`PGRE_SESSION_LINKS_SHOTS=<dir>` also saves one screenshot per stage. To see
book cards in the screenshots, copy the live `content/bank/*.js` into the
worktree's gitignored `content/bank/` and delete the copy afterwards.

## 7. Notes checked with no matching card

Checked on 2026-10-22; leave them out unless a new card covers them.

- `Classical Mechanics/2026-09-14-1657 Tangential acceleration on a curve.md`
- `Electrodynamics/2026-09-14-0828 Capacitance.md`
- `Electrodynamics/2026-09-21-0933 AC maximum power transfer.md`
- `Electrodynamics/2026-09-21-1447 Volume integral of rho from div E.md`
- `Quantum Mechanics/2026-07-26-2030 Displacement operator.md`
- `Quantum Mechanics/2026-07-27-1331 Position representation.md`
- `Nuclear Physics/2026-09-28-1604 Velocity filters.md`

## 8. Never

- Never change a card's text, id, or schedule to make a link fit.
- Never write to saved progress (`localStorage['pgre-state-v1']` on any origin)
  or open the learner's file:// Studio in an automated browser.
- Never edit the OrbitOS vault or the live checkout `/Users/Reid Hu/Life Studio`.
- Never commit `content/bank/` or card text.
