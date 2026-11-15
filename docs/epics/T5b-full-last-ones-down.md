# T5b - Validation on the full system: Last Ones Down, adopted

Goal: pitwall takes over an existing project at the full level, Last Ones Down, without a second plan or a second conductor, and carries it to a release; the plugin changes after the run.
Depends on: T7
Risk class: normal

## Acceptance criteria (draft, refined when T5b starts)

- [ ] T5b-AC1: The adoption of Last Ones Down starts with a dry run of T6's adopt flow: it shows what pitwall would add and how the project's `ROADMAP.md` maps onto `docs/EPICS.md`, and changes nothing. There are never two conductors or two plans: from that list the owner decides what pitwall's documents replace (owner, 2026-11-12). Done (2026-11-15): the list is in "The dry run of T5b-AC1" below, and the project did not change.
- [ ] T5b-AC2: Last Ones Down, at the full level, reaches a release through pitwall's loop, its own path to Steam kept. Dropped (owner, 2026-11-15): Last Ones Down is not adopted.
- [ ] T5b-AC3: The run records what T5a-AC3 names. Dropped with AC2 (owner, 2026-11-15): there is no run past the dry run to record.
- [ ] T5b-AC4: Every plugin change the run finds ships as a version before the next run. Changed (owner, 2026-11-15): the dry run's seven findings are filed as BUG-16 to BUG-22, not blocking, and fixed when the owner says; 1.0.3 ships them with the README's limits, and changes no code.

## Decisions

One-way (2026-11-15): T5b closes at its dry run, and Last Ones Down is not adopted. It has a working system of its own, and what the adoption would bring does not pay off there: a CI that pitwall requires on a private repository on GitHub Free, with Windows runners, and a gate of 7 to 13 minutes run before every commit, after every edit and before every stop (owner). The seven findings of the dry run are filed as BUG-16 to BUG-22, all not blocking, in one session; the README's limits say that the adoption is built for a project with no agent process of its own and a gate of a few minutes, and that the full level has not run on a real project; 1.0.3 releases this with docs and bugs only, no code changed. Then pitwall pauses: T8 and the bugs wait for the owner's word (owner).

One-way (2026-11-13): T5b comes after 1.0, which ships after T5a, T6 and T7 (owner).

One-way (2026-11-12): the full system of T5 is Last Ones Down, an existing project pitwall adopts, after T6 and after the lite run (owner).

## Out of scope

- The standard level: not validated before 1.0; the first real standard project after 1.0 checks it (owner, 2026-11-12).
- Staging by type of application and QA in a browser (T8); Last Ones Down's own path to Steam.

## Open questions

- Answered (2026-11-14): the owner renames `master` to `main` in Last Ones Down before T5b (nothing there uses the branch by name); a guarded branch per project is not built before 1.0, and T6's dry run names a default branch other than `main` with the steps of the rename. The question as it was put: Last Ones Down's default branch is `master`, and pitwall guards `main` in every project (`mergeProtection.branch`), so T6's adoption stops with a blocker there and names the commands that rename it. Either the owner renames `master` to `main` before T5b (its CI, any deploy, open PRs and each clone follow the rename), or pitwall learns a guarded branch per project, a key of `.claude/pitwall.json` read by the guard, `protect.mjs`, `merge.mjs`, `release.mjs` and the brief, a minor version after 1.0. The agent's recommendation: rename, since nothing in pitwall changes and T5b tests the path every other project takes.

### The dry run of T5b-AC1 (2026-11-15)

`adopt.mjs --dry-run` of pitwall 1.0.2 ran on Last Ones Down at `d112a83d` (branch `main`, 1849 tracked files, 1528 commits) and wrote nothing: `git status` was empty before and after. What follows is the list the owner decided from, kept as it was put: the owner closed T5b on it (Decisions, 2026-11-15), so the proposals below were not taken.

**What the dry run reports.**

