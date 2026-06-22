import type { ErrorRule, Finding, RuleResult } from './types';
import {
  TOSS_APEX_HEIGHT_ABOVE_SHOULDER_WARN, TOSS_APEX_HEIGHT_ABOVE_SHOULDER_ERROR,
} from '../constants/biomechanics';
import { LM } from '../pose/landmarks';

const TITLE_KEY = 'rules.TO2.title';
const ADVICE_KEY = 'rules.TO2.advice';
const METRIC_NAME_KEY = 'rules.TO2.metricName';

// Normative range: a good amateur toss peaks at or above WARN. Below it the toss
// is increasingly low. The upper bound is open (tosses can be very high).
const REFERENCE_RANGE: [number, number] = [TOSS_APEX_HEIGHT_ABOVE_SHOULDER_WARN, 1];

function evaluateTO2(ctx: Parameters<NonNullable<ErrorRule['evaluate']>>[0]): RuleResult {
  const h = ctx.metrics.tossApexHeightAboveShoulder;
  const atFrame = ctx.metrics.tossApexFrame;
  const atTimestampMs = ctx.poses[atFrame]?.timestampMs;
  const base = {
    ruleId: 'TO2', title: TITLE_KEY, phase: 'preparation' as const,
    confidence: ctx.phases.confidence, atFrame, atTimestampMs,
    landmarks: [LM.L_WRIST, LM.L_SHOULDER],
  };
  if (Number.isNaN(h)) return { ...base, status: 'unknown' };

  const metric = {
    name: METRIC_NAME_KEY,
    value: Math.round(h * 1000) / 1000,
    unit: '',
    referenceRange: REFERENCE_RANGE,
  };
  if (h >= TOSS_APEX_HEIGHT_ABOVE_SHOULDER_WARN) return { ...base, status: 'ok', metric };
  const status = h < TOSS_APEX_HEIGHT_ABOVE_SHOULDER_ERROR ? 'error' : 'warn';
  return { ...base, status, advice: ADVICE_KEY, metric };
}

export const ruleTO2: ErrorRule = {
  id: 'TO2',
  phase: 'preparation',
  layer: 1,
  title: TITLE_KEY,
  evaluate: evaluateTO2,
  check: (ctx) => {
    const r = evaluateTO2(ctx);
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
