# T4d - The guard's corpus and the gate before every commit

Goal: every change of a guard that reads commands is checked against its corpus before a reviewer sees it (L-13), and no commit lands while the gate is red (L-14), in a project and in pitwall itself.
Depends on: T4b
Risk class: high (a guard that refuses tools in every pitwall project, as T3a's and T4a's do, and a hook that refuses commits: a false refusal stops ordinary work, L-9)
ADR: ADR-0006, and a new one for AC3

## Acceptance criteria (draft, refined when T4d starts)

- [ ] T4d-AC1: The guard's corpus (L-13). A script in `scripts/` replays the command lines of the local transcripts through the hooks' guard at a given commit and in the working tree, and prints each verdict that changed. It is a tool for developing pitwall: not part of the plugin and not a step of `scripts/check.mjs`, since CI has no transcripts; it runs only locally and skips its work, saying so, when it finds none. No transcript line enters the repository: the journal, the PR and a committed review file describe a changed verdict by its rule and the form of the command, without quoting the line (owner, 2026-11-10).
- [ ] T4d-AC2: The 52 variants that T4a's verifying round wrote, kept by the owner outside the repository, become cases in `scripts/check.mjs` with their verdicts at T4a's merge, once a check has shown that none of them is a copy of a transcript line (owner, 2026-11-10).
- [ ] T4d-AC3: The gate before every commit (L-14), built after AC1, with an ADR. The template gives a project `.githooks/pre-commit`, which runs `scripts/gate --fast` and refuses the commit when the gate fails, on every branch but `spike/*`, where a prototype is committed while the gate is still the template's stub: one exception, so that a branch with a new name is checked by default. The stub counts `.githooks/` as configuration, not code. `/pitwall:kickoff` sets `core.hooksPath` to `.githooks` and commits the hook executable, and `/pitwall:continue` sets it in a project laid out before. The hooks' guard refuses `git commit --no-verify` and `-n`, and every change of `core.hooksPath` but setting it to `.githooks` (`git config core.hooksPath .githooks`, with or without `--local`): `--global`, `--unset`, any other value and `git -c core.hooksPath=...` are refused. A narrow rule, checked against the corpus of AC1. The ADR records the limit: the hook checks the work tree, not the index, so a partial commit can still be red, and CI catches it (owner, 2026-11-11).
- [ ] T4d-AC4: pitwall's own pre-commit hook, built with AC3. `.githooks/pre-commit` at the root of this repository runs `node scripts/check.mjs --fast`: the steps that only read the repository (the validator, the manifests and versions, the skills and agents, the template, the scripts' parse, the layout, the docs check, links, em dashes, English, model ids), about 7 seconds of the full run's 155 on the owner's machine; the steps with the fake `gh` and the hooks' recorded payloads stay in CI and in the full run before a PR. `scripts/check.mjs` fails unless `.githooks/pre-commit` is in the index with mode 100755, both the template's and pitwall's own, since git on macOS and Linux skips a hook that is not executable without a word. `CLAUDE.md` names under Commands `node scripts/check.mjs --fast` and `git config core.hooksPath .githooks` for a new clone. The guard of AC3 does not act in this repository, which is not a pitwall project, so here L-14 alone keeps `--no-verify` out (owner, 2026-11-11).

## Decisions

One-way (2026-11-11): split out of T4b, whose draft held these four criteria as T4b-AC4 to AC7 (owner). As drafted T4b was about 1.3 to 1.4 times the size of T4a, with two areas of high risk, the rules of merges and a guard, which every review round would have read together. The letter d keeps T4c the name of releases and QA, as the journal and T4a's decisions call it; this epic comes after T4b and before T4c, which depends on it.

The first bugs, filed with `/pitwall:bug` once T4b is merged (see T4b-bugs-and-lessons.md), go into the first commit of this epic's branch, and are fixed after this epic, when the script of AC1 checks each change of the guard against the corpus, `git rm -f` first (owner, 2026-11-11).

## Out of scope

- Bugs and lessons (T4b); releases, staging and QA (T4c).
- Fixing the first bugs: after this epic (see Decisions).

## Open questions

None.
