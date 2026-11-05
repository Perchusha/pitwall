---
name: discovery
description: Stage 1 of pitwall. Researches the problem, the analogues and the owner's constraints, and lists the technical assumptions by risk. Use after kickoff, or when the owner asks to research an idea, find analogues or check feasibility.
disable-model-invocation: true
---

# discovery - stage 1

> Status: planned for epic T1, not implemented in v0.1.0. If this skill is invoked, tell the owner that stage 1 is not built yet and stop.

## What it will do

1. Problem and user: who it is for, the job it does, 3 to 7 key scenarios, and the non-goals.
2. Analogues: 5 to 10 products and open-source projects in a table (what they do, how they make money, stack if known, what they lack). Each row links a page that was actually opened, never a search snippet. Runs in parallel `researcher` sub-agents.
3. Owner constraints: monthly budget, platforms, hosting, personal data, licence, how much time the owner has for reviews. One question at a time.
4. Feasibility: technical assumptions sorted by risk, each with a way to check it. The riskiest goes to `spike`.

## Output

`docs/DISCOVERY.md`: problem, scenarios, non-goals, analogues table, constraints, assumptions by risk.

## Check

Every analogue has a link, every assumption has a way to check it, every constraint is confirmed by the owner.
