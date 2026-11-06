#!/usr/bin/env node
// Every check CI runs for pitwall (T0-AC5). Exit 0 is a pass.
//
// It runs the official validator first, then the repository's own rules:
// manifests parse and agree on the version, every skill carries a status line
// and an unbuilt one cannot trigger, agents are named after their files, the
// template is complete, its gate is executable in the git index and behaves
// as L-2 says in a scratch project, and it carries .tmpl suffixes where a tool
// would load a file (L-1), relative links resolve, no file holds an em dash or
// Cyrillic, and no skill or agent hardcodes a model ID. Characters these
// checks look for are built from code points (L-3).
//
// The plugin's own scripts (T1) run here as a project gets them: layout.mjs
// lays out scratch projects, docs-check.mjs must pass on them and fail on
// broken copies (T1-AC5), and protect.mjs runs every branch against a fake
// gh (T1-AC2). The headless skill runs (scripts/e2e.mjs) are not here: they
// need a signed-in CLI and spend the subscription (T1-AC7).
//
// Needs Node 22, git, bash and the Claude Code CLI (`claude`) on the PATH, at least
// the version in .claude-code-version (the one CI installs).

import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = join(root, 'plugins', 'pitwall');
const rel = (p) => relative(root, p) || '.';

let failed = 0;
function step(name, fn) {
  const problems = [];
  try {
    fn((msg) => problems.push(msg));
  } catch (err) {
    problems.push(err.message);
  }
  if (problems.length === 0) {
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name}`);
    for (const p of problems) console.log(`  - ${p}`);
  }
}

function files(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) files(p, out);
    else out.push(p);
  }
  return out;
}

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}

const all = files(root);
const scripts = join(plugin, 'scripts');
const runScript = (script, args, opts = {}) => spawnSync(process.execPath, [join(scripts, script), ...args], { encoding: 'utf8', ...opts });
const layOut = (dir, extra = []) =>
  runScript('layout.mjs', ['--target', dir, '--name', 'scratch', '--idea', 'A scratch project for the checks', '--level', 'lite', ...extra]);
const docsCheck = (dir, extra = []) => runScript('docs-check.mjs', ['--root', dir, ...extra]);
const scratch = (prefix, fn) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const textFiles = all.filter((p) => !['.png', '.jpg', '.jpeg', '.ico'].includes(extname(p)));

// 0. The Claude Code CLI is at least the version CI pins in .claude-code-version.
// An older CLI lacks validator options, which reads as a confusing "unknown option".
step('claude cli version', (report) => {
  const pinned = readFileSync(join(root, '.claude-code-version'), 'utf8').trim();
  const r = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return report(`cannot run "claude --version": ${r.error?.message ?? r.stderr}`);
  const found = /(\d+)\.(\d+)\.(\d+)/.exec(r.stdout);
  if (!found) return report(`cannot read a version from "claude --version": ${r.stdout.trim()}`);
  const have = found.slice(1, 4).map(Number);
  const need = pinned.split('.').map(Number);
  const older = have[0] - need[0] || have[1] - need[1] || have[2] - need[2];
  if (older < 0) report(`Claude Code ${have.join('.')} is older than ${pinned} (.claude-code-version). Run "claude update".`);
});

// 1. The official validator, strict, with the plugin directory's submission profile.
function validate(target, extra, report) {
  const r = spawnSync('claude', ['plugin', 'validate', '--strict', ...extra, target], { encoding: 'utf8' });
  if (r.error) throw new Error(`cannot run claude: ${r.error.message}`);
  if (r.status !== 0) report(`claude plugin validate --strict ${extra.join(' ')} ${rel(target)}\n${r.stdout}${r.stderr}`);
}
step('validate marketplace', (report) => validate(root, [], report));
step('validate plugin (directory profile)', (report) => validate(plugin, ['--profile', 'directory'], report));

// 2. Every JSON file parses, template .json.tmpl included.
step('json parses', (report) => {
  for (const p of all.filter((f) => f.endsWith('.json') || f.endsWith('.json.tmpl'))) {
    try {
      JSON.parse(readFileSync(p, 'utf8'));
    } catch (err) {
      report(`${rel(p)}: ${err.message}`);
    }
  }
});

// 3. One version in plugin.json, the marketplace entry and the marketplace metadata.
step('versions agree', (report) => {
  const pluginJson = JSON.parse(readFileSync(join(plugin, '.claude-plugin', 'plugin.json'), 'utf8'));
  const market = JSON.parse(readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
  const entry = market.plugins.find((p) => p.name === pluginJson.name);
  if (!entry) return report(`marketplace has no entry named ${pluginJson.name}`);
  const versions = { 'plugin.json': pluginJson.version, 'marketplace entry': entry.version, 'marketplace metadata': market.metadata?.version };
  if (new Set(Object.values(versions)).size !== 1) report(`versions differ: ${JSON.stringify(versions)}`);
});

// 4. Skills: named after their folder, described, and an unbuilt skill cannot trigger by itself (T0-AC3).
step('skills', (report) => {
  const dir = join(plugin, 'skills');
  for (const name of readdirSync(dir)) {
    const file = join(dir, name, 'SKILL.md');
    if (!existsSync(file)) {
      report(`skills/${name} has no SKILL.md`);
      continue;
    }
    const text = readFileSync(file, 'utf8');
    const fm = frontmatter(text);
    if (!fm) {
      report(`skills/${name}/SKILL.md has no frontmatter`);
      continue;
    }
    if (fm.name !== name) report(`skills/${name}: frontmatter name is "${fm.name}"`);
    if (!fm.description) report(`skills/${name}: no description`);
    // Every skill states its status in a quote line. Only "Status: built ..." may trigger by itself;
    // anything else, however it is worded, needs disable-model-invocation: true.
    const status = /^>\s*\**\s*status\s*\**\s*:\s*\**\s*(.*)$/im.exec(text);
    if (!status) {
      report(`skills/${name}: no status line ("> Status: built ..." or "> Status: planned ...")`);
    } else if (!/^built\b/i.test(status[1].trim()) && fm['disable-model-invocation'] !== 'true') {
      report(`skills/${name}: status is not "built" but it can trigger by itself (set disable-model-invocation: true)`);
    }
  }
});

// 5. Agents: named after their file, described, and an unbuilt agent says so in its description.
step('agents', (report) => {
  const dir = join(plugin, 'agents');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const name = file.replace(/\.md$/, '');
    const text = readFileSync(join(dir, file), 'utf8');
    const fm = frontmatter(text);
    if (!fm) {
      report(`agents/${file} has no frontmatter`);
      continue;
    }
    if (fm.name !== name) report(`agents/${file}: frontmatter name is "${fm.name}"`);
    if (!fm.description) report(`agents/${file}: no description`);
    if (text.includes('NOT_IMPLEMENTED') && !fm.description?.startsWith('(Planned')) {
      report(`agents/${file}: not implemented but the description does not say so`);
    }
  }
});

// 6. The template is complete, and files a tool would load carry .tmpl (L-1).
step('template', (report) => {
  const t = join(plugin, 'template');
  const required = [
    'CLAUDE.md.tmpl',
    '.claude/settings.json.tmpl',
    'gitignore.tmpl',
    'editorconfig.tmpl',
    'gitattributes.tmpl',
    '.claude/pitwall.json.tmpl',
    '.github/workflows/ci.yml',
    '.github/pull_request_template.md',
    'scripts/gate',
    'docs/INDEX.md',
    'docs/IDEA.md',
    'docs/DISCOVERY.md',
    'docs/SPEC.md',
    'docs/STACK.md',
    'docs/EPICS.md',
    'docs/epics/E0-skeleton.md',
    'docs/adr/0000-template.md',
    'docs/spikes/README.md',
    'docs/PLAN-REVIEW.md',
    'docs/RISKS.md',
    'docs/BUGS.md',
    'docs/LESSONS.md',
    'docs/JOURNAL.md',
    'docs/archive/README.md',
  ];
  for (const f of required) if (!existsSync(join(t, f))) report(`template/${f} is missing`);

  // Executable in the git index when there is one (what a clone gets), else on disk.
  const gate = join(t, 'scripts', 'gate');
  if (existsSync(gate)) {
    const staged = spawnSync('git', ['ls-files', '-s', rel(gate)], { cwd: root, encoding: 'utf8' });
    const indexMode = staged.status === 0 ? staged.stdout.trim().split(/\s+/)[0] : '';
    const executable = indexMode ? indexMode === '100755' : (statSync(gate).mode & 0o111) !== 0;
    if (!executable) report(`template/scripts/gate is not executable${indexMode ? ` in the git index (${indexMode})` : ''}`);
  }

  // L-1: a file a tool loads by name, or anything under .claude/, must carry .tmpl inside this repository.
  const toolLoaded = new Set(['CLAUDE.md', 'AGENTS.md', '.mcp.json', '.gitignore', '.gitattributes', '.editorconfig']);
  for (const p of files(t)) {
    const r = relative(t, p);
    const base = r.split(/[\\/]/).pop();
    if (r.endsWith('.tmpl')) continue;
    if (toolLoaded.has(base) || r.startsWith('.claude')) {
      report(`template/${r} would act on this repository: rename it to the .tmpl form`);
    }
  }
});

// 6b. L-2: the template's gate stub, laid out as kickoff will lay it out, passes on docs only,
// fails on code (tracked or not), fails closed outside git and rejects a bad flag.
step('template gate behaviour', (report) => {
  const dir = mkdtempSync(join(tmpdir(), 'pitwall-gate-'));
  const env = { ...process.env, GIT_CEILING_DIRECTORIES: dir };
  const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  const expect = (label, r, code) => {
    if (r.error) report(`${label}: ${r.error.message}`);
    else if (r.status !== code) report(`${label}: exit ${r.status}, expected ${code}\n${r.stdout}${r.stderr}`);
  };
  try {
    const project = join(dir, 'project');
    expect('layout', layOut(project), 0);
    run('git', ['init', '-q'], project);
    run('git', ['add', '-A'], project);
    run('git', ['-c', 'user.email=check@pitwall', '-c', 'user.name=check', 'commit', '-qm', 'init'], project);

    expect('docs only', run('bash', ['scripts/gate', '--full'], project), 0);
    expect('run from docs/', run('bash', ['../scripts/gate'], join(project, 'docs')), 0);
    expect('bad flag', run('bash', ['scripts/gate', '--nope'], project), 2);
    mkdirSync(join(project, 'src'));
    writeFileSync(join(project, 'src', 'main.ts'), 'export {};\n');
    expect('untracked code', run('bash', ['scripts/gate', '--fast'], project), 1);

    const nogit = join(dir, 'nogit');
    mkdirSync(nogit);
    cpSync(join(plugin, 'template', 'scripts', 'gate'), join(nogit, 'gate'));
    expect('outside git', run('bash', ['gate'], nogit), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 6c. Every script parses, including the ones only the owner runs (scripts/e2e.mjs).
step('scripts parse', (report) => {
  for (const p of all.filter((f) => f.endsWith('.mjs'))) {
    const r = spawnSync(process.execPath, ['--check', p], { encoding: 'utf8' });
    if (r.status !== 0) report(`${rel(p)}\n${r.stderr}`);
  }
});

// 6d. T1-AC1: layout.mjs lays the template out complete and filled, and refuses any folder
// that holds more than .git, so it can never overwrite or commit someone's files.
step('layout', (report) => {
  scratch('pitwall-layout-', (dir) => {
    const project = join(dir, 'p');
    const r = layOut(project);
    if (r.status !== 0) return report(`layout exit ${r.status}\n${r.stdout}${r.stderr}`);
    const t = join(plugin, 'template');
    for (const f of files(t).map((p) => relative(t, p).split('\\').join('/'))) {
      const dest = f.endsWith('.tmpl') ? f.replace(/(^|\/)(gitignore|editorconfig|gitattributes)\.tmpl$/, '$1.$2').replace(/\.tmpl$/, '') : f;
      if (!existsSync(join(project, dest))) report(`template/${f} was not laid out as ${dest}`);
    }
    for (const p of files(project)) {
      if (p.endsWith('.tmpl')) report(`${relative(project, p)} kept its .tmpl suffix`);
      if (/\{\{[A-Z_]+\}\}/.test(readFileSync(p, 'utf8'))) report(`${relative(project, p)} still holds a placeholder`);
    }
    const claude = readFileSync(join(project, 'CLAUDE.md'), 'utf8');
    if (!claude.startsWith('# scratch\n\nA scratch project for the checks\n')) report(`CLAUDE.md does not start with the name and the idea:\n${claude.slice(0, 120)}`);
    const settings = JSON.parse(readFileSync(join(project, '.claude', 'pitwall.json'), 'utf8'));
    const version = JSON.parse(readFileSync(join(plugin, '.claude-plugin', 'plugin.json'), 'utf8')).version;
    const want = { templateVersion: version, processLevel: 'lite', mergeProtection: 'pending' };
    if (JSON.stringify(settings) !== JSON.stringify(want)) report(`.claude/pitwall.json is ${JSON.stringify(settings)}, expected ${JSON.stringify(want)}`);

    const again = layOut(project);
    if (again.status !== 1 || !/REFUSED/.test(again.stderr)) report(`a second layout must be refused with exit 1, got ${again.status}\n${again.stderr}`);
    if (readFileSync(join(project, 'CLAUDE.md'), 'utf8') !== claude) report('a refused layout changed CLAUDE.md');

    const docsOnly = join(dir, 'docs-only');
    mkdirSync(join(docsOnly, 'docs'), { recursive: true });
    writeFileSync(join(docsOnly, 'docs', 'notes.md'), '# Notes\n');
    const r2 = layOut(docsOnly);
    if (r2.status !== 1 || existsSync(join(docsOnly, 'CLAUDE.md'))) report(`a folder with a file in docs/ must be refused and stay untouched, got exit ${r2.status}`);
    const clash = join(dir, 'clash');
    mkdirSync(clash);
    writeFileSync(join(clash, '.gitignore'), 'mine\n');
    const r3 = layOut(clash);
    if (r3.status !== 1 || readFileSync(join(clash, '.gitignore'), 'utf8') !== 'mine\n' || existsSync(join(clash, 'docs'))) report(`a folder with its own .gitignore must be refused and stay untouched, got exit ${r3.status}`);
    const code = join(dir, 'code');
    mkdirSync(join(code, 'src'), { recursive: true });
    writeFileSync(join(code, 'src', 'main.ts'), 'export {};\n');
    const r4 = layOut(code);
    if (r4.status !== 1 || existsSync(join(code, 'CLAUDE.md'))) report(`a folder with code must be refused and stay untouched, got exit ${r4.status}`);
    if (!claude.includes(`commit on \`${JSON.parse(readFileSync(join(plugin, 'config', 'defaults.json'), 'utf8')).planning.branch}\``)) report('CLAUDE.md does not name the planning branch from the config');

    // --check: kickoff's preflight, answered without writing.
    const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.email=check@pitwall', '-c', 'user.name=check', ...a], { cwd, encoding: 'utf8', env: { ...process.env, GIT_CEILING_DIRECTORIES: dir } });
    const preflight = (target) => runScript('layout.mjs', ['--check', '--target', target], { env: { ...process.env, GIT_CEILING_DIRECTORIES: dir } });
    const bare = join(dir, 'bare');
    mkdirSync(bare);
    const c0 = preflight(bare);
    if (c0.status !== 0 || !c0.stdout.includes('NEXT: git init -b main') || readdirSync(bare).length !== 0) report(`--check on an empty folder: exit ${c0.status}, expected 0, "NEXT: git init -b main" and nothing written\n${c0.stdout}${c0.stderr}`);
    const fresh = join(dir, 'fresh');
    mkdirSync(join(fresh, '.claude'), { recursive: true });
    git(fresh, 'init', '-q', '-b', 'master');
    writeFileSync(join(fresh, '.claude', 'settings.local.json'), '{"permissions":{"allow":["Bash(git init *)"]}}\n');
    writeFileSync(join(fresh, '.DS_Store'), 'x');
    const c1 = preflight(fresh);
    if (c1.status !== 0 || !c1.stdout.includes('NEXT: git symbolic-ref HEAD refs/heads/main')) report(`--check on a fresh repository with Claude Code's local settings: exit ${c1.status}, expected 0 and the symbolic-ref step\n${c1.stdout}${c1.stderr}`);
    const keep = readFileSync(join(fresh, '.claude', 'settings.local.json'), 'utf8');
    const l1 = layOut(fresh);
    if (l1.status !== 0 || readFileSync(join(fresh, '.claude', 'settings.local.json'), 'utf8') !== keep) report(`layout next to .claude/settings.local.json: exit ${l1.status}, expected 0 with the file untouched\n${l1.stderr}`);
    const litter = join(dir, 'litter');
    mkdirSync(litter);
    git(litter, 'init', '-q', '-b', 'main');
    for (const f of ['.DS_Store', 'Thumbs.db', 'desktop.ini']) writeFileSync(join(litter, f), 'x');
    if (layOut(litter).status !== 0) report('layout next to OS files was refused');
    git(litter, 'add', '-A');
    git(litter, 'commit', '-q', '-m', 'kickoff');
    const litterGate = spawnSync('bash', ['scripts/gate', '--full'], { cwd: litter, encoding: 'utf8', env: { ...process.env, GIT_CEILING_DIRECTORIES: dir } });
    if (litterGate.status !== 0) report(`the gate fails after a layout next to OS files:\n${litterGate.stdout}`);
    const c2 = preflight(code);
    if (c2.status !== 1) report(`--check on a folder with code: exit ${c2.status}, expected 1`);
    const committed = join(dir, 'committed');
    mkdirSync(committed);
    git(committed, 'init', '-q', '-b', 'main');
    git(committed, 'commit', '-q', '--allow-empty', '-m', 'first');
    const c3 = preflight(committed);
    if (c3.status !== 1 || !/already has commits/.test(c3.stderr)) report(`--check on a repository with commits: exit ${c3.status}, expected 1\n${c3.stderr}`);
    const nested = join(committed, 'sub');
    mkdirSync(nested);
    const c4 = preflight(nested);
    if (c4.status !== 0 || !c4.stdout.includes('NEXT: git init -b main') || !/inside the repository at/.test(c4.stdout)) report(`--check in a folder inside another repository: exit ${c4.status}, expected 0 with its own git init\n${c4.stdout}${c4.stderr}`);
    writeFileSync(join(dir, 'a-file'), 'x');
    const c5 = runScript('layout.mjs', ['--check', '--target', join(dir, 'a-file')]);
    if (c5.status !== 2) report(`--check on a file: exit ${c5.status}, expected 2`);

    const usage = [
      ['--check with --name', runScript('layout.mjs', ['--check', '--target', join(dir, 'u0'), '--name', 'x'])],
      ['--level huge', layOut(join(dir, 'u1'), ['--level', 'huge'])],
      ['no --idea', runScript('layout.mjs', ['--target', join(dir, 'u2'), '--name', 'x', '--level', 'lite'])],
      ['unknown flag', layOut(join(dir, 'u3'), ['--force'])],
    ];
    for (const [label, u] of usage) if (u.status !== 2) report(`${label}: exit ${u.status}, expected 2`);
  });
});

