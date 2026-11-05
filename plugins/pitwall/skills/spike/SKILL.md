---
name: spike
description: Stage 3 of pitwall. Proves the riskiest technical assumption with a throwaway prototype against a success criterion written before the work. Use when an assumption is "not sure it will work", for example P2P, realtime, a third-party API, AI quality or performance.
disable-model-invocation: true
---

# spike - stage 3

> Status: planned for epic T2, not implemented in v0.1.0. If this skill is invoked, tell the owner that stage 3 is not built yet and stop.

## What it will do

1. Write the hypothesis and the success criterion first: what is measured and which number counts as success.
2. Build a throwaway prototype on branch `spike/<topic>`, within a budget of one epic.
3. Measure and compare with the criterion. The criterion is never adjusted to the result.
4. Not confirmed: back to `decide` with a new ADR.

## Output

`docs/spikes/<topic>.md`: hypothesis, criterion, result with numbers, conclusion. Spike code never reaches `main`.

## Check

The number was measured and compared with the criterion written in advance.
