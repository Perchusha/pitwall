#!/usr/bin/env node
// The guard's corpus (L-13, T7-AC1): every command line of Claude Code's local transcripts on
// this machine runs through the hooks' guard as it was at a commit and as it is in the working
// tree, and each verdict that changed is printed. Run it after every change of a guard that reads
// commands, before a reviewer sees the change, and explain each line it prints.
//
//   node scripts/guard-corpus.mjs [--base <commit>] [--match <regex>] [--callers <list>] [--variants <file.json>]
//
//   --base      the commit the working tree is compared with; main by default
//   --match     only the command lines this regular expression matches (the part of the corpus a
//               narrow change can reach); all of them by default
//   --callers   who makes the call, a list joined by commas: main, or the name of an agent
//               (implementer, code-reviewer, plan-reviewer, qa, researcher); main, implementer and
//               code-reviewer by default
//   --variants  a JSON file of extra lines, [["Bash" | "PowerShell", "<command>"], ...], replayed too
//
// A tool for developing pitwall: not part of the plugin and not a step of scripts/check.mjs, since
// CI has no transcripts. It runs only locally, and says so and stops when it finds none. The
// transcripts are the owner's own sessions: they are read where they lie, and no line of them is
// printed or kept. A changed verdict is described by the caller, the two verdicts, the tool and
// the form of the command, which is the programs it runs and, for git, the subcommand: that is
// what the journal, a PR or a review file may quote (owner, 2026-11-10).
//
// The lines are judged in a scratch pitwall project on an epic branch with uncommitted work in it
// (a changed CLAUDE.md and docs/IDEA.md, and a new file), so that the rules about work that would
// be lost answer as they do in the middle of a change. Each line is judged with the plugin folders
// it names as plugin roots (a headless run's copy, the installed cache, a checkout), as its session
// had them, since the rule on the guards' switches keys on that folder (review round 1). The git
// questions the guard asks in the folders a line names run without optional locks, so a replay
// never takes the index lock of a repository the owner works in.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseCommand, program } from '../plugins/pitwall/scripts/hook-guard.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..').split('\\').join('/');
const argv = process.argv.slice(2);
const opt = (name, fallback = '') => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const known = ['--base', '--match', '--callers', '--variants'];
if (argv.some((a, i) => a.startsWith('--') ? !known.includes(a) : !known.includes(argv[i - 1]))) {
  console.error('usage: node scripts/guard-corpus.mjs [--base <commit>] [--match <regex>] [--callers main,implementer,code-reviewer] [--variants <file.json>]');
  process.exit(2);
}
const base = opt('base', 'main');
let match = null;
try {
  match = opt('match') ? new RegExp(opt('match')) : null;
} catch (e) {
  console.error(`guard-corpus: --match is not a regular expression: ${e.message}`);
  process.exit(2);
}
const callers = opt('callers', 'main,implementer,code-reviewer').split(',').map((c) => c.trim()).filter(Boolean);

// The command lines: every Bash and PowerShell call of every transcript, once each.
const lines = new Map();
const take = (tool, command) => {
  if (typeof command !== 'string' || !command.trim()) return;
  if (match && !match.test(command)) return;
  lines.set(`${tool}\u0000${command}`, [tool, command]);
};
let transcripts = 0;
let unreadable = 0;
let seen = 0;
const projects = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
const walk = (dir) => {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    unreadable += 1;
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.jsonl')) {
      transcripts += 1;
      let text = '';
      try {
        text = readFileSync(p, 'utf8');
      } catch {
        unreadable += 1;
        continue;
      }
      for (const l of text.split('\n')) {
        if (!l.includes('"tool_use"')) continue;
        let j;
        try {
          j = JSON.parse(l);
        } catch {
          continue;
        }
        for (const c of [].concat(j.message?.content ?? [])) {
          if (c.type === 'tool_use' && (c.name === 'Bash' || c.name === 'PowerShell') && c.input?.command) {
            seen += 1;
            take(c.name, c.input.command);
          }
        }
      }
    }
  }
};
if (existsSync(projects)) walk(projects);
if (transcripts === 0) {
  console.log(`guard-corpus: no transcripts under ${projects}: nothing to replay (Claude Code deletes them after cleanupPeriodDays). The corpus runs only on a machine that holds sessions.`);
  process.exit(0);
}
let extra = 0;
if (opt('variants')) {
  const list = JSON.parse(readFileSync(opt('variants'), 'utf8'));
  for (const v of list) {
    take(/power/i.test(String(v[0])) ? 'PowerShell' : 'Bash', v[1]);
    extra += 1;
  }
}