- BLOCKER: `CLAUDE.md` has 276 lines; with the 40 lines of the five template sections it lacks ("Current state", "Architecture boundaries", "Definition of done", "How to work", "Never") it would have about 316, over the docs check's 200.
- ADD, 26 paths: `.claude/pitwall.json`, `.githooks/pre-commit`, `.github/pull_request_template.md`, `.github/workflows/ci.yml`, `.gitattributes` (pitwall's scripts only), `CHANGELOG.md`, `scripts/gate`, `scripts/build`, and under `docs/`: `EPICS.md`, `epics/E0-skeleton.md`, `IDEA.md`, `DISCOVERY.md`, `STACK.md`, `SPEC.md`, `BUGS.md`, `RISKS.md`, `LESSONS.md`, `JOURNAL.md`, `INDEX.md`, `PLAN-REVIEW.md`, `adr/0000-template.md`, `archive/README.md`, and `reviews/` and `spikes/` with their templates.
- KEEP: `CLAUDE.md`, `.claude/settings.json`, `.editorconfig`, `.gitignore`, and the 33 files under `docs/` as the project's own.
- PLAN: `ROADMAP.md` (445 checkbox items, 310 open) and `docs/archive/ROADMAP-closed.md` (710, all done).
- CHECK: `yarn run lint`, `yarn run typecheck`, `yarn test`, `yarn run build`. No CI and no git hooks.

**What it does not see**, read by hand. Each is a plugin finding for T5b-AC4, filed as BUG-16 to BUG-22 in this order:

1. The project's own conductor: eleven skills `.claude/skills/lod-*` and two agents `.claude/agents/lod-lane*`. `lod-continue` claims "continue" as `/pitwall:continue` does, and "Start here" in `CLAUDE.md` sends every "continue" to it. The dry run names none of them, and `adopt` never deletes a file, so it cannot retire one.
2. Three Claude Code hooks in `.claude/settings.json`: a SessionStart brief, a PreToolUse budget check of `ROADMAP.md` on commits, and a PostToolUse call budget at 100/120 and 250/300, pitwall's own numbers. The dry run's hooks section is empty: it reads git hooks only.
3. The project's own gate, `node tools/gate.mjs`: 11 steps (lint, knip, both typechecks, tests, the client's typecheck and bundle, the preload sandbox, the headless match smoke, the harness tests, the visual ratchet), 5 of them with `--fast`, and `CLAUDE.md` names it the only gate. The dry run proposes four `package.json` scripts instead.
4. `ADD docs/SPEC.md` beside the root `SPEC.md`, the owner's canonical design, with no NOTE: a second spec.
5. `docs/archive/ROADMAP-closed.md`, the archive of the same plan with nothing open, is reported as a second plan.
6. The gate `adopt.mjs` writes runs the full list for `--changed`; the Stop hook runs `--changed` with a limit of 540 s, and `--fast` runs after every edit with a limit of 120 s. With this project's gate (about 13 min full and 7 min fast, as `lod-gate` measured it), every stop waits 540 s and every edit 120 s for a timeout, unless the lists are cut to what fits.
7. Items without a checkbox (B-5 to B-8, Y-1 to Y-4, the playtest batches) are not counted: 445 is a lower bound.

**What collides with pitwall's workflow**, from `CLAUDE.md` and the `lod-*` skills:

- Every change is committed on `main`, by the conductor and by the owner's own sessions alike (`lod-design-round`, `lod-model`, `lod-pool`, `lod-logs`, the record of `lod-ship`); pitwall's guard refuses a push to `main`, and every change goes through a branch, a PR and `ai-review`.
- No CI, by the owner's ruling (GitHub Actions removed 2026-09-10); pitwall merges nothing without the check named `gate` from GitHub Actions, in either protection mode. The repository is private, so branch protection depends on the account's plan (`protect.mjs` falls back to `local-hook`).
- The gate is asleep during Epic M (OQ-73): 47 client reds, no tests and no new tests until Epic Y; pitwall runs `scripts/gate --fast` before every commit and after every edit, and its definition of done asks for tests.
- Bugs and follow-ups live in `ROADMAP.md` `## Open` (80 open), and `lod-logs` files a playtest's findings as P-n items and builds them in the same session; pitwall files BUG-n in `docs/BUGS.md` with a severity, and every fix waits for the owner's yes.
- Decisions live in `docs/OPEN_QUESTIONS.md` (OQ-n, cited by code); pitwall's are ADRs in `docs/adr/` and the Decisions of an epic file.
- The definition of done and the lanes live in `docs/AAA_BRIEF.md` sections 7 and 8; pitwall adds a "Definition of done" of its own to `CLAUDE.md`.

