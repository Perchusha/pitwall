# E0 - Walking skeleton

Goal: the empty project builds, tests and reaches staging, or a local build at the lite level, so every later epic runs the full loop from its first day.
Depends on: the stack decisions in `docs/adr/`
Risk class: normal
ADR: (the stack ADRs)

## Acceptance criteria

- [ ] E0-AC1: `scripts/gate --full` runs the real checks for the chosen stack and exits non-zero when a test fails; `scripts/gate --fast` runs the quick ones in seconds, since `.githooks/pre-commit` runs it before every commit.
- [ ] E0-AC2: CI runs the gate on every PR as the check named `gate`.
- [ ] E0-AC3: Merge protection is on: `.claude/pitwall.json` records `branch-protection` or `local-hook`, not `pending`, and pitwall's `protect.mjs` confirms it.
- [ ] E0-AC4: `scripts/build <version>` builds the "hello world" app from the tree as it is, changes no tracked file, and prints one `ARTIFACT: <path>` line for each thing it built; the built app runs. At the lite level this local build is the release; at the standard and full levels it also reaches staging.
- [ ] E0-AC5: `CLAUDE.md` lists the real commands, each run successfully.

## Out of scope

Any product feature.

## Open questions

None.
