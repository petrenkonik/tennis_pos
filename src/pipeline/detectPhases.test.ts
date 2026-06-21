import { describe, it, expect } from 'vitest';
import { detectPhases, ServeNotRecognizedError, visibilityBreakdown } from './detectPhases';
import { buildHappyServe, makeFrame, makeLandmarks } from '../__tests__/fixtures/poses';
import { LM } from '../pose/landmarks';

describe('detectPhases', () => {
  it('detects events and phases on a clean serve', () => {
    const r = detectPhases(buildHappyServe(), 'right');
    expect(r.events).toEqual({ trophyFrame: 2, contactFrame: 4, followStartFrame: 6 });
    expect(r.phases.preparation).toEqual([0, 2]);
    expect(r.phases.trophy).toEqual([2, 3]);
    expect(r.phases.acceleration).toEqual([3, 4]);
    expect(r.phases.followThrough).toEqual([4, 6]);
    expect(r.confidence).toBe('high');
  });

  it('falls back to a time split when trophy is not expressed', () => {
    // racket never goes above the nose (y always 0.7 > nose 0.5)
    const poses = Array.from({ length: 10 }, (_, i) =>
      makeFrame(i, makeLandmarks({ [LM.NOSE]: { y: 0.5 }, [LM.R_WRIST]: { y: 0.7 } })));
    const r = detectPhases(poses, 'right');
    expect(r.confidence).toBe('low');
    expect(r.events.trophyFrame).toBeGreaterThan(0);
    expect(r.events.trophyFrame).toBeLessThan(r.events.contactFrame + 1);
  });

  it('throws when critical landmarks are not visible on most frames', () => {
    const poses = Array.from({ length: 6 }, (_, i) =>
      makeFrame(i, makeLandmarks({ [LM.R_WRIST]: { visibility: 0 } })));
    expect(() => detectPhases(poses, 'right')).toThrow(ServeNotRecognizedError);
  });

  it('respects a loosened visibilityThreshold instead of rejecting', () => {
    // racket wrist is "uncertain" (0.4) on every frame: default 0.5 threshold rejects.
    const poses = buildHappyServe().map(f => {
      f.landmarks[LM.R_WRIST] = { ...f.landmarks[LM.R_WRIST], visibility: 0.4 };
      return f;
    });
    expect(() => detectPhases(poses, 'right')).toThrow(ServeNotRecognizedError);
    // Lowering the visibility threshold below 0.4 stops counting it as low → analyzes.
    const r = detectPhases(poses, 'right', { visibilityThreshold: 0.3 });
    expect(r.events.trophyFrame).toBeLessThan(r.events.contactFrame);
  });

  it('reports which joint is most often invisible in the rejection detail', () => {
    const poses = Array.from({ length: 6 }, (_, i) =>
      makeFrame(i, makeLandmarks({ [LM.R_KNEE]: { visibility: 0 } })));
    let caught: unknown;
    try { detectPhases(poses, 'right'); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ServeNotRecognizedError);
    const err = caught as ServeNotRecognizedError;
    expect(err.detail.code).toBe('low-visibility');
    const worst = err.detail.params.worst as Array<{ key: string; pct: number }>;
    expect(worst[0]).toEqual({ key: 'right-knee', pct: 100 });
  });

  it('visibilityBreakdown ranks the worst-visibility critical landmarks first', () => {
    const poses = [
      makeFrame(0, makeLandmarks({ [LM.R_KNEE]: { visibility: 0 }, [LM.L_WRIST]: { visibility: 0 } })),
      makeFrame(1, makeLandmarks({ [LM.R_KNEE]: { visibility: 0 } })),
    ];
    const bd = visibilityBreakdown(poses);
    expect(bd[0]).toEqual({ key: 'right-knee', lowFrac: 1 });
    expect(bd.find(b => b.key === 'left-wrist')?.lowFrac).toBe(0.5);
  });

  it('marks low confidence when follow-through is never reached', () => {
    // like the happy serve but the racket stays high after contact
    const poses = buildHappyServe().slice(0, 6); // drop f6 (the descent)
    poses[5].landmarks[LM.R_WRIST].y = 0.15;     // keep wrist high at the end
    const r = detectPhases(poses, 'right');
    expect(r.confidence).toBe('low');
    expect(r.events.followStartFrame).toBe(poses.length - 1);
  });

  it('forces minimum 1-frame gaps when phases would collapse (#14 guard)', () => {
    // Short clip where trophy/contact/followStart are at risk of collapsing.
    // The guard guarantees contact > trophy and followStart > contact whenever
    // the clip has enough frames to hold all three at distinct indices.
    const poses = buildHappyServe().slice(0, 7);
    const r = detectPhases(poses, 'right');
    expect(r.events.contactFrame).toBeGreaterThan(r.events.trophyFrame);
    expect(r.events.followStartFrame).toBeGreaterThan(r.events.contactFrame);
    // Phases as intervals must not collapse to [n, n] either.
    expect(r.phases.trophy[1]).toBeGreaterThan(r.phases.trophy[0]);
    expect(r.phases.acceleration[0]).toBeLessThan(r.phases.acceleration[1]);
  });
});
