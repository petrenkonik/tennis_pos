# ADR-0002: Rule-based Phase Analysis (Approach A)

**Date:** 2026-06-20
**Status:** Accepted

## Context

We need to choose the architecture for evaluating serve errors. All the approaches considered share a common pipeline:

```
Video → pose estimation → phase detection → analysis → feedback
```

They differ in **how the phases are analyzed** and where the error-evaluation logic lives.

## Approaches considered

### A. Rule-based phase analysis ✅
Split the serve into phases by events detected from the pose trajectory, and evaluate errors via **heuristic rules** based on biomechanical references.

### B. ML error classifier
Same pipeline up to the phases, but evaluation is a trained model (a classifier on the vector of joint angles per phase).

### C. Hybrid — rules + LLM for explanations
Heuristics detect the facts, an LLM formulates the human-readable explanation.

## Decision

**Approach A — Rule-based phase analysis.**

## Rationale

1. **Directly matches the prototype's goal** — validate that the CV pipeline can split a serve into phases and find errors. Rules make "finding errors" transparent and verifiable.
2. **Entirely in the browser** (see ADR-0001) — no backend.
3. **Explainability** — easy to debug ("why did it say it's an error?") and explain to a recreational user.
4. **Layers 2 and 3** (precise metrics, comparison with a reference) sit naturally on a rule-based approach — they are different "views" over the same computed angles.
5. **Needs no dataset** — unlike B, we don't have to collect and label hundreds of serves with error tags.
6. **Portable to the future mobile product** — the phases/events architecture carries over without a rewrite.

## Rejected alternatives

### B. ML classifier — rejected because:
- Needs a labeled dataset of serves with error tags, which we don't have
- Less explainability — hard to answer "why is this an error"
- Requires hosting/bundling a model somewhere — contradicts "everything in the browser"
- Could be revisited once we collect a dataset (future-work)

### C. LLM explanations — rejected **for the prototype**, kept as future-work:
- Adds a server component (API calls) → contradicts ADR-0001
- Per-request cost + latency
- Risk of hallucinations in technique advice (potentially harmful to the user)
- A good idea for improving human-readable feedback at a later stage

## Consequences

### Positive
- Deterministic, explainable, easy to debug
- No data collection needed
- Fully client-side

### Negative / risks
- **Accuracy depends on pose-estimation quality** — mitigated by tolerance zones in the rules
- **Rules must be calibrated** manually against references — the first iteration will be approximate
- **Poor at catching nuances** the rules don't describe — acceptable for the prototype; Layer 2 metrics give raw data for manual assessment

### Principles that follow from this
- **Explainability over accuracy** (see `docs/task-rules.md` §5)
- Every error rule must be explainable to a recreational user without anatomy
- Avoid black boxes in the prototype

## When to revisit
- Once a dataset is collected → a move to an A+B hybrid is possible
- Once user feedback shows rule-based advice feels "templated" → a candidate for adding an LLM (C)
- Once analysis of serve series (variability) is needed — possibly ML on trends

## Related
- [ADR-0001: Technology Stack](./0001-tech-stack.md)
- [Skill: serve-error-detection](../../skills/serve-error-detection/SKILL.md)
