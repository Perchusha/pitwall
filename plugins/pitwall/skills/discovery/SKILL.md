---
name: discovery
description: Stage 1 of pitwall. Researches the problem, the analogues and the owner's constraints, and lists the technical assumptions by risk in docs/DISCOVERY.md. /pitwall:continue runs it after kickoff; the owner can also run it as /pitwall:discovery.
disable-model-invocation: true
---

# discovery - stage 1

> Status: built in T1.

Turns the confirmed idea into `docs/DISCOVERY.md`: who it is for and what they do with it, what already exists, what the owner will and will not accept, and which technical assumptions could sink the project. Research runs in parallel `researcher` agents; constraints come from the owner, one at a time.

Plugin files used: `${CLAUDE_PLUGIN_ROOT}/config/defaults.json` (`discovery`, `planning.branch`, `budgets.researcherToolCalls`) and `${CLAUDE_PLUGIN_ROOT}/scripts/docs-check.mjs`.

## Rules

- Run each command in the steps as written, from the project root, one command per call.
- One question per message, then wait. Never answer for the owner, and never fill a constraint from a guess. What you only inferred from the owner's words or `docs/IDEA.md` is not a question each: such facts go to the owner as one numbered list, to confirm as a whole or correct by number; only what nothing answers, or what leaves a real choice, is a question of its own.
- A fact in the document comes from a page that was opened or from the owner. A search snippet is not a source.
- Keep the template's headings and table columns exactly as they are: the docs check reads them.
- Write plain Markdown the docs check reads as GitHub shows it: headings and table rows at the first column, a blank line after every table, one table in each section that has one; no HTML or comments, no block quotes, no setext headings, no invisible characters. The ID, risk and date cells hold plain text: no links, HTML tags, strikethrough, character references or backslash escapes (a "<" before a number, one "~" in a path and a "\" in a Windows path are fine).

## Steps

1. **Preflight.** Read `.claude/pitwall.json`; without it, stop: run `/pitwall:kickoff` first. Switch to the planning branch (`planning.branch`), creating it from `main` if it does not exist. If `mergeProtection` is `pending`, tell the owner once and offer to run `node "${CLAUDE_PLUGIN_ROOT}/scripts/protect.mjs"` now. Read `docs/IDEA.md`: it is the starting point for every section.
2. **Problem and user.** Write who it is for, the job it does for them and what they use today. Ask the owner only what `docs/IDEA.md` leaves open, one question at a time.
3. **Scenarios and non-goals.** Draft `discovery.scenarios` (min to max) key scenarios, one list item each, written so QA can walk them later, and the non-goals, starting from the out-of-scope list in `docs/IDEA.md`. Show both lists in one message; the owner accepts or edits them.
4. **Analogues.** Dispatch `discovery.researchers` (min to max) `researcher` agents in one message so they run in parallel, each on its own slice: commercial products; open-source projects; and, with a third agent, what people use instead today (scripts, spreadsheets, built-in OS features). Brief each with the idea, the user, the scenarios, its slice, how many rows to bring (about half of `discovery.analogues.max`) and the header row of the Analogues table in `docs/DISCOVERY.md`, copied as it is. Merge the results: drop duplicates and any row without a link to an opened page, and keep `discovery.analogues` (min to max) rows. A researcher's NEEDS_OWNER line becomes a question to the owner.
5. **Owner constraints.** Go through the items of `discovery.constraints`, in that order. Every item whose answer `docs/IDEA.md` and the owner's answers so far already imply goes into one message, as a numbered list: the item, the answer you propose and where it comes from. The owner confirms the list as a whole or corrects items by number; a proposal is never the answer until they have. Then ask each item that nothing answers, or that leaves a real choice, on its own, one per message, with its options. Record each answer with today's date in the "Confirmed on" column.
6. **Assumptions by risk.** List the technical assumptions the idea depends on: the things that must hold for it to work at all. Give each an ID `A-n`, a risk (one of `discovery.riskOrder`) and a concrete way to check it: a spike with a measurable result, a documentation page, a quick prototype. Sort them highest risk first and number them in that order. Show the table to the owner in one message; they accept or edit it. Name the riskiest one as the candidate for `spike` (stage 3).
7. **Write `docs/DISCOVERY.md`.** Fill every section of the template.
8. **Docs check.** Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/docs-check.mjs" --stage discovery`. Fix what it reports and run it again until it passes.
9. **Commit** on the planning branch: `git add docs/DISCOVERY.md .claude/pitwall.json` (the second only changes if `protect.mjs` recorded a mode) and `git commit -m "docs: discovery"`. With a remote, `git push -u origin <branch>`.
10. **Hand over.** Tell the owner the riskiest assumption and that the next stage is decide: `/pitwall:continue`, or just "continue", runs it. When `/pitwall:continue` runs this stage, it asks whether to move on.

## Researcher brief

Each brief holds, in this order: the slice; the idea and the user in two sentences; the scenarios; the header row of the Analogues table, copied from `docs/DISCOVERY.md`; how many rows; the call budget for the process level from `budgets.researcherToolCalls` (warn and stop); and the reminder that every row links a page the agent opened, and that unknown cells say `unknown`.

## Output

`docs/DISCOVERY.md`: the problem and user, scenarios, non-goals, the analogues table, the owner's constraints with confirmation dates, and the assumptions A-n by risk.

## Check

`docs-check.mjs --stage discovery` passes: every analogue has a link, every assumption has a way to check it and the list is sorted by risk, every constraint in `discovery.constraints` has an answer and the date the owner confirmed it, and the scenario count is within `discovery.scenarios`.
