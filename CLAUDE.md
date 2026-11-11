# pitwall

pitwall is a Claude Code plugin and marketplace that takes a project from an idea to a release through checked stages. The design is `docs/SPEC.md`; read the sections your task touches before planning. `docs/INDEX.md` lists every document.

## Current epic

The first epic in `docs/EPICS.md` whose status is neither merged nor released. That table is the only record of epic status; this file never repeats it.

## Commands

- All checks, as CI runs them: `node scripts/check.mjs`
- Headless runs of the stage skills (signed-in CLI, spends the subscription, not in CI; the owner runs the long ones in a terminal of their own with `--log <file>`, which the session reads, since a session restart ends anything the session started; the first line names the commit of this checkout the run copied at its start, and its sessions load that copy through `--plugin-dir`): `node scripts/e2e.mjs` runs the epic loop's E1 from the state E0 saved, against a fake GitHub; before a PR, `node scripts/e2e.mjs --from e0` runs E0 and E1; a blocking bug filed and fixed through the loop from the state E1 saved: `--from bug`; the planning stages: `node scripts/e2e.mjs --until plan`; one stage from the state the stage before it saved: `--from <stage> --until <stage>`; against an empty private repository the owner created, recording GitHub's answers for `scripts/check.mjs`: `--from e0 --github <owner/repo>`; the hooks alone: `node scripts/e2e.mjs --hooks`, and `--hooks --record` to record the payloads `scripts/check.mjs` runs them on (again whenever `.claude-code-version` moves)
- The docs check on any project: `node plugins/pitwall/scripts/docs-check.mjs --root <dir> [--stage kickoff|discovery|decide|spike-criterion|spike|plan|plan-review|code-review] [--change <change>]` (several stages joined by commas)
- The official validator alone: `claude plugin validate --strict .` (marketplace) and `claude plugin validate --strict plugins/pitwall` (plugin)
- Try the plugin from this checkout: `claude --plugin-dir plugins/pitwall`
- Install it from the local marketplace in a scratch home: `export HOME=$(mktemp -d)`, then `claude plugin marketplace add <this checkout>`, `claude plugin install pitwall@pitwall` and `claude plugin details pitwall@pitwall` to list its parts
- Tag a release (after the version bump is merged): `claude plugin tag plugins/pitwall` creates `pitwall--v<version>`

## Layout

- `.claude-plugin/marketplace.json`: the marketplace, one plugin.
- `plugins/pitwall/`: the plugin. Only `plugin.json` and the icon live in its `.claude-plugin/`; skills, agents, config, scripts and the template sit at the plugin root.
- `plugins/pitwall/scripts/`: the Node scripts skills call (ADR-0004): `layout.mjs`, `docs-check.mjs`, `protect.mjs`, `review-status.mjs`, `merge.mjs`, `owner-calls.mjs`, `bugs.mjs` (the bugs, risks and lessons that wait in the git directory for the next branch), and `merge-choice.mjs`, which only the owner runs, with `merge-rules.mjs`; and the hooks, which `plugins/pitwall/hooks/hooks.json` registers: `hook.mjs`, with `hook-events.mjs` and `hook-guard.mjs`. `scripts/check.mjs` runs each of them as a project gets them, the GitHub ones against `scripts/fake-gh.mjs`, the hooks on the payloads in `scripts/hook-payloads/`, and holds the fake GitHub of the loop runs (`scripts/fake-github.mjs`) to GitHub's answers in `scripts/github-responses/`.
- `plugins/pitwall/template/`: the project skeleton `/pitwall:kickoff` copies. A file that a tool would load inside this repository carries a `.tmpl` suffix (`CLAUDE.md.tmpl`, `settings.json.tmpl`, `pitwall.json.tmpl`, `gitignore.tmpl`, `editorconfig.tmpl`, `gitattributes.tmpl`), and so does anything under the template's `.claude/`.
- `docs/`: how pitwall itself is planned and built, in the same structure the template gives a project.

## How to work

- pitwall is built with its own process: one epic, one branch `epic/T<n>-<slug>`, one PR, reviewed by a fresh-context agent before merge. Reviews of pitwall's own epics stop after three rounds, and what is open then goes to `docs/BUGS.md` or `docs/RISKS.md` (owner, 2026-11-11); only a realistic finding blocks; an exotic one becomes one accepted risk (`review.findings` in `config/defaults.json`).
- `main` is protected, so a merged epic is recorded (its status in `docs/EPICS.md`) in the first commit of the next epic's branch. That commit also takes the bugs, risks and lessons that wait in the git directory: run `node plugins/pitwall/scripts/bugs.mjs flush` first, and commit the files it names.
- Skills hold process only. Knowledge goes in `docs/`, defaults in `config/defaults.json`. Never a second source of truth.
- Every skill carries a `> Status:` line. Until it reads `> Status: built ...`, the skill keeps `disable-model-invocation: true` so it never triggers by itself; the check enforces both. An unbuilt agent says so in its description and returns `STATUS: NOT_IMPLEMENTED`.
- The plugin never assumes a stack. It calls the project's `scripts/gate` and reads the docs by path.
- A version bump changes `plugin.json`, the marketplace entry and the marketplace metadata in the same commit. The check enforces it.
- Every file is in English, and no file holds an em dash: use a hyphen, a comma or a colon. The check rejects Cyrillic and em dashes; other languages are on the reviewer.

## Never

- Hardcode model IDs, prices or API limits in a skill or agent. They belong in `config/defaults.json` or the project's own config. The check rejects model IDs in skills and agents.
- Weaken `scripts/check.mjs` or the validator's `--strict` mode to make a change pass.
- Change the paths the template gives a project (`docs/EPICS.md`, `docs/adr/`, `scripts/gate`, `.claude/pitwall.json`, ...) or rename a `##` heading of a template document without a major version bump and a migration note: skills and the docs check find them by convention (ADR-0006).
