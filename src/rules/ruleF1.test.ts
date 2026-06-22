import { describe, it, expect } from 'vitest';
import i18n from '../i18n';
import { ruleF1 } from './ruleF1';
import { LM } from '../pose/landmarks';
import type { PhaseContext, Confidence } from '../types';

function makeCtx(
  followThroughHorizontalTravel: number,
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
      contactHorizontalOffset: 0,
      tossApexFrame: 0,
      tossApexHeightAboveShoulder: 0.2,
      tossApexHorizontalOffset: 0,
      tossArmDropAtContact: 0.9,
      racketDropDepth: 0.05,
      accelerationPhaseMs: 100,
      followThroughHorizontalTravel,
      leanAtFollowEnd: 0.05,
      facingSign: 1,
    },
  };
}

describe('ruleF1 (abrupt stop)', () => {
  it('passes when the racket travels well across the body', () => {
    expect(ruleF1.check(makeCtx(0.20))).toBeNull();
  });
  it('passes exactly at the warn boundary', () => {
    expect(ruleF1.check(makeCtx(0.12))).toBeNull();
  });
  it('warns just below the warn boundary', () => {
    expect(ruleF1.check(makeCtx(0.10))?.severity).toBe('warn');
  });
  it('errors well below the warn boundary', () => {
    expect(ruleF1.check(makeCtx(0.03))?.severity).toBe('error');
  });
  it('inherits confidence from the phases', () => {
    expect(ruleF1.check(makeCtx(0.03, 'low'))?.confidence).toBe('low');
  });
  it('returns null when the metric is NaN', () => {
    expect(ruleF1.check(makeCtx(NaN))).toBeNull();
  });
  it('fills a Layer-2 metric without anatomical jargon in advice', () => {
    const f = ruleF1.check(makeCtx(0.03))!;
    expect(f.advice).toBe('rules.F1.advice');
    expect(i18n.t(f.advice)).not.toMatch(/rotation|pronation|anatom|flexion|extension/i);
  });

  describe('evaluate (full report row)', () => {
    it('reports ok with the metric when the travel is long enough', () => {
      const r = ruleF1.evaluate!(makeCtx(0.20));
      expect(r.status).toBe('ok');
      expect(r.metric?.value).toBeCloseTo(0.20, 5);
      expect(r.metric?.referenceRange).toBeDefined();
    });
    it('reports error with advice when the motion cuts off', () => {
      const r = ruleF1.evaluate!(makeCtx(0.03));
      expect(r.status).toBe('error');
      expect(r.advice).toBe('rules.F1.advice');
    });
    it('reports unknown when the travel is NaN', () => {
      const r = ruleF1.evaluate!(makeCtx(NaN));
      expect(r.status).toBe('unknown');
      expect(r.metric).toBeUndefined();
    });
    it('points at the contact frame and declares the racket-wrist landmark', () => {
      const ctx = makeCtx(0.20);
      ctx.phases.events.contactFrame = 1;
      ctx.poses = [
        { frameIndex: 0, timestampMs: 0, landmarks: [] },
        { frameIndex: 1, timestampMs: 2400, landmarks: [] },
      ];
      const r = ruleF1.evaluate!(ctx);
      expect(r.atFrame).toBe(1);
      expect(r.atTimestampMs).toBe(2400);
      expect(r.landmarks).toEqual([LM.R_WRIST]);
    });
  });
});