// Filled-in documents for a scratch project, as kickoff, discovery and decide would leave them.
function fillStages(project) {
  const cfg = JSON.parse(readFileSync(join(plugin, 'config', 'defaults.json'), 'utf8'));
  const put = (relPath, text) => writeFileSync(join(project, relPath), text);
  put('docs/IDEA.md', '# Idea\n\n## Problem\n\nI sit for hours and forget to move.\n\n## Who it is for\n\nMe alone.\n\n## Out of scope\n\nTeams and phones.\n\n## Process level\n\nOne user, no money, no personal data: lite.\n');
  const analogues = Array.from({ length: cfg.discovery.analogues.min }, (_, i) => `| App ${i} | Reminds | Free | Electron | Nags | https://example.com/${i} |`);
  const constraints = cfg.discovery.constraints.map((c) => `| ${c} | Settled | 2026-11-05 |`);
  const scenarios = Array.from({ length: cfg.discovery.scenarios.min }, (_, i) => `- Scenario ${i}`);
  put(
    'docs/DISCOVERY.md',
    [
      '# Discovery', '', '## Problem and user', '', 'One person at a desk.', '', '## Scenarios', '', ...scenarios, '', '## Non-goals', '', '- No phone app', '',
      '## Analogues', '', '| Product | What it does | How it makes money | Stack | What it lacks | Link |', '| --- | --- | --- | --- | --- | --- |', ...analogues, '',
      '## Owner constraints', '', '| Constraint | Answer | Confirmed on |', '| --- | --- | --- |', ...constraints, '',
      '## Assumptions by risk', '', '| ID | Assumption | Risk | How to check it |', '| --- | --- | --- | --- |',
      '| A-1 | Notifications fire over full-screen apps | high | Spike on both systems |', '| A-2 | A tray icon is enough | low | Ask two users |', '',
    ].join('\n'),
  );
  const own = { Language: 'ADR-0002', 'Hosting and staging': 'ADR-0003' };
  const oneWay = cfg.decide.oneWay.map((a) => `| ${a} | Choice | - | - | ${own[a] ?? 'ADR-0001'} |`);
  const twoWay = cfg.decide.areas.filter((a) => !cfg.decide.oneWay.includes(a)).map((a) => `| ${a} | Default | Fits one user |`);
  put(
    'docs/STACK.md',
    [
      '# Stack', '', '## Decisions', '', '| Area | Choice | Version | Source | ADR |', '| --- | --- | --- | --- | --- |', ...oneWay,
      '| Test strategy | vitest | 3.2.4 | [npm](https://www.npmjs.com/package/vitest) 2026-11-05 | - |', '',
      '## Models, prices and limits', '', 'None: the app calls no model and no paid API.', '', '## Two-way decisions', '', '| Area | Choice | Why, in one line |', '| --- | --- | --- |', ...twoWay, '',
    ].join('\n'),
  );
  put(
    'docs/adr/0001-stack.md',
    '# ADR-0001: Stack\n\n- Status: accepted\n- Date: 2026-11-05\n- Class: one-way\n- Decided by: owner\n\n## Context\n\nA desktop app.\n\n## Options\n\n| Option | Pros | Cons | Maturity | Cost | Lock-in | Source |\n| --- | --- | --- | --- | --- | --- | --- |\n| Tauri | Small | Rust | Stable | Free | Low | https://tauri.app |\n| Electron | Known | Big | Stable | Free | Low | https://electronjs.org |\n\n## Decision\n\nTauri.\n\n## Consequences\n\nRust in the toolchain.\n',
  );
  const adr = readFileSync(join(project, 'docs/adr/0001-stack.md'), 'utf8');
  put('docs/adr/0002-language.md', adr.replace('# ADR-0001: Stack', '# ADR-0002: Language'));
  put('docs/adr/0003-hosting.md', adr.replace('# ADR-0001: Stack', '# ADR-0003: Hosting'));
  const claude = readFileSync(join(project, 'CLAUDE.md'), 'utf8');
  put('CLAUDE.md', claude.replace('## Architecture boundaries\n', '## Architecture boundaries\n\n- The UI never touches the file system directly: enforced by the Tauri allowlist.\n'));
}

