---
name: tennis-serve-phases
description: Detecting and splitting a tennis serve into phases. Read before working on detecting key serve events (toss start, trophy, contact, follow-through) and splitting the motion into phases. Uses the 8-stage model by Chow et al., grouped into 4 practical phases for the prototype.
---

# Skill: Tennis Serve Phase Detection

## When to use

Before any task that:
- Splits a serve into phases
- Detects key events (toss start, trophy, contact, follow-through)
- Works with timestamps / phase boundaries

## Phase model

A serve is split into **4 practical phases** (a simplification of the 8-stage Chow et al. model). Alongside the phases, the pipeline tracks **key events** — points in time, including the toss start, which lives inside preparation:

```
idle ──► toss start ──► trophy ──► contact ──► follow-through
            │              │           │              │
            └──prep────────┴──accel────┴──follow──────┘
```

| Phase | From | To | What is typical |
|---|---|---|---|
| **Preparation** | video start | trophy | idle stance, toss lift, knee bend |
| **Trophy** | trophy event | start of acceleration | racket behind the head, knees bent, toss arm extended |
| **Acceleration** | after trophy | contact | acceleration, hit |
| **Follow-through** | contact | end | finish, deceleration |

> ⚠️ Trophy is **both** a stage (a point in time) **and** a phase (an interval). Keep them separate in code: `detectTrophyEvent()` returns a timestamp, while the phase is the interval from trophy to the start of acceleration.

## Key events and how to detect them

Events are **points in time**. Phases are built from the intervals between them. Two detection styles coexist in the pipeline:

- **Pose-shaped rules** — "where is the body in this frame" (trophy, follow-through).
- **Motion-signal rules** — "what is the body doing over a window of frames" (toss start, contact cross-check). Signal detection is the tool for any event that is a *trend*, not a pose (see `src/pipeline/signals.ts` for the primitives: `derivative`, `pointSpeed`, `argmax/argmin/firstIdx`).

### 0. Toss start (motion-signal event)
**What:** the first frame where the toss arm begins its sustained upward lift — the true start of the serve motion (before it, the player is idle).

**How to detect (implemented in `detectTossStart`):**
1. Convert the toss-wrist HEIGHT series (1 − y; up = positive) into a smoothed vertical-velocity signal: central difference over real timestamps, then a centered moving average (window 5).
2. Scan from frame 1 for the first crossing of `TOSS_START_VELOCITY_THRESHOLD` (0.35 frame-heights/s upward). A deliberate lift comfortably exceeds it; idle sway and camera shake stay below.
3. Fallback: nothing crosses (occluded toss, clip starts mid-motion) → a time-based frame `round(n/3)` with `confident: false`, which drops the overall phases confidence to 'low'.

**Why a velocity signal:** "when did the motion begin" has no per-frame answer — the wrist is somewhere above the hip for the whole stance. A *sustained rise* is the distinguishing property, and a smoothed derivative is how you read a trend deterministically (no ML, explainable — ADR-0002).

### 1. Release (ball toss)
**What:** the ball leaves the player's hand.

**How to detect (approach):**
- The toss arm (wrist) rises, then the ascending trajectory of the ball-object begins
- On the prototype without ball tracking: a local pattern — the toss arm reaches a local height maximum and starts to descend, with a hand "opening" motion
- **Simplification for the prototype:** when ball tracking is unavailable, release ≈ the moment the toss arm stops rising (the toss-start event marks where that rise *begins*)

### 2. Trophy position (key phase)
**What:** racket behind the head (racket drop), toss arm extended upward, knees bent.

**How to detect (implemented in `detectTrophy`):**
- **Toss-arm peak anchor** — find the toss-wrist height peak inside `[0, contactFrame)`; trophy is the overhead frame nearest that peak. Anchoring on the toss arm (not the knee) is deliberate: the toss arm reaches full extension AT the trophy pose, while the deepest knee bend comes a few frames later during the racket drop / leg load.
- **Racket overhead** — the racket-hand wrist is above the nose (`TROPHY_OVERHEAD_REF_LM`)
- **Knee depth as tie-break only** — between frames equidistant from the toss peak, prefer the more bent knee
- Fallback: no overhead frame → time-based split (`FALLBACK_PREP_FRACTION` 0.6 / `FALLBACK_ACCEL_FRACTION` 0.2), confidence 'low'

### 3. Contact (ball strike)
**What:** the racket meets the ball at the top.

**How to detect (two independent readings, combined in a cascade):**
- **Pose reading (`detectContact`):** the highest racket-wrist height peak with an extended elbow (`CONTACT_ELBOW_MIN_DEG`); detected independently of trophy so a bad trophy can't suppress contact. Low-confidence fallback: global height maximum.
- **Track reading (`refineContactWithTracks`, cycle B):** when BOTH the ball and racket tracks are reliable (`CONTACT_TRACK_COVERAGE_MIN` 0.5 coverage), the frame of minimum ball-center↔racket-center distance inside `[tossStartFrame, poseContactFrame]` is the DIRECT measurement of when the ball met the racket.
- **Cross-check:** the track candidate is trusted only when it agrees (± `CONTACT_AGREEMENT_FRAMES` = 3) with the peak of the smoothed wrist-speed signal after the toss apex, constrained to frames where the wrist is above the shoulder midline. Agreement → adopt the track frame, confidence 'high', `contactSource: 'tracks'`. Disagreement or pre-trophy candidate → keep the pose timing, confidence 'low', diagnostic `contact-track-mismatch` (surfaced in the UI, never silently swapped).
- **Why a cascade:** the pose skeleton exists in every frame; the ball often does not (motion blur, occlusion). Start from the pose estimate, refine only when two independent measurements agree — the result is never worse than the pose-only timing.

