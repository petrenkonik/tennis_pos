import { describe, it, expect } from 'vitest';
import i18n from '../i18n';
import { ruleF2 } from './ruleF2';
import { LM } from '../pose/landmarks';
import type { PhaseContext, Confidence } from '../types';

function makeCtx(
  leanAtFollowEnd: number,
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
      followThroughHorizontalTravel: 0.2,
      leanAtFollowEnd,
      facingSign: 1,
    },
  };
}

describe('ruleF2 (loss of balance — info-only)', () => {
  it('passes (null) when the body is well balanced', () => {
    expect(ruleF2.check(makeCtx(0.05))).toBeNull();
  });
  it('passes exactly at the info boundary', () => {
    expect(ruleF2.check(makeCtx(0.10))).toBeNull();
  });
  it('surfaces a soft INFO finding (never warn/error) above the boundary', () => {
    const f = ruleF2.check(makeCtx(0.15));
    expect(f).not.toBeNull();
    expect(f!.severity).toBe('info'); // never warn/error (CV cannot tell lean from a step)
  });
  it('inherits confidence from the phases (info findings still carry confidence)', () => {
    expect(ruleF2.check(makeCtx(0.15, 'low'))?.confidence).toBe('low');
  });
  it('returns null when the metric is NaN', () => {
    expect(ruleF2.check(makeCtx(NaN))).toBeNull();
  });
  it('fills a Layer-2 metric without anatomical jargon in advice', () => {
    const f = ruleF2.check(makeCtx(0.15))!;
    expect(f.advice).toBe('rules.F2.advice');
    expect(i18n.t(f.advice)).not.toMatch(/rotation|pronation|anatom|flexion|extension/i);
  });

  describe('evaluate (full report row)', () => {
    it('reports ok when balanced', () => {
      const r = ruleF2.evaluate!(makeCtx(0.05));
      expect(r.status).toBe('ok');
      expect(r.metric?.referenceRange).toBeDefined();
    });
    it('reports a borderline status (warn) when leaning — the report table has no info tier', () => {
      // The report row uses 'warn' to surface the lean; the softness is in the
      // advice text and in check()'s 'info' severity. There is no 'info' status.
      const r = ruleF2.evaluate!(makeCtx(0.15));
      expect(r.status).toBe('warn');
      expect(r.advice).toBe('rules.F2.advice');
    });
    it('reports unknown when the lean is NaN', () => {
      const r = ruleF2.evaluate!(makeCtx(NaN));
      expect(r.status).toBe('unknown');
      expect(r.metric).toBeUndefined();
    });
    it('points at the last follow-through frame and declares hip + heel landmarks', () => {
      const ctx = makeCtx(0.05);
      ctx.poses = [
        { frameIndex: 0, timestampMs: 0, landmarks: [] },
        { frameIndex: 1, timestampMs: 1000, landmarks: [] },
        { frameIndex: 2, timestampMs: 2400, landmarks: [] }, // last frame
      ];
      const r = ruleF2.evaluate!(ctx);
      // atFrame = last frame of follow-through (the measurement instant)
      expect(r.atFrame).toBe(2);
      expect(r.atTimestampMs).toBe(2400);
      expect(r.landmarks).toEqual([LM.L_HIP, LM.R_HIP, LM.L_HEEL, LM.R_HEEL]);
    });
  });
});
