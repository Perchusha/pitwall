---
name: lesson
description: Records a repeatable mistake in docs/LESSONS.md as L-n with the rule, the reason and how it is checked, and promotes it to a lint rule, hook or test guard when possible. Use after a bug or a blocking review finding that could happen again.
disable-model-invocation: true
---

# lesson - turn a mistake into a rule

> Status: planned for epic T4, not implemented in v0.1.0. If this skill is invoked, tell the owner that the lesson flow is not built yet and stop.

## What it will do

1. Add `L-n` to `docs/LESSONS.md`: the rule in one line, why (link to the BUG or PR), the date, how it is checked.
2. If a tool can check it (a lint rule, a hook, a test guard), add the guard and leave a line in LESSONS that points to it.
3. The implementer and the reviewer read `docs/LESSONS.md` first, so the next agent does not repeat the same mistake.
