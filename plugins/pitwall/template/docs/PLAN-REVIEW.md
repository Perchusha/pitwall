# Plan review

Written at stage 5 by the `plan-reviewer` agent, from the documents only; it is the only file the reviewer writes. The main conversation closes findings in the epics, `SPEC.md` and `RISKS.md`, and the next review round records them here. Development starts when every reason and finding is closed or accepted as a risk.

## Pre-mortem

"A year from now the project failed. Why?" As many reasons as pitwall's `preMortemReasons` asks for the process level; none at lite.

| # | Reason | Closed by (epic, ADR) or accepted risk |
| --- | --- | --- |

## Non-functional requirements

One row per item of pitwall's `planReview.nonFunctional` for the process level.

| Requirement | Answer | Where it lives |
| --- | --- | --- |

## Launch questions

One row per item of pitwall's `planReview.launch` for the process level, as the owner confirmed it in `SPEC.md`.

| Question | Answer | Confirmed on |
| --- | --- | --- |

## Epic sizing

| Epic | Size (S, M, L) | Uncertainty (known, partly, unknown) | Action |
| --- | --- | --- | --- |

An L or unknown epic has an action: split it, clarify it, or a spike first.

## Findings

Gaps in the plan: a scenario no criterion covers, a criterion QA cannot check, an epic too big for one PR, a risky assumption nothing covers.

| # | Finding | Severity | Closed by (epic, ADR) or accepted risk |
| --- | --- | --- | --- |

## Approval

Filled in by the first commit of E0's branch, from the plan's merge commit: who approved the plan, when, and the merge commit.
