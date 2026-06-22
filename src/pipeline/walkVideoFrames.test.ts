import { describe, it, expect } from 'vitest';
import { frameSampleTimes, SAMPLE_STEP_SEC } from './walkVideoFrames';

describe('frameSampleTimes', () => {
  it('samples up to (but not including) the duration', () => {
    // 0.1s at 1/30s step: t=0, 0.0333, 0.0666 (0.1 is not < 0.1)
    const times = frameSampleTimes(0.1, 1 / 30);
    expect(times).toHaveLength(3);
    expect(times[0]).toBe(0);
    expect(times[2]).toBeCloseTo(2 / 30, 5);
  });

  it('uses an integer-indexed loop (no float drift over many steps)', () => {
    const times = frameSampleTimes(1, SAMPLE_STEP_SEC);
    expect(times[times.length - 1]).toBeCloseTo((times.length - 1) * SAMPLE_STEP_SEC, 10);
  });

  it('returns empty for a zero-length clip', () => {
    expect(frameSampleTimes(0, 1 / 30)).toEqual([]);
  });
});
