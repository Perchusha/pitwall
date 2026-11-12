# T7 - The guard's corpus

Goal: every change of a guard that reads commands is checked against its corpus before a reviewer sees it (L-13), the gaps of the guard found in T4a are fixed that way, and pitwall itself refuses a commit on a red check.
Depends on: T5
Risk class: high (the guard refuses tools in every pitwall project: a false refusal stops ordinary work, L-9)
ADR: ADR-0006

## Acceptance criteria (draft, refined when T7 starts)

- [ ] T7-AC1: The guard's corpus (L-13). A script in `scripts/` replays the command lines of the local transcripts through the hooks' guard at a given commit and in the working tree, and prints each verdict that changed. It is a tool for developing pitwall: not part of the plugin and not a step of `scripts/check.mjs`, since CI has no transcripts; it runs only locally and skips its work, saying so, when it finds none. No transcript line enters the repository: the journal, the PR and a committed review file describe a changed verdict by its rule and the form of the command, without quoting the line (owner, 2026-11-10).
- [ ] T7-AC2: The 52 variants that T4a's verifying round wrote, kept by the owner outside the repository, become cases in `scripts/check.mjs` with their verdicts at T4a's merge, once a check has shown that none of them is a copy of a transcript line (owner, 2026-11-10).
- [ ] T7-AC3: pitwall's own pre-commit hook, after the gate before every commit of T4d. `.githooks/pre-commit` at the root of this repository runs `node scripts/check.mjs --fast`: the steps that only read the repository (the validator, the manifests and versions, the skills and agents, the template, the scripts' parse, the layout, the docs check, links, em dashes, English, model ids), about 7 seconds of the full run's 155 on the owner's machine; the steps with the fake `gh` and the hooks' recorded payloads stay in CI and in the full run before a PR. `scripts/check.mjs` fails unless `.githooks/pre-commit` is in the index with mode 100755, both the template's and pitwall's own, since git on macOS and Linux skips a hook that is not executable without a word. `CLAUDE.md` names under Commands `node scripts/check.mjs --fast` and `git config core.hooksPath .githooks` for a new clone. The guard of T4d-AC1 does not act in this repository, which is not a pitwall project, so here L-14 alone keeps `--no-verify` out (owner, 2026-11-11).

## Decisions

One-way (2026-11-11): moved here from T4d, after T5 (owner). The four gaps of the guard that T4b files as pitwall's first bugs are fixed right after this epic, each change of the guard checked by the script of AC1, `git rm -f` first.

## Out of scope

- The gate before every commit in a project (T4d).

## Open questions

None.
