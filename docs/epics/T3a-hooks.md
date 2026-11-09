# T3a - Hooks

Goal: the rules the agents keep by prompt alone so far are kept by hooks: the session starts oriented, secrets, `main` and the guards' own switch are guarded, only the reviewers set `ai-review`, budgets end, and code is checked after edits and before stopping.
Depends on: T2
Risk class: high (hooks that block tools in every pitwall project, the review and merge guards)
ADR: ADR-0002, ADR-0004, ADR-0005, ADR-0007, ADR-0010

## Acceptance criteria

- [ ] T3a-AC1: Packaging. `plugins/pitwall/hooks/hooks.json` registers the hooks, and each runs a Node script of the plugin (ADR-0004). Outside a pitwall project, a folder without `.claude/pitwall.json` at its root, every hook exits 0 and prints nothing. A guard that cannot run refuses the call and says what broke and how to turn pitwall off in this project; the session brief, the warnings and the checks fail open and say so. At session start a self-test checks Node against `runtime.nodeMinMajor` and that the guard loads and refuses a known bad call; when it fails, the owner sees a warning at once.
- [ ] T3a-AC2: Session brief. At session start, resume, clear and compaction the hook adds a brief within `hooks.briefMaxChars` to the context: the process level, the merge protection mode, the branch and whether the tree is clean, the current stage or epic from `docs/EPICS.md` with its unchecked criteria, and a template version older than the plugin's.
- [ ] T3a-AC3: Guards. A PreToolUse hook, on Bash and PowerShell commands as well as the file tools, refuses: (a) reading or writing a secret file (`hooks.secrets.files`), and writing a known key format (`hooks.secrets.content`) into any file; (b) writing a file git ignores; (c) a `git push` that would change `main` (a push to it, a forced push, a deletion, `--mirror` or `--all`), except the first push of the skeleton while `main` holds one commit; (d) the guards' own switch: changing, deleting or renaming `.claude/pitwall.json`, `.claude/settings.json`, `.claude/settings.local.json`, the user's `~/.claude/settings.json` and `~/.claude/settings.local.json` or the plugin's own folder by any tool or command, and `claude plugin disable` or `uninstall`, so that only the owner or a pitwall script changes them; (e) merge protection: `gh pr merge --admin`, and any write to branch protection or rulesets through `gh api`, `curl`, GraphQL or an MCP tool (ADR-0005).
- [ ] T3a-AC4: Review guard (ADR-0007). A PreToolUse hook runs `review-status.mjs` only when the input carries `agent_id` and `agent_type` is `pitwall:plan-reviewer` or `pitwall:code-reviewer`, and refuses a commit status written any other way. The plan reviewer may write only `docs/PLAN-REVIEW.md`, and may run only the docs check and `review-status.mjs` from the plugin's own scripts, one command with no `;`, `&`, `|`, `<`, `>`, backtick, `$(` or line break.
- [ ] T3a-AC5: Call budget. Calls are counted per sub-agent by `agent_id` and per session for the main conversation. At `warn` a sub-agent is told once to wrap up and return PARTIAL with a handoff, and at `stop` every further call it makes is refused with the reason. The main conversation is told at `warn` and again at `stop` to record its state and suggest a fresh session; it is refused at `stop` like a sub-agent only when the session is unattended, which Claude Code tells a hook through `CLAUDE_CODE_SESSION_ATTENDED` (`0` in a `claude -p` session, `1` in an editor session, checked on 2.1.318 on 2026-11-09). Without the variable it is never refused, and the brief says so. The budget comes from `budgets.researcherToolCalls` for the project's level for `pitwall:researcher`, `budgets.subagentToolCalls` for other sub-agents and `budgets.sessionToolCalls` for the main conversation.
- [ ] T3a-AC6: Checks. On an `epic/*` branch, an edit to a file outside `docs/` runs `scripts/gate --fast` and reports a failure to the agent without blocking. When the main conversation or an implementer stops after such an edit, `scripts/gate --changed` runs once, and a red gate blocks the stop with its output, at most `hooks.stopRetries` times; after that the agent stops and reports PARTIAL. A stop with no edit since the last green run runs nothing.
- [ ] T3a-AC7: Merge guard (ADR-0002, ADR-0005). In the mode `local-hook` a PreToolUse hook refuses `gh pr merge` and the API's merge endpoint unless the PR's head has `gate` green from GitHub Actions in its latest run and `ai-review` green; in the mode `pending` it refuses them always. A failed read refuses.
- [ ] T3a-AC8: Tests. `scripts/check.mjs` runs every hook on payloads recorded from Claude Code (the version in `.claude-code-version`, and fails when the payloads were recorded from another): the main conversation, the plan reviewer, a researcher, a sub-agent of another plugin and a project agent named `plan-reviewer`, for each event the hooks take. It checks each decision, the no-op outside a pitwall project, the fail-closed paths and the self-test. `node scripts/e2e.mjs --hooks` runs a headless session with the plugin in a throwaway pitwall project with a local bare repository as `origin`, and checks in its transcript that the guards fired; `--record` records the payloads again. Like the other skill runs it is not part of CI.

