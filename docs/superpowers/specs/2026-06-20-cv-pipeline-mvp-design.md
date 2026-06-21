# End-to-end CV Pipeline MVP ("walking skeleton")

**Date:** 2026-06-20
**Status:** Under review
**Analysis layers:** Layer 1 (simple advice). Layer 2 — metrics are computed but not rendered. Layer 3 — out of scope.

## Context

The `tennis_pos` prototype validates that a CV pipeline can split a tennis serve into phases and find errors (see `AGENTS.md`, ADR-0001, ADR-0002). There is no codebase yet. This is the **first specification** — an end-to-end "walking skeleton": the minimum at each stage, but through the whole flow `video → pose → phases → errors → feedback`.

The goal of this slice is to prove the chain works end-to-end on a real clip. Detection accuracy and threshold calibration are the next stage, in a separate spec.

## Goals / Non-goals

### Goals
- An end-to-end flow on a real serve video clip (side view, ≤30s): upload → pose extraction (MediaPipe) → 4-phase detection → one error rule → Layer-1 feedback.
- All 4 phases (preparation / trophy / acceleration / follow-through) are detected from three events (trophy, contact, follow-through start).
- One working error rule — **C3 (insufficient knee bend)**.
- A clean, synthetic-testable algorithmic core (TDD per `task-rules §3`).
- An architecture ready to accept new rules without touching the core.

### Non-goals (explicit YAGNI)
- Ball tracking (YOLO) — contact is detected from the arm.
- Layers 2 and 3 in the UI (metrics are computed but not shown; no reference skeleton).
- A Web Worker (processing is synchronous on the main thread + a progress bar).
- Auto-detect of handedness (on the MVP it is a manual toggle).
- Separate detection of the start of acceleration (trophy is a point phase).
- Multiple serves in one clip (we expect one serve per video).
- ±2-frame accuracy and false-positive measurement — these are next-stage criteria.

## Architecture

Approach A (chosen): a stage-based pipeline of pure functions with a typed data contract. The only impure module is `extractPoses` (MediaPipe, `<video>`); everything downstream is a pure function `(data) → data`, testable on synthetic poses without a browser. The core is designed so it can later be wrapped in a Web Worker without a rewrite.

### Module map

```
src/
├── pipeline/
│   ├── extractPoses.ts      ⚠️ IMPURE — the only module that knows about MediaPipe and <video>
│   ├── smooth.ts            ✅ pure — trajectory smoothing
│   ├── detectPhases.ts      ✅ pure — event detection and phase split
│   ├── buildPhaseContext.ts ✅ pure — assembling metrics for the rules
│   ├── runRules.ts          ✅ pure — running rules, sorting findings
│   └── analyzeServe.ts      🔌 orchestrator: gluing stages + error handling (no logic)
├── rules/
│   ├── types.ts             ErrorRule, Finding
│   └── ruleC3.ts            insufficient knee bend
├── pose/
│   ├── landmarks.ts         named indices of the 33 landmarks + racketWrist/tossWrist getters
│   └── geometry.ts          jointAngle(), localMaxima(), etc. (from cv-pose-estimation)
├── constants/
│   └── biomechanics.ts      ALL thresholds with a source comment
├── ui/                      React components (Layer 1)
└── __tests__/fixtures/      synthetic poses + a test video clip
```

### Data flow

```
extractPoses(video) ─► PoseFrame[]           // IMPURE boundary (MediaPipe from CDN)
  ─► smooth(poses) ─► PoseFrame[]             // pure
  ─► detectPhases(poses, fps, handedness) ─► Phases
  ─► buildPhaseContext(poses, fps, phases) ─► PhaseContext
  ─► runRules(ctx, [ruleC3]) ─► Finding[]
  ─► <Feedback> (React, Layer 1)
```

The orchestrator `analyzeServe()` calls the stages in order and maps domain errors into UI state.

### Key architecture decisions

1. **The impure/pure boundary.** All the "dirt" (video decoding, MediaPipe, canvas) is locked inside `extractPoses.ts`. We do X because Y: the core becomes testable on synthetic data with no video/browser (`task-rules §3`).
2. **Metrics are computed in `buildPhaseContext`; rules only read them.** `kneeFlexionAtTrophyDeg` is already computed during trophy detection (trophy = the frame of minimum knee angle) and carried into `PhaseContext.metrics`. Rule C3 reads the ready value instead of recomputing geometry. This gives reuse and simple rule unit tests (`makeCtx({...})`).
3. **`runRules` takes an array of rules.** Adding a rule = a new file in `rules/` + (optionally) a metric in `buildPhaseContext`, **without changing** `detectPhases` or the contracts.
4. **`confidence` flows through the pipeline.** Low visibility / a fallback split → `Phases.confidence = 'low'` → `Finding.confidence = 'low'` → softer wording in the UI.
5. **Handedness is localized in the getters** `racketWrist/tossWrist` (`pose/landmarks.ts`) — left/right confusion does not leak across the algorithms.

### Phase detection (algorithm)

