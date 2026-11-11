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
  const order = riskOrder(cfg);
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

// The risk classes from the lowest to the highest.
export const riskOrder = (cfg) => Object.keys(cfg.riskClasses).filter((k) => typeof cfg.riskClasses[k] === 'object');

// ---------- bugs (T4b) ----------
//
// docs/BUGS.md is read by its header, never by the place of a column, so the table of seven columns a
// project laid out before T4b holds still reads: each open bug in it is blocking and high until
// /pitwall:continue adds the columns (T4b-AC2). A new bug's row, and a change to a bug not fixed yet,
// wait outside the work tree, in the git directory (bugs.pending in the config), until the first commit
// of the next branch moves them into docs/BUGS.md: no implementer commits them into another change,
// and no switch, stash or checkout touches them (owner, 2026-11-11). A row that waits holds every cell
// of a new bug, or, for a change, the ID and the cells that change, the others left empty.

const BOM = String.fromCodePoint(0xfeff);
export const BUG_KEYS = { id: 'ID', title: 'Title', found: 'Found in', steps: 'Steps', expected: 'Expected', actual: 'Actual', severity: 'Severity', risk: 'Risk', status: 'Status', fix: 'Fix PR' };
const cellsOf = (line) => line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
const separatorRow = (cells) => cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
// A value as a table cell holds it: one line, a pipe escaped.
export const bugCell = (value) => String(value ?? '').replace(/\s*\r?\n\s*/g, ' ').replace(/(?<!\\)\|/g, '\\|').trim();

// The columns of the template's table, in order.
export const bugColumns = () => cellsOf(readFileSync(join(templateRoot, 'docs', 'BUGS.md'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('|')));

// The first table of a text: the lines it spans, its header, and its rows keyed as BUG_KEYS names them.
// old: the table has the seven columns of a project laid out before T4b.
export function bugTable(text) {
  const lines = String(text ?? '').replace(BOM, '').replace(/\r\n?/g, '\n').split('\n');
  const first = lines.findIndex((l) => l.startsWith('|'));
  let end = first;
  if (first >= 0) while (end < lines.length && lines[end].startsWith('|')) end += 1;
  const header = first >= 0 ? cellsOf(lines[first]) : null;
  const keys = (header ?? []).map((h) => Object.keys(BUG_KEYS).find((k) => BUG_KEYS[k].toLowerCase() === h.toLowerCase()) ?? null);
  const rows = first < 0 ? [] : lines.slice(first + 1, end).map(cellsOf).filter((c) => !separatorRow(c)).map((cells) => {
    const row = {};
    keys.forEach((k, i) => {
      if (k) row[k] = cells[i] ?? '';
    });
    return row;
  });
  const old = Boolean(header) && header.map((h) => h.toLowerCase()).join('|') === OLD_BUG_COLUMNS.map((h) => h.toLowerCase()).join('|');
  return { lines, first, end, header, keys, rows, old };
}
// The table of a project laid out before T4b.
export const OLD_BUG_COLUMNS = ['ID', 'Found in', 'Steps', 'Expected', 'Actual', 'Status', 'Fix PR'];

// A table's text with these rows in the template's columns, the lines around the table kept.
export function writeBugTable(table, rows, intro) {
  const cols = bugColumns();
  const keys = cols.map((c) => Object.keys(BUG_KEYS).find((k) => BUG_KEYS[k] === c));
  const body = [`| ${cols.join(' | ')} |`, `| ${cols.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${keys.map((k) => bugCell(r[k])).join(' | ')} |`)];
  if (table.first < 0) return `${intro ?? ''}${body.join('\n')}\n`;
  return [...table.lines.slice(0, table.first), ...body, ...table.lines.slice(table.end)].join('\n');
}

