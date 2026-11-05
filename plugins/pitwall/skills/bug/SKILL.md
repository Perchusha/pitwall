---
name: bug
description: Files a bug in docs/BUGS.md as BUG-n with where it was found, steps, expected and actual, and makes sure its fix ships with a regression test. Use when QA, the reviewer, production or the owner reports a defect.
disable-model-invocation: true
---

# bug - record a defect

> Status: planned for epic T4, not implemented in v0.1.0. If this skill is invoked, tell the owner that the bug flow is not built yet and stop.

## What it will do

1. Add `BUG-n` to `docs/BUGS.md`: where it was found (QA, review, production, owner), steps, expected, actual, status, fix PR.
2. Put the fix at the top of the next loop of `continue`.
3. Close the bug only when the fix PR carries a regression test.
4. If the defect can happen again in another place, hand over to `lesson`.
