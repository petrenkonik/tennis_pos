# Detection Layer (ball + racket tracking)

## Context

The current pipeline (`docs/superpowers/specs/2026-06-20-cv-pipeline-mvp-design.md`)
uses **only the MediaPipe skeleton**. The racket is approximated by the racket-hand
wrist (`racketWrist`) and the ball by the toss-arm trajectory. Every event
(`release`, `trophy`, `contact`) and metric (`contactHeightAboveShoulder`,
`tossApexFrame`, `racketDropDepth`, …) is derived from wrist landmarks.

The driving motivation for real ball/racket tracking is detecting the
**"waiter's tray" error** (no forearm pronation, an "open" racket face on the
serve). The wrist proxy is useless for that — it carries no information about
the racket face or pronation.

This is too large for one spec, so the work is decomposed into three cycles
(`spec → plan → code` each):

- **A. Detection layer (this spec)** — add an in-browser object-detection pass
  producing per-frame ball/racket tracks + a validation overlay. No new rules,
  no change to event/metric logic.
- **B. Position / event refinement** — use the tracks to refine the contact
  point and timing (ball trajectory) and the toss metrics, replacing wrist
  proxies.
- **C. Racket orientation + "waiter's tray" rule** — racket long-axis angle and
  an apparent-aspect pronation proxy → a new error rule.

A de-risks and feeds both B and C, so it ships first.

## Goals / Non-goals

### Goals
- Add an in-browser object detector that emits per-frame ball and racket
  bounding boxes, reusing the existing frame walk (no extra video seeks).
- Associate detections into smoothed single-object tracks per class, with gating
  against spurious boxes and short-gap interpolation.
- Expose new data types (`DetectionFrame`, `ObjectTrack`, `BallTrack`,
  `RacketTrack`) and a per-track `coverage` confidence for downstream B/C.
- Render a scrubbable validation overlay (ball circle, racket box, racket
  long-axis) over the demo clip.
- Keep all processing on-device in the browser (locked decision).

### Non-goals
- No new error rules and no `runRules` changes (deferred to C).
- No change to `detectPhases` / event detection or to existing metrics
  (deferred to B). Tracks are produced and visualized only.
- No custom model training. We use a COCO-pretrained detector
  (`sports ball`, `tennis racket` are existing COCO classes).
- No Layer-1 user-facing advice. A is infrastructure; the overlay is a
  Layer-2/debug artifact.

## Architecture

A single shared frame walk runs **both** models per seeked frame. A second,
separate pass would double the expensive `seek` operations over a ~30 s clip, so
the existing per-frame loop in `extractPoses` is generalised into a shared
`walkVideoFrames` helper that both the pose landmarker and the object detector
consume.

```
video ─► walkVideoFrames(onFrame)
            ├─ PoseLandmarker   → PoseFrame[]
            └─ ObjectDetector   → DetectionFrame[]   (ball | null, racket | null)
                                      │
                                      ▼
                          buildTracks (pure function)
              association → gating → gap-fill → smooth → coverage
                                      │
                                      ▼
                   { ballTrack: BallTrack, racketTrack: RacketTrack }
```

- `walkVideoFrames` and `extractDetections` are the impure boundary (like the
  current `extractPoses`); they are not unit-tested and are validated via the
  overlay on the demo clip.
- `buildTracks` is a **pure function** of `DetectionFrame[]` → covered by unit
  tests (TDD).
- Tracks are aligned by index to `PoseFrame[]` (same frame walk → same indices),
  so downstream B/C can read `racketTrack.points[i]` alongside `poses[i]`.

### Model choice
COCO already includes `sports ball` (32) and `tennis racket` (38), so no
training is needed for bounding boxes. For A we use **TF.js `coco-ssd`
(MobileNet, Apache-2.0)**: trivially in-browser and licence-clean. The exact
model/runtime version is pinned (as `MEDIAPIPE_VERSION` is), with a source
comment. Loading weights from a CDN is allowed by `task-rules §4`.

Alternatives considered:
- **YOLOv8n via onnxruntime-web** — better small-object (ball) recall, but
  **AGPL-3.0**, which is toxic for a product. Rejected for A; kept as a possible
  permissive-licence upgrade (YOLOX / RT-DETR, Apache-2.0) decided in B's plan
  if ball recall proves insufficient.
- **A separate second pass** for detection — rejected: doubles `seek` cost.

## Interfaces

Sketches only (no implementation per `task-rules §2`).

