# ADR-0012: The gate runs before every commit, from a git hook the project carries

- Status: accepted
- Date: 2026-11-12
- Class: one-way
- Decided by: owner

## Context

L-14: a commit ran after the check before it had failed, because the check and the commit were joined by `&&` through a pipe without `pipefail`, and `tail` succeeded. The conductor did it once in T4b, and implementers wrote the same form with the gate in 10 calls of 6 of the 11 headless loop runs, though the epic skill says to run each command on its own. A rule in a skill did not hold; T4d puts a tool in its place. The gate itself, `scripts/gate`, is the project's (ADR-0006): pitwall only calls it.

## Options

| Option | Pros | Cons | Maturity | Cost | Lock-in |
| --- | --- | --- | --- | --- | --- |
| A `pre-commit` hook in the project, `.githooks/pre-commit`, with `core.hooksPath` set to it | git runs it for every `git commit`, whoever writes the command and however it is joined; it lives in the repository, so the template ships it and a review sees a change to it; one narrow guard rule keeps agents from skipping it | `core.hooksPath` is local config, which a clone does not carry; every commit waits for `scripts/gate --fast`; `--no-verify` skips it | git's own mechanism, stable for years | Seconds per commit | Low: one file and one setting |
| A `commit-msg` hook | Runs late, after the message is written | Same skip as `pre-commit`, runs after the author has typed the message for nothing, and the gate has nothing to do with the message | Same | Same | Low |
| CI alone | Already there: the required check `gate` on every PR | A red commit lands on the branch, and the next implementer or reviewer works on it; L-14 happened with CI in place | Already built | None | None |
| A guard on the forms of commands (`&&` after a pipe without `pipefail`) | No setting to install | Too many forms in two shells, the repeat of T4a's review rounds (owner's no, 2026-11-11) | - | High to keep right | None |

## Decision

- The template gives every project `.githooks/pre-commit`, a bash script executable in the git index. It runs `bash scripts/gate --fast` from the project root and refuses the commit when the gate fails, with the last lines of its output (owner, 2026-11-11).
- It runs nothing on a `spike/*` branch, where a prototype is committed while the gate is still the template's stub: the one branch exception, so that a branch with a new name is checked by default (owner, 2026-11-11).
- It runs nothing for a commit that changes only Markdown under `docs/` and `.claude/pitwall.json`: such a commit cannot turn the code's checks red (a gate that also checks `docs/` is caught by CI), and it must land while the gate is red, as the first commit of the fix for a red `main` does (proposed by the agent, accepted by the owner, 2026-11-12).
- `/pitwall:kickoff` sets `core.hooksPath` to `.githooks` before the skeleton commit; `/pitwall:continue` sets it in a clone where the hook is tracked, and lays the hook out in a project laid out before T4d.
- The hooks' guard refuses `git commit` with `--no-verify` or `-n`, and `git config` that sets `core.hooksPath` to anything but `.githooks` or unsets it. Nothing else: the rule is narrow, and what it does not read is R-5 (owner, 2026-11-12). Amended in T7 (2026-11-14), by the owner's decision in T4b that BUG-8 recorded: it also refuses `core.hooksPath` set for every repository of the account or the machine (`--global`, `--system`), whatever the value, and kickoff asks the owner before pitwall's hook replaces hooks of their own (BUG-7).
- pitwall's own repository has a hook of its own that runs `node scripts/check.mjs --fast` (owner, 2026-11-12).

## Consequences

- The hook checks the work tree, not what is committed. A partial commit can be red on its own while the whole tree is green: CI's `gate`, required on every PR, catches it. A commit that leaves out a red file is refused although what it commits is green: the red file is fixed, or put aside first (`git stash push -u -- <file>`, `-u` for a file git does not track yet).
- git makes some commits without `pre-commit`: a merge with no conflict, a cherry-pick, a revert, a rebase. CI catches these too.
- The gate runs as from a terminal: the hook clears the variables git sets for the commit's own index (`git rev-parse --local-env-vars`), or a gate whose tests make scratch repositories would write into the commit.
- `.githooks/pre-commit` joins the contract of ADR-0006. Every commit of an implementer waits for `scripts/gate --fast`, so a slow fast mode slows every commit.
- Revisiting costs the template file, two steps of the skills, one guard rule and their cases in `scripts/check.mjs`; `git config --unset core.hooksPath`, run by the owner, turns it off in one clone until the next `/pitwall:continue`, which reads an empty setting as a new clone and sets it again; to keep it off, the owner points `core.hooksPath` at another folder, which `continue` asks about each session.
