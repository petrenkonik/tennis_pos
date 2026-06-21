# Adding a serve-error rule

Step-by-step guide for adding a new rule-based error check to the pipeline.
Every section maps to a concrete file and shows what to change, using the
existing rule **C3 (insufficient knee bend)** as the reference implementation.

> Read this **together with** `skills/serve-error-detection/SKILL.md` — it has
> the domain rules, threshold sources, and the full catalogue of candidate
> rules (T1–T3, TO1–TO2, C1–C3, F1–F2). This guide is the *engineering* part:
> where each piece of a rule lives in the code and how they connect.

---

## How a rule works (the 30-second model)

A rule is a pure function: `PhaseContext → RuleResult`. It does **no** pose
tracking, no DOM, no i18n lookup — it reads a precomputed metric and returns a
verdict (`ok | warn | error | unknown`), the measured value, and i18n *keys*
(not strings) for the UI.

```
video → poses → phases → buildPhaseContext() → metrics ─┐
                                                         ▼
                                            rule.evaluate(ctx) → RuleResult
                                                         │
                  RulesReport (UI) ←─ runRulesReport() ──┘
                  SkeletonOverlay ← landmarks + status (for highlighting)
```

The pipeline runs every registered rule and feeds the results to the UI:
- `RuleResult` → the cards in the **Rules report** grid
- `landmarks + status` → colored bone highlighting on the **skeleton overlay**
- `Finding` (derived from `evaluate`) → the **Advice list** (problems only)

---

## The 7 touch points

Adding a rule touches these files, in order. Each is detailed below.

| # | File | What you add |
|---|------|--------------|
| 1 | `docs/biomechanics/serve-phases.md` | the metric + its normal range (domain) |
| 2 | `src/constants/biomechanics.ts` | the range + error margin as named constants |
| 3 | `src/pose/metrics.ts` | the metric's geometry (if it doesn't exist yet) |
| 4 | `src/types.ts` | add the metric to `PhaseContext['metrics']` |
| 5 | `src/pipeline/buildPhaseContext.ts` | compute the metric, put it in `ctx.metrics` |
| 6 | `src/rules/ruleXX.ts` (+ `.test.ts`) | the rule itself + unit tests |
| 7 | `src/pipeline/analyzeServe.ts` | register the rule in the two rule arrays |
| 8 | `src/i18n/locales/{en,ru}.json` | the rule's `title`, `metricName`, `advice` |

---

## Step 1 — Define the metric and its normal range

This is a **domain** decision, not an engineering one. Pick the rule from
`skills/serve-error-detection/SKILL.md` (the catalogue) and record:

- **What** it measures (e.g. "knee joint angle at trophy")
- **The convention** (e.g. "180° = straight, smaller = more bent") —
  writing this down prevents the `180 - x` flip bugs later
