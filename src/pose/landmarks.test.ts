import { describe, it, expect } from 'vitest';
import { LM, racketWrist, tossWrist } from './landmarks';
import type { PoseFrame, Landmark } from '../types';

function frame(): PoseFrame {
  const landmarks: Landmark[] = [];
  for (let i = 0; i < 33; i++) landmarks.push({ x: i / 100, y: 0, z: 0, visibility: 1 });
  return { frameIndex: 0, timestampMs: 0, landmarks };
}

describe('landmark accessors', () => {
  it('maps racket/toss wrist by handedness', () => {
    const f = frame();
    expect(racketWrist(f, 'right')).toBe(f.landmarks[LM.R_WRIST]);
    expect(tossWrist(f, 'right')).toBe(f.landmarks[LM.L_WRIST]);
    expect(racketWrist(f, 'left')).toBe(f.landmarks[LM.L_WRIST]);
    expect(tossWrist(f, 'left')).toBe(f.landmarks[LM.R_WRIST]);
  });
});
