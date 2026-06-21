# Task Workflow Rules

> These rules apply to **every** task in the project. Read this file first, then start work.

## 1. Principle: specification → plan → code

Every non-trivial task goes through three phases:

1. **Specification** — what we are building and why. Lives in `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`. Describes behavior, interfaces, success metrics. **No code.**
2. **Plan** — how we build it, step by step. Created via the `writing-plans` skill.
3. **Implementation** — the code itself, following the plan.

### What counts as "trivial" and needs no spec

- A typo in a comment/doc
- Renaming a variable
- Adding a missing import
- Formatting

Everything else goes through a spec. When in doubt, assume one is needed.

## 2. Design document (spec)

### Spec structure

```markdown
# <Feature name>

## Context
Why this matters. Link to parent spec / problem.

## Goals / Non-goals
- Goal: ...
- Non-goal: ...

## Architecture
How it is structured. Diagram or data-flow sketch.

## Interfaces
Inputs/outputs of key functions (signatures, types).

## Success metrics
How we will know it works. Concrete and measurable.

## Risks / open questions
What could go wrong.
```

### Rules

- **No implementation code.** Function signatures and data-structure examples are fine; bodies are not.
- **Every decision is justified.** "We do X because Y."
- **Alternatives are mentioned.** If there were several options, briefly state why this one was chosen.
- **Success metrics are concrete.** Not "works well" but "detects the trophy position within ±2 frames of the labeled one on a test set of ≥5 serves".

## 3. TDD for the algorithmic core

Phase detection, angle calculation, error finding — these are **pure functions** of pose data. Cover them with tests:

1. Write a test for a specific case (e.g. "a trajectory with a ball-height peak on frame N → contact detected on frame N")
2. Write the minimal implementation
3. Refactor

### Test data

- Put test videos / poses in `src/__tests__/fixtures/` (or similar)
- For unit tests use **synthetic pose data** (generate a keypoint array with a known phase), not real videos — this gives determinism
- Real videos — only for integration / manual checks

## 4. Everything in the browser

Principle: **zero server infrastructure in the prototype.**

- ❌ No API calls to external services (loading MediaPipe model weights from a CDN is allowed)
- ❌ No backend, databases, auth
- ❌ No secrets / API keys in code
- ✅ All processing — in the browser via MediaPipe / TF.js

**If a task needs a server — stop and ask the user.** That violates a locked decision.

## 5. Explainability over accuracy

We are building a **rule-based** system (see `docs/decisions/0002-rule-based-approach.md`). This is a deliberate choice. Rules:

- Every error rule must be **explainable** — a recreational user must understand "why this is an error" without anatomy.
- If a rule produces many false positives and cannot be explained simply, revise the rule rather than adding ML.
- **Avoid black boxes** in the prototype. ML classifiers and LLMs are explicitly deferred future-work.

## 6. Document thresholds and magic numbers

Any numeric threshold (angle, timestamp, distance) must be:

- A **named constant**, not a magic literal in code
- Annotated with a **source comment**: where the value comes from (paper, empirically, coach estimate)

```typescript
// Good
// Chow et al. (2012): trophy position typically reaches knee flexion 20-35°
// among intermediate players. Tolerance zone covers observed range.
const TROPHY_KNEE_FLEXION_MIN_DEG = 20;
const TROPHY_KNEE_FLEXION_MAX_DEG = 35;

// Bad
if (angle < 25) { ... }  // where does 25 come from?
```

Collect thresholds in one place — `src/constants/biomechanics.ts` (or similar).

## 7. Commit structure

Format: `<type>: <description>`

- `feat:` new feature
- `fix:` bugfix
- `docs:` documentation only
- `test:` tests only
- `refactor:` refactor with no behavior change
- `chore:` build, deps, config

Example: `feat(phases): detect trophy position from knee flexion peak`

## 8. Language policy

- All documentation and code comments are written in **English**.
- The app UI is **bilingual (en/ru)** via `react-i18next`. Every user-facing string lives in `src/i18n/locales/{en,ru}.json` — no inline literals in components.
- Default locale is auto-detected from `navigator.language` (anything `ru*` → RU, otherwise EN); a manual EN/РУ toggle overrides it, persisted in `localStorage`.
- When adding a rule: its `title`, `metric.name`, and `advice` must be **i18n keys**, never display strings. Add the keys to both locale files.

## 9. Analysis layers — always state which

Any analysis task must explicitly state which **depth layer** it touches:

- **Layer 1 — Simple advice** (default for everyone). Plain text, no jargon.
- **Layer 2 — Precise metrics.** Angles in degrees, heights in cm, deviations from a reference.
- **Layer 3 — Comparison with a reference.** Overlaid user skeleton vs. a pro player.

A feature may cover several layers, but that must be explicit in the spec.

## 10. Checklist before finishing a task

- [ ] Spec written and approved (if required)
- [ ] Tests written for algorithmic code
- [ ] No server calls / API keys / secrets
- [ ] Magic numbers moved to named constants with a source
- [ ] Affected analysis layer stated in the spec/commit
- [ ] Documentation (`docs/`) updated if behavior changed
- [ ] Skills (`skills/`) updated if the domain model changed
