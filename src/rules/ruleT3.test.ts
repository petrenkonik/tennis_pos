import { describe, it, expect } from 'vitest';
import i18n from '../i18n';
import { ruleT3 } from './ruleT3';
import { LM } from '../pose/landmarks';
import type { PhaseContext, Confidence } from '../types';

function makeCtx(
  tossArmDropAtContact: number,
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
      tossArmDropAtContact,
      racketDropDepth: 0.05,
      accelerationPhaseMs: 100,
      followThroughHorizontalTravel: 0.2,
      leanAtFollowEnd: 0.05,
      facingSign: 1,
    },
  };
}

describe('ruleT3 (toss arm drops too early)', () => {
  it('passes when the toss arm is still high at contact', () => {
    expect(ruleT3.check(makeCtx(0.90))).toBeNull();
  });
  it('passes exactly at the warn boundary', () => {
    expect(ruleT3.check(makeCtx(0.85))).toBeNull();
  });
  it('warns just below the warn boundary', () => {
    expect(ruleT3.check(makeCtx(0.80))?.severity).toBe('warn');
  });
  it('errors well below the warn boundary', () => {
    expect(ruleT3.check(makeCtx(0.50))?.severity).toBe('error');
  });
  it('inherits confidence from the phases', () => {
    expect(ruleT3.check(makeCtx(0.50, 'low'))?.confidence).toBe('low');
  });
  it('returns null when the metric is NaN', () => {
    expect(ruleT3.check(makeCtx(NaN))).toBeNull();
  });
  it('fills a Layer-2 metric without anatomical jargon in advice', () => {
    const f = ruleT3.check(makeCtx(0.50))!;
    expect(f.advice).toBe('rules.T3.advice');
    expect(i18n.t(f.advice)).not.toMatch(/rotation|pronation|anatom|flexion|extension/i);
  });
  it('graduates the advice wording by severity (warn → adviceMild, error → advice)', () => {
    expect(ruleT3.check(makeCtx(0.80))?.advice).toBe('rules.T3.adviceMild');
    expect(ruleT3.check(makeCtx(0.50))?.advice).toBe('rules.T3.advice');
  });

  describe('evaluate (full report row)', () => {
    it('reports ok with the metric when the arm is still high', () => {
      const r = ruleT3.evaluate!(makeCtx(0.90));
      expect(r.status).toBe('ok');
      expect(r.metric?.value).toBeCloseTo(0.90, 5);
      expect(r.metric?.referenceRange).toBeDefined();
    });
    it('reports error with advice when the arm has collapsed', () => {
      const r = ruleT3.evaluate!(makeCtx(0.50));
      expect(r.status).toBe('error');
      expect(r.advice).toBe('rules.T3.advice');
    });
    it('reports unknown when the ratio is NaN', () => {
      const r = ruleT3.evaluate!(makeCtx(NaN));
      expect(r.status).toBe('unknown');
      expect(r.metric).toBeUndefined();
    });
    it('points at the contact frame and declares the toss-wrist landmark', () => {
      const ctx = makeCtx(0.90);
      ctx.phases.events.contactFrame = 1;
      ctx.poses = [
        { frameIndex: 0, timestampMs: 0, landmarks: [] },
        { frameIndex: 1, timestampMs: 2400, landmarks: [] },
      ];
      const r = ruleT3.evaluate!(ctx);
      expect(r.atFrame).toBe(1);
      expect(r.atTimestampMs).toBe(2400);
      expect(r.landmarks).toEqual([LM.L_WRIST]);
    });
  });
});
