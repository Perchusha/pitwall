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

### Proposed, awaiting owner (2026-11-13)

Proposed by the agent when T5a started. Nothing here is decided until the owner answers.

**Questions** (the first is the owner's own, from T4c):

1. A release built on two machines. Recommended: the qa agent builds and checks the release on one machine, as now; the other system's build is a step of its own after the owner's tag, `release.mjs --build --at v<x.y.z>` on the other machine, with the tag checked out in a clean tree (`git switch --detach v<x.y.z>`): it runs the same `scripts/build <version>`, checks its artifacts, refuses when the tagged code is not what the release's merge holds, and hands the owner `gh release upload v<x.y.z> <its artifacts>`. The qa agent's checklist names the other system's build and its run as a manual item. Other options: the release waits before its merge for a build record from both machines (records live in each clone's git directory, so one would have to travel); or CI builds both systems (a macOS runner, which is T8's staging by type).
2. How the run's numbers are taken (AC2). Recommended: a script of pitwall's own, `scripts/run-stats.mjs <project folder>`, not part of the plugin, reads the project's local Claude Code transcripts and prints per branch (a planning stage, an epic, a fix, a release): sessions, the owner's messages, the questions the main conversation asked, the sub-agents with their tool calls, and tokens by kind; the owner marks the questions they find unnecessary and their interventions on its list. Money: Claude Code reports it only for headless runs, so the interactive run counts tokens, and money where the owner reads it. Other option: the owner keeps a tally by hand.
3. A defect of pitwall the run finds (AC3). Recommended: one that stops the run is filed in pitwall's `docs/BUGS.md` and fixed through pitwall's own loop, a patch version and its tag, before the run goes on (`claude plugin update` in the project); every other change collects on T5a's branch and ships with T5a's version, before T5b. Other option: every change ships at once as a patch.
4. The reminder's repository: a new empty one the owner creates on GitHub. Private on GitHub Free (merge protection `local-hook`, as the headless runs had it) or public (branch protection with admins included, never yet run for a project). Recommended: private, as the owner's own app.

**The criteria as proposed:**

- T5a-AC1: The move reminder, laid out by `/pitwall:kickoff` from pitwall installed from its marketplace at its latest tag, in the owner's new repository, walks discovery, decide, the plan (a spike if one is needed), the epic loop and `/pitwall:release` to a tagged version with a changelog and a build for Windows and one for macOS, in the owner's own interactive sessions.
- T5a-AC2: The run's numbers in pitwall's `docs/JOURNAL.md`, per stage and per change, from `scripts/run-stats.mjs` and the owner's marks (question 2): the owner's questions and the unnecessary ones, interventions, sub-agent calls, tokens and, where known, money, review rounds with blocking findings and repeats, bugs after a merge and after the release, and the plugin changes. Headless runs of pitwall's fixes keep printing UNSCRIPTED QUESTION lines (T3b).
- T5a-AC3: Every plugin change the run finds ships as a version: one that stops the run before it goes on, the others with T5a's version (question 3).
- T5a-AC4: The release built on two machines (question 1), checked in `scripts/check.mjs` on a scratch repository and in the run itself.

**Two-way, picked by the agent:**

| Area | Choice | Why, in one line |
| --- | --- | --- |
| Plugin | Installed from pitwall's marketplace on GitHub (`/plugin marketplace add Perchusha/pitwall`), at 0.9.0 now; a patch reaches the project with `claude plugin update` | The way a user gets it; the headless runs already cover `--plugin-dir` |
| Machines | The Windows laptop for the sessions, reviews and the release; the Mac for its build and its manual QA | One machine conducts; the other builds and checks what only it can |
| Sessions | The owner's own interactive sessions, at the owner's pace, not the headless harness | The run measures a real owner; the harness stays the regression of pitwall's fixes |
| Records | T5a's entry in pitwall's journal, one table per stage and per change; the reminder keeps its own journal as pitwall writes it | Pitwall's numbers in pitwall, the project's in the project |
| Where the work lands | Pitwall's code on T5a's branch (the run-stats script, the second machine's build, collected fixes); the reminder in its own repository | Two repositories, one PR here at the end |
| Version | A patch per fix that stops the run; T5a's own minor at its end | AC3 |

## Out of scope

- The standard level: not validated before 1.0; the first real standard project after 1.0 checks it (owner, 2026-11-12).
- Staging by type of application and QA in a browser (T8).

## Open questions

- The first question when T5a starts (owner, 2026-11-12): the reminder runs on Windows and macOS, and its macOS build is made only on a Mac, so a release is built on two machines. `release.mjs --tag` refuses in a clone where the qa agent recorded no build (T4c), and the qa agent builds on one machine. How does a release record and hand over the build of the other machine?
