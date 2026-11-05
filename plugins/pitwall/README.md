# pitwall

Idea to release with Claude Code. You sit on the pit wall and make the calls; agents run the laps.

pitwall takes a new project from a one-line idea through research, decisions recorded as ADRs and a plan in epics, then runs every epic through the same loop: clarify, implement with tests, gate, PR, a review by a fresh-context agent, a merge by risk class, a tagged release and QA on staging. Every stage ends with a check, every decision keeps its reason, and the state lives in the repository, so work can stop and resume at any time.

> **Status: v0.1.0, skeleton.** The commands, agents and project template are in place, but every command only says that its stage is not built yet. The stages arrive epic by epic: T1 (stages 0 to 2), T2 (stages 3 to 5), T3 (the epic loop), T4 (release and QA). See [docs/EPICS.md](https://github.com/Perchusha/pitwall/blob/main/docs/EPICS.md).

## Install

```
/plugin marketplace add Perchusha/pitwall
/plugin install pitwall@pitwall
```

## Stages

| Stage | Command | Output |
| --- | --- | --- |
| 0. Idea and process level | `/pitwall:kickoff` | Project skeleton, `docs/IDEA.md`, merge protection |
| 1. Discovery | `/pitwall:discovery` | `docs/DISCOVERY.md`: scenarios, analogues, constraints, risks |
| 2. Decisions | `/pitwall:decide` | One ADR per decision, `docs/STACK.md` |
| 3. Spike | `/pitwall:spike` | `docs/spikes/<topic>.md` with a measured result |
| 4. Plan | `/pitwall:plan` | `docs/EPICS.md` and one file per epic with acceptance criteria |
| 5. Plan review | (the `plan-reviewer` agent, from `plan`) | `docs/PLAN-REVIEW.md`: pre-mortem, requirements, sizing |
| 6. Epic loop | `/pitwall:continue` | One merged, tagged and QA-checked epic per lap |

Helpers: `/pitwall:gate`, `/pitwall:release`, `/pitwall:bug`, `/pitwall:lesson`, `/pitwall:owner-calls`.

## Process levels

- **lite**: one user, no money or personal data, 1 to 3 epics. A local build stands in for staging.
- **standard**: users, a database, auth, a deployment. Every stage, staging and QA after every merge.
- **full**: several services, realtime, payments or AI pipelines. A spike and a pre-mortem are required, high-risk PRs wait for the owner.

## Review and merge

The reviewer runs in your local session and publishes its verdict as the `ai-review` status check. A PR merges only when both `gate` and `ai-review` are green:

- on a public repository, branch protection enforces it;
- on a private repository on GitHub Free, where branch protection is not available, a local hook refuses the merge.

Low and normal risk PRs merge themselves; high-risk PRs (auth, payments, data migrations, infrastructure, security) wait for you.

## The project template

`template/` is copied into a new project by `/pitwall:kickoff`. Files that tools would otherwise pick up inside this plugin carry a `.tmpl` suffix, and kickoff renames them: `CLAUDE.md.tmpl`, `.claude/settings.json.tmpl`, `gitignore.tmpl` (to `.gitignore`) and `editorconfig.tmpl` (to `.editorconfig`). The template holds no code: the code and the real `scripts/gate` arrive in epic E0, once the stack is chosen.

## Configuration

`config/defaults.json` holds the process levels, risk classes, call budgets, review settings, maturity criteria for new dependencies and size limits for the docs.

## License

MIT
