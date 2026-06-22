# Serve Error Rules — T1, T2, T3, TO1, TO2, C1, C2, F1, F2

**Date:** 2026-06-22
**Status:** Proposed
**Analysis layers:** **Layer 1** (the rules' primary output — plain per-phase advice with no anatomy) and **Layer 2** (every rule also emits a concrete `metric` with a `referenceRange` for the rules report). No Layer 3 change.

## Context

The MVP spec (`docs/superpowers/specs/2026-06-20-cv-pipeline-mvp-design.md`) shipped the pipeline end-to-end with **one** error rule: **C3** (insufficient knee bend at trophy). `skills/serve-error-detection/SKILL.md` already documents **nine more rule candidates** — each with its logic, how-to-measure, and Layer-1 advice wording — but none have code, thresholds, or i18n keys. The MVP spec explicitly reserved `PhaseContext.metrics` with a `/* + metrics for future rules */` placeholder for exactly this next step.

This spec designs all nine documented candidates so the prototype moves from "C3 only" to "the full documented error surface." Every rule follows the already-locked C3 pattern: a thin rule module that reads a precomputed metric from `ctx.metrics`, an `evaluate()` that is the single source of truth (always returns a full `RuleResult` row), a `check()` derived from it, i18n keys for `title` / `metricName` / `advice`, and named thresholds in `src/constants/biomechanics.ts`.

### Why now, and why all nine at once

- The phase pipeline (`detectPhases`) and the metric seam (`buildPhaseContext` → `ctx.metrics`) are stable after the 2026-06-21 trophy fix; the surfaces a rule needs (`trophyFrame`, `contactFrame`, `followStartFrame`, smoothed `poses`, `fps`, `handedness`) all exist.
- Each new rule needs the **same** four wiring touchpoints (constants, `ctx.metrics`, i18n en+ru, the rule file). Doing them in one pass avoids nine near-identical refactors of `buildPhaseContext` and the locale catalogs.
- All nine share one infrastructure change (extending `ctx.metrics` + adding pose helpers + a `forwardSign` direction estimator), so it is cheaper to land that once.

### Thresholds are provisional

Per `task-rules §6`, every threshold is a named constant with a source comment. The values here are **provisional estimates in normalized image coordinates** (BlazePose `x`, `y` ∈ [0,1], `y` grows downward), chosen by reasoning about the geometry of a side-view serve, not yet calibrated on labeled serves. The MVP spec already flags threshold calibration as next-stage; this spec adds an explicit follow-up task rather than trying to calibrate inside it. Until calibration, expect false positives / negatives — the rules degrade to `unknown` (not a wrong verdict) whenever a metric cannot be computed.

## Goals / Non-goals

### Goals
- Implement the nine documented candidates (**C1, C2, TO1, TO2, T1, T2, T3, F1, F2**) following the C3 pattern, each covered by TDD unit tests (ok/warn/error/unknown boundaries, `confidence` inheritance, NaN → unknown, anatomy-free advice invariant).
- Extend `PhaseContext['metrics']` with the metrics the rules read, computed by atomic, tested helpers in `src/pose/metrics.ts`.
- Add a direction estimator (`forwardSign`) so "behind the body" / "toss too far back" rules resolve left-vs-right from the swing trajectory instead of guessing.
- Land all thresholds as named constants with source comments; no magic literals in rule bodies.
- Add the 27 i18n keys (`title` + `metricName` + `advice` × 9 rules) to **both** `en.json` and `ru.json`; the existing parity test enforces this.
- Group rules in a single `src/rules/index.ts` registry consumed by `analyzeServe.ts`.

### Non-goals (explicit YAGNI)
- **Threshold calibration on real serves.** Documented as a follow-up; values are provisional.
- **Real-world units (cm, degrees-from-vertical).** Metrics stay in normalized image space. Converting to cm/° (Layer 2 proper) needs camera calibration / depth and is future.
- **New phase events** (stance start, toss release, acceleration start). The rules reuse the existing `trophyFrame` / `contactFrame` / `followStartFrame`. Where a rule's "natural" anchor is missing (T2 in particular), we use the closest available proxy and flag low confidence.
- **Ball tracking.** Toss metrics continue to use the toss-arm wrist as a proxy for the ball, exactly as the skill prescribes and as detection already does.
- **ML / LLM evaluation.** Out of scope by ADR-0002.
- **Layer 3 reference comparison.** Unchanged.
- **New `Confidence` tiers.** Stays `'low' | 'high'`.

## Architecture

### Rule → metric map

Each rule reads one (sometimes two) precomputed metrics from `ctx.metrics`. The table is the contract between `buildPhaseContext` and the rules.

| ID | `phase` (UI group) | Primary metric | Secondary / corroborating | Measured at |
|----|--------------------|----------------|----------------------------|-------------|
| **C1** Contact too low | `acceleration` | `contactHeightAboveShoulder` | `elbowExtensionAtContactDeg` | `contactFrame` |
| **C2** Contact behind the body | `acceleration` | `contactHorizontalOffset` (+ `facingSign`) | — | `contactFrame` |
| **TO2** Toss too low | `preparation` | `tossApexHeightAboveShoulder` | — | `tossApexFrame` |
| **TO1** Toss too far back | `preparation` | `tossApexHorizontalOffset` (+ `facingSign`) | — | `tossApexFrame` |
| **T3** Toss arm drops early | `trophy` | `tossArmDropAtContact` | — | `contactFrame` (drop relative to apex) |
| **T1** No racket drop | `trophy` | `racketDropDepth` | — | window `[trophyFrame, contactFrame)` |
| **F1** Abrupt stop | `followThrough` | `followThroughHorizontalTravel` | — | window `[contactFrame, followEnd]` |
| **T2** Too long in trophy | `trophy` | `accelerationPhaseMs` | — | `(contactFrame − trophyFrame)` |
| **F2** Loss of balance | `followThrough` | `leanAtFollowEnd` | — | last frame of follow-through |

`phase` is assigned by the conceptual phase in `serve-error-detection/SKILL.md` (used only to group rules in the report and to pick overlay landmarks); the exact measurement instant is exposed via `atFrame` / `atTimestampMs`, exactly like C3.

### Coordinate conventions (all already established in the codebase)

- Image `y` grows **downward**; `height = 1 − y` so "higher" = larger.
- `x` ∈ [0,1] left-to-right in the image; the **player's forward direction is unknown a priori** (depends on which way they face the camera), so any "behind / forward" judgment goes through `facingSign` (see below).
- Heights/offsets are **normalized** (image-space), so thresholds are fractions of frame width/height.

### Direction: `forwardSign` (new helper)

C2, TO1, and (indirectly) F2 need to know which image-x direction is "forward" for the player. We do **not** have an explicit facing input, so we estimate it from the swing itself: the racket wrist travels from the trophy pose **forward** to follow-through. Define

```
forwardSign = sign( racketWrist.x(followStartFrame) − racketWrist.x(trophyFrame) )
```

- `+1` / `-1` → a consistent swing direction; "behind the body" = the offset sign **opposite** to `forwardSign`.
- `0` → the swing has no measurable horizontal travel (e.g. a very vertical clip, or noisy frames) → the three direction-dependent rules return `unknown` rather than guessing. This is the deliberate do-no-harm path (task-rules §5, skill principle 4).

`forwardSign` is computed once in `buildPhaseContext` and stored in `ctx.metrics.facingSign`. It degrades gracefully: a zero never produces a false verdict.

### Why specific design choices

- **C1 measured by *height above the shoulder*, not by elbow angle.** The contact-frame elbow is unreliable on a side view — the overhead arm self-occludes, which is exactly why `CONTACT_ELBOW_MIN_DEG` had to be relaxed to 140° (see its source comment in `biomechanics.ts`). Wrist-height-above-shoulder is a clean, visible signal. The elbow angle is kept as a *corroborating* secondary metric in the report only; it does not gate the verdict.
- **T2 uses the acceleration-phase duration, not the trophy-phase frame count.** By construction `trophy = [trophyFrame, trophyFrame+1]` (see `assemble()` in `detectPhases.ts`), so the trophy phase is ~1 frame and its duration is meaningless as a "freeze" signal. The observable proxy for "hung in trophy" is how long the trophy→contact (acceleration) window takes. This is acknowledged as a **weak proxy** — T2 is warn-only with low confidence, and improving it needs a real "acceleration start" detector (out of scope; flagged as future in the MVP spec).
- **T3 is a *ratio*, not an absolute drop.** Players toss to different heights; "the arm dropped before contact" is best expressed as `tossWristHeight(contact) / tossWristHeight(apex)` — a fraction of the peak — which is scale-free across players.
- **F1 measured by horizontal travel of the racket wrist across the body**, which captures "did the racket cross to the opposite side and descend" without needing 3D.
- **F2 is `info`-only.** The skill is explicit: CV cannot reliably tell "falling over" from "a natural step into the court." We surface it softly (`severity: 'info'`), never as `warn`/`error`.

## Interfaces

```ts
// src/types.ts — PhaseContext['metrics'] extended.
// Every field may be NaN (or 0 for facingSign) when it cannot be computed;
// rules render NaN as status 'unknown'.
export interface PhaseContext {
  poses: PoseFrame[];
  fps: number;
  phases: Phases;
  metrics: {
    // Existing:
    kneeFlexionAtTrophyDeg: number;
    // Contact (C1, C2):
    elbowExtensionAtContactDeg: number;   // racket-arm shoulder-elbow-wrist at contactFrame
    contactHeightAboveShoulder: number;   // racketWristH − racketShoulderH @ contactFrame
    contactHorizontalOffset: number;      // racketWrist.x − hipCenter.x @ contactFrame
    // Toss (TO1, TO2, and the apex anchor for T3):
    tossApexFrame: number;                // argmax tossWristHeight over [0, contactFrame)
    tossApexHeightAboveShoulder: number;  // tossWristH − tossShoulderH @ tossApexFrame
    tossApexHorizontalOffset: number;     // tossWrist.x − hipCenter.x @ tossApexFrame
    tossArmDropAtContact: number;         // tossWristH(contact) / tossWristH(apex)  ∈ [0,1]
    // Trophy (T1):
    racketDropDepth: number;              // max over [trophy,contact) of (racketElbowH − racketWristH)
    // Timing (T2):
    accelerationPhaseMs: number;          // (contactFrame − trophyFrame) / fps * 1000
    // Follow-through (F1, F2):
    followThroughHorizontalTravel: number; // |Δx| of racket wrist, contactFrame → followEnd
    leanAtFollowEnd: number;              // |hipCenter.x − footCenter.x| @ followEnd
    // Direction (shared by C2 / TO1):
    facingSign: 1 | -1 | 0;               // see "Direction" above
  };
}
```

```ts
// src/pose/landmarks.ts — add the two heels (indices already present in BlazePose
// but unnamed). Used only for footCenter in F2.
export const LM = {
  ...,
  L_HEEL: 29, R_HEEL: 30,
} as const;
```

```ts
// src/pose/metrics.ts — NEW atomic helpers (each unit-tested). All return NaN
// when the underlying landmarks are missing/unreliable.
export function elbowExtensionAt(f: PoseFrame, h: Handedness): number;    // alias of existing elbowExtension, kept for naming symmetry
export function hipCenter(f: PoseFrame): { x: number; y: number };        // midpoint of L_HIP/R_HIP (visible one if the other is occluded)
export function footCenter(f: PoseFrame): { x: number; y: number };       // midpoint of L_HEEL/R_HEEL
export function heightAboveShoulder(f: PoseFrame, h: Handedness, side: 'racket' | 'toss'): number;
// forwardSign is phase-aware, so it lives in buildPhaseContext, not here.
```

```ts
// src/constants/biomechanics.ts — NEW named thresholds (each with a source comment,
// all marked PROVISIONAL). Final names decided in implementation; shape:
export const CONTACT_HEIGHT_ABOVE_SHOULDER_RANGE: [number, number]; // ok / warn boundary, error below min
export const CONTACT_HORIZONTAL_BEHIND_WARN: number;                // |offset| opposing facingSign
export const CONTACT_HORIZONTAL_BEHIND_ERROR: number;
export const TOSS_APEX_HEIGHT_ABOVE_SHOULDER_RANGE: [number, number];
export const TOSS_APEX_HORIZONTAL_BEHIND_WARN: number;
export const TOSS_APEX_HORIZONTAL_BEHIND_ERROR: number;
export const TOSS_ARM_DROP_AT_CONTACT_RANGE: [number, number];      // ratio
export const RACKET_DROP_DEPTH_RANGE: [number, number];
export const ACCELERATION_PHASE_MS_WARN: number;
export const ACCELERATION_PHASE_MS_ERROR: number;
export const FOLLOW_THROUGH_TRAVEL_RANGE: [number, number];
export const LEAN_AT_FOLLOW_END_INFO: number;                       // F2 is info-only
```

```ts
// src/rules/index.ts — NEW registry, replaces the inline [ruleC3] arrays.
import { ruleC3 } from './ruleC3';
import { ruleC1 } from './ruleC1';
// ... etc.
export const ALL_RULES: ErrorRule[] = [
  ruleC3, ruleC1, ruleC2, ruleTO1, ruleTO2, ruleT1, ruleT2, ruleT3, ruleF1, ruleF2,
];
```

```ts
// src/pipeline/analyzeServe.ts — consume the registry (both call sites):
import { ALL_RULES } from '../rules';
const findings = runRules(ctx, ALL_RULES);
const ruleResults = runRulesReport(ctx, ALL_RULES);
```

Each rule file follows `ruleC3.ts` exactly: i18n key constants, a private `evaluateXxx(ctx)` returning a full `RuleResult` (single source of truth), and a `check` derived from it. Each rule's `landmarks` field lists the MediaPipe indices it inspects (for overlay highlighting).

## Per-rule logic (verdict rules)

Verdict boundaries below use the convention: **inside the range → `ok`; just outside → `warn`; substantially outside → `error`**. NaN (or `facingSign === 0` where relevant) → `unknown`. Severity inherits `ctx.phases.confidence` like C3.

### C1 — Contact too low
- Metric: `contactHeightAboveShoulder` (wrist height above racket shoulder at contact).
- Verdict: `< ERROR` → `error`; `[ERROR, WARN)` → `warn`; `≥ WARN` → `ok`. (`WARN` is the upper bound of the "good" reach; below it the contact is increasingly low.)
- Landmarks: racket wrist, racket shoulder, racket elbow (corroborating).

### C2 — Contact behind the body
- Metric: `contactHorizontalOffset` × `facingSign`. If the offset sign **opposes** `facingSign`, the contact is behind; magnitude decides severity.
- Verdict: behind with `|offset| ≥ ERROR` → `error`; `[WARN, ERROR)` → `warn`; forward (or near-zero) → `ok`. `facingSign === 0` → `unknown`.
- Landmarks: racket wrist, both hips.

### TO2 — Toss too low
- Metric: `tossApexHeightAboveShoulder`.
- Verdict: `< ERROR` → `error`; `[ERROR, WARN)` → `warn`; `≥ WARN` → `ok`.
- Landmarks: toss wrist, toss shoulder.

### TO1 — Toss too far back
- Metric: `tossApexHorizontalOffset` × `facingSign`. Same sign logic as C2.
- Verdict: behind with `|offset| ≥ ERROR` → `error`; `[WARN, ERROR)` → `warn`; else `ok`. `facingSign === 0` → `unknown`.
- Landmarks: toss wrist, both hips.

### T3 — Toss arm drops too early
- Metric: `tossArmDropAtContact` (ratio ∈ [0,1]; lower = arm dropped more).
- Verdict: `< ERROR` → `error`; `[ERROR, WARN)` → `warn`; `≥ WARN` → `ok`.
- Landmarks: toss wrist (contact frame) and toss wrist (apex).

### T1 — No racket drop
- Metric: `racketDropDepth` (max of `racketElbowH − racketWristH` over `[trophy, contact)` — how far the wrist drops below the elbow = "racket behind the back").
- Verdict: `≤ ERROR` → `error` (wrist never below elbow); `(ERROR, WARN]` → `warn`; `> WARN` → `ok`.
- Landmarks: racket wrist, racket elbow.

### F1 — Abrupt stop
- Metric: `followThroughHorizontalTravel` (|Δx| of racket wrist from contact to follow-through end).
- Verdict: `< ERROR` → `error`; `[ERROR, WARN)` → `warn`; `≥ WARN` → `ok`.
- Landmarks: racket wrist (contact → follow-through).

### T2 — Too long in trophy (weak proxy, warn-only)
- Metric: `accelerationPhaseMs`.
- Verdict: `> ERROR` → `error`; `> WARN` → `warn`; else `ok`. **Confidence forced to `'low'`** regardless of `ctx.phases.confidence` (acknowledged weak proxy).
- Landmarks: trophy-frame and contact-frame racket wrist (for visual context).

### F2 — Loss of balance (info-only)
- Metric: `leanAtFollowEnd` (|hipCenter.x − footCenter.x| at follow-through end).
- Verdict: `> INFO` → finding with **`severity: 'info'`** (never warn/error). Maps to `status: 'info'`-equivalent — implemented as a `Finding` with `severity: 'info'`; in the report it shows as a soft note.
- Landmarks: both hips, both heels.

## Success metrics

- **Unit tests (TDD, written first per rule):** for each of the 9 rules, a `ruleX.test.ts` with: (a) `ok` inside the range, (b) `warn` just outside, (c) `error` substantially outside, (d) `unknown` on NaN (and on `facingSign === 0` for C2/TO1), (e) `confidence` inherited from `ctx.phases.confidence` (except T2 forced `'low'`), (f) the anatomy-free-advice invariant (resolved advice matches no `/rotation|pronation|anatom|flexion|extension/i`), (g) `atFrame`/`atTimestampMs`/`landmarks` populated correctly.
- **Metric helper tests:** `metrics.test.ts` gains cases for each new helper (height-above-shoulder, hip/foot center, normalized offset), including NaN/occlusion handling.
- **`buildPhaseContext` tests:** each new `ctx.metrics` field is computed correctly from a synthetic pose sequence with known trophy/contact/apex frames.
- **i18n parity test passes** with the 27 new keys in both `en.json` and `ru.json`.
- **No magic literals** in any rule body — every threshold is an imported named constant.
- **Demo clip (integration / manual):** the full 10-rule set runs on `public/demo/clips/serve-right-side.mp4` without exceptions; every rule produces a `RuleResult`; at least one rule (likely C3 or a contact rule) shows a non-`ok` status so the surface is observably alive; no rule crashes on NaN / boundary data.
- `npm run build` (TypeScript + Vite) succeeds.

## Risks / open questions

- **Provisional thresholds will misfire.** Mitigation: rules degrade to `unknown` on any uncomputable metric, never to a wrong verdict. Calibration on labeled serves is an explicit follow-up task, not part of this spec.
- **`forwardSign` ambiguity.** A serve with near-zero horizontal swing travel yields `facingSign === 0` → C2/TO1 return `unknown`. This is the safe path; on a typical side-view clip the follow-through travels clearly across the body, so `facingSign` is non-zero.
- **T2 is a weak proxy.** Because the trophy phase is ~1 frame by construction, "too long in trophy" is approximated by acceleration-phase duration. It is warn-only and force-`low`-confidence; a future "acceleration start" detector (already future in the MVP spec) would let us measure the real freeze.
- **F2 false positives.** A natural step into the court shifts the hip center over the front foot and can look like a "lean." Per the skill this is `info`-only; we accept the noise and surface it softly.
- **Layer-2 numbers are image-space.** Until camera calibration / depth is available, "contactHeightAboveShoulder = 0.04" is "4% of frame height," not centimeters. The metric name in i18n avoids implying real units.
- **Heel landmarks (`L_HEEL`/`R_HEEL`) visibility.** On some clips the feet are out of frame; `footCenter` then falls back to ankles (already named in `LM`), and F2 degrades to `unknown` if neither is visible.
- **Registry refactor.** Moving from inline `[ruleC3]` to `ALL_RULES` is a small, mechanical change but touches the pipeline; covered by the existing pipeline integration test.

## Follow-up (not in this spec)

- Calibrate all 9 rules' thresholds on a labeled set of ≥5 serves per verdict class; replace provisional values and remove the PROVISIONAL tags.
- Real "acceleration start" detector to give T2 a proper signal (replace the acceleration-phase-duration proxy).
- Convert image-space metrics to real units (cm, °) for Layer 2 — needs camera calibration / depth.
