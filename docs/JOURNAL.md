# Journal

One entry per epic, newest first.

## 1.0.1 - BUG-14, a project-scope install (2026-11-14)

A patch, first after 1.0 (owner, 2026-11-14): kickoff counts as empty a folder where the only thing besides `.git` is a `.claude/settings.json` with pitwall enabled. Claude Code 2.1.323, probed in a scratch home, writes `{"enabledPlugins": {"pitwall@pitwall": true}}` for a project-scope install, and the marketplace's GitHub source beside it when the marketplace was added for the project too. `layout.mjs` counts no such file that holds nothing the template's own does not, and writes the template's in its place; settings that hold more are never overwritten, and when they are all the folder holds, the refusal says what to do. The rule is a subset of the template's file rather than "pitwall enabled", so that the layout never loses a setting and needs no rule for conflicts. The check holds both forms, one with a BOM and CRLF, and six refusals; its cases fail on 1.0.0's `layout.mjs`.

**What the review found.** Round one: nothing blocking, one to fix, the plugin README's "never overwrites a file", and notes, taken: the way on when the moved file was what loaded pitwall, the conductor's routing and kickoff's rule against overwriting, an invisible BOM in a regular expression, and a case with a BOM; T1's criterion and BUG-14's Actual cell stay as they are, records of their time. The loop of two refusals for a clone with any other file and no commit is a bug of its own, filed for the next branch. Round two approved, with notes, taken: the conductor's route for a bare clone, the wording of the note and the refusal for unusual settings, a case of the install's settings beside a file of the owner's.

| Round | Blocking | To fix | Subagent tokens | Tool calls | Minutes |
| --- | --- | --- | --- | --- | --- |
| 1 | 0 | 1 | 152,812 | 33 | 7.0 |
| 2 | 0 | 0 | 134,716 | 29 | 5.3 |

**Next:** T5b, Last Ones Down adopted at the full level, once the owner has renamed its `master` to `main`; then T8, with BUG-9 and BUG-11 to BUG-13 after 1.0.

## 1.0 - The first stable version (2026-11-14)

1.0 is a release, not an epic: no new features since 0.12.0 (owner, 2026-11-14). Twelve epics, T0 to T7, merged in twelve PRs between 2026-11-05 and 2026-11-14, each tagged as a 0.x version. The release holds:
- the version 1.0.0 in the plugin and in the marketplace;
- the README's quick start (an empty repository on GitHub, cloned; the plugin; `/pitwall:continue` with the idea; then "continue"), the requirements, with the Claude Code version CI pins and the bash of Git for Windows, the process levels, what the owner does, and the limits, linked to the risks; the plugin README's status;
- `plugins/pitwall/CHANGELOG.md`: a section per version from the merge commits of T0 to T7, and the section of 1.0.0, which is also `docs/release-notes-1.0.0.md`, the notes of the GitHub release the owner publishes after the tag;
- the records of T7's merge: BUG-1 to BUG-8 and BUG-10 fixed by #12.

**Found on the way.** What 1.0's work finds goes to the bugs or to the list after 1.0 in `docs/EPICS.md`, not into its PR (owner, 2026-11-14). The standard and full levels of the SPEC name QA after every merge and a deployment to production with its smoke check, and no epic holds them: T8 brings staging and QA in a browser only. The README promised an estimate before every paid run, which nothing makes. Both are on the list, and the README no longer promises them. A project-scope install of the plugin writes `.claude/settings.json` into the clone, which kickoff then refuses as not empty, and the adoption refuses as having no commit: filed as a bug, unconfirmed, which waits for the first commit of the next branch; the README says to install for the user. Each hook starts in bash and the guard's failure blocks the call, so on Windows without Git Bash a user-scope install might refuse every tool call in every project: a session here with Git off the PATH and Claude Code pointed at a bash that does not exist still found Git Bash where Git for Windows installs it, so the case could not be made on this machine. The quick start installs Git for Windows first, and the probe is on the list after 1.0.

