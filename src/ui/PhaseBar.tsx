import { useTranslation } from 'react-i18next';
import type { Phases } from '../types';
import type { PhaseKey } from '../lib/phaseTime';
import { cn } from '@/lib/utils';

// Fixed serve-phase order. Segment widths are proportional to the frame span
// of each phase over the whole serve (followThrough[1] = last frame).
const PHASE_KEYS = ['preparation', 'trophy', 'acceleration', 'followThrough'] as const;

// Maps a phase key to its design-token color (defined in index.css). Phase
// colors are CSS variables so they adapt to light/dark automatically.
const PHASE_COLOR_VAR: Record<(typeof PHASE_KEYS)[number], string> = {
  preparation: 'var(--phase-preparation)',
  trophy: 'var(--phase-trophy)',
  acceleration: 'var(--phase-acceleration)',
  followThrough: 'var(--phase-follow-through)',
};

// When `onSelect` is provided the segments become buttons the user clicks to
// replay a single phase slowly. `selected` highlights the active one; clicking
// it again clears the selection (onSelect(null)). Without onSelect the bar
// renders as a static legend.
export function PhaseBar({
  phases,
  selected,
  onSelect,
}: {
  phases: Phases;
  selected?: PhaseKey | null;
  onSelect?: (key: PhaseKey | null) => void;
}) {
  const { t } = useTranslation();
  const interactive = !!onSelect;
  const last = phases.phases.followThrough[1] || 1;
  return (
    <div
      className={cn(
        'flex h-11 w-full overflow-hidden rounded-lg border bg-card shadow-sm',
        interactive && 'h-auto',
      )}
      role="group"
      aria-label={t('report.colPhase')}
    >
      {PHASE_KEYS.map((key, i) => {
        const [start, end] = phases.phases[key];
        const width = `${Math.max(0, ((end - start) / last) * 100)}%`;
        const isSelected = selected === key;
        // min-w keeps even a 1-frame phase wide enough to read and tap;
        // min-h gives a comfortable touch target when interactive.
        const className = cn(
          'relative flex items-center justify-center overflow-hidden px-1.5',
          interactive ? 'min-w-[36px] min-h-[44px] cursor-pointer' : 'min-w-[28px]',
          i > 0 ? 'border-l border-background/60' : '',
          // Selected: ring + dimmed siblings so the eye lands on the phase.
          interactive && isSelected
            ? 'ring-2 ring-inset ring-primary z-10 bg-foreground/10'
            : interactive && selected != null
              ? 'opacity-60'
              : '',
          interactive && 'transition-opacity',
        );
        const style = { width, backgroundColor: PHASE_COLOR_VAR[key] };
        const label = t(`phases.${key}`);
        if (!interactive) {
          return (
            <div key={key} className={className} style={style}>
              <span className="truncate text-[11px] font-semibold text-foreground/70">
                {label}
              </span>
            </div>
          );
        }
        return (
          <button
            key={key}
            type="button"
            className={className}
            style={style}
            aria-pressed={isSelected}
            aria-label={label}
            onClick={() => onSelect?.(isSelected ? null : key)}
          >
            <span className="truncate text-[11px] font-semibold text-foreground/70">
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
