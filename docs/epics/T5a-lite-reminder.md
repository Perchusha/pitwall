# T5a - Validation on the lite system: the move reminder

Goal: a small idea walks the path with pitwall from scratch to its first merged epic without drowning in process, and the plugin changes after the run.
Depends on: T4c
Risk class: normal
ADR: ADR-0010

## Acceptance criteria

- [ ] T5a-AC1: The move reminder, laid out by `/pitwall:kickoff` from pitwall installed from its marketplace at 0.9.0, in a new empty public repository the owner created on GitHub, walks kickoff, discovery, decide, a spike, the plan with its review and the epic loop up to its first merged epic, E0, in the owner's own interactive session. Kickoff protects `main` with branch protection, admins included: the first project to take that path. The run ends there (owner, 2026-11-13): the first session gave the data this validation was for, and the path from merged epics to a tagged release is checked by the headless `release` stage (AC2), not by a release of the reminder.
- [ ] T5a-AC2: The path of a release is checked on T5a's version by the headless run `node scripts/e2e.mjs --from release`, from the states the runs of AC5 saved (owner, 2026-11-13). A build on two machines is no longer part of it: the reminder became a Windows app in its discovery.
- [ ] T5a-AC3: The first session's numbers in pitwall's `docs/JOURNAL.md`, per stage: the owner's questions and the unnecessary ones, the messages they typed outside the questions, the time spent waiting for them, sub-agent calls, tokens and the session's cost, the review rounds with their findings, and the plugin changes. They are taken from the project's local transcript by a script of pitwall's own, `scripts/run-stats.mjs`, not part of the plugin, with the marks of unnecessary questions and interventions in a file of its own. Headless runs of pitwall's fixes keep printing UNSCRIPTED QUESTION lines (T3b).
- [ ] T5a-AC4: The plugin changes the run asked for ship as one version, 0.10.0 (owner, 2026-11-13):
  - `/pitwall:continue` conducts the whole path: stage 0 in a new folder, each planning stage by its own skill, one question before the next stage, then the epic loop; the template's `CLAUDE.md` turns the owner's "continue" into it.
  - The session runs `merge-choice.mjs` itself, only through Claude Code's permission prompt and never through an allow rule (ADR-0010, amended).
  - What the agent only inferred goes to the owner as one list to confirm, not as a question each (the constraints of discovery, the launch questions of the plan).
  - At the lite level the plan review has three rounds at most, and the reviewer's notes after its approval go to the implementers without a question to the owner.
  - The plan's hand-over and every manual QA say what each epic makes visible in the product.
  - Kickoff asks the project's name in plain text or with two real options.
  - The project of the headless runs has a name of its own, so that the app they build writes nothing into the folders of the owner's reminder.
- [ ] T5a-AC5: The changes are checked by headless runs on the branch's head: the planning stages through the conductor (`node scripts/e2e.mjs --until plan`), E0 and E1 (`--from e0`), the bug stage (`--from bug`), the release stage (`--from release`) and the hooks (`--hooks`). The review of the epic stops after three rounds.

## Decisions

One-way (2026-11-12): T5 is split in two systems, not three (owner): the lite one here, from scratch, and the full one, Last Ones Down, adopted (T5b), after T6. The standard system of the first plan is dropped.

One-way, the owner's answers of 2026-11-13 to the questions the agent put when T5a started:
- A release built on two machines: by hand the first time; nothing is built for it beforehand. Superseded the same day: the run ends at E0 (below).
- The run's numbers: `scripts/run-stats.mjs` is written after the run, from the transcripts (AC3). Claude Code deletes local transcripts after `cleanupPeriodDays`, 30 by default; it was raised to 365 in the owner's user settings before the run, so that a long run keeps them all.
- A defect of pitwall found in the run: one that stops the run is a patch version through pitwall's own loop; every other change collects on T5a's branch. None stopped the run.
- The reminder's repository: public, with branch protection; it is the owner's portfolio, and it tests the path of protection no project has taken through kickoff (AC1). The owner created it, empty.

One-way, the owner's decisions of 2026-11-13 after the first session (kickoff to E0 merged, one session of 4.5 hours):
- No more testing by hand: T5a closes on the first session's data. AC1 ends at the first merged epic, and the path of a release is checked by the headless `release` stage.
- The fixes of AC4, as one version, 0.10.0, checked by headless runs, the planning stages too, since the conductor now leads them; the review stops after three rounds.
- The order after T5a: T6, checked by a headless run on a test repository, without the owner; then T7 with the guard's bugs; 1.0 after T5a, T6 and T7; T5b and T8 after 1.0 (`docs/EPICS.md`).
- The owner is brought only what cannot be decided without them, as a short list.

Two-way, picked by the agent while building AC4 (2026-11-13); each is cheap to change:

| Area | Choice | Why, in one line |
| --- | --- | --- |
| How the conductor runs a stage | It reads the stage's `SKILL.md` and follows it; only `continue` can be started by the model | One entry point; the stage skills stay commands of the owner's, and their descriptions stay out of every session's context |
| How the owner's "continue" reaches it | A rule in the template's `CLAUDE.md`, and the skill's own description | Probed on Claude Code 2.1.323: a headless session whose owner says only "continue" calls the skill by itself |
| The guard's answer to `merge-choice.mjs` | `ask`, for the script alone in its call; under Claude Code the script runs only on the guard's note of that prompt, once | Probed on 2.1.323: a hook's `ask` is not answered by an allow rule, nor by auto mode; the note keeps the script shut when the hooks are off |
| A session whose mode never prompts | Refused (`hooks.noPromptModes`), and the command handed to the owner | Whether a hook's `ask` prompts under `bypassPermissions` is not documented, and auto mode refused to let the probe run it |
| Where the reviewer's notes live | `docs/PLAN-REVIEW.md`, a section "Notes for the implementers", optional for projects laid out before it | The reviewer's own file: no commit after the reviewed one, so no extra round |
| The plan review at lite | Two full rounds, then one last round that only records (`processLevels.lite.planReviewRounds`) | Three rounds in all, as the owner set; the run's five rounds took 56 minutes |
| What an epic makes visible | A line `Visible after it:` in the epic's file, written by the plan, not required by the docs check | State in the repository, and older projects stay valid |
| The headless runs' project | `pitwall-e2e-reminder` | Its app data cannot be taken for the owner's reminder |
| An installed pitwall and the headless runs | Refused only when installed for every project | Probed: a copy installed for another project alone does not load in the test project |

Nothing was built in pitwall before the run started (owner, 2026-11-13).

## Out of scope

- The standard level: not validated before 1.0; the first real standard project after 1.0 checks it (owner, 2026-11-12).
- The reminder's later epics and its release: the owner goes on with it, or not, outside this epic.
- Staging by type of application and QA in a browser (T8).
- `BUG-7`, kickoff replacing a global `core.hooksPath`: it waits with the other bugs that are not blocking.

## Open questions

None.
