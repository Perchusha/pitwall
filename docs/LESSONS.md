# Lessons

Rules learned from mistakes. Read before writing or reviewing anything.

| ID | Rule | Why | Date | Checked by |
| --- | --- | --- | --- | --- |
| L-1 | A template file that a tool loads by name carries a `.tmpl` suffix inside this repository | A plain `CLAUDE.md` or `.gitignore` in `template/` would act on this repository | 2026-11-05 | `scripts/check.mjs` (template file list) |
| L-2 | A stub check must not pass on real work, and fails closed | An always-green gate stub hides that a project has no checks; the first stub also missed untracked files and passed outside git (T0 review) | 2026-11-05 | `scripts/check.mjs` step "template gate behaviour": docs only passes, untracked code fails, outside git fails |
| L-3 | Build a character a check looks for from its code point, never a `\u` escape in source | The file tools wrote the escapes as the literal characters twice, so the check failed on itself | 2026-11-05 | `scripts/check.mjs` passes its own em dash and Cyrillic checks |
| L-4 | Keep line endings LF in the repository and in every project | On Windows with `core.autocrlf=true`, frontmatter stops parsing and the gate script dies on `bash\r` (T0 review) | 2026-11-05 | `.gitattributes`, and `gitattributes.tmpl` in the template |
| L-5 | A step that writes a commit status, branch protection or a tag checks that it may, and hands the step to the owner when it may not | The cloud session that built T0 had push access, but its GitHub proxy refused all three writes | 2026-11-05 | T1 (kickoff) and T3 (review, merge, release) |
