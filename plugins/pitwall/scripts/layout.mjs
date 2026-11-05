#!/usr/bin/env node
// Lays the project template out in a folder: kickoff, stage 0 (T1-AC1).
//
//   node layout.mjs --name <project> --idea "<one line>" --level lite|standard|full [--target <dir>]
//
// Copies template/ into the target (default: the current folder), drops the
// .tmpl suffixes, fills the placeholders and writes .claude/pitwall.json with
// the process level and the plugin version (ADR-0006). It never overwrites:
// a folder that already holds CLAUDE.md, docs/ or any file the template would
// write is refused, and nothing is written. Exit 0 laid out, 1 refused, 2 usage.

import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { config, exists, listFiles, parseArgs, pluginVersion, projectPath, requireNode, templateRoot } from './lib.mjs';

requireNode();
const usage = 'node layout.mjs --name <project> --idea "<one line>" --level lite|standard|full [--target <dir>]';
const args = parseArgs(process.argv.slice(2), { name: 'value', idea: 'value', level: 'value', target: 'value' }, usage);
const levels = Object.keys(config().processLevels);
const bad = (msg) => {
  console.error(`layout: ${msg}\nusage: ${usage}`);
  process.exit(2);
};
for (const key of ['name', 'idea', 'level']) if (!args[key]?.trim()) bad(`--${key} is required`);
if (!levels.includes(args.level)) bad(`--level must be one of ${levels.join(', ')}`);
for (const key of ['name', 'idea']) {
  if (/[\r\n]/.test(args[key])) bad(`--${key} must be one line`);
  if (args[key].includes('{{')) bad(`--${key} must not contain "{{"`);
}

const target = resolve(args.target ?? '.');
const values = {
  PROJECT_NAME: args.name.trim(),
  ONE_LINE_IDEA: args.idea.trim(),
  PROCESS_LEVEL: args.level,
  TEMPLATE_VERSION: pluginVersion(),
};

// Build every file in memory first, so a refusal or a template error writes nothing.
const plan = listFiles(templateRoot).map((rel) => {
  const raw = readFileSync(join(templateRoot, rel));
  let body = raw;
  if (raw.includes('{{')) {
    let text = raw.toString('utf8');
    for (const [key, value] of Object.entries(values)) text = text.split(`{{${key}}}`).join(value);
    const left = /\{\{[A-Z_]+\}\}/.exec(text);
    if (left) {
      console.error(`layout: template/${rel} has a placeholder this script does not fill: ${left[0]}`);
      process.exit(1);
    }
    body = Buffer.from(text, 'utf8');
  }
  return { rel, dest: projectPath(rel), body, mode: statSync(join(templateRoot, rel)).mode };
});

const conflicts = plan.map((f) => f.dest).filter((dest) => exists(target, dest));
for (const held of ['CLAUDE.md', 'docs']) if (exists(target, held) && !conflicts.includes(held)) conflicts.unshift(held);
if (conflicts.length > 0) {
  console.error(`layout: REFUSED - ${target} already holds files the template would write. pitwall lays out new projects only; nothing was written.`);
  for (const c of conflicts.slice(0, 20)) console.error(`  ${c}`);
  process.exit(1);
}

for (const f of plan) {
  const out = join(target, f.dest);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, f.body);
  if (f.mode & 0o111) chmodSync(out, 0o755);
}
console.log(`layout: wrote ${plan.length} files into ${target}`);
for (const f of plan.filter((p) => p.rel !== p.dest)) console.log(`  ${f.rel} -> ${f.dest}`);
console.log(`layout: .claude/pitwall.json records level ${args.level}, template ${values.TEMPLATE_VERSION}, merge protection pending`);
