# Trophy Detection Fix — anchor on contact, robust knee, toss-arm gate

**Date:** 2026-06-21
**Status:** Under review
**Analysis layers:** Layer 1 (phase split) primarily. Layer 2 benefits indirectly — every angle/height metric is measured relative to a phase boundary, so a misplaced trophy corrupts Layer 2 too. No Layer 3 change.

## Context

`detectPhases()` (`src/pipeline/detectPhases.ts`) currently finds the trophy event as **"the frame with the deepest knee bend among all frames where the racket wrist is above the nose"**, then finds contact as the highest qualifying racket-wrist peak *after* trophy.

On the bundled demo clip (`public/demo/clips/serve-right-side.mp4`, right-handed side view) this misfires badly. Reproduced offline with the same MediaPipe model the browser uses (`pose_landmarker_heavy`, sampled at 30 fps → 74 poses, then the production `smooth()`):

- Detected `trophyFrame = 40` (~1.33 s) — this is **post-contact**, the arm already swinging down into the landing.
- Real trophy ≈ frame 18–20 (~0.6 s); real contact ≈ frame 36 (~1.2 s).
- Because trophy landed after the real contact, `detectContact` found **no qualifying racket-height peak after frame 40** → `contactFrame = -1` → low-confidence fallback. One bad trophy poisons the whole split, so `preparation = [0, 40]` swallows the toss, the real trophy, and the backswing.

### Why the current heuristic breaks (evidence from the run)

1. **The deepest knee bend is not at trophy.** Knee joint angle decreases monotonically from frame ~26 to 45 (170° → 126°) — that is the **landing crouch after the jump**, not pre-trophy loading. The "deepest bend" minimum lives in the wrong part of the serve.
2. **`kneeFlexion()` takes `min(left, right)`**, i.e. the *more-bent* leg — which on a side view is almost always the far / occluded leg. Left-knee visibility stays **0.22–0.50** for the whole serve, so the chosen "bend" is largely a tracking artifact of an occluded joint.
3. **"Overhead" (wrist above nose) is true on a huge window** (frames 17–25 and 32–40), so the entire upswing-to-contact stays eligible as a trophy candidate.
4. **The toss arm — the strongest disambiguator — is unused.** The toss wrist peaks at frame 17, exactly at the real trophy. Nothing in detection looks at it.

This spec fixes the detection with three changes agreed with the user: **A (core)** anchor everything on contact and bound the trophy search before it; **C (core)** make the knee signal robust to occlusion; **B (reinforcement)** gate trophy candidates by toss-arm extension.

## Goals / Non-goals

### Goals
- On the demo clip, detect trophy within **±2 frames** of the labeled trophy (≈ frame 18–20) and contact within ±2 frames (≈ frame 36), at `confidence: 'high'`.
- Make contact detection independent of trophy, so a bad trophy can no longer suppress contact.
- Make the knee angle used for both trophy detection **and** the C3 metric robust to an occluded back leg.
- Keep the change explainable and threshold-driven (task-rules §5, §6): every new number is a named constant in `src/constants/biomechanics.ts` with a source comment.
- Cover the new logic with synthetic-pose unit tests before implementation (task-rules §3, TDD).

### Non-goals (explicit YAGNI)
- **Ball tracking / release detection.** We bound the trophy search by `[0, contactFrame)`, not by a detected release. Release detection stays future-work; using video start as the lower bound is sufficient because the toss-arm gate already excludes the early prep frames.
- **A new confidence tier.** `Confidence` stays `'low' | 'high'` (`src/types.ts`); no `'medium'`.
- **Re-tuning C3 thresholds.** `KNEE_JOINT_ANGLE_NORMAL_RANGE_DEG` and friends are unchanged; we only change *which knee* feeds the angle.
- **Multi-pose / handedness auto-detection.** Handedness stays an explicit input.
- **Changing the smoothing window or the visibility gate.**

