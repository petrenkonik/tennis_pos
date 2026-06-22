# Detection Layer (ball + racket tracking) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-browser ball + racket detection pass that produces smoothed per-object tracks and a validation overlay, without changing event/metric/rule logic.

**Architecture:** A single shared frame walk (`walkVideoFrames`) seeks the video once and runs both the MediaPipe `PoseLandmarker` and `ObjectDetector` per frame (`extractFrameData`). Raw per-frame detections become smoothed, gap-filled single-object tracks via the pure `buildTracks`. `analyzeServe` carries the tracks into its result; a new `DetectionOverlay` canvas draws them over the video for visual validation on the demo clip.

**Tech Stack:** TypeScript, React 19, Vite, Vitest, `@mediapipe/tasks-vision` (PoseLandmarker + ObjectDetector, EfficientDet-Lite0 COCO model).

## Global Constraints

- **Everything in the browser, on-device.** No backend, no API calls except loading model weights from a CDN. (`task-rules §4`)
- **No new error rules, no changes to `detectPhases` / event detection / existing metrics / `runRules`.** A produces and visualises tracks only. (spec Non-goals)
- **No new heavy dependency.** Use `@mediapipe/tasks-vision` (already installed `^0.10.35`); do NOT add `@tensorflow/tfjs`. (spec §Model choice)
- **Model licence must stay permissive.** EfficientDet-Lite0 is Apache-2.0; never introduce YOLOv8 (AGPL-3.0). (spec Risks)
- **All thresholds are named constants with a source comment**, collected in `src/constants/detection.ts`. No magic literals in logic. (`task-rules §6`)
- **Docs and code comments in English.** No user-facing strings added in A (overlay labels, if any, go through i18n). (`task-rules §8`)
- **TDD for pure logic.** `buildTracks`, `frameSampleTimes`, `pickDetections` are pure → test-first. The impure boundaries (`walkVideoFrames`, `extractFrameData`) are validated via the demo-clip overlay, not unit tests. (`task-rules §3`)
- **Pinned model version**, mirroring `MEDIAPIPE_VERSION` in `extractPoses.ts`.

---

## File Structure

- `src/types.ts` — **modify**: add `BoxNorm`, `Detection`, `DetectionFrame`, `TrackPoint`, `ObjectTrack`, `BallTrack`, `RacketTrack`.
- `src/constants/detection.ts` — **create**: model URL/version, COCO class names, tracking thresholds.
- `src/pipeline/buildTracks.ts` (+ `.test.ts`) — **create**: pure detections → tracks.
- `src/pipeline/walkVideoFrames.ts` (+ `.test.ts`) — **create**: shared seek loop + pure `frameSampleTimes`.
- `src/pipeline/extractPoses.ts` — **modify**: consume `walkVideoFrames`; export `WASM_BASE`, `MODEL_URLS`, `mapLandmarks`.
- `src/pipeline/extractFrameData.ts` (+ `.test.ts` for `pickDetections`) — **create**: combined pose + object-detection extractor.
- `src/pipeline/analyzeServe.ts` — **modify**: carry tracks through deps + result.
- `src/ui/DetectionOverlay.tsx` (+ `.test.tsx`) — **create**: canvas overlay for ball/racket/long-axis.
- `src/App.tsx` — **modify**: mount `DetectionOverlay` with a toggle.

---

### Task 1: Track types + `buildTracks` (pure tracking core)

The heart of A and fully testable without MediaPipe. Defines the data types its test constructs, the tracking thresholds, and the pure tracking function.

**Files:**
- Modify: `src/types.ts` (append new interfaces)
- Create: `src/constants/detection.ts`
- Create: `src/pipeline/buildTracks.ts`
- Test: `src/pipeline/buildTracks.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - Types in `src/types.ts`: `BoxNorm { x:number; y:number; w:number; h:number }`, `Detection { box:BoxNorm; score:number }`, `DetectionFrame { frameIndex:number; timestampMs:number; ball:Detection|null; racket:Detection|null }`, `TrackPoint { frameIndex:number; timestampMs:number; center:{x:number;y:number}; box:BoxNorm; score:number; interpolated:boolean }`, `ObjectTrack { points:(TrackPoint|null)[]; coverage:number }`, `BallTrack=ObjectTrack`, `RacketTrack=ObjectTrack`.
  - `buildTracks(frames: DetectionFrame[]): { ballTrack: ObjectTrack; racketTrack: ObjectTrack }`
  - Constants in `src/constants/detection.ts`: `TRACK_SCORE_MIN`, `TRACK_GATING_MAX_DIST`, `TRACK_MAX_GAP_FRAMES`, `TRACK_SMOOTH_WINDOW` (plus model constants used in Task 3).

- [ ] **Step 1: Add the types**

Append to `src/types.ts`:

```typescript
// ---- Ball / racket detection layer (see specs/2026-06-22-detection-layer) ----
export interface BoxNorm { x: number; y: number; w: number; h: number; } // normalized [0,1], origin top-left

export interface Detection { box: BoxNorm; score: number; }

export interface DetectionFrame {
  frameIndex: number;
  timestampMs: number;
  ball: Detection | null;   // best ball this frame, else null
  racket: Detection | null; // best racket this frame, else null
}

export interface TrackPoint {
  frameIndex: number;
  timestampMs: number;
  center: { x: number; y: number };
  box: BoxNorm;
  score: number;
  interpolated: boolean; // true = gap-filled, not a real detection
}

