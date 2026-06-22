import type { ErrorRule, Finding, RuleResult } from './types';
import { adviceKey } from './advice';
import { RACKET_DROP_DEPTH_WARN, RACKET_DROP_DEPTH_ERROR } from '../constants/biomechanics';
import { LM } from '../pose/landmarks';

const TITLE_KEY = 'rules.T1.title';
const METRIC_NAME_KEY = 'rules.T1.metricName';

// Normative range: a good racket drop has the wrist below the elbow by at least
// WARN. The upper bound is open (a deep "scratch-back" can be very deep).
const REFERENCE_RANGE: [number, number] = [RACKET_DROP_DEPTH_WARN, 1];

function evaluateT1(ctx: Parameters<NonNullable<ErrorRule['evaluate']>>[0]): RuleResult {
  const depth = ctx.metrics.racketDropDepth;
  const atFrame = ctx.phases.events.trophyFrame;
  const atTimestampMs = ctx.poses[atFrame]?.timestampMs;
  const base = {
    ruleId: 'T1', title: TITLE_KEY, phase: 'trophy' as const,
    confidence: ctx.phases.confidence, atFrame, atTimestampMs,
    landmarks: [LM.R_WRIST, LM.R_ELBOW],
  };
  if (Number.isNaN(depth)) return { ...base, status: 'unknown' };

  const metric = {
    name: METRIC_NAME_KEY,
    value: Math.round(depth * 1000) / 1000,
    unit: '',
    referenceRange: REFERENCE_RANGE,
  };
  // Larger depth = better drop. At/below ERROR → no drop → error.
  if (depth >= RACKET_DROP_DEPTH_WARN) return { ...base, status: 'ok', metric };
  const status = depth <= RACKET_DROP_DEPTH_ERROR ? 'error' : 'warn';
  return { ...base, status, advice: adviceKey('T1', status), metric };
}

export const ruleT1: ErrorRule = {
  id: 'T1',
  phase: 'trophy',
  layer: 1,
  title: TITLE_KEY,
  evaluate: evaluateT1,
  check: (ctx) => {
    const r = evaluateT1(ctx);
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
