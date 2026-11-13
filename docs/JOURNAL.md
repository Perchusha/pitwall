# Journal

One entry per epic, newest first.

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

## T3b - The epic loop (2026-11-10)

`/pitwall:continue` is built: it takes a project with a merged plan through its changes, one at a time, an open bug's fix before the next epic. It asks the owner what is unclear, dispatches an `implementer` or `implementer-deep` by risk class at that class's effort, gates, opens the PR, runs a fresh `code-reviewer` each round under the plan's stopping rule, merges through `merge.mjs` by risk class, and records each merge in the first commit of the next branch. The code reviewer writes `docs/reviews/<change>.md` and sets `ai-review` only while nothing but that file changed after the commit it reviewed (ADR-0011, both of the owner's edits). Low and normal risk merge without the owner only when they chose that with `merge-choice.mjs`, a script no agent may run, whose two narrow allow rules the session-start hook keeps in step with the plugin's path (ADR-0010). The owner answered both one-way questions with edits, and accepted the two-way list with two: conventional merge commits, and any open bug first until T4, which now holds a changelog from `main`'s merge commits only, bugs with a severity and a risk class, `/pitwall:owner-calls` and the record of a plan's last change.

**Numbers.** `scripts/check.mjs` grew from 21 to 24 steps: the code-review stage on about 30 reviews, `review-status --review code`, `merge.mjs --change` by risk class and the owner's choice, `merge-choice.mjs`, the code reviewer's limits and the owner-only script on 34 payloads recorded from 2.1.318 (8 new ones from the code reviewer and an implementer), the code reviewers' own commands from the headless runs, and the fake GitHub against GitHub's recorded answers. The headless runs, at API prices:

| Run | Turns | Minutes | Cost | Result |
| --- | --- | --- | --- | --- |
| probes: allow rules, skill preload | 5 sessions | about 8 | $1.20 | the rule a session-start hook writes works in that session; a Windows path with backslashes matches as written; the exact rule refuses `--owner-approved`; a skill with `disable-model-invocation: true` is not preloaded (L-10) |
| hooks, recording with the code reviewer and an implementer | 20 | 2.9 | $1.00 | pass: each guarded step refused by its rule, the owner's script refused as `owner` |
| hooks, on the run's copy of the plugin | 20 | 2.7 | $1.01 | pass, the same |
| e0, fake GitHub, plugin 8d7f72a | 5 | 56.2 | $59.88 | pass: 4 implementers, 4 review rounds, 8 findings (3 blocking, one a test that only passed on Windows), merged after the owner's yes; no hook refused a call of the 401 the run made |
| e1, fake GitHub, plugin c986a7a | 1 | 38.8 | $10.26 | pass: 2 implementers (72 and 25 calls), 2 review rounds, 2 findings, merged without the owner through the allow rules alone; E0 recorded by E1's first commit |
| e0, real GitHub (a private repository the owner made), plugin a3d4da5 | 2 | 39.2 | $20.37 | pass: CI green on Ubuntu in GitHub Actions, the merge after the owner's yes in the mode `local-hook`, `gate` from github-actions and `ai-review` on the merged head |
| e1, real GitHub, plugin a3d4da5 | 2 | 3.8 | $2.03 | fail: the conductor rightly asked whether E0's manual QA of the window had run, and the scripted owner, with no fact for it, took the recommendation to hold E1 |
| e1, real GitHub, plugin 931f9c5 | 3 | 39.5 | $14.86 | pass: merged without the owner through the allow rules on GitHub, `gate` from github-actions and `ai-review` green on the merged head |

