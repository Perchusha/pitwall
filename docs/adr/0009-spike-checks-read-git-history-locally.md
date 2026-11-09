# ADR-0009: Spike checks read git history, and run locally

- Status: accepted
- Date: 2026-11-06
- Class: two-way
- Decided by: agent, accepted by the owner in the T2 list on 2026-11-06

## Context

Stage 3 promises a number measured against a criterion written in advance, and prototype code that never reaches `main` (SPEC 2). A file alone cannot show when its criterion was written; git history can. A check on history breaks without a sound: a CI checkout is shallow by default (`actions/checkout` fetches one commit), and it never holds a `spike/<topic>` branch at all. The owner asked that such a check never fail quietly in CI, and that the choice be recorded here.

## Options

| Option | Pros | Cons | Maturity | Cost | Lock-in |
| --- | --- | --- | --- | --- | --- |
| The check runs locally only, from the skills, and fails closed on a shallow or missing history | The history it reads is the developer's real one, spike branches included; CI stays as fast as it is | CI does not repeat the check | Plain git commands | None | None |
| `fetch-depth: 0` in the template CI, and the gate runs the check | CI repeats it | Every CI run fetches the whole history for one check, and still lacks the spike branches unless it fetches them too; the gate would depend on pitwall's scripts, which a project's CI does not have | Standard | Slower CI | Low |
| No history check, the skill's word only | Simplest | "Criterion first" and "code off main" become promises | - | None | None |

## Decision

- `docs-check --stage spike` reads git: the Criterion section of a spike has not changed since the commit that added the file; that commit held no result; the prototype commit the result names descends from it and is not reachable from the planning branch. It runs locally only: from `/pitwall:spike`, from `/pitwall:plan` and from `review-status.mjs`. Neither the template's CI nor `scripts/gate` runs it. On a shallow clone, outside git, or without a commit it needs, it fails and says why; it never passes for lack of history.
- When there is a remote, `spike/<topic>` is pushed before the check that its commit is not reachable from the planning branch, so the check sees the commit that was published.

## Consequences

- A clone without the spike branch fails `--stage spike` until it fetches the branch. The docs check without a stage needs no history.
- Until E0 the template's gate stub fails on any file that is not docs or configuration, so spike code that leaks into the planning branch turns the plan PR red. After E0 replaces the stub with the real checks, nothing mechanical keeps spike code out of an epic branch: only the review catches it. The owner accepts this risk.
- Revisiting: a project that wants CI to repeat the check adds `fetch-depth: 0`, a fetch of `spike/*` and a gate step that runs the docs check.