// 6e. T1-AC5: the docs check passes on a fresh layout and on pitwall's own docs, and reports
// a missing section, a broken ID, an oversized file and every stage Check it is given (L-2).
step('docs check', (report) => {
  const own = docsCheck(root, ['--only', 'ids,size']);
  if (own.status !== 0) report(`pitwall's own docs:\n${own.stdout}${own.stderr}`);

  scratch('pitwall-docs-', (dir) => {
    const base = join(dir, 'base');
    if (layOut(base).status !== 0) return report('layout failed');
    const fresh = docsCheck(base);
    if (fresh.status !== 0) report(`a fresh layout must pass:\n${fresh.stdout}`);
    const unfilled = docsCheck(base, ['--stage', 'kickoff']);
    if (unfilled.status !== 1 || !/IDEA\.md: section "## Problem" is not filled in/.test(unfilled.stdout)) report(`--stage kickoff must fail on an unfilled IDEA.md:\n${unfilled.stdout}`);

    let n = 0;
    // Copies the base project, breaks it, and expects the check to fail with these messages.
    const broken = (label, breakIt, expected, extra = []) => {
      const copy = join(dir, `case-${(n += 1)}`);
      cpSync(base, copy, { recursive: true });
      breakIt(copy);
      const r = docsCheck(copy, extra);
      const missing = expected.filter((e) => !e.test(r.stdout));
      if (expected.length === 0 ? r.status !== 0 : r.status !== 1 || missing.length > 0) {
        report(`${label}: exit ${r.status}, expected ${expected.length ? 1 : 0}${missing.length ? `, no line matching ${missing.join(', ')}` : ''}\n${r.stdout}${r.stderr}`);
      }
    };
    const edit = (copy, relPath, fn) => writeFileSync(join(copy, relPath), fn(readFileSync(join(copy, relPath), 'utf8')));

    broken('missing section', (c) => edit(c, 'docs/DISCOVERY.md', (t) => t.replace('## Non-goals\n', '')), [/DISCOVERY\.md: missing section "## Non-goals"/]);
    broken('missing ADR section', (c) => writeFileSync(join(c, 'docs/adr/0001-x.md'), '# ADR-0001: X\n\n## Context\n\n## Decision\n'), [/0001-x\.md: missing section "## Options"/, /0001-x\.md: missing section "## Consequences"/]);
    broken('missing file', (c) => rmSync(join(c, 'docs', 'IDEA.md')), [/docs\/IDEA\.md: missing/]);
    broken('broken IDs', (c) => appendFileSync(join(c, 'docs', 'SPEC.md'), '\nSee ADR-0042, E7, E0-AC9, BUG-3, L-2, A-4 and R-1.\n'), [
      /SPEC\.md:\d+: ADR-0042 points nowhere/, /E7 points nowhere/, /E0-AC9 points nowhere/, /BUG-3 points nowhere/, /L-2 points nowhere/, /A-4 points nowhere/, /R-1 points nowhere/,
    ]);
    broken('IDs that resolve', (c) => appendFileSync(join(c, 'docs', 'SPEC.md'), '\nE0 and E0-AC1 exist; `ADR-0042` is an example.\n\n```\nBUG-99 in a code block\n```\n'), []);
    broken('state file too big', (c) => appendFileSync(join(c, 'docs', 'BUGS.md'), 'x'.repeat(51 * 1024)), [/BUGS\.md: [\d.]+ KB, over the 50 KB limit/]);
    broken('CLAUDE.md too long', (c) => appendFileSync(join(c, 'CLAUDE.md'), '- line\n'.repeat(200)), [/CLAUDE\.md: \d+ lines, over the 200-line limit/]);

    // Stage checks: a filled project passes every stage, and each kind of gap is reported.
    broken('filled stages pass', (c) => fillStages(c), [], ['--stage', 'kickoff']);
    broken('filled discovery passes', (c) => fillStages(c), [], ['--stage', 'discovery']);
    broken('filled decide passes', (c) => fillStages(c), [], ['--stage', 'decide']);
    broken('kickoff placeholders', (c) => {
      fillStages(c);
      edit(c, '.claude/pitwall.json', (t) => t.replace('"lite"', '"huge"'));
      writeFileSync(join(c, 'notes.md.tmpl'), '{{PROJECT_NAME}}\n');
      edit(c, 'CLAUDE.md', (t) => `{{PROJECT_NAME}}\n${t}`);
    }, [/notes\.md\.tmpl: still carries the \.tmpl suffix/, /CLAUDE\.md: still holds a \{\{PLACEHOLDER\}\}/, /processLevel "huge"/], ['--stage', 'kickoff']);
    broken('discovery gaps', (c) => {
      fillStages(c);
      edit(c, 'docs/DISCOVERY.md', (t) => t.replace('https://example.com/0', 'see the site').replace('| Licence | Settled | 2026-11-05 |', '| Licence | Settled | yes |').replace('full-screen apps | high |', 'full-screen apps | low |').replace('| A-2 | A tray icon is enough | low |', '| A-2 | A tray icon is enough | high |').replace('- Scenario 0\n', ''));
    }, [/analogue "App 0" has no link/, /constraint "Licence" has no confirmation date/, /A-2: assumptions are not sorted by risk/, /2 scenarios, expected 3 to 7/], ['--stage', 'discovery']);
    broken('decide gaps', (c) => {
      fillStages(c);
      edit(c, 'docs/STACK.md', (t) => t.replace('| Database | Choice | - | - | ADR-0001 |\n', '').replace('[npm](https://www.npmjs.com/package/vitest) 2026-11-05', 'npm').replace('| i18n | Default | Fits one user |\n', ''));
      edit(c, 'docs/adr/0001-stack.md', (t) => t.replace('- Decided by: owner', '- Decided by: agent'));
    }, [/area "Database" is in neither table/, /area "i18n" is in neither table/, /vitest" 3\.2\.4 has no registry link with a date/, /one-way decision must be decided by the owner/], ['--stage', 'decide']);
    // At lite a one-way area may end in the accepted two-way list (processLevels.lite.decisions); above lite it may not.
    broken('one-way area as a two-way line at lite', (c) => {
      fillStages(c);
      edit(c, 'docs/STACK.md', (x) => x.replace('| Auth | Choice | - | - | ADR-0001 |\n', '').replace(/(\| Area \| Choice \| Why, in one line \|\n\| --- \| --- \| --- \|\n)/, '$1| Auth | Passwords | Simple |\n'));
    }, [], ['--stage', 'decide']);
    broken('one-way area decided as two-way', (c) => {
      fillStages(c);
      edit(c, '.claude/pitwall.json', (x) => x.replace('"lite"', '"standard"'));
      edit(c, 'docs/STACK.md', (t) => t.replace('| Auth | Choice | - | - | ADR-0001 |\n', '').replace(/(\| Area \| Choice \| Why, in one line \|\n\| --- \| --- \| --- \|\n)/, '$1| Auth | Passwords | Simple |\n'));
    }, [/one-way area "Auth" has no ADR/], ['--stage', 'decide']);
    // B1 of the T1 review: a one-way area must cite an accepted one-way ADR the owner decided.
    broken('one-way area cites a two-way ADR', (c) => {
      fillStages(c);
      edit(c, 'docs/adr/0001-stack.md', (x) => x.replace('- Class: one-way', '- Class: two-way').replace('- Decided by: owner', '- Decided by: agent'));
    }, [/one-way area "Database" cites ADR-0001, which is not an accepted one-way decision by the owner/], ['--stage', 'decide']);
    broken('one-way ADR only proposed', (c) => {
      fillStages(c);
      edit(c, 'docs/adr/0001-stack.md', (x) => x.replace('- Status: accepted', '- Status: proposed'));
    }, [/cites ADR-0001, which is not an accepted one-way decision/], ['--stage', 'decide']);
    broken('option without a source', (c) => {
      fillStages(c);
      edit(c, 'docs/adr/0001-stack.md', (x) => x.replace('| Low | https://tauri.app |', '| Low | the website |').replace('| Electron | Known | Big |', '| Electron |  | Big |'));
    }, [/option "Tauri" has no source link/, /option "Electron" has an empty cell/], ['--stage', 'decide']);
    broken('two-way area without its reason', (c) => {
      fillStages(c);
      edit(c, 'docs/STACK.md', (x) => x.replace('| Test strategy | Default | Fits one user |\n', ''));
    }, [/area "Test strategy" has neither an ADR nor a line with its reason/], ['--stage', 'decide']);
    broken('ADR cited as a link', (c) => {
      fillStages(c);
      edit(c, 'docs/STACK.md', (x) => x.replace('| Database | Choice | - | - | ADR-0001 |', '| Database | Choice | - | - | [ADR-0001](adr/0001-stack.md) |'));
    }, [], ['--stage', 'decide']);
    broken('duplicate analogues', (c) => {
      fillStages(c);
      edit(c, 'docs/DISCOVERY.md', (x) => x.replace('| App 1 | Reminds | Free | Electron | Nags | https://example.com/1 |', '| App 0 | Reminds | Free | Electron | Nags | https://example.com/0 |'));
    }, [/analogue "App 0" is listed twice/], ['--stage', 'discovery']);
    broken('settings that are not an object', (c) => {
      fillStages(c);
      writeFileSync(join(c, '.claude', 'pitwall.json'), 'null\n');
    }, [/pitwall\.json: is not a JSON object/], ['--stage', 'kickoff']);
    broken('a template version with junk', (c) => {
      fillStages(c);
      edit(c, '.claude/pitwall.json', (x) => x.replace(/"templateVersion": "[^"]+"/, '"templateVersion": "0.2.0garbage"'));
    }, [/templateVersion "0\.2\.0garbage" is not a version/], ['--stage', 'kickoff']);
    broken('IDs in longer code spans', (c) => appendFileSync(join(c, 'docs', 'SPEC.md'), '\n``ADR-0042 with a ` inside`` is an example.\n'), []);
    broken('an escaped pipe inside a cell', (c) => {
      fillStages(c);
      edit(c, 'docs/DISCOVERY.md', (x) => x.replace('| App 0 | Reminds |', '| App 0 | Reminds \\| nags |'));
    }, [], ['--stage', 'discovery']);
    broken('a one-way area cites an ADR with no file', (c) => {
      fillStages(c);
      edit(c, 'docs/STACK.md', (x) => x.replace('| Database | Choice | - | - | ADR-0001 |', '| Database | Choice | - | - | `ADR-0042` |'));
    }, [/"Database" cites ADR-0042, which has no file in docs\/adr\//], ['--stage', 'decide']);
    broken('options without the compared columns', (c) => {
      fillStages(c);
      edit(c, 'docs/adr/0001-stack.md', (x) => x.replace('| Option | Pros | Cons | Maturity | Cost | Lock-in | Source |\n| --- | --- | --- | --- | --- | --- | --- |', '| Option | Source |\n| --- | --- |'));
    }, [/0001-stack\.md: the table in "## Options" must keep the template's columns/], ['--stage', 'decide']);
    broken('an option row short of cells', (c) => {
      fillStages(c);
      edit(c, 'docs/adr/0001-stack.md', (x) => x.replace('| Electron | Known | Big | Stable | Free | Low | https://electronjs.org |', '| Electron | Known | https://electronjs.org |'));
    }, [/the row "Electron" has 3 cells, the table has 7 columns/], ['--stage', 'decide']);
    broken('an ADR and a Not needed line for one area', (c) => {
      fillStages(c);
      edit(c, 'docs/STACK.md', (x) => x.replace(/(\| Area \| Choice \| Why, in one line \|\n\| --- \| --- \| --- \|\n)/, '$1| Database | Not needed | One file |\n'));
    }, [/area "Database" has an ADR and a "Not needed" line/], ['--stage', 'decide']);
    broken('two ADRs with one number', (c) => {
      fillStages(c);
      writeFileSync(join(c, 'docs', 'adr', '0001-again.md'), readFileSync(join(c, 'docs', 'adr', '0001-stack.md'), 'utf8'));
    }, [/two ADR files share the number 0001/], ['--stage', 'decide']);
    broken('decided by "ownerless"', (c) => {
      fillStages(c);
      edit(c, 'docs/adr/0001-stack.md', (x) => x.replace('- Decided by: owner', '- Decided by: ownerless'));
    }, [/a one-way decision must be decided by the owner/], ['--stage', 'decide']);
    broken('assumptions numbered out of order', (c) => {
      fillStages(c);
      edit(c, 'docs/DISCOVERY.md', (x) => x.replace('| A-1 | Notifications', '| A-2 | Notifications').replace('| A-2 | A tray icon', '| A-1 | A tray icon'));
    }, [/assumption A-2 is row 1/], ['--stage', 'discovery']);
    broken('a discovery table with other columns', (c) => {
      fillStages(c);
      edit(c, 'docs/DISCOVERY.md', (x) => x.replace('| Constraint | Answer | Confirmed on |', '| Constraint | Answer | When |'));
    }, [/the table in "## Owner constraints" must keep the template's columns/], ['--stage', 'discovery']);
    // The ADR files stay, but no one-way area cites them: they do not count.
    broken('lite with no one-way decision cited', (c) => {
      fillStages(c);
      const cfgNow = JSON.parse(readFileSync(join(plugin, 'config', 'defaults.json'), 'utf8'));
      edit(c, 'docs/STACK.md', (x) => {
        for (const a of cfgNow.decide.oneWay) x = x.replace(new RegExp(`\\| ${a} \\| Choice \\| - \\| - \\| ADR-\\d{4} \\|\\n`), '');
        return x.replace(/(\| Area \| Choice \| Why, in one line \|\n\| --- \| --- \| --- \|\n)/, (m) => m + cfgNow.decide.oneWay.map((a) => `| ${a} | Default | Simple |\n`).join(''));
      });
    }, [/one-way areas cite 0 accepted one-way decisions by the owner; the lite level asks for at least 3/], ['--stage', 'decide']);
    broken('lite with two cited one-way decisions', (c) => {
      fillStages(c);
      edit(c, 'docs/STACK.md', (x) => x.replace('| Hosting and staging | Choice | - | - | ADR-0003 |', '| Hosting and staging | Choice | - | - | ADR-0001 |'));
    }, [/one-way areas cite 2 accepted one-way decisions/], ['--stage', 'decide']);
    broken('a second row of a one-way area cites an ADR with no file', (c) => {
      fillStages(c);
      edit(c, 'docs/STACK.md', (x) => x.replace('| Language | Choice | - | - | ADR-0002 |', '| Language | Choice | - | - | ADR-0002 |\n| Language | A helper | - | - | `ADR-0042` |'));
    }, [/"Language" cites ADR-0042, which has no file in docs\/adr\//], ['--stage', 'decide']);
    broken('a two-way area cites an ADR with no file', (c) => {
      fillStages(c);
      edit(c, 'docs/STACK.md', (x) => x.replace('2026-11-05 | - |', '2026-11-05 | `ADR-0042` |'));
    }, [/"Test strategy" cites ADR-0042, which has no file in docs\/adr\//], ['--stage', 'decide']);
    // A short two-way row for a one-way area reaches the "Not needed" test, which once crashed on it.
    broken('a short two-way row', (c) => {
      fillStages(c);
      edit(c, 'docs/STACK.md', (x) => x.replace(/(\| Area \| Choice \| Why, in one line \|\n\| --- \| --- \| --- \|\n)/, '$1| Auth |\n'));
    }, [/the row "Auth" has 1 cells/], ['--stage', 'decide']);
    broken('one-way area not needed', (c) => {
      fillStages(c);
      edit(c, 'docs/STACK.md', (t) => t.replace('| Auth | Choice | - | - | ADR-0001 |\n', '').replace(/(\| Area \| Choice \| Why, in one line \|\n\| --- \| --- \| --- \|\n)/, '$1| Auth | Not needed | One local user |\n'));
    }, [], ['--stage', 'decide']);
  });

  // A crash is not a report: no case may end in a stack trace.
  const usage = docsCheck(root, ['--stage', 'nope']);
  if (usage.status !== 2) report(`--stage nope: exit ${usage.status}, expected 2`);
  const noRoot = docsCheck(join(root, 'no-such-folder'), ['--stage', 'kickoff']);
  if (noRoot.status !== 2 || /at .+\.mjs/.test(noRoot.stderr)) report(`a missing --root: exit ${noRoot.status}, expected 2 without a stack trace\n${noRoot.stderr}`);
});

// 6f. T1-AC2: protect.mjs against a fake gh. It checks before it writes (L-5), writes the
// protection ADR-0005 asks for, hands over instead of failing, and a dry run writes nothing.
step('merge protection (fake gh)', (report) => {
  scratch('pitwall-protect-', (dir) => {
    const fake = join(dir, 'fake-gh.mjs');
    writeFileSync(
      fake,
      `import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
const s = JSON.parse(process.env.FAKE_GH);
const args = process.argv.slice(2);
let input = '';
try { input = readFileSync(0, 'utf8'); } catch {}
appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ args, input }) + '\\n');
const out = (o) => { process.stdout.write(typeof o === 'string' ? o : JSON.stringify(o)); process.exit(0); };
const err = (m) => { process.stderr.write(m + '\\n'); process.exit(1); };
const state = process.env.FAKE_GH_STATE;
if (args[0] === '--version') out('gh version 2.0.0 (fake)\\n');
if (args[0] === 'auth') s.auth ? out('Logged in\\n') : err('You are not logged into any GitHub hosts.');
if (args[0] === 'repo') s.repo ? out(s.repo) : err('no git remotes found');
if (args[0] === 'api') {
  const path = args.find((a) => a.startsWith('repos/'));
  const stored = existsSync(state) ? JSON.parse(readFileSync(state, 'utf8')) : s.protection ?? null;
  if (args.includes('PUT')) {
    if (s.put === 'refuse') err('gh: Resource not accessible by integration (HTTP 403)');
    const b = JSON.parse(input);
    // "lost": GitHub answers OK but the protection never shows up.
    if (s.put === 'ok') writeFileSync(state, JSON.stringify({ required_status_checks: { checks: b.required_status_checks.checks.map((c) => ({ context: c.context, app_id: c.app_id === -1 ? null : c.app_id })) }, enforce_admins: { enabled: b.enforce_admins } }));
    out('{}');
  }
  if (path.endsWith('/protection')) {
    if (s.probe === 'free') err('gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)');
    if (stored) out(stored);
    if (s.probe === 'denied') err('gh: Resource not accessible by integration (HTTP 403)');
    err('gh: Branch not protected (HTTP 404)');
  }
  if (s.branch === false) err('gh: Branch not found (HTTP 404)');
  if (s.branch === 'garbled') out('not json');
  // The branch endpoint: the protection summary any reader sees.
  out(stored
    ? { name: 'main', protected: true, protection: { enabled: true, required_status_checks: { checks: stored.required_status_checks.checks, enforcement_level: stored.enforce_admins?.enabled ? 'everyone' : 'non_admins' } } }
    : { name: 'main', protected: false, protection: { enabled: false } });
}
err('fake gh: unexpected call ' + args.join(' '));
`,
    );
    const cfg = JSON.parse(readFileSync(join(plugin, 'config', 'defaults.json'), 'utf8'));
    const expectedBody = {
      required_status_checks: { strict: cfg.mergeProtection.strict, checks: [{ context: cfg.review.gateContext, app_id: cfg.mergeProtection.githubActionsAppId }, { context: cfg.review.statusContext, app_id: -1 }] },
      enforce_admins: cfg.mergeProtection.enforceAdmins,
      required_pull_request_reviews: null,
      restrictions: null,
    };
    // ADR-0005 in plain values, so a config edit cannot quietly weaken it.
    if (expectedBody.enforce_admins !== true || cfg.review.gateContext !== 'gate' || cfg.review.statusContext !== 'ai-review' || cfg.mergeProtection.githubActionsAppId !== 15368) {
      report('config/defaults.json no longer asks for gate (GitHub Actions) and ai-review with admins included (ADR-0005)');
    }
    const repo = (visibility, viewerPermission = 'ADMIN') => ({ nameWithOwner: 'o/r', visibility, viewerPermission });
    const ok = { auth: true, repo: repo('PUBLIC'), branch: true, probe: '404', put: 'ok' };
    let n = 0;
    const run = (label, scenario, { args = [], gh, code, result, puts, setting, says = [], before = 'pending', raw }) => {
      const project = join(dir, `p${(n += 1)}`);
      mkdirSync(join(project, '.claude'), { recursive: true });
      if (raw !== undefined) writeFileSync(join(project, '.claude', 'pitwall.json'), raw);
      else if (before) writeFileSync(join(project, '.claude', 'pitwall.json'), JSON.stringify({ templateVersion: '0.0.0', processLevel: 'lite', mergeProtection: before }));
      const logFile = join(project, 'gh.log');
      writeFileSync(logFile, '');
      const env = { ...process.env, PITWALL_GH: JSON.stringify(gh ?? [process.execPath, fake]), FAKE_GH: JSON.stringify(scenario), FAKE_GH_LOG: logFile, FAKE_GH_STATE: join(project, 'state.json') };
      const r = runScript('protect.mjs', ['--project', project, ...args], { env, cwd: project });
      const calls = readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      const putCalls = calls.filter((c) => c.args.includes('PUT'));
      const settingsFile = join(project, '.claude', 'pitwall.json');
      const stored = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, 'utf8'))?.mergeProtection ?? null : null;
      const fail = (msg) => report(`${label}: ${msg}\n${r.stdout}${r.stderr}`);
      if (r.status !== code) fail(`exit ${r.status}, expected ${code}`);
      if (result && !r.stdout.includes(`RESULT: ${result}`)) fail(`no "RESULT: ${result}"`);
      if (putCalls.length !== puts) fail(`${putCalls.length} writes, expected ${puts}`);
      for (const c of putCalls) if (JSON.stringify(JSON.parse(c.input)) !== JSON.stringify(expectedBody)) fail(`wrote ${c.input}, expected ${JSON.stringify(expectedBody)}`);
      if (stored !== setting) fail(`.claude/pitwall.json says ${stored}, expected ${setting}`);
      for (const s of says) if (!r.stdout.includes(s)) fail(`output lacks "${s}"`);
      // A handed-over command must build the same body, by gh's own rules for -F fields (L-6).
      const handed = /gh api -X PUT repos\/o\/r\/branches\/main\/protection((?: -F "[^"]+")+)/.exec(r.stdout);
      if (handed) {
        const built = ghFields([...handed[1].matchAll(/-F "([^"]+)"/g)].map((m) => m[1]));
        if (JSON.stringify(built) !== JSON.stringify(expectedBody)) fail(`the handed-over command writes ${JSON.stringify(built)}`);
      }
      // Every line the owner is told to run works unchanged in bash and PowerShell: no pipes, redirects or placeholders (L-6).
      const commands = [...r.stdout.matchAll(/^ {2}(?:run|then): (.+)$/gm)].map((m) => m[1]);
      for (const c of commands) if (/[<>|]|--input -/.test(c)) fail(`a handed-over command would not run as written in both shells (L-6): ${c}`);
      if (r.stdout.includes('HANDOFF') && commands.length === 0) fail('a handoff without a ready command');
      return { r, calls, handed };
    };
    // What "gh api -F key[a][][b]=v ..." sends: typed values, and a repeated key starts a new array item.
    function ghFields(fields) {
      const body = {};
      for (const f of fields) {
        const at = f.indexOf('=');
        const raw = f.slice(at + 1);
        const value = raw === 'true' ? true : raw === 'false' ? false : raw === 'null' ? null : /^-?\d+$/.test(raw) ? Number(raw) : raw;
        const keys = f.slice(0, at).replace(/\]/g, '').split('[');
        let cur = body;
        for (let i = 0; i < keys.length - 1; i += 1) {
          if (keys[i + 1] === '') {
            const list = (cur[keys[i]] ??= []);
            if (list.length === 0 || keys[i + 2] in list[list.length - 1]) list.push({});
            cur = list[list.length - 1];
            i += 1;
          } else {
            cur = cur[keys[i]] ??= {};
          }
        }
        cur[keys[keys.length - 1]] = value;
      }
      return body;
    }

    const protectedOk = { required_status_checks: { checks: [{ context: 'gate', app_id: 15368 }, { context: 'ai-review', app_id: null }] }, enforce_admins: { enabled: true } };
    run('public', ok, { code: 0, result: 'branch-protection', puts: 1, setting: 'branch-protection' });
    run('private, paid plan', { ...ok, repo: repo('PRIVATE') }, { code: 0, result: 'branch-protection', puts: 1, setting: 'branch-protection' });
    run('dry run', ok, { args: ['--dry-run'], code: 0, result: 'branch-protection (dry run', puts: 0, setting: 'pending', says: ['"enforce_admins": true', 'would run gh api -X PUT'] });
    run('private, GitHub Free', { ...ok, repo: repo('PRIVATE'), probe: 'free' }, { code: 0, result: 'local-hook', puts: 0, setting: 'local-hook' });
    run('dry run, GitHub Free', { ...ok, repo: repo('PRIVATE'), probe: 'free' }, { args: ['--dry-run'], code: 0, result: 'local-hook', puts: 0, setting: 'pending' });
    run('already protected', { ...ok, protection: protectedOk }, { code: 0, result: 'branch-protection', puts: 0, setting: 'branch-protection' });
    run('not admin, already protected', { ...ok, repo: repo('PUBLIC', 'WRITE'), protection: protectedOk }, { code: 0, result: 'branch-protection', puts: 0, setting: 'branch-protection' });
    run('protected otherwise', { ...ok, protection: { required_status_checks: { checks: [{ context: 'build', app_id: 1 }] }, enforce_admins: { enabled: false } } }, { code: 3, result: 'pending', puts: 0, setting: 'pending', says: ['HANDOFF'] });
    run('admins excluded', { ...ok, protection: { ...protectedOk, enforce_admins: { enabled: false } } }, { code: 3, result: 'pending', puts: 0, setting: 'pending', says: ['other settings'] });
    const notAdmin = run('not admin', { ...ok, repo: repo('PUBLIC', 'WRITE') }, { code: 3, result: 'pending', puts: 0, setting: 'pending', says: ['HANDOFF', 'needs an admin'] });
    if (!notAdmin.handed) report('not admin: no ready command handed over');
    if (notAdmin.calls.some((c) => c.args.some((a) => a.endsWith('/protection')))) report('not admin: probed the protection API before checking the permission');
    const refused = run('write refused', { ...ok, put: 'refuse' }, { code: 3, result: 'pending', puts: 1, setting: 'pending', says: ['HANDOFF', 'GitHub refused the write'] });
    if (!refused.handed) report('write refused: no ready command handed over');
    run('write not read back', { ...ok, put: 'lost' }, { code: 3, result: 'pending', puts: 1, setting: 'pending', says: ['reading it back'] });
    run('probe refused', { ...ok, probe: 'denied' }, { code: 3, result: 'pending', puts: 0, setting: 'pending', says: ['HANDOFF'] });
    run('not signed in', { ...ok, auth: false }, { code: 3, result: 'pending', puts: 0, setting: 'pending', says: ['  run: gh auth login'] });
    run('recorded mode kept', { ...ok, auth: false }, { before: 'branch-protection', code: 3, result: 'pending', puts: 0, setting: 'branch-protection', says: ['kept the recorded mode'] });
    run('no repository', { ...ok, repo: null }, { code: 3, result: 'pending', puts: 0, setting: 'pending', says: ['  run: gh repo create --private --source . --remote origin', '  run: git push -u origin main'] });
    run('branch not pushed', { ...ok, branch: false }, { code: 3, result: 'pending', puts: 0, setting: 'pending', says: ['  run: git push -u origin main'] });
    run('no gh', ok, { gh: [join(dir, 'no-such-gh')], code: 3, result: 'pending', puts: 0, setting: 'pending', says: ['cli.github.com'] });
    run('no settings file', ok, { before: null, code: 0, result: 'branch-protection', puts: 1, setting: null, says: ['not recorded'] });
    const named = run('--repo', { ...ok }, { args: ['--repo', 'o/r'], code: 0, result: 'branch-protection', puts: 1, setting: 'branch-protection' });
    if (!named.calls.some((c) => c.args[0] === 'repo' && c.args.includes('o/r'))) report('--repo: the repository was not passed to gh repo view');
    run('recorded mode dropped on weaker protection', { ...ok, protection: { ...protectedOk, enforce_admins: { enabled: false } } }, { before: 'branch-protection', code: 3, result: 'pending', puts: 0, setting: 'pending' });
    run('repository not readable', { ...ok, repo: null }, { args: ['--repo', 'o/r'], code: 3, result: 'pending', puts: 0, setting: 'pending', says: ['gh could not read the repository'] });
    run('not admin, private', { ...ok, repo: repo('PRIVATE', 'WRITE') }, { code: 3, result: 'pending', puts: 0, setting: 'pending', says: ['Upgrade to GitHub Pro'] });
    run('settings that are not an object', ok, { raw: '[1]\n', code: 0, result: 'branch-protection', puts: 1, setting: null, says: ['not a JSON object'] });
    run('recorded protection gone, not admin', { ...ok, repo: repo('PUBLIC', 'WRITE') }, { before: 'branch-protection', code: 3, result: 'pending', puts: 0, setting: 'pending' });
    run('recorded protection, write refused', { ...ok, put: 'refuse' }, { before: 'branch-protection', code: 3, result: 'pending', puts: 1, setting: 'pending' });
    run('recorded local-hook, not admin', { ...ok, repo: repo('PRIVATE', 'WRITE') }, { before: 'local-hook', code: 3, result: 'pending', puts: 0, setting: 'local-hook', says: ['kept the recorded mode'] });
    run('dry run that hands over', { ...ok, auth: false }, { args: ['--dry-run'], code: 3, result: 'pending (dry run', puts: 0, setting: 'pending' });
    run('dry run keeps a recorded mode', { ...ok, auth: false }, { args: ['--dry-run'], before: 'local-hook', code: 3, result: 'pending (dry run', puts: 0, setting: 'local-hook', says: ['dry run: would keep the recorded mode "local-hook"'] });
    run('recorded local-hook, private paid plan, probe 404, write refused', { ...ok, repo: repo('PRIVATE'), put: 'refuse' }, { before: 'local-hook', code: 3, result: 'pending', puts: 1, setting: 'pending' });
    run('recorded local-hook, public, not admin', { ...ok, repo: repo('PUBLIC', 'WRITE') }, { before: 'local-hook', code: 3, result: 'pending', puts: 0, setting: 'pending' });
    run('recorded value that is not a mode', { ...ok, auth: false }, { before: 'bogus', code: 3, result: 'pending', puts: 0, setting: 'pending' });
    run('dry run, recorded local-hook, public, not admin', { ...ok, repo: repo('PUBLIC', 'WRITE') }, { args: ['--dry-run'], before: 'local-hook', code: 3, result: 'pending (dry run', puts: 0, setting: 'local-hook', says: ['would record pending'] });
    run('recorded protection kept when nothing could be read', { ...ok, branch: 'garbled', probe: 'denied' }, { before: 'branch-protection', code: 3, result: 'pending', puts: 0, setting: 'branch-protection', says: ['kept the recorded mode'] });
    run('recorded local-hook, protection available', { ...ok, protection: { required_status_checks: { checks: [{ context: 'build', app_id: 1 }] }, enforce_admins: { enabled: false } } }, { before: 'local-hook', code: 3, result: 'pending', puts: 0, setting: 'pending' });
    run('bad flag', ok, { args: ['--force'], code: 2, puts: 0, setting: 'pending' });
  });
});

// 7. Relative links in Markdown resolve.
step('markdown links', (report) => {
  for (const p of textFiles.filter((f) => f.endsWith('.md'))) {
    const text = readFileSync(p, 'utf8').replace(/```[\s\S]*?```/g, '');
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1].split('#')[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      if (!existsSync(resolve(dirname(p), target))) report(`${rel(p)}: broken link ${m[1]}`);
    }
  }
});

// 8. No em dashes anywhere. Built from its code point so this file passes its own check.
const EM_DASH = String.fromCodePoint(0x2014);
step('no em dashes', (report) => {
  for (const p of textFiles) {
    const lines = readFileSync(p, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.includes(EM_DASH)) report(`${rel(p)}:${i + 1}`);
    });
  }
});

// 9. Every file is in English: no Cyrillic (the language the owner otherwise writes in).
const CYRILLIC = new RegExp('[' + String.fromCodePoint(0x400) + '-' + String.fromCodePoint(0x4ff) + ']');
step('english only', (report) => {
  for (const p of textFiles) {
    readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      if (CYRILLIC.test(line)) report(`${rel(p)}:${i + 1}`);
    });
  }
});

// 10. No hardcoded model IDs in skills or agents: they belong in config.
step('no model ids in skills or agents', (report) => {
  const modelId = /\b(claude-(opus|sonnet|haiku|instant)[\w.-]*\d|claude-\d[\w.-]*|gpt-\d[\w.-]*|o\d-(mini|preview)|gemini-\d[\w.-]*)\b/i;
  for (const p of files(plugin).filter((f) => /^(skills|agents)[\\/]/.test(relative(plugin, f)) && f.endsWith('.md'))) {
    readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      if (modelId.test(line)) report(`${rel(p)}:${i + 1}: ${line.trim()}`);
    });
  }
});

console.log(failed === 0 ? '\nGATE: PASS' : `\nGATE: FAIL (${failed} step${failed === 1 ? '' : 's'})`);
process.exit(failed === 0 ? 0 : 1);
