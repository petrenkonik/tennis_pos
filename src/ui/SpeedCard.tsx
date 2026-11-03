import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { WRIST_SPEED_MS_REF_RANGE } from '../constants/proRanges';
import { cn } from '@/lib/utils';

// Layer-2 card: the peak racket-wrist speed of the swing, in physical units
// (m/s), shown against the recreational reference range.
//
// This card is deliberately explanatory (the project is educational): besides
// the number it states WHY the metric matters (hand speed is the engine of
// racket-head speed) and HOW the estimate was produced (converted through the
// height setting and the in-frame body ruler), so the user can judge how much
// to trust it. A NaN speed renders as "undetermined" — never a made-up value.
export function SpeedCard({ speedMs }: { speedMs: number }) {
  const { t } = useTranslation();
  const [from, to] = WRIST_SPEED_MS_REF_RANGE;
  const measurable = Number.isFinite(speedMs);
  const inRange = measurable && speedMs >= from && speedMs <= to;
  // ok = inside the reference band; warn = outside; unknown = not measurable.
  const status = !measurable ? 'unknown' : inRange ? 'ok' : 'warn';
  const norm = t('speedCard.rangeNorm', { from, to });

  return (
    <Card className={cn(
      status === 'warn' && 'border-amber-500/40',
      status === 'unknown' && 'opacity-80',
    )}>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t('speedCard.title')}</h3>
          <Badge variant={status === 'ok' ? 'secondary' : status === 'warn' ? 'destructive' : 'outline'}>
            {t(`statusBadge.${status}`)}
          </Badge>
        </div>
        {measurable ? (
          <p className="text-sm">
            {t('report.yoursVsNorm', {
              value: `${speedMs.toFixed(1)} ${t('speedCard.unit')}`,
              direction: inRange
                ? t('report.dirInRange')
                : speedMs < from ? t('report.dirBelow') : t('report.dirAbove'),
              norm,
            })}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t('speedCard.unknown')}</p>
        )}
        <p className="text-xs text-muted-foreground">{t('speedCard.why')}</p>
        {measurable && (
          <p className="text-xs text-muted-foreground">{t('speedCard.estimateNote')}</p>
        )}
      </CardContent>
    </Card>
  );
}
