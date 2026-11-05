---
name: decide
description: Stage 2 of pitwall. Walks every architecture and stack decision, asks the owner about each one-way decision with a comparison of options, and records each decision as an ADR. Use when choosing a stack, database, monorepo or services, folder structure, patterns, UI kit, tests or CI.
disable-model-invocation: true
---

# decide - stage 2

> Status: planned for epic T1, not implemented in v0.1.0. If this skill is invoked, tell the owner that stage 2 is not built yet and stop.

## What it will do

1. Walk every area, even when the answer looks obvious: platform and runtime, language, framework, database and data model, auth, monorepo or not, monolith or services, folder structure and module boundaries, architecture patterns, API, client state, UI kit, test strategy, CI/CD, hosting and staging, observability, i18n, accessibility, AI models and external APIs with their limits and prices.
2. Split decisions in two classes:
   - one-way (database, data model, monorepo, services, auth, hosting with lock-in): one question to the owner at a time, with 2 to 4 options compared, then wait;
   - two-way (linter, formatter, test layout, small libraries): the agent picks and explains in one line, the owner accepts the list or edits items. A two-way decision the agent doubts becomes one-way.
3. Question format: context in two sentences; options table (pros, cons, maturity, cost, lock-in, source link); the agent's recommendation and why; what changes if another option is picked; when and at what cost it can be revisited.
4. Check versions in the package registry at decision time, never from model memory. "New but proven" means a stable release, active maintenance, a migration path and compatibility with the rest of the stack (thresholds in `config/defaults.json`).

## Output

`docs/adr/NNNN-*.md` per decision (context, options, decision, consequences), `docs/STACK.md` with the summary and versions, one config for models, prices and limits.

## Check

Every area has an ADR or a line in the two-way list. Every one-way decision was confirmed by the owner.
