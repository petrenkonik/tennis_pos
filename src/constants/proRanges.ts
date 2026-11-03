// Layer-2 reference ranges ("pro ranges"): target bands used to display
// "yours vs reference" for the physical-unit metrics.
//
// Scope note (important): these ranges feed Layer-2 DISPLAY only. The error
// rules keep their own PROVISIONAL verdict thresholds in
// constants/biomechanics.ts — a range here never flips a rule verdict.
//
// Sources (internal): our biomechanics reference
// (docs/biomechanics/serve-phases.md) and empirical readings on the demo
// clip + synthetic serve fixtures. Provisional pending calibration on a
// labeled serve set (tracked follow-up in the specs).

// Peak racket-wrist speed of the swing, in m/s (see peakWristSpeedMs).
// A fluent recreational serve (3.0–4.0) peaks inside this band: below it the
// swing is usually abbreviated (short backswing, little leg drive feeding the
// arm); well above it is uncommon at this level and usually indicates a very
// athletic motion or an over-speed reading. Note for users: this is the HAND
// speed — the racket head travels several times faster on top of it, which is
// where serve power comes from.
export const WRIST_SPEED_MS_REF_RANGE: [number, number] = [10, 25];
