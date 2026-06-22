import type { ErrorRule, Finding, RuleResult } from './types';
import { adviceKey } from './advice';
import { FOLLOW_THROUGH_TRAVEL_WARN, FOLLOW_THROUGH_TRAVEL_ERROR } from '../constants/biomechanics';
import { LM } from '../pose/landmarks';

const TITLE_KEY = 'rules.F1.title';
const METRIC_NAME_KEY = 'rules.F1.metricName';

// Normative range: a finished serve swings the racket across the body by at
// least WARN. The upper bound is open (travel can be long).
const REFERENCE_RANGE: [number, number] = [FOLLOW_THROUGH_TRAVEL_WARN, 1];

function evaluateF1(ctx: Parameters<NonNullable<ErrorRule['evaluate']>>[0]): RuleResult {
  const travel = ctx.metrics.followThroughHorizontalTravel;
  const atFrame = ctx.phases.events.contactFrame;
  const atTimestampMs = ctx.poses[atFrame]?.timestampMs;
  const base = {
    ruleId: 'F1', title: TITLE_KEY, phase: 'followThrough' as const,
    confidence: ctx.phases.confidence, atFrame, atTimestampMs,
    landmarks: [LM.R_WRIST],
  };
  if (Number.isNaN(travel)) return { ...base, status: 'unknown' };

  const metric = {
    name: METRIC_NAME_KEY,
    value: Math.round(travel * 1000) / 1000,
    unit: '',
    referenceRange: REFERENCE_RANGE,
  };
  if (travel >= FOLLOW_THROUGH_TRAVEL_WARN) return { ...base, status: 'ok', metric };
  const status = travel < FOLLOW_THROUGH_TRAVEL_ERROR ? 'error' : 'warn';
  return { ...base, status, advice: adviceKey('F1', status), metric };
}

export const ruleF1: ErrorRule = {
  id: 'F1',
  phase: 'followThrough',
  layer: 1,
  title: TITLE_KEY,
  evaluate: evaluateF1,
  check: (ctx) => {
    const r = evaluateF1(ctx);
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
