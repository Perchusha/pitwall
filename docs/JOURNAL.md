# Journal

One entry per epic, newest first.

## T5a - Validation on the lite system: the move reminder (2026-11-14)

The owner took the move reminder through pitwall 0.9.0, installed from its marketplace, in a new empty public repository: kickoff, discovery, decide, a spike, the plan with its review and E0 through the loop to its merge, in one interactive session of four and a half hours. It was the first project to get branch protection, admins included, through kickoff. The run ended there by the owner's decision: one session had shown what the validation was for, and the rest of the path, a release, is held by the headless `release` stage. The reminder itself changed on the way, as a real project does: the idea leaned to Electron on two systems, discovery and decide made it a Windows tray app on WinForms, and its spike on notification buttons was not confirmed, a risk the owner accepted. What the session asked for shipped as 0.10.0: `/pitwall:continue` conducts the whole path, the session records the owner's choice of merges itself through Claude Code's permission prompt (ADR-0010, amended), inferred facts are confirmed as one list, the plan review at lite stops after three rounds with its notes going to the implementers, epics say what they make visible, and the headless runs build a project with a name of its own.

**The first session, by stage** (`scripts/run-stats.mjs` on the project's local transcript; which questions were unnecessary and which messages were interventions is the agent's reading of the owner's list of fixes):

| Stage | Minutes | Of them waiting for the owner | Questions in a form | Unnecessary | Messages typed outside a question | Main tool calls | Sub-agents and their tool calls | Output tokens, main and sub-agents |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| kickoff | 50.3 | 46.9 | 6, and 1 the tool refused | 0 | 1 | 28 | none | 19k |
| discovery | 18.1 | 12.8 | 7 | 4 | 1 | 24 | 3 researchers, 84 | 35k and 48k |
| decide | 20.0 | 10.7 | 4 | 0 | 1 | 31 | 3 researchers, 89 | 44k and 74k |
| spike | 18.2 | 6.5 | 6 | 0 | 0 | 51 | none | 45k |
| plan | 56.4 | 20.4 | 8 | 3 | 0 | 100 | 5 plan reviewers, 142 | 67k and 155k |
| E0, the loop | 98.1 | 56.6 | 1 | 0 | 7 | 43 | 2 implementers (72 and 51 calls), 2 code reviewers (44 and 33) | 26k and 170k |
| all | 261.1 | 153.7 | 32 | 7 | 10 | 277 | 15 agents, 515 calls | 236k and 447k |

Claude Code counted $38.45 at API prices for the whole session, sub-agents included, and 2.0 hours of model time in 4.5 hours of an open session: more than half of the time the session waited for the owner, who also installed two toolchains, ran the spike's measurements and tried the app. The questions in a form waited 97 minutes for the owner in all, most of it in three pauses of 32, 16 and 25 minutes; the owner counted 33 questions, one of which the question tool refused before it was shown. Six commands of the stages were typed by hand, and 15 sub-agents ran. The owner typed 23 messages beside the forms: 12 answers to questions put in plain text, 10 interventions and one unrelated request. The researchers of the lite level stayed at 27 to 31 calls each, inside the budget T2 gave them.

**The seven questions the owner should not have been asked.** Four of discovery's six constraints: budget, hosting and personal data only confirmed what `docs/IDEA.md` already said, one form each, and "time for reviews" the owner called a strange question, since at this level they test as a user and review nothing. The plan's two launch questions, both confirmations. And the question what to do with the reviewer's four notes after its approval, whose answer cost a fifth round. One more never reached the owner: the question tool refused kickoff's project name offered as a single option, and it was asked again in plain text.

**The ten interventions.** At kickoff, "why did you not run it yourself?", about `merge-choice.mjs`. In discovery a change of mind (something lighter than Electron), in decide a stop to take the recommended installer instead of the one just picked. During E0's QA three: the tray icon was missing, a real defect the reviewer had passed, which a second implementer and a second review round closed before the merge; the new installer refused to run over the old version still running, which the plan leaves to E3; and "is it normal that it shows nothing but a tray icon?": the skeleton read as a broken product. And four pastes of one long command line, broken by the terminal's wrapping or run from the wrong folder, before `merge-choice.mjs` recorded the yes the owner had given three hours earlier.

**The plan review.** Five rounds in 56 minutes of the stage: three full ones with 10, 5 and 2 open items, 17 findings in all, one blocking and 16 to fix, then two verification rounds, both approved. The fifth existed only because three of the fourth's notes went into the plan after its approval, which moved the reviewed commit.

**E0.** One implementer (72 calls, 18 minutes), a review round with no finding, the owner's QA, a second implementer for the icon (51 calls) and a second round, then the merge after the owner's yes. The main conversation stood at 277 of its 300 tool calls by then, and twice advised a fresh session.

**What only the run showed:**
- The owner does not know which command comes next, and should not have to. Six commands were typed by hand, each after reading a hand-over; "continue" is all they want to say.
- A script only the owner may run in a terminal is a cost paid at the worst moment, and the terminal broke the command four times. Claude Code's permission prompt is the same proof that the choice is theirs, at the price of one click. A probe showed that a hook's answer `ask` is not answered by an allow rule or by auto mode, so the guard can demand that prompt.
- One form per fact the agent already holds reads as bureaucracy; one list to confirm does not.
- A fresh reviewer always has notes. Asked about them after the approval, the owner improves the plan, and the plan pays a round for it.
- The owner tests as a user. A skeleton that shows a tray icon and nothing else is a pass by its criteria and a broken app to them, unless someone says what each epic makes visible.
- The headless runs had built their test app under the reminder's own name, and its Electron cache sat in the folder where the real reminder will keep its settings.
- The question tool refuses a question with one option: a proposal to confirm is plain text.

**The plugin changes, 0.10.0.** `scripts/check.mjs` grew from 28 to 29 steps, the new one "run stats"; the branch adds 984 lines and removes 171 over 49 files. The conductor reads each stage's own skill file and follows it, so the stage skills stay commands of their own; the model may start only `continue`. The guard answers `ask` for `merge-choice.mjs` alone in its call from the project root, in a session somebody attends, and leaves a note in the git directory that the script needs under Claude Code; it refuses the script in a line with anything else, from another folder, in a session nobody attends or whose mode never prompts, and to every sub-agent. Kickoff resumes when a session ended in it, and the brief and the conductor name it as not finished until a commit holds the skeleton and the planning branch exists, here or on origin (L-18). A skill holds its arguments once, on a line of their own (L-17).

**The headless runs of 0.10.0.** The planning stages ran through the conductor: kickoff from `/pitwall:continue <idea>`, every later stage from the scripted owner's one word, "continue", which the template's `CLAUDE.md` turns into the conductor; the runs check that each stage was led by it and ended with its question whether to move on. The long runs ran in processes of their own with a log, started by the session, and since this epic in hidden windows.

| Run | Plugin | Turns | Minutes | Cost | Result |
| --- | --- | --- | --- | --- | --- |
| hooks | 98382cc | 24 | 6.5 | $3.14 | fail: the implementer asked to run `merge-choice.mjs` read it and declined by itself, so the guard's refusal never came; the step was taken out |
| hooks | 40f1829 | 28 | 4.1 | $2.94 | pass: the main conversation's `merge-choice.mjs` refused in a session nobody attends, nothing recorded |
| kickoff, discovery, decide, spike, plan | 98382cc | 29 | 85.2 | $171.88 | pass; the four stages before the plan ended with the conductor's question |
| kickoff | 1975368 | 9 | 2.8 | $9.14 | pass, at the head after the reviews |
| spike | 1975368 | 4 | 16.6 | $18.31 | pass |
| plan | 1975368 | 5 | 24.0 | $17.35 | pass, the review stopping within the lite level's three rounds |
| e0, e1 | 40f1829 | | | | stopped with no word: the plan's gate came back red from the fake CI, which had opened a console window for each program it ran; a window closed on the owner's screen ends its gate. The harness now says why it stops, and the fake CI opens no window |
| e0, e1 | dc02024 | 6 | 59.3 | $63.42 | e0 pass; e1 stopped by the usage limit of the model the runs used |
| e1, bug | 1975368 | 1 | 22.3 | $6.06 | e1 pass; the bug stage's defect was written for the E1 of 2026-11-10, and this E1 was built anew: the harness now knows both shapes |
| bug, release | 79af48e | 6 | 14.7 | $6.98 | bug pass; release stopped, rightly: the qa agent failed a build the harness had put over E0's own |
| release | 16c1be0 | 2 | 7.6 | $2.44 | stopped, rightly: the qa agent filed a blocking bug, E0's QA scenarios still describing the window E1 removed. The implementer now rewrites a merged epic's scenario its change makes stale, and the code reviewer counts one left stale |
| e1 | 6d9d24c | 1 | 36.0 | $9.36 | pass: E1 built anew; its review kept E0's QA scenarios true; the bug stage did not know this E1's shape of Quit, which the harness now does |
| bug, release | 86c69bd | 7 | 14.8 | $8.66 | pass: the blocking bug filed by the owner and fixed through the loop before E2, then v0.1.0 with E0, E1 and BUG-1, merged after the owner's yes, the tag made by the scripted owner from the handed commands |

The runs above came to about $320 at API prices.

**What the review found.** Three fresh-context rounds, the cap the owner set, with the guard's corpus replayed after each change of the guard (L-13): of about 103,000 different command lines of the local transcripts and T4a's 52 variants, as the main conversation, an implementer and the code reviewer, the guard of the branch changed 10 verdicts at the first replay and 11 at the last, every one the main conversation's `node merge-choice.mjs` alone in a call, refused before and asked at the permission prompt now; against the head before each fix, none changed. Round one: nothing blocking, five to fix: the conductor explained the stage skills' placeholders in a sentence Claude Code had already filled (L-17); the guard's note lay in a temp folder a sandboxed command does not share; a kickoff that stopped after its layout could not resume; a last plan review round that did not approve had no way on; a "continue" that answers a question started the conductor. Round two: nothing blocking, three to fix: kickoff could resume, and nothing sent a session there (L-18); the planning run would have driven a stage the conductor did not lead into the next one; ADR-0010 named the note's old place. Round three, a verification round: round two's findings closed, and one blocking regression of its first fix, a new clone in the middle of the planning sent back to kickoff, fixed after it with a case and reviewed by nobody, since the rounds stop at three.

| Round | Blocking | To fix | Subagent tokens | Tool calls | Minutes |
| --- | --- | --- | --- | --- | --- |
| 1 | 0 | 5 | 405,394 | 112 | 33.9 |
| 2 | 0 | 3 | 328,576 | 98 | 36.6 |
| 3, verification | 1 | 0 | 211,661 | 56 | 16.5 |

**Next:** T6, the adoption of a project that exists already, then T7, the guard's corpus and the open bugs; 1.0 after them (owner, 2026-11-13).

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

Older entries, T0 to T3b: [archive/JOURNAL-T0-T3b.md](archive/JOURNAL-T0-T3b.md).
