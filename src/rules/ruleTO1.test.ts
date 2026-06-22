import { describe, it, expect } from 'vitest';
import i18n from '../i18n';
import { ruleTO1 } from './ruleTO1';
import { LM } from '../pose/landmarks';
import type { PhaseContext, Confidence } from '../types';

function makeCtx(
  tossApexHorizontalOffset: number,
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
      contactHorizontalOffset: 0,
      tossApexFrame: 0,
      tossApexHeightAboveShoulder: 0.2,
      tossApexHorizontalOffset,
      tossArmDropAtContact: 0.9,
      racketDropDepth: 0.05,
      accelerationPhaseMs: 100,
      followThroughHorizontalTravel: 0.2,
      leanAtFollowEnd: 0.05,
      facingSign,
    },
  };
}

describe('ruleTO1 (toss too far back)', () => {
  it('passes when the toss apex is in front of the body', () => {
    expect(ruleTO1.check(makeCtx(0.06, 1))).toBeNull();
  });
  it('passes when the toss apex is roughly in line', () => {
    expect(ruleTO1.check(makeCtx(-0.01, 1))).toBeNull();
  });
  it('warns when the toss apex is slightly behind', () => {
    expect(ruleTO1.check(makeCtx(-0.04, 1))?.severity).toBe('warn');
  });
  it('errors when the toss apex is well behind', () => {
    expect(ruleTO1.check(makeCtx(-0.08, 1))?.severity).toBe('error');
  });
  it('respects the facing sign', () => {
    expect(ruleTO1.check(makeCtx(0.08, -1))?.severity).toBe('error');
    expect(ruleTO1.check(makeCtx(-0.08, -1))).toBeNull();
  });
  it('returns null when facingSign is 0', () => {
    expect(ruleTO1.check(makeCtx(-0.08, 0))).toBeNull();
  });
  it('inherits confidence from the phases', () => {
    expect(ruleTO1.check(makeCtx(-0.08, 1, 'low'))?.confidence).toBe('low');
  });
  it('returns null when the offset is NaN', () => {
    expect(ruleTO1.check(makeCtx(NaN, 1))).toBeNull();
  });
  it('fills a Layer-2 metric without anatomical jargon in advice', () => {
    const f = ruleTO1.check(makeCtx(-0.08, 1))!;
    expect(f.advice).toBe('rules.TO1.advice');
    expect(i18n.t(f.advice)).not.toMatch(/rotation|pronation|anatom|flexion|extension/i);
  });
  it('graduates the advice wording by severity (warn → adviceMild, error → advice)', () => {
    expect(ruleTO1.check(makeCtx(-0.04, 1))?.advice).toBe('rules.TO1.adviceMild');
    expect(ruleTO1.check(makeCtx(-0.08, 1))?.advice).toBe('rules.TO1.advice');
  });

  describe('evaluate (full report row)', () => {
    it('reports ok when in front', () => {
      const r = ruleTO1.evaluate!(makeCtx(0.06, 1));
      expect(r.status).toBe('ok');
      expect(r.metric?.referenceRange).toBeDefined();
    });
    it('reports error with advice when well behind', () => {
      const r = ruleTO1.evaluate!(makeCtx(-0.08, 1));
      expect(r.status).toBe('error');
      expect(r.advice).toBe('rules.TO1.advice');
    });
    it('reports unknown when facingSign is 0', () => {
      const r = ruleTO1.evaluate!(makeCtx(-0.08, 0));
      expect(r.status).toBe('unknown');
    });
    it('reports unknown when the offset is NaN', () => {
      const r = ruleTO1.evaluate!(makeCtx(NaN, 1));
      expect(r.status).toBe('unknown');
      expect(r.metric).toBeUndefined();
    });
    it('points at the toss apex frame and declares toss-wrist + hip landmarks', () => {
      const ctx = makeCtx(-0.08, 1);
      ctx.metrics.tossApexFrame = 2;
      ctx.poses = [
        { frameIndex: 0, timestampMs: 0, landmarks: [] },
        { frameIndex: 1, timestampMs: 1000, landmarks: [] },
        { frameIndex: 2, timestampMs: 2000, landmarks: [] },
      ];
      const r = ruleTO1.evaluate!(ctx);
      expect(r.atFrame).toBe(2);
      expect(r.atTimestampMs).toBe(2000);
      expect(r.landmarks).toEqual([LM.L_WRIST, LM.L_HIP, LM.R_HIP]);
    });
  });
});
