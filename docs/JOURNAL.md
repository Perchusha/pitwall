# Journal

One entry per epic, newest first.

## T1 - Stages 0 to 2 (2026-11-06)

`/pitwall:kickoff`, `/pitwall:discovery` and `/pitwall:decide` are built, with the `researcher` agent, and the plugin gained its first scripts, in Node (ADR-0004): `layout.mjs` lays a new project out and never overwrites, `docs-check.mjs` reports missing sections, IDs that point nowhere and oversized files, plus the Check of each stage, and `protect.mjs` protects `main` with admins included (ADR-0005) or hands the owner ready commands. `.claude/pitwall.json` and the template's headings joined the contract (ADR-0006). The owner answered three one-way questions and accepted the two-way list with edits; one of them became a new epic, T6, for adopting an existing project.

**Numbers.** `scripts/check.mjs` grew from 12 to 17 steps; the protection step runs 29 scenarios against a fake `gh`, the docs check 37 broken or filled copies of a laid-out project. The headless run of the lite system from SPEC 10 (`scripts/e2e.mjs`, a scripted owner, `gh` signed out) passed all three stages before the review, and the changed stages again after it:

| Stage | Turns | Minutes | Cost at API prices | Output |
| --- | --- | --- | --- | --- |
| kickoff | 8 | 2.3 | $2.47 | skeleton on `main`, `plan/initial`, protection `pending` |
| discovery | 13 | 15.9 | $39.97 | 7 scenarios, analogues with opened links, 6 confirmed constraints, assumptions by risk |
| decide | 10 | 27.2 | $77.59 | 7 one-way ADRs, `docs/STACK.md` with registry links and dates |
| kickoff, after the fixes | 8 | 2.3 | $2.39 | the same from a folder with nothing in it: the preflight set git up, and `protect.mjs` ran against a signed-out fake `gh` |
| decide, after the fixes | 6 | 23.6 | $44.02 | 3 one-way ADRs (the lite rule), the rest in the accepted two-way list |

Almost all of the cost is the researchers, which run in parallel: 42 to 46 calls each in discovery, 78 to 103 each in decide, against a stop at 120. That is too much for a lite project and is the first thing to tune in T5. The second decide run started from the first run's discovery commit (`e2e.mjs --from decide --seed`); discovery itself was not run again, as its changes were small and its earlier output passes the stricter checks.

**What only the work showed:**
- Neither `claude plugin ...` nor `-p` acts on the marketplaces a project declares, so the teammate check (T1-AC6) could not be scripted. The owner ran it by hand on 2026-11-06 in a profile without the pitwall marketplace: after trusting the folder, Claude Code added the marketplace from GitHub and the `/pitwall:*` commands were there with no separate install, because the plugin's source is a relative path inside the marketplace.
- A headless run cannot answer a prompt, and the model wraps commands in `cd ... && ...; echo`, so an allow list alone stalled kickoff at the layout step. The runs use `--permission-mode auto` with an allow list, and the skills now ask for one command per call.
- Piping JSON into `gh api --input -` fails in Windows PowerShell, which adds a byte order mark (L-6). Typed `-F` fields work in both shells.
- The branch endpoint shows the protection summary to any reader, so a non-admin can confirm protection that an admin set. npm's `/latest` has no release date, so the registries in the config name the field that holds the date.

**What the review found.** A fresh-context reviewer probed the scripts in scratch folders, the protection script against a fake `gh` and, read-only, against the real repository. Two blocking findings: the decide check accepted a one-way area whose ADR was two-way or decided by the agent, and the "no repository" handoff held a `<name>` placeholder that neither shell runs as written, with a `--push` that could make `plan/initial` the default branch. Eleven more were fixed in the same PR: kickoff now checks the folder before the first question and always runs `protect.mjs`; a failed precondition no longer erases a recorded mode; the later stages commit `.claude/pitwall.json`; facts repeated in skills, templates and READMEs now point at the config or the template; the docs check also catches option rows without sources, duplicate analogues and malformed settings; and E0-AC3 in the template matches ADR-0005.

A second fresh-context review verified those fixes and found two more blocking gaps: Claude Code writes `.claude/settings.local.json` for a standing approval, so the new preflight refused a folder that was still empty; and a one-way area could cite an ADR with no file, written in a code span. Now the preflight is `layout.mjs --check` and ignores that file and OS litter, a cited ADR must exist, every table keeps the template's columns, and at the lite level a one-way area may end in the two-way list the owner accepts (`processLevels.lite.decisions`), as SPEC 3 always said. A third review found no blocking findings and five to fix, all fixed in the same PR: `desktop.ini` passed the preflight but turned the gate red, the lite rule had no lower bound (now `decisions.askOwner.min` owner decisions), a recorded `branch-protection` survived a run that read the branch unprotected, the kickoff run predated the new preflight (run again, the row above), and two criteria no longer said what the code does. The commits that fixed them were reviewed once more, and the verdict of that review is the `ai-review` status on the head of this PR.

**Next:** T2, stages 3 to 5. pitwall's own `main` still has admins excluded from its protection (ADR-0005): turning that on is the owner's step.

## T0 - Skeleton (2026-11-05)

The repository is a marketplace with one plugin. The plugin has 12 skills and 6 agents, all stubs that say which epic builds them, plus `config/defaults.json` and the project template. `claude plugin validate --strict` passes on both manifests, and `scripts/check.mjs` adds the repository's own checks. The design that came out of the planning discussion is in `docs/SPEC.md`, with three ADRs for the decisions taken along the way.

**What only the work showed:**
- The Claude Code CLI ships a strict validator, `claude plugin validate --strict`, and a release helper, `claude plugin tag`. Both replace hand-written checks.
- Files in the template that tools load by name (`CLAUDE.md`, `.claude/settings.json`, `.gitignore`) would act inside this repository, so they carry a `.tmpl` suffix.
- A gate stub that always passes would make a new project look green with no checks. The stub passes only while the repository holds docs, and fails once code appears.

**What the review found.** A fresh-context reviewer ran every acceptance criterion and probed the template in scratch repositories. One blocking finding: the gate stub only saw tracked files and passed outside git, so code that was not yet committed slipped through. It now lists untracked files, works from any folder and fails closed. Six more were fixed in the same PR: line endings on Windows (`.gitattributes` in the repo and the template), a guard for unbuilt skills that depended on wording, a premature "T0 is done" line, an unpinned validator in CI, a high-risk merge rule that read differently in two places, and the epic file name. The checks gained guards for Cyrillic text, model IDs in skills and agents, tool-loaded file names in the template and the gate's mode in the git index. L-2 was sharpened and L-3, L-4 added.

A second fresh-context review confirmed those fixes and found what they missed: the unbuilt-skill guard still matched wording, the gate passed when git could not list files, and nothing ever ran the gate, so a regression would have stayed green. Now every skill must carry a `> Status:` line and only `built` may trigger by itself, the gate fails when git fails, and the check runs the gate in a scratch project on every build.

**Merge.** PR #1 merged with `gate` green in GitHub Actions. The cloud session that built T0 could not publish the `ai-review` status, protect `main` or push the `pitwall--v0.1.0` tag: its GitHub proxy refuses those writes (L-5). They run from the owner's local session.

**Next:** T1, stages 0 to 2.
