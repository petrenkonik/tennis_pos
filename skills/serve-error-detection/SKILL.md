---
name: serve-error-detection
description: Implementing rule-based rules for finding errors in a tennis serve. Read before implementing error-evaluation rules, advice wording for a recreational user, and biomechanics thresholds. Matches Approach A (rule-based) from ADR-0002.
---

# Skill: Rule-based Serve Error Detection

## When to use

Before any task that:
- Implements rules for finding errors in a serve
- Words advice/feedback for a recreational user
- Defines biomechanics thresholds (angles, timings, distances)
- Works with **analysis layers** (1: simple advice, 2: metrics, 3: reference)

## Principles (from ADR-0002 and task-rules.md §5)

1. **Explainability over accuracy.** Every error rule must be understandable by a recreational user without anatomy.
2. **Tolerance zones, not sharp thresholds.** Amateurs vary widely — we use "normal" ranges, not exact values.
3. **Every threshold is a named constant with a source.** No magic numbers in code.
4. **Do no harm.** If a rule is unsure → flag it low-confidence rather than giving a categorical tip.

## Rule structure

Every error rule follows one format:

```typescript
interface ErrorRule {
  id: string;                      // unique identifier
  phase: Phase;                    // which phase it applies to
  layer: 1 | 2 | 3;                // depth layer (1 = simple advice)
  title: string;                   // short name (for the UI)
  check: (ctx: PhaseContext) => Finding | null;
  // if it returns null — no error / cannot determine
}
```

```typescript
interface Finding {
  ruleId: string;
  severity: 'info' | 'warn' | 'error';  // how critical
  confidence: 'low' | 'medium' | 'high';
  advice: string;                  // user-facing advice text (no anatomy!)
  metric?: {                       // for Layer 2 — the concrete value
    name: string;
    value: number;
    unit: string;
    referenceRange?: [number, number];
  };
}
```

> Note: in the codebase `Finding.advice`, `RuleResult.title`, and `RuleResult.metric.name` hold **i18n keys** (e.g. `rules.C3.advice`), not display strings. The rendering layer resolves them via `t()`. New rules must follow the same convention and add keys to both `src/i18n/locales/en.json` and `ru.json`.

## Rule candidates (from biomechanics)

From `docs/biomechanics/serve-phases.md` — typical amateur errors. Each is a rule candidate.

> ⚠️ Concrete thresholds are determined empirically on test serves and pinned in `src/constants/biomechanics.ts`. This file covers the **logic** of the rules.

### Trophy position

#### T1. No racket drop
- **Logic:** in trophy the racket wrist is above the head, but the **elbow is not dropped** (the racket does not "fall" behind the back).
- **How to measure:** in the trophy phase, check that the racket-hand wrist is below the elbow (the racket is dropped) — that is racket drop.
- **Advice (Layer 1):** "In the trophy position the racket should drop behind your back — that's what gives the hit its acceleration. Try relaxing the wrist and letting the racket drop."

#### T2. Too long in trophy
- **Logic:** the time from the trophy event to the start of acceleration is longer than the norm → the player "freezes".
- **How to measure:** the trophy phase duration in frames, compared with the typical (e.g. >N frames at 30fps).
- **Advice:** "A pause in the trophy position drains energy. Try to transition smoothly from the toss to the hit without stopping."

#### T3. Toss arm drops too early
- **Logic:** the toss wrist drops **before** contact → the player loses the "pointer" to the ball.
- **How to measure:** the toss-wrist height at contact; if substantially below its peak, the arm dropped.
- **Advice:** "After the toss, keep the toss arm up a little longer — it helps keep the ball in view and steers the direction of the hit."

### Toss

#### TO1. Toss too far back
- **Logic:** the peak position of the ball/toss-arm toss is behind the body (relative to the hips) → the player leans back at contact.
- **How to measure:** the x-coordinate of the toss peak relative to the hip center; substantially behind is a problem.
- **Advice:** "The ball is tossed too far back. Try tossing it slightly forward and to the side — the hit will then be on-line and with weight."

#### TO2. Toss too low
- **Logic:** the toss peak height (from release to peak) is below the norm → the player rushes the swing.
- **How to measure:** the y-coordinate difference between release and peak of the toss wrist (as a proxy for the ball).
- **Advice:** "The toss is too low — there isn't enough time for a full swing. Toss higher so the racket can make a full circle."

### Contact

#### C1. Contact too low
- **Logic:** at contact the racket-hand wrist height is substantially below its maximum extension, or the elbow is strongly bent (<180° - tol).
- **How to measure:** the elbow angle at the contact moment; the wrist height relative to the shoulder.
- **Advice:** "The hit happens too low — you strike with a bent arm. Reach for the ball with a fully extended arm at the top."

#### C2. Contact behind the body
- **Logic:** at contact the ball/strike point is behind the body (relative to the forward direction).
- **How to measure:** the x-coordinate of the contact point relative to the hips/shoulders; if behind → a problem.
- **Advice:** "The strike point is behind the body — the ball goes into the net or flies too long. Try to hit the ball slightly in front of you."

