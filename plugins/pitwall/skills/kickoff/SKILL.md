---
name: kickoff
description: Start a new project with pitwall. Takes the idea, picks the process level (lite, standard or full), lays out the project template and sets up merge protection. Use when the owner says "kickoff", "start a new project" or "new app from this idea".
argument-hint: "[one-line idea]"
disable-model-invocation: true
---

# kickoff - stage 0

> Status: planned for epic T1, not implemented in v0.1.0. If this skill is invoked, tell the owner that stage 0 is not built yet and stop.

## What it will do

1. Ask 3 to 5 questions, one at a time, to understand the idea: the problem, who it is for, what is out of scope.
2. Propose a process level (lite, standard, full) with the reason, using the criteria in `config/defaults.json`. The owner confirms it.
3. Copy `template/` from this plugin into the project root, fill the placeholders and drop the `.tmpl` suffixes.
4. Set up merge protection by repository visibility:
   - public repository: branch protection on `main` with the required checks `gate` and `ai-review`;
   - private repository on GitHub Free: a local hook that refuses `gh pr merge` until both checks are green.
5. Write `docs/IDEA.md` and hand over to `discovery`.

## Output

- The project skeleton from `template/`.
- `docs/IDEA.md`: the problem in one paragraph, who it is for, the process level and why.

## Check

The owner confirms the wording of the idea and the process level.
