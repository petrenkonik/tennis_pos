import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdviceList } from './AdviceList';
import type { Finding } from '../rules/types';

// Advice now carries an i18n key (not a display string); AdviceList resolves it
// via t(), so the rendered text is the catalog value for the pinned test locale.
// Severity drives which graduated copy is used (advice vs adviceMild).
const errorFinding: Finding = {
  ruleId: 'C3', severity: 'error', confidence: 'low',
  advice: 'rules.C3.advice',
};
const warnFinding: Finding = {
  ruleId: 'C3', severity: 'warn', confidence: 'low',
  advice: 'rules.C3.adviceMild',
};

describe('AdviceList', () => {
  it('renders an error finding with a low-confidence badge', () => {
    render(<AdviceList findings={[errorFinding]} />);
    // The full "advice" copy (used for error severity) mentions "knees are barely bent".
    expect(screen.getByText(/knees are barely bent/i)).toBeInTheDocument();
    expect(screen.getByText(/maybe/i)).toBeInTheDocument();
  });
  it('renders the softer adviceMild copy for a warn finding', () => {
    render(<AdviceList findings={[warnFinding]} />);
    expect(screen.getByText(/knees could bend a little more/i)).toBeInTheDocument();
  });
  it('shows an empty-state message when there are no findings', () => {
    render(<AdviceList findings={[]} />);
    expect(screen.getByText(/no errors found/i)).toBeInTheDocument();
  });
});
