# pitwall

Idea to release with Claude Code. You sit on the pit wall and make the calls; agents run the laps.

pitwall is a Claude Code plugin and a project template. It takes a new project from a one-line idea through research, decisions recorded as ADRs and a plan in epics, then runs every epic through the same loop: clarify, implement with tests, gate, PR, a review by a fresh-context agent, a merge by risk class, and a tagged release that a QA agent and you check.

> **Status: 1.0.0.** The whole path works, from a one-line idea, or from a project that exists already, to a tagged release: `/pitwall:continue` conducts it, stage by stage and then epic by epic. Checked with Claude Code 2.1.318 (see [Requirements](#requirements)). What changed in each version: [CHANGELOG](plugins/pitwall/CHANGELOG.md); what comes after 1.0: [docs/EPICS.md](docs/EPICS.md).

## Quick start

1. Create an empty repository on GitHub, with no README, licence or `.gitignore`, and clone it. Kickoff makes the first commit itself; a repository that already has commits is adopted instead, after a dry run.
2. Install the plugin for your user, from a terminal:

   ```
   claude plugin marketplace add Perchusha/pitwall
   claude plugin install pitwall@pitwall
   ```

   Inside Claude Code, `/plugin marketplace add Perchusha/pitwall` and `/plugin install pitwall@pitwall` do the same: choose the user scope there. A project-scope install writes `.claude/settings.json` into the clone, and kickoff then refuses the folder as not empty.
3. Open Claude Code in the clone and start with your idea in one line:

   ```
   /pitwall:continue A command line tool that keeps my reading list
   ```

4. Answer its questions. At the end of each stage it asks whether to move on. From then on, in that project, say "continue": the project's `CLAUDE.md` turns it into `/pitwall:continue`, which takes the next step, a stage or the next change of the epic loop.

For a project that already exists, open Claude Code in its clone and run `/pitwall:continue`: the adoption starts with a dry run that writes nothing, and nothing is written before your yes.

What the plugin does, stage by stage: [plugins/pitwall/README.md](plugins/pitwall/README.md).

## Requirements

- Claude Code. pitwall 1.0.0 is checked with 2.1.318, the version CI pins in [.claude-code-version](.claude-code-version); its headless runs used 2.1.323.
- Node.js on the PATH, at least the major version in `runtime.nodeMinMajor` of [config/defaults.json](plugins/pitwall/config/defaults.json) (ADR-0004): the plugin's scripts and hooks run on it. Your project's own stack can be anything.
- bash: the gate, `scripts/gate`, is a bash script, and every hook starts through bash. On Windows, the bash of Git for Windows (Git Bash).
- git, and the GitHub CLI (`gh`) signed in to github.com, with admin rights on the repository: pitwall opens every PR, sets the `ai-review` status and merges through `gh`, and sets up merge protection with it. GitHub.com only.

## Process levels

Kickoff proposes a level from the idea, and you choose: **lite** for one user and a few epics, **standard** for a product with users, data and a deployment, **full** for several services, payments or realtime. The level sets how much each stage asks: the research, the pre-mortem of the plan review, whether a spike is required. What each level holds: [Process levels](plugins/pitwall/README.md#process-levels).

## What you do

pitwall asks you only what an agent should not decide. You:

- answer its questions, one at a time; what the agent only inferred comes to you as one list to confirm;
- make the one-way decisions: the agent proposes options with its arguments and waits for your answer;
- confirm a spike's criterion before its prototype, and measure by hand when the spike asks you to;
- say yes to the plan's merge, once the plan reviewer has approved it;
- once a review has run its first rounds, decide each finding still open: fixed, or accepted as a risk with your fallback;
- say yes to each merge that waits for you, and run the manual QA scenarios the change lists for you: high-risk changes, bug fixes and releases always wait, and low and normal risk epics do unless you allowed them, once, at Claude Code's permission prompt, to merge themselves when both checks are green;
- confirm each bug's severity and risk class when it is filed; a bug you do not want fixed becomes a risk you accept, with your fallback;
- at a release, go through the manual QA list, say yes, and make the tag and the GitHub release from the commands it hands you: no agent makes a tag;
- run in your own terminal the few commands pitwall hands you: a step of merge protection it could not take, the record of your choice of merges when Claude Code does not ask you, a review status Claude Code did not let run.

`/pitwall:owner-calls` lists everything that waits for you, with what happens if you say nothing.

## Limits

- A release is a local build at every level. The standard and full levels name staging, QA after every merge and a deployment to production with its smoke check: none of them is built yet, and T8 brings staging and QA in a browser.
- The standard and full levels have not yet run on a real project, and the adoption of an existing project has run only headless, on a test project: T5b, a real project adopted at the full level, comes after 1.0.
- The default branch must be `main`: kickoff makes it so, and the adoption stops while it is not, with the steps of the rename.
- The marketplace serves the plugin from `main`, not from a tag (T8).
- The guards catch mistakes, not a command built to hide what it does: [R-2, R-3 and R-5](docs/RISKS.md) say what gets past them. A merge that waits for you is held by Claude Code's permission prompt: with permissions skipped, or an allow rule of your own that covers `merge.mjs`, only the skill's text holds it (R-4).
- Open bugs, none blocking: BUG-9 and BUG-11 to BUG-13, in [docs/BUGS.md](docs/BUGS.md).

## Principles

1. **One source of truth per kind of knowledge.** SPEC is what we build, ADRs are why, EPICS is the plan, LESSONS are the mistakes not to repeat. Skills hold process only.
2. **The owner decides.** Agents propose options with arguments; a one-way decision waits for a human answer.
3. **Tools enforce the rules, not prompts.** Hooks, linters, module boundaries, required checks.
4. **A stage closes only after its check**, and the check is written before the stage starts.
5. **The reviewer is not the author.** A fresh-context agent with the project's shared memory of mistakes.
6. **Volatile facts are checked against live sources.** Versions, models, prices and limits live in one place.
7. **Costs are bounded.** Call budgets per agent and per session.
8. **The process scales.** A small idea does not walk the path of a large system.

## Repository layout

```
.claude-plugin/marketplace.json   the marketplace: one plugin, pitwall
plugins/pitwall/                  the plugin
  .claude-plugin/plugin.json
  CHANGELOG.md                    what changed in each version
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
