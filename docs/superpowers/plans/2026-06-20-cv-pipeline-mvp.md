# CV Pipeline MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the end-to-end "walking skeleton" CV pipeline that turns a side-view tennis-serve clip into pose data, four serve phases, one rule-based error finding (C3 — insufficient knee bend), and a Layer-1 feedback UI.

**Architecture:** Staged pure-function pipeline (Approach A). One impure module (`extractPoses`, MediaPipe) at the edge; everything downstream is pure `(data) → data` and unit-tested on synthetic poses. An orchestrator (`analyzeServe`) wires the stages and turns domain errors into UI state.

**Tech Stack:** React + Vite + TypeScript, `@mediapipe/tasks-vision` (PoseLandmarker), Vitest (+ jsdom, Testing Library) for tests.

## Global Constraints

Every task implicitly includes these (verbatim from the spec):

- Browser-only. **No backend, DB, API keys, or external calls.** The single allowed network fetch is the MediaPipe model weights from CDN (ADR-0001).
- Rule-based only. No ML/LLM scoring on this prototype (ADR-0002).
- Every numeric threshold is a **named constant in `src/constants/biomechanics.ts`** with a source comment. No magic literals in logic.
- UI shows **Layer 1 only** (plain advice). Layer-2 metrics are computed but not rendered; Layer 3 is out of scope.
- Algorithmic core is tested **TDD-first on synthetic poses** (not real video).
- `MAX_CLIP_SECONDS = 30`. One serve per clip.
- Advice text contains **no anatomical jargon**.
- Joint-angle convention: `jointAngle(hip, knee, ankle)` returns degrees where **180° = straight leg, smaller = more bend**. Normalized image coords: `y` grows downward, so "higher" = smaller `y`.

---

### Task 1: Project scaffold + test harness

**Files:**
- Create: `package.json`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`
- Test: `src/__tests__/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a working `npm test` (Vitest) and `npm run dev` (Vite). No exported app code yet beyond a placeholder `App`.

- [ ] **Step 1: Scaffold Vite React-TS project in the current directory**

Run:
```bash
npm create vite@latest . -- --template react-ts
```
If prompted about a non-empty directory, choose "Ignore files and continue". This generates `package.json`, `vite.config.ts`, `tsconfig*.json`, `index.html`, `src/main.tsx`, `src/App.tsx`.

- [ ] **Step 2: Install test + runtime dependencies**

Run:
```bash
npm install @mediapipe/tasks-vision
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 3: Add `vitest.config.ts`**

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
  },
});
```

Create `src/__tests__/setup.ts`:
```typescript
import '@testing-library/jest-dom';
```

- [ ] **Step 4: Add the `test` script to `package.json`**

In `package.json` `"scripts"`, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Write the smoke test**

Create `src/__tests__/smoke.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';

describe('test harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run the smoke test**

Run: `npm test`
Expected: PASS (1 test passed).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite + React + TS + Vitest"
```

---

### Task 2: Core domain types + landmark accessors

**Files:**
- Create: `src/types.ts`, `src/pose/landmarks.ts`
- Test: `src/pose/landmarks.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `src/types.ts`: `Landmark`, `PoseFrame`, `Handedness`, `Confidence`, `Phases`, `PhaseContext`.
  - `src/pose/landmarks.ts`: `LM` (index map), `racketWrist(f, h)`, `tossWrist(f, h)`, `racketElbow(f, h)`, `racketShoulder(f, h)` — all return `Landmark`.

- [ ] **Step 1: Write the failing test**

Create `src/pose/landmarks.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { LM, racketWrist, tossWrist } from './landmarks';
import type { PoseFrame, Landmark } from '../types';

function frame(): PoseFrame {
  const landmarks: Landmark[] = [];
  for (let i = 0; i < 33; i++) landmarks.push({ x: i / 100, y: 0, z: 0, visibility: 1 });
  return { frameIndex: 0, timestampMs: 0, landmarks };
}

