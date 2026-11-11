---
name: lesson
description: Records a mistake that can repeat as the next L-n of docs/LESSONS.md - the rule in one line, why (the bug, PR or finding), the date and what checks it - and when a tool could check the rule but none does yet, files that missing check as a bug. Use in a pitwall project after a bug, a blocking review finding or the owner's correction that could happen again.
---

# lesson - turn a mistake into a rule

> Status: built in T4b.

The implementer and the reviewer read `docs/LESSONS.md` before anything else: that, not a fresh context alone, is what stops the same mistake twice. A rule a tool can check becomes a guard; until one is built, the lesson names the bug that builds it.

Plugin files used: the scripts in `${CLAUDE_PLUGIN_ROOT}/scripts/` (`bugs.mjs`, `docs-check.mjs`) and the skill `/pitwall:bug`.

## Rules

- Never write `docs/LESSONS.md` by hand: `bugs.mjs lesson` numbers and dates the row. It waits in the git directory until the first commit of the next branch, except a lesson from the review of the change in flight that names no bug waiting for a branch, which goes on that change's branch with `--tree` (step 5).
- Run each command as written, from the project root, one command per call; give the lesson on stdin with a quoted heredoc in bash (the Bash tool).
- One question per message, then wait. Never answer for the owner.

## Steps

1. **Preflight.** `docs/LESSONS.md` must exist; without it, stop and say so.
2. **Read `docs/LESSONS.md`.** When a lesson there already says it, propose to sharpen that one instead, in one question: a second row saying the same thing is not read twice as carefully.
3. **Draft the row:**
   - the rule: one line, what to do or never do, in words a reader can check against their own work;
   - why: the bug (`BUG-<n>`), the PR, the review finding or the owner's correction it comes from, and what went wrong, in a sentence;
   - checked by:
     - a tool that checks it now: name it (a step of the check, a rule of a hook, a test);
     - a tool could check it but none does: file that missing check with `/pitwall:bug` first (found in review or owner; the steps show the mistake; expected: the check refuses it; actual: nothing does; not blocking, since a missing check does harm only after someone's mistake; the class by what the check touches, high for a guard), and write `Not by a tool until BUG-<n>`. The owner may put it into an epic instead: then `Not by a tool until <E<n>-AC<m>>`;
     - no tool can: who checks it, `By the reviewer: <what they read>` or `By hand: <who, when>`.
4. **Show the row** to the owner and ask one question: record it as it stands? Change it as they say.
5. **Record it:**
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/bugs.mjs" lesson <<'EOF'
   rule: <the rule>
   why: <why>
   checked by: <what checks it>
   EOF
   ```
   When the lesson comes from the review of the change in flight (`/pitwall:continue` step 8), add `--tree` after `lesson`: it goes into `docs/LESSONS.md` on that change's branch, where the next implementer of the change reads it, and the conductor commits it with the round's docs. Not when it names a bug whose row is not in `docs/BUGS.md` on that branch, such as the missing check just filed in step 3: the script refuses, since the docs check of the change would find an ID that points nowhere, so record it without `--tree`, and it waits with the bug for the same first commit.
6. **Tell the owner** the `L-<n>`, the rule, what checks it, and where it waits.

## Output

`RECORDED: L-<n>`, waiting in the git directory for the first commit of the next branch, or in `docs/LESSONS.md` on the branch of the change in flight; `docs-check.mjs --stage lesson` passes on it.