**What the review found.** A fresh-context review of the documents against the code. Round one: one blocking, the project-scope install above, and seven to fix: `gh` named as needed for merge protection only, when every PR, status and merge runs through it; a repository with commits said to be refused, when the conductor adopts it; limits a new user would hit left out (the default branch must be `main`, the adoption has run only headless, R-4's merge held by the permission prompt alone); the standard level still promising QA after every merge; a yes before a bug's fix that does not exist; duties of the owner's left out (a spike's criterion, the findings after the first rounds, the manual QA of a change, the commands handed over); the estimate of principle 7. Round two approved, with three to fix and notes, all taken: kickoff's last headless run was at T5a, not at T7 that changed it; the open bugs said none blocking while the new one waits filed as blocking until the owner confirms it; no way back for an owner who installed for the project; auto mode beside the permission prompt in R-4's sentence; a session bounded by its count of changes, not its calls; and what a new user meets on the first day: the tools of the stack, the time a lite run took, a private repository on GitHub Free, macOS untried. Round three, a check of the last commit, approved with no findings.

| Round | Blocking | To fix | Subagent tokens | Tool calls | Minutes |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 | 7 | 217,533 | 70 | 8.6 |
| 2 | 0 | 3, and notes | 236,807 | 63 | 7.9 |
| 3 | 0 | 0 | 157,941 | 52 | 6.1 |

**Next:** T5b, Last Ones Down adopted at the full level, once the owner has renamed its `master` to `main`; then T8, with BUG-9 and BUG-11 to BUG-13 after 1.0.

## T7 - The guard's corpus (2026-11-14)

`scripts/guard-corpus.mjs` replays every command line of the local transcripts through the hooks' guard at a commit and in the working tree, as the main conversation and as the agents it is told, and prints each verdict that changed by its caller, its rule and the form of the command: the programs the guard's own parser reads, each named only when it is a known tool, and for git the subcommand. No word of a line is printed or kept (owner, 2026-11-10). Each line is judged with the plugin folders it names as the plugin's, as its session had them, in a scratch pitwall project with uncommitted work, and each git question is asked once, so the whole corpus takes about a minute and a half. It is a tool of pitwall's own development, not a step of `scripts/check.mjs`, since CI has no transcripts (L-13). T4a's 52 variants of one rollback are cases of the check with their verdicts at T4a's merge, 48 refused and 4 passing, none a copy of a transcript line. With the corpus behind each change, the guard's bugs were fixed: `git rm -f` over changed files (BUG-1); `git worktree remove --force` over a work tree that holds work, named plainly, in a loop, through xargs or by a PowerShell expression (BUG-2); `git reset --merge` over staged changes (BUG-3); a PowerShell assignment of one word read as a value (BUG-4); an inline `node -e` that only reads the plugin's data (BUG-6); `core.hooksPath` set for the account or the machine (BUG-8); and a new rule, `tag`: a release's tag, its push and its GitHub release are the owner's (BUG-10, R-6). Beside them, `bugs.mjs` and the docs check refuse a row of `docs/BUGS.md` with a cell too many (BUG-5), and kickoff asks before pitwall's hook replaces hooks of the owner's own (BUG-7). BUG-9, Git LFS, keeps its date after 1.0.

**Numbers.** `scripts/check.mjs` keeps its 30 steps: the variants and the cases of each bug, each failing before its fix, went into the steps of the hooks, the bugs and the skills. The epic's three commits add 595 lines and remove 43 over 20 files. The headless run of the hooks passes at the branch's head (`node scripts/e2e.mjs --hooks`, 24 turns, 3.5 minutes, $1.09): every rule it drives refuses in a real session as before; the new rule `tag` has cases in the check and no step of that run.

**The corpus against `main`, at T6's merge.** 115,211 command lines in 4,788 transcripts, 107,788 different ones, as the main conversation, an implementer and the code reviewer, in 91 seconds; 798 of them name a folder of the plugin. 52 verdicts changed, in 24 forms, each the same for the main conversation and an implementer:
- 10 allow to `deny:tag`: five lines that make a version's tag, push one or publish a release (BUG-10): the tag is the owner's now.
- 42 `deny:switch` to allow: 21 lines whose inline `node -e` reads the plugin's data files and writes nothing (BUG-6). One is new since the replays of the reviews: narrowed by pattern, its inline script reads JSON and writes, runs or loads nothing.

