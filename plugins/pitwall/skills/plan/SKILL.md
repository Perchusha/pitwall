---
name: plan
description: Stage 4 of pitwall. Turns the decisions into an ordered list of epics without dates, each with a goal, testable acceptance criteria, dependencies and a risk class, then sends the plan to the plan-reviewer agent. Use when the owner asks for a plan, a roadmap or epics.
disable-model-invocation: true
---

# plan - stage 4

> Status: planned for epic T2, not implemented in v0.1.0. If this skill is invoked, tell the owner that stage 4 is not built yet and stop.

## What it will do

1. E0 is always the walking skeleton: repository, `scripts/gate`, CI, a "hello world" deployed to staging.
2. One epic is one PR with a testable result. More than 3 modules or 2 packages: split it.
3. Acceptance criteria are written for QA, not for the author: checkable without knowing the code.
4. Risk class per epic: low (UI, copy), normal (ordinary logic), high (auth, payments, data migrations and deletion, infrastructure, security). It sets the implementer's effort, the review depth and how the PR is merged.
5. Dispatch the `plan-reviewer` agent (stage 5): pre-mortem, non-functional requirements, launch questions, epic sizing, moving everything into the project docs.

## Output

`docs/EPICS.md` (order and status) and `docs/epics/E<n>-<slug>.md` per epic, following `template/docs/epics/E0-skeleton.md`.

## Check

Every epic has acceptance criteria and a risk class, ADR links resolve, the dependency graph has no cycles, E0 comes first.
