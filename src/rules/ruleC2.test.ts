import { describe, it, expect } from 'vitest';
import i18n from '../i18n';
import { ruleC2 } from './ruleC2';
import { LM } from '../pose/landmarks';
import type { PhaseContext, Confidence } from '../types';

// Build a ctx varying the C2 inputs: the horizontal offset of the racket wrist
// from the hip center at the contact frame, and the swing facing sign.
function makeCtx(
  contactHorizontalOffset: number,
  facingSign: 1 | -1 | 0 = 1,
  confidence: Confidence = 'high',
): PhaseContext {
  return {
    poses: [], fps: 30,
    phases: {
      handedness: 'right',
      events: { trophyFrame: 0, contactFrame: 1, followStartFrame: 2 },
      phases: { preparation: [0, 0], trophy: [0, 1], acceleration: [1, 1], followThrough: [1, 2] },
      confidence,
    },
    metrics: {
      kneeFlexionAtTrophyDeg: 150,
      elbowExtensionAtContactDeg: 170,
      contactHeightAboveShoulder: 0.1,
      contactHorizontalOffset,
      tossApexFrame: 0,
      tossApexHeightAboveShoulder: 0.2,
      tossApexHorizontalOffset: 0,
      tossArmDropAtContact: 0.9,
      racketDropDepth: 0.05,
      accelerationPhaseMs: 100,
      followThroughHorizontalTravel: 0.2,
      leanAtFollowEnd: 0.05,
      facingSign,
    },
  };
}

describe('ruleC2 (contact behind the body)', () => {
  it('passes when the contact is in front of the body', () => {
    // facingSign +1: forward = positive offset. +0.06 is well in front.
    expect(ruleC2.check(makeCtx(0.06, 1))).toBeNull();
  });
  it('passes when the contact is roughly in line (small offset)', () => {
    expect(ruleC2.check(makeCtx(-0.01, 1))).toBeNull();
  });
  it('warns when the contact is slightly behind', () => {
    // facingSign +1: behind = negative offset. -0.04 is in [WARN, ERROR).
    expect(ruleC2.check(makeCtx(-0.04, 1))?.severity).toBe('warn');
  });
  it('errors when the contact is well behind', () => {
    expect(ruleC2.check(makeCtx(-0.08, 1))?.severity).toBe('error');
  });
  it('respects the facing sign (mirrors for a left-facing player)', () => {
    // facingSign -1: behind = positive offset. +0.08 is well behind.
    expect(ruleC2.check(makeCtx(0.08, -1))?.severity).toBe('error');
    expect(ruleC2.check(makeCtx(-0.08, -1))).toBeNull();
  });
  it('returns null when facingSign is 0 (ambiguous direction)', () => {
    expect(ruleC2.check(makeCtx(-0.08, 0))).toBeNull();
  });
  it('inherits confidence from the phases', () => {
    expect(ruleC2.check(makeCtx(-0.08, 1, 'low'))?.confidence).toBe('low');
  });
  it('returns null when the offset is NaN', () => {
    expect(ruleC2.check(makeCtx(NaN, 1))).toBeNull();
  });
  it('fills a Layer-2 metric without anatomical jargon in advice', () => {
    const f = ruleC2.check(makeCtx(-0.08, 1))!;
    expect(f.advice).toBe('rules.C2.advice');
    expect(i18n.t(f.advice)).not.toMatch(/rotation|pronation|anatom|flexion|extension/i);
  });

  describe('evaluate (full report row)', () => {
    it('reports ok when in front', () => {
      const r = ruleC2.evaluate!(makeCtx(0.06, 1));
      expect(r.status).toBe('ok');
      expect(r.metric?.referenceRange).toBeDefined();
    });
    it('reports error with advice when well behind', () => {
      const r = ruleC2.evaluate!(makeCtx(-0.08, 1));
      expect(r.status).toBe('error');
      expect(r.advice).toBe('rules.C2.advice');
    });
    it('reports unknown when facingSign is 0', () => {
      const r = ruleC2.evaluate!(makeCtx(-0.08, 0));
      expect(r.status).toBe('unknown');
    });
    it('reports unknown when the offset is NaN', () => {
      const r = ruleC2.evaluate!(makeCtx(NaN, 1));
      expect(r.status).toBe('unknown');
      expect(r.metric).toBeUndefined();
    });
    it('points at the contact frame and declares hip/wrist landmarks', () => {
      const ctx = makeCtx(-0.08, 1);
      ctx.phases.events.contactFrame = 1;
      ctx.poses = [
        { frameIndex: 0, timestampMs: 0, landmarks: [] },
        { frameIndex: 1, timestampMs: 2400, landmarks: [] },
      ];
      const r = ruleC2.evaluate!(ctx);
      expect(r.atFrame).toBe(1);
      expect(r.atTimestampMs).toBe(2400);
      expect(r.landmarks).toEqual([LM.R_WRIST, LM.L_HIP, LM.R_HIP]);
    });
  });
});
