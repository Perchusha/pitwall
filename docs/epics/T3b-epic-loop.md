# T3b - The epic loop

Goal: `/pitwall:continue` takes a project from a merged plan through its epics and bug fixes, each to a merged PR, and needs the owner only where the process asks for them.
Depends on: T3a
Risk class: high (merges by risk class, and the rules that let a merge run without the owner)
ADR: ADR-0002, ADR-0005, ADR-0007, ADR-0008, ADR-0010, ADR-0011

## Acceptance criteria

- [ ] T3b-AC1: Conductor. `/pitwall:continue` orients from the session brief (T3a-AC2), git and `docs/BUGS.md`, and selects by precedence: an open bug, then the change in flight (an `epic/*` or `fix/*` branch, its PR open, or merged and not yet recorded), then the next planned epic whose dependencies are merged. Before any code it rereads the epic or the bug, its acceptance criteria and its ADRs, and asks the owner what is unclear, one question at a time. The first commit of each new branch records what merged since the last one; the first commit of E0's branch also writes `Plan approved by the owner, <date>, at <sha>`, with the sha of the plan's merge commit, into the Approval section of `docs/PLAN-REVIEW.md` (ADR-0008). After `budgets.epicsPerSession` merged changes it stops and suggests a fresh session.
- [ ] T3b-AC2: Implementers. One implementer works on one change, picked by its risk class (`riskClasses.<class>.implementer`, dispatched at that class's `effort`), on `epic/E<n>-<slug>` or on the branch of a bug fix, following the `epic` skill: tests for every new module, a test or a QA scenario for every acceptance criterion, `scripts/gate --fast` while it works, within its call budget (T3a-AC5). It returns DONE, PARTIAL or NEEDS_OWNER. A PARTIAL report gets a fresh implementer with the handoff, and the work stays in the tree; a NEEDS_OWNER question goes to the owner, one at a time. Its check before stopping runs at its handback (T3a-AC6).
- [ ] T3b-AC3: Gate and PR. `scripts/gate --full` runs before the PR, and a red gate opens no PR. The PR lists each acceptance criterion with what covers it, the ADR links, what was not done and the review file. `/pitwall:gate` runs the gate with one bounded wait and reports PASS or FAIL with the failing steps.
- [ ] T3b-AC4: Code review (ADR-0007, ADR-0011). The `code-reviewer` agent, a fresh sub-agent in the local session every round, briefed with paths only, reads `docs/LESSONS.md` first, then the change, its acceptance criteria, its ADRs and its diff against `main`, and writes only the change's review file: `docs/reviews/E<n>-<slug>.md` for an epic, `docs/reviews/BUG-<n>.md` for a bug fix. The file records the commit it reviewed, what covers each acceptance criterion, and numbered findings, each closed by a commit or by a risk the owner accepted. The review rule of the plan applies: `review.findings`, `review.ownerDecidesAtReject` and `review.maxRounds` (L-8). `docs-check --stage code-review` passes only when every criterion is covered and every finding is closed. `review-status.mjs --review code` sets `success` only when that check passes and the commits after the reviewed one changed nothing but the review file; otherwise it sets `failure`, or a new round runs. The guard of T3a-AC4 gains the code reviewer's row in `hooks.agents`.
- [ ] T3b-AC5: Merge by risk class through `merge.mjs` (T2). The PR of an epic or a bug fix merges only when `gate` and `ai-review` are green on its head. Low and normal merge without the owner when the project's owner allowed it (ADR-0010) and after the owner's yes otherwise; high always waits for the owner's yes.
- [ ] T3b-AC6: The owner's choice of ADR-0010. One question at kickoff, or at the first `/pitwall:continue` of a project laid out before it. The answer is recorded in `.claude/pitwall.json` by a script the owner runs in a terminal: the session hands it over (L-6), and the guard of T3a-AC3 refuses it to every agent. On yes the script writes the two narrow allow rules into `.claude/settings.local.json`, only when the review guard of T3a-AC4 is installed; they are written again when the plugin's path changes, and removed on no.
- [ ] T3b-AC7: Skill runs. `node scripts/e2e.mjs` runs the epic loop of the lite system headless against a fake GitHub: a local bare repository as `origin`, PRs, commit statuses, a CI that runs `scripts/gate --full` on each PR head as the check `gate`, and merges. By default it runs E1 from the state E0 saved; the run from E0 goes before the PR. Each stage writes its numbers as soon as it ends. `--github` runs the same against an empty private repository the owner created, where the session only pushes and opens PRs and merge protection is `local-hook`; it records the API's answers, and `scripts/check.mjs` checks the fake against them.
- [ ] T3b-AC8: Tests. `scripts/check.mjs` runs `review-status.mjs --review code`, `merge.mjs` on epic and fix PRs by risk class and the owner's choice, and the script of AC6 against the fake `gh`; `docs-check --stage code-review` on reviews the way the reviewer leaves them and on each kind of gap; and the hooks on payloads recorded from the code reviewer and an implementer, with the false refusals of L-9 counted as failures.

## Decisions

One-way, asked one at a time (2026-11-09):

- Code review findings live in a file per reviewed change, named after it: `docs/reviews/E<n>-<slug>.md` or `docs/reviews/BUG-<n>.md` (owner's edit), and `review-status.mjs` sets `success` only when nothing but the review file changed after the reviewed commit (owner's edit, ADR-0011).
- The headless run uses both: a fake GitHub by default, and once before the PR an empty private repository on GitHub. The owner creates and deletes that repository, and the session only pushes and opens PRs, so it needs neither `delete_repo` nor the right to create repositories; it is private because in the mode `local-hook` GitHub does not back pitwall's protection, so checking it against the real API matters more (owner's edit). The `--github` run records the API's answers, as T3a recorded the hook payloads, and `scripts/check.mjs` checks the fake against them, so the fake is checked against real data and not against pitwall's model of GitHub (owner's edit). A run costs about $50 to $150, so by default the fake run starts from the state E0 saved, the full run from E0 goes before the PR, and every stage writes its cost as soon as it ends, as in T1 (owner's edit).

## Out of scope

- Releases, QA, and filing bugs and lessons (T4); here the loop stops after the merge and records it.
- Adopting an existing project (T6).

## Open questions

None.
