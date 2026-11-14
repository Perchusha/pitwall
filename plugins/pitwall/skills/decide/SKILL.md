---
name: decide
description: Stage 2 of pitwall. Walks every architecture and stack area, asks the owner about each one-way decision with a comparison of options, accepts the two-way decisions as one list, and records each one-way decision as an ADR and the result in docs/STACK.md. /pitwall:continue runs it after discovery; the owner can also run it as /pitwall:decide, or as /pitwall:decide <area> to revisit one area after a spike or a plan review.
argument-hint: "[area to revisit]"
disable-model-invocation: true
---

# decide - stage 2

> Status: built in T1.

Turns the idea and the discovery into recorded decisions: one ADR per one-way decision, a two-way list the owner accepts as a whole, and `docs/STACK.md` with versions read from the registries. The owner decides every one-way question; the agent researches, compares and recommends.

Plugin files used: `${CLAUDE_PLUGIN_ROOT}/config/defaults.json` (`decide`, `processLevels`, `maturity`, `registries`, `planning.branch`, `budgets.researcherToolCalls`) and `${CLAUDE_PLUGIN_ROOT}/scripts/docs-check.mjs`.

With an area as the argument (the arguments, on the line below, name one of `decide.areas`), follow "Revisit one area" below instead of the steps.

Arguments, as the owner gave them (nothing after the colon means none): $ARGUMENTS

## Rules

- Run each command in the steps as written, from the project root, one command per call.
- A commit that holds more than Markdown under `docs/` (`CLAUDE.md` here) runs the gate before every commit, still the template's stub. When it refuses, the stub found a file it counts as code: show the owner the files it names and wait until they move or remove them; never commit past it.
- One one-way question per message, then wait. Never record a one-way decision the owner did not give.
- Versions, prices, limits and model IDs come from a page opened at decision time, never from memory. A version is read from the registry's API or package page.
- "New but proven": a stable release (`maturity.stableReleaseOnly`), a release within `maturity.maxMonthsSinceLastRelease` months, a migration path and compatibility with the rest of the stack. An option that fails it is named in the comparison with the reason, not recommended.
- An area always ends in an ADR or a two-way line. A two-way decision the agent doubts, or the owner questions, becomes one-way.
- Write the ADRs in plain Markdown the docs check reads as GitHub shows it: fields written "- Name:" once each, headings and table rows at the first column, a blank line after every table, fences at the first column and never inside a list item; no HTML or comments, no setext headings, no invisible characters.

## Steps

1. **Preflight.** Read `.claude/pitwall.json`; without it, stop: run `/pitwall:kickoff` first. Switch to the planning branch (`planning.branch`). If `mergeProtection` is `pending`, tell the owner once and offer to run `node "${CLAUDE_PLUGIN_ROOT}/scripts/protect.mjs"`. Read `docs/IDEA.md`, `docs/DISCOVERY.md` (constraints and assumptions above all) and the existing `docs/adr/`. Without a filled `docs/DISCOVERY.md`, stop: run `/pitwall:discovery` first.
2. **Sort the areas.** Read `processLevel` from `.claude/pitwall.json` and that level's `decisions` in the config: `askOwner` says how many one-way areas the owner is asked one at a time (`min` to `max` of the ones that matter most, or `all`), and `restMayBeTwoWay` whether the other one-way areas may go into the two-way list instead. Go through `decide.areas` in order, even where the answer looks obvious. An area in `decide.oneWay` is one-way. An area that does not apply to this project (no database for a single local file, no auth for one local user) becomes a two-way line `Not needed` (the value of `decide.notNeeded`) with the reason. Everything else is two-way unless the agent doubts it.
3. **Research the one-way areas.** For the areas with real options, dispatch `researcher` agents in one message so they run in parallel, one per area or a few related areas each. Brief each with the area, the owner's constraints from `docs/DISCOVERY.md`, the maturity rule above, the registry APIs in `registries`, the header row of the Options table in `docs/adr/0000-template.md`, copied as it is, and the call budget for the process level from `budgets.researcherToolCalls` (warn and stop).
4. **Ask each one-way decision**, one per message, in this format:
   - the context in two sentences;
   - the options table, with the columns of the Options table in `docs/adr/0000-template.md`: `decide.options` (min to max) options, every cell filled (`unknown` when it is not known) and a source link each;
   - the recommendation and why;
   - what changes if another option is picked;
   - when and at what cost the decision can be revisited.
   Wait for the answer. Then write the ADR at once, so the state lives in the repository: the next free number in `docs/adr/`, from `docs/adr/0000-template.md`, with `Class: one-way`, `Decided by: owner`, today's date, and the options as compared. When the decision settles an assumption of `docs/DISCOVERY.md`, name its `A-n` in the Decision section: that is where the plan check looks for it.
