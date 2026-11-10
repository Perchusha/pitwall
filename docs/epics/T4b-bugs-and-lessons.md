# T4b - Bugs and lessons

Goal: a defect becomes a bug with a severity and a risk class, its fix runs the loop and merges by that class, and a mistake that can repeat becomes a lesson, and a guard where a tool can check it.
Depends on: T4a
Risk class: high (a fix merges by its own risk class: the rules of merges change)
ADR: ADR-0006, ADR-0010

## Acceptance criteria (draft, refined when T4b starts)

- [ ] T4b-AC1: `/pitwall:bug` and `/pitwall:lesson` record defects and rules; a fix closes only with a regression test.
- [ ] T4b-AC2: `docs/BUGS.md` gains a severity and a risk class: only a blocking bug goes before the next epic, the others wait in the queue (owner, 2026-11-09); until then T3b takes any open bug first. A new column changes a template table, so projects laid out before need a migration. The default "an open bug goes first" changes to "only a blocking bug goes first" everywhere it is said: `continue`'s selection and `/pitwall:owner-calls`' default for an open bug (owner, 2026-11-10).
- [ ] T4b-AC3: A fix merges by its risk class like an epic; until then T3b merges every fix after the owner's yes.
- [ ] T4b-AC4: The guard's corpus (L-13). A script in `scripts/` replays the command lines of the local transcripts through the hooks' guard at a given commit and in the working tree, and prints each verdict that changed. It is a tool for developing pitwall: not part of the plugin and not a step of `scripts/check.mjs`, since CI has no transcripts; it runs only locally and skips its work, saying so, when it finds none. No transcript line enters the repository: the journal, the PR and a committed review file describe a changed verdict by its rule and the form of the command, without quoting the line (owner, 2026-11-10).
- [ ] T4b-AC5: The 52 variants that T4a's verifying round wrote, kept by the owner outside the repository, become cases in `scripts/check.mjs` with their verdicts at T4a's merge, once a check has shown that none of them is a copy of a transcript line (owner, 2026-11-10).

## Decisions

One-way (2026-11-10): split out of T4 (see T4a-guards-and-process.md), high risk because a fix merging by its own class changes the rules of merges (owner).

## Out of scope

- Releases, staging and QA (T4c), whose qa agent files bugs in this epic's format.

## Open questions

None.
