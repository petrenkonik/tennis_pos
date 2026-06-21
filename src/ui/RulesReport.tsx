import type { RuleResult } from '../rules/types';
import { RuleCard } from './RuleCard';

/**
 * Rules report — renders each rule as a card in a responsive grid.
 * One column on mobile, two on small tablets/desktop, three on wide screens.
 *
 * Selecting a card (click) seeks the video to its measurement moment and keeps
 * its bones highlighted on the skeleton; hovering a card highlights them
 * temporarily without seeking. `onHover(null)` clears the hover highlight.
 */
export function RulesReport({
  results,
  onSeek,
  selectedRuleId,
  onSelect,
  onHover,
}: {
  results: RuleResult[];
  onSeek?: (timestampMs: number) => void;
  selectedRuleId?: string | null;
  onSelect?: (rule: RuleResult) => void;
  onHover?: (ruleId: string | null) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {results.map((r) => (
        <RuleCard
          key={r.ruleId}
          rule={r}
          onSeek={onSeek}
          selected={r.ruleId === selectedRuleId}
          onSelect={onSelect}
          onHover={onHover}
        />
      ))}
    </div>
  );
}
