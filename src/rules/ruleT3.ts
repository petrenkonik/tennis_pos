import type { ErrorRule, Finding, RuleResult } from './types';
import { TOSS_ARM_DROP_AT_CONTACT_WARN, TOSS_ARM_DROP_AT_CONTACT_ERROR } from '../constants/biomechanics';
import { LM } from '../pose/landmarks';

const TITLE_KEY = 'rules.T3.title';
const ADVICE_KEY = 'rules.T3.advice';
const METRIC_NAME_KEY = 'rules.T3.metricName';

// Normative ratio: the toss arm should still be near its peak height at contact.
// The "good" zone is [WARN, 1.0]; below it the arm has dropped.
const REFERENCE_RANGE: [number, number] = [TOSS_ARM_DROP_AT_CONTACT_WARN, 1];

function evaluateT3(ctx: Parameters<NonNullable<ErrorRule['evaluate']>>[0]): RuleResult {
  const ratio = ctx.metrics.tossArmDropAtContact;
  const atFrame = ctx.phases.events.contactFrame;
  const atTimestampMs = ctx.poses[atFrame]?.timestampMs;
  const base = {
    ruleId: 'T3', title: TITLE_KEY, phase: 'trophy' as const,
    confidence: ctx.phases.confidence, atFrame, atTimestampMs,
    landmarks: [LM.L_WRIST],
  };
  if (Number.isNaN(ratio)) return { ...base, status: 'unknown' };

  const metric = {
    name: METRIC_NAME_KEY,
    value: Math.round(ratio * 1000) / 1000,
    unit: '',
    referenceRange: REFERENCE_RANGE,
  };
  if (ratio >= TOSS_ARM_DROP_AT_CONTACT_WARN) return { ...base, status: 'ok', metric };
  const status = ratio < TOSS_ARM_DROP_AT_CONTACT_ERROR ? 'error' : 'warn';
  return { ...base, status, advice: ADVICE_KEY, metric };
}

export const ruleT3: ErrorRule = {
  id: 'T3',
  phase: 'trophy',
  layer: 1,
  title: TITLE_KEY,
  evaluate: evaluateT3,
  check: (ctx) => {
    const r = evaluateT3(ctx);
    if (r.status !== 'warn' && r.status !== 'error') return null;
    const f: Finding = {
      ruleId: r.ruleId,
      severity: r.status,
      confidence: r.confidence,
      advice: r.advice!,
      metric: r.metric,
    };
    return f;
  },
};
