---
name: adopt
description: Stage 0 of pitwall for a project that already exists. In a repository that already holds code or docs it first shows, changing nothing, what pitwall would add, what it keeps and how the project's own plan maps onto docs/EPICS.md; then, after the owner's decisions, it lays out only what is missing, never overwrites a file, turns the project's real checks into scripts/gate, fills pitwall's documents from the project's own, records the stage the project starts from, and sets up merge protection as kickoff does. /pitwall:continue runs it in a folder that holds a project and no .claude/pitwall.json; the owner can also run it as /pitwall:adopt.
disable-model-invocation: true
---

# adopt - stage 0 for an existing project

> Status: built in T6.

```
DRY RUN (nothing written) -> THE OWNER'S DECISIONS -> BRANCH -> LAY OUT -> GATE -> DOCS -> COMMIT -> PROTECTION -> the stage the project starts from
```

Brings an existing project under pitwall without a second plan and without a second conductor. What the project already has stays; pitwall adds what is missing and starts at the stage the project has reached. The owner makes every call here: this skill reads, proposes, asks, records and hands over.

Plugin files used: `${CLAUDE_PLUGIN_ROOT}/config/defaults.json` (`runtime`, `adopt`, `processLevels`, `planning`, `mergeProtection`) and the scripts in `${CLAUDE_PLUGIN_ROOT}/scripts/`: `adopt.mjs`, `docs-check.mjs`, `protect.mjs`, and `merge-choice.mjs`, which runs only through Claude Code's permission prompt.

## Rules

- Run each command in the steps as written, from the project root, one command per call.
- Nothing is written before the owner's yes at the end of step 3: no file, no branch, no commit, no setting on GitHub. Until then this skill only reads.
- Never overwrite or delete a file of the project, the files it keeps in `docs/adr/`, `docs/epics/`, `docs/spikes/` and `docs/reviews/` included: the dry run lists them as KEEP, `adopt.mjs` records them in `.claude/pitwall.json` (`adopt.ownDocsKey`), and the docs check leaves them as they are. `adopt.mjs` writes only paths the project lacks. A file the project already has changes only by an edit the owner said yes to in step 3, and that edit only adds lines: every line the owner wrote stays as it is, word for word, not removed, not reworded and not struck through.
- One question per message, then wait. Use the question tool when it is there; it refuses a question with a single option, so a proposal to confirm is plain text, and options are offered only where they really differ. What you only inferred from the project's files is not a question each: such facts go to the owner as one numbered list, to confirm as a whole or correct by number. Never answer for the owner.
- A fact in a document you fill comes from a file of the project, which you name, or from the owner. What nothing answers stays open and is said so; never fill it from a guess.
- Never two plans and never two conductors: after the adoption `docs/EPICS.md` is the plan and `/pitwall:continue` the way on, and the owner decides in step 3 what happens to the plan and the workflow rules the project had.
- When a script hands a step over, show its HANDOFF lines to the owner verbatim. Never retry a refused write another way.

## Steps

