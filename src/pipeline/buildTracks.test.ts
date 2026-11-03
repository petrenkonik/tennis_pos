import { describe, it, expect } from 'vitest';
import { buildTracks } from './buildTracks';
import { TRACK_MAX_GAP_FRAMES } from '../constants/detection';
import type { Detection, DetectionFrame } from '../types';

// A square detection centered at (cx,cy) with side s and score 0.9.
function box(cx: number, cy: number, s = 0.1, score = 0.9): Detection {
  return { box: { x: cx - s / 2, y: cy - s / 2, w: s, h: s }, score };
}
function df(i: number, ball: Detection | null, racket: Detection | null = null): DetectionFrame {
  return { frameIndex: i, timestampMs: i * 33, ball, racket };
}

describe('buildTracks', () => {
  it('linearly interpolates a single-frame interior gap', () => {
    const frames = [df(0, box(0.2, 0.2)), df(1, null), df(2, box(0.3, 0.3))];
    const { ballTrack } = buildTracks(frames);
    expect(ballTrack.points[1]?.interpolated).toBe(true);
    expect(ballTrack.points[1]?.center.x).toBeCloseTo(0.25, 5);
    expect(ballTrack.coverage).toBeCloseTo(2 / 3, 5);
  });

  it('rejects a spurious far box via gating', () => {
    const frames = [df(0, box(0.5, 0.5)), df(1, box(0.95, 0.95))];
    const { ballTrack } = buildTracks(frames);
    expect(ballTrack.points[1]).toBeNull();
    expect(ballTrack.coverage).toBeCloseTo(0.5, 5);
  });

  it('accepts a fast object spanning a 2-frame gap (time-aware gate)', () => {
    // Regression for the stale-anchor defect: the ball moves 0.35 while two
    // frames are missed. The old fixed gate (0.25) rejected it forever; the
    // time-aware gate widens the allowance by the missed frames.
    const frames = [df(0, box(0.20, 0.20)), df(1, null), df(2, null), df(3, box(0.55, 0.20))];
    const { ballTrack } = buildTracks(frames);
    expect(ballTrack.points[3]).not.toBeNull();
    expect(ballTrack.coverage).toBeCloseTo(0.5, 5);
  });

  it('still rejects a far different object after a long dropout (gate cap)', () => {
    // Even with 10 missed frames the allowance is capped at
    // TRACK_GATE_MAX_DIST_CAP (0.6); a candidate ~0.99 away is another object.
    const frames: DetectionFrame[] = [df(0, box(0.2, 0.2))];
    for (let i = 1; i <= 10; i++) frames.push(df(i, null));
    frames.push(df(11, box(0.95, 0.95)));
    const { ballTrack } = buildTracks(frames);
    expect(ballTrack.points[11]).toBeNull();
  });

  it('recovers gating after a rejection (anchor is not frozen)', () => {
    // f1 is a spurious far box; f2 is close to f0 again. The old code compared
    // f2 against the rejected f1 box and dropped it too; the fixed gate keeps
    // the anchor on the last ACCEPTED frame (f0), so f2 is accepted and the
    // 1-frame hole is gap-filled (interpolated, not a real detection).
    const frames = [df(0, box(0.5, 0.5)), df(1, box(0.95, 0.95)), df(2, box(0.52, 0.5))];
    const { ballTrack } = buildTracks(frames);
    expect(ballTrack.points[1]?.interpolated).toBe(true);
    expect(ballTrack.points[2]).not.toBeNull();
    expect(ballTrack.coverage).toBeCloseTo(2 / 3, 5);
  });

  it('drops a detection below the score threshold', () => {
    const frames = [df(0, box(0.4, 0.4, 0.1, 0.05))];
    expect(buildTracks(frames).ballTrack.points[0]).toBeNull();
  });

  it('smooths the track centers', () => {
    const frames = [df(0, box(0.30, 0.5)), df(1, box(0.40, 0.5)), df(2, box(0.30, 0.5))];
    const p = buildTracks(frames).ballTrack.points[1]!;
    expect(p.center.x).toBeCloseTo((0.30 + 0.40 + 0.30) / 3, 4); // 0.3333
  });

  it('does not fill a gap longer than TRACK_MAX_GAP_FRAMES', () => {
    const frames: DetectionFrame[] = [df(0, box(0.30, 0.30))];
    for (let i = 1; i <= TRACK_MAX_GAP_FRAMES + 1; i++) frames.push(df(i, null));
    frames.push(df(TRACK_MAX_GAP_FRAMES + 2, box(0.34, 0.30)));
    const { ballTrack } = buildTracks(frames);
    expect(ballTrack.points[1]).toBeNull();
  });

  it('tracks ball and racket independently', () => {
    const frames = [df(0, box(0.2, 0.2), box(0.7, 0.7))];
    const { ballTrack, racketTrack } = buildTracks(frames);
    expect(ballTrack.points[0]?.center.x).toBeCloseTo(0.2, 5);
    expect(racketTrack.points[0]?.center.x).toBeCloseTo(0.7, 5);
  });
});