**What only the work showed:**
- Claude Code does not preload a skill marked `disable-model-invocation: true` into an agent through `skills:`, and says nothing: the first implementers had no procedure (L-10).
- An allow rule the session-start hook writes into `.claude/settings.local.json` applies in that same session, so a plugin update needs nothing from the owner; Claude Code sets `CLAUDECODE` in every command it runs, which keeps `merge-choice.mjs` to the owner's own terminal.
- A project laid out by an older pitwall keeps an older `CLAUDE.md`: its definition of done made an implementer and then a reviewer ask for a journal entry inside the change. The epic skill and the reviewer now say the journal is the conductor's.
- The scripted owner improvises facts it was not given ("the window showed one sentence"), as it did in T2.
- GitHub Actions never registered the workflow of the owner's empty private repository after one push of every branch and a PR two seconds later; reopening the PR and turning Actions off and on did not wake it. On a fresh repository, `main` pushed alone, the workflow registered and every run started (L-11, now checked on GitHub).
- The recorded answers caught the fake out three times: rulesets on a private repository on GitHub Free refuse with 403, `gh pr checks` prints five fields, `gh pr merge` prints nothing. Agents also filter `gh` output with `--jq`, which the fake does not do; such answers are not recorded as GitHub's.
- The conductor ran implementers in the background and ended its turn, which in a headless session can end the agent; it now waits for every agent it dispatches. It also asked, before E1, whether E0's manual QA had run, the check the project's riskiest assumption depends on: a question the scripted owner had no answer for, so the harness now answers any unscripted question with the way that goes on and prints it as an UNSCRIPTED QUESTION.
- A restart of the session ended two headless runs it had started in the background. The owner now runs long runs in a terminal of their own with `--log`, on a copy of the plugin made at the start of the run, whose commit the first line names.

**What the review found.** Four fresh-context rounds. Round one (changes): one blocking finding, a test named in a code span read as no cover at all, and four to fix: a merged bug fix picked again, the last change of a plan never recorded (now T4c-AC3), the owner's changed `.claude/pitwall.json` that a stash could undo, and no handover for a project that says no. Round two read the transcripts of the E0 run and approved with six to fix, all fixed: the journal's numbers lost between sessions (now a PR comment), a weak e1 check, PARTIAL for steps only the owner can take, a refused failure status, the run's own commands as hook cases (L-9), and the spelling of the allow rules. Round three, a verification round, found all six fixed and nothing blocking. Round four, a verification round of what came after it, found one blocking finding before anything was pushed: the private repository of the GitHub run was named in two commit messages, and its numeric id was in the recordings, outright and inside every `node_id`, which encodes it. The scrub now clears every node id, the check fails on one, and the commits that carried them were folded into one before the first push.

| Round | Blocking | Subagent tokens | Tool calls | Minutes |
| --- | --- | --- | --- | --- |
| 1 | 1 | 250,372 | 56 | 13.0 |
| 2 | none (6 to fix) | 269,424 | 57 | 13.2 |
| 3, verification | none | 145,309 | 37 | 6.1 |
| 4, verification | 1 (the private repository identifiable in the recordings and two commit messages) | 118,235 | 31 | 4.8 |

**Next:** T4, release and QA.

## T3a - Hooks (2026-11-09)

T3 was split in two at the owner's call: T3a, the hooks, and T3b, the epic loop, both high risk, both merged by the owner. ADR-0010 records the owner's other one-way decision: merges without the owner are each project's owner's choice, with the allow rules written only once this epic's review guard is installed, and pitwall itself says no for now. The plugin now has hooks (`hooks/hooks.json`, `scripts/hook.mjs` with `hook-events.mjs` and `hook-guard.mjs`) that act in pitwall projects only: a brief at session start, with a self-test of the guards; guards on secrets, files git ignores, pushes that change `main`, writes to merge protection, commit statuses outside `review-status.mjs`, the plan reviewer's files and commands, and the guards' own switch; call budgets per agent; and the gate after edits and before stopping. The owner accepted the two-way list with five edits: the guards protect their own switch, `--admin` and protection writes are refused, a broken guard says how to turn pitwall off and the self-test warns at once, an unattended main conversation stops at its budget, and the plan reviewer's command takes no backtick or line break.

**Numbers.** `scripts/check.mjs` grew from 20 to 21 steps; the new one runs about 330 cases through `hook.mjs` on 26 payloads recorded from Claude Code 2.1.318 in a real headless session, plus the `hooks.json` commands through bash. The headless runs, at API prices:

