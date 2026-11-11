---
name: kickoff
description: Stage 0 of pitwall. Starts a new project from a one-line idea - asks about it one question at a time, proposes a process level, lays out the project template, writes docs/IDEA.md, sets up merge protection on GitHub and asks whether low and normal risk PRs may merge without the owner. The owner runs it as /pitwall:kickoff, with the idea as the argument.
argument-hint: "[one-line idea]"
disable-model-invocation: true
---

# kickoff - stage 0

> Status: built in T1.

Turns a one-line idea into a laid-out project with a confirmed process level and protected `main`. The owner makes every call here; this skill asks, proposes, records and hands over to `discovery`.

Plugin files used: `${CLAUDE_PLUGIN_ROOT}/config/defaults.json` (`runtime`, `kickoff`, `processLevels`, `planning`) and the scripts in `${CLAUDE_PLUGIN_ROOT}/scripts/`: `layout.mjs`, `docs-check.mjs`, `protect.mjs` (and `merge-choice.mjs`, which only the owner runs).

## Rules

- Run each command in the steps as written, from the project root, one command per call.
- One question per message, then wait for the answer. Use the question tool when it is there, plain text otherwise. Never answer for the owner.
- Never overwrite a file, never delete one, and never adopt an existing project: that is a later pitwall epic. Say so and stop.
- The skeleton commit is the only commit that goes to `main` directly. Every change to GitHub settings goes through `protect.mjs`.
- When a script hands a step over, show its HANDOFF lines to the owner verbatim. Never retry a refused write another way.

## Steps

1. **Preflight**, before any question. The working folder becomes the project root.
   - Run `node --version`. If it fails or the major version is below `runtime.nodeMinMajor`, stop: the owner installs the Node LTS release from https://nodejs.org and runs kickoff again.
   - Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/layout.mjs" --check`. It looks at the folder, git and the repository the folder is in, and writes nothing. Exit 1 (a folder with files in it, a repository with commits, no git): show its message to the owner and stop; kickoff starts new projects only. Exit 0: run the command on its `NEXT:` line as written, and pass any `NOTE:` line on to the owner.
2. **The idea.** Start from the arguments, `$ARGUMENTS`; when they are empty, the first question asks for the idea in one line. Then ask `kickoff.questions` (min to max) questions, one per message, each built on the answers so far, and skip any the idea already answers:
   - the problem: what is wrong today, and for whom;
   - who uses it, and how many: one person, a team, the public;
   - what it touches: money, personal data, accounts, a server or database, several services, realtime, AI;
   - what is out of scope for the first version;
   - the project name, offering the folder name as the default.
3. **The level.** Read `processLevels` in the config. Propose the lowest level whose `when` covers every answer, in one message: the level, the two or three answers that decide it, and what the level means for the later stages (`spike`, `planReview`, `staging`). The owner confirms it or picks another.
4. **Lay out.** Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/layout.mjs" --name '<name>' --idea '<the idea in one line>' --level <level>`, with the values in single quotes (rephrase a name or an idea that holds a single quote). Any exit other than 0 wrote nothing: show its message to the owner and stop.
5. **Write `docs/IDEA.md`.** Fill every section from the answers, in the owner's terms, and keep the headings exactly as they are:
   - Problem: one paragraph;
   - Who it is for;
   - Out of scope: what the owner ruled out;
   - Process level: why this level, against its `when` in the config. The level itself lives only in `.claude/pitwall.json`.
6. **Confirm.** Show the owner `docs/IDEA.md` and the level in one message, and say what happens on confirmation: the skeleton is committed to `main`, pushed if there is a GitHub repository, and `main` gets merge protection. Edit until the owner confirms. This is the stage's check.
7. **Docs check.** Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/docs-check.mjs" --stage kickoff`. Fix what it reports and run it again until it passes.
8. **Commit the skeleton** on `main`: `git add -A`, then `git update-index --chmod=+x scripts/gate` (the gate must stay executable when the project is laid out on Windows), then `git commit -m "chore: kickoff from pitwall <templateVersion>"`, with `templateVersion` from `.claude/pitwall.json`. If git refuses because it has no user name or email, show its message and wait for the owner to set them.
9. **GitHub**, still on `main`. Run `git remote get-url origin`.
   - No remote: ask the owner one question: create the GitHub repository now, public or private, or later. Now: `gh repo create <repository> --public` or `--private`, followed by `--source . --remote origin --push`, where `<repository>` is the project name in lower case with every character other than `a-z`, `0-9`, `-`, `.` and `_` turned into `-`. Later: go on to step 10 anyway.
   - A remote: `git push -u origin main`.
   A failed create or push is not retried: show the error and go on to step 10.
10. **Merge protection.** Always run `node "${CLAUDE_PLUGIN_ROOT}/scripts/protect.mjs"`, even when there is no repository yet: it checks first that it may, then protects `main`, records why it cannot, or says what to do. Its last line is `RESULT: <mode>`. Relay what it printed in a few lines, without restating the rules it applies:
    - `branch-protection`: done;
    - `local-hook`: tell the owner, as it says, that only pitwall's hook and the review flow guard `main`: a merge from the GitHub web page is not blocked;
    - `pending` (exit 3): show the HANDOFF block verbatim; the commands under "Run this yourself" are for the owner, and the one under "Then run this to record the result" records it once they are done.
11. **Merges without the owner** (ADR-0010). Ask one question: once `gate` and `ai-review` are green, may low and normal risk epics merge without the owner? High risk always waits for them; bug fixes have a choice of their own, which `/pitwall:continue` asks when the first fix of low or normal class is ready to merge; and the answer can change later. Do not recommend either answer: it is the owner's. On no, nothing changes: `.claude/pitwall.json` already says `autoMerge: false`. On yes, hand the owner the command to run themselves in a terminal, which pitwall's guard keeps from every agent: `node "${CLAUDE_PLUGIN_ROOT}/scripts/merge-choice.mjs" --allow`, from the project folder (not through `!` in Claude Code: the script refuses to run inside it). It records the yes and the two narrow allow rules, and the next stage commits it.
12. **The planning branch.** Create the branch named in `planning.branch` with `git switch -c <branch>`. If `.claude/pitwall.json` changed in step 10, commit it there: `git commit -am "chore: record merge protection"`. With a remote, `git push -u origin <branch>`.
13. **Hand over.** Tell the owner, in a few lines: the level, the protection mode (and the pending command, if any), the answer on merges without them (and the command, if they said yes), the branch, and that the next stage is `/pitwall:discovery`.

## Output

- The project skeleton from the template, with `.claude/pitwall.json`: `templateVersion`, `processLevel`, `mergeProtection`, `autoMerge`.
- `docs/IDEA.md`: the problem, who it is for, what is out of scope, why this level.
- One commit on `main`, pushed and protected when there is a GitHub repository, and the planning branch (`planning.branch`) for stages 1 to 5.

## Check

The owner confirmed the wording of the idea and the process level, and `docs-check.mjs --stage kickoff` passes: no `.tmpl` file or placeholder is left, `.claude/pitwall.json` is valid, and every section of `docs/IDEA.md` is filled in.
