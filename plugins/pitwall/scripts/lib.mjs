// Helpers shared by the plugin's scripts (ADR-0004). Node only, no dependencies.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const templateRoot = join(pluginRoot, 'template');

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

export const config = () => readJson(join(pluginRoot, 'config', 'defaults.json'));
export const pluginVersion = () => readJson(join(pluginRoot, '.claude-plugin', 'plugin.json')).version;

// Stops with a clear message on a Node older than the plugin needs (runtime.nodeMinMajor).
export function requireNode() {
  const need = config().runtime.nodeMinMajor;
  const have = Number(process.versions.node.split('.')[0]);
  if (have < need) {
    console.error(`pitwall needs Node ${need} or later, found ${process.versions.node}. Install the LTS release from https://nodejs.org.`);
    process.exit(2);
  }
}

// Parses --flag value and --switch arguments against a spec: { name: 'value' | 'switch' }.
// An unknown flag, a missing value or a stray argument is a usage error (exit 2).
export function parseArgs(argv, spec, usage) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const m = /^--([a-z-]+)$/.exec(argv[i]);
    const kind = m && spec[m[1]];
    if (!kind) fail(`unknown argument "${argv[i]}"`);
    if (kind === 'switch') out[m[1]] = true;
    else if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) fail(`--${m[1]} needs a value`);
    else out[m[1]] = argv[(i += 1)];
  }
  return out;
  function fail(msg) {
    console.error(`${msg}\nusage: ${usage}`);
    process.exit(2);
  }
}

// Every file under dir, as paths relative to it with forward slashes. Skips the
// folders named in skip: .git and node_modules unless told otherwise.
export function listFiles(dir, skip = ['.git', 'node_modules'], base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip.includes(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) listFiles(p, skip, base, out);
    else out.push(p.slice(base.length + 1).split('\\').join('/'));
  }
  return out;
}

// Where a template file lands in a project: the .tmpl suffix goes, and the
// files git and editors look for by a dotted name get their dot back (L-1).
const DOTTED = new Set(['gitignore', 'editorconfig', 'gitattributes']);
export function projectPath(templatePath) {
  if (!templatePath.endsWith('.tmpl')) return templatePath;
  const parts = templatePath.slice(0, -'.tmpl'.length).split('/');
  const base = parts.pop();
  parts.push(DOTTED.has(base) ? `.${base}` : base);
  return parts.join('/');
}

export const exists = (root, rel) => existsSync(join(root, rel));

export function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// gh as the scripts run it. PITWALL_GH, a JSON array, runs another binary (the checks
// use a fake one); PITWALL_CALLER tells that fake, and its log, which script called.
export function ghRunner(cwd, caller) {
  const cmd = process.env.PITWALL_GH ? JSON.parse(process.env.PITWALL_GH) : ['gh'];
  return (args, input) => {
    const r = spawnSync(cmd[0], [...cmd.slice(1), ...args], { cwd, input, encoding: 'utf8', env: { ...process.env, PITWALL_CALLER: caller } });
    return { ok: !r.error && r.status === 0, out: r.stdout ?? '', err: `${r.stderr ?? ''}${r.error?.message ?? ''}` };
  };
}

// The two checks on a commit, as merge.mjs and the merge guard read them (ADR-0005). A read
// that fails returns { failed, read }, never "not set": gh prints an error body as JSON.
// ai-review: the latest status with that context.
export function readReview(gh, name, sha, cfg) {
  const read = gh(['api', `repos/${name}/commits/${sha}/statuses`]);
  const statuses = read.ok ? parseJson(read.out) : null;
  if (!Array.isArray(statuses)) return { failed: 'statuses', read };
  return { review: statuses.find((s) => s.context === cfg.review.statusContext) ?? null };
}
// gate: the latest run of that name from GitHub Actions; a re-run replaces the run before it.
// foreign is a run of that name from another app, which never passes.
export function readGate(gh, name, sha, cfg) {
  const read = gh(['api', `repos/${name}/commits/${sha}/check-runs`]);
  const runs = read.ok ? parseJson(read.out)?.check_runs : null;
  if (!Array.isArray(runs)) return { failed: 'check runs', read };
  const named = runs.filter((c) => c.name === cfg.review.gateContext);
  const gate = named.filter((c) => c.app?.id === cfg.mergeProtection.githubActionsAppId).sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0] ?? null;
  return { gate, foreign: !gate && named.length > 0 ? named[0] : null };
}