| Run | Turns | Minutes | Cost | Result |
| --- | --- | --- | --- | --- |
| hooks, first recording | 18 | 2.4 | $0.76 | the template's settings refused the `.env` read before the guard could, so the main conversation's Read payload was missing |
| hooks, recordings 2 to 4 | 18 each | 2.6, 2.8, 2.5 | $0.63, $0.83, $0.81 | pass: each guarded step refused by its rule, each allowed one through |
| hooks, on the code after the review | 18 each | 2.3, 2.1 | $0.82, $0.81 | pass, the same |
| kickoff, under the hooks | 8 | 1.9 | $2.66 | pass |
| plan, under the hooks | 12 | 40.2 | $62.15 | pass, four review rounds, approved; the plan reviewer's `cd` before its command was refused once a round (fixed after) |
| kickoff, at the owner's request on 7c13d70 | 7 | 1.7 | $2.28 | pass, no refusal in the 11 calls the guard saw |
| plan, at the owner's request on 7c13d70 | 9 | 38.6 | $42.79 | pass, four review rounds, approved; no refusal in 183 guarded calls (67 in the main conversation, 116 by the four plan reviewers) |

**What only the work showed:**
- Claude Code tells a hook whether anyone attends the session: `CLAUDE_CODE_SESSION_ATTENDED` is `0` under `claude -p` and `1` in an editor session (2.1.318). Undocumented, so the payload recording pins it.
- A sub-agent hands its report back through a `SubagentHandback` tool call, and Claude Code ends it there: a SubagentStop block afterwards does not bring it back, a refused handback does. The budget never refuses the handback, and an implementer's check before stopping runs at it.
- The template's settings deny reading `.env` before any hook runs, so the headless run tests the guard's own refusal on a certificate.
- The auto mode classifier refused a probe session started with `bypassPermissions` ("Create Unsafe Agents"); every probe after ran in auto mode with a narrow allow list.
- Exec-form hooks need `node` on the PATH even outside a pitwall project, and with `onFailure: "block"` a machine without node would have refused every call in every project; every hook now starts through bash, which checks for the project and for node first.

**What the review found.** Five fresh-context rounds ran on the branch, then a short check of the last fixes. Round one found the skeleton's push exception letting a planning branch onto `main`, a Git Bash path that hid the branch, stop retries reset by every edit, no planning stage in the brief, and node's absence blocking every project. After that, most blocking findings were false refusals of ordinary work: a commit message naming `.env`, an edit by a non-implementer sub-agent left unchecked, search patterns and jq filters read as secret files, Claude Code's `"$(cat <<'EOF' ...)"` bodies cut at their first `)`, PowerShell's `if ($?) { }` blocks and here-strings, a recursive grep with `--include`. The round-four fix for blocks split words at every brace and so let gh's `repos/{owner}/{repo}/...` writes through; round five caught it (L-9). The ways past the guards that only a deliberate attempt writes are one accepted risk, R-2.

| Round | Blocking | Subagent tokens | Tool calls | Minutes |
| --- | --- | --- | --- | --- |
| 1 | 5 | 247,085 | 47 | 15.7 |
| 2 | 2 | 226,590 | 46 | 15.2 |
| 3 | 2 | 227,225 | 46 | 13.7 |
| 4, verification | 3 | 193,875 | 42 | 10.9 |
| 5, verification | 1 (a regression of round 4) | 157,281 | 28 | 8.9 |
| check of round 5's fixes | 3 (PowerShell forms the fix missed) | 121,766 | 24 | 6.7 |
| recheck | none; three older PowerShell gaps listed, closed after | 110,142 | 21 | 5.4 |
| short round on the owner's edits, false refusals only | 1 (a kickoff idea that names a settings file), 5 smaller | 170,761 | 34 | 9.2 |

The eight come to about 1.45 million tokens, 288 tool calls and 86 minutes. Each fix has a case in `scripts/check.mjs`; the last recheck compared the guard before and after its commit on 261 commands and 600,000 random PowerShell strings and found no command it lost.

