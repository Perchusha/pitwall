---
name: spike
description: Stage 3 of pitwall. Proves the riskiest technical assumption with a throwaway prototype against a success criterion committed before the work, and records the measured result in docs/spikes/<topic>.md. The owner runs it as /pitwall:spike after decide, optionally naming an assumption such as A-2.
argument-hint: "[assumption A-n or topic]"
disable-model-invocation: true
---

# spike - stage 3

> Status: built in T2.

Turns one risky assumption from `docs/DISCOVERY.md` into a number measured against a criterion that was committed before any prototype code. The criterion is never adjusted to the result. The prototype is throwaway: it lives on its own branch and never reaches the planning branch or `main`.

Plugin files used: `${CLAUDE_PLUGIN_ROOT}/config/defaults.json` (`processLevels`, `spike`, `planning.branch`, `budgets.subagentToolCalls`) and `${CLAUDE_PLUGIN_ROOT}/scripts/docs-check.mjs`.

## Rules

- Run each command in the steps as written, from the project root, one command per call.
- One question per message, then wait. The owner confirms the criterion before it is committed.
- Never edit the Criterion section after its commit, and never measure against anything else. A result that misses the criterion is "not confirmed", whatever the reason.
- Prototype code goes only on the spike branch. The planning branch holds the spike file and nothing else from this stage.
- Keep the prototype small: the least code that measures the metric, within `budgets.subagentToolCalls.stop` tool calls from the first prototype commit. Near the budget, stop building and measure what there is.

## Steps

1. **Preflight.** Read `.claude/pitwall.json`; without it, stop: run `/pitwall:kickoff` first. Run `git status --porcelain`; if it prints anything, stop and ask the owner to commit or drop those changes, before any branch is switched. Switch to the planning branch (`planning.branch`). Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/docs-check.mjs" --stage decide`; if it fails, stop: finish `/pitwall:decide` first. Read `docs/DISCOVERY.md` (the assumptions), `docs/STACK.md`, `docs/adr/` and the files in `docs/spikes/`.
2. **The assumption.** `$ARGUMENTS` may name an assumption (`A-n`) or a topic. Otherwise take the riskiest assumption that no concluded spike in `docs/spikes/` has tested. Tell the owner which one and why, in one message. When the level's `spikeRequired` is false (see `processLevels`), say that the spike is optional at this level and ask whether to run it; on no, stop and hand over to `/pitwall:plan`.
3. **Hypothesis and criterion.** Draft them from the assumption and its "How to check it": the hypothesis in one or two sentences; for each metric, how it is measured and the number that counts as success. Prefer a measurement a command can make on this machine; when a person has to look (a notification over a full-screen app, a sound, a device), say that the owner will measure it by hand and how. Show both in one message. The owner confirms or edits; nothing is committed before that.
4. **Write the spike file.** Pick a topic: two or three lower-case words joined by hyphens. Copy `docs/spikes/template.md` to `docs/spikes/<topic>.md` and fill the title, the fields (`Assumption: A-n`, `Branch: spike/<topic>`, today's `Date`, `Outcome: pending`, `Prototype: -`, `Follow-up: -`), the Hypothesis and the Criterion table. Leave the Result table with its header only, and the Conclusion as `Pending.`
5. **Commit the criterion** on the planning branch: `git add docs/spikes/<topic>.md`, then `git commit -m "docs: spike <topic> criterion"`. With a remote, `git push -u origin <planning branch>`.
6. **The prototype.** `git switch -c spike/<topic>`, so the branch starts from the criterion commit. Build the prototype and commit it there in small commits, with everything it needs to run again: code, a script that runs the measurement, its output. Run the measurement as the criterion says, or give the owner the steps to measure by hand in one message and wait for the numbers. Commit the output, so `git status --porcelain` prints nothing. With a remote, `git push -u origin spike/<topic>`: the check in step 9 needs the branch on the remote.
7. **Back to the plan.** `git switch <planning branch>`. In `docs/spikes/<topic>.md`: a Result row per measurement (the metric, the measured number, who measured it: `command: <the command>` or `owner`, today's date); `Prototype:` the commit `git rev-parse spike/<topic>` prints; `Outcome:` `confirmed` when every measured number meets its "Success when", otherwise `not confirmed`; the Conclusion in a few sentences, against the criterion.
8. **Not confirmed.** Tell the owner the numbers against the criterion, and ask one question: revisit the decision the assumption rests on, or accept the risk.
   - Revisit: set `Follow-up: pending, /pitwall:decide <area>`, with the area from `decide.areas` that the decision belongs to. `decide` writes the new ADR and records it here.
   - Accept: add a row to `docs/RISKS.md` (the next `R-n`, the risk, the owner's fallback, today's date in "Accepted on") and set `Follow-up: R-n`.
9. **Docs check.** Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/docs-check.mjs" --stage spike`. It reads git: the criterion has not changed since its commit, that commit held no result, the prototype commit comes after it and is not reachable from the planning branch, and with a remote the spike branch is pushed. Fix what it reports and run it again until it passes. Never fix a criterion report by editing history or the criterion.
10. **Commit** on the planning branch: `git add docs/`, then `git commit -m "docs: spike <topic> result"`. With a remote, `git push -u origin <planning branch>`.
11. **Hand over.** Tell the owner, in a few lines, the outcome and its numbers, and the next stage: `/pitwall:decide <area>` when the follow-up is a revisit; another `/pitwall:spike` when the level asks for one (`spikeRequired`) or another high-risk assumption needs one; otherwise `/pitwall:plan`.

## Output

- `docs/spikes/<topic>.md` on the planning branch: the hypothesis, the criterion committed before any code, the measured result, the conclusion and its follow-up.
- The branch `spike/<topic>` with the prototype and its measurements, pushed when there is a remote, never merged.

## Check

`docs-check.mjs --stage spike` passes: the criterion is unchanged since the commit that added it, that commit held no result, every criterion and result row has a number, the prototype commit comes after the criterion and is not reachable from the planning branch or `main`, and a spike that is not confirmed names its follow-up.
