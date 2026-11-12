# T4c - Releases and a minimal QA

Goal: every merged epic ships as a tagged version with a changelog, built locally at the lite level, and the owner gets the tests of every closed epic's criteria and a checklist of the manual QA left to them; defects found go in as bugs.
Depends on: T4d
Risk class: high (tags: a mistake reaches users, and a pushed tag is not taken back quietly)
ADR: ADR-0006, ADR-0007, ADR-0010, and a new one for the release (proposed: `ADR-0013`)

## Acceptance criteria (draft, refined when T4c starts)

The criteria as drafted in T4b. The refinement proposed for them is under "Proposed, awaiting owner" below; they are rewritten once the owner answers.

- [ ] T4c-AC1: A merged epic produces a semver tag and a changelog. The changelog and the version are built only from the merge commits on `main` (`git log --first-parent`), which T3b writes as `feat(E<n>): ...` and `fix(BUG-<n>): ...`; the commits inside a branch never reach the changelog (owner, 2026-11-09).
- [ ] T4c-AC3: The release records the changes merged since the last branch of the loop: the last change of a plan has no next branch to record it (T3b review).
- [ ] T4c-AC4: At the lite level the release is a local build: the project's own build command, run and checked, with no staging environment (owner, 2026-11-12).
- [ ] T4c-AC5: A minimal qa agent: it runs the tests of the acceptance criteria of every closed epic, writes for the owner a checklist of the manual QA the epics' scenarios leave to them, and files a bug for each failure with `/pitwall:bug` (owner, 2026-11-12).

## Decisions

One-way (2026-11-10): split out of T4 (see T4a-guards-and-process.md), high risk (owner). If T4c turns out as large as T3b when it starts, it is split again: releases (AC1 to AC3) and QA (AC4, AC5) (owner).

One-way (2026-11-12): made smaller before T5 (owner). Kept: AC1, AC3, the lite level's local build of AC4 and a minimal qa agent of AC5. Moved to T8, after T5: serving pitwall by tag with its ADR (drafted here as the second criterion, now T8-AC1), staging by type of application, and the qa agent's pass in a browser. T5 holds no web application, and Last Ones Down reaches Steam its own way. The criteria keep their numbers, so what the journal and the reviews call T4c-AC3 stays the same criterion.

T4c-AC3 belongs here and not in T4a: recording needs a commit on protected `main`, which only a reviewed PR brings, and the release already makes one (its changelog and version). In T4a the record would need a docs-only PR of its own, with its own branch kind, gate and review, for the same commit the release makes anyway.

### Proposed, awaiting owner (2026-11-12)

Proposed by the agent when T4c started. Nothing here is decided until the owner answers.

**One-way questions** (each adds to the contract between the plugin and a project, ADR-0006, or changes who sets `ai-review`, ADR-0007):

1. The build command. Recommended: `scripts/build <version>`, a script the template gives a project as it gives `scripts/gate`: it builds what the owner runs or installs from the tree as it is, may stamp the version into it, changes no tracked file, exits non-zero when it fails, and prints one `ARTIFACT: <path>` line for each thing it built. The template's stub fails until E0 fills it in (E0-AC4 names it). Other options: a command in `.claude/pitwall.json` (no file, but a shell line in JSON that only the plugin reads), or the line in `CLAUDE.md`'s Commands (read by parsing prose).
2. Where the version and the changelog live. Recommended: `CHANGELOG.md` at the project root, a section per version (`## v<x.y.z> - <date>`, then `### Added`, one line per epic `E<n>: <title> (#<pr>)`, and `### Fixed`, one per bug), and an annotated tag `v<x.y.z>` on `main` whose message is that section. The project's own manifests (`package.json` and the like) are the stack's: `scripts/build` may stamp the version into what it builds, never into a tracked file. Other options: `docs/CHANGELOG.md`; or no changelog file, the section only in the tag and a GitHub release (then the release needs no commit, but AC3 still does).
3. Who reviews a release. Recommended: the qa agent is the release's reviewer and sets `ai-review` on the release PR, through `review-status.mjs`, as the plan reviewer and the code reviewer do (ADR-0007 gains a third agent, for a release only): its check of the release is QA, and one fresh agent per release costs less than two. Other option: the code reviewer reviews the release PR as any change, and the qa agent runs apart from it.

