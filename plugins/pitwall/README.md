# pitwall

Idea to release with Claude Code. You sit on the pit wall and make the calls; agents run the laps.

pitwall takes a new project from a one-line idea through research, decisions recorded as ADRs and a plan in epics, then runs every epic through the same loop: clarify, implement with tests, gate, PR, a review by a fresh-context agent, a merge by risk class, a tagged release and QA on staging. Every stage ends with a check, every decision keeps its reason, and the state lives in the repository, so work can stop and resume at any time.

> **Status: v0.3.0, stages 0 to 5.** `/pitwall:kickoff`, `/pitwall:discovery`, `/pitwall:decide`, `/pitwall:spike` and `/pitwall:plan` work, with the `researcher` and `plan-reviewer` agents. The later commands still say that their stage is not built yet: T3 (the epic loop), T4 (release and QA). See [docs/EPICS.md](https://github.com/Perchusha/pitwall/blob/main/docs/EPICS.md).

## Install

```
/plugin marketplace add Perchusha/pitwall
/plugin install pitwall@pitwall
```

## Requirements

- Node.js on the PATH, at least the major version in `runtime.nodeMinMajor` of `config/defaults.json`: the plugin's scripts (layout, docs check, merge protection) run on it. Your project's own stack can be anything.
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
| 6. Epic loop | `/pitwall:continue` | One merged, tagged and QA-checked epic per lap |

Helpers: `/pitwall:gate`, `/pitwall:release`, `/pitwall:bug`, `/pitwall:lesson`, `/pitwall:owner-calls`.

## Process levels

- **lite**: one user, no money or personal data, 1 to 3 epics. A local build stands in for staging and production.
- **standard**: users, a database, auth, a deployment. Every stage, a short pre-mortem in the plan review, staging, QA after every merge and a production smoke check.
- **full**: several services, realtime, payments or AI pipelines. Everything in standard, plus a required spike and a longer pre-mortem.

## What stages 0 to 5 leave in a project

- `.claude/pitwall.json`: the process level, the merge protection mode and `templateVersion`, the plugin version the project was laid out from.
- `docs/IDEA.md`, `docs/DISCOVERY.md` (analogues with links, constraints with the date you confirmed them, assumptions `A-1`, `A-2` by risk), an ADR for each one-way decision the owner made (at lite, only the few that matter most; the rest are in the accepted two-way list) and `docs/STACK.md` with registry-checked versions.
- `docs/spikes/<topic>.md` for each spike: the criterion, committed before any prototype code and never changed, the measured numbers and the conclusion. The prototype stays on `spike/<topic>`.
- `docs/SPEC.md`, `docs/EPICS.md` and one file per epic (E0 first, each with acceptance criteria `E<n>-AC<m>` and a risk class), `docs/RISKS.md` with the risks you accepted, and `docs/PLAN-REVIEW.md` from the plan reviewer.
- One commit on `main` (the skeleton), and everything after it on the planning branch (`planning.branch` in the config) until the plan is reviewed and merged in one PR, with a merge commit whose message records your approval.

Each stage ends with `scripts/docs-check.mjs --stage <stage>` from the plugin, which also reports a missing section, an ID that points nowhere and a state file over its size limit. The spike check reads git history, so it runs on your full local clone, not in CI.

## Review and merge

The reviewer runs in your local session and publishes its verdict as the `ai-review` status check, through `scripts/review-status.mjs`, which sets success only when the review passes its check. The plan reviewer does this for the plan PR; the code reviewer will for every epic (T3). A PR merges only when both `gate` and `ai-review` are green:

- on a public repository, or a private one on a paid plan, branch protection enforces it, admins included, and `gate` must come from GitHub Actions;
- on a private repository on GitHub Free, where branch protection is not available, kickoff records the mode `local-hook`; the hook that refuses the merge ships with the epic loop (T3).

The plan PR merges once you say yes, with a merge commit (the repository must allow merge commits, and must not require linear history). At every process level, low and normal risk epic PRs merge themselves; high-risk PRs (auth, payments, data migrations and deletion, infrastructure, security) wait for you.

## The project template

`template/` is laid out in a new project by `/pitwall:kickoff`, through `scripts/layout.mjs`, which never overwrites a file. Files that tools would otherwise pick up inside this plugin carry a `.tmpl` suffix, and kickoff renames them: `CLAUDE.md.tmpl`, `.claude/settings.json.tmpl`, `.claude/pitwall.json.tmpl`, `gitignore.tmpl` (to `.gitignore`), `editorconfig.tmpl` (to `.editorconfig`) and `gitattributes.tmpl` (to `.gitattributes`, which keeps line endings LF so scripts run on Windows too). The template holds no code: the code and the real `scripts/gate` arrive in epic E0, once the stack is chosen.

## Configuration

`config/defaults.json` holds the process levels (with the pre-mortem length, whether a spike is required and the size of a lite plan), risk classes, call budgets (researchers per level), review and merge protection settings, the planning branch, the discovery, decide, spike, plan and plan review settings (counts, constraints, the list of decision areas, the checklists per level), maturity criteria and registries for new dependencies, and size limits for the docs.

## License

MIT
