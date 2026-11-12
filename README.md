# pitwall

Idea to release with Claude Code. You sit on the pit wall and make the calls; agents run the laps.

pitwall is a Claude Code plugin and a project template. It takes a new project from a one-line idea through research, decisions recorded as ADRs and a plan in epics, then runs every epic through the same loop: clarify, implement with tests, gate, PR, a review by a fresh-context agent, a merge by risk class, a tagged release and QA on staging.

> **Status: v0.3.0, stages 0 to 5.** `/pitwall:kickoff`, `/pitwall:discovery`, `/pitwall:decide`, `/pitwall:spike` and `/pitwall:plan` work, with the `researcher` and `plan-reviewer` agents: a new project goes from a one-line idea to a reviewed plan merged into `main`. The epic loop and release still answer that they are not built yet; they arrive epic by epic, see [docs/EPICS.md](docs/EPICS.md).

## Install

```
/plugin marketplace add Perchusha/pitwall
/plugin install pitwall@pitwall
```

The plugin's scripts need Node.js on the PATH, at least the major version in `runtime.nodeMinMajor` of [config/defaults.json](plugins/pitwall/config/defaults.json) (ADR-0004); your project's stack can be anything. Merge protection uses the GitHub CLI (`gh`).

What the plugin does, stage by stage: [plugins/pitwall/README.md](plugins/pitwall/README.md).

## Principles

1. **One source of truth per kind of knowledge.** SPEC is what we build, ADRs are why, EPICS is the plan, LESSONS are the mistakes not to repeat. Skills hold process only.
2. **The owner decides.** Agents propose options with arguments; a one-way decision waits for a human answer.
3. **Tools enforce the rules, not prompts.** Hooks, linters, module boundaries, required checks.
4. **A stage closes only after its check**, and the check is written before the stage starts.
5. **The reviewer is not the author.** A fresh-context agent with the project's shared memory of mistakes.
6. **Volatile facts are checked against live sources.** Versions, models, prices and limits live in one place.
7. **Costs are counted up front.** Call budgets per agent, an estimate before every paid run.
8. **The process scales.** A small idea does not walk the path of a large system.

## Repository layout

```
.claude-plugin/marketplace.json   the marketplace: one plugin, pitwall
plugins/pitwall/                  the plugin
  .claude-plugin/plugin.json
  skills/                         one folder per stage and helper
  agents/                         researcher, plan-reviewer, implementers, code-reviewer, qa
  config/defaults.json            process levels, risk classes, budgets, limits, stage settings
  scripts/                        layout, docs check, merge protection, review status and merge, in Node
  template/                       the project skeleton that /pitwall:kickoff copies
docs/                             how pitwall itself is planned and built
scripts/check.mjs                 every check CI runs
scripts/e2e.mjs                   headless runs of the stage skills, run by hand before a PR
scripts/fake-gh.mjs               the fake gh the checks run the GitHub scripts against
```

## Development

pitwall is built with its own process: epics in [docs/EPICS.md](docs/EPICS.md), decisions in [docs/adr](docs/adr), one PR per epic, a fresh-context review before merge. Run every check with:

```
node scripts/check.mjs
```

`node scripts/check.mjs --fast` runs the steps that only read the repository, about 9 seconds; `.githooks/pre-commit` runs it before every commit once a clone has `git config core.hooksPath .githooks`.

It needs Node 22 and the Claude Code CLI (`claude`) on the PATH. See [CLAUDE.md](CLAUDE.md).

## License

MIT