**The criteria as proposed** (AC2 stays T8's; AC6 and AC7 are new):

- T4c-AC1: Version, changelog, tag. A new plugin script, `release.mjs`, reads the first-parent history of `main` since the highest tag `v<x.y.z>` (with none, the whole history) and keeps only the merge commits of the loop, `feat(E<n>): <title> (#<pr>)` and `fix(BUG-<n>): <title> (#<pr>)`: the plan's merge, the kickoff commit, earlier releases and any other commit never reach the changelog, and a commit on `main` that is no merge is named to the owner (owner, 2026-11-09). The next version: before 1.0, minor when an epic is in it and patch when only fixes are; 1.0.0 and every major only when the owner names the version. With nothing to release it says so and stops. After the release merges, it tags the release's merge commit and pushes the tag, after it checks that it may (L-5), and hands the push to the owner when it may not; it refuses a tag that exists.
- T4c-AC3: The release is a change of its own: a branch `release/v<x.y.z>` from `main` with one commit, which adds the changelog's section, sets `released (v<x.y.z>)` as the status of each epic in it, and records each merged change not yet recorded as the first commit of a loop branch does (statuses, journal entries), so the last change of a plan is recorded too. It takes no row waiting in the git directory, so a release that stops leaves nothing behind (R-4, item 1). Then the PR, the gate, the qa agent's review (AC5) and the merge, always after the owner's yes, whatever the risk classes of what it holds, with a merge commit `release: v<x.y.z> (#<pr>)`.
- T4c-AC4: The local build (question 1): the qa agent runs `scripts/build <version>` on the release PR's head and checks that each artifact exists and that the tree stays clean. At every level until T8 the release is this local build; staging and production are T8's. A project laid out before 0.9.0 has no `scripts/build`: the release stops and says so, and the owner adds one or files it with `/pitwall:bug`.
- T4c-AC5: The minimal qa agent, the release's reviewer (question 3). Fresh, briefed with paths only, on the release PR's head, it runs `release.mjs --check` (the changelog and the records match the merges, and the branch changes only `CHANGELOG.md` and `docs/`), the build of AC4 and `scripts/gate --full`; then, for each acceptance criterion of each merged or released epic and for each fixed bug, it reads what the change's review file says covers it: a test whose file is still in the tree passes with the gate, a QA scenario becomes an item of the owner's checklist, and anything else fails. It writes only `docs/reviews/release-v<x.y.z>.md` (the review template: a row per criterion, a finding per failure), files a bug for each failure with `/pitwall:bug`, unconfirmed and so blocking until the owner confirms it (T4b), and sets `ai-review`, success only with no failure. A red release is closed, its bugs go first, and the release runs again after them.
- T4c-AC6: Where it runs. `/pitwall:release`, built, runs it when the owner asks; `/pitwall:continue` offers it once the plan is done, and treats an open release branch as the change in flight, which `/pitwall:release` resumes; the owner gets the checklist with the one question that merges the release; `/pitwall:owner-calls` lists a release that waits for that yes. SPEC 6 step 8 and SPEC 9's contract name `scripts/build` and `CHANGELOG.md`; `ADR-0013` records the release, the options it was chosen over and its limits.
- T4c-AC7: Tests. `scripts/check.mjs` runs `release.mjs` on scratch repositories (a first release, minor and patch, the owner's 1.0.0, the commits it leaves out, a tag that exists, a push refused and handed over through the fake `gh`), `merge.mjs` and `review-status.mjs` on a release branch, `docs-check --stage code-review` on a release's review, the template's build stub, and the hooks' cases for the qa agent. `scripts/e2e.mjs` gains a loop stage `release` from the state `bug` saved, with a `scripts/build` the harness adds as the owner would: `v0.1.0` on origin on the release's merge commit, `CHANGELOG.md` with E0, E1 and BUG-1, the release's review file, and the owner asked before the merge.

**Two-way, picked by the agent:**

| Area | Choice | Why, in one line |
| --- | --- | --- |
| When | When the owner runs `/pitwall:release`, and offered by `continue` once the plan is done; not after every merge | At the lite level, with 1 to 3 epics, a release per epic adds a PR and a QA run per epic for one user; QA after every merge belongs to staging (T8) |
| Version | Before 1.0, an epic makes a minor and fixes alone a patch; 1.0.0 and majors only by the owner's word; a first release counts from 0.0.0 | SPEC's rule; the owner decides when 1.0 ships |
| Changelog | Keep a Changelog's headings (`### Added`, `### Fixed`), one line per merge from its subject; written by `release.mjs`, never by hand | Read by people and tools alike; the merge commit's subject is already the change's title |
| Tag | Annotated, `v<x.y.z>`, on the release's merge commit, its message the changelog's section; pushed by `release.mjs --tag` | The tagged tree holds its own changelog; an annotated tag records who and when |
| Release branch | `release/v<x.y.z>`, a third kind in `loop.branches`; its first commit flushes nothing | A release that stops must leave no row only an abandoned branch holds (R-4, item 1) |
| Build | Run by the qa agent on the PR's head, not by the conductor; the release's commit changes only docs, so the tag holds the built code | One place for the build and its check; `release.mjs --tag` refuses when the tagged tree differs from the reviewed head |
| QA scope | Every criterion of every closed epic, and every fixed bug's regression test, through the review files' "Covered by" | The review files already map each criterion to its test or QA scenario |
| A red release | Closed and started again after the fixes, not kept open | Its version and changelog would change with the fixes anyway |
| Older projects | No `scripts/build`: the release stops and says so; no `CHANGELOG.md`: `release.mjs` creates it | One missing file the owner adds once, and nothing laid out behind their back |
| Out of scope | GitHub releases and uploaded artifacts, staging, production and its smoke check, a browser pass, pitwall's own releases (T8) | The owner's smaller T4c |
| Runs before the PR | `scripts/check.mjs`; `e2e --hooks` (about $1), since the qa agent runs `review-status.mjs`; the new loop stage `release` from the state `bug` saved (estimate $10 to $15) | The runs that cross what changes |
| Version | 0.9.0 | A built skill, a built agent, a script and two template files are additions |
| Size | About 1.5 to 2 thousand lines over 40 to 50 files: 1.2 to 1.5 times T4b, about half of T3b; not split | Below the owner's threshold for a split; and with the qa agent as the release's reviewer, a release without QA would need a review of its own |

## Out of scope

- The guards and the loop's follow-ups (T4a); bugs and lessons (T4b); the gate before every commit (T4d).
- Serving pitwall by tag, staging by type of application, QA in a browser (T8).

## Open questions

- The three one-way questions and the list above, proposed and awaiting the owner (2026-11-12).
