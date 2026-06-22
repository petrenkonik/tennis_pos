# Trophy Detection Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make trophy detection anchor on contact, use an occlusion-robust knee angle, and gate candidates by toss-arm extension, so the trophy event no longer slides onto the post-contact landing crouch.

**Architecture:** Reorder `detectPhases()` to detect contact first (global, trophy-independent), then search the trophy only in `[0, contactFrame)` among "racket overhead + toss-arm extended" frames, picking the deepest *robust* knee bend. Knee angle switches from `min(left, right)` (which prefers the occluded far leg) to the more-visible knee.

**Tech Stack:** TypeScript, Vitest, MediaPipe BlazePose 33-landmark model (already wired). No new dependencies.

## Global Constraints

- All code comments and docs in **English** (task-rules §8). No user-facing strings added in this work.
- Every numeric threshold is a **named constant** in `src/constants/biomechanics.ts` with a source comment (task-rules §6). No magic literals in logic.
- **TDD**: write the failing test first, watch it fail, then the minimal implementation (task-rules §3). Algorithmic core is pure functions of pose data — test with **synthetic** poses, never real video.
- `detectPhases()` public signature is unchanged: `detectPhases(poses: PoseFrame[], h: Handedness, gate?: GateOptions): Phases`.
- `Phases` / `PhaseContext` types unchanged. The metric field stays named `kneeFlexionAtTrophyDeg` (ruleC3 reads it) — only its *source* changes.
- Existing test suite is green at baseline (verified: 25/25 across the four affected files). No existing test may regress; tests asserting the old `min(left,right)` knee semantics are updated, not deleted.
- Spec: `docs/superpowers/specs/2026-06-21-trophy-detection-fix-design.md`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/constants/biomechanics.ts` | All thresholds | **Modify** — add `KNEE_MIN_VISIBILITY`, `TOSS_ARM_PEAK_BAND` |
| `src/pose/metrics.ts` | Per-frame scalar metrics | **Modify** — replace `kneeFlexion` with occlusion-robust `kneeJointAngle`; add `tossWristHeight` |
| `src/pose/metrics.test.ts` | Metric unit tests | **Modify** — rename + add occlusion/NaN/toss tests |
| `src/pipeline/detectPhases.ts` | Phase split | **Modify** — contact-first ordering, trophy bounded + toss-gated, robust knee |
| `src/__tests__/fixtures/poses.ts` | Synthetic pose builders | **Modify** — add `toss()` helper + `buildLandingCrouchServe`, `buildTossGateServe` |
| `src/pipeline/detectPhases.test.ts` | Phase-detection tests | **Modify** — add regression + toss-gate + contact-independence tests |
| `src/pipeline/buildPhaseContext.ts` | Metric assembly for rules | **Modify** — source `kneeFlexionAtTrophyDeg` from `kneeJointAngle` |
| `src/pipeline/buildPhaseContext.test.ts` | Context test | **Modify** — import rename |

`ruleC3.ts` / `ruleC3.test.ts` are **not** touched (field name unchanged).

---

## Task 1: Occlusion-robust knee angle + toss-arm height metric

**Files:**
- Modify: `src/constants/biomechanics.ts`
- Modify: `src/pose/metrics.ts`
- Test: `src/pose/metrics.test.ts`

**Interfaces:**
- Consumes: `jointAngle` (`src/pose/geometry.ts`), `LM`, `tossWrist` (`src/pose/landmarks.ts` — `tossWrist` already exists).
- Produces:
  - `kneeJointAngle(f: PoseFrame): number` — joint angle (180°=straight) of the more-visible knee; `NaN` if neither knee clears `KNEE_MIN_VISIBILITY`.
  - `tossWristHeight(f: PoseFrame, h: Handedness): number` — `1 - tossWrist(f,h).y`.
  - Constants `KNEE_MIN_VISIBILITY: number`, `TOSS_ARM_PEAK_BAND: number`.
  - `kneeFlexion` is **removed** (renamed to `kneeJointAngle`).

- [ ] **Step 1: Add the two constants**

In `src/constants/biomechanics.ts`, append:

```typescript
// Below this visibility a knee landmark is occluded/unreliable. kneeJointAngle
// then trusts the other leg instead. On a side view the far leg is routinely
// occluded and its angle drifts small — the old min(L,R) preferred exactly that
// noisy leg. 0.5 matches the research-grade VISIBILITY_THRESHOLD above.
export const KNEE_MIN_VISIBILITY = 0.5;

// At trophy the toss arm is near its vertical peak. A frame counts as
// "toss arm extended up" when its toss-wrist height is within this band of the
// peak toss height observed before contact. Empirical; loosened for amateur
// tosses that never reach full extension. Provisional pending calibration.
export const TOSS_ARM_PEAK_BAND = 0.10;
```

- [ ] **Step 2: Write the failing metric tests**

Replace the body of `src/pose/metrics.test.ts` with (note: `kneeFlexion` → `kneeJointAngle`, plus new cases):

```typescript
import { describe, it, expect } from 'vitest';
import { kneeJointAngle, elbowExtension, racketWristHeight, tossWristHeight } from './metrics';
import { LM } from './landmarks';
import type { PoseFrame, Landmark } from '../types';

function makeLandmarks(overrides: Record<number, Partial<Landmark>> = {}): Landmark[] {
  const a: Landmark[] = [];
  for (let i = 0; i < 33; i++) a.push({ x: 0.5, y: 0.5, z: 0, visibility: 1 });
  for (const k of Object.keys(overrides)) {
    const i = Number(k);
    a[i] = { ...a[i], ...overrides[i] };
  }
  return a;
}
const frame = (lm: Landmark[]): PoseFrame => ({ frameIndex: 0, timestampMs: 0, landmarks: lm });

