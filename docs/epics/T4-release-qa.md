# T4 - Release and QA

Goal: every merged epic ships as a tagged version, passes QA on staging and reaches production with a smoke check.
Depends on: T3b
Risk class: normal

## Acceptance criteria (draft, refined when T4 starts)

- [ ] T4-AC1: A merged epic produces a semver tag and a changelog from conventional commits.
- [ ] T4-AC2: Staging defaults per app type, and the lite level's local build.
- [ ] T4-AC3: The qa agent runs E2E against the acceptance criteria of every closed epic plus an exploratory browser pass, and files BUG-n for failures.
- [ ] T4-AC4: `/pitwall:bug` and `/pitwall:lesson` record defects and rules; a fix closes only with a regression test.
