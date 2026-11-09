# Epics

pitwall is built with its own process: epics in order, no dates, one PR each.

| Epic | Goal | Risk | Depends on | Status |
| --- | --- | --- | --- | --- |
| [T0](epics/T0-skeleton.md) | Marketplace, plugin skeleton, project template, checks and CI | normal | - | merged (#1) |
| [T1](epics/T1-stages-0-2.md) | Stages 0 to 2: kickoff, discovery, decide, researcher | normal | T0 | merged (#2) |
| [T2](epics/T2-stages-3-5.md) | Stages 3 to 5: spike, plan, plan-reviewer, the plan PR's review and merge | normal | T1 | merged (#3) |
| [T3a](epics/T3a-hooks.md) | Hooks: session brief, guards on secrets and pushes, the review and merge guards, call budgets, checks after edits and before stopping | high | T2 | merged (#4) |
| [T3b](epics/T3b-epic-loop.md) | The epic loop: conductor, implementers, code reviewer, bug fixes, merge by risk class, the owner's choice of merges without them | high | T3a | in progress |
| [T4](epics/T4-release-qa.md) | Release and QA: tags, changelog, staging, qa agent, bugs and lessons, owner calls | normal | T3b | planned |
| [T5](epics/T5-validation.md) | Validation on three systems: lite, standard, full | normal | T4 | planned |
| [T6](epics/T6-adopt-existing-project.md) | Adopt an existing project: lay out only what is missing, keep what is there | normal | T1 | planned |

Status: planned, in progress, in review, merged, released.
