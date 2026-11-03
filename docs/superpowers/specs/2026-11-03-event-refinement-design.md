# Event Refinement: toss-start event, track-verified contact, speed in m/s

> Parent spec: `2026-06-22-detection-layer-design.md` (this is cycle **B** —
> "Position / event refinement").
>
> **Analysis layers touched:** **Layer 1** (new toss-start event marker;
> contact timing refined with ball↔racket tracks) and **Layer 2** (peak wrist
> speed in m/s, reference ranges, per-metric "why it matters" explanations).
> No Layer 3 change.

## Context

Cycle A delivered per-frame ball/racket detection and single-object tracks
(`buildTracks`), but the tracks are currently used **only** for the validation
overlay. Event detection still relies purely on the pose skeleton:

- `detectPhases` finds contact as the highest racket-wrist peak with an
  extended elbow, and trophy as the overhead frame nearest the toss-arm peak.
- There is **no toss-start event at all** — "preparation" simply starts at
  frame 0, so the app cannot tell a user *when the serve motion actually
  begins* (arm starts rising toward the toss) versus the idle stance before it.
- Contact timing rests on a single proxy (wrist height peak). When the ball
  and racket tracks are trustworthy, the moment the ball center comes closest
  to the racket center is a more direct measurement of *when the ball was
  hit* — the wrist peak only says *when the hand moved fastest upward*.
