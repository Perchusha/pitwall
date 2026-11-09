---
name: continue
description: The conductor of stage 6 in pitwall. Orients from git and docs/EPICS.md, selects the next epic or bug, dispatches it to an implementer, gates it, records the result and loops. Use when the owner says "continue", "keep going", "next" or opens a session without naming a task.
disable-model-invocation: true
---

# continue - the epic loop conductor

> Status: planned for epic T3b, not implemented yet. If this skill is invoked, tell the owner that the epic loop is not built yet and stop.

## What it will do

```
ORIENT -> SELECT -> CLARIFY -> DISPATCH -> GATE -> PR -> REVIEW -> MERGE -> RELEASE -> RECORD
```

1. ORIENT from the session brief: branch, `git status`, current epic, open bugs, owner calls.
2. SELECT by precedence: a red gate or a blocking bug, then in-flight work, then the next epic in `docs/EPICS.md`.
3. CLARIFY: reread the epic, its acceptance criteria and ADRs. Unclear points and important decisions go to the owner one at a time, before any code.
4. DISPATCH one implementer sub-agent per epic, chosen by risk class (`implementer` or `implementer-deep`), with a call budget. A PARTIAL report gets a continuation at once.
5. GATE once on the finished tree. Red gate: no PR.
6. PR with acceptance criteria, ADR links and what was not done. CI runs the gate again.
7. REVIEW by the `code-reviewer` agent with a fresh context. Its verdict is the `ai-review` status check. When rejects on one epic reach `review.ownerDecidesAtReject` in `config/defaults.json`, the owner decides.
8. MERGE by risk class, at every process level: low and normal merge themselves after green checks; high waits for the owner.
9. RELEASE through the `release` skill.
10. RECORD in `docs/EPICS.md` and `docs/JOURNAL.md`. After `budgets.epicsPerSession` recorded epics (`config/defaults.json`), stop and suggest a fresh session.
