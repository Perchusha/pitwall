// The headless runs of the adoption of an existing project (T6), started by `node scripts/e2e.mjs`
// with the stages adopt and adopt-plan. Not part of scripts/check.mjs or CI: it needs a signed-in
// Claude Code CLI and spends the subscription.
//
// adopt builds a small project that exists already, a command line counter with its own README,
// roadmap, CLAUDE.md, CI and tests, a few commits on main, and no pitwall. One headless session
// with the plugin from this checkout gets `/pitwall:continue` there, and a scripted owner answers:
// start at the plan stage, the roadmap's open items become epics, pitwall's sections go into
// CLAUDE.md, the gate runs the project's lint and tests. The harness holds the session to T6's
// criteria by what the repository holds, never by the model's wording: nothing at all is written
// before the owner's yes to the adoption; afterwards every file the project had still holds
// what it held, the adoption is one commit on the planning branch and main has not moved, the
// gate runs the project's real tests (green as it stands, red once a test is broken), and the
// docs check passes with the stages before the plan skipped. adopt-plan starts from the state
// adopt saved: a fresh session whose owner says only "continue" must find the plan stage and
// turn the roadmap's open items into reviewed epics, with E0 first. gh runs signed out, as in the
// planning runs, so nothing reaches GitHub.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readOwner, resultWord, UNSCRIPTED_RULE } from './e2e-owner.mjs';

// How many more turns a stage gets, once its check passes, to reach the conductor's question whether to move on.
const CLOSING_TURNS = 4;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = process.env.PITWALL_E2E_PLUGIN ?? join(root, 'plugins', 'pitwall');
const version = JSON.parse(readFileSync(join(plugin, '.claude-plugin', 'plugin.json'), 'utf8')).version;
const cfg = JSON.parse(readFileSync(join(plugin, 'config', 'defaults.json'), 'utf8'));
export const ADOPT_STAGES = ['adopt', 'adopt-plan'];
// Not the name of any real project of the owner's (scripts/e2e-owner.mjs TEST_PROJECT says why).
const NAME = 'pitwall-e2e-tally';

