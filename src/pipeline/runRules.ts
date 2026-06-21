import type { PhaseContext } from '../types';
import type { ErrorRule, Finding, RuleResult, RuleStatus } from '../rules/types';

const ORDER: Record<Finding['severity'], number> = { error: 0, warn: 1, info: 2 };

// Fallback mapping (only for legacy rules without their own `evaluate`).
const SEV_TO_STATUS: Record<Finding['severity'], RuleStatus> = { error: 'error', warn: 'warn', info: 'warn' };

export function runRules(ctx: PhaseContext, rules: ErrorRule[]): Finding[] {
  return rules
    .map(r => r.check(ctx))
    .filter((f): f is Finding => f !== null)
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

// Full report: one row per rule (ok/warn/error/unknown), regardless of pass/fail.
// Prefers a rule's own `evaluate`; falls back to deriving a row from `check`.
export function runRulesReport(ctx: PhaseContext, rules: ErrorRule[]): RuleResult[] {
  return rules.map((r) => {
    if (r.evaluate) return r.evaluate(ctx);
    const f = r.check(ctx);
    return f
      ? { ruleId: f.ruleId, title: r.title, phase: r.phase, status: SEV_TO_STATUS[f.severity], confidence: f.confidence, advice: f.advice, metric: f.metric }
      : { ruleId: r.id, title: r.title, phase: r.phase, status: 'ok', confidence: ctx.phases.confidence };
  });
}
