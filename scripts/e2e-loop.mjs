// The headless runs of the epic loop (T3b-AC7), started by `node scripts/e2e.mjs` with the stages e0,
// e1 and bug. Not part of scripts/check.mjs or CI: it needs a signed-in Claude Code CLI and spends the
// subscription.
//
// e0 starts from the project the plan stage saved: the harness, standing in for GitHub and the
// owner, pushes it, opens the plan PR, sets ai-review on it with review-status.mjs, waits for the
// gate and merges it with merge.mjs. Then one headless session with the plugin from this checkout
// runs `/pitwall:continue 1` with a scripted owner, who says no to merges without them (so E0
// merges after their yes) and yes to everything else the process asks. e1 starts from the state
// e0 saved: the harness, as the owner, runs merge-choice.mjs --allow first, so E1 merges by its
// risk class through the allow rules alone. In both, review-status.mjs and merge.mjs are not in the
// session's allow list: e0 lets them through as the owner would answer the prompts, e1 relies on
// the rules ADR-0010 writes. bug starts from the state e1 saved (T4b-AC4): the harness, as a careless
// merge would, breaks the tray menu's Quit on main and drops its tests; one session files the defect with
// /pitwall:bug, the scripted owner confirming it blocking and normal, and a second runs
// /pitwall:continue 1, which must fix it before the planned E2 and merge it after the owner's yes, as
// every fix merges. release starts from the state bug saved (T4c-AC9): the harness, as the owner, adds a
// scripts/build to main, and one session runs /pitwall:release: the scripted owner picks 0.1.0 and says yes
// to the merge; the session makes no tag, and the harness, as the owner, then runs the commands it handed
// over. A stage passes on what git and GitHub hold afterwards, never on the model's wording,
// and saves its state and its numbers at once.
//
// By default GitHub is the fake of scripts/fake-github.mjs, with a local bare repository as origin
// and a CI that runs the gate job of ci.yml. --github <owner/repo> runs against an empty private
// repository the owner created: the session only pushes and opens PRs, merge protection is
// local-hook (GitHub Free), and every answer of the API is recorded; the run keeps one answer per
// kind of request in scripts/github-responses/, which scripts/check.mjs holds the fake to.

import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readOwner, resultWord, TEST_PROJECT, UNSCRIPTED_RULE } from './e2e-owner.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The copy e2e.mjs made at the start of the run (PITWALL_E2E_PLUGIN), never the checkout itself.
const plugin = process.env.PITWALL_E2E_PLUGIN ?? join(root, 'plugins', 'pitwall');
const tools = process.env.PITWALL_E2E_TOOLS ?? join(root, 'scripts');
const P = plugin.split('\\').join('/');
const version = JSON.parse(readFileSync(join(plugin, '.claude-plugin', 'plugin.json'), 'utf8')).version;
export const LOOP_STAGES = ['e0', 'e1', 'bug', 'release'];
// The stage each loop stage starts from, after e0.
const SEEDED_FROM = { e1: 'e0', bug: 'e1', release: 'bug' };
// The defect the bug stage files: the harness breaks it on main before the stage (injectDefect).
const BUG_REPORT = "Quit in the tray menu does nothing since the last change merged: start the app, open the icon's menu and pick Quit; the menu closes, and the icon and the app's processes stay, though E1 made Quit remove the icon and end the app. I found it today on my Windows laptop; the only way out is to end the process in Task Manager.";

const IDEA = 'A desktop app that reminds me to stand up and move every 45 minutes';
const SCENARIO = `You are the owner of a project: ${IDEA}. Its plan is merged, and the epic loop builds it now.
Facts you answer from:
- Only you use it, on your own Windows and macOS laptops. No accounts, no server, no money, no personal data leaves the machine.
- It shows a reminder every 45 minutes of active use, lets you snooze for 10 minutes, and pauses when the computer is idle or locked.
- The GitHub repository exists and gh is signed in. It is private on GitHub Free, so pitwall's hook guards main (merge protection local-hook).
- You want the plan built as the epics say. For a choice the epics and ADRs leave open, you take the assistant's recommendation.
- Every manual QA scenario of a merged epic you are asked about (the test window in front of a full-screen video, the installer, the packaged app), you ran today on both laptops, and it passed: 20 of 20 rounds, or whatever count the scenario asks for. A manual QA scenario of the epic in progress you will run after its merge.`;
const BUG_FACTS = `- Since the last change merged, picking Quit in the tray menu does nothing on both laptops: ${BUG_REPORT}
- A QA scenario of the fix you will run after its merge.`;
// The owner's answer on merges without them differs by stage: no at e0; at e1 the harness ran merge-choice.mjs --allow for them.
const OWNER_RULES = (stage) => `Answer as this owner, in English, in one to three sentences, and only what was asked.
- When asked to set up or record merge protection, or to run protect.mjs: yes.
${stage === 'e0' ? '- When asked whether low and normal risk epics may merge without you: no, every merge waits for you.' : '- When asked whether low and normal risk epics may merge without you: yes, you ran merge-choice.mjs --allow yourself; .claude/pitwall.json records it.'}${stage === 'bug' ? `
- When asked to confirm the severity and the risk class of the bug: blocking and normal.` : ''}${stage === 'release' ? `
- When asked which version the first release is, 0.1.0 or 1.0.0: 0.1.0.
- When asked whether to merge the release now: yes; you will run its manual checklist on your laptops after the merge.
- When handed the commands that make and push the tag: say you will run them yourself, and that the release is done for now.` : ''}
- When asked whether to merge an epic or a fix now: yes.
- When asked a question about an epic (clarification, a NEEDS_OWNER question, an option to pick): answer from the facts; when the facts do not say, accept the assistant's recommendation.
- When asked to accept a risk: accept it with the fallback the assistant proposes.
- When asked whether to go on after the implementer limit or after a review round: yes.
- When the assistant hands you a command to run yourself in a terminal: say you will run it later, and ask it to go on.
${UNSCRIPTED_RULE}
- When the assistant asks nothing and reports that it stopped or that the change is merged, reply exactly: DONE`;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.error) throw new Error(`${cmd}: ${r.error.message}`);
  return r;
}

