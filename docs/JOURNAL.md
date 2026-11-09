# Journal

One entry per epic, newest first.

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
