import { describe, it, expect } from 'vitest';
import { estimateFps, DEFAULT_MODEL } from './extractPoses';

describe('estimateFps', () => {
  it('returns 30 for ~33ms spacing', () => {
    expect(estimateFps([0, 33.3, 66.6, 100])).toBeCloseTo(30, 0);
  });
  it('uses the median delta (robust to one gap)', () => {
    expect(estimateFps([0, 33, 66, 400, 433])).toBeCloseTo(30, 0);
  });
  it('defaults to 30 with too few samples', () => {
    expect(estimateFps([0])).toBe(30);
  });
});

describe('defaults', () => {
  it('uses the calibrated heavy model as the default (matches the UI default)', () => {
    // N2: extractPoses and the UI must agree on a single default model.
    expect(DEFAULT_MODEL).toBe('heavy');
  });
});