`smooth()` is mandatory before detection (centered moving average, window `SMOOTH_WINDOW_FRAMES≈5`; `visibility` is not smoothed). The logic source is the `tennis-serve-phases` and `cv-pose-estimation` skills.

- **trophy (anchor event):** the frame of **minimum knee angle** (max flexion; `jointAngle(hip, knee, ankle)`, we take the more bent leg) among frames where the racket wrist is above the nose (`racketWrist.y < nose.y`). The knee angle at this frame is saved as `kneeFlexionAtTrophyDeg`.
- **contact:** local maximum of the racket-wrist height (`1 - y`) **after** trophy, where the elbow is extended (`elbowAngle ≥ CONTACT_ELBOW_MIN_DEG≈160`). If none — the global maximum after trophy + `confidence: low`.
- **follow-through start:** the first frame after contact where `racketWrist.y > shoulder.y` (wrist below the shoulder).

Phase assembly (arithmetic):
```
preparation:   [0,            trophyFrame]
trophy:        [trophyFrame,  accelStart]      // accelStart = trophyFrame + 1
acceleration:  [accelStart,   contactFrame]
followThrough: [contactFrame, last]
```

**Decision:** the trophy→acceleration boundary is not detected on the MVP, `accelStart = trophyFrame + 1` (trophy is a point phase).
**Alternative (future):** detect the start of acceleration as the first frame after trophy where the knee angle starts growing (legs extend → push upward). Deferred: +1 event and +1 test set, not needed to validate the chain.

### Fallbacks and invariants

- **Trophy not expressed** (no frames with the racket overhead / knee flexion barely changes) → a time-based split (`preparation ~60% / acceleration ~20% / followThrough ~20%` of the clip length) + `confidence: low`.
- **Critical landmarks below `VISIBILITY_THRESHOLD≈0.5` on a large share of frames** → `confidence: low`; if really bad → the domain error `serve-not-recognized`.
- **A visibility gap <5 frames** → interpolation; longer → a low-confidence phase.
- **Invariant** `0 ≤ trophyFrame < contactFrame < followStartFrame ≤ last`; on violation (noise) → `confidence: low` without a crash (covered by a test).

### Rule C3 and feedback (Layer 1)

`ruleC3` reads `ctx.metrics.kneeFlexionAtTrophyDeg`, compares it against the tolerance zone `KNEE_FLEXION_NORMAL_RANGE_DEG`:
- angle `≤ max` → `null` (bend is sufficient or deeper — no error);
- slightly above `max` → `warn`; above `max + KNEE_FLEXION_ERROR_MARGIN_DEG` → `error`.

Important: the angle grows as the bend shrinks (180° = straight leg), so "too little bend" = `angle > max` — this is spelled out in a code comment. The advice is anatomy-free text. `Finding.metric` is filled in (Layer-2 data), but the Layer-1 UI does not render it — the rule does not know about the rendering layers.

UI (minimal, React): file upload + right/left toggle; a `<video>` with a canvas skeleton overlay and a current-phase label; a processing progress bar; a 4-phase bar; a list of advice from `Finding[]` (sorted by severity, with a confidence badge). Layers 2/3 are not shown in the UI skeleton.

### Pose extraction, handedness, errors

- `extractPoses` uses `@mediapipe/tasks-vision` (`PoseLandmarker`, VIDEO mode); weights are loaded from a CDN — the only allowed external request (ADR-0001). Frames come via `requestVideoFrameCallback` with a fallback seek loop. `fps` is estimated from the median of `timestampMs` deltas. `onProgress` → progress bar.
- **Handedness:** manual toggle (default "right-handed"). *Alternative (future):* auto-detect from the toss arm on the release interval.
- **Domain errors** (`AnalysisError`): `pose-extraction-failed`, `serve-not-recognized`, `video-too-long` (> `MAX_CLIP_SECONDS=30`). The orchestrator surfaces them to the UI as state, not as a crash.

## Interfaces

