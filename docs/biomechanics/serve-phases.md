# Serve Biomechanics: Phases, Events, Metrics

> Subject-matter reference. This is the **source of truth** for terminology and metrics when working on phase detection and error finding.
> Based on the 8-stage model by Chow et al. (PMC/NIH), corroborated by 2023–2024 systematic reviews.

## Macro-structure: 3 phases → 8 stages

```
┌─────────────────────────────────────────────────────────────────┐
│                  FULL SERVE                                      │
├──────────────────┬──────────────────────┬────────────────────────┤
│  PREPARATION     │    ACCELERATION      │    FOLLOW-THROUGH      │
├──────────────────┼──────────────────────┼────────────────────────┤
│ 1. Stance        │ 5. External rotation │ 8. Follow-through      │
│ 2. Release       │    (Trophy)          │                        │
│ 3. Toss          │ 6. Internal rotation │                        │
│ 4. Knee flexion  │ 7. Contact           │                        │
└──────────────────┴──────────────────────┴────────────────────────┘
```

## Key events — the basis of the phase split

These events are detected from the pose trajectory and used as **phase boundaries**.

| Event | When | How to detect (hint) | Importance |
|---|---|---|---|
| **Release** | Ball leaves the hand | Toss arm opens, ball trajectory starts rising | prep→ boundary |
| **Peak toss height** | Top of the toss | Local maximum of ball height | Layer 2 metric |
| **Max knee flexion** | Max knee bend | Minimum "hip height" / max flexion angle | metric + part of trophy |
| **Trophy position** | "Trophy": racket behind the head, toss arm extended, knees bent | Combination: racket above the head + toss arm up + knees bent | **key phase**, a common amateur problem |
| **Contact** | Ball strike | Ball meets the racket; max upward extension; sharp change in ball trajectory | **accel→ boundary**, key moment |
| **Follow-through start** | After contact | Racket travels down/across the torso | →follow-through boundary |

> ⚠️ **For the prototype** the priority is to detect **release, trophy, contact, follow-through**. That is enough for a meaningful 4-phase split. Finer stages (stance, knee flexion on its own) are Layer 2 / future.

## Metrics by phase

### Preparation
- **Toss height** — toss height (from release to peak). Too low → rushing; too high → lost timing.
- **Toss consistency** — toss variability between serves (future, for a series).
- **Toss placement** — where the ball will land relative to the body (front/side).

### Acceleration
- **Trophy position quality** — is the racket vertical behind the head? toss arm extended? knees bent?
- **Knee bend angle** — knee flexion angle at trophy (typically 20–35° for intermediate players).
- **Kinetic chain** — sequence: legs → hips → torso → shoulder → arm. (Hard for 2D CV — partly future.)
- **Contact point height** — contact height relative to a fully extended arm.
- **Contact point placement** — contact position relative to the body (in front / above / behind).

### Follow-through
- **Racket finishes the motion** on the opposite side of the body (for right-handers — left).
- **Balance** — does the player fall after the serve.

## Typical errors of 3.0–4.0 amateurs

These errors are candidates for rule-based rules (see `skills/serve-error-detection/`).

### Trophy position
1. **"Catches" the racket in trophy** — stands in trophy too long, no smooth transition into acceleration.
2. **Racket doesn't drop behind the head** (no racket drop) — loses acceleration energy.
3. **Toss arm drops too early** — loses the "pointer" to the ball.

### Toss
4. **Toss too far back** — forced to lean back at contact.
5. **Toss too low** — no time for a full swing.
6. **Inconsistent toss** — ball goes to different places (future, a serve series).

### Contact
7. **Contact too low** — hits with a bent elbow instead of an extended arm.
8. **Contact behind the body** — hits backward, ball goes into the net / long.
9. **Too little knee bend** — doesn't use the legs for energy.

### Follow-through
10. **Abrupt stop** after the hit — no follow-through, risk of shoulder injury.
11. **Loss of balance** — falls after the serve.

## Threshold sources

> ⚠️ Concrete numeric thresholds (angles, timestamps) are **not fixed here** — they are determined empirically on test data and pinned in `src/constants/biomechanics.ts` with a source comment.

Possible sources:
- Chow et al. (2012) — 8-stage model, general ranges
- MDPI 2024 / Frontiers 2024 — kinematic ranges for different player levels
- OnCourtAI — practical metrics from AI analysis
- Empirical calibration on test serves (preferred for the prototype)

## What is NOT in the prototype

- **3D kinematics.** MediaPipe gives 3D landmarks, but depth-estimate reliability varies. In the prototype we rely mostly on 2D + careful use of visibility metrics.
- **Serve speed.** Requires ball tracking (YOLO) and perspective calibration — deferred.
- **Comparison with a reference (Layer 3)** — partial in the prototype, but a full overlay model needs a set of reference videos.
- **Serve series / progress** — future; the prototype works with one serve at a time.