**What only the work showed:**
- The corpus is only as honest as the plugin folder it is judged with: judged with one checkout as the plugin's, the switch rule's change on the headless runs' copies and the installed cache could not show at all. Round one found it; each line now brings its own.
- The form of a line is itself a leak: a word of a heredoc or a string, the owner's words, would have reached what a PR may quote. The form now names only known tools, and "other".
- A replay is not fully repeatable: the rule on work trees judges the work they hold when the line runs, and the corpus asks the folders a line names as they are now. Two lines that remove a work tree changed to refused at a replay during the reviews and do not against `main`.
- A guard's parser has more ways in than its rules: the reviews found three more gaps of the same family as BUG-2 (BUG-11, a PowerShell expression in parentheses as `git checkout`'s paths; BUG-12, an xargs option's value written apart; BUG-13, a work tree removed by its name). The corpus held none of them; they wait until after 1.0, with BUG-9 (owner, 2026-11-14).

**What the review found.** Three fresh-context rounds, the cap the owner set, with the corpus replayed after each change of the guard (L-13). Round one: one blocking, the corpus judging every line with one checkout as the plugin's folder, and four to fix: the form of a line could print a word of a heredoc or a string; `git worktree remove --force` through xargs or with a path under `~` passed; its refusal gave no way on; a dry run of a push was refused as if it sent a tag. Round two approved, with three to fix: the refusal for a work tree only the run knows advised keeping work in work trees the line may never touch; a PowerShell expression in parentheses as the target passed unjudged; the corpus missed the installed plugin's folder, which carries its version. Round three approved; the two gaps it found outside T7's fixes are BUG-12 and BUG-13.

| Round | Blocking | To fix | Subagent tokens | Tool calls | Minutes |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 | 4 | 255,260 | 88 | 23.1 |
| 2 | 0 | 3 | 252,297 | 104 | 26.3 |
| 3 | 0 | 0, two bugs filed | 158,575 | 74 | 14.6 |

**Next:** 1.0, after T5a, T6 and T7 (owner, 2026-11-13); then T5b, Last Ones Down adopted, and T8.

## T6 - Adopt an existing project (2026-11-14)

`/pitwall:adopt`, which `/pitwall:continue` runs in a folder that holds a project and no `.claude/pitwall.json`, brings pitwall into a project that exists already. `adopt.mjs --dry-run` writes nothing. It lists what the adoption would add and keep, the items of the project's own plan, its documents and the checks its manifests and CI already run, and what blocks the adoption: a default branch other than `main`, with the steps of the rename; a path pitwall must commit that the project's ignore rules ignore; an ID that points nowhere in a document pitwall keeps; a `CLAUDE.md` that pitwall's sections would push over its size limit; an adoption already on the planning branch. After the owner's yes to the list, `--write` lays out only the paths the project lacks, as one commit on the planning branch with `main` unmoved; a file the project has changes only by an addition the owner said yes to, every line of theirs kept word for word. `--gate` writes `scripts/gate` from the checks the owner confirmed. `.claude/pitwall.json` records the stage the project starts from (`startStage`: discovery, decide or plan), its plan file, which gets one line pointing to `docs/EPICS.md`, and the project's own files under `docs/` (`ownDocs`), which the docs check leaves alone while their IDs still resolve. The docs check skips the stages before the start, and the brief, the conductor, kickoff and the plan skill know an adopted project.

**Numbers.** `scripts/check.mjs` grew from 29 to 30 steps, the new one "adopt": the dry run, the writes and the gate on scratch projects with and without CI, with an adr-tools ADR, with a file of their own in `docs/epics/`, with ignored paths, with each blocker and with a default branch other than `main` here and on a fake GitHub, and the docs check of an adopted project at each start. The epic's three commits add 1,459 lines and remove 47 over 21 files. The guard did not change, so no replay of its corpus was due (L-13).

**The headless runs.** The test project, `pitwall-e2e-tally`, is a small command line counter with three commits on `main`: a README, a `ROADMAP.md` with two items done and two open, a `CLAUDE.md` whose workflow rule is "commit straight to main", a CI workflow, tests, an architecture note, a `docs/SPEC.md` of its own and an ADR written by adr-tools. The `adopt` stage checks that nothing is written before the scripted owner's yes, that every line of theirs is kept, that the adoption is one commit with `main` unmoved, that the gate goes red on a broken test, and that the documents of the stages before the plan are filled from the project's files. `adopt-plan` checks that the conductor led the plan stage, that the roadmap's open items became epics after E0, and that the review kept within the lite level's rounds.

