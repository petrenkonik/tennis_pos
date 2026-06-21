import type { PhaseContext, Phases, Confidence } from '../types';

export interface Finding {
  ruleId: string;
  severity: 'info' | 'warn' | 'error';
  confidence: Confidence;
  advice: string; // Layer 1: plain text, no anatomy
  metric?: { name: string; value: number; unit: string; referenceRange?: [number, number] };
}

// Full per-rule outcome, produced for EVERY rule regardless of pass/fail —
// used to render a complete rules report (not just the problems).
export type RuleStatus = 'ok' | 'warn' | 'error' | 'unknown';

export interface RuleMetric {
  name: string;
  value: number;
  unit: string;
  referenceRange?: [number, number];
}

export interface RuleResult {
  ruleId: string;
  title: string;
  phase: keyof Phases['phases'];
  status: RuleStatus;     // ok = passed, warn/error = problem, unknown = cannot determine
  confidence: Confidence;
  advice?: string;        // present for warn/error
  metric?: RuleMetric;
  atFrame?: number;        // frame index the metric is measured at
  atTimestampMs?: number;  // its time in the clip — lets the UI seek the video there
}

export interface ErrorRule {
  id: string;
  phase: keyof Phases['phases'];
  layer: 1 | 2 | 3;
  title: string;
  check: (ctx: PhaseContext) => Finding | null; // null = no error / cannot determine
  // Always-on evaluation for the rules report. Optional for back-compat;
  // when present it is the single source of truth and `check` derives from it.
  evaluate?: (ctx: PhaseContext) => RuleResult;
}
