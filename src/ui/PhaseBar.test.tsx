import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
    for (const label of ['Preparation', 'Trophy', 'Acceleration', 'Follow-through']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('renders a button per phase when onSelect is provided', () => {
    render(<PhaseBar phases={phases} onSelect={() => {}} />);
    // role="button" elements, one per phase
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
  });

  it('calls onSelect with the clicked phase key', () => {
    const onSelect = vi.fn();
    render(<PhaseBar phases={phases} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Trophy'));
    expect(onSelect).toHaveBeenCalledWith('trophy');
  });

  it('toggles to null when the already-selected phase is clicked again', () => {
    const onSelect = vi.fn();
    render(<PhaseBar phases={phases} selected="trophy" onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Trophy'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('marks the selected phase as pressed for screen readers', () => {
    render(<PhaseBar phases={phases} selected="acceleration" onSelect={() => {}} />);
    const accel = screen.getByText('Acceleration').closest('button')!;
    expect(accel).toHaveAttribute('aria-pressed', 'true');
    // others are not pressed
    const prep = screen.getByText('Preparation').closest('button')!;
    expect(prep).toHaveAttribute('aria-pressed', 'false');
  });
});
