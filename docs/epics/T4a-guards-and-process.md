# T4a - Guards and process follow-ups

Goal: no agent throws away uncommitted work, the owner sees in one place what waits for them, and the headless runs start from the state they saved and show what they could not script.
Depends on: T3b
Risk class: high (a guard that refuses tools in every pitwall project, as T3a's do: a false refusal stops ordinary work, L-9)
ADR: ADR-0004, ADR-0010

## Acceptance criteria

- [ ] T4a-AC1: Uncommitted work (L-12). The PreToolUse guard refuses, in the main conversation and in every sub-agent, a git command that would throw away uncommitted work, and only when it would: `git checkout -- <path>` and `git checkout <commit> -- <path>` over a changed file, `git checkout -f` and `git switch -f` or `--discard-changes` with changes in the tree, `git restore` of the work tree over a changed file (`--staged` alone keeps it), `git reset --hard` with changes in the tree, `git clean` that deletes an untracked file, and `git stash drop` or `git stash clear`. The refusal names the files and says to commit or copy them first; the same command on a clean tree passes. A read that fails refuses, as the other guards do.
- [ ] T4a-AC2: The owner's choice of ADR-0010 lives in `.claude/pitwall.json` alone. The conductor never writes an answer about merges without the owner into the docs, the epics or the PR: it hands over `merge-choice.mjs` and points to the file, which `merge.mjs` reads at every merge. In T3b's E1 run on GitHub a stale "every merge waits for me" in an epic's open questions contradicted `autoMerge: true` (owner, 2026-11-10).
- [ ] T4a-AC3: `/pitwall:owner-calls` lists what waits for the owner, grouped, one line each, with what happens if they say nothing: merge protection still `pending`, the ADR-0010 choice not made, open questions in the epics in flight or planned, a PR from the loop that is ready and waits for the owner's yes, open bugs, and while the plan is made, open items of `docs/PLAN-REVIEW.md`. It then asks them one at a time and records each answer where it belongs. A script gathers the list, so the check can run it.
- [ ] T4a-AC4: The headless run's `--from` with `--github` starts from the remote state of the snapshot: an open PR or a branch on GitHub that the snapshot does not hold is closed or deleted before the first session, and when `main` on GitHub has moved past the snapshot, the run stops before its first session and says to recreate the repository (owner, 2026-11-10; T3b's first E1 attempt left a branch that the next one found).
- [ ] T4a-AC5: When the scripted owner's fallback answer overrode a recommendation to stop, the run's result is not a plain PASS but "PASS, stops overridden: N", with the text of each, which a person reads before the run counts; the stage's saved numbers keep them (owner, 2026-11-10).
- [ ] T4a-AC6: Tests. `scripts/check.mjs` runs the guard of AC1 on the recorded payloads, on a clean and a dirty tree, with the commands agents really send (L-9) counted as much as what gets through; the owner-calls script on scratch projects with the fake `gh`; and the scripted owner's reading of unscripted and overriding answers.

## Decisions

One-way (2026-11-10): T4 is split into T4a, the guards and the follow-ups of the loop, T4b, bugs and lessons, and T4c, releases and QA, in that order, all three high risk; the owner merges each (owner).

Two-way, picked by the agent and accepted by the owner as a list on 2026-11-10, with the owner's edits (marked):

| Area | Choice | Why, in one line |
| --- | --- | --- |
| Refuse or ask | The guard refuses (deny), and the refusal offers the safe way: `git stash push -- <files>`, which keeps the changes in a stash to restore, or a commit (owner's edit) | Headless, "ask" is a refusal anyway; with the safe way named, "put the file back" works without a terminal |
| Which commands | `git checkout -- <path>`, `git checkout <path>` without `--` (a path, not a branch), `git checkout .`, `git checkout <commit> -- <path>`, `git checkout -f`, `git switch -f` or `--discard-changes`, `git restore` of the work tree, `git reset --hard`, `git clean` that deletes an untracked file, `git stash drop` and `git stash clear`; read through `git -C <dir>` and chains of `&&` and `;`, with Windows paths among the cases (owner's edit, L-9); decided by `git status --porcelain` on the command's paths; `git clean -n` passes, `-x` keeps T3a's switch rule; a failed read refuses | The same mistake in every spelling an agent uses, and nothing on a clean tree |
| Who | The main conversation and every sub-agent alike | An implementer makes the same mistake (owner) |
| Not covered | `rm` or `Remove-Item` of an untracked file | Not a git command: R-2's kind |
| The owner's choice | `continue` never writes an answer about merges without the owner into the docs, an epic's open questions or a PR; it hands over `merge-choice.mjs`, points to `.claude/pitwall.json` and reads it before every merge | One record, which `merge.mjs` reads |
| Owner calls | `scripts/owner-calls.mjs` gathers the list read-only (`.claude/pitwall.json`, the docs, PRs and statuses through `merge.mjs`'s readers); each item has its default if the owner says nothing (protection pending: nothing merges; no choice of ADR-0010: every merge waits; an open question: the epic waits; a ready PR: it stays open; an open bug: it goes first); the skill asks one at a time and records an answer where an agent may write it; the choice of ADR-0010 and merge protection it hands over as commands, as `continue` does (owner's edit); `disable-model-invocation` stays | Testable in the check; the owner's switches stay the owner's |
| Snapshot restore | The saved stage keeps the repository's id and its branches and PRs; before deleting anything the harness checks the id and stops, changing nothing, when it differs (owner's edit); then it closes the PRs and deletes the branches the snapshot does not hold, and stops when `main` moved past the snapshot or GitHub answers anything unexpected; checked against the live fake GitHub; GitHub's answers to a PR closed and a branch deleted are recorded at the next run on real GitHub (owner's edit) | A typo in `--github` must never touch a live repository; the fake is not yet held to those two answers |
| Overridden stops | The scripted owner writes `UNSCRIPTED OVERRIDE` when it took the way that goes on against a recommendation to stop; the result reads "E2E LOOP: PASS, stops overridden: N" with each text, the exit code stays 0, and the stage's numbers keep them | Not a plain PASS, and a person reads them before the run counts |
| Runs before the PR | `node scripts/e2e.mjs --hooks` (no new payloads: the guard reads the recorded Bash payload) and E1 on the fake GitHub in the owner's terminal with `--log`; no run on real GitHub | What T4a changes is covered by the check and these two |
| Version | 0.6.0 | A guard, a script and a skill are additions |

## Out of scope

- Bugs and lessons (T4b); releases, staging and QA (T4c).
- A guard on deleting untracked files with anything but git (`rm`, `Remove-Item`): R-2's kind, a command the guard does not read as git.

## Open questions

None.
