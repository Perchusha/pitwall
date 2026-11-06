#!/usr/bin/env node
// Headless runs of pitwall's stage skills with a scripted owner (T1-AC7).
//
//   node scripts/e2e.mjs [--until kickoff|discovery|decide] [--max-turns 30]
//   node scripts/e2e.mjs --from discovery|decide --seed <earlier e2e project> [--seed-ref <commit>] [--until ...]
//
// --from starts at a later stage from a copy of an earlier run's project: the
// seed is cloned, main and the planning branch are set from it (the planning
// branch at --seed-ref, by default the seed's own), and the clone's remote is
// removed so nothing is pushed back.
//
// Not part of scripts/check.mjs or CI: it needs a signed-in Claude Code CLI and
// spends the subscription. The owner runs it before a PR. Like scripts/check.mjs,
// it needs `claude` on the PATH as an executable (the native install).
//
// In a scratch folder it starts each stage as a fresh headless session with
// the plugin loaded from this checkout, and a second, tool-less session plays
// the owner of the lite system in SPEC 10 and answers each question. gh runs
// signed out, so nothing reaches GitHub, and protect.mjs runs a logging fake gh
// that is signed out too: kickoff must run it, and it must hand over. A stage passes when its files pass `docs-check.mjs --stage` and the git
// state it promises holds. It never looks at the wording of the model's replies.
// The scratch folder is kept for inspection and its path printed.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = join(root, 'plugins', 'pitwall');
const cfg = JSON.parse(readFileSync(join(plugin, 'config', 'defaults.json'), 'utf8'));

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const STAGES = ['kickoff', 'discovery', 'decide'];
const until = opt('until', 'decide');
const from = opt('from', 'kickoff');
const seed = opt('seed', '');
const seedRef = opt('seed-ref', '');
const stages = STAGES.slice(STAGES.indexOf(from), STAGES.indexOf(until) + 1);
const maxTurns = Number(opt('max-turns', '30'));
const flags = ['--until', '--max-turns', '--from', '--seed', '--seed-ref'];
if (!STAGES.includes(until) || !STAGES.includes(from) || stages.length === 0 || (from !== 'kickoff') !== Boolean(seed) || !(maxTurns > 0) || argv.some((a) => a.startsWith('--') && !flags.includes(a))) {
  console.error('usage: node scripts/e2e.mjs [--until kickoff|discovery|decide] [--max-turns 30]\n       node scripts/e2e.mjs --from discovery|decide --seed <earlier e2e project> [--seed-ref <commit>] [--until ...]');
  process.exit(2);
}

const IDEA = 'A desktop app that reminds me to stand up and move every 45 minutes';
const SCENARIO = `You are the owner of a new project: ${IDEA}.
Facts you answer from:
- Only you use it, on your own Windows and macOS laptops. No accounts, no server, no database beyond a local settings file, no money, no personal data leaves the machine.
- It shows a reminder every 45 minutes of active use, lets you snooze for 10 minutes, and pauses when the computer is idle or locked.
- Out of scope: phones, teams, statistics dashboards, cloud sync.
- Monthly budget: zero. Platforms: Windows and macOS desktop. Hosting: none, it is a local app; releases go on GitHub. Personal data: none. Licence: MIT, open source. Time for reviews: about 30 minutes a day.
- You expect 2 or 3 epics. The project name is move-reminder.`;
const OWNER_RULES = `Answer as this owner, in English, in one to three sentences, and only what was asked.
- When asked to confirm or approve something that fits the facts, confirm it.
- When offered options with a recommendation, accept the recommendation unless it contradicts the facts.
- When asked whether to create a GitHub repository, push, or set up GitHub now, answer: not now, later.
- When the assistant has run a command that you are told to run yourself, say you will do it later, and ask it to go on.
- When the assistant asks nothing and reports that the stage is done, reply exactly: DONE`;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.error) throw new Error(`${cmd}: ${r.error.message}`);
  return r;
}

