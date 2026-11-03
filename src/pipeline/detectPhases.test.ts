import { describe, it, expect } from 'vitest';
import { detectPhases, detectTossStart, ServeNotRecognizedError, visibilityBreakdown } from './detectPhases';
import { buildHappyServe, buildNoTossServe, buildLandingCrouchServe, buildTossGateServe, buildKneeAfterTrophyServe, buildNoConfidentContactServe, makeFrame, makeLandmarks } from '../__tests__/fixtures/poses';
import { LM } from '../pose/landmarks';

describe('detectPhases', () => {
  it('detects events and phases on a clean serve', () => {
    const r = detectPhases(buildHappyServe(), 'right');
    expect(r.events).toEqual({ tossStartFrame: 1, trophyFrame: 2, contactFrame: 4, followStartFrame: 6 });
    expect(r.phases.preparation).toEqual([0, 2]);
    expect(r.phases.trophy).toEqual([2, 3]);
    expect(r.phases.acceleration).toEqual([3, 4]);
    expect(r.phases.followThrough).toEqual([4, 6]);
    expect(r.confidence).toBe('high');
    expect(r.contactSource).toBe('pose');
    expect(r.contactDiagnostic).toBeNull();
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

  it('picks the pre-contact trophy even when the deepest knee bend is after contact', () => {
    // Regression for the demo clip: deepest knee bend is the landing crouch (f5-f6),
    // which the old "deepest knee among overhead frames" rule wrongly chose.
    const r = detectPhases(buildLandingCrouchServe(), 'right');
    expect(r.events.trophyFrame).toBe(2);
    expect(r.events.contactFrame).toBe(4);
    expect(r.events.followStartFrame).toBe(6);
    expect(r.confidence).toBe('high');
  });

  it('detects contact independently of a bad trophy region (no -1 fallback)', () => {
    // Same fixture: even though the global knee minimum is post-contact, contact
    // is still found at the racket-height peak — it does not depend on trophy.
    const r = detectPhases(buildLandingCrouchServe(), 'right');
    expect(r.events.contactFrame).toBe(4);
    expect(r.events.trophyFrame).toBeLessThan(r.events.contactFrame);
  });

  it('rejects an overhead frame with the toss arm down in favour of the real trophy', () => {
    // f1 is overhead with a deeper knee but the toss arm is down; the gate must
    // pick f2 (toss arm extended up), even though f1 is more bent.
    const r = detectPhases(buildTossGateServe(), 'right');
    expect(r.events.trophyFrame).toBe(2);
    expect(r.events.contactFrame).toBe(4);
    expect(r.confidence).toBe('high');
  });

  it('anchors trophy on the toss-arm peak, not the deepest knee in the window', () => {
    // f2 is the toss-arm peak (trophy pose); f4 is overhead with a deeper knee
    // (racket-drop load). Trophy must be f2, proving the anchor is the toss peak.
    const r = detectPhases(buildKneeAfterTrophyServe(), 'right');
    expect(r.events.trophyFrame).toBe(2);
    expect(r.events.contactFrame).toBe(5);
    expect(r.confidence).toBe('high');
  });

  it('flags low confidence when no height peak has an extended elbow (degraded contact)', () => {
    const r = detectPhases(buildNoConfidentContactServe(), 'right');
    expect(r.confidence).toBe('low');                         // contact not confident
    expect(r.events.contactFrame).toBe(4);                    // global-max height fallback
    expect(r.events.trophyFrame).toBe(2);                     // still bounded before contact
    expect(r.events.trophyFrame).toBeLessThan(r.events.contactFrame);
    expect(r.events.contactFrame).toBeLessThan(r.events.followStartFrame);
    // phases must not collapse to a degenerate [n, n] interval
    expect(r.phases.acceleration[1]).toBeGreaterThan(r.phases.acceleration[0]);
  });
});

describe('detectPhases — toss start event', () => {
  it('keeps the tossStart ≤ trophy ordering invariant on every fixture', () => {
    for (const poses of [
      buildHappyServe(), buildNoTossServe(), buildLandingCrouchServe(),
      buildTossGateServe(), buildKneeAfterTrophyServe(), buildNoConfidentContactServe(),
    ]) {
      const r = detectPhases(poses, 'right');
      expect(r.events.tossStartFrame).toBeLessThanOrEqual(r.events.trophyFrame);
      expect(r.events.tossStartFrame).toBeGreaterThanOrEqual(0);
    }
  });

  it('falls back to a time split frame and low confidence when the toss never lifts', () => {
    // Toss wrist is constant → no velocity crossing → fallback round(n/3).
    // Contact/trophy/follow-through are all clean, so the toss fallback alone
    // must be what drops confidence to 'low'.
    const r = detectPhases(buildNoTossServe(), 'right');
    expect(r.events.tossStartFrame).toBe(2); // round(7/3), clamped ≤ trophy=2
    expect(r.confidence).toBe('low');
    expect(r.contactSource).toBe('pose');
    expect(r.contactDiagnostic).toBeNull();
  });

  it('reports a fallback-time contact source when trophy is not expressed', () => {
    const poses = Array.from({ length: 10 }, (_, i) =>
      makeFrame(i, makeLandmarks({ [LM.NOSE]: { y: 0.5 }, [LM.R_WRIST]: { y: 0.7 } })));
    const r = detectPhases(poses, 'right');
    expect(r.contactSource).toBe('fallback-time');
    expect(r.contactDiagnostic).toBeNull();
  });
});

describe('detectTossStart', () => {
  it('finds the first frame of a sustained toss lift (±1 frame of smoothing lag)', () => {
    // Toss wrist height rises from f1 onward (buildHappyServe: y 0.70→0.45→0.15).
    const { frame, confident } = detectTossStart(buildHappyServe(), 'right');
    expect(frame).toBe(1);
    expect(confident).toBe(true);
  });

  it('returns the fallback frame with confident=false for a flat toss arm', () => {
    const poses = Array.from({ length: 9 }, (_, i) =>
      makeFrame(i, makeLandmarks({ [LM.L_WRIST]: { y: 0.6 } })));
    const { frame, confident } = detectTossStart(poses, 'right');
    expect(frame).toBe(3); // round(9/3)
    expect(confident).toBe(false);
  });

  it('is handedness-aware: a lefty toss reads the RIGHT wrist', () => {
    // The fixture raises the LEFT wrist (the righty's toss arm) and the RIGHT
    // wrist (the racket arm). For a lefty the "toss wrist" is the RIGHT one —
    // so the detector must find THAT lift (frame 1, confident), proving it
    // switched wrists rather than re-reading the righty's toss arm.
    const { frame, confident } = detectTossStart(buildHappyServe(), 'left');
    expect(confident).toBe(true);
    expect(frame).toBe(1);
  });

  it('degrades safely on a single-frame clip', () => {
    const { frame, confident } = detectTossStart(buildHappyServe().slice(0, 1), 'right');
    expect(frame).toBe(0);
    expect(confident).toBe(false);
  });
});
