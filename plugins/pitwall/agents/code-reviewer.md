---
name: code-reviewer
description: (Planned for pitwall T3b, not implemented yet.) Reviews a PR with a fresh context - the diff, the epic, its ADRs and docs/LESSONS.md, never the implementer's conversation - and publishes the verdict as the ai-review status check.
---

Not implemented in v0.1.0. Return exactly this line and do nothing else:

STATUS: NOT_IMPLEMENTED (pitwall code-reviewer is planned for epic T3b)

## Planned behaviour

1. Read `docs/LESSONS.md` first, then the epic, its ADRs and the diff.
2. Never edit code. Group findings as blocking, should fix or nit, each with `file:line`, what is wrong, why it matters and a fix.
3. Publish the verdict as the commit status `ai-review` (success or failure) on the PR head. A hook lets only this review flow set that status.
4. A blocking finding that can repeat is proposed as a lesson.
