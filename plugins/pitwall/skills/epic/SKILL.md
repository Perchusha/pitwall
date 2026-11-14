---
name: epic
description: The implementer's procedure for one change of a pitwall project, an epic or a bug fix - read first, implement on the change's branch with tests for every new module and a test or QA scenario per acceptance criterion, keep the gate green, commit, and return a DONE, PARTIAL or NEEDS_OWNER report. Preloaded into the implementer and implementer-deep agents; the main conversation never follows it itself, it dispatches an implementer through /pitwall:continue.
user-invocable: false
---

# epic - implement one change

> Status: built in T3b.

The procedure of the `implementer` and `implementer-deep` agents. `/pitwall:continue` dispatches one of them per change with a brief: the project root, the change (its file in `docs/epics/`, or its row in `docs/BUGS.md`), its branch and risk class, the ADRs it follows, the owner's answers from the clarification, and the task: implement the change, continue from a handoff, close the findings the brief names from the change's review file, or make a red gate green again.

Plugin files used: `${CLAUDE_PLUGIN_ROOT}/config/defaults.json` (`budgets.subagentToolCalls`, `riskClasses`).

## Rules

- Work on the branch the brief names, in the project root. Never switch branches, push, merge, open a PR or set a status: the main conversation does that. Never touch `main`.
- Do the task of the brief and nothing outside it: a change the epic's "Out of scope" excludes, or an unrelated fix, goes into the report under SHORT OF instead.
- Never weaken a check, a test, a lint rule, a hook or the CI to make something pass: fix the cause. Never edit `.claude/`, the pitwall plugin, the docs the reviewers write (`docs/PLAN-REVIEW.md`, `docs/reviews/`) or the gate's check name in CI. Leave `docs/EPICS.md`, `docs/BUGS.md` and `docs/JOURNAL.md` to the main conversation, which records the change when it merges: put the numbers worth keeping in your report instead. This holds even where the project's `CLAUDE.md`, laid out by an older pitwall, asks for a journal entry after an epic.
- A decision that belongs to the owner stops that part of the work and goes under NEEDS_OWNER, with the options: a new one-way decision (data model, a dependency that locks the project in, an external service), a change of scope, anything an ADR does not cover and you cannot take back easily. You cannot ask the owner yourself. Finish everything that does not depend on the answer.
- Versions of new dependencies come from the registry, never from memory, and fit `docs/STACK.md`; a dependency the stack does not name is a decision for the owner.
- Run each command on its own, from the project root.

## Steps

1. **Read** before any code: `docs/LESSONS.md`, then `CLAUDE.md` (the commands, the architecture boundaries, the definition of done), the change and its acceptance criteria, every ADR it cites, and the code it touches. For a continuation, the handoff first; for review findings, the review file and the rows the brief names. Notes of the plan's reviewer that the brief quotes for this epic are advice: follow one where it fits the criteria, and name under SHORT OF each one you left, with the reason.
2. **Plan the work** in a few lines for yourself: which modules change, which tests cover which criterion, in what order.
3. **Implement** in small steps. Every new module gets unit or integration tests; every acceptance criterion gets a test that would fail if the behaviour broke, or, where no test can drive it (a system tray, a sleep and wake, an installer), a QA scenario: the steps, and what the tester sees. A QA scenario is for the owner, who tests as a user of the product: it starts with what this change makes visible and what is not there yet (the epic's `Visible after it:` line, and the later epics), so that what is still missing does not read as a defect. When this change alters what a QA scenario of a merged epic describes (a window it removes, a menu it changes, a command it renames), rewrite that scenario in the same change, so that it still describes the product: the release hands every scenario of every closed epic to the owner as their checklist, and a stale one stops the release. Unit tests never touch the network. A bug fix starts with a regression test that fails without the fix; only where no test can drive the behaviour, a QA scenario in a file, and the report says why no automated test can.
4. **Keep the gate green.** The hook runs `scripts/gate --fast` after each edit outside `docs/` and tells you when it is red: fix it before the next step. Run `scripts/gate --fast` yourself whenever you want the verdict.
5. **Commit** each green step on the branch with a conventional message (`feat: ...`, `fix: ...`, `test: ...`, `refactor: ...`), only the files of that step. For review findings, one commit per finding where you can, with its number in the message (`fix: review finding 3, ...`), so the reviewer can name the commit that closed it. Every commit runs `scripts/gate --fast` first, through the project's `.githooks/pre-commit`, and a red gate refuses it: run `git commit` with the longest timeout the command tool allows, as for the gate, and when it is refused, fix what the gate reports and commit again; a red that does not come from this change (a test that fails on this machine only, a red `main`) goes under NEEDS_OWNER instead. Never `--no-verify` or `-n`, and never change `.githooks/` or `scripts/gate` unless the change is about them. A regression test that fails without its fix goes into the same commit as the fix.
6. **Finish.** Run `scripts/gate --full`; it must pass, and the tree must be clean: everything committed. Update `docs/SPEC.md`, the README or `CLAUDE.md` where the change altered behaviour, architecture or commands, and commit that too.
7. **Watch the budget.** The hook warns at `budgets.subagentToolCalls.warn`: finish the step you are on, commit what is green, and return PARTIAL with a handoff. Past `stop` every call is refused.

## High risk, and bugs whose cause is unknown

For `implementer-deep`, on top of the steps:

- Before the code, write down the ways this change can fail in production (a half-applied migration, a token that leaks, a deletion that cannot be taken back, a retry that charges twice) and give each a test or a guard in the code.
- A data migration runs forward and back on a copy in a test, and never deletes what it cannot restore.
- A bug whose cause is unknown: reproduce it first in a failing test, find the cause before any fix, and say in the report what the cause was and why the fix removes it.

## Report

Return exactly this shape, nothing after it:

```
STATUS: DONE | PARTIAL | NEEDS_OWNER
CHANGE: <the change, as the brief names it>
CHANGED: <the paths, one per line>
COMMITS: <sha and subject of each commit, one per line>
TESTS: <for each acceptance criterion (or the bug): the test that covers it, its file and name, or the QA scenario in one line>
GATE: <the result of scripts/gate --full: PASS, or FAIL with the failing step>
SHORT OF: <what the task asked for and is not done, and why; or "nothing">
NEEDS_OWNER: <questions only the owner can answer, each with its options; or "none">
HANDOFF: <PARTIAL only: what is done, the exact next step, the paths in progress>
```

DONE only when the task is complete, `scripts/gate --full` passes and the tree is clean, but for a file in `docs/reviews/` the reviewer left uncommitted: leave that one as it is. A QA scenario written for the owner to run counts as done; what only the owner can do (run it on their laptops, watch a window, sign an installer) goes under SHORT OF, and the report is still DONE. PARTIAL is for work an implementer can still do.
