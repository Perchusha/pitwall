---
name: gate
description: Runs the project's mechanical gate, scripts/gate, once with a bounded wait, and reports PASS or FAIL with the failing steps quoted. Use after a code change, before opening a PR, and whenever the owner asks whether the build is green. The owner runs it as /pitwall:gate, with --fast, --changed or --full (the default).
argument-hint: "[--fast | --changed | --full]"
disable-model-invocation: true
---

# gate - the mechanical contract

> Status: built in T3b.

Every pitwall project has `scripts/gate`, which E0 fills in once the stack is chosen; until then it is the template's stub, which passes on docs only and fails as soon as code appears. pitwall never assumes a stack: it only calls this script.

```
scripts/gate --fast      # lint, typecheck, unit tests: the inner loop
scripts/gate --changed   # checks for what changed since main
scripts/gate --full      # everything CI runs
```

Exit code 0 is a pass, anything else is a fail.

## Steps

1. The mode is `$ARGUMENTS`, or `--full` when it is empty; anything other than `--fast`, `--changed` or `--full` is a usage error: say so and stop.
2. Run `bash scripts/gate <mode>` from the project root, once, with the longest timeout the command tool allows: the way CI runs it, so a gate without the executable bit still runs. Never wrap it in a loop or run it again to see whether a red turns green.
3. Report in one message:
   - PASS, with the mode;
   - FAIL, with the exit code and the failing steps quoted verbatim from the output (the last lines that name what failed, not the whole log);
   - did not finish, when the timeout ended it: say so, which is not a FAIL, and that it was not run again.
4. A FAIL is never called "known" or "flaky" in the same breath as it is found. Read what failed and say what you think the cause is and whether it comes from the change at hand. A red on `main` that the change did not cause goes to the owner: it is a bug for the next loop of `/pitwall:continue`.

## Output

The verdict in one message. Nothing is written or committed.
