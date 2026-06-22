import { describe, it, expect } from 'vitest';
import { buildPhaseContext } from './buildPhaseContext';
import { detectPhases } from './detectPhases';
import {
  buildHappyServe, buildKneeAfterTrophyServe, buildLandingCrouchServe,
} from '../__tests__/fixtures/poses';
import { kneeJointAngle, racketWristHeight, tossWristHeight, racketShoulderHeight } from '../pose/metrics';
import { racketWrist } from '../pose/landmarks';

describe('buildPhaseContext', () => {
  it('exposes the deepest robust knee flexion over the trophy->contact window', () => {
    // buildKneeAfterTrophyServe: trophy=2, contact=5; the deepest knee in [2,5)
    // is f4 (the racket-drop load), not the trophy frame f2. The metric must be
    // f4's angle, proving it windows rather than reading a single frame.
    const poses = buildKneeAfterTrophyServe();
    const phases = detectPhases(poses, 'right');
    expect(phases.events.trophyFrame).toBe(2);
    expect(phases.events.contactFrame).toBe(5);
    const ctx = buildPhaseContext(poses, 30, phases);
    expect(ctx.metrics.kneeFlexionAtTrophyDeg).toBeCloseTo(kneeJointAngle(poses[4]), 5);
    expect(ctx.metrics.kneeFlexionAtTrophyDeg).toBeLessThan(kneeJointAngle(poses[2]));
  });

  it('passes through fps and the phases object', () => {
    const poses = buildHappyServe();
    const phases = detectPhases(poses, 'right');
    const ctx = buildPhaseContext(poses, 30, phases);
    expect(ctx.fps).toBe(30);
    expect(ctx.phases).toBe(phases);
  });

  describe('new metrics (C1, C2, TO1, TO2, T1, T2, T3, F1, F2)', () => {
    // buildLandingCrouchServe: trophy=2, contact=4, followStart=6, 7 frames total.
    // toss arm peaks at f2 (y=0.15 → tossWristH 0.85). contact f4 (wristY 0.12).
    const poses = buildLandingCrouchServe();
    const phases = detectPhases(poses, 'right');
    const ctx = buildPhaseContext(poses, 30, phases);
    const m = ctx.metrics;

    it('computes contact-frame metrics (C1, C2)', () => {
      const c = phases.events.contactFrame; // 4
      expect(m.contactHeightAboveShoulder).toBeCloseTo(
        racketWristHeight(poses[c], 'right') - racketShoulderHeight(poses[c], 'right'), 5);
      expect(m.contactHorizontalOffset).toBeCloseTo(
        racketWrist(poses[c], 'right').x - 0.5, 5); // fixture hips sit at x=0.5
    });

    it('anchors the toss apex before contact (TO1, TO2, T3 denominator)', () => {
      expect(m.tossApexFrame).toBe(2); // f2 has the tallest toss wrist
      expect(m.tossApexHeightAboveShoulder).toBeGreaterThan(0);
    });

    it('computes the toss-arm drop ratio at contact (T3)', () => {
      const apex = m.tossApexFrame;
      const c = phases.events.contactFrame;
      const expected = tossWristHeight(poses[c], 'right') / tossWristHeight(poses[apex], 'right');
      expect(m.tossArmDropAtContact).toBeCloseTo(expected, 5);
      expect(m.tossArmDropAtContact).toBeGreaterThan(0);
      expect(m.tossArmDropAtContact).toBeLessThanOrEqual(1);
    });

    it('computes the racket drop depth over [trophy, contact) (T1)', () => {
      // The fixture has racket wrist ABOVE the elbow at trophy/contact frames
      // (arm rising), so the max (elbowH − wristH) is expected to be ≤ 0 here.
      expect(Number.isNaN(m.racketDropDepth)).toBe(false);
    });

    it('computes the acceleration-phase duration in ms (T2)', () => {
      // (contact − trophy) / fps * 1000 = (4 − 2) / 30 * 1000 ≈ 66.67 ms
      expect(m.accelerationPhaseMs).toBeCloseTo(((4 - 2) / 30) * 1000, 3);
    });

    it('computes the follow-through horizontal travel of the racket wrist (F1)', () => {
      const last = poses.length - 1;
      const c = phases.events.contactFrame;
      const expected = Math.abs(racketWrist(poses[last], 'right').x - racketWrist(poses[c], 'right').x);
      expect(m.followThroughHorizontalTravel).toBeCloseTo(expected, 5);
    });

    it('computes the lean at follow-through end (F2) as a non-negative number', () => {
      expect(m.leanAtFollowEnd).toBeGreaterThanOrEqual(0);
      expect(Number.isNaN(m.leanAtFollowEnd)).toBe(false);
    });

    it('resolves a facing sign from the swing (trophy → followStart)', () => {
      // The fixture is purely vertical (all x = 0.5), so facingSign must be 0
      // (ambiguous) — the safe "do no harm" path for C2 / TO1.
      expect(m.facingSign).toBe(0);
    });
  });
});
