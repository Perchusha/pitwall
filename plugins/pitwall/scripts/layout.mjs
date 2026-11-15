#!/usr/bin/env node
// Lays the project template out in a folder: kickoff, stage 0 (T1-AC1).
//
//   node layout.mjs --check [--target <dir>]
//   node layout.mjs --name <project> --idea "<one line>" --level lite|standard|full [--target <dir>]
//   node layout.mjs --hook [--target <dir>]
//
// Copies template/ into the target (default: the current folder), drops the
// .tmpl suffixes, fills the placeholders and writes .claude/pitwall.json with
// the process level and the plugin version (ADR-0006). It lays out new
// projects only: a folder that holds anything but .git is refused, and nothing
// is written. Claude Code's own .claude/settings.local.json and the files an
// operating system leaves behind do not count, and are never touched; nor does
// a .claude/settings.json that holds nothing the template's own does not, as a
// project-scope install of pitwall writes it, which the template's replaces.
//
// --check is kickoff's preflight, asked before the interview and writing
// nothing: the folder, git, and the repository the folder is in. On exit 0 it
// prints a "NEXT:" line with the git command that sets the folder up, and
// "NOTE:" lines for the owner. Exit 0 laid out (or can be), 1 refused, 2 usage,
// 3 a template placeholder this script does not fill.
//
// --hook gives a project laid out before T4d the template's gate before every
// commit (T4d-AC2): /pitwall:continue runs it on a new branch, right after the
// branch's first commit. It writes .githooks/pre-commit, commits it alone and
// executable (git on Windows drops the executable bit of a new file in a commit
// that names its paths), without running a hook on it, since the stub gate of
// such a project counts the hook as code and a red main may wait for the fix the
// branch is for; then it sets core.hooksPath to .githooks. A failure leaves the
// hook neither in the index nor, when this run wrote it, in the tree. Where
// the hook is in the index already, it only sets core.hooksPath. It refuses a
// hook that differs from the template, other staged changes, the branch the
// merge protection guards, and a core.hooksPath the owner set to another folder.

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { config, listFiles, parseArgs, pluginVersion, projectPath, requireNode, templateRoot } from './lib.mjs';

requireNode();
const usage = "node layout.mjs --check [--target <dir>] | --name <project> --idea '<one line>' --level lite|standard|full [--target <dir>] | --hook [--target <dir>]";
const args = parseArgs(process.argv.slice(2), { name: 'value', idea: 'value', level: 'value', target: 'value', check: 'switch', hook: 'switch' }, usage);
const cfg = config();
const bad = (msg) => {
  console.error(`layout: ${msg}\nusage: ${usage}`);
  process.exit(2);
};
const refuse = (msg, list = []) => {
  console.error(`layout: REFUSED - ${msg}; nothing was written.`);
  for (const e of list.slice(0, 20)) console.error(`  ${e}`);
  if (list.length > 20) console.error(`  and ${list.length - 20} more`);
  process.exit(1);
};
const target = resolve(args.target ?? '.');
if (existsSync(target) && !statSync(target).isDirectory()) bad(`${target} is a file, not a folder`);
if (args.check && (args.name || args.idea || args.level)) bad('--check takes only --target');
if (args.hook && (args.check || args.name || args.idea || args.level)) bad('--hook takes only --target');

// The same folder, as the file system and git spell it.
const same = (a, b) => {
  const real = (p) => {
    try {
      return realpathSync.native(p);
    } catch {
      return realpathSync(p);
    }
  };
  const norm = (p) => real(p).replace(/\\/g, '/').replace(/\/$/, '');
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
};

