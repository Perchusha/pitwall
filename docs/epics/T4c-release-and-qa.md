# T4c - Releases and a minimal QA

Goal: every merged epic ships as a tagged version with a changelog, built locally at the lite level, and the owner gets the tests of every closed epic's criteria and a checklist of the manual QA left to them; defects found go in as bugs.
Depends on: T4d
Risk class: high (tags: a mistake reaches users, and a pushed tag is not taken back quietly)
ADR: ADR-0010

## Acceptance criteria (draft, refined when T4c starts)

- [ ] T4c-AC1: A merged epic produces a semver tag and a changelog. The changelog and the version are built only from the merge commits on `main` (`git log --first-parent`), which T3b writes as `feat(E<n>): ...` and `fix(BUG-<n>): ...`; the commits inside a branch never reach the changelog (owner, 2026-11-09).
- [ ] T4c-AC3: The release records the changes merged since the last branch of the loop: the last change of a plan has no next branch to record it (T3b review).
- [ ] T4c-AC4: At the lite level the release is a local build: the project's own build command, run and checked, with no staging environment (owner, 2026-11-12).
- [ ] T4c-AC5: A minimal qa agent: it runs the tests of the acceptance criteria of every closed epic, writes for the owner a checklist of the manual QA the epics' scenarios leave to them, and files a bug for each failure with `/pitwall:bug` (owner, 2026-11-12).

## Decisions

One-way (2026-11-10): split out of T4 (see T4a-guards-and-process.md), high risk (owner). If T4c turns out as large as T3b when it starts, it is split again: releases (AC1 to AC3) and QA (AC4, AC5) (owner).

One-way (2026-11-12): made smaller before T5 (owner). Kept: AC1, AC3, the lite level's local build of AC4 and a minimal qa agent of AC5. Moved to T8, after T5: serving pitwall by tag with its ADR (drafted here as the second criterion, now T8-AC1), staging by type of application, and the qa agent's pass in a browser. T5 holds no web application, and Last Ones Down reaches Steam its own way. The criteria keep their numbers, so what the journal and the reviews call T4c-AC3 stays the same criterion.

T4c-AC3 belongs here and not in T4a: recording needs a commit on protected `main`, which only a reviewed PR brings, and the release already makes one (its changelog and version). In T4a the record would need a docs-only PR of its own, with its own branch kind, gate and review, for the same commit the release makes anyway.

## Out of scope

- The guards and the loop's follow-ups (T4a); bugs and lessons (T4b); the gate before every commit (T4d).
- Serving pitwall by tag, staging by type of application, QA in a browser (T8).

## Open questions

None.
