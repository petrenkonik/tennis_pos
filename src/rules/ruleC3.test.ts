import { describe, it, expect } from 'vitest';
import i18n from '../i18n';
import { ruleC3 } from './ruleC3';
import { LM } from '../pose/landmarks';
import type { PhaseContext, Confidence } from '../types';

function makeCtx(kneeFlexionAtTrophyDeg: number, confidence: Confidence = 'high'): PhaseContext {
  return {
    poses: [], fps: 30,
    phases: {
      handedness: 'right',
      events: { trophyFrame: 0, contactFrame: 1, followStartFrame: 2 },
      phases: { preparation: [0, 0], trophy: [0, 1], acceleration: [1, 1], followThrough: [1, 2] },
      confidence,
    },
    metrics: {
      kneeFlexionAtTrophyDeg,
      elbowExtensionAtContactDeg: 170,
      contactHeightAboveShoulder: 0.1,
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

describe('ruleC3 (insufficient knee bend)', () => {
  it('passes (null) when bend is sufficient', () => {
    expect(ruleC3.check(makeCtx(150))).toBeNull();
  });
  it('passes exactly at the upper bound', () => {
    expect(ruleC3.check(makeCtx(160))).toBeNull();
  });
  it('warns when slightly too straight', () => {
    expect(ruleC3.check(makeCtx(165))?.severity).toBe('warn');
  });
  it('errors when far too straight', () => {
    expect(ruleC3.check(makeCtx(175))?.severity).toBe('error');
  });
  it('inherits confidence from the phases', () => {
    expect(ruleC3.check(makeCtx(175, 'low'))?.confidence).toBe('low');
  });
  it('returns null when the metric is NaN', () => {
    expect(ruleC3.check(makeCtx(NaN))).toBeNull();
  });
  it('fills a Layer-2 metric without anatomical jargon in advice', () => {
    const f = ruleC3.check(makeCtx(175))!;
    expect(f.metric?.value).toBe(175);
    // Advice is an i18n key; resolve to English and check the wording stays
    // anatomy-free (no rotation/pronation jargon) — the Layer-1 invariant.
    expect(f.advice).toBe('rules.C3.advice');
    const adviceText = i18n.t(f.advice);
    expect(adviceText).not.toMatch(/rotation|pronation|anatom/i);
  });

  describe('evaluate (full report row)', () => {
    it('reports ok with the metric when bend is sufficient', () => {
      const r = ruleC3.evaluate!(makeCtx(150));
      expect(r.status).toBe('ok');
      expect(r.metric?.value).toBe(150);
      expect(r.metric?.referenceRange).toEqual([140, 160]);
    });
    it('reports error (with advice) when far too straight', () => {
      const r = ruleC3.evaluate!(makeCtx(175));
      expect(r.status).toBe('error');
      expect(r.advice).toBeTruthy();
    });
    it('reports unknown (no metric) when the angle is NaN', () => {
      const r = ruleC3.evaluate!(makeCtx(NaN));
      expect(r.status).toBe('unknown');
      expect(r.metric).toBeUndefined();
    });
    it('points at the trophy frame and its timestamp for seeking', () => {
      const ctx = makeCtx(150);
      ctx.phases.events.trophyFrame = 1;
      ctx.poses = [
        { frameIndex: 0, timestampMs: 0, landmarks: [] },
        { frameIndex: 1, timestampMs: 2400, landmarks: [] },
      ];
      const r = ruleC3.evaluate!(ctx);
      expect(r.atFrame).toBe(1);
      expect(r.atTimestampMs).toBe(2400);
    });
    it('declares the landmarks it inspects (both legs) for highlighting', () => {
      const r = ruleC3.evaluate!(makeCtx(150));
      // Knees and ankles of both legs — what the rule is about. Hips are
      // intentionally excluded so the torso isn't highlighted (a listed hip
      // would also light the shoulder-hip / hip-hip connections).
      expect(r.landmarks).toEqual([LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE]);
    });
  });
});
