---
name: cv-pose-estimation
description: Working with MediaPipe Pose for pose tracking in tennis — the 33 landmark indices, joint-angle calculation, trajectory smoothing, and handling of visibility. Read before working with pose data, computing skeleton metrics, or integrating MediaPipe.
---

# Skill: CV Pose Estimation (MediaPipe) for Tennis

## When to use

Before any task that:
- Works with pose landmarks (skeleton points)
- Computes joint angles, distances, velocities
- Integrates MediaPipe Pose into code
- Smooths / filters a pose trajectory

## MediaPipe Pose: 33 landmarks

MediaPipe BlazePose returns **33 landmarks** per frame, each with `{x, y, z, visibility}`.

```
 0: nose
 1-10: face (eyes, ears, mouth)               ← barely needed for tennis
11: left shoulder    12: right shoulder
13: left elbow       14: right elbow
15: left wrist       16: right wrist          ← racket/toss hand
17-22: hands (pinky, index, thumb, kp tips)   ← fine motor, usually ignored
23: left hip         24: right hip
25: left knee        26: right knee
27: left ankle       28: right ankle
29-32: feet
```

### Coordinate normalization
- `x, y` — **normalized** to [0, 1] relative to the frame width/height
- `z` — depth, relative to the hip center (smaller = closer to the camera). **Less reliable**, use carefully
- `visibility` — [0, 1], the probability that the landmark is visible and not occluded. **Critical** for filtering

### Which landmarks matter for tennis

| Landmark | Why |
|---|---|
| 15, 16 (wrists) | Toss and racket hand; trophy/contact detection |
| 13, 14 (elbows) | Elbow angle (extension at contact) |
| 11, 12 (shoulders) | Reference points for arm angles, torso orientation |
| 23, 24 (hips) | Center of mass, jump height, stability |
| 25, 26 (knees) | Knee flexion angle (knee bend at trophy) |
| 0 (nose), 27/28 (ankles) | "Head" and "feet" references for the vertical |

## Computing joint angles

### Angle at a joint (3 points)
The angle at point B for the triple (A, B, C):

```typescript
function jointAngle(a: Point, b: Point, c: Point): number {
  // Vectors from B to A and from B to C
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };
  const cos = (ba.x * bc.x + ba.y * bc.y) /
              (Math.hypot(ba.x, ba.y) * Math.hypot(bc.x, bc.y));
  // Guard against numerical error (cos can slightly exceed [-1,1])
  return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
}
```

### Useful angles for tennis
- **Knee flexion:** hip(23/24) → knee(25/26) → ankle(27/28)
  - 180° = straight leg, smaller = more bent
- **Elbow extension:** shoulder(11/12) → elbow(13/14) → wrist(15/16)
  - 180° = straight arm (important for contact)
- **Shoulder abduction:** hip → shoulder → elbow (is the arm raised)

### The 2D nuance
- MediaPipe gives **2D (x,y)** and **z** (depth)
- Angles computed in 2D can be **inaccurate** when the motion is in depth (e.g. the arm moves toward/away from the camera)
- On the prototype: **we rely on 2D angles**, note that depth is inaccurate, and compensate with tolerance zones in the rules (see serve-error-detection)

## Trajectory smoothing

Pose estimation is noisy. Before detecting extrema/events — **smooth**.

### Recommended approach: moving average (simple and sufficient for the prototype)
```typescript
function smooth(values: number[], windowSize = 5): number[] {
  // centered moving average
  const out = [];
  const half = Math.floor(windowSize / 2);
  for (let i = 0; i < values.length; i++) {
    let sum = 0, count = 0;
    for (let j = -half; j <= half; j++) {
      const k = i + j;
      if (k >= 0 && k < values.length) { sum += values[k]; count++; }
    }
    out.push(sum / count);
  }
  return out;
}
```

### When to consider Kalman / One-Euro
- A moving average introduces a peak **lag** (~windowSize/2 frames)
- For phase detection this is usually acceptable (tolerance ±2 frames)
- If peaks "drift" — switch to a **One-Euro filter** (adaptive, low lag for fast motion)

### What to smooth
- Coordinates of key landmarks (wrists, knees, hips) — yes
- Visibility — no (it is already a filtered confidence)
- Derived metrics (angles) — can be computed **after** smoothing the coordinates, or you can smooth the angles themselves. Smoothing coordinates first is usually better.

## Visibility filtering

Not every landmark is reliable every frame. Rules:

1. **Visibility threshold** — if `visibility < THRESHOLD`, flag the landmark as unreliable
   - `THRESHOLD ≈ 0.5` — a typical empirical minimum for analysis
2. **Gaps** — if a landmark disappears for a few frames, interpolate (for a short gap, <5 frames) or flag the phase as low-confidence
3. **Refuse to analyze** — if critical landmarks (wrists, shoulders) are unreliable across most of the serve → do not analyze, show "could not recognize the serve, reshoot"

## Local extrema (for event detection)

Trophy/contact detection is based on **local maxima/minima** of smoothed trajectories.

```typescript
function localMaxima(values: number[], minProminence = 0): number[] {
  const peaks = [];
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] > values[i-1] && values[i] >= values[i+1]) {
      // prominence filter: the peak must stand out
      peaks.push(i);
    }
  }
  return peaks;
}
```

- `minProminence` cuts noise (small jitters must not count as peaks)
- For the **racket-hand contact peak** the prominence must be substantial (the hand rises noticeably)

## Integrating MediaPipe in the browser

### Recommended package
- `@mediapipe/tasks-vision` — the modern Tasks API (PoseLandmarker)
- Alternative: the legacy `@mediapipe/pose`

### Video-file processing flow
```
1. A <video> element loads the file
2. For each frame (via requestVideoFrameCallback or a timer):
   a. Extract an ImageBitmap / draw onto a canvas
   b. poseLandmarker.detectForVideo(bitmap, timestamp)
   c. Save the landmarks into an array
3. After the whole video: smoothing → metric computation → phase detection
```

### FPS / performance
- `detectForVideo` on a mid-range device: ~20-30 FPS
- For a video file this is **not real-time** — we process frame by frame and show progress
- We don't chase 60fps; what matters is **sampling every frame** (or ≥30fps) so we don't miss fast events (contact)

## Common mistakes when working with pose data

1. **Forgetting to smooth** → the phase detector finds "peaks" from noise
2. **Computing a 2D angle for motion in depth** → wrong angle. Check visibility and flag low-confidence
3. **Ignoring visibility** → analyzing occluded landmarks produces nonsense
4. **Confusing left/right** → MediaPipe gives landmarks relative to the **mirrored** view (as the camera sees it). Pin the convention in tests.
5. **Magic thresholds without a source** → see `docs/task-rules.md` §6, all thresholds go into named constants

## Related
- Full biomechanics reference: `docs/biomechanics/serve-phases.md`
- Detecting phases from landmarks: the `tennis-serve-phases` skill
- Error rules: the `serve-error-detection` skill
- Threshold sources: empirically + Chow et al., MDPI/Frontiers 2024 (see research/)
