# pitwall spec

pitwall takes an idea to a release through stages that each end with a check. Agents do the work, the owner makes the decisions, and tools enforce the rules. This file is the design; the stage-by-stage procedure lives in the skills under `plugins/pitwall/skills/`, and decisions live in `docs/adr/`.

## 1. What the developer gets

- One command starts a new system, with the same documentation structure in every project.
- Every decision is recorded with its reason and the options that were rejected.
- Every epic reaches `main` through a PR, a review by a separate agent and QA.
- Work can stop and resume at any time: the state lives in the repository, not in a conversation.

## 2. The pipeline

Stages 0 to 5 run once and produce an approved plan. Stage 6 repeats for every epic until the plan is done.

| Stage | Skill or agent | Output | Check |
| --- | --- | --- | --- |
| 0. Idea and process level | `kickoff` | Template laid out, `docs/IDEA.md`, `.claude/pitwall.json`, merge protection | The owner confirms the idea and the level |
| 1. Discovery | `discovery`, `researcher` | `docs/DISCOVERY.md` | Every analogue linked, every assumption checkable, every constraint confirmed |
| 2. Decisions | `decide`, `researcher` | `docs/adr/*`, `docs/STACK.md` | Every area has an ADR or a two-way line; one-way decisions confirmed by the owner |
| 3. Spike | `spike` | `docs/spikes/<topic>.md`, prototype on `spike/<topic>` | A measured number against a criterion committed before the prototype (ADR-0009) |
| 4. Plan | `plan` | `docs/EPICS.md`, `docs/epics/*` | Every epic has acceptance criteria and a risk class; no dependency cycles; E0 first |
| 5. Plan review | `plan-reviewer`, `plan` | `docs/PLAN-REVIEW.md`, `ai-review` on the plan PR, the plan merged | Every finding closed or accepted as a risk; the owner says yes to the merge (ADR-0007, ADR-0008) |
| 6. Epic loop | `continue`, `epic`, `gate`, `code-reviewer`, `release`, `qa` | A merged, tagged, QA-checked epic | Gate green, `ai-review` green, QA green on staging |

## 3. Process levels

| Level | When | Required | Lighter |
| --- | --- | --- | --- |
| lite | One user, no money or personal data, 1 to 3 epics | Discovery, 3 to 5 decisions, plan, epic loop with review | Spike optional, a short plan review with no pre-mortem, a local build instead of staging and production |
| standard | Users, a database, auth, a deployment | Every stage, a pre-mortem with 5 reasons, staging, QA after every merge, a production smoke check | Spike only for an unproven assumption |
| full | Several services, realtime, payments, AI pipelines, a high cost of error | Every stage, a spike and a pre-mortem with 10 reasons, staging, QA, a production smoke check | Nothing |

At every level, a high-risk PR waits for the owner (section 6). The level can go up later; that change is an ADR too. The numbers behind each level (pre-mortem reasons, plan review items, epics at lite) live in `processLevels` and `planReview` of `config/defaults.json`.

## 4. Decisions

One-way decisions (database, data model, monorepo, monolith or services, auth, hosting with lock-in) are asked one at a time, with 2 to 4 options compared on pros, cons, maturity, cost and lock-in, the agent's recommendation and the cost of revisiting. Two-way decisions (linter, formatter, test layout, small libraries) are picked by the agent with a one-line reason and accepted by the owner as a list. A two-way decision the agent doubts becomes one-way.

"New but proven" means a stable release, active maintenance, a migration path and compatibility with the rest of the stack. Versions, models, prices and limits are checked against live sources at decision time and kept in one config.

## 5. Finding project knowledge: no RAG by default

Project docs are tens or hundreds of kilobytes and change with almost every commit, so agents search them with grep and glob instead of a vector index (ADR-0003). Docs are findable by design: an ID on every entity (`ADR-0007`, `E3`, `E3-AC2`, `BUG-12`, `L-5`, `A-2` for an assumption, `R-4` for a risk), `docs/INDEX.md`, `CLAUDE.md` within 200 lines, size limits on state files and an archive for closed rows. `scripts/docs-check.mjs` reports a missing section, an ID that points nowhere and a file over its limit; an ID inside a code span is an example and is not checked. RAG is an optional module: a docs MCP for the stack's libraries, or a RAG over `docs/` once grep by ID stops finding things.

