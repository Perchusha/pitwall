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
// The plugin's own scripts run here as a project gets them: layout.mjs
// lays out scratch projects, docs-check.mjs must pass on them and fail on
// broken copies (T1-AC5), its spike, plan and plan-review stages too, the spike
// one on real git history (T2-AC1, T2-AC3, T2-AC4), and protect.mjs,
// review-status.mjs and merge.mjs run every branch against the fake gh in
// scripts/fake-gh.mjs (T1-AC2, T2-AC5, T2-AC6). The headless skill runs
// (scripts/e2e.mjs) are not here: they need a signed-in CLI and spend the
// subscription (T1-AC7, T2-AC7).
//
// Needs Node 22, git, bash and the Claude Code CLI (`claude`) on the PATH, at least
// the version in .claude-code-version (the one CI installs).

import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { captureRemote, restoreRemote } from './e2e-loop.mjs';
import { readOwner, resultWord } from './e2e-owner.mjs';

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
    // L-10: a skill an agent preloads names the plugin (pitwall:<skill>) and allows model invocation,
    // or Claude Code leaves it out of the agent without a word (2.1.318).
    const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
    const preload = /^skills:\s*\r?\n((?:\s+- .+\r?\n?)+)/m.exec(block)?.[1].split(/\r?\n/).map((l) => l.replace(/^\s+- /, '').trim()).filter(Boolean) ?? [];
    for (const s of preload) {
      const skill = /^pitwall:([a-z-]+)$/.exec(s)?.[1];
      const skillFile = skill ? join(plugin, 'skills', skill, 'SKILL.md') : null;
      if (!skillFile || !existsSync(skillFile)) report(`agents/${file}: preloads "${s}", which is no skill of this plugin named pitwall:<skill>`);
      else if (frontmatter(readFileSync(skillFile, 'utf8'))?.['disable-model-invocation'] === 'true') report(`agents/${file}: preloads ${s}, whose disable-model-invocation: true keeps it out of the agent (L-10)`);
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
    'docs/spikes/template.md',
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
    const want = { templateVersion: version, processLevel: 'lite', mergeProtection: 'pending', autoMerge: false };
    if (JSON.stringify(settings) !== JSON.stringify(want)) report(`.claude/pitwall.json is ${JSON.stringify(settings)}, expected ${JSON.stringify(want)}`);

    const again = layOut(project);
    if (again.status !== 1 || !/REFUSED/.test(again.stderr)) report(`a second layout must be refused with exit 1, got ${again.status}\n${again.stderr}`);
    if (readFileSync(join(project, 'CLAUDE.md'), 'utf8') !== claude) report('a refused layout changed CLAUDE.md');
    // T3a (owner): an agent cannot lay a project out again to reset its mode: a folder with .claude/pitwall.json is refused.
    const settingsBefore = readFileSync(join(project, '.claude', 'pitwall.json'), 'utf8');
    for (const extra of [['--level', 'full'], ['--level', 'lite', '--name', 'other']]) {
      const again2 = layOut(project, extra);
      if (again2.status !== 1 || readFileSync(join(project, '.claude', 'pitwall.json'), 'utf8') !== settingsBefore) report(`a layout over a project with ${extra.join(' ')} must be refused and leave .claude/pitwall.json as it was, got exit ${again2.status}`);
    }
    const onlySettings = join(dir, 'only-settings');
    mkdirSync(join(onlySettings, '.claude'), { recursive: true });
    writeFileSync(join(onlySettings, '.claude', 'pitwall.json'), '{"mergeProtection":"local-hook"}');
    const onlyRun = layOut(onlySettings);
    if (onlyRun.status !== 1 || readFileSync(join(onlySettings, '.claude', 'pitwall.json'), 'utf8') !== '{"mergeProtection":"local-hook"}') report(`a folder holding only .claude/pitwall.json must be refused and stay untouched, got exit ${onlyRun.status}`);

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
  const own = docsCheck(root, ['--only', 'ids,size', '--stage', 'bug,lesson']);
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
    // An epic split in two: both halves and their criteria resolve, and so does the bare number; another letter does not.
    const split = (c) => writeFileSync(join(c, 'docs/epics/E1a-split.md'), '# E1a - Split\n\n## Acceptance criteria\n\n- [ ] E1a-AC1: One.\n\n## Out of scope\n\nNone.\n\n## Open questions\n\nNone.\n');
    broken('a split epic resolves', (c) => {
      split(c);
      appendFileSync(join(c, 'docs', 'SPEC.md'), '\nE1, E1a and E1a-AC1 exist.\n');
    }, []);
    broken('a split epic defines only its own letter', (c) => {
      split(c);
      appendFileSync(join(c, 'docs', 'SPEC.md'), '\nE1b and E1a-AC2 do not.\n');
    }, [/E1b points nowhere/, /E1a-AC2 points nowhere/]);
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

// The fake gh (scripts/fake-gh.mjs) the protection, review status and merge steps run against.
const fakeGh = join(root, 'scripts', 'fake-gh.mjs');
// Runs a plugin script against the fake gh in a project folder, and returns what it did.
function withFakeGh(script, project, scenario, args = [], extraEnv = {}) {
  const logFile = join(project, '..', `${project.split(/[\\/]/).pop()}-gh.log`);
  writeFileSync(logFile, '');
  const env = { ...process.env, PITWALL_GH: JSON.stringify([process.execPath, fakeGh]), FAKE_GH: JSON.stringify(scenario), FAKE_GH_LOG: logFile, FAKE_GH_STATE: join(project, '..', `${project.split(/[\\/]/).pop()}-gh.json`), PITWALL_POLL_MS: '1', ...extraEnv };
  const r = runScript(script, args, { env, cwd: project });
  const calls = readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { r, calls, state: existsSync(env.FAKE_GH_STATE) ? JSON.parse(readFileSync(env.FAKE_GH_STATE, 'utf8')) : {} };
}
// The commands a HANDOFF block hands the owner: the lines under a label, indented by four spaces.
// Only lines under one of the two labels count, so a report indented the same way is not read as a command.
const handedCommands = (stdout) => {
  const out = [];
  let under = false;
  for (const line of stdout.split('\n')) {
    if (/^ {2}(Run this yourself, in bash or PowerShell|Then run this to record the result):$/.test(line)) under = true;
    else if (under && /^ {4}\S/.test(line)) out.push(line.slice(4));
    else under = false;
  }
  return out;
};
// Every command the owner is told to run works unchanged in bash and PowerShell: no pipes, redirects or placeholders (L-6).
function checkHandoff(stdout, fail) {
  const commands = handedCommands(stdout);
  for (const c of commands) if (/[<>|]|--input -/.test(c)) fail(`a handed-over command would not run as written in both shells (L-6): ${c}`);
  if (stdout.includes('HANDOFF') && commands.length === 0) fail('a handoff without a ready command');
  if (/^ {2}(run|then|note): /m.test(stdout)) fail('a handoff still uses the old "run:" lines (T2-AC6)');
  return commands;
}

// Filled-in documents for stages 4 and 5, as plan and the plan reviewer would leave them at the lite level.
function fillPlan(project) {
  const put = (relPath, text) => writeFileSync(join(project, relPath), text);
  const edit = (relPath, fn) => put(relPath, fn(readFileSync(join(project, relPath), 'utf8')));
  edit('docs/SPEC.md', (t) =>
    t
      .replace('## Overview\n', '## Overview\n\nA tray app that reminds one person to stand up.\n')
      .replace('## Scenarios\n', '## Scenarios\n\n- A reminder after 45 minutes of active use.\n')
      .replace('## Architecture\n', '## Architecture\n\nOne Tauri process (ADR-0001).\n')
      .replace('## Data model\n', '## Data model\n\nA local settings file.\n')
      .replace(/(## Non-functional requirements\n\n.*\n)/, '$1\n- Security and secrets: none kept.\n')
      .replace(/(## Launch\n\n.*\n)/, '$1\n- App stores: none, GitHub releases (confirmed 2026-11-08).\n'),
  );
  put(
    'docs/EPICS.md',
    [
      '# Epics', '', 'The plan.', '', '| Epic | Goal | Risk | Depends on | Status |', '| --- | --- | --- | --- | --- |',
      '| [E0](epics/E0-skeleton.md) | Walking skeleton | normal | decisions in `adr/` | planned |',
      '| [E1](epics/E1-reminder.md) | The reminder | normal | E0 | planned |',
      '| [E2](epics/E2-release.md) | A release on GitHub | low | E1 | planned |', '',
    ].join('\n'),
  );
  edit('docs/epics/E0-skeleton.md', (t) => t.replace('ADR: (the stack ADRs)', 'ADR: ADR-0001, ADR-0002, ADR-0003'));
  const epic = (id, title, goal, deps, risk, adr, acs) =>
    [`# ${id} - ${title}`, '', `Goal: ${goal}`, `Depends on: ${deps}`, `Risk class: ${risk}`, `ADR: ${adr}`, '', '## Acceptance criteria', '', ...acs.map((a, i) => `- [ ] ${id}-AC${i + 1}: ${a}`), '', '## Out of scope', '', 'Statistics.', '', '## Open questions', '', 'None.', ''].join('\n');
  put('docs/epics/E1-reminder.md', epic('E1', 'The reminder', 'a reminder every 45 minutes of active use.', 'E0', 'normal', 'ADR-0001', ['A reminder shows after 45 minutes of active use, also over a full-screen app (A-1).', 'Snooze delays it by 10 minutes.']));
  put('docs/epics/E2-release.md', epic('E2', 'A release on GitHub', 'an installer on GitHub releases.', 'E1', 'low', 'none', ['An installer for each system is attached to a GitHub release.']));
  edit('docs/RISKS.md', (t) => t.replace('| --- | --- | --- | --- |\n', '| --- | --- | --- | --- |\n| R-1 | A game in exclusive full screen hides the reminder | A tray badge | 2026-11-08 |\n'));
  edit('docs/PLAN-REVIEW.md', (t) =>
    t
      .replace(/(## Pre-mortem\n\n.*\n)/, '$1\nNot at the lite level.\n')
      .replace('| Requirement | Answer | Where it lives |\n| --- | --- | --- |\n', '| Requirement | Answer | Where it lives |\n| --- | --- | --- |\n| Security and secrets | None kept | SPEC.md |\n| Dependency licences | MIT and Apache | E2-AC1 |\n| Backups and restore | Settings reset to defaults | SPEC.md |\n| Performance targets | Under 50 MB | E1-AC1 |\n')
      .replace('| Question | Answer | Confirmed on |\n| --- | --- | --- |\n', '| Question | Answer | Confirmed on |\n| --- | --- | --- |\n| App stores | None: GitHub releases | 2026-11-08 |\n| Support channel | GitHub issues | 2026-11-08 |\n')
      .replace('| --- | --- | --- | --- |\n\nAn epic whose', '| --- | --- | --- | --- |\n| E0 | S | known | - |\n| E1 | M | partly | - |\n| E2 | S | known | - |\n\nAn epic whose')
      .replace(/(\| # \| Finding \| Severity \| Closed by \(epic, ADR\) or accepted risk \|\n\| --- \| --- \| --- \| --- \|\n)/, '$1| 1 | Snooze had no criterion | should fix | E1-AC2 |\n| 2 | Full-screen games hide it | should fix | R-1 |\n'),
  );
}

// A git repository with the stages done through the plan, a spike on its planning branch and
// the prototype on spike/notify, the way the skills leave it. Returns the prototype commit.
const gitIn = (cwd, ...a) => spawnSync('git', ['-c', 'user.email=check@pitwall', '-c', 'user.name=check', '-c', 'core.autocrlf=false', ...a], { cwd, encoding: 'utf8' });
const SPIKE_CRITERION = '| Reminder shown over a full-screen app | Ten tries with a full-screen video | 10 of 10 shown |';
function spikeFile(outcome, prototype, result, followUp = '-') {
  return [
    '# Spike: Notifications over full-screen apps', '',
    '- Assumption: A-1', '- Branch: spike/notify', '- Date: 2026-11-08', `- Outcome: ${outcome}`, `- Prototype: ${prototype}`, `- Follow-up: ${followUp}`, '',
    '## Hypothesis', '', 'A Tauri notification shows over a full-screen app on Windows.', '',
    '## Criterion', '', '| Metric | How it is measured | Success when |', '| --- | --- | --- |', SPIKE_CRITERION, '',
    '## Result', '', '| Metric | Measured | Measured by | Date |', '| --- | --- | --- | --- |', ...(result ? [result] : []), '',
    '## Conclusion', '', outcome === 'pending' ? 'Pending.' : `The reminder was ${outcome} against the criterion.`, '',
  ].join('\n');
}
function makePlanRepo(dir, { spike = true } = {}) {
  const project = join(dir, 'repo');
  if (layOut(project).status !== 0) throw new Error('layout failed');
  gitIn(project, 'init', '-q', '-b', 'main');
  gitIn(project, 'add', '-A');
  gitIn(project, 'commit', '-qm', 'chore: kickoff');
  gitIn(project, 'switch', '-qc', 'plan/initial');
  fillStages(project);
  fillPlan(project);
  gitIn(project, 'add', '-A');
  gitIn(project, 'commit', '-qm', 'docs: discovery, decisions, plan');
  if (!spike) return { project };
  writeFileSync(join(project, 'docs/spikes/notify.md'), spikeFile('pending', '-', ''));
  gitIn(project, 'add', '-A');
  gitIn(project, 'commit', '-qm', 'docs: spike notify criterion');
  gitIn(project, 'switch', '-qc', 'spike/notify');
  mkdirSync(join(project, 'proto'));
  writeFileSync(join(project, 'proto', 'notify.mjs'), 'console.log("shown");\n');
  gitIn(project, 'add', '-A');
  gitIn(project, 'commit', '-qm', 'spike: notify prototype');
  const proto = gitIn(project, 'rev-parse', 'HEAD').stdout.trim();
  gitIn(project, 'switch', '-q', 'plan/initial');
  writeFileSync(join(project, 'docs/spikes/notify.md'), spikeFile('confirmed', proto.slice(0, 12), '| Reminder shown over a full-screen app | 10 of 10 | owner, by hand | 2026-11-08 |'));
  gitIn(project, 'add', '-A');
  gitIn(project, 'commit', '-qm', 'docs: spike notify result');
  return { project, proto };
}

// 6g. T2-AC1, T2-AC3, T2-AC4: the spike, plan and plan-review checks pass on a project the way
// the skills leave it, and report each kind of gap. The spike check reads git (ADR-0009).
step('plan and spike checks', (report) => {
  scratch('pitwall-plan-', (dir) => {
    const ceiling = { env: { ...process.env, GIT_CEILING_DIRECTORIES: dir } };
    const check = (project, stages) => runScript('docs-check.mjs', ['--root', project, '--stage', stages], ceiling);
    const expect = (label, r, patterns) => {
      const missing = patterns.filter((p) => !p.test(r.stdout));
      if (patterns.length === 0 ? r.status !== 0 : r.status !== 1 || missing.length > 0) {
        report(`${label}: exit ${r.status}, expected ${patterns.length ? 1 : 0}${missing.length ? `, no line matching ${missing.join(', ')}` : ''}\n${r.stdout}${r.stderr}`);
      }
    };
    const { project: base, proto } = makePlanRepo(dir);
    expect('a finished spike', check(base, 'spike'), []);
    expect('a finished plan and review', check(base, 'plan,plan-review,spike'), []);
    expect('the gate stub on the planning branch', spawnSync('bash', ['scripts/gate', '--full'], { cwd: base, encoding: 'utf8', ...ceiling }), []);

    let n = 0;
    const copy = () => {
      const c = join(dir, `c${(n += 1)}`);
      cpSync(base, c, { recursive: true });
      return c;
    };
    const edit = (c, relPath, fn) => writeFileSync(join(c, relPath), fn(readFileSync(join(c, relPath), 'utf8')));
    const commit = (c, msg = 'edit') => {
      gitIn(c, 'add', '-A');
      gitIn(c, 'commit', '-qm', msg);
    };
    // Spike: each way the criterion, the prototype or the history can go wrong.
    let c = copy();
    edit(c, 'docs/spikes/notify.md', (t) => t.replace('10 of 10 shown |', '8 of 10 shown |'));
    commit(c);
    expect('criterion changed after its commit', check(c, 'spike'), [/the criterion changed after [0-9a-f]{7}, the commit that added it/]);
    c = copy();
    gitIn(c, 'merge', '-q', '--no-edit', 'spike/notify');
    expect('prototype merged into the planning branch', check(c, 'spike'), [/the prototype commit [0-9a-f]+ is reachable from HEAD/, /reachable from plan\/initial/]);
    c = copy();
    gitIn(c, 'switch', '-qc', 'spike/early', 'main');
    writeFileSync(join(c, 'early.mjs'), 'x\n');
    commit(c);
    const early = gitIn(c, 'rev-parse', 'HEAD').stdout.trim();
    gitIn(c, 'switch', '-q', 'plan/initial');
    edit(c, 'docs/spikes/notify.md', (t) => t.replace(proto.slice(0, 12), early.slice(0, 12)));
    commit(c);
    expect('prototype not after the criterion', check(c, 'spike'), [/does not come after [0-9a-f]{7}, the criterion commit/, /spike\/notify does not hold the prototype commit/]);
    c = copy();
    writeFileSync(join(c, 'docs/spikes/later.md'), spikeFile('confirmed', proto.slice(0, 12), '| Reminder shown over a full-screen app | 10 of 10 | owner | 2026-11-08 |').replace('spike/notify', 'spike/later'));
    expect('a spike that is not committed', check(c, 'spike'), [/later\.md: is not committed/]);
    commit(c);
    expect('a spike committed with its result', check(c, 'spike'), [/later\.md: [0-9a-f]{7}, the commit that added it, already held a result/]);
    c = copy();
    writeFileSync(join(c, 'docs/spikes/early.md'), spikeFile('pending', '-', '').replace('spike/notify', 'spike/early').replace('Pending.', 'Confirmed: 10 of 10 shown.'));
    commit(c);
    edit(c, 'docs/spikes/early.md', (t) => t.replace('- Outcome: pending', '- Outcome: confirmed').replace('| --- | --- | --- | --- |\n', '| --- | --- | --- | --- |\n| Reminder shown over a full-screen app | 10 of 10 | owner | 2026-11-08 |\n'));
    commit(c);
    expect('a criterion commit that already held a conclusion', check(c, 'spike'), [/early\.md: [0-9a-f]{7}, the commit that added it, already held a result/]);
    c = copy();
    gitIn(c, 'switch', '-qc', 'side');
    writeFileSync(join(c, 'side.txt'), 'x\n');
    commit(c);
    gitIn(c, 'switch', '-q', 'plan/initial');
    gitIn(c, 'merge', '-q', '--no-ff', '--no-commit', 'side');
    writeFileSync(join(c, 'docs/spikes/merged.md'), spikeFile('pending', '-', '').replace('spike/notify', 'spike/merged'));
    gitIn(c, 'add', '-A');
    gitIn(c, 'commit', '-qm', 'merge side with a spike in it');
    expect('a spike only a merge adds', check(c, 'spike'), [/merged\.md: no commit but a merge adds it/]);
    // T2 review, round 3.
    c = copy();
    writeFileSync(join(c, 'docs/spikes/staged.md'), spikeFile('pending', '-', '').replace('spike/notify', 'spike/staged'));
    gitIn(c, 'add', '-A');
    expect('a spike staged but not committed', check(c, 'spike'), [/staged\.md: is not committed/]);
    c = copy();
    writeFileSync(join(c, 'docs/spikes/proto.md'), spikeFile('pending', proto.slice(0, 12), '').replace('spike/notify', 'spike/proto'));
    commit(c);
    expect('a criterion commit that already named a prototype', check(c, 'spike'), [/proto\.md: [0-9a-f]{7}, the commit that added it, already held a result/]);
    c = copy();
    writeFileSync(join(c, 'docs/spikes/wording.md'), spikeFile('pending', '-', '').replace('spike/notify', 'spike/wording').replace('Pending.', 'Pending, until the prototype has run.'));
    commit(c);
    expect('a criterion commit that says pending in its own words', check(c, 'spike'), [/wording\.md: "- Outcome:" is "pending"/]);
    if (/wording\.md: [0-9a-f]{7}, the commit that added it, already held a result/.test(check(c, 'spike').stdout)) report('a criterion commit that says pending in its own words: read as a result');
    // T2 review, round 4: a result written as prose in the criterion commit is a result too.
    c = copy();
    writeFileSync(join(c, 'docs/spikes/prose.md'), spikeFile('pending', '-', '').replace('spike/notify', 'spike/prose').replace('| --- | --- | --- | --- |\n', '| --- | --- | --- | --- |\n\nAlready measured: 10 of 10 shown, by the owner on 2026-11-08.\n'));
    commit(c);
    expect('a criterion commit with the result in prose', check(c, 'spike'), [/prose\.md: [0-9a-f]{7}, the commit that added it, already held a result/]);
    c = copy();
    edit(c, 'docs/spikes/notify.md', (t) => t.replace('## Conclusion\n', 'The log:\n\n```\n| run | shown |\n| 1 | yes |\n```\n\n## Conclusion\n'));
    expect('a fenced block of output in the result', check(c, 'spike'), []);
    c = copy();
    edit(c, 'docs/spikes/notify.md', (t) => t.replace('The reminder was confirmed against the criterion.', 'Pending.'));
    expect('the plan alone with a confirmed spike whose conclusion is pending', check(c, 'plan'), [/notify\.md: the conclusion is not written/]);
    c = copy();
    edit(c, 'docs/spikes/notify.md', (t) => t.replace('- Outcome: confirmed', '- Outcome: pending').replace('10 of 10 shown |', 'all shown |').replace('| 10 of 10 | owner', '| all | owner'));
    expect('a spike without numbers or an outcome', check(c, 'spike'), [/"- Outcome:" is "pending"/, /"Success when" holds no number/, /"Measured" holds no number/]);
    c = copy();
    edit(c, 'docs/spikes/notify.md', (t) => t.replace('- Outcome: confirmed', '- Outcome: not confirmed'));
    expect('not confirmed without a follow-up', check(c, 'spike'), [/not confirmed, and "- Follow-up:" names no ADR/]);
    edit(c, 'docs/spikes/notify.md', (t) => t.replace('- Follow-up: -', '- Follow-up: pending, /pitwall:decide Platform and runtime'));
    expect('not confirmed, follow-up pending: the spike passes', check(c, 'spike'), []);
    expect('not confirmed, follow-up pending: the plan does not', check(c, 'plan'), [/notify\.md: not confirmed, and its follow-up is not done/]);
    edit(c, 'docs/spikes/notify.md', (t) => t.replace('- Follow-up: pending, /pitwall:decide Platform and runtime', '- Follow-up: R-1'));
    expect('not confirmed, risk accepted', check(c, 'plan'), []);
    // T2 review: placeholders the spike skill writes, and a "Measured by" that names no one.
    c = copy();
    edit(c, 'docs/spikes/notify.md', (t) => t.replace('The reminder was confirmed against the criterion.', 'Pending.').replace('| owner, by hand |', '| x |'));
    expect('a spike left with its placeholders', check(c, 'spike'), [/the conclusion still reads "Pending\."/, /"Measured by" is "x"/]);
    c = copy();
    edit(c, 'docs/spikes/notify.md', (t) => t.replace('- Outcome: confirmed', '- Outcome: pending'));
    expect('the plan with a spike not concluded', check(c, 'plan'), [/notify\.md: the spike is not concluded/]);
    // T2 review: a rename does not hide a changed criterion; a rename alone changes nothing.
    c = copy();
    gitIn(c, 'mv', 'docs/spikes/notify.md', 'docs/spikes/alert.md');
    commit(c, 'rename');
    gitIn(c, 'branch', '-m', 'spike/notify', 'spike/alert');
    edit(c, 'docs/spikes/alert.md', (t) => t.replace('- Branch: spike/notify', '- Branch: spike/alert'));
    commit(c);
    expect('a renamed spike', check(c, 'spike'), []);
    edit(c, 'docs/spikes/alert.md', (t) => t.replace('10 of 10 shown |', '1 of 10 shown |'));
    gitIn(c, 'mv', 'docs/spikes/alert.md', 'docs/spikes/warn.md');
    gitIn(c, 'branch', '-m', 'spike/alert', 'spike/warn');
    edit(c, 'docs/spikes/warn.md', (t) => t.replace('- Branch: spike/alert', '- Branch: spike/warn'));
    commit(c, 'rename and change');
    expect('a spike renamed with its criterion changed', check(c, 'spike'), [/warn\.md: the criterion changed after [0-9a-f]{7}, the commit that added it/]);
    // No history, or only part of it: the check fails, never passes (ADR-0009).
    const shallow = join(dir, 'shallow');
    gitIn(dir, 'clone', '-q', '--depth', '1', '--branch', 'plan/initial', pathToFileURL(base).href, shallow);
    expect('a shallow clone', check(shallow, 'spike'), [/the clone is shallow/]);
    const nogit = join(dir, 'nogit');
    cpSync(base, nogit, { recursive: true, filter: (src) => !/[\\/]\.git([\\/]|$)/.test(src) });
    expect('outside git', check(nogit, 'spike'), [/not inside a git repository/]);
    c = copy();
    const remote = join(dir, 'origin.git');
    gitIn(dir, 'init', '-q', '--bare', remote);
    gitIn(c, 'remote', 'add', 'origin', remote);
    gitIn(c, 'push', '-q', 'origin', 'plan/initial');
    gitIn(c, 'fetch', '-q', 'origin');
    expect('spike branch not pushed', check(c, 'spike'), [/push spike\/notify before this check/]);
    gitIn(c, 'push', '-q', 'origin', 'spike/notify');
    gitIn(c, 'fetch', '-q', 'origin');
    expect('spike branch pushed', check(c, 'spike'), []);

    // Plan: T2-AC3, each refusal on its own copy of the files.
    const planCase = (label, breakIt, patterns, stages = 'plan') => {
      const p = copy();
      breakIt(p, (rel, fn) => edit(p, rel, fn));
      expect(label, check(p, stages), patterns);
    };
    planCase('an epic without acceptance criteria', (p, e) => e('docs/epics/E2-release.md', (t) => t.replace(/- \[ \] E2-AC1: .*\n/, '')), [/E2-release\.md: no acceptance criteria/]);
    planCase('an epic without a risk class', (p, e) => e('docs/epics/E2-release.md', (t) => t.replace('Risk class: low\n', '')), [/E2-release\.md: no risk class/]);
    planCase('a risk class outside riskClasses', (p, e) => e('docs/epics/E1-reminder.md', (t) => t.replace('Risk class: normal', 'Risk class: medium')), [/risk class "medium" is not one of low, normal, high/]);
    planCase('row and file disagree', (p, e) => e('docs/EPICS.md', (t) => t.replace('| The reminder | normal |', '| The reminder | high |')), [/E1-reminder\.md: risk class normal, but docs\/EPICS\.md says high/]);
    planCase('a broken ADR link', (p, e) => e('docs/epics/E1-reminder.md', (t) => t.replace('ADR: ADR-0001', 'ADR: ADR-0042').replace('## Out of scope', 'See [the decision](../adr/0042-gone.md).\n\n## Out of scope')), [/E1-reminder\.md: cites ADR-0042, which has no file in docs\/adr\//, /E1-reminder\.md: broken link \.\.\/adr\/0042-gone\.md/]);
    planCase('a dependency cycle', (p, e) => {
      e('docs/EPICS.md', (t) => t.replace('| The reminder | normal | E0 |', '| The reminder | normal | E0, E2 |'));
      e('docs/epics/E1-reminder.md', (t) => t.replace('Depends on: E0', 'Depends on: E0, E2'));
    }, [/dependency cycle: E[12] -> E[12] -> E[12]/, /E1 depends on E2, which does not come before it/]);
    planCase('an unknown dependency', (p, e) => {
      e('docs/EPICS.md', (t) => t.replace('| low | E1 |', '| low | E9 |'));
      e('docs/epics/E2-release.md', (t) => t.replace('Depends on: E1', 'Depends on: E9'));
    }, [/E2 depends on E9, which is not in the plan/]);
    planCase('E0 not first', (p, e) => e('docs/EPICS.md', (t) => {
      const rows = t.split('\n');
      const i = rows.findIndex((l) => l.startsWith('| [E0]'));
      [rows[i], rows[i + 1]] = [rows[i + 1], rows[i]];
      return rows.join('\n');
    }), [/the first epic is E1: the plan starts with E0/]);
    planCase('criteria out of order', (p, e) => e('docs/epics/E1-reminder.md', (t) => t.replace('E1-AC2:', 'E1-AC3:')), [/E1-AC3 is criterion 2: number them E1-AC1, E1-AC2/]);
    planCase('an epic file not in the table', (p, e) => writeFileSync(join(p, 'docs/epics/E3-extra.md'), readFileSync(join(p, 'docs/epics/E2-release.md'), 'utf8')), [/E3-extra\.md: is not in the table/]);
    planCase('a status other than planned', (p, e) => e('docs/EPICS.md', (t) => t.replace('| low | E1 | planned |', '| low | E1 | merged |')), [/E2: status "merged", every epic of a new plan is planned/]);
    planCase('an unfilled SPEC section', (p, e) => e('docs/SPEC.md', (t) => t.replace('A local settings file.\n', '')), [/SPEC\.md: section "## Data model" is not filled in/]);
    planCase('a lite plan with too many epics', (p, e) => {
      e('docs/EPICS.md', (t) => t.replace('| low | E1 | planned |\n', '| low | E1 | planned |\n| [E3](epics/E3-a.md) | A | low | E2 | planned |\n| [E4](epics/E4-b.md) | B | low | E3 | planned |\n'));
      for (const [id, dep] of [['E3', 'E2'], ['E4', 'E3']]) writeFileSync(join(p, `docs/epics/${id}-${id === 'E3' ? 'a' : 'b'}.md`), `# ${id} - X\n\nGoal: x.\nDepends on: ${dep}\nRisk class: low\nADR: none\n\n## Acceptance criteria\n\n- [ ] ${id}-AC1: x.\n\n## Out of scope\n\nx\n\n## Open questions\n\nNone.\n`);
    }, [/4 epics after E0: the lite level holds at most 3/]);
    planCase('E0 without the stack ADRs', (p, e) => e('docs/epics/E0-skeleton.md', (t) => t.replace('ADR: ADR-0001, ADR-0002, ADR-0003', 'ADR: none')), [/E0 lays down the stack/]);
    planCase('links with a title or in angle brackets', (p, e) => e('docs/epics/E1-reminder.md', (t) => t.replace('## Out of scope', 'See [a](../adr/0042-gone.md "title") and [b](<../no such dir/x.md>).\n\n## Out of scope')), [/broken link \.\.\/adr\/0042-gone\.md/, /broken link \.\.\/no such dir\/x\.md/]);
    // T2 review: a level that is not known fails the checks, never relaxes them.
    for (const [label, settings] of [['a level with another case', (t) => t.replace('"lite"', '"Standard"')], ['no level', (t) => t.replace(/\s*"processLevel": "lite",/, '')]]) {
      planCase(`plan: ${label}`, (p, e) => e('.claude/pitwall.json', settings), [/processLevel ".*" is not one of lite, standard, full/]);
      planCase(`plan review: ${label}`, (p, e) => e('.claude/pitwall.json', settings), [/processLevel ".*" is not one of lite, standard, full/], 'plan-review');
    }
    // T2 review: an open cell is open however it is worded, and a closed one starts with its ID.
    for (const cell of ['open - E1 needs a snooze criterion', 'Open (E1-AC2 missing)', 'not closed yet, E1 should get one', '`E1-AC2`']) {
      planCase(`a finding closed by "${cell}"`, (p, e) => e('docs/PLAN-REVIEW.md', (t) => t.replace('| should fix | E1-AC2 |', `| should fix | ${cell} |`)), [/finding 1 is not closed/], 'plan-review');
    }
    planCase('a requirement answered "open, nothing yet"', (p, e) => e('docs/PLAN-REVIEW.md', (t) => t.replace('| Backups and restore | Settings reset to defaults |', '| Backups and restore | open, nothing yet |')), [/"Backups and restore" has no answer/], 'plan-review');
    planCase('a finding closed by an ID and a few words', (p, e) => e('docs/PLAN-REVIEW.md', (t) => t.replace('| should fix | E1-AC2 |', '| should fix | E1-AC2 (snooze) |')), [], 'plan-review');
    // T2 review, round 2.
    planCase('an open finding in a second table', (p, e) => e('docs/PLAN-REVIEW.md', (t) => t.replace('| 2 | Full-screen games hide it | should fix | R-1 |\n', '| 2 | Full-screen games hide it | should fix | R-1 |\n\n### Round 2\n\n| # | Finding | Severity | Closed by (epic, ADR) or accepted risk |\n| --- | --- | --- | --- |\n| 3 | E2 names no systems | blocking | open: name them |\n')), [/"## Findings" holds 2 tables/], 'plan-review');
    planCase('a dash as an answer and as a place', (p, e) => e('docs/PLAN-REVIEW.md', (t) => t.replace('| Security and secrets | None kept | SPEC.md |', '| Security and secrets | - | - |').replace('| Performance targets | Under 50 MB | E1-AC1 |', '| Performance targets | Under 50 MB | somewhere |')), [/"Security and secrets" has no answer/, /"Performance targets" has no place where it lives/], 'plan-review');
    planCase('a finding closed by the template ADR', (p, e) => e('docs/PLAN-REVIEW.md', (t) => t.replace('| should fix | E1-AC2 |', '| should fix | ADR-0000 |')), [/finding 1 is not closed/], 'plan-review');
    planCase('a broken link in SPEC.md', (p, e) => e('docs/SPEC.md', (t) => t.replace('A local settings file.', 'A local settings file, see [the idea](../nowhere/IDEA.md).')), [/SPEC\.md: broken link \.\.\/nowhere\/IDEA\.md/]);
    planCase('a broken link in PLAN-REVIEW.md', (p, e) => e('docs/PLAN-REVIEW.md', (t) => t.replace('| Snooze had no criterion |', '| Snooze had no [criterion](epics/E9-x.md) |')), [/PLAN-REVIEW\.md: broken link epics\/E9-x\.md/], 'plan-review');
    planCase('a high-risk assumption only a superseded ADR covers', (p, e) => {
      e('docs/epics/E1-reminder.md', (t) => t.replace(' (A-1)', ''));
      rmSync(join(p, 'docs/spikes/notify.md'));
      e('docs/adr/0001-stack.md', (t) => t.replace('- Status: accepted', '- Status: superseded by ADR-0003').replace('A desktop app.', 'A desktop app; it settles A-1.'));
    }, [/high-risk assumption A-1 is covered by no spike, ADR, epic or accepted risk/], 'plan-review');
    planCase('not confirmed, follow-up an ADR that supersedes nothing', (p, e) => e('docs/spikes/notify.md', (t) => t.replace('- Outcome: confirmed', '- Outcome: not confirmed').replace('- Follow-up: -', '- Follow-up: ADR-0001')), [/notify\.md: not confirmed, and its follow-up is not done/]);
    planCase('not confirmed, follow-up the new ADR that links the spike', (p, e) => {
      e('docs/spikes/notify.md', (t) => t.replace('- Outcome: confirmed', '- Outcome: not confirmed').replace('- Follow-up: -', '- Follow-up: ADR-0003'));
      e('docs/adr/0003-hosting.md', (t) => t.replace('A desktop app.', 'A desktop app; the spike ../spikes/notify.md was not confirmed.'));
      e('docs/adr/0002-language.md', (t) => t.replace('- Status: accepted', '- Status: superseded by ADR-0003'));
    }, []);
    // T2 review, round 4: the ADR the spike disproved, dated the same day, is no follow-up.
    planCase('not confirmed, follow-up the old ADR of the same day', (p, e) => {
      e('docs/spikes/notify.md', (t) => t.replace('- Outcome: confirmed', '- Outcome: not confirmed').replace('- Follow-up: -', '- Follow-up: ADR-0001'));
      e('docs/adr/0001-stack.md', (t) => t.replace('- Date: 2026-11-05', '- Date: 2026-11-08'));
    }, [/notify\.md: not confirmed, and its follow-up is not done/]);
    // T2 review, round 3.
    planCase('Findings twice, the open row under the first', (p, e) => e('docs/PLAN-REVIEW.md', (t) => t.replace('| 2 | Full-screen games hide it | should fix | R-1 |\n', '| 2 | Full-screen games hide it | should fix | R-1 |\n| 3 | E2 names no systems | blocking | open: name them |\n\n## Findings\n\n| # | Finding | Severity | Closed by (epic, ADR) or accepted risk |\n| --- | --- | --- | --- |\n| 1 | Snooze had no criterion | should fix | E1-AC2 |\n')), [/"## Findings" appears 2 times/], 'plan-review');
    planCase('a later round under a heading of its own', (p, e) => e('docs/PLAN-REVIEW.md', (t) => `${t}\n## Findings, round 2\n\n| # | Finding | Severity | Closed by (epic, ADR) or accepted risk |\n| --- | --- | --- | --- |\n| 3 | E2 names no systems | blocking | open: name them |\n`), [/"## Findings, round 2" is not a section of the template/, /a table in "## Findings, round 2"/], 'plan-review');
    planCase('a risk nobody accepted, in a second table, closing a finding', (p, e) => {
      e('docs/RISKS.md', (t) => `${t}\n| ID | Risk | Fallback | Accepted on |\n| --- | --- | --- | --- |\n| R-2 | Snooze is misused | none | not yet |\n`);
      e('docs/PLAN-REVIEW.md', (t) => t.replace('| should fix | E1-AC2 |', '| should fix | R-2 |'));
    }, [/RISKS\.md: holds 2 tables/, /finding 1 is not closed/, /R-2 is not an accepted risk/], 'plan-review');
    for (const action of ['open: split it with the owner', 'TBD', 'n/a']) {
      planCase(`an L epic with the action "${action}"`, (p, e) => e('docs/PLAN-REVIEW.md', (t) => t.replace('| E1 | M | partly | - |', `| E1 | L | unknown | ${action} |`)), [/E1 is L, unknown: it needs an action/], 'plan-review');
    }
    planCase('not confirmed, follow-up a new ADR for an area that had none', (p, e) => {
      e('docs/spikes/notify.md', (t) => t.replace('- Outcome: confirmed', '- Outcome: not confirmed').replace('- Follow-up: -', '- Follow-up: ADR-0004'));
      writeFileSync(join(p, 'docs/adr/0004-models.md'), readFileSync(join(p, 'docs/adr/0001-stack.md'), 'utf8').replace('# ADR-0001: Stack', '# ADR-0004: Models').replace('- Date: 2026-11-05', '- Date: 2026-11-08').replace('A desktop app.', 'After ../spikes/notify.md, models move to a local file.'));
    }, []);
    // T2 review, round 4: Markdown that GitHub shows one way and a line reader reads another.
    const hide = (label, rel, fn, patterns) => planCase(`hidden from the check: ${label}`, (p, e) => e(rel, fn), patterns, 'plan-review');
    const afterRow2 = (extra) => (t) => t.replace('| 2 | Full-screen games hide it | should fix | R-1 |\n', `| 2 | Full-screen games hide it | should fix | R-1 |\n${extra}`);
    hide('a row without its leading pipe', 'docs/PLAN-REVIEW.md', afterRow2('3 | E2 names no systems | blocking | open: name them\n'), [/a line right after a table/]);
    hide('a table in a block quote', 'docs/PLAN-REVIEW.md', afterRow2('\n> | # | Finding | Severity | Closed by |\n> | --- | --- | --- | --- |\n> | 3 | E2 | blocking | open: name them |\n'), [/a block quote/]);
    hide('a table between comment fences', 'docs/PLAN-REVIEW.md', afterRow2('\n<!--\n~~~\n-->\n| 3 | E2 names no systems | blocking | open: name them |\n<!--\n~~~\n-->\n'), [/an HTML comment/]);
    hide('a table between indented fences', 'docs/PLAN-REVIEW.md', afterRow2('\n    ```\n| 3 | E2 names no systems | blocking | open: name them |\n    ```\n'), [/"## Findings" holds 2 tables/]);
    hide('a setext heading after the last section', 'docs/PLAN-REVIEW.md', (t) => `${t}\nFindings, round 2\n-----\n\n| 3 | E2 names no systems | blocking | still to do |\n`, [/a setext heading/, /a table in "## Approval"/]);
    hide('an HTML table', 'docs/PLAN-REVIEW.md', (t) => `${t}\n<table><tr><td>3</td><td>open: name them</td></tr></table>\n`, [/an HTML block/]);
    hide('a fenced example table before the real one', 'docs/PLAN-REVIEW.md', (t) => t.replace('| # | Finding | Severity |', '```\n| # | Finding | Severity | Closed by (epic, ADR) or accepted risk |\n| --- | --- | --- | --- |\n| 1 | Example | should fix | E1-AC2 |\n```\n\n| # | Finding | Severity |').replace('| should fix | E1-AC2 |\n| 2 |', '| should fix | not yet, ask the owner |\n| 2 |'), [/finding 1 is not closed/]);
    hide('a requirement twice, answered then open', 'docs/PLAN-REVIEW.md', (t) => t.replace('| Security and secrets | None kept | SPEC.md |\n', '| Security and secrets | None kept | SPEC.md |\n| Security and secrets | open: the release tokens | - |\n'), [/the row "Security and secrets" repeats a row above it/, /an open item in "## Non-functional requirements"/]);
    hide('an epic sized twice', 'docs/PLAN-REVIEW.md', (t) => t.replace('| E1 | M | partly | - |\n', '| E1 | M | partly | - |\n| E1 | L | unknown | - |\n'), [/the row "E1" repeats a row above it/]);
    hide('an open cell in emphasis', 'docs/PLAN-REVIEW.md', (t) => t.replace('| should fix | E1-AC2 |', '| should fix | **open**: name it |'), [/finding 1 is not closed/, /an open item in "## Findings"/]);
    hide('a launch answer not confirmed', 'docs/PLAN-REVIEW.md', (t) => t.replace('| GitHub issues | 2026-11-08 |', '| GitHub issues | not confirmed, asked 2026-11-08 |'), [/"Support channel" has no date the owner confirmed it/]);
    hide('an L epic with the action "none"', 'docs/PLAN-REVIEW.md', (t) => t.replace('| E1 | M | partly | - |', '| E1 | L | unknown | none |'), [/E1 is L, unknown: it needs an action/]);
    hide('an accepted risk in a fenced example', 'docs/RISKS.md', (t) => t.replace('| ID | Risk |', '```\n| ID | Risk | Fallback | Accepted on |\n| --- | --- | --- | --- |\n| R-2 | x | y | 2026-11-08 |\n```\n\n| ID | Risk |').replace('| 2026-11-08 |\n', '| 2026-11-08 |\n| R-2 | Snooze is misused | none | not yet |\n'), []);
    planCase('hidden from the check: a risk accepted only in a fenced example closes a finding', (p, e) => {
      e('docs/RISKS.md', (t) => t.replace('| ID | Risk |', '```\n| ID | Risk | Fallback | Accepted on |\n| --- | --- | --- | --- |\n| R-2 | x | y | 2026-11-08 |\n```\n\n| ID | Risk |').replace('| 2026-11-08 |\n', '| 2026-11-08 |\n| R-2 | Snooze is misused | none | not yet |\n'));
      e('docs/PLAN-REVIEW.md', (t) => t.replace('| should fix | E1-AC2 |', '| should fix | R-2 |'));
    }, [/finding 1 is not closed/, /R-2 is not an accepted risk/], 'plan-review');
    hide('a risk in an HTML comment', 'docs/RISKS.md', (t) => `${t}\n<!--\n| R-3 | x | y | 2026-11-08 |\n-->\n`, [/an HTML comment/]);
    hide('a second table of epics', 'docs/EPICS.md', (t) => `${t}\nLater:\n\n| Epic | Goal | Risk | Depends on | Status |\n| --- | --- | --- | --- | --- |\n| E3 | X | low | E5 | planned |\n`, [/EPICS\.md: holds 2 tables/]);
    hide('a second table of assumptions', 'docs/DISCOVERY.md', (t) => t.replace('| A-2 | A tray icon is enough | low | Ask two users |\n', '| A-2 | A tray icon is enough | low | Ask two users |\n\n| ID | Assumption | Risk | How to check it |\n| --- | --- | --- | --- |\n| A-9 | Users accept a tray icon | high | Ask five people |\n'), [/"## Assumptions by risk" holds 2 tables/]);
    hide('an outcome in an HTML comment', 'docs/spikes/notify.md', (t) => t.replace('- Outcome: confirmed', '<!--\n- Outcome: confirmed\n-->\n- Outcome: pending'), [/an HTML comment/, /"- Outcome:" appears 2 times/]);
    hide('an outcome twice', 'docs/spikes/notify.md', (t) => t.replace('- Outcome: confirmed', '- Outcome: confirmed\n- Outcome: pending'), [/"- Outcome:" appears 2 times/]);
    planCase('a closing cell that starts with "closed by"', (p, e) => e('docs/PLAN-REVIEW.md', (t) => t.replace('| should fix | E1-AC2 |', '| should fix | closed by E1-AC2: snooze is a criterion now |').replace('| should fix | R-1 |', '| should fix | **R-1** |')), [], 'plan-review');
    planCase('a file with a byte order mark', (p, e) => e('.claude/pitwall.json', (t) => String.fromCodePoint(0xfeff) + t), [], 'plan-review');
    // T2 review, round 5: a cell is judged by what GitHub shows of it, and lines follow a small grammar.
    hide('a struck-out closer', 'docs/PLAN-REVIEW.md', (t) => t.replace('| should fix | E1-AC2 |', '| should fix | ~~E1-AC2~~ open: E1-AC2 was cut |'), [/finding 1 is not closed/]);
    planCase('hidden from the check: a risk whose date is open', (p, e) => {
      e('docs/RISKS.md', (t) => t.replace('| A tray badge | 2026-11-08 |', '| A tray badge | open: the owner has not answered, asked 2026-11-08 |'));
    }, [/finding 2 is not closed/, /R-1 is not an accepted risk/], 'plan-review');
    hide('a risk whose date is struck out', 'docs/RISKS.md', (t) => t.replace('| A tray badge | 2026-11-08 |', '| A tray badge | ~~2026-11-08~~ withdrawn |'), [/finding 2 is not closed/]);
    hide('a launch date struck out', 'docs/PLAN-REVIEW.md', (t) => t.replace('| GitHub issues | 2026-11-08 |', '| GitHub issues | ~~2026-11-08~~ open: withdrawn |'), [/"Support channel" has no date the owner confirmed it/]);
    hide('an open answer as a character reference', 'docs/PLAN-REVIEW.md', (t) => t.replace('| Performance targets | Under 50 MB | E1-AC1 |', '| Performance targets | &#111;pen: nothing yet | &#111;pen, see SPEC.md |'), [/"Performance targets" has no answer/]);
    hide('an open answer in inline HTML', 'docs/PLAN-REVIEW.md', (t) => t.replace('| Performance targets | Under 50 MB | E1-AC1 |', '| Performance targets | <b>open</b>: nothing yet | E1-AC1 |'), [/"Performance targets" has no answer/]);
    hide('an open answer as a link', 'docs/PLAN-REVIEW.md', (t) => t.replace('| Performance targets | Under 50 MB | E1-AC1 |', '| Performance targets | [open](SPEC.md) | [open](SPEC.md) |'), [/"Performance targets" has no answer/]);
    hide('a lazy row in a code span', 'docs/PLAN-REVIEW.md', afterRow2('`15 | Nothing checks the reboot case | blocking | open: add a criterion`\n'), [/a line right after a table/]);
    hide('a lazy row of epics', 'docs/EPICS.md', (t) => t.replace('| low | E1 | planned |\n', '| low | E1 | planned |\n`[E4](epics/E4-hidden.md) | Hidden epic | high | E0 | planned`\n'), [/a line right after a table/]);
    hide('a table between fences in a list item', 'docs/PLAN-REVIEW.md', afterRow2('\n- Round 8 notes:\n  ```\n\n| # | Finding | Severity | Closed by (epic, ADR) or accepted risk |\n| --- | --- | --- | --- |\n| 15 | Reboot | blocking | open: add a criterion |\n\n- End of the notes.\n  ```\n'), [/an indented fence/]);
    hide('an outcome hidden by a fence in a list item', 'docs/spikes/notify.md', (t) => t.replace('- Outcome: confirmed', '- Outcome: not confirmed\n  ```\n- Outcome: confirmed').replace('## Hypothesis', '```\n\n## Hypothesis'), [/an indented fence/]);
    hide('a link reference definition', 'docs/epics/E1-reminder.md', (t) => t.replace('## Out of scope', '[//]: # (A-1 is settled by E2-AC1)\n\n## Out of scope'), [/a link reference definition/]);
    hide('an epic sized in two rows', 'docs/PLAN-REVIEW.md', (t) => t.replace('| E2 | S | known | - |\n', '| E2 | S | known | - |\n| E2, second half | L | unknown | - |\n'), [/E2 is sized in 2 rows/]);
    hide('a closer that is still open', 'docs/PLAN-REVIEW.md', (t) => t.replace('| should fix | E1-AC2 |', '| should fix | closed by E1-AC2; still open: the snooze limit |'), [/finding 1 is not closed/]);
    planCase('the discovery stage reads its structure too', (p, e) => e('docs/DISCOVERY.md', (t) => t.replace('One person at a desk.', 'One person at a desk.\n> quoted')), [/a block quote/], 'discovery');
    // Ordinary Markdown a model writes stays allowed.
    planCase('ordinary Markdown in the plan files', (p, e) => {
      e('docs/epics/E1-reminder.md', (t) => t.replace('## Out of scope', '> Note: the timer is wall-clock time.\n\n---\n\nSee <https://example.com/timers> and S | M | L sizes.\n\n## Out of scope'));
      e('docs/PLAN-REVIEW.md', (t) => t.replace('| should fix | E1-AC2 |', '| should fix | Closed by: **E1-AC2** |').replace('| GitHub issues | 2026-11-08 |', '| GitHub issues | confirmed 2026-11-08 |'));
      e('docs/spikes/notify.md', (t) => t.replace('The reminder was confirmed against the criterion.', 'The reminder was confirmed against the criterion.\n\n| Run | Shown |\n| --- | --- |\n| 1 | yes |'));
    }, [], 'plan-review');
    hide('an indented heading', 'docs/PLAN-REVIEW.md', (t) => t.replace('## Findings', '  ## Findings, again\n\n## Findings'), [/an indented heading/]);
    hide('a conclusion in the template words', 'docs/spikes/notify.md', (t) => t.replace('The reminder was confirmed against the criterion.', 'Confirmed or not confirmed, against the criterion, in a few sentences. A spike that is not confirmed names its follow-up: a new ADR from `/pitwall:decide <area>`, or a risk the owner accepted in `RISKS.md`.'), [/the conclusion is not written/]);
    // T2 review, round 6: line endings and white space as GitHub reads them, and judged cells in plain text only.
    const NBSP = String.fromCodePoint(0xa0);
    const ZWSP = String.fromCodePoint(0x200b);
    hide('a second table after lone carriage returns', 'docs/PLAN-REVIEW.md', afterRow2('\nRound 8.\r\r| # | Finding | Severity | Closed by (epic, ADR) or accepted risk |\r| --- | --- | --- | --- |\r| 15 | Reboot | blocking | open: add a criterion |\n'), [/"## Findings" holds 2 tables/]);
    hide('a second table of epics after lone carriage returns', 'docs/EPICS.md', (t) => `${t}\nLater.\r\r| Epic | Goal | Risk | Depends on | Status |\r| --- | --- | --- | --- | --- |\r| E4 | Sync | high | E0 | planned |\n`, [/EPICS\.md: holds 2 tables/]);
    hide('an outcome under another list marker, a copy in a details block', 'docs/spikes/notify.md', (t) => t.replace('- Outcome: confirmed', '* Outcome: not confirmed') + '\nRaw notes.\r\r<details>\r\r~~~\r- Outcome: confirmed\r~~~\r\r</details>\n', [/"Outcome:" is written with "\*" or "\+"/, /an HTML block/]);
    hide('a row after a line of non-breaking spaces', 'docs/PLAN-REVIEW.md', afterRow2(`${NBSP}\n15 | Reboot | blocking | open: add a criterion\n`), [/an invisible character or a space other than a plain one/]);
    hide('an epic after a line of non-breaking spaces', 'docs/EPICS.md', (t) => t.replace('| low | E1 | planned |\n', `| low | E1 | planned |\n${NBSP}\nE&#52; | Sync | high | E0 | planned\n`), [/an invisible character/]);
    hide('an assumption after a line of non-breaking spaces', 'docs/DISCOVERY.md', (t) => t.replace('| A-2 | A tray icon is enough | low | Ask two users |\n', `| A-2 | A tray icon is enough | low | Ask two users |\n${NBSP}\nA-&#55; | Cloud sync works | high | nothing |\n`), [/an invisible character/]);
    hide('a closer struck out with an HTML tag', 'docs/PLAN-REVIEW.md', (t) => t.replace('| should fix | E1-AC2 |', '| should fix | <s>E1-AC2</s> nothing covers it |'), [/"Closed by" cell of "1" holds HTML/]);
    hide('a risk date struck out with an HTML tag', 'docs/RISKS.md', (t) => t.replace('| A tray badge | 2026-11-08 |', '| A tray badge | <del>2026-11-08</del> withdrawn |'), [/"Accepted on" cell of "R-1" holds HTML/, /finding 2 is not closed/]);
    hide('a launch date struck out with an HTML tag', 'docs/PLAN-REVIEW.md', (t) => t.replace('| GitHub issues | 2026-11-08 |', '| GitHub issues | <strike>2026-11-08</strike> withdrawn |'), [/"Confirmed on" cell of "Support channel" holds HTML/]);
    hide('an action struck out with an HTML tag', 'docs/PLAN-REVIEW.md', (t) => t.replace('| E1 | M | partly | - |', '| E1 | L | unknown | <s>split it in two</s> |'), [/action cell of "E1" holds HTML/]);
    hide('a closer that is an image', 'docs/PLAN-REVIEW.md', (t) => t.replace('| should fix | E1-AC2 |', '| should fix | ![E1-AC2](https://example.com/x.gif) nothing covers it |'), [/"Closed by" cell of "1" holds a link, an image or a bracket/, /finding 1 is not closed/]);
    hide('a status hidden in an ADR comment', 'docs/adr/0001-stack.md', (t) => t.replace('- Status: accepted', '<!--\n- Status: accepted\n-->\n- Status: superseded by ADR-0003'), [/0001-stack\.md:\d+: an HTML comment/, /"- Status:" appears 2 times/]);
    hide('an epic ID with a zero-width space', 'docs/PLAN-REVIEW.md', (t) => t.replace('| E2 | S | known | - |\n', `| E2 | S | known | - |\n| E${ZWSP}2, second half | L | unknown | - |\n`), [/an invisible character/]);
    hide('an epic ID with a character reference', 'docs/PLAN-REVIEW.md', (t) => t.replace('| E2 | S | known | - |\n', '| E2 | S | known | - |\n| E&#8203;2 second half | L | unknown | - |\n'), [/epic cell of "E&#8203;2 second half" holds a character reference/]);
    hide('a high risk in emphasis that nothing covers', 'docs/DISCOVERY.md', (t) => t.replace('| A-2 | A tray icon is enough | low | Ask two users |\n', '| A-2 | A tray icon is enough | low | Ask two users |\n| A-3 | Cloud sync works | **high** | nothing yet |\n'), [/high-risk assumption A-3 is covered by no spike/]);
    for (const [label, cell, pattern] of [
      ['tildes that strike nothing', '~~ open: nothing covers it ~~E1-AC2', /finding 1 is not closed/],
      ['an open written with a character reference', 'E1-AC2 was cut, open&colon; nothing covers it', /holds a character reference/],
      ['an open in angle brackets', 'E1-AC2 <open: nothing covers it>', /holds HTML or an angle bracket/],
      ['an open as a broken link', '[E1-AC2](open: nothing covers it)', /holds a link, an image or a bracket/],
      ['backticks that open no code span', 'E1-AC2 ``` open: nothing covers it ``', /holds a backtick that opens no code span/],
      ['an open behind a backslash', 'E1-AC2 is cut, open\\: nothing covers it', /holds a backslash escape/],
      ['an ID written with a character reference', 'ADR-&#48;099', /holds a character reference/],
    ]) hide(label, 'docs/PLAN-REVIEW.md', (t) => t.replace('| should fix | E1-AC2 |', `| should fix | ${cell} |`), [pattern]);
    hide('a heading after a non-breaking space', 'docs/spikes/notify.md', (t) => t.replace('## Result', `##${NBSP}Notes\n\n## Result`), [/an invisible character/]);
    planCase('a constraint date struck out, at the discovery stage', (p, e) => e('docs/DISCOVERY.md', (t) => t.replace('| Licence | Settled | 2026-11-05 |', '| Licence | Settled | ~~2026-11-05~~ open: withdrawn |')), [/constraint "Licence" has no confirmation date/, /"Confirmed on" cell of "Licence" holds tildes/], 'discovery');
    // T2 review, round 7: a criterion is checked before its commit freezes it, ordinary signs stay
    // allowed, only a decision the owner made closes an item, and a mention is no coverage.
    const pendingSpike = (criterionRows) => spikeFile('pending', '-', '').replace('spike/notify', 'spike/idle-time').replace(SPIKE_CRITERION, criterionRows);
    planCase('a criterion with "<" and a metric per system, before its commit', (p) => writeFileSync(join(p, 'docs/spikes/idle-time.md'), pendingSpike('| Idle time error | Windows, 10 readings | Error < 1 s in 10 of 10 |\n| Idle time error | macOS, 10 readings | Error < 1 s in 10 of 10 |')), [], 'spike-criterion');
    planCase('a criterion that would freeze a refused cell, before its commit', (p) => writeFileSync(join(p, 'docs/spikes/idle-time.md'), pendingSpike('| Idle time error | Ten readings | <b>10 of 10</b> |')), [/idle-time\.md:\d+: the "Success when" cell of "Idle time error" holds HTML/], 'spike-criterion');
    planCase('a criterion committed with its result already written', (p) => writeFileSync(join(p, 'docs/spikes/idle-time.md'), pendingSpike('| Idle time error | Ten readings | 10 of 10 |').replace('| --- | --- | --- | --- |\n', '| --- | --- | --- | --- |\n| Idle time error | 10 of 10 | owner | 2026-11-09 |\n')), [/idle-time\.md: the result is written already/], 'spike-criterion');
    planCase('no spike waiting for its criterion', () => {}, [/no spike with "- Outcome: pending"/], 'spike-criterion');
    planCase('ordinary signs in judged cells', (p, e) => {
      e('docs/PLAN-REVIEW.md', (t) => t.replace('| Performance targets | Under 50 MB | E1-AC1 |', '| Performance targets | Average CPU < 1% over 1 hour | E1-AC1 |').replace('| GitHub issues | 2026-11-08 |', '| GitHub issues, answered in < 1 day | 2026-11-08 |'));
      e('docs/RISKS.md', (t) => t.replace('| A tray badge |', '| A tray badge, cached in ~/Library/Caches/move-reminder or %LOCALAPPDATA%\\move-reminder |'));
    }, [], 'plan-review');
    planCase('a finding closed by a proposed ADR', (p, e) => {
      writeFileSync(join(p, 'docs/adr/0004-models.md'), readFileSync(join(p, 'docs/adr/0001-stack.md'), 'utf8').replace('# ADR-0001: Stack', '# ADR-0004: Models').replace('- Status: accepted', '- Status: proposed'));
      e('docs/PLAN-REVIEW.md', (t) => t.replace('| should fix | E1-AC2 |', '| should fix | ADR-0004 |'));
    }, [/finding 1 is not closed/], 'plan-review');
    planCase('a high-risk assumption only mentioned in open questions', (p, e) => {
      e('docs/epics/E1-reminder.md', (t) => t.replace(' (A-1)', '').replace('## Open questions\n\nNone.', '## Open questions\n\nNothing in this epic checks A-1 yet; it needs a spike or an accepted risk.'));
      rmSync(join(p, 'docs/spikes/notify.md'));
    }, [/high-risk assumption A-1 is covered by no spike, ADR, epic or accepted risk/], 'plan-review');
    planCase('a high-risk assumption only in the address of a link', (p, e) => {
      e('docs/epics/E1-reminder.md', (t) => t.replace(' (A-1)', ' (see [the notes](https://example.com/A-1))'));
      rmSync(join(p, 'docs/spikes/notify.md'));
    }, [/high-risk assumption A-1 is covered by no spike/], 'plan-review');
    hide('a non-breaking space after a closing fence', 'docs/PLAN-REVIEW.md', afterRow2(`\n\`\`\`\nnotes\n\`\`\`${NBSP}\n\n| # | Finding | Severity | Closed by (epic, ADR) or accepted risk |\n| --- | --- | --- | --- |\n| 15 | Reboot | blocking | open: add a criterion |\n\n\`\`\`\n`), [/an invisible character on a fence line/]);
    hide('rows indented with a tab', 'docs/RISKS.md', (t) => t.replace('| ID | Risk |', '\t| R-3 | Hidden | none | 2026-11-08 |\n\n| ID | Risk |'), [/an indented table row/]);
    // T2 verification round: what an honest reviewer writes passes, and the rule says where to write it.
    planCase('a place that also names the decision a newer one superseded', (p, e) => {
      e('docs/adr/0002-language.md', (t) => t.replace('- Status: accepted', '- Status: superseded by ADR-0003'));
      e('docs/PLAN-REVIEW.md', (t) => t.replace('| Backups and restore | Settings reset to defaults | SPEC.md |', '| Backups and restore | Settings reset to defaults | ADR-0003, which supersedes ADR-0002 |'));
    }, [], 'plan-review');
    planCase('two tildes that strike nothing', (p, e) => e('docs/RISKS.md', (t) => t.replace('| A tray badge |', '| A tray badge, in ~/Library/Caches/x on macOS and ~/.cache/x on Linux, about ~0.4 s |')), [], 'plan-review');
    hide('tildes that strike text through', 'docs/RISKS.md', (t) => t.replace('| A tray badge |', '| A tray badge within ~1 s~ |'), [/the fallback cell of "R-1" holds tildes/]);
    planCase('an assumption on a criterion continuation line', (p, e) => {
      e('docs/epics/E1-reminder.md', (t) => t.replace(' (A-1)', '\n  This settles A-1 on both systems.'));
      rmSync(join(p, 'docs/spikes/notify.md'));
    }, [], 'plan-review');
    planCase('an assumption named only in an ADR context', (p, e) => {
      e('docs/epics/E1-reminder.md', (t) => t.replace(' (A-1)', ''));
      e('docs/adr/0001-stack.md', (t) => t.replace('A desktop app.', 'A desktop app; this decision settles A-1.'));
      rmSync(join(p, 'docs/spikes/notify.md'));
    }, [/high-risk assumption A-1 is covered by no spike, ADR, epic or accepted risk: name it in a spike's "- Assumption:", the "## Decision" of an accepted ADR/], 'plan-review');
    // T2 final check: tildes strike only where GitHub strikes, and a place names settled IDs.
    const noSpikeNoAc = (p, e) => {
      e('docs/epics/E1-reminder.md', (t) => t.replace(' (A-1)', ''));
      rmSync(join(p, 'docs/spikes/notify.md'));
    };
    planCase('tildes for "about" around a covering criterion', (p, e) => {
      noSpikeNoAc(p, e);
      e('docs/epics/E1-reminder.md', (t) => t.replace('- [ ] E1-AC2: Snooze delays it by 10 minutes.', '- [ ] E1-AC2: Snooze pauses in ~2 s.\n- [ ] E1-AC3: Settles A-1.\n- [ ] E1-AC4: It resumes (~1 s).'));
    }, [], 'plan-review');
    planCase('tildes for "about" in one covering criterion', (p, e) => {
      noSpikeNoAc(p, e);
      e('docs/epics/E1-reminder.md', (t) => t.replace('Snooze delays it by 10 minutes.', 'It starts in ~1 s, which settles A-1 (~3 s on the first start).'));
    }, [], 'plan-review');
    planCase('tildes for "about" around a covering ADR decision', (p, e) => {
      noSpikeNoAc(p, e);
      e('docs/adr/0001-stack.md', (t) => t.replace('## Decision\n\nTauri.', '## Decision\n\nTauri, ~5 ms to start.\n\nThis settles A-1.\n\nA reminder draws in (~2 ms).'));
    }, [], 'plan-review');
    planCase('tildes for "about" in a fallback', (p, e) => e('docs/RISKS.md', (t) => t.replace('| A tray badge |', '| Retry after ~2 s (~5 s on a cold start) |')), [], 'plan-review');
    planCase('a place with a proposed ADR next to a criterion', (p, e) => {
      writeFileSync(join(p, 'docs/adr/0004-models.md'), readFileSync(join(p, 'docs/adr/0001-stack.md'), 'utf8').replace('# ADR-0001: Stack', '# ADR-0004: Models').replace('- Status: accepted', '- Status: proposed'));
      e('docs/PLAN-REVIEW.md', (t) => t.replace('| Backups and restore | Settings reset to defaults | SPEC.md |', '| Backups and restore | Settings reset to defaults | ADR-0004, E1-AC1 |'));
    }, [/"Backups and restore" has no place where it lives/], 'plan-review');
    planCase('a place with a superseded ADR whose successor it does not name', (p, e) => {
      e('docs/adr/0002-language.md', (t) => t.replace('- Status: accepted', '- Status: superseded by ADR-0003'));
      e('docs/PLAN-REVIEW.md', (t) => t.replace('| Backups and restore | Settings reset to defaults | SPEC.md |', '| Backups and restore | Settings reset to defaults | ADR-0002, E1-AC1 |'));
    }, [/"Backups and restore" has no place where it lives/], 'plan-review');
    planCase('a tilde after punctuation before another tilde', (p, e) => {
      noSpikeNoAc(p, e);
      e('docs/epics/E1-reminder.md', (t) => t.replace('Snooze delays it by 10 minutes.', 'Settles A-1 within ~2 s.~~'));
    }, [], 'plan-review');
    planCase('an assumption on a criterion line after a blank line', (p, e) => {
      noSpikeNoAc(p, e);
      e('docs/epics/E1-reminder.md', (t) => t.replace('- [ ] E1-AC2: Snooze delays it by 10 minutes.', '- [ ] E1-AC2: Snooze delays it by 10 minutes.\n\n  This settles A-1.'));
    }, [], 'plan-review');
    // Ordinary Markdown from the round-6 review stays allowed.
    planCase('free tables, repeated rows and plain words', (p, e) => {
      e('docs/spikes/notify.md', (t) => t.replace('The reminder was confirmed against the criterion.', 'The reminder was confirmed against the criterion.\n\n| Run | Date |\n| --- | --- |\n| 1 | 2026-11-08 |\n| 1 | 2026-11-08 |'));
      e('docs/epics/E1-reminder.md', (t) => t.replace('## Out of scope', '| System | Check |\n| --- | --- |\n| Windows 11 | tray |\n| Windows 11 | full screen |\n\n<owner@example.com> answers questions.\n\n## Out of scope'));
      e('docs/PLAN-REVIEW.md', (t) => t.replace('| should fix | E1-AC2 |', '| should fix | E1-AC2: the reminder is still open after 5 clicks, `scripts/gate` checks it, Settings > System |').replace('| Under 50 MB | E1-AC1 |', '| Under 50 MB, the window still open after a lock | E1-AC1 |').replace('| # | Finding | Severity | Closed by (epic, ADR) or accepted risk |\n| --- | --- | --- | --- |', '| # | Finding | Severity | Closed by (epic, ADR) or accepted risk |\n|-|-|-|-|'));
    }, [], 'plan-review');
    planCase('a broken link in RISKS.md', (p, e) => e('docs/RISKS.md', (t) => t.replace('| A tray badge |', '| A [tray badge](spikes/badge.md) |')), [/RISKS\.md: broken link spikes\/badge\.md/], 'plan-review');
    planCase('a high-risk assumption only a risk nobody accepted names', (p, e) => {
      e('docs/epics/E1-reminder.md', (t) => t.replace(' (A-1)', ''));
      rmSync(join(p, 'docs/spikes/notify.md'));
      e('docs/RISKS.md', (t) => t.replace('| 2026-11-08 |\n', '| 2026-11-08 |\n| R-2 | A-1 may not hold | none yet | not yet |\n'));
    }, [/high-risk assumption A-1 is covered by no spike, ADR, epic or accepted risk/], 'plan-review');
    // Plan review: T2-AC4.
    planCase('an open finding', (p, e) => e('docs/PLAN-REVIEW.md', (t) => t.replace('| should fix | E1-AC2 |', '| should fix | open: no criterion for snooze |')), [/finding 1 is not closed/], 'plan-review');
    planCase('a requirement of the level missing', (p, e) => e('docs/PLAN-REVIEW.md', (t) => t.replace('| Backups and restore | Settings reset to defaults | SPEC.md |\n', '')), [/"Backups and restore" is missing/], 'plan-review');
    planCase('a launch answer without a date', (p, e) => e('docs/PLAN-REVIEW.md', (t) => t.replace('| GitHub issues | 2026-11-08 |', '| GitHub issues | yes |')), [/"Support channel" has no date the owner confirmed it/], 'plan-review');
    planCase('an epic not sized, an L without an action', (p, e) => e('docs/PLAN-REVIEW.md', (t) => t.replace('| E2 | S | known | - |\n', '').replace('| E1 | M | partly | - |', '| E1 | L | partly | - |')), [/E2 is not sized/, /E1 is L, partly: it needs an action/], 'plan-review');
    planCase('an accepted risk without its date', (p, e) => e('docs/RISKS.md', (t) => t.replace('| A tray badge | 2026-11-08 |', '| A tray badge | soon |')), [/RISKS\.md: R-1 is not an accepted risk/, /finding 2 is not closed/], 'plan-review');
    planCase('a high-risk assumption nothing covers', (p, e) => {
      e('docs/epics/E1-reminder.md', (t) => t.replace(' (A-1)', ''));
      rmSync(join(p, 'docs/spikes/notify.md'));
    }, [/high-risk assumption A-1 is covered by no spike, ADR, epic or accepted risk/], 'plan-review');
    planCase('standard: too few pre-mortem reasons', (p, e) => e('.claude/pitwall.json', (t) => t.replace('"lite"', '"standard"')), [/0 pre-mortem reasons, the standard level asks for 5/, /"Personal data and GDPR" is missing/, /"Domain" is missing/], 'plan-review');
    planCase('standard: an unclosed reason', (p, e) => {
      e('.claude/pitwall.json', (t) => t.replace('"lite"', '"standard"'));
      e('docs/PLAN-REVIEW.md', (t) => t.replace('| # | Reason | Closed by (epic, ADR) or accepted risk |\n| --- | --- | --- |\n', `| # | Reason | Closed by (epic, ADR) or accepted risk |\n| --- | --- | --- |\n${[1, 2, 3, 4].map((i) => `| ${i} | Reason ${i} | E1-AC1 |\n`).join('')}| 5 | Nobody uses it | open |\n`));
    }, [/pre-mortem reason 5 is not closed/], 'plan-review');
    planCase('full: no spike on the riskiest assumption', (p, e) => {
      e('.claude/pitwall.json', (t) => t.replace('"lite"', '"full"'));
      rmSync(join(p, 'docs/spikes/notify.md'));
    }, [/the full level asks for a concluded spike on the riskiest assumption, A-1/], 'plan-review');
    const usage = runScript('docs-check.mjs', ['--root', base, '--stage', 'plan,nope']);
    if (usage.status !== 2) report(`--stage plan,nope: exit ${usage.status}, expected 2`);
  });
});

// 6h. T2-AC5, ADR-0007: review-status.mjs against the fake gh. It refuses success on a review that
// does not pass its check, commits only the review file, pushes, and sets the status on the PR head.
const identity = { GIT_AUTHOR_NAME: 'check', GIT_AUTHOR_EMAIL: 'check@pitwall', GIT_COMMITTER_NAME: 'check', GIT_COMMITTER_EMAIL: 'check@pitwall' };
step('review status (fake gh)', (report) => {
  scratch('pitwall-review-', (dir) => {
    const { project: base } = makePlanRepo(dir);
    const origin = join(dir, 'origin.git');
    gitIn(dir, 'init', '-q', '--bare', origin);
    gitIn(base, 'remote', 'add', 'origin', origin);
    gitIn(base, 'push', '-q', 'origin', 'main', 'plan/initial', 'spike/notify');
    gitIn(base, 'fetch', '-q', 'origin');
    const ok = { auth: true, repo: { nameWithOwner: 'o/r', viewerPermission: 'ADMIN' }, pr: { head: 'local' }, status: 'ok' };
    let n = 0;
    const run = (label, scenario, { args = ['--review', 'plan', '--state', 'success'], prepare, gh, env = {}, code, result, posts, commits = 0, says = [] }) => {
      const p = join(dir, `r${(n += 1)}`);
      cpSync(base, p, { recursive: true });
      // Each case pushes to a remote of its own.
      cpSync(origin, p + '-origin.git', { recursive: true });
      gitIn(p, 'remote', 'set-url', 'origin', p + '-origin.git');
      // A new finding the reviewer wrote this round: the only uncommitted change.
      const reviewFile = join(p, 'docs', 'PLAN-REVIEW.md');
      writeFileSync(reviewFile, readFileSync(reviewFile, 'utf8').replace('| 2 | Full-screen games hide it | should fix | R-1 |\n', '| 2 | Full-screen games hide it | should fix | R-1 |\n| 3 | E2 names no systems | should fix | E2-AC1 |\n'));
      prepare?.(p);
      const before = Number(gitIn(p, 'rev-list', '--count', 'HEAD').stdout.trim());
      const { r, calls, state } = withFakeGh('review-status.mjs', p, scenario, [...args, '--project', p], { ...identity, GIT_CEILING_DIRECTORIES: dir, ...(gh ? { PITWALL_GH: JSON.stringify(gh) } : {}), ...env });
      const fail = (msg) => report(`${label}: ${msg}\n${r.stdout}${r.stderr}`);
      const writes = calls.filter((c) => c.args.includes('POST'));
      const made = Number(gitIn(p, 'rev-list', '--count', 'HEAD').stdout.trim()) - before;
      if (r.status !== code) fail(`exit ${r.status}, expected ${code}`);
      if (result && !r.stdout.includes(`RESULT: ${result}`)) fail(`no "RESULT: ${result}"`);
      if (writes.length !== posts) fail(`${writes.length} status writes, expected ${posts}`);
      if (made !== commits) fail(`${made} commits, expected ${commits}`);
      if (made > 0) {
        const touched = gitIn(p, 'diff', '--name-only', 'HEAD~1', 'HEAD').stdout.trim();
        if (touched !== 'docs/PLAN-REVIEW.md') fail(`the commit touched ${touched}, expected docs/PLAN-REVIEW.md only`);
      }
      for (const w of writes) {
        const head = gitIn(p, 'rev-parse', 'HEAD').stdout.trim();
        if (!w.args.includes(`repos/o/r/statuses/${head}`) || !w.args.includes('context=ai-review')) fail(`wrote ${w.args.join(' ')}, expected ai-review on ${head}`);
      }
      for (const s of says) if (!r.stdout.includes(s)) fail(`output lacks "${s}"`);
      checkHandoff(r.stdout, fail);
      return { r, p, state };
    };
    const good = run('approved', ok, { code: 0, result: 'success', posts: 1, commits: 1 });
    const pushed = gitIn(good.p, 'rev-parse', 'origin/plan/initial').stdout.trim();
    if (pushed !== gitIn(good.p, 'rev-parse', 'HEAD').stdout.trim()) report('approved: the commit with the review was not pushed');
    run('changes requested', ok, { args: ['--review', 'plan', '--state', 'failure'], prepare: (p) => writeFileSync(join(p, 'docs/PLAN-REVIEW.md'), readFileSync(join(p, 'docs/PLAN-REVIEW.md'), 'utf8').replace('| E2 names no systems | should fix | E2-AC1 |', '| E2 names no systems | should fix | open: name the systems |')), code: 0, result: 'failure', posts: 1, commits: 1 });
    run('success on an open finding', ok, { prepare: (p) => writeFileSync(join(p, 'docs/PLAN-REVIEW.md'), readFileSync(join(p, 'docs/PLAN-REVIEW.md'), 'utf8').replace('| E2 names no systems | should fix | E2-AC1 |', '| E2 names no systems | should fix | open: name the systems |')), code: 1, result: 'not set', posts: 0, says: ['does not pass docs-check --stage plan-review,spike', 'finding 3 is not closed'] });
    run('other changes in the tree', ok, { prepare: (p) => writeFileSync(join(p, 'docs/SPEC.md'), 'changed\n'), code: 1, posts: 0, says: ['changes besides docs/PLAN-REVIEW.md', 'docs/SPEC.md'] });
    run('not on the planning branch', ok, { prepare: (p) => gitIn(p, 'stash', '-q').stdout + gitIn(p, 'switch', '-q', 'main').stdout, code: 1, posts: 0, says: ['on branch "main"'] });
    run('not signed in', { ...ok, auth: false }, { code: 3, result: 'pending', posts: 0, commits: 1, says: ['    gh auth login\n'] });
    run('no repository', { ...ok, repo: null }, { code: 3, result: 'pending', posts: 0, commits: 1, says: ['    gh repo create --private --source . --remote origin\n', '    git push -u origin spike/notify\n', '    gh pr create --base main --head plan/initial --fill\n'] });
    run('a repository gh cannot read', { ...ok, repo: null, repoError: 'HTTP 404: Not Found' }, { code: 3, result: 'pending', posts: 0, commits: 1, says: ['gh could not read the repository: HTTP 404'] });
    run('no gh', ok, { gh: [join(dir, 'no-such-gh')], code: 3, result: 'pending', posts: 0, commits: 1, says: ['cli.github.com'] });
    run('outside git', ok, { prepare: (p) => rmSync(join(p, '.git'), { recursive: true, force: true }), code: 1, posts: 0, says: ['is not inside a git repository'] });
    run('a PR into another branch', { ...ok, pr: { head: 'local', base: 'develop' } }, { code: 1, posts: 0, commits: 1, says: ['goes into develop, not main'] });
    run('a closed PR', { ...ok, pr: { head: 'local', state: 'CLOSED' } }, { code: 1, posts: 0, commits: 1, says: ['is closed'] });
    run('a PR from another branch only', { ...ok, pr: { head: 'local', branch: 'other' } }, { code: 3, result: 'pending', posts: 0, commits: 1, says: ['there is no PR from plan/initial'] });
    run('no PR', { ...ok, pr: null }, { code: 3, result: 'pending', posts: 0, commits: 1, says: ['    gh pr create --base main --head plan/initial --fill\n'] });
    run('PR merged', { ...ok, pr: { head: 'local', state: 'MERGED' } }, { code: 1, posts: 0, commits: 1, says: ['is merged'] });
    run('PR head lags', { ...ok, pr: { head: '0'.repeat(40) } }, { code: 3, result: 'pending', posts: 0, commits: 1, says: ['shows head 0000000'] });
    run('read only', { ...ok, repo: { nameWithOwner: 'o/r', viewerPermission: 'READ' } }, { code: 3, result: 'pending', posts: 0, commits: 1, says: ['needs write access'] });
    run('status refused', { ...ok, status: 'refuse' }, { code: 3, result: 'pending', posts: 1, commits: 1, says: ['GitHub refused the status', '-f "state=success" -f "context=ai-review"'] });
    run('status not read back', { ...ok, status: 'lost' }, { code: 3, result: 'pending', posts: 1, commits: 1, says: ['reading it back'] });
    run('push refused', ok, { prepare: (p) => gitIn(p, 'remote', 'set-url', 'origin', join(dir, 'no-such-remote.git')), code: 3, result: 'pending', posts: 0, commits: 1, says: ['    git push -u origin plan/initial\n'] });
    run('dry run', ok, { args: ['--review', 'plan', '--state', 'success', '--dry-run'], code: 0, result: 'success (dry run', posts: 0, commits: 0, says: ['would commit docs/PLAN-REVIEW.md', 'would run gh api -X POST'] });
    run('nothing to commit', ok, { prepare: (p) => gitIn(p, 'checkout', '-q', '--', 'docs/PLAN-REVIEW.md'), code: 0, result: 'success', posts: 1, commits: 0 });
    // T2 review, round 2: an ignored file the check would read, a failed read after the write, a commit git refuses.
    run('an ignored file under docs/', ok, { prepare: (p) => { writeFileSync(join(p, '.git', 'info', 'exclude'), 'docs/adr/0004-extra.md\n'); writeFileSync(join(p, 'docs', 'adr', '0004-extra.md'), '# ADR-0004: Extra\n'); }, code: 1, posts: 0, says: ['ignored by git', 'docs/adr/0004-extra.md'] });
    run('the status read back fails', { ...ok, reads: 'statuses' }, { code: 3, result: 'pending', posts: 1, commits: 1, says: ['reading it back'] });
    run('an OS file under docs/ that the template ignores', ok, { prepare: (p) => writeFileSync(join(p, 'docs', '.DS_Store'), 'x'), code: 0, result: 'success', posts: 1, commits: 1 });
    const emptyConfig = join(dir, 'empty.gitconfig');
    writeFileSync(emptyConfig, '');
    run('git cannot commit', ok, { env: { GIT_AUTHOR_NAME: '', GIT_AUTHOR_EMAIL: '', GIT_COMMITTER_NAME: '', GIT_COMMITTER_EMAIL: '', GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1' }, code: 1, posts: 0, commits: 0, says: ['git could not commit docs/PLAN-REVIEW.md'] });
    for (const [label, a] of [['no --state', ['--review', 'plan']], ['an unknown review', ['--review', 'epic', '--state', 'success']], ['an unknown flag', ['--review', 'plan', '--state', 'success', '--force']]]) {
      run(label, ok, { args: a, code: 2, posts: 0 });
    }
  });
});

// 6i. T2-AC5, ADR-0008: merge.mjs against the fake gh. It merges the plan PR with a merge commit that
// records the owner's approval, and only when both checks are green and a merge commit is possible.
step('plan merge (fake gh)', (report) => {
  scratch('pitwall-merge-', (dir) => {
    const { project: base } = makePlanRepo(dir, { spike: false });
    const sha = gitIn(base, 'rev-parse', 'plan/initial').stdout.trim();
    const ok = { auth: true, repo: { nameWithOwner: 'o/r', viewerPermission: 'ADMIN', mergeCommitAllowed: true }, pr: { head: 'local' }, statuses: { 'ai-review': 'success' }, gate: 'success', merge: 'ok' };
    const run = (label, scenario, { args = ['--plan', '--owner-approved'], project = base, gh, env = {}, code, result, merges, says = [] }) => {
      const { r, calls, state } = withFakeGh('merge.mjs', project, scenario, [...args, '--project', project, ...(args.includes('--wait') ? [] : ['--wait', '0'])], { GIT_CEILING_DIRECTORIES: dir, ...(gh ? { PITWALL_GH: JSON.stringify(gh) } : {}), ...env });
      const fail = (msg) => report(`${label}: ${msg}\n${r.stdout}${r.stderr}`);
      const merged = calls.filter((c) => c.args[0] === 'pr' && c.args[1] === 'merge');
      if (r.status !== code) fail(`exit ${r.status}, expected ${code}`);
      if (result && !r.stdout.includes(`RESULT: ${result}`)) fail(`no "RESULT: ${result}"`);
      if (merged.length !== merges) fail(`${merged.length} merges, expected ${merges}`);
      for (const m of merged) {
        const body = m.args[m.args.indexOf('--body') + 1];
        if (!m.args.includes('--merge') || m.args[m.args.indexOf('--match-head-commit') + 1] !== sha) fail(`merged with ${m.args.join(' ')}, expected --merge --match-head-commit ${sha}`);
        if (!new RegExp(`^Plan approved by the owner, \\d{4}-\\d{2}-\\d{2}, at ${sha}$`).test(body ?? '')) fail(`the merge commit message is "${body}"`);
      }
      for (const s of says) if (!r.stdout.includes(s) && !r.stderr.includes(s)) fail(`output lacks "${s}"`);
      checkHandoff(r.stdout, fail);
      if (state.merged) rmSync(join(dir, 'repo-gh.json'));
      return r;
    };
    run('green and approved', ok, { code: 0, result: 'merged', merges: 1 });
    run('without the owner', ok, { args: ['--plan'], code: 2, merges: 0, says: ['--owner-approved is required'] });
    run('merge commits not allowed', { ...ok, repo: { ...ok.repo, mergeCommitAllowed: false } }, { code: 3, result: 'pending', merges: 0, says: ['    gh repo edit o/r --enable-merge-commit\n'] });
    run('a ruleset requires linear history', { ...ok, rules: [{ type: 'required_linear_history' }] }, { code: 3, result: 'pending', merges: 0, says: ['requires linear history'] });
    run('the protection requires linear history', { ...ok, protection: { required_status_checks: { checks: [] }, enforce_admins: { enabled: true }, required_linear_history: { enabled: true } } }, { code: 3, result: 'pending', merges: 0, says: ['Require linear history'] });
    run('ai-review red', { ...ok, statuses: { 'ai-review': 'failure' } }, { code: 1, merges: 0, says: ['ai-review is failure'] });
    run('ai-review not set', { ...ok, statuses: {} }, { code: 1, merges: 0, says: ['ai-review is not set'] });
    run('gate red', { ...ok, gate: 'failure' }, { code: 1, merges: 0, says: ['gate is failure'] });
    run('gate still running', { ...ok, gate: 'pending' }, { code: 3, result: 'pending', merges: 0, says: ['still in_progress'] });
    run('the head moved', { ...ok, pr: { head: '0'.repeat(40) } }, { code: 1, merges: 0, says: ['push it and review it again'] });
    run('GitHub refuses', { ...ok, merge: 'refuse' }, { code: 3, result: 'pending', merges: 1, says: ['GitHub refused the merge', `    gh pr merge 7 --merge --match-head-commit ${sha}`] });
    run('no PR', { ...ok, pr: null }, { code: 3, result: 'pending', merges: 0, says: ['    gh pr create --base main --head plan/initial --fill\n'] });
    run('already merged', { ...ok, pr: { head: 'local', state: 'MERGED' } }, { code: 0, result: 'merged', merges: 0, says: ['already merged'] });
    run('not signed in', { ...ok, auth: false }, { code: 3, result: 'pending', merges: 0, says: ['    gh auth login\n'] });
    run('read only', { ...ok, repo: { ...ok.repo, viewerPermission: 'READ' } }, { code: 3, result: 'pending', merges: 0, says: ['needs write access'] });
    run('dry run', ok, { args: ['--plan', '--owner-approved', '--dry-run'], code: 0, result: 'merged (dry run', merges: 0, says: ['would run gh pr merge 7 --merge'] });
    // T2 review: the branches the first version left untested.
    run('no gate check at all', { ...ok, gate: null }, { code: 3, result: 'pending', merges: 0, says: ['no gate check from GitHub Actions'] });
    run('a gate from another app refuses at once', { ...ok, gateApp: 1 }, { code: 1, merges: 0, says: ['comes from app 1, not GitHub Actions'] });
    run('a closed PR', { ...ok, pr: { head: 'local', state: 'CLOSED' } }, { code: 1, merges: 0, says: ['is closed'] });
    run('a PR into another branch', { ...ok, pr: { head: 'local', base: 'develop' } }, { code: 1, merges: 0, says: ['goes into develop, not main'] });
    run('a PR from another branch only', { ...ok, pr: { head: 'local', branch: 'other' } }, { code: 3, result: 'pending', merges: 0, says: ['there is no PR from plan/initial'] });
    run('a repository gh cannot read', { ...ok, repo: null, repoError: 'HTTP 404: Not Found' }, { code: 3, result: 'pending', merges: 0, says: ['gh could not read the repository: HTTP 404'] });
    run('no gh', ok, { gh: [join(dir, 'no-such-gh')], code: 3, result: 'pending', merges: 0, says: ['cli.github.com'] });
    run('the merge is not read back', { ...ok, merge: 'lost' }, { code: 3, result: 'pending', merges: 1, says: ['reads OPEN'] });
    run('merged by hand before', { ...ok, pr: { head: 'local', state: 'MERGED' } }, { code: 0, result: 'merged', merges: 0, says: ['does not record the approval of the owner'] });
    run('merged with the approval before', { ...ok, pr: { head: 'local', state: 'MERGED' }, mergeMessage: 'Merge the plan\n\nPlan approved by the owner, 2026-11-08, at abc' }, { code: 0, result: 'merged', merges: 0, says: ['records the approval of the owner'] });
    // T2 review, round 2.
    run('without --plan', ok, { args: ['--owner-approved'], code: 2, merges: 0, says: ['--plan is required'] });
    run('a --wait that is not a number', ok, { args: ['--plan', '--owner-approved', '--wait', 'soon'], code: 2, merges: 0, says: ['--wait takes a number of seconds'] });
    run('the statuses cannot be read', { ...ok, reads: 'statuses' }, { code: 3, result: 'pending', merges: 0, says: ['gh could not read the statuses'] });
    run('the check runs cannot be read', { ...ok, reads: 'check-runs' }, { code: 3, result: 'pending', merges: 0, says: ['gh could not read the check runs'] });
    run('the rules cannot be read', { ...ok, reads: 'rules' }, { code: 0, result: 'merged', merges: 1, says: ['could not read the rules on main'] });
    run('the protection cannot be read', { ...ok, reads: 'protection' }, { code: 0, result: 'merged', merges: 1, says: ['could not read the branch protection of main'] });
    run('a gate re-run after a failure', { ...ok, gateRerun: true }, { code: 0, result: 'merged', merges: 1 });
    // T2 review, round 3.
    run('merged before at another commit', { ...ok, pr: { head: '1'.repeat(40), state: 'MERGED' } }, { code: 1, result: 'not merged', merges: 0, says: ['was merged at 1111111', 'need a PR and a review of their own'] });
    const started = Date.now();
    run('a gate still running, with a long poll', { ...ok, gate: 'pending' }, { args: ['--plan', '--owner-approved', '--wait', '1'], env: { PITWALL_POLL_MS: '20000' }, code: 3, result: 'pending', merges: 0, says: ['still in_progress'] });
    if (Date.now() - started > 8000) report(`a gate still running, with a long poll: took ${Date.now() - started} ms with --wait 1, so it slept past its deadline`);
    const nobranch = join(dir, 'nobranch');
    cpSync(base, nobranch, { recursive: true });
    gitIn(nobranch, 'switch', '-q', 'main');
    gitIn(nobranch, 'branch', '-q', '-D', 'plan/initial');
    run('no local planning branch', ok, { project: nobranch, code: 1, merges: 0, says: ['there is no local branch plan/initial'] });
  });
});

// T3b: a project after its plan merged, with E1 on its branch: a code commit, a fix commit, and the
// review file the code reviewer would write. Returns the project and the commits.
function makeChangeRepo(dir) {
  const { project } = makePlanRepo(dir, { spike: false });
  gitIn(project, 'switch', '-q', 'main');
  gitIn(project, 'merge', '-q', '--no-ff', 'plan/initial', '-m', 'Merge the plan from plan/initial (#1)', '-m', 'Plan approved by the owner, 2026-11-09, at x');
  gitIn(project, 'switch', '-qc', 'epic/E1-reminder');
  const epics = join(project, 'docs', 'EPICS.md');
  writeFileSync(epics, readFileSync(epics, 'utf8').replace('| The reminder | normal | E0 | planned |', '| The reminder | normal | E0 | in progress |'));
  gitIn(project, 'commit', '-qam', 'docs: start E1-reminder');
  mkdirSync(join(project, 'src'));
  writeFileSync(join(project, 'src', 'reminder.js'), 'export const minutes = 45;\n');
  gitIn(project, 'add', '-A');
  gitIn(project, 'commit', '-qm', 'feat: the reminder');
  const code = gitIn(project, 'rev-parse', 'HEAD').stdout.trim();
  writeFileSync(join(project, 'src', 'reminder.test.js'), 'import { minutes } from "./reminder.js";\n');
  gitIn(project, 'add', '-A');
  gitIn(project, 'commit', '-qm', 'fix: review finding 1, a test');
  const fix = gitIn(project, 'rev-parse', 'HEAD').stdout.trim();
  return { project, code, fix, main: gitIn(project, 'rev-parse', 'main').stdout.trim() };
}
// A review file as the code reviewer writes it from the template.
function reviewText({ change = 'E1-reminder', reviewed, round = 2, criteria = [['E1-AC1', '`src/reminder.test.js` "shows after 45 minutes"'], ['E1-AC2', 'QA: snooze, then wait 10 minutes']], findings = [], extra = '' }) {
  return [
    `# Review: ${change}`, '', `- Change: ${change}`, `- Reviewed: ${reviewed}`, `- Round: ${round}`, '',
    '## Acceptance criteria', '', '| Criterion | Covered by |', '| --- | --- |', ...criteria.map(([c, by]) => `| ${c} | ${by} |`), '',
    '## Findings', '', '| # | Finding | Severity (blocking, should fix) | Closed by (commit) or accepted risk |', '| --- | --- | --- | --- |', ...findings.map((f, i) => `| ${f[3] ?? i + 1} | ${f[0]} | ${f[1]} | ${f[2]} |`), '', extra,
  ].join('\n');
}

// 6j. T3b-AC4, ADR-0011: docs-check --stage code-review on a review the way the code reviewer leaves it,
// and on each kind of gap: a criterion not covered, a finding not closed, the code changed after the review.
step('code review check', (report) => {
  scratch('pitwall-code-review-', (dir) => {
    const { project: base, code, fix, main } = makeChangeRepo(dir);
    const good = { reviewed: fix, findings: [['`src/reminder.js:1` has no test', 'blocking', `${fix.slice(0, 9)} adds it`], ['A game in full screen hides it', 'should fix', 'R-1']] };
    let n = 0;
    const run = (label, { review = good, prepare, args = [], pass = false, says = [] }) => {
      const p = join(dir, `c${(n += 1)}`);
      cpSync(base, p, { recursive: true });
      mkdirSync(join(p, 'docs', 'reviews'), { recursive: true });
      if (review) writeFileSync(join(p, 'docs', 'reviews', `${review.change ?? 'E1-reminder'}.md`), reviewText(review));
      prepare?.(p);
      const r = docsCheck(p, ['--stage', 'code-review', ...args]);
      const out = `${r.stdout}${r.stderr}`;
      if ((r.status === 0) !== pass) report(`${label}: exit ${r.status}, expected ${pass ? 0 : 1}\n${out}`);
      for (const s of says) if (!out.includes(s)) report(`${label}: output lacks "${s}"\n${out}`);
    };
    run('a review the way the reviewer leaves it', { pass: true });
    run('a review with no findings', { review: { reviewed: fix }, pass: true });
    run('a project laid out before docs/reviews/ had a README and a template', {
      prepare: (p) => {
        gitIn(p, 'rm', '-q', 'docs/reviews/README.md', 'docs/reviews/template.md');
        gitIn(p, 'commit', '-qm', 'an older layout');
        writeFileSync(join(p, 'docs', 'reviews', 'E1-reminder.md'), reviewText({ ...good, reviewed: gitIn(p, 'rev-parse', 'HEAD').stdout.trim() }));
      },
      pass: true,
    });
    run('an open finding', { review: { ...good, findings: [...good.findings, ['No snooze test', 'should fix', 'open: add one']] }, says: ['finding 3 is not closed'] });
    run('a finding with nothing in its last cell', { review: { ...good, findings: [['No snooze test', 'should fix', '']] }, says: ['finding 1 is not closed'] });
    run('a finding closed by words', { review: { ...good, findings: [['No snooze test', 'should fix', 'fixed in the last commit']] }, says: ['finding 1 is not closed'] });
    run('a criterion left out', { review: { ...good, criteria: [['E1-AC1', 'a test']] }, says: ['E1-AC2 is not in "## Acceptance criteria"'] });
    run('a criterion not covered', { review: { ...good, criteria: [['E1-AC1', 'a test'], ['E1-AC2', 'open: no test yet']] }, says: ['E1-AC2 is not covered'] });
    run('criteria covered by a test in a code span, and by a link', { review: { ...good, criteria: [['E1-AC1', '`src/reminder.test.js`'], ['E1-AC2', '[the snooze test](../../src/reminder.test.js)']] }, pass: true });
    run('a criterion covered by a dash', { review: { ...good, criteria: [['E1-AC1', 'a test'], ['E1-AC2', '-']] }, says: ['E1-AC2 is not covered'] });
    run('a criterion of another epic', { review: { ...good, criteria: [...good.criteria ?? [['E1-AC1', 'a'], ['E1-AC2', 'b']], ['E2-AC1', 'a test']] }, says: ['"E2-AC1" is not a criterion of E1'] });
    run('a short reviewed sha', { review: { ...good, reviewed: fix.slice(0, 7) }, says: ['the full sha of the commit the round reviewed'] });
    run('a reviewed commit that is not here', { review: { ...good, reviewed: '1'.repeat(40) }, says: ['is not in this repository'] });
    run('code changed after the reviewed commit', { review: { ...good, reviewed: code, findings: [] }, says: ['files changed after the reviewed commit', 'src/reminder.test.js'] });
    run('a change in the tree besides the review file', { prepare: (p) => writeFileSync(join(p, 'src', 'reminder.js'), 'export const minutes = 40;\n'), says: ['files changed after the reviewed commit', 'src/reminder.js'] });
    run('a reviewed commit from another branch', {
      prepare: (p) => {
        gitIn(p, 'switch', '-qc', 'side', 'main');
        gitIn(p, 'commit', '-q', '--allow-empty', '-m', 'side');
        const side = gitIn(p, 'rev-parse', 'HEAD').stdout.trim();
        gitIn(p, 'switch', '-q', 'epic/E1-reminder');
        writeFileSync(join(p, 'docs', 'reviews', 'E1-reminder.md'), reviewText({ ...good, reviewed: side }));
      },
      says: ['is not in the history of HEAD'],
    });
    run('a finding closed by a commit on main', { review: { ...good, findings: [['x', 'blocking', main.slice(0, 9)]] }, says: ['is already on main'] });
    run('a finding closed by a sha that is no commit', { review: { ...good, findings: [['x', 'blocking', 'abcdef1234']] }, says: ['no commit of this repository'] });
    run('a finding closed by a risk nobody accepted', { review: { ...good, findings: [['x', 'blocking', 'R-9']] }, says: ['closed by R-9, which is not a risk the owner accepted'] });
    run('a severity of its own', { review: { ...good, findings: [['x', 'nit', fix.slice(0, 9)]] }, says: ['severity "nit" is not one of blocking, should fix'] });
    run('findings numbered out of order', { review: { ...good, findings: [['x', 'blocking', fix.slice(0, 9)], ['y', 'blocking', fix.slice(0, 9), 3]] }, says: ['finding "3" is row 2'] });
    run('a Change field for another epic', { review: { ...good, change: 'E1-reminder' }, prepare: (p) => writeFileSync(join(p, 'docs', 'reviews', 'E1-reminder.md'), reviewText(good).replace('- Change: E1-reminder', '- Change: E2-release')), says: ['"- Change:" reads "E2-release"'] });
    run('a round that is no number', { prepare: (p) => writeFileSync(join(p, 'docs', 'reviews', 'E1-reminder.md'), reviewText(good).replace('- Round: 2', '- Round: two')), says: ['"- Round:" reads "two"'] });
    run('a heading of its own', { review: { ...good, extra: '## Round 1 findings\n\n| # | Finding | Severity (blocking, should fix) | Closed by (commit) or accepted risk |\n| --- | --- | --- | --- |\n| 1 | x | blocking | open: y |\n' }, says: ['"## Round 1 findings" is not a section of the template'] });
    run('a second table in Findings', { prepare: (p) => writeFileSync(join(p, 'docs', 'reviews', 'E1-reminder.md'), reviewText(good).replace('## Findings\n', '## Findings\n\n| # | x |\n| --- | --- |\n| 1 | open: hidden |\n')), says: ['"## Findings" holds 2 tables'] });
    run('a closed cell as a link', { review: { ...good, findings: [['x', 'blocking', `[${fix.slice(0, 9)}](https://example.com)`]] }, says: ['holds a link'] });
    run('the template\'s columns changed', { prepare: (p) => writeFileSync(join(p, 'docs', 'reviews', 'E1-reminder.md'), reviewText(good).replace('| Criterion | Covered by |', '| Criterion | Test |')), says: ['must keep the template\'s columns'] });
    run('no review file', { review: null, says: ['docs/reviews/E1-reminder.md: missing'] });
    run('on main', { prepare: (p) => { gitIn(p, 'stash', '-q', '-u'); gitIn(p, 'switch', '-q', 'main'); }, says: ['not on the branch of a change'] });
    run('a branch that names no change', { prepare: (p) => gitIn(p, 'branch', '-q', '-m', 'epic/reminder'), says: ['"epic/reminder" names no change'] });
    run('--change names the review', { args: ['--change', 'E1-reminder'], prepare: (p) => gitIn(p, 'branch', '-q', '-m', 'work'), pass: true });
    const bug = (p, covered = '`src/reminder.test.js` "shows the tray icon"', extra) => {
      gitIn(p, 'branch', '-q', '-m', 'fix/BUG-1');
      const bugs = join(p, 'docs', 'BUGS.md');
      writeFileSync(bugs, `${readFileSync(bugs, 'utf8').trimEnd()}\n| BUG-1 | No tray icon | QA | Open the app | A tray icon | Nothing | blocking | normal | in progress | - |\n`);
      extra?.(p);
      gitIn(p, 'add', '-A');
      gitIn(p, 'commit', '-qm', 'docs: BUG-1');
      const head = gitIn(p, 'rev-parse', 'HEAD').stdout.trim();
      writeFileSync(join(p, 'docs', 'reviews', 'BUG-1.md'), reviewText({ change: 'BUG-1', reviewed: head, criteria: [['BUG-1', covered]], findings: [['x', 'blocking', fix.slice(0, 9)]] }));
    };
    run('a bug fix\'s review', { review: null, prepare: bug, pass: true });
    // T4b-AC1: a bug closes only with a regression test, or a QA scenario in a file where no test can drive it, saying why.
    run('a bug covered by words alone', { review: null, prepare: (p) => bug(p, 'the tray test'), says: ['BUG-1 is covered by no file of the reviewed commit'] });
    run('a bug covered by a file that is not in the reviewed commit', { review: null, prepare: (p) => bug(p, '`src/tray.test.js`'), says: ['BUG-1 is covered by no file of the reviewed commit'] });
    run('a bug covered by a test named with its line', { review: null, prepare: (p) => bug(p, '`src/reminder.test.js:1`'), pass: true });
    run('a bug covered by a test named in a link', { review: null, prepare: (p) => bug(p, '[the test](../../src/reminder.test.js)'), pass: true });
    const scenario = (p) => {
      mkdirSync(join(p, 'docs', 'qa'), { recursive: true });
      writeFileSync(join(p, 'docs', 'qa', 'tray.md'), '# The tray icon\n\n1. Log in.\n2. See the icon.\n');
    };
    run('a bug covered by a QA scenario that says why no test can', { review: null, prepare: (p) => bug(p, 'QA scenario `docs/qa/tray.md`: no automated test: the tray of the desktop is out of reach of the tests', scenario), pass: true });
    run('a bug covered by a QA scenario that does not say why', { review: null, prepare: (p) => bug(p, 'QA scenario `docs/qa/tray.md`', scenario), says: ['BUG-1 is covered by a QA scenario: the same cell says why'] });
    run('a bug fix\'s review without its row in BUGS.md', {
      review: null,
      prepare: (p) => {
        bug(p);
        gitIn(p, 'branch', '-q', '-m', 'fix/BUG-2');
        cpSync(join(p, 'docs', 'reviews', 'BUG-1.md'), join(p, 'docs', 'reviews', 'BUG-2.md'));
        writeFileSync(join(p, 'docs', 'reviews', 'BUG-2.md'), readFileSync(join(p, 'docs', 'reviews', 'BUG-2.md'), 'utf8').split('BUG-1').join('BUG-2'));
        rmSync(join(p, 'docs', 'reviews', 'BUG-1.md'));
      },
      says: ['BUG-2 is not a row of docs/BUGS.md'],
    });
  });
});

// 6k. T3b-AC4, AC5, AC6: review-status.mjs --review code, merge.mjs --change and merge-choice.mjs against
// the fake gh, on a change the way the loop leaves it.
step('code review status, merges by risk class, the owner\'s choice (fake gh)', (report) => {
  scratch('pitwall-loop-', (dir) => {
    const { project: base, fix } = makeChangeRepo(dir);
    const origin = join(dir, 'origin.git');
    gitIn(dir, 'init', '-q', '--bare', origin);
    gitIn(base, 'remote', 'add', 'origin', origin);
    gitIn(base, 'push', '-q', 'origin', 'main', 'epic/E1-reminder');
    const branch = 'epic/E1-reminder';
    let n = 0;
    const fresh = (prepare) => {
      const p = join(dir, `l${(n += 1)}`);
      cpSync(base, p, { recursive: true });
      cpSync(origin, `${p}-origin.git`, { recursive: true });
      gitIn(p, 'remote', 'set-url', 'origin', `${p}-origin.git`);
      prepare?.(p);
      return p;
    };
    const writeReview = (p, review) => {
      mkdirSync(join(p, 'docs', 'reviews'), { recursive: true });
      writeFileSync(join(p, 'docs', 'reviews', 'E1-reminder.md'), reviewText(review));
    };
    const closed = { reviewed: fix, findings: [['`src/reminder.js:1` has no test', 'blocking', `${fix.slice(0, 9)} adds it`]] };

    // review-status.mjs --review code.
    const okReview = { auth: true, repo: { nameWithOwner: 'o/r', viewerPermission: 'ADMIN' }, pr: { head: 'local', branch }, status: 'ok' };
    const status = (label, { args = ['--review', 'code', '--state', 'success'], review = closed, prepare, code, result, posts, commits = 0, says = [] }) => {
      const p = fresh((q) => {
        if (review) writeReview(q, review);
        prepare?.(q);
      });
      const before = Number(gitIn(p, 'rev-list', '--count', 'HEAD').stdout.trim());
      const { r, calls } = withFakeGh('review-status.mjs', p, okReview, [...args, '--project', p], { ...identity, GIT_CEILING_DIRECTORIES: dir });
      const fail = (msg) => report(`review-status, ${label}: ${msg}\n${r.stdout}${r.stderr}`);
      const writes = calls.filter((c) => c.args.includes('POST'));
      const made = Number(gitIn(p, 'rev-list', '--count', 'HEAD').stdout.trim()) - before;
      if (r.status !== code) fail(`exit ${r.status}, expected ${code}`);
      if (result && !r.stdout.includes(`RESULT: ${result}`)) fail(`no "RESULT: ${result}"`);
      if (writes.length !== posts) fail(`${writes.length} status writes, expected ${posts}`);
      if (made !== commits) fail(`${made} commits, expected ${commits}`);
      if (made > 0) {
        const touched = gitIn(p, 'diff', '--name-only', 'HEAD~1', 'HEAD').stdout.trim();
        if (touched !== 'docs/reviews/E1-reminder.md') fail(`the commit touched ${touched}, expected the review file only`);
        const subject = gitIn(p, 'log', '-1', '--format=%s').stdout.trim();
        if (!/^docs: code review of E1-reminder, (approved|changes requested)$/.test(subject)) fail(`the commit says "${subject}"`);
      }
      for (const w of writes) if (!w.args.includes(`repos/o/r/statuses/${gitIn(p, 'rev-parse', 'HEAD').stdout.trim()}`)) fail(`wrote ${w.args.join(' ')}, not on the head`);
      for (const s of says) if (!r.stdout.includes(s)) fail(`output lacks "${s}"`);
      checkHandoff(r.stdout, fail);
    };
    status('approved', { code: 0, result: 'success', posts: 1, commits: 1 });
    status('changes requested', { args: ['--review', 'code', '--state', 'failure', '--description', 'code review: 1 open'], review: { ...closed, findings: [['x', 'blocking', 'open: y']] }, code: 0, result: 'failure', posts: 1, commits: 1 });
    status('success with an open finding', { review: { ...closed, findings: [['x', 'blocking', 'open: y']] }, code: 1, posts: 0, says: ['does not pass docs-check --stage code-review', 'finding 1 is not closed'] });
    status('success after the code changed', { review: { ...closed, reviewed: gitIn(base, 'rev-parse', 'HEAD~1').stdout.trim(), findings: [] }, code: 1, posts: 0, says: ['files changed after the reviewed commit'] });
    status('failure after the code changed', { args: ['--review', 'code', '--state', 'failure'], review: { ...closed, reviewed: gitIn(base, 'rev-parse', 'HEAD~1').stdout.trim() }, code: 0, result: 'failure', posts: 1, commits: 1 });
    status('a branch that names no change', { prepare: (p) => gitIn(p, 'branch', '-q', '-m', 'epic/reminder'), code: 1, posts: 0, says: ['names no change'] });
    status('on main', { review: null, prepare: (p) => gitIn(p, 'switch', '-q', 'main'), code: 1, posts: 0, says: ['sets its status on epic/<change> or fix/<change>'] });
    status('other changes in the tree', { prepare: (p) => writeFileSync(join(p, 'docs', 'SPEC.md'), 'changed\n'), code: 1, posts: 0, says: ['changes besides docs/reviews/E1-reminder.md'] });

    // merge.mjs --change, by risk class and the owner's choice.
    const green = { auth: true, repo: { nameWithOwner: 'o/r', viewerPermission: 'ADMIN', mergeCommitAllowed: true }, pr: { head: 'local', branch, title: 'E1 - The reminder' }, statuses: { 'ai-review': 'success' }, gate: 'success', merge: 'ok' };
    const choose = (p, v) => {
      const f = join(p, '.claude', 'pitwall.json');
      const s = JSON.parse(readFileSync(f, 'utf8'));
      // null: a project laid out before the owner's choice existed.
      if (v === null) delete s.autoMerge;
      else s.autoMerge = v;
      writeFileSync(f, JSON.stringify(s, null, 2) + '\n');
    };
    const merge = (label, { scenario = green, args = ['--change'], autoMerge = true, prepare, code, result, merges, subject, body, says = [] }) => {
      const p = fresh((q) => {
        choose(q, autoMerge);
        prepare?.(q);
      });
      const sha = gitIn(p, 'rev-parse', 'HEAD').stdout.trim();
      const { r, calls } = withFakeGh('merge.mjs', p, scenario, [...args, '--project', p, '--wait', '0'], { GIT_CEILING_DIRECTORIES: dir });
      const fail = (msg) => report(`merge, ${label}: ${msg}\n${r.stdout}${r.stderr}`);
      const merged = calls.filter((c) => c.args[0] === 'pr' && c.args[1] === 'merge');
      if (r.status !== code) fail(`exit ${r.status}, expected ${code}`);
      if (result && !r.stdout.includes(`RESULT: ${result}`)) fail(`no "RESULT: ${result}"`);
      if (merged.length !== merges) fail(`${merged.length} merges, expected ${merges}`);
      for (const m of merged) {
        const got = { subject: m.args[m.args.indexOf('--subject') + 1], body: m.args[m.args.indexOf('--body') + 1] };
        if (!m.args.includes('--merge') || m.args[m.args.indexOf('--match-head-commit') + 1] !== sha) fail(`merged with ${m.args.join(' ')}, expected --merge --match-head-commit ${sha}`);
        if (subject && got.subject !== subject) fail(`the merge commit's subject is "${got.subject}", expected "${subject}"`);
        if (body && !body.test(got.body)) fail(`the merge commit's body is "${got.body}"`);
      }
      for (const s of says) if (!r.stdout.includes(s) && !r.stderr.includes(s)) fail(`output lacks "${s}"`);
      checkHandoff(r.stdout, fail);
    };
    const without = new RegExp(`^Risk class: normal\\. Merged without the owner, .*\\(pitwall ADR-0010\\), at [0-9a-f]{40}\\.$`);
    const byOwner = (cls) => new RegExp(`^${cls ? `Risk class: ${cls}\\.` : 'A bug fix, approved by the owner as every fix is until bugs carry a risk class\\.'} Approved by the owner, \\d{4}-\\d{2}-\\d{2}, at [0-9a-f]{40}\\.$`);
    merge('normal risk, the owner allowed it', { code: 0, result: 'merged', merges: 1, subject: 'feat(E1): The reminder (#7)', body: without });
    merge('normal risk, the owner said no', { autoMerge: false, code: 4, result: 'waits for the owner', merges: 0, says: ['every merge waits for them'] });
    merge('normal risk, the owner not asked yet', { autoMerge: null, code: 4, result: 'waits for the owner', merges: 0, says: ['has not chosen yet'] });
    merge('normal risk, the owner said yes to this merge', { autoMerge: false, args: ['--change', '--owner-approved'], code: 0, result: 'merged', merges: 1, subject: 'feat(E1): The reminder (#7)', body: byOwner('normal') });
    const high = (p) => {
      const f = join(p, 'docs', 'EPICS.md');
      writeFileSync(f, readFileSync(f, 'utf8').replace('| The reminder | normal | E0 |', '| The reminder | high | E0 |'));
      gitIn(p, 'commit', '-qm', 'docs: E1 is high risk', '--', 'docs/EPICS.md');
    };
    merge('high risk, the owner allowed low and normal', { prepare: high, code: 4, result: 'waits for the owner', merges: 0, says: ['E1 is high risk'] });
    merge('high risk, the owner said yes', { prepare: high, args: ['--change', '--owner-approved'], code: 0, result: 'merged', merges: 1, body: byOwner('high') });
    // T3b review: the plan on main says high, the branch says normal: the higher class holds.
    const lowered = (p) => {
      gitIn(p, 'switch', '-q', 'main');
      high(p);
      gitIn(p, 'switch', '-q', branch);
      gitIn(p, 'merge', '-q', '-s', 'ours', 'main', '-m', 'merge main, keeping the branch\'s EPICS.md');
    };
    merge('high on main, lowered on the branch', { prepare: lowered, code: 4, result: 'waits for the owner', merges: 0, says: ['E1 is high risk'] });
    merge('a class read from the commit, not the tree', { prepare: (p) => writeFileSync(join(p, 'docs', 'EPICS.md'), readFileSync(join(p, 'docs', 'EPICS.md'), 'utf8').replace('| The reminder | normal | E0 | in progress |', '| The reminder | high | E0 | in progress |')), code: 0, result: 'merged', merges: 1, body: without });
    const toFix = (p) => gitIn(p, 'branch', '-q', '-m', 'fix/BUG-1');
    const fixPr = { ...green, pr: { head: 'local', branch: 'fix/BUG-1', title: 'BUG-1: no tray icon after login' } };
    merge('a bug fix, the owner allowed low and normal', { prepare: toFix, scenario: fixPr, code: 4, result: 'waits for the owner', merges: 0, says: ['BUG-1 is a bug fix'] });
    merge('a bug fix, the owner said yes', { prepare: toFix, scenario: fixPr, args: ['--change', '--owner-approved'], code: 0, result: 'merged', merges: 1, subject: 'fix(BUG-1): no tray icon after login (#7)', body: byOwner(null) });
    merge('ai-review red', { scenario: { ...green, statuses: { 'ai-review': 'failure' } }, code: 1, merges: 0, says: ['ai-review is failure', 'the code reviewer sets it'] });
    merge('gate red', { scenario: { ...green, gate: 'failure' }, code: 1, merges: 0, says: ['gate is failure'] });
    merge('the head moved', { scenario: { ...green, pr: { ...green.pr, head: '0'.repeat(40) } }, code: 1, merges: 0, says: ['push it and review it again'] });
    merge('on main', { prepare: (p) => gitIn(p, 'switch', '-q', 'main'), code: 1, merges: 0, says: ['--change merges the PR of the change on this branch'] });
    merge('a branch that names no change', { prepare: (p) => gitIn(p, 'branch', '-q', '-m', 'epic/reminder'), code: 1, merges: 0, says: ['--change merges the PR of the change on this branch'] });
    merge('--plan and --change', { args: ['--plan', '--change', '--owner-approved'], code: 2, merges: 0, says: ['give one'] });
    merge('a dry run', { args: ['--change', '--dry-run'], code: 0, result: 'merged (dry run', merges: 0, says: ['would run gh pr merge 7 --merge --match-head-commit', '--subject "feat(E1): The reminder (#7)"'] });
    merge('already merged', { scenario: { ...green, pr: { ...green.pr, state: 'MERGED' } }, code: 0, result: 'merged', merges: 0, says: ['already merged'] });
    merge('no PR', { scenario: { ...green, pr: null }, code: 3, result: 'pending', merges: 0, says: ['there is no PR from epic/E1-reminder'] });

    // merge-choice.mjs: the owner's script, never under Claude Code, rules only while the guard works.
    const owner = { ...process.env, CLAUDECODE: '' };
    delete owner.CLAUDECODE;
    const choiceRun = (p, args, env = owner, script = join(scripts, 'merge-choice.mjs')) => spawnSync(process.execPath, [script, ...args, '--project', p], { encoding: 'utf8', env });
    const local = (p) => join(p, '.claude', 'settings.local.json');
    const rules = (p) => (existsSync(local(p)) ? JSON.parse(readFileSync(local(p), 'utf8')).permissions?.allow ?? [] : []);
    const choiceOf = (p) => JSON.parse(readFileSync(join(p, '.claude', 'pitwall.json'), 'utf8')).autoMerge;
    // Both spellings of the plugin's folder (Windows has two), until a session start keeps the session's own.
    const expectRules = [...new Set([plugin, plugin.split('\\').join('/')])].flatMap((d) => [`Bash(node "${d}/scripts/review-status.mjs" *)`, `Bash(node "${d}/scripts/merge.mjs" --change)`]);
    let p = fresh();
    let r = choiceRun(p, ['--allow'], { ...owner, CLAUDECODE: '1' });
    if (r.status !== 1 || !/not inside Claude Code/.test(r.stdout) || existsSync(local(p)) || choiceOf(p) !== false) report(`merge-choice under Claude Code must refuse and write nothing: exit ${r.status}\n${r.stdout}`);
    r = choiceRun(p, ['--allow']);
    if (r.status !== 0 || choiceOf(p) !== true || JSON.stringify(rules(p)) !== JSON.stringify(expectRules)) report(`merge-choice --allow: exit ${r.status}, autoMerge ${choiceOf(p)}, rules ${JSON.stringify(rules(p))}\n${r.stdout}${r.stderr}`);
    writeFileSync(local(p), JSON.stringify({ permissions: { allow: ['Bash(npm test)', ...expectRules] } }, null, 2));
    r = choiceRun(p, ['--allow']);
    if (r.status !== 0 || !/as before/.test(r.stdout) || JSON.stringify(rules(p)) !== JSON.stringify(['Bash(npm test)', ...expectRules])) report(`merge-choice --allow a second time must change nothing: ${JSON.stringify(rules(p))}\n${r.stdout}`);
    r = choiceRun(p, ['--deny']);
    if (r.status !== 0 || choiceOf(p) !== false || JSON.stringify(rules(p)) !== JSON.stringify(['Bash(npm test)'])) report(`merge-choice --deny must record false and keep only the owner's rules: ${JSON.stringify(rules(p))}\n${r.stdout}`);
    for (const args of [[], ['--allow', '--deny']]) if (choiceRun(p, args).status !== 2) report(`merge-choice ${args.join(' ') || 'without a flag'}: expected a usage error`);
    r = choiceRun(dir, ['--allow']);
    if (r.status !== 1 || !/not a pitwall project/.test(r.stdout)) report(`merge-choice outside a pitwall project must refuse\n${r.stdout}`);
    p = fresh();
    writeFileSync(local(p), '{ not json');
    r = choiceRun(p, ['--allow']);
    if (r.status !== 1 || !/does not parse/.test(r.stdout) || choiceOf(p) !== false) report(`merge-choice with a settings.local.json that does not parse must refuse and record nothing\n${r.stdout}`);
    const blind = join(dir, 'blind-plugin');
    cpSync(plugin, blind, { recursive: true });
    const g = join(blind, 'scripts', 'hook-guard.mjs');
    writeFileSync(g, readFileSync(g, 'utf8').replace('export function guard(call, ctx) {', 'export function guard(call, ctx) {\n  return null;'));
    p = fresh();
    r = choiceRun(p, ['--allow'], owner, join(blind, 'scripts', 'merge-choice.mjs'));
    if (r.status !== 1 || !/review guard does not work/.test(r.stdout) || choiceOf(p) !== false || existsSync(local(p))) report(`merge-choice with a guard that refuses nothing must refuse and record nothing\n${r.stdout}`);
    const noHooks = join(dir, 'no-hooks-plugin');
    cpSync(plugin, noHooks, { recursive: true });
    writeFileSync(join(noHooks, 'hooks', 'hooks.json'), '{ "hooks": {} }\n');
    r = choiceRun(p, ['--allow'], owner, join(noHooks, 'scripts', 'merge-choice.mjs'));
    if (r.status !== 1 || !/registers no guard/.test(r.stdout)) report(`merge-choice with a plugin whose hooks.json registers no guard must refuse\n${r.stdout}`);
  });
});

// 6m. T4a-AC3, AC4, AC5: owner-calls.mjs on projects the way the loop leaves them, with the live fake
// GitHub; the headless runs' restore of a snapshot on it; and the scripted owner's marks.
step('owner calls, snapshots and unscripted stops', (report) => {
  // The scripted owner's marks (T3b, T4a-AC5).
  const ask = 'Status: E0 is merged.\n\nShould I hold E1 until you have run QA-E0-2?';
  const cases = [
    ['Yes, merge it now.', { text: 'Yes, merge it now.', question: null, override: false }],
    ['UNSCRIPTED\nGo with your recommendation.', { text: 'Go with your recommendation.', question: 'Should I hold E1 until you have run QA-E0-2?', override: false }],
    ['UNSCRIPTED: yes, go on', { text: 'yes, go on', question: 'Should I hold E1 until you have run QA-E0-2?', override: false }],
    ['UNSCRIPTED OVERRIDE\nStart E1 now.', { text: 'Start E1 now.', question: 'Should I hold E1 until you have run QA-E0-2?', override: true }],
    ['UNSCRIPTED OVERRIDE', { text: 'Do as you recommend.', question: 'Should I hold E1 until you have run QA-E0-2?', override: true }],
    // Review round 1: the marker as a model may dress it still counts.
    ['**UNSCRIPTED OVERRIDE**\nStart E1 now.', { text: 'Start E1 now.', question: 'Should I hold E1 until you have run QA-E0-2?', override: true }],
    ['UNSCRIPTED (OVERRIDE): start E1 now.', { text: 'start E1 now.', question: 'Should I hold E1 until you have run QA-E0-2?', override: true }],
    ['unscripted override\nStart E1 now.', { text: 'Start E1 now.', question: 'Should I hold E1 until you have run QA-E0-2?', override: true }],
    ['**UNSCRIPTED**\nGo on.', { text: 'Go on.', question: 'Should I hold E1 until you have run QA-E0-2?', override: false }],
    // Review round 2: punctuation between the words, or OVERRIDE on a line of its own, and the word never leaks into the reply.
    ['**UNSCRIPTED** **OVERRIDE**\nStart E1 now.', { text: 'Start E1 now.', question: 'Should I hold E1 until you have run QA-E0-2?', override: true }],
    ['UNSCRIPTED - OVERRIDE\nStart E1 now.', { text: 'Start E1 now.', question: 'Should I hold E1 until you have run QA-E0-2?', override: true }],
    ['UNSCRIPTED: OVERRIDE. Go on.', { text: 'Go on.', question: 'Should I hold E1 until you have run QA-E0-2?', override: true }],
    ['UNSCRIPTED, OVERRIDE: go', { text: 'go', question: 'Should I hold E1 until you have run QA-E0-2?', override: true }],
    ['UNSCRIPTED\nOVERRIDE\nStart E1 now.', { text: 'Start E1 now.', question: 'Should I hold E1 until you have run QA-E0-2?', override: true }],
  ];
  for (const [reply, want] of cases) {
    const got = readOwner(reply, ask);
    if (JSON.stringify(got) !== JSON.stringify(want)) report(`readOwner(${JSON.stringify(reply)}): ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
  }
  for (const [passed, list, want] of [[true, [], 'PASS'], [true, [{ override: false }], 'PASS'], [true, [{ override: true }, { override: true }], 'PASS, stops overridden: 2'], [false, [{ override: true }], 'FAIL']]) {
    if (resultWord(passed, list) !== want) report(`resultWord(${passed}, ${JSON.stringify(list)}): ${resultWord(passed, list)}, expected ${want}`);
  }

  scratch('pitwall-owner-calls-', (dir) => {
    const { project: base } = makeChangeRepo(dir);
    const origin = join(dir, 'origin.git');
    gitIn(dir, 'init', '-q', '--bare', origin);
    gitIn(base, 'remote', 'add', 'origin', origin);
    gitIn(base, 'push', '-q', 'origin', 'main', 'epic/E1-reminder');
    let n = 0;
    const live = (p) => ({ ...process.env, ...identity, FAKE_GH_LIVE: join(`${p}-gh`), FAKE_GH_ORIGIN: `${p}-origin.git`, FAKE_GH_REPO: 'e2e/move-reminder', PITWALL_GH: JSON.stringify([process.execPath, fakeGh]) });
    const fresh = (prepare) => {
      const p = join(dir, `o${(n += 1)}`);
      cpSync(base, p, { recursive: true });
      cpSync(origin, `${p}-origin.git`, { recursive: true });
      gitIn(p, 'remote', 'set-url', 'origin', `${p}-origin.git`);
      prepare?.(p);
      return p;
    };
    const fake = (p, ...args) => spawnSync(process.execPath, [fakeGh, ...args], { cwd: p, env: live(p), encoding: 'utf8' });
    // A green PR from a branch: the fake CI's gate (the template's stub, docs only) and ai-review on its head.
    const greenPr = (p, branch) => {
      gitIn(p, 'push', '-q', '-f', 'origin', branch);
      fake(p, 'pr', 'create', '--base', 'main', '--head', branch, '--title', branch, '--body', 'x');
      const head = gitIn(p, 'rev-parse', branch).stdout.trim();
      fake(p, 'api', '-X', 'POST', `repos/e2e/move-reminder/statuses/${head}`, '-f', 'state=success', '-f', 'context=ai-review', '-f', 'description=approved');
      for (let i = 0; i < 60 && json(fake(p, 'api', `repos/e2e/move-reminder/commits/${head}/check-runs`))?.check_runs?.[0]?.status !== 'completed'; i += 1) spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 1000)']);
    };
    const json = (r) => {
      try {
        return JSON.parse(r.stdout);
      } catch {
        return null;
      }
    };
    const calls = (p, extra = []) => {
      const r = runScript('owner-calls.mjs', ['--project', p, '--json', ...extra], { env: live(p) });
      return { r, out: json(r) ?? { groups: [], notes: [`no JSON: ${r.stdout}${r.stderr}`] } };
    };
    const items = (out, group) => (out.groups.find((g) => g.name === group)?.items ?? []).map((i) => i.what);
    const setSettings = (p, change) => {
      const f = join(p, '.claude', 'pitwall.json');
      writeFileSync(f, JSON.stringify(change(JSON.parse(readFileSync(f, 'utf8'))), null, 2) + '\n');
    };

    // Switches: protection pending, no choice of ADR-0010; each handed over as commands that run as written (L-6).
    let p = fresh((q) => setSettings(q, (s) => ({ ...s, autoMerge: undefined })));
    let { r, out } = calls(p, ['--no-github']);
    if (r.status !== 0) report(`owner-calls: exit ${r.status}\n${r.stdout}${r.stderr}`);
    const sw = out.groups.find((g) => g.name === 'switches')?.items ?? [];
    if (!sw.some((i) => /merge protection is pending/.test(i.what) && i.run?.length === 1 && /protect\.mjs" --project "/.test(i.run[0]))) report(`owner-calls: no handed-over protect.mjs for a pending protection: ${JSON.stringify(sw)}`);
    if (!sw.some((i) => /ADR-0010/.test(i.what) && /merge-choice\.mjs" --allow --project/.test(i.run?.[0]) && /merge-choice\.mjs" --deny --project/.test(i.run?.[1]))) report(`owner-calls: no --allow and --deny commands for the choice not made: ${JSON.stringify(sw)}`);
    for (const c of sw.flatMap((i) => i.run ?? [])) if (/[<>|]|\(or /.test(c)) report(`owner-calls hands over a command that does not run as written (L-6): ${c}`);
    if (!out.notes.some((x) => /not read \(--no-github\)/.test(x))) report('owner-calls --no-github does not say GitHub was not read');
    const text = runScript('owner-calls.mjs', ['--project', p, '--no-github'], { env: live(p) }).stdout;
    checkHandoff(text, (msg) => report(`owner-calls: ${msg}`));
    p = fresh((q) => setSettings(q, (s) => ({ ...s, mergeProtection: 'local-hook', autoMerge: false })));
    if (calls(p, ['--no-github']).out.groups.some((g) => g.name === 'switches')) report('owner-calls lists switches in a project that has set both');

    // Questions: an epic's open question, not its answers or its notes; the plan review's open items while the plan is made.
    p = fresh((q) => {
      const f = join(q, 'docs', 'epics', 'E2-release.md');
      writeFileSync(f, readFileSync(f, 'utf8').replace('## Open questions\n\nNone.', '## Open questions\n\n- Which installer format for macOS?\n- Answered (2026-11-10): Which icon? The tray one.\n- If the build fails, the owner runs /pitwall:decide CI/CD.\n- Should the tray icon\n  follow the dark mode?\n  - In both themes?'));
    });
    out = calls(p, ['--no-github']).out;
    if (JSON.stringify(items(out, 'questions')) !== JSON.stringify(['E2: Which installer format for macOS?', 'E2: Should the tray icon follow the dark mode? In both themes?'])) report(`owner-calls: questions ${JSON.stringify(items(out, 'questions'))}, expected the two open questions of E2, a wrapped and nested one whole`);
    const planning = join(dir, 'planning');
    makePlanRepo(join(dir, 'pl'), { spike: false });
    cpSync(join(dir, 'pl', 'repo'), planning, { recursive: true });
    const pr = join(planning, 'docs', 'PLAN-REVIEW.md');
    writeFileSync(pr, readFileSync(pr, 'utf8').replace('| 2 | Full-screen games hide it | should fix | R-1 |', '| 2 | Full-screen games hide it | should fix | open: a fallback |'));
    if (!items(runScript('owner-calls.mjs', ['--project', planning, '--json', '--no-github']).stdout ? JSON.parse(runScript('owner-calls.mjs', ['--project', planning, '--json', '--no-github']).stdout) : { groups: [] }, 'questions').some((q) => /^plan review: 2 \| Full-screen games hide it/.test(q))) report('owner-calls does not list an open item of the plan review while the plan is made');
    if (items(out, 'questions').some((q) => /^plan review/.test(q))) report('owner-calls lists the plan review once the plan is merged');

    // Bugs (T4b): the open ones, with what waits in the git directory over docs/BUGS.md, each with the default
    // of its severity; one filed without the owner's answer is a question; the work the loop set aside.
    const bugRow = (cells) => `| ${cells.join(' | ')} |`;
    p = fresh((q) => {
      const f = join(q, 'docs', 'BUGS.md');
      writeFileSync(f, [readFileSync(f, 'utf8').trimEnd(), bugRow(['BUG-1', 'No tray icon', 'QA', 'Open the app', 'A tray icon', 'Nothing', 'blocking', 'normal', 'open', '-']), bugRow(['BUG-2', 'Snooze is short', 'owner', 'Snooze', '10 minutes', '5', 'not blocking', 'low', 'fixed', '#4']), bugRow(['BUG-3', 'Count resets', 'QA', 'Lock the screen', 'The count stays', 'It resets', 'not blocking', 'low', 'in progress', '-']), ''].join('\n'));
      const filed = runScript('bugs.mjs', ['file', '--project', q], { input: 'title: Window behind\nfound in: production\nsteps: Open a game\nexpected: The reminder in front\nactual: Behind the game\nseverity: not blocking\nrisk: normal\nconfirmed: no\n' });
      if (filed.status !== 0) report(`bugs.mjs file: exit ${filed.status}\n${filed.stdout}${filed.stderr}`);
      writeFileSync(join(q, 'wip.txt'), 'half done\n');
      gitIn(q, 'stash', 'push', '-q', '-u', '-m', 'pitwall: E1-reminder before BUG-1', '--', 'wip.txt');
    });
    out = calls(p, ['--no-github']).out;
    const bugItems = out.groups.find((g) => g.name === 'bugs')?.items ?? [];
    if (JSON.stringify(bugItems.map((i) => i.what)) !== JSON.stringify(['BUG-1 (No tray icon): blocking, normal risk, open', 'BUG-3 (Count resets): not blocking, low risk, in progress'])) report(`owner-calls: bugs ${JSON.stringify(bugItems.map((i) => i.what))}, expected BUG-1 and BUG-3`);
    if (!/goes first/.test(bugItems[0]?.default) || !/until no epic is ready/.test(bugItems[1]?.default)) report(`owner-calls: the defaults of a blocking and a not blocking bug: ${JSON.stringify(bugItems.map((i) => i.default))}`);
    if (!items(out, 'questions').some((q) => /^BUG-4 \(Window behind\) was filed without your answer: .*now blocking and high, waiting in the git directory/.test(q))) report(`owner-calls does not ask about a bug nobody confirmed: ${JSON.stringify(items(out, 'questions'))}`);
    if (JSON.stringify(items(out, 'stashes')) !== JSON.stringify(['stash@{0}: the work of E1-reminder, set aside before BUG-1'])) report(`owner-calls: work set aside ${JSON.stringify(items(out, 'stashes'))}`);
    p = fresh((q) => {
      const f = join(q, 'docs', 'BUGS.md');
      writeFileSync(f, '# Bugs\n\n| ID | Found in | Steps | Expected | Actual | Status | Fix PR |\n| --- | --- | --- | --- | --- | --- | --- |\n| BUG-1 | QA | Open the app | A tray icon | Nothing | open | - |\n| BUG-2 | owner | Snooze | 10 minutes | 5 | fixed | #4 |\n');
    });
    out = calls(p, ['--no-github']).out;
    if (JSON.stringify(items(out, 'bugs')) !== JSON.stringify(['BUG-1 (Nothing): blocking, high risk, open']) || !out.notes.some((x) => /seven columns from before T4b/.test(x))) report(`owner-calls on a table from before T4b: ${JSON.stringify(out)}`);

    // Merges: a green PR waits for the owner when the epic is high risk, when it is a fix, or without the owner's yes to merges.
    // The template's stub gate passes on docs only, so the green PR's branch holds docs alone.
    p = fresh((q) => {
      setSettings(q, (s) => ({ ...s, autoMerge: true }));
      gitIn(q, 'switch', '-q', '-C', 'epic/E1-reminder', 'main');
      gitIn(q, 'commit', '-q', '--allow-empty', '-m', 'docs: E1');
    });
    greenPr(p, 'epic/E1-reminder');
    if (!items(calls(p).out, 'merges').length && !calls(p).out.notes.length) {
      setSettings(p, (s) => ({ ...s, autoMerge: false }));
      if (!items(calls(p).out, 'merges').length) report('owner-calls: the green PR of the test is not ready, so the cases below prove nothing');
      setSettings(p, (s) => ({ ...s, autoMerge: true }));
    }
    if (items(calls(p).out, 'merges').length !== 0) report(`owner-calls lists a green normal-risk PR the owner allowed to merge by itself: ${JSON.stringify(items(calls(p).out, 'merges'))}`);
    setSettings(p, (s) => ({ ...s, autoMerge: false }));
    if (!items(calls(p).out, 'merges').some((m) => /^PR #1 \(E1-reminder\) is ready.*you have not allowed merges without you/.test(m))) report(`owner-calls does not list a green PR that waits for the owner's yes: ${JSON.stringify(calls(p).out)}`);
    gitIn(p, 'switch', '-q', '-c', 'fix/BUG-1', 'main');
    gitIn(p, 'commit', '-q', '--allow-empty', '-m', 'fix: BUG-1');
    greenPr(p, 'fix/BUG-1');
    setSettings(p, (s) => ({ ...s, autoMerge: true }));
    if (!items(calls(p).out, 'merges').some((m) => /^PR #2 \(BUG-1\) is ready.*a bug fix/.test(m))) report(`owner-calls does not list a green fix PR: ${JSON.stringify(calls(p).out)}`);
    gitIn(p, 'switch', '-q', '-c', 'epic/E2-release', 'main');
    gitIn(p, 'commit', '-q', '--allow-empty', '-m', 'feat: E2');
    gitIn(p, 'push', '-q', 'origin', 'epic/E2-release');
    fake(p, 'pr', 'create', '--base', 'main', '--head', 'epic/E2-release', '--title', 'E2', '--body', 'x');
    if (items(calls(p).out, 'merges').some((m) => /E2-release/.test(m))) report('owner-calls lists a PR whose review is not done');
    // A class raised on the branch holds, as merge.mjs reads it (review round 1), though main still says normal.
    gitIn(p, 'switch', '-q', 'epic/E1-reminder');
    const plan = join(p, 'docs', 'EPICS.md');
    writeFileSync(plan, readFileSync(plan, 'utf8').replace('| The reminder | normal |', '| The reminder | high |'));
    gitIn(p, 'commit', '-qm', 'docs: E1 is high risk', '--', 'docs/EPICS.md');
    greenPr(p, 'epic/E1-reminder');
    gitIn(p, 'switch', '-q', 'main');
    if (!items(calls(p).out, 'merges').some((m) => /^PR #1 \(E1-reminder\) is ready.*\(high risk\)/.test(m))) report(`owner-calls misses a PR whose epic was raised to high on its branch: ${JSON.stringify(calls(p).out)}`);
    const unread = runScript('owner-calls.mjs', ['--project', p, '--json'], { env: { ...live(p), PITWALL_GH: JSON.stringify([join(dir, 'no-such-gh')]) } });
    if (!/GitHub could not be read/.test(unread.stdout)) report(`owner-calls with a gh that does not run must say GitHub was not read: ${unread.stdout}${unread.stderr}`);
    if (runScript('owner-calls.mjs', ['--project', dir]).status !== 2) report('owner-calls outside a pitwall project: expected exit 2');

    // The headless runs' snapshot (T4a-AC4): the same repository, main where it was, nothing left over.
    p = fresh();
    const gh = (...args) => spawnSync(process.execPath, [fakeGh, ...args], { cwd: p, env: live(p), encoding: 'utf8' });
    const g = (...args) => spawnSync('git', args, { cwd: p, encoding: 'utf8' });
    const repo = 'e2e/move-reminder';
    const snap = captureRemote(gh, g, repo);
    if (snap.id !== 'R_fakeRepositoryId' || !snap.main || !snap.branches.includes('epic/E1-reminder')) report(`captureRemote: ${JSON.stringify(snap)}`);
    if (JSON.stringify(restoreRemote(gh, g, repo, snap)) !== '[]') report('restoreRemote changed a repository that holds the snapshot');
    // Left over: a PR and its branch, and a branch alone.
    gitIn(p, 'switch', '-q', '-c', 'epic/E2-release', 'main');
    gitIn(p, 'commit', '-q', '--allow-empty', '-m', 'feat: E2');
    gitIn(p, 'push', '-q', 'origin', 'epic/E2-release', 'main:refs/heads/scratch');
    gh('pr', 'create', '--base', 'main', '--head', 'epic/E2-release', '--title', 'E2', '--body', 'x');
    const throws = (label, fn, pattern) => {
      try {
        fn();
        report(`${label}: expected the run to stop`);
      } catch (e) {
        if (!pattern.test(e.message)) report(`${label}: stopped with "${e.message}"`);
      }
    };
    // Another repository (a typo in --github): nothing is touched.
    throws('restore into another repository', () => restoreRemote(gh, g, repo, { ...snap, id: 'R_another' }), /is not the repository the snapshot was saved from.*changes nothing/);
    if (!g('ls-remote', '--heads', 'origin').stdout.includes('refs/heads/scratch') || json(gh('pr', 'view', 'epic/E2-release', '--json', 'state'))?.state !== 'OPEN') report('restore into another repository changed something');
    throws('restore from a snapshot without a remote state', () => restoreRemote(gh, g, repo, {}), /holds no remote snapshot/);
    // A gh that answers what it should not: the run stops.
    const failing = (...args) => (args[0] === 'pr' && args[1] === 'close' ? { status: 1, stdout: '', stderr: 'GraphQL: something unexpected' } : gh(...args));
    throws('restore when GitHub answers a close unexpectedly', () => restoreRemote(failing, g, repo, snap), /closing PR #1: GitHub answered 1.*stops/);
    const done = restoreRemote(gh, g, repo, snap);
    if (JSON.stringify(done) !== JSON.stringify(['closed PR #1 (epic/E2-release)', 'deleted the branch epic/E2-release', 'deleted the branch scratch'])) report(`restoreRemote: ${JSON.stringify(done)}`);
    if (/epic\/E2-release|scratch/.test(g('ls-remote', '--heads', 'origin').stdout) || json(gh('pr', 'view', '1', '--json', 'state'))?.state !== 'CLOSED') report('restoreRemote left a branch or a PR the snapshot does not hold');
    // A delete GitHub says it did but did not (review round 1): the restore reads the repository again and stops.
    gitIn(p, 'push', '-q', 'origin', 'main:refs/heads/scratch');
    const silent = (...args) => (args[0] === 'api' && args.includes('DELETE') ? { status: 0, stdout: '', stderr: '' } : gh(...args));
    throws('restore when a delete did nothing', () => restoreRemote(silent, g, repo, snap), /still differs from the snapshot \(branch scratch\)/);
    if (JSON.stringify(restoreRemote(gh, g, repo, snap)) !== JSON.stringify(['deleted the branch scratch'])) report('restoreRemote did not delete a branch left over');
    // main moved past the snapshot: stop.
    gitIn(p, 'switch', '-q', 'main');
    gitIn(p, 'commit', '-q', '--allow-empty', '-m', 'later');
    gitIn(p, 'push', '-q', 'origin', 'main');
    throws('restore after main moved', () => restoreRemote(gh, g, repo, snap), /main on e2e\/move-reminder moved past the snapshot/);
    // Let the fake CI finish before the folder goes (Windows keeps a folder a running process works in).
    for (const d of readdirSync(dir).filter((x) => x.endsWith('-gh'))) {
      for (let i = 0; i < 60; i += 1) {
        const ci = join(dir, d, 'ci');
        if (!existsSync(ci) || !readdirSync(ci).filter((f) => f.endsWith('.json')).some((f) => JSON.parse(readFileSync(join(ci, f), 'utf8')).status !== 'completed')) break;
        spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 1000)']);
      }
    }
  });
});

// 6n. T4b-AC1, AC2: bugs.mjs as the bug and lesson skills and the conductor use it, on a scratch project:
// rows wait in the git directory until a branch's first commit, numbers count every branch, a change to a
// bug whose row another branch holds takes that row along, a merge of main joins the rows cell by cell,
// and a table from before T4b gains its columns; then docs-check --stage bug and lesson on each kind of gap.
step('bugs and lessons', (report) => {
  scratch('pitwall-bugs-', (dir) => {
    const p = join(dir, 'p');
    if (layOut(p).status !== 0) return report('layout failed');
    gitIn(p, 'init', '-q', '-b', 'main');
    gitIn(p, 'add', '-A');
    gitIn(p, 'commit', '-qm', 'skeleton');
    const bugs = (args, input) => runScript('bugs.mjs', [...args, '--project', p], { input: input ?? '' });
    const expect = (label, r, code, says = []) => {
      const out = `${r.stdout}${r.stderr}`;
      if (r.status !== code) report(`bugs.mjs, ${label}: exit ${r.status}, expected ${code}\n${out}`);
      for (const w of says) if (!out.includes(w)) report(`bugs.mjs, ${label}: output lacks "${w}"\n${out}`);
      return out;
    };
    const bug = (fields = {}) => Object.entries({ title: 'No tray icon', 'found in': 'QA', steps: 'Open the app', expected: 'A tray icon', actual: 'Nothing', severity: 'blocking', risk: 'normal', confirmed: 'yes', ...fields }).filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n';
    const waiting = join(p, '.git', 'pitwall', 'bugs.md');
    const doc = (rel) => readFileSync(join(p, rel), 'utf8');
    const rowOf = (id) => doc('docs/BUGS.md').split('\n').find((l) => l.startsWith(`| ${id} |`)) ?? '';
    const listed = () => JSON.parse(bugs(['list', '--json', '--all']).stdout).bugs;

    // Filing: the next number, the row waits in the git directory and the work tree stays clean.
    expect('file a bug', bugs(['file'], bug()), 0, ['FILED: BUG-1 (No tray icon), blocking, normal']);
    if (!existsSync(waiting) || /BUG-1/.test(doc('docs/BUGS.md'))) report('bugs.mjs: a filed bug must wait in the git directory, not in docs/BUGS.md');
    if (gitIn(p, 'status', '--porcelain').stdout.trim()) report(`bugs.mjs: filing a bug changed the work tree: ${gitIn(p, 'status', '--porcelain').stdout}`);
    expect('an unconfirmed bug', bugs(['file'], bug({ title: 'Snooze is short', severity: 'not blocking', risk: 'low', confirmed: 'no' })), 0, ['FILED: BUG-2 (Snooze is short), blocking (unconfirmed), high (unconfirmed)']);
    expect('a cell with a pipe and a dollar sign', bugs(['file'], bug({ title: 'Pipes', actual: "a | b, and $r = 'x' ran" })), 0, ['FILED: BUG-3']);
    if (!readFileSync(waiting, 'utf8').includes("a \\| b, and $r = 'x' ran")) report('bugs.mjs: a pipe in a cell must be escaped, and the rest kept as written');
    expect('a field missing', bugs(['file'], bug({ steps: null })), 1, ['lacks steps']);
    expect('no bug on stdin', bugs(['file'], ''), 1, ['lacks title']);
    expect('a severity of its own', bugs(['file'], bug({ severity: 'critical' })), 1, ['severity "critical" is not one of blocking, not blocking']);
    expect('a class of its own', bugs(['file'], bug({ risk: 'medium' })), 1, ['risk "medium" is not one of low, normal, high']);
    expect('a place of its own', bugs(['file'], bug({ 'found in': 'lab' })), 1, ['found in "lab" is not one of']);
    expect('a title too long', bugs(['file'], bug({ title: 'x'.repeat(61) })), 1, ['at most 60']);
    expect('a line before any field', bugs(['file'], `and more\n${bug()}`), 1, ['names no field']);
    expect('confirmed left out', bugs(['file'], bug({ confirmed: null })), 1, ['lacks confirmed']);

    // Changes: an unconfirmed bug is confirmed by both at once; the owner's no makes a risk.
    expect('half a confirmation', bugs(['set', 'BUG-2', '--severity', 'not blocking']), 1, ['give both its severity and its class']);
    expect('a confirmation', bugs(['set', 'BUG-2', '--severity', 'not blocking', '--risk', 'low']), 0, ['SET: BUG-2 severity, risk']);
    const two = listed().find((b) => b.id === 'BUG-2');
    if (two?.unconfirmed !== false || two?.severity !== 'not blocking' || two?.risk !== 'low') report(`bugs.mjs: BUG-2 after its confirmation: ${JSON.stringify(two)}`);
    expect('a bug that does not exist', bugs(['set', 'BUG-9', '--risk', 'high']), 1, ['BUG-9 is not a bug']);
    expect('acceptance through set', bugs(['set', 'BUG-1', '--status', 'accepted']), 1, ['becomes a risk']);
    expect('a fix PR that is no number', bugs(['set', 'BUG-1', '--fix-pr', '12']), 1, ['is not a PR number']);
    expect('the owner says no to a fix', bugs(['accept', 'BUG-3', '--fallback', 'Live with it']), 0, ['ACCEPTED: BUG-3 becomes R-1']);
    expect('a lesson', bugs(['lesson'], 'rule: Never x\nwhy: BUG-1\nchecked by: Not by a tool until BUG-1\n'), 0, ['RECORDED: L-1']);
    expect('a lesson without what checks it', bugs(['lesson'], 'rule: Never y\nwhy: BUG-1\n'), 1, ['lacks checked by']);
    expect('what waits never lands on main', bugs(['flush']), 1, ['protected']);
    expect('nor a lesson in the tree of main', bugs(['lesson', '--tree'], 'rule: r\nwhy: w\nchecked by: c\n'), 1, ['protected']);

    // The first commit of the next branch takes everything that waits; the docs check passes on it.
    gitIn(p, 'switch', '-qc', 'fix/BUG-1');
    expect('flush', bugs(['flush']), 0, ['BUG-1 (new)', 'BUG-2 (new)', 'BUG-3 (new)', 'R-1 into docs/RISKS.md', 'L-1 into docs/LESSONS.md']);
    if (existsSync(waiting)) report('bugs.mjs flush left the rows waiting');
    if (!rowOf('BUG-3').includes('accepted (R-1)') || !/\| R-1 \| BUG-3 \(Pipes\), not fixed: /.test(doc('docs/RISKS.md'))) report(`bugs.mjs: the accepted bug and its risk: ${rowOf('BUG-3')}`);
    let dc = docsCheck(p, ['--stage', 'bug,lesson']);
    if (dc.status !== 0) report(`docs-check --stage bug,lesson after a flush:\n${dc.stdout}`);
    gitIn(p, 'commit', '-qam', 'docs: start BUG-1');
    expect("the conductor's own status", bugs(['set', 'BUG-1', '--status', 'in progress', '--tree']), 0, ['SET: BUG-1 status in docs/BUGS.md']);
    if (!rowOf('BUG-1').includes('| in progress |')) report(`bugs.mjs set --tree: ${rowOf('BUG-1')}`);
    gitIn(p, 'commit', '-qam', 'docs: BUG-1 in progress');

    // On main again: the row of BUG-2 is on fix/BUG-1 only. The owner raises its class; the next number counts that branch.
    gitIn(p, 'switch', '-q', 'main');
    expect('a change to a bug whose row another branch holds', bugs(['set', 'BUG-2', '--risk', 'high']), 0, ['SET: BUG-2 risk']);
    if (listed().find((b) => b.id === 'BUG-2')?.risk !== 'high') report(`bugs.mjs list: BUG-2 raised, as seen from main: ${JSON.stringify(listed())}`);
    expect('the next number counts every branch', bugs(['file'], bug({ title: 'Fourth' })), 0, ['FILED: BUG-4']);
    gitIn(p, 'switch', '-qc', 'epic/E1-x');
    expect('flush takes the row from the branch that holds it', bugs(['flush']), 0, ['BUG-2 (its row from fix/BUG-1, with risk)', 'BUG-4 (new)']);
    if (!/\| BUG-2 \| Snooze is short \|.*\| not blocking \| high \| open \|/.test(rowOf('BUG-2'))) report(`bugs.mjs flush: BUG-2 taken along: ${rowOf('BUG-2')}`);
    gitIn(p, 'commit', '-qam', 'docs: start E1-x');

    // The fix merges first; the epic then merges main, and resolve joins the rows cell by cell.
    gitIn(p, 'switch', '-q', 'fix/BUG-1');
    bugs(['set', 'BUG-1', '--status', 'in review', '--tree']);
    gitIn(p, 'commit', '-qam', 'docs: BUG-1 in review');
    gitIn(p, 'switch', '-q', 'main');
    gitIn(p, 'merge', '-q', '--no-ff', 'fix/BUG-1', '-m', 'fix(BUG-1): no tray icon (#2)');
    gitIn(p, 'switch', '-q', 'epic/E1-x');
    if (gitIn(p, 'merge', '--no-edit', 'main').status === 0) report('bugs.mjs resolve: the merge of main did not stop on docs/BUGS.md, so the case below proves nothing');
    expect('resolve', bugs(['resolve']), 0, ['RESOLVED: docs/BUGS.md']);
    const joined = ['BUG-1', 'BUG-2', 'BUG-3', 'BUG-4'].map(rowOf);
    if (!joined[0].includes('| in review |') || !joined[1].includes('| high |') || !joined[2].includes('accepted (R-1)') || !joined[3].includes('| Fourth |')) report(`bugs.mjs resolve: ${JSON.stringify(joined)}`);
    gitIn(p, 'commit', '-q', '--no-edit');
    dc = docsCheck(p, ['--stage', 'bug,lesson']);
    if (dc.status !== 0) report(`docs-check --stage bug,lesson after resolve:\n${dc.stdout}`);
    expect('resolve with no merge', bugs(['resolve']), 1, ['no merge is in progress']);

    // A table from before T4b: it reads, blocking and high; the first flush gives it the new columns.
    const old = join(dir, 'old');
    if (layOut(old).status !== 0) return report('layout failed');
    writeFileSync(join(old, 'docs', 'BUGS.md'), '# Bugs\n\n| ID | Found in | Steps | Expected | Actual | Status | Fix PR |\n| --- | --- | --- | --- | --- | --- | --- |\n| BUG-1 | QA | Open the app | A tray icon | Nothing | open | - |\n| BUG-2 | owner | Snooze | 10 minutes | 5 | fixed | #4 |\n');
    gitIn(old, 'init', '-q', '-b', 'main');
    gitIn(old, 'add', '-A');
    gitIn(old, 'commit', '-qm', 'an older layout');
    dc = docsCheck(old, ['--stage', 'bug']);
    if (dc.status !== 0) report(`docs-check --stage bug on a table from before T4b:\n${dc.stdout}`);
    const oldList = JSON.parse(runScript('bugs.mjs', ['list', '--json', '--project', old]).stdout);
    if (!oldList.old || JSON.stringify(oldList.bugs.map((b) => [b.id, b.severity, b.risk])) !== JSON.stringify([['BUG-1', 'blocking', 'high']])) report(`bugs.mjs list on a table from before T4b: ${JSON.stringify(oldList)}`);
    gitIn(old, 'switch', '-qc', 'epic/E1-x');
    const migrated = runScript('bugs.mjs', ['flush', '--project', old]);
    if (migrated.status !== 0 || !/gains the columns Title, Severity, Risk/.test(migrated.stdout)) report(`bugs.mjs flush on a table from before T4b: exit ${migrated.status}\n${migrated.stdout}${migrated.stderr}`);
    if (!readFileSync(join(old, 'docs', 'BUGS.md'), 'utf8').includes('| BUG-1 | Nothing | QA | Open the app | A tray icon | Nothing | blocking | high | open | - |')) report(`bugs.mjs flush: the migrated table\n${readFileSync(join(old, 'docs', 'BUGS.md'), 'utf8')}`);
    dc = docsCheck(old, ['--stage', 'bug']);
    if (dc.status !== 0) report(`docs-check --stage bug on the migrated table:\n${dc.stdout}`);

    // docs-check --stage bug and lesson on each kind of gap.
    const base = join(dir, 'gaps');
    if (layOut(base).status !== 0) return report('layout failed');
    let n = 0;
    const gap = (label, stage, rel, rows, says) => {
      const c = join(dir, `g${(n += 1)}`);
      cpSync(base, c, { recursive: true });
      writeFileSync(join(c, rel), `${readFileSync(join(c, rel), 'utf8').trimEnd()}\n${rows.join('\n')}\n`);
      const r = docsCheck(c, ['--stage', stage]);
      const missing = says.filter((w) => !r.stdout.includes(w));
      if ((says.length ? r.status !== 1 : r.status !== 0) || missing.length) report(`docs-check --stage ${stage}, ${label}: exit ${r.status}${missing.length ? `, lacks "${missing.join('", "')}"` : ''}\n${r.stdout}`);
    };
    const B = (cells) => `| ${cells.join(' | ')} |`;
    const ok = ['BUG-1', 'No tray icon', 'QA', 'Open the app', 'A tray icon', 'Nothing', 'blocking', 'normal', 'open', '-'];
    const with_ = (i, v) => ok.map((x, j) => (j === i ? v : x));
    gap('a good row', 'bug', 'docs/BUGS.md', [B(ok), B(with_(0, 'BUG-2').map((x, j) => (j === 6 ? 'blocking (unconfirmed)' : j === 7 ? 'high (unconfirmed)' : x)))], []);
    gap('a severity of its own', 'bug', 'docs/BUGS.md', [B(with_(6, 'critical'))], ['severity "critical" is not one of blocking, not blocking']);
    gap('a class of its own', 'bug', 'docs/BUGS.md', [B(with_(7, 'medium'))], ['risk "medium" is not one of low, normal, high']);
    gap('one of the two marked unconfirmed', 'bug', 'docs/BUGS.md', [B(with_(6, 'blocking (unconfirmed)'))], ['a bug the owner has not confirmed is "blocking (unconfirmed)" and "high (unconfirmed)"']);
    gap('unconfirmed but not blocking and high', 'bug', 'docs/BUGS.md', [B(with_(6, 'not blocking (unconfirmed)').map((x, j) => (j === 7 ? 'high (unconfirmed)' : x)))], ['a bug the owner has not confirmed']);
    gap('no title', 'bug', 'docs/BUGS.md', [B(with_(1, ''))], ['BUG-1: has no title']);
    gap('a place of its own', 'bug', 'docs/BUGS.md', [B(with_(2, 'lab'))], ['found in "lab"']);
    gap('no steps', 'bug', 'docs/BUGS.md', [B(with_(3, ''))], ['says nothing under "Steps"']);
    gap('fixed with no PR', 'bug', 'docs/BUGS.md', [B(with_(8, 'fixed'))], ['is fixed, and names no fix PR']);
    gap('accepted as a risk nobody accepted', 'bug', 'docs/BUGS.md', [B(with_(8, 'accepted (R-9)'))], ['is accepted as R-9, which is not a risk the owner accepted']);
    gap('a status of its own', 'bug', 'docs/BUGS.md', [B(with_(8, 'done'))], ['status "done" is not one of']);
    gap('the same bug twice', 'bug', 'docs/BUGS.md', [B(ok), B(ok)], ['BUG-1 is in the table twice']);
    gap('a lesson the way the skill records it', 'lesson', 'docs/LESSONS.md', ['| L-1 | Never x | A review finding | 2026-11-11 | Not by a tool until the check is built |'], []);
    gap('a lesson nothing checks', 'lesson', 'docs/LESSONS.md', ['| L-1 | Never x | A finding | 2026-11-11 |  |'], ['says nothing under "Checked by"']);
    gap('a lesson checked by a dash', 'lesson', 'docs/LESSONS.md', ['| L-1 | Never x | A finding | 2026-11-11 | - |'], ['says nothing under "Checked by"']);
    gap('a lesson with no date', 'lesson', 'docs/LESSONS.md', ['| L-1 | Never x | A finding | soon | a test |'], ['date "soon" is not a date']);
    gap('a lesson with no rule', 'lesson', 'docs/LESSONS.md', ['| L-1 |  | A finding | 2026-11-11 | a test |'], ['L-1: states no rule']);
    const cols = join(dir, 'cols');
    cpSync(base, cols, { recursive: true });
    writeFileSync(join(cols, 'docs', 'BUGS.md'), readFileSync(join(cols, 'docs', 'BUGS.md'), 'utf8').replace('| Severity | Risk |', '| Priority | Risk |'));
    if (!/must keep the template's columns/.test(docsCheck(cols, ['--stage', 'bug']).stdout)) report('docs-check --stage bug does not refuse a table whose columns changed');
  });
});

// 6l. T3b-AC7: the fake GitHub of the headless loop runs (scripts/fake-github.mjs) answers like GitHub,
// as `node scripts/e2e.mjs --github <owner/repo>` recorded GitHub's answers in scripts/github-responses/:
// every field the fake gives, GitHub gave with the same type, and its refusals read the same.
// The kinds a run of the loop makes; a recording of others (pr-list as JSON, a commit) is compared too.
const GITHUB_KINDS = ['repo-view', 'pr-create', 'pr-list-text', 'pr-view', 'pr-checks', 'pr-comment', 'pr-merge', 'run-list', 'api-status-post', 'api-statuses', 'api-check-runs', 'api-rules', 'api-protection', 'api-branch'];
step('fake GitHub against GitHub\'s answers', (report) => {
  const recDir = join(root, 'scripts', 'github-responses');
  const recs = Object.fromEntries((existsSync(recDir) ? readdirSync(recDir).filter((f) => f.endsWith('.json')) : []).map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(recDir, f), 'utf8'))]));
  // The recordings came from the owner's private repository into a public one: no node id may stay, since
  // GitHub's encode the repository's numeric id, and no numeric id of a repository or an account.
  for (const [k, r] of Object.entries(recs)) {
    const text = JSON.stringify(r);
    for (const m of text.matchAll(/"(\w*node_id|id)":"([^"]*)"/g)) if (!/^<\w+>$/.test(m[2])) report(`${k}: ${m[1]} "${m[2]}" is GitHub's own and names the repository: e2e-loop.mjs scrubs it`);
    if (/"(owner|repository|repo|creator|author|committer|user)":\{[^{}]*"id":[1-9]/.test(text)) report(`${k}: an account's or a repository's numeric id is in the recording`);
  }
  const missing = GITHUB_KINDS.filter((k) => !recs[k]);
  if (missing.length) return report(`no recorded answer of GitHub for ${missing.join(', ')}: run node scripts/e2e.mjs --from e0 --github <owner/repo> against an empty private repository`);
  // The type of every field, by its path; the items of a list as "[]".
  const shape = (v, at = '', out = new Map()) => {
    const t = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
    out.set(at || '.', t);
    if (t === 'array') for (const x of v) shape(x, `${at}[]`, out);
    if (t === 'object') for (const [k, x] of Object.entries(v)) shape(x, `${at}.${k}`, out);
    return out;
  };
  scratch('pitwall-fake-github-', (dir) => {
    const origin = join(dir, 'origin.git');
    const state = join(dir, 'state');
    gitIn(dir, 'init', '-q', '--bare', origin);
    const p = join(dir, 'p');
    if (layOut(p).status !== 0) return report('layout failed');
    gitIn(p, 'init', '-q', '-b', 'main');
    gitIn(p, 'add', '-A');
    gitIn(p, 'commit', '-qm', 'skeleton');
    gitIn(p, 'remote', 'add', 'origin', origin);
    gitIn(p, 'switch', '-qc', 'epic/E0-skeleton');
    gitIn(p, 'commit', '-q', '--allow-empty', '-m', 'docs: start E0-skeleton');
    gitIn(p, 'push', '-q', 'origin', 'main', 'epic/E0-skeleton');
    const head = gitIn(p, 'rev-parse', 'HEAD').stdout.trim();
    const env = { ...process.env, ...identity, FAKE_GH_LIVE: state, FAKE_GH_ORIGIN: origin, FAKE_GH_REPO: 'e2e/move-reminder' };
    const fake = (...args) => spawnSync(process.execPath, [fakeGh, ...args], { cwd: p, env, encoding: 'utf8' });
    const json = (r) => {
      try {
        return JSON.parse(r.stdout);
      } catch {
        return undefined;
      }
    };
    const fieldsOf = (k) => recs[k].args[recs[k].args.indexOf('--json') + 1];
    const repo = 'repos/e2e/move-reminder';
    const answers = {};
    // The same requests the recorded run made, in the same states: a PR whose review asked for changes when
    // its checks were read (so gh exits 1), then approved, merged, and main read afterwards.
    answers['repo-view'] = fake('repo', 'view', '--json', fieldsOf('repo-view'));
    answers['pr-list-text'] = fake('pr', 'list', '--head', 'epic/E0-skeleton', '--state', 'open');
    answers['pr-create'] = fake('pr', 'create', '--base', 'main', '--head', 'epic/E0-skeleton', '--title', 'E0 - Walking skeleton', '--body', 'x');
    if (recs['pr-list']) answers['pr-list'] = fake('pr', 'list', '--head', 'epic/E0-skeleton', '--state', 'open', '--json', fieldsOf('pr-list'));
    answers['pr-view'] = fake('pr', 'view', 'epic/E0-skeleton', '--json', fieldsOf('pr-view'));
    answers['api-status-post'] = fake('api', '-X', 'POST', `${repo}/statuses/${head}`, '-f', 'state=failure', '-f', 'context=ai-review', '-f', 'description=code review: 3 open');
    answers['api-statuses'] = fake('api', `${repo}/commits/${head}/statuses`);
    // The CI runs the template's gate in the background: wait for it, at most a minute.
    let runs;
    for (let i = 0; i < 60; i += 1) {
      runs = fake('api', `${repo}/commits/${head}/check-runs`);
      if (json(runs)?.check_runs?.[0]?.status === 'completed') break;
      spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 1000)']);
    }
    answers['api-check-runs'] = runs;
    if (json(runs)?.check_runs?.[0]?.conclusion !== 'success') report(`the fake CI did not pass the template's gate on a docs-only commit: ${runs.stdout}`);
    answers['pr-checks'] = fake('pr', 'checks', '1');
    fake('api', '-X', 'POST', `${repo}/statuses/${head}`, '-f', 'state=success', '-f', 'context=ai-review', '-f', 'description=code review: approved');
    answers['pr-comment'] = fake('pr', 'comment', '1', '--body', 'pitwall numbers: implementers 1');
    if (recs['api-commit']) answers['api-commit'] = fake('api', `${repo}/commits/${head}`);
    answers['api-rules'] = fake('api', `${repo}/rules/branches/main`);
    answers['api-protection'] = fake('api', `${repo}/branches/main/protection`);
    answers['pr-merge'] = fake('pr', 'merge', '1', '--merge', '--match-head-commit', head, '--subject', 'feat(E0): Walking skeleton (#1)', '--body', 'Risk class: normal.');
    answers['api-branch'] = fake('api', `${repo}/branches/main`);
    answers['run-list'] = fake('run', 'list', '--branch', 'main', '--limit', '1', '--json', fieldsOf('run-list'));
    // Reading main's runs started the CI on the merge commit in the background: let it finish, so the
    // scratch folder can go (Windows keeps a folder a running process works in).
    for (let i = 0; i < 90; i += 1) {
      const pendingRuns = readdirSync(join(state, 'ci')).filter((f) => f.endsWith('.json')).some((f) => JSON.parse(readFileSync(join(state, 'ci', f), 'utf8')).status !== 'completed');
      if (!pendingRuns) break;
      spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 1000)']);
    }
    // A text answer, as gh prints it without a terminal: the same form, line by line.
    const TEXT = {
      'pr-create': (t) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+\n$/.test(t),
      'pr-comment': (t) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+#issuecomment-\d+\n$/.test(t),
      'pr-merge': (t) => t === '',
      'pr-list-text': (t) => t === '' || t.split('\n').filter(Boolean).every((l) => /^\d+\t/.test(l)),
      // name, state, elapsed, link, description; one line per check, ai-review and gate among them.
      'pr-checks': (t) => {
        const rows = t.split('\n').filter(Boolean).map((l) => l.split('\t'));
        return rows.every((r) => r.length === 5 && /^(pass|fail|pending|skipping)$/.test(r[1])) && ['ai-review', 'gate'].every((n) => rows.some((r) => r[0] === n));
      },
    };
    for (const kind of Object.keys(answers)) {
      const rec = recs[kind];
      const got = answers[kind];
      if (!rec) continue;
      if ((got.status === 0) !== (rec.status === 0)) report(`${kind}: the fake exits ${got.status}, GitHub exited ${rec.status}\n${got.stdout}${got.stderr}`);
      if (TEXT[kind]) {
        if (!TEXT[kind](String(rec.stdout))) report(`${kind}: GitHub's recorded answer no longer has the form the check expects: ${JSON.stringify(rec.stdout)}`);
        if (!TEXT[kind](got.stdout)) report(`${kind}: the fake prints ${JSON.stringify(got.stdout)}, and GitHub printed ${JSON.stringify(rec.stdout)}`);
        continue;
      }
      if (rec.status !== 0) {
        // A refusal reads the same: its last line names the same reason.
        const reason = (x) => String(x).replace(/\(HTTP \d+\)/, '').replace(/^gh: /, '').trim();
        if (!reason(got.stderr.trim().split('\n').pop()).startsWith(reason(rec.stderr).slice(0, 40))) report(`${kind}: the fake refuses with "${got.stderr.trim()}", GitHub with "${rec.stderr}"`);
        continue;
      }
      const real = typeof rec.stdout === 'string' ? undefined : rec.stdout;
      const mine = json(got);
      if (real === undefined || mine === undefined) {
        report(`${kind}: GitHub answered ${real === undefined ? 'text' : 'JSON'}, the fake "${got.stdout.slice(0, 200)}"`);
        continue;
      }
      const theirs = shape(real);
      for (const [path, type] of shape(mine)) {
        if (!theirs.has(path)) report(`${kind}: the fake gives ${path}, which GitHub's answer does not hold`);
        else if (type !== theirs.get(path) && type !== 'null' && theirs.get(path) !== 'null') report(`${kind}: ${path} is ${type} in the fake and ${theirs.get(path)} on GitHub`);
      }
    }
  });
});

// 6f. T1-AC2, T2-AC6: protect.mjs against the fake gh. It checks before it writes (L-5), writes the
// protection ADR-0005 and ADR-0008 ask for, hands over instead of failing, and a dry run writes nothing.
step('merge protection (fake gh)', (report) => {
  scratch('pitwall-protect-', (dir) => {
    const cfg = JSON.parse(readFileSync(join(plugin, 'config', 'defaults.json'), 'utf8'));
    const expectedBody = {
      required_status_checks: { strict: cfg.mergeProtection.strict, checks: [{ context: cfg.review.gateContext, app_id: cfg.mergeProtection.githubActionsAppId }, { context: cfg.review.statusContext, app_id: -1 }] },
      enforce_admins: cfg.mergeProtection.enforceAdmins,
      required_pull_request_reviews: null,
      restrictions: null,
      required_linear_history: false,
    };
    // ADR-0005 in plain values, so a config edit cannot quietly weaken it.
    if (expectedBody.enforce_admins !== true || cfg.review.gateContext !== 'gate' || cfg.review.statusContext !== 'ai-review' || cfg.mergeProtection.githubActionsAppId !== 15368) {
      report('config/defaults.json no longer asks for gate (GitHub Actions) and ai-review with admins included (ADR-0005)');
    }
    const repo = (visibility, viewerPermission = 'ADMIN') => ({ nameWithOwner: 'o/r', visibility, viewerPermission });
    const ok = { auth: true, repo: repo('PUBLIC'), branch: true, probe: '404', put: 'ok' };
    let n = 0;
    const run = (label, scenario, { args = [], gh, code, result, puts, setting, says = [], before = 'pending', raw, remote }) => {
      const project = join(dir, `p${(n += 1)}`);
      mkdirSync(join(project, '.claude'), { recursive: true });
      if (remote) {
        gitIn(project, 'init', '-q');
        gitIn(project, 'remote', 'add', 'origin', `https://github.com/${remote}.git`);
      }
      if (raw !== undefined) writeFileSync(join(project, '.claude', 'pitwall.json'), raw);
      else if (before) writeFileSync(join(project, '.claude', 'pitwall.json'), JSON.stringify({ templateVersion: '0.0.0', processLevel: 'lite', mergeProtection: before }));
      const { r, calls } = withFakeGh('protect.mjs', project, scenario, ['--project', project, ...args], gh ? { PITWALL_GH: JSON.stringify(gh) } : {});
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
      checkHandoff(r.stdout, fail);
      // A handed-over command must build the same body, by gh's own rules for -F fields (L-6).
      const handed = /gh api -X PUT repos\/o\/r\/branches\/main\/protection((?: -F "[^"]+")+)/.exec(r.stdout);
      if (handed) {
        const built = ghFields([...handed[1].matchAll(/-F "([^"]+)"/g)].map((m) => m[1]));
        if (JSON.stringify(built) !== JSON.stringify(expectedBody)) fail(`the handed-over command writes ${JSON.stringify(built)}`);
      }
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
    const otherProtection = { required_status_checks: { checks: [{ context: 'build', app_id: 1 }] }, enforce_admins: { enabled: false } };
    run('public', ok, { code: 0, result: 'branch-protection', puts: 1, setting: 'branch-protection' });
    run('private, paid plan', { ...ok, repo: repo('PRIVATE') }, { code: 0, result: 'branch-protection', puts: 1, setting: 'branch-protection' });
    run('dry run', ok, { args: ['--dry-run'], code: 0, result: 'branch-protection (dry run', puts: 0, setting: 'pending', says: ['"enforce_admins": true', '"required_linear_history": false', 'would run gh api -X PUT'] });
    run('private, GitHub Free', { ...ok, repo: repo('PRIVATE'), probe: 'free' }, { code: 0, result: 'local-hook', puts: 0, setting: 'local-hook' });
    run('dry run, GitHub Free', { ...ok, repo: repo('PRIVATE'), probe: 'free' }, { args: ['--dry-run'], code: 0, result: 'local-hook', puts: 0, setting: 'pending' });
    run('already protected', { ...ok, protection: protectedOk }, { code: 0, result: 'branch-protection', puts: 0, setting: 'branch-protection' });
    run('not admin, already protected', { ...ok, repo: repo('PUBLIC', 'WRITE'), protection: protectedOk }, { code: 0, result: 'branch-protection', puts: 0, setting: 'branch-protection' });
    run('protected otherwise', { ...ok, protection: otherProtection }, { code: 3, result: 'pending', puts: 0, setting: 'pending', says: ['HANDOFF'] });
    run('admins excluded', { ...ok, protection: { ...protectedOk, enforce_admins: { enabled: false } } }, { code: 3, result: 'pending', puts: 0, setting: 'pending', says: ['other settings'] });
    const notAdmin = run('not admin', { ...ok, repo: repo('PUBLIC', 'WRITE') }, { code: 3, result: 'pending', puts: 0, setting: 'pending', says: ['HANDOFF', 'needs an admin'] });
    if (!notAdmin.handed) report('not admin: no ready command handed over');
    if (notAdmin.calls.some((c) => c.args.some((a) => a.endsWith('/protection')))) report('not admin: probed the protection API before checking the permission');
    const refused = run('write refused', { ...ok, put: 'refuse' }, { code: 3, result: 'pending', puts: 1, setting: 'pending', says: ['HANDOFF', 'GitHub refused the write'] });
    if (!refused.handed) report('write refused: no ready command handed over');
    run('write not read back', { ...ok, put: 'lost' }, { code: 3, result: 'pending', puts: 1, setting: 'pending', says: ['reading it back'] });
    run('probe refused', { ...ok, probe: 'denied' }, { code: 3, result: 'pending', puts: 0, setting: 'pending', says: ['HANDOFF'] });
    run('not signed in', { ...ok, auth: false }, { code: 3, result: 'pending', puts: 0, setting: 'pending', says: ['  Run this yourself, in bash or PowerShell:\n    gh auth login\n'] });
    run('recorded mode kept', { ...ok, auth: false }, { before: 'branch-protection', code: 3, result: 'pending', puts: 0, setting: 'branch-protection', says: ['kept the recorded mode'] });
    run('no repository', { ...ok, repo: null }, { code: 3, result: 'pending', puts: 0, setting: 'pending', says: ['    gh repo create --private --source . --remote origin\n', '    git push -u origin main\n'] });
    run('branch not pushed', { ...ok, branch: false }, { code: 3, result: 'pending', puts: 0, setting: 'pending', says: ['    git push -u origin main\n'] });
    run('no gh', ok, { gh: [join(dir, 'no-such-gh')], code: 3, result: 'pending', puts: 0, setting: 'pending', says: ['cli.github.com'] });
    run('no settings file', ok, { before: null, code: 0, result: 'branch-protection', puts: 1, setting: null, says: ['not recorded'] });
    const named = run('--repo', { ...ok }, { args: ['--repo', 'o/r'], remote: 'o/r', code: 0, result: 'branch-protection', puts: 1, setting: 'branch-protection' });
    if (!named.calls.some((c) => c.args[0] === 'repo' && c.args.includes('o/r'))) report('--repo: the repository was not passed to gh repo view');
    run('recorded mode dropped on weaker protection', { ...ok, protection: { ...protectedOk, enforce_admins: { enabled: false } } }, { before: 'branch-protection', code: 3, result: 'pending', puts: 0, setting: 'pending' });
    run('repository not readable', { ...ok, repo: null }, { args: ['--repo', 'o/r'], remote: 'o/r', code: 3, result: 'pending', puts: 0, setting: 'pending', says: ['gh could not read the repository'] });
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
    run('summary not JSON, probe shows the protection', { ...ok, branch: 'garbled', protection: protectedOk }, { code: 0, result: 'branch-protection', puts: 0, setting: 'branch-protection' });
    // T2-AC6 (a): a branch summary that shows protection no longer proves that branch protection is available.
    run('recorded local-hook, private, not admin, protection visible', { ...ok, repo: repo('PRIVATE', 'WRITE'), protection: otherProtection }, { before: 'local-hook', code: 3, result: 'pending', puts: 0, setting: 'local-hook', says: ['kept the recorded mode'] });
    run('recorded local-hook, protection available', { ...ok, protection: otherProtection }, { before: 'local-hook', code: 3, result: 'pending', puts: 0, setting: 'pending' });
    // T2-AC6 (d): a refused probe while other protection is visible.
    run('probe refused, other protection visible', { ...ok, probe: 'denied', protection: otherProtection }, { code: 3, result: 'pending', puts: 0, setting: 'pending', says: ['could not read the branch protection'] });
    run('probe refused, other protection visible, private, recorded local-hook', { ...ok, repo: repo('PRIVATE'), probe: 'denied', protection: otherProtection }, { before: 'local-hook', code: 3, result: 'pending', puts: 0, setting: 'local-hook', says: ['kept the recorded mode'] });
    // T2 review: linear history, which the summary cannot show, counts as other settings for an admin.
    run('admin, protected but linear history required', { ...ok, protection: { ...protectedOk, required_linear_history: { enabled: true } } }, { before: 'branch-protection', code: 3, result: 'pending', puts: 0, setting: 'pending', says: ['other settings'] });
    run('not admin, protected with linear history the summary hides', { ...ok, repo: repo('PUBLIC', 'WRITE'), protection: { ...protectedOk, required_linear_history: { enabled: true } } }, { code: 0, result: 'branch-protection', puts: 0, setting: 'branch-protection' });
    run('admin, summary satisfies, probe refused', { ...ok, probe: 'denied', protection: protectedOk }, { before: 'branch-protection', code: 3, result: 'pending', puts: 0, setting: 'branch-protection', says: ['kept the recorded mode'] });
    run('bad flag', ok, { args: ['--force'], code: 2, puts: 0, setting: 'pending' });
    // T3a (owner): no flag sets the mode, so an agent cannot use protect.mjs to weaken it. The mode comes only
    // from what GitHub answers for the project's own repository; --repo names one of its remotes or is refused.
    for (const args of [['--mode', 'branch-protection'], ['--mode=branch-protection'], ['--merge-protection', 'branch-protection'], ['--branch-protection'], ['--local-hook'], ['--pending']]) {
      run(`a flag that would set the mode: ${args.join(' ')}`, { ...ok, repo: repo('PRIVATE'), probe: 'free' }, { args, before: 'local-hook', code: 2, puts: 0, setting: 'local-hook' });
    }
    run('--repo naming another repository', ok, { args: ['--repo', 'other/public-repo'], remote: 'o/r', before: 'local-hook', code: 2, puts: 0, setting: 'local-hook' });
    run('--repo with no remote at all', ok, { args: ['--repo', 'o/r'], before: 'local-hook', code: 2, puts: 0, setting: 'local-hook' });
    run('--repo naming the upstream of a fork', { ...ok, repo: repo('PRIVATE'), probe: 'free' }, { args: ['--repo', 'o/r'], remote: 'o/r', code: 0, result: 'local-hook', puts: 0, setting: 'local-hook' });
    // On a private repository on GitHub Free, no flag the script takes records branch-protection, the mode in which the merge guard steps aside.
    for (const args of [[], ['--dry-run'], ['--repo', 'o/r'], ['--repo', 'o/r', '--dry-run']]) {
      const r = run(`GitHub Free with ${args.join(' ') || 'no flags'}`, { ...ok, repo: repo('PRIVATE'), probe: 'free' }, { args, remote: 'o/r', code: 0, result: 'local-hook', puts: 0, setting: args.includes('--dry-run') ? 'pending' : 'local-hook' });
      if (/RESULT: branch-protection/.test(r.r.stdout)) report(`GitHub Free with ${args.join(' ')}: recorded branch-protection`);
    }
  });
});

// 6i. T3a-AC1 to AC8: the hooks, run as Claude Code runs them, on the payloads it gave them in a
// real session (scripts/hook-payloads/, from `node scripts/e2e.mjs --hooks --record`), with the
// tool input of each case put in. The payloads must come from the pinned CLI: their fields
// belong to Claude Code (ADR-0007).
const payloadDir = join(root, 'scripts', 'hook-payloads');
const PAYLOADS = [
  'main-session-start', 'main-pre-tool-use-bash', 'main-pre-tool-use-read', 'main-pre-tool-use-write', 'main-pre-tool-use-edit', 'main-pre-tool-use-agent', 'main-post-tool-use-write', 'main-stop',
  'plan-reviewer-pre-tool-use-read', 'plan-reviewer-pre-tool-use-subagenthandback', 'plan-reviewer-subagent-stop',
  'researcher-pre-tool-use-glob', 'researcher-pre-tool-use-subagenthandback', 'researcher-subagent-stop',
  'other-plugin-pre-tool-use-bash', 'other-plugin-post-tool-use-write', 'other-plugin-pre-tool-use-subagenthandback', 'other-plugin-subagent-stop',
  'project-agent-pre-tool-use-read', 'project-agent-pre-tool-use-subagenthandback', 'project-agent-subagent-stop',
  'implementer-pre-tool-use-subagenthandback', 'implementer-subagent-stop', 'plan-reviewer-post-tool-use-write',
  'implementer-pre-tool-use-write', 'implementer-pre-tool-use-bash', 'implementer-post-tool-use-write',
  'code-reviewer-pre-tool-use-bash', 'code-reviewer-pre-tool-use-write', 'code-reviewer-post-tool-use-write', 'code-reviewer-pre-tool-use-subagenthandback', 'code-reviewer-subagent-stop',
];
step('hooks (recorded payloads)', (report) => {
  const pinned = readFileSync(join(root, '.claude-code-version'), 'utf8').trim();
  const payloads = {};
  for (const f of existsSync(payloadDir) ? readdirSync(payloadDir).filter((x) => x.endsWith('.json')) : []) {
    const p = JSON.parse(readFileSync(join(payloadDir, f), 'utf8'));
    if (p.claudeCode !== pinned) report(`${f} was recorded from Claude Code ${p.claudeCode}, and .claude-code-version pins ${pinned}: record again with node scripts/e2e.mjs --hooks --record`);
    payloads[f.slice(0, -5)] = p;
  }
  const missing = PAYLOADS.filter((l) => !payloads[l]);
  if (missing.length) return report(`no recorded payload for ${missing.join(', ')}: run node scripts/e2e.mjs --hooks --record`);
  // What the recording tells about Claude Code, which the hooks rely on (ADR-0007).
  if (payloads['main-pre-tool-use-bash'].input.agent_id !== undefined) report('a call from the main conversation carries agent_id');
  if (payloads['plan-reviewer-pre-tool-use-read'].input.agent_type !== 'pitwall:plan-reviewer') report('the plan reviewer\'s calls do not carry agent_type pitwall:plan-reviewer');
  if (payloads['project-agent-pre-tool-use-read'].input.agent_type !== 'plan-reviewer') report('a project agent named plan-reviewer does not carry agent_type plan-reviewer');
  if (payloads['main-pre-tool-use-bash'].attended !== '0') report('the headless recording does not carry CLAUDE_CODE_SESSION_ATTENDED=0');

  // hooks.json: every hook through bash, which checks for a pitwall project and for node first;
  // the guard matches every tool, fails closed and outlasts the gate it may run at a handback.
  const hooksCfg = JSON.parse(readFileSync(join(plugin, 'config', 'defaults.json'), 'utf8')).hooks;
  const hooks = JSON.parse(readFileSync(join(plugin, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const EVENTS = { SessionStart: 'session-start', PreToolUse: 'pre-tool-use', PostToolUse: 'post-tool-use', Stop: 'stop', SubagentStop: 'subagent-stop' };
  const commands = {};
  for (const [ev, arg] of Object.entries(EVENTS)) {
    const hk = hooks[ev]?.[0]?.hooks?.[0];
    commands[arg] = hk?.command ?? '';
    if (hk?.shell !== 'bash' || !commands[arg].startsWith('[ -f "$CLAUDE_PROJECT_DIR/.claude/pitwall.json" ] || exit 0;') || !commands[arg].endsWith(`scripts/hook.mjs" ${arg}`)) report(`hooks.json: ${ev} must run through bash, check for .claude/pitwall.json first and end by running hook.mjs ${arg}`);
  }
  const pre = hooks.PreToolUse?.[0];
  if (pre?.matcher !== '*' || pre.hooks?.[0]?.onFailure !== 'block') report('hooks.json: PreToolUse must match every tool with onFailure "block"');
  if (!(pre?.hooks?.[0]?.timeout > hooksCfg.gateTimeoutSeconds.changed)) report('hooks.json: the PreToolUse timeout must outlast hooks.gateTimeoutSeconds.changed, which an implementer\'s handback may run');
  const sessionCmd = commands['session-start'];

  scratch('pitwall-hooks-', (dir) => {
    const cfg = JSON.parse(readFileSync(join(plugin, 'config', 'defaults.json'), 'utf8'));
    const fwd = (p) => p.split('\\').join('/');
    const home = join(dir, 'home');
    mkdirSync(join(home, '.claude'), { recursive: true });
    const state = join(dir, 'state');
    const origin = join(dir, 'origin.git');
    gitIn(dir, 'init', '-q', '--bare', origin);
    // A project as kickoff leaves it, plus a second commit on main, so the skeleton's first push is over.
    const makeProject = (name, commits = 2) => {
      const p = join(dir, name);
      if (layOut(p).status !== 0) throw new Error('layout failed');
      gitIn(p, 'init', '-q', '-b', 'main');
      gitIn(p, 'add', '-A');
      gitIn(p, 'commit', '-qm', 'skeleton');
      if (commits > 1) gitIn(p, 'commit', '-q', '--allow-empty', '-m', 'second');
      gitIn(p, 'remote', 'add', 'origin', origin);
      return p;
    };
    const project = makeProject('p');
    const setMode = (mode) => {
      const f = join(project, '.claude', 'pitwall.json');
      writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, 'utf8')), mergeProtection: mode }, null, 2));
    };
    const head = gitIn(project, 'rev-parse', 'HEAD').stdout.trim();
    let sessions = 0;
    // Runs one hook on a recorded payload with the case's input, and returns what it said.
    const hook = (label, { input = {}, tool, env = {}, session, projectDir = project, script = join(scripts, 'hook.mjs'), stdin } = {}) => {
      const p = payloads[label];
      const text = JSON.stringify(p.input).split('<project>').join(fwd(projectDir)).split('<scratch>').join(fwd(dir)).split('<plugin>').join(fwd(plugin)).split('<home>').join(fwd(home));
      const payload = { ...JSON.parse(text), session_id: session ?? `check-${(sessions += 1)}`, cwd: projectDir, ...(tool ? { tool_name: tool } : {}), ...input };
      const hookEnv = { ...process.env, CLAUDE_PROJECT_DIR: projectDir, PITWALL_HOOK_STATE: state, HOME: home, USERPROFILE: home, CLAUDE_CODE_SESSION_ATTENDED: p.attended ?? '0', PITWALL_GH: JSON.stringify([process.execPath, fakeGh]), FAKE_GH: JSON.stringify({}), FAKE_GH_LOG: join(dir, 'gh.log'), FAKE_GH_STATE: join(dir, 'gh-state.json'), ...env };
      // An attendance of undefined: Claude Code did not set the variable.
      for (const [k, v] of Object.entries(hookEnv)) if (v === undefined) delete hookEnv[k];
      const r = spawnSync(process.execPath, [script, p.event], { input: stdin ?? JSON.stringify(payload), encoding: 'utf8', env: hookEnv });
      let out = null;
      try {
        out = r.stdout.trim() ? JSON.parse(r.stdout) : null;
      } catch {
        out = { unparsed: r.stdout };
      }
      return { code: r.status, out, stderr: r.stderr };
    };
    // A short form of the answer: "allow", "deny:<rule>", "context", "block" or "message".
    const verdict = ({ out }) => {
      if (!out) return 'allow';
      const h = out.hookSpecificOutput ?? {};
      if (h.permissionDecision === 'deny') return `deny:${/pitwall refused this call \((\w+)\)/.exec(h.permissionDecisionReason ?? '')?.[1] ?? '?'}`;
      if (out.decision === 'block') return 'block';
      if (h.additionalContext) return 'context';
      if (out.systemMessage) return 'message';
      return JSON.stringify(out);
    };
    const expect = (label, what, opts, want) => {
      const r = hook(label, opts);
      const got = verdict(r);
      if (got !== want) report(`${what}: expected ${want}, got ${got}${r.code !== 0 ? ` (exit ${r.code})` : ''}${r.stderr ? `\n${r.stderr}` : ''}${r.out ? `\n${JSON.stringify(r.out).slice(0, 400)}` : ''}`);
      return r;
    };
    const bash = (command, want, extra = {}) => expect('main-pre-tool-use-bash', `main conversation: ${command.slice(0, 120)}`, { input: { tool_input: { command } }, ...extra }, want);
    const AWS = 'AKIA' + 'IOSFODNN7EXAMPLE';
    const P = fwd(plugin);

    // No-op outside a pitwall project, for every event.
    for (const label of ['main-session-start', 'main-pre-tool-use-bash', 'main-post-tool-use-write', 'main-stop', 'implementer-subagent-stop']) {
      const r = hook(label, { projectDir: dir, input: { tool_input: { command: 'rm .env', file_path: join(dir, '.env') } } });
      if (r.code !== 0 || r.out !== null) report(`${label} outside a pitwall project: exit ${r.code}, printed ${JSON.stringify(r.out)}`);
    }

    // (a) Secrets.
    bash('cat .env', 'deny:secrets');
    bash('cp .env.example .env', 'deny:secrets');
    bash('cat .env.example', 'allow');
    bash('node --env-file=.env app.js', 'deny:secrets');
    bash('cat ~/.ssh/id_rsa', 'deny:secrets');
    bash('node -e "console.log(require(\'fs\').readFileSync(\'.env\', \'utf8\'))"', 'deny:secrets');
    bash(`echo ${AWS} > notes.txt`, 'deny:secrets');
    bash('git commit -m "never commit .env"', 'allow');
    bash("git commit -F - <<'EOF'\nrm .env from the docs\nEOF", 'allow');
    expect('main-pre-tool-use-read', 'Read .env', { input: { tool_input: { file_path: join(project, '.env') } } }, 'deny:secrets');
    expect('main-pre-tool-use-read', 'Read config/.env.local', { input: { tool_input: { file_path: join(project, 'config', '.env.local') } } }, 'deny:secrets');
    expect('main-pre-tool-use-read', 'Read docs/IDEA.md', { input: { tool_input: { file_path: join(project, 'docs', 'IDEA.md') } } }, 'allow');
    expect('main-pre-tool-use-read', 'Grep through .env files', { tool: 'Grep', input: { tool_input: { pattern: 'KEY', glob: '**/.env*' } } }, 'deny:secrets');
    expect('main-pre-tool-use-write', 'Write a key into src/a.js', { input: { tool_input: { file_path: join(project, 'src', 'a.js'), content: `const key = '${AWS}';` } } }, 'deny:secrets');
    expect('main-pre-tool-use-write', 'Write a private key block', { input: { tool_input: { file_path: join(project, 'test', 'k.txt'), content: `-----BEGIN RSA ${'PRIVATE'} KEY-----\n${'MIIEpAIBAAKCAQEA'.repeat(4)}\n` } } }, 'deny:secrets');
    expect('main-pre-tool-use-write', 'Write code that looks for a key header', { input: { tool_input: { file_path: join(project, 'src', 'pem.js'), content: `export const isKey = (s) => s.startsWith('-----BEGIN ${'PRIVATE'} KEY-----');` } } }, 'allow');
    expect('main-pre-tool-use-edit', 'Edit a token into a file', { input: { tool_input: { file_path: join(project, 'src', 'a.js'), old_string: 'x', new_string: `ghp_${'a1'.repeat(18)}` } } }, 'deny:secrets');
    expect('main-pre-tool-use-write', 'Write .env.example', { input: { tool_input: { file_path: join(project, '.env.example'), content: 'API_KEY=\n' } } }, 'allow');
    expect('main-pre-tool-use-read', 'Grep through .env.example files', { tool: 'Grep', input: { tool_input: { pattern: 'KEY', glob: '**/.env.example' } } }, 'allow');
    expect('main-pre-tool-use-read', 'Grep through keymap files', { tool: 'Grep', input: { tool_input: { pattern: 'ctrl', glob: '**/*.keymap.json' } } }, 'allow');
    bash('echo ".env" >> .gitignore', 'allow');
    bash('test -f .env && echo there', 'allow');
    bash('find . -name "*.pem"', 'allow');
    bash('echo SECRET=1 > .env', 'deny:secrets');
    bash('git commit -m "feat: load settings from config/.env"', 'allow');
    bash('git commit -m "feat: read keys from certs/server.key"', 'allow');
    // A path with a space in it is still a path.
    bash(`rm "${fwd(project)}/.claude/pitwall.json"`, 'deny:switch');
    bash('cat "./my notes/.env"', 'deny:secrets');
    bash('git log --grep=".env"', 'allow');
    bash("sed -n '/[z-a]/p' notes.txt", 'allow');
    bash('grep -E "[\\w-.]+" notes.txt', 'allow');
    // A recursive grep reads ignored files: with a .env in the project, it is refused unless it leaves .env out.
    writeFileSync(join(project, '.env'), 'DATABASE_URL=postgres://x\n');
    bash('grep -rn DATABASE_URL .', 'deny:secrets');
    // A search pattern, a filter or a property is no file; a file named after the pattern still is.
    bash('grep -n ".env" .gitignore', 'allow');
    bash("grep -qx '.env' .gitignore", 'allow');
    bash("git grep -n '.env'", 'allow');
    bash("rg '\\.env' src", 'allow');
    bash("git log -S '.env'", 'allow');
    bash("grep -n 'cert.pem' docs/SPEC.md", 'allow');
    bash("jq -r '.key' data.json", 'allow');
    bash("yq e '.metadata.key' x.yaml", 'allow');
    bash('node -e "const o = { key: 1 }; console.log(o.key)"', 'allow');
    bash("git ls-files '*.pem'", 'allow');
    bash('grep KEY .env', 'deny:secrets');
    bash('grep -e KEY .env', 'deny:secrets');
    expect('main-pre-tool-use-bash', 'PowerShell: Select-String for .env', { tool: 'PowerShell', input: { tool_input: { command: "Select-String -Path src/*.ts -Pattern '.env'" } } }, 'allow');
    // git commands that only name a secret file, and untracking one.
    bash('git check-ignore -v .env', 'allow');
    bash('git ls-files .env', 'allow');
    bash('git status --short .env', 'allow');
    bash('git rm --cached .env', 'allow');
    bash('git rm .env', 'deny:secrets');
    bash('grep -r DATABASE_URL', 'deny:secrets');
    bash('grep -rn --exclude=.env DATABASE_URL .', 'allow');
    bash('grep -rn --include=*.ts useState .', 'allow');
    bash('grep -rn --include=.env* KEY .', 'deny:secrets');
    bash('rg -uu DATABASE_URL', 'deny:secrets');
    bash('rg DATABASE_URL', 'allow');
    bash('grep -rn DATABASE_URL docs', 'allow');
    bash('grep -rn DATABASE_URL {src,docs}', 'allow');
    bash("rg -uu -g '*' KEY", 'deny:secrets');
    bash("rg -uu -g '*.ts' KEY", 'allow');
    bash('git grep DATABASE_URL', 'allow');
    rmSync(join(project, '.env'));

    // (b) Files git ignores.
    expect('main-pre-tool-use-write', 'Write dist/a.js', { input: { tool_input: { file_path: join(project, 'dist', 'a.js'), content: 'x' } } }, 'deny:ignored');
    expect('main-pre-tool-use-edit', 'Edit node_modules/x/index.js', { input: { tool_input: { file_path: join(project, 'node_modules', 'x', 'index.js'), old_string: 'a', new_string: 'b' } } }, 'deny:ignored');
    expect('main-pre-tool-use-write', 'Write src/a.js', { input: { tool_input: { file_path: join(project, 'src', 'a.js'), content: 'x' } } }, 'allow');
    expect('main-pre-tool-use-write', 'Write outside the project', { input: { tool_input: { file_path: join(dir, 'outside.txt'), content: 'x' } } }, 'allow');

    // (c) Pushes that change main (main has two commits, the project is on main).
    bash('git push origin HEAD:main', 'deny:push');
    bash('git push', 'deny:push');
    bash('git push origin', 'deny:push');
    bash('git -C . push origin main', 'deny:push');
    bash('git push --force origin main', 'deny:push');
    bash('git push origin +HEAD:main', 'deny:push');
    bash('git push origin :main', 'deny:push');
    bash('git push origin --delete main', 'deny:push');
    bash('git push --all', 'deny:push');
    bash('git push --mirror origin', 'deny:push');
    bash('git push --tags', 'allow');
    bash('git push -n origin main', 'allow');
    bash('git push -u origin epic/E1-x', 'allow');
    bash('git push --force-with-lease origin epic/E1-x', 'allow');
    bash('echo $(git push -f origin main)', 'deny:push');
    bash('git push origin @', 'deny:push');
    // Commands inside blocks and groups are commands: PowerShell's "A; if ($?) { B }", bash's if, { } and ( ).
    expect('main-pre-tool-use-bash', "PowerShell: git commit -m \"feat: x\"; if ($?) { git push origin main }", { tool: 'PowerShell', input: { tool_input: { command: "git commit -m \"feat: x\"; if ($?) { git push origin main }" } } }, 'deny:push');
    expect('main-pre-tool-use-bash', "PowerShell: gh pr checks 7; if ($?) { gh pr merge 7 --admin --squash }", { tool: 'PowerShell', input: { tool_input: { command: "gh pr checks 7; if ($?) { gh pr merge 7 --admin --squash }" } } }, 'deny:protection');
    expect('main-pre-tool-use-bash', "PowerShell: git commit -m \"feat: x\"; if ($?) { git push -u origin epic/E1-x }", { tool: 'PowerShell', input: { tool_input: { command: "git commit -m \"feat: x\"; if ($?) { git push -u origin epic/E1-x }" } } }, 'allow');
    bash('if npm test; then git push origin main; fi', 'deny:push');
    bash('{ git push origin main; }', 'deny:push');
    bash('(git push origin main)', 'deny:push');
    bash('(cd docs && git push -u origin epic/E1-x)', 'allow');
    // Braces inside a word are text: gh's {owner}/{repo} placeholders, brace expansion, stash@{0}.
    bash('gh api repos/{owner}/{repo}/statuses/abc -f state=success -f context=ai-review', 'deny:review');
    bash('gh api -X PUT repos/{owner}/{repo}/branches/main/protection --input p.json', 'deny:protection');
    bash("gh api graphql -F owner={owner} -F name={repo} -f query='mutation { deleteBranchProtectionRule(input: {branchProtectionRuleId: \"x\"}) { clientMutationId } }'", 'deny:protection');
    expect('main-pre-tool-use-bash', "PowerShell: Invoke-RestMethod -Headers @{Authorization = \"token $t\"} -Method Put -Uri https://api.github.com/repos/o/r/branches/main/protection", { tool: 'PowerShell', input: { tool_input: { command: "Invoke-RestMethod -Headers @{Authorization = \"token $t\"} -Method Put -Uri https://api.github.com/repos/o/r/branches/main/protection" } } }, 'deny:protection');
    expect('main-pre-tool-use-bash', "PowerShell: if($?){git push origin main}", { tool: 'PowerShell', input: { tool_input: { command: "if($?){git push origin main}" } } }, 'deny:push');
    bash('mkdir -p src/{a,b} && git stash show stash@{0}', 'allow');
    // PowerShell's keywords, negations and assignments may touch their ( and {.
    expect('main-pre-tool-use-bash', "PowerShell: if (!(Test-Path .env)) { Write-Host \"no .env\" }", { tool: 'PowerShell', input: { tool_input: { command: "if (!(Test-Path .env)) { Write-Host \"no .env\" }" } } }, 'allow');
    expect('main-pre-tool-use-bash', "PowerShell: if (-not(Test-Path .claude/pitwall.json)) { Write-Host \"not a pitwall project\" }", { tool: 'PowerShell', input: { tool_input: { command: "if (-not(Test-Path .claude/pitwall.json)) { Write-Host \"not a pitwall project\" }" } } }, 'allow');
    expect('main-pre-tool-use-bash', "PowerShell: if(Test-Path .env){ Write-Host \"there\" }", { tool: 'PowerShell', input: { tool_input: { command: "if(Test-Path .env){ Write-Host \"there\" }" } } }, 'allow');
    expect('main-pre-tool-use-bash', "PowerShell: $ok=(Test-Path .env)", { tool: 'PowerShell', input: { tool_input: { command: "$ok=(Test-Path .env)" } } }, 'allow');
    expect('main-pre-tool-use-bash', "PowerShell: try{npm test}catch{git push origin main}", { tool: 'PowerShell', input: { tool_input: { command: "try{npm test}catch{git push origin main}" } } }, 'deny:push');
    expect('main-pre-tool-use-bash', "PowerShell: try{git push origin main}catch{}", { tool: 'PowerShell', input: { tool_input: { command: "try{git push origin main}catch{}" } } }, 'deny:push');
    expect('main-pre-tool-use-bash', "PowerShell: if ($?) { npm test }else{ git push origin main }", { tool: 'PowerShell', input: { tool_input: { command: "if ($?) { npm test }else{ git push origin main }" } } }, 'deny:push');
    expect('main-pre-tool-use-bash', "PowerShell: do{ git push origin main }while($false)", { tool: 'PowerShell', input: { tool_input: { command: "do{ git push origin main }while($false)" } } }, 'deny:push');
    expect('main-pre-tool-use-bash', "PowerShell: if ($LASTEXITCODE -eq 0) { gh api repos/{owner}/{repo}/statuses/abc -f state=success -f context=ai-review }", { tool: 'PowerShell', input: { tool_input: { command: "if ($LASTEXITCODE -eq 0) { gh api repos/{owner}/{repo}/statuses/abc -f state=success -f context=ai-review }" } } }, 'deny:review');
    expect('main-pre-tool-use-bash', "PowerShell: if ($?) { gh api -X PUT repos/{owner}/{repo}/branches/main/protection --input p.json }", { tool: 'PowerShell', input: { tool_input: { command: "if ($?) { gh api -X PUT repos/{owner}/{repo}/branches/main/protection --input p.json }" } } }, 'deny:protection');
    expect('main-pre-tool-use-bash', "PowerShell: $r=git push origin main", { tool: 'PowerShell', input: { tool_input: { command: "$r=git push origin main" } } }, 'deny:push');
    expect('main-pre-tool-use-bash', "PowerShell: if ($?) { Invoke-RestMethod -Headers @{Authorization = \"token $t\"} -Method Put -Uri https://api.github.com/repos/o/r/branches/main/protection }", { tool: 'PowerShell', input: { tool_input: { command: "if ($?) { Invoke-RestMethod -Headers @{Authorization = \"token $t\"} -Method Put -Uri https://api.github.com/repos/o/r/branches/main/protection }" } } }, 'deny:protection');
    expect('main-pre-tool-use-bash', "PowerShell: [IO.File]::WriteAllText('.claude/pitwall.json', '{}')", { tool: 'PowerShell', input: { tool_input: { command: "[IO.File]::WriteAllText('.claude/pitwall.json', '{}')" } } }, 'deny:switch');
    expect('main-pre-tool-use-bash', "PowerShell: [IO.File]::WriteAllText(\"$PWD/docs/STACK.md\", \"Settings: .claude/pitwall.json holds the level.\")", { tool: 'PowerShell', input: { tool_input: { command: "[IO.File]::WriteAllText(\"$PWD/docs/STACK.md\", \"Settings: .claude/pitwall.json holds the level.\")" } } }, 'allow');
    expect('main-pre-tool-use-bash', "PowerShell: [IO.File]::Copy('backup.json', '.claude/settings.json')", { tool: 'PowerShell', input: { tool_input: { command: "[IO.File]::Copy('backup.json', '.claude/settings.json')" } } }, 'deny:switch');
    expect('main-pre-tool-use-bash', "PowerShell: [IO.File]::WriteAllText('notes.txt', 'x')", { tool: 'PowerShell', input: { tool_input: { command: "[IO.File]::WriteAllText('notes.txt', 'x')" } } }, 'allow');
    expect('main-pre-tool-use-bash', "PowerShell: $cfg = Get-Content .claude/pitwall.json | ConvertFrom-Json", { tool: 'PowerShell', input: { tool_input: { command: "$cfg = Get-Content .claude/pitwall.json | ConvertFrom-Json" } } }, 'allow');
    expect('main-pre-tool-use-bash', "PowerShell: if ($?) { git push -u origin epic/E1-x }", { tool: 'PowerShell', input: { tool_input: { command: "if ($?) { git push -u origin epic/E1-x }" } } }, 'allow');
    bash('find . -name "*.tmp" -exec rm {} \\;', 'allow');
    bash('cp x.json ${HOME}/.claude/settings.json', 'deny:switch');
    // A subshell keeps its cd to itself.
    bash('(cd docs && ls) && rm .claude/pitwall.json', 'deny:switch');
    bash('echo "${HOME}/x" && git push -u origin epic/E1-x', 'allow');
    // A PowerShell here-string is one word of text, apostrophes and all.
    expect('main-pre-tool-use-bash', "PowerShell: git commit -m @'\nfix: don't read .env in tests\n'@", { tool: 'PowerShell', input: { tool_input: { command: "git commit -m @'\nfix: don't read .env in tests\n'@" } } }, 'allow');
    expect('main-pre-tool-use-bash', "PowerShell: git commit -m @'\nfix: the owner's choice\n'@; git push origin main", { tool: 'PowerShell', input: { tool_input: { command: "git commit -m @'\nfix: the owner's choice\n'@; git push origin main" } } }, 'deny:push');
    // A heredoc inside $( ... ): its parentheses and backticks are text, and what comes after the substitution is still read.
    bash("gh pr create --title x --body \"$(cat <<'EOF'\nSteps: a) install b) run `git push origin main` is not done here\nEOF\n)\"", 'allow');
    bash("git commit -m \"$(cat <<'EOF'\nfix: three things\n\n1) the parser 2) the docs 3) docs mention `cat .env`\nEOF\n)\"", 'allow');
    bash("git commit -m \"$(cat <<'EOF'\nfix: a) b)\nEOF\n)\" && git push origin main", 'deny:push');
    bash('bash -c "git push origin main"', 'deny:push');
    bash('bash -lc "git push origin main"', 'deny:push');
    bash('git push origin "$(git branch --show-current)"', 'deny:push');
    bash('git checkout -b epic/E9-x && git push -u origin HEAD', 'allow');
    bash('git switch -c epic/E9-y && git push -u origin HEAD', 'allow');
    bash('git switch --create epic/E9-z && git push -u origin HEAD', 'allow');
    // Git Bash spells the project folder /c/...; on Linux that folder does not exist, and a branch git cannot read is refused too.
    const bashPath = fwd(project).replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
    bash(`cd ${bashPath} && git push`, 'deny:push');
    bash(`git -C ${bashPath} push`, 'deny:push');
    if (process.platform === 'win32') expect('main-pre-tool-use-write', 'Write .claude/settings.json by its Git Bash path', { input: { tool_input: { file_path: `${bashPath}/.claude/settings.json`, content: '{}' } } }, 'deny:switch');
    // The skeleton's first push passes from main itself, while main holds one commit and was never pushed.
    const fresh = makeProject('fresh', 1);
    const onFresh = (command, want, what) => expect('main-pre-tool-use-bash', what, { projectDir: fresh, input: { tool_input: { command } } }, want);
    onFresh('git push -u origin main', 'allow', 'the skeleton\'s first push');
    onFresh('git push -f -u origin main', 'deny:push', 'a forced first push');
    gitIn(fresh, 'checkout', '-qb', 'plan/initial');
    onFresh('git push origin HEAD:main', 'deny:push', 'a planning branch pushed onto main while main holds the skeleton');
    onFresh('git push origin plan/initial:main', 'deny:push', 'the planning branch pushed onto main by name');
    onFresh('git push -u origin plan/initial', 'allow', 'the planning branch pushed');
    gitIn(fresh, 'checkout', '-q', 'main');
    gitIn(fresh, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    onFresh('git push origin main', 'deny:push', 'main pushed again after its first push');
    gitIn(fresh, 'checkout', '-q', '--detach');
    onFresh('git push origin HEAD:epic/E1-x', 'allow', 'a detached HEAD pushed to a named branch');
    onFresh('git push origin HEAD:main', 'deny:push', 'a detached HEAD pushed onto main');
    onFresh('git push', 'deny:push', 'a push from a detached HEAD with no branch named');
    gitIn(fresh, 'checkout', '-q', 'main');

    // (d) The guards' switch.
    bash('rm .claude/pitwall.json', 'deny:switch');
    bash('cat .claude/pitwall.json', 'allow');
    bash('git add .claude/pitwall.json', 'allow');
    bash('cd .claude && rm settings.json', 'deny:switch');
    bash('bash -c "rm .claude/pitwall.json"', 'deny:switch');
    bash("sed -i 's/true/false/' .claude/settings.json", 'deny:switch');
    bash('echo {} > .claude/settings.local.json', 'deny:switch');
    bash('mv .claude/pitwall.json /tmp/x.json', 'deny:switch');
    bash('git rm --cached .claude/settings.json', 'deny:switch');
    bash('git checkout -- .claude/settings.json', 'deny:switch');
    bash('rm .claude/*.json', 'deny:switch');
    bash('rm -rf .claude', 'deny:switch');
    bash('rm -rf node_modules dist', 'allow');
    bash('git clean -fdx', 'deny:switch');
    bash('git clean -fd', 'allow');
    bash('git clean -n -x', 'allow');
    bash('mv build/out.js .', 'allow');
    bash('mv notes.md .claude/', 'allow');
    bash('mv .claude old-claude', 'deny:switch');
    expect('main-pre-tool-use-bash', "PowerShell: Move-Item -Destination old -Path .claude", { tool: 'PowerShell', input: { tool_input: { command: "Move-Item -Destination old -Path .claude" } } }, 'deny:switch');
    expect('main-pre-tool-use-bash', 'PowerShell: Move-Item into the project folder', { tool: 'PowerShell', input: { tool_input: { command: 'Move-Item build/out.js .' } } }, 'allow');
    bash('git commit -m "chore: record merge protection" .claude/pitwall.json', 'allow');
    bash('git reset HEAD .claude/pitwall.json', 'allow');
    bash('git reset --hard', 'allow');
    bash('node -e "require(\'fs\').writeFileSync(\'.claude/pitwall.json\', \'{}\')"', 'deny:switch');
    bash('claude plugin disable pitwall@pitwall', 'deny:switch');
    bash('claude plugin uninstall pitwall@pitwall --scope project', 'deny:switch');
    bash('claude plugin marketplace remove pitwall', 'deny:switch');
    bash('rm ~/.claude/settings.json', 'deny:switch');
    bash(`rm -rf "${P}/hooks"`, 'deny:switch');
    bash(`cp evil.mjs "${P}/scripts/hook.mjs"`, 'deny:switch');
    bash(`node "${P}/scripts/docs-check.mjs" --root .`, 'allow');
    bash(`cat "${P}/config/defaults.json"`, 'allow');
    bash(`cp "${P}/template/docs/spikes/template.md" docs/spikes/x.md`, 'deny:switch');
    bash('sed -n 1,20p .claude/settings.json', 'deny:switch');
    bash("awk '{print}' .claude/settings.json", 'deny:switch');
    bash('cp .claude/settings.json /tmp/settings-copy.json', 'deny:switch');
    bash('cp backup.json .claude/settings.json', 'deny:switch');
    bash('git restore --staged .claude/pitwall.json', 'allow');
    bash('git restore .claude/pitwall.json', 'deny:switch');
    bash('node -p "require(\'./.claude/pitwall.json\').processLevel"', 'deny:switch');
    bash('python -c "open(\'.claude/settings.json\', \'w\').write(\'{}\')"', 'deny:switch');
    bash('npx prettier --write .claude/settings.json', 'deny:switch');
    bash('head -5 .claude/settings.json && grep -n mergeProtection .claude/pitwall.json', 'allow');
    // Commands that only read (owner, 2026-11-09): they pass on the switch files and the plugin folder; a write through them does not.
    for (const command of ['ls -la .claude/', 'ls .claude/pitwall.json', 'test -f .claude/pitwall.json && echo yes', '[ -f .claude/settings.json ] && echo yes', '[[ -f .claude/settings.local.json ]] && echo yes', 'stat .claude/pitwall.json', 'wc -l .claude/settings.json', 'jq .mergeProtection .claude/pitwall.json', "jq -r '.processLevel' .claude/pitwall.json", 'diff .claude/settings.json .claude/settings.local.json', 'file .claude/pitwall.json', 'cmp .claude/settings.json .claude/settings.local.json', 'tail -3 .claude/pitwall.json', 'sha256sum .claude/settings.json']) {
      bash(command, 'allow');
    }
    bash(`ls "${P}/scripts" && wc -l "${P}/config/defaults.json"`, 'allow');
    bash('jq . .claude/pitwall.json > .claude/pitwall.json', 'deny:switch');
    // An exclusion leaves a switch file alone; a pitwall script's free text names no file; a "<" only reads.
    bash("git checkout -- . ':!.claude/pitwall.json'", 'allow');
    bash("git restore -- . ':(exclude).claude/settings.json'", 'allow');
    bash("npx prettier --write . '!.claude/settings.json'", 'allow');
    bash(`node "${P}/scripts/layout.mjs" --name 'x' --idea 'a linter for .claude/settings.json files' --level lite`, 'allow');
    bash(`node --no-warnings "${P}/scripts/docs-check.mjs" --stage plan`, 'allow');
    bash(`node "${P}/scripts/docs-check.mjs" --root .claude/pitwall.json`, 'deny:switch');
    bash('while read -r l; do echo "$l"; done < .claude/settings.json', 'allow');
    bash('python -m json.tool < .claude/settings.json', 'allow');
    // The plugin's own files read the ways agents read them; the switch files keep the strict list.
    bash(`sed -n '140,170p' "${P}/config/defaults.json"`, 'allow');
    bash(`find "${P}/template/docs" -name '*.md'`, 'allow');
    bash(`cd "${P}" && ls`, 'allow');
    bash(`sort "${P}/config/defaults.json"`, 'allow');
    bash(`find "${P}/template" -name '*.tmpl' -delete`, 'deny:switch');
    bash(`sed -i 's/a/b/' "${P}/config/defaults.json"`, 'deny:switch');
    bash(`cd "${P}" && rm -rf hooks`, 'deny:switch');
    bash("sed -n '1,20p' .claude/settings.json", 'deny:switch');
    bash("jq '.mergeProtection = \"branch-protection\"' .claude/pitwall.json > /tmp/p.json && mv /tmp/p.json .claude/pitwall.json", 'deny:switch');
    bash('diff .claude/settings.json backup.json > .claude/settings.local.json', 'deny:switch');
    bash('git diff .claude/settings.json && git log -p .claude/pitwall.json && git show HEAD:.claude/pitwall.json', 'allow');
    bash('git add docs/ .claude/pitwall.json && git commit -m "docs: discovery"', 'allow');
    bash('gh pr create --title x --body "explains .claude/settings.json"', 'allow');
    bash('python -c "print(open(\'config/settings.json\').read())"', 'allow');
    bash('git commit -m "fix the review-status.mjs call"', 'allow');
    bash('npm test', 'allow');
    expect('main-pre-tool-use-edit', 'Edit .claude/settings.json', { input: { tool_input: { file_path: join(project, '.claude', 'settings.json'), old_string: 'true', new_string: 'false' } } }, 'deny:switch');
    expect('main-pre-tool-use-write', 'Write .claude/settings.local.json', { input: { tool_input: { file_path: join(project, '.claude', 'settings.local.json'), content: '{}' } } }, 'deny:switch');
    expect('main-pre-tool-use-write', 'Write the user\'s settings', { input: { tool_input: { file_path: join(home, '.claude', 'settings.json'), content: '{}' } } }, 'deny:switch');
    expect('main-pre-tool-use-write', 'Write into the plugin', { input: { tool_input: { file_path: join(plugin, 'scripts', 'hook-guard.mjs'), content: '' } } }, 'deny:switch');
    expect('main-pre-tool-use-read', 'Read .claude/pitwall.json', { input: { tool_input: { file_path: join(project, '.claude', 'pitwall.json') } } }, 'allow');
    for (const [command, want] of [['Remove-Item .claude\\pitwall.json', 'deny:switch'], ['Get-Content .claude\\pitwall.json', 'allow'], ['Set-Content -Path .claude\\settings.json -Value "{}"', 'deny:switch'], ['& gh pr merge 7 --admin', 'deny:protection']]) {
      expect('main-pre-tool-use-bash', `PowerShell: ${command}`, { tool: 'PowerShell', input: { tool_input: { command } } }, want);
    }

    // (e) Merge protection, and AC4: commit statuses.
    bash('gh pr merge 7 --admin', 'deny:protection');
    bash('gh api -X PUT repos/o/r/branches/main/protection --input p.json', 'deny:protection');
    bash('gh api --method DELETE repos/o/r/branches/main/protection/enforce_admins', 'deny:protection');
    bash('gh api repos/o/r/branches/main/protection', 'allow');
    bash('gh api repos/o/r/rulesets -f name=open', 'deny:protection');
    bash('gh api graphql -f query=\'mutation { deleteBranchProtectionRule(input: {branchProtectionRuleId: "x"}) { clientMutationId } }\'', 'deny:protection');
    bash('curl -X DELETE -H "Authorization: token x" https://api.github.com/repos/o/r/branches/main/protection', 'deny:protection');
    bash(`gh api repos/o/r/statuses/${head} -f state=success -f context=ai-review`, 'deny:review');
    bash('gh api -X POST repos/o/r/statuses/abc --input s.json', 'deny:review');
    bash('gh api repos/o/r/commits/abc/statuses', 'allow');
    bash('curl -X POST -d \'{"state":"success","context":"ai-review"}\' https://api.github.com/repos/o/r/statuses/abc', 'deny:review');
    bash(`node "${P}/scripts/review-status.mjs" --review plan --state success`, 'deny:review');
    bash(`grep -n state "${P}/scripts/review-status.mjs"`, 'allow');
    expect('main-pre-tool-use-bash', 'an MCP tool that changes protection', { tool: 'mcp__github__update_branch_protection', input: { tool_input: { branch: 'main' } } }, 'deny:protection');
    expect('main-pre-tool-use-bash', 'an MCP tool that sets ai-review', { tool: 'mcp__github__create_commit_status', input: { tool_input: { context: 'ai-review', state: 'success' } } }, 'deny:review');
    expect('main-pre-tool-use-bash', 'an MCP tool that reads', { tool: 'mcp__github__get_pull_request', input: { tool_input: { number: 7 } } }, 'allow');
    expect('main-pre-tool-use-bash', 'an MCP tool that writes any commit status', { tool: 'mcp__github__create_commit_status', input: { tool_input: { context: 'ci', state: 'success' } } }, 'deny:review');
    expect('main-pre-tool-use-bash', 'an MCP tool that sets an issue status', { tool: 'mcp__linear__update_issue_status', input: { tool_input: { status: 'done' } } }, 'allow');
    expect('main-pre-tool-use-bash', 'an MCP tool that merges a pull request', { tool: 'mcp__github__merge_pull_request', input: { tool_input: { number: 7 } } }, 'deny:merge');
    expect('main-pre-tool-use-bash', 'an MCP tool that merges a database branch', { tool: 'mcp__supabase__merge_branch', input: { tool_input: { branch_id: 'x' } } }, 'allow');

    // AC4: who runs review-status.mjs, and the plan reviewer's limits.
    const reviewStatus = `node "${P}/scripts/review-status.mjs" --review plan --state success`;
    const reviewer = (what, tool, toolInput, want) => expect('plan-reviewer-pre-tool-use-read', `plan reviewer: ${what}`, { tool, input: { tool_input: toolInput } }, want);
    reviewer('review-status.mjs', 'Bash', { command: reviewStatus }, 'allow');
    reviewer('the docs check', 'Bash', { command: `node "${P}/scripts/docs-check.mjs" --stage plan-review` }, 'allow');
    // What the plan reviewer ran in each round of the headless plan stage: a cd to the project root first.
    reviewer('cd to the project root first', 'Bash', { command: `cd "${fwd(project)}" && node "${P}/scripts/docs-check.mjs" --stage plan-review,spike` }, 'allow');
    reviewer('cd to the project root, Windows spelling', 'Bash', { command: `cd "${project}" && node "${P}/scripts/docs-check.mjs" --stage plan-review,spike` }, 'allow');
    reviewer('cd elsewhere first', 'Bash', { command: `cd "${fwd(dir)}" && node "${P}/scripts/docs-check.mjs" --stage plan-review` }, 'deny:agent');
    reviewer('cd to the project root, then git', 'Bash', { command: `cd "${fwd(project)}" && git status` }, 'deny:agent');
    reviewer('cd to the project root, then two commands', 'Bash', { command: `cd "${fwd(project)}" && ${reviewStatus} && git push` }, 'deny:agent');
    reviewer('git status', 'Bash', { command: 'git status' }, 'deny:agent');
    reviewer('merge.mjs', 'Bash', { command: `node "${P}/scripts/merge.mjs" --plan --owner-approved` }, 'deny:agent');
    reviewer('a copy of review-status.mjs', 'Bash', { command: `node "${fwd(dir)}/review-status.mjs" --review plan --state success` }, 'deny:agent');
    reviewer('two commands', 'Bash', { command: `${reviewStatus}; git push` }, 'deny:agent');
    reviewer('a backtick', 'Bash', { command: `${reviewStatus} --description \`whoami\`` }, 'deny:agent');
    reviewer('a line break', 'Bash', { command: `${reviewStatus}\ngit push` }, 'deny:agent');
    reviewer('$(', 'Bash', { command: `${reviewStatus} --description "$(git log -1)"` }, 'deny:agent');
    reviewer('a redirect', 'Bash', { command: `${reviewStatus} > out.txt` }, 'deny:agent');
    // Claude Code spells the plugin's folder by its link; the script finds it with the link resolved.
    const link = join(dir, 'plugin-link');
    symlinkSync(plugin, link, 'junction');
    expect('plan-reviewer-pre-tool-use-read', 'plan reviewer: review-status.mjs through the plugin folder as Claude Code spells it', { tool: 'Bash', env: { CLAUDE_PLUGIN_ROOT: link }, input: { tool_input: { command: `node "${fwd(link)}/scripts/review-status.mjs" --review plan --state success` } } }, 'allow');
    expect('main-pre-tool-use-write', 'Write into the plugin through its link', { env: { CLAUDE_PLUGIN_ROOT: link }, input: { tool_input: { file_path: join(link, 'scripts', 'hook.mjs'), content: '' } } }, 'deny:switch');
    reviewer('Write docs/PLAN-REVIEW.md', 'Write', { file_path: join(project, 'docs', 'PLAN-REVIEW.md'), content: '# Plan review\n' }, 'allow');
    reviewer('Write docs/SPEC.md', 'Write', { file_path: join(project, 'docs', 'SPEC.md'), content: 'x' }, 'deny:agent');
    reviewer('Edit docs/EPICS.md', 'Edit', { file_path: join(project, 'docs', 'EPICS.md'), old_string: 'a', new_string: 'b' }, 'deny:agent');
    reviewer('Read docs/IDEA.md', 'Read', { file_path: join(project, 'docs', 'IDEA.md') }, 'allow');
    expect('project-agent-pre-tool-use-read', 'a project agent named plan-reviewer runs review-status.mjs', { tool: 'Bash', input: { tool_input: { command: reviewStatus } } }, 'deny:review');
    expect('project-agent-pre-tool-use-read', 'a project agent named plan-reviewer writes docs/SPEC.md', { tool: 'Write', input: { tool_input: { file_path: join(project, 'docs', 'SPEC.md'), content: 'x' } } }, 'allow');
    expect('other-plugin-pre-tool-use-bash', 'another plugin\'s agent runs review-status.mjs', { input: { tool_input: { command: reviewStatus } } }, 'deny:review');

    // T3b-AC4: the code reviewer's limits (hooks.agents), on its own recorded calls.
    if (payloads['code-reviewer-pre-tool-use-bash'].input.agent_type !== 'pitwall:code-reviewer') report('the code reviewer\'s calls do not carry agent_type pitwall:code-reviewer');
    const codeStatus = `node "${P}/scripts/review-status.mjs" --review code --state success --project "${fwd(project)}"`;
    const crBash = (what, command, want) => expect('code-reviewer-pre-tool-use-bash', `code reviewer: ${what}`, { input: { tool_input: { command } } }, want);
    const crWrite = (what, file, want, tool = 'Write') => expect('code-reviewer-pre-tool-use-write', `code reviewer: ${what}`, { tool, input: { tool_input: tool === 'Edit' ? { file_path: file, old_string: 'a', new_string: 'b' } : { file_path: file, content: '# Review\n' } } }, want);
    crBash('review-status.mjs', codeStatus, 'allow');
    crBash('review-status.mjs with failure', `node "${P}/scripts/review-status.mjs" --review code --state failure --description "code review: 2 open"`, 'allow');
    crBash('the docs check', `node "${P}/scripts/docs-check.mjs" --root "${fwd(project)}" --stage code-review`, 'allow');
    crBash('git diff against main', 'git diff main...HEAD', 'allow');
    crBash('git diff --stat', 'git diff main...HEAD --stat', 'allow');
    crBash('git log', 'git log --oneline -5', 'allow');
    crBash('git show a file at the head', 'git show HEAD:src/app.js', 'allow');
    crBash('git rev-parse HEAD', 'git rev-parse HEAD', 'allow');
    crBash('git blame', 'git blame -L 1,20 src/app.js', 'allow');
    crBash('git --no-pager log', 'git --no-pager log -3', 'allow');
    crBash('git -C the project', `git -C "${fwd(project)}" status`, 'allow');
    crBash('cd to the project root, then git diff', `cd "${fwd(project)}" && git diff main...HEAD --stat`, 'allow');
    crBash('the gate, as CI runs it', 'bash scripts/gate --full', 'allow');
    crBash('the gate from its path', 'scripts/gate --fast', 'allow');
    crBash('the gate by its full path', `bash "${fwd(project)}/scripts/gate" --changed`, 'allow');
    crBash('the gate with a mode it lacks', 'bash scripts/gate --all', 'deny:agent');
    crBash('git commit', 'git commit -am x', 'deny:agent');
    crBash('git push', 'git push origin HEAD', 'deny:agent');
    crBash('git checkout', 'git checkout main', 'deny:agent');
    // L-9: what the code reviewers of the headless E0 run sent, verbatim, with the project's own (Windows) path.
    const ran = [
      'bash "{root}\\scripts\\gate" --full',
      'git -C "{root}" diff --stat 92651f8 HEAD',
      'git -C "{root}" diff main...HEAD -- .claude .github .gitignore .prettierignore .prettierrc.json CLAUDE.md docs package.json scripts forge.config.mjs tsconfig.base.json tsconfig.build.json tsconfig.json vitest.config.mts',
      'git -C "{root}" diff main...HEAD --stat',
      'git -C "{root}" log --oneline main..HEAD',
      'git -C "{root}" ls-files src tsconfig.json tsconfig.renderer.json tsconfig.tests.json package.json',
      'git -C "{root}" rev-parse HEAD',
      'git -C "{root}" show 244dd07 --stat',
      'git -C "{root}" status',
      'git diff 238dc5e..HEAD -- . ":(exclude)package-lock.json"',
      'git diff main...HEAD -- . ":(exclude)package-lock.json" ":(exclude).oxlintrc.json"',
      'git diff main...HEAD -- docs/JOURNAL.md docs/SPEC.md docs/EPICS.md docs/PLAN-REVIEW.md CLAUDE.md .claude/pitwall.json .gitignore',
      'git log --stat --format="%h %s" 238dc5e..HEAD',
      'git ls-files -s scripts/gate',
      // And from the E1 run.
      'cd "{root}" && bash scripts/gate --full',
      'git -C "{root}" log --format=%H%n%B%n----',
      'git -C "{root}" log --format="%h %ad %s" --date=iso -- docs/JOURNAL.md',
      `node "${P}/scripts/docs-check.mjs" --root "{root}" --stage code-review`,
      `node "${P}/scripts/review-status.mjs" --review code --state failure --description "code review: 2 open" --project "{root}"`,
      `node "${P}/scripts/review-status.mjs" --review code --state success --project "{root}"`,
    ];
    for (const c of ran) crBash(`as the E0 run sent it: ${c.slice(0, 60)}`, c.split('{root}').join(project), 'allow');
    // T3b review: what a reviewer runs by habit.
    crBash('git branch --show-current', 'git branch --show-current', 'allow');
    crBash('git merge-base', 'git merge-base main HEAD', 'allow');
    crBash('the gate with 2>&1', 'bash scripts/gate --full 2>&1', 'allow');
    crBash('git diff --output-indicator-new', 'git diff --output-indicator-new=+ main...HEAD', 'allow');
    crBash('git branch -D', 'git branch -D epic/E1-x', 'deny:agent');
    crBash('git branch with a new name', 'git branch other', 'deny:agent');
    crBash('2>&1 then more', 'git status 2>&1; git push', 'deny:agent');
    crBash('git with a config option', 'git -c core.pager=less log', 'deny:agent');
    crBash('git diff into a file', 'git diff --output=x.patch main', 'deny:agent');
    crBash('git log into a file', 'git log --output x.txt', 'deny:agent');
    crBash('git diff with an external tool', 'git diff --ext-diff main', 'deny:agent');
    crBash('git in another folder', `git -C "${fwd(dir)}" log`, 'deny:agent');
    crBash('two commands', 'git status; git push', 'deny:agent');
    crBash('a pipe', 'git log | head', 'deny:agent');
    crBash('npm test', 'npm test', 'deny:agent');
    crBash('merge.mjs', `node "${P}/scripts/merge.mjs" --change`, 'deny:agent');
    crBash('rm', 'rm docs/reviews/E1-x.md', 'deny:agent');
    crWrite('its review file', join(project, 'docs', 'reviews', 'E1-x.md'), 'allow');
    crWrite('a bug fix\'s review file', join(project, 'docs', 'reviews', 'BUG-3.md'), 'allow');
    crWrite('Edit its review file', join(project, 'docs', 'reviews', 'E1-x.md'), 'allow', 'Edit');
    crWrite('a review file in a subfolder', join(project, 'docs', 'reviews', 'old', 'E1-x.md'), 'deny:agent');
    crWrite('the code', join(project, 'src', 'app.js'), 'deny:agent');
    crWrite('Edit the code', join(project, 'src', 'app.js'), 'deny:agent', 'Edit');
    crWrite('the plan review', join(project, 'docs', 'PLAN-REVIEW.md'), 'deny:agent');
    crWrite('a review file outside docs', join(project, 'reviews', 'E1-x.md'), 'deny:agent');
    reviewer('Write a code review file', 'Write', { file_path: join(project, 'docs', 'reviews', 'E1-x.md'), content: 'x' }, 'deny:agent');
    // The implementers write the code and run the gate, never the review status.
    expect('implementer-pre-tool-use-bash', 'implementer runs review-status.mjs', { input: { tool_input: { command: codeStatus } } }, 'deny:review');
    expect('implementer-pre-tool-use-bash', 'implementer runs the gate', { input: { tool_input: { command: 'bash scripts/gate --fast' } } }, 'allow');
    expect('implementer-pre-tool-use-bash', 'implementer commits', { input: { tool_input: { command: 'git commit -m "feat: the reminder"' } } }, 'allow');
    expect('implementer-pre-tool-use-write', 'implementer writes code', { input: { tool_input: { file_path: join(project, 'src', 'b.js'), content: 'x' } } }, 'allow');
    expect('implementer-pre-tool-use-write', 'implementer writes a review file', { input: { tool_input: { file_path: join(project, 'docs', 'reviews', 'E1-x.md'), content: 'x' } } }, 'allow');

    // T3b-AC6: merge-choice.mjs records the owner's choice, so no agent runs it, the main conversation included.
    const choice = `node "${P}/scripts/merge-choice.mjs" --allow`;
    bash(choice, 'deny:owner');
    bash(`node "${P}/scripts/merge-choice.mjs" --deny`, 'deny:owner');
    bash(`cd "${fwd(project)}" && ${choice}`, 'deny:owner');
    bash(`node ${P}/scripts/merge-choice.mjs --allow --project .`, 'deny:owner');
    bash(`node -e "import('${P}/scripts/merge-choice.mjs')"`, 'deny:switch');
    bash(`cat "${P}/scripts/merge-choice.mjs"`, 'allow');
    bash(`grep -n allow "${P}/scripts/merge-choice.mjs"`, 'allow');
    bash(`node "${P}/scripts/merge.mjs" --change`, 'allow');
    bash(`node "${P}/scripts/merge.mjs" --change --owner-approved`, 'allow');
    expect('implementer-pre-tool-use-bash', 'implementer runs merge-choice.mjs', { input: { tool_input: { command: choice } } }, 'deny:owner');
    expect('other-plugin-pre-tool-use-bash', 'another plugin\'s agent runs merge-choice.mjs', { input: { tool_input: { command: choice } } }, 'deny:owner');
    crBash('merge-choice.mjs', choice, 'deny:agent');

    // T4a-AC1, L-12: no git command throws away uncommitted work; the same commands pass on a clean tree.
    const w = makeProject('l12');
    gitIn(w, 'branch', 'other');
    mkdirSync(join(w, 'src'), { recursive: true });
    writeFileSync(join(w, 'src', 'my file.js'), 'export const a = 1;\n');
    gitIn(w, 'add', 'src');
    gitIn(w, 'commit', '-qm', 'a file with a space in its name');
    const W = (command, want, extra = {}) => bash(command, want, { projectDir: w, ...extra });
    const onClean = ['git checkout -- CLAUDE.md', 'git checkout .', 'git restore CLAUDE.md', 'git reset --hard', 'git clean -fd', 'git stash drop', 'git checkout -f other'];
    for (const c of onClean) W(c, 'allow');
    writeFileSync(join(w, 'CLAUDE.md'), `${readFileSync(join(w, 'CLAUDE.md'), 'utf8')}\nchanged\n`);
    writeFileSync(join(w, 'src', 'my file.js'), 'export const a = 2;\n');
    writeFileSync(join(w, 'new.js'), 'console.log(1)\n');
    mkdirSync(join(w, 'newdir'), { recursive: true });
    writeFileSync(join(w, 'newdir', 'n2.js'), 'console.log(2)\n');
    for (const c of [
      'git checkout -- CLAUDE.md', 'git checkout CLAUDE.md', 'git checkout .', 'git checkout HEAD -- CLAUDE.md', 'git checkout -f other', 'git checkout -fq other', 'git switch -f other', 'git switch --discard-changes other',
      'git restore CLAUDE.md', 'git restore .', 'git restore -SW CLAUDE.md', 'git restore --source=HEAD CLAUDE.md', 'git reset --hard', 'git reset --hard HEAD', 'git clean -fd', 'git clean -f', 'git clean -f new.js',
      'git status; git checkout -- CLAUDE.md', 'git fetch origin && git reset --hard origin/main', `git -C "${w}" checkout -- CLAUDE.md`, `git -C "${fwd(w)}" reset --hard`,
      `cd "${w}" && git checkout -- "${join(w, 'CLAUDE.md')}"`, `git checkout -- "${join(w, 'CLAUDE.md')}"`, 'cd src && git checkout -- "my file.js"',
      // Review round 1: what a stash or a commit earlier in the line kept is all it kept (no new files without -u, the paths it named, the index).
      'git stash && git clean -fd', 'git commit -am wip && git clean -fd', 'git add CLAUDE.md && git commit -m x && git checkout -- .', 'git stash push -- CLAUDE.md && git checkout -- "src/my file.js"',
      'git commit -m x -- CLAUDE.md && git reset --hard', 'git add -A && git reset --hard', 'git stash && git stash drop',
      // Review round 2: a folder Claude Code names; paths only the run knows stand for the whole tree; a stash popped is back in the tree.
      'cd "$CLAUDE_PROJECT_DIR" && git checkout -- .', 'cd $CLAUDE_PROJECT_DIR/src && git checkout -- "my file.js"',
      'git diff --name-only | xargs git checkout --', 'git diff --name-only | xargs git restore', 'git ls-files -m | xargs -I{} git checkout -- {}', 'git checkout -- $(git diff --name-only)',
      'git restore $(git diff --name-only)', 'for f in CLAUDE.md; do git checkout -- "$f"; done', 'git ls-files --others --exclude-standard | xargs git clean -f --',
      'git stash && git stash pop && git checkout -- .', 'git add -A && git reset && git clean -f', 'mkdir fresh && cd fresh && git reset --hard',
    ]) W(c, 'deny:uncommitted');
    for (const c of ['Set-Location $env:CLAUDE_PROJECT_DIR; git reset --hard', 'git diff --name-only | ForEach-Object { git checkout -- $_ }']) W(c, 'deny:uncommitted', { tool: 'PowerShell' });
    // A folder the guard follows: its repository's top, a variable the line sets to a plain path (review round 3).
    for (const c of ['cd "$(git rev-parse --show-toplevel)" && git reset --hard', 'git -C "$(git rev-parse --show-toplevel)" reset --hard', 'ROOT=$(git rev-parse --show-toplevel); cd "$ROOT" && git clean -fd', `S=${fwd(w)}; cd $S/src && git checkout -- "my file.js"`]) W(c, 'deny:uncommitted');
    W('$root = git rev-parse --show-toplevel; Set-Location $root; git reset --hard', 'deny:uncommitted', { tool: 'PowerShell' });
    // A folder it cannot follow: a read that fails refuses (review round 2), for a command that can throw work away only (review round 3).
    for (const c of ['cd "$(mktemp -d)" && git reset --hard', 'for d in src docs; do git -C "$d" checkout -- .; done']) W(c, 'deny:broken');
    for (const c of [
      'cd "$(git rev-parse --show-toplevel)" && git status', 'git -C "$(git rev-parse --show-toplevel)" status', 'cd "$(mktemp -d)" && git init -q && git commit --allow-empty -m x',
      'git init newrepo && cd newrepo && git add . && git commit -m init', 'mkdir scratchx && cd scratchx && git init -q && git checkout -b main', 'for d in src docs; do git -C "$d" status; done',
      'npm create vite@latest web -- --template react && cd web && git add . && git commit -m "feat: web"', 'git checkout other --', 'git checkout -q other --', 'git checkout -b feat/x --',
      'mkdir -p ../rt-x && cd ../rt-x && git init -q && git checkout -- .', 'cd "$(mktemp -d)" && git init -q && git reset --hard',
    ]) W(c, 'allow');
    W('$root = git rev-parse --show-toplevel; Set-Location $root; git status', 'allow', { tool: 'PowerShell' });
    // Review round 4: a PowerShell assignment keeps its name, so its value is never read as a program.
    for (const c of ["$p = '.claude/pitwall.json'; (Get-Content $p | ConvertFrom-Json).autoMerge", '$s = "$env:USERPROFILE/.claude/settings.json"; Get-Content $s', "$e = '.env'; if (Test-Path $e) { 'present' }", `$m = '${P}/scripts/merge.mjs'; node $m --change`, "$f = 'CLAUDE.md'; $f = 'docs/IDEA.md'; git checkout -- $f"]) W(c, 'allow', { tool: 'PowerShell' });
    for (const c of ["$f = 'CLAUDE.md'; git checkout -- $f", "$f='CLAUDE.md'; git checkout -- $f"]) W(c, 'deny:uncommitted', { tool: 'PowerShell' });
    W('S=.claude; echo x > $S/settings.json', 'deny:switch');
    // Review round 5: a variable the shell splits, a list or a command's output holds paths only the run knows; so does a loop's.
    for (const c of ['P="CLAUDE.md docs/IDEA.md"; git checkout -- $P', 'P="new.js docs/IDEA.md"; git clean -f $P', 'F=docs/IDEA.md; for F in $(git diff --name-only); do git checkout -- "$F"; done', 'git diff --name-only | while read f; do git checkout -- "$f"; done']) W(c, 'deny:uncommitted');
    for (const c of ["$p = 'CLAUDE.md','docs/IDEA.md'; git checkout -- $p", "$p = @('CLAUDE.md','docs/IDEA.md'); git checkout -- $p", "$f = 'docs/IDEA.md'; $f = git diff --name-only; git checkout -- $f"]) W(c, 'deny:uncommitted', { tool: 'PowerShell' });
    for (const c of ['F=docs/IDEA.md; git checkout -- $F', 'cd "$WT" && git checkout -q --detach "$(git rev-parse HEAD)"']) W(c, 'allow');
    // git rm --cached over paths only the run knows may take any file out of the index; "." is never a branch;
    // a folder git init found there is no new repository; in a folder mkdir made, paths are read from there.
    for (const c of ['git rm --cached $(git ls-files -i -c --exclude-standard) && git checkout -- .', 'git ls-files -i -c --exclude-standard | xargs git rm --cached && git checkout -- .', 'mkdir -p out && cd out && git checkout -- ../CLAUDE.md']) W(c, 'deny:uncommitted');
    for (const c of ['cd "$UNKNOWN" && git checkout .', 'git init -q && cd "$UNKNOWN" && git reset --hard']) W(c, 'deny:broken');
    for (const c of ['cd "$UNKNOWN" && git checkout feat/x', 'mkdir -p out && cd out && git clean -f', 'mkdir -p out && cd out && git checkout -- .']) W(c, 'allow');
    for (const c of [
      'git checkout other', 'git checkout -b feature', 'git switch other', 'git restore --staged CLAUDE.md', 'git clean -n', 'git clean -nd', 'git reset --soft HEAD', 'git reset HEAD CLAUDE.md',
      'git diff', 'git status', 'git stash list', 'git stash push -- CLAUDE.md && git checkout -- CLAUDE.md', 'git stash push -u -- new.js', 'git add -A && git commit -m "wip" && git reset --hard HEAD~1',
      'git checkout -- docs/IDEA.md', 'git clean -fd docs', 'git add -A && git stash && git clean -fd', 'git stash -u && git clean -fd', 'git commit -am wip && git checkout -- .',
      'git stash push -- CLAUDE.md "src/my file.js" && git checkout -- .', 'git add . && git checkout -- .', 'git add new.js newdir && git clean -fd', 'git commit -m x -- CLAUDE.md "src/my file.js" && git reset --hard',
      'cd src && git stash push -- "my file.js" && cd .. && git checkout -- "src/my file.js"', 'git -C src stash && git reset --hard', 'git stash save wip && git reset --hard',
      // A repository the line makes holds no work yet.
      'git worktree add ../wt-x other && cd ../wt-x && git checkout -- CLAUDE.md', 'git clone ../origin.git copy && cd copy && git checkout -- CLAUDE.md',
      // A path Git Bash spells /c/... (review round 2).
      ...(process.platform === 'win32' ? [`git stash push -- /${fwd(w)[0].toLowerCase()}${fwd(w).slice(2)}/CLAUDE.md && git checkout -- CLAUDE.md`] : []),
    ]) W(c, 'allow');
    if (process.platform === 'win32') W(`git checkout -- /${fwd(w)[0].toLowerCase()}${fwd(w).slice(2)}/CLAUDE.md`, 'deny:uncommitted');
    W('git stash push -- CLAUDE.md; if ($?) { git checkout -- CLAUDE.md }', 'allow', { tool: 'PowerShell' });
    const said = hook('main-pre-tool-use-bash', { projectDir: w, input: { tool_input: { command: 'git checkout -- CLAUDE.md' } } }).out?.hookSpecificOutput?.permissionDecisionReason ?? '';
    if (!/git stash push -- CLAUDE\.md/.test(said) || !/commit/.test(said) || !/L-12/.test(said)) report(`the refusal must name the files and offer git stash push -- <files> or a commit (owner's edit): ${said}`);
    const saidNew = hook('main-pre-tool-use-bash', { projectDir: w, input: { tool_input: { command: 'git clean -fd' } } }).out?.hookSpecificOutput?.permissionDecisionReason ?? '';
    if (!/git stash push -u -- new\.js/.test(saidNew)) report(`the refusal of git clean must offer git stash push -u for the new files: ${saidNew}`);
    W('git checkout -- CLAUDE.md', 'deny:uncommitted', { tool: 'PowerShell' });
    expect('implementer-pre-tool-use-bash', 'implementer: git checkout -- CLAUDE.md on a dirty tree', { projectDir: w, input: { tool_input: { command: 'git checkout -- CLAUDE.md' } } }, 'deny:uncommitted');
    expect('implementer-pre-tool-use-bash', 'implementer: git stash push -- CLAUDE.md', { projectDir: w, input: { tool_input: { command: 'git stash push -- CLAUDE.md' } } }, 'allow');
    // A stash holds uncommitted work too.
    gitIn(w, 'stash', 'push', '-q', '-u', '--', 'CLAUDE.md', 'new.js');
    for (const c of ['git stash drop', 'git stash clear', 'git stash drop stash@{0}', 'git stash drop -q', 'git stash drop 0']) W(c, 'deny:uncommitted');
    for (const c of ['git stash pop', 'git stash apply', 'git stash drop stash@{3}', 'git stash drop 3', 'git checkout -- CLAUDE.md']) W(c, 'allow');
    W('git reset --hard', 'deny:uncommitted');
    gitIn(w, 'stash', 'pop', '-q');
    // What a restore from the index leaves: a change already staged, a file only deleted.
    gitIn(w, 'add', 'CLAUDE.md');
    gitIn(w, 'stash', 'push', '-q', '-u', '--', 'src', 'new.js', 'newdir');
    rmSync(join(w, 'docs', 'IDEA.md'));
    for (const c of ['git checkout -- CLAUDE.md', 'git restore CLAUDE.md', 'git restore --source=HEAD CLAUDE.md', 'git checkout -- docs/IDEA.md', 'git restore docs/IDEA.md']) W(c, 'allow');
    for (const c of ['git checkout HEAD -- CLAUDE.md', 'git restore -SW CLAUDE.md', 'git reset --hard']) W(c, 'deny:uncommitted');
    // Unstaged first, the staged change is thrown away by a restore from the index (review round 2); unstaging alone keeps it.
    for (const c of ['git reset HEAD CLAUDE.md && git checkout -- CLAUDE.md', 'git restore --staged CLAUDE.md && git restore CLAUDE.md', 'git reset -q && git checkout -- .', 'git reset && git restore .', 'git rm --cached -q CLAUDE.md && git clean -f']) W(c, 'deny:uncommitted');
    W('git reset HEAD CLAUDE.md; git checkout -- CLAUDE.md', 'deny:uncommitted', { tool: 'PowerShell' });
    // A path git rm --cached took out of the index is no longer one git checkout restores (review round 3).
    for (const c of ['git reset HEAD CLAUDE.md', 'git restore --staged CLAUDE.md', 'git reset && git add -A && git checkout -- .', 'git rm --cached -q CLAUDE.md && git checkout -- CLAUDE.md']) W(c, 'allow');
    // A file staged as new and unstaged is untracked again: git clean deletes it, a restore leaves it (review round 3).
    writeFileSync(join(w, 'new2.js'), 'console.log(3)\n');
    gitIn(w, 'add', 'new2.js');
    for (const c of ['git reset && git clean -f', 'git restore --staged new2.js && git clean -f', 'git rm --cached new2.js && git clean -f', 'git reset -- new2.js && git stash && git clean -f']) W(c, 'deny:uncommitted');
    for (const c of ['git clean -f', 'git reset -- new2.js && git checkout -- new2.js']) W(c, 'allow');
    gitIn(w, 'rm', '-q', '-f', '--', 'new2.js');
    gitIn(w, 'checkout', '--', 'docs/IDEA.md');
    // A merge conflict resolved the usual way (review round 1): the conflicted path is the merge's, not uncommitted work.
    gitIn(w, 'commit', '-qm', 'the staged change');
    gitIn(w, 'switch', '-qc', 'side');
    writeFileSync(join(w, 'CLAUDE.md'), 'side\n');
    gitIn(w, 'commit', '-qam', 'side');
    gitIn(w, 'switch', '-q', 'main');
    writeFileSync(join(w, 'CLAUDE.md'), 'mainline\n');
    gitIn(w, 'commit', '-qam', 'main');
    gitIn(w, 'merge', 'side');
    writeFileSync(join(w, 'src', 'my file.js'), 'export const a = 2;\n');
    if (!/^UU CLAUDE\.md$/m.test(gitIn(w, 'status', '--short').stdout)) report(`the conflict case needs CLAUDE.md in conflict: ${gitIn(w, 'status', '--short').stdout}`);
    for (const c of ['git checkout --theirs CLAUDE.md', 'git checkout --ours -- CLAUDE.md', 'git restore --theirs CLAUDE.md', 'git checkout -m CLAUDE.md', 'git merge --abort']) W(c, 'allow');
    for (const c of ['git checkout --theirs -- "src/my file.js"', 'git reset --hard']) W(c, 'deny:uncommitted');
    // In a merge, the refusal names its --abort (review round 2): git stash refuses unmerged paths.
    const saidMerge = hook('main-pre-tool-use-bash', { projectDir: w, input: { tool_input: { command: 'git reset --hard' } } }).out?.hookSpecificOutput?.permissionDecisionReason ?? '';
    if (!/A merge is in progress: git merge --abort/.test(saidMerge)) report(`the refusal in a merge must name git merge --abort: ${saidMerge}`);
    gitIn(w, 'merge', '--abort');
    // A tree git cannot read refuses, as the other guards do.
    rmSync(join(w, '.git'), { recursive: true, force: true });
    W('git checkout -- CLAUDE.md', 'deny:broken');

    // AC7: the merge guard by mode.
    bash('gh pr merge 7 --merge', 'deny:merge');
    const pr = { number: 7, head, branch: 'epic/E1-x' };
    const green = { auth: true, repo: { nameWithOwner: 'o/r' }, pr, statuses: { 'ai-review': 'success' }, gate: 'success' };
    setMode('local-hook');
    const merge = (what, scenario, want, command = 'gh pr merge 7 --merge') => bash(command, want, { env: { FAKE_GH: JSON.stringify(scenario) } });
    merge('both green', green, 'allow');
    merge('both green, by branch', green, 'allow', 'gh pr merge epic/E1-x --squash --delete-branch');
    merge('ai-review not set', { ...green, statuses: {} }, 'deny:merge');
    merge('ai-review failed', { ...green, statuses: { 'ai-review': 'failure' } }, 'deny:merge');
    merge('gate red', { ...green, gate: 'failure' }, 'deny:merge');
    merge('gate running', { ...green, gate: 'pending' }, 'deny:merge');
    merge('gate from another app', { ...green, gateApp: 1 }, 'deny:merge');
    merge('no PR', { ...green, pr: null }, 'deny:merge');
    merge('statuses unreadable', { ...green, reads: 'statuses' }, 'deny:merge');
    merge('check runs unreadable', { ...green, reads: 'check-runs' }, 'deny:merge');
    merge('an API merge', green, 'deny:merge', 'gh api -X PUT repos/o/r/pulls/7/merge');
    setMode('branch-protection');
    merge('branch protection', { ...green, statuses: {} }, 'allow');
    merge('branch protection, --admin', green, 'deny:protection', 'gh pr merge 7 --admin');
    setMode('something else');
    merge('an unknown mode', green, 'deny:merge');
    setMode(undefined);
    merge('no mode recorded', green, 'deny:merge');
    setMode('pending');

    // AC5: the call budget. A researcher at lite: warned once at warn, refused past stop; its handback always passes.
    const lite = cfg.budgets.researcherToolCalls.lite;
    const rs = 'budget-researcher';
    mkdirSync(join(state, rs), { recursive: true });
    writeFileSync(join(state, rs, 'agent-recorded-researcher.calls'), '.'.repeat(lite.warn - 2));
    const seen = [];
    for (let i = lite.warn - 1; i <= lite.stop + 1; i += 1) seen.push(`${i}:${verdict(hook('researcher-pre-tool-use-glob', { session: rs, input: { tool_input: { pattern: 'docs/*.md' } } }))}`);
    const want = [];
    for (let i = lite.warn - 1; i <= lite.stop + 1; i += 1) want.push(`${i}:${i === lite.warn ? 'context' : i > lite.stop ? 'deny:budget' : 'allow'}`);
    if (seen.join(' ') !== want.join(' ')) report(`researcher budget: expected ${want.join(' ')}\n  got ${seen.join(' ')}`);
    expect('researcher-pre-tool-use-glob', 'a researcher past its budget hands back', { session: rs, tool: 'SubagentHandback', input: { tool_input: {} } }, 'allow');
    // The main conversation: warned at warn and at stop; refused past stop only when unattended.
    const s = cfg.budgets.sessionToolCalls;
    // A session that has made calls - 1 calls (and had the warnings that go with them) makes one more.
    const mainBudget = (attended, calls, want, what) => {
      const sid = `budget-main-${(sessions += 1)}`;
      mkdirSync(join(state, sid), { recursive: true });
      writeFileSync(join(state, sid, 'main.calls'), '.'.repeat(calls - 1));
      if (calls > s.warn) writeFileSync(join(state, sid, 'main.warned'), '');
      if (calls > s.stop) writeFileSync(join(state, sid, 'main.stopped'), '');
      const r = hook('main-pre-tool-use-read', { session: sid, env: { CLAUDE_CODE_SESSION_ATTENDED: attended }, input: { tool_input: { file_path: join(project, 'docs', 'IDEA.md') } } });
      if (verdict(r) !== want) report(`${what}: expected ${want}, got ${verdict(r)}`);
    };
    mainBudget('1', s.warn, 'context', 'main conversation at warn');
    mainBudget('1', s.stop, 'context', 'main conversation at stop');
    mainBudget('1', s.stop + 1, 'allow', 'attended main conversation past stop');
    mainBudget('0', s.stop + 1, 'deny:budget', 'unattended main conversation past stop');
    mainBudget(undefined, s.stop + 1, 'allow', 'main conversation past stop, attendance unknown');

    // AC6: the gate after edits and before stopping.
    writeFileSync(join(project, 'src.js'), 'console.log(1)\n');
    const post = (session, extra = {}) => hook('main-post-tool-use-write', { session, input: { tool_input: { file_path: join(project, 'src.js'), content: 'x' }, ...extra } });
    if (verdict(post('gate-main')) !== 'allow') report('an edit on main must not run the gate');
    gitIn(project, 'checkout', '-qb', 'epic/E1-x');
    const red = post('gate-main');
    if (verdict(red) !== 'context' || !/gate --fast is red/.test(red.out.hookSpecificOutput.additionalContext)) report(`an edit on an epic branch with a red gate: expected the gate's report, got ${verdict(red)}`);
    if (verdict(hook('main-post-tool-use-write', { session: 'gate-docs', input: { tool_input: { file_path: join(project, 'docs', 'NOTES.md') } } })) !== 'allow') report('an edit under docs/ must not run the gate');
    const stops = [1, 2, 3, 4].map((i) => verdict(hook('main-stop', { session: 'gate-main', input: { stop_hook_active: i > 1 } })));
    if (stops.join(' ') !== 'block block message allow') report(`stops after an edit with a red gate: expected block block message allow, got ${stops.join(' ')}`);
    // The tries are used up until the gate is green: edits in between do not bring them back.
    post('gate-main');
    if (verdict(hook('main-stop', { session: 'gate-main' })) !== 'message') report('an edit after the tries are used up must not block the stop again while the gate is red');
    rmSync(join(project, 'src.js'));
    // An edit outside docs/ that leaves the gate green (the stub passes on CLAUDE.md): the next stop runs it, and the tries come back.
    hook('main-post-tool-use-write', { session: 'gate-main', input: { tool_input: { file_path: join(project, 'CLAUDE.md') } } });
    if (verdict(hook('main-stop', { session: 'gate-main' })) !== 'allow') report('a green gate must let the session stop');
    if (verdict(hook('main-stop', { session: 'gate-main' })) !== 'allow' || existsSync(join(state, 'gate-main', 'main.dirty'))) report('after a green run, a stop must run nothing');
    writeFileSync(join(project, 'src.js'), 'console.log(1)\n');
    post('gate-main');
    if (verdict(hook('main-stop', { session: 'gate-main' })) !== 'block') report('after a green run, a red gate must block the stop again');
    if (verdict(hook('main-stop', { session: 'gate-none' })) !== 'allow') report('a stop with no edit must run nothing');
    // An implementer: Claude Code ends it at its handback, so the handback waits for the gate.
    const impl = payloads['implementer-pre-tool-use-subagenthandback'].input;
    post('gate-sub', { agent_id: impl.agent_id, agent_type: impl.agent_type });
    const handbacks = [1, 2, 3].map(() => verdict(hook('implementer-pre-tool-use-subagenthandback', { session: 'gate-sub' })));
    if (handbacks.join(' ') !== 'deny:gate deny:gate message') report(`an implementer handing back after an edit with a red gate: expected deny:gate deny:gate message, got ${handbacks.join(' ')}`);
    if (verdict(hook('implementer-subagent-stop', { session: 'gate-sub' })) !== 'allow') report('an implementer\'s stop after its handback check must run nothing');
    post('gate-sub2', { agent_id: impl.agent_id, agent_type: impl.agent_type });
    if (verdict(hook('implementer-subagent-stop', { session: 'gate-sub2' })) !== 'block') report('an implementer that ends without a handback after an edit with a red gate must be blocked');
    const helper = payloads['other-plugin-post-tool-use-write'].input;
    hook('other-plugin-post-tool-use-write', { session: 'gate-other', input: { tool_input: { file_path: join(project, 'src.js'), content: 'x' } } });
    for (const label of ['other-plugin-pre-tool-use-subagenthandback', 'other-plugin-subagent-stop']) if (verdict(hook(label, { session: 'gate-other' })) !== 'allow') report(`${label}: another plugin's agent must not wait for the gate`);
    if (verdict(hook('main-stop', { session: 'gate-other' })) !== 'block') report(`an edit by another plugin's agent (${helper.agent_type}) must be checked when the main conversation stops`);
    // T3b: a bug fix's branch is checked like an epic's (loop.branches); the code reviewer's file under docs/ is not.
    gitIn(project, 'checkout', '-qb', 'fix/BUG-1');
    if (verdict(post('gate-fix')) !== 'context') report('an edit on a fix branch with a red gate must run the gate');
    if (verdict(hook('code-reviewer-post-tool-use-write', { session: 'gate-fix-review', input: { tool_input: { file_path: join(project, 'docs', 'reviews', 'BUG-1.md'), content: 'x' } } })) !== 'allow') report('the code reviewer\'s file under docs/ must not run the gate');
    const implPost = hook('implementer-post-tool-use-write', { session: 'gate-fix-impl', input: { tool_input: { file_path: join(project, 'src.js'), content: 'x' } } });
    if (verdict(implPost) !== 'context') report('an implementer\'s edit on a fix branch with a red gate must run the gate');
    rmSync(join(project, 'src.js'));
    gitIn(project, 'checkout', '-q', 'main');
    // Every recorded payload not used above passes in a project with nothing to refuse.
    for (const label of ['main-pre-tool-use-agent', 'plan-reviewer-post-tool-use-write', 'plan-reviewer-pre-tool-use-subagenthandback', 'plan-reviewer-subagent-stop', 'researcher-pre-tool-use-subagenthandback', 'researcher-subagent-stop', 'project-agent-pre-tool-use-subagenthandback', 'project-agent-subagent-stop', 'implementer-subagent-stop', 'code-reviewer-pre-tool-use-subagenthandback', 'code-reviewer-subagent-stop', 'code-reviewer-post-tool-use-write']) {
      const r = hook(label);
      if (verdict(r) !== 'allow') report(`${label} as recorded: expected allow, got ${verdict(r)} ${JSON.stringify(r.out)}`);
    }

    // AC2 and AC1: the brief and the self-test.
    const brief = hook('main-session-start', { env: { CLAUDE_CODE_SESSION_ATTENDED: '1' } });
    const text = brief.out?.hookSpecificOutput?.additionalContext ?? '';
    for (const part of ['pitwall brief', 'process level lite', 'merge protection pending', 'Branch: main', 'E0', 'E0-AC1', 'never refused', 'self-test passed']) if (!text.includes(part)) report(`the brief does not say "${part}":\n${text}`);
    if (brief.out?.systemMessage) report(`a passing self-test must not warn the owner: ${brief.out.systemMessage}`);
    if (text.length > cfg.hooks.briefMaxChars) report(`the brief is ${text.length} characters, over hooks.briefMaxChars`);
    if (!(hook('main-session-start').out?.hookSpecificOutput?.additionalContext ?? '').includes('unattended')) report('the brief of an unattended session does not say so');
    // A file in a submodule: git check-ignore does not answer for it, and nothing refuses the write.
    const subSrc = join(dir, 'sub-src');
    mkdirSync(subSrc);
    gitIn(subSrc, 'init', '-q', '-b', 'main');
    gitIn(subSrc, 'commit', '-q', '--allow-empty', '-m', 'sub');
    gitIn(project, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', fwd(subSrc), 'vendor/sub');
    expect('main-pre-tool-use-write', 'Write into a submodule', { input: { tool_input: { file_path: join(project, 'vendor', 'sub', 'x.js'), content: 'x' } } }, 'allow');
    // Before kickoff's first commit, main has no commits: the brief still gives the planning stage.
    const unborn = join(dir, 'unborn');
    if (layOut(unborn).status !== 0) throw new Error('layout failed');
    gitIn(unborn, 'init', '-q', '-b', 'main');
    const early = hook('main-session-start', { projectDir: unborn }).out?.hookSpecificOutput?.additionalContext ?? '';
    if (!/Stage: planning/.test(early)) report(`the brief before the skeleton's commit must give the planning stage:\n${early}`);
    // While the plan is made, the brief gives the stage, not E0.
    // A docs folder the brief cannot read is said in the brief, and warns no one that the guards are off.
    const odd = makeProject('odd', 1);
    rmSync(join(odd, 'docs', 'spikes'), { recursive: true, force: true });
    writeFileSync(join(odd, 'docs', 'spikes'), 'not a folder');
    const oddBrief = hook('main-session-start', { projectDir: odd }).out;
    if (!/could not read the docs/.test(oddBrief?.hookSpecificOutput?.additionalContext ?? '') || oddBrief?.systemMessage) report(`a brief that cannot read the docs must say so in the brief alone: ${JSON.stringify(oddBrief)}`);
    const planning = hook('main-session-start', { projectDir: fresh }).out?.hookSpecificOutput?.additionalContext ?? '';
    if (!/Stage: planning on plan\/initial; the next stage is kickoff/.test(planning) || /Current epic/.test(planning)) report(`the brief of a project being planned must give its stage:\n${planning}`);

    // AC1: failing closed. A copy of the plugin breaks one part at a time.
    const copy = (name, breakIt) => {
      const c = join(dir, name);
      cpSync(plugin, c, { recursive: true });
      breakIt(c);
      return join(c, 'scripts', 'hook.mjs');
    };
    const brokenCases = [
      ['input that is not JSON', { stdin: 'not json' }],
      ['an old Node', { script: copy('old-node', (c) => writeFileSync(join(c, 'config', 'defaults.json'), readFileSync(join(c, 'config', 'defaults.json'), 'utf8').replace('"nodeMinMajor": 20', '"nodeMinMajor": 999'))) }],
      ['hook-events.mjs that does not load', { script: copy('no-events', (c) => writeFileSync(join(c, 'scripts', 'hook-events.mjs'), 'throw new Error("broken on purpose");\n')) }],
    ];
    // A part of the guard that cannot run (here git, missing from PATH) refuses and says how to turn pitwall off.
    const noGit = hook('main-pre-tool-use-write', { env: { PATH: '' }, input: { tool_input: { file_path: join(project, 'src', 'a.js'), content: 'x' } } });
    if (verdict(noGit) !== 'deny:broken' || !/claude plugin disable pitwall@pitwall --scope local/.test(noGit.out?.hookSpecificOutput?.permissionDecisionReason ?? '')) report(`a guard that cannot run git must refuse and say how to turn pitwall off: ${JSON.stringify(noGit.out)}`);
    // A gate slower than its time limit: reported once, not red, and not run again until the next edit.
    const slowHook = copy('slow-gate', (c) => {
      const f = join(c, 'config', 'defaults.json');
      writeFileSync(f, readFileSync(f, 'utf8').replace('"fast": 120', '"fast": 1').replace('"changed": 540', '"changed": 1'));
    });
    const slow = makeProject('slow', 2);
    gitIn(slow, 'checkout', '-qb', 'epic/E1-slow');
    writeFileSync(join(slow, 'scripts', 'gate'), '#!/usr/bin/env bash\nsleep 5\n');
    const slowPost = hook('main-post-tool-use-write', { script: slowHook, projectDir: slow, session: 'slow', input: { tool_input: { file_path: join(slow, 'src.js'), content: 'x' } } });
    if (!/did not finish/.test(slowPost.out?.hookSpecificOutput?.additionalContext ?? '')) report(`a slow gate after an edit must be reported as not finished: ${JSON.stringify(slowPost.out)}`);
    const slowStops = [1, 2].map(() => hook('main-stop', { script: slowHook, projectDir: slow, session: 'slow' }));
    if (!/did not finish/.test(slowStops[0].out?.systemMessage ?? '') || verdict(slowStops[1]) !== 'allow') report(`a slow gate before stopping: expected one report, then nothing, got ${slowStops.map((r) => verdict(r)).join(' ')}`);
    for (const [what, opts] of brokenCases) {
      const r = hook('main-pre-tool-use-bash', { ...opts, input: { tool_input: { command: 'ls' } } });
      const reason = r.out?.hookSpecificOutput?.permissionDecisionReason ?? '';
      if (verdict(r) !== 'deny:broken' || !reason.includes('run this yourself in a terminal, not through an agent') || !reason.includes('claude plugin disable pitwall@pitwall --scope local')) report(`the guard with ${what}: expected a refusal that says how to turn pitwall off, got ${verdict(r)} ${reason}`);
      const s2 = hook('main-session-start', opts);
      if (!s2.out?.systemMessage) report(`the session start with ${what} must warn the owner at once`);
      const p2 = hook('main-post-tool-use-write', { ...opts, input: { tool_input: { file_path: join(project, 'a.js') } } });
      if (p2.out?.hookSpecificOutput?.permissionDecision || p2.code !== 0) report(`the check after an edit with ${what} must fail open`);
    }
    const settingsFile = join(project, '.claude', 'pitwall.json');
    const good = readFileSync(settingsFile, 'utf8');
    writeFileSync(settingsFile, '{ not json');
    if (verdict(hook('main-pre-tool-use-bash', { input: { tool_input: { command: 'ls' } } })) !== 'deny:broken') report('a .claude/pitwall.json that does not parse must make the guard refuse');
    writeFileSync(settingsFile, good);
    const blind = copy('blind-guard', (c) => {
      const f = join(c, 'scripts', 'hook-guard.mjs');
      writeFileSync(f, readFileSync(f, 'utf8').replace('export function guard(call, ctx) {', 'export function guard(call, ctx) {\n  return null;'));
    });
    const st = hook('main-session-start', { script: blind });
    if (!/self-test/.test(st.out?.systemMessage ?? '')) report(`a guard that refuses nothing must fail the self-test and warn the owner, got ${JSON.stringify(st.out)}`);

    // T3b-AC6: the owner's choice in the brief, and its allow rules kept in step with it and with the plugin's path.
    const local = join(project, '.claude', 'settings.local.json');
    const setChoice = (v) => {
      const s = JSON.parse(readFileSync(settingsFile, 'utf8'));
      if (v === undefined) delete s.autoMerge;
      else s.autoMerge = v;
      writeFileSync(settingsFile, JSON.stringify(s, null, 2));
    };
    const rulesNow = () => (existsSync(local) ? JSON.parse(readFileSync(local, 'utf8')).permissions?.allow ?? [] : []);
    const briefWith = (opts = {}) => hook('main-session-start', opts).out?.hookSpecificOutput?.additionalContext ?? '';
    // The session's spelling of the plugin's folder and the same with forward slashes (one on POSIX).
    const rulesFor = (d) => [...new Set([d, d.split('\\').join('/')])].flatMap((x) => [`Bash(node "${x}/scripts/review-status.mjs" *)`, `Bash(node "${x}/scripts/merge.mjs" --change)`]);
    rmSync(local, { force: true });
    setChoice(undefined);
    if (!/has not chosen yet/.test(briefWith())) report('the brief of a project without autoMerge does not say the owner has not chosen yet');
    if (existsSync(local)) report('without a yes, the session start wrote .claude/settings.local.json');
    setChoice(true);
    const yes = briefWith({ env: { CLAUDE_PLUGIN_ROOT: plugin } });
    if (JSON.stringify(rulesNow()) !== JSON.stringify(rulesFor(plugin))) report(`on yes, the session start must write the two rules for the plugin's path, got ${JSON.stringify(rulesNow())}`);
    if (!/merge without the owner/.test(yes) || !/were written/.test(yes)) report(`the brief on yes does not say so, or that the rules were written:\n${yes}`);
    // The owner's own rules and settings stay, and a second start rewrites nothing.
    writeFileSync(local, JSON.stringify({ model: 'kept', permissions: { allow: ['Bash(npm test)', ...rulesFor(plugin)], deny: ['Bash(rm -rf *)'] } }, null, 2));
    const kept = readFileSync(local, 'utf8');
    briefWith({ env: { CLAUDE_PLUGIN_ROOT: plugin } });
    if (readFileSync(local, 'utf8') !== kept) report('a second session start rewrote .claude/settings.local.json that already held the rules');
    // The plugin moved (an update): the rules follow the path as the session spells it.
    briefWith({ env: { CLAUDE_PLUGIN_ROOT: link } });
    const moved = JSON.parse(readFileSync(local, 'utf8'));
    if (JSON.stringify(moved.permissions.allow) !== JSON.stringify(['Bash(npm test)', ...rulesFor(link)]) || moved.model !== 'kept' || moved.permissions.deny?.[0] !== 'Bash(rm -rf *)') report(`after the plugin moved, expected the owner's rule and the rules for the new path, got ${JSON.stringify(moved)}`);
    // A guard that does not work: no rules, and the brief says why.
    const blindBrief = briefWith({ script: blind });
    if (rulesNow().some((r) => /merge\.mjs|review-status\.mjs/.test(r)) || !/review guard does not work/.test(blindBrief)) report(`with a guard that refuses nothing, the rules must go and the brief say why, got ${JSON.stringify(rulesNow())}\n${blindBrief}`);
    // No: the rules go, everything else stays.
    briefWith({ env: { CLAUDE_PLUGIN_ROOT: plugin } });
    setChoice(false);
    const no = briefWith({ env: { CLAUDE_PLUGIN_ROOT: plugin } });
    if (JSON.stringify(rulesNow()) !== JSON.stringify(['Bash(npm test)']) || !/every merge waits for the owner/.test(no) || !/were removed/.test(no)) report(`on no, the rules must go and the owner's stay, got ${JSON.stringify(rulesNow())}\n${no}`);
    // A settings.local.json that does not read as settings is left alone, and the brief says so.
    setChoice(true);
    writeFileSync(local, '{ not json');
    if (!/does not parse/.test(briefWith()) || readFileSync(local, 'utf8') !== '{ not json') report('a .claude/settings.local.json that does not parse must be left alone and named in the brief');
    rmSync(local, { force: true });
    writeFileSync(settingsFile, good);

    // The commands in hooks.json, through bash as Claude Code runs them: nothing outside a pitwall
    // project, even without node; in one, the hook runs, and without node the guard refuses and the brief warns.
    const sh = (event, label, projectDir, { prefix = '', toolInput } = {}) => {
      const input = { ...JSON.parse(JSON.stringify(payloads[label].input).split('<project>').join(fwd(projectDir))), session_id: `sh-${event}`, cwd: projectDir, ...(toolInput ? { tool_input: toolInput } : {}) };
      const r = spawnSync('bash', ['-c', `${prefix}${commands[event].split('${CLAUDE_PLUGIN_ROOT}').join(fwd(plugin))}`], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: fwd(projectDir), PITWALL_HOOK_STATE: state } });
      return { code: r.status, stdout: r.stdout, stderr: r.stderr, out: r.stdout.trim() ? parseOut(r.stdout) : null };
    };
    const parseOut = (text) => {
      try {
        return JSON.parse(text);
      } catch {
        return { unparsed: text };
      }
    };
    const noNode = 'PATH=/nonexistent; ';
    const labels = { 'session-start': 'main-session-start', 'pre-tool-use': 'main-pre-tool-use-bash', 'post-tool-use': 'main-post-tool-use-write', stop: 'main-stop', 'subagent-stop': 'implementer-subagent-stop' };
    for (const [event, label] of Object.entries(labels)) {
      for (const prefix of ['', noNode]) {
        const r = sh(event, label, dir, { prefix, toolInput: { command: 'rm .claude/pitwall.json' } });
        if (r.code !== 0 || r.stdout !== '') report(`the ${event} command outside a pitwall project${prefix ? ', without node,' : ''}: exit ${r.code}, printed ${r.stdout}${r.stderr}`);
      }
    }
    if (!/pitwall brief/.test(sh('session-start', 'main-session-start', project).stdout)) report('the SessionStart command gives no brief in a pitwall project');
    if (!/Node\.js is not on PATH/.test(sh('session-start', 'main-session-start', project, { prefix: noNode }).out?.systemMessage ?? '')) report('the SessionStart command without node must warn the owner');
    if (verdict(sh('pre-tool-use', 'main-pre-tool-use-bash', project, { toolInput: { command: 'rm .claude/pitwall.json' } })) !== 'deny:switch') report('the PreToolUse command must run the guard in a pitwall project');
    const blocked = sh('pre-tool-use', 'main-pre-tool-use-bash', project, { prefix: noNode, toolInput: { command: 'ls' } });
    if (verdict(blocked) !== 'deny:broken' || !/claude plugin disable pitwall@pitwall --scope local/.test(blocked.out?.hookSpecificOutput?.permissionDecisionReason ?? '')) report(`the PreToolUse command without node must refuse and say how to turn pitwall off: ${blocked.stdout}${blocked.stderr}`);
    for (const event of ['post-tool-use', 'stop', 'subagent-stop']) {
      const r = sh(event, labels[event], project, { prefix: noNode });
      if (r.code !== 0 || r.stdout !== '') report(`the ${event} command without node must let the session go on: exit ${r.code}, printed ${r.stdout}${r.stderr}`);
    }
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
