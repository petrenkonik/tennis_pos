import { useTranslation } from 'react-i18next';
import { XCircle, AlertTriangle, Info, CheckCircle2 } from 'lucide-react';
import type { Finding } from '../rules/types';
import { cn } from '@/lib/utils';

type Severity = Finding['severity'];

const SEVERITY_ICON: Record<Severity, typeof XCircle> = {
  error: XCircle,
  warn: AlertTriangle,
  info: Info,
};

// Left accent + icon color per severity, drawn from the design tokens.
const SEVERITY_STYLE: Record<Severity, string> = {
  error: 'border-l-error [&_svg]:text-error',
  warn: 'border-l-warning [&_svg]:text-warning',
  info: 'border-l-primary [&_svg]:text-primary',
};

export function AdviceList({ findings }: { findings: Finding[] }) {
  const { t } = useTranslation();

  if (findings.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-success/30 bg-success/[0.05] p-4">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
        <p className="text-sm font-medium text-foreground">{t('advice.empty')}</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {findings.map((f, i) => {
        const Icon = SEVERITY_ICON[f.severity];
        return (
          <li
            key={i}
            className={cn(
              'flex gap-3 rounded-lg border border-l-4 bg-card p-3.5 shadow-sm',
              SEVERITY_STYLE[f.severity],
            )}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                  {f.ruleId}
                </span>
              </div>
              <p className="text-sm leading-snug text-foreground">
                {f.confidence === 'low' && (
                  <span className="italic text-muted-foreground">{t('advice.maybe')}</span>
                )}
                {t(f.advice)}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