## 6. The epic loop

1. **Clarify.** `/pitwall:continue` takes one change at a time: a blocking bug's fix first, then the change in flight, then the next epic whose dependencies are merged, then a fix of a bug that is not blocking. The work of a change it leaves for a fix waits in a stash, and the change takes `main` with the fix in when the loop returns to it. It rereads the change, its acceptance criteria and ADRs. Questions go to the owner one at a time, before any code.
2. **Implement.** One implementer sub-agent per change on `epic/E<n>-<slug>` or `fix/BUG-<n>`, with a call budget. The risk class picks `implementer` or `implementer-deep`; a PARTIAL report gets a fresh one with the handoff.
3. **Test.** Every new module has tests; every acceptance criterion has a test or a QA scenario. Hooks run checks after edits and before stopping.
4. **Gate.** `scripts/gate --full`. Red gate: no PR.
5. **PR** with the acceptance criteria, ADR links and what was not done. CI runs the gate as the check `gate`.
6. **Review** by `code-reviewer` in the local session with a fresh context each round: the diff, the change, its ADRs and `docs/LESSONS.md`. It writes `docs/reviews/E<n>-<slug>.md` or `docs/reviews/BUG-<n>.md`, its only file: the commit it reviewed, what covers each criterion and the findings, each closed by a commit or an accepted risk (ADR-0011). Its verdict is the commit status `ai-review` (ADR-0002, ADR-0007), set only while nothing but that file changed after the reviewed commit. When rejects on one change reach `review.ownerDecidesAtReject` in `config/defaults.json`, the owner decides, and rounds stop at `review.maxRounds` (L-8).
7. **Merge** by risk class, at every process level, with a merge commit `feat(E<n>): ...` or `fix(BUG-<n>): ...` that records who approved it: low and normal merge themselves when `gate` and `ai-review` are green and the project's owner chose that, for epics and, a choice of its own, for bug fixes (ADR-0010); otherwise, and always for high risk, the owner says yes. A merged change is recorded in the first commit of the next branch, since `main` is protected.
8. **Release and QA.** A semver tag with a changelog, a deploy to staging, QA against the acceptance criteria of every closed epic plus an exploratory pass, then production and a smoke check. Red QA files a bug and makes its fix the first item of the next loop.

Staging defaults: web, a separate environment with its own database and URL; desktop, a built installer, and for Steam a closed beta branch; mobile, TestFlight and Google Play internal testing; lite level, a local build.

## 7. Bugs, lessons and memory

- `docs/BUGS.md`: BUG-n with a title, where it was found, steps, expected, actual, a severity, a risk class, status and fix PR, filed by `/pitwall:bug`. Only a blocking bug, whose defect itself does harm in ordinary work, goes before the next epic; a bug filed without the owner's answer is blocking and high until they confirm it. A bug closes only with a regression test, or a QA scenario in a file where no test can drive the behaviour; the owner's no to a fix makes it an accepted risk. A defect of the branch in flight is a finding of its review, not a bug.
- `docs/LESSONS.md`: L-n, the rule, why, the date and how it is checked, recorded by `/pitwall:lesson`. The implementer and the reviewer read it first; this, not a fresh context alone, is what stops the same mistake twice. A rule a tool can check becomes a guard; until one is built, the missing check is a bug, and the lesson names it.
- New rows of these files, and changes to a bug not fixed yet, wait in the git directory, outside the work tree, until the first commit of the next branch moves them in, so that no implementer commits them into another change.
- `docs/JOURNAL.md`: one entry per epic with numbers and cost.

## 8. Agents

