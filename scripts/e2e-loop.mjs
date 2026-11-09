// The headless runs of the epic loop (T3b-AC7), started by `node scripts/e2e.mjs` with the stages e0
// and e1. Not part of scripts/check.mjs or CI: it needs a signed-in Claude Code CLI and spends the
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
// the rules ADR-0010 writes. A stage passes on what git and GitHub hold afterwards, never on the
// model's wording, and saves its state and its numbers at once.
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

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = join(root, 'plugins', 'pitwall');
const P = plugin.split('\\').join('/');
const version = JSON.parse(readFileSync(join(plugin, '.claude-plugin', 'plugin.json'), 'utf8')).version;
export const LOOP_STAGES = ['e0', 'e1'];

const IDEA = 'A desktop app that reminds me to stand up and move every 45 minutes';
const SCENARIO = `You are the owner of a project: ${IDEA}. Its plan is merged, and the epic loop builds it now.
Facts you answer from:
- Only you use it, on your own Windows and macOS laptops. No accounts, no server, no money, no personal data leaves the machine.
- It shows a reminder every 45 minutes of active use, lets you snooze for 10 minutes, and pauses when the computer is idle or locked.
- The GitHub repository exists and gh is signed in. It is private on GitHub Free, so pitwall's hook guards main (merge protection local-hook).
- You want the plan built as the epics say. For a choice the epics and ADRs leave open, you take the assistant's recommendation.`;
const OWNER_RULES = `Answer as this owner, in English, in one to three sentences, and only what was asked.
- When asked to set up or record merge protection, or to run protect.mjs: yes.
- When asked whether low and normal risk epics may merge without you: no, every merge waits for you.
- When asked whether to merge an epic or a fix now: yes.
- When asked a question about an epic (clarification, a NEEDS_OWNER question, an option to pick): answer from the facts; when the facts do not say, accept the assistant's recommendation.
- When asked to accept a risk: accept it with the fallback the assistant proposes.
- When asked whether to go on after the implementer limit or after a review round: yes.
- When the assistant hands you a command to run yourself in a terminal: say you will run it later, and ask it to go on.
- When the assistant asks nothing and reports that it stopped or that the change is merged, reply exactly: DONE`;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.error) throw new Error(`${cmd}: ${r.error.message}`);
  return r;
}