| Run | Plugin | Turns | Minutes | Cost | Result |
| --- | --- | --- | --- | --- | --- |
| adopt | 79c3159 | 8 | 8.5 | $19.62 | pass then; the stage ended on the question of merges without the owner, not on whether to move on, which now fails a stage |
| adopt | 7759435 | 12 | | | stopped by the session: the adoption struck through the owner's workflow rule to mark it replaced, a line of theirs changed, and the run passed the owner's NEXT on before the stage's check passed, which started the plan stage inside the adoption. The skill now keeps every line of the owner's word for word and puts one line of its own above a replaced rule; a run fails a stage that asks to move on too early |
| adopt, adopt-plan | 396f142 | 10, 7 | 10.6, 24.4 | $24.43, $43.08 | pass; the plan approved in round 2 |
| adopt, adopt-plan | 363c411 | 10, 5 | 7.2, 15.0 | $11.70, $11.99 | pass, after review round 1's fixes; the plan approved in round 3, the last at lite |
| adopt, adopt-plan | 927663b | 8, 7 | 7.4, 20.8 | $8.66, $22.90 | pass, at the head after the reviews; the plan approved in round 3 |

The runs came to about $142 at API prices, the stopped one not counted.

**What only the work showed:**
- An addition can still change a line of the owner's: a rule struck through to mark it replaced reads well and is no longer theirs. The skill says so in plain words now, and the run compares the owner's lines.
- A project keeps files of its own in the folders pitwall reads: adr-tools writes `docs/adr/0001-record-architecture-decisions.md`, which pitwall's numbering, template and ID scan took for pitwall's. Everything the project brought under `docs/` is recorded as its own and left alone.
- A gate that runs the project's real checks is red on a bare CI runner: the workflow of the check named `gate` needs the project's toolchain and dependencies, which the adoption now adds and the dry run names.
- Four of the five runs asked the scripted owner something it had no line for, each a real decision of the adoption (the lines `.gitignore` gains, a licence, backups): the dry run's list does not yet hold every question. T5b, a real adoption, will show what that costs the owner.
- Last Ones Down's default branch is `master`. The dry run now finds a default branch other than `main`, here or on GitHub, and lists the steps of the rename; the owner renames it before T5b, and a branch of each project's own waits until after 1.0 (owner, 2026-11-14).

**What the review found.** Three fresh-context rounds, the cap the owner set. Round one: three blocking findings and four to fix. Blocking: the project's own files in `docs/adr/`, `docs/epics/`, `docs/spikes/` and `docs/reviews/` were held to pitwall's template at every stage, the skipped ones included; the gate's workflow ran the project's checks on a bare runner, so the plan's PR could never merge; a path pitwall must commit that the project's ignore rules ignore would never be committed. To fix: a resume asked the decisions again; a session on `main` or a new clone did not find the adoption on the planning branch; the plan skill could drop lines of a `docs/SPEC.md` the project brought; the headless run checked too little. Round two: round one's findings closed, and two blocking: the docs check's ID scan read the project's own documents, so an ID in an adr-tools ADR failed every stage; pitwall's sections could push the owner's `CLAUDE.md` over its size limit, which only a cut of the owner's lines could fix. Two to fix: the decide and plan checks did not find the project's own ADR files, and the advice for an ignored folder missed the folder itself. Round three approved; its four notes went in after it: GitHub is asked for the default branch when origin's HEAD is not on record, the files listed are capped at `adopt.maxListed`, a case that passed without its check, and a line of the epic's table.

| Round | Blocking | To fix | Subagent tokens | Tool calls | Minutes |
| --- | --- | --- | --- | --- | --- |
| 1 | 3 | 4 | 232,106 | 75 | 20.0 |
| 2 | 2 | 2 | 228,381 | 58 | 15.6 |
| 3 | 0 | 0, four notes | 178,674 | 58 | 14.7 |

**Next:** T7, the guard's corpus and the open bugs, then 1.0. BUG-11, BUG-12 and BUG-13, which T7's reviews found, wait until after 1.0 with BUG-9 (owner, 2026-11-14).

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

Older entries: T4a to T4c, T4d among them, in [archive/JOURNAL-T4a-T4c.md](archive/JOURNAL-T4a-T4c.md), T0 to T3b in [archive/JOURNAL-T0-T3b.md](archive/JOURNAL-T0-T3b.md).
