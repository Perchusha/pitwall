# Journal, T4a to T4c

The entries of the epics T4a, T4b, T4d and T4c, in the order they merged, moved out of `docs/JOURNAL.md` to keep it under its size limit (`docsLimits.stateFileMaxKB`). Newest first.

## T4c - Releases and a minimal QA (2026-11-13)

`/pitwall:release` ships what the loop merged since the last release as one version (ADR-0013). `release.mjs` reads the loop's merge commits on `main`, an epic making a minor and fixes alone a patch, the first version and a major by the owner's word, and writes `CHANGELOG.md` on a branch `release/v<x.y.z>` whose one commit also records the changes it holds, the last one of a plan included. The `qa` agent is the release's reviewer: it checks the release, runs the project's new `scripts/build <version>` and the gate, finds a test or a QA scenario behind every criterion of every closed epic and every fixed bug, files a bug per failure, and lists the manual QA for the owner. The release merges after the owner's yes, never while a blocking bug is open or another change is in flight, and the owner makes and pushes the tag from the commands it hands them. ADR-0007 gains the qa agent as a third reviewer, each reviewer bound by the guard to its own kind of review. The owner's three conditions on the qa agent, their additions (the tag is theirs, the first version is one question, the artifacts stay local) and their edits came in two lists; L-15 (the executable bit), L-16 (a change that records others), R-6 and BUG-10 (the tag left to the skill's text) came from the work and the reviews.

**Numbers.** `scripts/check.mjs` grew from 27 to 28 steps, the new one "releases (fake gh)": `release.mjs` on scratch repositories in each of its modes and refusals, `merge.mjs` and `review-status.mjs` on a release branch, and `docs-check --stage release`; the template step now reads `template/scripts/` and `template/.githooks/` whole (L-15). The branch adds 1,838 lines and removes 131 over 47 files.

| Run | Turns | Minutes | Cost | Result |
| --- | --- | --- | --- | --- |
| hooks, plugin 2d7d7a8 | 24 | | $1.43 | fail: the qa agent refused on its own to run `review-status.mjs --review code`, as its prompt says, so the guard's refusal the run counted never came |
| hooks, plugin 4636fb3 | 24 | 3.5 | $1.17 | pass: the qa agent sets a release's status, which the guard lets through |
| hooks with `--record`, plugin fdfa4c0 | 24 | 3.7 | $1.22 | pass; the qa agent's five payloads kept |
| release, fake GitHub, plugin 4636fb3 | 2 | | | stopped by the owner: the qa agent set `failure`, rightly, on a journal entry the conductor wrote with pitwall's ADR-0010 as a bare ID; the skill closed the release and started it again |
| release, fake GitHub, plugin 58c428e | 3 | 9.2 | $4.50 | pass: v0.1.0 with E0, E1 and BUG-1, the owner asked before the merge, no tag from the session, the scripted owner's tag on the release's merge commit |
| release, fake GitHub, plugin e8acec1 | 3 | 7.2 | $4.58 | pass, the same, at the head that merged |

**What only the work showed:**
- The qa agent found a real defect in the first release it reviewed: the conductor's journal entry cited one of pitwall's own ADRs as if it were the project's, which the docs check reads as an ID that points nowhere. The skill now names pitwall's IDs in words.
- A prompt beats a test's design: told to run a status of the wrong kind, the qa agent refused before the guard could. The headless run now checks the call it may make; the check holds the refusal.
- git on Windows dropped the executable bit of a new file in a commit with pathspecs a third time (the gate, the hook, the build stub); the check before the commit read the index, which still said 100755. L-15 reads both template folders whole.
- `git tag -F` strips every line that starts with `#`: the tag's commands carry `--cleanup=verbatim` to keep the changelog's headings.
- A release is a change that records others, like a loop branch's first commit: started beside another change in flight it conflicts with that change's records, and merged after `main` moved it holds code nobody built (L-16).

**What the review found.** Three fresh-context rounds, the cap the owner set, with the guard's corpus replayed after each change of the guard (L-13): of about 103,500 command lines of the local transcripts and T4a's 52 variants, the 9,650 that hold `<<` or `review-status` ran through the guard of `main` and of the branch as three callers, and the same 9 verdicts changed each time, all expected. Round one: one blocking finding, the release beside a change in flight or after `main` moved (L-16), and two to fix (no build wanted at the reviewed commit, a test that passed without its check), with eleven points of its notes. Round two: none blocking, three to fix (a build run again after a timeout refused, the check's records and versions untested, a merged release read as one to close). Round three, a verification round on round two's diff at the owner's word: none; a differential run of `merge.mjs` at three commits over 219 cases showed the merge of epics and fixes unchanged. Its four notes went into T5a's first commit.

| Round | Blocking | Subagent tokens | Tool calls | Minutes |
| --- | --- | --- | --- | --- |
| 1 | 1 | 335,285 | 75 | 18.9 |
| 2 | none, 3 to fix | 331,838 | 79 | 20.5 |
| 3, verification | none | 211,975 | 73 | 12.7 |

**Next:** T5a, the move reminder from scratch to a release, whose first question is a release built on two machines.

## T4d - The gate before every commit (2026-11-12)

A pitwall project gets `.githooks/pre-commit`, which runs `scripts/gate --fast` before every commit and refuses it while the gate is red (L-14), except on `spike/*` and for a commit of Markdown under `docs/` and `.claude/pitwall.json` alone, which must land while the gate is red: the first commit of a fix for a red `main`, a reviewer's verdict. `/pitwall:kickoff` sets `core.hooksPath` before the skeleton commit, `/pitwall:continue` sets it in a new clone and lays the hook out in a project from before 0.8.0 through `layout.mjs --hook`, a commit of its own. The guard's rule `precommit` refuses `git commit --no-verify` or `-n` and a `git config` that points `core.hooksPath` elsewhere or unsets it; what it does not read is R-5, by the owner's choice of a narrow rule. pitwall itself runs `scripts/check.mjs --fast`, the steps that only read the repository or lay out scratch projects, before each of its own commits. ADR-0012 records the hook and its limits: it checks the work tree, not what is committed, and git makes some commits without it; CI catches both.

**Numbers.** `scripts/check.mjs` grew from 26 to 27 steps, the new one the template's hook in a scratch project (a red gate refuses code, a green one passes, `spike/*` and docs alone pass while red, a gate's own scratch repository leaves the project's commit alone), and gained `--fast`: about 9 seconds of the full run's 200 on the owner's machine. The hooks step gained the rule's cases both ways, in bash and PowerShell. The branch adds 689 lines and removes 104 over 39 files.

| Run | Turns | Minutes | Cost | Result |
| --- | --- | --- | --- | --- |
| hooks, plugin 5c9241b | 23 | 3.4 | $1.13 | pass: each guarded step refused by its rule, the skipped gate among them |
| hooks, plugin d4f3b55, the rule renamed `precommit` | 23 | 3.7 | $1.15 | pass, the same |
| bug, fake GitHub, plugin d4f3b55 | 6 | 11.0 | $11.12 | pass only through an accepted risk: the code reviewer counted the commit of `layout.mjs --hook` on the fix's branch as a blocking change to `.githooks/`, and the scripted owner accepted it as the project's R-1; one unscripted question, whether to record a lesson |
| bug, fake GitHub, plugin 1651426 | 4 | 7.6 | $5.22 | pass: the hook laid out and installed through `continue` in a project from before 0.8.0, the fix committed through it, review approved in round one, merged after the owner's yes |

**What only the work showed:**
- Git on Windows drops the executable bit of a new file in a commit that names its paths, which is how `continue` commits; the hook goes in a commit of its own.
- A hook runs with git's variables for the commit's own index set, so a gate whose tests make scratch repositories writes into the commit; the hook clears them first.
- A hook that refuses every red commit also refuses the first commit of a red `main`'s own fix, which holds only docs: hence the docs-only exception, found before any project met it.
- The reviewer's rule against changes to `.githooks/` caught pitwall's own upgrade of a project: every project laid out before 0.8.0 would have met that finding on its first branch. Only the headless stage `bug` showed it.

**What the review found.** Before round one the guard's change was replayed on 38,608 command lines of the owner's transcripts and the 52 variants of T4a (L-13): five refusals, all deliberate tests. Round one found three to fix, none blocking: `layout.mjs --hook` committed through the hook it adds, the hook's test would have passed with the gate in another mode or with `.claude/pitwall.json` left out of the docs-only rule, and two consequences of ADR-0012 said the opposite of the code. Its notes became BUG-7 (kickoff replaces a global `core.hooksPath` unasked), BUG-8 (`git config --global core.hooksPath .githooks` passes) and BUG-9 (Git LFS writes its hooks into `.githooks/`), filed after the merge, and the hook's missing time limit, which the owner accepted. Round two approved with no finding.

| Round | Blocking | Subagent tokens | Tool calls | Minutes |
| --- | --- | --- | --- | --- |
| 1 | none, 3 to fix | 248,678 | 61 | 16.9 |
| 2 | none | 261,312 | 67 | 18.7 |

**Next:** T4c, releases and a minimal QA.

## T4b - Bugs and lessons (2026-11-12)

`/pitwall:bug` files a defect of merged work as the next BUG-n with a title, a severity and a risk class the owner confirms, and `/pitwall:lesson` records L-n with what checks it; a rule a tool could check but none does is filed as a bug. `bugs.mjs` keeps a new row, an accepted risk and a lesson in the git directory, outside the work tree, until the first commit of the next branch takes it, and lets it go once a commit holds it. A blocking bug's fix goes right after the change in flight, never interrupting it, and a bug that is not blocking waits until no epic is ready. Every fix merges after the owner's yes at any class; the class only picks the implementer. A table of `docs/BUGS.md` from before T4b gains its columns in a project's next first commit. The guard's corpus and the gate before every commit, drafted here, went to T4d and then partly to T7, after T5 (owner).

**Numbers.** `scripts/check.mjs` grew from 25 to 26 steps: `bugs.mjs` on scratch projects in the order the conductor runs it (file, set, accept, risk, lesson, list, flush, an old table, a table with a column of its own), the docs check's stages `bug` and `lesson`, a bug's review without a file of the reviewed commit, and every fix waiting for the owner's yes. The branch adds 1,345 lines and removes 135 over 34 files, after the owner's simplification removed 508 lines of what the first build had.

| Run | Turns | Minutes | Cost | Result |
| --- | --- | --- | --- | --- |
| bug, fake GitHub, plugin dbe78d5 | 2 | 3.8 | $3.60 | fail: told by the session brief that it ran unattended, `/pitwall:bug` filed the bug unconfirmed without asking, then handed the owner the `bugs.mjs set` command to run |
| bug, fake GitHub, plugin 59b16c2 | 4 | 12.1 | $13.10 | pass: the bug filed after the owner confirmed it blocking and normal, fixed before the planned E2 with six regression tests, the old table given its columns in the fix's first commit, merged after the owner's yes, which was asked before the merge; the next branch's flush left the bug as the fix left it |

**What only the work showed:**
- A plan the owner reads as "a spaceship for one owner" is cut, not reviewed: after round one the owner removed the choice for fixes of their own, the class read in four places, the stash before a fix and the return to an interrupted change, about 500 lines, and a review round on them was stopped.
- Each review round's fix opened the next round's finding twice, as in T4a: round two found that the flush let rows go before a commit held them, and the fix of that kept a new bug waiting forever and reopened it once fixed (round three). The test followed an order the skill does not, so it passed.
- A session brief that says "unattended" is read as "no owner": the skill filed the bug without asking. Only a headless run showed it.
- The guard refused `node -e` reading the plugin's config, a false refusal of the kind L-9 names; the model read it with `grep` instead. It goes to T7 with the guard's other gaps.

**What the review found.** Three fresh-context rounds, the cap the owner set for pitwall's own epics. Round one: three blocking findings (the owner-calls skill not updated for unconfirmed bugs, a lesson on the branch naming a waiting bug failing the change's docs check, a fix branch without its bug's row) and seven to fix. Round two, after the simplification: none blocking, seven to fix. Round three: one blocking, a regression of round two's fix, and free text in double-quoted arguments expanded by bash; both fixed without a further round, the first checked by the headless stage. What stayed open: R-4, accepted, and one bug filed after the merge (`bugs.mjs flush` drops a cell of a hand-written row with a `|` not escaped).

| Round | Blocking | Subagent tokens | Tool calls | Minutes |
| --- | --- | --- | --- | --- |
| 1 | 3 | 238,076 | 49 | 12.2 |
| 2, after the simplification | none | 237,758 | 46 | 12.7 |
| 3 | 1 (a regression of round 2's fix) | 213,694 | 34 | 10.6 |

**Next:** T4d, the gate before every commit, then a smaller T4c and T5 on the reminder.

## T4a - Guards and process follow-ups (2026-11-10)

T4 was split in three at the owner's call: T4a, the guards and the loop's follow-ups, T4b, bugs and lessons, and T4c, releases and QA, each high risk and merged by the owner. In T4a the PreToolUse guard refuses a git command that would throw uncommitted work away (rule `uncommitted`, L-12), in the main conversation and in every agent, and only when it would: it reads the tree with `git status` before the command, follows `cd`, `git -C`, `$CLAUDE_PROJECT_DIR`, a variable the line sets to one plain path, and what earlier commands of the line stashed, committed, staged or unstaged, and its refusal names the files with the `git stash push` that keeps them, or a merge's `--abort`. `/pitwall:owner-calls` lists what waits for the owner from a read-only script, each item with what happens if they say nothing, asks one question at a time, commits the answers only on a branch with no open PR, and merges last. The conductor keeps the owner's choice of ADR-0010 in `.claude/pitwall.json` alone. A `--github` run restores the remote state of its snapshot after it checks the repository's id, and a scripted owner's answer that overrode a stop turns PASS into "PASS, stops overridden: N". The owner accepted the two-way list with edits: the refusal offers the safe way, `git checkout <path>` without `--` and Windows paths among the cases, owner-calls hands the owner's switches over as commands, the id check before anything is deleted, and GitHub's answers to a closed PR and a deleted branch recorded at the next run on real GitHub. What the guard cannot read before a command runs is R-3, which the owner accepted.

**Numbers.** `scripts/check.mjs` grew from 24 to 25 steps: the owner-calls script on scratch projects with the fake `gh` (a risk class raised on the branch, wrapped and nested questions), the snapshot restore against the live fake GitHub (another repository's id, no snapshot, an unexpected answer, a deletion that did nothing, `main` moved), and the scripted owner's UNSCRIPTED and OVERRIDE markers. The hooks step gained 166 cases of the new guard, all written by hand on scratch projects: 86 refused as uncommitted work, 74 that pass, and 6 refused as unreadable or as a switch. The headless runs, at API prices:

| Run | Turns | Minutes | Cost | Result |
| --- | --- | --- | --- | --- |
| hooks, plugin a20bf56 | 21 | 3.6 | $1.31 | pass: each guarded step refused by its rule, `uncommitted` among them |
| hooks, plugin bfc4246, the reviewed guard | 21 | 3.3 | $1.07 | pass, the same |
| e1, fake GitHub, plugin bfc4246 | 2 | 57.1 | $20.81 | pass: the conductor stopped once on a question that was the owner's (Electron 45 refuses a bare `--debug` before any app code runs) and the scripted owner took the recommended rename; 3 implementers (73 calls, 50 continuing after the answer, 31 closing the finding), 2 review rounds with one finding to fix (a start by the Windows installer set no data folder), merged without the owner through the allow rules; no unscripted question, no stop overridden, the ADR-0010 choice in no doc, and no hook refused any of the run's 329 calls |

**What only the work showed:**
- A guard that judges a line before it runs has to read it as the shell will: the folder after each `cd`, a variable's value, what an earlier stash or commit took and left, what a reset took out of the index, a folder a clone or `mkdir` makes. Each piece it learned to read was a new way to be wrong, in both directions. What it still cannot read is R-3, which an honest agent rarely writes.
- A refusal is only as good as the way out it names: `git stash` refuses unmerged paths, so in a merge the refusal names `git merge --abort` first.
- What the guard costs ordinary work was measured on the owner's local transcripts: about 95,000 distinct command lines from 4,251 transcripts, replayed through the guard before and after each fix, read where they lie and kept out of the repository. Against the round before it, the last fix changed two verdicts, both explained.
- Of the five regressions the review found, two were false refusals of command lines agents really send, which the replay shows at once as changed verdicts, and three were misses, which show only on a variant that spells them. The conductor ran neither between rounds; the reviewers ran both (L-13).

**What the review found.** Five full rounds and a verifying one (L-8). Round one found two blocking findings: any stash or commit earlier in a line turned the guard off for the rest of it, though a plain stash keeps no new file and a commit of some paths keeps only those; and owner-calls left the owner's answers uncommitted while a merge switched branches, so they landed on the branch just merged. Each blocking finding of rounds two to five was a regression of the conductor's own fix of the round before: after round one, unstaging and then restoring threw a staged change away, and a folder the guard could not resolve passed; after round two, every git command in such a folder was refused, read-only ones included (L-9); after round three, a PowerShell assignment's own name was expanded, so its value was judged as a program, and a variable of several paths was read as one path, so a rollback passed. The reviewers tried each fix on variants they wrote (52 for round five's, in bash and PowerShell, quoted and not) and on the replay of the transcripts. The verifying round found nothing blocking; what it found smaller went to R-3 and not into the code, since each small fix of the five rounds had opened a hole.

| Round | Blocking | Subagent tokens | Tool calls | Minutes |
| --- | --- | --- | --- | --- |
| 1 | 2 | 186,748 | 46 | 9.3 |
| 2 | 2 (both regressions of round 1's fixes) | 255,182 | 69 | 14.5 |
| 3 | 1 (a regression of round 2's fix) | 224,691 | 54 | 15.9 |
| 4 | 1 (a regression of round 3's fix) | 276,747 | 60 | 19.7 |
| 5 | 1 (a regression of round 3's fix) | 239,477 | 58 | 17.5 |
| 6, verification | none | 183,847 | 45 | 14.6 |

**Next:** T4b, bugs and lessons.
