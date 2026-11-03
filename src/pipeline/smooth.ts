import type { PoseFrame } from '../types';
import { SMOOTH_WINDOW_FRAMES } from '../constants/biomechanics';

// Centered moving average over a plain numeric series.
//
// How it works (educational note): for every index i the output is the mean of
// the values in a fixed-width window centered on i (clamped at the sequence
// edges, so the window "shrinks" near the ends instead of shifting or padding).
// Two properties matter for event detection:
//   1. It removes single-frame noise (a landmark jumping for one frame).
//   2. It keeps real trends intact — a multi-frame rise survives almost
//      unchanged, just shifted by ~window/2 frames (peak lag ≈ 2 frames at a
//      window of 5 and 30 fps, within our ±2-frame detection tolerance).
// Reused by `smooth` (per-landmark x/y trajectories) and by the signal helpers
// in signals.ts (velocity / speed series), so every smoothing in the pipeline
// shares one implementation and one window convention.
export function smoothSeries(values: number[], window = SMOOTH_WINDOW_FRAMES): number[] {
  if (values.length === 0) return [];
  const n = values.length;
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    let sum = 0, count = 0;
    for (let j = -half; j <= half; j++) {
      const k = i + j;
      if (k >= 0 && k < n) { sum += values[k]; count++; }
    }
    return sum / count;
  });
}

// Centered moving average over x,y of every landmark. z and visibility are
// passed through untouched (visibility is already a filtered confidence).
export function smooth(poses: PoseFrame[], window = SMOOTH_WINDOW_FRAMES): PoseFrame[] {
  if (poses.length === 0) return [];
  const numLm = poses[0].landmarks.length;

  // Smooth each landmark's x and y trajectory once, up front (33 landmarks ×
  // 2 axes), then reassemble frame by frame — one pass over the series instead
  // of re-smoothing inside the frame loop.
  const xs: number[][] = [];
  const ys: number[][] = [];
  for (let l = 0; l < numLm; l++) {
    xs.push(smoothSeries(poses.map(p => p.landmarks[l].x), window));
    ys.push(smoothSeries(poses.map(p => p.landmarks[l].y), window));
  }

  return poses.map((frame, i) => ({
    ...frame,
    landmarks: frame.landmarks.map((orig, l) =>
      ({ x: xs[l][i], y: ys[l][i], z: orig.z, visibility: orig.visibility })),
  }));
}