**After the review, the owner added:** any command that names a switch file or the plugin's folder is refused unless it only reads or stages it or is a pitwall script, which closes `node -e`, `python -c` and other one-off writes; `protect.mjs` takes no flag that sets the mode (its `--repo` now has to name a remote of the project), and `layout.mjs` refuses a folder with `.claude/pitwall.json`, each shown by cases in `scripts/check.mjs`; the turn-off command is the owner's to run in a terminal; R-2 in the owner's words.

**First meeting with the real GitHub API.** On PR #4, from a scratch copy of the plugin whose planning branch was this epic's branch: `merge.mjs --dry-run` read the account, the repository, the PR and its statuses, and refused because `ai-review` was not set; `review-status.mjs --dry-run` refused success (pitwall's own docs are no project plan) and would have posted failure on the PR's head. The reads after `ai-review`, run read-only through the same functions, found `gate` from GitHub Actions (app 15368) in progress, no rules on `main`, and the protection kickoff asks for: `gate` from GitHub Actions and `ai-review` from any source, admins included, linear history off. Every answer had the shape the fake `gh` gives.

**Next:** T3b, the epic loop. It adds the code reviewer's row to `hooks.agents`, the conductor that reads the brief, and the owner's choice of ADR-0010, whose allow rules this epic's review guard now makes possible.

## T2 - Stages 3 to 5 (2026-11-09)

`/pitwall:spike` and `/pitwall:plan` are built, with the `plan-reviewer` agent, and the plan of a new project now reaches `main` the way every later PR will: reviewed by a fresh agent, with `ai-review` set by that agent, merged with the owner's yes. The plugin gained two scripts, `review-status.mjs` (ADR-0007) and `merge.mjs` (ADR-0008), and `docs-check.mjs` three stages: `spike`, which reads git to show that the criterion came before the prototype (ADR-0009), `plan` and `plan-review`. `/pitwall:decide <area>` revisits one area after a failed spike. The T1 follow-ups the owner added are in: the GitHub plan read from the protection probe only, research budgets per level, handoffs with each command on its own line under a label, and the refused-probe case in the fake `gh`. The owner answered two one-way questions, added to the second one, and accepted the two-way list with five edits.

**Numbers.** `scripts/check.mjs` grew from 17 to 20 steps: the plan and spike checks run about 150 cases on projects built with real git history, `review-status.mjs` 26 and `merge.mjs` 36 scenarios against the shared fake `gh` in `scripts/fake-gh.mjs`, and the protection step 43 (from 38). The headless run of the lite system (`scripts/e2e.mjs`, a scripted owner, `gh` signed out) started from an empty folder and saved each stage it passed:

| Stage | Turns | Minutes | Cost at API prices | Output |
| --- | --- | --- | --- | --- |
| kickoff | 8 | 2.4 | not recorded | skeleton on `main`, protection `pending` |
| discovery | 12 | 10.1 | not recorded | discovery with the research budget of the lite level |
| decide | 6 | 17.9 | not recorded | 4 one-way ADRs from the owner, `docs/STACK.md` |
| spike | 5 | 14.6 | not recorded | `A-1` (lock and sleep detection) confirmed, measured by the owner, prototype on `spike/lock-sleep-detection` |
| plan, before the review fixes | 13 | about 64 | not recorded | stopped at review round 7 with 13 findings: the loop had no end |
| plan, first try on the fixed code | 4 | 7.8 | $6.79 | the scripted owner asked for a second spike, and the skill rightly stopped before the review |
| plan | 9 | 34.7 | $39.99 | E0 to E3, four review rounds (the last a verification round), 11 findings closed, approved; the PR, the status and the merge handed over |

The first run was stopped in its plan stage, before it printed its costs, so the costs of stages 0 to 3 are lost; `e2e.mjs` now writes each stage's numbers when it saves the stage. Discovery and decide took 10.1 and 17.9 minutes against 15.9 and 27.2 in T1, with the research budget of the lite level. The passing plan run used the code before the fifth review's fixes; its output passes the final checks, as do the saved outputs of stages 0 to 3, so neither was run again.

