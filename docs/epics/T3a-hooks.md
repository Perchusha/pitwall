# T3a - Hooks

Goal: the rules the agents keep by prompt alone so far are kept by hooks: the session starts oriented, secrets and `main` are guarded, only the reviewers set `ai-review`, budgets end, and code is checked after edits and before stopping.
Depends on: T2
Risk class: high (hooks that block tools in every pitwall project, the review and merge guards)
ADR: ADR-0002, ADR-0004, ADR-0005, ADR-0007, ADR-0010

## Acceptance criteria

- [ ] T3a-AC1: Packaging. `plugins/pitwall/hooks/hooks.json` registers the hooks, and each runs a Node script of the plugin (ADR-0004). Outside a pitwall project, a folder without `.claude/pitwall.json` at its root, every hook exits 0 and prints nothing. A guard that cannot read its input, the project's settings or the config refuses the call and says why; the session brief, the warnings and the checks fail open and say so.
- [ ] T3a-AC2: Session brief. At session start, resume, clear and compaction the hook adds a brief within `hooks.briefMaxChars` to the context: the process level, the merge protection mode, the branch and whether the tree is clean, the current stage or epic from `docs/EPICS.md` with its unchecked criteria, and a template version older than the plugin's.
- [ ] T3a-AC3: Guards. A PreToolUse hook refuses reading or writing a secret file (the patterns in `hooks.secrets`), writing a known key format into any file, writing a file git ignores, and a `git push` that would change `main` (a push to it, a forced push, a deletion, `--mirror` or `--all`), except the first push of the skeleton while `main` holds one commit.
- [ ] T3a-AC4: Review guard (ADR-0007). A PreToolUse hook runs `review-status.mjs` only when the input carries `agent_id` and `agent_type` is `pitwall:plan-reviewer` or `pitwall:code-reviewer`, and refuses a commit status written any other way. The plan reviewer may write only `docs/PLAN-REVIEW.md` and run only the docs check and `review-status.mjs`, one command at a time, from the plugin's own scripts.
- [ ] T3a-AC5: Call budget. Calls are counted per sub-agent by `agent_id` and per session for the main conversation. At `warn` the agent is told once to wrap up and return PARTIAL with a handoff; at `stop` every further call is refused with the reason. The budget comes from `budgets.researcherToolCalls` for the project's level for `pitwall:researcher`, `budgets.subagentToolCalls` for other sub-agents and `budgets.sessionToolCalls` for the main conversation.
- [ ] T3a-AC6: Checks. On an `epic/*` branch, an edit to a file outside `docs/` runs `scripts/gate --fast` and reports a failure to the agent without blocking. When the main conversation or an implementer stops after such an edit, `scripts/gate --changed` runs once, and a red gate blocks the stop with its output, at most `hooks.stopRetries` times; after that the agent stops and reports PARTIAL. A stop with no edit since the last green run runs nothing.
- [ ] T3a-AC7: Merge guard (ADR-0002, ADR-0005). In the mode `local-hook` a PreToolUse hook refuses `gh pr merge` and the API's merge endpoint unless the PR's head has `gate` green from GitHub Actions in its latest run and `ai-review` green; in the mode `pending` it refuses them always. A failed read refuses.
- [ ] T3a-AC8: Tests. `scripts/check.mjs` runs every hook on payloads recorded from Claude Code (the version in `.claude-code-version`): the main conversation, the plan reviewer, a researcher, a sub-agent of another plugin and a project agent named `plan-reviewer`, for each event the hooks take, and checks each decision, the no-op outside a pitwall project and the fail-closed paths. `node scripts/e2e.mjs --hooks` runs a headless session with the plugin in a throwaway pitwall project and checks in its transcript that the guards fired; like the other skill runs it is not part of CI.

## Decisions

One-way, asked one at a time (2026-11-09): merges without the owner are each project's owner's choice, with the rules written only when this epic's review guard is installed, and pitwall's own repository says no for now (ADR-0010); T3 is split into T3a, the hooks, and T3b, the epic loop, both high risk, and the owner merges both PRs.

## Out of scope

- The conductor, the implementers, the code reviewer, merges by risk class and the allow rules of ADR-0010 (T3b).
- What the code reviewer may write: T3b adds it to the guard of T3a-AC4.

## Open questions

- The two-way list for this epic, for the owner to accept.
