import type { ErrorRule } from './types';
import { ruleC3 } from './ruleC3';
import { ruleC1 } from './ruleC1';
import { ruleC2 } from './ruleC2';
import { ruleTO1 } from './ruleTO1';
import { ruleTO2 } from './ruleTO2';
import { ruleT1 } from './ruleT1';
import { ruleT2 } from './ruleT2';
import { ruleT3 } from './ruleT3';
import { ruleF1 } from './ruleF1';
import { ruleF2 } from './ruleF2';

// The full set of serve error rules, in spec order (contact → toss → trophy →
// follow-through). Consumed by analyzeServe() for both the findings list and
// the rules report. Add a new rule here once its module exists.
export const ALL_RULES: ErrorRule[] = [
  ruleC3, ruleC1, ruleC2, ruleTO1, ruleTO2, ruleT1, ruleT2, ruleT3, ruleF1, ruleF2,
];
