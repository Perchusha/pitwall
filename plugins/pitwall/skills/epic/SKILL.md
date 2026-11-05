---
name: epic
description: The implementer's procedure for one pitwall epic. Implements the epic on its branch with tests for every new module and a test or QA scenario per acceptance criterion, runs the gate and returns a DONE or PARTIAL report. Preloaded into the implementer agents.
disable-model-invocation: true
---

# epic - implement one epic

> Status: planned for epic T3, not implemented in v0.1.0. If this skill is invoked, tell the owner that the epic procedure is not built yet and stop.

## What it will do

1. Read the epic, its acceptance criteria, its ADRs, `docs/LESSONS.md` and `CLAUDE.md` before any code.
2. Work on branch `epic/E<n>-<slug>`. Never push to `main`.
3. Every new module gets unit or integration tests. Every acceptance criterion gets a test or a QA scenario.
4. Run `scripts/gate --fast` while working and `scripts/gate --full` once at the end. Fix your own reds.
5. Stop near the call budget and return PARTIAL with a handoff: what is done, the exact next step, every path touched.
6. A decision that belongs to the owner goes into the report under NEEDS_OWNER. A sub-agent cannot ask the owner.

## Report

```
STATUS: DONE | PARTIAL | NEEDS_OWNER
CHANGED: paths
TESTS: what was added and what covers each acceptance criterion
GATE: the result of scripts/gate --full
SHORT OF: what was not done
HANDOFF: (PARTIAL only) done, next step, paths
```