// What a row says, read: its severity and class (each marked when the owner has not confirmed it), and
// whether it is still open. A row of an old table is blocking and high.
export function bugFacts(row, cfg, old = false) {
  const mark = cfg.bugs.unconfirmed.mark;
  const read = (cell, values) => {
    const m = new RegExp(`^(${values.join('|')})(?:\\s*\\((${mark})\\))?$`, 'i').exec(String(cell ?? '').trim());
    return m ? { value: values.find((v) => v.toLowerCase() === m[1].toLowerCase()), unconfirmed: Boolean(m[2]) } : { value: null, unconfirmed: false };
  };
  const severity = old ? { value: cfg.bugs.unconfirmed.severity, unconfirmed: false } : read(row.severity, Object.keys(cfg.bugs.severities));
  const risk = old ? { value: cfg.bugs.unconfirmed.risk, unconfirmed: false } : read(row.risk, riskOrder(cfg));
  const status = String(row.status ?? '').trim();
  return {
    id: String(row.id ?? '').replace(/`/g, '').trim(),
    title: String(row.title ?? '').trim(),
    severity: severity.value,
    risk: risk.value,
    unconfirmed: severity.unconfirmed || risk.unconfirmed,
    status,
    open: !/^(fixed|accepted|closed)\b/i.test(status),
    accepted: /^accepted\s*\((R-\d+)\)$/i.exec(status)?.[1] ?? null,
  };
}

// The file in the git directory where rows wait (kind: bugs, risks the owner accepted in place of a fix,
// or lessons), or null outside git.
export function pendingBugsPath(project, cfg = config(), kind = 'bugs') {
  const r = spawnSync('git', ['-C', project, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  return join(resolve(project, r.stdout.trim()), ...cfg.bugs.pending[kind].split('/'));
}

// The bugs as the loop sees them: the rows of docs/BUGS.md in the work tree, then the bugs whose row only
// another branch holds, not merged yet (branch: where), with the rows waiting in the git directory over
// them all, each with its facts and, when part of it waits, waiting: 'new' or 'change'.
export function bugsView(project, cfg = config()) {
  const text = (p) => (p && existsSync(p) ? readFileSync(p, 'utf8') : '');
  const tree = bugTable(text(join(project, 'docs', 'BUGS.md')));
  const path = pendingBugsPath(project, cfg);
  const pending = bugTable(text(path));
  const rows = tree.rows.filter((r) => /^`?BUG-\d+`?$/.test(String(r.id ?? '').trim())).map((r) => (tree.old ? { ...r, ...oldDefaults(r, cfg) } : { ...r }));
  const idOf = (r) => bugFacts(r, cfg).id;
  // A bug the archive holds is closed, whatever an old branch still says of it.
  const archive = join(project, 'docs', 'archive');
  const archived = new Set(existsSync(archive) ? readdirSync(archive).filter((f) => f.endsWith('.md')).flatMap((f) => bugTable(readFileSync(join(archive, f), 'utf8')).rows.map(idOf)) : []);
  for (const [id, { row, branch }] of path ? bugsOnBranches(project, cfg) : []) if (!archived.has(id) && !rows.some((r) => idOf(r) === id)) rows.push({ ...row, branch });
  for (const p of pending.rows) {
    const at = rows.findIndex((r) => idOf(r) === idOf(p));
    if (at >= 0) rows[at] = { ...rows[at], ...changedCells(p), waiting: rows[at].waiting ?? 'change' };
    else rows.push({ ...p, waiting: isNewBug(p) ? 'new' : 'change' });
  }
  rows.sort((a, b) => Number(/\d+/.exec(idOf(a))?.[0] ?? 0) - Number(/\d+/.exec(idOf(b))?.[0] ?? 0));
  return { tree, pending, path, rows: rows.map((r) => ({ row: r, ...bugFacts(r, cfg) })) };
}

// A row that waits is a new bug when it holds the steps; a change holds only the cells that change.
export const isNewBug = (row) => String(row.steps ?? '').trim() !== '';
export const changedCells = (row) => Object.fromEntries(Object.entries(row).filter(([k, v]) => k !== 'id' && String(v ?? '').trim() !== ''));

// The rows of docs/BUGS.md on every local and fetched branch, the newest commit first: id -> { row, branch }.
// A bug filed into one branch's first commit is not on main until that branch merges.
export function bugsOnBranches(project, cfg = config(), git = gitRunner(project)) {
  const found = new Map();
  const refs = git('for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads/', 'refs/remotes/').out.split('\n').filter((r) => r && !/\/HEAD$/.test(r));
  for (const ref of refs) {
    const shown = git('show', `${ref}:docs/BUGS.md`);
    if (!shown.ok) continue;
    const table = bugTable(shown.raw);
    for (const r of table.rows) {
      const id = bugFacts(r, cfg).id;
      if (/^BUG-\d+$/.test(id) && !found.has(id)) found.set(id, { row: table.old ? { ...r, ...oldDefaults(r, cfg) } : r, branch: ref });
    }
  }
  return found;
}

// The cells a row of an old table gains when /pitwall:continue adds the columns: blocking and high, as it
// was read before, and a title taken from what happened.
export function oldDefaults(row, cfg) {
  const words = String(row.actual ?? row.expected ?? '').replace(/\s+/g, ' ').trim();
  const title = words.length <= 60 ? words : `${words.slice(0, 57).replace(/\s+\S*$/, '')}...`;
  return { title: title || String(row.id ?? ''), severity: cfg.bugs.unconfirmed.severity, risk: cfg.bugs.unconfirmed.risk };
}

// The risk class of a bug fix as a merge reads it (T4b-AC3): the highest of the class docs/BUGS.md gives the
// bug in the first commit of the fix's branch that holds its row (the row as filed, with the owner's changes
// that waited for that commit), at the commit that merges, and in a change the owner made after the fix
// started, which waits in the git directory of this clone (owner, 2026-11-11). A class raised anywhere holds;
// one lowered on the branch does not. An unconfirmed bug, and a bug of a table from before T4b, is high.
// Null when neither commit gives the bug a class.
export function bugRiskClassAt(git, project, bug, sha, base, cfg) {
  const order = riskOrder(cfg);
  const classIn = (text) => {
    const t = bugTable(text);
    const r = t.rows.find((x) => bugFacts(x, cfg).id === bug);
    return r ? bugFacts(r, cfg, t.old).risk : null;
  };
  const at = (ref) => {
    const shown = git('show', `${ref}:docs/BUGS.md`);
    return shown.ok ? classIn(shown.raw) : null;
  };
  const fork = git('merge-base', sha, base);
  let first = null;
  for (const c of fork.ok ? git('rev-list', '--reverse', '--first-parent', `${fork.out}..${sha}`).out.split('\n').filter(Boolean) : []) {
    first = at(c);
    if (first) break;
  }
  const head = at(sha);
  if (!first && !head) return null;
  const path = pendingBugsPath(project, cfg);
  const waiting = path && existsSync(path) ? bugTable(readFileSync(path, 'utf8')).rows.find((r) => bugFacts(r, cfg).id === bug && String(r.risk ?? '').trim()) : null;
  const later = waiting ? bugFacts(waiting, cfg).risk : null;
  return [first, head, later].filter(Boolean).reduce((a, b) => (order.indexOf(b) > order.indexOf(a) ? b : a));
}

// The next BUG-n: one more than any in docs/BUGS.md, its archive, the rows waiting, docs/BUGS.md on every
// branch and the fix branches.
export function nextBugId(project, view, git = gitRunner(project), cfg = config()) {
  const seen = [...view.rows.map((r) => r.id), ...bugsOnBranches(project, cfg, git).keys()];
  const archive = join(project, 'docs', 'archive');
  if (existsSync(archive)) for (const f of readdirSync(archive).filter((n) => n.endsWith('.md'))) seen.push(...bugTable(readFileSync(join(archive, f), 'utf8')).rows.map((r) => r.id));
  seen.push(...git('for-each-ref', '--format=%(refname)', 'refs/heads/fix/', 'refs/remotes/origin/fix/').out.split('\n'));
  const n = Math.max(0, ...seen.map((s) => Number(/\bBUG-(\d+)\b/.exec(String(s ?? ''))?.[1] ?? 0)));
  return `BUG-${n + 1}`;
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
