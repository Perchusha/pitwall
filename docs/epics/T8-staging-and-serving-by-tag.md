# T8 - Staging and pitwall served by tag

Goal: a project with a staging environment of its type gets one, QA can pass through a browser, and pitwall reaches its users by tag, not by a merge into `main`.
Depends on: T5b
Risk class: high (deploys to staging, and the way pitwall reaches its users)
ADR: ADR-0010

## Acceptance criteria (draft, refined when T8 starts)

- [ ] T8-AC1: pitwall's marketplace serves the plugin by tag. A plugin source of kind `github`, `url` or `git-subdir` takes a `ref` (a branch or a tag) and a `sha`, and a relative path takes neither (Claude Code's marketplace reference, Plugin sources), so pitwall can be served as `git-subdir` from its own repository, path `plugins/pitwall`, at a tag; a release is then a commit that moves the ref, not a merge into `main`. That breaks the rule that a version bump changes `plugin.json` and the marketplace in one commit (`CLAUDE.md`, `scripts/check.mjs`): an ADR first, the first question when T4c starts. With the plugin served by tag, ADR-0010's answer for pitwall itself is revisited (owner, 2026-11-10).
- [ ] T8-AC2: Staging defaults per type of application (SPEC 6): web, a separate environment with its own database and URL; desktop, a built installer, and for Steam a closed beta branch; mobile, TestFlight and Google Play internal testing.
- [ ] T8-AC3: The qa agent adds an exploratory pass in a browser to the tests of the closed epics' criteria.

## Decisions

One-way (2026-11-12): moved here from T4c, after T5 (owner): T5 holds no web application, and Last Ones Down reaches Steam its own way.

## Out of scope

- The releases and the minimal QA of T4c.

## Open questions

- The ADR of T8-AC1: how pitwall's version bump and the marketplace's ref move, and what `scripts/check.mjs` checks instead of "one commit".
