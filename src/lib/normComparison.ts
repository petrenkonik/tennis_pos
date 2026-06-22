import type { RuleMetric } from '../rules/types';

export type ComparisonDirection = 'below' | 'above' | 'inRange';

export interface ComparisonInput {
  value: number;
  unit?: string;
  referenceRange?: [number, number];
}

export interface ComparisonResult {
  direction: ComparisonDirection;
  // i18n key + params for report.yoursVsNorm. The caller resolves via t().
  labelKey: string;
  params: Record<string, string>;
}

// A readable precision for the numbers shown in the comparison line. Most rule
// metrics are normalized fractions (0.04) or millisecond counts (700); 3 sig
// digits is enough for either without trailing-zero noise.
function fmt(n: number): string {
  if (Number.isNaN(n)) return '—';
  // Keep small fractions legible (0.04 not 0.0400) and round large ones (700 not 700.000).
  if (n !== 0 && Math.abs(n) < 1) return Number(n.toFixed(3)).toString();
  return Number(n.toFixed(0)).toString();
}

// Compares a metric value to its reference range and returns a machine-readable
// direction + an i18n-keyed label the UI renders as "Yours: X — below the norm (Y)".
// Returns null when there is no reference range to compare against.
export function compareMetricToNorm(input: ComparisonInput): ComparisonResult | null {
  const { value, unit = '' } = input;
  const range = input.referenceRange;
  if (!range) return null;
  const [lo, hi] = range;

  let direction: ComparisonDirection;
  // Which bound to show as "the norm": the one the value has crossed. If the
  // value is in range, show the range itself.
  let normBound: string;
  if (value < lo) {
    direction = 'below';
    normBound = fmt(lo);
  } else if (value > hi) {
    direction = 'above';
    normBound = fmt(hi);
  } else {
    direction = 'inRange';
    normBound = `${fmt(lo)}–${fmt(hi)}`;
  }

  return {
    direction,
    labelKey: 'report.yoursVsNorm',
    params: {
      value: fmt(value) + unit,
      direction: `report.dir${direction === 'inRange' ? 'InRange' : direction.charAt(0).toUpperCase() + direction.slice(1)}`,
      norm: normBound + unit,
    },
  };
}

// Convenience overload for a RuleMetric (used by RuleCard).
export function compareRuleMetric(metric: RuleMetric): ComparisonResult | null {
  return compareMetricToNorm({
    value: metric.value, unit: metric.unit, referenceRange: metric.referenceRange,
  });
}