// The project before pitwall: each commit of its history, oldest first.
const HISTORY = [
  {
    message: 'Count from the command line',
    files: {
      'package.json': `{\n  "name": "${NAME}",\n  "version": "0.2.0",\n  "type": "module",\n  "bin": { "tally": "src/cli.js" },\n  "scripts": {\n    "lint": "node --check src/tally.js && node --check src/cli.js",\n    "test": "node --test"\n  }\n}\n`,
      'src/tally.js': "// The counter: a number in a JSON file.\nimport { existsSync, readFileSync, writeFileSync } from 'node:fs';\n\nexport const read = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).count : 0);\n\nexport function add(file, by = 1) {\n  const count = read(file) + by;\n  writeFileSync(file, JSON.stringify({ count }) + '\\n');\n  return count;\n}\n",
      'src/cli.js': "#!/usr/bin/env node\nimport { add, read } from './tally.js';\n\nconst file = process.env.TALLY_FILE ?? 'tally.json';\nconst [command = 'show', amount = '1'] = process.argv.slice(2);\nif (command === 'add') console.log(add(file, Number(amount)));\nelse if (command === 'show') console.log(read(file));\nelse {\n  console.error('usage: tally [show | add <n>]');\n  process.exit(2);\n}\n",
      'README.md': `# ${NAME}\n\nA command line counter: it keeps one number in a file and adds to it. I use it to count things during the day, from any terminal, on my own laptop.\n\n## Usage\n\n    tally add 3\n    tally show\n\nThe count lives in \`tally.json\` in the current folder, or in the file \`TALLY_FILE\` names.\n\n## Development\n\nNode 20 or later, no dependencies. \`npm run lint\` checks the syntax, \`npm test\` runs the tests.\n`,
      '.gitignore': 'node_modules/\ntally.json\n',
    },
  },
  {
    message: 'Tests for the counter',
    files: {
      'test/tally.test.js': "import assert from 'node:assert';\nimport { mkdtempSync } from 'node:fs';\nimport { tmpdir } from 'node:os';\nimport { join } from 'node:path';\nimport test from 'node:test';\nimport { add, read } from '../src/tally.js';\n\ntest('a new counter reads zero', () => {\n  assert.equal(read(join(mkdtempSync(join(tmpdir(), 'tally-')), 'tally.json')), 0);\n});\n\ntest('add keeps the count in the file', () => {\n  const file = join(mkdtempSync(join(tmpdir(), 'tally-')), 'tally.json');\n  add(file, 2);\n  assert.equal(add(file, 3), 5);\n  assert.equal(read(file), 5);\n});\n",
      '.github/workflows/ci.yml': 'name: ci\n\non: [push, pull_request]\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n      - run: npm run lint\n      - run: npm test\n',
    },
  },
  {
    message: 'How the project is built, and what comes next',
    files: {
      'docs/architecture.md': '# Architecture\n\n## Decisions\n\n- Node 20 or later, ES modules, no dependencies: the tool must install with nothing but Node.\n- The count is one JSON file. No database.\n- One user, one machine. Nothing leaves the laptop.\n\n## Layout\n\n`src/tally.js` holds the counter, `src/cli.js` the command line. Tests live in `test/` and run with `node --test`.\n',
      'ROADMAP.md': '# Roadmap\n\n- [x] Count from the command line\n- [x] Keep the count in a file\n- [ ] Named counters: `tally add coffee 1` keeps a count per name\n- [ ] Export the counts as CSV: `tally export` prints `name,count` lines\n',
      // A spec of the owner's under a template path, and a decision in adr-tools' own format under a folder pitwall's
      // checks read by convention (T6 review, round 1): both stay as they are.
      'docs/SPEC.md': '# Spec\n\n## Overview\n\nA counter for the command line: one number per name, kept in a file.\n',
      'docs/adr/0001-use-node-without-dependencies.md': '# 1. Use Node without dependencies\n\nDate: 2026-01-10\n\n## Status\n\nAccepted\n\n## Context\n\nThe tool must install with nothing but Node.\n\n## Decision\n\nNode 20 or later, ES modules, no dependencies.\n\n## Consequences\n\nThe tests use node --test.\n',
      'CLAUDE.md': `# ${NAME}\n\nA small command line counter. Keep it dependency-free.\n\n## Workflow\n\nCommit straight to main. There are no reviews and no pull requests.\n\n## Style\n\nTwo spaces, single quotes, semicolons.\n`,
    },
  },
];

const SCENARIO = `You are the owner of a small project that already exists: ${NAME}, a command line counter written in Node. It has code, tests, a README, a roadmap and CI. You want pitwall to take it over without losing anything you wrote.
Facts you answer from:
- Only you use it, on your own laptop. No accounts, no server, no money, no personal data.
- The project's name is ${NAME}. The idea in one line: a command line counter that keeps its counts in a file.
- The process level: lite.
- The stage to start from: the plan. The stack is decided (Node 20 or later, no dependencies, one JSON file), so discovery and decide are behind you.
- The plan: docs/EPICS.md takes over ROADMAP.md. The two open items of the roadmap become epics; the two done items are history. ROADMAP.md gets the line that points to docs/EPICS.md.
- Documents you already have: pitwall adds its sections to your CLAUDE.md; your own text stays.
- Your CLAUDE.md says "Commit straight to main": pitwall's rules replace that one. Your style rules stay.
- The gate: the fast checks are "npm run lint"; the full checks are "npm run lint" and "npm test".
- You have no git hooks of your own: pitwall's hook may be set.
- Merge protection: later, not now. There is no GitHub repository yet, and none is to be created now.
- Out of scope for the project: a server, sync between machines, a graphical interface.
- You expect two epics after E0, one per open item of the roadmap.
- Launch: no app stores; support is the README; no domain, no analytics.`;
const OWNER_RULES = `Answer as this owner, in English, in one to three sentences, and only what was asked.
- When asked to confirm or approve something that fits the facts, confirm it.
- When shown a list of facts the assistant inferred, confirm the list as a whole when it fits the facts; otherwise correct the items by number.
- When offered options with a recommendation, accept the recommendation unless it contradicts the facts.
- When asked, as the last question before anything is written, whether to adopt the project as listed: reply exactly: ADOPT
- When shown the plan, accept it as drafted: no changes, and no spike.
- When asked to accept a risk, accept it with the fallback the assistant proposes.
- When asked whether to merge the plan, say yes.
- When asked whether low and normal risk epics may merge without you, say no: every merge waits for you.
- When asked whether to create a GitHub repository, push, or set up GitHub now, answer: not now, later.
- When the assistant has run a command that you are told to run yourself, say you will do it later, and ask it to go on.
- When the assistant says that a stage is finished in this conversation and asks whether to move on to the next stage, reply exactly: NEXT
- When the assistant asks, at the start of a conversation, which stage to run now, answer from the facts.
${UNSCRIPTED_RULE}
- When the assistant asks nothing and reports that the stage is done, reply exactly: DONE`;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.error) throw new Error(`${cmd}: ${r.error.message}`);
  return r;
}

