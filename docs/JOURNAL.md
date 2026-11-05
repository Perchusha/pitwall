# Journal

One entry per epic, newest first.

## T0 - Skeleton (2026-11-05)

The repository is a marketplace with one plugin. The plugin has 12 skills and 6 agents, all stubs that say which epic builds them, plus `config/defaults.json` and the project template. `claude plugin validate --strict` passes on both manifests, and `scripts/check.mjs` adds the repository's own checks. The design that came out of the planning discussion is in `docs/SPEC.md`, with three ADRs for the decisions taken along the way.

**What only the work showed:**
- The Claude Code CLI ships a strict validator, `claude plugin validate --strict`, and a release helper, `claude plugin tag`. Both replace hand-written checks.
- Files in the template that tools load by name (`CLAUDE.md`, `.claude/settings.json`, `.gitignore`) would act inside this repository, so they carry a `.tmpl` suffix.
- A gate stub that always passes would make a new project look green with no checks. The stub passes only while the repository holds docs, and fails once code appears.

**What the review found.** A fresh-context reviewer ran every acceptance criterion and probed the template in scratch repositories. One blocking finding: the gate stub only saw tracked files and passed outside git, so code that was not yet committed slipped through. It now lists untracked files, works from any folder and fails closed. Six more were fixed in the same PR: line endings on Windows (`.gitattributes` in the repo and the template), a guard for unbuilt skills that depended on wording, a premature "T0 is done" line, an unpinned validator in CI, a high-risk merge rule that read differently in two places, and the epic file name. The checks gained guards for Cyrillic text, model IDs in skills and agents, tool-loaded file names in the template and the gate's mode in the git index. L-2 was sharpened and L-3, L-4 added.

**Next:** T1, stages 0 to 2.
