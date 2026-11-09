# ADR-0005: Branch protection includes admins

- Status: accepted
- Date: 2026-11-05
- Class: one-way
- Decided by: owner

## Context

ADR-0002 puts merge protection on `main` by visibility. The agents act from the owner's account, which is admin of the repository. Classic branch protection with `enforce_admins` off lets an admin merge a red PR (`gh pr merge --admin`) and push to `main` directly, so it would not bind the agents at all until the T3 hooks exist.

## Options

| Option | Pros | Cons | Maturity | Cost | Lock-in |
| --- | --- | --- | --- | --- | --- |
| Admins included | No session with the owner's token can bypass `gate` and `ai-review`, by merge or by push, even before T3 | The owner cannot bypass either: an emergency merge means switching the protection off first; until T3 the owner sets `ai-review` by hand | Standard GitHub setting | Free | None: one setting |
| Admins excluded | The owner can merge anything | So can every agent: protection rests on discipline, and before T3 not even on a hook | Standard GitHub setting | Free | None |

## Decision

Kickoff sets branch protection with `enforce_admins` on (owner, 2026-11-05). In the same step, picked by the agent and accepted by the owner:

- `gate` is required from GitHub Actions only, so a status set by hand cannot pass it; `ai-review` is accepted from any source, because the review flow sets it from the owner's account.
- A private repository on a paid plan gets branch protection too, since it is stronger than the hook. The mode comes from a read-only probe of the protection API: `404 Branch not protected` means available, `403 Upgrade to GitHub Pro` means a private repository on GitHub Free.
- On GitHub Free, kickoff records the mode `local-hook` in `.claude/pitwall.json`; the hook itself is built with the other hooks in T3a (T3a-AC7). Nothing merges by itself before T3b.
- The values (`mergeProtection` and `review` in `config/defaults.json`) are read by `scripts/protect.mjs`, never repeated in a skill.

## Consequences

- The first PR of a new project, the plan from `plan/initial`, needs an `ai-review` status: the plan reviewer sets it in T2 (T2-AC5).
- pitwall's own repository had admins excluded when this was decided. Turning it on was the owner's step, outside this epic; on 2026-11-06 the branch summary of `main` reads `enforcement_level: everyone`, so it is on.
- Revisiting it is one setting per repository.
