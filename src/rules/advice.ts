// Picks the right advice i18n key by severity. Each rule ships two texts:
//   • advice      — the full, "substantially off" wording (error).
//   • adviceMild  — a softer, "a little off" wording (warn).
// Graduating the wording by severity (rather than one blanket sentence) lets the
// Layer-1 feedback acknowledge how far off the measurement is — "the contact is
// a touch low" vs "the hit happens far too low" — which matches how a coach talks.
//
// F2 is the exception: it is info-only and carries a single hedged text, so its
// callers pass status 'error' here only nominally; F2 resolves its own key.
export function adviceKey(ruleId: string, status: 'warn' | 'error'): string {
  return status === 'warn' ? `rules.${ruleId}.adviceMild` : `rules.${ruleId}.advice`;
}
