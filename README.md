# Life Studio

A personal, fully-local study studio — Physics GRE prep is the first subject.
No accounts, no network calls: progress lives in your browser (localStorage + IndexedDB),
libraries are vendored, and the whole thing is plain HTML/CSS/JS with no build step.

## Run it

```bash
cd "/Users/Reid Hu/Life Studio"
python3 -m http.server 8000
```

Then open **http://localhost:8000**.

(Double-clicking `index.html` mostly works too, but some browsers restrict IndexedDB
on `file://` pages — the local server is the reliable way.)

## What's inside

| Page | What it does |
|---|---|
| **Today** | The daily surface: greeting, one Next up launcher (mixed practice) and three tiles (mistake book, recall review, next mock); this week's plan tasks with a Start button; a collapsed Progress panel (level, XP, streak, stat tiles, daily challenges, question of the day, readiness, achievements); study time beside recent activity; topic portals |
| **Knowledge portals** (×9) | One per exam topic with official weights (CM 20% … LM 6%): mastery/accuracy stats, subtopic map, practice launcher, and a Notes section that renders imported book chapters (markdown + KaTeX, offline) |
| **Practice** | GRE-style 5-choice questions with instant feedback, worked solutions, and XP — all math written in LaTeX and typeset offline by KaTeX. Mixed pool of ~366 questions: 20 preview + 146 *Conquering the Physics GRE* chapter problems + 200 drills from the two oldest released ETS forms (GR8677/GR9277) |
| **History** | Every answer ever given, kept for good: question, your pick vs. the correct one, time taken, and its session. Session list + filterable attempt log |
| **Mistake book** | Every missed question with your wrong pick beside the solution. Re-drillable anytime; resurfaced on a spaced-repetition ladder (1→3→7→14→30→60 days). Solving never removes an entry — only your manual Archive does. Entries list collapsed under Due now and Coming up, 20 at a time |
| **Formula recall** | Flip cards: recall, flip, self-grade Again/Hard/Good/Easy → SM-2 intervals and a daily due queue. One mixed daily queue across subjects — a Subject filter narrows which cards Study serves, and new introductions cap at the "New cards per day" setting. The student's own cards (any subject) live on the Cards tab: create, edit, delete with a live KaTeX preview. Match/Type/Cloze/Quiz drills, the daily check-in, and interval settings sit behind Options; agent learning status export in-progress and at checkout |
| **Study plan** | Sep 14 → Nov 1 · 7 live weeks · ~16 h/wk · generated from the vault syllabus via tools/build-plan.js · each timed set has a Start button and is ticked automatically when finished · the exam countdown and prep runway live here (moved off the dashboard) |
| **Achievements** | 80 achievements across 10 categories, 7 secret |
| **Library** | Import the *Conquering the Physics GRE* markdown (drag & drop), map its sections to topics, export/restore/reset all progress, Back up now to versioned disk snapshots, restore a leftover browser safety copy |
| **Mock exam** | Timed simulator: weighted 70-question/120-minute draw, or verbatim replay of the 5 released ETS exams (incl. the 70-question 2024 form) and the book's 3 sample exams. Official scale tables where published |
| **Focus timer** | Pomodoro-style focus sessions with ambient sound, session log, and per-day study-time totals |
| **Concept visualization** | Interactive teaching widgets (11 trio visualizer files + spherical harmonics) under `#/concepts`, plus a Formula Lab |
| **Analytics & tools** | Study-time page, per-topic analytics, custom quiz builder, global search, notes & bookmarks |
| **Settings** | Named themes — eight palettes (Cream and coral, Paper and ink, Sage forest, Nordic slate, Rose dawn, Warm dark, Midnight and gold, Aurora night) applied instantly; the sidebar theme button stays a light/dark quick flip |

## Content

The question bank is already in: `content/bank/` (gitignored, generated) holds the
146 chapter problems, 3 sample exams, 214 book-derived recall cards (154 formula
cards + 60 recall cards, hand-curated since 2026-10-14; the deck adds 80 supplemental
cards from `js/data-formulas.js`), and the released ETS
exams. `js/bank.js` merges the practice pool; intact exams stay out of it so they
remain fresh for simulation.

The **Library** page still imports the *Conquering the Physics GRE* markdown
(drag & drop, stored in IndexedDB) — its chapters render in each portal's Notes
card once sections are mapped to topics.

## Where things live

```
index.html          app shell (hash-routed SPA)
css/                stylesheets (named themes in style.css, life-studio.css,
                    fonts, visualizer, print)
js/                 app logic: stores/engines (store, srs, gamify, bank, exam-engine,
                    plan-engine, timer, subjects, user-cards), seed data (data-*.js,
                    data-themes.js), views (view-*.js), router (app.js),
                    teaching widgets (visualizers/)
simulations/        standalone interactive physics visualizers (oscillator.html)
tools/              offline build scripts, extraction pipelines, test runners
content/            question banks, book/ETS figures, raw question sources
20_docs/            project specs (Project Docs/), reference PDFs (ETS, Kahn)
99_System/          meta documents and cross-agent handoffs
fonts/              locally hosted web fonts
vendor/             marked + KaTeX (offline)
```

Backup: **Library → Export progress** writes a JSON snapshot you can restore anytime.