// The guard as it was at the base: the plugin's scripts and config of that commit, in a folder of their own.
const work = mkdtempSync(join(tmpdir(), 'pitwall-corpus-'));
const git = (cwd, ...a) => spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8', maxBuffer: 256 << 20 });
const sha = git(repo, 'rev-parse', '--verify', '-q', `${base}^{commit}`).stdout.trim();
if (!sha) {
  console.error(`guard-corpus: ${base} is no commit of this repository`);
  process.exit(2);
}
const old = join(work, 'base');
for (const f of git(repo, 'ls-tree', '-r', '--name-only', sha, '--', 'plugins/pitwall/scripts', 'plugins/pitwall/config').stdout.split('\n').filter(Boolean)) {
  mkdirSync(dirname(join(old, f)), { recursive: true });
  writeFileSync(join(old, f), execFileSync('git', ['-C', repo, 'show', `${sha}:${f}`], { maxBuffer: 64 << 20 }));
}
const guards = {
  before: { guard: (await import(pathToFileURL(join(old, 'plugins/pitwall/scripts/hook-guard.mjs')).href)).guard, cfg: JSON.parse(readFileSync(join(old, 'plugins/pitwall/config/defaults.json'), 'utf8')) },
  after: { guard: (await import(pathToFileURL(`${repo}/plugins/pitwall/scripts/hook-guard.mjs`).href)).guard, cfg: JSON.parse(readFileSync(`${repo}/plugins/pitwall/config/defaults.json`, 'utf8')) },
};

// The project the lines are judged in.
const root = join(work, 'p').split('\\').join('/');
const plugin = `${repo}/plugins/pitwall`;
execFileSync(process.execPath, [`${plugin}/scripts/layout.mjs`, '--target', root, '--name', 'corpus', '--idea', 'The corpus of the guard', '--level', 'lite']);
const g = (...a) => git(root, '-c', 'user.email=corpus@pitwall.invalid', '-c', 'user.name=corpus', ...a);
g('init', '-q', '-b', 'main');
g('add', '-A');
g('commit', '-qm', 'skeleton');
g('switch', '-qc', 'epic/E1-corpus');
writeFileSync(join(root, 'CLAUDE.md'), `${readFileSync(join(root, 'CLAUDE.md'), 'utf8')}\nwork in progress\n`);
writeFileSync(join(root, 'docs', 'IDEA.md'), `${readFileSync(join(root, 'docs', 'IDEA.md'), 'utf8')}\nwork in progress\n`);
writeFileSync(join(root, 'new.js'), 'export const work = 1;\n');
const settings = JSON.parse(readFileSync(join(root, '.claude', 'pitwall.json'), 'utf8'));
// The project never changes while the lines are judged, so each git question is asked once.
const answers = new Map();
const gitOnce = (args, cwd = root) => {
  const key = `${cwd}\u0000${args.join('\u0000')}`;
  if (!answers.has(key)) {
    const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
    answers.set(key, { ok: !r.error && r.status === 0, status: r.error ? -1 : r.status, out: (r.stdout ?? '').trim(), raw: r.stdout ?? '', err: `${r.stderr ?? ''}${r.error?.message ?? ''}`.trim() });
  }
  return answers.get(key);
};
// The plugin folders a line names: a folder called pitwall that holds the plugin's own parts.
const pluginScripts = readdirSync(`${plugin}/scripts`).filter((f) => f.endsWith('.mjs')).map((f) => f.replace(/\./g, '\\.')).join('|');
const COPY = new RegExp(`([A-Za-z]:[\\\\/]|/)[^\\s"'\`;&|<>()=]*?[\\\\/]pitwall(?:[\\\\/]+\\d+\\.\\d+\\.\\d+)?(?=[\\\\/]+(?:config[\\\\/]+defaults\\.json|skills[\\\\/]|template[\\\\/]|hooks[\\\\/]+hooks\\.json|scripts[\\\\/]+(?:${pluginScripts})))`, 'g');
let named = 0;
const rootsOf = (command) => {
  const found = [...new Set([...command.matchAll(COPY)].map((m) => m[0]))];
  return found;
};
const ctx = (cfg, roots) => ({ root, home: homedir(), pluginRoot: plugin, pluginRoots: [plugin, ...roots], cfg, settings, cwd: root, git: gitOnce, checkPr: () => null });
const verdict = ({ guard, cfg }, tool, command, caller, roots) => {
  try {
    const r = guard({ tool, input: { command }, agentId: caller === 'main' ? undefined : 'corpus', agentType: caller === 'main' ? undefined : `pitwall:${caller}`, permissionMode: 'default' }, ctx(cfg, roots));
    return r ? `${r.ask ? 'ask' : 'deny'}:${r.rule ?? '?'}` : 'allow';
  } catch (e) {
    return `error:${String(e.message).split('\n')[0].slice(0, 60)}`;
  }
};
// The form of a command, never the line: the programs the guard's own parser reads in it, in order, each once, a
// git command with its subcommand and node with a script of the plugin's. A program is named only when it is a
// known tool, and "other" otherwise: a word of a heredoc or a string, the owner's words, never reaches the output
// that a brief, the journal or a review file may quote (review round 1).
const KNOWN = new Set([
  ...guards.after.cfg.hooks.readOnlyCommands,
  'git', 'gh', 'node', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'deno', 'python', 'python3', 'py', 'pip', 'bash', 'sh', 'pwsh', 'powershell', 'cmd', 'claude',
  'cd', 'pushd', 'popd', 'mkdir', 'rm', 'rmdir', 'cp', 'mv', 'touch', 'chmod', 'ln', 'tee', 'sed', 'awk', 'xargs', 'find', 'sort', 'uniq', 'cut', 'tr', 'tar', 'unzip', 'zip', 'curl', 'wget',
  'sleep', 'date', 'env', 'export', 'set', 'unset', 'source', 'true', 'false', 'exit', 'timeout', 'time', 'which', 'where', 'dotnet', 'cargo', 'go', 'make', 'winget', 'code',
  'set-location', 'get-location', 'remove-item', 'copy-item', 'move-item', 'new-item', 'set-content', 'add-content', 'out-file', 'write-output', 'write-host', 'select-object',
  'where-object', 'foreach-object', 'sort-object', 'measure-object', 'start-process', 'stop-process', 'get-process', 'get-ciminstance', 'invoke-webrequest', 'invoke-restmethod', 'start-sleep',
]);
const GIT_SUBS = new Set(['add', 'am', 'apply', 'bisect', 'blame', 'branch', 'bundle', 'cat-file', 'check-ignore', 'checkout', 'cherry-pick', 'clean', 'clone', 'commit', 'config', 'describe', 'diff', 'diff-tree', 'fetch', 'for-each-ref', 'format-patch', 'gc', 'grep', 'hash-object', 'init', 'log', 'ls-files', 'ls-remote', 'ls-tree', 'merge', 'merge-base', 'mv', 'notes', 'pull', 'push', 'rebase', 'reflog', 'remote', 'reset', 'restore', 'rev-list', 'rev-parse', 'revert', 'rm', 'shortlog', 'show', 'show-ref', 'sparse-checkout', 'stash', 'status', 'submodule', 'switch', 'symbolic-ref', 'tag', 'update-index', 'update-ref', 'verify-commit', 'worktree']);
const SCRIPT_NAMES = new Set(readdirSync(`${plugin}/scripts`).filter((f) => f.endsWith('.mjs')));
const form = (tool, command) => {
  const out = [];
  let cmds = [];
  try {
    cmds = parseCommand(command, tool === 'PowerShell' ? 'powershell' : 'bash', root, homedir());
  } catch {
    return 'unparsed';
  }
  for (const { argv } of cmds) {
    const prog = program(argv[0]);
    if (!prog) continue;
    let name = KNOWN.has(prog) ? prog : 'other';
    if (prog === 'git') {
      // Only git's own subcommands are named: a word after an option with a value, or an alias, prints as "git other".
      const sub = argv.slice(1).find((w, k, all) => !w.startsWith('-') && !['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env'].includes(all[k - 1]));
      name = sub && GIT_SUBS.has(sub) ? `git ${sub}` : 'git other';
    }
    if (prog === 'node') {
      const script = String(argv.slice(1).find((w) => /\.m?js$/.test(w)) ?? '').split(/[\\/]/).pop();
      if (SCRIPT_NAMES.has(script)) name = `node ${script}`;
    }
    if (!out.includes(name)) out.push(name);
  }
  return out.slice(0, 6).join(', ') || 'other';
};

