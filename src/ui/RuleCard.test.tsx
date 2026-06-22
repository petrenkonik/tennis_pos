import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RuleCard } from './RuleCard';
import type { RuleResult } from '../rules/types';

// Minimal ok row (no advice) and a warn/error row with a metric + reference range.
function okRow(): RuleResult {
  return {
    ruleId: 'C3', title: 'rules.C3.title', phase: 'trophy',
    status: 'ok', confidence: 'high',
    metric: { name: 'rules.C3.metricName', value: 150, unit: '°', referenceRange: [140, 160] },
    atFrame: 2, atTimestampMs: 1000,
  };
}
function errorRow(): RuleResult {
  return {
    ruleId: 'C1', title: 'rules.C1.title', phase: 'acceleration',
    status: 'error', confidence: 'high',
    // value 0.04 is below the lower bound 0.05 → "below the norm".
    metric: { name: 'rules.C1.metricName', value: 0.04, unit: '', referenceRange: [0.05, 1] },
    advice: 'rules.C1.advice',
    atFrame: 5, atTimestampMs: 2400,
  };
}

describe('RuleCard', () => {
  it('renders the title, phase, metric value and unit', () => {
    render(<RuleCard rule={okRow()} />);
    expect(screen.getByText('Knee bend')).toBeInTheDocument();
    expect(screen.getByText(/Acceleration|Trophy/)).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText('°')).toBeInTheDocument();
  });

  it('shows the human-readable comparison line ("Yours: X — below the norm (Y)") for an off-norm metric', () => {
    render(<RuleCard rule={errorRow()} />);
    // value 0.04 is below the lower bound 0.05.
    expect(screen.getByText(/Yours: 0\.04 — below the norm \(0\.05\)/)).toBeInTheDocument();
  });

  it('shows the advice text for warn/error rows', () => {
    render(<RuleCard rule={errorRow()} />);
    // The C1 error advice copy mentions "strike with a bent arm".
    expect(screen.getByText(/strike with a bent arm/i)).toBeInTheDocument();
  });

  it('does NOT show an advice block for an ok row (nothing to fix)', () => {
    render(<RuleCard rule={okRow()} />);
    // An ok C3 row has no advice; the ok copy ("barely bent") should not appear.
    expect(screen.queryByText(/barely bent/i)).not.toBeInTheDocument();
  });

  it('shows the norm range verbatim when the metric is in range', () => {
    render(<RuleCard rule={okRow()} />);
    // value 150 (°) is within [140, 160] → "Yours: 150° — within the norm (...)".
    // The bounds are formatted with the unit; just assert the in-range phrase +
    // that both bounds appear (avoid hard-coding the en-dash glyph).
    expect(screen.getByText(/Yours: 150° — within the norm/i)).toBeInTheDocument();
    expect(screen.getByText(/140.*160/)).toBeInTheDocument();
  });
});