export interface ObjectTrack {
  points: (TrackPoint | null)[]; // one slot per input DetectionFrame; null = uncovered
  coverage: number;              // real (non-interpolated) detections / total frames
}
export type BallTrack = ObjectTrack;
export type RacketTrack = ObjectTrack;
```

- [ ] **Step 2: Add the tracking constants**

Create `src/constants/detection.ts`:

```typescript
// Object-detection + tracking constants for the ball/racket detection layer.
// task-rules §6: no magic literals in logic. All values are PROVISIONAL and are
// calibrated on the demo clip in the final validation task of this plan.

// --- Tracking (buildTracks) -------------------------------------------------
// Minimum detection score to accept a box (below = treated as no detection).
// Deliberately low: a fast, motion-blurred ball scores poorly and gap-fill
// closes the resulting holes. PROVISIONAL.
export const TRACK_SCORE_MIN = 0.2;

// Max normalized center-to-center jump between consecutive accepted detections,
// as a fraction of the (normalized) frame extent. Rejects a spurious far box
// (a background ball / a second racket) that would teleport the track.
// PROVISIONAL.
export const TRACK_GATING_MAX_DIST = 0.25;

// Interior gaps shorter than this many frames are linearly interpolated; longer
// gaps stay null (a low-confidence zone). At ~30fps, 8 frames ≈ 0.27s.
// PROVISIONAL.
export const TRACK_MAX_GAP_FRAMES = 8;

// Centered moving-average window for track-center smoothing. Mirrors
// SMOOTH_WINDOW_FRAMES for pose; tracks are noisier but the same window is safe.
export const TRACK_SMOOTH_WINDOW = 5;
```

- [ ] **Step 3: Write the failing test**

Create `src/pipeline/buildTracks.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildTracks } from './buildTracks';
import { TRACK_MAX_GAP_FRAMES } from '../constants/detection';
import type { Detection, DetectionFrame } from '../types';

// A square detection centered at (cx,cy) with side s and score 0.9.
function box(cx: number, cy: number, s = 0.1, score = 0.9): Detection {
  return { box: { x: cx - s / 2, y: cy - s / 2, w: s, h: s }, score };
}
function df(i: number, ball: Detection | null, racket: Detection | null = null): DetectionFrame {
  return { frameIndex: i, timestampMs: i * 33, ball, racket };
}

