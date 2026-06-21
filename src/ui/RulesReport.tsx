import type { RuleResult } from '../rules/types';
import { RuleCard } from './RuleCard';

/**
 * Rules report — renders each rule as a card in a responsive grid.
 * One column on mobile, two on small tablets/desktop, three on wide screens.
 */
export function RulesReport({
  results,
  onSeek,
}: {
  results: RuleResult[];
  onSeek?: (timestampMs: number) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {results.map((r) => (
        <RuleCard key={r.ruleId} rule={r} onSeek={onSeek} />
      ))}
    </div>
  );
}
