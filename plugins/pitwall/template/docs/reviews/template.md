# Review: E<n> - Title of the change

- Change: E<n>-<slug> for an epic, the name of its file in `epics/`, or BUG-<n> for a bug
- Reviewed: the full sha of the commit this round reviewed
- Round: 1

## Acceptance criteria

One row per acceptance criterion of the epic, or one row for a bug, its ID: the test that covers it (its file and name) or the QA scenario that checks it. A bug is covered by its regression test, the path in a code span; only where no test can drive the behaviour, by a QA scenario in a file, its path in a code span and `no automated test: <why>` in the same cell.

| Criterion | Covered by |
| --- | --- |

## Findings

Numbered from 1, each kept with its number from round to round. A closed row starts its last cell with the commit on this branch that closes it, or with a risk `R-n` the owner accepted; an open one starts with `open:`.

| # | Finding | Severity (blocking, should fix) | Closed by (commit) or accepted risk |
| --- | --- | --- | --- |