#### C3. Insufficient knee bend
- **Logic:** the max knee flexion in trophy is below the norm → the player doesn't use the legs.
- **How to measure:** the minimum knee angle (max flexion) in the trophy phase.
- **Advice:** "The knees are barely bent — the legs contribute almost no energy to the hit. Bend the knees deeper in the trophy position to push upward toward the ball."

### Follow-through

#### F1. Abrupt stop
- **Logic:** after contact the racket does not pass across the body / the motion cuts off sharply.
- **How to measure:** the racket-wrist trajectory after contact — it should cross the body's midline and descend.
- **Advice:** "The racket motion cuts off after the hit. Finish the serve — let the racket travel across the body to the opposite side. It's both power and shoulder protection."

#### F2. Loss of balance
- **Logic:** after the serve the player leans noticeably / "falls over".
- **How to measure:** the center-of-mass (hips) position relative to the feet at the end of the follow-through; the lean.
- **Confidence level:** usually low — CV struggles to tell "falling over" from a "natural step". Flag as info, not warn.

## Analysis layers

### Layer 1 — Simple advice (default for everyone)
- Output: the text advice from the rules above
- Sorted by severity (error → warn → info)
- No numbers, degrees, or anatomy
- This is the prototype's **main front-end**

### Layer 2 — Precise metrics (optional)
- For each piece of advice (where applicable) — a concrete value:
  - "Your knee flexion angle: 12° (norm 20–35°)"
  - "Toss height: ~40cm above the head (norm 50–80cm)"
- Reference ranges from `src/constants/biomechanics.ts`
- For the advanced amateur who cares about the numbers

### Layer 3 — Comparison with a reference (optional, partial in the prototype)
- An overlaid user skeleton vs. a reference pro video
- Requires:
  - A set of reference videos (1–3 to start)
  - Skeleton normalization (scale, orientation, time alignment by phase)
- On the prototype: a **minimal version** — we show the reference skeleton in the same phase side by side. Full overlay alignment is future.

## Thresholds and calibration

### Principle
- Thresholds live in `src/constants/biomechanics.ts`
- Each carries a source comment:
  ```typescript
  // Chow et al. (2012), Table 3: intermediate players show knee flexion 20-35° at trophy
  // Calibrated 2026-06-20 on 5 test serves; tolerance widened by ±5° for amateur variability.
  export const KNEE_FLEXION_NORMAL_RANGE_DEG: [number, number] = [20, 35];
  ```

### Threshold sources
1. **Literature** — Chow et al., MDPI 2024, Frontiers 2024 (see `docs/research/`)
2. **Practical** — OnCourtAI, APOPT metrics
3. **Empirical** — calibration on test serves (preferred for the prototype)

### Tolerance zones
- An amateur serve is **variable** — narrow thresholds give many false positives
- We use **normal ranges** + severity by distance from the range:
  - Inside the range → no finding
  - Slightly outside → `info` / `warn`
  - Substantially outside → `error`

## Confidence

Every rule returns a confidence. Factors that lower confidence:
- Low landmark visibility (see the cv-pose-estimation skill)
- A short phase (few frames to analyze)
- Motion tangential to the camera (2D inaccuracy)
- Low-quality test video

**Rule:** we show low-confidence findings, but softly ("Maybe ...", "Could not pin down exactly, but ..."), not categorically.

## Testing rules

### Unit tests
For every rule — a synthetic `PhaseContext` with known values:
```typescript
test('C3 flags insufficient knee bend', () => {
  const ctx = makeCtx({ kneeFlexionAtTrophy: 12 });  // below the norm
  expect(ruleC3.check(ctx)?.severity).toBe('warn');
});

test('C3 passes for good knee bend', () => {
  const ctx = makeCtx({ kneeFlexionAtTrophy: 28 });  // in the norm
  expect(ruleC3.check(ctx)).toBeNull();
});
```

### Boundary cases
- A value exactly on the threshold
- Low visibility → the rule should return low-confidence or null
- An empty/short phase

## Anti-patterns (do NOT do)

1. ❌ A sharp threshold with no tolerance zone → false positives
2. ❌ Advice with anatomical terms ("reduce the internal shoulder rotation angle by 15°") → an amateur won't understand
3. ❌ Categorical advice at low-confidence → misleading
4. ❌ A magic number in a rule body → impossible to calibrate
5. ❌ A rule without a unit test → regressions when thresholds change
6. ❌ ML/LLM for evaluation → violates ADR-0002 on the prototype

## Related
- ADR-0002 (rule-based approach): `docs/decisions/0002-rule-based-approach.md`
- Biomechanics of errors: `docs/biomechanics/serve-phases.md`
- Analysis layers and success metrics: see the design doc
- Angle calculation: the `cv-pose-estimation` skill
- Phase detection: the `tennis-serve-phases` skill
