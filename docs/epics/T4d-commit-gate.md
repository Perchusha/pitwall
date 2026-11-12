# T4d - The gate before every commit

Goal: no commit lands while the gate is red (L-14): in a pitwall project, where the project's gate runs before every commit and the hooks' guard refuses the ways an agent would skip it, and in pitwall itself, where the fast part of its check runs.
Depends on: T4b
Risk class: high (a hook that refuses commits, and a guard that refuses tools in every pitwall project, as T3a's and T4a's do: a false refusal stops ordinary work, L-9)
ADR: ADR-0006, ADR-0012

## Acceptance criteria

- [ ] T4d-AC1: The template's hook. A project gets `.githooks/pre-commit`, a bash script executable in the git index, which runs `bash scripts/gate --fast` from the project root and refuses the commit when the gate fails, with the last lines of its output. It runs nothing on a `spike/*` branch, where a prototype is committed while the gate is still the template's stub: one branch exception, so that a branch with a new name is checked by default. It runs nothing either for a commit that changes only Markdown under `docs/` and `.claude/pitwall.json`, which cannot turn the gate red and must land while it is red: the first commit of a fix for a red `main`, a reviewer's verdict on a red branch. The gate runs as from a terminal, without the variables git sets for the commit's own index, so a gate whose tests make scratch repositories works. The stub counts `.githooks/*` as configuration. `.gitattributes` keeps `.githooks/*` LF, in the template and in pitwall (L-4).
- [ ] T4d-AC2: Installing it. `/pitwall:kickoff` marks the hook executable in the index and sets `core.hooksPath` to `.githooks` before the skeleton commit, which the hook then checks. `/pitwall:continue` sets `core.hooksPath` in its preflight wherever the hook is in the index and the setting is not `.githooks` (a new clone), and asks the owner before it replaces a value they set themselves. In a project laid out before T4d, the first branch `continue` starts takes the hook from the template: `layout.mjs --hook` commits it on its own right after the branch's first commit, executable, and sets `core.hooksPath`.
- [ ] T4d-AC3: The guard's rule `precommit`, narrow by the owner's decision. It refuses `git commit` with `--no-verify`, or with `-n` alone or in a bundle of short flags (`-n`, `-an`, `-anm "x"`), but not `-mn`, where `n` is the message; `-n` of any other command is not touched. It refuses `git config` that sets `core.hooksPath` to anything but `.githooks`, at any scope, or unsets it (`--unset`, `--unset-all`, `git config unset`), and lets a read of it through. What it does not read is R-5. The code reviewer counts a change to `.githooks/` or `scripts/gate` in a change that is not about them as a blocking finding.
- [ ] T4d-AC4: pitwall's own hook (owner, 2026-11-12, back from T7). `.githooks/pre-commit` at the root of this repository runs `node scripts/check.mjs --fast`: the steps that only read the repository or lay out scratch projects (the validator, the manifests and versions, the skills and agents, the template and its hook, the scripts' parse, the layout, the docs check, links, em dashes, English, model ids), about 9 seconds of the full run's 200 on the owner's machine; the steps with the fake `gh` and the hooks' recorded payloads stay in CI and in the full run before a PR. `scripts/check.mjs` fails unless both hooks, the template's and pitwall's, are in the index with mode 100755, since git on macOS and Linux skips a hook that is not executable, and unless both `.gitattributes` keep `.githooks/*` LF. `CLAUDE.md` names `node scripts/check.mjs --fast` and, for a new clone, `git config core.hooksPath .githooks`. The guard does not act in this repository, which is not a pitwall project, so here L-14 alone keeps `--no-verify` out.
- [ ] T4d-AC5: ADR-0012 records the hook, the options it was chosen over and its limits: it checks the work tree, not what is committed, so a partial commit can still be red; git makes some commits without it (a merge with no conflict, a cherry-pick, a revert, a rebase); CI catches both. `scripts/check.mjs` lays out a scratch project and commits through the hook: a red gate refuses a commit of code, a green one passes, a `spike/*` branch and a commit of docs alone pass while it is red, and a gate that commits in a scratch repository of its own leaves the project's commit alone; and it holds a case of the guard for each form the rule refuses and each it lets through. The epic skill tells implementers that each commit runs `scripts/gate --fast` first.

## Decisions

One-way (2026-11-11): split out of T4b, whose draft held the guard's corpus and the gate before every commit as T4b-AC4 to AC7 (owner). As drafted T4b was about 1.3 to 1.4 times the size of T4a, with two areas of high risk. The letter d keeps T4c the name of releases and QA, as the journal and T4a's decisions call it; this epic comes after T4b and before T4c, which depends on it.