export async function runLoop({ stages, stateDir, maxTurns, github }) {
  const tag = github ? 'github-' : '';
  const scratch = mkdtempSync(join(tmpdir(), 'pitwall-loop-'));
  const project = join(scratch, 'move-reminder');
  const originDir = join(scratch, 'origin.git');
  const ghState = join(scratch, 'github');
  const bin = join(scratch, 'bin');
  const ownerDir = join(scratch, 'owner');
  const record = join(scratch, 'github-calls.jsonl');
  for (const d of [bin, ownerDir, ghState]) mkdirSync(d, { recursive: true });

  // gh for the session and for the plugin's scripts: the fake GitHub, or the real one, recorded.
  const realGh = github ? run(process.platform === 'win32' ? 'where' : 'which', ['gh']).stdout.split(/\r?\n/)[0].trim() : '';
  const ghScript = github ? join(root, 'scripts', 'gh-record.mjs') : join(root, 'scripts', 'fake-gh.mjs');
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
    ...(github ? { GH_REAL: realGh, GH_RECORD: record } : { FAKE_GH_LIVE: ghState, FAKE_GH_ORIGIN: originDir, FAKE_GH_REPO: 'e2e/move-reminder', GH_CONFIG_DIR: join(scratch, 'gh-config') }),
  };
  // The session's commands are never Claude Code's own variable: the owner's script refuses under it.
  const ownerEnv = { ...env };
  delete ownerEnv.CLAUDECODE;
  if (!github) for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) delete env[k];
  const git = (...args) => run('git', args, { cwd: project, env });
  const script = (name, args, e = env) => run(process.execPath, [join(plugin, 'scripts', name), ...args], { cwd: project, env: e });
  const gh = (...args) => run(process.execPath, [ghScript, ...args], { cwd: project, env });

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
    const spikes = git('for-each-ref', '--format=%(refname:short)', 'refs/heads/spike/').stdout.split('\n').filter(Boolean);
    const push = git('push', '-q', 'origin', 'main', 'plan/initial', ...spikes);
    if (push.status !== 0) throw new Error(`push failed: ${push.stderr}`);
    // The world before the epic loop: the plan PR, reviewed, its gate green, merged after the owner's yes.
    gh('pr', 'create', '--base', 'main', '--head', 'plan/initial', '--title', 'Plan: move-reminder', '--body', 'Stages 1 to 5, from the headless planning run.');
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
    const seed = join(stateDir, `${tag}e0`);
    if (!existsSync(join(seed, 'project', '.git'))) throw new Error(`no saved e0 at ${seed}: run node scripts/e2e.mjs --from e0${github ? ` --github ${github}` : ''} first`);
    cpSync(join(seed, 'project'), project, { recursive: true });
    if (!github) {
      cpSync(join(seed, 'origin.git'), originDir, { recursive: true });
      cpSync(join(seed, 'github'), ghState, { recursive: true });
      git('remote', 'set-url', 'origin', originDir);
    }
    const meta = existsSync(join(stateDir, `${tag}e0.json`)) ? readFileSync(join(stateDir, `${tag}e0.json`), 'utf8').trim() : '';
    console.log(`seeded from ${seed} at ${git('log', '--oneline', '-1').stdout.trim()} ${meta}`);
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
      if (!/\bE0\b/.test(shown('docs/JOURNAL.md').stdout)) unmet.push('docs/JOURNAL.md on main has no entry for E0');
      if (!remote('ls-tree', '--name-only', 'origin/main', 'docs/reviews/').stdout.split('\n').some((f) => /^docs\/reviews\/E1-.+\.md$/.test(f))) unmet.push('no review file of E1 on main');
      return unmet;
    },
  };

  const allowed = [
    `Bash(node "${P}/scripts/docs-check.mjs" *)`, `Bash(node "${P}/scripts/protect.mjs")`, `Bash(node "${P}/scripts/protect.mjs" *)`,
    'Bash(git *)', 'Bash(gh *)', 'Bash(npm *)', 'Bash(npx *)', 'Bash(bash scripts/gate *)', 'Bash(scripts/gate *)', 'Bash(ls *)', 'Bash(cd *)', 'Bash(echo *)', 'Bash(cat *)', 'Bash(pwd)', 'Bash(mkdir *)',
    'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Agent',
  ];
  // e0: the owner said no to merges without them, so they answer each prompt for the status and the merge; standing in for those answers.
  const ownerAnswers = [`Bash(node "${P}/scripts/review-status.mjs" *)`, `Bash(node "${P}/scripts/merge.mjs" *)`];

  const results = [];
  for (const stage of stages) {
    if (stage === 'e1') {
      const choice = script('merge-choice.mjs', ['--allow', '--project', project], ownerEnv);
      if (choice.status !== 0) throw new Error(`merge-choice.mjs --allow: ${choice.stdout}${choice.stderr}`);
      console.log('the owner allowed low and normal risk to merge without them (merge-choice.mjs --allow)');
    }
    const started = Date.now();
    const history = [];
    let cost = 0;
    let turns = 0;
    let sessionId;
    let prompt = '/pitwall:continue 1';
    let unmet = ['not run'];
    let error = '';
    console.log(`\n== ${stage}${github ? ` on ${github}` : ''}`);
    try {
      while (turns < maxTurns) {
        turns += 1;
        const args = ['-p', '--plugin-dir', P, '--output-format', 'json', '--permission-mode', 'auto', '--permission-prompts', 'none', '--strict-mcp-config'];
        if (sessionId) args.push('--resume', sessionId);
        args.push('--disallowedTools', 'PowerShell', '--allowedTools', ...allowed, ...(stage === 'e0' ? ownerAnswers : []));
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
        unmet = promises[stage]();
        if (unmet.length === 0) break;
        const ask = `${SCENARIO}\n\n${OWNER_RULES}\n\nThe conversation so far, oldest first:\n\n${history.slice(-12).map((h) => `${h.who}: ${h.text}`).join('\n\n')}\n\nYour reply as the owner:`;
        const o = run('claude', ['-p', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands'], { cwd: ownerDir, input: ask, timeout: 5 * 60 * 1000 });
        const reply = JSON.parse(o.stdout);
        cost += reply.total_cost_usd ?? 0;
        const text = String(reply.result ?? '').trim();
        if (/^DONE.?$/i.test(text)) {
          error = 'the conductor stopped, but the stage does not pass its check';
          break;
        }
        prompt = text;
        console.log(`  owner: ${prompt.split('\n')[0].slice(0, 110)}`);
      }
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
      const pluginCommit = run('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).stdout.trim();
      writeFileSync(join(stateDir, `${tag}${stage}.json`), JSON.stringify({ saved: new Date().toISOString(), plugin: version, pluginCommit, github: github || null, turns, minutes, cost }) + '\n');
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
  const passed = results.length === stages.length && results.every((r) => r.pass);
  console.log(`\nE2E LOOP: ${passed ? 'PASS' : 'FAIL'}   scratch folder: ${scratch}   saved state: ${stateDir}`);
  return passed ? 0 : 1;
}

// The kind of request a gh call makes, as scripts/check.mjs compares the fake with GitHub, or null.
export function kindOf(args) {
  const a = args.join(' ');
  if (/^repo view\b/.test(a) && args.includes('--json')) return 'repo-view';
  if (/^pr create\b/.test(a)) return 'pr-create';
  if (/^pr list\b/.test(a) && args.includes('--json')) return 'pr-list';
  if (/^pr view\b/.test(a) && args.includes('--json')) return 'pr-view';
  if (/^pr merge\b/.test(a)) return 'pr-merge';
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
function saveResponses(file, repo) {
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
    // The first answer of each kind; a failed call counts only where failure is the answer (protection on GitHub Free).
    if (!kind || written.includes(kind) || (c.status !== 0 && !/^api-protection/.test(kind))) continue;
    let body = c.stdout;
    try {
      body = JSON.parse(c.stdout);
    } catch {}
    writeFileSync(join(out, `${kind}.json`), JSON.stringify({ gh: cli, recorded: new Date().toISOString().slice(0, 10), args: JSON.parse(scrub(JSON.stringify(c.args))), status: c.status, stdout: JSON.parse(scrub(JSON.stringify(body))), stderr: scrub(c.stderr.trim().split('\n').pop() ?? '') }, null, 2) + '\n');
    written.push(kind);
  }
  console.log(`recorded GitHub's answers for ${written.length} kinds of request into scripts/github-responses/: ${written.sort().join(', ')}${seen.size ? ` (replacing ${seen.size})` : ''}`);
}
