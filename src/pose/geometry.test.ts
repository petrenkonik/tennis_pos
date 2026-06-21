import { describe, it, expect } from 'vitest';
import { jointAngle, localMaxima } from './geometry';
import type { Landmark } from '../types';

const p = (x: number, y: number): Landmark => ({ x, y, z: 0, visibility: 1 });

describe('jointAngle', () => {
  it('returns 90 for a right angle', () => {
    expect(jointAngle(p(0, 1), p(0, 0), p(1, 0))).toBeCloseTo(90, 4);
  });
  it('returns 180 for colinear points', () => {
    expect(jointAngle(p(0, 0), p(0, 1), p(0, 2))).toBeCloseTo(180, 4);
  });
  it('does not throw on coincident points', () => {
    expect(() => jointAngle(p(0, 0), p(0, 0), p(0, 0))).not.toThrow();
  });
});

describe('localMaxima', () => {
  it('finds an interior peak', () => {
    expect(localMaxima([0, 1, 2, 1, 0])).toEqual([2]);
  });
  it('filters peaks below the prominence threshold', () => {
    expect(localMaxima([0, 0.01, 0, 1, 0], 0.1)).toEqual([3]);
  });
});
