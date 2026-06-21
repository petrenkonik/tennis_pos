# AGENTS.md — Instructions for AI Agents

> This file is the entry point. Read it **in full** before starting any work in the project.

## What this project is

**tennis_pos** is a web prototype of an app for analyzing the tennis serve. A user (a recreational player, level 3.0–4.0) uploads a video of their serve, and the app:

1. Recognizes the pose (pose tracking) via MediaPipe
2. Splits the serve into **phases** by key events
3. Finds **movement errors** via rule-based rules
4. Shows feedback at three depth levels (optionally):
   - **Layer 1** (default): simple, clear per-phase tips
   - **Layer 2**: precise biomechanics metrics (joint angles, toss height)
   - **Layer 3**: comparing the skeleton against a pro reference

The goal of the prototype is to **validate that the CV pipeline can actually split a serve into phases and find errors**, not to ship a polished UI.

## Current status

- 🟢 **Research is done** — see `docs/research/`
- 🟢 **Architecture decisions are locked** — see `docs/decisions/`
- 🟢 **MVP CV pipeline is implemented** in `src/` (end-to-end flow: video → pose → phases → rules → UI, rule C3, bilingual UI)

First the spec is finished in `docs/superpowers/specs/`, then the implementation plan via the `writing-plans` skill, and only then — code.

## 🔒 Locked decisions (do NOT revisit without an explicit user request)

These decisions have already been made jointly with the user. Don't propose alternatives "just because" — if you see a problem, point it out specifically, but don't silently roll a decision back.

| Decision | Value | Rationale |
|---|---|---|
| Target audience | Recreational players 3.0–4.0 | The biggest market; feedback must be anatomy-free |
| Prototype platform | Web (in the browser) | Fast iteration on algorithms without the pain of mobile integration |
| CV stack | MediaPipe JS / TF.js (fully on-device) | Zero server infrastructure; closer to the final mobile UX |
| Video source | Video-file upload | Easier to control conditions; no real-time constraints |
| Analysis approach | **Rule-based phase analysis** (Approach A) | Deterministic, explainable, fully in the browser, no dataset |
| Analysis depth | 3 optional layers | Don't scare a beginner, give depth to the advanced user |
| LLM explanations | **Deferred (future-work)** | A good candidate, but not for the prototype |
| Language | **English docs + bilingual (en/ru) UI** | All docs and code comments in English; the UI is bilingual via `react-i18next` with browser auto-detect + a manual EN/РУ toggle |

Details: `docs/decisions/`.

## Project structure

```
tennis_pos/
├── AGENTS.md                  ← you are here
├── README.md                  ← overview for humans
├── docs/
│   ├── research/              ← market and technology research
│   ├── biomechanics/          ← domain: serve phases, metrics
│   ├── decisions/             ← ADR — architecture decisions
│   ├── task-rules.md          ← task workflow rules (MUST read)
│   └── superpowers/specs/     ← specifications (design docs)
├── skills/                    ← domain skills (subject-matter knowledge)
│   ├── tennis-serve-phases/
│   ├── cv-pose-estimation/
│   └── serve-error-detection/
└── src/                       ← code (MVP CV pipeline + bilingual UI)
    ├── i18n/                  ← react-i18next setup + locale catalogs (en/ru)
    ├── pipeline/, rules/, pose/, constants/, ui/
```

## 🧠 Subject-matter knowledge — READ before working on algorithms

Any task involving phases, poses, metrics, or errors needs context. These skills are compressed domain expertise. Read the relevant one **before** implementing:

| Skill | When to read |
|---|---|
| `skills/tennis-serve-phases/SKILL.md` | Work on splitting a serve into phases, detecting key events (release, trophy, contact, follow-through) |
| `skills/cv-pose-estimation/SKILL.md` | Work with MediaPipe Pose: the 33 landmark indices, joint-angle calculation, trajectory smoothing |
| `skills/serve-error-detection/SKILL.md` | Implementing rule-based error rules, thresholds, advice wording for a recreational user |

Detailed biomechanics reference: `docs/biomechanics/serve-phases.md`.

## 📋 Task workflow rules

**Read `docs/task-rules.md` in full before starting any task.** Quick summary:

1. **Spec first, then code.** Any feature goes design doc → plan → implementation.
2. **No code in the spec.** A spec describes what and why, not how.
3. **TDD for the algorithmic core.** Phase detection and error finding are pure functions — cover them with tests first.
4. **Everything in the browser.** No server calls, API keys, or backend. If a task needs a server — stop and ask.
5. **Explainability over accuracy.** A rule you can explain is better than a black box.
6. **Document thresholds.** Any magic threshold (15° angle, timestamp) must be a named constant with a source comment.
7. **Language policy.** All docs and code comments are in **English**. The UI is **bilingual (en/ru)** via `react-i18next` — every user-facing string lives in `src/i18n/locales/{en,ru}.json`. Default locale is auto-detected from `navigator.language` (`ru*` → RU, otherwise EN); a manual EN/РУ toggle overrides it, persisted in `localStorage`. When adding a rule: its `title`, `metric.name`, and `advice` must be **i18n keys** (never display strings) and must be added to both locale files.

## Environment

- **OS:** Windows (win32)
- **Shell:** `cmd.exe`
- **Git:** initialized, on branch `master`. Don't run `git init`.
- **Working directory:** `E:\work\startups\tennis_pos`

## Checklist before starting a task

- [ ] Read `AGENTS.md` (this file)
- [ ] Read `docs/task-rules.md`
- [ ] Read the relevant skill from `skills/`
- [ ] There is a spec or task in `docs/superpowers/specs/` (or the task is small and obviously trivial)
- [ ] It's clear which analysis layer (1/2/3) is affected
