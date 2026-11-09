# T2 - Stages 3 to 5

Goal: decisions become an approved, merged plan: spike, plan and plan-reviewer work, and the plan PR reaches `main` under the protection T1 set up.
Depends on: T1
Risk class: normal
ADR: ADR-0002, ADR-0005, ADR-0006, ADR-0007, ADR-0008, ADR-0009

## Acceptance criteria

- [ ] T2-AC1: Spike (ADR-0009). `/pitwall:spike` takes an assumption from `docs/DISCOVERY.md` (by default the riskiest one no spike has tested), writes `docs/spikes/<topic>.md` from the template with the hypothesis and a criterion with a number, which the owner confirms, and commits it on the planning branch before any prototype code. The prototype lives on `spike/<topic>`, started from that commit, pushed when there is a remote and never merged. The result records the measured numbers, who measured them (a command, or the owner when a person has to look) and the prototype commit; the conclusion is confirmed or not confirmed against the criterion, and a spike that is not confirmed names its follow-up: a new ADR from `/pitwall:decide <area>`, which supersedes the old one where the area had one, or an accepted risk. `docs-check --stage spike` checks in git that the criterion has not changed since the commit that added the file, that this commit held no result, and that the prototype commit descends from it and is not reachable from the planning branch. It runs locally only and fails closed on a shallow or missing history.
- [ ] T2-AC2: Plan. `/pitwall:plan` fills `docs/SPEC.md` (overview, scenarios, architecture, data model) and writes `docs/EPICS.md` and one file per epic from the template: a goal, acceptance criteria `E<n>-AC<m>` written so QA can check them without the code, dependencies, ADR links and a risk class from `riskClasses`, with E0 first. The owner accepts the plan table before it is committed on the planning branch.
- [ ] T2-AC3: Plan check. `docs-check --stage plan` refuses an epic without acceptance criteria or a risk class, a table row and an epic file that disagree, an ADR ID or relative link that does not resolve, a dependency on an unknown or later epic, a dependency cycle, a plan whose first epic is not E0, a spike without a conclusion or a failed one without a follow-up, and at the lite level more epics after E0 than `processLevels.lite.epics.max`.
- [ ] T2-AC4: Plan review (ADR-0007). The `plan-reviewer` agent, briefed with paths and the process level only, writes only `docs/PLAN-REVIEW.md`: a pre-mortem with `preMortemReasons` reasons for the level (none at lite, 5 at standard, 10 at full), the non-functional and launch items of its level from `planReview` in the config, a size and an uncertainty for every epic, and findings. The main conversation closes the findings in the epics, `docs/SPEC.md` and `docs/RISKS.md`, asking the owner one question at a time; every round is a fresh agent that rereads the documents, and after `review.ownerDecidesAtReject` rounds the owner decides. `docs-check --stage plan-review` passes only when every reason and finding is closed by an ID that resolves or accepted as a risk with a date, every item of the level has an answer and a place where it lives, every epic is sized and an unknown or L epic has an action, and every high-risk assumption is cited by a spike, an ADR, an epic or an accepted risk (at full, the riskiest has a concluded spike).
- [ ] T2-AC5: Review status and merge (ADR-0007, ADR-0008). The reviewer sets `ai-review` through `scripts/review-status.mjs`: it checks that it may (L-5), commits only `docs/PLAN-REVIEW.md`, and sets `success` only on a clean, pushed head of the open PR from the planning branch that passes `--stage plan-review`; otherwise it sets `failure` or hands over. Once both checks are green and the owner says yes, `scripts/merge.mjs` checks that merge commits are allowed and linear history is not required, and merges the plan PR with a merge commit whose message holds `Plan approved by the owner, <date>, at <sha>`; otherwise it hands over. `protect.mjs` sets `required_linear_history: false`. `scripts/check.mjs` runs every branch of both scripts against a fake `gh`.
- [ ] T2-AC6: T1 follow-ups. (a) `protect.mjs` takes "branch protection is available" from the protection probe only: a 404 means available, a 403 "Upgrade to GitHub Pro" means GitHub Free; a branch summary that shows protection no longer counts. (b) Researchers get a call budget per process level (`budgets.researcherToolCalls`), and the discovery and decide briefs pass it on. (c) Every script that hands a step over prints each command for the owner on a line of its own under a plain label. (d) The fake `gh` stages a refused probe while other protection is visible.
- [ ] T2-AC7: Skill runs. `node scripts/e2e.mjs` runs spike and plan headless for the lite system of SPEC 10. Its normal mode starts a stage from the state the stage before it saved, and every passing stage saves its state. gh is signed out, so the spike must pass `--stage spike`, the plan `--stage plan` and `--stage plan-review`, and `review-status.mjs` must run and hand over without a write. Like T1-AC7, it checks files and git, never wording, and is not part of `scripts/check.mjs` or CI.

