# Reviews

One file per reviewed change, written by pitwall's `code-reviewer` agent from `template.md` and committed with its verdict on the change's branch, so it merges with the change: `E<n>-<slug>.md` for an epic, the same name as its file in `epics/`, and `BUG-<n>.md` for the PR that fixes a bug. Only the reviewer writes it. A finding is closed by a commit on the change's branch or by a risk the owner accepted in `RISKS.md`, and the verdict holds only while nothing but this file changed after the commit it names as reviewed.
