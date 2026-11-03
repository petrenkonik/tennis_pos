import { describe, it, expect } from 'vitest';
import { pointSpeed, derivative, argmax, argmin, firstIdx } from './signals';

// 30 fps timeline helper: exact evenly spaced timestamps (like the pose
// extractor yields) so central-difference speeds come out round.
const fps30 = (i: number) => (i / 30) * 1000;

describe('pointSpeed', () => {
  it('returns zeros for a stationary point', () => {
    const pts = Array.from({ length: 6 }, () => ({ x: 0.5, y: 0.5 }));
    const speed = pointSpeed(pts, pts.map((_, i) => fps30(i)));
    expect(speed).toHaveLength(6);
    expect(speed.every(v => Math.abs(v) < 1e-9)).toBe(true);
  });

  it('reads linear motion at its true rate (units per second)', () => {
    // x advances by 0.1 per frame at 30 fps → 0.1 * 30 = 3 units/s.
    const pts = Array.from({ length: 6 }, (_, i) => ({ x: i * 0.1, y: 0.5 }));
    const speed = pointSpeed(pts, pts.map((_, i) => fps30(i)));
    for (const v of speed) expect(v).toBeCloseTo(3.0, 5);
  });

  it('uses real timestamps, not assumed frame counts', () => {
    // Same displacement over a doubled interval → half the speed.
    const pts = Array.from({ length: 5 }, (_, i) => ({ x: i * 0.1, y: 0.5 }));
    const slow = pointSpeed(pts, pts.map((_, i) => fps30(i)));
    const fastTs = pts.map((_, i) => fps30(i) / 2); // effectively 60 fps
    const fast = pointSpeed(pts, fastTs);
    expect(fast[2]).toBeCloseTo(slow[2] * 2, 5);
  });

  it('skips null slots by bridging to the nearest present neighbors', () => {
    // Frames 0..4, motion only between f1 and f3 (f2 is a track gap).
    const pts = [
      { x: 0.0, y: 0.5 },
      { x: 0.1, y: 0.5 },
      null,
      { x: 0.3, y: 0.5 },
      { x: 0.3, y: 0.5 },
    ] as ({ x: number; y: number } | null)[];
    const speed = pointSpeed(pts, [0, 33, 66, 100, 133]);
    // f2 bridges f1→f3: 0.2 over 67 ms ≈ 3 units/s; no NaN anywhere.
    expect(Number.isNaN(speed[2])).toBe(false);
    expect(speed[2]).toBeGreaterThan(2);
    expect(speed[2]).toBeLessThan(4);
  });

  it('dampens a single-frame teleport spike via the smoothing window', () => {
    const pts = [
      { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.5 },
      { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 },
    ];
    const speed = pointSpeed(pts, pts.map((_, i) => fps30(i)));
    const peak = Math.max(...speed);
    // Raw central difference for the spike would be ~6; smoothing must pull it down.
    expect(peak).toBeLessThan(6);
    expect(peak).toBeGreaterThan(0);
  });

  it('handles the empty and single-frame edge cases', () => {
    expect(pointSpeed([], [])).toEqual([]);
    expect(pointSpeed([{ x: 0, y: 0 }], [0])).toEqual([0]);
  });
});

describe('derivative', () => {
  it('reads a linear ramp at its true signed slope', () => {
    // Height rising 0.15 per frame at 30 fps → +4.5 units/s.
    const values = [0, 0.15, 0.3, 0.45, 0.6, 0.75];
    const v = derivative(values, values.map((_, i) => fps30(i)));
    for (const x of v) expect(x).toBeCloseTo(4.5, 5);
  });

  it('is signed: a falling signal reads negative', () => {
    const values = [0.75, 0.6, 0.45, 0.3, 0.15, 0];
    const v = derivative(values, values.map((_, i) => fps30(i)));
    for (const x of v) expect(x).toBeCloseTo(-4.5, 5);
  });

  it('a single-frame downward glitch never flips the smoothed trend negative', () => {
    // Steady rise of 0.1/frame with one glitch dip at f3. The detector relies
    // on exactly this property: smoothing dilutes the glitch so the trend
    // stays positive (no false "descent" readings) while real multi-frame
    // rises stay above the toss threshold.
    const values = [0, 0.1, 0.2, 0.1, 0.4, 0.5];
    const v = derivative(values, values.map((_, i) => fps30(i)));
    expect(v.every(x => x > 0)).toBe(true);
    expect(v.every(x => Number.isFinite(x))).toBe(true);
    expect(v[1]).toBeGreaterThan(2.0); // clean rise still clearly positive
  });

  it('handles short inputs without NaN', () => {
    expect(derivative([], [])).toEqual([]);
    const single = derivative([0.5], [0]);
    expect(single).toEqual([0]);
    const pair = derivative([0, 0.1], [0, 33]);
    expect(pair[0]).toBeCloseTo(0.1 / (33 / 1000), 5);
    expect(pair[1]).toBeCloseTo(0.1 / (33 / 1000), 5);
  });
});

describe('argmax / argmin', () => {
  it('finds the extreme inside [from, toExclusive)', () => {
    const v = [1, 5, 9, 3, 7];
    expect(argmax(v, 0, v.length)).toBe(2);
    expect(argmin(v, 0, v.length)).toBe(0);
  });

  it('respects the window bounds', () => {
    const v = [9, 1, 2, 8, 0];
    expect(argmax(v, 1, 4)).toBe(3); // ignores v[0]=9
    expect(argmin(v, 1, 4)).toBe(1);
    expect(argmax(v, 3, 5)).toBe(3); // v[3]=8 beats v[4]=0
  });

  it('returns the first extreme on ties', () => {
    const v = [2, 2, 2];
    expect(argmax(v, 0, 3)).toBe(0);
    expect(argmin(v, 0, 3)).toBe(0);
  });

  it('clamps degenerate inputs instead of crashing', () => {
    expect(argmax([], 0, 0)).toBe(0);
    expect(argmin([4.2], 0, 1)).toBe(0);
    expect(argmax([1, 2, 3], 5, 10)).toBe(2); // from beyond the end → clamped
  });
});

describe('firstIdx', () => {
  it('finds the first index satisfying the predicate from `from` onward', () => {
    const v = [0.1, 0.2, -0.5, -0.9];
    expect(firstIdx(v, 1, x => x < -0.35)).toBe(2);
  });

  it('returns -1 when nothing satisfies the predicate', () => {
    expect(firstIdx([0.1, 0.2], 0, x => x < -0.35)).toBe(-1);
  });

  it('starts scanning at `from` and never looks back', () => {
    const v = [-0.9, 0.1, -0.9];
    expect(firstIdx(v, 1, x => x < -0.35)).toBe(2);
  });
});
