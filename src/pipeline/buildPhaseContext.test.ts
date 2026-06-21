import { describe, it, expect } from 'vitest';
import { buildPhaseContext } from './buildPhaseContext';
import { detectPhases } from './detectPhases';
import { buildHappyServe, buildKneeAfterTrophyServe } from '../__tests__/fixtures/poses';
import { kneeJointAngle } from '../pose/metrics';

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
});
