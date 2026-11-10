# T4 - Release and QA

Goal: every merged epic ships as a tagged version, passes QA on staging and reaches production with a smoke check.
Depends on: T3b
Risk class: normal

## Acceptance criteria (draft, refined when T4 starts)

- [ ] T4-AC1: A merged epic produces a semver tag and a changelog from conventional commits. The changelog and the version are built only from the merge commits on `main` (`git log --first-parent`), which T3b writes as `feat(E<n>): ...` and `fix(BUG-<n>): ...`; the commits inside a branch never reach the changelog (owner, 2026-11-09).
- [ ] T4-AC2: Staging defaults per app type, and the lite level's local build.
- [ ] T4-AC3: The qa agent runs E2E against the acceptance criteria of every closed epic plus an exploratory browser pass, and files BUG-n for failures.
- [ ] T4-AC4: `/pitwall:bug` and `/pitwall:lesson` record defects and rules; a fix closes only with a regression test. `docs/BUGS.md` gains a severity and a risk class: only a blocking bug goes before the next epic, the others wait in the queue (owner, 2026-11-09), and a fix merges by its risk class like an epic (until then, T3b takes any open bug first and merges every fix after the owner's yes). A new column changes a template table, so projects laid out before need a migration.
- [ ] T4-AC5: `/pitwall:owner-calls` lists what waits for the owner (moved from T3b, 2026-11-09).
- [ ] T4-AC6: The release records the changes merged since the last branch of the loop: the last change of a plan has no next branch to record it (T3b review).
- [ ] T4-AC7: A hook stops `git checkout -- <path>`, `git restore` of the work tree, `git reset --hard` and `git clean` when they would throw away uncommitted work, in the main conversation and in the implementers alike, and says to commit or copy it first (L-12, owner, 2026-11-10).
