import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdviceList } from './AdviceList';
import type { Finding } from '../rules/types';

const finding: Finding = {
  ruleId: 'C3', severity: 'warn', confidence: 'low',
  advice: 'Сгибайте колени глубже.',
};

describe('AdviceList', () => {
  it('renders findings with a low-confidence badge', () => {
    render(<AdviceList findings={[finding]} />);
    expect(screen.getByText('Сгибайте колени глубже.')).toBeInTheDocument();
    expect(screen.getByText(/возможно/i)).toBeInTheDocument();
  });
  it('shows an empty-state message when there are no findings', () => {
    render(<AdviceList findings={[]} />);
    expect(screen.getByText(/ошибок не найдено/i)).toBeInTheDocument();
  });
});
