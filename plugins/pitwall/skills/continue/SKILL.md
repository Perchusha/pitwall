---
name: continue
description: Stage 6 of pitwall, the conductor of the epic loop. Orients from the session brief, git and the docs, selects the next change (an open bug, the change in flight, or the next epic), clarifies it with the owner, dispatches an implementer, gates it, opens the PR, runs the code-reviewer until it approves, merges by risk class and records the result, then loops. The owner runs it as /pitwall:continue once the plan is merged, and again to resume.
disable-model-invocation: true
---

# continue - the epic loop

> Status: built in T3b. Releases and QA (step 8 of SPEC 6) come in T4: until then the loop ends each lap at the merge.

```
ORIENT -> SELECT -> CLARIFY -> BRANCH -> IMPLEMENT -> GATE -> PR -> REVIEW -> MERGE -> RECORD -> loop
```

Takes a project with a merged plan through its changes, one at a time: the fix of an open bug, the change in flight, or the next epic. Implementers write the code, a fresh `code-reviewer` judges it, `merge.mjs` merges it by its risk class, and the owner answers what only the owner can answer.

Plugin files used: `${CLAUDE_PLUGIN_ROOT}/config/defaults.json` (`riskClasses`, `budgets`, `review`, `loop`, `mergeProtection`) and the scripts in `${CLAUDE_PLUGIN_ROOT}/scripts/`: `docs-check.mjs`, `merge.mjs`, `protect.mjs` (and `review-status.mjs`, which only the reviewer runs, and `merge-choice.mjs`, which only the owner runs).

## Rules

- Run each command as written, from the project root, one command per call.
- One question per message, then wait. Never answer for the owner, never accept a risk for them, and never pass `--owner-approved` without their yes to that merge in this conversation.
- This conversation writes docs only: the change's own file, `docs/EPICS.md`, `docs/BUGS.md`, `docs/RISKS.md`, `docs/JOURNAL.md` and the Approval section of `docs/PLAN-REVIEW.md`. Code is the implementers'. Never edit a file in `docs/reviews/` and never set `ai-review`: both belong to the reviewer.
- One change in flight at a time, on its own branch: `epic/E<n>-<slug>`, the epic's file name, or `fix/BUG-<n>` (`loop.branches`).
- When a script hands a step over, show the owner its HANDOFF lines verbatim. Never retry a refused write another way, and never work around a hook.
- Keep the template's headings and table columns, and write the plain Markdown the docs check reads, as `/pitwall:plan` does.

## Steps

1. **Preflight.**
   - Read `.claude/pitwall.json`; without it, stop: `/pitwall:kickoff` first. When the session brief names a planning stage, or `main` holds no merge commit whose message has `Plan approved by the owner`, stop: the plan comes first, `/pitwall:plan`.
   - When `.claude/pitwall.json` has no `autoMerge` (a project laid out before ADR-0010), ask the owner one question: may low and normal risk epics merge without them once `gate` and `ai-review` are green? High risk and bug fixes always wait for them. Either way, hand them the command to run themselves in a terminal, which the guard keeps from every agent: `node "${CLAUDE_PLUGIN_ROOT}/scripts/merge-choice.mjs" --allow` for yes, `--deny` for no. Go on; until it is recorded, every merge waits for the owner.
   - When `mergeProtection` is `pending`, tell the owner once and offer to run `node "${CLAUDE_PLUGIN_ROOT}/scripts/protect.mjs"`.
   - With a remote, `git fetch origin`. Run `git status --porcelain`: changes that belong to the change in flight stay; anything else the owner commits or drops first.