| Agent | Stage | Context | Sees | Returns |
| --- | --- | --- | --- | --- |
| Main conversation | 0, 2, 4, 6 | Talks to the owner | Everything | Questions one at a time, ADRs, plan, records |
| `researcher` | 1, 2 | Sub-agent, several in parallel | The topic and its criteria | A table with links to opened pages |
| `plan-reviewer` | 5 | Sub-agent, fresh context, one per round | The documents only | `docs/PLAN-REVIEW.md` (its only write), the `ai-review` verdict, questions for the owner |
| `implementer`, `implementer-deep` | 6 | Sub-agent per epic, call budget | The epic, its ADRs, LESSONS, CLAUDE.md | Code, tests, a DONE, PARTIAL or NEEDS_OWNER report |
| `code-reviewer` | 6 | Sub-agent in the local session, fresh context, one per round | The diff, the change, its ADRs, LESSONS | `docs/reviews/<change>.md` (its only write), the `ai-review` verdict, questions for the owner |
| `qa` | 6 | Sub-agent with a browser and E2E | Acceptance criteria, scenarios, the staging address | A report and new BUG-n |

Sub-agents never ask the owner; they return NEEDS_OWNER and the main conversation asks.

## 9. Packaging

- **The plugin** holds the process: skills, agents, hooks, scripts and defaults. Improving the process ships as a new plugin version to every project.
- **The template** (`plugins/pitwall/template/`) is copied into a new project by `kickoff` (ADR-0001). It holds no code; E0 adds the code and the real `scripts/gate` once the stack is chosen.
- **The contract between them** is a set of paths: `docs/EPICS.md`, `docs/epics/`, `docs/adr/`, `docs/reviews/`, `docs/LESSONS.md`, `docs/BUGS.md`, `.claude/pitwall.json` and `scripts/gate --fast|--changed|--full`, plus the `##` headings of the template's documents (ADR-0006, ADR-0011). Changing any of it is a major version with a migration note. `.claude/pitwall.json` holds the process level, the merge protection mode, `templateVersion`, the plugin version the project was laid out from, and `autoMerge`, the owner's choice of ADR-0010, which only the owner records, through `merge-choice.mjs` in a terminal.
- **Plugin scripts** run on Node.js (ADR-0004): the layout, the docs check, merge protection, the review status, the merge, the owner's choice of merges without them and the hooks. A project's stack needs no Node.
- **Hooks** act only in a pitwall project: a brief at session start, guards on secrets, ignored files, pushes to `main`, merge protection, the review status, the reviewers' limits, the owner's own script, git commands that would throw away uncommitted work (L-12) and their own switch, call budgets, and the gate after edits and before stopping on epic and fix branches (T3a, T3b). On the owner's yes to merges without them, the session-start hook keeps the two narrow allow rules of ADR-0010 in `.claude/settings.local.json` in step with the plugin's path. A guard that cannot run refuses.
- **MCP** is for data outside the repository: library docs for the stack, GitHub, a browser for QA, hosting and databases. Project state stays in files, and the process stays in skills.
- **Merge protection** follows repository visibility (ADR-0002): branch protection with the required checks `gate` and `ai-review`, admins included (ADR-0005), wherever GitHub offers it, and a local hook that refuses the merge on private repositories on GitHub Free.
- **Planning** happens on one branch: the skeleton is the only direct commit on `main`, stages 1 to 5 commit on `plan/initial`, and the plan reaches `main` in one PR after stage 5, merged with a merge commit once the owner says yes (ADR-0008). Spike code stays on `spike/<topic>`.

## 10. Validation on three systems

The template is tested like a product: three systems of rising complexity walk the whole path, and the same numbers are taken for each.

| Level | System | What it tests |
| --- | --- | --- |
| lite | A desktop move-reminder app for one user | That a small idea does not drown in process |
| standard | A money tracker rebuilt from scratch: web, database, auth, two users | Decisions, ADRs, staging, merges by risk class, QA |
| full | Chosen after the standard run | Spike, pre-mortem, many high-risk epics, modules |

Measured per system: questions to the owner and how many were unnecessary; interventions outside the questions; calls, tokens and money per epic; blocking review findings and how many repeated a lesson; bugs found by QA after merge and bugs that reached production; what had to change in the plugin, each change released as a version before the next system.