const started = Date.now();
const changed = new Map();
let errors = 0;
for (const [tool, command] of lines.values()) {
  const roots = rootsOf(command);
  if (roots.length) named += 1;
  for (const caller of callers) {
    const before = verdict(guards.before, tool, command, caller, roots);
    const after = verdict(guards.after, tool, command, caller, roots);
    if (after.startsWith('error:')) errors += 1;
    if (before === after) continue;
    const key = `${caller}: ${before} -> ${after} (${tool}: ${form(tool, command)})`;
    changed.set(key, (changed.get(key) ?? 0) + 1);
  }
}
rmSync(work, { recursive: true, force: true });
console.log(`guard-corpus: ${seen} command lines in ${transcripts} transcripts${extra ? `, and ${extra} variants` : ''}; ${lines.size} different ones${match ? ` match ${match}` : ''}, replayed as ${callers.join(', ')} through the guard of ${base} (${sha.slice(0, 7)}) and of the working tree, in ${((Date.now() - started) / 1000).toFixed(0)} s`);
console.log(`guard-corpus: ${named} of them name a folder of the plugin, judged with it as the plugin's${unreadable ? `; ${unreadable} transcript files or folders could not be read` : ''}`);
if (errors) console.log(`guard-corpus: the guard of the working tree threw on ${errors} call(s): each is a line it could not read`);
if (changed.size === 0) console.log('guard-corpus: no verdict changed');
else {
  console.log(`guard-corpus: ${[...changed.values()].reduce((a, b) => a + b, 0)} verdicts changed, in ${changed.size} forms:`);
  for (const [k, n] of [...changed].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  ${n} x ${k}`);
}
