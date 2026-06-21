import { describe, it, expect } from 'vitest';
import { runRules, runRulesReport } from './runRules';
import type { ErrorRule, Finding } from '../rules/types';
import type { PhaseContext } from '../types';

const ctx = { phases: { confidence: 'high' } } as PhaseContext;
const rule = (id: string, sev: Finding['severity'] | null): ErrorRule => ({
  id, phase: 'trophy', layer: 1, title: id,
  check: () => sev === null ? null
    : { ruleId: id, severity: sev, confidence: 'high', advice: id },
});

describe('runRules', () => {
  it('drops null findings and sorts error→warn→info', () => {
    const out = runRules(ctx, [rule('a', 'warn'), rule('b', null), rule('c', 'error'), rule('d', 'info')]);
    expect(out.map(f => f.ruleId)).toEqual(['c', 'a', 'd']);
  });
  it('returns an empty array when nothing fires', () => {
    expect(runRules(ctx, [rule('a', null)])).toEqual([]);
  });
});

describe('runRulesReport', () => {
  it('returns one row per rule, including passing ones', () => {
    const out = runRulesReport(ctx, [rule('a', 'error'), rule('b', null)]);
    expect(out.map(r => [r.ruleId, r.status])).toEqual([['a', 'error'], ['b', 'ok']]);
  });
  it('prefers a rule\'s own evaluate when present', () => {
    const r: ErrorRule = {
      id: 'x', phase: 'trophy', layer: 1, title: 'X',
      check: () => null,
      evaluate: () => ({ ruleId: 'x', title: 'X', phase: 'trophy', status: 'unknown', confidence: 'low' }),
    };
    expect(runRulesReport(ctx, [r])[0].status).toBe('unknown');
  });
});
