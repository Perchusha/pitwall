# Index

One line per document: what it holds and when to read it. Every entity has an ID (ADR-0007, E3, E3-AC2, BUG-12, L-5); link by ID.

| Document | Holds | Read it when |
| --- | --- | --- |
| `IDEA.md` | The problem, who it is for, the process level | Starting any stage |
| `DISCOVERY.md` | Scenarios, non-goals, analogues, constraints, assumptions by risk | Deciding or planning |
| `SPEC.md` | What the product does and how it is built | Planning or changing behaviour |
| `STACK.md` | The stack with versions, and where models, prices and limits live | Adding a dependency or calling an API |
| `adr/` | One decision per file: context, options, decision, consequences | Touching an area a decision covers |
| `spikes/` | Prototypes of risky assumptions with measured results | Revisiting a risky choice |
| `EPICS.md` | The plan: epics in order with status | Picking the next work |
| `epics/` | One epic per file with acceptance criteria and risk class | Implementing, reviewing or testing an epic |
| `PLAN-REVIEW.md` | The plan reviewer's findings and how each was closed | Changing the plan |
| `RISKS.md` | Accepted risks and their fallbacks | Changing the plan or the stack |
| `BUGS.md` | BUG-n: where found, steps, expected, actual, status, fix PR | Selecting work, fixing a bug |
| `LESSONS.md` | L-n: rules learned from mistakes and how each is checked | Before writing or reviewing code |
| `JOURNAL.md` | One entry per epic: what shipped, numbers, cost, surprises | Reviewing progress |
| `archive/` | Closed entries moved out of the state files | Looking up history |
