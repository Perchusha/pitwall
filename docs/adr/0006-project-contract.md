# ADR-0006: Template headings and `.claude/pitwall.json` join the contract

- Status: accepted
- Date: 2026-11-05
- Class: one-way
- Decided by: owner

## Context

The plugin and a project agree on a set of paths (SPEC 9). T1 adds two things the plugin's scripts read from a project: the `##` headings of the template's documents, which the docs check requires, and the project's own settings, which scripts and the T3 hooks need in a form they can parse: the process level, the merge protection mode and the version of the template the project was laid out from.

## Options

| Option | Pros | Cons | Maturity | Cost | Lock-in |
| --- | --- | --- | --- | --- | --- |
| Headings and `.claude/pitwall.json` are contract | One file a script can parse; renaming a heading cannot silently break a check in older projects; `templateVersion` tells a migration where a project starts | A heading rename needs a major version and a migration note | Same rule as the paths | None | Low |
| Settings in `CLAUDE.md` and `docs/IDEA.md` prose, headings free to change | Nothing new to learn | Scripts would parse prose; a heading change breaks the check for every older project | - | None | None |

## Decision

- The `##` headings of the template's documents are part of the contract, like the paths. Renaming or removing one is a major version with a migration note (owner, 2026-11-05).
- `.claude/pitwall.json` holds `templateVersion`, `processLevel` and `mergeProtection` (owner, 2026-11-05). `docs/IDEA.md` explains why the level was chosen, `CLAUDE.md` points to both, and neither repeats the values.
- `templateVersion` is the plugin version kickoff laid the project out with. A migration to a new major version updates it.

## Consequences

- `scripts/docs-check.mjs` reads the required sections from the template itself, so adding a heading to a template file is a minor change and the check picks it up.
- `mergeProtection` is one of `pending`, `branch-protection` and `local-hook`. `scripts/protect.mjs` is the only writer after kickoff.
- In the template the file is `.claude/pitwall.json.tmpl` (L-1).