```typescript
interface Landmark { x: number; y: number; z: number; visibility: number; }
// x,y are normalized to [0,1]; y grows downward (image space): "higher" = smaller y. z is unreliable, barely used.

interface PoseFrame { frameIndex: number; timestampMs: number; landmarks: Landmark[]; } // landmarks.length === 33

type Handedness = 'right' | 'left';
type Confidence = 'low' | 'medium' | 'high';

interface Phases {
  handedness: Handedness;
  events: { trophyFrame: number; contactFrame: number; followStartFrame: number };
  phases: {
    preparation:   [number, number];   // [startFrame, endFrame]
    trophy:        [number, number];
    acceleration:  [number, number];
    followThrough: [number, number];
  };
  confidence: Confidence;
}

interface PhaseContext {
  poses: PoseFrame[];
  fps: number;
  phases: Phases;
  metrics: { kneeFlexionAtTrophyDeg: number; /* + metrics for future rules */ };
}

interface Finding {
  ruleId: string;
  severity: 'info' | 'warn' | 'error';
  confidence: Confidence;
  advice: string;                       // Layer 1: anatomy-free text
  metric?: { name: string; value: number; unit: string; referenceRange?: [number, number] };
}

interface ErrorRule {
  id: string;
  phase: keyof Phases['phases'];
  layer: 1 | 2 | 3;
  title: string;
  check: (ctx: PhaseContext) => Finding | null;   // null = no error / cannot determine
}

// Pipeline stages
function extractPoses(video: HTMLVideoElement, onProgress?: (frac: number) => void)
  : Promise<{ poses: PoseFrame[]; fps: number }>;            // IMPURE
function smooth(poses: PoseFrame[], window?: number): PoseFrame[];
function detectPhases(poses: PoseFrame[], fps: number, handedness: Handedness): Phases;
function buildPhaseContext(poses: PoseFrame[], fps: number, phases: Phases): PhaseContext;
function runRules(ctx: PhaseContext, rules: ErrorRule[]): Finding[];

// Orchestrator
type AnalysisError =
  | { kind: 'pose-extraction-failed'; detail: string }
  | { kind: 'serve-not-recognized';   detail: string }
  | { kind: 'video-too-long';         detail: string };
type AnalysisResult =
  | { ok: true; phases: Phases; findings: Finding[]; poses: PoseFrame[] }
  | { ok: false; error: AnalysisError };
function analyzeServe(video: HTMLVideoElement, handedness: Handedness,
  onProgress?: (frac: number) => void): Promise<AnalysisResult>;

// Geometry / landmarks (pose/)
function jointAngle(a: Landmark, b: Landmark, c: Landmark): number;   // angle at B, in degrees
function racketWrist(f: PoseFrame, h: Handedness): Landmark;
function tossWrist(f: PoseFrame, h: Handedness): Landmark;
```

All numeric thresholds are named constants in `src/constants/biomechanics.ts` with a source comment:
`SMOOTH_WINDOW_FRAMES`, `VISIBILITY_THRESHOLD`, `CONTACT_ELBOW_MIN_DEG`, `KNEE_FLEXION_NORMAL_RANGE_DEG`, `KNEE_FLEXION_ERROR_MARGIN_DEG`, `MAX_CLIP_SECONDS`, the fallback-split fractions.

## Success metrics

Chosen criterion: **an assembled end-to-end flow** (accuracy is secondary).

1. On a real test clip (≤30s, side view) `analyzeServe()` completes without an `AnalysisError` and returns `Phases` with `trophyFrame < contactFrame < followStartFrame`.
2. The UI shows 4 phases on the bar and ≥1 piece of advice (or an explicit "no errors found"), plus a skeleton overlay on the video.
3. All core unit tests are green; an integration run on the fixture clip passes.
4. Explainability: every piece of advice shown is anatomy-free text; every threshold is a named constant with a source in `biomechanics.ts`.

**Explicitly NOT a metric for this stage:** frame-level detection accuracy (±2 frames) and the false-positive rate of rule C3 — those are the next stage (calibration), in a separate spec.

### Testing (TDD-first, on synthetic data)

| Module | Example test |
|---|---|
| `pose/geometry` | `jointAngle` of a right angle = 90°; degenerate points don't crash |
| `smooth` | a constant series is unchanged; a noise spike is damped; edges are not lost |
| `detectPhases` | knee minimum on frame N + racket overhead → `trophyFrame === N` |
| `detectPhases` | wrist-height peak after trophy with an extended elbow → `contactFrame === M` |
| `detectPhases` (fallback) | no expressed trophy → `confidence: 'low'` + a time-based split |
| `detectPhases` (invariant) | broken event order → `confidence: 'low'`, no crash |
| `ruleC3` | `makeCtx({ kneeFlexionAtTrophyDeg: 12 })` → has a `severity`; `28` → `null`; a value exactly on the boundary |
| `runRules` | error→warn→info sort order; null findings are filtered out |

Boundary cases: a value on the threshold; low visibility → null/low-confidence; an empty/short phase.
Integration (1 test): `analyzeServe()` on a video fixture → no errors, 4 phases in the right order, `findings` is an array (we don't assert frames).
Manual check: dev server, upload a clip, visually verify the overlay and phase labels.

## Risks / open questions

- **MediaPipe FPS / performance** — processing is not real-time; mitigated by a progress bar and the 30s cap (ADR-0001).
- **2D angles are inaccurate for motion in depth** (`cv-pose-estimation`) — we accept that on the skeleton, compensate with tolerance zones and confidence; the success criterion is the flow, not accuracy.
- **Trophy may not be expressed** for "flat" serves — there is a time-based fallback + low confidence.
- **Thresholds in `biomechanics.ts` are not yet calibrated** — we take literature/estimated values for the skeleton; calibration on test serves is the next stage.
- **One test clip** for integration — enough for the "chain assembled" criterion; for accuracy we will need golden labeling of several serves (next stage).
- **Left/right in MediaPipe are mirrored** — the convention is pinned by tests in `pose/landmarks.ts`.

## Related
- `AGENTS.md`, `docs/task-rules.md`
- ADR-0001 (stack), ADR-0002 (rule-based)
- Skills: `tennis-serve-phases`, `cv-pose-estimation`, `serve-error-detection`
- Biomechanics: `docs/biomechanics/serve-phases.md`