5. **The two-way list.** Pick each remaining area with a one-line reason and show them all as one table: Area, Choice, Why. The owner accepts the list or names items to change; an item the owner questions goes back to step 4 as one-way.
6. **Versions.** For every choice with a version (runtime, framework, libraries, tools), read the current stable version and its release date from its registry: `registries` gives the URL and the fields that hold them (for npm, check that the name matches), and for an ecosystem not listed, the registry's package page. Keep the link and today's date for the Source column.
7. **Models, prices and limits.** If the project calls AI models or paid APIs, the "Models, prices and limits" section of `docs/STACK.md` names the one config file that will hold them (E0 creates it) and lists the model IDs, prices and limits found, each with its source page and the date. Otherwise the section says that the project calls none.
8. **Write `docs/STACK.md`.** The Decisions table has a row per choice that has an ADR or a version (ADR column: `ADR-NNNN`, or `-` for a two-way choice); the Two-way table has every two-way choice with its reason, `Not needed` lines included. Use the area names of `decide.areas` exactly.
9. **Architecture boundaries.** Fill the "Architecture boundaries" section of `CLAUDE.md` from the folder-structure and module-boundary decisions: each boundary names the tool that will enforce it.
10. **Docs check.** Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/docs-check.mjs" --stage decide`. Fix what it reports and run it again until it passes.
11. **Commit** on the planning branch: `git add docs/ CLAUDE.md .claude/pitwall.json` (the last only changes if `protect.mjs` recorded a mode) and `git commit -m "docs: decisions and stack"`. With a remote, `git push -u origin <branch>`.
12. **Hand over.** Tell the owner how many ADRs were written, which assumption is the spike candidate, and the next stage: a spike on it when the process level asks for one, or when they want one, else the plan; `/pitwall:continue`, or just "continue", runs it. When `/pitwall:continue` runs this stage, it asks which way to move on.

## Revisit one area

When a spike was not confirmed, or a plan review shows that a decision does not hold, one area is decided again; the old ADR stays as the record of what was decided and why.

1. **Preflight** as in step 1. Read the ADR that `docs/STACK.md` cites for the area, and every spike in `docs/spikes/` whose `Follow-up:` names `/pitwall:decide <area>` or whose assumption the decision rests on.
2. **Research and ask** as in steps 3 and 4, for this area only, with the spike's measured result and the old ADR's options as context. The old choice is one of the options, with what the spike measured.
3. **Record.** Write the new ADR (the next free number, `Class: one-way`, `Decided by: owner`, today's date) and, when the area had an ADR, set the old one's Status to `superseded by ADR-NNNN`; an area that was a two-way line has nothing to supersede. In the new ADR's Context, link each spike from step 1 by its path, `../spikes/<topic>.md`: the plan check takes that link as the sign that this is the decision the spike led to. Update the area's rows in `docs/STACK.md` (versions as in step 6), and set the `Follow-up:` of each spike from step 1 to the new ADR.
4. **Check and commit.** Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/docs-check.mjs" --stage decide` until it passes, then `git add docs/ CLAUDE.md` and `git commit -m "docs: revisit <area>"`. With a remote, `git push -u origin <planning branch>`.
5. **Hand over.** Tell the owner the new decision, and that the next stage is the plan, which resumes where it stopped: `/pitwall:continue`, or just "continue".

## Output

- `docs/adr/NNNN-<slug>.md` for each one-way decision: context, the options compared, the decision, the consequences.
- `docs/STACK.md`: the decisions with versions and registry links, the config for models, prices and limits, and the two-way list.
- The "Architecture boundaries" section of `CLAUDE.md`.

## Check

`docs-check.mjs --stage decide` passes: every area of `decide.areas` is in a table, every one-way area has an ADR or a `Not needed` line (or, where the level allows it, a two-way line, while one-way areas still cite at least `decisions.askOwner.min` owner ADRs), every one-way ADR was decided by the owner and compares `decide.options` options in the template's columns, and every version has a registry link with a date.
