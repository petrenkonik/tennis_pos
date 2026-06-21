import { describe, it, expect } from 'vitest';
import { kneeJointAngle, elbowExtension, racketWristHeight, tossWristHeight } from './metrics';
import { jointAngle } from './geometry';
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
  it('kneeJointAngle returns 180 for straight legs', () => {
    const f = frame(makeLandmarks({
      [LM.L_HIP]: { x: 0.5, y: 0.4 }, [LM.L_KNEE]: { x: 0.5, y: 0.6 }, [LM.L_ANKLE]: { x: 0.5, y: 0.8 },
      [LM.R_HIP]: { x: 0.5, y: 0.4 }, [LM.R_KNEE]: { x: 0.5, y: 0.6 }, [LM.R_ANKLE]: { x: 0.5, y: 0.8 },
    }));
    expect(kneeJointAngle(f)).toBeCloseTo(180, 1);
  });

  it('kneeJointAngle trusts the more-visible knee, not the more-bent one', () => {
    // Far leg (left) is occluded (vis 0.2) AND geometrically bent; the visible
    // right leg is straight. The old min(L,R) returned the bent ~<160; the
    // robust version must return the straight (right) leg's ~180.
    const f = frame(makeLandmarks({
      [LM.L_HIP]: { x: 0.5, y: 0.4 }, [LM.L_KNEE]: { x: 0.5, y: 0.6, visibility: 0.2 }, [LM.L_ANKLE]: { x: 0.72, y: 0.78 },
      [LM.R_HIP]: { x: 0.5, y: 0.4 }, [LM.R_KNEE]: { x: 0.5, y: 0.6, visibility: 1 }, [LM.R_ANKLE]: { x: 0.5, y: 0.8 },
    }));
    expect(kneeJointAngle(f)).toBeCloseTo(180, 1);
  });

  it('kneeJointAngle returns NaN when neither knee is visible enough', () => {
    const f = frame(makeLandmarks({
      [LM.L_KNEE]: { visibility: 0.2 }, [LM.R_KNEE]: { visibility: 0.2 },
    }));
    expect(Number.isNaN(kneeJointAngle(f))).toBe(true);
  });

  it('kneeJointAngle returns the more-bent leg exactly when both are equally visible', () => {
    const f = frame(makeLandmarks({
      [LM.L_HIP]: { x: 0.5, y: 0.4 }, [LM.L_KNEE]: { x: 0.5, y: 0.6 }, [LM.L_ANKLE]: { x: 0.55, y: 0.8 }, // slightly bent (larger angle)
      [LM.R_HIP]: { x: 0.5, y: 0.4 }, [LM.R_KNEE]: { x: 0.5, y: 0.6 }, [LM.R_ANKLE]: { x: 0.72, y: 0.78 }, // more bent (smaller angle)
    }));
    const rightAngle = jointAngle(
      { x: 0.5, y: 0.4, z: 0, visibility: 1 },
      { x: 0.5, y: 0.6, z: 0, visibility: 1 },
      { x: 0.72, y: 0.78, z: 0, visibility: 1 },
    );
    expect(kneeJointAngle(f)).toBeCloseTo(rightAngle, 5);
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

  it('tossWristHeight inverts y of the toss arm (left wrist for a righty)', () => {
    const f = frame(makeLandmarks({ [LM.L_WRIST]: { x: 0.5, y: 0.2 } }));
    expect(tossWristHeight(f, 'right')).toBeCloseTo(0.8, 5);
  });
});
