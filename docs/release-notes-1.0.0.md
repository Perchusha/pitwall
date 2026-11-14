The first stable version of pitwall: epics T0 to T7 as they merged, with no new features since 0.12.0.

### What it does

- `/pitwall:continue` leads a project from a one-line idea, or from a project that exists already after a dry run that writes nothing, through discovery, decisions recorded as ADRs, a spike when one is due and a plan in epics that a fresh-context agent reviews. Then it runs the epic loop, one change per lap: implemented with tests, gated, reviewed by a fresh-context code reviewer, merged by risk class. In a pitwall project you can just say "continue".
- Bugs and lessons: `/pitwall:bug` files a defect of merged work with a severity you confirm, `/pitwall:lesson` a mistake that can repeat with what checks it.
- `/pitwall:release` ships what the loop merged as one version: a changelog from the merge commits, a local build, the `qa` agent's check of every closed epic's criteria, your yes, and the tag you make.
- Three process levels, lite, standard and full: a small idea does not walk the path of a large system.
- Hooks in every pitwall project: a brief at session start, guards on secrets, on pushes to `main`, on merges, on the review status, on uncommitted work, on the gate before every commit and on a release's tag, and call budgets for agents.

### Checked

- The lite level on a real project, from an empty repository to its first merged epic, in the owner's own session (T5a).
- Every stage in headless runs against a fake GitHub, on Windows with Claude Code 2.1.323: the stages at T5a, the adoption of an existing project at T6, the hooks at T7. T7's change to kickoff, a question before it replaces git hooks of the owner's own, is held by a case of the check only.
- Every check in CI, on Linux with Claude Code 2.1.318, the version `.claude-code-version` pins.

### Known limits

- A release is a local build at every level. The standard and full levels name staging, QA after every merge and a deployment to production with its smoke check: none of them is built yet, and T8 brings staging and QA in a browser.
- The standard and full levels have not yet run on a real project, and the adoption of an existing project has run only headless, on a test project: T5b, a real project adopted at the full level, comes after 1.0.
- The default branch must be `main`: kickoff makes it so, and the adoption stops while it is not, with the steps of the rename.
- The marketplace serves the plugin from `main`, not from a tag (T8).
- On a private repository on GitHub Free there is no branch protection: a hook refuses `gh pr merge` until both checks are green, and a merge on GitHub's web page is not stopped.
- The guards catch mistakes, not a command built to hide what it does: [R-2, R-3 and R-5](https://github.com/Perchusha/pitwall/blob/main/docs/RISKS.md). A merge that waits for the owner is held by Claude Code's permission prompt, or in auto mode by its classifier: with permissions skipped, or an allow rule that covers `merge.mjs`, only the skill's text holds it (R-4).
- Checked on Windows, and in CI on Linux; macOS has not been tried.
- Open bugs: BUG-9 (Git LFS writes its hooks into `.githooks`) and BUG-11 to BUG-13 (three forms of a command that throws uncommitted work away and that the guard lets through), none blocking, in [docs/BUGS.md](https://github.com/Perchusha/pitwall/blob/main/docs/BUGS.md). One more waits for the next branch: a project-scope install of the plugin, which kickoff refuses; install for the user.

### After 1.0

T5b, T8, BUG-9 and BUG-11 to BUG-13; QA after every merge and a deployment to production with its smoke check, which no epic holds yet; an estimate of the cost before a paid run; a probe of the hooks on Windows without Git Bash: [docs/EPICS.md](https://github.com/Perchusha/pitwall/blob/main/docs/EPICS.md).
