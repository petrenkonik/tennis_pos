import { describe, it, expect } from 'vitest';
import { buildPhaseContext } from './buildPhaseContext';
import { detectPhases } from './detectPhases';
import { buildHappyServe } from '../__tests__/fixtures/poses';
import { kneeFlexion } from '../pose/metrics';

describe('buildPhaseContext', () => {
  it('exposes kneeFlexionAtTrophyDeg taken at the trophy frame', () => {
    const poses = buildHappyServe();
    const phases = detectPhases(poses, 'right');
    const ctx = buildPhaseContext(poses, 30, phases);
    expect(ctx.metrics.kneeFlexionAtTrophyDeg)
      .toBeCloseTo(kneeFlexion(poses[phases.events.trophyFrame]), 5);
    expect(ctx.fps).toBe(30);
    expect(ctx.phases).toBe(phases);
  });
});
