import type { PoseFrame, Phases } from '../types';

// The four serve-phase keys, as a reusable union. Phase intervals in
// Phases.phases are [startFrame, endFrame] indices into the poses array; this
// type names each key so callers (PhaseBar, App) can refer to them by name
// instead of repeating the union literal.
export type PhaseKey = keyof Phases['phases']; // 'preparation' | 'trophy' | 'acceleration' | 'followThrough'

/**
 * Convert a pose-array frame index into its wall-clock timestamp (ms).
 *
 * Phase boundaries are stored as frame indices (Phases.phases[key] =
 * [startFrame, endFrame]) — indices into the `poses` array, where each
 * PoseFrame carries a `timestampMs` aligned to the source video. This helper
 * bridges the two so the UI can seek the <video> to a phase boundary.
 *
 * Out-of-bounds indices are clamped (defensively: detection guarantees
 * endFrame <= poses.length-1, but we never want a NaN/undefined seek target).
 */
export function frameToMs(frameIndex: number, poses: PoseFrame[]): number {
  if (poses.length === 0) return 0;
  const clamped = Math.min(Math.max(frameIndex, 0), poses.length - 1);
  return poses[clamped].timestampMs;
}