## Decisions

One-way, asked one at a time (2026-11-06): the reviewer sets `ai-review` through one plugin script, and the T3a hook runs it only from the two pitwall reviewers, which the PreToolUse payload can tell apart (ADR-0007); the plan PR merges with a merge commit after the owner's yes, which the merge commit message records (ADR-0008).

Two-way, picked by the agent and accepted by the owner as a list, with the owner's edits (marked):

| Area | Choice | Why, in one line |
| --- | --- | --- |
| Criterion first | The spike file with the hypothesis and the criterion is committed on the planning branch before `spike/<topic>` starts from it; the check reads git, locally only, and fails closed on a shallow history (owner's edit, ADR-0009) | "Criterion first" and "code off main" are checked by a tool, and never pass quietly in CI |
| Spike code | On `spike/<topic>`, pushed before the reachability check when there is a remote, never merged; the gate stub catches a leak until E0, the review after it (owner's edit, ADR-0009) | The prototype stays readable, and the gap after E0 is recorded |
| Who builds and measures | The main conversation, within `budgets.subagentToolCalls.stop` calls; the result says whether a command or the owner measured | Implementers are T3b, and some measurements need a person |
| Spike template | `docs/spikes/template.md`: Hypothesis, Criterion, Result, Conclusion, with the fields Assumption, Branch, Outcome, Follow-up | The same pattern as `adr/0000-template.md`; a new file is a minor version |
| A spike that fails | `/pitwall:decide <area>` revisits one area: a new ADR, the old one `superseded by`, `docs/STACK.md` updated; the spike's follow-up names that ADR or an accepted risk | "Back to decide with a new ADR" without copying decide into spike |
| Spikes by level | At every level each high-risk assumption is covered by a spike, an ADR, an epic or an accepted risk; at full the riskiest has a concluded spike; at standard "unproven" is the reviewer's call | "Unproven" is judgement, coverage is checkable |
| `docs/SPEC.md` | The plan fills overview, scenarios, architecture and data model; the non-functional section is filled as the review closes | Nothing filled it so far, and the reviewer reads it |
| Plan check | E0 first, rows and files agree, risk from `riskClasses`, criteria numbered in order, dependencies only on earlier epics, links resolve, status `planned` | T2-AC3, plus the table and the files staying in step |
| Size of a lite plan | At lite at most `processLevels.lite.epics.max` (3) epics after E0, or raise the level with an ADR | The lite level says 1 to 3 epics (SPEC 3) |
| Review depth | `preMortemReasons` per level: lite 0, standard 5, full 10 (owner's edit); non-functional and launch items carry the levels they apply to | SPEC 3 and the config said it differently; now they agree |
| Findings | `docs/PLAN-REVIEW.md` gains `## Findings`, a launch questions table and `## Approval` (filled by E0's first commit); every reason and finding is closed by an ID or an accepted risk | "Every finding closed or accepted" becomes a check; adding headings is minor (ADR-0006) |
| Plan reviewer | Read, Grep, Glob, Write, Edit and Bash for two scripts; the brief holds paths and the level only; it writes only `docs/PLAN-REVIEW.md`, and the main conversation closes findings elsewhere (owner's edit, ADR-0007) | From the documents only, and the reviewer is not the author |
| PR and merge | The plan skill pushes the planning branch and opens the PR before the last round; `merge.mjs` merges after the owner's yes; both scripts hand over when they may not act | The L-5 and L-6 pattern of T1, and parts T3b reuses |
| Skill runs | `e2e.mjs` adds spike and plan for the lite system; the scripted owner takes a spike on the riskiest assumption, measured by a command where one can measure it and by the scripted owner where a person has to look (the first run needed a person: lock and sleep cannot be done headless); a stage starts from saved state | Spike and the reviewer run headless before T5, without paying for stages 0 to 2 every time |
| Version | 0.3.0 | New skills, scripts, a template file and headings are minor (ADR-0006) |

The owner added the T1 follow-ups in T2-AC6 to this epic.

## Out of scope

- The hooks: running `review-status.mjs` only from the reviewers, and limiting the plan reviewer's writes (T3a-AC4).
- Writing the plan's merge commit into `docs/PLAN-REVIEW.md`: the first commit of E0's branch (T3b-AC1).
- Merging epics by risk class with `merge.mjs` (T3b-AC5).

## Open questions

None.
