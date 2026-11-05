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
// Needs Node 22, git, bash and the Claude Code CLI (`claude`) on the PATH, at least
// the version in .claude-code-version (the one CI installs).

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
    cpSync(join(plugin, 'template'), project, { recursive: true });
    for (const p of files(project).filter((f) => f.endsWith('.tmpl'))) {
      const base = p.split(/[\\/]/).pop().replace(/\.tmpl$/, '');
      const name = ['gitignore', 'editorconfig', 'gitattributes'].includes(base) ? `.${base}` : base;
      renameSync(p, join(dirname(p), name));
    }
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
