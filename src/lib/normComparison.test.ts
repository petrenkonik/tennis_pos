import { describe, it, expect, beforeEach } from 'vitest';
import i18n from '../i18n';
import { compareMetricToNorm } from './normComparison';

// All comparisons are i18n-key + params based (like rules); resolved here via t().
// Pinned to English for assertions on the wording.
beforeEach(() => { i18n.changeLanguage('en'); });

describe('compareMetricToNorm', () => {
  it('returns "below" when the value is under the lower bound', () => {
    const r = compareMetricToNorm({ value: 0.04, referenceRange: [0.05, 1] })!;
    expect(r.direction).toBe('below');
    expect(i18n.t(r.labelKey, r.params)).toMatch(/0\.04/);
    expect(i18n.t(r.labelKey, r.params)).toMatch(/0\.05/);
  });

  it('returns "above" when the value exceeds the upper bound', () => {
    const r = compareMetricToNorm({ value: 700, referenceRange: [0, 400] })!;
    expect(r.direction).toBe('above');
  });

  it('returns "inRange" when the value lies inside the range', () => {
    const r = compareMetricToNorm({ value: 0.2, referenceRange: [0.05, 1] })!;
    expect(r.direction).toBe('inRange');
  });

  it('returns null when there is no reference range', () => {
    expect(compareMetricToNorm({ value: 0.4 })).toBeNull();
  });

  it('formats the value and bound to a readable precision (no trailing noise)', () => {
    const r = compareMetricToNorm({ value: 0.04123, referenceRange: [0.05, 1] })!;
    const text = i18n.t(r.labelKey, r.params);
    // The user-facing value is rounded cleanly; the raw 0.04123 must not leak.
    expect(text).not.toMatch(/0\.04123/);
  });

  it('respects an explicit unit in the rendered string', () => {
    const r = compareMetricToNorm({ value: 700, unit: 'ms', referenceRange: [0, 400] })!;
    const text = i18n.t(r.labelKey, r.params);
    expect(text).toMatch(/ms/);
  });

  it('handles a symmetric about-zero range (offset-style norms: [-0.03, 0.03])', () => {
    // C2/TO1 project the offset onto facing; the range is symmetric. A value of
    // -0.06 is "below" the lower bound -0.03 → below.
    const r = compareMetricToNorm({ value: -0.06, referenceRange: [-0.03, 0.03] })!;
    expect(r.direction).toBe('below');
  });
});
