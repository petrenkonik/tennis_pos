import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle } from 'lucide-react';
import type { RuleResult, RuleStatus } from '../rules/types';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { compareRuleMetric } from '../lib/normComparison';

const STATUS_ICON = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  error: XCircle,
  unknown: HelpCircle,
} as const satisfies Record<RuleStatus, typeof CheckCircle2>;

const STATUS_BADGE_VARIANT: Record<RuleStatus, BadgeProps['variant']> = {
  ok: 'success',
  warn: 'warning',
  error: 'error',
  unknown: 'unknown',
};

// Tint the card's left accent and faint background by status, so the eye can
// scan a wall of rule cards for problems without reading each one.
const STATUS_ACCENT: Record<RuleStatus, string> = {
  ok: 'border-l-success border-l-4 bg-success/[0.03]',
  warn: 'border-l-warning border-l-4 bg-warning/[0.03]',
  error: 'border-l-error border-l-4 bg-error/[0.03]',
  unknown: 'border-l-border border-l-4',
};

function formatRange(r?: [number, number], unit = ''): string {
  return r ? `${r[0]}–${r[1]}${unit}` : '—';
}

export function RuleCard({
  rule,
  onSeek,
  selected = false,
  onSelect,
  onHover,
}: {
  rule: RuleResult;
  // Kept for callers that only want seeking; onSelect is preferred and also seeks.
  onSeek?: (timestampMs: number) => void;
  selected?: boolean;
  onSelect?: (rule: RuleResult) => void;
  onHover?: (ruleId: string | null) => void;
}) {
  const { t } = useTranslation();
  const StatusIcon = STATUS_ICON[rule.status];
  const ms = rule.atTimestampMs;
  // Human-readable "Yours: X — below/above the norm (Y)" line. Null when the
  // metric has no reference range (e.g. unknown status, or a metric that is
  // intrinsically directional). Direction is also used to tint the line.
  const comparison = rule.metric ? compareRuleMetric(rule.metric) : null;

  // The whole card seeks + selects. Only rules with a timestamp are navigable.
  const seekable = ms !== undefined && (onSelect !== undefined || onSeek !== undefined);

  function activate() {
    if (!seekable) return;
    // onSelect carries both the selection (for highlighting) and the seek;
    // fall back to a plain onSeek for any caller wiring only that.
    if (onSelect) {
      onSelect(rule);
    } else if (ms !== undefined) {
      onSeek?.(ms);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!seekable) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate();
    }
  }

  return (
    <Card
      className={[
        'flex flex-col overflow-hidden p-0 transition-shadow',
        STATUS_ACCENT[rule.status],
        seekable ? 'cursor-pointer hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring' : '',
        selected ? 'ring-2 ring-primary' : '',
      ].join(' ')}
      onClick={seekable ? activate : undefined}
      onMouseEnter={() => onHover?.(rule.ruleId)}
      onMouseLeave={() => onHover?.(null)}
      role={seekable ? 'button' : undefined}
      tabIndex={seekable ? 0 : undefined}
      onKeyDown={seekable ? onKeyDown : undefined}
    >
      <CardHeader className="gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                {rule.ruleId}
              </span>
              {rule.confidence === 'low' && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {t('advice.maybe')}
                </span>
              )}
            </div>
            <h3 className="mt-0.5 text-sm font-semibold leading-tight text-card-foreground">
              {t(rule.title)}
            </h3>
          </div>
          <Badge variant={STATUS_BADGE_VARIANT[rule.status]} className="shrink-0">
            <StatusIcon className="h-3 w-3" />
            {t(`statusBadge.${rule.status}`)}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex-1 space-y-3 p-4 pt-0">
        {rule.metric && (
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold tabular-nums text-foreground">
                {rule.metric.value}
              </span>
              <span className="text-sm text-muted-foreground">{rule.metric.unit}</span>
            </div>
            <p className="text-xs text-muted-foreground">{t(rule.metric.name)}</p>
            {comparison ? (
              <p className="mt-1 text-xs font-medium text-foreground/80">
                {t(comparison.labelKey, {
                  value: comparison.params.value,
                  direction: t(comparison.params.direction),
                  norm: comparison.params.norm,
                })}
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('report.colNorm')}: {formatRange(rule.metric.referenceRange, rule.metric.unit)}
              </p>
            )}
          </div>
        )}
        {/* The advice (what's wrong + why it matters + how to fix). Only for
            problem rows; an ok/unknown card has nothing to fix. */}
        {rule.advice && (rule.status === 'warn' || rule.status === 'error') && (
          <p className="text-sm leading-snug text-card-foreground/90">
            {t(rule.advice)}
          </p>
        )}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{t('report.colPhase')}:</span>
          <span className="font-medium text-foreground">{t(`phases.${rule.phase}`)}</span>
        </div>
      </CardContent>

      {ms !== undefined && (
        <CardFooter className="p-4 pt-0">
          {/* Non-interactive affordance hint: the whole card seeks on click, so
              this is just a visual "▶ N.Ns" label, not a button (avoids a nested
              clickable that would double-fire the card's onClick). */}
          <span className="inline-flex h-8 items-center rounded-md px-2 font-mono text-primary">
            {t('report.seekSec', { n: (ms / 1000).toFixed(1) })}
          </span>
        </CardFooter>
      )}
    </Card>
  );
}