## Decisions

One-way, asked one at a time (2026-11-09): merges without the owner are each project's owner's choice, with the rules written only when this epic's review guard is installed, and pitwall's own repository says no for now (ADR-0010); T3 is split into T3a, the hooks, and T3b, the epic loop, both high risk, and the owner merges both PRs.

Two-way, picked by the agent and accepted by the owner as a list on 2026-11-09, with the owner's edits (marked):

| Area | Choice | Why, in one line |
| --- | --- | --- |
| Layout | `hooks/hooks.json` at the plugin root and one Node script, `scripts/hook.mjs <event>` | One place decides "is this a pitwall project", reads the config and fails closed |
| Which projects | `.claude/pitwall.json` at `CLAUDE_PROJECT_DIR`; anywhere else every hook does nothing | A plugin's hooks fire in every project that enables it |
| A broken hook | Guards fail closed, through `onFailure: "block"` (CLI 2.1.295 and later) and the script's own refusal, and say what broke and that `claude plugin disable pitwall@pitwall --scope local` turns pitwall off in the project; a self-test at session start warns the owner at once (owner's edit); the brief, warnings and checks fail open | A broken guard lets nothing through, and the owner hears of it before the first refusal |
| Secrets | The template's `.env` patterns plus `*.pem`, `*.key` and `id_rsa*`, for the file tools and any command that names them; private key blocks and the common AWS, GitHub, Slack and API key formats in content | The settings deny only reads; tests make their keys at run time |
| Generated files | Any path `git check-ignore` reports; an ignored file the owner wants changed, the owner changes | It follows the project's own `.gitignore`, so no stack is assumed |
| Pushes | Refuse a push that changes `main`; the skeleton's first push and forced pushes to epic branches pass | In the mode `local-hook` nothing else guards `main` |
| The guards' switch | The three project files by any tool or command (owner's edit); the agent added the user's settings, the plugin's folder and `claude plugin disable` or `uninstall`, the other ways to the same switch | A guard that an agent can switch off guards nothing |
| Merge protection | `gh pr merge --admin` and writes to branch protection and rulesets refused, through any client (owner's edit, ADR-0005) | Admins are included in the protection; the hook keeps the agents from taking that back |
| Review guard | Only the two reviewers run `review-status.mjs`; every other status write is refused | The script is the reviewers' only way to set a status |
| Plan reviewer | Writes only `docs/PLAN-REVIEW.md`; Bash only for one command of the docs check or `review-status.mjs`, with no `;`, `&`, `\|`, `<`, `>`, backtick, `$(` or line break (owner's edit); the limits per agent live in `hooks.agents`, and T3b adds the code reviewer | "Never run git" is checked by a tool instead of a prompt |
| Budget counting | One file per agent in the system temp folder, one byte appended per call | Parallel sub-agents cannot lose a count, and no lock is needed |
| Unattended sessions | The main conversation is refused at `stop` when `CLAUDE_CODE_SESSION_ATTENDED` is `0` (owner's edit, probed on 2.1.318) | A headless run has nobody to suggest a fresh session to |
| Checks | `gate --fast` after an edit, reported; `gate --changed` before stopping, blocking at most `hooks.stopRetries` (2) times; a timeout is reported, not red | `--fast` is the gate's inner loop; until E0 the stub gate fails on any code, which pushes E0 to replace it |
| Merge guard | Reads the PR the way `merge.mjs` does, through shared code; the mode `pending` refuses every merge | One rule for "the latest gate run"; with no protection, nothing merges |
| Recorded payloads | `e2e.mjs --hooks --record` stores them in `scripts/hook-payloads/` without personal paths; `check.mjs` fails when their version is not the pinned one | The payload belongs to Claude Code (ADR-0007) |
| Headless run | A throwaway project with a local bare repository as `origin`; each guarded action is tried, and the transcript must show the refusals | It never touches GitHub |
| pitwall's own repository | Not laid out as a pitwall project in T3a; T3b decides | It would need its own `scripts/gate`, and the checks after edits would slow work on pitwall |
| Version | 0.4.0 | New hooks are a minor version; no path of the contract changes |

## Out of scope

- The conductor, the implementers, the code reviewer, merges by risk class and the allow rules of ADR-0010 (T3b).
- What the code reviewer may write: T3b adds it to the guard of T3a-AC4.

## Open questions

None.
