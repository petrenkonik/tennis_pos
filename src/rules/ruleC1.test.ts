import { describe, it, expect } from 'vitest';
import i18n from '../i18n';
import { ruleC1 } from './ruleC1';
import { LM } from '../pose/landmarks';
import type { PhaseContext, Confidence } from '../types';

// Build a minimal ctx varying only the C1 metric (contact height above the
// racket shoulder at the contact frame). All other metrics are filled with
// plausible values so the object typechecks; C1 only reads its own field.
function makeCtx(
  contactHeightAboveShoulder: number,
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
      contactHeightAboveShoulder,
      contactHorizontalOffset: 0,
      tossApexFrame: 0,
      tossApexHeightAboveShoulder: 0.2,
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

describe('ruleC1 (contact too low)', () => {
  it('passes (null) when the contact is high enough', () => {
    expect(ruleC1.check(makeCtx(0.10))).toBeNull();
  });
  it('passes exactly at the warn boundary', () => {
    expect(ruleC1.check(makeCtx(0.05))).toBeNull();
  });
  it('warns just below the warn boundary', () => {
    expect(ruleC1.check(makeCtx(0.035))?.severity).toBe('warn');
  });
  it('errors well below the warn boundary', () => {
    expect(ruleC1.check(makeCtx(0.005))?.severity).toBe('error');
  });
  it('inherits confidence from the phases', () => {
    expect(ruleC1.check(makeCtx(0.005, 'low'))?.confidence).toBe('low');
  });
  it('returns null when the metric is NaN', () => {
    expect(ruleC1.check(makeCtx(NaN))).toBeNull();
  });
  it('fills a Layer-2 metric without anatomical jargon in advice', () => {
    const f = ruleC1.check(makeCtx(0.005))!;
    expect(f.advice).toBe('rules.C1.advice');
    expect(i18n.t(f.advice)).not.toMatch(/rotation|pronation|anatom|flexion|extension/i);
  });

  describe('evaluate (full report row)', () => {
    it('reports ok with the metric when the contact is high enough', () => {
      const r = ruleC1.evaluate!(makeCtx(0.10));
      expect(r.status).toBe('ok');
      expect(r.metric?.value).toBeCloseTo(0.10, 5);
      expect(r.metric?.referenceRange).toBeDefined();
    });
    it('reports error (with advice) when the contact is far too low', () => {
      const r = ruleC1.evaluate!(makeCtx(0.005));
      expect(r.status).toBe('error');
      expect(r.advice).toBe('rules.C1.advice');
    });
    it('reports unknown (no metric) when the height is NaN', () => {
      const r = ruleC1.evaluate!(makeCtx(NaN));
      expect(r.status).toBe('unknown');
      expect(r.metric).toBeUndefined();
    });
    it('points at the contact frame for seeking', () => {
      const ctx = makeCtx(0.10);
      ctx.phases.events.contactFrame = 1;
      ctx.poses = [
        { frameIndex: 0, timestampMs: 0, landmarks: [] },
        { frameIndex: 1, timestampMs: 2400, landmarks: [] },
      ];
      const r = ruleC1.evaluate!(ctx);
      expect(r.atFrame).toBe(1);
      expect(r.atTimestampMs).toBe(2400);
    });
    it('declares the racket-arm landmarks it inspects for highlighting', () => {
      const r = ruleC1.evaluate!(makeCtx(0.10));
      expect(r.landmarks).toEqual([LM.R_WRIST, LM.R_ELBOW, LM.R_SHOULDER]);
    });
  });
});