- **The normal range** for a recreational player (3.0–4.0)
- **The source** of the range (paper, coaching manual, or "provisional,
  pending calibration")

Example (`docs/biomechanics/serve-phases.md` style):

> Knee flexion at trophy: typically 20–35° flexion (≈ 145–160° joint angle)
> for intermediate players. Source: Chow et al. (2012). Lower bound widened
> for amateur variability; provisional pending calibration on real serves.

---

## Step 2 — Pin the thresholds as named constants

`src/constants/biomechanics.ts` — **every threshold is a named constant with a
source comment** (task-rules §6). No magic numbers in rule logic.

```ts
// Knee JOINT angle at trophy (hip-knee-ankle); 180° = straight, smaller = more bend.
// Named JOINT_ANGLE (not FLEXION) on purpose: a flexion angle uses the opposite
// convention (0° = straight, larger = more bend). The serve-error-detection
// skill describes the same physical range as flexion 20-35°, i.e. joint angle
// ~145-160°. Keeping the name aligned with the stored convention avoids the
// `180 - x` flip the old KNEE_FLEXION_* name implied.
// Chow et al. (2012): intermediate players ~20-35° knee flexion ≈ ~145-160° joint angle.
// Lower bound widened for amateur variability; values are provisional pending
// next-phase calibration on real serves.
export const KNEE_JOINT_ANGLE_NORMAL_RANGE_DEG: [number, number] = [140, 160];

// Angle this many degrees above the normal upper bound => "barely bent" => error (vs warn).
export const KNEE_JOINT_ANGLE_ERROR_MARGIN_DEG = 10;
```

For your rule, add the matching constants: a `[number, number]` normal range
and, if you want a three-tier verdict (ok / warn / error), an error margin.

---

## Step 3 — Compute the metric's geometry (if new)

`src/pose/metrics.ts` — the pure geometry helpers. Rules never call
`jointAngle` / coordinate math directly; they read a metric from
`ctx.metrics`. This keeps rules testable with a plain object.

```ts
import type { PoseFrame, Handedness } from '../types';
import { jointAngle } from './geometry';
import { LM, racketWrist, racketElbow, racketShoulder } from './landmarks';

// Smaller angle = more bend (180° = straight). Take the more-bent leg.
export function kneeFlexion(f: PoseFrame): number {
  const left  = jointAngle(f.landmarks[LM.L_HIP],  f.landmarks[LM.L_KNEE],  f.landmarks[LM.L_ANKLE]);
  const right = jointAngle(f.landmarks[LM.R_HIP],  f.landmarks[LM.R_KNEE],  f.landmarks[LM.R_ANKLE]);
  return Math.min(left, right);
}

// 180° = fully extended racket arm.
export function elbowExtension(f: PoseFrame, h: Handedness): number {
  return jointAngle(racketShoulder(f, h), racketElbow(f, h), racketWrist(f, h));
}
```

Existing helpers you can reuse:
- `jointAngle(a, b, c)` in `src/pose/geometry.ts` — the angle at vertex `b`
- `racketWrist / racketElbow / racketShoulder / tossWrist` in
  `src/pose/landmarks.ts` — handedness-aware landmark getters
- `LM` enum in `src/pose/landmarks.ts` — **always** use `LM.L_KNEE`, never
  the raw index `25` (a renumbering of a landmark then flows through)

> If your metric needs a new landmark that isn't in `LM` yet (e.g. a foot),
> add it to the `LM` object first — do not use a raw number anywhere.

---

## Step 4 — Add the metric to `PhaseContext`

`src/types.ts` — `PhaseContext['metrics']` lists every metric rules can read.
Add your field here:

```ts
export interface PhaseContext {
  poses: PoseFrame[];
  fps: number;
  phases: Phases;
  metrics: {
    kneeFlexionAtTrophyDeg: number;
    // add your metric, e.g.:
    // elbowExtensionAtContactDeg: number;
  };
}
```

---

## Step 5 — Compute the metric into `ctx.metrics`

`src/pipeline/buildPhaseContext.ts` — compute the metric **once** at the right
frame, store it in `ctx.metrics`. Rules consume the value instead of
recomputing geometry.

```ts
import type { PoseFrame, Phases, PhaseContext } from '../types';
import { kneeFlexion } from '../pose/metrics';

export function buildPhaseContext(poses: PoseFrame[], fps: number, phases: Phases): PhaseContext {
  const tf = phases.events.trophyFrame;
  const kneeFlexionAtTrophyDeg =
    tf >= 0 && tf < poses.length ? kneeFlexion(poses[tf]) : NaN;
  return { poses, fps, phases, metrics: { kneeFlexionAtTrophyDeg } };
}
```

Notes:
- Use the **event frame** that matches the metric's definition (trophy,
  contact, follow-start — all in `phases.events`).
