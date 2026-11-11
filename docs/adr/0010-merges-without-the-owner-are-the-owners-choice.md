# ADR-0010: Merges without the owner are the owner's choice, per project

- Status: accepted
- Date: 2026-11-09
- Class: one-way
- Decided by: owner

## Context

SPEC 6 lets low and normal risk epics merge themselves once `gate` and `ai-review` are green, and ADR-0007 has the reviewer set `ai-review` through `review-status.mjs`. Claude Code's auto mode refuses by default "merging a pull request no human has approved, approving Claude's own pull request". A probe on 2026-11-09 (Claude Code 2.1.318, a fake `gh` that only logged its arguments, a headless session in auto mode) showed both sides: without an allow rule the session ran neither the status write nor the merge, and with narrow allow rules in the project's settings it ran both, since allow rules resolve before the classifier. A merge cannot be taken back.

## Options

| Option | Pros | Cons | Maturity | Cost | Lock-in |
| --- | --- | --- | --- | --- | --- |
| The project's owner chooses, once | The owner of each project decides whether a fresh reviewer and a green gate are enough; the default stays with Claude Code's protection | One more question; two paths to test | Allow rules are a documented Claude Code feature | One question per project | Low |
| Always, from the template's settings | No question; SPEC 6 as written | Every project bypasses Claude Code's protection without its owner choosing it | Same | None | Low |
| Never: the owner sets the status and merges by hand | Claude Code's protection untouched | Two manual steps per epic; SPEC 6 changes | - | Owner time per epic | None |

## Decision

- The owner of each project chooses (owner, 2026-11-09): at kickoff, and in a project laid out before this choice existed, at its first `/pitwall:continue`, one question: may low and normal risk epics merge themselves once `gate` and `ai-review` are green? The answer is recorded in `.claude/pitwall.json`. High risk always waits for the owner (SPEC 6).
- On yes, a plugin script writes allow rules for exactly two commands: `review-status.mjs` and `merge.mjs`, each by the absolute path of the script, with a wildcard for its arguments only, never a pattern such as `node *` or `gh pr merge *` (owner, 2026-11-09). Project settings cannot expand `${CLAUDE_PLUGIN_ROOT}`, and the plugin's path differs per machine and per version, so the rules go into `.claude/settings.local.json`, which stays on the machine, and the script writes them again when the plugin's path changes.
- The script writes them only when the hook that runs `review-status.mjs` only from `pitwall:plan-reviewer` and `pitwall:code-reviewer` (ADR-0007) is installed; otherwise it writes nothing and says why (owner, 2026-11-09). The hook ships in T3a, the rules and the question in T3b.
- Merges without the owner cover epics only (owner, 2026-11-11, T4b): every bug fix merges after the owner's yes, at any risk class, as the question above has always said. A bug's risk class picks the implementer of its fix and nothing else.
- pitwall's own repository answers no for now: every merge waits for the owner until the hook has worked on at least one real PR (owner, 2026-11-09). The hook has since worked on real PRs, T3b's headless runs on GitHub (E1 merged through the allow rules), and the answer stays no for another reason: while the marketplace serves the plugin from `main`, a merge reaches users at once. A marketplace entry can point a plugin at a tag (a `git-subdir` source with a `ref`); once pitwall is served that way, which T4c-AC2 decides in an ADR, this is revisited (owner, 2026-11-10).

## Consequences

- A project that says no gets a loop that stops at "ready to merge" and hands the owner the status and merge commands (L-5, L-6).
- The rules are only as narrow as the script paths; the hook, and `merge.mjs`'s own checks (both checks green, the approved head, no high risk without the owner), are what bound them.
- A plugin update moves the scripts, so a rule left behind stops matching and the loop falls back to the owner until the script refreshes it: it fails safe.
- Revisiting costs one question, one key in `.claude/pitwall.json` and one script.
