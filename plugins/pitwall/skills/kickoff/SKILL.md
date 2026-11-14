---
name: kickoff
description: Stage 0 of pitwall. Starts a new project from a one-line idea - asks about it one question at a time, proposes a process level, lays out the project template, writes docs/IDEA.md, sets up merge protection on GitHub and asks whether low and normal risk PRs may merge without the owner. /pitwall:continue runs it in a new empty folder; the owner can also run it as /pitwall:kickoff, with the idea as the argument.
argument-hint: "[one-line idea]"
disable-model-invocation: true
---

# kickoff - stage 0

> Status: built in T1.

Turns a one-line idea into a laid-out project with a confirmed process level and protected `main`. The owner makes every call here; this skill asks, proposes, records and hands over to `discovery`.

Plugin files used: `${CLAUDE_PLUGIN_ROOT}/config/defaults.json` (`runtime`, `kickoff`, `processLevels`, `planning`) and the scripts in `${CLAUDE_PLUGIN_ROOT}/scripts/`: `layout.mjs`, `docs-check.mjs`, `protect.mjs`, and `merge-choice.mjs`, which runs only through Claude Code's permission prompt.

## Rules

- Run each command in the steps as written, from the project root, one command per call.
- One question per message, then wait for the answer. Use the question tool when it is there, plain text otherwise. Never answer for the owner.
- The question tool refuses a question with a single option: a proposal to confirm is asked in plain text, and options are offered only where they really differ. What you only inferred from the idea or an earlier answer is not a question each: such facts go to the owner as one numbered list, to confirm as a whole or correct by number.
- Never overwrite a file, never delete one, and never adopt an existing project: that is `/pitwall:adopt`, which `/pitwall:continue` runs in a folder that already holds a project. Say so and stop.
- The skeleton commit is the only commit that goes to `main` directly. Every change to GitHub settings goes through `protect.mjs`.
- When a script hands a step over, show its HANDOFF lines to the owner verbatim. Never retry a refused write another way.

## Steps

1. **Preflight**, before any question. The working folder becomes the project root. When `.claude/pitwall.json` is already there, an earlier run of this skill laid the project out and stopped before its end: do not run the layout check, which refuses a folder that holds files, and do not lay out again. Resume at the first step whose result is missing. Step 5 when `docs/IDEA.md` is not filled in, asking the owner again what its sections need and neither `CLAUDE.md` nor `.claude/pitwall.json` holds. Step 6, the owner's confirmation, when it is filled in and no commit holds the skeleton (`git cat-file -e HEAD:.claude/pitwall.json` fails). With the skeleton committed and no planning branch yet, neither here nor on origin (`git rev-parse --verify -q refs/remotes/origin/<branch>`): step 9, which asks about the repository when there is no remote and pushes `main` when origin lacks it; step 10, since `protect.mjs` changes nothing that is done; step 11 once more unless `autoMerge` is already true, since nothing records that the question was asked; then step 12. With the planning branch there, in this clone or on origin, or the plan merged into `main`, kickoff is over: say that `/pitwall:continue` goes on from here, and stop.
   - Run `node --version`. If it fails or the major version is below `runtime.nodeMinMajor`, stop: the owner installs the Node LTS release from https://nodejs.org and runs kickoff again.
   - Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/layout.mjs" --check`. It looks at the folder, git and the repository the folder is in, and writes nothing. Exit 1 (a folder with files in it, a repository with commits, no git): show its message to the owner and stop; kickoff starts new projects only. Exit 0: run the command on its `NEXT:` line as written, and pass any `NOTE:` line on to the owner.
2. **The idea.** Start from this skill's arguments, on the line below; when there are none, the first question asks for the idea in one line.

   Arguments, as the owner gave them (nothing after the colon means none): $ARGUMENTS

   Then ask `kickoff.questions` (min to max) questions, one per message, each built on the answers so far, and skip any the idea already answers:
   - the problem: what is wrong today, and for whom;
   - who uses it, and how many: one person, a team, the public;
   - what it touches: money, personal data, accounts, a server or database, several services, realtime, AI;
   - what is out of scope for the first version;
   - the project name: in plain text, with the folder name as the proposal to confirm or replace, or through the question tool with two real names to pick from, the folder's and one from the idea; never the question tool with the folder name as its only option.
3. **The level.** Read `processLevels` in the config. Propose the lowest level whose `when` covers every answer, in one message: the level, the two or three answers that decide it, and what the level means for the later stages (`spike`, `planReview`, `staging`). The owner confirms it or picks another.
4. **Lay out.** Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/layout.mjs" --name '<name>' --idea '<the idea in one line>' --level <level>`, with the values in single quotes (rephrase a name or an idea that holds a single quote). Any exit other than 0 wrote nothing: show its message to the owner and stop.
5. **Write `docs/IDEA.md`.** Fill every section from the answers, in the owner's terms, and keep the headings exactly as they are:
   - Problem: one paragraph;
   - Who it is for;
   - Out of scope: what the owner ruled out;
   - Process level: why this level, against its `when` in the config. The level itself lives only in `.claude/pitwall.json`.
