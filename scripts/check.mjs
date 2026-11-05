#!/usr/bin/env node
// Every check CI runs for pitwall (T0-AC5). Exit 0 is a pass.
//
// It runs the official validator first, then the repository's own rules:
// manifests parse and agree on the version, skills and agents are named after
// their files and unbuilt ones cannot trigger, the template is complete, its
// gate is executable in the git index, and it carries .tmpl suffixes where a
// tool would load a file (L-1), relative links resolve, no file holds an em
// dash or Cyrillic, and no skill or agent hardcodes a model ID. Characters
// these checks look for are built from code points (L-3).
//
// Needs Node 22 and the Claude Code CLI (`claude`) on the PATH.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
    // Unbuilt = the status line, or any wording that says so. Either way it must not trigger by itself.
    const unbuilt = /^> Status: planned/m.test(text) || /not (implemented|built)/i.test(text);
    if (unbuilt && fm['disable-model-invocation'] !== 'true') {
      report(`skills/${name}: not built yet but can trigger by itself (set disable-model-invocation: true)`);
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
  for (const p of files(plugin).filter((f) => /[\\/](skills|agents)[\\/]/.test(f) && f.endsWith('.md'))) {
    readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      if (modelId.test(line)) report(`${rel(p)}:${i + 1}: ${line.trim()}`);
    });
  }
});

console.log(failed === 0 ? '\nGATE: PASS' : `\nGATE: FAIL (${failed} step${failed === 1 ? '' : 's'})`);
process.exit(failed === 0 ? 0 : 1);
