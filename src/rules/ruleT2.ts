import type { ErrorRule, Finding, RuleResult } from './types';
import { ACCELERATION_PHASE_MS_WARN, ACCELERATION_PHASE_MS_ERROR } from '../constants/biomechanics';
import { LM } from '../pose/landmarks';

const TITLE_KEY = 'rules.T2.title';
const ADVICE_KEY = 'rules.T2.advice';
const METRIC_NAME_KEY = 'rules.T2.metricName';

// Normative range: a fluent acceleration takes at most WARN ms. The lower bound
// is 0 (a very quick swing is fine). Above ERROR it is a clear freeze.
const REFERENCE_RANGE: [number, number] = [0, ACCELERATION_PHASE_MS_WARN];

// Single source of truth. NOTE: T2 is an acknowledged WEAK PROXY — the trophy
// phase itself is ~1 frame by construction, so "too long in trophy" is
// approximated by the acceleration-phase duration (trophy → contact). The rule
// is therefore warn-capable but its confidence is FORCED to 'low' regardless of
// the phase confidence. A real "acceleration start" detector (future) would give
// T2 a proper signal; until then it stays a soft hint, not a categorical tip.
function evaluateT2(ctx: Parameters<NonNullable<ErrorRule['evaluate']>>[0]): RuleResult {
  const ms = ctx.metrics.accelerationPhaseMs;
  const atFrame = ctx.phases.events.trophyFrame;
  const atTimestampMs = ctx.poses[atFrame]?.timestampMs;
  const base = {
    ruleId: 'T2', title: TITLE_KEY, phase: 'trophy' as const,
    // Forced low: see note above.
    confidence: 'low' as const, atFrame, atTimestampMs,
    landmarks: [LM.R_WRIST],
  };
  if (Number.isNaN(ms)) return { ...base, status: 'unknown' };

  const metric = {
    name: METRIC_NAME_KEY,
    value: Math.round(ms),
    unit: 'ms',
    referenceRange: REFERENCE_RANGE,
  };
  if (ms <= ACCELERATION_PHASE_MS_WARN) return { ...base, status: 'ok', metric };
  const status = ms > ACCELERATION_PHASE_MS_ERROR ? 'error' : 'warn';
  return { ...base, status, advice: ADVICE_KEY, metric };
}

export const ruleT2: ErrorRule = {
  id: 'T2',
  phase: 'trophy',
  layer: 1,
  title: TITLE_KEY,
  evaluate: evaluateT2,
  check: (ctx) => {
    const r = evaluateT2(ctx);
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