1. **Preflight.** Run `node --version`; below `runtime.nodeMinMajor`, stop: the owner installs the Node LTS release from https://nodejs.org. When `.claude/pitwall.json` is not here but the planning branch holds it (`git cat-file -e <planning.branch>:.claude/pitwall.json`, or `origin/<planning.branch>` in a new clone), the adoption lives there: `git switch <planning.branch>` and go on. When `.claude/pitwall.json` is already here with `startStage` in it, an earlier run of this skill laid the project out and stopped before its end: do not run the dry run, which refuses a pitwall project, and do not lay out again. Nothing records the decisions of step 3, so put them to the owner again first, as one list to confirm or correct, from what the tree shows (the gate's commands, the sections added, the rules marked, the plan file's line). Then resume at the first step whose result is missing, each checked on its own: step 6 while `scripts/gate` is the template's stub, or the gate's workflow has no setup for the toolchain; step 7, part by part, while `docs/IDEA.md` is not filled in, while a document of a stage before `startStage` (`docs/DISCOVERY.md`, `docs/STACK.md`, the "Architecture boundaries" of `CLAUDE.md`) is still the template's text, while a kept document lacks a section the owner agreed to add, or while the plan file lacks its line; step 9 while the tree holds what is not committed; then the protection mode and the question about merges, each only when it is not done. Otherwise run `node "${CLAUDE_PLUGIN_ROOT}/scripts/adopt.mjs" --dry-run`. Exit 1: show its message and stop (an empty folder starts with kickoff; a pitwall project goes on with `/pitwall:continue`).
2. **The dry run.** Read what the report names, and nothing is written: the project's README and its own `CLAUDE.md`, each `PLAN` file, the `DOC` files that say what the project is, how it is built and what was decided, the manifests behind the `CHECK` lines and the workflows behind the `CI` lines. Then show the owner one message, "what the adoption would do":
   - what pitwall adds (the `ADD` lines, grouped) and what it keeps (the `KEEP` lines), with the sections each kept document lacks;
   - how the project's own plan maps onto `docs/EPICS.md`: a table of its items, each done or open, and what each becomes: an epic `E<n>` after E0, part of another epic, or history that goes to `docs/JOURNAL.md` because it is done. E0 stays the first epic: for an adopted project it brings what the contract still lacks (the check named `gate` in CI, `scripts/build`, the commands in `CLAUDE.md`). The epics themselves are written and reviewed at the plan stage; this table is the proposal;
   - the stage to start from, one of `adopt.stages`, and why: `discovery` when little is written down, `decide` when the problem, the users and the constraints are clear but the decisions are not recorded, `plan` when the stack is decided and the remaining work is known;
   - the process level, proposed as kickoff proposes it, from `processLevels`;
   - the gate: the commands for `scripts/gate --fast` and for `--full`, from the `CHECK` and `CI` lines;
   - what collides: workflow rules in the project's own docs that pitwall's replace (how branches, reviews, merges and releases go), hooks of its own, and every `BLOCKER` and `NOTE` line;
   - the decisions that are the owner's, as a numbered list (step 3).
3. **The owner's decisions.** First the list of what you inferred, in one message, to confirm as a whole or correct by number: the project's name, the idea in one line, the level, the stage to start from, the gate's commands. Then each real choice on its own, one per message:
   - the plan: `docs/EPICS.md` takes it over, and the project's plan file gets one line on top that says so and is history from then on (step 7 writes the line; the owner may remove the file themselves later). With several plan files, which one is the plan. An owner who wants their own file to stay the plan cannot adopt: pitwall's loop reads `docs/EPICS.md`, and two plans drift apart; say so and stop;
   - the kept documents that lack sections of the template: pitwall adds the missing sections to each, at its end, and changes nothing else in them. `CLAUDE.md` and the documents under `docs/` need them for the docs check; ask as one list when there are several;
   - each workflow rule of the project's own that collides with pitwall's: pitwall's replaces it, or the owner keeps theirs and says how the two fit;
   - hooks of the project's own: whether pitwall's `.githooks/pre-commit` replaces them (`core.hooksPath` becomes `.githooks`);
   - merge protection: set it up now, which makes `main` require the checks `gate` and `ai-review` for everyone, or later.
   A `BLOCKER` stops here: say what the owner has to do first. Then ask one last question: adopt the project as listed? On no, stop: nothing was written.
