---
name: tennis-serve-phases
description: Detecting and splitting a tennis serve into phases. Read before working on detecting key serve events (release, trophy, contact, follow-through) and splitting the motion into phases. Uses the 8-stage model by Chow et al., grouped into 4 practical phases for the prototype.
---

# Skill: Tennis Serve Phase Detection

## When to use

Before any task that:
- Splits a serve into phases
- Detects key events (release, trophy, contact, follow-through)
- Works with timestamps / phase boundaries

## Phase model

A serve is split into **4 practical phases** (a simplification of the 8-stage Chow et al. model):

```
release ──► trophy ──► contact ──► follow-through
   │           │           │              │
   └──prep─────┴──accel────┴──follow──────┘
```

| Phase | From | To | What is typical |
|---|---|---|---|
| **Preparation** | video start | trophy | ball toss, knee bend |
| **Trophy** | trophy event | start of acceleration | racket behind the head, knees bent, toss arm extended |
| **Acceleration** | after trophy | contact | acceleration, hit |
| **Follow-through** | contact | end | finish, deceleration |

> ⚠️ Trophy is **both** a stage (a point in time) **and** a phase (an interval). Keep them separate in code: `detectTrophyEvent()` returns a timestamp, while the phase is the interval from trophy to the start of acceleration.

## Key events and how to detect them

Events are **points in time**. Phases are built from the intervals between them.

### 1. Release (ball toss)
**What:** the ball leaves the player's hand.

**How to detect (approach):**
- The toss arm (wrist) rises, then the ascending trajectory of the ball-object begins
- On the prototype without ball tracking: a local pattern — the toss arm reaches a local height maximum and starts to descend, with a hand "opening" motion
- **Simplification for the prototype:** when ball tracking is unavailable, release ≈ the moment the toss arm stops rising

### 2. Trophy position (key phase)
**What:** racket behind the head (racket drop), toss arm extended upward, knees bent.

**How to detect:**
- **Racket overhead** — the racket-hand wrist is above the nose/head (by the y-coordinate in image space, for a vertical shot)
- **Knees bent** — a local maximum of the knee flexion angle (see the cv-pose-estimation skill for the calculation)
- **Toss arm extended upward** — the toss-hand wrist is near its top position

Trophy ≈ the moment of **maximum knee flexion** provided the racket is overhead. This is a reliable marker.

### 3. Contact (ball strike)
**What:** the racket meets the ball at the top.

**How to detect:**
- **Maximum upward extension** — the racket-hand wrist is at a local height maximum
- **The ball sharply changes trajectory** (if ball tracking is available)
- **The racket arm is almost fully extended** — the elbow angle is close to 180°
- **The player begins to descend** (the body drops after the jump/extension)

**Simplification for the prototype:** contact ≈ a local maximum of the racket-hand wrist height, after trophy, provided the elbow is extended.

### 4. Follow-through start
**What:** after contact, the racket travels down and across the torso.

**How to detect:**
- After contact: the racket-hand wrist drops below the shoulder
- The racket crosses the body's midline (for right-handers — it goes left)
- The motion slows down

## The split algorithm (conceptually)

```
function splitIntoPhases(poses: Pose[], fps: number): Phases {
  const trophyFrame = detectTrophy(poses)      // max knee flexion + racket overhead
  const contactFrame = detectContact(poses)    // max racket-hand height after trophy
  const followStart = detectFollowStart(poses) // racket descends below shoulder after contact

  return {
    preparation:  [0,               trophyFrame],
    trophy:       [trophyFrame,     /*accel start*/],
    acceleration: [/*accel start*/, contactFrame],
    followThrough:[contactFrame,    poses.length - 1],
  }
}
```

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

### What can go wrong
- **Trophy not expressed** (the player serves "flat") → the trophy rule may not fire. Fallback: a time-based split (preparation ~60%, acceleration ~20%, follow ~20% of the clip length) flagged "low confidence".
- **Contact smeared** (a slow swing) → several local maxima. Smoothing + picking the maximum after trophy.
- **Player partly out of frame** → low landmark visibility. Flag the phase as "low confidence" or refuse to analyze.

## Testing phase detection

- **Unit tests on synthetic data:** generate a keypoint array with a known phase structure, verify the detector returns the correct boundaries
- **Integration:** on 3–5 real short videos with manual phase labeling (golden files), ±2-frame tolerance
- See `docs/task-rules.md` §3 (TDD)

## What we do NOT do on the prototype
- Detection of stance, separate knee-flexion stages (4 stages → 1 trophy)
- Ball tracking as a hard requirement (optional, if we add YOLO)
- Splitting acceleration into sub-stages (external/internal rotation separately)

## Related
- Full reference: `docs/biomechanics/serve-phases.md`
- Angle and landmark calculation: the `cv-pose-estimation` skill
- Error rules: the `serve-error-detection` skill
- ADR-0002 (rule-based): `docs/decisions/0002-rule-based-approach.md`
