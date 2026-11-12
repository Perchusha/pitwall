# T4d - The gate before every commit

Goal: no commit lands in a pitwall project while its gate is red (L-14).
Depends on: T4b
Risk class: high (a hook that refuses commits, and a guard that refuses tools in every pitwall project, as T3a's and T4a's do: a false refusal stops ordinary work, L-9)
ADR: ADR-0006, and a new one for AC1

## Acceptance criteria (draft, refined when T4d starts)

- [ ] T4d-AC1: The gate before every commit (L-14), with an ADR. The template gives a project `.githooks/pre-commit`, which runs `scripts/gate --fast` and refuses the commit when the gate fails, on every branch but `spike/*`, where a prototype is committed while the gate is still the template's stub: one exception, so that a branch with a new name is checked by default. The stub counts `.githooks/` as configuration, not code. `/pitwall:kickoff` sets `core.hooksPath` to `.githooks` and commits the hook executable, and `/pitwall:continue` sets it in a project laid out before. The hooks' guard refuses `git commit --no-verify` and `-n`, and every change of `core.hooksPath` but setting it to `.githooks` (`git config core.hooksPath .githooks`, with or without `--local`): `--global`, `--unset`, any other value and `git -c core.hooksPath=...` are refused. A narrow rule, with cases in `scripts/check.mjs` for each form it lets through and each it refuses; the replay of the corpus comes with T7. The ADR records the limit: the hook checks the work tree, not the index, so a partial commit can still be red, and CI catches it (owner, 2026-11-11).

## Decisions

One-way (2026-11-11): split out of T4b, whose draft held the guard's corpus and the gate before every commit as T4b-AC4 to AC7 (owner). As drafted T4b was about 1.3 to 1.4 times the size of T4a, with two areas of high risk. The letter d keeps T4c the name of releases and QA, as the journal and T4a's decisions call it; this epic comes after T4b and before T4c, which depends on it.

One-way (2026-11-11): only the gate before every commit stays here, with the guard's rule on `--no-verify` and `core.hooksPath` (owner). The script that replays the guard's corpus (L-13), the 52 variants of T4a and the four gaps of the guard move to T7, after T5. So does pitwall's own pre-commit hook, drafted here as T4d-AC4: it comes with the gate's ADR and the fast run of `scripts/check.mjs` it needs.

## Out of scope

- Bugs and lessons (T4b); releases, staging and QA (T4c); the guard's corpus, its four gaps and pitwall's own pre-commit hook (T7).

## Open questions

None.
