# Epics

pitwall is built with its own process: epics in order, no dates, one PR each.

| Epic | Goal | Risk | Depends on | Status |
| --- | --- | --- | --- | --- |
| [T0](epics/T0-skeleton.md) | Marketplace, plugin skeleton, project template, checks and CI | normal | - | merged (#1) |
| [T1](epics/T1-stages-0-2.md) | Stages 0 to 2: kickoff, discovery, decide, researcher | normal | T0 | merged (#2) |
| [T2](epics/T2-stages-3-5.md) | Stages 3 to 5: spike, plan, plan-reviewer, the plan PR's review and merge | normal | T1 | merged (#3) |
| [T3a](epics/T3a-hooks.md) | Hooks: session brief, guards on secrets and pushes, the review and merge guards, call budgets, checks after edits and before stopping | high | T2 | merged (#4) |
| [T3b](epics/T3b-epic-loop.md) | The epic loop: conductor, implementers, code reviewer, bug fixes, merge by risk class, the owner's choice of merges without them | high | T3a | merged (#5) |
| [T4a](epics/T4a-guards-and-process.md) | Guards and process follow-ups: the hook that keeps uncommitted work, owner calls, the headless runs' snapshots and unscripted stops | high | T3b | merged (#6) |
| [T4b](epics/T4b-bugs-and-lessons.md) | Bugs and lessons: severity and a queue by it, every fix after the owner's yes, lessons that become guards | high | T4a | merged (#7) |
| [T4d](epics/T4d-commit-gate.md) | The gate before every commit (L-14), with the guard's rule on skipping it, in projects and in pitwall itself | high | T4b | merged (#8) |
| [T4c](epics/T4c-release-and-qa.md) | Releases and a minimal QA: tags and changelog from merge commits, the lite level's local build, a qa agent for the closed epics' criteria | high | T4d | merged (#9) |
| [T5a](epics/T5a-lite-reminder.md) | Validation on the lite system: the move reminder, from scratch to its first merged epic, and the plugin changes the run asked for | normal | T4c | merged (#10) |
| [T6](epics/T6-adopt-existing-project.md) | Adopt an existing project: lay out only what is missing, keep what is there | normal | T5a | merged (#11) |
| [T7](epics/T7-guard-corpus.md) | The guard's corpus run before each review round (L-13), and the open bugs fixed with it | high | T6 | merged (#12) |
| [T5b](epics/T5b-full-last-ones-down.md) | Validation on the full system: Last Ones Down, adopted after a dry run, to a release | normal | T7 | planned |
| [T8](epics/T8-staging-and-serving-by-tag.md) | Staging by type of application, QA in a browser, pitwall served by tag | high | T7 | planned |

1.0.0 is released: T0 to T7, as they merged, with the tag `pitwall--v1.0.0` (owner, 2026-11-14). After 1.0: T5b and T8 above; BUG-9 and BUG-11 to BUG-13 in [BUGS.md](BUGS.md); what the standard and full levels of the SPEC name and no epic holds yet, QA after every merge and a deployment to production with its smoke check; an estimate of the cost before a paid run, which the README promised; and a probe of the hooks on Windows without Git Bash, where a user-scope install might refuse every tool call in every project, since each hook starts in bash and the guard's failure blocks (all found while writing the README of 1.0).

Status: planned, in progress, in review, merged, released.