```ts
// New types (src/types.ts)
interface BoxNorm { x: number; y: number; w: number; h: number; } // normalized [0,1]
interface Detection { box: BoxNorm; score: number; }

interface DetectionFrame {
  frameIndex: number;
  timestampMs: number;
  ball: Detection | null;       // highest-score ball above threshold, else null
  racket: Detection | null;     // highest-score racket above threshold, else null
}

interface TrackPoint {
  frameIndex: number;
  timestampMs: number;
  center: { x: number; y: number };
  box: BoxNorm;
  score: number;
  interpolated: boolean;        // true if filled, not a real detection
}

interface ObjectTrack {
  points: (TrackPoint | null)[]; // index-aligned to PoseFrame[]; null = uncovered
  coverage: number;              // fraction of frames with a real (non-interpolated) detection
}
type BallTrack = ObjectTrack;
type RacketTrack = ObjectTrack;

// Shared frame walk (src/pipeline/walkVideoFrames.ts) — refactor of extractPoses' loop.
// The single seek loop; both models run inside onFrame, so neither pose nor
// detection performs its own walk.
function walkVideoFrames(
  video: HTMLVideoElement,
  onFrame: (frame: { source: ImageBitmap | HTMLVideoElement; timestampMs: number; index: number }) => void,
  onProgress?: (frac: number) => void,
): Promise<void>;

// Detection-side per-frame logic (src/pipeline/extractDetections.ts), the impure
// boundary around the object detector. Consumes one already-seeked frame and
// returns its DetectionFrame; the combined extractor composes this with the pose
// landmarker inside a single walkVideoFrames pass.
function detectFrame(
  source: ImageBitmap | HTMLVideoElement,
  timestampMs: number,
  index: number,
): DetectionFrame;

// Pure core (src/pipeline/buildTracks.ts)
function buildTracks(
  frames: DetectionFrame[],
): { ballTrack: BallTrack; racketTrack: RacketTrack };
```

### Tracking rules (inside `buildTracks`)
- **Single object per class.** Per frame, take the highest-score detection above
  `DETECT_SCORE_MIN`.
- **Gating.** Reject a detection whose center is farther than
  `TRACK_GATING_MAX_DIST` from the predicted/previous center (rejects background
  ball / a second racket).
- **Gap-fill.** Gaps shorter than `TRACK_MAX_GAP_FRAMES` are linearly
  interpolated and marked `interpolated: true`; longer gaps stay `null`.
- **Smoothing.** Track centers are smoothed with the existing `smooth.ts`
  (window `TRACK_SMOOTH_WINDOW`).
- **Coverage.** `coverage` = real detections / total frames, surfaced for B/C.

All thresholds are named constants with a source comment (`task-rules §6`),
collected with the other pipeline constants.

## Success metrics

Calibrated on the real demo clip (mirrors the existing offline CV validation
approach):

- Racket detected (real, pre-gap-fill) in **≥80%** of frames in the
  trophy→follow-through window.
- Ball detected in **≥50%** of frames in the toss→contact window (lower bar is
  realistic due to motion blur; gap-fill closes short holes).
- After gap-fill, no unexplained gap **> `TRACK_MAX_GAP_FRAMES`** inside the
  swing window.
- Total processing time on the demo clip **≤ ~1.3×** the current pose-only time
  (no duplicated seeks; the detector adds per-frame compute only).
- Visual check: overlay boxes track the real ball and racket throughout the
  demo clip.
- `buildTracks` unit tests pass for: short-gap interpolation, far-box rejection
  via gating, smoothing, and coverage computation.

## Risks / open questions

- **Ball recall under motion blur.** Small, fast object → missed frames.
  Mitigation: low score threshold + gap-fill; B will fit a trajectory rather
  than trust per-frame points. If `coco-ssd` recall is too low, revisit the
  permissive-YOLO upgrade in B's plan.
- **Model licence.** `coco-ssd` is Apache-2.0 (safe). Any upgrade must stay
  permissive — YOLOv8 (AGPL-3.0) is excluded.
- **Bundle size / WebGPU.** TF.js backend selection; fall back to WASM where
  WebGPU is unavailable.
- **Background objects.** A second ball/racket in frame → handled by the
  single-instance assumption + gating; document the limitation.
- **Frame-walk refactor risk.** Generalising `extractPoses`' loop into
  `walkVideoFrames` must not change existing pose output. The existing
  `extractPoses` tests guard the pose path; verify indices stay aligned.

## Future work (out of scope for A)

- **B — Position / event refinement.** Use tracks to refine contact point/timing
  (ball trajectory) and toss metrics, replacing wrist proxies.
- **C — Racket orientation + "waiter's tray" rule.** Derive the racket long-axis
  angle (wrist → far edge of the racket box) and an apparent-aspect-ratio
  pronation proxy through contact → a new error rule for the waiter's-tray /
  no-pronation fault.
- **D — Unified pose+racket keypoint model (preferred long-term).** Fine-tune /
  train a single keypoint model that localises body **and** racket keypoints
  together, for accurate racket-face angle and pronation. The most accurate path
  to face angle; requires a dataset and training. Flagged by the user as the
  best eventual option.
