# Changelog

One section per version, newest first. Up to 0.12.0 each version is one epic, named as its merge commit on `main` names it; the epic's file holds its acceptance criteria.

## 1.0.0 - 2026-11-14

The first stable version of pitwall: epics T0 to T7 as they merged, with no new features since 0.12.0.

### What it does

- `/pitwall:continue` leads a project from a one-line idea, or from a project that exists already after a dry run that writes nothing, through discovery, decisions recorded as ADRs, a spike when one is due and a plan in epics that a fresh-context agent reviews. Then it runs the epic loop, one change per lap: implemented with tests, gated, reviewed by a fresh-context code reviewer, merged by risk class. In a pitwall project you can just say "continue".
- Bugs and lessons: `/pitwall:bug` files a defect of merged work with a severity you confirm, `/pitwall:lesson` a mistake that can repeat with what checks it.
- `/pitwall:release` ships what the loop merged as one version: a changelog from the merge commits, a local build, the `qa` agent's check of every closed epic's criteria, your yes, and the tag you make.
- Three process levels, lite, standard and full: a small idea does not walk the path of a large system.
- Hooks in every pitwall project: a brief at session start, guards on secrets, on pushes to `main`, on merges, on the review status, on uncommitted work, on the gate before every commit and on a release's tag, and call budgets for agents.

### Checked

- The lite level on a real project, from an empty repository to its first merged epic, in the owner's own session (T5a).
- Every stage in headless runs against a fake GitHub, the adoption of an existing project included, at the epic that last changed it, and the hooks again at T7, on Windows with Claude Code 2.1.323.
- Every check in CI, on Linux with Claude Code 2.1.318, the version `.claude-code-version` pins.

### Known limits

- A release is a local build at every level. The standard and full levels name staging, QA after every merge and a deployment to production with its smoke check: none of them is built yet, and T8 brings staging and QA in a browser.
- The standard and full levels have not yet run on a real project, and the adoption of an existing project has run only headless, on a test project: T5b, a real project adopted at the full level, comes after 1.0.
- The default branch must be `main`: kickoff makes it so, and the adoption stops while it is not, with the steps of the rename.
- The marketplace serves the plugin from `main`, not from a tag (T8).
- The guards catch mistakes, not a command built to hide what it does: [R-2, R-3 and R-5](https://github.com/Perchusha/pitwall/blob/main/docs/RISKS.md). A merge that waits for the owner is held by Claude Code's permission prompt: with permissions skipped, or an allow rule that covers `merge.mjs`, only the skill's text holds it (R-4).
- Open bugs, none blocking: BUG-9 (Git LFS writes its hooks into `.githooks`) and BUG-11 to BUG-13 (three forms of a command that throws uncommitted work away and that the guard lets through), in [docs/BUGS.md](https://github.com/Perchusha/pitwall/blob/main/docs/BUGS.md).

### After 1.0

T5b, T8, BUG-9 and BUG-11 to BUG-13; QA after every merge and a deployment to production with its smoke check, which no epic holds yet; an estimate of the cost before a paid run: [docs/EPICS.md](https://github.com/Perchusha/pitwall/blob/main/docs/EPICS.md).

## 0.12.0 - 2026-11-14

T7: the guard's corpus - every command line of the transcripts replayed before each review, and the open bugs fixed ([#12](https://github.com/Perchusha/pitwall/pull/12), [the epic](https://github.com/Perchusha/pitwall/blob/main/docs/epics/T7-guard-corpus.md))

## 0.11.0 - 2026-11-14

T6: adopt an existing project - a dry run first, only what is missing, the project's checks as its gate ([#11](https://github.com/Perchusha/pitwall/pull/11), [the epic](https://github.com/Perchusha/pitwall/blob/main/docs/epics/T6-adopt-existing-project.md))

## 0.10.0 - 2026-11-14

T5a: validation on the lite system - one conductor for the whole path, the owner's choice through the permission prompt, a shorter plan review at lite ([#10](https://github.com/Perchusha/pitwall/pull/10), [the epic](https://github.com/Perchusha/pitwall/blob/main/docs/epics/T5a-lite-reminder.md))

## 0.9.0 - 2026-11-13

T4c: releases and a minimal QA - release.mjs, the qa agent as the release's reviewer, the owner's tag ([#9](https://github.com/Perchusha/pitwall/pull/9), [the epic](https://github.com/Perchusha/pitwall/blob/main/docs/epics/T4c-release-and-qa.md))

## 0.8.0 - 2026-11-12

T4d: the gate before every commit - the template's pre-commit hook, the guard's rule precommit, pitwall's own hook ([#8](https://github.com/Perchusha/pitwall/pull/8), [the epic](https://github.com/Perchusha/pitwall/blob/main/docs/epics/T4d-commit-gate.md))

## 0.7.0 - 2026-11-12

T4b: bugs and lessons - /pitwall:bug, /pitwall:lesson, severity and the queue, rows that wait in the git directory ([#7](https://github.com/Perchusha/pitwall/pull/7), [the epic](https://github.com/Perchusha/pitwall/blob/main/docs/epics/T4b-bugs-and-lessons.md))

## 0.6.0 - 2026-11-10

T4a: guards and process follow-ups - the uncommitted-work guard, owner calls, snapshots, overridden stops ([#6](https://github.com/Perchusha/pitwall/pull/6), [the epic](https://github.com/Perchusha/pitwall/blob/main/docs/epics/T4a-guards-and-process.md))

## 0.5.0 - 2026-11-10

T3b: the epic loop - conductor, implementers, code reviewer, merges by risk class, the owner's choice ([#5](https://github.com/Perchusha/pitwall/pull/5), [the epic](https://github.com/Perchusha/pitwall/blob/main/docs/epics/T3b-epic-loop.md))

## 0.4.0 - 2026-11-09

T3a: hooks - session brief, guards, call budgets, checks ([#4](https://github.com/Perchusha/pitwall/pull/4), [the epic](https://github.com/Perchusha/pitwall/blob/main/docs/epics/T3a-hooks.md))

## 0.3.0 - 2026-11-09

T2: stages 3 to 5 - spike, plan, plan-reviewer, plan review and merge ([#3](https://github.com/Perchusha/pitwall/pull/3), [the epic](https://github.com/Perchusha/pitwall/blob/main/docs/epics/T2-stages-3-5.md))

## 0.2.0 - 2026-11-06

T1: stages 0 to 2 - kickoff, discovery, decide, researcher ([#2](https://github.com/Perchusha/pitwall/pull/2), [the epic](https://github.com/Perchusha/pitwall/blob/main/docs/epics/T1-stages-0-2.md))

## 0.1.0 - 2026-11-05

T0: skeleton - marketplace, plugin stubs, project template, checks ([#1](https://github.com/Perchusha/pitwall/pull/1), [the epic](https://github.com/Perchusha/pitwall/blob/main/docs/epics/T0-skeleton.md))
