# T4 - Release and QA

Goal: every merged epic ships as a tagged version, passes QA on staging and reaches production with a smoke check.
Depends on: T3b
Risk class: normal

## Acceptance criteria (draft, refined when T4 starts)

- [ ] T4-AC1: A merged epic produces a semver tag and a changelog from conventional commits. The changelog and the version are built only from the merge commits on `main` (`git log --first-parent`), which T3b writes as `feat(E<n>): ...` and `fix(BUG-<n>): ...`; the commits inside a branch never reach the changelog (owner, 2026-11-09). First, check in Claude Code's documentation whether a marketplace entry can point a plugin at a tag: pitwall's own repository keeps every merge for the owner while the marketplace serves the plugin from `main`, where a merge reaches users at once; if an entry can name a tag, ADR-0010's answer for pitwall is revisited (owner, 2026-11-10).
- [ ] T4-AC2: Staging defaults per app type, and the lite level's local build.
- [ ] T4-AC3: The qa agent runs E2E against the acceptance criteria of every closed epic plus an exploratory browser pass, and files BUG-n for failures.
- [ ] T4-AC4: `/pitwall:bug` and `/pitwall:lesson` record defects and rules; a fix closes only with a regression test. `docs/BUGS.md` gains a severity and a risk class: only a blocking bug goes before the next epic, the others wait in the queue (owner, 2026-11-09), and a fix merges by its risk class like an epic (until then, T3b takes any open bug first and merges every fix after the owner's yes). A new column changes a template table, so projects laid out before need a migration.
- [ ] T4-AC5: `/pitwall:owner-calls` lists what waits for the owner (moved from T3b, 2026-11-09).
- [ ] T4-AC6: The release records the changes merged since the last branch of the loop: the last change of a plan has no next branch to record it (T3b review).
- [ ] T4-AC7: A hook stops `git checkout -- <path>`, `git restore` of the work tree, `git reset --hard` and `git clean` when they would throw away uncommitted work, in the main conversation and in the implementers alike, and says to commit or copy it first (L-12, owner, 2026-11-10).
- [ ] T4-AC8: The headless run's `--from` with `--github` restores the remote state of the snapshot it starts from: branches and PRs the snapshot does not hold are deleted, or the run stops before its first session and lists them (owner, 2026-11-10; T3b's first E1 attempt left a branch that the next one found).
- [ ] T4-AC9: When the scripted owner's fallback answer overrode a recommendation to stop, the run's result is not a plain PASS but "PASS, stops overridden: N" with the text of each, which a person reads before the run counts (owner, 2026-11-10).
- [ ] T4-AC10: The conductor's notes never restate the owner's choice of ADR-0010; they point to `.claude/pitwall.json`. In T3b's E1 run on GitHub a stale "every merge waits for me" in the notes contradicted `autoMerge: true` (owner, 2026-11-10).
