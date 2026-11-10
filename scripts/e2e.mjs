#!/usr/bin/env node
// Headless runs of pitwall's stage skills with a scripted owner (T1-AC7, T2-AC7, T3b-AC7).
//
//   node scripts/e2e.mjs [--from <stage>] [--until <stage>] [--max-turns 30] [--state <dir>] [--seed <project>] [--github <owner/repo>] [--log <file>]
//   node scripts/e2e.mjs --hooks [--record]     the hooks alone (scripts/e2e-hooks.mjs, T3a-AC8)
//
// Stages, in order: kickoff, discovery, decide, spike, plan, then the epic loop's e0 and e1
// (scripts/e2e-loop.mjs). With no flags it runs e1 from the state e0 saved, the cheap run after a
// change; --from e0 runs E0 and E1, the run before a PR; --until plan runs the planning stages from
// kickoff. A run is either planning stages or loop stages. --github <owner/repo> runs the loop
// stages against an empty private repository the owner created, and records GitHub's answers.
// A planning run goes from --from (default kickoff) to --until (default plan). Every stage that passes saves the
// project as it left it in the state folder (default ~/.cache/pitwall-e2e/<stage>),
// and a run that starts later starts from the state the stage before it saved: that
// is the normal way to run one stage again without paying for the ones before it.
// --seed <project> starts from that project folder instead.
//
// Not part of scripts/check.mjs or CI: it needs a signed-in Claude Code CLI and
// spends the subscription. The owner runs it before a PR. Like scripts/check.mjs,
// it needs `claude` on the PATH as an executable (the native install).
//
// In a scratch folder it starts each stage as a fresh headless session with the
// plugin loaded from this checkout, and a second, tool-less session plays the owner
// of the lite system in SPEC 10 and answers each question. gh runs signed out, so
// nothing reaches GitHub, and the plugin's scripts run a logging fake gh that is
// signed out too: kickoff must run protect.mjs, the plan reviewer review-status.mjs,
// and each must hand over without a write. A stage passes when its files pass
// `docs-check.mjs --stage` and the git state it promises holds. It never looks at the
// wording of the model's replies. The scratch folder is kept and its path printed.

import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = join(root, 'plugins', 'pitwall');
const cfg = JSON.parse(readFileSync(join(plugin, 'config', 'defaults.json'), 'utf8'));
const version = JSON.parse(readFileSync(join(plugin, '.claude-plugin', 'plugin.json'), 'utf8')).version;

