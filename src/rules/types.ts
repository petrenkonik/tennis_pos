import type { PhaseContext, Phases, Confidence } from '../types';

export interface Finding {
  ruleId: string;
  severity: 'info' | 'warn' | 'error';
  confidence: Confidence;
  // i18n key resolved by the rendering layer (AdviceList) via t(). Never a
  // display string — rules stay locale-agnostic.
  advice: string;
  metric?: { name: string; value: number; unit: string; referenceRange?: [number, number] };
}

// Full per-rule outcome, produced for EVERY rule regardless of pass/fail —
// used to render a complete rules report (not just the problems).
export type RuleStatus = 'ok' | 'warn' | 'error' | 'unknown';

export interface RuleMetric {
  // i18n key resolved by RulesReport via t().
  name: string;
  value: number;
  unit: string;
  referenceRange?: [number, number];
}

export interface RuleResult {
  ruleId: string;
  // i18n key (e.g. "rules.C3.title") resolved by RulesReport via t().
  title: string;
  phase: keyof Phases['phases'];
  status: RuleStatus;     // ok = passed, warn/error = problem, unknown = cannot determine
  confidence: Confidence;
  // i18n key present for warn/error.
  advice?: string;
  metric?: RuleMetric;
  atFrame?: number;        // frame index the metric is measured at
  atTimestampMs?: number;  // its time in the clip — lets the UI seek the video there
}

export interface ErrorRule {
  id: string;
  phase: keyof Phases['phases'];
  layer: 1 | 2 | 3;
  // i18n key (e.g. "rules.C3.title"). Same value is reused as RuleResult.title.
  title: string;
  check: (ctx: PhaseContext) => Finding | null; // null = no error / cannot determine
  // Always-on evaluation for the rules report. Optional for back-compat;
  // when present it is the single source of truth and `check` derives from it.
  evaluate?: (ctx: PhaseContext) => RuleResult;
}
