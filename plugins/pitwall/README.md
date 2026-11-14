# pitwall

Idea to release with Claude Code. You sit on the pit wall and make the calls; agents run the laps.

pitwall takes a new project from a one-line idea through research, decisions recorded as ADRs and a plan in epics, then runs every epic through the same loop: clarify, implement with tests, gate, PR, a review by a fresh-context agent, a merge by risk class, and a tagged release that a QA agent and you check. Every stage ends with a check, every decision keeps its reason, and the state lives in the repository, so work can stop and resume at any time.

> **Status: 1.0.0, stages 0 to 5, the adoption of a project that exists already, the hooks, the epic loop, bugs and lessons, the gate before every commit, releases and a minimal QA, and one conductor for the whole path.** `/pitwall:continue` leads from the idea to the last epic: say "continue" and it takes the next step. `/pitwall:kickoff`, `/pitwall:discovery`, `/pitwall:decide`, `/pitwall:spike`, `/pitwall:plan`, `/pitwall:gate`, `/pitwall:owner-calls`, `/pitwall:bug`, `/pitwall:lesson` and `/pitwall:release` work, with the `researcher`, `plan-reviewer`, `implementer`, `implementer-deep`, `code-reviewer` and `qa` agents, and the hooks guard every pitwall project. A release is a local build at every level for now: staging, production and QA in a browser come later. What changed in each version: [CHANGELOG.md](CHANGELOG.md); what comes after 1.0: [docs/EPICS.md](https://github.com/Perchusha/pitwall/blob/main/docs/EPICS.md).

## Install

```
/plugin marketplace add Perchusha/pitwall
/plugin install pitwall@pitwall
```

Choose the user scope when the install asks: a project-scope install writes `.claude/settings.json` into the folder, and kickoff then refuses it as not empty. From a terminal, `claude plugin marketplace add Perchusha/pitwall` and `claude plugin install pitwall@pitwall` install for your user.

## Requirements

- Node.js on the PATH, at least the major version in `runtime.nodeMinMajor` of `config/defaults.json`: the plugin's scripts (layout, docs check, merge protection) and its hooks run on it. Your project's own stack can be anything.
- bash (Git Bash on Windows): the gate contract, `scripts/gate`, is a bash script, and every hook starts through bash, which checks for a pitwall project and for Node before anything else.
- The GitHub CLI, `gh`, signed in to github.com with admin rights on the repository: pitwall opens every PR, sets the `ai-review` status, merges and sets up merge protection through it (the commands it hands over were tested with gh 2.98). Without it, kickoff hands you the steps to install it and sign in. GitHub.com only.

## Stages

`/pitwall:continue` conducts all of them: in a new empty folder it starts stage 0 with your idea, then it runs the stage the project has reached and asks you before it moves on to the next, and once the plan is merged it runs the epic loop. In a pitwall project you can just say "continue". Each stage's own command still works.

| Stage | Command | Output |
| --- | --- | --- |
| 0. Idea and process level | `/pitwall:kickoff` | Project skeleton, `docs/IDEA.md`, merge protection |
| 0, for a project that exists | `/pitwall:adopt` | First a dry run that writes nothing: what pitwall would add, what it keeps, how your own plan maps onto `docs/EPICS.md`. After your yes: only the paths the project lacks, your real checks as `scripts/gate`, pitwall's documents filled from yours, and the stage the project starts from |
| 1. Discovery | `/pitwall:discovery` | `docs/DISCOVERY.md`: scenarios, analogues, constraints, risks |
| 2. Decisions | `/pitwall:decide` | One ADR per decision, `docs/STACK.md` |
| 3. Spike | `/pitwall:spike` | `docs/spikes/<topic>.md` with a measured result, the prototype on `spike/<topic>` |
| 4. Plan | `/pitwall:plan` | `docs/SPEC.md`, `docs/EPICS.md` and one file per epic with acceptance criteria |
| 5. Plan review | (the `plan-reviewer` agent, from `plan`) | `docs/PLAN-REVIEW.md`: pre-mortem, requirements, launch, sizing, findings; `ai-review` on the plan PR, which merges after your yes |
| 6. Epic loop | `/pitwall:continue` | One merged change per lap: the change in flight, a blocking bug's fix or the next epic, implemented, gated, reviewed into `docs/reviews/`, merged by risk class |
| Release | `/pitwall:release` | A version: `CHANGELOG.md` from the merge commits, the local build of `scripts/build`, the `qa` agent's check of every closed epic's criteria, your yes, and the tag you make |

Helpers: `/pitwall:gate`, `/pitwall:owner-calls` (everything that waits for you, in one list, with what happens if you say nothing), `/pitwall:bug` (a defect of merged work, with a title, a severity and a risk class you confirm), `/pitwall:lesson` (a mistake that can repeat, and what checks it).

## Adopting an existing project

In a repository that already holds code or docs, `/pitwall:continue` (or `/pitwall:adopt`) starts with a dry run, `scripts/adopt.mjs`, which writes nothing and lists what would happen: every template path the project lacks (`ADD`) and has (`KEEP`, never overwritten), the items of your own plan file, done and open, your documents (your own files in `docs/adr/`, `docs/epics/`, `docs/spikes/` and `docs/reviews/` stay as they are, and pitwall's checks leave them alone), the checks your manifests and CI already run, and a blocker for each path pitwall must commit that your ignore rules ignore. You decide from that list: the level, the stage to start from (discovery, decide or the plan; the stages before it stay as you did them, and their docs checks are skipped), the commands of the gate, and what pitwall's documents replace. `docs/EPICS.md` takes over your plan, whose file gets one line that says so: there are never two plans. Nothing is written before your yes. The adoption is one commit on the planning branch, so `main` moves only with the plan's PR; your own CI file stays, and the check named `gate` gets a workflow of its own; `.gitattributes` and `.gitignore` are written narrow, for pitwall's own paths, and only where you had none.

## Process levels

- **lite**: one user, no money or personal data, 1 to 3 epics. A local build stands in for staging and production.
- **standard**: users, a database, auth, a deployment. Every stage and a short pre-mortem in the plan review. The level names staging, QA after every merge and a production smoke check, and none of them is built yet: a release here is a local build checked by the `qa` agent, as at lite, until T8 brings staging and QA in a browser.
- **full**: several services, realtime, payments or AI pipelines. Everything in standard, plus a required spike and a longer pre-mortem.

## What stages 0 to 5 leave in a project

- `.claude/pitwall.json`: the process level, the merge protection mode, `templateVersion`, the plugin version the project was laid out from, and `autoMerge`, your answer on merges of epics without you.
- `docs/IDEA.md`, `docs/DISCOVERY.md` (analogues with links, constraints with the date you confirmed them, assumptions `A-1`, `A-2` by risk), an ADR for each one-way decision the owner made (at lite, only the few that matter most; the rest are in the accepted two-way list) and `docs/STACK.md` with registry-checked versions.
- `docs/spikes/<topic>.md` for each spike: the criterion, committed before any prototype code and never changed, the measured numbers and the conclusion. The prototype stays on `spike/<topic>`.
- `docs/SPEC.md`, `docs/EPICS.md` and one file per epic (E0 first, each with acceptance criteria `E<n>-AC<m>` and a risk class), `docs/RISKS.md` with the risks you accepted, and `docs/PLAN-REVIEW.md` from the plan reviewer.
- One commit on `main` (the skeleton), and everything after it on the planning branch (`planning.branch` in the config) until the plan is reviewed and merged in one PR, with a merge commit whose message records your approval.

Each stage ends with `scripts/docs-check.mjs --stage <stage>` from the plugin, which also reports a missing section, an ID that points nowhere and a state file over its size limit. The spike check reads git history, so it runs on your full local clone, not in CI.

## What the epic loop leaves

`/pitwall:continue` takes one change per lap and never interrupts it: the change in flight, then a blocking bug's fix on `fix/BUG-<n>`, the next epic on `epic/E<n>-<slug>`, and a bug that is not blocking once no epic is ready. Bugs, risks and lessons recorded between branches wait in the git directory, outside the work tree, until the first commit of the next branch. It asks you what is unclear before any code, dispatches an implementer by the risk class (a fresh one with the handoff when the first runs out of its budget), runs `scripts/gate --full`, opens the PR, and runs the code reviewer until it approves, under the same stopping rule as the plan review. Each change leaves:

- its commits and its PR, with each acceptance criterion and what covers it;
- `docs/reviews/E<n>-<slug>.md` or `docs/reviews/BUG-<n>.md` from the code reviewer: the commit it reviewed, the criteria and their tests or QA scenarios, and every finding with the commit or the accepted risk that closed it;
- its merge commit on `main`, and in the first commit of the next branch its status (`merged (#n)`, or a fixed bug) and an entry in `docs/JOURNAL.md`; E0's branch also records your approval of the plan in `docs/PLAN-REVIEW.md`.

`/pitwall:continue 1` stops after one merged change; without a number it stops after `budgets.epicsPerSession` and suggests a fresh session. Once the plan is done, it offers `/pitwall:release`.

## Releases

`/pitwall:release` ships what the loop merged since the last release as one version (ADR-0013). `release.mjs` reads the merge commits on `main` (`feat(E<n>): ...`, `fix(BUG-<n>): ...`): an epic makes a minor version, fixes alone a patch, a major only when you name it, and the first release asks you 0.1.0 or 1.0.0. A commit on `main` that is no merge of the loop never reaches the changelog and is named to you. The release leaves:

- a branch `release/v<x.y.z>` with one commit: the version's section in `CHANGELOG.md` (`### Added` for epics, `### Fixed` for bugs), `released (v<x.y.z>)` for each epic in it, each bug fixed with its PR, and the records of changes merged and not recorded yet, the last one of the plan included;
- `docs/reviews/release-v<x.y.z>.md` from the `qa` agent, the release's reviewer: it checks the changelog and the records, runs the project's `scripts/build <version>` (which prints an `ARTIFACT: <path>` line per thing it built and changes no tracked file) and `scripts/gate --full`, and finds a test or a QA scenario behind every criterion of every closed epic and every fixed bug. Its `ai-review` means the automated part passed; the manual QA it lists is your checklist, and each failure becomes a bug, blocking until you confirm it;
- its merge commit `release: v<x.y.z> (#<pr>)`, after your yes, never while a blocking bug is open;
- the commands for you to make and push the annotated tag `v<x.y.z>` on that merge commit and to publish the build with `gh release create`: no agent makes a tag, and no new release starts until it exists.

## Review and merge

The reviewer runs in your local session and publishes its verdict as the `ai-review` status check, through `scripts/review-status.mjs`, which sets success only when the review passes its check. The plan reviewer does this for the plan PR, the `qa` agent for a release; the code reviewer does it for every epic and bug fix, from its file `docs/reviews/E<n>-<slug>.md` or `docs/reviews/BUG-<n>.md`, and only while nothing but that file changed after the commit it reviewed. A PR merges only when both `gate` and `ai-review` are green:

- on a public repository, or a private one on a paid plan, branch protection enforces it, admins included, and `gate` must come from GitHub Actions;
- on a private repository on GitHub Free, where branch protection is not available, kickoff records the mode `local-hook`, and a hook refuses `gh pr merge` until both are green on the PR's head.

The plan PR merges once you say yes, with a merge commit (the repository must allow merge commits, and must not require linear history). Epics and fixes merge with a merge commit too, `feat(E<n>): ...` or `fix(BUG-<n>): ...`, through `scripts/merge.mjs`, which records your yes or the risk class in the message. High-risk PRs (auth, payments, data migrations and deletion, infrastructure, security), bug fixes and releases always wait for you. Low and normal risk epics merge themselves only if you chose that, once, at kickoff or at your first `/pitwall:continue`: the session runs `node "<plugin>/scripts/merge-choice.mjs" --allow` (or `--deny`) for your answer, and Claude Code asks you to allow that one command, whatever the session's mode or allow rules: your yes at that prompt records the answer in `.claude/pitwall.json` and writes two narrow allow rules into `.claude/settings.local.json` for the review status and `merge.mjs --change`. No allow rule ever covers the script itself, no sub-agent can run it, and the guard refuses it outright from another folder than the project's root and in a session nobody attends, where the session hands you the command; you can always run it yourself in a terminal instead.

## Hooks

In a pitwall project, a folder with `.claude/pitwall.json`, the plugin's hooks (`hooks/hooks.json`, `scripts/hook.mjs`) do this; anywhere else they do nothing:

- **A brief at session start**: the process level, the merge protection mode, the branch, the current epic with its unchecked criteria, the call budget, and a self-test of the guards that warns you at once when it fails.
- **Uncommitted work**: a git command that would throw it away (`checkout` or `restore` over changed files, `reset --hard`, `reset --merge` over staged changes, `rm -f` over a changed file, `worktree remove --force` over a work tree that is not clean, `clean -f`, `stash drop` or `clear`, a forced switch) is refused, for every agent, and the refusal offers `git stash push -- <files>` or a commit (for a work tree, a stash or a commit in that work tree, or naming it plainly); on a clean tree the same command passes.
- **Guards** on every tool call, commands included: secret files and key formats, files git ignores, a push that changes `main`, `gh pr merge --admin` and writes to branch protection or rulesets, and the guards' own switch, which only you change: any command that names `.claude/pitwall.json`, the project's or your Claude Code settings, or the plugin's folder is refused unless it only reads (`cat`, `grep`, `git diff`) or is one of pitwall's own scripts, and so is `claude plugin disable`.
- **The review status**: only the plan reviewer, the code reviewer and the `qa` agent run `review-status.mjs`, each for its own kind of review (`--review plan`, `code`, `release`), and no commit status is written any other way. The plan reviewer writes only `docs/PLAN-REVIEW.md` and runs only its two scripts; the code reviewer writes only `docs/reviews/*.md` and runs only those two, read-only git and `scripts/gate`; the `qa` agent writes only `docs/reviews/release-*.md` and runs only `release.mjs`, `bugs.mjs` (a bug in a quoted heredoc), the docs check, `review-status.mjs`, read-only git and `scripts/gate`. `merge-choice.mjs` records a choice that is yours alone: the guard sends the main conversation's call to Claude Code's permission prompt, refuses it in a line with anything else or in a mode that never asks, and refuses it to every sub-agent.
- **Call budgets** (`budgets` in the config): a sub-agent is told to wrap up at `warn` and refused past `stop`; the main conversation is told, and refused past `stop` only when nobody attends it (`claude -p`).
- **The gate**: on an `epic/*`, `fix/*` or `release/*` branch, `scripts/gate --fast` after each edit outside `docs/`, reported to the agent, and `scripts/gate --changed` before the session or an implementer stops, which a red gate blocks a few times (`hooks.stopRetries`).
- **A release's tag**: a tag named like a version (`v1.2.3`) made, moved or deleted, a push of one or of every tag, and `gh release create`, `edit`, `delete` and `upload` are refused whatever their tag: the tag and the GitHub release are yours to make, from the commands `/pitwall:release` hands you. A git tag not named like a version is the project's own business.
- **The gate before every commit**: `git commit --no-verify` or `-n`, and a `git config` that points `core.hooksPath` anywhere but `.githooks` or unsets it, or sets it for every repository of the account or the machine (`--global`, `--system`), whatever the value, are refused, so that the project's git hook (below) runs on every commit.
- **Merges without you**: the brief says what you chose, and on yes the session start keeps the two allow rules pointing at the plugin's current folder, so an update needs nothing from you.

A guard that cannot run refuses the call and says why. To turn pitwall off in one project, run `claude plugin disable pitwall@pitwall --scope local` yourself in a terminal: an agent asked to run it is stopped by the guard. The guards catch mistakes, not a command built to hide what it does (`review.threatModel`).

## The project template

`template/` is laid out in a new project by `/pitwall:kickoff`, through `scripts/layout.mjs`, which never overwrites a file. Files that tools would otherwise pick up inside this plugin carry a `.tmpl` suffix, and kickoff renames them: `CLAUDE.md.tmpl`, `.claude/settings.json.tmpl`, `.claude/pitwall.json.tmpl`, `gitignore.tmpl` (to `.gitignore`), `editorconfig.tmpl` (to `.editorconfig`) and `gitattributes.tmpl` (to `.gitattributes`, which keeps line endings LF so scripts run on Windows too). The template holds no code: the code and the real `scripts/gate` arrive in epic E0, once the stack is chosen.

It also holds `.githooks/pre-commit`, the gate before every commit: kickoff sets `core.hooksPath` to `.githooks` for the project's repository, after asking you when you already have hooks of your own there, and from then on git runs `scripts/gate --fast` before each commit and refuses it while the gate is red. A commit of nothing but Markdown under `docs/` and `.claude/pitwall.json`, and any commit on a `spike/*` branch, pass without it. `/pitwall:continue` sets `core.hooksPath` again in a new clone, which does not carry it, and lays the hook out in a project laid out before 0.8.0, in a commit of its own on the next branch. Every commit now waits for `scripts/gate --fast`, so keep that mode fast.

## Configuration

`config/defaults.json` holds the process levels (with the pre-mortem length, whether a spike is required and the size of a lite plan), risk classes (the implementer, its effort and whether it may merge without the owner), call budgets (researchers per level, implementers per change), the hooks (the brief's size, the gate's time limits, the agents with limits of their own, the scripts that record a choice of the owner, the secret patterns), review and merge protection settings, the planning branch, the epic loop (its branches, the review folder and severities, the key of the owner's choice), the discovery, decide, spike, plan and plan review settings (counts, constraints, the list of decision areas, the checklists per level), maturity criteria and registries for new dependencies, and size limits for the docs.

## License

MIT
