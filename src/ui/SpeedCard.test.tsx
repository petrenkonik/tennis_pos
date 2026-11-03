import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SpeedCard } from './SpeedCard';

// English is pinned in the test setup, so the i18n templates resolve
// deterministically: "Yours: {{value}} — {{direction}} the norm ({{norm}})".

describe('SpeedCard', () => {
  it('renders an in-range speed with the reference band', () => {
    render(<SpeedCard speedMs={15} />);
    expect(screen.getByText('Peak swing speed')).toBeInTheDocument();
    expect(screen.getByText(/Yours: 15\.0 m\/s/)).toHaveTextContent('within the norm (10–25 m/s)');
    expect(screen.getByText('normal')).toBeInTheDocument();
    // Educational content is always present.
    expect(screen.getByText(/Hand speed at the top of the swing/)).toBeInTheDocument();
    expect(screen.getByText(/Estimate: converted to m\/s/)).toBeInTheDocument();
  });

  it('renders a below-range speed as borderline with the "below" direction', () => {
    render(<SpeedCard speedMs={7.2} />);
    expect(screen.getByText(/Yours: 7\.2 m\/s/)).toHaveTextContent('below the norm');
    expect(screen.getByText('borderline')).toBeInTheDocument();
  });

  it('renders an above-range speed as borderline with the "above" direction', () => {
    render(<SpeedCard speedMs={30} />);
    expect(screen.getByText(/Yours: 30\.0 m\/s/)).toHaveTextContent('above the norm');
  });

  it('renders NaN as undetermined without an estimate note', () => {
    render(<SpeedCard speedMs={NaN} />);
    expect(screen.getByText(/Not measurable on this clip/)).toBeInTheDocument();
    expect(screen.getByText('undetermined')).toBeInTheDocument();
    expect(screen.queryByText(/Estimate: converted to m\/s/)).not.toBeInTheDocument();
  });
});
