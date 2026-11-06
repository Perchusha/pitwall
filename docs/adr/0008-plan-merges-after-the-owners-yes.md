# ADR-0008: The plan PR merges with a merge commit after the owner's yes

- Status: accepted
- Date: 2026-11-06
- Class: one-way
- Decided by: owner

## Context

The plan PR from the planning branch is the first PR of a project, and every later PR follows the plan it brings. ADR-0005 protects `main` with admins included, so the PR can merge only when `gate` and `ai-review` are green. Open: who merges it, with which merge method, and how the owner's approval of the plan is recorded. A merge cannot be taken back.

## Options

| Option | Pros | Cons | Maturity | Cost | Lock-in |
| --- | --- | --- | --- | --- | --- |
| The plan skill merges after the owner says yes | The owner makes the largest call of the project in one answer; the agent does the mechanics | One more question at the end of stage 5 | Same tools as the rest of the flow | None | Low |
| The owner merges by hand | The most explicit control | One more manual step; the epic loop must start from a plan that may not be merged yet | Standard | None | None |
| It merges itself once both checks are green, like a normal-risk epic | No extra question | The plan that defines every other PR reaches `main` without the owner's final yes | Same as SPEC 6 step 7 | None | Low |

## Decision

- `/pitwall:plan` merges the plan PR once `gate` and `ai-review` are green and the owner says yes to one summary: the epics, the accepted risks and the reviewer's verdict (owner, 2026-11-06).
- It merges with a merge commit, so `main` keeps one commit per stage, among them the spike criterion committed before the prototype (owner, 2026-11-06). Before merging, `scripts/merge.mjs` checks that the repository allows merge commits and that neither branch protection nor a ruleset requires linear history; `protect.mjs` sets `required_linear_history: false` when it protects `main`. When it may not merge, it hands the owner a ready command (L-5, L-6).
- The approval is recorded in the merge commit message only: `Plan approved by the owner, <date>, at <sha>`, where the sha is the reviewed head (owner, 2026-11-06). The sha of the merge commit is not known before the merge, and `docs/PLAN-REVIEW.md` sits on protected `main` after it, so the first commit of E0's branch writes the same line, with the merge commit's sha, into `docs/PLAN-REVIEW.md` (T3), the way pitwall records a merged epic in the next branch.

## Consequences

- Until E0 starts, the approval lives only in git history.
- A repository that allows only squash or rebase merges cannot take the plan as is: `merge.mjs` says so, and the owner changes the setting or merges by hand.
- Epic merges by risk class (T3-AC5) build on `merge.mjs` and decide their own merge method.
- Revisiting costs the last step of the plan skill and one script.
