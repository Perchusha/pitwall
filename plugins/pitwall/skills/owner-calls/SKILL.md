---
name: owner-calls
description: Lists everything that waits for the owner in a pitwall project, grouped, one line each, with what happens if the owner says nothing - the switches only the owner sets, open questions of the epics and the plan, bugs filed without the owner's answer, PRs ready and waiting for the owner's yes, open bugs - then asks them one at a time and records each answer where it belongs. The owner runs it as /pitwall:owner-calls.
disable-model-invocation: true
---

# owner-calls - what waits for the owner

> Status: built in T4a; bugs by severity and unconfirmed bugs since T4b.

Gathers what waits for the owner with a script, shows it in one message and goes through it with them, one question at a time. Whatever an agent may not write, it hands over as a command for the owner's own terminal.

Plugin files used: `${CLAUDE_PLUGIN_ROOT}/scripts/owner-calls.mjs`, `bugs.mjs` for an answer about a bug, and `merge.mjs` for a merge the owner says yes to.

## Rules

- Run each command as written, from the project root, one command per call.
- One question per message, then wait. Never answer for the owner.
- Never record the owner's choice of merges without them (ADR-0010) or the merge protection mode: only their own scripts write them, and the guard keeps agents out. Hand over the command the list gives, verbatim, under "Run this yourself, in bash or PowerShell:" (L-6).
- Write plain Markdown the docs check reads, keeping the template's headings. Never write `docs/BUGS.md`, `docs/RISKS.md` or `docs/LESSONS.md` by hand: an answer about a bug goes through `bugs.mjs`, which keeps it in the git directory until the next branch's first commit.

## Steps

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/owner-calls.mjs"`. It reads `.claude/pitwall.json`, the docs and, through gh, the open PRs and their checks, and writes nothing.
2. Show its list in one message, as it printed it: each group, each line with what happens if the owner says nothing, the commands for the switches, and its notes (GitHub not read, for instance). When it says nothing waits, say so and stop.
3. Go through the questions first, one per message, in the list's order:
   - an open question of an epic: ask it; record the answer in that epic's "## Open questions" as a line `Answered (<date>): <the question>: <the answer>`, in place of the question; a new one-way decision goes through `/pitwall:decide <area>` instead;
   - an open item of the plan review: it is closed in the plan, not here: say so and point to `/pitwall:plan`;
   - a bug filed without the owner's answer: show its row (`node "${CLAUDE_PLUGIN_ROOT}/scripts/bugs.mjs" list --all`), propose its severity and its risk class as `/pitwall:bug` step 3 does, and ask the owner to confirm or change both; record them with `node "${CLAUDE_PLUGIN_ROOT}/scripts/bugs.mjs" set <BUG-n> --severity "<s>" --risk <class>`. When they will not have it fixed, ask what they will do if it comes true and run `node "${CLAUDE_PLUGIN_ROOT}/scripts/bugs.mjs" accept <BUG-n>` with their answer on stdin, in a quoted heredoc as `/pitwall:bug` files a bug (`fallback: <their answer>`) instead;
   - an open bug: nothing to ask; a blocking one's fix goes right after the change in flight, one that is not blocking waits until no epic is ready, and every fix merges after the owner's yes. When the owner changes its severity, its class or its title, or will not have it fixed, record it with `bugs.mjs set` or `bugs.mjs accept`, as above;
4. Before any merge, put the answers where they stay (`git branch --show-current` tells where the project is):
   - on the branch of a change with no PR open yet (`gh pr list --head <branch> --state open` lists nothing): commit them there, naming each path, `git commit -m "docs: the owner's answers" -- <paths>`;
   - on `main`, which is protected, or on a branch whose PR is open: never commit them, since a commit there can move a reviewed head and ask for another review round. They stay in the tree, and the first commit of the next branch `/pitwall:continue` starts records them (its step 1); say so.
5. Then the ready merges, last, one per message: ask whether to merge it now. On no, it stays open. On yes:
   - `git switch <its branch>`, then `node "${CLAUDE_PLUGIN_ROOT}/scripts/merge.mjs" --change --owner-approved`, and act on its exit as `/pitwall:continue` step 9 says;
   - after a merge, with a remote, `git switch main` and `git pull --ff-only origin main`, as `/pitwall:continue` step 10 does, before the next merge or the end;
   - answers left in the tree move with these switches; when git refuses a switch or the pull over them, keep them with `git stash push -- <their paths>`, run the step again, then `git stash pop`.
6. Tell the owner in a few lines what is answered, what they still have to run, and what still waits; an answer about a bug waits in the git directory for the first commit of the next branch.

## Output

The answers in the epics' open questions, any merge the owner said yes to, and the commands handed over for the switches.
