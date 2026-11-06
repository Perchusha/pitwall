# T3 - The epic loop

Goal: `/pitwall:continue` runs an epic from clarification to a merged PR without the owner except where the process asks for them.
Depends on: T2
Risk class: high (hooks that block tools, merge protection)

## Acceptance criteria (draft, refined when T3 starts)

- [ ] T3-AC1: The conductor orients from a session brief, selects by precedence, clarifies with the owner before code and dispatches one implementer per epic by risk class. The first commit of E0's branch writes `Plan approved by the owner, <date>, merge <sha>` into `docs/PLAN-REVIEW.md`, from the plan's merge commit (ADR-0008).
- [ ] T3-AC2: Hooks: a session brief at start; a guard on secrets, generated folders and pushes to `main`; per-package checks after edits; tests before stopping; a call budget that warns and then stops a sub-agent.
- [ ] T3-AC3: A PARTIAL report gets a continuation with the handoff, and the work stays in the tree.
- [ ] T3-AC4: The code-reviewer runs in the local session with a fresh context and sets the `ai-review` status through `review-status.mjs` (ADR-0007). A PreToolUse hook runs that script only when the input carries `agent_id` and `agent_type` is `pitwall:plan-reviewer` or `pitwall:code-reviewer`, refuses an `ai-review` status set any other way, and limits the plan reviewer's writes to `docs/PLAN-REVIEW.md`. The hook is tested against a recorded payload.
- [ ] T3-AC5: Merge by risk class through `merge.mjs` (T2): low and normal merge themselves when `gate` and `ai-review` are green, high waits; on a private repository on GitHub Free a hook refuses `gh pr merge` until both are green.
