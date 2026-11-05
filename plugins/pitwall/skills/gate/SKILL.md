---
name: gate
description: Runs the project's mechanical gate through scripts/gate and reads the verdict. Use after any code change, before opening a PR, and whenever the owner asks whether the build is green.
disable-model-invocation: true
---

# gate - the mechanical contract

> Status: planned for epic T3, not implemented in v0.1.0. If this skill is invoked, tell the owner that the gate skill is not built yet and stop.

## The contract

Every pitwall project has `scripts/gate`, filled in during E0 once the stack is chosen:

```
scripts/gate --fast      # lint, typecheck, unit tests: the inner loop
scripts/gate --changed   # checks for packages changed since main
scripts/gate --full      # everything CI runs
```

Exit code 0 is a pass, anything else is a fail. The plugin never assumes a stack: it only calls this script.

## What it will do

1. Run the gate in the background into a log and wait with one bounded wait, never a loop with no end.
2. Report PASS or FAIL with the failing steps quoted verbatim.
3. A new red is never declared "known" in the same breath as finding it: diagnose it first and file it in `docs/BUGS.md`.
