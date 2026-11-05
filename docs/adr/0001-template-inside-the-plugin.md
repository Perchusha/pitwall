# ADR-0001: The project template lives inside the plugin

- Status: accepted
- Date: 2026-11-05
- Class: two-way
- Decided by: agent, reported to the owner

## Context

A new project needs a skeleton: the docs structure, the CLAUDE.md and settings skeletons, CI and the `scripts/gate` contract. The skills find these files by path, so the skeleton and the plugin must agree on that contract.

## Options

| Option | Pros | Cons |
| --- | --- | --- |
| A separate GitHub template repository | The "Use this template" button; `gh repo create --template` | Versioned apart from the plugin, so a project can start from a skeleton that does not match the installed skills |
| The template inside the plugin, copied by `kickoff` | Always matches the installed plugin version; one repository to maintain | No template button; kickoff has to rename files that tools would otherwise load |

## Decision

The template lives in `plugins/pitwall/template/` and `/pitwall:kickoff` copies it. The skeleton and the skills ship in the same version, so they cannot drift apart.

## Consequences

- Files a tool would load inside this repository carry a `.tmpl` suffix: `CLAUDE.md.tmpl`, `.claude/settings.json.tmpl`, `gitignore.tmpl`, `editorconfig.tmpl`, `gitattributes.tmpl`. Kickoff renames them.
- GitHub template repositories also do not copy settings such as branch protection, so kickoff would have set those up in either option.
- Revisiting it is cheap: a template repository can be generated from `template/` at any time.
