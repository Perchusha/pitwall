# ADR-0003: No RAG over project docs by default

- Status: accepted
- Date: 2026-11-05
- Class: two-way
- Decided by: owner, after discussion

## Context

Agents need to find the right ADR, epic or lesson quickly. One option was to build a RAG index over every project's docs.

## Options

| Option | Pros | Cons |
| --- | --- | --- |
| RAG over `docs/` in every project | Search by meaning | A new project has tens or hundreds of kilobytes of docs that change with almost every commit; a stale index returns a revoked decision as current; another service to sync, pay for and test |
| Findable docs plus grep | One call finds a line by ID; always current | Needs discipline: IDs, an index, size limits |

## Decision

No RAG by default. Docs are findable by design: an ID on every entity, `docs/INDEX.md`, `CLAUDE.md` under 200 lines, size limits on state files and an archive for closed rows. RAG is an optional module, for two cases: a docs MCP for the stack's libraries, and a RAG over `docs/` once grep by ID stops finding things (threshold in `config/defaults.json`).

## Consequences

The template carries `docs/INDEX.md` and the ID scheme from the start, and the docs check in T1 enforces the size limits.
