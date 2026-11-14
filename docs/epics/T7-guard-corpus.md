# T7 - The guard's corpus

Goal: every change of a guard that reads commands is checked against its corpus before a reviewer sees it (L-13), and the bugs of the guard, with the two other open bugs, are fixed that way.
Depends on: T6
Risk class: high (the guard refuses tools in every pitwall project: a false refusal stops ordinary work, L-9)
ADR: ADR-0006

## Acceptance criteria

- [ ] T7-AC1: The guard's corpus (L-13). `scripts/guard-corpus.mjs` replays the command lines of the local transcripts through the hooks' guard at a given commit and in the working tree, as the main conversation and as the agents it is told, and prints each verdict that changed. It is a tool for developing pitwall: not part of the plugin and not a step of `scripts/check.mjs`, since CI has no transcripts; it runs only locally and skips its work, saying so, when it finds none. No transcript line enters the repository: the script prints a changed verdict by its caller, its rule and the form of the command, the programs it runs, and the journal, the PR and a committed review file quote only that (owner, 2026-11-10).
- [ ] T7-AC2: The 52 variants that T4a's verifying round wrote, kept by the owner outside the repository, are cases in `scripts/check.mjs` with their verdicts at T4a's merge, after a check showed that none of them is a copy of a transcript line (owner, 2026-11-10).
- [ ] T7-AC3: The guard's bugs are fixed in this epic, each with the cases that failed before its fix, and the corpus replayed after the fixes with every changed verdict explained: BUG-1 (`git rm -f`), BUG-2 (`git worktree remove --force`), BUG-3 (`git reset --merge`), BUG-4 (the PowerShell single-word assignment), BUG-6 (`node -e` reading the plugin's config), BUG-8 (`git config --global core.hooksPath`) and BUG-10 (a rule on a release's tag, its push and its GitHub release, R-6) (owner, 2026-11-13).
- [ ] T7-AC4: The two open bugs that are not the guard's are fixed with them: BUG-5 (`bugs.mjs flush` over a row with a cell too many) and BUG-7 (kickoff replacing hooks the owner set, unasked). BUG-9, Git LFS, keeps the date the owner gave it on 2026-11-12, after 1.0.

## Decisions

One-way (2026-11-13): T7 comes right after T6 and before 1.0, and holds the bugs, where the plan of 2026-11-12 fixed them after it (owner: "T7, the guard's corpus, BUG-1 to BUG-10"); T5b no longer stands before it. The agent read that range as every open bug but BUG-9, whose date after 1.0 the owner had set by name the day before, and says so in the hand-over.

One-way (2026-11-11): moved here from T4d, after T5 (owner). pitwall's own pre-commit hook, drafted here as `T7-AC3`, went back to T4d as T4d-AC4 on 2026-11-12: it is cheap (owner).

Two-way, picked by the agent while building (2026-11-13 and 2026-11-14), the owner away by their own word; each is cheap to change:

| Area | Choice | Why, in one line |
| --- | --- | --- |
| The tree the corpus is judged on | A scratch pitwall project on an epic branch with a changed `CLAUDE.md` and `docs/IDEA.md` and a new file | The rules about work that would be lost answer as they do in the middle of a change |
| The corpus's speed | Each git question asked once, since the project never changes | The whole corpus, 103,000 different lines as three callers, in two to five minutes instead of an hour |
| One change in one PR | The bug fixes are commits of this epic, not a fix branch and a PR each | Nine PRs would each wait for the owner's hand; the corpus and the review judge them together |
| BUG-3, `git reset --merge` | Refused only while changes are staged and not committed | That is what it puts back; an unstaged change it keeps, or stops on |
| BUG-4, the assignment | A PowerShell assignment of exactly one word is read as a value and judged by no rule | The parser keeps no quotes; one word with no argument does nothing a rule refuses, and a command inside it is still read |
| BUG-6, the inline script | Passes when every string that names the plugin's folder is a `.json` or `.md` file and nothing in it writes, runs a program or loads code | The config is data; a list of acts is a mistake's guard, not a wall (R-2) |
| BUG-10, the rule `tag` | A tag named exactly like a version, `--tags` and `--mirror`, and `gh release` create, edit, delete and upload; any other tag passes, and so does `--follow-tags` | Narrow, as R-6 asked: a project's own tags are its own business |
| BUG-7 | Skill text and a check on it, no headless run of its own | Kickoff with hooks of the owner's own is one question; the next planning run reads the skill as it stands |
| BUG-2, a work tree only the run knows | A loop, a variable or xargs stands for every linked work tree: refused while any of them holds work | As paths only the run knows stand for the whole tree (R-3); a clean-up loop over clean work trees passes, as the corpus held four |
| BUG-2, the way on | The refusal says to commit or stash in that work tree, in a call of its own | A stash or commit of the work tree earlier in the same line is not followed: one more call is cheaper than reading the line in the guard's head (R-3) |
| The corpus and the plugin's folder | Each line is judged with the plugin folders it names (a headless run's copy, the installed cache, a checkout) as plugin roots | The switch rule keys on that folder: judged with one checkout's path only, a change of it could not show (review round 1) |
| The corpus's form of a line | The programs the guard's own parser reads, each named only when it is a known tool, else "other" | No word of a heredoc or a string, the owner's words, reaches what may be quoted (review round 1) |

## Out of scope

- The gate before every commit, in a project and in pitwall itself (T4d).
- BUG-9, the hooks Git LFS writes into `.githooks` (after 1.0).

## Open questions

None.
