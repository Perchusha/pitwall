# ADR-0013: A release is a change of its own, reviewed by the qa agent and tagged by the owner

- Status: accepted
- Date: 2026-11-12
- Class: one-way
- Decided by: owner

## Context

SPEC 6 ends the loop with a release: a semver tag with a changelog, a build to check, QA against the acceptance criteria of every closed epic. The owner decided that the changelog and the version come only from the merge commits on `main` (2026-11-09), and that T4c builds the lite level's part: a local build, no staging, and a minimal qa agent (2026-11-12). `main` is protected (ADR-0002, ADR-0005), so the changelog and the records of the last change of a plan, which has no next branch to record it (T3b review), reach `main` only through a PR with `gate` and `ai-review` green. pitwall never assumes a stack: it calls the project's scripts. A pushed tag reaches users and is not taken back quietly.

## Options

| Option | Pros | Cons | Maturity | Cost | Lock-in |
| --- | --- | --- | --- | --- | --- |
| A release branch with one commit of docs and the changelog, reviewed by the qa agent, merged after the owner's yes, tagged by the owner from handed commands | The changelog is built after the merges, as decided; the last change is recorded; one fresh agent checks both the release and the product; the owner says yes once and publishes the tag themselves | One more PR per release; a third agent sets `ai-review` | The loop's own PR, review and merge (T3b) | One qa run and one question per release | Low: a script, a skill, an agent |
| The same, reviewed by the code reviewer, with the qa agent apart | ADR-0007 unchanged | Two fresh agents per release, and the code reviewer reads a diff of docs only | Same | Two agent runs per release | Low |
| No release commit: the changelog only in the tag and a GitHub release, the records in the next branch's first commit | No PR | The last change of a plan stays unrecorded; the changelog lives outside the repository | `gh release` is stable | None | Medium: the changelog is GitHub's |
| The changelog's line written on each change's branch before its merge | No release PR | Against the owner's decision of 2026-11-09: the line is written before the merge commit it describes exists | - | None | Low |

## Decision

- The build is `scripts/build <version>`, a script the template gives every project, as it gives `scripts/gate` (owner, 2026-11-12): it builds what the owner runs or installs from the tree as it is, may stamp the version into what it builds and never into a tracked file, exits non-zero when it fails, and prints one `ARTIFACT: <path>` line per thing it built. E0 fills it in. Until T8 the release is this local build at every level.
- The changelog is `CHANGELOG.md` at the project root, a section per version, `### Added` for epics and `### Fixed` for bugs, written by `release.mjs` from the loop's merge commits; a version is an annotated tag `v<x.y.z>` on the release's merge commit, whose message is that section (owner, 2026-11-12). The project's manifests stay the stack's.
- An epic makes a minor version, fixes alone a patch; a major, and the first version of a project (0.1.0 or 1.0.0), only by the owner's word (owner, 2026-11-12).
- A release is a change of its own, on `release/v<x.y.z>`: one commit with the changelog's section, the released epics' status and the records of the merged changes not yet recorded, and no row waiting in the git directory. It always merges after the owner's yes, with a merge commit `release: v<x.y.z> (#<pr>)` (owner, 2026-11-12).
- The qa agent is the release's reviewer and sets its `ai-review` through `review-status.mjs --review release`, which the hooks' guard lets it run for a release only (owner, 2026-11-12). Its `ai-review` means that the automated part passed: the release's check, the build and the gate, and a test or a QA scenario for every criterion of every closed epic and every fixed bug. The manual checklist is the owner's, and the release merges only after their yes.
- No release while a blocking bug is open, one the qa agent has just filed included (owner, 2026-11-12): `release.mjs` refuses to start one, its check fails, `docs-check --stage release` fails, and `merge.mjs` refuses to merge one. A red release is closed and runs again after the fixes.
- The owner makes and pushes the tag, and publishes the artifacts, from the commands `release.mjs --tag` hands them, as pitwall's own releases are handed to the owner (owner, 2026-11-12). No agent creates or pushes a tag.

## Consequences

- A release costs one PR, one run of the qa agent, the build and the gate, and one question; the owner's yes covers the merge, and the tag follows from their terminal.
- The tag holds the code the qa agent built only because the release's commit changes docs and `CHANGELOG.md` alone: `release.mjs --check` holds the branch to that, and `release.mjs --tag` refuses when the merge commit's code differs from the built commit's, as when `main` moved under the release.
- A release merged and not tagged blocks the next one, and `/pitwall:owner-calls` lists it: without the tag, the next release would not know where the last one ended.
- A project laid out before 0.9.0 has no `scripts/build`, and its first release stops until the owner adds one.
- The qa agent of T4c reads tests and review files and runs the project's scripts; it neither drives the product nor opens a browser. Staging by type of application and the browser pass are T8's.
- Revisiting costs one script, one skill, one agent, the guard's line for the qa agent, and the two contract paths, which only a major version with a migration note changes (ADR-0006).
