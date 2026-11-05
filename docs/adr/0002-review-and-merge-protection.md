# ADR-0002: Local review as a status check, merge protection by visibility

- Status: accepted
- Date: 2026-11-05
- Class: one-way
- Decided by: owner

## Context

Every epic merges through a PR that a separate agent has reviewed. The review has to block the merge, and the owner works on GitHub Free with a mix of public and private repositories. On GitHub, a PR author cannot approve their own PR, and the agents act from the owner's account.

## Options

| Option | Pros | Cons |
| --- | --- | --- |
| Review in CI | Independent of the session | Spends API tokens instead of the subscription |
| Review in the local session | Runs on the subscription | The session must publish the verdict itself |
| Verdict as an approval from a GitHub App | A real "Approve" by a bot identity | An app, a private key and an install per repository; on one machine the key needs a guard anyway |
| Verdict as a commit status from the owner's account | No setup | Any session with the token could set it, so a hook must guard it |
| Branch protection everywhere | Enforced by GitHub | Not available for private repositories on GitHub Free |

## Decision

- The review runs in the local session (owner, 2026-11-05).
- Its verdict is the commit status `ai-review` from the owner's account (owner, 2026-11-05). A hook lets only the review flow set it. A GitHub App with real approvals may come later as an optional module.
- Merge protection follows visibility (owner, 2026-11-05): a public repository gets branch protection with the required checks `gate` and `ai-review`; a private repository on GitHub Free gets a local hook that refuses `gh pr merge` until both are green.

## Consequences

- CI runs only the gate; it calls no model.
- On private repositories the protection is only as strong as the hook: a merge from the GitHub web page is not blocked. The owner accepts this.
- A status belongs to a commit, so a push after the review needs a new review before the merge.
