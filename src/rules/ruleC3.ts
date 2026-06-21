import type { ErrorRule, Finding, RuleResult } from './types';
import { KNEE_JOINT_ANGLE_NORMAL_RANGE_DEG, KNEE_JOINT_ANGLE_ERROR_MARGIN_DEG } from '../constants/biomechanics';
import { LM } from '../pose/landmarks';

// i18n keys (resolved by AdviceList / RulesReport via t()). The rule itself is
// locale-agnostic: it never carries display strings, only keys + numbers.
const TITLE_KEY = 'rules.C3.title';
const ADVICE_KEY = 'rules.C3.advice';
const METRIC_NAME_KEY = 'rules.C3.metricName';

// Single source of truth: always returns a full row (ok/warn/error/unknown).
function evaluateC3(ctx: Parameters<NonNullable<ErrorRule['evaluate']>>[0]): RuleResult {
  const angle = ctx.metrics.kneeFlexionAtTrophyDeg;
  // C3 is measured at the trophy frame — expose it so the UI can seek there.
  const atFrame = ctx.phases.events.trophyFrame;
  const atTimestampMs = ctx.poses[atFrame]?.timestampMs;
  const base = {
    ruleId: 'C3', title: TITLE_KEY, phase: 'trophy' as const,
    confidence: ctx.phases.confidence, atFrame, atTimestampMs,
    // The knee metric is the deepest robust (more-visible-leg) flexion over the
    // trophy->contact window; highlight both legs anyway — the skeleton overlay
    // paints these landmarks by the rule's status. We deliberately list the knees
    // and ankles only — NOT the hips — because the overlay highlights any bone
    // that touches a listed landmark, and including a hip would also light up
    // the torso connections (shoulder-hip, hip-hip). The shin ([knee, ankle])
    // plus the upper-leg ([hip, knee]) still light up fully because the knee is
    // listed; only the torso stays dimmed, which matches what the rule inspects.
    landmarks: [LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE],
  };
  if (Number.isNaN(angle)) return { ...base, status: 'unknown' };

  const [, max] = KNEE_JOINT_ANGLE_NORMAL_RANGE_DEG;
  const metric = {
    name: METRIC_NAME_KEY,
    value: Math.round(angle),
    unit: '°',
    referenceRange: KNEE_JOINT_ANGLE_NORMAL_RANGE_DEG,
  };
  // angle grows as bend shrinks (180° = straight); too straight => angle > max.
  if (angle <= max) return { ...base, status: 'ok', metric };
  const status = angle > max + KNEE_JOINT_ANGLE_ERROR_MARGIN_DEG ? 'error' : 'warn';
  return { ...base, status, advice: ADVICE_KEY, metric };
}

export const ruleC3: ErrorRule = {
  id: 'C3',
  phase: 'trophy',
  layer: 1,
  title: TITLE_KEY,
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
