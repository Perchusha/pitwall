# ADR-0011: Code review findings live in a file per reviewed change

- Status: accepted
- Date: 2026-11-09
- Class: one-way
- Decided by: owner

## Context

ADR-0007 has a reviewer set `ai-review` through `review-status.mjs`, which for the plan commits `docs/PLAN-REVIEW.md` and sets `success` only when that file passes its check. T3b adds the code reviewer, and it needs the same two things: a fresh reviewer each round (L-8) has to see what the rounds before it found, and the script has to tell whether every finding is closed. `/pitwall:continue` takes a bug fix before the next epic, and the PR of a fix is reviewed like an epic's.

## Options

| Option | Pros | Cons | Maturity | Cost | Lock-in |
| --- | --- | --- | --- | --- | --- |
| A file per reviewed change in the repository | The plan review's pattern: the hook lets the reviewer write one file, `review-status.mjs` commits only it, and a docs check decides "every finding closed"; the next round reads the findings with their numbers; the reviews stay beside the epics, works without GitHub | A new folder in the project contract; one commit per round in the change's PR | Same as `docs/PLAN-REVIEW.md` (T2) | None | Low |
| Comments on the PR on GitHub | Seen where the PR is read; no files | Every round needs GitHub; a script cannot tell from free text that every finding is closed; the reviewer gets a second way to write to GitHub, which the hook must guard; the state lives outside the repository (SPEC 1) | Standard GitHub feature | None | GitHub |
| One file, `docs/CODE-REVIEW.md`, rewritten for every change | One fixed path, the simplest hook rule | The review of the change before is only in git history | Same as the first | None | Low |

## Decision

- Code review findings live in a file per reviewed change in the project's repository. Only the code reviewer writes it, and `review-status.mjs` commits it on the change's branch, so it merges with the change (owner, 2026-11-09).
- The name repeats what is reviewed: `docs/reviews/E<n>-<slug>.md` for an epic, the same name as its file in `docs/epics/`, and `docs/reviews/BUG-<n>.md` for the PR that fixes a bug (owner, 2026-11-09).
- The file records the commit the reviewer reviewed. `review-status.mjs` sets `success` on the head only when the commits after that one changed nothing but the review file; otherwise the code changed after the review, and a new round runs (owner, 2026-11-09).

## Consequences

- `docs/reviews/` joins the contract (ADR-0006). The template adds the folder with a README, which is a minor version; a project laid out before gets the folder with its first review.
- `docs-check.mjs` gains a `code-review` stage that reads the file of the change on the current branch.
- Each round adds one commit to the change's PR. The reviews stay in the repository, as data for T5 and for the lesson flow of T4.
- Revisiting costs the template folder, the stage, an entry in `review-status.mjs` and the hook's rule; the reviews written by then stay as history.
