import { describe, it, expect } from 'vitest';
import { kneeFlexion, elbowExtension, racketWristHeight } from './metrics';
import { LM } from './landmarks';
import type { PoseFrame, Landmark } from '../types';

function makeLandmarks(overrides: Record<number, Partial<Landmark>> = {}): Landmark[] {
  const a: Landmark[] = [];
  for (let i = 0; i < 33; i++) a.push({ x: 0.5, y: 0.5, z: 0, visibility: 1 });
  for (const k of Object.keys(overrides)) {
    const i = Number(k);
    a[i] = { ...a[i], ...overrides[i] };
  }
  return a;
}
const frame = (lm: Landmark[]): PoseFrame => ({ frameIndex: 0, timestampMs: 0, landmarks: lm });

describe('pose metrics', () => {
  it('kneeFlexion returns 180 for straight legs', () => {
    const f = frame(makeLandmarks({
      [LM.L_HIP]: { x: 0.5, y: 0.4 }, [LM.L_KNEE]: { x: 0.5, y: 0.6 }, [LM.L_ANKLE]: { x: 0.5, y: 0.8 },
      [LM.R_HIP]: { x: 0.5, y: 0.4 }, [LM.R_KNEE]: { x: 0.5, y: 0.6 }, [LM.R_ANKLE]: { x: 0.5, y: 0.8 },
    }));
    expect(kneeFlexion(f)).toBeCloseTo(180, 1);
  });
  it('kneeFlexion picks the more bent (smaller-angle) leg', () => {
    const f = frame(makeLandmarks({
      [LM.L_HIP]: { x: 0.5, y: 0.4 }, [LM.L_KNEE]: { x: 0.5, y: 0.6 }, [LM.L_ANKLE]: { x: 0.5, y: 0.8 }, // straight
      [LM.R_HIP]: { x: 0.5, y: 0.4 }, [LM.R_KNEE]: { x: 0.5, y: 0.6 }, [LM.R_ANKLE]: { x: 0.72, y: 0.78 }, // bent
    }));
    expect(kneeFlexion(f)).toBeLessThan(160);
  });
  it('elbowExtension returns 180 for a straight racket arm', () => {
    const f = frame(makeLandmarks({
      [LM.R_SHOULDER]: { x: 0.5, y: 0.55 }, [LM.R_ELBOW]: { x: 0.5, y: 0.35 }, [LM.R_WRIST]: { x: 0.5, y: 0.15 },
    }));
    expect(elbowExtension(f, 'right')).toBeCloseTo(180, 1);
  });
  it('racketWristHeight inverts y', () => {
    const f = frame(makeLandmarks({ [LM.R_WRIST]: { x: 0.5, y: 0.2 } }));
    expect(racketWristHeight(f, 'right')).toBeCloseTo(0.8, 5);
  });
});
