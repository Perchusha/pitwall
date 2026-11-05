# T5 - Validation on three systems

Goal: three systems of rising complexity walk the whole path, and the plugin changes after each run.
Depends on: T4
Risk class: normal

## Acceptance criteria (draft, refined when T5 starts)

- [ ] T5-AC1: A lite system (a desktop move-reminder app) reaches a release.
- [ ] T5-AC2: A standard system (a money tracker rebuilt from scratch) reaches a release.
- [ ] T5-AC3: A full system, chosen after the standard run, reaches a release.
- [ ] T5-AC4: Each run records in `docs/JOURNAL.md`: owner questions and unnecessary ones, interventions, calls, tokens and money per epic, blocking findings and repeats, bugs after merge and in production, plugin changes.
- [ ] T5-AC5: Every plugin change found by a run ships as a version before the next run.
