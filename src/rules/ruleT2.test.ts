import { describe, it, expect } from 'vitest';
import i18n from '../i18n';
import { ruleT2 } from './ruleT2';
import { LM } from '../pose/landmarks';
import type { PhaseContext, Confidence } from '../types';

function makeCtx(
  accelerationPhaseMs: number,
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
      accelerationPhaseMs,
      followThroughHorizontalTravel: 0.2,
      leanAtFollowEnd: 0.05,
      facingSign: 1,
    },
  };
}

describe('ruleT2 (too long in trophy — weak proxy, warn-only)', () => {
  it('passes when the acceleration phase is fluent', () => {
    expect(ruleT2.check(makeCtx(300))).toBeNull();
  });
  it('passes exactly at the warn boundary', () => {
    expect(ruleT2.check(makeCtx(400))).toBeNull();
  });
  it('warns just above the warn boundary', () => {
    expect(ruleT2.check(makeCtx(500))?.severity).toBe('warn');
  });
  it('errors well above the error boundary', () => {
    expect(ruleT2.check(makeCtx(800))?.severity).toBe('error');
  });
  it('forces confidence to low (acknowledged weak proxy) even when phases are high', () => {
    expect(ruleT2.check(makeCtx(800, 'high'))?.confidence).toBe('low');
  });
  it('returns null when the metric is NaN', () => {
    expect(ruleT2.check(makeCtx(NaN))).toBeNull();
  });
  it('fills a Layer-2 metric without anatomical jargon in advice', () => {
    const f = ruleT2.check(makeCtx(800))!;
    expect(f.advice).toBe('rules.T2.advice');
    expect(i18n.t(f.advice)).not.toMatch(/rotation|pronation|anatom|flexion|extension/i);
  });

  describe('evaluate (full report row)', () => {
    it('reports ok with the metric when fluent', () => {
      const r = ruleT2.evaluate!(makeCtx(300));
      expect(r.status).toBe('ok');
      expect(r.metric?.value).toBe(300);
      expect(r.metric?.referenceRange).toBeDefined();
    });
    it('reports error with advice when clearly frozen', () => {
      const r = ruleT2.evaluate!(makeCtx(800));
      expect(r.status).toBe('error');
      expect(r.advice).toBe('rules.T2.advice');
    });
    it('forces low confidence on the evaluate path too', () => {
      const r = ruleT2.evaluate!(makeCtx(800, 'high'));
      expect(r.confidence).toBe('low');
    });
    it('reports unknown when the duration is NaN', () => {
      const r = ruleT2.evaluate!(makeCtx(NaN));
      expect(r.status).toBe('unknown');
      expect(r.metric).toBeUndefined();
    });
    it('points at the trophy frame and declares racket-wrist landmarks', () => {
      const ctx = makeCtx(300);
      ctx.phases.events.trophyFrame = 1;
      ctx.poses = [
        { frameIndex: 0, timestampMs: 0, landmarks: [] },
        { frameIndex: 1, timestampMs: 2400, landmarks: [] },
      ];
      const r = ruleT2.evaluate!(ctx);
      expect(r.atFrame).toBe(1);
      expect(r.atTimestampMs).toBe(2400);
      expect(r.landmarks).toEqual([LM.R_WRIST]);
    });
  });
});