let argv = process.argv.slice(2);
// --log <file>: everything the run prints goes to that file too, so the owner can run it in a terminal of
// their own, away from any Claude Code session that a restart could end, and the session reads the file.
const logAt = argv.indexOf('--log');
if (logAt >= 0) {
  const file = resolve(argv[logAt + 1] ?? '');
  if (!argv[logAt + 1] || argv[logAt + 1].startsWith('--')) {
    console.error('usage: --log <file>');
    process.exit(2);
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '');
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream);
    stream.write = (chunk, ...rest) => {
      appendFileSync(file, chunk);
      return write(chunk, ...rest);
    };
  }
  argv = [...argv.slice(0, logAt), ...argv.slice(logAt + 2)];
}
// The first line of every run: which plugin its sessions load. Always this checkout through --plugin-dir,
// never a copy installed from a marketplace, which the project's own settings would load beside it.
const pluginCommit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
const dirty = spawnSync('git', ['status', '--porcelain', '--', 'plugins'], { cwd: root, encoding: 'utf8' }).stdout.trim() ? ', with uncommitted changes' : '';
const cliVersion = spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout?.trim().split(' ')[0] ?? '?';
console.log(`e2e: pitwall ${version} from ${plugin.split('\\').join('/')} at ${pluginCommit}${dirty} (--plugin-dir), Claude Code ${cliVersion}`);
const installed = spawnSync('claude', ['plugin', 'list'], { encoding: 'utf8' }).stdout ?? '';
if (/\bpitwall@/.test(installed)) {
  console.error('e2e: pitwall is installed from a marketplace (claude plugin list), and the test project enables pitwall@pitwall, so its sessions would load that copy beside this checkout. Uninstall it (claude plugin uninstall pitwall@pitwall) or run with HOME set to a scratch folder.');
  process.exit(2);
}
// The hooks have a run of their own (T3a-AC8): scripts/e2e-hooks.mjs, which exits when done.
if (argv[0] === '--hooks') {
  if (argv.slice(1).some((a) => a !== '--record')) {
    console.error('usage: node scripts/e2e.mjs --hooks [--record]');
    process.exit(2);
  }
  await import('./e2e-hooks.mjs');
}
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const STAGES = ['kickoff', 'discovery', 'decide', 'spike', 'plan'];
const LOOP = ['e0', 'e1'];
const ALL = [...STAGES, ...LOOP];
const fromArg = opt('from', '');
const untilArg = opt('until', '');
// No flags: e1 from the saved e0 (owner, T3b). --until a planning stage alone: from kickoff, as before.
const from = fromArg || (STAGES.includes(untilArg) ? 'kickoff' : 'e1');
const until = untilArg || (STAGES.includes(from) ? 'plan' : 'e1');
const seedArg = opt('seed', '');
const github = opt('github', '');
const stateDir = resolve(opt('state', join(homedir(), '.cache', 'pitwall-e2e')));
const maxTurns = Number(opt('max-turns', '30'));
const flags = ['--from', '--until', '--max-turns', '--state', '--seed', '--github'];
const usage = 'usage: node scripts/e2e.mjs [--from <stage>] [--until <stage>] [--max-turns 30] [--state <dir>] [--seed <project>] [--github <owner/repo>] [--log <file>]\n       stages: ' + ALL.join(', ') + ' (a run is planning stages or loop stages)';
const loop = LOOP.includes(from) && LOOP.includes(until);
const span = ALL.slice(ALL.indexOf(from), ALL.indexOf(until) + 1);
const bad = !ALL.includes(from) || !ALL.includes(until) || span.length === 0 || (!loop && span.some((x) => LOOP.includes(x))) || (loop && seedArg) || (!loop && github) || (github && !/^[\w.-]+\/[\w.-]+$/.test(github));
if (bad || (from === 'kickoff' && seedArg) || !(maxTurns > 0) || argv.some((a) => a.startsWith('--') && !flags.includes(a))) {
  console.error(usage);
  process.exit(2);
}
if (loop) {
  const { runLoop } = await import('./e2e-loop.mjs');
  process.exit(await runLoop({ stages: span, stateDir, maxTurns, github }));
}
const stages = span;
// A later stage starts from a project: the seed, or what the stage before it saved.
const seed = from === 'kickoff' ? '' : resolve(seedArg || join(stateDir, STAGES[STAGES.indexOf(from) - 1]));
if (seed && !existsSync(join(seed, '.git'))) {
  console.error(`e2e: no saved project at ${seed}. Run the stages before ${from} first (node scripts/e2e.mjs --until ${STAGES[STAGES.indexOf(from) - 1]}), or pass --seed <project>.`);
  process.exit(2);
}