One-way (2026-11-11): only the gate before every commit stays here, with the guard's rule on `--no-verify` and `core.hooksPath` (owner). The script that replays the guard's corpus (L-13), the 52 variants of T4a and the four gaps of the guard move to T7, after T5.

One-way (2026-11-12): pitwall's own pre-commit hook, moved to T7 as `T7-AC3` the day before, comes back as T4d-AC4: it is cheap (owner).

Two-way, picked by the agent and accepted by the owner as a list on 2026-11-12, with the owner's edits (marked):

| Area | Choice | Why, in one line |
| --- | --- | --- |
| Hook | `.githooks/pre-commit`, a bash script executable in the index: `scripts/gate --fast`, a red gate refuses the commit with the tail of its output, nothing runs on `spike/*` | The gate's inner-loop mode, on every `git commit`, whoever runs it |
| Stub | `is_docs` counts `.githooks/*` as configuration | A new project's skeleton and planning commits pass the stub |
| Kickoff | Before the skeleton commit, `git update-index --chmod=+x .githooks/pre-commit` and `git config core.hooksPath .githooks` | The skeleton commit is the hook's first run |
| Older projects, new clones | `continue`'s preflight sets `core.hooksPath` where it is not `.githooks`; a project with no hook (laid out before T4d) gets it from the template, executable, with the first commit of its next branch | A clone does not carry git's config, and nothing else installs the hook in an older project |
| Guard | Only `git commit` with `--no-verify` or `-n` (bundles such as `-anm` included, `-mn` not), and `git config` setting `core.hooksPath` to anything but `.githooks`, or unsetting it (owner's edit: `--unset` too, the same command read the same way); `-n` of other commands untouched | The owner's narrow rule: a guard on many command forms repeats T4a |
| Outside the rule | `git -c core.hooksPath=...`, abbreviations of `--no-verify` such as `--no-ver` (owner's edit), a change or deletion of `.githooks/` or `scripts/gate`: R-5. The code reviewer counts such a change in a change that is not about them as a blocking finding, a line in `agents/code-reviewer.md` (owner's edit) | An honest agent rarely writes these, and the review reads every diff |
| Line endings | `.githooks/* text eol=lf` in the template's `.gitattributes` and pitwall's, and `scripts/check.mjs` checks both (owner's edit, L-4) | A hook with CRLF dies on `bash\r` as the gate did |
| Commit time | Every commit runs `scripts/gate --fast`; the epic skill tells implementers to commit with the longest timeout, as for the gate | A commit cut short by the tool's timeout looks like a refusal |
| ADR-0012 | The hook; rejected: a `commit-msg` hook, CI alone, a guard on command forms (the owner's no); the limit of the work tree, the `spike/*` exception and the narrow rule | Records why the gate sits in git and not only in the guard |
| pitwall's own hook | In T4d, as T4d-AC4 (owner's edit) | Cheap, and pitwall commits most often |
| Tests | `scripts/check.mjs`: the template's hook in the index with mode 100755; in a scratch project a red gate refuses a commit, a green one passes, `spike/*` passes; the guard's cases for each form it refuses and each it lets through | L-9: the forms an agent sends, both ways |
| Runs before the PR | `scripts/check.mjs`; `e2e --hooks`, since the guard changes (about $1); the loop stage `bug` from the state E1 saved (about $13), a project laid out before T4d, so the run also installs the hook through `continue` and the implementer commits through it | The two runs that cross what changed |
| Version | 0.8.0 | A template file, a guard rule and a check option are additions |

Found while building, proposed by the agent and accepted by the owner (2026-11-12):
- A commit that changes only Markdown under `docs/` and `.claude/pitwall.json` passes the hook without the gate; any other file under `docs/` runs it, since a project may keep code there. Without it, a red `main` would refuse the first commit of its own fix, which holds only docs, and `/pitwall:owner-calls` could not commit the owner's answers over an implementer's red work in progress.
- `layout.mjs --hook` commits the hook in a commit of its own: git on Windows drops the executable bit of a new file in a commit that names its paths, which is how `continue` commits. It sets `core.hooksPath` after that commit, since the stub of a project laid out before T4d counts the hook as code, and refuses to replace a folder of hooks the owner set; `continue` asks the owner first.
- The hook clears git's variables for the commit's own index (`git rev-parse --local-env-vars`) before the gate, or the git commands of a gate's tests write into the commit.
- The template's E0-AC1 asks for a `scripts/gate --fast` that runs in seconds, since it runs before every commit; the loop stage `bug` of `scripts/e2e.mjs` checks that the hook reached `main` executable and that `core.hooksPath` is set.

## Out of scope

- Bugs and lessons (T4b); releases, staging and QA (T4c); the guard's corpus and its four gaps (T7).
- A hook for the commits git makes without `pre-commit` (merges, cherry-picks, rebases): CI catches them (ADR-0012).

## Open questions

None.