## Architecture

New detection order inside `detectPhases()` (contact-anchored):

```
visibility gate (unchanged)
        │
        ▼
1. detectContact(poses, h)          ← NEW: global, trophy-independent
   = argmax racket-wrist height over local maxima with elbow ≥ CONTACT_ELBOW_MIN_DEG
        │  (contactFrame)
        ▼
2. detectTrophy(poses, h, contactFrame)   ← REWORKED
   search window = [0, contactFrame)
   candidate frame must satisfy ALL of:
     • racket overhead  (wrist.y < REF_LM.y)                     ← D-ready (ref = nose for now)
     • toss arm extended: tossWristHeight ≥ peakTossHeight − TOSS_ARM_PEAK_BAND   ← B
   among candidates pick the deepest *robust* knee bend           ← C
        │  (trophyFrame)
        ▼
3. detectFollowStart(poses, h, contactFrame)  (unchanged logic, still post-contact)
        │
        ▼
4. invariant guard trophy < contact < followStart (unchanged)
        │
        ▼
assemble()  (unchanged)
```

### A — contact first, trophy bounded before it

Contact is the **single most reliable marker** of the serve: the highest racket-wrist reach with an extended elbow. It does not depend on trophy, so we detect it first over the whole clip. The trophy search is then restricted to `[0, contactFrame)` — trophy is *by definition* before contact, so the post-contact / landing knee-flex artifact (frames 40–45 in the demo) is excluded by construction.

Risk this introduces: could the trophy-region height bump be mistaken for contact? On the demo the trophy-region peak is 0.549 vs contact 0.613, and in a serve contact is the highest reach of the whole motion, so **global max height among extended-elbow peaks** robustly selects contact over the trophy bump. If no qualifying peak exists at all, keep the existing low-confidence fallback (global max height), then still bound trophy by it.

### C — occlusion-robust knee angle

Replace the blind `min(left, right)` with a **visibility-aware** selection, used by both detection and the C3 metric so they never disagree:

- If exactly one knee is visible (`visibility ≥ KNEE_MIN_VISIBILITY`), use that knee's joint angle.
- If both are visible, use the **more-visible** knee (the near leg on a side view), not the more-bent one.
- If neither is visible, the knee signal is unreliable → return `NaN` for the metric (C3 already renders `unknown` on `NaN`) and, for detection, fall back to the toss-arm peak frame as trophy with `confidence: 'low'`.

This directly removes the artifact: the occluded back knee can no longer hijack the "deepest bend".

### B — toss-arm extension gate

A trophy candidate must have the toss-side wrist near its own vertical peak (`tossWristHeight ≥ peakTossHeight − TOSS_ARM_PEAK_BAND`, both in the height convention `1 − y`). At true trophy the toss arm is fully extended up; during the rest of the swing it is not. This collapses the candidate set onto the real trophy window even before the knee tie-break runs.

### D — readiness (not enabled now)

The "overhead" reference landmark stays `nose` (`TROPHY_OVERHEAD_REF_LM`), already a single constant. Switching to a shoulder for stricter detection is a one-line constant change deferred until calibration data exists; no structural work needed.

## Interfaces

```ts
// src/pose/metrics.ts — REWORKED (signature unchanged, semantics occlusion-robust)
// Returns the joint angle (180° = straight) of the more-visible knee, or NaN if
// neither knee clears KNEE_MIN_VISIBILITY.
export function kneeJointAngle(f: PoseFrame): number;

// src/pose/metrics.ts — NEW helper (mirror of racketWristHeight for the toss arm)
export function tossWristHeight(f: PoseFrame, h: Handedness): number;

// src/pipeline/detectPhases.ts — internal helpers (not exported), shapes:
function detectContact(poses: PoseFrame[], h: Handedness):
  { frame: number; confident: boolean };
function detectTrophy(poses: PoseFrame[], h: Handedness, contactFrame: number):
  { frame: number; confident: boolean };

// detectPhases() public signature is UNCHANGED:
//   detectPhases(poses: PoseFrame[], h: Handedness, gate?: GateOptions): Phases
```