// The gate before every commit, for a project laid out before T4d (see the top of this file).
const HOOK = '.githooks/pre-commit';
const HOOKS_PATH = '.githooks';
if (args.hook) {
  const git = (...a) => spawnSync('git', ['-C', target, ...a], { encoding: 'utf8' });
  const fail = (msg) => {
    console.error(`layout --hook: REFUSED - ${msg}`);
    process.exit(1);
  };
  if (!existsSync(join(target, '.claude', 'pitwall.json'))) fail(`${target} is not a pitwall project: it has no .claude/pitwall.json`);
  const top = git('rev-parse', '--show-toplevel');
  if (top.status !== 0 || !same(top.stdout.trim(), target)) fail(`${target} is not the top folder of a git repository`);
  const setting = git('config', '--get', 'core.hooksPath').stdout.trim();
  if (setting && setting !== HOOKS_PATH) fail(`core.hooksPath is ${setting}, a folder of hooks the owner set: ask them before pitwall's hook replaces it (git config core.hooksPath ${HOOKS_PATH})`);
  const setPath = () => {
    if (setting === HOOKS_PATH) return;
    const r = git('config', 'core.hooksPath', HOOKS_PATH);
    if (r.status !== 0) fail(`git config core.hooksPath ${HOOKS_PATH} failed: ${r.stderr.trim()}`);
    console.log(`layout --hook: core.hooksPath is ${HOOKS_PATH}`);
  };
  if (git('ls-files', '--error-unmatch', '--', HOOK).status === 0) {
    console.log(`layout --hook: ${HOOK} is in the index already`);
    setPath();
    process.exit(0);
  }
  const branch = git('symbolic-ref', '--short', '-q', 'HEAD').stdout.trim();
  if (!branch) fail('HEAD names no branch: switch to the branch the hook goes on');
  if (branch === cfg.mergeProtection.branch) fail(`${branch} is the branch merge protection guards: the hook goes on the next branch, after its first commit`);
  if (git('rev-parse', '--verify', '-q', 'HEAD').status !== 0) fail(`${branch} has no commit yet: the hook goes in after the branch's first commit`);
  const staged = git('-c', 'core.quotePath=false', 'diff', '--cached', '--name-only').stdout.split('\n').filter((f) => f && f !== HOOK);
  if (staged.length) fail(`other changes are staged, and the hook's commit holds only the hook:\n  ${staged.slice(0, 20).join('\n  ')}`);
  const body = readFileSync(join(templateRoot, '.githooks', 'pre-commit'));
  const file = join(target, '.githooks', 'pre-commit');
  const had = existsSync(file);
  if (had && !readFileSync(file).equals(body)) fail(`${HOOK} exists and differs from pitwall's template; pitwall never overwrites a file`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
  chmodSync(file, 0o755);
  // A failure leaves nothing behind for the next commit to take: the hook leaves the index, and the file
  // too when this run wrote it.
  const undo = (msg) => {
    git('rm', '-q', '--cached', '--ignore-unmatch', '--', HOOK);
    if (!had) rmSync(file, { force: true });
    fail(msg);
  };
  const add = git('add', '--chmod=+x', '--', HOOK);
  if (add.status !== 0) undo(`git add ${HOOK} failed: ${add.stderr.trim()}`);
  // Without the hook it adds: this commit holds only the template's own file, and a gate that cannot pass yet
  // (the old stub counts the hook as code, or a red main waits for its fix) would refuse it (review round 1).
  const commit = git('commit', '-q', '--no-verify', '-m', `chore: the gate before every commit, from pitwall ${pluginVersion()}`);
  if (commit.status !== 0) undo(`git could not commit ${HOOK}: ${(commit.stderr || commit.stdout).trim()}`);
  console.log(`layout --hook: committed ${HOOK}, executable, on ${branch}: ${git('log', '-1', '--format=%h %s').stdout.trim()}`);
  setPath();
  process.exit(0);
}

// Anything in the folder but .git means this is not a new project. Claude Code
// writes .claude/settings.local.json for a standing approval, and some systems
// drop their own files; neither makes a folder a project.
const IGNORED = new Set(['.claude/settings.local.json']);
const LITTER = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
// A project-scope install of pitwall writes .claude/settings.json, which enables the plugin, and names its
// marketplace when that was added for the project too. A file that holds nothing the template's own does not
// makes no folder a project either: the layout writes the template's in its place, which holds all of it (BUG-14).
const SETTINGS = '.claude/settings.json';
const templateSettings = (() => {
  const rel = listFiles(templateRoot).find((f) => projectPath(f) === SETTINGS);
  return rel ? JSON.parse(readFileSync(join(templateRoot, rel), 'utf8')) : null;
})();
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// Every key of a is in b with the same value; an array or a plain value only as it is.
const within = (a, b) => (isObject(a) ? isObject(b) && Object.keys(a).every((k) => Object.hasOwn(b, k) && within(a[k], b[k])) : JSON.stringify(a) === JSON.stringify(b));
const installSettings = (() => {
  const file = join(target, SETTINGS);
  if (!templateSettings || !existsSync(file)) return false;
  try {
    const mine = JSON.parse(readFileSync(file, 'utf8').replace(new RegExp(`^${String.fromCodePoint(0xfeff)}`), ''));
    return isObject(mine) && within(mine, templateSettings);
  } catch {
    return false;
  }
})();
const present = existsSync(target)
  ? listFiles(target, ['.git']).filter((f) => !IGNORED.has(f) && !LITTER.has(f.split('/').pop()) && !(f === SETTINGS && installSettings))
  : [];
if (present.length > 0) {
  const existing = present.some((f) => f === 'CLAUDE.md' || f.startsWith('docs/'));
  if (present.length === 1 && present[0] === SETTINGS) {
    refuse(`${target} holds nothing but ${SETTINGS}, Claude Code's settings of this project, and they hold something the template's own does not, which enables pitwall and names its marketplace, or they do not parse. kickoff never overwrites them: move the file out of the folder and run kickoff again (when a new session no longer loads pitwall, install it for your user or for the project first), then bring back into the template's ${SETTINGS} what you need of yours`);
  }
  // The top folder of a repository with no commit: /pitwall:adopt refuses it too, so the refusal says what to do with the
  // files, or the owner goes between the two (BUG-15).
  const git = (...a) => spawnSync('git', ['-C', target, ...a], { encoding: 'utf8' });
  const top = git('rev-parse', '--show-toplevel');
  if (top.status === 0 && same(top.stdout.trim(), target) && git('rev-parse', '--verify', '-q', 'HEAD').status !== 0) {
    refuse(`${target} is not empty, and its repository has no commit yet. kickoff lays out an empty folder only, and /pitwall:adopt adopts a project with a commit: move these files out of the folder, or commit them, then run /pitwall:continue again (a commit leaves out what git ignores, which only kickoff needs moved)`, present);
  }
  refuse(`${target} is not empty. kickoff lays out new projects only${existing ? ', and this looks like an existing project' : ''}: an existing project is adopted with /pitwall:adopt, which keeps what is there`, present);
}
const settingsNote = `${SETTINGS} holds nothing the template's own does not, as a project-scope install of pitwall writes it: the layout writes the template's in its place.`;

if (args.check) {
  const git = (...a) => spawnSync('git', ['-C', target, ...a], { encoding: 'utf8' });
  if (spawnSync('git', ['--version'], { encoding: 'utf8' }).error) refuse('git is not installed: install it from https://git-scm.com and run kickoff again');
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
  if (installSettings) console.log(`NOTE: ${settingsNote}`);
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
  // Every file of scripts/ and .githooks/ (the gate, the build, the git hook) runs as a program, whatever the mode
  // of the plugin's copy (L-15).
  if (f.mode & 0o111 || /^(scripts|\.githooks)\//.test(f.dest)) chmodSync(out, 0o755);
}
console.log(`layout: wrote ${plan.length} files into ${target}`);
if (installSettings) console.log(`layout: ${SETTINGS} held nothing the template's own does not, and the template's is in its place`);
for (const f of plan.filter((p) => p.rel !== p.dest)) console.log(`  ${f.rel} -> ${f.dest}`);
console.log(`layout: .claude/pitwall.json records level ${args.level}, template ${values.TEMPLATE_VERSION}, merge protection pending`);
