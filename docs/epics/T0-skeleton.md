# T0 - Skeleton

Goal: a public repository that is a working Claude Code marketplace with the pitwall plugin skeleton, the project template and the checks that keep both valid.
Depends on: nothing
Risk class: normal
ADR: ADR-0001, ADR-0002, ADR-0003

## Acceptance criteria

- [ ] T0-AC1: `claude plugin validate --strict` passes on the marketplace and on the plugin, and the plugin carries a README and an icon.
- [ ] T0-AC2: The plugin installs from the marketplace (`claude plugin marketplace add`, `claude plugin install pitwall@pitwall`) and lists 12 skills and 6 agents.
- [ ] T0-AC3: Every skill and agent that is not built yet says so and stops; no unbuilt skill can trigger by itself.
- [ ] T0-AC4: `template/` holds the documentation skeleton, the CLAUDE.md and settings skeletons, CI, a PR template and a `scripts/gate` stub that passes on docs only and fails once code appears.
- [ ] T0-AC5: `node scripts/check.mjs` runs every check, fails on a broken manifest, a mismatched version, a skill whose name differs from its folder, a missing template file or an em dash, and CI runs it as the check `gate`.
- [ ] T0-AC6: The repository documents itself in the structure the template gives a project: SPEC, EPICS, ADRs, JOURNAL, LESSONS, BUGS.

## Out of scope

The behaviour of any stage: that is T1 to T4.

## Open questions

None.
