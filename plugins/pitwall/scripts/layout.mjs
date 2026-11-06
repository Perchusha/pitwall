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
// is written. Claude Code's own .claude/settings.local.json and the files an
// operating system leaves behind do not count, and are never touched.
//
// --check is kickoff's preflight, asked before the interview and writing
// nothing: the folder, git, and the repository the folder is in. On exit 0 it
// prints a "NEXT:" line with the git command that sets the folder up, and
// "NOTE:" lines for the owner. Exit 0 laid out (or can be), 1 refused, 2 usage,
// 3 a template placeholder this script does not fill.

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { config, listFiles, parseArgs, pluginVersion, projectPath, requireNode, templateRoot } from './lib.mjs';

requireNode();
const usage = "node layout.mjs --check [--target <dir>] | --name <project> --idea '<one line>' --level lite|standard|full [--target <dir>]";
const args = parseArgs(process.argv.slice(2), { name: 'value', idea: 'value', level: 'value', target: 'value', check: 'switch' }, usage);
const cfg = config();
const bad = (msg) => {
  console.error(`layout: ${msg}\nusage: ${usage}`);
  process.exit(2);
};
const refuse = (msg, list = []) => {
  console.error(`layout: REFUSED - ${msg}; nothing was written.`);
  for (const e of list.slice(0, 20)) console.error(`  ${e}`);
  process.exit(1);
};
const target = resolve(args.target ?? '.');
if (existsSync(target) && !statSync(target).isDirectory()) bad(`${target} is a file, not a folder`);
if (args.check && (args.name || args.idea || args.level)) bad('--check takes only --target');

// Anything in the folder but .git means this is not a new project. Claude Code
// writes .claude/settings.local.json for a standing approval, and some systems
// drop their own files; neither makes a folder a project.
const IGNORED = new Set(['.claude/settings.local.json']);
const LITTER = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const present = existsSync(target) ? listFiles(target, ['.git']).filter((f) => !IGNORED.has(f) && !LITTER.has(f.split('/').pop())) : [];
if (present.length > 0) {
  const existing = present.some((f) => f === 'CLAUDE.md' || f.startsWith('docs/'));
  refuse(`${target} is not empty. pitwall lays out new projects only${existing ? ', and this looks like an existing project' : ''}`, present);
}

if (args.check) {
  const git = (...a) => spawnSync('git', ['-C', target, ...a], { encoding: 'utf8' });
  if (spawnSync('git', ['--version'], { encoding: 'utf8' }).error) refuse('git is not installed: install it from https://git-scm.com and run kickoff again');
  const same = (a, b) => {
    const norm = (p) => realpathSync(p).replace(/\\/g, '/').replace(/\/$/, '');
    return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
  };
  const top = existsSync(target) ? git('rev-parse', '--show-toplevel') : { status: 1 };
  let next = 'git init -b main';
  if (top.status === 0 && same(top.stdout.trim(), target)) {
    if (git('rev-parse', '--verify', '-q', 'HEAD').status === 0) refuse(`the repository in ${target} already has commits, and the skeleton must be the first commit on main`);
    next = 'git symbolic-ref HEAD refs/heads/main';
  } else if (top.status === 0) {
    console.log(`NOTE: ${target} is inside the repository at ${top.stdout.trim()}; kickoff starts a repository of its own here.`);
  }
  if (!git('config', 'user.email').stdout.trim()) {
    console.log('NOTE: git has no user.name and user.email here yet; the owner sets them (git config --global user.name, git config --global user.email) before the skeleton is committed.');
  }
  console.log(`layout: ${target} can be laid out`);
  console.log(`NEXT: ${next}`);
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
