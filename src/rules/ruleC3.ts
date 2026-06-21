import type { ErrorRule, Finding, RuleResult } from './types';
import { KNEE_JOINT_ANGLE_NORMAL_RANGE_DEG, KNEE_JOINT_ANGLE_ERROR_MARGIN_DEG } from '../constants/biomechanics';

const ADVICE =
  'Колени согнуты слабо — ноги почти не дают энергию удару. ' +
  'Сгибайте колени глубже в позиции «трофей», чтобы вытолкнуться вверх к мячу.';

// Single source of truth: always returns a full row (ok/warn/error/unknown).
function evaluateC3(ctx: Parameters<NonNullable<ErrorRule['evaluate']>>[0]): RuleResult {
  const angle = ctx.metrics.kneeFlexionAtTrophyDeg;
  // C3 is measured at the trophy frame — expose it so the UI can seek there.
  const atFrame = ctx.phases.events.trophyFrame;
  const atTimestampMs = ctx.poses[atFrame]?.timestampMs;
  const base = {
    ruleId: 'C3', title: 'Сгиб коленей', phase: 'trophy' as const,
    confidence: ctx.phases.confidence, atFrame, atTimestampMs,
  };
  if (Number.isNaN(angle)) return { ...base, status: 'unknown' };

  const [, max] = KNEE_JOINT_ANGLE_NORMAL_RANGE_DEG;
  const metric = {
    name: 'Сгиб колена в «трофей»',
    value: Math.round(angle),
    unit: '°',
    referenceRange: KNEE_JOINT_ANGLE_NORMAL_RANGE_DEG,
  };
  // angle grows as bend shrinks (180° = straight); too straight => angle > max.
  if (angle <= max) return { ...base, status: 'ok', metric };
  const status = angle > max + KNEE_JOINT_ANGLE_ERROR_MARGIN_DEG ? 'error' : 'warn';
  return { ...base, status, advice: ADVICE, metric };
}

export const ruleC3: ErrorRule = {
  id: 'C3',
  phase: 'trophy',
  layer: 1,
  title: 'Сгиб коленей',
  evaluate: evaluateC3,
  check: (ctx) => {
    const r = evaluateC3(ctx);
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
