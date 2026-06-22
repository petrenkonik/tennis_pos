import type { ErrorRule, Finding, RuleResult } from './types';
import { LEAN_AT_FOLLOW_END_INFO } from '../constants/biomechanics';
import { LM } from '../pose/landmarks';

const TITLE_KEY = 'rules.F2.title';
const METRIC_NAME_KEY = 'rules.F2.metricName';
// F2 is info-only by design (see evaluateF2 note): a single hedged advice text,
// not graduated by severity — CV can't tell lean from a natural step.
const ADVICE_KEY = 'rules.F2.advice';

// Normative range: balanced means |hip − foot| x-offset up to INFO at the end
// of the serve. Above INFO we surface a soft note.
const REFERENCE_RANGE: [number, number] = [0, LEAN_AT_FOLLOW_END_INFO];

// Single source of truth.
//
// F2 is INFO-ONLY by design (serve-error-detection skill): CV cannot reliably
// distinguish a real loss of balance from a natural step into the court. We
// therefore surface it SOFTLY:
//   • evaluate() returns 'warn' to make the row visible in the rules report
//     (the report table has no 'info' tier), but the advice wording is hedged;
//   • check() returns a Finding with severity 'info' so the Layer-1 advice list
//     ranks it last (after real errors/warns) and the UI can render it softly.
function evaluateF2(ctx: Parameters<NonNullable<ErrorRule['evaluate']>>[0]): RuleResult {
  const lean = ctx.metrics.leanAtFollowEnd;
  const atFrame = ctx.poses.length - 1; // last frame of follow-through
  const atTimestampMs = atFrame >= 0 ? ctx.poses[atFrame]?.timestampMs : undefined;
  const base = {
    ruleId: 'F2', title: TITLE_KEY, phase: 'followThrough' as const,
    confidence: ctx.phases.confidence, atFrame: atFrame >= 0 ? atFrame : undefined,
    atTimestampMs, landmarks: [LM.L_HIP, LM.R_HIP, LM.L_HEEL, LM.R_HEEL],
  };
  if (Number.isNaN(lean)) return { ...base, status: 'unknown' };

  const metric = {
    name: METRIC_NAME_KEY,
    value: Math.round(lean * 1000) / 1000,
    unit: '',
    referenceRange: REFERENCE_RANGE,
  };
  if (lean <= LEAN_AT_FOLLOW_END_INFO) return { ...base, status: 'ok', metric };
  // Soft-surfaced: report row is 'warn' (no info tier in the table), but check()
  // downgrades the finding severity to 'info' so the advice list shows it last.
  return { ...base, status: 'warn', advice: ADVICE_KEY, metric };
}

export const ruleF2: ErrorRule = {
  id: 'F2',
  phase: 'followThrough',
  layer: 1,
  title: TITLE_KEY,
  evaluate: evaluateF2,
  check: (ctx) => {
    const r = evaluateF2(ctx);
    if (r.status === 'ok' || r.status === 'unknown') return null;
    const f: Finding = {
      ruleId: r.ruleId,
      severity: 'info', // INFO-ONLY by design (see evaluateF2 note).
      confidence: r.confidence,
      advice: r.advice!,
      metric: r.metric,
    };
    return f;
  },
};
