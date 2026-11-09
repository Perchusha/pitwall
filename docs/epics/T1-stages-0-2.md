# T1 - Stages 0 to 2

Goal: a new project goes from a one-line idea to recorded decisions: kickoff, discovery and decide work, with the researcher agent.
Depends on: T0
Risk class: normal
ADR: ADR-0002, ADR-0003, ADR-0004, ADR-0005, ADR-0006

## Acceptance criteria

- [ ] T1-AC1: Kickoff. `/pitwall:kickoff` in an empty folder checks for Node and for the folder first (ADR-0004, `layout.mjs --check`), asks about the idea one question at a time, proposes a process level with its reason from `config/defaults.json` and waits for the owner. `scripts/layout.mjs` then lays out the template: placeholders filled, `.tmpl` suffixes dropped, and `.claude/pitwall.json` holding the process level, the merge protection mode and the plugin version the layout came from (ADR-0006). Kickoff writes `docs/IDEA.md` (the problem, who it is for, why this level), makes the skeleton the only direct commit on `main` and starts the branch `plan/initial` for stages 1 to 5. A folder that holds any file but `.git`, Claude Code's own `.claude/settings.local.json` and the files an operating system leaves behind, or a repository that already has commits, is refused before the first question, and nothing is written.
- [ ] T1-AC2: Merge protection (ADR-0002, ADR-0005). `scripts/protect.mjs` first checks that it may (L-5): `gh` is installed and signed in, the owner is admin, `main` is on GitHub. A read-only probe of the protection API picks the mode. Where branch protection is available (a public repository, or a private one on a paid plan) it requires `gate` from GitHub Actions and `ai-review` from any source, with admins included. On a private repository on GitHub Free it records `local-hook`; the hook itself is T3a-AC7. A failed precondition or a refused write records `pending` (a recorded mode is kept when the run could not check it, a recorded `branch-protection` is dropped once the run reads weaker protection, and a recorded `local-hook` once the run sees that branch protection is available) and hands the owner ready `run:` commands that work unchanged in bash and PowerShell (L-6), plus the `then:` command that records the result. `--dry-run` reads, prints the writes and writes nothing. `scripts/check.mjs` tests every branch against a fake `gh`.
- [ ] T1-AC3: Discovery. `/pitwall:discovery` writes `docs/DISCOVERY.md` on `plan/initial`: the problem and user, 3 to 7 scenarios, non-goals, 5 to 10 analogues from 2 or 3 `researcher` agents run in parallel, each row linking a page that was opened, owner constraints asked one at a time and each marked confirmed, and assumptions A-n sorted by risk, each with a way to check it.
- [ ] T1-AC4: Decide. `/pitwall:decide` walks every area in `decide.areas` of `config/defaults.json`, asks each one-way decision on its own with 2 to 4 options compared (pros, cons, maturity, cost, lock-in, source), presents the two-way decisions as one list, writes one ADR per one-way decision the owner makes (at lite, `processLevels.lite.decisions` lets the less important one-way areas end in the two-way list) from the template and `docs/STACK.md`, where each versioned choice links the registry page it was checked on, with the date. Every area ends in an ADR or a two-way line.
- [ ] T1-AC5: Docs check. `scripts/docs-check.mjs` reports a missing section (a `##` heading of the matching template file), a broken ID link (ADR-NNNN, E<n>, E<n>-AC<m>, BUG-n, L-n, A-n, R-n), a `CLAUDE.md` over its line limit and a state file over its size limit, with the limits and the list of state files in `config/defaults.json`. An ID inside a code span is an example and is not checked. `--stage kickoff|discovery|decide` adds that skill's Check. `scripts/check.mjs` runs it on a scratch project laid out from the template by `layout.mjs`, on broken and filled-in copies of it, and on pitwall's own docs (IDs and sizes, with the epic prefix T read from `docs/EPICS.md`).
- [ ] T1-AC6: Teammate. The template settings (`extraKnownMarketplaces`, `enabledPlugins`) are confirmed by hand in an interactive session: a profile without the pitwall marketplace opens a kicked-off project, trusts the folder and gets the plugin. `claude plugin` subcommands and `-p` do not act on marketplaces a project declares (checked in T1), so this check cannot be scripted.
- [ ] T1-AC7: Skill runs. `node scripts/e2e.mjs` runs kickoff, discovery and decide headless in a scratch folder with a scripted owner, `gh` signed out and a logging fake `gh` for `protect.mjs`, and each stage must pass `docs-check.mjs --stage` and the git state it promises. It checks files and their structure, never the model's wording. It is not part of `scripts/check.mjs` or CI: it needs a signed-in CLI and spends the subscription, so the owner runs it before a PR.

## Decisions

One-way, asked one at a time (2026-11-05): plugin scripts run on Node.js (ADR-0004); branch protection includes admins (ADR-0005); the merge hook for private repositories on GitHub Free is built in T3a, and kickoff records the mode. The owner added to the two-way list: `.claude/pitwall.json` and template headings join the contract (ADR-0006), the plan PR gets its `ai-review` from the plan reviewer (T2), and adopting an existing project becomes its own epic (T6).

Two-way, picked by the agent and accepted by the owner as a list:

| Area | Choice | Why, in one line |
| --- | --- | --- |
| Planning branch | The skeleton is the only direct commit on `main`; stages 1 to 5 commit on `plan/initial`, one PR after stage 5 | `main` is protected from the end of kickoff, and the plan is reviewed as a whole |
| Existing project | Kickoff refuses it | Merging into a live project is its own problem: T6 |
| No GitHub remote | Kickoff offers `gh repo create` or later; later hands over the protection command | Creating a repository is the owner's outward-facing call |
| Private on a paid plan | Branch protection | Stronger than a hook; the API probe tells, not the plan name |
| Required checks | `gate` bound to GitHub Actions, `ai-review` from any source | A status set by hand cannot pass the gate |
| Docs check | Required sections are the template's `##` headings; IDs gain A-n (assumptions) and R-n (risks) | One source for structure, and every row a stage writes has an ID |
| Decide areas | The list lives in `config/defaults.json` | The skill and the check read the same list |
| Researchers | 2 or 3 in parallel, with web search, page fetch and file reads | Enough spread for 5 to 10 analogues without duplicate searching |
| Marketplace pin | None: a project gets the current plugin | Process improvements reach every project (SPEC 9); the major-version rule and `templateVersion` guard breaking changes |

## Out of scope

- Kickoff into an existing project: T6.
- The local merge hook for private repositories on GitHub Free: T3a-AC7.
- The plan PR, its review and stages 3 to 5: T2.

## Open questions

None.
