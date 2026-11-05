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
| 0. Idea and process level | `kickoff` | Template laid out, `docs/IDEA.md`, merge protection | The owner confirms the idea and the level |
| 1. Discovery | `discovery`, `researcher` | `docs/DISCOVERY.md` | Every analogue linked, every assumption checkable, every constraint confirmed |
| 2. Decisions | `decide`, `researcher` | `docs/adr/*`, `docs/STACK.md` | Every area has an ADR or a two-way line; one-way decisions confirmed by the owner |
| 3. Spike | `spike` | `docs/spikes/<topic>.md` | A measured number against a criterion written in advance |
| 4. Plan | `plan` | `docs/EPICS.md`, `docs/epics/*` | Every epic has acceptance criteria and a risk class; no dependency cycles; E0 first |
| 5. Plan review | `plan-reviewer` | `docs/PLAN-REVIEW.md` | Every finding closed or accepted as a risk |
| 6. Epic loop | `continue`, `epic`, `gate`, `code-reviewer`, `release`, `qa` | A merged, tagged, QA-checked epic | Gate green, `ai-review` green, QA green on staging |

## 3. Process levels

| Level | When | Required | Lighter |
| --- | --- | --- | --- |
| lite | One user, no money or personal data, 1 to 3 epics | Discovery, 3 to 5 decisions, plan, epic loop with review | Spike optional, short plan review, a local build instead of staging and production |
| standard | Users, a database, auth, a deployment | Every stage, staging, QA after every merge, a production smoke check | Spike only for an unproven assumption |
| full | Several services, realtime, payments, AI pipelines, a high cost of error | Every stage, a spike and a pre-mortem, staging, QA, a production smoke check | Nothing |

At every level, a high-risk PR waits for the owner (section 6). The level can go up later; that change is an ADR too.

## 4. Decisions

One-way decisions (database, data model, monorepo, monolith or services, auth, hosting with lock-in) are asked one at a time, with 2 to 4 options compared on pros, cons, maturity, cost and lock-in, the agent's recommendation and the cost of revisiting. Two-way decisions (linter, formatter, test layout, small libraries) are picked by the agent with a one-line reason and accepted by the owner as a list. A two-way decision the agent doubts becomes one-way.

"New but proven" means a stable release, active maintenance, a migration path and compatibility with the rest of the stack. Versions, models, prices and limits are checked against live sources at decision time and kept in one config.

## 5. Finding project knowledge: no RAG by default

Project docs are tens or hundreds of kilobytes and change with almost every commit, so agents search them with grep and glob instead of a vector index (ADR-0003). Docs are findable by design: an ID on every entity (ADR-0007, E3, E3-AC2, BUG-12, L-5), `docs/INDEX.md`, `CLAUDE.md` under 200 lines, size limits on state files and an archive for closed rows. RAG is an optional module: a docs MCP for the stack's libraries, or a RAG over `docs/` once grep by ID stops finding things.

## 6. The epic loop

1. **Clarify.** Reread the epic, its acceptance criteria and ADRs. Questions go to the owner one at a time, before any code.
2. **Implement.** One implementer sub-agent per epic on `epic/E<n>-<slug>`, with a call budget. The risk class picks `implementer` or `implementer-deep`.
3. **Test.** Every new module has tests; every acceptance criterion has a test or a QA scenario. Hooks run checks after edits and before stopping.
4. **Gate.** `scripts/gate --full`. Red gate: no PR.
5. **PR** with the acceptance criteria, ADR links and what was not done. CI runs the gate as the check `gate`.
6. **Review** by `code-reviewer` in the local session with a fresh context: the diff, the epic, its ADRs and `docs/LESSONS.md`. Its verdict is the commit status `ai-review` (ADR-0002). When rejects on one epic reach `review.ownerDecidesAtReject` in `config/defaults.json`, the owner decides.
7. **Merge** by risk class, at every process level: low and normal merge themselves when `gate` and `ai-review` are green; high waits for the owner.
8. **Release and QA.** A semver tag with a changelog, a deploy to staging, QA against the acceptance criteria of every closed epic plus an exploratory pass, then production and a smoke check. Red QA files a bug and makes its fix the first item of the next loop.

Staging defaults: web, a separate environment with its own database and URL; desktop, a built installer, and for Steam a closed beta branch; mobile, TestFlight and Google Play internal testing; lite level, a local build.

## 7. Bugs, lessons and memory

- `docs/BUGS.md`: BUG-n with where it was found, steps, expected, actual, status and fix PR. A bug closes only with a regression test.
- `docs/LESSONS.md`: L-n, the rule, why, the date and how it is checked. The implementer and the reviewer read it first; this, not a fresh context alone, is what stops the same mistake twice. A rule a tool can check becomes a guard.
- `docs/JOURNAL.md`: one entry per epic with numbers and cost.

## 8. Agents

| Agent | Stage | Context | Sees | Returns |
| --- | --- | --- | --- | --- |
| Main conversation | 0, 2, 4, 6 | Talks to the owner | Everything | Questions one at a time, ADRs, plan, records |
| `researcher` | 1, 2 | Sub-agent, several in parallel | The topic and its criteria | A table with links to opened pages |
| `plan-reviewer` | 5 | Sub-agent, fresh context | The documents only | `docs/PLAN-REVIEW.md`, questions for the owner |
| `implementer`, `implementer-deep` | 6 | Sub-agent per epic, call budget | The epic, its ADRs, LESSONS, CLAUDE.md | Code, tests, a DONE, PARTIAL or NEEDS_OWNER report |
| `code-reviewer` | 6 | Sub-agent in the local session, fresh context | The diff, the epic, its ADRs, LESSONS | The `ai-review` verdict |
| `qa` | 6 | Sub-agent with a browser and E2E | Acceptance criteria, scenarios, the staging address | A report and new BUG-n |

Sub-agents never ask the owner; they return NEEDS_OWNER and the main conversation asks.

## 9. Packaging

- **The plugin** holds the process: skills, agents, hooks, scripts and defaults. Improving the process ships as a new plugin version to every project.
- **The template** (`plugins/pitwall/template/`) is copied into a new project by `kickoff` (ADR-0001). It holds no code; E0 adds the code and the real `scripts/gate` once the stack is chosen.
- **The contract between them** is a set of paths: `docs/EPICS.md`, `docs/epics/`, `docs/adr/`, `docs/LESSONS.md`, `docs/BUGS.md` and `scripts/gate --fast|--changed|--full`. Changing it is a major version.
- **MCP** is for data outside the repository: library docs for the stack, GitHub, a browser for QA, hosting and databases. Project state stays in files, and the process stays in skills.
- **Merge protection** follows repository visibility (ADR-0002): branch protection with the required checks `gate` and `ai-review` on public repositories, a local hook that refuses the merge on private repositories on GitHub Free.

## 10. Validation on three systems

The template is tested like a product: three systems of rising complexity walk the whole path, and the same numbers are taken for each.

| Level | System | What it tests |
| --- | --- | --- |
| lite | A desktop move-reminder app for one user | That a small idea does not drown in process |
| standard | A money tracker rebuilt from scratch: web, database, auth, two users | Decisions, ADRs, staging, merges by risk class, QA |
| full | Chosen after the standard run | Spike, pre-mortem, many high-risk epics, modules |

Measured per system: questions to the owner and how many were unnecessary; interventions outside the questions; calls, tokens and money per epic; blocking review findings and how many repeated a lesson; bugs found by QA after merge and bugs that reached production; what had to change in the plugin, each change released as a version before the next system.
