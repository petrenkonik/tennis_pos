import { describe, it, expect } from 'vitest';
import { refineContactWithTracks } from './refineContact';
import { buildHappyServe } from '../__tests__/fixtures/poses';
import type { ObjectTrack, Phases, TrackPoint } from '../types';

// --- helpers ---------------------------------------------------------------

// A minimal Phases object mirroring what detectPhases returns for
// buildHappyServe (tossStart=1, trophy=2, contact=4, followStart=6).
const basePhases: Phases = {
  handedness: 'right',
  events: { tossStartFrame: 1, trophyFrame: 2, contactFrame: 4, followStartFrame: 6 },
  phases: {
    preparation: [0, 2], trophy: [2, 3], acceleration: [3, 4], followThrough: [4, 6],
  },
  confidence: 'high',
  contactSource: 'pose',
  contactDiagnostic: null,
};

// Build an ObjectTrack from a per-frame center list (null = uncovered frame).
// Coverage = share of real detections, mirroring buildTracks' contract.
function trackFrom(centers: Array<{ x: number; y: number } | null>): ObjectTrack {
  const real = centers.filter(Boolean).length;
  return {
    points: centers.map((c, i): TrackPoint | null =>
      c
        ? {
            frameIndex: i, timestampMs: (i / 30) * 1000,
            center: c, box: { x: c.x - 0.02, y: c.y - 0.02, w: 0.04, h: 0.04 },
            score: 0.9, interpolated: false,
          }
        : null),
    coverage: centers.length > 0 ? real / centers.length : 0,
  };
}

// Ball approaching a fixed racket at (0.5, 0.15): distances shrink to f4 and
// grow again after — the closest-approach frame is f4, the pose contact frame.
const ballNearContact = trackFrom([
  { x: 0.2, y: 0.7 }, { x: 0.3, y: 0.5 }, { x: 0.4, y: 0.35 },
  { x: 0.46, y: 0.22 }, { x: 0.5, y: 0.15 }, { x: 0.62, y: 0.25 }, { x: 0.75, y: 0.4 },
]);
const racketAtContact = trackFrom([
  { x: 0.5, y: 0.55 }, { x: 0.5, y: 0.45 }, { x: 0.5, y: 0.35 },
  { x: 0.5, y: 0.24 }, { x: 0.5, y: 0.15 }, { x: 0.5, y: 0.4 }, { x: 0.5, y: 0.62 },
]);
const poses = buildHappyServe();

// --- tests -----------------------------------------------------------------

describe('refineContactWithTracks', () => {
  it('adopts the track candidate when it agrees with the wrist-speed peak', () => {
    const out = refineContactWithTracks(basePhases, poses, ballNearContact, racketAtContact);
    expect(out.contactSource).toBe('tracks');
    expect(out.contactDiagnostic).toBeNull();
    expect(out.confidence).toBe('high');
    expect(out.events.contactFrame).toBe(4);
    // phase intervals are rebuilt around the (possibly moved) contact frame
    expect(out.phases.acceleration).toEqual([3, 4]);
  });

  it('keeps the pose contact (and lowers confidence) on disagreement', () => {
    // Tracks closest-approach at f1 — far before the wrist-speed peak after the
    // toss apex (f5 on this fixture), and before the trophy: implausible.
    const earlyBall = trackFrom([
      { x: 0.5, y: 0.16 }, { x: 0.3, y: 0.3 }, { x: 0.2, y: 0.5 },
      { x: 0.2, y: 0.6 }, { x: 0.3, y: 0.7 }, { x: 0.4, y: 0.7 }, { x: 0.5, y: 0.7 },
    ]);
    const out = refineContactWithTracks(basePhases, poses, earlyBall, racketAtContact);
    expect(out.contactSource).toBe('pose');
    expect(out.contactDiagnostic).toBe('contact-track-mismatch');
    expect(out.confidence).toBe('low');
    expect(out.events.contactFrame).toBe(4); // pose timing kept
  });

  it('reports sparse tracks and leaves the phases untouched below the coverage gate', () => {
    const sparse = trackFrom([null, { x: 0.5, y: 0.2 }, null, null, null, null, null]); // 1/7 < 0.5
    const out = refineContactWithTracks(basePhases, poses, sparse, racketAtContact);
    expect(out.contactSource).toBe('pose');
    expect(out.contactDiagnostic).toBe('contact-tracks-sparse');
    expect(out.confidence).toBe('high'); // input confidence preserved
    expect(out.events).toEqual(basePhases.events);
  });

  it('reports sparse when the tracks are covered but never overlap in the window', () => {
    // Both tracks have full coverage, but the ball is null on every frame of
    // the [tossStart, contact] window → no measurable closest approach there.
    const outsideBall = trackFrom([
      { x: 0.5, y: 0.9 }, null, null, null, null, { x: 0.5, y: 0.9 }, { x: 0.5, y: 0.9 },
    ]);
    const out = refineContactWithTracks(basePhases, poses, outsideBall, racketAtContact);
    expect(out.contactDiagnostic).toBe('contact-tracks-sparse');
    expect(out.events.contactFrame).toBe(4);
  });

  it('upgrades a fallback-time phase split when the tracks are trustworthy', () => {
    const fallbackPhases: Phases = {
      ...basePhases,
      confidence: 'low',
      contactSource: 'fallback-time',
      events: { ...basePhases.events, contactFrame: 5 },
      phases: { ...basePhases.phases, acceleration: [3, 5], followThrough: [5, 6] },
    };
    const out = refineContactWithTracks(fallbackPhases, poses, ballNearContact, racketAtContact);
    expect(out.contactSource).toBe('tracks');
    expect(out.confidence).toBe('high');
    expect(out.events.contactFrame).toBe(4);
  });

  it('never moves the contact before the trophy', () => {
    // Track candidate at f1 (≤ trophy=2) must not become the contact frame even
    // if a naive min-distance scan picks it: a close ball↔racket pair during
    // the backswing is not a serve contact.
    const out = refineContactWithTracks(basePhases, poses, ballNearContact, racketAtContact);
    expect(out.events.contactFrame).toBeGreaterThan(out.events.trophyFrame);
  });
});
