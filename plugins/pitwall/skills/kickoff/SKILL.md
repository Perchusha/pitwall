---
name: kickoff
description: Stage 0 of pitwall. Starts a new project from a one-line idea - asks about it one question at a time, proposes a process level, lays out the project template, writes docs/IDEA.md and sets up merge protection on GitHub. Use when the owner says "kickoff", "start a new project" or "new app from this idea".
argument-hint: "[one-line idea]"
disable-model-invocation: true
---

# kickoff - stage 0

> Status: built in T1.

Turns a one-line idea into a laid-out project with a confirmed process level and protected `main`. The owner makes every call here; this skill asks, proposes, records and hands over to `discovery`.

Plugin files used: `${CLAUDE_PLUGIN_ROOT}/config/defaults.json` (process levels, merge protection, the planning branch) and the scripts in `${CLAUDE_PLUGIN_ROOT}/scripts/`: `layout.mjs`, `docs-check.mjs`, `protect.mjs`.

## Rules

- Run each command in the steps as written, from the project root, one command per call.
- One question per message, then wait for the answer. Use the question tool when it is there, plain text otherwise. Never answer for the owner.
- Never overwrite a file, never delete one, and never adopt an existing project: that is a later pitwall epic. Say so and stop.
- The skeleton commit is the only commit that goes to `main` directly. Every GitHub write after it goes through `protect.mjs`.
- When a script hands a step over, show its HANDOFF lines to the owner verbatim. Never retry a refused write another way.

## Steps

1. **Preflight.** Run `node --version`. If it fails or the major version is below `runtime.nodeMinMajor`, stop: the owner installs the Node LTS release from https://nodejs.org and runs kickoff again. Then look at the working folder, which becomes the project root:
   - it holds `CLAUDE.md` or `docs/`: stop, this is an existing project;
   - it is not a git repository: run `git init -b main`;
   - it is one with commits: the current branch must be `main`, otherwise stop and ask the owner to switch.
2. **The idea.** Start from the arguments, `$ARGUMENTS`; when they are empty, the first question asks for the idea in one line. Then ask 3 to 5 questions, one per message, each built on the answers so far, and skip any the idea already answers:
   - the problem: what is wrong today, and for whom;
   - who uses it, and how many: one person, a team, the public;
   - what it touches: money, personal data, accounts, a server or database, several services, realtime, AI;
   - what is out of scope for the first version;
   - the project name, offering the folder name as the default.
3. **The level.** Read `processLevels` in the config. Propose the lowest level whose `when` covers every answer, in one message: the level, the two or three answers that decide it, and what the level means for the later stages (`spike`, `planReview`, `staging`). The owner confirms it or picks another.
4. **Lay out.** Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/layout.mjs" --name "<name>" --idea "<the idea in one line>" --level <level>`. A refusal (exit 1) lists the files in the way: show them to the owner and stop. It writes nothing when it refuses.
5. **Write `docs/IDEA.md`.** Fill every section from the answers, in the owner's terms, and keep the headings exactly as they are:
   - Problem: one paragraph;
   - Who it is for;
   - Out of scope: what the owner ruled out;
   - Process level: why this level, against its `when` in the config. The level itself lives only in `.claude/pitwall.json`.
6. **Confirm.** Show the owner `docs/IDEA.md` and the level in one message, and say what happens on confirmation: the skeleton is committed to `main`, pushed if there is a GitHub repository, and `main` is protected. Edit until the owner confirms. This is the stage's check.
7. **Docs check.** Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/docs-check.mjs" --stage kickoff`. Fix what it reports and run it again until it passes.
8. **Commit the skeleton** on `main`: `git add -A`, then `git update-index --chmod=+x scripts/gate` (the gate must stay executable when the project is laid out on Windows), then `git commit -m "chore: kickoff from pitwall <templateVersion>"`, with `templateVersion` from `.claude/pitwall.json`.
9. **GitHub.** Run `git remote get-url origin`.
   - No remote: ask the owner one question: create the GitHub repository now, public or private, or later. Now: `gh repo create <name> --public|--private --source . --remote origin --push`. Later: skip to step 11; protection stays `pending`.
   - A remote: `git push -u origin main`.
   A failed create or push is not retried: show the error, and go on to step 11 with protection `pending`.
10. **Merge protection.** Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/protect.mjs"`. It checks first that it may, then protects `main` or records why it cannot. Its last line is `RESULT: <mode>`:
    - `branch-protection`: `main` now requires `gate` and `ai-review`, admins included;
    - `local-hook`: a private repository on GitHub Free; tell the owner that pitwall's merge hook is not shipped yet, so until it is nothing blocks a merge there except the review flow;
    - `pending` (exit 3): show the HANDOFF lines verbatim. Once the owner has run them, run `protect.mjs` again to record the result.
11. **The planning branch.** Create the branch named in `planning.branch` with `git switch -c <branch>`. If `.claude/pitwall.json` changed in step 10, commit it there: `git commit -am "chore: record merge protection"`. With a remote, `git push -u origin <branch>`.
12. **Hand over.** Tell the owner, in a few lines: the level, the protection mode (and the pending command, if any), the branch, and that the next stage is `/pitwall:discovery`.

## Output

- The project skeleton from the template, with `.claude/pitwall.json`: `templateVersion`, `processLevel`, `mergeProtection`.
- `docs/IDEA.md`: the problem, who it is for, what is out of scope, why this level.
- One commit on `main`, pushed and protected when there is a GitHub repository, and the planning branch (`planning.branch`) for stages 1 to 5.

## Check

The owner confirmed the wording of the idea and the process level, and `docs-check.mjs --stage kickoff` passes: no `.tmpl` file or placeholder is left, `.claude/pitwall.json` is valid, and every section of `docs/IDEA.md` is filled in.
