import { describe, it, expect } from 'vitest';
import { smooth } from './smooth';
import type { PoseFrame, Landmark } from '../types';

function seq(xs: number[]): PoseFrame[] {
  return xs.map((x, i) => {
    const landmarks: Landmark[] = [{ x, y: x, z: 0, visibility: 1 }];
    return { frameIndex: i, timestampMs: i * 33, landmarks };
  });
}

describe('smooth', () => {
  it('leaves a constant signal unchanged', () => {
    const out = smooth(seq([0.5, 0.5, 0.5, 0.5, 0.5]), 3);
    expect(out.map(f => f.landmarks[0].x)).toEqual([0.5, 0.5, 0.5, 0.5, 0.5]);
  });
  it('dampens a single-frame spike', () => {
    const out = smooth(seq([0, 0, 1, 0, 0]), 3);
    expect(out[2].landmarks[0].x).toBeLessThan(1);
    expect(out[2].landmarks[0].x).toBeGreaterThan(0);
  });
  it('keeps the same number of frames and preserves visibility', () => {
    const input = seq([0, 1, 0]);
    input[1].landmarks[0].visibility = 0.3;
    const out = smooth(input, 3);
    expect(out).toHaveLength(3);
    expect(out[1].landmarks[0].visibility).toBe(0.3);
  });
});
