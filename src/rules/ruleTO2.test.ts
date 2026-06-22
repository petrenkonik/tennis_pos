import { describe, it, expect } from 'vitest';
import i18n from '../i18n';
import { ruleTO2 } from './ruleTO2';
import { LM } from '../pose/landmarks';
import type { PhaseContext, Confidence } from '../types';

function makeCtx(
  tossApexHeightAboveShoulder: number,
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
      tossApexHeightAboveShoulder,
      tossApexHorizontalOffset: 0,
      tossArmDropAtContact: 0.9,
      racketDropDepth: 0.05,
      accelerationPhaseMs: 100,
      followThroughHorizontalTravel: 0.2,
      leanAtFollowEnd: 0.05,
      facingSign: 1,
    },
  };
}

describe('ruleTO2 (toss too low)', () => {
  it('passes when the toss apex is high enough', () => {
    expect(ruleTO2.check(makeCtx(0.20))).toBeNull();
  });
  it('passes exactly at the warn boundary', () => {
    expect(ruleTO2.check(makeCtx(0.15))).toBeNull();
  });
  it('warns just below the warn boundary', () => {
    expect(ruleTO2.check(makeCtx(0.12))?.severity).toBe('warn');
  });
  it('errors well below the warn boundary', () => {
    expect(ruleTO2.check(makeCtx(0.04))?.severity).toBe('error');
  });
  it('inherits confidence from the phases', () => {
    expect(ruleTO2.check(makeCtx(0.04, 'low'))?.confidence).toBe('low');
  });
  it('returns null when the metric is NaN', () => {
    expect(ruleTO2.check(makeCtx(NaN))).toBeNull();
  });
  it('fills a Layer-2 metric without anatomical jargon in advice', () => {
    const f = ruleTO2.check(makeCtx(0.04))!;
    expect(f.advice).toBe('rules.TO2.advice');
    expect(i18n.t(f.advice)).not.toMatch(/rotation|pronation|anatom|flexion|extension/i);
  });

  describe('evaluate (full report row)', () => {
    it('reports ok with the metric when the toss is high enough', () => {
      const r = ruleTO2.evaluate!(makeCtx(0.20));
      expect(r.status).toBe('ok');
      expect(r.metric?.value).toBeCloseTo(0.20, 5);
      expect(r.metric?.referenceRange).toBeDefined();
    });
    it('reports error with advice when the toss is far too low', () => {
      const r = ruleTO2.evaluate!(makeCtx(0.04));
      expect(r.status).toBe('error');
      expect(r.advice).toBe('rules.TO2.advice');
    });
    it('reports unknown when the height is NaN', () => {
      const r = ruleTO2.evaluate!(makeCtx(NaN));
      expect(r.status).toBe('unknown');
      expect(r.metric).toBeUndefined();
    });
    it('points at the toss apex frame and declares the toss-arm landmarks', () => {
      const ctx = makeCtx(0.20);
      ctx.metrics.tossApexFrame = 2;
      ctx.poses = [
        { frameIndex: 0, timestampMs: 0, landmarks: [] },
        { frameIndex: 1, timestampMs: 1000, landmarks: [] },
        { frameIndex: 2, timestampMs: 2000, landmarks: [] },
      ];
      const r = ruleTO2.evaluate!(ctx);
      expect(r.atFrame).toBe(2);
      expect(r.atTimestampMs).toBe(2000);
      expect(r.landmarks).toEqual([LM.L_WRIST, LM.L_SHOULDER]);
    });
  });
});
