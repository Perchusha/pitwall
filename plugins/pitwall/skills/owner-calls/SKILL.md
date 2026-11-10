---
name: owner-calls
description: Lists everything that waits for the owner, grouped and one line each, with what happens if the owner says nothing, then records the answers. Use when the owner asks what needs their decision.
disable-model-invocation: true
---

# owner-calls - what waits for the owner

> Status: planned for epic T4, not implemented yet. If this skill is invoked, tell the owner that this skill is not built yet and stop.

## What it will do

1. Collect open questions from `docs/EPICS.md`, `docs/PLAN-REVIEW.md`, NEEDS_OWNER reports and high-risk PRs waiting for a merge.
2. Show them grouped, one line each, with the default that applies if the owner says nothing.
3. Ask one question at a time and record each answer where it belongs: an ADR, an epic or the plan review.