// Scratch folders: the project, an empty gh config (signed out), an empty folder for the owner.
const scratch = mkdtempSync(join(tmpdir(), 'pitwall-e2e-'));
const project = join(scratch, 'move-reminder');
const ghConfig = join(scratch, 'gh');
const ownerDir = join(scratch, 'owner');
for (const d of [project, ghConfig, ownerDir]) mkdirSync(d, { recursive: true });
// protect.mjs gets a fake gh that logs every call and is signed out, so the kickoff check can see it ran.
const fakeGh = join(scratch, 'fake-gh.mjs');
const ghLog = join(scratch, 'protect-gh.log');
writeFileSync(
  fakeGh,
  [
    "import { appendFileSync } from 'node:fs';",
    'const a = process.argv.slice(2);',
    "appendFileSync(process.env.E2E_GH_LOG, a.join(' ') + '\\n');",
    "if (a[0] === '--version') { console.log('gh version 0.0.0 (e2e fake)'); process.exit(0); }",
    "console.error('You are not logged into any GitHub hosts.');",
    'process.exit(1);',
    '',
  ].join('\n'),
);
writeFileSync(ghLog, '');
// The commit identity comes from the environment, so a fresh run starts from a folder with
// nothing in it, and kickoff's preflight has to set up git itself.
const identity = { GIT_AUTHOR_NAME: 'pitwall e2e', GIT_AUTHOR_EMAIL: 'e2e@pitwall.invalid', GIT_COMMITTER_NAME: 'pitwall e2e', GIT_COMMITTER_EMAIL: 'e2e@pitwall.invalid' };
const env = { ...process.env, ...identity, GH_CONFIG_DIR: ghConfig, PITWALL_GH: JSON.stringify([process.execPath, fakeGh]), E2E_GH_LOG: ghLog, GIT_CEILING_DIRECTORIES: scratch };
for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) delete env[k];
if (run('gh', ['auth', 'status'], { env }).status === 0) {
  console.error('e2e: gh is still signed in with an empty GH_CONFIG_DIR; refusing to run so nothing reaches GitHub.');
  process.exit(1);
}
const git = (...args) => run('git', args, { cwd: project, env });
if (seed) {
  const plan = cfg.planning.branch;
  const cloned = run('git', ['clone', '-q', '--no-checkout', resolve(seed), project], { env });
  if (cloned.status !== 0) throw new Error(`cannot clone the seed ${seed}: ${cloned.stderr}`);
  for (const step of [['checkout', '-q', '-B', 'main', 'origin/main'], ['checkout', '-q', '-B', plan, seedRef || `origin/${plan}`], ['remote', 'remove', 'origin']]) {
    const r = git(...step);
    if (r.status !== 0) throw new Error(`seed: git ${step.join(' ')} failed: ${r.stderr}`);
  }
  console.log(`seeded from ${seed} at ${git('log', '--oneline', '-1').stdout.trim()}`);
}

