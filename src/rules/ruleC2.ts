import type { ErrorRule, Finding, RuleResult } from './types';
import { adviceKey } from './advice';
import {
  CONTACT_HORIZONTAL_BEHIND_WARN, CONTACT_HORIZONTAL_BEHIND_ERROR,
} from '../constants/biomechanics';
import { LM } from '../pose/landmarks';

const TITLE_KEY = 'rules.C2.title';
const METRIC_NAME_KEY = 'rules.C2.metricName';

// Reference range shown in the Layer-2 report: |offset| up to WARN is "in line
// to slightly forward"; beyond that the contact drifts behind. Symmetric range.
const REFERENCE_RANGE: [number, number] = [-CONTACT_HORIZONTAL_BEHIND_WARN, CONTACT_HORIZONTAL_BEHIND_WARN];

// Single source of truth: always returns a full row (ok/warn/error/unknown).
function evaluateC2(ctx: Parameters<NonNullable<ErrorRule['evaluate']>>[0]): RuleResult {
  const offset = ctx.metrics.contactHorizontalOffset;
  const facing = ctx.metrics.facingSign;
  const atFrame = ctx.phases.events.contactFrame;
  const atTimestampMs = ctx.poses[atFrame]?.timestampMs;
  const base = {
    ruleId: 'C2', title: TITLE_KEY, phase: 'acceleration' as const,
    confidence: ctx.phases.confidence, atFrame, atTimestampMs,
    landmarks: [LM.R_WRIST, LM.L_HIP, LM.R_HIP],
  };
  if (Number.isNaN(offset) || facing === 0) return { ...base, status: 'unknown' };

  // The contact is "behind" when its horizontal offset opposes the swing
  // direction (facing). Project the offset onto the facing axis: a negative
  // value means behind, a positive one means in front. Magnitude decides severity.
  const projected = offset * facing;
  const metric = {
    name: METRIC_NAME_KEY,
    value: Math.round(projected * 1000) / 1000,
    unit: '',
    referenceRange: REFERENCE_RANGE,
  };
  if (projected >= -CONTACT_HORIZONTAL_BEHIND_WARN) return { ...base, status: 'ok', metric };
  // projected < -WARN → behind. Lower (more negative) → error.
  const status = projected < -CONTACT_HORIZONTAL_BEHIND_ERROR ? 'error' : 'warn';
  return { ...base, status, advice: adviceKey('C2', status), metric };
}

export const ruleC2: ErrorRule = {
  id: 'C2',
  phase: 'acceleration',
  layer: 1,
  title: TITLE_KEY,
  evaluate: evaluateC2,
  check: (ctx) => {
    const r = evaluateC2(ctx);
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