**The `lod-*` parts, proposed:**

| Part | pitwall's counterpart | Proposed |
| --- | --- | --- |
| `lod-continue` | `/pitwall:continue` | replaced |
| `lod-lane`, with the agents `lod-lane` (high) and `lod-lane-deep` (xhigh) | the `epic` skill, with `implementer` and `implementer-deep` by risk class | replaced; the project knowledge in it (content batches through `tools/content-apply.mjs`, the frozen pack, measuring with the harness, reading new copy, the lanes of `AAA_BRIEF.md` section 7) moves into the docs |
| `lod-gate` | `/pitwall:gate` over `scripts/gate`, which calls `tools/gate.mjs` | the skill replaced, the tool kept |
| `lod-checkpoint` | the loop's record: `docs/EPICS.md`, `docs/JOURNAL.md`, the PR | replaced |
| `lod-owner-calls`, with `tools/owner-calls.mjs` | `/pitwall:owner-calls` | replaced; the OQ defaults that wait for the owner need a place it reads |
| the hooks `session-brief.mjs`, `call-budget.mjs`, `roadmap-check.mjs` | pitwall's brief and call budgets; `ROADMAP.md` becomes history | removed |
| `lod-critic` | none: the code reviewer reads diffs, not frames | kept, as a criterion of a visual epic |
| `lod-design-round`, `lod-model`, `lod-pool` | none | kept, the owner's sessions; what they record goes through a branch |
| `lod-logs` | `/pitwall:bug` | kept for reading the zips (`tools/bugs.mjs`); what it finds is filed as BUG-n, not built in the same session |
| `lod-ship` | `/pitwall:release`: the version, the changelog, `scripts/build`, the tag | kept, as the deployment after a release: the path to Steam stays the project's (T5b-AC2) |

**`ROADMAP.md` onto `docs/EPICS.md`, proposed.** The epics are written and reviewed at the plan stage, where a large ROADMAP epic splits into epics of one PR each.

