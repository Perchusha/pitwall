# pitwall

Idea to release with Claude Code. You sit on the pit wall and make the calls; agents run the laps.

pitwall takes a new project from a one-line idea through research, decisions recorded as ADRs and a plan in epics, then runs every epic through the same loop: clarify, implement with tests, gate, PR, a review by a fresh-context agent, a merge by risk class, a tagged release and QA on staging. Every stage ends with a check, every decision keeps its reason, and the state lives in the repository, so work can stop and resume at any time.

> **Status: v0.7.0, stages 0 to 5, the hooks, the epic loop, bugs and lessons.** `/pitwall:kickoff`, `/pitwall:discovery`, `/pitwall:decide`, `/pitwall:spike`, `/pitwall:plan`, `/pitwall:continue`, `/pitwall:gate`, `/pitwall:owner-calls`, `/pitwall:bug` and `/pitwall:lesson` work, with the `researcher`, `plan-reviewer`, `implementer`, `implementer-deep` and `code-reviewer` agents, and the hooks guard every pitwall project. Releases and QA come in T4c: until then each lap of the loop ends at the merge, and `/pitwall:release` says it is not built yet. See [docs/EPICS.md](https://github.com/Perchusha/pitwall/blob/main/docs/EPICS.md).

## Install

```
/plugin marketplace add Perchusha/pitwall
/plugin install pitwall@pitwall
```

## Requirements

- Node.js on the PATH, at least the major version in `runtime.nodeMinMajor` of `config/defaults.json`: the plugin's scripts (layout, docs check, merge protection) and its hooks run on it. Your project's own stack can be anything.
- bash (Git Bash on Windows): the gate contract, `scripts/gate`, is a bash script, and every hook starts through bash, which checks for a pitwall project and for Node before anything else.
- The GitHub CLI, `gh`, signed in as an admin of the repository, for merge protection (the commands it hands over were tested with gh 2.98). Without it, kickoff hands you the commands to run.

## Stages

| Stage | Command | Output |
| --- | --- | --- |
| 0. Idea and process level | `/pitwall:kickoff` | Project skeleton, `docs/IDEA.md`, merge protection |
| 1. Discovery | `/pitwall:discovery` | `docs/DISCOVERY.md`: scenarios, analogues, constraints, risks |
| 2. Decisions | `/pitwall:decide` | One ADR per decision, `docs/STACK.md` |
| 3. Spike | `/pitwall:spike` | `docs/spikes/<topic>.md` with a measured result, the prototype on `spike/<topic>` |
| 4. Plan | `/pitwall:plan` | `docs/SPEC.md`, `docs/EPICS.md` and one file per epic with acceptance criteria |
| 5. Plan review | (the `plan-reviewer` agent, from `plan`) | `docs/PLAN-REVIEW.md`: pre-mortem, requirements, launch, sizing, findings; `ai-review` on the plan PR, which merges after your yes |
| 6. Epic loop | `/pitwall:continue` | One merged change per lap: a blocking bug's fix or the next epic, implemented, gated, reviewed into `docs/reviews/`, merged by risk class (tags and QA in T4c) |

Helpers: `/pitwall:gate`, `/pitwall:owner-calls` (everything that waits for you, in one list, with what happens if you say nothing), `/pitwall:bug` (a defect of merged work, with a title, a severity and a risk class you confirm), `/pitwall:lesson` (a mistake that can repeat, and what checks it), `/pitwall:release`.

## Process levels

- **lite**: one user, no money or personal data, 1 to 3 epics. A local build stands in for staging and production.
- **standard**: users, a database, auth, a deployment. Every stage, a short pre-mortem in the plan review, staging, QA after every merge and a production smoke check.
- **full**: several services, realtime, payments or AI pipelines. Everything in standard, plus a required spike and a longer pre-mortem.

## What stages 0 to 5 leave in a project

- `.claude/pitwall.json`: the process level, the merge protection mode, `templateVersion`, the plugin version the project was laid out from, and `autoMerge`, your answer on merges of epics without you (`autoMergeFixes`, the one for bug fixes, comes when the first fix of low or normal class is ready).
- `docs/IDEA.md`, `docs/DISCOVERY.md` (analogues with links, constraints with the date you confirmed them, assumptions `A-1`, `A-2` by risk), an ADR for each one-way decision the owner made (at lite, only the few that matter most; the rest are in the accepted two-way list) and `docs/STACK.md` with registry-checked versions.
- `docs/spikes/<topic>.md` for each spike: the criterion, committed before any prototype code and never changed, the measured numbers and the conclusion. The prototype stays on `spike/<topic>`.
- `docs/SPEC.md`, `docs/EPICS.md` and one file per epic (E0 first, each with acceptance criteria `E<n>-AC<m>` and a risk class), `docs/RISKS.md` with the risks you accepted, and `docs/PLAN-REVIEW.md` from the plan reviewer.
- One commit on `main` (the skeleton), and everything after it on the planning branch (`planning.branch` in the config) until the plan is reviewed and merged in one PR, with a merge commit whose message records your approval.

Each stage ends with `scripts/docs-check.mjs --stage <stage>` from the plugin, which also reports a missing section, an ID that points nowhere and a state file over its size limit. The spike check reads git history, so it runs on your full local clone, not in CI.

## What the epic loop leaves

`/pitwall:continue` takes one change per lap: a blocking bug's fix on `fix/BUG-<n>` first, then the change in flight, the next epic on `epic/E<n>-<slug>`, and a bug that is not blocking once no epic is ready. A change it leaves for a fix waits in a stash named `pitwall: <change> before <bug>`, which it pops when it returns. Bugs, risks and lessons recorded between branches wait in the git directory, outside the work tree, until the first commit of the next branch. It asks you what is unclear before any code, dispatches an implementer by the risk class (a fresh one with the handoff when the first runs out of its budget), runs `scripts/gate --full`, opens the PR, and runs the code reviewer until it approves, under the same stopping rule as the plan review. Each change leaves:

- its commits and its PR, with each acceptance criterion and what covers it;
- `docs/reviews/E<n>-<slug>.md` or `docs/reviews/BUG-<n>.md` from the code reviewer: the commit it reviewed, the criteria and their tests or QA scenarios, and every finding with the commit or the accepted risk that closed it;
- its merge commit on `main`, and in the first commit of the next branch its status (`merged (#n)`, or a fixed bug) and an entry in `docs/JOURNAL.md`; E0's branch also records your approval of the plan in `docs/PLAN-REVIEW.md`.

`/pitwall:continue 1` stops after one merged change; without a number it stops after `budgets.epicsPerSession` and suggests a fresh session.

## Review and merge

The reviewer runs in your local session and publishes its verdict as the `ai-review` status check, through `scripts/review-status.mjs`, which sets success only when the review passes its check. The plan reviewer does this for the plan PR; the code reviewer does it for every epic and bug fix, from its file `docs/reviews/E<n>-<slug>.md` or `docs/reviews/BUG-<n>.md`, and only while nothing but that file changed after the commit it reviewed. A PR merges only when both `gate` and `ai-review` are green:

- on a public repository, or a private one on a paid plan, branch protection enforces it, admins included, and `gate` must come from GitHub Actions;
- on a private repository on GitHub Free, where branch protection is not available, kickoff records the mode `local-hook`, and a hook refuses `gh pr merge` until both are green on the PR's head.

The plan PR merges once you say yes, with a merge commit (the repository must allow merge commits, and must not require linear history). Epics and fixes merge with a merge commit too, `feat(E<n>): ...` or `fix(BUG-<n>): ...`, through `scripts/merge.mjs`, which records your yes or the risk class in the message. High-risk PRs (auth, payments, data migrations and deletion, infrastructure, security) always wait for you. Low and normal risk epics merge themselves only if you chose that, once, at kickoff or at your first `/pitwall:continue`; low and normal risk bug fixes only if you chose that too, a choice of its own that `/pitwall:continue` asks when the first such fix is ready. You run `node "<plugin>/scripts/merge-choice.mjs" --allow` (or `--deny`, and `--fixes` for bug fixes) yourself in a terminal, which records the answer in `.claude/pitwall.json` and writes two narrow allow rules into `.claude/settings.local.json` for the review status and `merge.mjs --change`; no agent can run it.

## Hooks

In a pitwall project, a folder with `.claude/pitwall.json`, the plugin's hooks (`hooks/hooks.json`, `scripts/hook.mjs`) do this; anywhere else they do nothing:

- **A brief at session start**: the process level, the merge protection mode, the branch, the current epic with its unchecked criteria, the call budget, and a self-test of the guards that warns you at once when it fails.
- **Uncommitted work**: a git command that would throw it away (`checkout` or `restore` over changed files, `reset --hard`, `clean -f`, `stash drop` or `clear`, a forced switch) is refused, for every agent, and the refusal offers `git stash push -- <files>` or a commit; on a clean tree the same command passes.
- **Guards** on every tool call, commands included: secret files and key formats, files git ignores, a push that changes `main`, `gh pr merge --admin` and writes to branch protection or rulesets, and the guards' own switch, which only you change: any command that names `.claude/pitwall.json`, the project's or your Claude Code settings, or the plugin's folder is refused unless it only reads (`cat`, `grep`, `git diff`) or is one of pitwall's own scripts, and so is `claude plugin disable`.
- **The review status**: only the plan reviewer and the code reviewer run `review-status.mjs`, and no commit status is written any other way. The plan reviewer writes only `docs/PLAN-REVIEW.md` and runs only its two scripts; the code reviewer writes only `docs/reviews/*.md` and runs only those two, read-only git and `scripts/gate`. `merge-choice.mjs` is yours alone: the guard refuses it to every agent.
- **Call budgets** (`budgets` in the config): a sub-agent is told to wrap up at `warn` and refused past `stop`; the main conversation is told, and refused past `stop` only when nobody attends it (`claude -p`).
- **The gate**: on an `epic/*` or `fix/*` branch, `scripts/gate --fast` after each edit outside `docs/`, reported to the agent, and `scripts/gate --changed` before the session or an implementer stops, which a red gate blocks a few times (`hooks.stopRetries`).
- **Merges without you**: the brief says what you chose, and on yes the session start keeps the two allow rules pointing at the plugin's current folder, so an update needs nothing from you.

A guard that cannot run refuses the call and says why. To turn pitwall off in one project, run `claude plugin disable pitwall@pitwall --scope local` yourself in a terminal: an agent asked to run it is stopped by the guard. The guards catch mistakes, not a command built to hide what it does (`review.threatModel`).

## The project template

`template/` is laid out in a new project by `/pitwall:kickoff`, through `scripts/layout.mjs`, which never overwrites a file. Files that tools would otherwise pick up inside this plugin carry a `.tmpl` suffix, and kickoff renames them: `CLAUDE.md.tmpl`, `.claude/settings.json.tmpl`, `.claude/pitwall.json.tmpl`, `gitignore.tmpl` (to `.gitignore`), `editorconfig.tmpl` (to `.editorconfig`) and `gitattributes.tmpl` (to `.gitattributes`, which keeps line endings LF so scripts run on Windows too). The template holds no code: the code and the real `scripts/gate` arrive in epic E0, once the stack is chosen.

## Configuration

`config/defaults.json` holds the process levels (with the pre-mortem length, whether a spike is required and the size of a lite plan), risk classes (the implementer, its effort and whether it may merge without the owner), call budgets (researchers per level, implementers per change), the hooks (the brief's size, the gate's time limits, the agents with limits of their own, the scripts only the owner runs, the secret patterns), review and merge protection settings, the planning branch, the epic loop (its branches, the review folder and severities, the key of the owner's choice), the discovery, decide, spike, plan and plan review settings (counts, constraints, the list of decision areas, the checklists per level), maturity criteria and registries for new dependencies, and size limits for the docs.

## License

MIT