**What only the work showed:**
- The PreToolUse payload says which agent calls a tool: `agent_type` with the plugin's prefix (`pitwall:plan-reviewer`) and an `agent_id`, both missing in the main conversation (checked on Claude Code 2.1.318). The T3 hook can run `review-status.mjs` for the two reviewers only (ADR-0007).
- `git log --follow` treats a copied spike file as a copy and walks into the other spike's history; the spike check follows renames itself and leaves copies alone.
- A fresh reviewer each round always finds something new: the first plan stage reached round 7 with 13 findings. Rounds after `review.ownerDecidesAtReject` now only verify, and smaller notes go to the owner without blocking (L-8).
- The model writes what reads naturally, such as "closed by E0-AC8: ...": the checks accept that, and the reviewer's prompt says the ID comes first.
- A scripted owner improvises outside its facts: it asked for a second spike while accepting the plan. Its facts now say what it accepts.

**What the review found.** Seven fresh-context reviews ran on the branch, each in its own clone and scratch repositories; the later ones rendered their cases with GitHub's own Markdown API. Almost every blocking finding was of one kind: a way to write `docs/PLAN-REVIEW.md`, `docs/RISKS.md`, an epic or a spike so that the line-based check missed an open finding, an unaccepted risk or a hidden outcome while GitHub showed it, so `review-status.mjs` would have set success. Round one found an unknown process level that emptied the checklists, "open" worded loosely, unaccepted risks counted as coverage and a renamed spike that hid a changed criterion; round two a second table in a section; round three a repeated or extra heading; round four block quotes, comments, setext headings, rows without a leading pipe, repeated rows, and the ADR a spike disproved passing as its follow-up; round five strikethrough, character references, inline HTML, lazy table rows and fences in list items; round six a lone carriage return, invisible characters and HTML strike tags. Fixing them one by one did not close the class, so the files whose rows decide a stage keep to a grammar of allowed lines, and the cells the checks judge must be plain text (L-7). Each fix has a case in `scripts/check.mjs` that fails without it, and the checks still pass on the real output of the headless run. Round seven ran under the owner's stopping rule: only a case an honest author could write by accident blocks, and the ways past the check that only a deliberate attempt writes are one accepted risk, R-1, with the threat model in ADR-0007 and the rule in `review.findings` and `review.maxRounds` for every later review. Its one realistic blocking finding was a false failure: a spike criterion the cell rules refuse could not be fixed once committed, so the spike skill now runs `--stage spike-criterion` before that commit. The rounds also found other false failures (OS files under `docs/`, "closed by" cells, a failed spike in an area with no ADR, "<" or one "~" in ordinary text, a rule or a table where nothing is read from it), all fixed.

**Review rounds and their cost (data for T5).** T1 ran seven review rounds; the first two found blocking findings, and their cost was not recorded. T2 ran seven, plus a verification round of the last fixes; the agent tool reports total tokens per agent, not a price, so the cost is given in tokens:

| Round | Blocking | Subagent tokens | Tool calls | Minutes |
| --- | --- | --- | --- | --- |
| 1 | 4 | 231,083 | 46 | 13.4 |
| 2 | 1 | 273,934 | 57 | 20.6 |
| 3 | 1 | 251,142 | 52 | 17.3 |
| 4 | 2 | 265,572 | 97 | 22.9 |
| 5 | 2 | 236,156 | 57 | 30.1 |
| 6 | 7 | 208,210 | 37 | 19.0 |
| 7 | 1 realistic, 3 exotic | 204,493 | 21 | 5.8 |
| 8, verification | none | 149,040 | 32 | 14.1 |
| 9, check of the last fixes | 1 realistic | 109,805 | 14 | 8.9 |
| 10, recheck | none | 134,894 | 7 | 3.4 |

