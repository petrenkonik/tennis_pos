import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdviceList } from './AdviceList';
import type { Finding } from '../rules/types';

// Advice now carries an i18n key (not a display string); AdviceList resolves it
// via t(), so the rendered text is the catalog value for the pinned test locale.
const finding: Finding = {
  ruleId: 'C3', severity: 'warn', confidence: 'low',
  advice: 'rules.C3.advice',
};

describe('AdviceList', () => {
  it('renders findings with a low-confidence badge', () => {
    render(<AdviceList findings={[finding]} />);
    // C3 advice mentions knee bend; assert a stable fragment of the English copy.
    expect(screen.getByText(/knees are barely bent/i)).toBeInTheDocument();
    expect(screen.getByText(/maybe/i)).toBeInTheDocument();
  });
  it('shows an empty-state message when there are no findings', () => {
    render(<AdviceList findings={[]} />);
    expect(screen.getByText(/no errors found/i)).toBeInTheDocument();
  });
});
