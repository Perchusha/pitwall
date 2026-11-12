# T7 - The guard's corpus

Goal: every change of a guard that reads commands is checked against its corpus before a reviewer sees it (L-13), and the gaps of the guard found in T4a are fixed that way.
Depends on: T5b
Risk class: high (the guard refuses tools in every pitwall project: a false refusal stops ordinary work, L-9)
ADR: ADR-0006

## Acceptance criteria (draft, refined when T7 starts)

- [ ] T7-AC1: The guard's corpus (L-13). A script in `scripts/` replays the command lines of the local transcripts through the hooks' guard at a given commit and in the working tree, and prints each verdict that changed. It is a tool for developing pitwall: not part of the plugin and not a step of `scripts/check.mjs`, since CI has no transcripts; it runs only locally and skips its work, saying so, when it finds none. No transcript line enters the repository: the journal, the PR and a committed review file describe a changed verdict by its rule and the form of the command, without quoting the line (owner, 2026-11-10).
- [ ] T7-AC2: The 52 variants that T4a's verifying round wrote, kept by the owner outside the repository, become cases in `scripts/check.mjs` with their verdicts at T4a's merge, once a check has shown that none of them is a copy of a transcript line (owner, 2026-11-10).

## Decisions

One-way (2026-11-11): moved here from T4d, after T5 (owner). pitwall's own pre-commit hook, drafted here as `T7-AC3`, went back to T4d as T4d-AC4 on 2026-11-12: it is cheap (owner). The bugs of the guard are fixed right after this epic, each change of the guard checked by the script of AC1: BUG-1 (`git rm -f`) first, then BUG-2 (`git worktree remove --force`), BUG-3 (`git reset --merge`), BUG-4 (the PowerShell single-word assignment), BUG-6 (`node -e` reading the plugin's config) and BUG-8 (`git config --global core.hooksPath .githooks`) (owner, 2026-11-12).

## Out of scope

- The gate before every commit, in a project and in pitwall itself (T4d).

## Open questions

None.