The ten rounds come to about 2.06 million tokens, 420 tool calls and 155 minutes; round 7 was cut off when its session ended and resumed, and only its resumed part is counted. The verification round found no realistic blocking finding, which ends the review under the owner's rule; its five smaller findings (a superseded ADR next to the new one in a place, two tildes that strike nothing, where a cover counts, a stage list) were fixed after it. A short check of those fixes found that one of them read tildes for "about" ("~2 s ... (~1 s)") as a strikethrough and so lost a cover, a realistic false failure; the strikethrough rule now follows the GFM spec's flanking rules, as the checker derived them and tried them on its cases. A recheck of that fix found nothing blocking. The plan reviewer inside the headless run is separate: four rounds within the plan stage's $39.99.

**Next:** T3, the epic loop. It takes the hook rule of ADR-0007, the Approval line of ADR-0008 and the verification rounds of L-8 for the code-reviewer.

## T1 - Stages 0 to 2 (2026-11-06)

`/pitwall:kickoff`, `/pitwall:discovery` and `/pitwall:decide` are built, with the `researcher` agent, and the plugin gained its first scripts, in Node (ADR-0004): `layout.mjs` lays a new project out and never overwrites, `docs-check.mjs` reports missing sections, IDs that point nowhere and oversized files, plus the Check of each stage, and `protect.mjs` protects `main` with admins included (ADR-0005) or hands the owner ready commands. `.claude/pitwall.json` and the template's headings joined the contract (ADR-0006). The owner answered three one-way questions and accepted the two-way list with edits; one of them became a new epic, T6, for adopting an existing project.

**Numbers.** `scripts/check.mjs` grew from 12 to 17 steps; the protection step runs 38 scenarios against a fake `gh`, the docs check 39 broken or filled copies of a laid-out project. The headless run of the lite system from SPEC 10 (`scripts/e2e.mjs`, a scripted owner, `gh` signed out) passed all three stages before the review, and the changed stages again after it:

| Stage | Turns | Minutes | Cost at API prices | Output |
| --- | --- | --- | --- | --- |
| kickoff | 8 | 2.3 | $2.47 | skeleton on `main`, `plan/initial`, protection `pending` |
| discovery | 13 | 15.9 | $39.97 | 7 scenarios, analogues with opened links, 6 confirmed constraints, assumptions by risk |
| decide | 10 | 27.2 | $77.59 | 7 one-way ADRs, `docs/STACK.md` with registry links and dates |
| kickoff, after the fixes | 8 | 2.3 | $2.39 | the same from a folder with nothing in it: the preflight set git up, and `protect.mjs` ran against a signed-out fake `gh` |
| decide, after the fixes | 6 | 23.6 | $44.02 | 3 one-way ADRs (the lite rule), the rest in the accepted two-way list |

Almost all of the cost is the researchers, which run in parallel: 42 to 46 calls each in discovery, 78 to 103 each in decide, against a stop at 120. That is too much for a lite project and is the first thing to tune in T5. The second decide run started from the first run's discovery commit (`e2e.mjs --from decide --seed`); discovery itself was not run again, as its changes were small and its earlier output passes the stricter checks.

**What only the work showed:**
- Neither `claude plugin ...` nor `-p` acts on the marketplaces a project declares, so the teammate check (T1-AC6) could not be scripted. The owner ran it by hand on 2026-11-06 in a profile without the pitwall marketplace: after trusting the folder, Claude Code added the marketplace from GitHub and the `/pitwall:*` commands were there with no separate install, because the plugin's source is a relative path inside the marketplace.
- A headless run cannot answer a prompt, and the model wraps commands in `cd ... && ...; echo`, so an allow list alone stalled kickoff at the layout step. The runs use `--permission-mode auto` with an allow list, and the skills now ask for one command per call.
- Piping JSON into `gh api --input -` fails in Windows PowerShell, which adds a byte order mark (L-6). Typed `-F` fields work in both shells.
- The branch endpoint shows the protection summary to any reader, so a non-admin can confirm protection that an admin set. npm's `/latest` has no release date, so the registries in the config name the field that holds the date.

