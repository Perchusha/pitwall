# Lessons

Rules learned from mistakes. Read before writing or reviewing anything.

| ID | Rule | Why | Date | Checked by |
| --- | --- | --- | --- | --- |
| L-1 | A template file that a tool loads by name carries a `.tmpl` suffix inside this repository | A plain `CLAUDE.md` or `.gitignore` in `template/` would act on this repository | 2026-11-05 | `scripts/check.mjs` (template file list) |
| L-2 | A stub check must not pass on real work | An always-green gate stub hides that a project has no checks | 2026-11-05 | The template's `scripts/gate` fails once code appears |
