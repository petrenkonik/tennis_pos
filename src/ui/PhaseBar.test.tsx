import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PhaseBar } from './PhaseBar';
import type { Phases } from '../types';

const phases: Phases = {
  handedness: 'right',
  events: { trophyFrame: 2, contactFrame: 4, followStartFrame: 6 },
  phases: { preparation: [0, 2], trophy: [2, 3], acceleration: [3, 4], followThrough: [4, 6] },
  confidence: 'high',
};

describe('PhaseBar', () => {
  it('labels all four phases', () => {
    render(<PhaseBar phases={phases} />);
    for (const label of ['Подготовка', 'Трофей', 'Разгон', 'Завершение']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