4. **Branch.** With a remote, `git fetch origin`. Run `git status --porcelain`: uncommitted work the owner commits or puts aside first. Then `git switch -c <planning.branch> main`, from the tip of `main` whatever branch the session stands on: the adoption is a change like any other and reaches `main` with the plan's PR, never by a commit on `main`.
5. **Lay out.** Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/adopt.mjs" --write --name '<name>' --idea '<the idea in one line>' --level <level> --stage <stage>`, with `--plan-file <path>` when the project has a plan of its own, and the values in single quotes. Any exit other than 0 wrote nothing: show its message and stop.
6. **The gate.** Give `adopt.mjs` the commands the owner confirmed, in a quoted heredoc, one per line, `fast:` for the quick ones and `full:` for everything CI should run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/adopt.mjs" --gate <<'EOF'
   fast: <command>
   full: <command>
   EOF
   ```

   Then run `bash scripts/gate --full`, with the longest timeout. Red on the project as it stands: show the owner the failing check and ask one question: leave it out of the gate for now, to be filed with `/pitwall:bug` once the plan is merged, or stop and fix it first. A project that brought its own `scripts/gate` keeps it: run it the same way. The workflow pitwall laid out for the check named `gate` (`.github/workflows/ci.yml`, or `adopt.gateWorkflow` when the project keeps its own `ci.yml`) runs `bash scripts/gate --full` on a bare runner, and the plan's PR merges only once that check is green: add to it, before the gate's step, the setup the project's checks need, the toolchain and its version and the install of the dependencies, copied from the project's own workflows (the `CI` lines of the dry run) or, with none, from the owner's answer to one question. An edit of a file pitwall laid out in this adoption, not of the owner's.
7. **The documents.** Fill pitwall's documents from the project's own, naming the file each part comes from:
   - `docs/IDEA.md`, every section, in the owner's terms;
   - for each stage before the one the project starts from, that stage's document as far as the project's files and the owner's answers go: `docs/DISCOVERY.md` when it starts at `decide` or `plan`; `docs/STACK.md` and the "Architecture boundaries" of `CLAUDE.md` when it starts at `plan`, the versions read from the project's manifests and lock files. Under a heading nothing answers, write one line: `Not recorded before pitwall.` These stages' checks are skipped for an adopted project, so write what is true, not what would pass;
   - the sections the owner agreed to add to kept documents: the template's text for each (`${CLAUDE_PLUGIN_ROOT}/template/`), with its placeholders filled, at the end of the file; in `CLAUDE.md`, fill "Commands" with the project's real commands, each one run successfully;
   - the workflow rules the owner let pitwall replace: add one line above each that says pitwall's rule replaced it, on which date, and where the rule that holds now is; leave the rule's own words as they are;
   - the project's plan file (`planFile`): one line on top, `The plan moved to docs/EPICS.md (pitwall, <date>): the open items below become epics at the plan stage, and this file is history.`
   What is still missing and the next stage needs, put to the owner now, as one list where you can propose the answers, as questions where you cannot.
8. **Docs check.** Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/docs-check.mjs" --stage kickoff`. Fix what it reports in what you wrote and run it again until it passes.
9. **Commit** on the planning branch: `git add -A`, then `git update-index --chmod=+x` on each of `scripts/gate`, `scripts/build` and `.githooks/pre-commit` that pitwall wrote (git on Windows keeps no executable bit of its own). When the owner said pitwall's hook replaces theirs, or the project had none, `git config core.hooksPath .githooks`. Then `git commit -m "chore: adopt pitwall <templateVersion>"`, naming no paths. If the hook refuses the commit, the gate is red: show its output and stop; never commit past it. With a remote, `git push -u origin <planning.branch>`.
10. **Merge protection**, when the owner said now: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/protect.mjs"` and relay its last lines as kickoff does (`branch-protection`, `local-hook`, or `pending` with its HANDOFF block verbatim). When they said later, say that `/pitwall:continue` offers it again. If `.claude/pitwall.json` changed, `git commit -m "chore: record merge protection and the choice of merges" -- .claude/pitwall.json` after the next step.
11. **Merges without the owner** (ADR-0010). Ask the one question kickoff asks in its step 11, and record a yes the same way: tell the owner that Claude Code will ask them to allow one command, then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/merge-choice.mjs" --allow` yourself, alone in its call; when Claude Code does not ask, hand them the command on one line, with `--project "<the project root>"`.
12. **Hand over.** Tell the owner, in a few lines: what was added and what was kept, the level, the stage the project starts from and what that stage will ask of them, what the gate runs, the protection mode, that the open items of their plan file become epics at the plan stage, and that `/pitwall:continue`, or just "continue", takes the next step. When `/pitwall:continue` runs this stage, it asks whether to move on.

## Output

- The template's paths the project lacked, `.claude/pitwall.json` with `templateVersion`, `processLevel`, `mergeProtection`, `autoMerge`, and `startStage` and `planFile`, which only an adopted project has.
- `scripts/gate` running the project's real checks, `docs/IDEA.md`, and the documents of the stages before `startStage` as far as the project's own files go.
- One commit on the planning branch, pushed when there is a remote; nothing on `main`, and no file of the project overwritten.

## Check

The owner said yes to the adoption as listed before anything was written, `docs-check.mjs --stage kickoff` passes (in an adopted project it also refuses a gate that is still the template's stub), `scripts/gate --full` is green on the project as it stands, and every file the project had is unchanged but for the additions the owner agreed to.
