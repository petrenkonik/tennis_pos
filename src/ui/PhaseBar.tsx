import { useTranslation } from 'react-i18next';
import type { Phases } from '../types';

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

export function PhaseBar({ phases }: { phases: Phases }) {
  const { t } = useTranslation();
  const last = phases.phases.followThrough[1] || 1;
  return (
    <div
      className="flex h-11 w-full overflow-hidden rounded-lg border bg-card shadow-sm"
      role="img"
      aria-label={t('app.reportTitle', { n: 0 })}
    >
      {PHASE_KEYS.map((key, i) => {
        const [start, end] = phases.phases[key];
        const width = `${Math.max(0, ((end - start) / last) * 100)}%`;
        return (
          <div
            key={key}
            className={[
              'relative flex min-w-[28px] items-center justify-center overflow-hidden px-1.5',
              i > 0 ? 'border-l border-background/60' : '',
            ].join(' ')}
            style={{ width, backgroundColor: PHASE_COLOR_VAR[key] }}
          >
            <span className="truncate text-[11px] font-semibold text-foreground/70">
              {t(`phases.${key}`)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