export async function runAdopt({ stages, stateDir, maxTurns }) {
  const scratch = mkdtempSync(join(tmpdir(), 'pitwall-adopt-'));
  const project = join(scratch, NAME);
  const ghConfig = join(scratch, 'gh');
  const ownerDir = join(scratch, 'owner');
  for (const d of [ghConfig, ownerDir]) mkdirSync(d, { recursive: true });
  // The plugin's scripts get a fake gh that logs every call and is signed out, as in the planning runs.
  const fakeGh = join(scratch, 'fake-gh.mjs');
  const ghLog = join(scratch, 'scripts-gh.log');
  writeFileSync(
    fakeGh,
    ["import { appendFileSync } from 'node:fs';", 'const a = process.argv.slice(2);', "appendFileSync(process.env.E2E_GH_LOG, `${process.env.PITWALL_CALLER || '?'}: ${a.join(' ')}\\n`);", "if (a[0] === '--version') { console.log('gh version 0.0.0 (e2e fake)'); process.exit(0); }", "console.error('You are not logged into any GitHub hosts.');", 'process.exit(1);', ''].join('\n'),
  );
  writeFileSync(ghLog, '');
  const identity = { GIT_AUTHOR_NAME: 'pitwall e2e', GIT_AUTHOR_EMAIL: 'e2e@pitwall.invalid', GIT_COMMITTER_NAME: 'pitwall e2e', GIT_COMMITTER_EMAIL: 'e2e@pitwall.invalid' };
  // Every tool call the hooks see, so that the plan stage can show which skills led it.
  const hookRecord = join(scratch, 'hook-record.jsonl');
  writeFileSync(hookRecord, '');
  const env = { ...process.env, ...identity, GH_CONFIG_DIR: ghConfig, PITWALL_GH: JSON.stringify([process.execPath, fakeGh]), E2E_GH_LOG: ghLog, GIT_CEILING_DIRECTORIES: scratch, PITWALL_HOOK_RECORD: hookRecord };
  for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) delete env[k];
  if (run('gh', ['auth', 'status'], { env }).status === 0) {
    console.error('e2e: gh is still signed in with an empty GH_CONFIG_DIR; refusing to run so nothing reaches GitHub.');
    return 1;
  }
  const git = (...args) => run('git', ['-c', 'core.autocrlf=false', ...args], { cwd: project, env });

  // What the project held before pitwall, to hold the adoption to.
  const original = new Map(HISTORY.flatMap((c) => Object.entries(c.files)));
  let fixtureHead = '';
  const first = stages[0];
  if (first === 'adopt') {
    mkdirSync(project, { recursive: true });
    git('init', '-q', '-b', 'main');
    for (const c of HISTORY) {
      for (const [rel, body] of Object.entries(c.files)) {
        mkdirSync(dirname(join(project, rel)), { recursive: true });
        writeFileSync(join(project, rel), body);
      }
      git('add', '-A');
      git('commit', '-qm', c.message);
    }
    fixtureHead = git('rev-parse', 'HEAD').stdout.trim();
    console.log(`the project before pitwall: ${NAME}, ${HISTORY.length} commits on main, ${original.size} files`);
  } else {
    const seed = join(stateDir, 'adopt');
    if (!existsSync(join(seed, '.git'))) throw new Error(`no saved project at ${seed}: run node scripts/e2e.mjs --from adopt --until adopt first`);
    cpSync(seed, project, { recursive: true });
    fixtureHead = git('rev-parse', 'main').stdout.trim();
    console.log(`seeded from ${seed} at ${git('log', '--oneline', '-1').stdout.trim()}`);
  }

  const allowed = ['Bash(node *)', 'Bash(git *)', 'Bash(gh *)', 'Bash(ls *)', 'Bash(cd *)', 'Bash(echo *)', 'Bash(cat *)', 'Bash(pwd)', 'Bash(bash scripts/gate *)', 'Bash(npm *)', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Agent'];
  function agentTurn(prompt, sessionId) {
    const args = ['-p', '--plugin-dir', plugin, '--output-format', 'json', '--permission-mode', 'auto', '--permission-prompts', 'none', '--strict-mcp-config'];
    if (sessionId) args.push('--resume', sessionId);
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

  const docsCheck = (stage) => run(process.execPath, [join(plugin, 'scripts', 'docs-check.mjs'), '--root', project, '--stage', stage], { env });
  const branch = () => git('branch', '--show-current').stdout.trim();
  const clean = () => git('status', '--porcelain').stdout.trim() === '';
  const planBranch = cfg.planning.branch;
  const gate = (mode = '--full') => run('bash', ['scripts/gate', mode], { cwd: project, env });
  const settings = () => JSON.parse(readFileSync(join(project, '.claude', 'pitwall.json'), 'utf8'));
  const calls = (caller) => readFileSync(ghLog, 'utf8').split('\n').filter((l) => l.startsWith(`${caller}: `));
  const walk = (dir, out = []) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      if (e.isDirectory()) walk(join(dir, e.name), out);
      else out.push(relative(project, join(dir, e.name)).split('\\').join('/'));
    }
    return out;
  };
  // Untouched: the project as the fixture left it, on main, with no other branch and nothing new.
  const untouched = () => {
    const unmet = [];
    if (branch() !== 'main') unmet.push(`on branch "${branch()}"`);
    if (git('rev-parse', 'HEAD').stdout.trim() !== fixtureHead) unmet.push('HEAD moved');
    if (!clean()) unmet.push(`the tree changed: ${git('status', '--porcelain').stdout.trim().split('\n').slice(0, 6).join(', ')}`);
    if (git('for-each-ref', '--format=%(refname:short)', 'refs/heads/').stdout.trim() !== 'main') unmet.push('a branch was created');
    if (walk(project).length !== original.size) unmet.push('a file was added or removed');
    return unmet;
  };
  // Every line the project's file held is still there, in order: additions are allowed where the owner agreed to them.
  const keeps = (rel) => {
    if (!existsSync(join(project, rel))) return false;
    const now = readFileSync(join(project, rel), 'utf8').split(/\r?\n/);
    let at = 0;
    for (const line of original.get(rel).split('\n')) {
      const found = now.indexOf(line, at);
      if (found < 0) return false;
      at = found + 1;
    }
    return true;
  };
  // The files the scripted owner let pitwall add to; every other file of the project stays byte for byte.
  const MAY_GROW = ['CLAUDE.md', 'ROADMAP.md', '.gitignore', 'docs/SPEC.md'];

  const promises = {
    adopt: () => {
      const unmet = [];
      if (branch() !== planBranch) unmet.push(`on branch "${branch()}", expected ${planBranch}`);
      if (!clean()) unmet.push('the working tree is not clean');
      if (git('rev-parse', 'main').stdout.trim() !== fixtureHead) unmet.push('main moved: the adoption reaches main only with the plan\'s PR');
      for (const [rel, body] of original) {
        if (MAY_GROW.includes(rel)) {
          if (!keeps(rel)) unmet.push(`${rel} lost a line the project had`);
        } else if (!existsSync(join(project, rel)) || readFileSync(join(project, rel), 'utf8') !== body) unmet.push(`${rel}, a file the project had, changed`);
      }
      try {
        const s = settings();
        if (s.startStage !== 'plan') unmet.push(`startStage is "${s.startStage}", expected plan`);
        if (s.processLevel !== 'lite') unmet.push(`processLevel is "${s.processLevel}", expected lite`);
        if (s.planFile !== 'ROADMAP.md') unmet.push(`planFile is "${s.planFile}", expected ROADMAP.md`);
        if (s.mergeProtection !== 'pending') unmet.push(`mergeProtection is "${s.mergeProtection}", expected pending (the owner said later, and gh is signed out)`);
        if (s.autoMerge !== false) unmet.push('autoMerge is not false, though the owner said no');
      } catch {
        unmet.push('.claude/pitwall.json does not parse');
      }
      if (!git('ls-files', '-s', 'scripts/gate').stdout.startsWith('100755')) unmet.push('scripts/gate is not executable in the git index');
      const green = gate();
      if (green.status !== 0) unmet.push(`scripts/gate --full fails on the project as it stands: ${green.stdout.trim().split('\n').pop()}`);
      else {
        // Green only while the project's real checks pass: break a test, and it must turn red.
        const test = join(project, 'test', 'tally.test.js');
        const good = readFileSync(test, 'utf8');
        writeFileSync(test, good.replace('add(file, 3), 5', 'add(file, 3), 6'));
        if (gate().status === 0) unmet.push('scripts/gate --full stays green with a failing test: it does not run the project\'s tests');
        writeFileSync(test, good);
      }
      if (!existsSync(join(project, '.github', 'workflows', 'pitwall-gate.yml'))) unmet.push('no workflow with the job named gate beside the project\'s own ci.yml');
      if (!/docs\/EPICS\.md/.test(readFileSync(join(project, 'ROADMAP.md'), 'utf8'))) unmet.push('ROADMAP.md does not point to docs/EPICS.md: two plans');
      const skipped = docsCheck('discovery,decide');
      if (skipped.status !== 0) unmet.push(`the docs check of the stages before the plan does not pass:\n${skipped.stdout.trim()}`);
      if (docsCheck('plan').status === 0) unmet.push('the plan check passes already: the adoption wrote the plan, which is the plan stage\'s');
      // One commit holds the adoption; one after it may record the protection mode and the choice of merges.
      const commits = git('rev-list', '--reverse', `main..${planBranch}`).stdout.trim().split('\n').filter(Boolean);
      if (commits.length === 0) unmet.push(`no commit on ${planBranch}`);
      for (const c of commits.slice(1)) {
        const touched = git('diff-tree', '--no-commit-id', '--name-only', '-r', c).stdout.trim().split('\n').filter(Boolean);
        if (touched.some((f) => f !== '.claude/pitwall.json')) unmet.push(`the adoption is more than one commit: ${c.slice(0, 7)} changes ${touched.join(', ')}`);
      }
      // T6-AC2: the documents of the stages before the plan are filled from the project's own, naming them.
      const doc = (rel) => (existsSync(join(project, rel)) ? readFileSync(join(project, rel), 'utf8') : '');
      const template = (rel) => readFileSync(join(plugin, 'template', rel), 'utf8');
      if (doc('docs/DISCOVERY.md') === template('docs/DISCOVERY.md') || !/README\.md|architecture\.md/.test(doc('docs/DISCOVERY.md'))) unmet.push('docs/DISCOVERY.md is not filled from the project\'s README or docs/architecture.md, naming them');
      if (doc('docs/STACK.md') === template('docs/STACK.md') || !/Node/.test(doc('docs/STACK.md')) || !/package\.json|architecture\.md|ADR-0001|0001-use-node/.test(doc('docs/STACK.md'))) unmet.push('docs/STACK.md does not name Node, from package.json, docs/architecture.md or the project\'s own ADR');
      try {
        if (!(settings().ownDocs ?? []).includes('docs/adr/0001-use-node-without-dependencies.md')) unmet.push('.claude/pitwall.json does not record the project\'s own ADR in ownDocs');
      } catch {}
      return unmet;
    },
    'adopt-plan': () => {
      const unmet = [];
      if (branch() !== planBranch) unmet.push(`on branch "${branch()}", expected ${planBranch}`);
      if (!clean()) unmet.push('the working tree is not clean');
      if (git('rev-parse', 'main').stdout.trim() !== fixtureHead) unmet.push('main moved');
      for (const [rel, body] of original) {
        if (MAY_GROW.includes(rel) ? !keeps(rel) : !existsSync(join(project, rel)) || readFileSync(join(project, rel), 'utf8') !== body) unmet.push(`${rel}, a file the project had, changed`);
      }
      // E0 and one epic per open item of the roadmap, within the lite level's limit; what is done is not planned again.
      const epics = readdirSync(join(project, 'docs', 'epics')).filter((f) => /^E\d+-.+\.md$/.test(f));
      const later = epics.filter((f) => !f.startsWith('E0-')).length;
      if (!epics.some((f) => f.startsWith('E0-'))) unmet.push('no E0');
      if (later < 2 || later > cfg.processLevels.lite.epics.max) unmet.push(`${later} epics after E0, expected 2 (the roadmap's open items) and at most ${cfg.processLevels.lite.epics.max}`);
      // The epics after E0 are the roadmap's open items, not the done ones.
      const plannedText = epics.filter((f) => !f.startsWith('E0-')).map((f) => readFileSync(join(project, 'docs', 'epics', f), 'utf8')).join('\n');
      if (!/named/i.test(plannedText) || !/CSV/i.test(plannedText)) unmet.push('the epics after E0 do not hold the roadmap\'s open items, named counters and the CSV export');
      if (gate().status !== 0) unmet.push('scripts/gate --full fails');
      if (!calls('review-status').some((l) => l.includes(': auth status'))) unmet.push('review-status.mjs did not run up to its gh checks');
      if (calls('review-status').some((l) => / POST /.test(l))) unmet.push('review-status.mjs tried to write a status with a signed-out gh');
      if (calls('merge').some((l) => / pr merge /.test(l))) unmet.push('merge.mjs tried to merge with a signed-out gh');
      const rounds = git('log', '--oneline', '--grep=^docs: plan review,', planBranch).stdout.trim().split('\n').filter(Boolean).length;
      const max = cfg.processLevels.lite.planReviewRounds?.maxRounds ?? cfg.review.maxRounds;
      if (rounds > max) unmet.push(`${rounds} plan review rounds, the lite level stops at ${max}`);
      // The conductor led it: the owner's one word started the continue skill, which read the plan skill's file.
      const seen = readFileSync(hookRecord, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.event === 'pre-tool-use' && !r.input?.agent_id);
      if (!seen.some((r) => r.input?.tool_name === 'Skill' && /(^|:)continue$/.test(String(r.input?.tool_input?.skill ?? '')))) unmet.push('the session did not start the continue skill on the owner\'s "continue"');
      if (!seen.some((r) => /skills\/plan\/SKILL\.md/.test(JSON.stringify(r.input?.tool_input ?? {}).split('\\\\').join('/')))) unmet.push('the session did not read the plan skill\'s file');
      return unmet;
    },
  };
  const CHECK = { adopt: 'kickoff', 'adopt-plan': 'plan-review' };
  function status(stage) {
    // Before .claude/pitwall.json exists there is nothing for the docs check to read.
    if (!existsSync(join(project, '.claude', 'pitwall.json'))) return { done: false, check: '', unmet: [] };
    const check = docsCheck(CHECK[stage]);
    const unmet = check.status === 0 ? promises[stage]() : [];
    return { done: check.status === 0 && unmet.length === 0, check: check.stdout.trim(), unmet };
  }
  function save(stage, numbers) {
    const dest = join(stateDir, stage);
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(stateDir, { recursive: true });
    cpSync(project, dest, { recursive: true });
    writeFileSync(join(stateDir, `${stage}.json`), JSON.stringify({ saved: new Date().toISOString(), plugin: version, pluginCommit: process.env.PITWALL_E2E_COMMIT, head: git('rev-parse', '--short', 'HEAD').stdout.trim(), ...numbers }) + '\n');
    console.log(`  saved: ${numbers.turns} turns, ${numbers.minutes.toFixed(1)} min, $${numbers.cost.toFixed(2)}, plugin at ${process.env.PITWALL_E2E_COMMIT}`);
  }

  const results = [];
  const unscripted = [];
  const unasked = [];
  for (const stage of stages) {
    const started = Date.now();
    const history = [];
    let cost = 0;
    let turns = 0;
    let sessionId;
    // The conductor leads both: in a folder that holds a project and no pitwall, it adopts; afterwards the
    // owner's one word finds the stage the project starts from.
    let prompt = stage === 'adopt' ? '/pitwall:continue' : 'continue';
    let verdict = { done: false };
    let error = '';
    // T6-AC5: nothing is written before the owner's yes to the adoption as listed.
    let agreed = stage !== 'adopt';
    let closing = 0;
    const early = [];
    console.log(`\n== ${stage}`);
    try {
      while (turns < maxTurns) {
        turns += 1;
        const out = agentTurn(prompt, sessionId);
        sessionId = out.session_id;
        cost += out.total_cost_usd ?? 0;
        history.push({ who: 'Owner', text: prompt }, { who: 'Assistant', text: String(out.result ?? '') });
        console.log(`  turn ${turns}: ${String(out.result ?? '').split('\n')[0].slice(0, 110)}`);
        if (!agreed) {
          const touched = untouched();
          if (touched.length) {
            early.push(...touched.map((t) => `before the owner's yes to the adoption (turn ${turns}): ${t}`));
            break;
          }
        }
        verdict = status(stage);
        if (verdict.done && stage !== 'adopt') break;
        const reply = ownerReply(history.slice(-12));
        cost += reply.cost;
        if (verdict.done) {
          // The adoption's commit makes its check pass; the protection mode, the question about merges and the
          // hand-over still follow, and then the conductor's question whether to move on, which NEXT answers.
          if (/^\W*NEXT\b/i.test(reply.text)) break;
          closing += 1;
          if (closing > CLOSING_TURNS || /^DONE.?$/i.test(reply.text)) {
            unasked.push(stage);
            console.log(`  NO QUESTION WHETHER TO MOVE ON: the owner replied "${reply.text.split('\n')[0].slice(0, 110)}"`);
            break;
          }
        }
        // The conductor asked whether to move on while the stage's check does not pass: answering would start the
        // next stage inside this one, so the stage ends here, failed, with what its check still wants.
        if (/^\W*NEXT\b/i.test(reply.text)) {
          error = 'the conductor asked whether to move on, but the stage does not pass its check yet';
          break;
        }
        const read = readOwner(reply.text, history[history.length - 1].text);
        reply.text = read.text;
        if (read.question) {
          unscripted.push({ stage, turn: turns, question: read.question, override: read.override });
          console.log(`  UNSCRIPTED ${read.override ? 'STOP OVERRIDDEN' : 'QUESTION'}: ${read.question.slice(0, 160)}`);
        }
        if (/^\W*ADOPT\b/.test(reply.text)) agreed = true;
        if (/^DONE.?$/i.test(reply.text)) {
          error = 'the skill reported done, but the stage does not pass its check';
          break;
        }
        prompt = reply.text;
        console.log(`  owner: ${prompt.split('\n')[0].slice(0, 110)}`);
      }
      if (!verdict.done && !error && !early.length) error = `not done after ${maxTurns} turns`;
    } catch (err) {
      error = err.message;
    }
    if (!verdict.done && !early.length) verdict = status(stage);
    const done = verdict.done && early.length === 0 && (stage !== 'adopt' || agreed);
    if (stage === 'adopt' && verdict.done && !agreed) error = 'the project was adopted, but the owner was never asked whether to adopt it as listed';
    const minutes = (Date.now() - started) / 60000;
    if (done) save(stage, { turns, minutes, cost, unscripted: unscripted.filter((u) => u.stage === stage).map((u) => u.question) });
    results.push({ stage, pass: done, turns, cost, minutes, error: done ? '' : error, check: verdict.check, unmet: [...early, ...(verdict.unmet ?? [])] });
    if (!done) break;
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
  for (const u of unscripted) console.log(`UNSCRIPTED ${u.override ? 'STOP OVERRIDDEN' : 'QUESTION'} (${u.stage}, turn ${u.turn}): ${u.question}`);
  // A stage that ended without the conductor's question whether to move on fails the run, as in the planning runs.
  for (const s of unasked) console.log(`FAIL ${s}: the conductor ended the stage without asking whether to move on`);
  const passed = results.length === stages.length && results.every((r) => r.pass) && unasked.length === 0;
  console.log(`\nE2E ADOPT: ${resultWord(passed, unscripted)}   scratch folder: ${scratch}   saved state: ${stateDir}`);
  return passed ? 0 : 1;
}
