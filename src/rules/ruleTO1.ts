import type { ErrorRule, Finding, RuleResult } from './types';
import { adviceKey } from './advice';
import {
  TOSS_APEX_HORIZONTAL_BEHIND_WARN, TOSS_APEX_HORIZONTAL_BEHIND_ERROR,
} from '../constants/biomechanics';
import { LM } from '../pose/landmarks';

const TITLE_KEY = 'rules.TO1.title';
const METRIC_NAME_KEY = 'rules.TO1.metricName';

const REFERENCE_RANGE: [number, number] = [-TOSS_APEX_HORIZONTAL_BEHIND_WARN, TOSS_APEX_HORIZONTAL_BEHIND_WARN];

function evaluateTO1(ctx: Parameters<NonNullable<ErrorRule['evaluate']>>[0]): RuleResult {
  const offset = ctx.metrics.tossApexHorizontalOffset;
  const facing = ctx.metrics.facingSign;
  const atFrame = ctx.metrics.tossApexFrame;
  const atTimestampMs = ctx.poses[atFrame]?.timestampMs;
  const base = {
    ruleId: 'TO1', title: TITLE_KEY, phase: 'preparation' as const,
    confidence: ctx.phases.confidence, atFrame, atTimestampMs,
    landmarks: [LM.L_WRIST, LM.L_HIP, LM.R_HIP],
  };
  if (Number.isNaN(offset) || facing === 0) return { ...base, status: 'unknown' };

  // Same projection as C2: behind = offset opposing the swing direction.
  const projected = offset * facing;
  const metric = {
    name: METRIC_NAME_KEY,
    value: Math.round(projected * 1000) / 1000,
    unit: '',
    referenceRange: REFERENCE_RANGE,
  };
  if (projected >= -TOSS_APEX_HORIZONTAL_BEHIND_WARN) return { ...base, status: 'ok', metric };
  const status = projected < -TOSS_APEX_HORIZONTAL_BEHIND_ERROR ? 'error' : 'warn';
  return { ...base, status, advice: adviceKey('TO1', status), metric };
}

export const ruleTO1: ErrorRule = {
  id: 'TO1',
  phase: 'preparation',
  layer: 1,
  title: TITLE_KEY,
  evaluate: evaluateTO1,
  check: (ctx) => {
    const r = evaluateTO1(ctx);
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
