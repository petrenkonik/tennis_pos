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
  hovered,
  onHover,
}: {
  phases: Phases;
  selected?: PhaseKey | null;
  onSelect?: (key: PhaseKey | null) => void;
  // Hovered phase drives a temporary skeleton highlight without seeking;
  // hover wins over selection (mirrors the rule-card pattern), so sweeping
  // the cursor across blocks previews each one, then snaps back to the
  // selected phase when the cursor leaves the bar.
  hovered?: PhaseKey | null;
  onHover?: (key: PhaseKey | null) => void;
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
      // Leaving the bar clears the hover highlight so it falls back to the
      // selected phase (or none). Drag-out through the border still fires.
      onMouseLeave={onHover ? () => onHover(null) : undefined}
    >
      {PHASE_KEYS.map((key, i) => {
        const [start, end] = phases.phases[key];
        const width = `${Math.max(0, ((end - start) / last) * 100)}%`;
        const isSelected = selected === key;
        // The visual highlight previews on hover too, so the user can scrub
        // the skeleton by sweeping the cursor across blocks without committing.
        // But click-to-toggle must key off the persisted `selected` state only:
        // at click time the cursor is already over the block, so using the
        // hover-merged "active" flag would make every click look like a toggle-off.
        const isActive = (hovered ?? selected) === key;
        const isAnyActive = (hovered ?? selected) != null;
        // min-w keeps even a 1-frame phase wide enough to read and tap;
        // min-h gives a comfortable touch target when interactive.
        const className = cn(
          'relative flex items-center justify-center overflow-hidden px-1.5',
          interactive ? 'min-w-[36px] min-h-[44px] cursor-pointer' : 'min-w-[28px]',
          i > 0 ? 'border-l border-background/60' : '',
          // Active (hovered-or-selected): ring + dimmed siblings so the eye
          // lands on the phase.
          interactive && isActive
            ? 'ring-2 ring-inset ring-primary z-10 bg-foreground/10'
            : interactive && isAnyActive
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
            onMouseEnter={onHover ? () => onHover(key) : undefined}
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