describe('buildTracks', () => {
  it('linearly interpolates a single-frame interior gap', () => {
    const frames = [df(0, box(0.2, 0.2)), df(1, null), df(2, box(0.4, 0.4))];
    const { ballTrack } = buildTracks(frames);
    expect(ballTrack.points[1]?.interpolated).toBe(true);
    expect(ballTrack.points[1]?.center.x).toBeCloseTo(0.3, 5);
    expect(ballTrack.coverage).toBeCloseTo(2 / 3, 5);
  });

  it('rejects a spurious far box via gating', () => {
    const frames = [df(0, box(0.5, 0.5)), df(1, box(0.95, 0.95))];
    const { ballTrack } = buildTracks(frames);
    expect(ballTrack.points[1]).toBeNull();
    expect(ballTrack.coverage).toBeCloseTo(0.5, 5);
  });

  it('drops a detection below the score threshold', () => {
    const frames = [df(0, box(0.4, 0.4, 0.1, 0.05))];
    expect(buildTracks(frames).ballTrack.points[0]).toBeNull();
  });

  it('smooths the track centers', () => {
    const frames = [df(0, box(0.30, 0.5)), df(1, box(0.40, 0.5)), df(2, box(0.30, 0.5))];
    const p = buildTracks(frames).ballTrack.points[1]!;
    expect(p.center.x).toBeCloseTo((0.30 + 0.40 + 0.30) / 3, 4); // 0.3333
  });

  it('does not fill a gap longer than TRACK_MAX_GAP_FRAMES', () => {
    const frames: DetectionFrame[] = [df(0, box(0.30, 0.30))];
    for (let i = 1; i <= TRACK_MAX_GAP_FRAMES + 1; i++) frames.push(df(i, null));
    frames.push(df(TRACK_MAX_GAP_FRAMES + 2, box(0.34, 0.30)));
    const { ballTrack } = buildTracks(frames);
    expect(ballTrack.points[1]).toBeNull();
  });

  it('tracks ball and racket independently', () => {
    const frames = [df(0, box(0.2, 0.2), box(0.7, 0.7))];
    const { ballTrack, racketTrack } = buildTracks(frames);
    expect(ballTrack.points[0]?.center.x).toBeCloseTo(0.2, 5);
    expect(racketTrack.points[0]?.center.x).toBeCloseTo(0.7, 5);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -- buildTracks`
Expected: FAIL — `buildTracks` is not defined / module not found.

- [ ] **Step 5: Write minimal implementation**

Create `src/pipeline/buildTracks.ts`:

```typescript
import type { BoxNorm, Detection, DetectionFrame, ObjectTrack, TrackPoint } from '../types';
import {
  TRACK_SCORE_MIN, TRACK_GATING_MAX_DIST, TRACK_MAX_GAP_FRAMES, TRACK_SMOOTH_WINDOW,
} from '../constants/detection';

type Pt = { x: number; y: number };
const centerOf = (b: BoxNorm): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
const lerpBox = (a: BoxNorm, b: BoxNorm, t: number): BoxNorm => ({
  x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
  w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t,
});

function buildTrack(frames: DetectionFrame[], pick: (f: DetectionFrame) => Detection | null): ObjectTrack {
  const n = frames.length;
  const pts: (TrackPoint | null)[] = new Array(n).fill(null);

  // 1) Accept the best detection per frame, gating against teleporting jumps.
  let lastCenter: Pt | null = null;
  let realCount = 0;
  for (let i = 0; i < n; i++) {
    const d = pick(frames[i]);
    if (!d || d.score < TRACK_SCORE_MIN) continue;
    const c = centerOf(d.box);
    if (lastCenter && dist(c, lastCenter) > TRACK_GATING_MAX_DIST) continue; // spurious far box
    pts[i] = {
      frameIndex: frames[i].frameIndex, timestampMs: frames[i].timestampMs,
      center: c, box: d.box, score: d.score, interpolated: false,
    };
    lastCenter = c;
    realCount++;
  }

  // 2) Linearly interpolate short interior gaps.
  let prev = -1;
  for (let i = 0; i < n; i++) {
    if (pts[i] === null) continue;
    if (prev >= 0 && i - prev - 1 > 0 && i - prev - 1 <= TRACK_MAX_GAP_FRAMES) {
      const a = pts[prev]!, b = pts[i]!;
      for (let k = prev + 1; k < i; k++) {
        const t = (k - prev) / (i - prev);
        const box = lerpBox(a.box, b.box, t);
        pts[k] = {
          frameIndex: frames[k].frameIndex, timestampMs: frames[k].timestampMs,
          center: centerOf(box), box, score: a.score + (b.score - a.score) * t, interpolated: true,
        };
      }
    }
    prev = i;
  }

  // 3) Smooth centers with a centered moving average that skips nulls.
  const half = Math.floor(TRACK_SMOOTH_WINDOW / 2);
  const smoothed = pts.map((p, i) => {
    if (p === null) return null;
    let sx = 0, sy = 0, cnt = 0;
    for (let j = -half; j <= half; j++) {
      const q = i + j >= 0 && i + j < n ? pts[i + j] : null;
      if (q) { sx += q.center.x; sy += q.center.y; cnt++; }
    }
    return { ...p, center: { x: sx / cnt, y: sy / cnt } };
  });

  return { points: smoothed, coverage: n > 0 ? realCount / n : 0 };
}

export function buildTracks(frames: DetectionFrame[]): { ballTrack: ObjectTrack; racketTrack: ObjectTrack } {
  return {
    ballTrack: buildTrack(frames, f => f.ball),
    racketTrack: buildTrack(frames, f => f.racket),
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- buildTracks`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/constants/detection.ts src/pipeline/buildTracks.ts src/pipeline/buildTracks.test.ts
git commit -m "feat(detection): pure buildTracks with gating, gap-fill, smoothing"
```

---

### Task 2: Shared frame walk (`walkVideoFrames`) + refactor `extractPoses`

Extract the seek loop so pose and object detection can share one walk (the spec's single-walk decision). `extractPoses.test.ts` only tests `estimateFps` and `DEFAULT_MODEL`, so the refactor is safe as long as those exports stay.

**Files:**
- Create: `src/pipeline/walkVideoFrames.ts`
- Test: `src/pipeline/walkVideoFrames.test.ts`
- Modify: `src/pipeline/extractPoses.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `frameSampleTimes(durationSec: number, stepSec: number): number[]`
  - `walkVideoFrames(video: HTMLVideoElement, onFrame: (frame: { timestampMs: number; index: number }) => void | Promise<void>, onProgress?: (frac: number) => void): Promise<void>`
  - `SAMPLE_STEP_SEC: number` (exported from `walkVideoFrames.ts`)
  - From `extractPoses.ts` (newly exported for Task 3): `WASM_BASE: string`, `MODEL_URLS: Record<PoseModel,string>`, `mapLandmarks(raw): Landmark[]`.

- [ ] **Step 1: Write the failing test**

Create `src/pipeline/walkVideoFrames.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { frameSampleTimes, SAMPLE_STEP_SEC } from './walkVideoFrames';

describe('frameSampleTimes', () => {
  it('samples up to (but not including) the duration', () => {
    // 0.1s at 1/30s step: t=0, 0.0333, 0.0666 (0.1 is not < 0.1)
    const times = frameSampleTimes(0.1, 1 / 30);
    expect(times).toHaveLength(3);
    expect(times[0]).toBe(0);
    expect(times[2]).toBeCloseTo(2 / 30, 5);
  });

  it('uses an integer-indexed loop (no float drift over many steps)', () => {
    const times = frameSampleTimes(1, SAMPLE_STEP_SEC);
    expect(times[times.length - 1]).toBeCloseTo((times.length - 1) * SAMPLE_STEP_SEC, 10);
  });

  it('returns empty for a zero-length clip', () => {
    expect(frameSampleTimes(0, 1 / 30)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- walkVideoFrames`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/pipeline/walkVideoFrames.ts`:

```typescript
// Single source of truth for the "~30 fps" sampling intent (was in extractPoses).
export const SAMPLE_STEP_SEC = 1 / 30;

// Integer-indexed sample times in [0, duration). Integer loop, not float
// accumulation: adding a float STEP would drift over a 30s clip.
export function frameSampleTimes(durationSec: number, stepSec: number): number[] {
  const times: number[] = [];
  for (let i = 0; i * stepSec < durationSec; i++) times.push(i * stepSec);
  return times;
}

// Seek-and-wait per sample time, invoking onFrame once the frame is ready.
// Impure boundary (drives the <video> element); validated via the demo overlay.
const SEEK_TIMEOUT_MS = 5000;
export async function walkVideoFrames(
  video: HTMLVideoElement,
  onFrame: (frame: { timestampMs: number; index: number }) => void | Promise<void>,
  onProgress?: (frac: number) => void,
): Promise<void> {
  const duration = video.duration;
  const times = frameSampleTimes(duration, SAMPLE_STEP_SEC);
  for (let i = 0; i < times.length; i++) {
    await seekTo(video, times[i]);
    await onFrame({ timestampMs: video.currentTime * 1000, index: i });
    onProgress?.(Math.min(1, times[i] / duration));
  }
  onProgress?.(1);
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const onSeeked = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', onSeeked);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', onSeeked);
      reject(new Error(`seek to ${time.toFixed(3)}s timed out after ${SEEK_TIMEOUT_MS}ms`));
    }, SEEK_TIMEOUT_MS);
    video.addEventListener('seeked', onSeeked);
    video.currentTime = time;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- walkVideoFrames`
Expected: PASS (3 tests).

- [ ] **Step 5: Refactor `extractPoses` to use the shared walk and export reusable pieces**

In `src/pipeline/extractPoses.ts`:

Add `export` to `WASM_BASE` and `MODEL_URLS` (change `const WASM_BASE` → `export const WASM_BASE`, and `const MODEL_URLS` → `export const MODEL_URLS`). Remove the local `SAMPLE_STEP_SEC`/`DEFAULT_FPS` duplication for the step (keep `DEFAULT_FPS` for `estimateFps`; import `SAMPLE_STEP_SEC` is not needed here anymore since the loop moves out). Add a shared landmark mapper and replace the body of `extractPoses` and delete its local `seekTo`:

```typescript
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { PoseFrame, Landmark } from '../types';
import { walkVideoFrames } from './walkVideoFrames';

const DEFAULT_FPS = 30;

export const MEDIAPIPE_VERSION = '0.10.35';
export const WASM_BASE =
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const MODEL_BASE =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker';
export const MODEL_URLS: Record<PoseModel, string> = {
  lite: `${MODEL_BASE}/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
  full: `${MODEL_BASE}/pose_landmarker_full/float16/1/pose_landmarker_full.task`,
  heavy: `${MODEL_BASE}/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task`,
};

export type PoseModel = 'lite' | 'full' | 'heavy';
export const DEFAULT_MODEL: PoseModel = 'heavy';

// Shared mapping of a raw MediaPipe landmark list to our Landmark[] (Task 3 reuses it).
export function mapLandmarks(raw: Array<{ x: number; y: number; z: number; visibility?: number }>): Landmark[] {
  return raw.map(p => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 0 }));
}

async function createLandmarker(model: PoseModel): Promise<PoseLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URLS[model] },
    runningMode: 'VIDEO',
    numPoses: 1,
  });
}

export function estimateFps(timestampsMs: number[]): number {
  if (timestampsMs.length < 2) return DEFAULT_FPS;
  const deltas: number[] = [];
  for (let i = 1; i < timestampsMs.length; i++) deltas.push(timestampsMs[i] - timestampsMs[i - 1]);
  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)];
  return median > 0 ? 1000 / median : DEFAULT_FPS;
}

export async function extractPoses(
  video: HTMLVideoElement,
  onProgress?: (frac: number) => void,
  model: PoseModel = DEFAULT_MODEL,
): Promise<{ poses: PoseFrame[]; fps: number }> {
  const landmarker = await createLandmarker(model);
  const poses: PoseFrame[] = [];
  let poseIndex = 0; // counts kept frames only (33-landmark filter creates gaps)
  await walkVideoFrames(video, ({ timestampMs }) => {
    const result = landmarker.detectForVideo(video, timestampMs);
    const landmarks = mapLandmarks(result.landmarks[0] ?? []);
    if (landmarks.length === 33) poses.push({ frameIndex: poseIndex++, timestampMs, landmarks });
  }, onProgress);
  landmarker.close();
  return { poses, fps: estimateFps(poses.map(p => p.timestampMs)) };
}
```

(Delete the old `SAMPLE_STEP_SEC`, the old inline `for` loop, and the old `seekTo` from this file — they now live in `walkVideoFrames.ts`.)

- [ ] **Step 6: Verify the existing pose tests still pass**

Run: `npm test -- extractPoses`
Expected: PASS (`estimateFps` 3 tests + `DEFAULT_MODEL` 1 test).

- [ ] **Step 7: Commit**

```bash
git add src/pipeline/walkVideoFrames.ts src/pipeline/walkVideoFrames.test.ts src/pipeline/extractPoses.ts
git commit -m "refactor(pipeline): extract shared walkVideoFrames from extractPoses"
```

---

### Task 3: Combined extractor `extractFrameData` (pose + object detection)

One walk runs both models; poses and detections are appended together only on kept (33-landmark) frames, so the two arrays stay index- and timestamp-aligned. `pickDetections` (pure) is tested; the walk is validated on the demo clip.

**Files:**
- Modify: `src/constants/detection.ts` (add model constants)
- Create: `src/pipeline/extractFrameData.ts`
- Test: `src/pipeline/extractFrameData.test.ts` (covers `pickDetections`)

**Interfaces:**
- Consumes: `walkVideoFrames`, `WASM_BASE`, `MODEL_URLS`, `mapLandmarks`, `estimateFps`, `DEFAULT_MODEL`, `PoseModel` (Task 2); `DetectionFrame`, `Detection` (Task 1).
- Produces:
  - `interface RawDetection { categories: { categoryName: string; score: number }[]; boundingBox?: { originX: number; originY: number; width: number; height: number } }`
  - `pickDetections(raw: RawDetection[], videoW: number, videoH: number): { ball: Detection | null; racket: Detection | null }`
  - `extractFrameData(video: HTMLVideoElement, onProgress?: (f: number) => void, model?: PoseModel): Promise<{ poses: PoseFrame[]; fps: number; detections: DetectionFrame[] }>`
  - Constants: `OBJECT_MODEL_URL`, `COCO_BALL`, `COCO_RACKET`.

- [ ] **Step 1: Add the model constants**

Append to `src/constants/detection.ts`:

```typescript
// --- Model (MediaPipe ObjectDetector, EfficientDet-Lite0, COCO, Apache-2.0) --
// Pinned exactly like MEDIAPIPE_VERSION in extractPoses: '@latest'/'1' drift
// would move the model away from the API we compile against. Loading from a CDN
// is allowed by task-rules §4.
export const OBJECT_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.task';

// COCO category names emitted by EfficientDet-Lite0 for the two tracked objects.
// Used as the ObjectDetector categoryAllowlist and to bucket detections.
export const COCO_BALL = 'sports ball';
export const COCO_RACKET = 'tennis racket';
```

- [ ] **Step 2: Write the failing test**

Create `src/pipeline/extractFrameData.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { pickDetections, type RawDetection } from './extractFrameData';

const raw = (name: string, score: number, x = 0, y = 0, w = 100, h = 100): RawDetection => ({
  categories: [{ categoryName: name, score }],
  boundingBox: { originX: x, originY: y, width: w, height: h },
});

describe('pickDetections', () => {
  it('normalizes the bounding box by the video dimensions', () => {
    const { ball } = pickDetections([raw('sports ball', 0.8, 100, 50, 40, 40)], 400, 200);
    expect(ball).not.toBeNull();
    expect(ball!.box).toEqual({ x: 0.25, y: 0.25, w: 0.1, h: 0.2 });
    expect(ball!.score).toBe(0.8);
  });

  it('keeps the highest-scoring detection per class', () => {
    const { racket } = pickDetections(
      [raw('tennis racket', 0.4), raw('tennis racket', 0.7)], 100, 100);
    expect(racket!.score).toBe(0.7);
  });

  it('buckets ball and racket separately and ignores other classes', () => {
    const { ball, racket } = pickDetections(
      [raw('sports ball', 0.6), raw('tennis racket', 0.9), raw('person', 0.99)], 100, 100);
    expect(ball!.score).toBe(0.6);
    expect(racket!.score).toBe(0.9);
  });

  it('returns nulls when nothing relevant is detected', () => {
    expect(pickDetections([], 100, 100)).toEqual({ ball: null, racket: null });
  });

  it('skips detections with no bounding box or bad video dimensions', () => {
    const noBox: RawDetection = { categories: [{ categoryName: 'sports ball', score: 0.9 }] };
    expect(pickDetections([noBox], 100, 100).ball).toBeNull();
    expect(pickDetections([raw('sports ball', 0.9)], 0, 0).ball).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- extractFrameData`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

Create `src/pipeline/extractFrameData.ts`:

```typescript
import { FilesetResolver, PoseLandmarker, ObjectDetector } from '@mediapipe/tasks-vision';
import type { PoseFrame, Detection, DetectionFrame } from '../types';
import { walkVideoFrames } from './walkVideoFrames';
import {
  WASM_BASE, MODEL_URLS, mapLandmarks, estimateFps, DEFAULT_MODEL, type PoseModel,
} from './extractPoses';
import {
  OBJECT_MODEL_URL, COCO_BALL, COCO_RACKET, TRACK_SCORE_MIN,
} from '../constants/detection';

// Subset of the MediaPipe ObjectDetector result we consume. boundingBox is in
// pixels of the input frame; we normalize it against the video dimensions.
export interface RawDetection {
  categories: { categoryName: string; score: number }[];
  boundingBox?: { originX: number; originY: number; width: number; height: number };
}

// Pure: pick the best ball and the best racket from one frame's raw detections.
export function pickDetections(
  raw: RawDetection[], videoW: number, videoH: number,
): { ball: Detection | null; racket: Detection | null } {
  let ball: Detection | null = null;
  let racket: Detection | null = null;
  if (videoW <= 0 || videoH <= 0) return { ball, racket };
  for (const d of raw) {
    const bb = d.boundingBox;
    if (!bb) continue;
    const det: Detection = {
      box: { x: bb.originX / videoW, y: bb.originY / videoH, w: bb.width / videoW, h: bb.height / videoH },
      score: d.categories[0]?.score ?? 0,
    };
    for (const c of d.categories) {
      const cand: Detection = { ...det, score: c.score };
      if (c.categoryName === COCO_BALL && (!ball || c.score > ball.score)) ball = cand;
      else if (c.categoryName === COCO_RACKET && (!racket || c.score > racket.score)) racket = cand;
    }
  }
  return { ball, racket };
}

// Combined extractor: one shared frame walk, both models per frame. poses and
// detections are appended together only on kept (33-landmark) frames, so the
// arrays stay index- and timestamp-aligned. Impure boundary; validated on the
// demo clip via DetectionOverlay.
export async function extractFrameData(
  video: HTMLVideoElement,
  onProgress?: (frac: number) => void,
  model: PoseModel = DEFAULT_MODEL,
): Promise<{ poses: PoseFrame[]; fps: number; detections: DetectionFrame[] }> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  const landmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URLS[model] },
    runningMode: 'VIDEO',
    numPoses: 1,
  });
  const detector = await ObjectDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: OBJECT_MODEL_URL },
    runningMode: 'VIDEO',
    scoreThreshold: TRACK_SCORE_MIN,
    categoryAllowlist: [COCO_BALL, COCO_RACKET],
  });

  const poses: PoseFrame[] = [];
  const detections: DetectionFrame[] = [];
  let idx = 0;
  await walkVideoFrames(video, ({ timestampMs }) => {
    const pose = landmarker.detectForVideo(video, timestampMs);
    const landmarks = mapLandmarks(pose.landmarks[0] ?? []);
    if (landmarks.length !== 33) return; // keep poses & detections aligned to kept frames
    const od = detector.detectForVideo(video, timestampMs);
    const picked = pickDetections(od.detections as RawDetection[], video.videoWidth, video.videoHeight);
    poses.push({ frameIndex: idx, timestampMs, landmarks });
    detections.push({ frameIndex: idx, timestampMs, ball: picked.ball, racket: picked.racket });
    idx++;
  }, onProgress);

  landmarker.close();
  detector.close();
  return { poses, fps: estimateFps(poses.map(p => p.timestampMs)), detections };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- extractFrameData`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/constants/detection.ts src/pipeline/extractFrameData.ts src/pipeline/extractFrameData.test.ts
git commit -m "feat(detection): combined pose+object extractor with pickDetections"
```

---

### Task 4: Carry tracks through `analyzeServe`

Switch the production extractor to `extractFrameData`, build tracks from its detections, and add them to the success result. The deps seam keeps detections optional so existing synthetic-extract tests still typecheck and pass.

**Files:**
- Modify: `src/pipeline/analyzeServe.ts`
- Test: `src/pipeline/analyzeServe.test.ts` (add cases)

**Interfaces:**
- Consumes: `extractFrameData` (Task 3), `buildTracks` (Task 1), `DetectionFrame`, `BallTrack`, `RacketTrack` (Task 1).
- Produces: `AnalysisResult` `ok:true` branch gains `ballTrack: BallTrack; racketTrack: RacketTrack`. `AnalyzeDeps.extract` return type gains optional `detections?: DetectionFrame[]`.

- [ ] **Step 1: Write the failing test**

Add to `src/pipeline/analyzeServe.test.ts` (inside the top `describe`):

```typescript
  it('builds ball/racket tracks from the extractor detections', async () => {
    const poses = buildHappyServe();
    const detections = poses.map(p => ({
      frameIndex: p.frameIndex, timestampMs: p.timestampMs,
      ball: { box: { x: 0.5, y: 0.3, w: 0.05, h: 0.05 }, score: 0.9 },
      racket: null,
    }));
    const extract = async () => ({ poses, fps: 30, detections });
    const r = await analyzeServe(video(5), 'right', undefined, { deps: { extract } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ballTrack.points.length).toBe(detections.length);
      expect(r.ballTrack.coverage).toBeCloseTo(1, 5);
      expect(r.racketTrack.coverage).toBe(0);
    }
  });

  it('returns empty tracks when the extractor yields no detections', async () => {
    const extract = async () => ({ poses: buildHappyServe(), fps: 30 });
    const r = await analyzeServe(video(5), 'right', undefined, { deps: { extract } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ballTrack.points).toEqual([]);
      expect(r.ballTrack.coverage).toBe(0);
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- analyzeServe`
Expected: FAIL — `ballTrack` does not exist on the result type / value.

- [ ] **Step 3: Wire tracks into `analyzeServe`**

In `src/pipeline/analyzeServe.ts`:

Add imports:

```typescript
import type { Handedness, PoseFrame, Phases, DetectionFrame, BallTrack, RacketTrack } from '../types';
import { buildTracks } from './buildTracks';
import { extractFrameData } from './extractFrameData';
```

Change the success result type and the deps type, and swap the default extractor:

```typescript
export type AnalysisResult =
  | { ok: true; phases: Phases; findings: Finding[]; ruleResults: RuleResult[];
      poses: PoseFrame[]; ballTrack: BallTrack; racketTrack: RacketTrack }
  | { ok: false; error: AnalysisError; poses: PoseFrame[] };

export interface AnalyzeDeps {
  extract: (v: HTMLVideoElement, onProgress?: (f: number) => void, model?: PoseModel) =>
    Promise<{ poses: PoseFrame[]; fps: number; detections?: DetectionFrame[] }>;
}
const defaultDeps: AnalyzeDeps = { extract: extractFrameData };
```

(Remove the now-unused `import { extractPoses, type PoseModel } from './extractPoses';` and import the `PoseModel` type from `extractPoses` directly: `import type { PoseModel } from './extractPoses';`.)

In the success branch, build and return the tracks (the `raw` variable already holds the extractor output):

```typescript
    const ctx = buildPhaseContext(smoothed, raw.fps, phases);
    const findings = runRules(ctx, ALL_RULES);
    const ruleResults = runRulesReport(ctx, ALL_RULES);
    const { ballTrack, racketTrack } = buildTracks(raw.detections ?? []);
    return { ok: true, phases, findings, ruleResults, poses: smoothed, ballTrack, racketTrack };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- analyzeServe`
Expected: PASS (existing 5 + new 2).

- [ ] **Step 5: Typecheck the whole project (App.tsx consumes AnalysisResult)**

Run: `npm run build`
Expected: PASS. If `App.tsx` destructures the result and TS complains about the new required fields, that is handled in Task 6; for now the build should still pass because the new fields are additive on the `ok` branch. If it fails, note the error and proceed to Task 6 which updates `App.tsx`.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/analyzeServe.ts src/pipeline/analyzeServe.test.ts
git commit -m "feat(detection): carry ball/racket tracks through analyzeServe"
```

---

### Task 5: `DetectionOverlay` component

A canvas overlay mirroring `SkeletonOverlay`'s rAF + nearest-by-timestamp pattern, drawing the ball as a circle, the racket as a box, and the racket long-axis as a line from the racket-hand wrist to the racket box center (the orientation proxy C will build on). Guards `getContext` so it renders safely under jsdom.

**Files:**
- Create: `src/ui/DetectionOverlay.tsx`
- Test: `src/ui/DetectionOverlay.test.tsx`

**Interfaces:**
- Consumes: `BallTrack`, `RacketTrack`, `PoseFrame`, `Handedness` (types); `racketWrist` from `src/pose/landmarks`.
- Produces: `DetectionOverlay` React component with props `{ videoRef: RefObject<HTMLVideoElement | null>; ballTrack: BallTrack; racketTrack: RacketTrack; poses: PoseFrame[]; handedness: Handedness }`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/DetectionOverlay.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { createRef } from 'react';
import { DetectionOverlay } from './DetectionOverlay';
import type { BallTrack, RacketTrack } from '../types';

const empty: BallTrack = { points: [], coverage: 0 };

describe('DetectionOverlay', () => {
  it('renders a canvas without crashing on empty tracks and a null video ref', () => {
    const ref = createRef<HTMLVideoElement>();
    const { container } = render(
      <DetectionOverlay
        videoRef={ref}
        ballTrack={empty}
        racketTrack={empty as RacketTrack}
        poses={[]}
        handedness="right"
      />,
    );
    expect(container.querySelector('canvas')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- DetectionOverlay`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `src/ui/DetectionOverlay.tsx`:

```typescript
import { useEffect, useRef, type RefObject } from 'react';
import type { BallTrack, RacketTrack, PoseFrame, Handedness, TrackPoint } from '../types';
import { racketWrist } from '../pose/landmarks';

const BALL_COLOR = '#22D3EE';   // cyan — distinct from the green skeleton
const RACKET_COLOR = '#F472B6'; // pink — distinct from ball and skeleton

// Nearest track point to a video time, or null if the slot is uncovered.
function nearestPoint(points: (TrackPoint | null)[], tMs: number): TrackPoint | null {
  let best: TrackPoint | null = null;
  let bestDist = Infinity;
  for (const p of points) {
    if (!p) continue;
    const d = Math.abs(p.timestampMs - tMs);
    if (d < bestDist) { best = p; bestDist = d; }
  }
  return best;
}

function nearestPose(poses: PoseFrame[], tMs: number): PoseFrame | null {
  if (poses.length === 0) return null;
  let best = poses[0];
  for (const f of poses) {
    if (Math.abs(f.timestampMs - tMs) < Math.abs(best.timestampMs - tMs)) best = f;
  }
  return best;
}

export function DetectionOverlay({
  videoRef, ballTrack, racketTrack, poses, handedness,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  ballTrack: BallTrack;
  racketTrack: RacketTrack;
  poses: PoseFrame[];
  handedness: Handedness;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // jsdom / unsupported: render nothing, do not crash
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const w = video.clientWidth, h = video.clientHeight;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      ctx.clearRect(0, 0, w, h);

      const tMs = video.currentTime * 1000;

      // Ball: filled circle at the (smoothed) center, radius from the box.
      const ball = nearestPoint(ballTrack.points, tMs);
      if (ball) {
        const r = Math.max(ball.box.w, ball.box.h) * 0.5 * w;
        ctx.beginPath();
        ctx.arc(ball.center.x * w, ball.center.y * h, Math.max(4, r), 0, Math.PI * 2);
        ctx.fillStyle = BALL_COLOR;
        ctx.globalAlpha = ball.interpolated ? 0.4 : 0.85; // dim gap-filled points
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Racket: bounding box + long-axis line from the racket-hand wrist to the
      // box center (the in-plane orientation proxy that sub-project C builds on).
      const racket = nearestPoint(racketTrack.points, tMs);
      if (racket) {
        ctx.strokeStyle = RACKET_COLOR;
        ctx.lineWidth = racket.interpolated ? 1 : 2;
        ctx.globalAlpha = racket.interpolated ? 0.5 : 1;
        ctx.strokeRect(racket.box.x * w, racket.box.y * h, racket.box.w * w, racket.box.h * h);

        const pose = nearestPose(poses, tMs);
        if (pose) {
          const wrist = racketWrist(pose, handedness);
          ctx.beginPath();
          ctx.moveTo(wrist.x * w, wrist.y * h);
          ctx.lineTo(racket.center.x * w, racket.center.y * h);
          ctx.lineWidth = 3;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [videoRef, ballTrack, racketTrack, poses, handedness]);

  return <canvas ref={canvasRef} className="skeleton-overlay" />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- DetectionOverlay`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/ui/DetectionOverlay.tsx src/ui/DetectionOverlay.test.tsx
git commit -m "feat(detection): DetectionOverlay canvas for ball/racket/long-axis"
```

---

### Task 6: Wire `DetectionOverlay` into `App` + demo-clip validation

Mount the overlay alongside `SkeletonOverlay` behind a toggle, then validate and calibrate on the demo clip. This task's deliverable is verified by the demo-clip observation plus a green `npm test` and `npm run build`.

**Files:**
- Modify: `src/App.tsx`
- Modify (calibration only, if needed): `src/constants/detection.ts`
- Modify (i18n, for the toggle label): `src/i18n/locales/en.json`, `src/i18n/locales/ru.json`

**Interfaces:**
- Consumes: `DetectionOverlay` (Task 5); `result.ballTrack` / `result.racketTrack` from `AnalysisResult` (Task 4).
- Produces: no new module exports.

- [ ] **Step 1: Add an i18n label for the toggle**

In `src/i18n/locales/en.json`, add under the appropriate existing section (mirror where `skeleton.preview` lives):

```json
"detection": { "toggle": "Show ball & racket" }
```

In `src/i18n/locales/ru.json`, add the matching key:

```json
"detection": { "toggle": "Показать мяч и ракетку" }
```

- [ ] **Step 2: Mount the overlay in `App.tsx`**

Add the import near the other UI imports:

```typescript
import { DetectionOverlay } from './ui/DetectionOverlay';
```

Add a toggle state near the other `useState` hooks:

```typescript
const [showDetections, setShowDetections] = useState(true);
```

Locate the existing `<SkeletonOverlay ... />` (around `App.tsx:490`). Immediately after it, render the detection overlay on the success path. Because `ballTrack`/`racketTrack` exist only on the `ok` result, guard on the same condition the surrounding code already uses to access `result.phases`/`result.poses` (follow the local variable the file uses — e.g. an `ok`-narrowed `result`):

```tsx
{result?.ok && showDetections && (
  <DetectionOverlay
    videoRef={videoRef}
    ballTrack={result.ballTrack}
    racketTrack={result.racketTrack}
    poses={result.poses}
    handedness={hand}
  />
)}
```

Add a checkbox near the existing overlay/controls (mirror an existing control's markup; `hand` is the handedness variable already passed to `analyzeServe` at `App.tsx:225`):

```tsx
<label className="flex items-center gap-2 text-sm">
  <input type="checkbox" checked={showDetections} onChange={e => setShowDetections(e.target.checked)} />
  {t('detection.toggle')}
</label>
```

(Use the same `t` translation function already imported in `App.tsx`. If the exact variable names differ — `result`, `hand`, `videoRef`, `t` — use the file's actual names; do not invent new ones.)

- [ ] **Step 3: Typecheck and run the full test suite**

Run: `npm run build && npm test`
Expected: both PASS. Fix any type errors from the new required `ok`-branch fields surfacing in `App.tsx`.

- [ ] **Step 4: Validate on the demo clip (manual)**

Run: `npm run dev`
Then in the browser:
1. Load the demo serve (the "Try a demo serve" button; clip at `public/demo/clips/serve-right-side.mp4`).
2. After analysis, ensure "Show ball & racket" is on and scrub the video.
3. Confirm visually: the cyan ball circle follows the toss/contact, the pink racket box and long-axis line follow the racket through trophy→follow-through.
4. Read the console: the existing `[analyzeServe]` diagnostics print frame counts. (Optional, if useful) temporarily log `ballTrack.coverage` and `racketTrack.coverage` to confirm against the success metrics.

Record what you observe (coverage, where tracking drops out).

- [ ] **Step 5: Calibrate thresholds against the spec's success metrics**

Compare observations to the spec:
- Racket detected in ≥80% of trophy→follow-through frames; ball in ≥50% of toss→contact frames; no unexplained gap > `TRACK_MAX_GAP_FRAMES`.

If the metrics are missed, adjust the PROVISIONAL constants in `src/constants/detection.ts` (lower `TRACK_SCORE_MIN` to raise recall; widen `TRACK_GATING_MAX_DIST` if a fast ball is wrongly gated out; raise `TRACK_MAX_GAP_FRAMES` if real motion-blur gaps are slightly longer). Re-run `npm run dev` and re-check. Update each changed constant's comment from "PROVISIONAL" to note the demo-clip calibration, mirroring the style of the calibrated constants in `src/constants/biomechanics.ts`.

If the metrics cannot be met with EfficientDet-Lite0 (especially ball recall), record this in the spec's Risks section as the trigger for the permissive-YOLO upgrade in sub-project B — do NOT introduce YOLOv8 here (AGPL).

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/i18n/locales/en.json src/i18n/locales/ru.json src/constants/detection.ts
git commit -m "feat(detection): show ball/racket overlay in App; calibrate on demo clip"
```

---

## Self-Review

**1. Spec coverage:**
- Single shared frame walk (no extra seeks) → Task 2 (`walkVideoFrames`) + Task 3 (`extractFrameData` runs both models in one walk). ✓
- COCO detector (ball + racket), MediaPipe ObjectDetector, Apache-2.0, no new heavy dep → Task 3. ✓
- New types `DetectionFrame`/`ObjectTrack`/`BallTrack`/`RacketTrack` + `coverage` → Task 1. ✓
- Association + gating + gap-fill + smoothing in a pure function → Task 1 (`buildTracks`). ✓
- Index/timestamp alignment to pose frames → Task 3 (append together on kept frames) + overlay matches by timestamp. ✓
- Validation overlay (ball circle, racket box, long-axis) → Task 5 + Task 6. ✓
- No new rules / no event/metric changes → respected (only `analyzeServe` additively returns tracks). ✓
- Thresholds as named constants with sources → `src/constants/detection.ts` (Task 1/3), calibrated in Task 6. ✓
- Success metrics (recall %, gaps, processing time) → Task 6 validation. ✓
- Future work D (pose+racket model) → recorded in spec; not in this plan (correct). ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; manual validation steps (Task 6) are inherent to demo-clip calibration and spell out exact actions. ✓

**3. Type consistency:** `BoxNorm`/`Detection`/`DetectionFrame`/`TrackPoint`/`ObjectTrack` defined in Task 1 and used unchanged in Tasks 3–5. `buildTracks` signature consistent (Task 1 → Task 4). `pickDetections`/`RawDetection` consistent (Task 3 → its test). `extractFrameData` return shape `{poses,fps,detections}` matches `AnalyzeDeps.extract` (optional `detections`) in Task 4. `DetectionOverlay` props match the call site in Task 6. ✓

**Note on a spec refinement:** the plan uses MediaPipe `ObjectDetector` (reuses `@mediapipe/tasks-vision`) instead of TF.js `coco-ssd`; spec §Model choice was updated to match, with `coco-ssd` kept as the documented alternative.
