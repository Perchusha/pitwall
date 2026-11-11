# T4b - Bugs and lessons

Goal: a defect becomes a bug with a severity and a risk class, its fix runs the loop and merges by that class, and a mistake that can repeat becomes a lesson, and a guard where a tool can check it.
Depends on: T4a
Risk class: high (a fix merges by its own risk class: the rules of merges change)
ADR: ADR-0006, ADR-0010

## Acceptance criteria

- [ ] T4b-AC1: `/pitwall:bug` files a defect as the next `BUG-n`: its title, where it was found, the steps, what was expected, what happened, its severity and its risk class, which the skill proposes with a reason in one line each and the owner confirms or changes in one answer. A fix closes only with a regression test: the reviewer's file of a bug names under "Covered by" a file that exists at the reviewed commit, and the docs check of the code review refuses one that does not; a QA scenario in a file stays allowed where no automated test can drive the behaviour, and then the same cell says why there is none (owner, 2026-11-11). `/pitwall:lesson` records `L-n`: the rule, why, the date and how it is checked; the docs check refuses a lesson whose "Checked by" is empty.
- [ ] T4b-AC2: `docs/BUGS.md` gains a title, a severity and a risk class: only a blocking bug goes before the next epic, the others wait in the queue (owner, 2026-11-09); until then T3b takes any open bug first. The default "an open bug goes first" changes to "only a blocking bug goes first" everywhere it is said: `continue`'s selection and `/pitwall:owner-calls`' default for an open bug (owner, 2026-11-10). Scripts read the table by its header, not by the place of a column. A project laid out before keeps its table of seven columns readable, and `continue` adds the new columns there.
- [ ] T4b-AC3: A fix merges by its risk class like an epic once the owner has allowed fixes of low and normal class to merge without them, a choice of its own (owner, 2026-11-11); until then T3b merges every fix after the owner's yes. `/pitwall:kickoff`, `/pitwall:continue` and `merge-choice.mjs` say it so.
- [ ] T4b-AC4: Tests. `scripts/check.mjs` runs the bugs script on scratch projects (a bug filed, the file it waits in, the first commit that moves it, an old table), `merge.mjs` on a fix of each class with the fake `gh`, with and without the owner's choice for fixes and with a class lowered on the branch, `owner-calls.mjs` with severities and unconfirmed bugs, and the docs check's new rules. A headless loop stage `bug` runs a blocking fix through the loop on the fake GitHub.

## Decisions

One-way (2026-11-10): split out of T4 (see T4a-guards-and-process.md), high risk because a fix merging by its own class changes the rules of merges (owner).

One-way (2026-11-11): the four criteria of the guard's corpus and the gate before every commit, drafted here as T4b-AC4 to AC7, move to T4d, which comes after this epic and before T4c (owner; see T4d-guard-corpus-and-commit-gate.md).

Two-way, picked by the agent and accepted by the owner as a list on 2026-11-11, with the owner's edits (marked):

