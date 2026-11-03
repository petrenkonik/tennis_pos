import { SMOOTH_WINDOW_FRAMES } from '../constants/biomechanics';
import { smoothSeries } from './smooth';

// Signal primitives used by event detection (toss start, track-verified
// contact). They operate on plain numeric series / point tracks, deliberately
// decoupled from pose types, so the event logic reads like signal math rather
// than landmark bookkeeping.
//
// Educational framing (why these exist): a discrete event like "the toss
// starts" is a property of a MOTION TREND, not of any single frame. The tools
// below are the minimal vocabulary for trend reasoning:
//   - pointSpeed turns a trajectory into a "how fast is it moving" signal;
//   - argmax / argmin find the extreme of a signal inside a window;
//   - firstIdx finds where a signal first crosses a condition.
// Every detector in the pipeline is then a short, readable composition of
// these primitives — deterministic, explainable, no ML (decision 0002).

export interface Point { x: number; y: number }

// Magnitude of the velocity of a moving point, per input frame, in units per
// second, smoothed with the standard window.
//
// How it works, step by step:
//   1. For frame i, take the displacement between the nearest present points
//      on each side (central difference). Central differences are preferred
//      over forward/backward ones because they are centered on frame i — no
//      half-frame lag, and symmetric behavior on rising vs falling edges.
//      At the sequence edges (or around null gaps) only one side may exist;
//      then the available single side is used (one-sided difference).
//   2. Divide the displacement by the REAL elapsed time between the two
//      frames (from timestampsMs), so variable frame timing is handled
//      honestly. The interval is clamped to ≥1 ms to avoid divide-by-zero on
//      duplicate timestamps.
//   3. Smooth the resulting speed series (window 5): per-frame speeds are
//      noisy (landmark jitter shows up squared here, as displacement noise),
//      while true speed peaks span several frames and survive smoothing.
// Null slots (track gaps) are bridged to the nearest present neighbors; a
// frame with no neighbors at all reads speed 0 rather than NaN, so callers
// can always compare/scan the output.
export function pointSpeed(
  points: (Point | null)[],
  timestampsMs: number[],
  window: number = SMOOTH_WINDOW_FRAMES,
): number[] {
  const n = points.length;
  if (n === 0) return [];
  if (n === 1) return [0];

  // Index of the nearest non-null point at or before/after i (-1 = none).
  const prevPresent = new Array<number>(n).fill(-1);
  const nextPresent = new Array<number>(n).fill(-1);
  let last = -1;
  for (let i = 0; i < n; i++) { if (points[i]) last = i; prevPresent[i] = last; }
  last = -1;
  for (let i = n - 1; i >= 0; i--) { if (points[i]) last = i; nextPresent[i] = last; }

  const raw = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    // Neighbor strictly before i, strictly after i (fall back to i itself if
    // nothing else exists on that side → zero displacement → speed 0).
    const a = prevPresent[i - 1] ?? -1;
    const b = nextPresent[i + 1] ?? -1;
    const pa = a >= 0 ? points[a]! : points[i]!;
    const pb = b >= 0 && b < n ? points[b]! : points[i]!;
    const ta = a >= 0 ? timestampsMs[a] : timestampsMs[i];
    const tb = b >= 0 && b < n ? timestampsMs[b] : timestampsMs[i];
    const dt = Math.max(1, tb - ta) / 1000; // seconds, ≥1 ms guard
    raw[i] = Math.hypot(pb.x - pa.x, pb.y - pa.y) / dt;
  }
  return smoothSeries(raw, window);
}

// Signed rate of change of a numeric series, per input frame, in units per
// second, smoothed with the standard window.
//
// This is `pointSpeed`'s directional sibling: speed answers "how fast is the
// point moving", derivative answers "is it going up or down". The event
// detector for the toss start scans exactly this: the toss-wrist HEIGHT series
// (1 − y, so up = positive), and looks for the first frame where the height is
// increasing fast enough to be a deliberate toss lift rather than jitter.
//
// How it works, step by step:
//   1. Central difference for interior frames — v[i] = (s[i+1] − s[i−1]) / Δt
//      where Δt is the REAL time elapsed between frames i−1 and i+1 (from
//      timestampsMs, clamped to ≥1 ms). Centered, so no half-frame lag.
//   2. One-sided difference at the sequence edges (only one neighbor exists).
//   3. Smooth the derivative series (window 5): consecutive-frame differences
//      amplify landmark jitter (noise in s shows up doubled in s[i+1] − s[i−1]);
//      a real multi-frame rise survives smoothing nearly intact.
export function derivative(
  values: number[],
  timestampsMs: number[],
  window: number = SMOOTH_WINDOW_FRAMES,
): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [0];

  const raw = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const a = i > 0 ? i - 1 : 0;
    const b = i < n - 1 ? i + 1 : n - 1;
    const dt = Math.max(1, timestampsMs[b] - timestampsMs[a]) / 1000; // seconds, ≥1 ms guard
    raw[i] = (values[b] - values[a]) / dt;
  }
  return smoothSeries(raw, window);
}

// Index of the maximum value inside [from, toExclusive). Ties resolve to the
// FIRST such index. Degenerate bounds are clamped into the array, so callers
// never need their own guards for empty windows.
export function argmax(values: number[], from = 0, toExclusive: number = values.length): number {
  const n = values.length;
  if (n === 0) return 0;
  let best = Math.max(0, Math.min(from, n - 1));
  let bestVal = -Infinity;
  const end = Math.min(toExclusive, n);
  for (let i = best; i < end; i++) {
    if (values[i] > bestVal) { bestVal = values[i]; best = i; }
  }
  return best;
}

// Index of the minimum value inside [from, toExclusive). Mirrors argmax.
export function argmin(values: number[], from = 0, toExclusive: number = values.length): number {
  const n = values.length;
  if (n === 0) return 0;
  let best = Math.max(0, Math.min(from, n - 1));
  let bestVal = Infinity;
  const end = Math.min(toExclusive, n);
  for (let i = best; i < end; i++) {
    if (values[i] < bestVal) { bestVal = values[i]; best = i; }
  }
  return best;
}

// Index of the first value satisfying `pred`, scanning from `from` to the end.
// Returns -1 when nothing qualifies (the caller decides the fallback).
export function firstIdx(values: number[], from: number, pred: (v: number) => boolean): number {
  const start = Math.max(0, from);
  for (let i = start; i < values.length; i++) {
    if (pred(values[i])) return i;
  }
  return -1;
}