| ROADMAP | State | Becomes |
| --- | --- | --- |
| Epics A, S, F, V, X, L (the owner's balance round); C1, C5, C6, C8, C9; H1, H2, H4, H5, H7; J4 to J6; the done items of every other epic; the 710 lines of `ROADMAP-closed.md` | done | history in `docs/JOURNAL.md` |
| What the contract lacks | - | E0: `scripts/gate` over `tools/gate.mjs`, the check named `gate` in CI, `scripts/build` (`yarn typecheck`, then `yarn workspace @lod/client dist`, the artifact `apps/client/release/win-unpacked/`), the commands in `CLAUDE.md`, the knowledge of the replaced skills in the docs |
| M, models in Blender (now) | M-5 to M-8, M-6a to M-6c, M-9, M-10 open | epics: the rows, the placement, M-9 with M-10 |
| Z, the Imposter (beside M) | Z-1 to Z-12, Z-14, Z-16 to Z-19, Z-31 to Z-33 done | epics: stage C (Z-20, Z-21), stage D (Z-22 to Z-27), stage E (Z-30); Z-0, Z-13 and Z-15 are the owner's playtests, dependencies, not epics |
| L2, the big balance | L2-1 to L2-3 done | epics: the card (L2-4), the pools (L2-5 to L2-7), the volume (L2-8 to L2-13), the numbers (L2-14 to L2-17) |
| O, the game explains itself (active) | O-2, O-3c, O-4.1 to O-4.6, O-4.7a done | epics: the rest of O-4 (O-4.5, O-4.7); O-5 to O-9; O-10 goes with U |
| B, bots and Solo | B-1 to B-4 done, B-5 inside Z-25 | an epic: B-6 to B-8 |
| D, twists | not started | an epic: D-0 to D-6 |
| T-6, the record screen; G-3c, Quick start removed (G-3r parked) | open | parts of the flow-screen epic, or one small epic |
| I, translation | not started | epics: I-1 to I-5 between the others, I-6 to I-9 after B, D and Z |
| Y, tests and performance | not started, after all of M | an epic; it brings the tests and the full gate back (OQ-73) |
| W residue, H3, H6, Prettier in the gate, the deferred audit items, J1 to J3, Epic SND | open | epics of their own, in the work order's place |
| Epic Q, the visual queue (Q23 to Q39, 106 open boxes), and the owner's playtest items (P-8 to P-43) | open | epics by surface, a blind pass's leads as one epic's criteria; a blocking defect as a BUG-n |
| `# Bugs / follow-ups` `## Open` (80 open, the code audit CA among them) | open | the defects as BUG-n in `docs/BUGS.md`, by severity; residues and leads into their epics; "do not build" (K-5 stage C, OQ-18) in `docs/RISKS.md` or out of scope |
| U achievements, then C4, C3, then C2 (the live matrix) and C7 (release ops) | open | the last epics before 1.0 (April 2027), C2 with C7 as the release epic |
| `# Post-1.0`: M13 to M15, trustless play, the rest | open | epics after the 1.0 epic |

**Proposed values**, to confirm as one list: the name Last Ones Down; the idea "An online turn-based social survival game, Bunker-like, host-authoritative over Steam P2P, serverless" (`package.json`); the level full (T5b's word: it also asks for staging, which T8 brings, and a production smoke, which no epic holds yet); the stage `plan` (`SPEC.md`, `ARCHITECTURE.md`, `NETWORKING.md` and the stack in `CLAUDE.md` record the decisions, and the work left is in `ROADMAP.md`); the gate's fast list `yarn lint` and `yarn typecheck`, to be timed against the 120 s limit; the full list `node tools/gate.mjs`; in CI, what a Linux runner can pass, without the visual ratchet and the Electron steps.

**The owner's decisions it asked for**, not taken, since the owner closed T5b instead:

1. The BLOCKER, on `main` before the adoption: remove "Start here" (32 lines) with `lod-continue`, and move "Architecture" and "Conventions" (132 lines) into a file that `CLAUDE.md` imports with one line: about 114 lines, 154 with pitwall's sections.
2. The plan: `docs/EPICS.md` takes it over, `ROADMAP.md` gets the line on top and is history; `ROADMAP-closed.md` stays the archive.
3. The `lod-*` parts as in the table: those replaced are removed on `main` before the adoption, the rest kept.
4. The workflow: every change through a branch and a PR, the owner's own sessions included; without it there is no adoption, since the guard refuses an agent's push to `main`.
5. The gate during Epic M (OQ-73): `scripts/gate` runs only what is green today (`packages/**`) until Epic Y, or the 47 client reds are fixed first.
6. CI: the check named `gate` on GitHub Actions comes back, and which steps it runs.
7. The open bugs: which of the 80 in `## Open` and of the P-n items become BUG-n now.
8. Decisions: OQ-n stays the log of the game's rulings and ADRs take the architecture, or `OPEN_QUESTIONS.md` is frozen and new decisions go to the epic files and ADRs.
9. The definition of done: pitwall's section names `AAA_BRIEF.md` section 8 as the project's own.
10. The spec: `docs/SPEC.md` points to the root `SPEC.md` instead of repeating it.
11. Merge protection now or later, and whether low and normal risk PRs merge without the owner.
