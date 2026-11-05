# T2 - Stages 3 to 5

Goal: decisions become an approved plan: spike, plan and plan-reviewer work.
Depends on: T1
Risk class: normal

## Acceptance criteria (draft, refined when T2 starts)

- [ ] T2-AC1: `/pitwall:spike` writes the criterion before the prototype, keeps the code off `main` and records the measured result.
- [ ] T2-AC2: `/pitwall:plan` writes `docs/EPICS.md` and one file per epic with acceptance criteria and a risk class, E0 first.
- [ ] T2-AC3: A plan check refuses an epic without acceptance criteria or a risk class, a broken ADR link and a dependency cycle.
- [ ] T2-AC4: The plan-reviewer, from the documents only, writes `docs/PLAN-REVIEW.md` with a pre-mortem, the non-functional checklist, launch questions and epic sizing.