### 4. Follow-through start
**What:** after contact, the racket travels down and across the torso.

**How to detect:**
- After contact: the racket-hand wrist drops below the shoulder
- The racket crosses the body's midline (for right-handers — it goes left)
- The motion slows down

## The split algorithm (conceptually)

```
function splitIntoPhases(poses: Pose[], fps: number): Phases {
  const tossStart   = detectTossStart(poses)     // smoothed toss-wrist velocity crossing
  const contactFrame = detectContact(poses)      // height peak + extended elbow (pose-only)
  const trophyFrame  = detectTrophy(poses, contactFrame) // overhead frame nearest toss peak
  const followStart  = detectFollowStart(poses)  // racket descends below shoulder after contact
  const phases = refineContactWithTracks(phases, poses, ballTrack, racketTrack)
  //            ↑ cycle B: replaces contactFrame with the ball↔racket closest
  //              approach when the tracks are reliable AND agree with the
  //              wrist-speed peak; otherwise keeps the pose timing (low conf)

  return {
    events: { tossStart, trophyFrame, contactFrame, followStart },
    preparation:  [0,               trophyFrame],
    trophy:       [trophyFrame,     /*accel start*/],
    acceleration: [/*accel start*/, contactFrame],
    followThrough:[contactFrame,    poses.length - 1],
  }
}
```

Event invariants: `tossStart ≤ trophy < contact < followStart`, each pair at least 1 frame apart (the guard re-clamps with `+1` floors after refinement).

## Physical units (Layer 2)

- `peakWristSpeedMs` converts the smoothed racket-wrist speed peak into m/s through the player's in-frame body extent (nose→ankle-mid × `BODY_HEIGHT_SCALE` 1.25) and the real height setting (default 175 cm). The body acts as a built-in ruler, making the number independent of camera distance.
- Reference band for display: `WRIST_SPEED_MS_REF_RANGE` [10, 25] m/s in `src/constants/proRanges.ts`. Display-only — verdict thresholds stay in `biomechanics.ts`.

## Important nuances

### Racket vs toss hand
- For right-handers: **left hand toss**, **right hand racket**
- For left-handers: the reverse
- On the prototype: we **detect left/right** by which hand raises the ball at release, or ask the user

### Shooting
- **Standard for the prototype:** camera on the side, at the player's level, player fully in frame
- We assume a **vertical orientation** (player standing) or the ability to rotate
- Pose estimation is sensitive to the angle — warn the user if the player is not fully in frame

### FPS
- MediaPipe Pose gives per-frame landmarks
- For phase detection **temporal resolution** matters: at 30fps trophy and contact can be 1–2 frames apart (fast motion)
- **Smoothing** of trajectories is mandatory (see the cv-pose-estimation skill), otherwise local extrema are noisy
- Velocity/speed signals are smoothed too (window 5); expect ~2 frames of peak lag on every smoothed signal — the ±3-frame agreement window in the contact cross-check accounts for two such lags

### What can go wrong
- **Toss lift not detectable** (occlusion, clip starts mid-motion) → time fallback `round(n/3)`, confidence 'low'. The UI still shows the marker, labeled as an estimate.
- **Trophy not expressed** (the player serves "flat") → the trophy rule may not fire. Fallback: a time-based split (preparation ~60%, acceleration ~20%, follow ~20% of the clip length) flagged "low confidence".
- **Contact smeared** (a slow swing) → several local maxima. Smoothing + the extended-elbow gate; the track cascade adds a second opinion when tracks allow.
- **Ball track too sparse** (motion blur) → refinement disabled (`contact-tracks-sparse` diagnostic), pose timing kept. This is the correct degradation: never invent timing from gaps.
- **Player partly out of frame** → low landmark visibility. Flag the phase as "low confidence" or refuse to analyze.

## Testing phase detection

- **Unit tests on synthetic data:** generate a keypoint array with a known phase structure, verify the detector returns the correct boundaries
- **Integration:** on 3–5 real short videos with manual phase labeling (golden files), ±2-frame tolerance
- See `docs/task-rules.md` §3 (TDD)

## What we do NOT do on the prototype
- Detection of stance, separate knee-flexion stages (4 stages → 1 trophy)
- Ball tracking as a hard requirement — the tracks REFINE events when reliable, but the pose-only path must stay fully functional
- Splitting acceleration into sub-stages (external/internal rotation separately)
- Groundstrokes (forehand/backhand) — a separate cycle

## Related
- Full reference: `docs/biomechanics/serve-phases.md`
- Event refinement design (toss start + track contact + m/s): `docs/superpowers/specs/2026-11-03-event-refinement-design.md`
- Signal primitives and the educational walkthrough: `src/pipeline/signals.ts`
- Angle and landmark calculation: the `cv-pose-estimation` skill
- Error rules: the `serve-error-detection` skill
- ADR-0002 (rule-based): `docs/decisions/0002-rule-based-approach.md`