const allowed = ['Bash(node *)', 'Bash(git *)', 'Bash(gh *)', 'Bash(ls *)', 'Bash(cd *)', 'Bash(echo *)', 'Bash(cat *)', 'Bash(pwd)', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Agent'];

function agentTurn(prompt, sessionId) {
  // Auto mode with an allow list: nobody can answer a prompt here. No MCP servers: the run
  // reaches the web only through WebSearch and WebFetch, and GitHub not at all (gh is signed out).
  const args = ['-p', '--plugin-dir', plugin, '--output-format', 'json', '--permission-mode', 'auto', '--permission-prompts', 'none', '--strict-mcp-config'];
  if (sessionId) args.push('--resume', sessionId);
  // Bash only, so the allow list below covers every command on Windows too.
  args.push('--disallowedTools', 'PowerShell', '--allowedTools', ...allowed);
  const r = run('claude', args, { cwd: project, env, input: prompt, timeout: 30 * 60 * 1000 });
  let out;
  try {
    out = JSON.parse(r.stdout);
  } catch {
    throw new Error(`claude returned no JSON (exit ${r.status}):\n${r.stdout.slice(-2000)}${r.stderr.slice(-2000)}`);
  }
  if (out.is_error) throw new Error(`claude reported an error: ${out.result ?? out.subtype}`);
  return out;
}

function ownerReply(history) {
  const prompt = `${SCENARIO}\n\n${OWNER_RULES}\n\nThe conversation so far, oldest first:\n\n${history.map((h) => `${h.who}: ${h.text}`).join('\n\n')}\n\nYour reply as the owner:`;
  const r = run('claude', ['-p', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands'], { cwd: ownerDir, input: prompt, timeout: 5 * 60 * 1000 });
  let out;
  try {
    out = JSON.parse(r.stdout);
  } catch {
    throw new Error(`the owner session returned no JSON (exit ${r.status}):
${r.stdout.slice(-1000)}${r.stderr.slice(-1000)}`);
  }
  return { text: String(out.result ?? '').trim(), cost: out.total_cost_usd ?? 0 };
}

const docsCheck = (stage) => run(process.execPath, [join(plugin, 'scripts', 'docs-check.mjs'), '--root', project, '--stage', stage], { env });
const branch = () => git('branch', '--show-current').stdout.trim();
const clean = () => git('status', '--porcelain').stdout.trim() === '';
const count = (ref) => Number(git('rev-list', '--count', ref).stdout.trim() || 0);
const touched = (path) => git('log', '--format=%H', `main..HEAD`, '--', path).stdout.trim() !== '';
const settings = () => JSON.parse(readFileSync(join(project, '.claude', 'pitwall.json'), 'utf8'));
const planBranch = cfg.planning.branch;

// What each stage promises about git, beyond its docs check. Returns the unmet promises.
const promises = {
  kickoff: () => {
    const unmet = [];
    if (count('main') !== 1) unmet.push(`main has ${count('main')} commits, expected the skeleton only`);
    if (branch() !== planBranch) unmet.push(`on branch "${branch()}", expected ${planBranch}`);
    if (!clean()) unmet.push('the working tree is not clean');
    if (!git('ls-files', '-s', 'scripts/gate').stdout.startsWith('100755')) unmet.push('scripts/gate is not executable in the git index');
    try {
      if (settings().mergeProtection !== 'pending') unmet.push(`mergeProtection is "${settings().mergeProtection}", expected pending (gh is signed out)`);
    } catch {
      unmet.push('.claude/pitwall.json does not parse');
    }
    if (run('bash', ['scripts/gate', '--full'], { cwd: project, env }).status !== 0) unmet.push('scripts/gate --full fails');
    const calls = readFileSync(ghLog, 'utf8');
    if (!/^auth status/m.test(calls)) unmet.push('protect.mjs did not run (no gh auth status call in its log)');
    if (/PUT/.test(calls)) unmet.push('protect.mjs tried to write with a signed-out gh');
    return unmet;
  },
  discovery: () => {
    const unmet = [];
    if (branch() !== planBranch) unmet.push(`on branch "${branch()}", expected ${planBranch}`);
    if (!clean()) unmet.push('the working tree is not clean');
    if (!touched('docs/DISCOVERY.md')) unmet.push(`docs/DISCOVERY.md is not committed on ${planBranch}`);
    if (count('main') !== 1) unmet.push('main changed');
    return unmet;
  },
  decide: () => {
    const unmet = [];
    if (branch() !== planBranch) unmet.push(`on branch "${branch()}", expected ${planBranch}`);
    if (!clean()) unmet.push('the working tree is not clean');
    if (!touched('docs/STACK.md')) unmet.push(`docs/STACK.md is not committed on ${planBranch}`);
    if (!touched('docs/adr')) unmet.push(`no ADR committed on ${planBranch}`);
    if (count('main') !== 1) unmet.push('main changed');
    return unmet;
  },
};

function status(stage) {
  const check = docsCheck(stage);
  const unmet = check.status === 0 ? promises[stage]() : [];
  return { done: check.status === 0 && unmet.length === 0, check: check.stdout.trim(), unmet };
}

const results = [];
for (const stage of stages) {
  const started = Date.now();
  const history = [];
  let cost = 0;
  let turns = 0;
  let sessionId;
  let prompt = stage === 'kickoff' ? `/pitwall:kickoff ${IDEA}` : `/pitwall:${stage}`;
  let verdict = { done: false };
  let error = '';
  console.log(`\n== ${stage}`);
  try {
    while (turns < maxTurns) {
      turns += 1;
      const out = agentTurn(prompt, sessionId);
      sessionId = out.session_id;
      cost += out.total_cost_usd ?? 0;
      history.push({ who: 'Owner', text: prompt }, { who: 'Assistant', text: String(out.result ?? '') });
      console.log(`  turn ${turns}: ${String(out.result ?? '').split('\n')[0].slice(0, 110)}`);
      verdict = status(stage);
      if (verdict.done) break;
      const reply = ownerReply(history.slice(-12));
      cost += reply.cost;
      if (/^DONE.?$/i.test(reply.text)) {
        error = 'the skill reported done, but the stage does not pass its check';
        break;
      }
      prompt = reply.text;
      console.log(`  owner: ${prompt.split('\n')[0].slice(0, 110)}`);
    }
    if (!verdict.done && !error) error = `not done after ${maxTurns} turns`;
  } catch (err) {
    error = err.message;
  }
  if (!verdict.done) verdict = status(stage);
  results.push({ stage, pass: verdict.done, turns, cost, minutes: (Date.now() - started) / 60000, error: verdict.done ? '' : error, check: verdict.check, unmet: verdict.unmet });
  if (!verdict.done) break;
}

console.log('\n== results');
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.stage}: ${r.turns} turns, ${r.minutes.toFixed(1)} min, $${r.cost.toFixed(2)}`);
  if (!r.pass) {
    if (r.error) console.log(`  - ${r.error}`);
    if (r.check && !r.check.startsWith('PASS')) console.log(r.check.replace(/^/gm, '  '));
    for (const u of r.unmet ?? []) console.log(`  - ${u}`);
  }
}
const passed = results.length === stages.length && results.every((r) => r.pass);
console.log(`\nE2E: ${passed ? 'PASS' : 'FAIL'}   scratch folder: ${scratch}`);
process.exit(passed ? 0 : 1);
