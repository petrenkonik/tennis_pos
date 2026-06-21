import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle } from 'lucide-react';
import type { RuleResult, RuleStatus } from '../rules/types';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

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
}: {
  rule: RuleResult;
  onSeek?: (timestampMs: number) => void;
}) {
  const { t } = useTranslation();
  const StatusIcon = STATUS_ICON[rule.status];
  const ms = rule.atTimestampMs;

  return (
    <Card className={`flex flex-col overflow-hidden p-0 ${STATUS_ACCENT[rule.status]}`}>
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
            <p className="mt-1 text-xs text-muted-foreground">
              {t('report.colNorm')}: {formatRange(rule.metric.referenceRange, rule.metric.unit)}
            </p>
          </div>
        )}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{t('report.colPhase')}:</span>
          <span className="font-medium text-foreground">{t(`phases.${rule.phase}`)}</span>
        </div>
      </CardContent>

      {ms !== undefined && (
        <CardFooter className="p-4 pt-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 -ml-2 font-mono text-primary hover:bg-primary/10"
            onClick={() => onSeek?.(ms)}
          >
            {t('report.seekSec', { n: (ms / 1000).toFixed(1) })}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
