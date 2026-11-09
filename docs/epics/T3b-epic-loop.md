# T3b - The epic loop

Goal: `/pitwall:continue` runs an epic from clarification to a merged PR without the owner except where the process asks for them.
Depends on: T3a
Risk class: high (merges by risk class, and the rules that let a merge run without the owner)
ADR: ADR-0007, ADR-0008, ADR-0010

## Acceptance criteria (draft, refined when T3b starts)

- [ ] T3b-AC1: The conductor orients from the session brief (T3a-AC2), selects by precedence, clarifies with the owner before code and dispatches one implementer per epic by risk class. The first commit of E0's branch writes the approval line of the plan's merge commit, `Plan approved by the owner, <date>, at <sha>`, with the sha of that merge commit, into the Approval section of `docs/PLAN-REVIEW.md` (ADR-0008).
- [ ] T3b-AC2: The implementers work on `epic/E<n>-<slug>` within their budget (T3a-AC5); a PARTIAL report gets a continuation with the handoff, and the work stays in the tree.
- [ ] T3b-AC3: Gate and PR: `scripts/gate --full` before the PR, no PR on a red gate; the PR lists the acceptance criteria, the ADR links and what was not done.
- [ ] T3b-AC4: The code-reviewer runs in the local session with a fresh context, under the review rule (`review.findings`, `review.maxRounds`), and sets the `ai-review` status through `review-status.mjs` (ADR-0007), which T3a-AC4 lets only it and the plan reviewer run.
- [ ] T3b-AC5: Merge by risk class through `merge.mjs` (T2): low and normal merge themselves when `gate` and `ai-review` are green and the project's owner allowed it (ADR-0010), high waits for the owner.
- [ ] T3b-AC6: The owner's choice of ADR-0010: one question at kickoff, or at the first `/pitwall:continue` of a project laid out before it, recorded in `.claude/pitwall.json`; on yes a script writes the two narrow allow rules into `.claude/settings.local.json` only when the review guard of T3a-AC4 is installed, and writes them again when the plugin's path changes.
- [ ] T3b-AC7: Skill runs: `node scripts/e2e.mjs` runs E0 and one epic of the lite system headless.
