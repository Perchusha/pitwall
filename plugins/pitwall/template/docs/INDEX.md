# Index

One line per document: what it holds and when to read it. Every entity has an ID (`ADR-0007`, `E3`, `E3-AC2`, `BUG-12`, `L-5`, `A-2` for an assumption, `R-4` for a risk); link by ID. An ID inside a code span is an example, and pitwall's docs check resolves every other one. The process level and the merge protection mode are in `../.claude/pitwall.json`.

| Document | Holds | Read it when |
| --- | --- | --- |
| `IDEA.md` | The problem, who it is for, the process level | Starting any stage |
| `DISCOVERY.md` | Scenarios, non-goals, analogues, constraints, A-n assumptions by risk | Deciding or planning |
| `SPEC.md` | What the product does, how it is built and where it ships | Planning or changing behaviour |
| `STACK.md` | The stack with versions, and where models, prices and limits live | Adding a dependency or calling an API |
| `adr/` | One decision per file: context, options, decision, consequences | Touching an area a decision covers |
| `spikes/` | Prototypes of risky assumptions with measured results, one file each from `template.md` | Revisiting a risky choice |
| `EPICS.md` | The plan: epics in order with status | Picking the next work |
| `epics/` | One epic per file with acceptance criteria and risk class | Implementing, reviewing or testing an epic |
| `reviews/` | One code review per epic or bug fix: what covers each criterion, the findings and what closed them; one QA review per release | Reviewing a change, fixing a finding |
| `PLAN-REVIEW.md` | The plan reviewer's pre-mortem, checklists, sizing and findings, and how each was closed | Changing the plan |
| `RISKS.md` | R-n: accepted risks and their fallbacks | Changing the plan or the stack |
| `BUGS.md` | BUG-n: title, where found, steps, expected, actual, severity, risk class, status, fix PR | Selecting work, fixing a bug |
| `LESSONS.md` | L-n: rules learned from mistakes and how each is checked | Before writing or reviewing code |
| `JOURNAL.md` | One entry per epic: what shipped, numbers, cost, surprises | Reviewing progress |
| `../CHANGELOG.md` | One section per released version, written by the release from the merge commits on main | Releasing, or looking up what a version holds |
| `archive/` | Closed entries moved out of the state files | Looking up history |