export async function runLoop({ stages, stateDir, maxTurns, github }) {
  const tag = github ? 'github-' : '';
  const scratch = mkdtempSync(join(tmpdir(), 'pitwall-loop-'));
  const project = join(scratch, TEST_PROJECT);
  const originDir = join(scratch, 'origin.git');
  const ghState = join(scratch, 'github');
  const bin = join(scratch, 'bin');
  const ownerDir = join(scratch, 'owner');
  const record = join(scratch, 'github-calls.jsonl');
  for (const d of [bin, ownerDir, ghState]) mkdirSync(d, { recursive: true });

  // gh for the session and for the plugin's scripts: the fake GitHub, or the real one, recorded.
  const realGh = github ? run(process.platform === 'win32' ? 'where' : 'which', ['gh']).stdout.split(/\r?\n/)[0].trim() : '';
  const ghScript = github ? join(tools, 'gh-record.mjs') : join(tools, 'fake-gh.mjs');
  const node = process.execPath.split('\\').join('/');
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env bash\nexec "${node}" "${ghScript.split('\\').join('/')}" "$@"\n`);
  chmodSync(join(bin, 'gh'), 0o755);
  const identity = { GIT_AUTHOR_NAME: 'pitwall e2e', GIT_AUTHOR_EMAIL: 'e2e@pitwall.invalid', GIT_COMMITTER_NAME: 'pitwall e2e', GIT_COMMITTER_EMAIL: 'e2e@pitwall.invalid' };
  const env = {
    ...process.env,
    ...identity,
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    PITWALL_GH: JSON.stringify([process.execPath, ghScript]),
    GIT_CEILING_DIRECTORIES: scratch,
    ...(github ? { GH_REAL: realGh, GH_RECORD: record } : { FAKE_GH_LIVE: ghState, FAKE_GH_ORIGIN: originDir, FAKE_GH_REPO: `e2e/${TEST_PROJECT}`, GH_CONFIG_DIR: join(scratch, 'gh-config') }),
  };
  // The session's commands are never Claude Code's own variable: the owner's script refuses under it.
  const ownerEnv = { ...env };
  delete ownerEnv.CLAUDECODE;
  if (!github) for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) delete env[k];
  const git = (...args) => run('git', args, { cwd: project, env });
  const script = (name, args, e = env) => run(process.execPath, [join(plugin, 'scripts', name), ...args], { cwd: project, env: e });
  const gh = (...args) => run(process.execPath, [ghScript, ...args], { cwd: project, env });
  // The harness's own calls that change GitHub (T4a-AC4), recorded and allowed by gh-record for it alone.
  const ghHarness = (...args) => run(process.execPath, [ghScript, ...args], { cwd: project, env: { ...env, GH_RECORD_HARNESS: '1' } });

  // The start: e0 from the saved plan, e1 from the saved e0.
  const first = stages[0];
  if (first === 'e0') {
    const seed = join(stateDir, 'plan');
    if (!existsSync(join(seed, '.git'))) throw new Error(`no saved plan at ${seed}: run node scripts/e2e.mjs --until plan first`);
    cpSync(seed, project, { recursive: true });
    if (git('remote').stdout.split('\n').includes('origin')) git('remote', 'remove', 'origin');
    if (github) {
      const view = run(realGh, ['repo', 'view', github, '--json', 'visibility,isEmpty,viewerPermission,nameWithOwner'], { env });
      const repo = view.status === 0 ? JSON.parse(view.stdout) : null;
      if (!repo || repo.visibility !== 'PRIVATE' || repo.isEmpty !== true || repo.viewerPermission !== 'ADMIN') throw new Error(`--github ${github} must name an empty private repository you administer: gh says ${view.stdout.trim() || view.stderr.trim()}`);
      git('remote', 'add', 'origin', `https://github.com/${repo.nameWithOwner}.git`);
    } else {
      run('git', ['init', '-q', '--bare', originDir]);
      git('remote', 'add', 'origin', originDir);
    }
    // L-11: main first, and on GitHub only once Actions shows its workflow; then each branch on its own;
    // then the PR, and on GitHub a check suite from GitHub Actions on its head. One push of every branch into
    // an empty repository, with the PR two seconds later, left GitHub without a workflow and the PR without a
    // gate for 25 minutes (T3b, owner).
    const pushOne = (ref) => {
      const p = git('push', '-q', 'origin', ref);
      if (p.status !== 0) throw new Error(`push of ${ref} failed: ${p.stderr}`);
    };
    // Waits up to `seconds` for test() to hold, polling every few seconds; a FAIL that says what to look at when it never does.
    const waitFor = (seconds, test, what) => {
      const deadline = Date.now() + seconds * 1000;
      while (Date.now() < deadline) {
        if (test()) return;
        run(process.execPath, ['-e', 'setTimeout(() => {}, 5000)']);
      }
      throw new Error(`${what} within ${seconds} seconds. Look at the Actions tab of ${github}: a workflow GitHub has not registered, or Actions turned off for the repository; the run stops here, before any Claude session.`);
    };
    const api = (path) => {
      const r = run(realGh, ['api', `repos/${github}/${path}`], { env });
      try {
        return r.status === 0 ? JSON.parse(r.stdout) : null;
      } catch {
        return null;
      }
    };
    pushOne('main');
    if (github) waitFor(180, () => (api('actions/workflows')?.workflows ?? []).some((w) => /\/ci\.ya?ml$/.test(w.path)), 'GitHub Actions did not register .github/workflows/ci.yml after the push of main');
    for (const ref of ['plan/initial', ...git('for-each-ref', '--format=%(refname:short)', 'refs/heads/spike/').stdout.split('\n').filter(Boolean)]) pushOne(ref);
    // The world before the epic loop: the plan PR, reviewed, its gate green, merged after the owner's yes.
    gh('pr', 'create', '--base', 'main', '--head', 'plan/initial', '--title', `Plan: ${TEST_PROJECT}`, '--body', 'Stages 1 to 5, from the headless planning run.');
    const planHead = git('rev-parse', 'plan/initial').stdout.trim();
    if (github) waitFor(180, () => (api(`commits/${planHead}/check-suites`)?.check_suites ?? []).some((s) => s.app?.slug === 'github-actions'), `GitHub Actions started no check suite on the plan PR's head ${planHead.slice(0, 7)}`);
    git('switch', '-q', 'plan/initial');
    const status = script('review-status.mjs', ['--review', 'plan', '--state', 'success', '--project', project], ownerEnv);
    if (status.status !== 0) throw new Error(`review-status.mjs for the plan: ${status.stdout}${status.stderr}`);
    let merged = null;
    for (let i = 0; i < 20 && !merged; i += 1) {
      const m = script('merge.mjs', ['--plan', '--owner-approved', '--project', project, '--wait', '120'], ownerEnv);
      if (m.status === 0) merged = m;
      else if (m.status !== 3 || !/still|no gate check/.test(m.stdout)) throw new Error(`merge.mjs for the plan: ${m.stdout}${m.stderr}`);
    }
    if (!merged) throw new Error('the plan PR did not merge: its gate never finished');
    git('switch', '-q', 'main');
    git('pull', '-q', '--ff-only', 'origin', 'main');
    console.log(`plan merged on ${github ? github : 'the fake GitHub'}: ${git('log', '-1', '--format=%h %s').stdout.trim()}`);
  } else {
    const before = SEEDED_FROM[first];
    const seed = join(stateDir, `${tag}${before}`);
    if (!existsSync(join(seed, 'project', '.git'))) throw new Error(`no saved ${before} at ${seed}: run node scripts/e2e.mjs --from ${before === 'e0' ? 'e0' : `${before} --until ${before}`}${github ? ` --github ${github}` : ''} first`);
    cpSync(join(seed, 'project'), project, { recursive: true });
    if (!github) {
      cpSync(join(seed, 'origin.git'), originDir, { recursive: true });
      cpSync(join(seed, 'github'), ghState, { recursive: true });
      git('remote', 'set-url', 'origin', originDir);
    }
    const meta = existsSync(join(stateDir, `${tag}${before}.json`)) ? readFileSync(join(stateDir, `${tag}${before}.json`), 'utf8').trim() : '';
    console.log(`seeded from ${seed} at ${git('log', '--oneline', '-1').stdout.trim()} ${meta}`);
    // On GitHub, the remote state of the snapshot first: the same repository, main where it was, nothing left over (T4a-AC4).
    if (github) {
      const done = restoreRemote(ghHarness, git, github, meta ? JSON.parse(meta).remote : null);
      console.log(done.length ? `restored ${github} to the snapshot: ${done.join('; ')}` : `${github} holds the snapshot's remote state`);
    }
  }

  // What each stage leaves on origin's main: the change merged with the right merge commit, and its records.
  const remote = (...args) => {
    git('fetch', '-q', 'origin');
    return git(...args);
  };
  const shown = (path) => remote('show', `origin/main:${path}`);
  const merges = () => remote('log', '--first-parent', '--format=%H%x09%s%x09%b%x1e', 'origin/main').stdout.split('\x1e').map((l) => l.trim().split('\t')).filter((x) => x[0]);
  const promises = {
    e0: () => {
      const unmet = [];
      const m = merges().find((x) => /^feat\(E0\): /.test(x[1]));
      if (!m) return ['E0 is not merged into origin main with a "feat(E0): ..." merge commit'];
      if (!/Approved by the owner/.test(m[2] ?? '')) unmet.push(`E0's merge commit does not record the owner's approval: "${m[2]}"`);
      const plan = merges().find((x) => /Plan approved by the owner/.test(x[2] ?? ''));
      if (!plan || !shown('docs/PLAN-REVIEW.md').stdout.includes(`at ${plan[0]}`)) unmet.push('docs/PLAN-REVIEW.md on main does not hold the Approval line with the sha of the plan\'s merge commit');
      if (shown('docs/reviews/E0-skeleton.md').status !== 0) unmet.push('docs/reviews/E0-skeleton.md is not on main');
      const mode = JSON.parse(shown('.claude/pitwall.json').stdout || '{}').mergeProtection;
      if (mode !== 'local-hook') unmet.push(`.claude/pitwall.json on main records mergeProtection ${mode}, expected local-hook`);
      return unmet;
    },
    e1: () => {
      const unmet = [];
      const m = merges().find((x) => /^feat\(E1\): /.test(x[1]));
      if (!m) return ['E1 is not merged into origin main with a "feat(E1): ..." merge commit'];
      if (!/Merged without the owner/.test(m[2] ?? '')) unmet.push(`E1's merge commit does not say it merged by its risk class without the owner: "${m[2]}"`);
      if (!/\| \[E0\]\([^)]*\) \|.*\| merged \(#\d+\) \|/.test(shown('docs/EPICS.md').stdout)) unmet.push('docs/EPICS.md on main does not record E0 as merged (#n)');
      // The conductor's record, not an entry E0's own implementer may have left: E1's first commit touches the journal.
      if (!remote('log', '--format=%s', 'origin/main', '--', 'docs/JOURNAL.md').stdout.split('\n').some((s) => /^docs: start E1\b/.test(s))) unmet.push('docs/JOURNAL.md is not recorded by the first commit of E1\'s branch ("docs: start E1...")');
      if (!remote('ls-tree', '--name-only', 'origin/main', 'docs/reviews/').stdout.split('\n').some((f) => /^docs\/reviews\/E1-.+\.md$/.test(f))) unmet.push('no review file of E1 on main');
      return unmet;
    },
    // T4c-AC9: the release of what e0, e1 and bug merged, its records on main, the owner asked before its merge, and
    // no tag of the session's own; then the harness, as the owner, runs the commands the release handed over.
    release: () => {
      const unmet = [];
      const m = merges().find((x) => /^release: v0\.1\.0 \(#\d+\)$/.test(x[1]));
      if (!m) return ['the release is not merged into origin main with a "release: v0.1.0 (#n)" merge commit'];
      if (!/Approved by the owner/.test(m[2] ?? '')) unmet.push("the release's merge commit does not record the owner's yes: " + JSON.stringify(m[2] ?? ''));
      if (!fixAsked.before) unmet.push('the release merged before the scripted owner was asked about its merge');
      const log = shown('CHANGELOG.md').stdout;
      const section = log.split(/^## /m).find((s) => s.startsWith('v0.1.0 - ')) ?? '';
      if (!/### Added[\s\S]*- E0: [\s\S]*- E1: [\s\S]*### Fixed[\s\S]*- BUG-1: /.test(section) || /refactor\(E1\)/.test(section)) unmet.push('CHANGELOG.md on main has no section v0.1.0 with E0 and E1 under Added and BUG-1 under Fixed, and nothing else:\n' + section);
      const epics = shown('docs/EPICS.md').stdout;
      for (const e of ['E0', 'E1']) if (!new RegExp('\\| \\[' + e + '\\]\\([^)]*\\) \\|.*\\| released \\(v0\\.1\\.0\\) \\|').test(epics)) unmet.push('docs/EPICS.md on main does not record ' + e + ' as released (v0.1.0)');
      if (!/^\| BUG-1 \|[^\n]*\| fixed \| #\d+ \|$/m.test(shown('docs/BUGS.md').stdout)) unmet.push('docs/BUGS.md on main does not record BUG-1 as fixed with its PR');
      if (shown('docs/reviews/release-v0.1.0.md').status !== 0) unmet.push("docs/reviews/release-v0.1.0.md, the qa agent's file, is not on main");
      if (unmet.length) return unmet;
      // The tag is the owner's: none from the session; then the harness runs the handed commands as the owner.
      if (!released.tagged) {
        if (git('tag', '--list').stdout.trim() || git('ls-remote', '--tags', 'origin').stdout.trim()) return ['the session made a tag: the release hands its commands to the owner (ADR-0013)'];
        const handed = script('release.mjs', ['--tag', '--project', project], ownerEnv);
        const make = handed.stdout.split('\n').map((l) => l.trim()).find((l) => l.startsWith('git tag -a v0.1.0 '));
        if (handed.status !== 3 || !make) return ['release.mjs --tag handed no tag command (exit ' + handed.status + '):\n' + handed.stdout + handed.stderr];
        const words = make.match(/"[^"]*"|\S+/g).map((w) => w.replace(/^"|"$/g, ''));
        const made = run(words[0], words.slice(1), { cwd: project, env });
        const pushed = git('push', '-q', 'origin', 'v0.1.0');
        if (made.status !== 0 || pushed.status !== 0) return ['the handed tag commands failed: ' + made.stderr + pushed.stderr];
        released.tagged = true;
        console.log('  the owner tagged v0.1.0 from the handed commands: ' + git('rev-list', '-n', '1', 'v0.1.0').stdout.trim().slice(0, 7));
      }
      if (remote('rev-list', '-n', '1', 'v0.1.0').stdout.trim() !== m[0]) unmet.push("the tag v0.1.0 is not on the release's merge commit");
      return unmet;
    },
    // T4b-AC4: a blocking bug goes before the planned E2, and its fix merges after the owner's yes.
    bug: () => {
      const unmet = [];
      const m = merges().find((x) => /^fix\(BUG-1\): /.test(x[1]));
      if (!m) return ['BUG-1 is not merged into origin main with a "fix(BUG-1): ..." merge commit'];
      // Every fix merges after the owner's yes, at any class (ADR-0010; owner, 2026-11-11).
      if (!/^A bug fix, approved by the owner as every fix is \(pitwall ADR-0010\)\. Approved by the owner/.test(m[2] ?? '')) unmet.push(`BUG-1's merge commit does not record the owner's yes: "${m[2]}"`);
      if (merges().some((x) => /^feat\(E2\): /.test(x[1])) || /refs\/heads\/epic\/E2-/.test(git('ls-remote', '--heads', 'origin').stdout)) unmet.push('E2 was started before the blocking bug was fixed');
      const bugs = shown('docs/BUGS.md').stdout;
      if (!/^\| ID \| Title \| Found in \| Steps \| Expected \| Actual \| Severity \| Risk \| Status \| Fix PR \|$/m.test(bugs)) unmet.push('docs/BUGS.md on main lacks the columns of T4b: the first commit of the fix did not give the table of seven columns its new ones');
      if (!/^\| BUG-1 \|[^\n]*\| blocking \| normal \|/m.test(bugs)) unmet.push('docs/BUGS.md on main does not hold BUG-1 as blocking and normal');
      if (shown('docs/reviews/BUG-1.md').status !== 0) unmet.push('docs/reviews/BUG-1.md is not on main');
      // The owner was asked about the fix's merge before it happened (owner, 2026-11-11): the merge commit alone
      // cannot tell a yes the conductor asked for from --owner-approved run without a question.
      if (!fixAsked.before) unmet.push('the fix merged before the scripted owner was asked about its merge');
      // The next branch's flush leaves BUG-1 on main as the fix left it (owner, 2026-11-11; review round 3).
      fixAsked.reopened ??= reopenedAtNextFlush();
      if (fixAsked.reopened) unmet.push(`the first commit of the next branch would reopen BUG-1: bugs.mjs flush there writes "${fixAsked.reopened}"`);
      if (existsSync(join(project, '.git', 'pitwall', 'bugs.md'))) unmet.push('rows still wait in the git directory: the first commit of the fix did not take them (bugs.mjs flush)');
      // T4d-AC2: the saved e1 was laid out before the gate before every commit, so the fix's branch lays the hook out.
      if (remote('ls-tree', 'origin/main', '.githooks/pre-commit').stdout.split(/\s+/)[0] !== '100755') unmet.push('.githooks/pre-commit is not on main, executable: the fix\'s branch did not lay out the gate before every commit (layout.mjs --hook)');
      if (git('config', 'core.hooksPath').stdout.trim() !== '.githooks') unmet.push('core.hooksPath is not .githooks in the project after the fix');
      // The hook layout.mjs --hook brought is pitwall's own commit, which the code reviewer leaves alone (T4d, run of d4f3b55).
      const findings = (shown('docs/reviews/BUG-1.md').stdout.split(/^## Findings$/m)[1] ?? '').split('\n').filter((l) => /^\| *\d+ *\|/.test(l));
      if (findings.some((l) => l.includes('.githooks'))) unmet.push('the code review of BUG-1 counted the hook that layout.mjs --hook laid out as a finding');
      return unmet;
    },
  };
  // The bug stage: whether the owner was asked about the fix's merge before it happened, and what the next
  // branch's flush would make of BUG-1's row on main.
  const fixAsked = { asked: false, merged: false, before: false, reopened: undefined };
  const fixMerged = () => merges().some((x) => /^fix\(BUG-1\): /.test(x[1]));
  // The release stage: whether the harness, as the owner, has made the tag from the handed commands.
  const released = { tagged: false };
  const releaseMerged = () => merges().some((x) => /^release: v0\.1\.0 \(#\d+\)$/.test(x[1]));
  // A copy of the git directory, with what waits in it, checked out at origin's main on a branch of its own, as
  // the next branch of the loop starts; the project itself is left as the stage left it.
  function reopenedAtNextFlush() {
    const copy = mkdtempSync(join(scratch, 'next-branch-'));
    try {
      cpSync(join(project, '.git'), join(copy, '.git'), { recursive: true });
      const g = (...a) => run('git', a, { cwd: copy, env });
      g('checkout', '-q', '-f', '-B', 'e2e-next', 'origin/main');
      const flushed = run(process.execPath, [join(plugin, 'scripts', 'bugs.mjs'), 'flush', '--project', copy], { cwd: copy, env });
      if (flushed.status !== 0) return `nothing: it refused (${(flushed.stderr || flushed.stdout).trim()})`;
      const row = readFileSync(join(copy, 'docs', 'BUGS.md'), 'utf8').split('\n').find((l) => l.startsWith('| BUG-1 |')) ?? '';
      return /\| open \|/.test(row) ? row : '';
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  }
  // The filing session of the bug stage is done once BUG-1 waits in the git directory, confirmed.
  const filed = () => {
    const f = join(project, '.git', 'pitwall', 'bugs.md');
    return existsSync(f) && /^\| BUG-1 \|[^\n]*\| blocking \| normal \| open \|/m.test(readFileSync(f, 'utf8'));
  };

  // The bug stage's defect, broken on main as a careless merge would break it: Quit no longer quits, and the
  // test named for it is gone, so the gate stays green. Each E1 the e1 stage has built so far has its own shape; the
  // first that fits is broken (each was checked on its saved e1 with scripts/gate --full: 2026-11-10 and 2026-11-14).
  // An E1 built some other way needs a shape of its own here.
  const DEFECTS = [
    {
      // Electron, the tray in src/main/tray.ts, its tests in tests/main/ (2026-11-10).
      code: 'src/main/tray.ts',
      breakCode: (code) => code.replace(/click: \(\) => \{\s*onQuit\(\);\s*\}/, "click: () => {\n        if (status === '') {\n          onQuit();\n        }\n      }"),
      tests: () => (existsSync(join(project, 'tests', 'main')) ? readdirSync(join(project, 'tests', 'main')).filter((x) => x.endsWith('.test.ts')).map((x) => `tests/main/${x}`) : []),
      breakTest: (text) => text.replace(/\n([ \t]*)it\('"Quit"[^'\n]*', (?:async )?\(\) => \{[\s\S]*?\n\1\}\);\n/g, ''),
    },
    {
      // Electron, the tray's menu in src/main/main.ts, its test beside it (2026-11-14).
      code: 'src/main/main.ts',
      breakCode: (code) => code.replace('template.push({ label: QUIT_LABEL, click: () => app.quit() });', 'template.push({ label: QUIT_LABEL, click: () => undefined });'),
      tests: () => ['src/main/main.test.ts'],
      breakTest: (text) => text.replace(/\n\n([ \t]*)it\("ends the app with Quit", (?:async )?\(\) => \{[\s\S]*?\n\1\}\);\n/, '\n'),
    },
    {
      // Electron, the tray's menu in src/main/menu.ts with its actions, Quit's test in src/main/main.test.ts (2026-11-14).
      code: 'src/main/menu.ts',
      breakCode: (code) => code.replace('{ label: "Quit", click: () => actions.quit() }', '{ label: "Quit", click: () => undefined }'),
      tests: () => ['src/main/main.test.ts'],
      breakTest: (text) => text.replace(/\n\n([ \t]*)\/\/ E1-AC\d+\.\n\1it\("[^"\n]*Quit ends the app", (?:async )?\(\) => \{[\s\S]*?\n\1\}\);\n/, '\n'),
    },
  ];
  function injectDefect() {
    for (const d of DEFECTS) {
      const file = join(project, d.code);
      const code = existsSync(file) ? readFileSync(file, 'utf8') : '';
      const brokenCode = d.breakCode(code);
      if (!code || brokenCode === code) continue;
      const changed = [];
      for (const rel of d.tests()) {
        if (!existsSync(join(project, rel))) continue;
        const text = readFileSync(join(project, rel), 'utf8');
        const without = d.breakTest(text);
        if (without === text) continue;
        writeFileSync(join(project, rel), without);
        changed.push(rel);
      }
      if (changed.length === 0) continue;
      writeFileSync(file, brokenCode);
      git('switch', '-q', 'main');
      git('commit', '-q', '-m', 'refactor(E1): the tray menu', '--', d.code, ...changed);
      const p = git('push', '-q', 'origin', 'main');
      if (p.status !== 0) throw new Error(`push of the broken main failed: ${p.stderr}`);
      console.log(`the harness broke Quit on main: ${git('log', '-1', '--format=%h %s').stdout.trim()}`);
      return;
    }
    throw new Error('the saved e1 has a tray menu of a shape the bug stage does not know: E1 was built anew, so give the bug stage a defect of the new code (scripts/e2e-loop.mjs, DEFECTS)');
  }

  // The release stage's build: the owner adds scripts/build to a project laid out before 0.9.0 (T4c-AC4), a commit
  // on main that is no merge of the loop, which the release must name and leave out of the changelog.
  function addBuild() {
    git('switch', '-q', 'main');
    // A project laid out from 0.9.0 on has a scripts/build, and its E0 wrote the real one: the owner adds nothing,
    // and the release builds what E0 built (2026-11-14: the harness's own build had replaced a real one, and the qa
    // agent rightly failed the release on it).
    const stub = readFileSync(join(plugin, 'template', 'scripts', 'build'), 'utf8');
    const ownBuild = git('show', 'main:scripts/build');
    if (ownBuild.status === 0 && ownBuild.stdout.replace(/\r\n/g, '\n') !== stub.replace(/\r\n/g, '\n')) {
      console.log('main has a scripts/build of its own, from E0: the owner adds none');
      return;
    }
    writeFileSync(join(project, 'scripts', 'build'), '#!/usr/bin/env bash\n# The release build: the compiled app, for the release of pitwall\'s headless run.\nset -euo pipefail\nnpm run build >&2\necho "ARTIFACT: dist/main/main.js"\n');
    git('add', 'scripts/build');
    git('update-index', '--chmod=+x', 'scripts/build');
    // No pathspec: git on Windows drops the executable bit of a new file in a commit that names its paths (T4d).
    git('-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'chore: scripts/build, the release build');
    const p = git('push', '-q', 'origin', 'main');
    if (p.status !== 0) throw new Error('push of scripts/build failed: ' + p.stderr);
    console.log('the owner added scripts/build on main: ' + git('log', '-1', '--format=%h %s').stdout.trim());
  }

  const allowed = [
    `Bash(node "${P}/scripts/docs-check.mjs" *)`, `Bash(node "${P}/scripts/release.mjs" *)`, `Bash(node "${P}/scripts/protect.mjs")`, `Bash(node "${P}/scripts/protect.mjs" *)`, `Bash(node "${P}/scripts/bugs.mjs" *)`, `Bash(node "${P}/scripts/layout.mjs" --hook)`,
    'Bash(git *)', 'Bash(gh *)', 'Bash(npm *)', 'Bash(npx *)', 'Bash(bash scripts/gate *)', 'Bash(scripts/gate *)', 'Bash(ls *)', 'Bash(cd *)', 'Bash(echo *)', 'Bash(cat *)', 'Bash(pwd)', 'Bash(mkdir *)',
    'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Agent',
  ];
  // e0: the owner said no to merges without them, so they answer each prompt for the status and the merge; standing in for
  // those answers. bug: the owner's yes to the fix's merge, which every fix waits for.
  const ownerAnswers = [`Bash(node "${P}/scripts/review-status.mjs" *)`, `Bash(node "${P}/scripts/merge.mjs" *)`];

  const results = [];
  // Questions the scripted owner had no answer for (readOwner): printed at the end, and kept with the numbers.
  const unscripted = [];
  for (const stage of stages) {
    if (stage === 'e1') {
      const choice = script('merge-choice.mjs', ['--allow', '--project', project], ownerEnv);
      if (choice.status !== 0) throw new Error(`merge-choice.mjs --allow: ${choice.stdout}${choice.stderr}`);
      console.log('the owner allowed low and normal risk to merge without them (merge-choice.mjs --allow)');
    }
    if (stage === 'bug') injectDefect();
    if (stage === 'release') addBuild();
    // The bug stage files the defect in one session, then runs the loop in a second.
    let filing = stage === 'bug';
    const started = Date.now();
    const history = [];
    let cost = 0;
    let turns = 0;
    let sessionId;
    let prompt = filing ? `/pitwall:bug ${BUG_REPORT}` : stage === 'release' ? '/pitwall:release' : '/pitwall:continue 1';
    let unmet = ['not run'];
    let error = '';
    console.log(`\n== ${stage}${github ? ` on ${github}` : ''}`);
    try {
      while (turns < maxTurns) {
        turns += 1;
        const args = ['-p', '--plugin-dir', P, '--output-format', 'json', '--permission-mode', 'auto', '--permission-prompts', 'none', '--strict-mcp-config'];
        if (sessionId) args.push('--resume', sessionId);
        args.push('--disallowedTools', 'PowerShell', '--allowedTools', ...allowed, ...(stage === 'e0' || stage === 'bug' || stage === 'release' ? ownerAnswers : []));
        const r = run('claude', args, { cwd: project, env, input: prompt, timeout: 60 * 60 * 1000 });
        let out;
        try {
          out = JSON.parse(r.stdout);
        } catch {
          throw new Error(`claude returned no JSON (exit ${r.status}):\n${r.stdout.slice(-2000)}${r.stderr.slice(-2000)}`);
        }
        if (out.is_error) throw new Error(`claude reported an error: ${out.result ?? out.subtype}`);
        sessionId = out.session_id;
        cost += out.total_cost_usd ?? 0;
        history.push({ who: 'Owner', text: prompt }, { who: 'Assistant', text: String(out.result ?? '') });
        console.log(`  turn ${turns}: ${String(out.result ?? '').split('\n')[0].slice(0, 110)}`);
        if ((stage === 'bug' && !filing) || stage === 'release') {
          // Merged in this turn: the question had to come in an earlier one. Then this turn's question counts.
          if (!fixAsked.merged && (stage === 'release' ? releaseMerged() : fixMerged())) {
            fixAsked.merged = true;
            fixAsked.before = fixAsked.asked;
          }
          if (/\bmerg/i.test(String(out.result ?? '')) && String(out.result ?? '').includes('?')) fixAsked.asked = true;
          if (fixAsked.merged && !fixAsked.before) {
            unmet = promises[stage]();
            error = `the ${stage === 'release' ? 'release' : 'fix'} merged before the scripted owner was asked about its merge`;
            break;
          }
        }
        if (filing) {
          if (filed()) {
            // Filed: the owner starts the loop in a fresh session.
            console.log('  BUG-1 waits in the git directory, confirmed; the loop starts');
            filing = false;
            sessionId = undefined;
            prompt = '/pitwall:continue 1';
            continue;
          }
        } else {
          unmet = promises[stage]();
          if (unmet.length === 0) break;
        }
        const ask = `${SCENARIO}${stage === 'bug' ? `\n${BUG_FACTS}` : ''}\n\n${OWNER_RULES(stage)}\n\nThe conversation so far, oldest first:\n\n${history.slice(-12).map((h) => `${h.who}: ${h.text}`).join('\n\n')}\n\nYour reply as the owner:`;
        const o = run('claude', ['-p', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands'], { cwd: ownerDir, input: ask, timeout: 5 * 60 * 1000 });
        const reply = JSON.parse(o.stdout);
        cost += reply.total_cost_usd ?? 0;
        const { text, question, override } = readOwner(reply.result, history[history.length - 1].text);
        if (question) {
          unscripted.push({ stage, turn: turns, question, override });
          console.log(`  UNSCRIPTED ${override ? 'STOP OVERRIDDEN' : 'QUESTION'}: ${question.slice(0, 160)}`);
        }
        if (/^DONE.?$/i.test(text)) {
          error = 'the conductor stopped, but the stage does not pass its check';
          break;
        }
        prompt = text;
        console.log(`  owner: ${prompt.split('\n')[0].slice(0, 110)}`);
      }
      if (filing && !error) error = `BUG-1 was not filed, confirmed blocking and normal, after ${maxTurns} turns`;
      if (unmet.length && !error) error = `not done after ${maxTurns} turns`;
    } catch (e) {
      error = e.message;
      unmet = promises[stage]?.() ?? unmet;
    }
    const minutes = (Date.now() - started) / 60000;
    const pass = unmet.length === 0;
    if (pass) {
      // The state and the numbers are saved at once, so a run stopped later keeps them.
      const dest = join(stateDir, `${tag}${stage}`);
      rmSync(dest, { recursive: true, force: true });
      mkdirSync(dest, { recursive: true });
      cpSync(project, join(dest, 'project'), { recursive: true });
      if (!github) {
        cpSync(originDir, join(dest, 'origin.git'), { recursive: true });
        cpSync(ghState, join(dest, 'github'), { recursive: true, filter: (src) => !/[\\/](merge-|work-)[^\\/]*$/.test(src) });
      }
      const pluginCommit = process.env.PITWALL_E2E_COMMIT;
      writeFileSync(join(stateDir, `${tag}${stage}.json`), JSON.stringify({ saved: new Date().toISOString(), plugin: version, pluginCommit, github: github || null, turns, minutes, cost, unscripted: unscripted.filter((u) => u.stage === stage).map((u) => u.question), overridden: unscripted.filter((u) => u.stage === stage && u.override).map((u) => u.question), ...(github ? { remote: captureRemote(ghHarness, git, github) } : {}) }) + '\n');
      console.log(`  saved: ${turns} turns, ${minutes.toFixed(1)} min, $${cost.toFixed(2)}, plugin at ${pluginCommit}`);
    } else {
      console.log(`  failed after ${turns} turns, ${minutes.toFixed(1)} min, $${cost.toFixed(2)}`);
    }
    results.push({ stage, pass, turns, minutes, cost, error: pass ? '' : error, unmet });
    if (!pass) break;
  }

  if (github) saveResponses(record, github);
  console.log('\n== results');
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.stage}: ${r.turns} turns, ${r.minutes.toFixed(1)} min, $${r.cost.toFixed(2)}`);
    if (!r.pass) {
      if (r.error) console.log(`  - ${r.error}`);
      for (const u of r.unmet) console.log(`  - ${u}`);
    }
  }
  for (const u of unscripted) console.log(`UNSCRIPTED ${u.override ? 'STOP OVERRIDDEN' : 'QUESTION'} (${u.stage}, turn ${u.turn}): ${u.question}`);
  const passed = results.length === stages.length && results.every((r) => r.pass);
  // A stop the scripted owner overrode is read by a person before the run counts (T4a-AC5).
  console.log(`\nE2E LOOP: ${resultWord(passed, unscripted)}   scratch folder: ${scratch}   saved state: ${stateDir}`);
  return passed ? 0 : 1;
}

// T4a-AC4: the remote state a --github stage saves with its numbers, and its restore before a later stage
// starts from that snapshot. gh(...args) and git(...args) return { status, stdout, stderr }.
const parsed = (r, what) => {
  try {
    if (r.status === 0) return JSON.parse(r.stdout);
  } catch {}
  throw new Error(`${what}: GitHub answered ${r.status}: ${`${r.stderr ?? ''}${r.stdout ?? ''}`.trim().split('\n').pop()}; the run stops here`);
};
function remoteNow(gh, git, repo) {
  const heads = git('ls-remote', '--heads', 'origin');
  if (heads.status !== 0) throw new Error(`git ls-remote origin failed: ${heads.stderr.trim()}; the run stops here`);
  const branches = Object.fromEntries(heads.stdout.split('\n').filter(Boolean).map((l) => l.split('\t')).map(([sha, ref]) => [ref.replace('refs/heads/', ''), sha]));
  const prs = parsed(gh('pr', 'list', '--repo', repo, '--state', 'all', '--limit', '200', '--json', 'number,state,headRefName'), 'listing the PRs');
  return { branches, prs };
}
export function captureRemote(gh, git, repo) {
  const id = parsed(gh('repo', 'view', repo, '--json', 'id'), 'reading the repository').id;
  const { branches, prs } = remoteNow(gh, git, repo);
  return { id, main: branches.main, branches: Object.keys(branches), prs: prs.map((p) => ({ number: p.number, state: p.state })) };
}
// Checks the repository's id before anything else: a different repository, a typo in --github, is never
// touched. Stops when main moved past the snapshot or when GitHub answers anything unexpected; closes
// the PRs and deletes the branches the snapshot does not hold. Returns what it did, one line each.
export function restoreRemote(gh, git, repo, snap) {
  if (!snap?.id) throw new Error('the saved stage holds no remote snapshot (saved before T4a): recreate the repository empty and run from e0');
  const id = parsed(gh('repo', 'view', repo, '--json', 'id'), 'reading the repository').id;
  if (id !== snap.id) throw new Error(`--github ${repo} is not the repository the snapshot was saved from (its id differs): the run stops and changes nothing`);
  const now = remoteNow(gh, git, repo);
  if (now.branches.main !== snap.main) throw new Error(`main on ${repo} moved past the snapshot (${String(now.branches.main).slice(0, 7)}, the snapshot ${String(snap.main).slice(0, 7)}): recreate the repository empty and run from e0`);
  const gone = snap.prs.filter((p) => p.state === 'OPEN' && now.prs.find((q) => q.number === p.number)?.state !== 'OPEN');
  if (gone.length) throw new Error(`PRs open in the snapshot are no longer open: ${gone.map((p) => `#${p.number}`).join(', ')}; recreate the repository empty and run from e0`);
  const done = [];
  // A PR is closed with its branch left in place: the branches are judged on their own below, so a branch
  // the snapshot holds stays even when a later PR came from it.
  for (const p of now.prs.filter((q) => q.state === 'OPEN' && !snap.prs.some((s) => s.number === q.number))) {
    const r = gh('pr', 'close', String(p.number), '--repo', repo);
    if (r.status !== 0) throw new Error(`closing PR #${p.number}: GitHub answered ${r.status}: ${r.stderr.trim().split('\n').pop()}; the run stops here`);
    done.push(`closed PR #${p.number} (${p.headRefName})`);
  }
  for (const b of Object.keys(now.branches).filter((x) => !snap.branches.includes(x))) {
    const r = gh('api', '-X', 'DELETE', `repos/${repo}/git/refs/heads/${b}`);
    if (r.status !== 0) throw new Error(`deleting the branch ${b}: GitHub answered ${r.status}: ${r.stderr.trim().split('\n').pop()}; the run stops here`);
    done.push(`deleted the branch ${b}`);
  }
  // Read again: the repository now holds the snapshot's branches and open PRs, and nothing more.
  if (done.length) {
    const after = remoteNow(gh, git, repo);
    const extraBranches = Object.keys(after.branches).filter((x) => !snap.branches.includes(x));
    const extraPrs = after.prs.filter((q) => q.state === 'OPEN' && !snap.prs.some((s) => s.number === q.number));
    if (after.branches.main !== snap.main || extraBranches.length || extraPrs.length) throw new Error(`after the restore ${repo} still differs from the snapshot (${[...extraBranches.map((b) => `branch ${b}`), ...extraPrs.map((q) => `PR #${q.number}`), ...(after.branches.main !== snap.main ? ['main moved'] : [])].join(', ')}): the run stops here`);
  }
  return done;
}

// The kind of request a gh call makes, as scripts/check.mjs compares the fake with GitHub, or null.
export function kindOf(args) {
  const a = args.join(' ');
  // An answer filtered by gh's own --jq or --template is the session's shape, not GitHub's.
  // (-t is gh pr create's --title, not --template.)
  if (args.some((x) => x === '--jq' || x === '-q' || x === '--template')) return null;
  if (/^repo view\b/.test(a) && args.includes('--json')) return 'repo-view';
  if (/^pr create\b/.test(a)) return 'pr-create';
  if (/^pr list\b/.test(a)) return args.includes('--json') ? 'pr-list' : 'pr-list-text';
  if (/^pr view\b/.test(a) && args.includes('--json')) return 'pr-view';
  if (/^pr merge\b/.test(a)) return 'pr-merge';
  if (/^pr checks\b/.test(a) && !args.includes('--watch')) return 'pr-checks';
  if (/^pr comment\b/.test(a)) return 'pr-comment';
  if (/^pr close\b/.test(a)) return 'pr-close';
  if (args[0] === 'api' && args.includes('DELETE') && /\/git\/refs\/heads\//.test(args.join(' '))) return 'api-ref-delete';
  if (/^run list\b/.test(a) && args.includes('--json')) return 'run-list';
  if (args[0] !== 'api') return null;
  const path = args.find((x) => /^\/?repos\//.test(x)) ?? '';
  const write = args.includes('-X') && args[args.indexOf('-X') + 1] !== 'GET';
  if (/\/statuses\/[0-9a-f]{40}$/.test(path)) return 'api-status-post';
  if (/\/commits\/[0-9a-f]{40}\/statuses$/.test(path)) return 'api-statuses';
  if (/\/commits\/[0-9a-f]{40}\/check-runs$/.test(path)) return 'api-check-runs';
  if (/\/commits\/[0-9a-f]{40}$/.test(path)) return 'api-commit';
  if (/\/rules\/branches\/[^/]+$/.test(path)) return 'api-rules';
  if (/\/branches\/[^/]+\/protection$/.test(path)) return write ? 'api-protection-put' : 'api-protection';
  if (/\/branches\/[^/]+$/.test(path)) return 'api-branch';
  return null;
}

// One answer per kind, scrubbed of the account, the repository, emails and paths.
export function saveResponses(file, repo) {
  if (!existsSync(file)) return;
  const [owner, name] = repo.split('/');
  const scrub = (text) =>
    String(text)
      .split(repo).join('<owner>/<repo>')
      .replace(new RegExp(`\\b${owner}\\b`, 'g'), '<owner>')
      .replace(new RegExp(`\\b${name}\\b`, 'g'), '<repo>')
      .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>')
      .split(homedir()).join('<home>')
      .split(homedir().split('\\').join('/')).join('<home>');
  const out = join(root, 'scripts', 'github-responses');
  const cli = run('gh', ['--version']).stdout.split('\n')[0].trim();
  const seen = new Set(existsSync(out) ? readdirSync(out).map((f) => f.replace(/\.json$/, '')) : []);
  mkdirSync(out, { recursive: true });
  const calls = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const written = [];
  for (const c of calls) {
    const kind = kindOf(c.args);
    // The first answer of each kind; a failed call counts only where failure is the answer: protection and rulesets
    // on GitHub Free, and the checks of a PR with a red one.
    if (!kind || written.includes(kind) || (c.status !== 0 && !/^(api-protection|api-rules|pr-checks)$/.test(kind))) continue;
    // The harness's reads of the snapshot ask other fields than the loop does (the repository's id): only
    // its closing and deleting are recorded (T4a-AC4).
    if (c.caller === 'harness' && !/^(pr-close|api-ref-delete)$/.test(kind)) continue;
    let body = c.stdout;
    try {
      body = JSON.parse(c.stdout);
    } catch {}
    // An account in the answer (a status's creator, a repository's owner) keeps its shape, not its identity.
    const anonymous = (v) => {
      if (Array.isArray(v)) return v.map(anonymous);
      if (!v || typeof v !== 'object') return v;
      const o = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, anonymous(x)]));
      if ('login' in o) for (const k of Object.keys(o)) if (k !== 'login' && k !== 'type') o[k] = typeof o[k] === 'number' ? 0 : typeof o[k] === 'string' ? `<${k}>` : o[k];
      // A commit's author or committer: a person's name beside the email.
      if ('email' in o && typeof o.name === 'string') o.name = '<name>';
      // A repository's numeric identity, beside the name already scrubbed.
      if ('full_name' in o || /\/repos\/[^/]+\/[^/]+$/.test(String(o.url ?? ''))) for (const k of ['id', 'node_id']) if (k in o) o[k] = typeof o[k] === 'number' ? 0 : `<${k}>`;
      // Every node id: GitHub's encode the repository's numeric id (base64url msgpack), whatever object holds them;
      // gh's --json gives them as a string "id" (a repository's "R_...", a PR's "PR_...").
      for (const k of Object.keys(o)) if ((/node_id$/.test(k) || k === 'id') && typeof o[k] === 'string') o[k] = `<${k}>`;
      // A commit's signature check repeats the raw commit, author's name included.
      for (const k of ['payload', 'signature']) if ('verified' in o && typeof o[k] === 'string') o[k] = `<${k}>`;
      return o;
    };
    body = anonymous(body);
    writeFileSync(join(out, `${kind}.json`), JSON.stringify({ gh: cli, recorded: new Date().toISOString().slice(0, 10), args: JSON.parse(scrub(JSON.stringify(c.args))), status: c.status, stdout: JSON.parse(scrub(JSON.stringify(body))), stderr: scrub(c.stderr.trim().split('\n').pop() ?? '') }, null, 2) + '\n');
    written.push(kind);
  }
  console.log(`recorded GitHub's answers for ${written.length} kinds of request into scripts/github-responses/: ${written.sort().join(', ')}${seen.size ? ` (replacing ${seen.size})` : ''}`);
}
