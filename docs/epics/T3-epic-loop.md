# T3 - The epic loop

Goal: `/pitwall:continue` runs an epic from clarification to a merged PR without the owner except where the process asks for them.
Depends on: T2
Risk class: high (hooks that block tools, merge protection)

## Acceptance criteria (draft, refined when T3 starts)

- [ ] T3-AC1: The conductor orients from a session brief, selects by precedence, clarifies with the owner before code and dispatches one implementer per epic by risk class.
- [ ] T3-AC2: Hooks: a session brief at start; a guard on secrets, generated folders and pushes to `main`; per-package checks after edits; tests before stopping; a call budget that warns and then stops a sub-agent.
- [ ] T3-AC3: A PARTIAL report gets a continuation with the handoff, and the work stays in the tree.
- [ ] T3-AC4: The code-reviewer runs in the local session with a fresh context and sets the `ai-review` status; a hook refuses that status from anywhere else.
- [ ] T3-AC5: Merge by risk class: low and normal merge themselves when `gate` and `ai-review` are green, high waits; on a private repository on GitHub Free a hook refuses `gh pr merge` until both are green.
