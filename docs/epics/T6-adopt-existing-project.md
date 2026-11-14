# T6 - Adopt an existing project

Goal: pitwall starts in a repository that already has code or docs: it lays out only what is missing, keeps what is there and starts at the stage the project has actually reached.
Depends on: T5a
Risk class: normal
ADR: ADR-0006

## Acceptance criteria

- [ ] T6-AC1: `/pitwall:adopt`, which `/pitwall:continue` runs in a folder that holds a project and no `.claude/pitwall.json`, lists every template path the project already has, and no file of the project is ever overwritten: `adopt.mjs` writes only paths the project lacks, and a file the project has changes only by an addition the owner said yes to.
- [ ] T6-AC2: The project's own documents are mapped onto the template's sections: `docs/IDEA.md` and the documents of the stages before the one the project starts from are filled from them, each part naming the file it comes from, the sections a kept document lacks are added to it, and what nothing answers becomes a list of questions for the owner.
- [ ] T6-AC3: The project's real checks become its `scripts/gate`, written by `adopt.mjs --gate` from the commands the owner confirmed: it is green only while they pass, and the docs check refuses an adopted project whose gate is still the template's stub.
- [ ] T6-AC4: `.claude/pitwall.json` records the stage the project starts from, `startStage`, one of discovery, decide and plan: the docs checks of the stages before it are skipped, and the session brief and `/pitwall:continue` start there. Merge protection is set up as kickoff does it, when the owner says so.
- [ ] T6-AC5: A dry run comes first and changes nothing: it lists what the adoption would add and keep, and how the project's own plan (a `ROADMAP.md`, for one) maps onto `docs/EPICS.md`. The owner decides from that list what pitwall's documents replace, and nothing is written before their yes to the adoption as listed, so a project never has two plans or two conductors (owner, 2026-11-12; T5b).
- [ ] T6-AC6: A headless run adopts a test project that exists already (`node scripts/e2e.mjs --from adopt`), and a second one takes it through the plan stage (`--from adopt-plan`): nothing written before the scripted owner's yes, every file the project had kept, the adoption one commit on the planning branch with `main` unmoved, the gate red once a test of the project is broken, and the open items of its roadmap turned into reviewed epics after E0 (owner, 2026-11-13: checked by a headless run on a test repository, without them).

## Decisions

One-way (2026-11-12): a dry run comes first, and there are never two plans or two conductors (owner; AC5).

One-way (2026-11-13): T6 comes right after T5a and before T7 and 1.0, built and checked by a headless run on a test repository without the owner (owner).

Two-way, picked by the agent while building (2026-11-13), the owner away by their own word; each is cheap to change, and T5b, the adoption of a real project, will test them:

| Area | Choice | Why, in one line |
| --- | --- | --- |
| Where the adoption lands | One commit on the planning branch; `main` moves only with the plan's PR | An existing project's `main` may be protected already, and the adoption is a change like any other |
| The stages an adopted project may start from | discovery, decide or plan (`adopt.stages`), never the loop | pitwall's loop reads `docs/EPICS.md` and a reviewed plan: the project's own plan is the input of the plan stage, not a substitute for it |
| The stages before the start | Their documents are filled from the project's own as far as those go, and their docs checks are skipped | They were done before pitwall, in the project's own way: a check would only make the agent write what passes |
| The project's plan file | `planFile` in `.claude/pitwall.json`; it gets one line that points to `docs/EPICS.md` and is history from then on | Never two plans, and nothing of the owner's is deleted |
| An owner who wants their own file to stay the plan | The adoption stops | Two plans drift apart, which is what T5b's criterion rules out |
| The gate | Generated from two lists, fast and full, which the owner confirms; it replaces only the template's stub or a gate `adopt.mjs` wrote | The plugin never assumes a stack: the manifests and the CI only propose |
| The project's own CI | Kept; the check named `gate` gets a workflow of its own, `adopt.gateWorkflow` | Never overwrite; branch protection needs that name |
| `.gitattributes`, `.gitignore`, `.editorconfig` | Narrow ones for pitwall's own paths, or none | The template's act on every file of a project: right for a new one, a silent rewrite of an existing one |
| A repository whose branch is not `main` | A blocker in the dry run, with the commands that rename it | The guarded branch is one setting of the plugin, not a per-project one, until a project needs otherwise |
| The project's own Claude Code settings | Kept, with a note of what the template's hold | The guard keeps agents out of that file |
| New keys of `.claude/pitwall.json` | `startStage`, `planFile` and `ownDocs`, only in an adopted project | Additions to the contract of ADR-0006, which older projects do not need |
| The project's own files in `docs/adr/`, `docs/epics/`, `docs/spikes/`, `docs/reviews/` | Kept, listed in `ownDocs`, left alone by the docs check; their IDs still resolve and their ADR numbers still count | A decision written years ago in another format cannot honestly be rewritten to pitwall's template (review round 1) |
| A path pitwall must commit that the project's ignore rules ignore | A blocker of the dry run, and `--write` refuses | Otherwise the adoption's commit leaves it out and the adoption can never finish (review round 1) |
| The check named `gate` in CI | Every adoption adds the toolchain and dependency setup to the gate's workflow, from the project's workflows or one question | The plan's PR merges only on a green `gate`, which a bare runner cannot give a project with dependencies (review round 1) |
| A session on `main`, or a new clone, during the adoption | The dry run and the conductor find the adoption on the planning branch, here or on origin, and switch to it | The adoption lives there until the plan merges (review round 1) |

## Out of scope

- A project whose default branch is not `main`, beyond naming the blocker.
- Merging the template's Claude Code settings into the project's own.
- Starting an adopted project inside the epic loop, with epics already in flight.
- Monorepos with several products: one plan per repository.

## Open questions

None.
