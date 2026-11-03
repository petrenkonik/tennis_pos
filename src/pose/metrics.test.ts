import { describe, it, expect } from 'vitest';
import {
  kneeJointAngle, elbowExtension, racketWristHeight, tossWristHeight,
  racketElbowHeight, racketShoulderHeight, tossShoulderHeight, hipCenterX, footCenterX,
  bodyHeightUnits, peakWristSpeedMs,
} from './metrics';
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
const frameAt = (i: number, lm: Landmark[]): PoseFrame =>
  ({ frameIndex: i, timestampMs: (i / 30) * 1000, landmarks: lm });

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

  it('racketElbowHeight / racketShoulderHeight invert y', () => {
    const f = frame(makeLandmarks({
      [LM.R_ELBOW]: { x: 0.5, y: 0.3 }, [LM.R_SHOULDER]: { x: 0.5, y: 0.6 },
    }));
    expect(racketElbowHeight(f, 'right')).toBeCloseTo(0.7, 5);
    expect(racketShoulderHeight(f, 'right')).toBeCloseTo(0.4, 5);
  });

  it('tossShoulderHeight reads the OPPOSITE shoulder (left shoulder for a righty)', () => {
    const f = frame(makeLandmarks({ [LM.L_SHOULDER]: { x: 0.5, y: 0.25 } }));
    expect(tossShoulderHeight(f, 'right')).toBeCloseTo(0.75, 5);
  });

  describe('hipCenterX', () => {
    it('averages both hips when both are visible', () => {
      const f = frame(makeLandmarks({
        [LM.L_HIP]: { x: 0.4 }, [LM.R_HIP]: { x: 0.6 },
      }));
      expect(hipCenterX(f)).toBeCloseTo(0.5, 5);
    });
    it('trusts the only visible hip when the other is occluded', () => {
      const f = frame(makeLandmarks({
        [LM.L_HIP]: { x: 0.42, visibility: 0.2 }, [LM.R_HIP]: { x: 0.6, visibility: 1 },
      }));
      expect(hipCenterX(f)).toBeCloseTo(0.6, 5);
    });
    it('falls back to the shoulder midpoint when neither hip is reliable', () => {
      const f = frame(makeLandmarks({
        [LM.L_HIP]: { x: 0.4, visibility: 0.1 }, [LM.R_HIP]: { x: 0.6, visibility: 0.1 },
        [LM.L_SHOULDER]: { x: 0.45 }, [LM.R_SHOULDER]: { x: 0.55 },
      }));
      expect(hipCenterX(f)).toBeCloseTo(0.5, 5);
    });
  });

  describe('footCenterX', () => {
    it('averages both heels when both are visible', () => {
      const f = frame(makeLandmarks({
        [LM.L_HEEL]: { x: 0.35 }, [LM.R_HEEL]: { x: 0.65 },
      }));
      expect(footCenterX(f)).toBeCloseTo(0.5, 5);
    });
    it('falls back to ankles when heels are occluded', () => {
      const f = frame(makeLandmarks({
        [LM.L_HEEL]: { x: 0.35, visibility: 0.1 }, [LM.R_HEEL]: { x: 0.65, visibility: 0.1 },
        [LM.L_ANKLE]: { x: 0.4 }, [LM.R_ANKLE]: { x: 0.6 },
      }));
      expect(footCenterX(f)).toBeCloseTo(0.5, 5);
    });
    it('falls back to the hip center when neither heels nor ankles are reliable', () => {
      const f = frame(makeLandmarks({
        [LM.L_HEEL]: { x: 0.35, visibility: 0.1 }, [LM.R_HEEL]: { x: 0.65, visibility: 0.1 },
        [LM.L_ANKLE]: { x: 0.4, visibility: 0.1 }, [LM.R_ANKLE]: { x: 0.6, visibility: 0.1 },
        [LM.L_HIP]: { x: 0.48 }, [LM.R_HIP]: { x: 0.52 },
      }));
      expect(footCenterX(f)).toBeCloseTo(0.5, 5);
    });
  });

  describe('bodyHeightUnits', () => {
    // Nose at y 0.2, ankles at y 0.8 → extent 0.6 × BODY_HEIGHT_SCALE (1.25) = 0.75.
    const standing = () => frame(makeLandmarks({
      [LM.NOSE]: { x: 0.5, y: 0.2 },
      [LM.L_ANKLE]: { x: 0.45, y: 0.8 }, [LM.R_ANKLE]: { x: 0.55, y: 0.8 },
    }));

    it('scales the nose→ankle-mid extent by BODY_HEIGHT_SCALE', () => {
      expect(bodyHeightUnits(standing())).toBeCloseTo(0.75, 5);
    });

    it('is NaN when the nose is not reliable (no ruler in frame)', () => {
      const f = frame(makeLandmarks({
        [LM.NOSE]: { y: 0.2, visibility: 0.2 },
        [LM.L_ANKLE]: { y: 0.8 }, [LM.R_ANKLE]: { y: 0.8 },
      }));
      expect(Number.isNaN(bodyHeightUnits(f))).toBe(true);
    });

    it('is NaN when neither ankle is reliable', () => {
      const f = frame(makeLandmarks({
        [LM.NOSE]: { y: 0.2 },
        [LM.L_ANKLE]: { y: 0.8, visibility: 0.1 }, [LM.R_ANKLE]: { y: 0.8, visibility: 0.1 },
      }));
      expect(Number.isNaN(bodyHeightUnits(f))).toBe(true);
    });

    it('uses the visible ankle when the other is occluded', () => {
      const f = frame(makeLandmarks({
        [LM.NOSE]: { x: 0.5, y: 0.2 },
        [LM.L_ANKLE]: { y: 0.8, visibility: 0.1 }, [LM.R_ANKLE]: { x: 0.55, y: 0.8 },
      }));
      expect(bodyHeightUnits(f)).toBeCloseTo(0.75, 5);
    });
  });

  describe('peakWristSpeedMs', () => {
    // A linear swing: the racket wrist moves +0.1 x per frame → 3 units/s at
    // 30 fps. Body ruler: nose 0.2 → ankles 0.8 → 0.75 units ≈ 1.75 m →
    // 3 units/s × (1.75 / 0.75) = 7.0 m/s at the default 175 cm.
    const swing = () => Array.from({ length: 6 }, (_, i) => frameAt(i, makeLandmarks({
      [LM.NOSE]: { x: 0.5, y: 0.2 },
      [LM.L_ANKLE]: { x: 0.45, y: 0.8 }, [LM.R_ANKLE]: { x: 0.55, y: 0.8 },
      [LM.R_WRIST]: { x: 0.3 + i * 0.1, y: 0.5 },
    })));

    it('converts a synthetic linear swing into m/s via the body ruler', () => {
      expect(peakWristSpeedMs(swing(), 'right', 0, 5, 175)).toBeCloseTo(7.0, 3);
    });

    it('scales linearly with the player-height setting', () => {
      const at175 = peakWristSpeedMs(swing(), 'right', 0, 5, 175);
      const at160 = peakWristSpeedMs(swing(), 'right', 0, 5, 160);
      expect(at160).toBeCloseTo(at175 * (160 / 175), 3);
    });

    it('ignores speed peaks outside the measurement window', () => {
      const poses = swing();
      // A teleport AFTER the window must not win. The window is narrowed to
      // [0,2] so the teleport's smoothing halo (±2 frames around the spike)
      // cannot bleed into it either.
      poses.push(frameAt(6, makeLandmarks({
        [LM.NOSE]: { x: 0.5, y: 0.2 },
        [LM.L_ANKLE]: { x: 0.45, y: 0.8 }, [LM.R_ANKLE]: { x: 0.55, y: 0.8 },
        [LM.R_WRIST]: { x: 0.95, y: 0.5 },
      })));
      expect(peakWristSpeedMs(poses, 'right', 0, 2, 175)).toBeCloseTo(7.0, 3);
    });

    it('is NaN when the body ruler is unreadable at the peak frame', () => {
      // Occlude the ankles everywhere: argmax lands on a frame whose ruler is
      // NaN no matter which frame wins the tie.
      const poses = swing().map(f => {
        f.landmarks[LM.L_ANKLE].visibility = 0.1;
        f.landmarks[LM.R_ANKLE].visibility = 0.1;
        return f;
      });
      expect(Number.isNaN(peakWristSpeedMs(poses, 'right', 0, 5, 175))).toBe(true);
    });

    it('is NaN for degenerate inputs (too few frames, empty window)', () => {
      expect(Number.isNaN(peakWristSpeedMs([], 'right', 0, 0, 175))).toBe(true);
      expect(Number.isNaN(peakWristSpeedMs(swing().slice(0, 1), 'right', 0, 0, 175))).toBe(true);
      expect(Number.isNaN(peakWristSpeedMs(swing(), 'right', 4, 1, 175))).toBe(true);
    });
  });
});
