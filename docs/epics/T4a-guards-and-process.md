# T4a - Guards and process follow-ups

Goal: no agent throws away uncommitted work, the owner sees in one place what waits for them, and the headless runs start from the state they saved and show what they could not script.
Depends on: T3b
Risk class: high (a guard that refuses tools in every pitwall project, as T3a's do: a false refusal stops ordinary work, L-9)
ADR: ADR-0004, ADR-0010

## Acceptance criteria (draft, refined at the start of T4a)

- [ ] T4a-AC1: A hook stops `git checkout -- <path>`, `git restore` of the work tree, `git reset --hard` and `git clean` when they would throw away uncommitted work, in the main conversation and in the implementers alike, and says to commit or copy it first (L-12, owner, 2026-11-10).
- [ ] T4a-AC2: The conductor's notes never restate the owner's choice of ADR-0010; they point to `.claude/pitwall.json`. In T3b's E1 run on GitHub a stale "every merge waits for me" in the notes contradicted `autoMerge: true` (owner, 2026-11-10).
- [ ] T4a-AC3: `/pitwall:owner-calls` lists what waits for the owner (moved from T3b, 2026-11-09).
- [ ] T4a-AC4: The headless run's `--from` with `--github` restores the remote state of the snapshot it starts from: branches and PRs the snapshot does not hold are deleted, or the run stops before its first session and lists them (owner, 2026-11-10; T3b's first E1 attempt left a branch that the next one found).
- [ ] T4a-AC5: When the scripted owner's fallback answer overrode a recommendation to stop, the run's result is not a plain PASS but "PASS, stops overridden: N" with the text of each, which a person reads before the run counts (owner, 2026-11-10).

## Decisions

One-way (2026-11-10): T4 is split into T4a, the guards and the follow-ups of the loop, T4b, bugs and lessons, and T4c, releases and QA, in that order, all three high risk; the owner merges each (owner).

## Out of scope

- Bugs and lessons (T4b); releases, staging and QA (T4c).

## Open questions

None.