// The change a branch of the epic loop holds (T3b, ADR-0011): epic/E<n>-<slug>, named as the
// epic's file in docs/epics/, or fix/BUG-<n>. Null for any other branch; id is null when the
// branch has a loop prefix but names no change.
export function changeOf(branch, cfg) {
  const kind = Object.keys(cfg.loop.branches).find((k) => String(branch ?? '').startsWith(cfg.loop.branches[k]));
  if (!kind) return null;
  const name = branch.slice(cfg.loop.branches[kind].length);
  const epic = kind === 'epic' ? /^(E\d+)-[a-z0-9]+(?:-[a-z0-9]+)*$/.exec(name) : null;
  const bug = kind === 'fix' ? /^BUG-\d+$/.exec(name) : null;
  if (!epic && !bug) return { kind, branch, id: null };
  return { kind, branch, id: name, epic: epic?.[1] ?? null, bug: bug?.[0] ?? null, review: `${cfg.loop.reviews}/${name}.md` };
}

// The risk class of an epic as a merge reads it (T3b-AC5): the higher of the class docs/EPICS.md gives it
// at the commit that merges and where that commit left the base branch, so a class raised on the branch
// (the owner said so at the clarification) holds and one lowered there does not. Null when the plan at
// the commit gives it none. git is a gitRunner.
export function riskClassAt(git, epic, sha, base, cfg) {
  const order = Object.keys(cfg.riskClasses).filter((k) => typeof cfg.riskClasses[k] === 'object');
  const classAt = (ref) => {
    const plan = git('show', `${ref}:docs/EPICS.md`);
    const row = plan.ok ? plan.out.split('\n').map((l) => l.split('|').map((c) => c.trim())).find((cells) => cells[0] === '' && new RegExp(`^\\[?${epic}\\]?(\\(|$)`).test(cells[1] ?? '')) : null;
    return order.includes(row?.[3]) ? row[3] : null;
  };
  const fork = git('merge-base', sha, base);
  const atHead = classAt(sha);
  const atFork = fork.ok ? classAt(fork.out) : null;
  return atHead && atFork && order.indexOf(atFork) > order.indexOf(atHead) ? atFork : atHead;
}

export function gitRunner(cwd) {
  return (...args) => {
    const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
    return { ok: !r.error && r.status === 0, out: (r.stdout ?? '').trim(), raw: r.stdout ?? '', err: `${r.stderr ?? ''}${r.error?.message ?? ''}`.trim() };
  };
}

export function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// A step handed to the owner. steps: { note } is plain text, { run } a ready command;
// then is the command that records the result afterwards. Each command stands on a
// line of its own under a plain label, so it can be copied as it is, and it runs
// unchanged in bash and in PowerShell: no pipes, no redirects, no placeholders (L-6).
export const RUN_LABEL = 'Run this yourself, in bash or PowerShell:';
export const THEN_LABEL = 'Then run this to record the result:';
export function printHandoff(reason, steps, then) {
  console.log(`HANDOFF: ${reason}`);
  let last = '';
  for (const s of steps) {
    if (s.note) {
      console.log(`  Note: ${s.note}`);
      last = 'note';
    } else {
      if (last !== 'run') console.log(`  ${RUN_LABEL}`);
      console.log(`    ${s.run}`);
      last = 'run';
    }
  }
  if (then) {
    console.log(`  ${THEN_LABEL}`);
    console.log(`    ${then}`);
  }
}