- Return `NaN` when the frame is out of range or the pose is unusable. Rules
  map `NaN → status: 'unknown'` (don't panic — see Step 6).

---

## Step 6 — Write the rule (TDD)

This is the core. The rule is a pure function — **write the test first**
(task-rules §3), then the implementation. Both live next to each other:

- `src/rules/ruleC3.ts`
- `src/rules/ruleC3.test.ts`

### The type the rule must satisfy

`src/rules/types.ts`:

```ts
export type RuleStatus = 'ok' | 'warn' | 'error' | 'unknown';

export interface RuleResult {
  ruleId: string;
  title: string;          // i18n key, e.g. "rules.C3.title"
  phase: keyof Phases['phases'];
  status: RuleStatus;     // ok = passed, warn/error = problem, unknown = cannot determine
  confidence: Confidence;
  advice?: string;        // i18n key, present for warn/error
  metric?: RuleMetric;
  atFrame?: number;       // frame index the metric is measured at
  atTimestampMs?: number; // its time in the clip — lets the UI seek the video there
  landmarks?: number[];   // MediaPipe indices the rule inspects → skeleton highlight
}

export interface ErrorRule {
  id: string;
  phase: keyof Phases['phases'];
  layer: 1 | 2 | 3;
  title: string;          // i18n key (same value reused as RuleResult.title)
  check: (ctx: PhaseContext) => Finding | null;          // legacy: problems only
  evaluate?: (ctx: PhaseContext) => RuleResult;          // preferred: full row
}
```

**Implement `evaluate` (the single source of truth) and derive `check` from
it.** Do not implement both independently — they will drift.

### Reference implementation — `src/rules/ruleC3.ts`

```ts
import type { ErrorRule, Finding, RuleResult } from './types';
import { KNEE_JOINT_ANGLE_NORMAL_RANGE_DEG, KNEE_JOINT_ANGLE_ERROR_MARGIN_DEG } from '../constants/biomechanics';
import { LM } from '../pose/landmarks';

// i18n keys (resolved by AdviceList / RulesReport via t()). The rule itself is
// locale-agnostic: it never carries display strings, only keys + numbers.
const TITLE_KEY = 'rules.C3.title';
const ADVICE_KEY = 'rules.C3.advice';
const METRIC_NAME_KEY = 'rules.C3.metricName';

// Single source of truth: always returns a full row (ok/warn/error/unknown).
function evaluateC3(ctx: Parameters<NonNullable<ErrorRule['evaluate']>>[0]): RuleResult {
  const angle = ctx.metrics.kneeFlexionAtTrophyDeg;
  const atFrame = ctx.phases.events.trophyFrame;
  const atTimestampMs = ctx.poses[atFrame]?.timestampMs;
  const base = {
    ruleId: 'C3', title: TITLE_KEY, phase: 'trophy' as const,
    confidence: ctx.phases.confidence, atFrame, atTimestampMs,
    // See "Choosing landmarks" below for why hips are excluded.
    landmarks: [LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE],
  };
  if (Number.isNaN(angle)) return { ...base, status: 'unknown' };

  const [, max] = KNEE_JOINT_ANGLE_NORMAL_RANGE_DEG;
  const metric = {
    name: METRIC_NAME_KEY,
    value: Math.round(angle),
    unit: '°',
    referenceRange: KNEE_JOINT_ANGLE_NORMAL_RANGE_DEG,
  };
  if (angle <= max) return { ...base, status: 'ok', metric };
  const status = angle > max + KNEE_JOINT_ANGLE_ERROR_MARGIN_DEG ? 'error' : 'warn';
  return { ...base, status, advice: ADVICE_KEY, metric };
}

export const ruleC3: ErrorRule = {
  id: 'C3',
  phase: 'trophy',
  layer: 1,
  title: TITLE_KEY,
  evaluate: evaluateC3,
  check: (ctx) => {
    const r = evaluateC3(ctx);
    if (r.status !== 'warn' && r.status !== 'error') return null;
    const f: Finding = {
      ruleId: r.ruleId,
      severity: r.status,
      confidence: r.confidence,
      advice: r.advice!,
      metric: r.metric,
    };
    return f;
  },
};
```

### Reference tests — `src/rules/ruleC3.test.ts`

Test the boundary cases — the transitions between `ok` / `warn` / `error` /
`unknown`. Use a tiny `makeCtx` helper that only sets the metric:

```ts
it('declares the landmarks it inspects (both legs) for highlighting', () => {
  const r = ruleC3.evaluate!(makeCtx(150));
  expect(r.landmarks).toEqual([LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE]);
});
```

Run them with:

```bash
npx vitest run src/rules/ruleC3.test.ts
```

---

## Step 7 — Register the rule

`src/pipeline/analyzeServe.ts` — add the rule to **both** arrays (findings +
report). Forgetting one means either the Advice list or the Rules report is
silently missing your rule.

```ts
import { ruleC3 } from '../rules/ruleC3';
// ...
const findings    = runRules(ctx, [ruleC3 /*, yourRule */]);
const ruleResults = runRulesReport(ctx, [ruleC3 /*, yourRule */]);
```

> Keep the two arrays in the same order — it's the only place they're coupled.

---

## Step 8 — Add i18n keys to **both** locales

`src/i18n/locales/en.json` and `src/i18n/locales/ru.json` — every display
string is an i18n key (task-rules §7). The rule carries only the **keys**, the
locale files carry the translated strings. Add a block under `rules`:

```json
"rules": {
  "C3": {
    "title": "Knee bend",
    "metricName": "Knee flexion at \"trophy\"",
    "advice": "Knees are barely bent — the legs contribute almost no energy…"
  }
}
```

Russian (`ru.json`):

```json
"rules": {
  "C3": {
    "title": "Сгиб коленей",
    "metricName": "Сгиб колена в «трофей»",
    "advice": "Колени согнуты слабо — ноги почти не дают энергию удару…"
  }
}
```

Three keys per rule:
- `title` — short name shown on the card
- `metricName` — what the number measures
- `advice` — the Layer-1 tip for `warn` / `error` (anatomy-free, actionable)

> If you forget `ru.json`, the Russian UI will render the raw key
> (`rules.C3.advice`) — the app does **not** fall back to English.

---

## Choosing `landmarks` for the skeleton highlight

The `landmarks` array drives which bones/joints light up when the user hovers
or selects the rule card. The overlay highlights **any bone that touches at
least one listed landmark**, and paints them by the rule's `status`
(ok → green, warn → yellow, error → red, unknown → gray).

Rules of thumb:

- **List the joints the rule is literally about.** C3 is about knee bend, so
  it lists the knees and ankles — not the hips.
- **Exclude a landmark if listing it would over-highlight.** C3 deliberately
  omits the hips: a listed hip also lights the torso connections
  (shoulder-hip, hip-hip), and C3 isn't about the torso. The upper-leg bone
  still highlights fully because the knee is listed.
- **Use `LM.*` constants, never raw indices.** `[LM.L_KNEE, LM.R_KNEE, …]`,
  not `[25, 26, …]`.
- **List both sides for symmetric rules.** `kneeFlexion()` takes `Math.min`
  over both legs without telling you which won, so C3 lists both legs.

---

## Verify end-to-end

After the 8 steps:

```bash
# 1. types + tests
npx tsc --noEmit
npx vitest run

# 2. production build
npm run build

# 3. manual / visual
npm run dev
```

Then in the browser: upload a clip, wait for analysis, and check that
- a card for your rule appears in the Rules report
- hovering it highlights the right bones (color = status)
- clicking it seeks the video to `atTimestampMs` and keeps the highlight

For a programmatic visual check (canvas pixels + page screenshot), see the
Playwright pattern used during the highlight feature's development.

---

## Common pitfalls

- **Magic numbers in the rule.** Move every threshold to
  `src/constants/biomechanics.ts` with a source comment. `15`, `160`,
  `0.6` — none of these belong inline.
- **Implementing `check` and `evaluate` separately.** They drift. Derive
  `check` from `evaluate` (as `ruleC3` does).
- **Display strings in the rule.** Rules carry i18n **keys**, never Russian or
  English text. The UI resolves them via `t()`.
- **Forgetting `ru.json`.** Both locales must get the three keys, or the
  Russian UI shows raw keys.
- **Registering in only one array.** `runRules` (Advice list) **and**
  `runRulesReport` (Rules report) both need the rule.
- **Raw landmark indices.** Use `LM.*` everywhere — in the rule, the test, and
  any new metric helper.
- **Returning a status on bad data.** When the metric is `NaN` (frame out of
  range, low visibility), return `status: 'unknown'`, not `ok` or `error`.
  C3's `if (Number.isNaN(angle)) return { ...base, status: 'unknown' };` is
  the pattern.

---

## Reference: rule candidates

From `skills/serve-error-detection/SKILL.md` — the backlog you can implement
with this guide. Each has its logic, measurement method, and Layer-1 advice
already written in the skill.

| id | phase | metric (sketch) | likely landmarks |
|----|-------|-----------------|------------------|
| T1 | trophy | racket wrist below elbow (racket drop) | racket elbow + wrist |
| T2 | trophy | trophy-phase duration in frames | *(time-based — no joints)* |
| T3 | trophy | toss-wrist height at contact vs peak | toss wrist |
| TO1 | toss | x of toss peak vs hip center | toss wrist + hips |
| TO2 | toss | toss-wrist y rise, release → peak | toss wrist |
| C1 | contact | elbow angle / wrist height at contact | racket shoulder + elbow + wrist |
| C2 | contact | x of contact vs hips/shoulders | racket wrist + hips |
| **C3** | **trophy** | **knee joint angle at trophy** | **knees + ankles** *(implemented)* |
| F1 | follow-through | racket-wrist crosses midline post-contact | racket wrist + shoulders |
| F2 | follow-through | hip center vs feet at end of follow-through | hips + ankles |

When you pick one, fill in the 8 touch points above. The engineering is
identical for every rule; only the metric, the thresholds, and the landmarks
change.
