# ADR-0007: The reviewer sets `ai-review` through one plugin script

- Status: accepted
- Date: 2026-11-06
- Class: one-way
- Decided by: owner

## Context

ADR-0002 makes the review verdict the commit status `ai-review`, set from the owner's account. T1 decided that the plan PR gets its status from the plan reviewer, and T3 that the code-reviewer sets it and a hook refuses it from anywhere else (T3a-AC4). Any session with the owner's token can set a status, so the mechanism decides what the T3a hook can guard. T2 builds it for the plan PR, and T3b reuses it.

## Options

| Option | Pros | Cons | Maturity | Cost | Lock-in |
| --- | --- | --- | --- | --- | --- |
| A plugin script the reviewer runs | The rule "every finding closed" is code, tested against a fake `gh` like `protect.mjs`; the hook has one command to allow; the same script serves both reviewers | One more script to keep | Same pattern as `protect.mjs` (T1) | None | Low: one script |
| The reviewer calls `gh api .../statuses` as its prompt says | No new code | The rule lives only in a prompt; nothing tests it; the hook must parse arbitrary `gh` commands | - | None | None |
| The main conversation sets it from the reviewer's report | The reviewer needs no Bash | The author of the plan sets the verdict on it, against the T1 decision and T3a-AC4 | - | None | None |

## Decision

- `scripts/review-status.mjs` is the only way pitwall sets `ai-review`, and only a reviewer runs it (owner, 2026-11-06). It checks that it may (L-5), commits nothing but the review file, and sets `success` only on a clean, pushed head of the open PR whose review check passes (for the plan, `docs-check --stage plan-review`). Otherwise it sets `failure` or hands the owner a ready command (L-6).
- Who may run it was checked on a real payload, with Claude Code 2.1.318 on 2026-11-06: the PreToolUse input of a call made inside a sub-agent carries `agent_id` and `agent_type`; a plugin agent's type has the plugin prefix (`pitwall:plan-reviewer`); a project agent with the same name has none (`plan-reviewer`); a call from the main conversation has neither field. So in T3a the hook runs `review-status.mjs` only when `agent_id` is present and `agent_type` is `pitwall:plan-reviewer` or `pitwall:code-reviewer` (T3a-AC4). Requiring `agent_id` also rules out a main conversation started with `--agent`.
- The plan reviewer writes only `docs/PLAN-REVIEW.md`; the main conversation closes the findings in the epics, `docs/SPEC.md` and `docs/RISKS.md` (owner, 2026-11-06). Until T3a this is a rule in the agent's prompt; in T3a the hook limits its writes to that file.

## Consequences

- Until the T3a hook exists, the split rests on the prompts and on the status belonging to one commit: a push after the review needs a new review. The owner accepts this risk, as in ADR-0002.
- No hook sees a status set outside Claude Code, from the owner's terminal or the GitHub web page. The handoff commands rely on that, and so could a mistake.
- The payload fields belong to Claude Code and may change. `.claude-code-version` pins the CLI, and T3a tests the hook against a recorded payload.
- Threat model (owner, 2026-11-09): the docs check that `success` rests on guards against mistakes and carelessness, not against a deliberate attempt to get past it; a deliberate one is for the reviewer and the owner's yes to catch. The ways past it that only such an attempt would write are accepted as R-1, and `review.findings` in the config keeps the line between the two kinds for every later review.
- Revisiting costs one script and one hook rule.