const IDEA = 'A desktop app that reminds me to stand up and move every 45 minutes';
const SCENARIO = `You are the owner of a new project: ${IDEA}.
Facts you answer from:
- Only you use it, on your own Windows and macOS laptops. No accounts, no server, no database beyond a local settings file, no money, no personal data leaves the machine.
- It shows a reminder every 45 minutes of active use, lets you snooze for 10 minutes, and pauses when the computer is idle or locked.
- Out of scope: phones, teams, statistics dashboards, cloud sync.
- Monthly budget: zero. Platforms: Windows and macOS desktop. Hosting: none, it is a local app; releases go on GitHub. Personal data: none. Licence: MIT, open source. Time for reviews: about 30 minutes a day.
- You expect 2 or 3 epics. The project name is move-reminder.
- Launch: no app stores, the installers are attached to GitHub releases; support is GitHub issues; no domain, no analytics.
- A spike: yes, run one on the riskiest assumption, even though the lite level makes it optional. Accept the criterion the assistant proposes if it has a number.
- When asked to measure something by hand, say that you ran it as described today and give numbers that meet the criterion the assistant proposed.`;
const OWNER_RULES = `Answer as this owner, in English, in one to three sentences, and only what was asked.
- When asked to confirm or approve something that fits the facts, confirm it.
- When offered options with a recommendation, accept the recommendation unless it contradicts the facts.
- When shown the plan, accept it as drafted: no changes, and no further spike (one spike is enough for this project).
- When asked to accept a risk, accept it with the fallback the assistant proposes.
- When asked whether to merge the plan, say yes.
- When asked whether low and normal risk epics may merge without you, say no: every merge waits for you.
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
for (const d of [ghConfig, ownerDir]) mkdirSync(d, { recursive: true });
if (!seed) mkdirSync(project, { recursive: true });
// The plugin's scripts get a fake gh that logs every call, with the script that made it, and is signed out.
const fakeGh = join(scratch, 'fake-gh.mjs');
const ghLog = join(scratch, 'scripts-gh.log');
writeFileSync(
  fakeGh,
  [
    "import { appendFileSync } from 'node:fs';",
    'const a = process.argv.slice(2);',
    "appendFileSync(process.env.E2E_GH_LOG, `${process.env.PITWALL_CALLER || '?'}: ${a.join(' ')}\\n`);",
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
  cpSync(seed, project, { recursive: true });
  // A copy keeps every branch and the checked-out one; a remote would let a stage push back.
  if (git('remote').stdout.split('\n').includes('origin')) git('remote', 'remove', 'origin');
  const meta = existsSync(join(seed, '..', `${STAGES[STAGES.indexOf(from) - 1]}.json`)) ? readFileSync(join(seed, '..', `${STAGES[STAGES.indexOf(from) - 1]}.json`), 'utf8').trim() : '';
  console.log(`seeded from ${seed} at ${git('log', '--oneline', '-1').stdout.trim()}${meta ? ` ${meta}` : ''}`);
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
    throw new Error(`the owner session returned no JSON (exit ${r.status}):\n${r.stdout.slice(-1000)}${r.stderr.slice(-1000)}`);
  }
  return { text: String(out.result ?? '').trim(), cost: out.total_cost_usd ?? 0 };
}

// The docs check each stage must pass: plan-review includes plan.
const CHECK = { kickoff: 'kickoff', discovery: 'discovery', decide: 'decide', spike: 'spike', plan: 'plan-review' };
const docsCheck = (stage) => run(process.execPath, [join(plugin, 'scripts', 'docs-check.mjs'), '--root', project, '--stage', CHECK[stage]], { env });
const branch = () => git('branch', '--show-current').stdout.trim();
const clean = () => git('status', '--porcelain').stdout.trim() === '';
const count = (ref) => Number(git('rev-list', '--count', ref).stdout.trim() || 0);
const touched = (path) => git('log', '--format=%H', `main..HEAD`, '--', path).stdout.trim() !== '';
const settings = () => JSON.parse(readFileSync(join(project, '.claude', 'pitwall.json'), 'utf8'));
const planBranch = cfg.planning.branch;
const gateGreen = () => run('bash', ['scripts/gate', '--full'], { cwd: project, env }).status === 0;
const calls = (caller) => readFileSync(ghLog, 'utf8').split('\n').filter((l) => l.startsWith(`${caller}: `));
const onPlan = (unmet) => {
  if (branch() !== planBranch) unmet.push(`on branch "${branch()}", expected ${planBranch}`);
  if (!clean()) unmet.push('the working tree is not clean');
  if (count('main') !== 1) unmet.push('main changed');
};

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
    if (!gateGreen()) unmet.push('scripts/gate --full fails');
    if (!calls('protect').some((l) => l.includes(': auth status'))) unmet.push('protect.mjs did not run (no gh auth status call in its log)');
    if (calls('protect').some((l) => / PUT /.test(l))) unmet.push('protect.mjs tried to write with a signed-out gh');
    return unmet;
  },
  discovery: () => {
    const unmet = [];
    onPlan(unmet);
    if (!touched('docs/DISCOVERY.md')) unmet.push(`docs/DISCOVERY.md is not committed on ${planBranch}`);
    return unmet;
  },
  decide: () => {
    const unmet = [];
    onPlan(unmet);
    if (!touched('docs/STACK.md')) unmet.push(`docs/STACK.md is not committed on ${planBranch}`);
    if (!touched('docs/adr')) unmet.push(`no ADR committed on ${planBranch}`);
    return unmet;
  },
  spike: () => {
    const unmet = [];
    onPlan(unmet);
    if (!touched('docs/spikes')) unmet.push(`no spike committed on ${planBranch}`);
    const spikes = git('for-each-ref', '--format=%(refname:short)', 'refs/heads/spike/').stdout.split('\n').filter(Boolean);
    if (spikes.length === 0) unmet.push('no spike/<topic> branch');
    for (const b of spikes) if (git('merge-base', '--is-ancestor', b, planBranch).status === 0) unmet.push(`${b} is reachable from ${planBranch}`);
    if (!gateGreen()) unmet.push(`scripts/gate --full fails on ${planBranch}: spike code reached it`);
    return unmet;
  },
  plan: () => {
    const unmet = [];
    onPlan(unmet);
    for (const p of ['docs/EPICS.md', 'docs/epics', 'docs/SPEC.md', 'docs/PLAN-REVIEW.md']) if (!touched(p)) unmet.push(`${p} is not committed on ${planBranch}`);
    if (!gateGreen()) unmet.push('scripts/gate --full fails');
    if (!calls('review-status').some((l) => l.includes(': auth status'))) unmet.push('review-status.mjs did not run up to its gh checks (no auth status call in its log)');
    if (calls('review-status').some((l) => / POST /.test(l))) unmet.push('review-status.mjs tried to write a status with a signed-out gh');
    if (calls('merge').some((l) => / pr merge /.test(l))) unmet.push('merge.mjs tried to merge with a signed-out gh');
    return unmet;
  },
};

function status(stage) {
  const check = docsCheck(stage);
  const unmet = check.status === 0 ? promises[stage]() : [];
  return { done: check.status === 0 && unmet.length === 0, check: check.stdout.trim(), unmet };
}

// A passing stage saves the project as it left it, for runs that start after it.
// The numbers go with it, and are printed at once, so a run stopped later keeps them.
function save(stage, numbers) {
  const dest = join(stateDir, stage);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(stateDir, { recursive: true });
  cpSync(project, dest, { recursive: true });
  const commit = git('rev-parse', '--short', 'HEAD').stdout.trim();
  const pluginCommit = run('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).stdout.trim();
  writeFileSync(join(stateDir, `${stage}.json`), JSON.stringify({ saved: new Date().toISOString(), plugin: version, pluginCommit, head: commit, ...numbers }) + '\n');
  console.log(`  saved: ${numbers.turns} turns, ${numbers.minutes.toFixed(1)} min, $${numbers.cost.toFixed(2)}, plugin at ${pluginCommit}`);
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
  const minutes = (Date.now() - started) / 60000;
  if (verdict.done) save(stage, { turns, minutes, cost });
  results.push({ stage, pass: verdict.done, turns, cost, minutes, error: verdict.done ? '' : error, check: verdict.check, unmet: verdict.unmet });
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
console.log(`\nE2E: ${passed ? 'PASS' : 'FAIL'}   scratch folder: ${scratch}   saved state: ${stateDir}`);
process.exit(passed ? 0 : 1);
