# Risks

Risks the owner accepted, with their fallbacks.

| ID | Risk | Fallback | Accepted on |
| --- | --- | --- | --- |
| R-1 | The docs check of a project's plan review can still be got past by Markdown built to read one way and render another, beyond the forms it now refuses: for example a table hidden in an inline HTML span opened in the middle of a line, or a link reference definition whose label runs over two lines (T2 review, round 7), and constructs of the same kind no review reached. Only a deliberate attempt writes these (`review.findings.exotic`), so the check is not hardened against each one (ADR-0007) | The plan reviewer reads the files as written and the owner says yes to the plan before it merges; a bypass found in use becomes a BUG with a regression case in `scripts/check.mjs` | 2026-11-09 |

IDs run `R-1`, `R-2`, and so on.
