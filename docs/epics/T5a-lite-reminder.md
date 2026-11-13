# T5a - Validation on the lite system: the move reminder

Goal: a small idea walks the whole path with pitwall from scratch to a release without drowning in process, and the plugin changes after the run.
Depends on: T4c
Risk class: normal

## Acceptance criteria (draft, refined when T5a starts)

- [ ] T5a-AC1: The lite system, a desktop app for one user that reminds them to stand up and move, built from scratch with pitwall, reaches a release: a tag, a changelog and a local build (T4c).
- [ ] T5a-AC2: The run records in `docs/JOURNAL.md`: owner questions and unnecessary ones, interventions, calls, tokens and money per epic, blocking findings and repeats, bugs after merge and in production, plugin changes. The headless runs print every question the scripted owner had no answer for as an UNSCRIPTED QUESTION line and keep them with each stage's numbers: an input for the count of questions (T3b).
- [ ] T5a-AC3: Every plugin change the run finds ships as a version before the next run.

## Decisions

One-way (2026-11-12): T5 is split in two systems, not three (owner): the lite one here, from scratch, and the full one, Last Ones Down, adopted (T5b), after T6. The standard system of the first plan is dropped.

## Out of scope

- The standard level: not validated before 1.0; the first real standard project after 1.0 checks it (owner, 2026-11-12).
- Staging by type of application and QA in a browser (T8).

## Open questions

- The first question when T5a starts (owner, 2026-11-12): the reminder runs on Windows and macOS, and its macOS build is made only on a Mac, so a release is built on two machines. `release.mjs --tag` refuses in a clone where the qa agent recorded no build (T4c), and the qa agent builds on one machine. How does a release record and hand over the build of the other machine?
