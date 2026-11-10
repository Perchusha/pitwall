---
name: owner-calls
description: Lists everything that waits for the owner in a pitwall project, grouped, one line each, with what happens if the owner says nothing - the switches only the owner sets, open questions of the epics and the plan, PRs ready and waiting for the owner's yes, open bugs - then asks them one at a time and records each answer where it belongs. The owner runs it as /pitwall:owner-calls.
disable-model-invocation: true
---

# owner-calls - what waits for the owner

> Status: built in T4a.

Gathers what waits for the owner with a script, shows it in one message and goes through it with them, one question at a time. Whatever an agent may not write, it hands over as a command for the owner's own terminal.

Plugin files used: `${CLAUDE_PLUGIN_ROOT}/scripts/owner-calls.mjs`, and `merge.mjs` for a merge the owner says yes to.

## Rules

- Run each command as written, from the project root, one command per call.
- One question per message, then wait. Never answer for the owner.
- Never record the owner's choice of merges without them (ADR-0010) or the merge protection mode: only their own scripts write them, and the guard keeps agents out. Hand over the command the list gives, verbatim, under "Run this yourself, in bash or PowerShell:" (L-6).
- Write plain Markdown the docs check reads, keeping the template's headings.

## Steps

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/owner-calls.mjs"`. It reads `.claude/pitwall.json`, the docs and, through gh, the open PRs and their checks, and writes nothing.
2. Show its list in one message, as it printed it: each group, each line with what happens if the owner says nothing, the commands for the switches, and its notes (GitHub not read, for instance). When it says nothing waits, say so and stop.
3. Go through the questions and the ready merges, one per message, in the list's order:
   - an open question of an epic: ask it; record the answer in that epic's "## Open questions" as a line `Answered (<date>): <the question>: <the answer>`, in place of the question; a new one-way decision goes through `/pitwall:decide <area>` instead;
   - an open item of the plan review: it is closed in the plan, not here: say so and point to `/pitwall:plan`;
   - a PR ready and waiting for the owner's yes: ask whether to merge it now; on yes, `git switch <its branch>` and `node "${CLAUDE_PLUGIN_ROOT}/scripts/merge.mjs" --change --owner-approved`, and act on its exit as `/pitwall:continue` step 9 says; on no, it stays open;
   - an open bug: nothing to ask; its fix goes first in the next `/pitwall:continue`.
4. Commit what you recorded on the branch the project is on, naming each path (`git commit -m "docs: the owner's answers" -- <paths>`); on `main`, which is protected, leave it for the first commit of the next branch and say so.
5. Tell the owner in a few lines what is answered, what they still have to run, and what still waits.

## Output

The answers in the epics' open questions, any merge the owner said yes to, and the commands handed over for the switches.