2. **Select.** Read `docs/EPICS.md`, `docs/BUGS.md` and the branches (`git branch --list "epic/*" "fix/*"`).
   - With `gh`, `gh run list --branch main --limit 1 --json conclusion,displayTitle,url`: a last run on `main` that failed stops the loop. Tell the owner what failed; it becomes a bug for them to file.
   - A change is merged when its branch has commits of its own and its last commit is in the history of `main` (`git merge-base --is-ancestor <branch> origin/main`, or `main` without a remote): pitwall merges with a merge commit. Note every merged change whose status in the docs is not yet `merged` or `fixed`: step 4 records it.
   - Then by precedence: an open bug (a row of `docs/BUGS.md` whose status is not fixed), the oldest first; else the change in flight, an `in progress` or `in review` one that is not merged, resumed at its step (its PR, its review round, its merge); else the next `planned` epic whose dependencies are all merged.
   - Nothing left: tell the owner the plan is done, and stop.
   - Tell the owner in a few lines what you picked and why.
3. **Clarify.** Reread the change: the epic and its acceptance criteria (or the bug's row), every ADR it cites, `docs/LESSONS.md` and `CLAUDE.md`. Ask the owner what is unclear or decides something, one question at a time, before any code. Record each answer in the epic's "Open questions" section (for a bug, in the brief and the PR); a new one-way decision goes through `/pitwall:decide <area>` first.
4. **Branch.** With a remote, `git switch main` and `git pull --ff-only`. Then `git switch -c <branch>` (a change in flight: `git switch <branch>` and go to its step). The first commit of the branch records, in `docs/`:
   - each merged change step 2 noted: `merged (#<pr>)` as its status in `docs/EPICS.md`, or `fixed` and `#<pr>` in `docs/BUGS.md`, and an entry in `docs/JOURNAL.md`: what shipped, its review rounds and findings (from its file in `docs/reviews/`), the implementers it took, and its cost where known;
   - for E0 only, the Approval section of `docs/PLAN-REVIEW.md`: the line `Plan approved by the owner, <date>, at <sha>`, with the date from the plan's merge commit message and the sha of that merge commit (`git log --merges --grep="Plan approved by the owner" -1 --format="%H %B" main`), ADR-0008;
   - this change's status, `in progress`.
   Then `git add docs/ .claude/pitwall.json`, `git commit -m "docs: start <change>"`, and with a remote `git push -u origin <branch>`.
5. **Implement.** Dispatch one implementer with the brief below: `pitwall:<riskClasses.<class>.implementer>` with that class's `effort`, by the epic's risk class; for a bug, `pitwall:implementer-deep` with the high class's effort when its cause is unknown, `pitwall:implementer` with the normal class's effort when it is known. On its report:
   - DONE: go to step 6.
   - PARTIAL: dispatch a fresh implementer with the handoff; the work stays in the tree.
   - NEEDS_OWNER: ask the owner, one question at a time, record the answers in the epic, and dispatch a fresh implementer with them.
   Every dispatch for this change counts: after `budgets.implementersPerChange` of them, the owner decides whether to go on.
6. **Gate.** Run `bash scripts/gate --full`, once, with the longest timeout (as `/pitwall:gate` does). Red: no PR; dispatch an implementer with the failing output (step 5's count goes on).
7. **PR.** Set the change's status to `in review` in `docs/EPICS.md` (for a bug, in `docs/BUGS.md`), `git commit -am "docs: <change> in review"`, then `git push -u origin <branch>`. When `gh pr list --head <branch> --state open` lists nothing, open it: `gh pr create --base main --head <branch> --title "<E<n> - title, or BUG-<n>: what it fixes>" --body "<body>"`, the body after `.github/pull_request_template.md`: the risk class, each acceptance criterion with what covers it (from the implementer's TESTS), the ADRs, what was not done (SHORT OF), and the review file. A failed push or PR is not retried: show the error, and the reviewer's status step hands it over.
8. **Review.** Dispatch `pitwall:code-reviewer` with the reviewer brief below, a fresh agent each round. Show the owner its STATUS, the open items in a short list, a LESSON it proposes, and any HANDOFF lines verbatim. For each open item:
   - a finding in the code: dispatch a fresh implementer to close the findings by number (step 5's count goes on); it commits on the branch;
   - a risk to accept: ask the owner; on yes, add the next `R-n` to `docs/RISKS.md` with the risk, their fallback and today's date;
   - a question only the owner can answer: ask it and record the answer where it belongs.
   Commit the docs (`git commit -am "docs: close review round <n> of <change>"`), push, and run the next round.
   The loop has an end, the same as the plan's (L-8). The first `review.ownerDecidesAtReject` rounds are full reviews. After them, show the owner what is still open, and they decide, item by item, to fix it or accept it as a risk. Later rounds are verification rounds: the reviewer checks its findings, adds only blocking ones, and lists the rest under NOTES, which the owner reads and none of which blocks. Rounds stop at `review.maxRounds` in all: what is open then, the owner fixes or accepts, and the last round only records it.
9. **Merge**, once the reviewer returned APPROVED. Run exactly `node "${CLAUDE_PLUGIN_ROOT}/scripts/merge.mjs" --change`, with no other argument: the owner's allow rule names it so.
   - Exit 0 (`RESULT: merged`): go to step 10.
   - Exit 4 (`RESULT: waits for the owner`): show the owner one summary (the change, its risk class, the reviewer's verdict and its file, what was not done) and ask one question: merge it now? On yes, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/merge.mjs" --change --owner-approved`. On no, or not yet, stop here; `/pitwall:continue` resumes at this step.
   - Exit 3: when the gate is still running, run the same command again (a yes still stands); otherwise show the HANDOFF block verbatim and stop.
   - Exit 1: show why it refused; when `ai-review` is not success on the head, run one more review round (step 8).
10. **Record and loop.** With a remote, `git switch main` and `git pull --ff-only`. The merge is recorded by the first commit of the next branch (step 4), since `main` is protected. Count the changes merged in this session: after `budgets.epicsPerSession`, stop and suggest a fresh session; otherwise go back to step 2. When you stop, say in a few lines where each change stands and what waits for the owner.

## Implementer brief

Only what the implementer needs, never this conversation: the project root; the change (the path of its epic file, or its row of `docs/BUGS.md` quoted) and its branch; its risk class; the paths of the ADRs it cites; the owner's answers from step 3; the task: implement the change, continue from a handoff (quoted), close review findings (the review file's path and the finding numbers), or make the gate green (its failing output quoted); and the config path `${CLAUDE_PLUGIN_ROOT}/config/defaults.json` with its call budget, `budgets.subagentToolCalls`.

## Reviewer brief

Only what the reviewer needs to find the change, never this conversation or the implementer's reports: the project root; the change and its branch; the round number, one more than the `- Round:` of the change's review file on the branch, or 1 when there is none, and from round `review.ownerDecidesAtReject` + 1 on, that it is a verification round; the config path `${CLAUDE_PLUGIN_ROOT}/config/defaults.json`; the template `${CLAUDE_PLUGIN_ROOT}/template/docs/reviews/template.md`; the paths to read (`docs/LESSONS.md`, `CLAUDE.md`, the epic's file or `docs/BUGS.md`, the ADRs it cites, `docs/RISKS.md`, the review file); and the commands it may run, with their paths and the project root spelled out, so it needs no `cd`:

- read-only git: `git diff main...HEAD`, `git log`, `git show`, `git status`, `git rev-parse HEAD`, `git ls-files`, `git blame`;
- `bash scripts/gate --full` (or `--fast`);
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/docs-check.mjs" --root "<project root>" --stage code-review`;
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/review-status.mjs" --review code --state success --project "<project root>"`, or `--state failure --description "code review: <n> open"`.

## Output

- Per change: its branch, its commits, the PR, `docs/reviews/<change>.md` from the reviewer with `ai-review` on the PR, and the merge into `main` with a `feat(E<n>): ...` or `fix(BUG-<n>): ...` merge commit that records the risk class and who approved it.
- In the first commit of the next branch: the statuses in `docs/EPICS.md` and `docs/BUGS.md`, an entry per merged change in `docs/JOURNAL.md`, and for E0 the Approval line of the plan.

## Check

Each merged change passed `scripts/gate --full` before its PR and `docs-check --stage code-review` before `ai-review` turned green, and `merge.mjs` merged it only with both checks green on the reviewed head, by its risk class or after the owner's yes.
