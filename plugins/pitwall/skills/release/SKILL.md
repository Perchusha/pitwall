---
name: release
description: Releases what the epic loop merged in a pitwall project - a version and a changelog from the merge commits on main, a release branch with one commit that records the changes, the project's local build and a qa agent that checks every closed epic's criteria, then the owner's yes to the merge and the commands for the owner to make and push the tag. The owner runs it as /pitwall:release when they want a version, and /pitwall:continue offers it once the plan is done.
argument-hint: "[the version, when the owner names one]"
disable-model-invocation: true
---

# release - version, changelog, local build, QA, tag

> Status: built in T4c (ADR-0013). Staging, production and a pass in a browser come in T8: until then the release is a local build at every level.

```
PREFLIGHT -> PLAN -> BRANCH -> PR -> QA -> THE OWNER'S YES -> MERGE -> THE OWNER'S TAG
```

Ships the changes merged since the last release as one version. `release.mjs` reads the loop's merge commits on `main` and writes the changelog; the `qa` agent checks the release, builds it and goes through every closed epic's criteria; the owner says yes once, and makes and pushes the tag themselves.

Plugin files used: `${CLAUDE_PLUGIN_ROOT}/config/defaults.json` (`release`, `bugs`, `loop`, `budgets`), `${CLAUDE_PLUGIN_ROOT}/template/docs/reviews/template.md`, and the scripts in `${CLAUDE_PLUGIN_ROOT}/scripts/`: `release.mjs`, `merge.mjs`, `bugs.mjs`, `docs-check.mjs` (and `review-status.mjs`, which only the qa agent runs here).

## Rules

- Run each command as written, from the project root, one command per call.
- One question per message, then wait. Never answer for the owner, and never pass `--owner-approved` without their yes to this merge in this conversation.
- Never make, move or push a tag, and never run `gh release`: `release.mjs --tag` hands those commands to the owner, and you show them verbatim (owner, 2026-11-12). The same for any HANDOFF a script prints.
- No release while a blocking bug is open, an unconfirmed one included (ADR-0013): `release.mjs`, the qa agent's check and `merge.mjs` each refuse. Never work around a refusal; a blocking bug goes first, through `/pitwall:continue`.
- This conversation writes only the release's records: what `release.mjs --write` writes, and the entries of `docs/JOURNAL.md`. Never edit `CHANGELOG.md` by hand, never write `docs/reviews/`, and never set `ai-review`: the review file and the status are the qa agent's.
- Wait for the qa agent: run it in the foreground and read its report before you go on or end your turn.
- Never `git commit --no-verify` or `-n`: the gate before every commit runs on the release's commit too.

## Steps

1. **Preflight.** Read `.claude/pitwall.json`; without it, stop: `/pitwall:kickoff` first. With a remote, `git fetch origin`. Run `git status --porcelain`: anything there the owner commits or drops first. Run `git branch --list "release/*"`:
   - a release branch whose last commit is not the second parent of a merge commit on `main` is the release in flight: `git switch <it>` and go to the step it stands at (its PR, its QA, its merge), as `gh pr view <branch> --json number,state,statusCheckRollup` shows;
   - otherwise `git switch main`, and with a remote `git pull --ff-only origin main`.
2. **Plan.** Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/release.mjs" --plan`, with `--version <x.y.z>` when `$ARGUMENTS` names one, the owner's word for a major.
   - Exit 4: the first release of this project. Show the owner the changes it lists and ask one question: is its version 0.1.0 or 1.0.0 (`release.firstVersions`)? Run it again with their answer as `--version`.
   - Exit 1: show why, and stop. A blocking bug open: its fix goes first, through `/pitwall:continue`, and an unconfirmed one waits for the owner to confirm it (`/pitwall:owner-calls`). A release merged and not tagged: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/release.mjs" --tag` and show its HANDOFF verbatim. Nothing to release: say so.
   - Exit 0: tell the owner in a few lines the version, the changes it holds, and each commit it names as left out (a commit on `main` that is no merge of the loop never reaches the changelog).
