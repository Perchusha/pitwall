# T1 - Stages 0 to 2

Goal: a new project goes from a one-line idea to recorded decisions: kickoff, discovery and decide work, with the researcher agent.
Depends on: T0
Risk class: normal

## Acceptance criteria (draft, refined when T1 starts)

- [ ] T1-AC1: `/pitwall:kickoff` in an empty repository asks about the idea one question at a time, proposes a process level with its reason, lays out the template with placeholders filled and `.tmpl` suffixes dropped, and writes `docs/IDEA.md`.
- [ ] T1-AC2: kickoff sets up merge protection by visibility: branch protection with `gate` and `ai-review` on a public repository, the local merge hook on a private repository on GitHub Free.
- [ ] T1-AC3: `/pitwall:discovery` writes `docs/DISCOVERY.md` with linked analogues from parallel researchers and constraints confirmed one at a time.
- [ ] T1-AC4: `/pitwall:decide` walks every area, asks one-way decisions one at a time with a comparison, writes one ADR per decision and `docs/STACK.md` with registry-checked versions.
- [ ] T1-AC5: A docs check reports a missing section, a broken ID link or a state file over its size limit.
- [ ] T1-AC6: The template settings (`extraKnownMarketplaces`, `enabledPlugins`) are confirmed to offer the plugin when a teammate opens a kicked-off project.
