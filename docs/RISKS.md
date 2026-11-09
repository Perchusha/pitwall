# Risks

Risks the owner accepted, with their fallbacks.

| ID | Risk | Fallback | Accepted on |
| --- | --- | --- | --- |
| R-1 | The docs check of a project's plan review can still be got past by Markdown built to read one way and render another, beyond the forms it now refuses: for example a table hidden in an inline HTML span opened in the middle of a line, or a link reference definition whose label runs over two lines (T2 review, round 7), and constructs of the same kind no review reached. Only a deliberate attempt writes these (`review.findings.exotic`), so the check is not hardened against each one (ADR-0007) | The plan reviewer reads the files as written and the owner says yes to the plan before it merges; a bypass found in use becomes a BUG with a regression case in `scripts/check.mjs` | 2026-11-09 |
| R-2 | The hooks' guards read shell commands well enough for what an honest agent runs by mistake, and a command built to hide what it does gets past them: a path or a command assembled in a variable or decoded at run time, a script written to a file and run later, a tool reached through a program the guard does not know (T3a). Only a deliberate attempt writes these (`review.findings.exotic`), so the guards are not hardened against each one (`review.threatModel`) | Branch protection with admins included holds `main` and the required checks on GitHub (ADR-0005); `ai-review` belongs to one commit, so a change after the review needs a new one (ADR-0007); the reviewer reads the diff and the owner merges high risk; a bypass found in use becomes a BUG with a regression case in `scripts/check.mjs` | 2026-11-09 |

IDs run `R-1`, `R-2`, and so on.
