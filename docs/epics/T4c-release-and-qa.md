# T4c - Releases and QA

Goal: every merged epic ships as a tagged version with a changelog, passes QA on staging and reaches production with a smoke check; pitwall itself reaches its users by tag, not by a merge into `main`.
Depends on: T4b
Risk class: high (tags and deploys to staging and production: a mistake reaches users, and a pushed tag is not taken back quietly)
ADR: ADR-0010

## Acceptance criteria (draft, refined when T4c starts)

- [ ] T4c-AC1: A merged epic produces a semver tag and a changelog. The changelog and the version are built only from the merge commits on `main` (`git log --first-parent`), which T3b writes as `feat(E<n>): ...` and `fix(BUG-<n>): ...`; the commits inside a branch never reach the changelog (owner, 2026-11-09).
- [ ] T4c-AC2: pitwall's marketplace serves the plugin by tag. A plugin source of kind `github`, `url` or `git-subdir` takes a `ref` (a branch or a tag) and a `sha`, and a relative path takes neither (Claude Code's marketplace reference, Plugin sources), so pitwall can be served as `git-subdir` from its own repository, path `plugins/pitwall`, at a tag; a release is then a commit that moves the ref, not a merge into `main`. That breaks the rule that a version bump changes `plugin.json` and the marketplace in one commit (`CLAUDE.md`, `scripts/check.mjs`): an ADR first, the first question when T4c starts. With the plugin served by tag, ADR-0010's answer for pitwall itself is revisited (owner, 2026-11-10).
- [ ] T4c-AC3: The release records the changes merged since the last branch of the loop: the last change of a plan has no next branch to record it (T3b review).
- [ ] T4c-AC4: Staging defaults per app type, and the lite level's local build.
- [ ] T4c-AC5: The qa agent runs E2E against the acceptance criteria of every closed epic plus an exploratory browser pass, and files BUG-n for failures, in T4b's format.

## Decisions

One-way (2026-11-10): split out of T4 (see T4a-guards-and-process.md), high risk (owner). If T4c turns out as large as T3b when it starts, it is split again: releases (AC1 to AC3) and QA (AC4, AC5) (owner).

T4c-AC3 belongs here and not in T4a: recording needs a commit on protected `main`, which only a reviewed PR brings, and the release already makes one (its changelog and version). In T4a the record would need a docs-only PR of its own, with its own branch kind, gate and review, for the same commit the release makes anyway.

## Out of scope

- The guards and the loop's follow-ups (T4a); bugs and lessons (T4b).

## Open questions

- The ADR of T4c-AC2: how pitwall's version bump and the marketplace's ref move, and what `scripts/check.mjs` checks instead of "one commit".
