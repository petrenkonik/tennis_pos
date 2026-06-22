import type { ErrorRule, Finding, RuleResult } from './types';
import {
  CONTACT_HEIGHT_ABOVE_SHOULDER_WARN, CONTACT_HEIGHT_ABOVE_SHOULDER_ERROR,
} from '../constants/biomechanics';
import { LM } from '../pose/landmarks';

// i18n keys (resolved by AdviceList / RulesReport via t()).
const TITLE_KEY = 'rules.C1.title';
const ADVICE_KEY = 'rules.C1.advice';
const METRIC_NAME_KEY = 'rules.C1.metricName';

// Reference range shown in the Layer-2 report. The "good" zone starts at WARN;
// below it the contact is increasingly low. The range's lower bound is 0
// (can't be below the shoulder's own height) — only the upper bound is normative.
const REFERENCE_RANGE: [number, number] = [CONTACT_HEIGHT_ABOVE_SHOULDER_WARN, 1];

// Single source of truth: always returns a full row (ok/warn/error/unknown).
function evaluateC1(ctx: Parameters<NonNullable<ErrorRule['evaluate']>>[0]): RuleResult {
  const h = ctx.metrics.contactHeightAboveShoulder;
  const atFrame = ctx.phases.events.contactFrame;
  const atTimestampMs = ctx.poses[atFrame]?.timestampMs;
  const base = {
    ruleId: 'C1', title: TITLE_KEY, phase: 'acceleration' as const,
    confidence: ctx.phases.confidence, atFrame, atTimestampMs,
    landmarks: [LM.R_WRIST, LM.R_ELBOW, LM.R_SHOULDER],
  };
  if (Number.isNaN(h)) return { ...base, status: 'unknown' };

  const metric = {
    name: METRIC_NAME_KEY,
    value: Math.round(h * 1000) / 1000,
    unit: '',
    referenceRange: REFERENCE_RANGE,
  };
  // Larger height = better contact. Below ERROR → error; [ERROR, WARN) → warn.
  if (h >= CONTACT_HEIGHT_ABOVE_SHOULDER_WARN) return { ...base, status: 'ok', metric };
  const status = h < CONTACT_HEIGHT_ABOVE_SHOULDER_ERROR ? 'error' : 'warn';
  return { ...base, status, advice: ADVICE_KEY, metric };
}

export const ruleC1: ErrorRule = {
  id: 'C1',
  phase: 'acceleration',
  layer: 1,
  title: TITLE_KEY,
  evaluate: evaluateC1,
  check: (ctx) => {
    const r = evaluateC1(ctx);
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
