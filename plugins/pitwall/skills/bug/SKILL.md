---
name: bug
description: Files a defect of a pitwall project as the next BUG-n - its title, where it was found, the steps, what was expected and what happened, its severity and its risk class, which the owner confirms - or changes a bug already filed, or records the owner's no to its fix as a risk. Use when QA, a review, production, CI on main or the owner reports a defect in work that is merged already; a defect of the branch in flight is a finding of its review instead.
---

# bug - file a defect

> Status: built in T4b.

Files a bug where the loop finds it: the row waits in the git directory, outside the work tree, until the first commit of the next branch moves it into `docs/BUGS.md` (owner, 2026-11-11). Its fix runs the loop like an epic and always merges after the owner's yes; its risk class picks the fix's implementer. Only a blocking bug's fix goes before the next epic, right after the change in flight.

Plugin files used: `${CLAUDE_PLUGIN_ROOT}/config/defaults.json` (`bugs`, `riskClasses`) and the scripts in `${CLAUDE_PLUGIN_ROOT}/scripts/` (`bugs.mjs`, `docs-check.mjs`).

## Rules

- A bug is a defect of what is merged already. A defect of the branch in flight is a finding of that change's review, or a fix within the same change: never file one for it on your own, and when the owner asks for it, say so once and do as they decide (owner, 2026-11-11).
- Never write `docs/BUGS.md` yourself, and commit nothing: `bugs.mjs` writes the row into the git directory, and `/pitwall:continue` moves it into the first commit of its next branch, so no implementer commits it into another change.
- Run each command as written, from the project root, one command per call. Give a bug, a lesson, a risk or a fallback to `bugs.mjs` on stdin with a quoted heredoc in bash (the Bash tool), as the steps show: nothing in it is expanded, so a command quoted in the steps stays as it was written. Never put free text in a double-quoted argument: bash expands `$`, backticks and commands inside it.
- One question per message, then wait. Never answer for the owner.
- Severity and class follow the config, never a word of your own: `bugs.severities` says what blocking means, and `riskClasses` gives the examples of each class.

## Steps

1. **Preflight.** `docs/BUGS.md` must exist (a pitwall project, or a repository whose docs follow its template, pitwall's own included); without it, stop and say so. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/bugs.mjs" list --all`: when a bug there already describes the defect, name it and ask whether this is a change to it (step 7) rather than a new one.
2. **Gather** from what was reported, and ask the reporter or the owner only for what is missing, one question at a time:
   - a title: the short name, at most 60 characters, that plans and `docs/RISKS.md` give the bug beside its ID;
   - where it was found, one of `bugs.foundIn`;
   - the steps that show it, what was expected, and what happened instead, each in a line or two. Quote a command as it was run.
3. **Propose** a severity and a risk class, each with a reason in one line:
   - the severity by `bugs.severities`: blocking when the defect itself does harm in ordinary work (work stops, or data, work or a secret is lost because of it); a gap in a protection that does harm only after someone else's mistake is not blocking;
   - the class by what the fix will touch, as `riskClasses` gives its examples (auth, payments, data migrations and deletion, infrastructure, security: high); it picks the implementer of the fix.
4. **Ask the owner** in one message to confirm both or change them. Their answer, or "as you propose", confirms them. When no owner can answer (you run as an agent nobody talks to, or the owner left without a word), file it unconfirmed: the script files it blocking, marked so, with the class you proposed, until they confirm it in `/pitwall:owner-calls` (owner, 2026-11-11).
5. **File it**, with `confirmed: yes` when the owner answered and `confirmed: no` otherwise:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/bugs.mjs" file <<'EOF'
   title: <the title>
   found in: <where>
   steps: <the steps>
   expected: <what was expected>
   actual: <what happened>
   severity: <blocking or not blocking>
   risk: <low, normal or high>
   confirmed: <yes or no>
   EOF
   ```
   It prints `FILED:` with the ID. A refusal names the field to fix: fix it and run it again.
6. **Can it happen again** in another place, the same mistake made elsewhere? Then say so, with the rule in one line, and suggest `/pitwall:lesson`.
7. **A change to a bug already filed**, when the owner asks for one: `node "${CLAUDE_PLUGIN_ROOT}/scripts/bugs.mjs" set <BUG-n> --severity "<s>" --risk <class>` (an unconfirmed bug is confirmed by its severity), or `--title '<t>'` in single quotes (a title with a quote mark of its own is reworded), or `--found <where>`. The change waits in the git directory as a new bug does.
8. **The owner's no to a fix**: the bug becomes an accepted risk. Ask what they will do if it comes true, then:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/bugs.mjs" accept <BUG-n> <<'EOF'
   fallback: <their answer>
   EOF
   ```
9. **Tell the owner** in a few lines: the ID and title, the severity and class, that the row waits in the git directory until the next branch, and what happens next: a blocking bug's fix goes right after the change in flight, before the next epic; one that is not blocking waits until no epic is ready; every fix merges after the owner's yes. The fix closes only with a regression test, or a QA scenario in a file where no test can drive the behaviour.

## Output

`FILED: BUG-<n>`, a change `SET:`, or `ACCEPTED: BUG-<n> becomes R-<n>`, each waiting in the git directory for the first commit of the next branch, where `docs-check.mjs --stage bug` passes on it.