| Area | Choice | Why, in one line |
| --- | --- | --- |
| Severity | Two values in the config: `blocking`, when the defect itself does harm in ordinary work (work stops, or data, work or a secret is lost because of it); `not blocking`, anything else, a gap in a protection that does harm only after someone else's mistake included (owner's edit) | The owner's rule is binary; counted as blocking, every gap of a guard would go before every epic |
| Columns | ID, Title, Found in, Steps, Expected, Actual, Severity, Risk, Status, Fix PR; the title is the short name plans and RISKS give the bug beside its ID (owner's edit); found in QA, review, production, by the owner or by CI; status open, in progress, in review, fixed, or `accepted (R-n)` | A decision that names a bug reads without opening `docs/BUGS.md` |
| Not fixed | The owner's no to a fix moves the bug to `docs/RISKS.md` as the next R-n, and its status becomes `accepted (R-n)` | RISKS keeps only what will not be fixed (the owner's rule for R-3) |
| Older projects | A table of seven columns reads as before, every open bug blocking and high; `continue` adds the new columns with those values in the first commit of its next branch and tells the owner; a minor version | ADR-0006's contract, the paths and the `##` headings, does not change, and the old table keeps reading |
| Until committed | A new bug's row, and a change to the row of a bug not fixed yet (the owner confirming its severity and class), wait outside the work tree, in `pitwall/bugs.md` in the git directory (`git rev-parse --git-common-dir`), written by a script; `continue`, `owner-calls` and the next number read it over `docs/BUGS.md`; the first commit of the next branch moves it into `docs/BUGS.md` and empties it (owner's edit) | No implementer sees it, `git add -A` does not take it, and no switch, stash, checkout or clean touches it; it lives in one clone, and `owner-calls` lists it |
| The class of a fix | `merge.mjs`, which runs in the same clone, reads it in three places and takes the highest: the first commit of the fix's branch, which holds the row with the owner's last change to it, the commit it merges, and the file in the git directory, which holds a change the owner made after the fix started (owner's edit); and `main`, where another branch's first commit may already have taken that change, unless the class there is still unconfirmed (review round 1) | As for an epic: a class raised holds wherever it was raised, one lowered on the branch does not, and the owner's confirmation before the fix starts counts |
| Order | A blocking bug, the oldest first, even before the change in flight; then the change in flight; then the next epic; a bug that is not blocking when no epic is ready; `owner-calls` gives each default. Before the loop switches to a fix's branch the tree is clean: work of the change in flight not yet committed goes into `git stash push -u -m "pitwall: <change> before <bug>"`, never into a commit, and when the conductor returns to that change it pops that stash; `owner-calls` lists every stash whose message starts with `pitwall:`; no work tree of its own for the fix (owner's edit) | Otherwise git carries the epic's work into the fix's branch; a commit of red work would meet T4d's gate before every commit, while T4a's guard already keeps a stash from being dropped; a work tree per fix would need the project's dependencies installed again before its gate could pass |
| Implementer of a fix | By its risk class, as for an epic; `implementer-deep` whatever the class when the cause is unknown | T3b's rule stays the floor |
| A lesson's guard | A rule a tool could check but none does yet is filed with `/pitwall:bug` as a bug that is not blocking, and "Checked by" reads "Not by a tool until" its ID; the owner may put it into an epic instead | A missing check is a defect, which the bug flow already orders, fixes and merges; editing a planned epic would change an approved plan |
| Who files | Both skills keep model invocation on, so `continue` and T4c's qa agent can preload them (L-10), and work in any repository whose `docs/BUGS.md` and `docs/LESSONS.md` follow the template, pitwall's own included. A model files a bug only on what is merged already: a defect on the branch in flight is a review finding or a fix within the same change. A bug filed without the owner's answer on its severity and class is `blocking (unconfirmed)` and `high (unconfirmed)` until they confirm, and `owner-calls` asks about it (owner's edit) | High, so its fix never merges without the owner. Blocking, because the two mistakes cost unequally: a wrong "blocking" costs one fix, whose merge waits for the owner anyway, and a wrong "not blocking" lets epics merge over a defect that stops work or loses data or work |
| Fixes without the owner | A choice of its own, `autoMergeFixes` in `.claude/pitwall.json`, recorded only through `merge-choice.mjs` in the owner's terminal; `continue` asks once, when a fix of low or normal class is first ready to merge, and until then every fix waits for the owner; the class confirmed when the bug is filed stays; ADR-0010 gets a dated line (owner's edit) | The owner's earlier yes was given under "fixes always wait for you": its meaning does not widen |
| First real data | Once T4b is merged, the four gaps below are filed with `/pitwall:bug` in a session started with `--plugin-dir`, not blocking and high; their rows go into the first commit of T4d's branch | The skill's first run on real data |
| Runs before the PR | `scripts/check.mjs`, and a new loop stage `bug` from the state E1 saved, on the fake GitHub: the scripted owner files a blocking bug of normal class and says yes to the choice for fixes; `/pitwall:continue` fixes it before the planned E2 and merges it by its class (owner's edit); E1 is not run again, and nothing runs on real GitHub | The fix path of T3b never ran headless, and it is what this epic changes |
| Version | 0.7.0 | Two skills, a script and a column are additions |

The first bugs (owner, 2026-11-11): once `/pitwall:bug` is built, it files four gaps of the hooks' guard as the first bugs in pitwall's own `docs/BUGS.md`, in the new format, which is the skill's first run on real data. Each is not blocking, and each fix is high risk, since it changes a guard:
- `git rm -f` over a changed file passes (R-3);
- `git worktree remove --force` over a work tree with changes passes (R-3);
- `git reset --merge` is not judged (R-3);
- a PowerShell assignment of a single word is read as running its value: `$r = 'review-status.mjs'` is refused as `review` (T3a).

Once they are filed, the description, the steps and the severity of each live only in `docs/BUGS.md`, so that a gap lives in one file (owner, 2026-11-11):
- this list keeps each bug as its BUG-n with a short name and its place in the order, so that the decision reads without opening another file: for example "BUG-&lt;n&gt; (`git rm -f`), fixed first", with the number it gets;
- R-3 names the three it describes the same way, by BUG-n with a short name, and keeps only what was accepted and will not be fixed.

The four are not T4b's criteria. They are fixed after T4d, when the script of T4d-AC1 checks each change of the guard against the corpus, `git rm -f` first, since it throws work away more readily than the others.

An intermittent failure of the step "fake GitHub against GitHub's answers" of `scripts/check.mjs` (once in about seven runs on 2026-11-11, its message not kept) is filed the same way, with `/pitwall:bug` once it is built, as soon as a failure shows its message (owner, 2026-11-11).

## Out of scope

- The guard's corpus and the gate before every commit (T4d); releases, staging and QA (T4c), whose qa agent files bugs in this epic's format.
- Fixing the four first bugs: after T4d (see Decisions).

## Open questions

None.
