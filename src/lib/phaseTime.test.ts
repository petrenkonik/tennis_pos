import { describe, it, expect } from 'vitest';
import type { PoseFrame } from '../types';
import { frameToMs } from './phaseTime';

// Build a minimal pose array where frame i has timestampMs = i * 1000 + 500.
// Only timestampMs/frameIndex are read by frameToMs, so landmarks can be empty.
function poses(n: number): PoseFrame[] {
  return Array.from({ length: n }, (_, i) => ({
    frameIndex: i,
    timestampMs: i * 1000 + 500,
    landmarks: [],
  }));
}

describe('frameToMs', () => {
  it('returns the timestampMs of the frame at the given index', () => {
    const p = poses(6);
    expect(frameToMs(2, p)).toBe(2500);
  });

  it('handles the first frame (index 0)', () => {
    const p = poses(6);
    expect(frameToMs(0, p)).toBe(500);
  });

  it('clamps an out-of-bounds index to the last available frame', () => {
    const p = poses(6); // last index 5 → 5500ms
    expect(frameToMs(99, p)).toBe(5500);
  });

  it('clamps a negative index to the first frame', () => {
    const p = poses(6);
    expect(frameToMs(-3, p)).toBe(500);
  });

  it('returns 0 when there are no poses (defensive — should not happen post-gate)', () => {
    expect(frameToMs(5, [])).toBe(0);
  });
});