describe('pose metrics', () => {
  it('kneeJointAngle returns 180 for straight legs', () => {
    const f = frame(makeLandmarks({
      [LM.L_HIP]: { x: 0.5, y: 0.4 }, [LM.L_KNEE]: { x: 0.5, y: 0.6 }, [LM.L_ANKLE]: { x: 0.5, y: 0.8 },
      [LM.R_HIP]: { x: 0.5, y: 0.4 }, [LM.R_KNEE]: { x: 0.5, y: 0.6 }, [LM.R_ANKLE]: { x: 0.5, y: 0.8 },
    }));
    expect(kneeJointAngle(f)).toBeCloseTo(180, 1);
  });

  it('kneeJointAngle trusts the more-visible knee, not the more-bent one', () => {
    // Far leg (left) is occluded (vis 0.2) AND geometrically bent; the visible
    // right leg is straight. The old min(L,R) returned the bent ~<160; the
    // robust version must return the straight (right) leg's ~180.
    const f = frame(makeLandmarks({
      [LM.L_HIP]: { x: 0.5, y: 0.4 }, [LM.L_KNEE]: { x: 0.5, y: 0.6, visibility: 0.2 }, [LM.L_ANKLE]: { x: 0.72, y: 0.78 },
      [LM.R_HIP]: { x: 0.5, y: 0.4 }, [LM.R_KNEE]: { x: 0.5, y: 0.6, visibility: 1 }, [LM.R_ANKLE]: { x: 0.5, y: 0.8 },
    }));
    expect(kneeJointAngle(f)).toBeCloseTo(180, 1);
  });

  it('kneeJointAngle returns NaN when neither knee is visible enough', () => {
    const f = frame(makeLandmarks({
      [LM.L_KNEE]: { visibility: 0.2 }, [LM.R_KNEE]: { visibility: 0.2 },
    }));
    expect(Number.isNaN(kneeJointAngle(f))).toBe(true);
  });

  it('kneeJointAngle picks the more bent leg when both are equally visible', () => {
    const f = frame(makeLandmarks({
      [LM.L_HIP]: { x: 0.5, y: 0.4 }, [LM.L_KNEE]: { x: 0.5, y: 0.6 }, [LM.L_ANKLE]: { x: 0.5, y: 0.8 }, // straight
      [LM.R_HIP]: { x: 0.5, y: 0.4 }, [LM.R_KNEE]: { x: 0.5, y: 0.6 }, [LM.R_ANKLE]: { x: 0.72, y: 0.78 }, // bent
    }));
    expect(kneeJointAngle(f)).toBeLessThan(160);
  });

  it('elbowExtension returns 180 for a straight racket arm', () => {
    const f = frame(makeLandmarks({
      [LM.R_SHOULDER]: { x: 0.5, y: 0.55 }, [LM.R_ELBOW]: { x: 0.5, y: 0.35 }, [LM.R_WRIST]: { x: 0.5, y: 0.15 },
    }));
    expect(elbowExtension(f, 'right')).toBeCloseTo(180, 1);
  });

  it('racketWristHeight inverts y', () => {
    const f = frame(makeLandmarks({ [LM.R_WRIST]: { x: 0.5, y: 0.2 } }));
    expect(racketWristHeight(f, 'right')).toBeCloseTo(0.8, 5);
  });

  it('tossWristHeight inverts y of the toss arm (left wrist for a righty)', () => {
    const f = frame(makeLandmarks({ [LM.L_WRIST]: { x: 0.5, y: 0.2 } }));
    expect(tossWristHeight(f, 'right')).toBeCloseTo(0.8, 5);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/pose/metrics.test.ts`
Expected: FAIL — `kneeJointAngle` / `tossWristHeight` are not exported (import error).

- [ ] **Step 4: Implement the metrics**

Replace `src/pose/metrics.ts` with:

```typescript
import type { PoseFrame, Handedness } from '../types';
import { jointAngle } from './geometry';
import { LM, racketWrist, racketElbow, racketShoulder, tossWrist } from './landmarks';
import { KNEE_MIN_VISIBILITY } from '../constants/biomechanics';

// Knee JOINT angle (180° = straight, smaller = more bent) of the more-trustworthy
// leg. On a side view the far leg is routinely occluded and its estimated angle
// drifts small, so we pick the more-VISIBLE knee rather than the more-bent one
// (the old min(L,R) preferred exactly the noisy occluded leg). Returns NaN when
// neither knee clears KNEE_MIN_VISIBILITY — callers treat NaN as "knee unknown".
export function kneeJointAngle(f: PoseFrame): number {
  const lVis = f.landmarks[LM.L_KNEE].visibility;
  const rVis = f.landmarks[LM.R_KNEE].visibility;
  const lOk = lVis >= KNEE_MIN_VISIBILITY;
  const rOk = rVis >= KNEE_MIN_VISIBILITY;
  if (!lOk && !rOk) return NaN;
  const left = jointAngle(f.landmarks[LM.L_HIP], f.landmarks[LM.L_KNEE], f.landmarks[LM.L_ANKLE]);
  const right = jointAngle(f.landmarks[LM.R_HIP], f.landmarks[LM.R_KNEE], f.landmarks[LM.R_ANKLE]);
  if (lOk && !rOk) return left;
  if (rOk && !lOk) return right;
  if (lVis > rVis) return left;
  if (rVis > lVis) return right;
  // Equally visible (both trustworthy): fall back to the more-bent leg.
  return Math.min(left, right);
}

// 180° = fully extended racket arm.
export function elbowExtension(f: PoseFrame, h: Handedness): number {
  return jointAngle(racketShoulder(f, h), racketElbow(f, h), racketWrist(f, h));
}

// Image y grows downward; invert so larger = higher.
export function racketWristHeight(f: PoseFrame, h: Handedness): number {
  return 1 - racketWrist(f, h).y;
}

// Toss-arm wrist height (1 - y); larger = arm raised higher. Used by the trophy
// toss-arm-extended gate.
export function tossWristHeight(f: PoseFrame, h: Handedness): number {
  return 1 - tossWrist(f, h).y;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/pose/metrics.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/constants/biomechanics.ts src/pose/metrics.ts src/pose/metrics.test.ts
git commit -m "refactor(pose): occlusion-robust kneeJointAngle + tossWristHeight

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Synthetic fixtures for the new trophy cases

**Files:**
- Modify: `src/__tests__/fixtures/poses.ts`

**Interfaces:**
- Consumes: `makeLandmarks`, `makeFrame`, `LM`, the existing private `knee()` / `arm()` helpers.
- Produces:
  - `buildLandingCrouchServe(): PoseFrame[]` — trophy at frame 2, contact at 4, with the **deepest knee bend after contact** (frames 5–6, the landing crouch) while still overhead. Reproduces the demo-clip bug.
  - `buildTossGateServe(): PoseFrame[]` — within `[0, contact)` an overhead frame (1) has a deeper knee but the toss arm is **down**; the real trophy (frame 2) has less knee bend but the toss arm is **up**.

This task adds builders only; they are exercised by Task 3's tests. It is committed with Task 3 (a fixture with no consumer is not independently meaningful) — but kept as its own step block for clarity.

- [ ] **Step 1: Add a toss-arm helper and the two builders**

In `src/__tests__/fixtures/poses.ts`, after the existing `arm()` helper and `nose` constant, add:

```typescript
// Toss arm (left wrist for a righty) at a given height-y. Lower y = raised higher.
function toss(wristY: number) {
  return { [LM.L_WRIST]: { x: 0.5, y: wristY } };
}

// Right-handed serve where the DEEPEST knee bend lands AFTER contact (the landing
// crouch at f5-f6) while the racket wrist is still above the nose. The old
// "deepest knee among overhead frames" rule picked f5; the contact-bounded rule
// must pick the real trophy at f2. trophy=2, contact=4, followStart=6.
export function buildLandingCrouchServe(): PoseFrame[] {
  // [knee bend, racket wristY, racket elbowY, toss wristY]
  const specs: Array<['straight'|'bent'|'deep', number, number, number]> = [
    ['straight', 0.70, 0.62, 0.70], // f0 prep, racket low, toss low
    ['bent',     0.55, 0.50, 0.45], // f1 rising (not overhead), toss rising
    ['bent',     0.45, 0.42, 0.15], // f2 TROPHY: overhead, toss UP, knee bent
    ['bent',     0.30, 0.28, 0.30], // f3 overhead, rising, toss dropping
    ['straight', 0.12, 0.32, 0.55], // f4 CONTACT: highest + straight elbow
    ['deep',     0.40, 0.45, 0.70], // f5 post-contact: overhead, DEEPEST knee (landing load)
    ['deep',     0.62, 0.58, 0.75], // f6 follow start: wrist below shoulder, knee deep
  ];
  return specs.map(([bend, wY, eY, tY], i) =>
    makeFrame(i, makeLandmarks({ ...nose, ...knee(bend), ...arm(wY, eY), ...toss(tY) })));
}

// Right-handed serve isolating the toss-arm gate: f1 is overhead with the deepest
// knee but the toss arm is DOWN (decoy); f2 is the real trophy (toss arm UP, knee
// less bent). The gate must reject f1 and pick f2. trophy=2, contact=4, followStart=5.
export function buildTossGateServe(): PoseFrame[] {
  const specs: Array<['straight'|'bent'|'deep', number, number, number]> = [
    ['straight', 0.70, 0.62, 0.70], // f0 prep
    ['deep',     0.45, 0.42, 0.70], // f1 overhead, DEEP knee, toss DOWN (decoy)
    ['bent',     0.44, 0.41, 0.15], // f2 TROPHY: overhead, BENT knee, toss UP
    ['bent',     0.30, 0.28, 0.30], // f3 overhead, rising
    ['straight', 0.12, 0.32, 0.55], // f4 CONTACT: highest + straight elbow
    ['straight', 0.62, 0.58, 0.60], // f5 follow start: wrist below shoulder
  ];
  return specs.map(([bend, wY, eY, tY], i) =>
    makeFrame(i, makeLandmarks({ ...nose, ...knee(bend), ...arm(wY, eY), ...toss(tY) })));
}
```

- [ ] **Step 2: Verify the fixtures compile (no test yet)**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors). The builders are unused until Task 3 — that is fine for a type check.

(No commit here — committed together with Task 3.)

---

## Task 3: Contact-first, trophy-bounded, toss-gated detection

**Files:**
- Modify: `src/pipeline/detectPhases.ts`
- Test: `src/pipeline/detectPhases.test.ts`
- Depends on: Task 1 (`kneeJointAngle`, `tossWristHeight`, constants), Task 2 (fixtures)

**Interfaces:**
- Consumes: `kneeJointAngle`, `elbowExtension`, `racketWristHeight`, `tossWristHeight` (`src/pose/metrics.ts`); `racketWrist`, `racketShoulder` (`src/pose/landmarks.ts`); `localMaxima` (`src/pose/geometry.ts`); constants `CONTACT_ELBOW_MIN_DEG`, `CONTACT_HEIGHT_PROMINENCE`, `TROPHY_OVERHEAD_REF_LM`, `TOSS_ARM_PEAK_BAND`, plus the existing gate constants; `buildLandingCrouchServe`, `buildTossGateServe`, `buildHappyServe`, `makeFrame`, `makeLandmarks`.
- Produces: unchanged public `detectPhases(...)`. Internal (non-exported) helpers `detectContact`, `detectTrophy`.

- [ ] **Step 1: Write the failing detection tests**

Append these tests inside the `describe('detectPhases', ...)` block in `src/pipeline/detectPhases.test.ts`, and add the two fixtures to the existing import on line 3:

```typescript
// add to the import: buildLandingCrouchServe, buildTossGateServe
  it('picks the pre-contact trophy even when the deepest knee bend is after contact', () => {
    // Regression for the demo clip: deepest knee bend is the landing crouch (f5-f6),
    // which the old "deepest knee among overhead frames" rule wrongly chose.
    const r = detectPhases(buildLandingCrouchServe(), 'right');
    expect(r.events.trophyFrame).toBe(2);
    expect(r.events.contactFrame).toBe(4);
    expect(r.events.followStartFrame).toBe(6);
    expect(r.confidence).toBe('high');
  });

  it('detects contact independently of a bad trophy region (no -1 fallback)', () => {
    // Same fixture: even though the global knee minimum is post-contact, contact
    // is still found at the racket-height peak — it does not depend on trophy.
    const r = detectPhases(buildLandingCrouchServe(), 'right');
    expect(r.events.contactFrame).toBe(4);
    expect(r.events.trophyFrame).toBeLessThan(r.events.contactFrame);
  });

  it('rejects an overhead frame with the toss arm down in favour of the real trophy', () => {
    // f1 is overhead with a deeper knee but the toss arm is down; the gate must
    // pick f2 (toss arm extended up), even though f1 is more bent.
    const r = detectPhases(buildTossGateServe(), 'right');
    expect(r.events.trophyFrame).toBe(2);
    expect(r.events.contactFrame).toBe(4);
    expect(r.confidence).toBe('high');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/pipeline/detectPhases.test.ts`
Expected: FAIL — the new tests fail (old logic picks `trophyFrame === 5` on the landing-crouch fixture and `1` on the toss-gate fixture). The 8 pre-existing tests still pass.

- [ ] **Step 3: Rewrite the detection core**

Replace the body of `src/pipeline/detectPhases.ts` from the imports through `detectPhases` with the version below. Keep `ServeRejectCode`, `ServeRejectDetail`, `ServeNotRecognizedError`, `CRITICAL_LM`, `CRITICAL_LM_KEYS`, `pct`, `visibilityBreakdown`, `GateOptions`, `assemble`, `timeBasedFallback` **exactly as they are** — only the imports (line 1–9), the two new helper functions, and the `detectPhases` body (the numbered sections) change.

Replace the import block (original lines 1–9) with this verbatim. `LM` stays (used by `CRITICAL_LM`/`CRITICAL_LM_KEYS`); `racketWrist`/`racketShoulder` stay (used by `detectTrophy` and the follow-through loop); `kneeFlexion` → `kneeJointAngle` and `tossWristHeight` are added; `TOSS_ARM_PEAK_BAND` is added to the constants import:

```typescript
import type { PoseFrame, Phases, Handedness, Confidence } from '../types';
import { LM, racketWrist, racketShoulder } from '../pose/landmarks';
import { kneeJointAngle, elbowExtension, racketWristHeight, tossWristHeight } from '../pose/metrics';
import { localMaxima } from '../pose/geometry';
import {
  CONTACT_ELBOW_MIN_DEG, CONTACT_HEIGHT_PROMINENCE, VISIBILITY_THRESHOLD,
  MAX_LOW_VIS_FRACTION, FALLBACK_PREP_FRACTION, FALLBACK_ACCEL_FRACTION,
  DIAGNOSTIC_MIN_LOW_FRAC, TROPHY_OVERHEAD_REF_LM, TOSS_ARM_PEAK_BAND,
} from '../constants/biomechanics';
```

Add these two helper functions immediately above the `export function detectPhases(...)` declaration:

```typescript
// Contact = global highest racket-wrist peak with an extended elbow. Detected
// independently of trophy on purpose: the old "highest peak AFTER trophy" coupling
// let a misdetected (late) trophy suppress contact entirely (contactFrame === -1).
function detectContact(poses: PoseFrame[], h: Handedness): { frame: number; confident: boolean } {
  const last = poses.length - 1;
  const heights = poses.map(p => racketWristHeight(p, h));
  const peaks = localMaxima(heights, CONTACT_HEIGHT_PROMINENCE);
  let frame = -1, best = -Infinity;
  for (const i of peaks) {
    if (elbowExtension(poses[i], h) >= CONTACT_ELBOW_MIN_DEG && heights[i] > best) {
      best = heights[i]; frame = i;
    }
  }
  if (frame >= 0) return { frame, confident: true };
  // No clean extended-elbow peak: best-effort global max height, low confidence.
  for (let i = 0; i <= last; i++) if (heights[i] > best) { best = heights[i]; frame = i; }
  return { frame, confident: false };
}

// Trophy = within [0, searchEnd): an "overhead AND toss-arm-extended" frame with
// the deepest robust knee bend. Bounding by contact removes the post-contact
// landing-crouch knee minimum; the toss-arm gate removes unrelated overhead frames.
// Returns frame -1 when no frame is overhead at all (trophy "not expressed") so
// the caller can use the time-based fallback.
function detectTrophy(
  poses: PoseFrame[], h: Handedness, searchEnd: number,
): { frame: number; confident: boolean } {
  const end = Math.min(searchEnd, poses.length);
  let peakToss = -Infinity;
  for (let i = 0; i < end; i++) peakToss = Math.max(peakToss, tossWristHeight(poses[i], h));
  const tossFloor = peakToss - TOSS_ARM_PEAK_BAND;

  let frame = -1, minAngle = Infinity;
  let anyOverhead = false, tossPeakFrame = -1, tossPeakH = -Infinity;
  for (let i = 0; i < end; i++) {
    const tossH = tossWristHeight(poses[i], h);
    if (tossH > tossPeakH) { tossPeakH = tossH; tossPeakFrame = i; }
    const overhead = racketWrist(poses[i], h).y < poses[i].landmarks[TROPHY_OVERHEAD_REF_LM].y;
    if (overhead) anyOverhead = true;
    if (!overhead || tossH < tossFloor) continue;
    const ang = kneeJointAngle(poses[i]);
    if (Number.isNaN(ang)) continue;
    if (ang < minAngle) { minAngle = ang; frame = i; }
  }
  if (frame >= 0) return { frame, confident: true };
  if (!anyOverhead) return { frame: -1, confident: false }; // not expressed → caller falls back
  // Overhead frames existed but knees were unreadable → use the toss peak, low conf.
  return { frame: tossPeakFrame, confident: false };
}
```

Replace the `detectPhases` body from `const last = poses.length - 1;` (the line after the visibility gate, originally line 121) through the `return assemble(...)` at the end with:

```typescript
  const last = poses.length - 1;

  // 2) contact first (trophy-independent), then trophy bounded before it.
  const contact = detectContact(poses, h);
  const searchEnd = contact.confident ? contact.frame : last + 1;
  const trophy = detectTrophy(poses, h, searchEnd);
  if (trophy.frame < 0) return timeBasedFallback(poses, h);

  let trophyFrame = trophy.frame;
  let contactFrame = contact.frame;
  let confidence: Confidence = contact.confident && trophy.confident ? 'high' : 'low';

  // 3) follow-through start = first post-contact frame with wrist below shoulder
  let followStartFrame = -1;
  for (let i = contactFrame + 1; i <= last; i++) {
    if (racketWrist(poses[i], h).y > racketShoulder(poses[i], h).y) { followStartFrame = i; break; }
  }
  if (followStartFrame < 0) { followStartFrame = last; confidence = 'low'; }

  // 4) invariant guard: trophy < contact < followStart, each pair at least 1 apart.
  // Order alone is not enough — without the +1 floor the contact/trophy frames
  // can collapse onto each other and produce degenerate [n, n] phase intervals.
  const clampMinWidths = (): void => {
    contactFrame = Math.min(Math.max(contactFrame, trophyFrame + 1), last);
    followStartFrame = Math.min(Math.max(followStartFrame, contactFrame + 1), last);
  };
  if (!(trophyFrame < contactFrame && contactFrame < followStartFrame)) {
    confidence = 'low';
    clampMinWidths();
  } else if (contactFrame === trophyFrame + 1 && contactFrame === followStartFrame) {
    // ordered but degenerate (collapsed triple) — widen defensively
    confidence = 'low';
    clampMinWidths();
  }

  return assemble(h, trophyFrame, contactFrame, followStartFrame, last, confidence);
```

> The old section "2) trophy = min knee flexion among 'racket overhead' frames" and "3) contact = highest qualifying racket-wrist peak after trophy" are deleted — replaced by the `detectContact` / `detectTrophy` calls above.

- [ ] **Step 4: Run the full detection + metrics suite to verify it passes**

Run: `npx vitest run src/pipeline/detectPhases.test.ts src/pose/metrics.test.ts`
Expected: PASS — 8 original + 3 new detectPhases tests, plus the 7 metrics tests.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/detectPhases.ts src/pipeline/detectPhases.test.ts src/__tests__/fixtures/poses.ts
git commit -m "fix(phases): anchor trophy on contact, gate by toss arm, robust knee

Trophy was 'deepest knee bend among overhead frames', which on real side-view
footage migrated to the post-contact landing crouch (the occluded far knee
drifts small and stays overhead). Now: detect contact first (trophy-independent),
search trophy only in [0, contact) among overhead + toss-arm-extended frames,
and choose the deepest visible-knee bend.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Feed the robust knee into the C3 metric

**Files:**
- Modify: `src/pipeline/buildPhaseContext.ts`
- Test: `src/pipeline/buildPhaseContext.test.ts`
- Depends on: Task 1

**Interfaces:**
- Consumes: `kneeJointAngle` (`src/pose/metrics.ts`).
- Produces: `buildPhaseContext(...)` unchanged signature; `metrics.kneeFlexionAtTrophyDeg` now sourced from `kneeJointAngle` (so ruleC3 reports the same occlusion-robust angle used for detection).

- [ ] **Step 1: Update the failing test**

Replace `src/pipeline/buildPhaseContext.test.ts` with:

```typescript
import { describe, it, expect } from 'vitest';
import { buildPhaseContext } from './buildPhaseContext';
import { detectPhases } from './detectPhases';
import { buildHappyServe } from '../__tests__/fixtures/poses';
import { kneeJointAngle } from '../pose/metrics';

describe('buildPhaseContext', () => {
  it('exposes kneeFlexionAtTrophyDeg (robust knee) taken at the trophy frame', () => {
    const poses = buildHappyServe();
    const phases = detectPhases(poses, 'right');
    const ctx = buildPhaseContext(poses, 30, phases);
    expect(ctx.metrics.kneeFlexionAtTrophyDeg)
      .toBeCloseTo(kneeJointAngle(poses[phases.events.trophyFrame]), 5);
    expect(ctx.fps).toBe(30);
    expect(ctx.phases).toBe(phases);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/pipeline/buildPhaseContext.test.ts`
Expected: FAIL — `kneeJointAngle` is not imported by `buildPhaseContext.ts` yet; the context still uses `kneeFlexion` (now removed), so the file fails to compile / the assertion mismatches.

- [ ] **Step 3: Switch the source in buildPhaseContext**

Replace `src/pipeline/buildPhaseContext.ts` with:

```typescript
import type { PoseFrame, Phases, PhaseContext } from '../types';
import { kneeJointAngle } from '../pose/metrics';

// Computes the metrics rules read. The knee angle is taken at the already-detected
// trophy frame — rules consume this value rather than recomputing geometry. Uses
// the occlusion-robust kneeJointAngle so C3's verdict matches what trophy
// detection saw (same leg, same NaN-when-unreadable semantics).
export function buildPhaseContext(poses: PoseFrame[], fps: number, phases: Phases): PhaseContext {
  const tf = phases.events.trophyFrame;
  const kneeFlexionAtTrophyDeg =
    tf >= 0 && tf < poses.length ? kneeJointAngle(poses[tf]) : NaN;
  return { poses, fps, phases, metrics: { kneeFlexionAtTrophyDeg } };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/pipeline/buildPhaseContext.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/buildPhaseContext.ts src/pipeline/buildPhaseContext.test.ts
git commit -m "fix(phases): source C3 knee metric from robust kneeJointAngle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Full-suite verification and demo sanity check

**Files:** none (verification only)

- [ ] **Step 1: Run the entire test suite**

Run: `npx vitest run`
Expected: PASS — all suites green (the 25 baseline tests in the four touched files, now with the added cases, plus every untouched suite). No test references the removed `kneeFlexion`.

- [ ] **Step 2: Type-check and build**

Run: `npm run build`
Expected: PASS — TypeScript compiles, Vite build succeeds, no unused-import or missing-export errors.

- [ ] **Step 3: Demo-clip sanity check (manual, optional)**

If the offline harness (`_analyze_demo.py` + the `/tmp/mpenv` venv) is still available, re-run it and confirm the success metric from the spec:

Run: `/tmp/mpenv/Scripts/python.exe _analyze_demo.py` (after pasting the new `detectTrophy`/`detectContact` ordering into its Python mirror, or just confirm in-browser)
Expected: trophy frame ∈ [16, 22], contact frame ∈ [34, 38] (was trophy 40 / contact -1). If the harness was cleaned up, load the demo clip in the running app (`npm run dev` → "Try a demo serve") and confirm the trophy marker sits on the racket-behind-head pose, not the post-contact swing.

> This step is a confirmation, not a gate — the synthetic regression test in Task 3 (`picks the pre-contact trophy even when the deepest knee bend is after contact`) is the automated guard for this bug.

- [ ] **Step 4: Update the spec status**

Edit `docs/superpowers/specs/2026-06-21-trophy-detection-fix-design.md` line 4: change `**Status:** Under review` to `**Status:** Implemented`.

```bash
git add docs/superpowers/specs/2026-06-21-trophy-detection-fix-design.md
git commit -m "docs: mark trophy-detection-fix spec implemented

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- A (contact-first, trophy bounded by `[0, contact)`) → Task 3 (`detectContact`, `searchEnd`, `detectTrophy`).
- B (toss-arm gate) → Task 1 (`tossWristHeight`), Task 3 (`tossFloor` gate), Task 2/3 (`buildTossGateServe` + test).
- C (occlusion-robust knee) → Task 1 (`kneeJointAngle`), Task 4 (C3 metric source), tests in Task 1.
- D (overhead ref stays `nose`) → no code change; `TROPHY_OVERHEAD_REF_LM` reused as-is (documented in spec, intentionally not enabled).
- Success metric "trophy within ±2 frames / contact found" → Task 3 regression tests + Task 5 demo check.
- Success metric "5 synthetic tests" → kneeJointAngle robust (Task 1), kneeJointAngle NaN (Task 1), landing-crouch regression (Task 3), toss-gate (Task 3), contact-independence (Task 3).
- "No regressions" → Task 5 full suite + build.
- Non-goal "no new confidence tier" → `Confidence` untouched; only `'high'`/`'low'` produced.

**Placeholder scan:** No TBD / "handle edge cases" / "similar to" / bodiless code steps — every code step shows full content.

**Type consistency:** `kneeJointAngle(f: PoseFrame): number` (Task 1) is consumed with that exact signature in Task 3 and Task 4. `tossWristHeight(f, h)` (Task 1) consumed in Task 3. `detectContact`/`detectTrophy` return `{ frame: number; confident: boolean }` and are consumed as `.frame` / `.confident` in `detectPhases`. The metric field stays `kneeFlexionAtTrophyDeg` everywhere (types.ts, buildPhaseContext, ruleC3 — ruleC3 untouched).


---

# Task 6: Calibration — anchor trophy on toss-arm peak, relax contact gates, window the C3 knee

**Why:** Tasks 1–5 fixed the gross bug, but a demo-clip check (heavy model, 30 fps — the browser's real path) showed the success metric was not yet met: trophy landed on frame 25 (the racket-drop) instead of [16,22], and contact, though on the right frame (36), was flagged low-confidence. Evidence from a per-frame dump:
- The visible (right) knee genuinely keeps flexing from the trophy pose (~f17) through the racket drop to peak load (~f28). So "deepest knee among overhead frames" anchors trophy on the racket-drop, not the pose. The **toss-arm vertical peak (f17)** coincides with the trophy pose and is the better anchor.
- The real contact peak has height-prominence ~0.020 (< the 0.05 threshold) and an elbow angle of ~147° (< the 160° threshold), so both contact gates were too strict for smoothed amateur footage.
- Because trophy moves to the pose (where the knee is only ~168°), the C3 "knee bend" metric must measure the **deepest** knee flexion over the trophy→contact window, not the instantaneous trophy-frame angle, or it would falsely report "barely bent".

Decision (made with the user): anchor trophy on the toss-arm peak; relax the two contact thresholds; window the C3 knee. Confirmed on the demo via the offline harness: **trophy=17, contact=36 (confident), C3 knee=147°** (within the normal [140,160] range = "ok").

**Files:**
- Modify: `src/constants/biomechanics.ts`
- Modify: `src/pipeline/detectPhases.ts`
- Modify: `src/__tests__/fixtures/poses.ts`
- Modify: `src/pipeline/detectPhases.test.ts`
- Modify: `src/pipeline/buildPhaseContext.ts`
- Modify: `src/pipeline/buildPhaseContext.test.ts`
- Modify: `src/rules/ruleC3.ts` (comment only)

**Interfaces:**
- Consumes: `kneeJointAngle`, `tossWristHeight`, `racketWristHeight`, `elbowExtension` (`src/pose/metrics.ts`); `racketWrist` (`src/pose/landmarks.ts`); `localMaxima` (`src/pose/geometry.ts`).
- Produces: `detectTrophy` now anchors on the toss-arm peak; `buildPhaseContext` sources `kneeFlexionAtTrophyDeg` as the min knee joint angle over `[trophyFrame, contactFrame)`. Public signatures unchanged. The constant `TOSS_ARM_PEAK_BAND` is **removed** (no longer used).

---

- [ ] **Step 1: Relax the contact thresholds; remove the unused toss band**

In `src/constants/biomechanics.ts`:

Change `CONTACT_ELBOW_MIN_DEG` (currently `160`) to:

```typescript
// Racket arm considered "extended" at contact (elbowExtension >= this).
// Calibrated down from 160 on the demo clip: at the true contact frame the
// smoothed shoulder-elbow-wrist angle reads ~147 deg (overhead self-occlusion
// flattens the estimate), so 160 rejected the real contact. Provisional.
export const CONTACT_ELBOW_MIN_DEG = 140;
```

Change `CONTACT_HEIGHT_PROMINENCE` (currently `0.05`) to:

```typescript
// Minimum normalized height rise for a racket-wrist peak to count (noise filter).
// Calibrated down from 0.05: after the mandatory trajectory smoothing the real
// contact peak on the demo clip has a prominence of only ~0.02, so 0.05 rejected
// it and forced the low-confidence global-max fallback. Provisional.
export const CONTACT_HEIGHT_PROMINENCE = 0.015;
```

Delete the `TOSS_ARM_PEAK_BAND` constant block entirely (the trophy detector no longer uses a band — it anchors on the toss peak directly).

- [ ] **Step 2: Add the toss-anchor fixture**

In `src/__tests__/fixtures/poses.ts`, after `buildTossGateServe`, add:

```typescript
// Right-handed serve where the toss-arm peak (f2) is the trophy pose, but a LATER
// overhead frame (f4) has a deeper knee bend (the racket-drop load). The toss-peak
// anchor must pick f2; the old "deepest knee in window" rule would have picked f4.
// Also exercises the C3 trophy->contact knee window (deepest in [2,5) is f4).
// trophy=2, contact=5, followStart=6.
export function buildKneeAfterTrophyServe(): PoseFrame[] {
  const specs: Array<['straight'|'bent'|'deep', number, number, number]> = [
    ['straight', 0.70, 0.62, 0.70], // f0 prep
    ['bent',     0.55, 0.50, 0.45], // f1 rising (not overhead), toss rising
    ['bent',     0.45, 0.42, 0.10], // f2 TROPHY: overhead, toss arm PEAK (highest)
    ['bent',     0.42, 0.40, 0.40], // f3 overhead, toss dropping, knee a bit deeper
    ['deep',     0.40, 0.38, 0.55], // f4 overhead, DEEPEST knee (racket-drop load)
    ['straight', 0.12, 0.32, 0.55], // f5 CONTACT: highest + straight elbow
    ['straight', 0.62, 0.58, 0.60], // f6 follow start: wrist below shoulder
  ];
  return specs.map(([bend, wY, eY, tY], i) =>
    makeFrame(i, makeLandmarks({ ...nose, ...knee(bend), ...arm(wY, eY), ...toss(tY) })));
}
```

- [ ] **Step 3: Write the failing trophy-anchor test**

Add to `src/pipeline/detectPhases.test.ts` (extend the line-3 fixtures import with `buildKneeAfterTrophyServe`), inside the `describe('detectPhases', ...)` block:

```typescript
  it('anchors trophy on the toss-arm peak, not the deepest knee in the window', () => {
    // f2 is the toss-arm peak (trophy pose); f4 is overhead with a deeper knee
    // (racket-drop load). Trophy must be f2, proving the anchor is the toss peak.
    const r = detectPhases(buildKneeAfterTrophyServe(), 'right');
    expect(r.events.trophyFrame).toBe(2);
    expect(r.events.contactFrame).toBe(5);
    expect(r.confidence).toBe('high');
  });
```

- [ ] **Step 4: Run the new test to verify it fails**

Run: `npx vitest run src/pipeline/detectPhases.test.ts`
Expected: FAIL — the current (band + deepest-knee) `detectTrophy` picks `trophyFrame === 4` (the deeper knee), not 2. The 11 existing tests still pass.

- [ ] **Step 5: Replace `detectTrophy` with the toss-peak anchor**

In `src/pipeline/detectPhases.ts`, remove `TOSS_ARM_PEAK_BAND` from the import block (the `constants/biomechanics` import line), and replace the entire `detectTrophy` function (the block from its leading comment through its closing brace) with:

```typescript
// Trophy = the overhead frame nearest the toss-arm's vertical peak within
// [0, searchEnd). The toss arm reaches full extension at the trophy POSE (racket
// behind the head); the deepest knee bend comes a few frames LATER, during the
// racket drop / leg load, so anchoring on the toss peak (not the knee minimum)
// keeps trophy on the pose itself. Knee depth is only a tie-break between frames
// equidistant from the peak. Returns frame -1 when no frame is overhead (trophy
// "not expressed") so the caller can use the time-based fallback.
function detectTrophy(
  poses: PoseFrame[], h: Handedness, searchEnd: number,
): { frame: number; confident: boolean } {
  const end = Math.min(searchEnd, poses.length);
  if (end <= 0) return { frame: -1, confident: false };

  let tossPeakFrame = 0, tossPeakH = -Infinity;
  for (let i = 0; i < end; i++) {
    const th = tossWristHeight(poses[i], h);
    if (th > tossPeakH) { tossPeakH = th; tossPeakFrame = i; }
  }

  let frame = -1, bestDist = Infinity, bestKnee = Infinity;
  for (let i = 0; i < end; i++) {
    const overhead = racketWrist(poses[i], h).y < poses[i].landmarks[TROPHY_OVERHEAD_REF_LM].y;
    if (!overhead) continue;
    const dist = Math.abs(i - tossPeakFrame);
    const knee = kneeJointAngle(poses[i]);
    const kneeVal = Number.isNaN(knee) ? Infinity : knee;
    if (dist < bestDist || (dist === bestDist && kneeVal < bestKnee)) {
      bestDist = dist; bestKnee = kneeVal; frame = i;
    }
  }
  return frame >= 0 ? { frame, confident: true } : { frame: -1, confident: false };
}
```

Note: `tossWristHeight` and `kneeJointAngle` are already imported in this file (do not re-import). After removing `TOSS_ARM_PEAK_BAND`, make sure no other reference to it remains in the file.

- [ ] **Step 6: Run the detection suite to verify it passes**

Run: `npx vitest run src/pipeline/detectPhases.test.ts`
Expected: PASS — all 12 tests (11 prior + the new anchor test). The happy-serve, landing-crouch, and toss-gate fixtures still resolve to `trophyFrame === 2` (each one's toss peak is nearest frame 2), so the earlier assertions hold.

- [ ] **Step 7: Write the failing C3-window test**

Replace `src/pipeline/buildPhaseContext.test.ts` with:

```typescript
import { describe, it, expect } from 'vitest';
import { buildPhaseContext } from './buildPhaseContext';
import { detectPhases } from './detectPhases';
import { buildHappyServe, buildKneeAfterTrophyServe } from '../__tests__/fixtures/poses';
import { kneeJointAngle } from '../pose/metrics';

describe('buildPhaseContext', () => {
  it('exposes the deepest robust knee flexion over the trophy->contact window', () => {
    // buildKneeAfterTrophyServe: trophy=2, contact=5; the deepest knee in [2,5)
    // is f4 (the racket-drop load), not the trophy frame f2. The metric must be
    // f4's angle, proving it windows rather than reading a single frame.
    const poses = buildKneeAfterTrophyServe();
    const phases = detectPhases(poses, 'right');
    expect(phases.events.trophyFrame).toBe(2);
    expect(phases.events.contactFrame).toBe(5);
    const ctx = buildPhaseContext(poses, 30, phases);
    expect(ctx.metrics.kneeFlexionAtTrophyDeg).toBeCloseTo(kneeJointAngle(poses[4]), 5);
    expect(ctx.metrics.kneeFlexionAtTrophyDeg).toBeLessThan(kneeJointAngle(poses[2]));
  });

  it('passes through fps and the phases object', () => {
    const poses = buildHappyServe();
    const phases = detectPhases(poses, 'right');
    const ctx = buildPhaseContext(poses, 30, phases);
    expect(ctx.fps).toBe(30);
    expect(ctx.phases).toBe(phases);
  });
});
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `npx vitest run src/pipeline/buildPhaseContext.test.ts`
Expected: FAIL — current `buildPhaseContext` reads only the trophy frame (f2), so `kneeFlexionAtTrophyDeg` equals f2's angle, not f4's.

- [ ] **Step 9: Window the C3 knee in buildPhaseContext**

Replace `src/pipeline/buildPhaseContext.ts` with:

```typescript
import type { PoseFrame, Phases, PhaseContext } from '../types';
import { kneeJointAngle } from '../pose/metrics';

// Computes the metrics rules read. C3 measures knee bend as the DEEPEST robust
// knee flexion over the trophy->contact window (not a single frame): the trophy
// event sits on the trophy POSE, while peak leg load comes a few frames later
// during the racket drop. Reading only the trophy frame would under-report the
// bend. Falls back to the trophy frame if the window is empty; NaN when no frame
// has a readable knee (ruleC3 renders NaN as "unknown").
export function buildPhaseContext(poses: PoseFrame[], fps: number, phases: Phases): PhaseContext {
  const { trophyFrame, contactFrame } = phases.events;
  const lo = Math.max(0, trophyFrame);
  const hi = Math.min(contactFrame, poses.length);
  let minAngle = Infinity;
  for (let i = lo; i < hi; i++) {
    const a = kneeJointAngle(poses[i]);
    if (!Number.isNaN(a) && a < minAngle) minAngle = a;
  }
  let kneeFlexionAtTrophyDeg = Number.isFinite(minAngle) ? minAngle : NaN;
  if (Number.isNaN(kneeFlexionAtTrophyDeg) && trophyFrame >= 0 && trophyFrame < poses.length) {
    kneeFlexionAtTrophyDeg = kneeJointAngle(poses[trophyFrame]);
  }
  return { poses, fps, phases, metrics: { kneeFlexionAtTrophyDeg } };
}
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `npx vitest run src/pipeline/buildPhaseContext.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 11: Fix the stale ruleC3 comment**

In `src/rules/ruleC3.ts`, the comment near the `landmarks` array still describes the old `kneeFlexion()` / `Math.min` behavior. Replace the two-line comment:

```typescript
    // kneeFlexion() takes Math.min over both legs, so highlight both — the
    // skeleton overlay paints these landmarks by the rule's status.
```

with:

```typescript
    // The knee metric is the deepest robust (more-visible-leg) flexion over the
    // trophy->contact window; highlight both legs anyway — the skeleton overlay
    // paints these landmarks by the rule's status.
```

Do not change any logic in `ruleC3.ts`. (If the exact comment text differs slightly, match it on the `kneeFlexion()` / `Math.min` wording.)

- [ ] **Step 12: Run the full suite and build**

Run: `npx vitest run`
Expected: PASS — every suite green.

Run: `npm run build`
Expected: PASS — `tsc -b && vite build` succeed, no unused-symbol error for the removed `TOSS_ARM_PEAK_BAND`.

- [ ] **Step 13: Commit**

```bash
git add src/constants/biomechanics.ts src/pipeline/detectPhases.ts src/pipeline/detectPhases.test.ts src/__tests__/fixtures/poses.ts src/pipeline/buildPhaseContext.ts src/pipeline/buildPhaseContext.test.ts src/rules/ruleC3.ts
git commit -m "fix(phases): anchor trophy on toss-arm peak, relax contact gates, window C3 knee

Calibration after demo-clip verification: trophy was landing on the racket-drop
(deepest knee) instead of the trophy pose. Anchor trophy on the toss-arm vertical
peak; relax CONTACT_HEIGHT_PROMINENCE (0.05->0.015) and CONTACT_ELBOW_MIN_DEG
(160->140) which rejected the real smoothed contact peak; measure C3 knee bend as
the deepest flexion over [trophy, contact) so the pose-anchored trophy does not
under-report leg load. Demo now: trophy=17, contact=36 (confident).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