6. **Confirm.** Show the owner `docs/IDEA.md` and the level in one message, and say what happens on confirmation: the skeleton is committed to `main`, pushed if there is a GitHub repository, and `main` gets merge protection. Edit until the owner confirms. This is the stage's check.
7. **Docs check.** Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/docs-check.mjs" --stage kickoff`. Fix what it reports and run it again until it passes.
8. **Commit the skeleton** on `main`: `git add -A`, then `git update-index --chmod=+x scripts/gate scripts/build .githooks/pre-commit` (every file of `scripts/` and `.githooks/`, the gate, the build and the git hook: git on Windows keeps no executable bit of its own, L-15 of pitwall), then the hooks folder: run `git config --get core.hooksPath`; when it prints a folder other than `.githooks`, the owner has hooks of their own there, for this machine or this repository, and pitwall's would replace them here: ask one question, may pitwall's hook replace them in this project, and on no go on without the next command, saying that the gate before every commit does not run until they set it. Otherwise, and on yes, `git config core.hooksPath .githooks`, which sets it for this repository alone, so that the gate before every commit runs from now on, this commit first (pitwall's ADR-0012), then `git commit -m "chore: kickoff from pitwall <templateVersion>"`, naming no paths, which would drop the bit again, with `templateVersion` from `.claude/pitwall.json`. If git refuses because it has no user name or email, show its message and wait for the owner to set them. If the hook refuses the commit, the stub gate found a file it counts as code: show the owner its output and stop; never commit past it.
9. **GitHub**, still on `main`. Run `git remote get-url origin`.
   - No remote: ask the owner one question: create the GitHub repository now, public or private, or later. Now: `gh repo create <repository> --public` or `--private`, followed by `--source . --remote origin --push`, where `<repository>` is the project name in lower case with every character other than `a-z`, `0-9`, `-`, `.` and `_` turned into `-`. Later: go on to step 10 anyway.
   - A remote: `git push -u origin main`.
   A failed create or push is not retried: show the error and go on to step 10.
10. **Merge protection.** Always run `node "${CLAUDE_PLUGIN_ROOT}/scripts/protect.mjs"`, even when there is no repository yet: it checks first that it may, then protects `main`, records why it cannot, or says what to do. Its last line is `RESULT: <mode>`. Relay what it printed in a few lines, without restating the rules it applies:
    - `branch-protection`: done;
    - `local-hook`: tell the owner, as it says, that only pitwall's hook and the review flow guard `main`: a merge from the GitHub web page is not blocked;
    - `pending` (exit 3): show the HANDOFF block verbatim; the commands under "Run this yourself" are for the owner, and the one under "Then run this to record the result" records it once they are done.
11. **Merges without the owner** (ADR-0010). Ask one question: once `gate` and `ai-review` are green, may low and normal risk epics merge without the owner? High risk and bug fixes always wait for them, and the answer can change later. Do not recommend either answer: it is the owner's. On no, nothing changes: `.claude/pitwall.json` already says `autoMerge: false`. On yes, tell the owner that Claude Code will now ask them to allow one command, the one that records their yes, then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/merge-choice.mjs" --allow` yourself, alone in its call: pitwall's guard sends exactly that command to Claude Code's permission prompt, whatever the session's mode or allow rules, and their yes there records the answer as theirs, with the two narrow allow rules. Never run it without their yes in this conversation, never add or suggest an allow rule for it, and never try another way when it is refused. When the owner says no at the prompt, nothing is recorded. When Claude Code does not ask (nobody is at the prompt, or the session's mode never asks, and the guard refuses), hand the owner the command to run themselves in a terminal, on one line of its own in a code block, with `--project "<the project root>"` at its end so that it runs from any folder; until it is recorded, every merge waits for them.
12. **The planning branch.** Create the branch named in `planning.branch` with `git switch -c <branch>`; when origin already holds it, as in a new clone of a project in the middle of its planning, `git switch <branch>` takes origin's instead, and never a second one cut from `main`. If `.claude/pitwall.json` changed in step 10 or 11, commit it there: `git commit -am "chore: record merge protection and the choice of merges"`. With a remote, `git push -u origin <branch>`.
13. **Hand over.** Tell the owner, in a few lines: the level, the protection mode (and the pending command, if any), the answer on merges without them (and the command, if it is still theirs to run), the branch, and that the next stage is discovery: `/pitwall:continue`, or just "continue", runs it. When `/pitwall:continue` runs this stage, it asks whether to move on.

## Output

- The project skeleton from the template, with `.claude/pitwall.json`: `templateVersion`, `processLevel`, `mergeProtection`, `autoMerge`.
- `docs/IDEA.md`: the problem, who it is for, what is out of scope, why this level.
- One commit on `main`, pushed and protected when there is a GitHub repository, and the planning branch (`planning.branch`) for stages 1 to 5.
- `core.hooksPath` set to `.githooks`: `scripts/gate --fast` runs before every commit.

## Check

The owner confirmed the wording of the idea and the process level, and `docs-check.mjs --stage kickoff` passes: no `.tmpl` file or placeholder is left, `.claude/pitwall.json` is valid, and every section of `docs/IDEA.md` is filled in.