```ts
// src/constants/biomechanics.ts — NEW constants (each with a source comment)
export const KNEE_MIN_VISIBILITY = 0.5;        // below this a knee is occluded/unreliable
export const TOSS_ARM_PEAK_BAND = 0.10;        // toss wrist within 10% of its peak height counts as "extended up"
// (CONTACT_ELBOW_MIN_DEG, CONTACT_HEIGHT_PROMINENCE, TROPHY_OVERHEAD_REF_LM reused as-is)
```

`buildPhaseContext()` keeps its signature; it switches from `kneeFlexion` to `kneeJointAngle`, so `metrics.kneeFlexionAtTrophyDeg` becomes the robust angle. `Phases` / `PhaseContext` types are unchanged. `ruleC3` is unchanged (still reads `kneeFlexionAtTrophyDeg`); its landmark-highlight list may later drop the occluded knee, but that is cosmetic and out of scope.

## Success metrics

- **Demo clip (integration / manual):** `detectPhases` on the real extracted+smoothed poses returns `trophyFrame ∈ [16, 22]`, `contactFrame ∈ [34, 38]`, `followStartFrame > contactFrame`, `confidence: 'high'`.
- **Synthetic unit tests (TDD, written first):**
  1. A serve where the deepest knee bend is *after* contact (the landing-crouch case) → trophy is detected before contact, not at the crouch. *(Direct regression for this bug.)*
  2. A serve where the back (far) knee is flagged low-visibility with a spuriously small angle → `kneeJointAngle` returns the front knee's angle; trophy is unaffected.
  3. A serve where the toss arm is only briefly extended → trophy lands inside the toss-arm-extended window, not at an unrelated overhead frame.
  4. Contact independence: a deliberately broken/garbage trophy region still yields a correct `contactFrame` (was `-1` before).
  5. `kneeJointAngle` returns `NaN` when both knees are below `KNEE_MIN_VISIBILITY` → C3 renders `unknown`.
- **No regressions:** the existing `detectPhases.test.ts`, `metrics.test.ts`, `ruleC3.test.ts`, `buildPhaseContext.test.ts`, and the pipeline integration test pass (updated only where they asserted the old `min(left,right)` knee behavior).
- `npm run build` (TypeScript + Vite) succeeds.

## Risks / open questions

- **Trophy-bump mistaken for contact.** Mitigated by selecting the global max height among extended-elbow peaks (contact is the highest reach). If a clip has a freak trophy spike higher than contact, contact detection stays `confident: false` and the result is flagged low-confidence — same failure surface as today, no crash.
- **`KNEE_MIN_VISIBILITY = 0.5` vs the lenient UI visibility gate (0.30).** The gate decides whether to analyze *at all*; the knee floor decides *which leg to trust* once we do. They are intentionally different thresholds; both are named with comments. If on real amateur clips both knees routinely fall below 0.5, revisit by lowering the floor rather than reverting to `min`.
- **`TOSS_ARM_PEAK_BAND` too tight** could empty the candidate set on a flat/low toss → falls back to the knee-only path within `[0, contactFrame)` at `confidence: 'low'`. Acceptable: bounding by contact already removes the worst artifact even without the toss gate.
- **C3 metric shift.** Switching the metric from `min(both)` to the visible knee changes the reported angle for clips with a noisy back leg. This is the intended correction (the old value was an artifact), but it will move some C3 verdicts; call it out in the commit and the C3 test update.
- **Offline harness ≠ browser exactly.** The reproduction sampled via OpenCV at 30 fps; the browser seeks `<video>` at 1/30 s. Frame indices can differ by ±1; the ±2-frame tolerance in the success metric absorbs this.
```
