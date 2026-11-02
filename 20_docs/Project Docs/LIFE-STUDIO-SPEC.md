# Life Studio - confirmed spec

The student confirmed these answers in the Life Studio interview on 2026-11-02. The interview page is `/Users/Reid Hu/firstmate/.lavish/life-studio-interview.html`. The Physics GRE exam was on 2026-11-01. From now on this app is the Life Studio: a private studio for knowledge the student wants to remember. Physics is one subject inside it.

## Confirmed answers

| Topic | Answer |
|---|---|
| Content | Physics formulas and concepts; English usage, grammar and vocabulary; research knowledge (nuclear physics, detectors, machine learning); mathematics and methods |
| Privacy | Private, on the student's Mac only |
| Structure | Option A: the same app grows into the Life Studio, and physics becomes one subject. The existing data stays in place. |
| Name | Life Studio |
| Folder and repository | Rename both, with a data migration, in phase 2 (see below) |
| Exam countdown, 8-week runway, study plan | Hidden: kept, and reachable from a menu |
| Practice questions, timed packs, mock exams | Moved under the Physics subject |
| Mistake book and answer history | Moved under the Physics subject |
| Nine topic portals | Moved under the Physics subject |
| Concept visualizers and Formula Lab | Moved under the Physics subject |
| Achievements, XP, streaks | Visible across the whole studio |
| Focus timer and study time | Visible across the whole studio |
| New subjects | English usage and grammar (first), Vocabulary, Nuclear physics, Basic Computer Science |
| Existing 294 cards | All kept; their review history continues |
| Daily queue | One mixed daily queue for all subjects, with a filter to study one subject |
| Scheduler | SM-2 with Again / Hard / Good / Easy (unchanged) |
| Daily limits | 10 new cards per day; no minute limit |
| Adding cards | (1) The student asks firstmate in chat (the existing inspect-first procedure). (2) A simple card editor inside the studio. |
| Themes | Six themes ship: Cream and coral, Warm dark, Paper and ink, Sage forest, Nordic slate, Midnight and gold. The student also asked for "more interesting themes". |
| Default theme | Paper and ink |
| Theme picker | A picker in Settings that remembers the student's choice |
| Where it runs | The same Mac, opened as a file:// page, as today |
| Phone | No phone access for now |
| Unpublished local edits | Publish them through a pull request before the cloud work starts |
| Cloud session | Starts as soon as this spec and the plan exist |

### Decisions confirmed on 2026-11-02, after the interview

| Topic | Decision |
|---|---|
| Phase 0 pull request | Approved |
| New names | Folder `/Users/Reid Hu/Life Studio`; repository `Edfghdrtxxx/Life-Studio`. Applied in phase 2, after the phase 1 pull request merges, not before. |
| Phone sync | Phase 3, later |

### The student's note on synchronization (a later phase, not built now)

The student's words: "I intend to realize synchronization features for me. For example, I can see my progress in both my Mac and iPhone. I can take a look anytime I want. But I don't know how to realize the progress synchronization and data synchronization."

For now the student chose a Mac-only studio and no phone access. Syncing between the Mac and the iPhone is therefore phase 3, a separate design decision for the student. That phase must respect two constraints:

- The book-derived and ETS-derived cards must never be published (AGENTS.md "ETS copyright").
- The studio was founded on a no-network rule.

## Implementation plan

Rule for every phase: reach the goal with the least change.

### Phase 0 - local, on the Mac, before the cloud work

1. Publish the 5 edited files through a pull request to `main` of https://github.com/Edfghdrtxxx/Physics-GRE-Practice. The edited files are `index.html`, `js/card-diagrams.js`, `js/data-formulas.js`, `tools/test-card-diagrams.js` and `tools/test-public-formulas.js`. Commit this spec in the same pull request.
2. Export the student's progress with Library -> Export progress, and keep the JSON file outside the repository.

### Phase 1 - cloud session (code only; one pull request)

The cloud session cannot read `content/bank/` (gitignored), the student's progress in localStorage, or OrbitOS. Its work therefore stays inside tracked code and tests.

1. **Subjects.** Add a small subject registry: Physics, English usage and grammar, Vocabulary, Nuclear physics, Basic Computer Science.
   - Every existing card belongs to Physics, derived from its id prefix (`cpgf-`, `cpgl-`, `supp-`), so no card id changes and no SRS state changes.
   - The new subjects start empty.
2. **Navigation.** The sidebar puts the studio-wide pages first: Today, Recall, Achievements, Focus, Study time. A Physics group holds practice, packs, mock exams, the mistake book and answer history, the nine portals, the visualizers and the Formula Lab. The countdown, runway and study plan move behind a menu entry, and the countdown is hidden from the dashboard. App titles read "Life Studio".
3. **Daily queue.** Build one mixed due queue across subjects, with a subject filter and a setting for new cards per day (default 10). SM-2 stays unchanged. Existing schedules and streaks continue without any reset.
4. **Card editor.** Build a simple in-app form with these fields: subject, front, back, optional note. It creates, edits and deletes the student's own cards. Those cards are stored in the progress state with ids `user-<subject>-<n>` that never change. Deletions go through `store.tombstone`, following the "Cross-tab persistence" rule in AGENTS.md. KaTeX renders `$...$`. User cards follow the "Recall card wording" rules.
5. **Themes.**
   - Turn the existing `data-theme` layer (`PGRE.setTheme`, `js/app.js`) into named themes: the six confirmed themes plus two or three more distinctive ones, all meeting 4.5:1 text contrast.
   - Add a Settings picker with live previews. The choice is saved in `state.settings.theme`.
   - Paper and ink is the default for a missing setting. A one-time migration switches a saved `light` value to Paper and ink, as the student chose. A saved `dark` value keeps Warm dark.
   - Visualizers, card diagrams and the concept door already read `data-theme`. Keep them readable under every theme.
6. **Storage key.** Keep `pgre-state-v1` and every existing localStorage key unchanged, so no data migration is needed for phase 1.
7. **Tests and documentation.**
   - Run every existing `tools/test-*.js` suite that can run without `content/bank/`, and add tests for the subject assignment, the queue filter and new-card cap, the editor's persistence, and the theme migration.
   - Attach screenshots of each theme and of the new navigation to the pull request.
   - Update `README.md` and `AGENTS.md` where the structure changed.

### Phase 2 - local, on the Mac, after the phase 1 pull request merges (the student approves the merge)

1. Back up the progress again by export.
2. Rename the folder `/Users/Reid Hu/Physics GRE` to `/Users/Reid Hu/Life Studio`, and rename the GitHub repository to `Edfghdrtxxx/Life-Studio` with `gh repo rename Life-Studio`.
3. Open the studio from the new file:// path. Check that the cards, schedules and streaks appear; if they do not, restore them from the export.
4. Update every reference to the old path:
   - the firstmate project registry (`data/projects.md`) and its link `projects/physics-gre`;
   - the firstmate skills `studio-card-procedures` and `orbitos-session-rules`, and the studio entries in `data/captain.md`;
   - the OrbitOS skills `practice-physics-gre-set`, `physics-gre-miss-drill`, `learn`, `start-my-day`, `end-my-day` and `handoff-prompt`;
   - the status bridge `99_System/Services/pgre-status-bridge/bridge.py`;
   - the git remotes (`origin`, `no-mistakes`).

### Phase 3 - later, on the student's decision

Design synchronization between the Mac and the iPhone (see the note above).
