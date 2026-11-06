#!/usr/bin/env node
// Lays the project template out in a folder: kickoff, stage 0 (T1-AC1).
//
//   node layout.mjs --check [--target <dir>]
//   node layout.mjs --name <project> --idea "<one line>" --level lite|standard|full [--target <dir>]
//
// Copies template/ into the target (default: the current folder), drops the
// .tmpl suffixes, fills the placeholders and writes .claude/pitwall.json with
// the process level and the plugin version (ADR-0006). It lays out new
// projects only: a folder that holds anything but .git is refused, and nothing
// is written. --check answers that question alone and writes nothing, so
// kickoff can ask it before the interview. Exit 0 laid out (or can be),
// 1 refused, 2 usage, 3 a template placeholder this script does not fill.

import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { config, listFiles, parseArgs, pluginVersion, projectPath, requireNode, templateRoot } from './lib.mjs';

requireNode();
const usage = 'node layout.mjs --check [--target <dir>] | --name <project> --idea "<one line>" --level lite|standard|full [--target <dir>]';
const args = parseArgs(process.argv.slice(2), { name: 'value', idea: 'value', level: 'value', target: 'value', check: 'switch' }, usage);
const cfg = config();
const bad = (msg) => {
  console.error(`layout: ${msg}\nusage: ${usage}`);
  process.exit(2);
};
const target = resolve(args.target ?? '.');

// Anything in the folder but .git means this is not a new project.
const present = existsSync(target) ? readdirSync(target).filter((e) => e !== '.git') : [];
if (present.length > 0) {
  const existing = present.includes('CLAUDE.md') || present.includes('docs');
  console.error(`layout: REFUSED - ${target} is not empty. pitwall lays out new projects only${existing ? ', and this looks like an existing project' : ''}; nothing was written.`);
  for (const e of present.slice(0, 20)) console.error(`  ${e}`);
  process.exit(1);
}
if (args.check) {
  if (args.name || args.idea || args.level) bad('--check takes only --target');
  console.log(`layout: ${target} can be laid out`);
  process.exit(0);
}

const levels = Object.keys(cfg.processLevels);
for (const key of ['name', 'idea', 'level']) if (!args[key]?.trim()) bad(`--${key} is required`);
if (!levels.includes(args.level)) bad(`--level must be one of ${levels.join(', ')}`);
for (const key of ['name', 'idea']) {
  if (/[\r\n]/.test(args[key])) bad(`--${key} must be one line`);
  if (args[key].includes('{{')) bad(`--${key} must not contain "{{"`);
}

const values = {
  PROJECT_NAME: args.name.trim(),
  ONE_LINE_IDEA: args.idea.trim(),
  PROCESS_LEVEL: args.level,
  TEMPLATE_VERSION: pluginVersion(),
  PLANNING_BRANCH: cfg.planning.branch,
};

// Build every file in memory first, so an error writes nothing.
const plan = listFiles(templateRoot).map((rel) => {
  const raw = readFileSync(join(templateRoot, rel));
  let body = raw;
  if (raw.includes('{{')) {
    let text = raw.toString('utf8');
    for (const [key, value] of Object.entries(values)) text = text.split(`{{${key}}}`).join(value);
    const left = /\{\{[A-Z_]+\}\}/.exec(text);
    if (left) {
      console.error(`layout: template/${rel} has a placeholder this script does not fill: ${left[0]}`);
      process.exit(3);
    }
    body = Buffer.from(text, 'utf8');
  }
  return { rel, dest: projectPath(rel), body, mode: statSync(join(templateRoot, rel)).mode };
});

for (const f of plan) {
  const out = join(target, f.dest);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, f.body);
  if (f.mode & 0o111) chmodSync(out, 0o755);
}
console.log(`layout: wrote ${plan.length} files into ${target}`);
for (const f of plan.filter((p) => p.rel !== p.dest)) console.log(`  ${f.rel} -> ${f.dest}`);
console.log(`layout: .claude/pitwall.json records level ${args.level}, template ${values.TEMPLATE_VERSION}, merge protection pending`);