**What the review found.** A fresh-context reviewer probed the scripts in scratch folders, the protection script against a fake `gh` and, read-only, against the real repository. Two blocking findings: the decide check accepted a one-way area whose ADR was two-way or decided by the agent, and the "no repository" handoff held a `<name>` placeholder that neither shell runs as written, with a `--push` that could make `plan/initial` the default branch. Eleven more were fixed in the same PR: kickoff now checks the folder before the first question and always runs `protect.mjs`; a failed precondition no longer erases a recorded mode; the later stages commit `.claude/pitwall.json`; facts repeated in skills, templates and READMEs now point at the config or the template; the docs check also catches option rows without sources, duplicate analogues and malformed settings; and E0-AC3 in the template matches ADR-0005.

A second fresh-context review verified those fixes and found two more blocking gaps: Claude Code writes `.claude/settings.local.json` for a standing approval, so the new preflight refused a folder that was still empty; and a one-way area could cite an ADR with no file, written in a code span. Now the preflight is `layout.mjs --check` and ignores that file and OS litter, a cited ADR must exist, every table keeps the template's columns, and at the lite level a one-way area may end in the two-way list the owner accepts (`processLevels.lite.decisions`), as SPEC 3 always said. A third review found no blocking findings and five to fix, all fixed in the same PR: `desktop.ini` passed the preflight but turned the gate red, the lite rule had no lower bound (now `decisions.askOwner.min` owner decisions), a recorded `branch-protection` survived a run that read the branch unprotected, the kickoff run predated the new preflight (run again, the row above), and two criteria no longer said what the code does. Reviews went on until one found nothing blocking; the last one's verdict is the `ai-review` status on the head of this PR. The last decide run predates the final changes to the decide check and its config, which only made the check stricter; its output passes the current check.

**Next:** T2, stages 3 to 5. pitwall's own `main` still has admins excluded from its protection (ADR-0005): turning that on is the owner's step.

## T0 - Skeleton (2026-11-05)

The repository is a marketplace with one plugin. The plugin has 12 skills and 6 agents, all stubs that say which epic builds them, plus `config/defaults.json` and the project template. `claude plugin validate --strict` passes on both manifests, and `scripts/check.mjs` adds the repository's own checks. The design that came out of the planning discussion is in `docs/SPEC.md`, with three ADRs for the decisions taken along the way.

**What only the work showed:**
- The Claude Code CLI ships a strict validator, `claude plugin validate --strict`, and a release helper, `claude plugin tag`. Both replace hand-written checks.
- Files in the template that tools load by name (`CLAUDE.md`, `.claude/settings.json`, `.gitignore`) would act inside this repository, so they carry a `.tmpl` suffix.
- A gate stub that always passes would make a new project look green with no checks. The stub passes only while the repository holds docs, and fails once code appears.

**What the review found.** A fresh-context reviewer ran every acceptance criterion and probed the template in scratch repositories. One blocking finding: the gate stub only saw tracked files and passed outside git, so code that was not yet committed slipped through. It now lists untracked files, works from any folder and fails closed. Six more were fixed in the same PR: line endings on Windows (`.gitattributes` in the repo and the template), a guard for unbuilt skills that depended on wording, a premature "T0 is done" line, an unpinned validator in CI, a high-risk merge rule that read differently in two places, and the epic file name. The checks gained guards for Cyrillic text, model IDs in skills and agents, tool-loaded file names in the template and the gate's mode in the git index. L-2 was sharpened and L-3, L-4 added.

A second fresh-context review confirmed those fixes and found what they missed: the unbuilt-skill guard still matched wording, the gate passed when git could not list files, and nothing ever ran the gate, so a regression would have stayed green. Now every skill must carry a `> Status:` line and only `built` may trigger by itself, the gate fails when git fails, and the check runs the gate in a scratch project on every build.

**Merge.** PR #1 merged with `gate` green in GitHub Actions. The cloud session that built T0 could not publish the `ai-review` status, protect `main` or push the `pitwall--v0.1.0` tag: its GitHub proxy refuses those writes (L-5). They run from the owner's local session.

**Next:** T1, stages 0 to 2.