- Layer 2 has no physical (m/s) units yet: speed-related knowledge stays in
  normalized image coordinates, which a player cannot interpret ("is 1.2
  units/s good?").

This cycle closes those gaps. Because tennis_pos is an **educational**
prototype, every new algorithm ships with step-by-step explanatory comments,
the spec carries a design-rationale section, and every new Layer-2 metric is
displayed together with a plain-language "why this matters" explanation.

## Goals / Non-goals

### Goals
1. **Toss-start event (Layer 1).** Detect the frame where the toss arm begins
   its sustained upward motion, using the smoothed vertical velocity of the
   toss wrist. Expose it as `phases.events.tossStartFrame`, show it in the UI
   (PhaseBar marker + timeline), and explain it to the user.
2. **Track-verified contact (Layer 1).** When both tracks are reliable
   (coverage ≥ threshold), compute a contact candidate as the frame of minimum
   ball-center↔racket-center distance inside the toss→pose-contact window,
   cross-check it against the pose-based contact, and adjust confidence
   accordingly. Keep `detectPhases` itself pose-only; refinement is a separate
   pure function composed in `analyzeServe`.
3. **Peak wrist speed in m/s (Layer 2).** Convert the racket-wrist speed peak
   into meters per second by scaling with the player's body height in frame and
   a user-supplied height setting; display it with a reference range.
4. **Reference ranges for Layer 2 (Layer 2).** A calibration table
   (`src/constants/proRanges.ts`) giving target ranges for the new speed metric
   (and reused for display of deviation on the existing Layer-2 metric card).
5. **Educational UX.** New UI strings explain *how event detection works* and
   *what each metric means* (bilingual en/ru via i18n keys).
6. **Fix a known gating defect in `buildTracks`:** a rejected far box currently
   freezes `lastCenter`, so after one rejection every subsequent detection is
   compared against a stale anchor. Make the gate time-aware (scale the max
   jump by the frame gap) and re-anchor on the *previous accepted* frame.

### Non-goals
- **Groundstrokes** (forehand/backhand) — out of scope; a separate spec.
- **Court detection / bounce detection** — out of scope.
- **Changing the object-detection model** (YOLOX / RT-DETR upgrade) — separate
  decision if ball recall proves insufficient (see Risks).
- **Rewriting existing rules** — the PROVISIONAL thresholds in
  `biomechanics.ts` stay; the new reference table feeds Layer-2 *display*
  (deviation direction + range), not verdict logic.
- **A new phase segment.** Toss start is an *event marker*, not a fifth phase:
  the four-phase model (preparation/trophy/acceleration/follow-through) and
  click-to-replay behavior stay unchanged. Rationale below.
- No server calls — everything remains in-browser (locked decision).

## Architecture

### Data flow

```
poses ─► smooth ─► detectPhases ──────────────► Phases { events: tossStartFrame, ... }
                                        │
detections ─► buildTracks (fixed gate) ─┴─► refineContactWithTracks(phases, poses,
                                                ballTrack, racketTrack)
                                              │  pose contact  ←→  track contact
                                              │  wrist-speed cross-check
                                              ▼
                                          refined Phases
                                        │
                                        ▼
                            buildPhaseContext ─► metrics (+ peakWristSpeedMs, m/s)
                                        │
                                        ▼
                              runRules / RulesReport / Layer-2 cards
```

### 1. Toss-start event inside `detectPhases`

The toss wrist height (1 − y, so "up" = increasing) is converted into a
**vertical velocity signal**, smoothed, and scanned for the first frame where
the wrist moves upward faster than a calibrated threshold. Algorithm:

1. Take the smoothed (already trajectory-smoothed) pose sequence.
2. Compute the vertical velocity of the toss wrist per frame via **central
   difference**: `v[i] = (h[i+1] − h[i−1]) / Δt` where `h = 1 − wrist.y` and
   `Δt` is the real time between frames `i+1` and `i−1` (endpoints use their
   single neighbor; `Δt` clamped to ≥ 1 ms).
3. Smooth the velocity with a centered moving average (window 5, the same
   window used for trajectories).
4. `tossStartFrame` = first index (from 1) where smoothed `v < −0.35`
   normalized units/s. In image coordinates y grows downward, so a *negative*
   vertical velocity means the wrist is moving **up** — the toss lift.
5. If no frame qualifies (e.g. the toss is hidden by noise or the clip starts
   mid-motion), fall back to `round(n/3)` and force `confidence: 'low'` —
   same degradation pattern as the existing trophy fallback.

**Why an event, not a phase:** a fifth phase would ripple through
`PhaseKey`, phase-time playback, PhaseBar widths and every rule's `phase`
field, for information the user needs as a *moment*, not a span. An event
marker renders as a tick on the PhaseBar/timeline and is available to
downstream logic (window for track refinement) with zero churn to the phase
model.

### 2. Track-verified contact — `refineContactWithTracks`

`detectPhases` stays a pure pose function (its tests and semantics unchanged).
Refinement is a separate pure function called once in `analyzeServe`, after
`detectPhases` and after `buildTracks`:

1. **Gate.** Both tracks must have `coverage ≥ CONTACT_TRACK_COVERAGE_MIN`
   (0.5) over the whole clip; otherwise the refined phases equal the input
   phases (a diagnostic code records why).
2. **Track candidate.** Inside the window `[tossStartFrame, poseContactFrame]`
   (clamped to the clip), take the frame with the **minimum distance between
   the ball-center and racket-center** where both track points exist. This is
   the direct physical reading of "when the ball met the racket".
3. **Cross-check with wrist speed.** Compute the smoothed wrist-speed signal
   for the racket wrist, take the argmax after the toss apex, constrained to
   frames where the wrist is above the shoulder mid-height. If the track
   candidate and this wrist-speed peak agree within
   `CONTACT_AGREEMENT_FRAMES`, confidence is forced `'high'` (two independent
   measurements agree); the *track* frame becomes `contactFrame` because it is
   the direct ball measurement.
4. **Disagreement / missing candidate.** Keep the pose-based contact frame,
   force `confidence: 'low'`, and attach a machine-readable diagnostic code
   (`contact-refined` / `contact-track-mismatch` / `contact-tracks-sparse`)
   that the UI translates and shows as an explanatory note.
5. Invariant guard unchanged: `tossStart ≤ trophy < contact < followStart`
   with the existing +1 clamping reapplied after refinement.

### 3. Speed in physical units (Layer 2)

Wrist speed in normalized units/s is converted to m/s by scaling with the
player's body height *as seen in the frame*: `ankleMid → nose` distance ×
1.25 approximates the full standing height in normalized units; multiplying
normalized speed by that scale and by the user's real height (cm) yields m/s.
`playerHeightCm` is a new UI setting (default 175, persisted like the other
settings). The metric card shows the value, the reference range, and an
explanation of what wrist speed means for serve power.

### 4. `buildTracks` gating fix (follow-up from cycle A)

Current defect: when a detection is rejected by the max-jump gate,
`lastCenter` is **not** updated — every later detection is then compared
against a stale anchor and a fast-moving object (the ball!) spanning a missed
frame gets permanently locked out. Fix: (a) the max allowed jump scales with
the number of missed frames since the last *accepted* detection (a fast ball
moving between two adjacent frames is fine; the same jump after 10 dropped
frames is suspicious), and (b) rejection re-anchors against the most recent
accepted point rather than freezing. `TRACK_GATING_MAX_DIST` keeps its role
as the per-frame (1-frame gap) bound.

## Interfaces

Sketches only (no bodies, per `task-rules §2`).

```ts
// src/types.ts — Phases.events gains one field:
interface Phases {
  events: {
    tossStartFrame: number;   // NEW — -1 when never detected (fallback frame used instead)
    trophyFrame: number;
    contactFrame: number;
    followStartFrame: number;
  };
  // NEW — why contact timing is what it is; surfaced by the UI as an i18n note.
  contactSource: 'pose' | 'tracks' | 'fallback-time';
  contactDiagnostic: string | null; // machine key, e.g. 'contact-track-mismatch'; null = none
}

// src/pipeline/signals.ts (NEW) — signal primitives over numeric series.
function pointSpeed(points: Array<{ x: number; y: number } | null>,
                    timestampsMs: number[]): number[];      // smoothed magnitude, units/s
function argmax(values: number[], from: number, toExclusive: number): number;
function argmin(values: number[], from: number, toExclusive: number): number;
function firstIdx(values: number[], from: number, pred: (v: number) => boolean): number; // -1 if none

// src/pipeline/detectPhases.ts — toss-start detection (internal helper, exported for tests)
export function detectTossStart(poses: PoseFrame[], h: Handedness): { frame: number; confident: boolean };

// src/pipeline/refineContact.ts (NEW) — pure composition point.
function refineContactWithTracks(
  phases: Phases, poses: PoseFrame[],
  ballTrack: ObjectTrack, racketTrack: ObjectTrack,
): Phases;

// src/pose/metrics.ts (NEW) — Layer 2 physical speed.
function peakWristSpeedMs(poses: PoseFrame[], h: Handedness,
                          windowFrom: number, windowTo: number,
                          playerHeightCm: number): number;   // NaN when uncomputable

// src/constants/proRanges.ts (NEW) — Layer-2 reference table.
export const WRIST_SPEED_MS_REF_RANGE: [number, number];    // e.g. [10, 25]
```

UI: PhaseBar renders a toss-start tick when `tossStartFrame ≥ 0`; the metric
panel gains one Layer-2 card (peak wrist speed, m/s, reference range, "why it
matters"); settings gain `playerHeightCm`. All new strings are i18n keys in
`src/i18n/locales/{en,ru}.json`.

## Threshold table (each a named constant with a source comment)

| Constant | Value | Justification (internal) |
|---|---|---|
| `TOSS_START_VELOCITY_THRESHOLD` | −0.35 units/s | Empirical calibration on the demo clip + synthetic serves: a deliberate toss lift comfortably exceeds it; camera shake and arm micro-motion stay below. Lowered/raised only after re-watching test clips. See Design rationale. |
| `TOSS_VELOCITY_SMOOTH_WINDOW` | 5 frames | Same window as trajectory smoothing (`SMOOTH_WINDOW_FRAMES`); a common window keeps one mental model and ≈2-frame peak lag, inside the ±2-frame tolerance. |
| `TOSS_START_FALLBACK_FRACTION` | n/3 | Time-based fallback consistent with `FALLBACK_PREP_FRACTION` (0.6): prep spans [0, 0.6n), so its interior third is the most plausible toss lift if it was undetectable. Forces `confidence: 'low'`. |
| `CONTACT_TRACK_COVERAGE_MIN` | 0.5 | Matches the cycle-A success bar ("ball in ≥50% of frames of the toss→contact window"). Below half the frames the min-distance scan is dominated by gaps, not measurements. |
| `CONTACT_AGREEMENT_FRAMES` | 3 (±) | ~0.1 s at 30 fps — wider than the ±2-frame detection tolerance to allow for smoothing lag on *both* signals, tighter than a phase width. |
| `BODY_HEIGHT_SCALE` | 1.25 | Geometry estimate: nose→ankle-mid vertical extent ≈ 80% of standing height on a side-view serve; documented as provisional like the other geometry estimates. |
| `PLAYER_HEIGHT_DEFAULT_CM` | 175 | Population-average default; per-user override in settings so the m/s number is honest per player. |
| `TRACK_GATE_GAP_SCALE` | ≤ +0.15 per missed frame (cap: 0.6) | Time-aware gate: allows the ball to move further per frame when frames were dropped; capped so a far background box is still rejected. Calibrated on the demo clip. |
| `WRIST_SPEED_MS_REF_RANGE` | [10, 25] m/s | Internal calibration target for recreational 3.0–4.0 players (see `docs/biomechanics/serve-phases.md` and our empirical demo-clip readings); used for Layer-2 display of "yours vs range", not for verdicts. Provisional. |

## Success metrics

1. **Toss start (TDD, synthetic poses).** On a constructed serve whose toss
   wrist rises from frame 3, `detectTossStart` returns 3 (±1 for smoothing
   lag); a clip with no upward lift falls back to `round(n/3)` with
   `confident: false`.
2. **Contact refinement (TDD, synthetic tracks).** (a) Tracks converging at
   frame K within ±3 of pose contact → `contactFrame = K`,
   `contactSource = 'tracks'`, confidence `'high'`; (b) tracks converging far
   away → pose contact kept, `'low'`, diagnostic
   `contact-track-mismatch`; (c) coverage < 0.5 → pose phases unchanged,
   diagnostic `contact-tracks-sparse`.
3. **No regression.** All existing `detectPhases` / `buildTracks` tests pass
   (with the gating fix, the old gating tests are updated to the new
   time-aware semantics, not deleted).
4. **m/s sanity.** On the synthetic fixture, `peakWristSpeedMs` for a
   175 cm player yields a value inside the reference range for the "good"
   serve and below it for the degraded serve.
5. **Manual demo-clip check.** Toss marker appears between "Preparation" and
   "Trophy" on the timeline; refined contact agrees with what the overlay
   shows; EN/РУ toggle renders every new string; Layer-2 card shows m/s with
   the range and explanation.
6. **`npm run build`** passes (types compile).

## Risks / open questions

- **Velocity threshold sensitivity.** Low-fps clips (≈15 fps) make the
  velocity signal spikier; the smoothing window mitigates this, and the
  fallback degrades gracefully. Calibration stays provisional until a labeled
  serve set exists (tracked follow-up).
- **Ball recall under motion blur** (carried over from cycle A). The coverage
  gate means a poor ball track simply *disables* refinement — no wrong
  timing is invented. If the demo clip sits below 0.5 coverage, that is the
  trigger to revisit the detector upgrade (explicitly out of scope here).
- **Min-distance ambiguity.** If the ball leaves the frame right before
  contact, the last ball point may sit far from the racket; the agreement
  cross-check rejects such candidates instead of trusting them.
- **Type ripple from the new `events` field.** Fixtures, `buildPhaseContext`,
  PhaseBar and tests must be updated together; the field is mandatory in the
  type so no consumer can forget it.
- **m/s scale honesty.** A wrong `playerHeightCm` scales the number linearly;
  the UI labels the metric as an *estimate based on your height setting*, and
  the explanation card states that dependency explicitly.
- **Gating fix regression risk.** Widening the gate by gap length could admit
  a far box after a long dropout. The cap (0.6) plus gap-fill keep the track
  bounded; unit tests cover "fast ball across a 2-frame gap accepted" and
  "far box after a 10-frame gap rejected".

## Design rationale (educational)

*Why signal-based event detection?* A discrete event like "the toss starts"
is not a property of any single frame — it is a property of a **motion
trend**. Frame-wise rules ("wrist above nose") answer *where the body is*;
a velocity signal answers *what the body is doing*. Converting a trajectory
into velocity with a central difference, then smoothing, turns a noisy
per-frame quantity into a stable trend that can be scanned with a simple
threshold — deterministic, explainable, and cheap (no ML), which is exactly
the project's rule-based philosophy (decision 0002).

*Why a cascade (pose → tracks) instead of replacing pose detection with
tracks?* The pose skeleton exists in every frame; the ball often does not
(blur, occlusion). Starting from the pose estimate and *refining* it only
when two independent measurements agree gives the best of both: the pose
estimate is never worse than today, and when the tracks are trustworthy they
add a direct physical reading (ball meets racket) that pose alone cannot
provide. Disagreement is surfaced as *lower confidence* — never silently
swapped — so the user always knows how much to trust the timing.

*Why scale speed by body height?* MediaPipe coordinates are normalized to
the *frame*, not to the world. The same swing fills a different fraction of
the frame depending on camera distance. But the player's own body is always
in frame, so the nose→ankle distance acts as a built-in ruler: expressing
speed in units of body height and multiplying by the real height converts
normalized motion into honest meters per second, independent of framing.

*Why 1.25?* The nose sits slightly below the crown, and the ankle-mid sits
slightly above the sole, so the measured extent under-reports standing
height; 1.25 restores the missing head/foot fraction (a documented geometry
estimate, provisional like the rest).

*Why keep the four-phase model?* Users already learned the phase colors and
click-to-replay. The toss start answers "when did my motion begin?" — a
question about a moment. Marking the moment keeps the interaction model
stable while still teaching the serve's structure (idle stance → toss lift →
trophy → hit → finish).