3. **Branch.** `git switch -c release/v<x.y.z>` from `main`, then `node "${CLAUDE_PLUGIN_ROOT}/scripts/release.mjs" --write`: it writes the changelog's section into `CHANGELOG.md`, `released (v<x.y.z>)` for each epic in it, and each bug in it fixed with its PR. Then add to `docs/JOURNAL.md` an entry for each change of the release that has none yet, as `/pitwall:continue` step 4 writes one: what shipped, its review rounds and findings (from its file in `docs/reviews/`), the implementers and their calls (from the last "pitwall numbers" comment on its PR, `gh pr view <pr> --json comments`), and its cost where known. Never run `bugs.mjs flush` here: what waits in the git directory stays there for the next branch of the loop, so a release that stops loses nothing. Then `git add CHANGELOG.md` (it may be new) and `git commit -m "docs: release v<x.y.z>" -- CHANGELOG.md docs/EPICS.md docs/BUGS.md docs/JOURNAL.md`, naming only the files it changed. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/release.mjs" --check`: a FAIL is put right before the PR.
4. **PR.** `git push -u origin release/v<x.y.z>`, then, when `gh pr list --head release/v<x.y.z> --state open` lists nothing, `gh pr create --base main --head release/v<x.y.z> --title "Release v<x.y.z>" --body "<body>"`: the changelog's section, the commits left out, and a line saying that the qa agent reviews it and that it merges after the owner's yes (ADR-0013). Without a remote there is no PR: the qa agent still checks the release, and its status step hands the rest over.
5. **QA.** Dispatch `pitwall:qa` with the brief below, a fresh agent each round. Show the owner its STATUS, the ARTIFACTS, what is OPEN, the BUGS FILED, the CHECKLIST, and any HANDOFF lines verbatim.
   - APPROVED: go to step 6.
   - CHANGES: the release is red. Close it, `gh pr close <pr> --delete-branch --comment "Closed: <what failed>. The release runs again after the fixes (ADR-0013)."`, then `git switch main` and `git branch -D release/v<x.y.z>`; its commit holds only what `release.mjs --write` writes again. Tell the owner what failed and what comes next: each bug the qa agent filed waits, blocking and unconfirmed, until the owner confirms it (`/pitwall:owner-calls`), and its fix goes first through `/pitwall:continue`; a failure of the release itself (`main` moved, a status) needs no fix; then `/pitwall:release` again.
   - NEEDS_OWNER: ask the owner, one question at a time, and run a fresh qa agent with the answers.
   - A status the qa agent could not set because Claude Code did not let `review-status.mjs` run (REVIEW STATUS says "not run") with STATUS APPROVED: hand the owner the command it names, to run themselves in a terminal from the project folder, and stop: the release is ready to merge once they have, and `/pitwall:release` resumes at step 6.
6. **The owner's yes.** Show the owner one summary: the version, the changelog's section, the artifacts, the qa agent's verdict and file, and the checklist of manual QA, which is theirs: they run it before their yes or after it, and a failure they find they file with `/pitwall:bug`. The qa agent's `ai-review` means the automated part passed, no more (owner, 2026-11-12). Ask one question: merge the release now?
   - Yes: `node "${CLAUDE_PLUGIN_ROOT}/scripts/merge.mjs" --change --owner-approved`. Exit 0: go to step 7. Exit 3 with the gate still running: run it again (the yes still stands); otherwise show the HANDOFF verbatim and stop. Exit 1: show why it refused; a blocking bug opened since the qa agent's check stops the release as in step 5.
   - No, or not yet: stop here; `/pitwall:release` resumes at this step.
7. **The owner's tag.** With a remote, `git switch main` and `git pull --ff-only origin main`. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/release.mjs" --tag` and show its HANDOFF verbatim: the commands that make the annotated tag on the release's merge commit, push it, and publish the build with `gh release create`. Never run them. Until the tag exists, no release starts, and `/pitwall:owner-calls` lists it. Then tell the owner in a few lines where the release stands: merged, the tag theirs to make, the checklist theirs to run, and any bug waiting for the next branch.

## QA brief

Only what the qa agent needs, never this conversation: the project root; the release's branch and version; the round number, one more than the `- Round:` of `docs/reviews/release-v<x.y.z>.md` on the branch, or 1 when there is none; the config path `${CLAUDE_PLUGIN_ROOT}/config/defaults.json` with its call budget, `budgets.subagentToolCalls`; the template `${CLAUDE_PLUGIN_ROOT}/template/docs/reviews/template.md`; the paths to read (`docs/LESSONS.md`, `CLAUDE.md`, `docs/EPICS.md`, `docs/BUGS.md`, `docs/epics/`, `docs/reviews/`, `CHANGELOG.md`); and the commands it may run, with their paths and the project root spelled out, so it needs no `cd`:

- read-only git: `git diff main...HEAD`, `git log`, `git show`, `git status`, `git rev-parse HEAD`, `git ls-files`;
- `bash scripts/gate --full`;
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/release.mjs" --check --project "<project root>"` and `--build --project "<project root>"`;
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/bugs.mjs" file --project "<project root>"`, the bug on stdin in a quoted heredoc;
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/docs-check.mjs" --root "<project root>" --stage release`;
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/review-status.mjs" --review release --state success --project "<project root>"`, or `--state failure --description "qa: <n> failing"`.

## Output

`CHANGELOG.md` with the version's section, the release's merge commit `release: v<x.y.z> (#<pr>)` on `main` with the records of every change it holds, `docs/reviews/release-v<x.y.z>.md` from the qa agent with `ai-review` on the PR, the build's artifacts in the project's folder, and the owner's commands for the tag and the GitHub release.

## Check

`release.mjs --check` and `docs-check --stage release` pass on the reviewed head before `ai-review` turns green, `merge.mjs` merges the release only after the owner's yes with no blocking bug open, and `release.mjs --tag` hands over the tag only when the merge commit holds the code the qa agent built.
