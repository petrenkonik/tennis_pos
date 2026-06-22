import { describe, it, expect } from 'vitest';
import i18n from '../i18n';
import { ruleT1 } from './ruleT1';
import { LM } from '../pose/landmarks';
import type { PhaseContext, Confidence } from '../types';

function makeCtx(
  racketDropDepth: number,
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
      racketDropDepth,
      accelerationPhaseMs: 100,
      followThroughHorizontalTravel: 0.2,
      leanAtFollowEnd: 0.05,
      facingSign: 1,
    },
  };
}

describe('ruleT1 (no racket drop)', () => {
  it('passes when the racket drops well below the elbow', () => {
    expect(ruleT1.check(makeCtx(0.10))).toBeNull();
  });
  it('passes exactly at the warn boundary', () => {
    expect(ruleT1.check(makeCtx(0.03))).toBeNull();
  });
  it('warns when the drop is shallow', () => {
    expect(ruleT1.check(makeCtx(0.015))?.severity).toBe('warn');
  });
  it('errors when the wrist never drops below the elbow', () => {
    expect(ruleT1.check(makeCtx(-0.02))?.severity).toBe('error');
  });
  it('errors exactly at the error boundary (no drop at all)', () => {
    expect(ruleT1.check(makeCtx(0.0))?.severity).toBe('error');
  });
  it('inherits confidence from the phases', () => {
    expect(ruleT1.check(makeCtx(-0.02, 'low'))?.confidence).toBe('low');
  });
  it('returns null when the metric is NaN', () => {
    expect(ruleT1.check(makeCtx(NaN))).toBeNull();
  });
  it('fills a Layer-2 metric without anatomical jargon in advice', () => {
    const f = ruleT1.check(makeCtx(-0.02))!;
    expect(f.advice).toBe('rules.T1.advice');
    expect(i18n.t(f.advice)).not.toMatch(/rotation|pronation|anatom|flexion|extension/i);
  });

  describe('evaluate (full report row)', () => {
    it('reports ok with the metric when the drop is deep', () => {
      const r = ruleT1.evaluate!(makeCtx(0.10));
      expect(r.status).toBe('ok');
      expect(r.metric?.value).toBeCloseTo(0.10, 5);
      expect(r.metric?.referenceRange).toBeDefined();
    });
    it('reports error with advice when there is no drop', () => {
      const r = ruleT1.evaluate!(makeCtx(-0.02));
      expect(r.status).toBe('error');
      expect(r.advice).toBe('rules.T1.advice');
    });
    it('reports unknown when the depth is NaN', () => {
      const r = ruleT1.evaluate!(makeCtx(NaN));
      expect(r.status).toBe('unknown');
      expect(r.metric).toBeUndefined();
    });
    it('points at the trophy frame and declares racket wrist + elbow landmarks', () => {
      const ctx = makeCtx(0.10);
      ctx.phases.events.trophyFrame = 1;
      ctx.poses = [
        { frameIndex: 0, timestampMs: 0, landmarks: [] },
        { frameIndex: 1, timestampMs: 2400, landmarks: [] },
      ];
      const r = ruleT1.evaluate!(ctx);
      expect(r.atFrame).toBe(1);
      expect(r.atTimestampMs).toBe(2400);
      expect(r.landmarks).toEqual([LM.R_WRIST, LM.R_ELBOW]);
    });
  });
});
