# ADR-0004: Plugin scripts run on Node.js

- Status: accepted
- Date: 2026-11-05
- Class: one-way
- Decided by: owner

## Context

T1 adds the first scripts the plugin runs on the developer's machine: the template layout for kickoff, the docs check and merge protection. T3 adds hooks, which read JSON from stdin. They all need one runtime, and pitwall never assumes the project's stack, so the runtime is a requirement of the plugin, not of the project.

## Options

| Option | Pros | Cons | Maturity | Cost | Lock-in |
| --- | --- | --- | --- | --- | --- |
| Node.js | JSON without libraries; the same language as `scripts/check.mjs`, which runs the same scripts; one behaviour on Windows, macOS and Linux | The developer needs Node on the PATH; the native Claude Code installer does not bring it | LTS releases, the runtime of most Claude Code plugins with scripts | Free | Rewriting the scripts and hooks later |
| Bash and git | Nothing to install: Claude Code already needs bash (Git Bash on Windows) | GNU and BSD tools differ, macOS ships bash 3.2, JSON without jq is fragile, worst for the T3 hooks; CI would need a macOS run | Universal | Free | Low |
| No scripts | No dependency at all | Layout and checks are not deterministic, the docs check is not a real check, a dry run is only text; contradicts L-2 | - | Free | None |

## Decision

Plugin scripts and hooks are Node.js ES modules under `plugins/pitwall/scripts/`, with no dependencies beyond Node itself. The minimum version is `runtime.nodeMinMajor` in `config/defaults.json`. Skills call them as `node "${CLAUDE_PLUGIN_ROOT}/scripts/<name>.mjs"`.

## Consequences

- Kickoff checks `node --version` before anything else and stops with an install hint. The plugin README states the requirement.
- A project's own stack and CI need no Node: `scripts/gate` stays the only contract the plugin calls in a project.
- `scripts/check.mjs` runs the shipped scripts directly, so CI tests what a project gets.
- Revisiting it after T3 means rewriting the scripts and the hooks.