describe('landmark accessors', () => {
  it('maps racket/toss wrist by handedness', () => {
    const f = frame();
    expect(racketWrist(f, 'right')).toBe(f.landmarks[LM.R_WRIST]);
    expect(tossWrist(f, 'right')).toBe(f.landmarks[LM.L_WRIST]);
    expect(racketWrist(f, 'left')).toBe(f.landmarks[LM.L_WRIST]);
    expect(tossWrist(f, 'left')).toBe(f.landmarks[LM.R_WRIST]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- landmarks`
Expected: FAIL ("Cannot find module './landmarks'").

- [ ] **Step 3: Create `src/types.ts`**

```typescript
export interface Landmark { x: number; y: number; z: number; visibility: number; }

export interface PoseFrame {
  frameIndex: number;
  timestampMs: number;
  landmarks: Landmark[]; // length 33
}

export type Handedness = 'right' | 'left';
export type Confidence = 'low' | 'medium' | 'high';

export interface Phases {
  handedness: Handedness;
  events: { trophyFrame: number; contactFrame: number; followStartFrame: number };
  phases: {
    preparation: [number, number];
    trophy: [number, number];
    acceleration: [number, number];
    followThrough: [number, number];
  };
  confidence: Confidence;
}

export interface PhaseContext {
  poses: PoseFrame[];
  fps: number;
  phases: Phases;
  metrics: { kneeFlexionAtTrophyDeg: number };
}
```

- [ ] **Step 4: Create `src/pose/landmarks.ts`**

```typescript
import type { Landmark, PoseFrame, Handedness } from '../types';

// MediaPipe BlazePose 33-landmark indices (see skills/cv-pose-estimation).
export const LM = {
  NOSE: 0,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28,
} as const;

// Right-handed player: racket = right arm. Left-handed: racket = left arm.
// NOTE: MediaPipe labels left/right from the camera's mirror view; this mapping
// is the single source of truth and is locked by landmarks.test.ts.
export function racketWrist(f: PoseFrame, h: Handedness): Landmark {
  return f.landmarks[h === 'right' ? LM.R_WRIST : LM.L_WRIST];
}
export function tossWrist(f: PoseFrame, h: Handedness): Landmark {
  return f.landmarks[h === 'right' ? LM.L_WRIST : LM.R_WRIST];
}
export function racketElbow(f: PoseFrame, h: Handedness): Landmark {
  return f.landmarks[h === 'right' ? LM.R_ELBOW : LM.L_ELBOW];
}
export function racketShoulder(f: PoseFrame, h: Handedness): Landmark {
  return f.landmarks[h === 'right' ? LM.R_SHOULDER : LM.L_SHOULDER];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- landmarks`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/pose/landmarks.ts src/pose/landmarks.test.ts
git commit -m "feat: core domain types and landmark accessors"
```

---

### Task 3: Geometry helpers (jointAngle, localMaxima)

**Files:**
- Create: `src/pose/geometry.ts`
- Test: `src/pose/geometry.test.ts`

**Interfaces:**
- Consumes: `Landmark` from `src/types.ts`.
- Produces: `jointAngle(a, b, c): number` (degrees at `b`), `localMaxima(values, minProminence?): number[]`.

- [ ] **Step 1: Write the failing test**

Create `src/pose/geometry.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { jointAngle, localMaxima } from './geometry';
import type { Landmark } from '../types';

const p = (x: number, y: number): Landmark => ({ x, y, z: 0, visibility: 1 });

describe('jointAngle', () => {
  it('returns 90 for a right angle', () => {
    expect(jointAngle(p(0, 1), p(0, 0), p(1, 0))).toBeCloseTo(90, 4);
  });
  it('returns 180 for colinear points', () => {
    expect(jointAngle(p(0, 0), p(0, 1), p(0, 2))).toBeCloseTo(180, 4);
  });
  it('does not throw on coincident points', () => {
    expect(() => jointAngle(p(0, 0), p(0, 0), p(0, 0))).not.toThrow();
  });
});

describe('localMaxima', () => {
  it('finds an interior peak', () => {
    expect(localMaxima([0, 1, 2, 1, 0])).toEqual([2]);
  });
  it('filters peaks below the prominence threshold', () => {
    expect(localMaxima([0, 0.01, 0, 1, 0], 0.1)).toEqual([3]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- geometry`
Expected: FAIL ("Cannot find module './geometry'").

- [ ] **Step 3: Create `src/pose/geometry.ts`**

```typescript
import type { Landmark } from '../types';

// Angle (degrees) at vertex b for the triple (a, b, c).
export function jointAngle(a: Landmark, b: Landmark, c: Landmark): number {
  const bax = a.x - b.x, bay = a.y - b.y;
  const bcx = c.x - b.x, bcy = c.y - b.y;
  const denom = Math.hypot(bax, bay) * Math.hypot(bcx, bcy);
  if (denom === 0) return 0; // degenerate (coincident points)
  const cos = (bax * bcx + bay * bcy) / denom;
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

// Indices of strict local maxima whose rise over the smaller neighbour
// is at least minProminence (filters out noise wiggles).
export function localMaxima(values: number[], minProminence = 0): number[] {
  const peaks: number[] = [];
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] > values[i - 1] && values[i] >= values[i + 1]) {
      const prominence = values[i] - Math.min(values[i - 1], values[i + 1]);
      if (prominence >= minProminence) peaks.push(i);
    }
  }
  return peaks;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- geometry`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pose/geometry.ts src/pose/geometry.test.ts
git commit -m "feat: jointAngle and localMaxima geometry helpers"
```

---

### Task 4: Trajectory smoothing + constants file

**Files:**
- Create: `src/constants/biomechanics.ts`, `src/pipeline/smooth.ts`
- Test: `src/pipeline/smooth.test.ts`

**Interfaces:**
- Consumes: `PoseFrame`, `Landmark` from `src/types.ts`.
- Produces: `smooth(poses, window?): PoseFrame[]`; constant `SMOOTH_WINDOW_FRAMES`.

- [ ] **Step 1: Write the failing test**

Create `src/pipeline/smooth.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { smooth } from './smooth';
import type { PoseFrame, Landmark } from '../types';

function seq(xs: number[]): PoseFrame[] {
  return xs.map((x, i) => {
    const landmarks: Landmark[] = [{ x, y: x, z: 0, visibility: 1 }];
    return { frameIndex: i, timestampMs: i * 33, landmarks };
  });
}

describe('smooth', () => {
  it('leaves a constant signal unchanged', () => {
    const out = smooth(seq([0.5, 0.5, 0.5, 0.5, 0.5]), 3);
    expect(out.map(f => f.landmarks[0].x)).toEqual([0.5, 0.5, 0.5, 0.5, 0.5]);
  });
  it('dampens a single-frame spike', () => {
    const out = smooth(seq([0, 0, 1, 0, 0]), 3);
    expect(out[2].landmarks[0].x).toBeLessThan(1);
    expect(out[2].landmarks[0].x).toBeGreaterThan(0);
  });
  it('keeps the same number of frames and preserves visibility', () => {
    const input = seq([0, 1, 0]);
    input[1].landmarks[0].visibility = 0.3;
    const out = smooth(input, 3);
    expect(out).toHaveLength(3);
    expect(out[1].landmarks[0].visibility).toBe(0.3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- smooth`
Expected: FAIL ("Cannot find module './smooth'").

- [ ] **Step 3: Create `src/constants/biomechanics.ts`**

```typescript
// All biomechanics thresholds live here, each with a source comment.
// task-rules §6: no magic literals in logic.

// Centered moving-average window for landmark trajectory smoothing.
// cv-pose-estimation skill: window ~5 at 30fps ≈ ~2-frame peak lag,
// within our ±2-frame phase-detection tolerance.
export const SMOOTH_WINDOW_FRAMES = 5;
```

- [ ] **Step 4: Create `src/pipeline/smooth.ts`**

```typescript
import type { PoseFrame, Landmark } from '../types';
import { SMOOTH_WINDOW_FRAMES } from '../constants/biomechanics';

// Centered moving average over x,y of every landmark. z and visibility are
// passed through untouched (visibility is already a filtered confidence).
export function smooth(poses: PoseFrame[], window = SMOOTH_WINDOW_FRAMES): PoseFrame[] {
  if (poses.length === 0) return [];
  const n = poses.length;
  const numLm = poses[0].landmarks.length;
  const half = Math.floor(window / 2);

  return poses.map((frame, i) => {
    const smoothed: Landmark[] = [];
    for (let l = 0; l < numLm; l++) {
      let sx = 0, sy = 0, count = 0;
      for (let j = -half; j <= half; j++) {
        const k = i + j;
        if (k >= 0 && k < n) {
          sx += poses[k].landmarks[l].x;
          sy += poses[k].landmarks[l].y;
          count++;
        }
      }
      const orig = frame.landmarks[l];
      smoothed.push({ x: sx / count, y: sy / count, z: orig.z, visibility: orig.visibility });
    }
    return { ...frame, landmarks: smoothed };
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- smooth`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/constants/biomechanics.ts src/pipeline/smooth.ts src/pipeline/smooth.test.ts
git commit -m "feat: trajectory smoothing + biomechanics constants file"
```

---

### Task 5: Pose metrics (kneeFlexion, elbowExtension, racketWristHeight)

**Files:**
- Create: `src/pose/metrics.ts`
- Test: `src/pose/metrics.test.ts`

**Interfaces:**
- Consumes: `jointAngle` (geometry), landmark accessors, `LM`.
- Produces: `kneeFlexion(f): number`, `elbowExtension(f, h): number`, `racketWristHeight(f, h): number`.

- [ ] **Step 1: Write the failing test**

Create `src/pose/metrics.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { kneeFlexion, elbowExtension, racketWristHeight } from './metrics';
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
  it('kneeFlexion returns 180 for straight legs', () => {
    const f = frame(makeLandmarks({
      [LM.L_HIP]: { x: 0.5, y: 0.4 }, [LM.L_KNEE]: { x: 0.5, y: 0.6 }, [LM.L_ANKLE]: { x: 0.5, y: 0.8 },
      [LM.R_HIP]: { x: 0.5, y: 0.4 }, [LM.R_KNEE]: { x: 0.5, y: 0.6 }, [LM.R_ANKLE]: { x: 0.5, y: 0.8 },
    }));
    expect(kneeFlexion(f)).toBeCloseTo(180, 1);
  });
  it('kneeFlexion picks the more bent (smaller-angle) leg', () => {
    const f = frame(makeLandmarks({
      [LM.L_HIP]: { x: 0.5, y: 0.4 }, [LM.L_KNEE]: { x: 0.5, y: 0.6 }, [LM.L_ANKLE]: { x: 0.5, y: 0.8 }, // straight
      [LM.R_HIP]: { x: 0.5, y: 0.4 }, [LM.R_KNEE]: { x: 0.5, y: 0.6 }, [LM.R_ANKLE]: { x: 0.72, y: 0.78 }, // bent
    }));
    expect(kneeFlexion(f)).toBeLessThan(160);
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- metrics`
Expected: FAIL ("Cannot find module './metrics'").

- [ ] **Step 3: Create `src/pose/metrics.ts`**

```typescript
import type { PoseFrame, Handedness } from '../types';
import { jointAngle } from './geometry';
import { LM, racketWrist, racketElbow, racketShoulder } from './landmarks';

// Smaller angle = more bend (180° = straight). Take the more-bent leg.
export function kneeFlexion(f: PoseFrame): number {
  const left = jointAngle(f.landmarks[LM.L_HIP], f.landmarks[LM.L_KNEE], f.landmarks[LM.L_ANKLE]);
  const right = jointAngle(f.landmarks[LM.R_HIP], f.landmarks[LM.R_KNEE], f.landmarks[LM.R_ANKLE]);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- metrics`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pose/metrics.ts src/pose/metrics.test.ts
git commit -m "feat: knee/elbow/racket-height pose metrics"
```

---

### Task 6: Phase detection (events + 4 phases + fallback)

**Files:**
- Create: `src/pipeline/detectPhases.ts`, `src/__tests__/fixtures/poses.ts`
- Modify: `src/constants/biomechanics.ts` (append constants)
- Test: `src/pipeline/detectPhases.test.ts`

**Interfaces:**
- Consumes: `smooth` output (`PoseFrame[]`), metrics, `localMaxima`, accessors, constants.
- Produces:
  - `detectPhases(poses, fps, handedness): Phases`
  - `class ServeNotRecognizedError extends Error { detail: string }`
  - fixtures: `makeLandmarks`, `makeFrame`, `buildHappyServe()`.

- [ ] **Step 1: Append constants to `src/constants/biomechanics.ts`**

Add to the end of the file:
```typescript
// Racket arm considered "extended" at contact (elbowExtension >= this).
// Empirical; widened for amateur variability. Calibration on test serves is next-phase.
export const CONTACT_ELBOW_MIN_DEG = 160;

// Minimum normalized height rise for a racket-wrist peak to count (noise filter).
export const CONTACT_HEIGHT_PROMINENCE = 0.05;

// visibility below this => landmark unreliable (cv-pose-estimation skill, ~0.5).
export const VISIBILITY_THRESHOLD = 0.5;

// If more than this fraction of frames have low-visibility critical landmarks,
// we refuse to analyze (serve-not-recognized).
export const MAX_LOW_VIS_FRACTION = 0.5;

// Time-based fallback split when trophy is not expressed (tennis-serve-phases skill).
export const FALLBACK_PREP_FRACTION = 0.6;
export const FALLBACK_ACCEL_FRACTION = 0.2;
```

- [ ] **Step 2: Create fixtures `src/__tests__/fixtures/poses.ts`**

```typescript
import type { Landmark, PoseFrame } from '../../types';
import { LM } from '../../pose/landmarks';

export function makeLandmarks(overrides: Record<number, Partial<Landmark>> = {}): Landmark[] {
  const a: Landmark[] = [];
  for (let i = 0; i < 33; i++) a.push({ x: 0.5, y: 0.5, z: 0, visibility: 1 });
  for (const k of Object.keys(overrides)) {
    const i = Number(k);
    a[i] = { ...a[i], ...overrides[i] };
  }
  return a;
}

export function makeFrame(frameIndex: number, lms: Landmark[], fps = 30): PoseFrame {
  return { frameIndex, timestampMs: (frameIndex / fps) * 1000, landmarks: lms };
}

// Knee landmarks producing progressively smaller (more bent) angles.
function knee(bend: 'straight' | 'bent' | 'deep') {
  const ax = bend === 'straight' ? 0.5 : bend === 'bent' ? 0.62 : 0.72;
  return {
    [LM.L_HIP]: { x: 0.5, y: 0.4 }, [LM.L_KNEE]: { x: 0.5, y: 0.58 }, [LM.L_ANKLE]: { x: ax, y: 0.78 },
    [LM.R_HIP]: { x: 0.5, y: 0.4 }, [LM.R_KNEE]: { x: 0.5, y: 0.58 }, [LM.R_ANKLE]: { x: ax, y: 0.78 },
  };
}
// Racket arm (right) with given wrist/elbow y; shoulder fixed at 0.55.
function arm(wristY: number, elbowY: number) {
  return {
    [LM.R_SHOULDER]: { x: 0.5, y: 0.55 },
    [LM.R_ELBOW]: { x: 0.5, y: elbowY },
    [LM.R_WRIST]: { x: 0.5, y: wristY },
  };
}
const nose = { [LM.NOSE]: { x: 0.5, y: 0.5 } };

// Deterministic right-handed serve: trophy=2, contact=4, followStart=6.
export function buildHappyServe(): PoseFrame[] {
  const specs: Array<[ 'straight'|'bent'|'deep', number, number ]> = [
    ['straight', 0.70, 0.62], // f0 prep, racket low
    ['bent',     0.55, 0.50], // f1 rising (not overhead)
    ['deep',     0.45, 0.42], // f2 trophy: overhead + deepest knee
    ['bent',     0.30, 0.28], // f3 overhead, rising
    ['straight', 0.15, 0.35], // f4 contact: highest + straight elbow
    ['straight', 0.40, 0.45], // f5 descending (still overhead)
    ['straight', 0.62, 0.58], // f6 follow start: wrist below shoulder (0.55)
  ];
  return specs.map(([bend, wY, eY], i) =>
    makeFrame(i, makeLandmarks({ ...nose, ...knee(bend), ...arm(wY, eY) })));
}
```

- [ ] **Step 3: Write the failing tests**

Create `src/pipeline/detectPhases.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { detectPhases, ServeNotRecognizedError } from './detectPhases';
import { buildHappyServe, makeFrame, makeLandmarks } from '../__tests__/fixtures/poses';
import { LM } from '../pose/landmarks';

describe('detectPhases', () => {
  it('detects events and phases on a clean serve', () => {
    const r = detectPhases(buildHappyServe(), 30, 'right');
    expect(r.events).toEqual({ trophyFrame: 2, contactFrame: 4, followStartFrame: 6 });
    expect(r.phases.preparation).toEqual([0, 2]);
    expect(r.phases.trophy).toEqual([2, 3]);
    expect(r.phases.acceleration).toEqual([3, 4]);
    expect(r.phases.followThrough).toEqual([4, 6]);
    expect(r.confidence).toBe('high');
  });

  it('falls back to a time split when trophy is not expressed', () => {
    // racket never goes above the nose (y always 0.7 > nose 0.5)
    const poses = Array.from({ length: 10 }, (_, i) =>
      makeFrame(i, makeLandmarks({ [LM.NOSE]: { y: 0.5 }, [LM.R_WRIST]: { y: 0.7 } })));
    const r = detectPhases(poses, 30, 'right');
    expect(r.confidence).toBe('low');
    expect(r.events.trophyFrame).toBeGreaterThan(0);
    expect(r.events.trophyFrame).toBeLessThan(r.events.contactFrame + 1);
  });

  it('throws when critical landmarks are not visible on most frames', () => {
    const poses = Array.from({ length: 6 }, (_, i) =>
      makeFrame(i, makeLandmarks({ [LM.R_WRIST]: { visibility: 0 } })));
    expect(() => detectPhases(poses, 30, 'right')).toThrow(ServeNotRecognizedError);
  });

  it('marks low confidence when follow-through is never reached', () => {
    // like the happy serve but the racket stays high after contact
    const poses = buildHappyServe().slice(0, 6); // drop f6 (the descent)
    poses[5].landmarks[LM.R_WRIST].y = 0.15;     // keep wrist high at the end
    const r = detectPhases(poses, 30, 'right');
    expect(r.confidence).toBe('low');
    expect(r.events.followStartFrame).toBe(poses.length - 1);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test -- detectPhases`
Expected: FAIL ("Cannot find module './detectPhases'").

- [ ] **Step 5: Create `src/pipeline/detectPhases.ts`**

```typescript
import type { PoseFrame, Phases, Handedness, Confidence } from '../types';
import { LM, racketWrist, racketShoulder } from '../pose/landmarks';
import { kneeFlexion, elbowExtension, racketWristHeight } from '../pose/metrics';
import { localMaxima } from '../pose/geometry';
import {
  CONTACT_ELBOW_MIN_DEG, CONTACT_HEIGHT_PROMINENCE, VISIBILITY_THRESHOLD,
  MAX_LOW_VIS_FRACTION, FALLBACK_PREP_FRACTION, FALLBACK_ACCEL_FRACTION,
} from '../constants/biomechanics';

export class ServeNotRecognizedError extends Error {
  detail: string;
  constructor(detail: string) {
    super(detail);
    this.name = 'ServeNotRecognizedError';
    this.detail = detail;
  }
}

const CRITICAL_LM = [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_WRIST, LM.R_WRIST, LM.L_KNEE, LM.R_KNEE];

function assemble(
  h: Handedness, trophyFrame: number, contactFrame: number,
  followStartFrame: number, last: number, confidence: Confidence,
): Phases {
  const accelStart = Math.min(trophyFrame + 1, contactFrame);
  return {
    handedness: h,
    events: { trophyFrame, contactFrame, followStartFrame },
    phases: {
      preparation: [0, trophyFrame],
      trophy: [trophyFrame, accelStart],
      acceleration: [accelStart, contactFrame],
      followThrough: [contactFrame, last],
    },
    confidence,
  };
}

function timeBasedFallback(poses: PoseFrame[], h: Handedness): Phases {
  const last = poses.length - 1;
  const trophyFrame = Math.round(last * FALLBACK_PREP_FRACTION);
  const contactFrame = Math.round(last * (FALLBACK_PREP_FRACTION + FALLBACK_ACCEL_FRACTION));
  return assemble(h, trophyFrame, contactFrame, contactFrame, last, 'low');
}

export function detectPhases(poses: PoseFrame[], _fps: number, h: Handedness): Phases {
  if (poses.length < 2) throw new ServeNotRecognizedError('too few frames');

  // 1) visibility gate
  const lowVis = poses.filter(f =>
    CRITICAL_LM.some(i => f.landmarks[i].visibility < VISIBILITY_THRESHOLD)).length;
  if (lowVis / poses.length > MAX_LOW_VIS_FRACTION) {
    throw new ServeNotRecognizedError('key landmarks not visible on most frames');
  }

  const last = poses.length - 1;

  // 2) trophy = min knee flexion among "racket overhead" frames
  let trophyFrame = -1, minAngle = Infinity;
  for (let i = 0; i <= last; i++) {
    const overhead = racketWrist(poses[i], h).y < poses[i].landmarks[LM.NOSE].y;
    if (!overhead) continue;
    const ang = kneeFlexion(poses[i]);
    if (ang < minAngle) { minAngle = ang; trophyFrame = i; }
  }
  if (trophyFrame < 0) return timeBasedFallback(poses, h);

  let confidence: Confidence = 'high';

  // 3) contact = highest qualifying racket-wrist peak after trophy
  const heights = poses.map(p => racketWristHeight(p, h));
  const peaks = localMaxima(heights, CONTACT_HEIGHT_PROMINENCE).filter(i => i > trophyFrame);
  let contactFrame = -1, best = -Infinity;
  for (const i of peaks) {
    if (elbowExtension(poses[i], h) >= CONTACT_ELBOW_MIN_DEG && heights[i] > best) {
      best = heights[i]; contactFrame = i;
    }
  }
  if (contactFrame < 0) {
    confidence = 'low'; // no clean peak: take global max height after trophy
    for (let i = trophyFrame + 1; i <= last; i++) {
      if (heights[i] > best) { best = heights[i]; contactFrame = i; }
    }
    if (contactFrame < 0) contactFrame = Math.min(trophyFrame + 1, last);
  }

  // 4) follow-through start = first post-contact frame with wrist below shoulder
  let followStartFrame = -1;
  for (let i = contactFrame + 1; i <= last; i++) {
    if (racketWrist(poses[i], h).y > racketShoulder(poses[i], h).y) { followStartFrame = i; break; }
  }
  if (followStartFrame < 0) { followStartFrame = last; confidence = 'low'; }

  // 5) invariant guard: trophy < contact < followStart
  if (!(trophyFrame < contactFrame && contactFrame < followStartFrame)) {
    confidence = 'low';
    contactFrame = Math.min(Math.max(contactFrame, trophyFrame + 1), last);
    followStartFrame = Math.min(Math.max(followStartFrame, contactFrame + 1), last);
  }

  return assemble(h, trophyFrame, contactFrame, followStartFrame, last, confidence);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- detectPhases`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add src/pipeline/detectPhases.ts src/pipeline/detectPhases.test.ts src/__tests__/fixtures/poses.ts src/constants/biomechanics.ts
git commit -m "feat: serve phase detection with fallback and confidence"
```

---

### Task 7: Build PhaseContext (collect metrics)

**Files:**
- Create: `src/pipeline/buildPhaseContext.ts`
- Test: `src/pipeline/buildPhaseContext.test.ts`

**Interfaces:**
- Consumes: `PoseFrame[]`, `Phases`, `kneeFlexion`.
- Produces: `buildPhaseContext(poses, fps, phases): PhaseContext`.

- [ ] **Step 1: Write the failing test**

Create `src/pipeline/buildPhaseContext.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { buildPhaseContext } from './buildPhaseContext';
import { detectPhases } from './detectPhases';
import { buildHappyServe } from '../__tests__/fixtures/poses';
import { kneeFlexion } from '../pose/metrics';

describe('buildPhaseContext', () => {
  it('exposes kneeFlexionAtTrophyDeg taken at the trophy frame', () => {
    const poses = buildHappyServe();
    const phases = detectPhases(poses, 30, 'right');
    const ctx = buildPhaseContext(poses, 30, phases);
    expect(ctx.metrics.kneeFlexionAtTrophyDeg)
      .toBeCloseTo(kneeFlexion(poses[phases.events.trophyFrame]), 5);
    expect(ctx.fps).toBe(30);
    expect(ctx.phases).toBe(phases);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- buildPhaseContext`
Expected: FAIL ("Cannot find module './buildPhaseContext'").

- [ ] **Step 3: Create `src/pipeline/buildPhaseContext.ts`**

```typescript
import type { PoseFrame, Phases, PhaseContext } from '../types';
import { kneeFlexion } from '../pose/metrics';

// Computes the metrics rules read. The knee angle is taken at the already-detected
// trophy frame — rules consume this value rather than recomputing geometry.
export function buildPhaseContext(poses: PoseFrame[], fps: number, phases: Phases): PhaseContext {
  const tf = phases.events.trophyFrame;
  const kneeFlexionAtTrophyDeg =
    tf >= 0 && tf < poses.length ? kneeFlexion(poses[tf]) : NaN;
  return { poses, fps, phases, metrics: { kneeFlexionAtTrophyDeg } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- buildPhaseContext`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/buildPhaseContext.ts src/pipeline/buildPhaseContext.test.ts
git commit -m "feat: buildPhaseContext collects trophy knee-flexion metric"
```

---

### Task 8: Rule types + rule C3 (insufficient knee bend)

**Files:**
- Create: `src/rules/types.ts`, `src/rules/ruleC3.ts`
- Modify: `src/constants/biomechanics.ts` (append)
- Test: `src/rules/ruleC3.test.ts`

**Interfaces:**
- Consumes: `PhaseContext`, `Phases`, `Confidence`, constants.
- Produces:
  - `src/rules/types.ts`: `Finding`, `ErrorRule`.
  - `src/rules/ruleC3.ts`: `ruleC3: ErrorRule`.
  - constants `KNEE_FLEXION_NORMAL_RANGE_DEG`, `KNEE_FLEXION_ERROR_MARGIN_DEG`.

- [ ] **Step 1: Append constants to `src/constants/biomechanics.ts`**

Add to the end of the file:
```typescript
// Knee JOINT angle at trophy (hip-knee-ankle); 180° = straight, smaller = more bend.
// Chow et al. (2012): intermediate players ~20-35° knee flexion ≈ ~145-160° joint angle.
// Lower bound widened for amateur variability; values are provisional pending
// next-phase calibration on real serves.
export const KNEE_FLEXION_NORMAL_RANGE_DEG: [number, number] = [140, 160];

// Angle this many degrees above the normal upper bound => "barely bent" => error (vs warn).
export const KNEE_FLEXION_ERROR_MARGIN_DEG = 10;
```

- [ ] **Step 2: Write the failing tests**

Create `src/rules/ruleC3.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { ruleC3 } from './ruleC3';
import type { PhaseContext, Confidence } from '../types';

function makeCtx(kneeFlexionAtTrophyDeg: number, confidence: Confidence = 'high'): PhaseContext {
  return {
    poses: [], fps: 30,
    phases: {
      handedness: 'right',
      events: { trophyFrame: 0, contactFrame: 1, followStartFrame: 2 },
      phases: { preparation: [0, 0], trophy: [0, 1], acceleration: [1, 1], followThrough: [1, 2] },
      confidence,
    },
    metrics: { kneeFlexionAtTrophyDeg },
  };
}

describe('ruleC3 (insufficient knee bend)', () => {
  it('passes (null) when bend is sufficient', () => {
    expect(ruleC3.check(makeCtx(150))).toBeNull();
  });
  it('passes exactly at the upper bound', () => {
    expect(ruleC3.check(makeCtx(160))).toBeNull();
  });
  it('warns when slightly too straight', () => {
    expect(ruleC3.check(makeCtx(165))?.severity).toBe('warn');
  });
  it('errors when far too straight', () => {
    expect(ruleC3.check(makeCtx(175))?.severity).toBe('error');
  });
  it('inherits confidence from the phases', () => {
    expect(ruleC3.check(makeCtx(175, 'low'))?.confidence).toBe('low');
  });
  it('returns null when the metric is NaN', () => {
    expect(ruleC3.check(makeCtx(NaN))).toBeNull();
  });
  it('fills a Layer-2 metric without anatomical jargon in advice', () => {
    const f = ruleC3.check(makeCtx(175))!;
    expect(f.metric?.value).toBe(175);
    expect(f.advice).not.toMatch(/ротаци|пронаци|анатом/i);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- ruleC3`
Expected: FAIL ("Cannot find module './ruleC3'").

- [ ] **Step 4: Create `src/rules/types.ts`**

```typescript
import type { PhaseContext, Phases, Confidence } from '../types';

export interface Finding {
  ruleId: string;
  severity: 'info' | 'warn' | 'error';
  confidence: Confidence;
  advice: string; // Layer 1: plain text, no anatomy
  metric?: { name: string; value: number; unit: string; referenceRange?: [number, number] };
}

export interface ErrorRule {
  id: string;
  phase: keyof Phases['phases'];
  layer: 1 | 2 | 3;
  title: string;
  check: (ctx: PhaseContext) => Finding | null; // null = no error / cannot determine
}
```

- [ ] **Step 5: Create `src/rules/ruleC3.ts`**

```typescript
import type { ErrorRule } from './types';
import { KNEE_FLEXION_NORMAL_RANGE_DEG, KNEE_FLEXION_ERROR_MARGIN_DEG } from '../constants/biomechanics';

export const ruleC3: ErrorRule = {
  id: 'C3',
  phase: 'trophy',
  layer: 1,
  title: 'Сгиб коленей',
  check: (ctx) => {
    const angle = ctx.metrics.kneeFlexionAtTrophyDeg;
    if (Number.isNaN(angle)) return null;
    const [, max] = KNEE_FLEXION_NORMAL_RANGE_DEG;
    // angle grows as bend shrinks (180° = straight); too straight => angle > max.
    if (angle <= max) return null; // enough bend (or deeper) — no error
    const severity = angle > max + KNEE_FLEXION_ERROR_MARGIN_DEG ? 'error' : 'warn';
    return {
      ruleId: 'C3',
      severity,
      confidence: ctx.phases.confidence,
      advice:
        'Колени согнуты слабо — ноги почти не дают энергию удару. ' +
        'Сгибайте колени глубже в позиции «трофей», чтобы вытолкнуться вверх к мячу.',
      metric: {
        name: 'Сгиб колена в «трофей»',
        value: Math.round(angle),
        unit: '°',
        referenceRange: KNEE_FLEXION_NORMAL_RANGE_DEG,
      },
    };
  },
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- ruleC3`
Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add src/rules/types.ts src/rules/ruleC3.ts src/rules/ruleC3.test.ts src/constants/biomechanics.ts
git commit -m "feat: rule C3 insufficient knee bend (Layer 1)"
```

---

### Task 9: Run rules (filter + sort findings)

**Files:**
- Create: `src/pipeline/runRules.ts`
- Test: `src/pipeline/runRules.test.ts`

**Interfaces:**
- Consumes: `PhaseContext`, `ErrorRule`, `Finding`.
- Produces: `runRules(ctx, rules): Finding[]` (nulls filtered, sorted error→warn→info).

- [ ] **Step 1: Write the failing test**

Create `src/pipeline/runRules.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { runRules } from './runRules';
import type { ErrorRule, Finding } from '../rules/types';
import type { PhaseContext } from '../types';

const ctx = {} as PhaseContext;
const rule = (id: string, sev: Finding['severity'] | null): ErrorRule => ({
  id, phase: 'trophy', layer: 1, title: id,
  check: () => sev === null ? null
    : { ruleId: id, severity: sev, confidence: 'high', advice: id },
});

describe('runRules', () => {
  it('drops null findings and sorts error→warn→info', () => {
    const out = runRules(ctx, [rule('a', 'warn'), rule('b', null), rule('c', 'error'), rule('d', 'info')]);
    expect(out.map(f => f.ruleId)).toEqual(['c', 'a', 'd']);
  });
  it('returns an empty array when nothing fires', () => {
    expect(runRules(ctx, [rule('a', null)])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- runRules`
Expected: FAIL ("Cannot find module './runRules'").

- [ ] **Step 3: Create `src/pipeline/runRules.ts`**

```typescript
import type { PhaseContext } from '../types';
import type { ErrorRule, Finding } from '../rules/types';

const ORDER: Record<Finding['severity'], number> = { error: 0, warn: 1, info: 2 };

export function runRules(ctx: PhaseContext, rules: ErrorRule[]): Finding[] {
  return rules
    .map(r => r.check(ctx))
    .filter((f): f is Finding => f !== null)
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- runRules`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/runRules.ts src/pipeline/runRules.test.ts
git commit -m "feat: runRules filters and sorts findings by severity"
```

---

### Task 10: Pose extraction (MediaPipe) + fps estimation

**Files:**
- Create: `src/pipeline/extractPoses.ts`
- Modify: `src/constants/biomechanics.ts` (append `MAX_CLIP_SECONDS`)
- Test: `src/pipeline/extractPoses.test.ts`

**Interfaces:**
- Consumes: `@mediapipe/tasks-vision`, `PoseFrame`.
- Produces:
  - `estimateFps(timestampsMs): number` (pure, unit-tested).
  - `extractPoses(video, onProgress?): Promise<{ poses: PoseFrame[]; fps: number }>` (impure, manually verified).
  - constant `MAX_CLIP_SECONDS`.

- [ ] **Step 1: Append `MAX_CLIP_SECONDS` to `src/constants/biomechanics.ts`**

Add to the end of the file:
```typescript
// Browser memory guard for a single serve clip (ADR-0001).
export const MAX_CLIP_SECONDS = 30;
```

- [ ] **Step 2: Write the failing test (pure fps estimator)**

Create `src/pipeline/extractPoses.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { estimateFps } from './extractPoses';

describe('estimateFps', () => {
  it('returns 30 for ~33ms spacing', () => {
    expect(estimateFps([0, 33.3, 66.6, 100])).toBeCloseTo(30, 0);
  });
  it('uses the median delta (robust to one gap)', () => {
    expect(estimateFps([0, 33, 66, 400, 433])).toBeCloseTo(30, 0);
  });
  it('defaults to 30 with too few samples', () => {
    expect(estimateFps([0])).toBe(30);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- extractPoses`
Expected: FAIL ("Cannot find module './extractPoses'").

- [ ] **Step 4: Create `src/pipeline/extractPoses.ts`**

```typescript
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { PoseFrame, Landmark } from '../types';

// Median frame-to-frame delta → fps (browser does not expose fps directly).
export function estimateFps(timestampsMs: number[]): number {
  if (timestampsMs.length < 2) return 30;
  const deltas: number[] = [];
  for (let i = 1; i < timestampsMs.length; i++) deltas.push(timestampsMs[i] - timestampsMs[i - 1]);
  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)];
  return median > 0 ? 1000 / median : 30;
}

const WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

async function createLandmarker(): Promise<PoseLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL },
    runningMode: 'VIDEO',
    numPoses: 1,
  });
}

// Walks the video frame-by-frame, runs PoseLandmarker, returns one PoseFrame per frame.
// Single impure boundary of the pipeline (MediaPipe + <video> only live here).
export async function extractPoses(
  video: HTMLVideoElement,
  onProgress?: (frac: number) => void,
): Promise<{ poses: PoseFrame[]; fps: number }> {
  const landmarker = await createLandmarker();
  const poses: PoseFrame[] = [];
  const duration = video.duration;

  // Step through the clip with seeks (works without requestVideoFrameCallback).
  const STEP = 1 / 30; // sample at ~30fps
  let frameIndex = 0;
  for (let t = 0; t < duration; t += STEP) {
    await seekTo(video, t);
    const tsMs = video.currentTime * 1000;
    const result = landmarker.detectForVideo(video, tsMs);
    const landmarks: Landmark[] = (result.landmarks[0] ?? []).map(p => ({
      x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 0,
    }));
    if (landmarks.length === 33) {
      poses.push({ frameIndex: frameIndex++, timestampMs: tsMs, landmarks });
    }
    onProgress?.(Math.min(1, t / duration));
  }
  onProgress?.(1);
  landmarker.close();

  return { poses, fps: estimateFps(poses.map(p => p.timestampMs)) };
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve(); };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = time;
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- extractPoses`
Expected: PASS (3 tests; the MediaPipe loop is verified manually in Task 13).

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/extractPoses.ts src/pipeline/extractPoses.test.ts src/constants/biomechanics.ts
git commit -m "feat: MediaPipe pose extraction + fps estimation"
```

---

### Task 11: Orchestrator `analyzeServe`

**Files:**
- Create: `src/pipeline/analyzeServe.ts`
- Test: `src/pipeline/analyzeServe.test.ts`

**Interfaces:**
- Consumes: `smooth`, `detectPhases`, `ServeNotRecognizedError`, `buildPhaseContext`, `runRules`, `ruleC3`, `extractPoses`, `MAX_CLIP_SECONDS`.
- Produces:
  - `type AnalysisError`, `type AnalysisResult`, `interface AnalyzeDeps { extract }`.
  - `analyzeServe(video, handedness, onProgress?, deps?): Promise<AnalysisResult>`.

- [ ] **Step 1: Write the failing tests**

Create `src/pipeline/analyzeServe.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { analyzeServe } from './analyzeServe';
import { buildHappyServe, makeFrame, makeLandmarks } from '../__tests__/fixtures/poses';
import { LM } from '../pose/landmarks';

const video = (duration: number) => ({ duration }) as HTMLVideoElement;

describe('analyzeServe', () => {
  it('returns a full result on a clean serve', async () => {
    const extract = async () => ({ poses: buildHappyServe(), fps: 30 });
    const r = await analyzeServe(video(5), 'right', undefined, { extract });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const { trophyFrame, contactFrame, followStartFrame } = r.phases.events;
      expect(trophyFrame).toBeLessThan(contactFrame);
      expect(contactFrame).toBeLessThan(followStartFrame);
      expect(Array.isArray(r.findings)).toBe(true);
    }
  });

  it('rejects clips longer than MAX_CLIP_SECONDS', async () => {
    const extract = async () => ({ poses: buildHappyServe(), fps: 30 });
    const r = await analyzeServe(video(99), 'right', undefined, { extract });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('video-too-long');
  });

  it('maps unrecognized serves to a domain error', async () => {
    const poses = Array.from({ length: 6 }, (_, i) =>
      makeFrame(i, makeLandmarks({ [LM.R_WRIST]: { visibility: 0 } })));
    const extract = async () => ({ poses, fps: 30 });
    const r = await analyzeServe(video(5), 'right', undefined, { extract });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('serve-not-recognized');
  });

  it('maps extraction failures to pose-extraction-failed', async () => {
    const extract = async () => { throw new Error('mediapipe boom'); };
    const r = await analyzeServe(video(5), 'right', undefined, { extract });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('pose-extraction-failed');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- analyzeServe`
Expected: FAIL ("Cannot find module './analyzeServe'").

- [ ] **Step 3: Create `src/pipeline/analyzeServe.ts`**

```typescript
import type { Handedness, PoseFrame, Phases } from '../types';
import type { Finding } from '../rules/types';
import { smooth } from './smooth';
import { detectPhases, ServeNotRecognizedError } from './detectPhases';
import { buildPhaseContext } from './buildPhaseContext';
import { runRules } from './runRules';
import { ruleC3 } from '../rules/ruleC3';
import { extractPoses } from './extractPoses';
import { MAX_CLIP_SECONDS } from '../constants/biomechanics';

export type AnalysisError =
  | { kind: 'pose-extraction-failed'; detail: string }
  | { kind: 'serve-not-recognized'; detail: string }
  | { kind: 'video-too-long'; detail: string };

export type AnalysisResult =
  | { ok: true; phases: Phases; findings: Finding[]; poses: PoseFrame[] }
  | { ok: false; error: AnalysisError };

export interface AnalyzeDeps {
  extract: (v: HTMLVideoElement, onProgress?: (f: number) => void) =>
    Promise<{ poses: PoseFrame[]; fps: number }>;
}
const defaultDeps: AnalyzeDeps = { extract: extractPoses };

export async function analyzeServe(
  video: HTMLVideoElement,
  handedness: Handedness,
  onProgress?: (frac: number) => void,
  deps: AnalyzeDeps = defaultDeps,
): Promise<AnalysisResult> {
  if (video.duration > MAX_CLIP_SECONDS) {
    return { ok: false, error: { kind: 'video-too-long', detail: `>${MAX_CLIP_SECONDS}s` } };
  }

  let raw: { poses: PoseFrame[]; fps: number };
  try {
    raw = await deps.extract(video, onProgress);
  } catch (e) {
    return { ok: false, error: { kind: 'pose-extraction-failed', detail: String(e) } };
  }

  try {
    const smoothed = smooth(raw.poses);
    const phases = detectPhases(smoothed, raw.fps, handedness);
    const ctx = buildPhaseContext(smoothed, raw.fps, phases);
    const findings = runRules(ctx, [ruleC3]);
    return { ok: true, phases, findings, poses: smoothed };
  } catch (e) {
    if (e instanceof ServeNotRecognizedError) {
      return { ok: false, error: { kind: 'serve-not-recognized', detail: e.detail } };
    }
    return { ok: false, error: { kind: 'pose-extraction-failed', detail: String(e) } };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- analyzeServe`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/analyzeServe.ts src/pipeline/analyzeServe.test.ts
git commit -m "feat: analyzeServe orchestrator with domain error mapping"
```

---

### Task 12: Layer-1 UI (upload, overlay, phases, advice)

**Files:**
- Create: `src/ui/PhaseBar.tsx`, `src/ui/AdviceList.tsx`, `src/ui/SkeletonOverlay.tsx`
- Modify: `src/App.tsx`, `src/main.tsx` (use App), `src/App.css` (optional minimal styles)
- Test: `src/ui/AdviceList.test.tsx`, `src/ui/PhaseBar.test.tsx`

**Interfaces:**
- Consumes: `analyzeServe`, `AnalysisResult`, `Finding`, `Phases`, `PoseFrame`, landmark accessors.
- Produces: a working single-page app rendering video + skeleton overlay + phase bar + advice list + progress + error state. Components: `PhaseBar({ phases })`, `AdviceList({ findings })`, `SkeletonOverlay({ video, poses, phases })`.

- [ ] **Step 1: Write the failing component tests**

Create `src/ui/AdviceList.test.tsx`:
```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdviceList } from './AdviceList';
import type { Finding } from '../rules/types';

const finding: Finding = {
  ruleId: 'C3', severity: 'warn', confidence: 'low',
  advice: 'Сгибайте колени глубже.',
};

describe('AdviceList', () => {
  it('renders findings with a low-confidence badge', () => {
    render(<AdviceList findings={[finding]} />);
    expect(screen.getByText('Сгибайте колени глубже.')).toBeInTheDocument();
    expect(screen.getByText(/возможно/i)).toBeInTheDocument();
  });
  it('shows an empty-state message when there are no findings', () => {
    render(<AdviceList findings={[]} />);
    expect(screen.getByText(/ошибок не найдено/i)).toBeInTheDocument();
  });
});
```

Create `src/ui/PhaseBar.test.tsx`:
```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PhaseBar } from './PhaseBar';
import type { Phases } from '../types';

const phases: Phases = {
  handedness: 'right',
  events: { trophyFrame: 2, contactFrame: 4, followStartFrame: 6 },
  phases: { preparation: [0, 2], trophy: [2, 3], acceleration: [3, 4], followThrough: [4, 6] },
  confidence: 'high',
};

describe('PhaseBar', () => {
  it('labels all four phases', () => {
    render(<PhaseBar phases={phases} />);
    for (const label of ['Подготовка', 'Трофей', 'Разгон', 'Завершение']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- AdviceList PhaseBar`
Expected: FAIL ("Cannot find module './AdviceList'").

- [ ] **Step 3: Create `src/ui/AdviceList.tsx`**

```tsx
import type { Finding } from '../rules/types';

const SEVERITY_ICON: Record<Finding['severity'], string> = { error: '⛔', warn: '⚠️', info: 'ℹ️' };

export function AdviceList({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
    return <p className="advice-empty">Ошибок не найдено — хорошая подача!</p>;
  }
  return (
    <ul className="advice-list">
      {findings.map((f, i) => (
        <li key={i} className={`advice advice--${f.severity}`}>
          <strong>{SEVERITY_ICON[f.severity]} {f.ruleId}</strong>
          <p>{f.confidence === 'low' ? 'Возможно: ' : ''}{f.advice}</p>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Create `src/ui/PhaseBar.tsx`**

```tsx
import type { Phases } from '../types';

const LABELS: Array<[keyof Phases['phases'], string]> = [
  ['preparation', 'Подготовка'],
  ['trophy', 'Трофей'],
  ['acceleration', 'Разгон'],
  ['followThrough', 'Завершение'],
];

export function PhaseBar({ phases }: { phases: Phases }) {
  const last = phases.phases.followThrough[1] || 1;
  return (
    <div className="phase-bar">
      {LABELS.map(([key, label]) => {
        const [start, end] = phases.phases[key];
        const width = `${Math.max(0, ((end - start) / last) * 100)}%`;
        return (
          <div key={key} className={`phase-seg phase-seg--${key}`} style={{ width }}>
            <span>{label}</span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Run component tests to verify they pass**

Run: `npm test -- AdviceList PhaseBar`
Expected: PASS.

- [ ] **Step 6: Create `src/ui/SkeletonOverlay.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import type { PoseFrame, Phases } from '../types';

const BONES: Array<[number, number]> = [
  [11, 13], [13, 15], [12, 14], [14, 16],     // arms
  [11, 12], [23, 24], [11, 23], [12, 24],     // torso
  [23, 25], [25, 27], [24, 26], [26, 28],     // legs
];

function phaseAt(frameIndex: number, phases: Phases): string {
  const p = phases.phases;
  if (frameIndex < p.preparation[1]) return 'Подготовка';
  if (frameIndex < p.acceleration[0]) return 'Трофей';
  if (frameIndex < p.acceleration[1]) return 'Разгон';
  return 'Завершение';
}

export function SkeletonOverlay(
  { video, poses, phases }: { video: HTMLVideoElement | null; poses: PoseFrame[]; phases: Phases },
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!video) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    const draw = () => {
      canvas.width = video.clientWidth;
      canvas.height = video.clientHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (poses.length === 0) return;
      // nearest pose frame by time
      const tMs = video.currentTime * 1000;
      let nearest = poses[0];
      for (const f of poses) if (Math.abs(f.timestampMs - tMs) < Math.abs(nearest.timestampMs - tMs)) nearest = f;

      ctx.strokeStyle = '#39FF14';
      ctx.lineWidth = 2;
      for (const [a, b] of BONES) {
        const pa = nearest.landmarks[a], pb = nearest.landmarks[b];
        ctx.beginPath();
        ctx.moveTo(pa.x * canvas.width, pa.y * canvas.height);
        ctx.lineTo(pb.x * canvas.width, pb.y * canvas.height);
        ctx.stroke();
      }
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '16px sans-serif';
      ctx.fillText(phaseAt(nearest.frameIndex, phases), 8, 20);
    };

    video.addEventListener('timeupdate', draw);
    draw();
    return () => video.removeEventListener('timeupdate', draw);
  }, [video, poses, phases]);

  return <canvas ref={canvasRef} className="skeleton-overlay" />;
}
```

- [ ] **Step 7: Replace `src/App.tsx`**

```tsx
import { useRef, useState, type ChangeEvent } from 'react';
import type { Handedness } from './types';
import { analyzeServe, type AnalysisResult } from './pipeline/analyzeServe';
import { PhaseBar } from './ui/PhaseBar';
import { AdviceList } from './ui/AdviceList';
import { SkeletonOverlay } from './ui/SkeletonOverlay';
import './App.css';

type Status = 'idle' | 'processing' | 'done' | 'error';

const ERROR_TEXT: Record<string, string> = {
  'video-too-long': 'Видео длиннее 30 секунд. Загрузите короткий клип одной подачи.',
  'serve-not-recognized': 'Не удалось распознать подачу. Снимите сбоку, игрок целиком в кадре.',
  'pose-extraction-failed': 'Не удалось запустить распознавание. Попробуйте другой браузер/файл.',
};

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [handedness, setHandedness] = useState<Handedness>('right');
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const video = videoRef.current;
    if (!file || !video) return;

    setResult(null);
    setStatus('processing');
    setProgress(0);
    video.src = URL.createObjectURL(file);
    await new Promise<void>((res) => {
      video.onloadedmetadata = () => res();
    });

    const r = await analyzeServe(video, handedness, setProgress);
    setResult(r);
    if (r.ok) {
      setStatus('done');
    } else {
      setStatus('error');
      setErrorMsg(ERROR_TEXT[r.error.kind] ?? r.error.detail);
    }
  }

  return (
    <main className="app">
      <h1>Анализ подачи</h1>
      <div className="controls">
        <input type="file" accept="video/*" onChange={onFile} />
        <label>
          <input
            type="radio" name="hand" checked={handedness === 'right'}
            onChange={() => setHandedness('right')}
          /> Правша
        </label>
        <label>
          <input
            type="radio" name="hand" checked={handedness === 'left'}
            onChange={() => setHandedness('left')}
          /> Левша
        </label>
      </div>

      <div className="stage">
        <video ref={videoRef} controls className="video" />
        {status === 'done' && result?.ok && (
          <SkeletonOverlay video={videoRef.current} poses={result.poses} phases={result.phases} />
        )}
      </div>

      {status === 'processing' && <p>Обработка: {Math.round(progress * 100)}%</p>}
      {status === 'error' && <p className="error">{errorMsg}</p>}

      {status === 'done' && result?.ok && (
        <>
          <PhaseBar phases={result.phases} />
          <AdviceList findings={result.findings} />
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 8: Ensure `src/main.tsx` renders `App`**

`src/main.tsx` should be (from the Vite template; confirm it imports the default `App`):
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 9: Add minimal styles to `src/App.css`**

Replace `src/App.css` with:
```css
.app { max-width: 720px; margin: 0 auto; padding: 1rem; font-family: sans-serif; }
.controls { display: flex; gap: 1rem; align-items: center; margin-bottom: 1rem; }
.stage { position: relative; }
.video { width: 100%; display: block; }
.skeleton-overlay { position: absolute; top: 0; left: 0; pointer-events: none; }
.phase-bar { display: flex; width: 100%; height: 28px; margin: 1rem 0; border: 1px solid #ccc; }
.phase-seg { display: flex; align-items: center; justify-content: center; font-size: 12px; overflow: hidden; }
.phase-seg--preparation { background: #cfe8ff; }
.phase-seg--trophy { background: #ffe7a3; }
.phase-seg--acceleration { background: #ffc1c1; }
.phase-seg--followThrough { background: #d6f5d6; }
.advice-list { list-style: none; padding: 0; }
.advice { border-left: 4px solid #999; padding: 0.5rem 0.75rem; margin: 0.5rem 0; background: #fafafa; }
.advice--error { border-color: #d00; }
.advice--warn { border-color: #e69500; }
.error { color: #d00; }
```

- [ ] **Step 10: Run the full test suite**

Run: `npm test`
Expected: PASS (all suites green).

- [ ] **Step 11: Commit**

```bash
git add src/ui src/App.tsx src/App.css src/main.tsx
git commit -m "feat: Layer-1 UI — upload, skeleton overlay, phase bar, advice"
```

---

### Task 13: End-to-end assembly test + manual verification

**Files:**
- Create: `src/__tests__/pipeline.integration.test.ts`
- Modify: `README.md` (add run/verify instructions)

**Interfaces:**
- Consumes: `analyzeServe` with an injected extractor returning the synthetic serve.
- Produces: a runnable integration test that proves the stages assemble end-to-end, plus a documented manual check on a real clip.

- [ ] **Step 1: Write the integration test**

Create `src/__tests__/pipeline.integration.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { analyzeServe } from '../pipeline/analyzeServe';
import { buildHappyServe } from './fixtures/poses';

describe('pipeline integration (assembled flow)', () => {
  it('runs video→pose→phases→rules without error and returns 4 ordered phases', async () => {
    const extract = async () => ({ poses: buildHappyServe(), fps: 30 });
    const r = await analyzeServe({ duration: 5 } as HTMLVideoElement, 'right', undefined, { extract });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { trophyFrame, contactFrame, followStartFrame } = r.phases.events;
    expect(trophyFrame).toBeLessThan(contactFrame);
    expect(contactFrame).toBeLessThan(followStartFrame);
    const p = r.phases.phases;
    expect(p.preparation[0]).toBe(0);
    expect(p.followThrough[1]).toBe(buildHappyServe().length - 1);
    expect(Array.isArray(r.findings)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `npm test -- pipeline.integration`
Expected: PASS.

- [ ] **Step 3: Add run/verify instructions to `README.md`**

Append to `README.md`:
```markdown
## Запуск прототипа

```bash
npm install
npm run dev      # открыть указанный localhost-адрес
npm test         # прогнать тесты ядра
```

### Ручная проверка сквозного потока (критерий успеха MVP)
1. `npm run dev`, открыть приложение.
2. Выбрать клип подачи (сбоку, игрок целиком в кадре, ≤30с) и handedness.
3. Дождаться прогресс-бара обработки.
4. Убедиться, что:
   - на видео рисуется скелет и подпись текущей фазы;
   - полоса фаз показывает 4 сегмента (Подготовка/Трофей/Разгон/Завершение);
   - показан ≥1 совет либо «Ошибок не найдено».
```

- [ ] **Step 4: Manual verification on the real clip**

Place the real serve clip somewhere accessible, run `npm run dev`, and perform the checklist from Step 3. This is the spec's primary success criterion ("assembled end-to-end flow"). Frame-accuracy is explicitly out of scope for this MVP.

- [ ] **Step 5: Final full-suite run**

Run: `npm test`
Expected: PASS (all suites).

- [ ] **Step 6: Commit**

```bash
git add src/__tests__/pipeline.integration.test.ts README.md
git commit -m "test: end-to-end pipeline assembly + manual verify instructions"
```

---

## Notes for the implementer

- **Build order matters:** Tasks 1→13 are dependency-ordered. Each ends green and committed.
- **The only impure module is `extractPoses`.** If a test needs pose data, build synthetic `PoseFrame[]` via `src/__tests__/fixtures/poses.ts` — never load video in a unit test.
- **MediaPipe model/wasm URLs** in `extractPoses.ts` are pinned to `@latest`; if CDN resolution fails at runtime, pin to the exact installed `@mediapipe/tasks-vision` version.
- **All new thresholds go to `src/constants/biomechanics.ts`** with a source comment — never inline.
