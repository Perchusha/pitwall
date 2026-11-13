# T6 - Adopt an existing project

Goal: pitwall starts in a repository that already has code or docs: it lays out only what is missing, keeps what is there and starts at the stage the project has actually reached.
Depends on: T5a
Risk class: normal

## Acceptance criteria (draft, refined when T6 starts)

- [ ] T6-AC1: An adopt flow lists every template path the project already has, and never overwrites one without the owner's answer.
- [ ] T6-AC2: Existing docs are mapped to the template's sections, and what is missing becomes a list of questions for the owner.
- [ ] T6-AC3: The project's real checks become its `scripts/gate`, so the gate is green only when they pass.
- [ ] T6-AC4: `.claude/pitwall.json` records the stage the project starts from, and merge protection is set up as kickoff does it.
- [ ] T6-AC5: A dry run comes first and changes nothing: it lists what the adoption would add and how the project's own plan (a `ROADMAP.md`, for one) maps onto `docs/EPICS.md`. The owner decides from that list what pitwall's documents replace, so a project never has two plans or two conductors (owner, 2026-11-12; T5b).
