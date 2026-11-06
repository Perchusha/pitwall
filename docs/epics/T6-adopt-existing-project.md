# T6 - Adopt an existing project

Goal: pitwall starts in a repository that already has code or docs: it lays out only what is missing, keeps what is there and starts at the stage the project has actually reached.
Depends on: T1
Risk class: normal

## Acceptance criteria (draft, refined when T6 starts)

- [ ] T6-AC1: An adopt flow lists every template path the project already has, and never overwrites one without the owner's answer.
- [ ] T6-AC2: Existing docs are mapped to the template's sections, and what is missing becomes a list of questions for the owner.
- [ ] T6-AC3: The project's real checks become its `scripts/gate`, so the gate is green only when they pass.
- [ ] T6-AC4: `.claude/pitwall.json` records the stage the project starts from, and merge protection is set up as kickoff does it.
