# T5a - Validation on the lite system: the move reminder

Goal: a small idea walks the whole path with pitwall from scratch to a release without drowning in process, and the plugin changes after the run.
Depends on: T4c
Risk class: normal

## Acceptance criteria

- [ ] T5a-AC1: The move reminder, laid out by `/pitwall:kickoff` from pitwall installed from its marketplace at its latest tag, in a new empty public repository the owner creates on GitHub, walks discovery, decide, the plan (a spike if one is needed), the epic loop and `/pitwall:release` to a tagged version with a changelog, in the owner's own interactive sessions. Kickoff protects `main` with branch protection, admins included: the first project to take that path (owner, 2026-11-13).
- [ ] T5a-AC2: The release holds a build for Windows and one for macOS. The first time by hand: the qa agent builds and checks the release on the Windows laptop as T4c does, and on the Mac the owner runs the project's `scripts/build <version>` and `gh release upload v<x.y.z> <the artifacts>`, an item of their manual checklist. A tool for the second machine (`release.mjs --build --at`) is built only once the hand-made way proves awkward (owner, 2026-11-13).
- [ ] T5a-AC3: The run's numbers in pitwall's `docs/JOURNAL.md`, per stage and per change: the owner's questions and the unnecessary ones, interventions, sub-agent calls, tokens and, where known, money, review rounds with blocking findings and repeats, bugs after a merge and after the release, and the plugin changes. They are taken after the run, from the project's local transcripts, by a script of pitwall's own, `scripts/run-stats.mjs`, not part of the plugin, written then and before the journal entry, with the owner's marks of unnecessary questions and interventions. Headless runs of pitwall's fixes keep printing UNSCRIPTED QUESTION lines (T3b) (owner, 2026-11-13).
- [ ] T5a-AC4: Every plugin change the run finds ships as a version. A defect of pitwall that stops the run is filed in pitwall's `docs/BUGS.md` and fixed through pitwall's own loop as a patch version with its tag before the run goes on (`claude plugin update` in the project); every other change collects on T5a's branch and ships with T5a's version, before T5b (owner, 2026-11-13).

## Decisions

One-way (2026-11-12): T5 is split in two systems, not three (owner): the lite one here, from scratch, and the full one, Last Ones Down, adopted (T5b), after T6. The standard system of the first plan is dropped.

One-way, the owner's answers of 2026-11-13 to the questions the agent put when T5a started:
- A release built on two machines: by hand the first time (AC2); nothing is built for it beforehand.
- The run's numbers: `scripts/run-stats.mjs` is written after the run, from the transcripts (AC3). Claude Code deletes local transcripts after `cleanupPeriodDays`, 30 by default; it was raised to 365 in the owner's user settings before the run, so that a long run keeps them all.
- A defect of pitwall found in the run: as the agent proposed (AC4).
- The reminder's repository: public, with branch protection; it is the owner's portfolio, and it tests the path of protection no project has taken through kickoff (AC1). The owner creates it, empty.

Two-way, picked by the agent and accepted by the owner as a list on 2026-11-13:

| Area | Choice | Why, in one line |
| --- | --- | --- |
| Plugin | Installed from pitwall's marketplace on GitHub (`/plugin marketplace add Perchusha/pitwall`), at 0.9.0 now; a patch reaches the project with `claude plugin update` | The way a user gets it; the headless runs already cover `--plugin-dir` |
| Machines | The Windows laptop for the sessions, reviews and the release; the Mac for its build and its manual QA | One machine conducts; the other builds and checks what only it can |
| Sessions | The owner's own interactive sessions, at the owner's pace, not the headless harness | The run measures a real owner; the harness stays the regression of pitwall's fixes |
| Records | T5a's entry in pitwall's journal, one table per stage and per change; the reminder keeps its own journal as pitwall writes it | Pitwall's numbers in pitwall, the project's in the project |
| Where the work lands | Pitwall's code on T5a's branch (the run-stats script after the run, collected fixes); the reminder in its own repository | Two repositories, one PR here at the end |
| Version | A patch per fix that stops the run; T5a's own minor at its end | AC4 |

Nothing is built in pitwall before the run starts (owner, 2026-11-13).

## Out of scope

- The standard level: not validated before 1.0; the first real standard project after 1.0 checks it (owner, 2026-11-12).
- Staging by type of application and QA in a browser (T8).
- A tool for the second machine's build, until the hand-made way proves awkward.

## Open questions

None.
