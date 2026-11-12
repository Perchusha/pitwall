# T5b - Validation on the full system: Last Ones Down, adopted

Goal: pitwall takes over an existing project at the full level, Last Ones Down, without a second plan or a second conductor, and carries it to a release; the plugin changes after the run.
Depends on: T5a, T6
Risk class: normal

## Acceptance criteria (draft, refined when T5b starts)

- [ ] T5b-AC1: The adoption of Last Ones Down starts with a dry run of T6's adopt flow: it shows what pitwall would add and how the project's `ROADMAP.md` maps onto `docs/EPICS.md`, and changes nothing. There are never two conductors or two plans: from that list the owner decides what pitwall's documents replace (owner, 2026-11-12).
- [ ] T5b-AC2: Last Ones Down, at the full level, reaches a release through pitwall's loop, its own path to Steam kept.
- [ ] T5b-AC3: The run records what T5a-AC2 names.
- [ ] T5b-AC4: Every plugin change the run finds ships as a version before the next run.

## Decisions

One-way (2026-11-12): the full system of T5 is Last Ones Down, an existing project pitwall adopts, after T6 and after the lite run (owner).

## Out of scope

- The standard level: not validated before 1.0; the first real standard project after 1.0 checks it (owner, 2026-11-12).
- Staging by type of application and QA in a browser (T8); Last Ones Down's own path to Steam.

## Open questions

None.
