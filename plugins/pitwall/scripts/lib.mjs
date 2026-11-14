// Helpers shared by the plugin's scripts (ADR-0004). Node only, no dependencies.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
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

// A name safe as a file name.
export const safeName = (s) => String(s ?? 'unknown').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
// The hooks' state: PITWALL_HOOK_STATE, or a folder of the account's own in the system temp folder, so two
// users of one machine keep apart state.
export function hookState() {
  if (process.env.PITWALL_HOOK_STATE) return process.env.PITWALL_HOOK_STATE;
  let account;
  try {
    account = safeName(userInfo().username);
  } catch {
    account = safeName(process.getuid?.() ?? 'user');
  }
  return join(tmpdir(), `pitwall-${account}`);
}
// A folder's path spelled one way: forward slashes, no trailing one, and on Windows one case.
export const samePath = (dir) => {
  const p = resolve(String(dir)).split('\\').join('/').replace(/\/+$/, '');
  return process.platform === 'win32' ? p.toLowerCase() : p;
};
// The note the guard leaves when it sends an owner's script to Claude Code's permission prompt (ADR-0010, T5a):
// under Claude Code the script runs only when the note is its own and fresh. It lies in the project's git
// directory, beside the rows that wait there (bugs.pending), and not in a temp folder: the hook runs outside
// Claude Code's sandbox and the script may run inside it, where the temp folder is another one (review round 1).
// Null outside a git repository.
export function ownerPromptFile(projectRoot, cfg = config()) {
  const r = spawnSync('git', ['-C', projectRoot, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  return join(resolve(projectRoot, r.stdout.trim()), ...cfg.hooks.ownerPromptNote.split('/'));
}
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
  // A release, release/v<x.y.z> (T4c-AC3, ADR-0013): its change is release-v<x.y.z>.
  const release = kind === 'release' ? new RegExp(`^${cfg.release.tagPrefix}(\\d+)\\.(\\d+)\\.(\\d+)$`).exec(name) : null;
  if (!epic && !bug && !release) return { kind, branch, id: null };
  const id = release ? `release-${name}` : name;
  return { kind, branch, id, epic: epic?.[1] ?? null, bug: bug?.[0] ?? null, release: release ? name : null, review: `${cfg.loop.reviews}/${id}.md` };
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
  const cellRows = first < 0 ? [] : lines.slice(first + 1, end).map(cellsOf).filter((c) => !separatorRow(c));
  // BUG-5: a row with more cells than the table has columns, as a "|" written without its backslash makes it: a
  // rewrite would shift its cells and drop the last.
  const ragged = header ? cellRows.filter((c) => c.length > header.length).map((c) => ({ id: c[0] ?? '', cells: c.length })) : [];
  const rows = cellRows.map((cells) => {
    const row = {};
    keys.forEach((k, i) => {
      if (k) row[k] = cells[i] ?? '';
    });
    return row;
  });
  const old = Boolean(header) && header.map((h) => h.toLowerCase()).join('|') === OLD_BUG_COLUMNS.map((h) => h.toLowerCase()).join('|');
  return { lines, first, end, header, keys, rows, old, ragged };
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

// What a row says, read: its severity (marked when the owner has not confirmed it), its class, which picks
// the fix's implementer and nothing else (owner, 2026-11-11), and whether it is still open. A row of an old
// table is blocking and high.
export function bugFacts(row, cfg, old = false) {
  const mark = cfg.bugs.unconfirmed.mark;
  const read = (cell, values, marked) => {
    const m = new RegExp(`^(${values.join('|')})${marked ? `(?:\\s*\\((${mark})\\))?` : ''}$`, 'i').exec(String(cell ?? '').trim());
    return m ? { value: values.find((v) => v.toLowerCase() === m[1].toLowerCase()), unconfirmed: Boolean(m[2]) } : { value: null, unconfirmed: false };
  };
  const severity = old ? { value: cfg.bugs.oldTable.severity, unconfirmed: false } : read(row.severity, Object.keys(cfg.bugs.severities), true);
  const risk = old ? { value: cfg.bugs.oldTable.risk, unconfirmed: false } : read(row.risk, riskOrder(cfg), false);
  const status = String(row.status ?? '').trim();
  return {
    id: String(row.id ?? '').replace(/`/g, '').trim(),
    title: String(row.title ?? '').trim(),
    severity: severity.value,
    risk: risk.value,
    unconfirmed: severity.unconfirmed,
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
  // A bug the archive holds is closed, whatever an old branch still says of it; a branch merged into main
  // says nothing main does not (review round 2).
  const archived = archivedBugIds(project);
  for (const [id, { row, branch }] of path ? bugsOnBranches(project, cfg, gitRunner(project), { unmerged: true }) : []) if (!archived.has(id) && !rows.some((r) => idOf(r) === id)) rows.push({ ...row, branch });
  for (const p of pending.rows) {
    const at = rows.findIndex((r) => idOf(r) === idOf(p));
    // A new bug a flush already wrote somewhere, or the archive holds, waits only until a commit holds it: the
    // row it was written into is the record (review round 3).
    if (isNewBug(p) && (at >= 0 || archived.has(idOf(p)))) continue;
    if (at >= 0) rows[at] = { ...rows[at], ...changedCells(p), waiting: rows[at].waiting ?? 'change' };
    else rows.push({ ...p, waiting: isNewBug(p) ? 'new' : 'change' });
  }
  rows.sort((a, b) => Number(/\d+/.exec(idOf(a))?.[0] ?? 0) - Number(/\d+/.exec(idOf(b))?.[0] ?? 0));
  return { tree, pending, path, rows: rows.map((r) => ({ row: r, ...bugFacts(r, cfg) })) };
}

// A row that waits is a new bug when it holds the steps; a change holds only the cells that change.
export const isNewBug = (row) => String(row.steps ?? '').trim() !== '';
export const changedCells = (row) => Object.fromEntries(Object.entries(row).filter(([k, v]) => k !== 'id' && String(v ?? '').trim() !== ''));

// The IDs of the bugs in docs/archive/, from every table of every file: closed bugs.
export function archivedBugIds(project) {
  const archive = join(project, 'docs', 'archive');
  if (!existsSync(archive)) return new Set();
  const ids = readdirSync(archive).filter((f) => f.endsWith('.md')).flatMap((f) => readFileSync(join(archive, f), 'utf8').split(/\r?\n/).map((l) => /^\|\s*`?(BUG-\d+)`?\s*\|/.exec(l)?.[1]));
  return new Set(ids.filter(Boolean));
}

// The rows of docs/BUGS.md on every local and fetched branch, the newest commit first: id -> { row, branch }.
// A bug filed into one branch's first commit is not on main until that branch merges. unmerged: only the
// branches not merged into main, whose rows main does not hold yet; numbering reads them all.
export function bugsOnBranches(project, cfg = config(), git = gitRunner(project), { unmerged = false } = {}) {
  const found = new Map();
  const base = cfg.mergeProtection.branch;
  const mains = [`refs/heads/${base}`, `refs/remotes/origin/${base}`].filter((r) => git('rev-parse', '--verify', '-q', `${r}^{commit}`).ok);
  const refs = git('for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads/', 'refs/remotes/').out.split('\n').filter((r) => r && !/\/HEAD$/.test(r));
  for (const ref of refs) {
    if (unmerged && mains.some((m) => git('merge-base', '--is-ancestor', ref, m).ok)) continue;
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
  return { title: title || String(row.id ?? ''), severity: cfg.bugs.oldTable.severity, risk: cfg.bugs.oldTable.risk };
}

// The next BUG-n: one more than any in docs/BUGS.md, its archive, the rows waiting, docs/BUGS.md on every
// branch and the fix branches.
export function nextBugId(project, view, git = gitRunner(project), cfg = config()) {
  const seen = [...view.rows.map((r) => r.id), ...bugsOnBranches(project, cfg, git).keys(), ...archivedBugIds(project)];
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

// The open blocking bugs (T4c-AC6, ADR-0013): docs/BUGS.md, the rows only another branch holds and what waits
// in the git directory, an unconfirmed bug included, since it is blocking until the owner answers. A bug whose
// fix is merged into ref ("fix(BUG-<n>): ..." on its first-parent history) is not open, though only the first
// commit of the next branch, or the release, records it fixed.
export function openBlockingBugs(project, cfg = config(), ref = null) {
  const blocking = Object.keys(cfg.bugs.severities)[0];
  const fixed = new Set();
  if (ref) {
    const subjects = gitRunner(project)('log', '--first-parent', '--merges', '--format=%s', ref).out.split('\n');
    for (const s of subjects) {
      const m = loopSubject(s, cfg);
      if (m?.kind === 'bug') fixed.add(m.id);
    }
  }
  return bugsView(project, cfg).rows.filter((b) => b.open && b.severity === blocking && !fixed.has(b.id));
}

// Versions and releases (T4c-AC1, ADR-0013). A version is x.y.z; its tag is release.tagPrefix + x.y.z.
export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const compareVersions = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};
// The merge commits of the loop as merge.mjs writes them, and a release's.
export const loopSubject = (subject, cfg = config()) => {
  const epic = /^feat\((E\d+)\): (.+) \(#(\d+)\)$/.exec(subject);
  if (epic) return { kind: 'epic', id: epic[1], title: epic[2], pr: Number(epic[3]) };
  const bug = /^fix\((BUG-\d+)\): (.+) \(#(\d+)\)$/.exec(subject);
  if (bug) return { kind: 'bug', id: bug[1], title: bug[2], pr: Number(bug[3]) };
  const release = new RegExp(`^${cfg.release.subject}: ${cfg.release.tagPrefix}(\\d+\\.\\d+\\.\\d+) \\(#(\\d+)\\)$`).exec(subject);
  if (release) return { kind: 'release', version: release[1], pr: Number(release[2]) };
  return null;
};

// What main holds since the last release, read from its first-parent history at ref (git is a gitRunner):
//   last      the highest tag vX.Y.Z merged into ref, { tag, version, sha }, or null;
//   untagged  the newest release merged after it, { version, sha, pr }, or null: merged, and not tagged yet;
//   items     the loop's merges since the last release, tagged or not, oldest first: { kind, id, title, pr, sha };
//   leftOut   the commits since then that are neither, and not the plan's merge or the kickoff: { sha, subject, why }.
export function releaseHistory(git, ref, cfg = config()) {
  const prefix = cfg.release.tagPrefix;
  const tags = git('tag', '--merged', ref, '--list', `${prefix}*`).out.split('\n').map((t) => t.trim()).filter((t) => t.startsWith(prefix) && SEMVER.test(t.slice(prefix.length)));
  tags.sort((a, b) => compareVersions(a.slice(prefix.length), b.slice(prefix.length)));
  const top = tags.pop();
  const last = top ? { tag: top, version: top.slice(prefix.length), sha: git('rev-list', '-n', '1', top).out } : null;
  const log = git('log', '--first-parent', '--format=%H%x1f%P%x1f%s%x1f%b%x1e', ref, ...(last ? [`^${last.sha}`] : []));
  const commits = log.raw.split('\x1e').map((r) => r.replace(/^\s+/, '')).filter(Boolean).map((r) => {
    const [sha, parents, subject, body] = r.split('\x1f');
    return { sha, merge: (parents ?? '').trim().split(/\s+/).filter(Boolean).length > 1, subject: subject ?? '', body: body ?? '' };
  });
  const at = commits.findIndex((c) => c.merge && loopSubject(c.subject, cfg)?.kind === 'release');
  const untagged = at >= 0 ? { ...loopSubject(commits[at].subject, cfg), sha: commits[at].sha } : null;
  const since = (at >= 0 ? commits.slice(0, at) : commits).reverse();
  const items = [];
  const leftOut = [];
  for (const c of since) {
    const s = loopSubject(c.subject, cfg);
    if (c.merge && s && s.kind !== 'release') items.push({ ...s, sha: c.sha });
    else if (/Plan approved by the owner/.test(c.body) || /^chore: kickoff from pitwall\b/.test(c.subject)) continue;
    else leftOut.push({ sha: c.sha, subject: c.subject, why: c.merge ? 'a merge the loop did not make' : 'a commit on main that is no merge of the loop' });
  }
  return { last, untagged, items, leftOut };
}

// The changelog's section of a version, as release.mjs writes it: Keep a Changelog's headings, one line per merge.
export function changelogSection(version, date, items, cfg = config()) {
  const line = (i) => `- ${i.id}: ${i.title} (#${i.pr})`;
  const added = items.filter((i) => i.kind === 'epic').map(line);
  const fixed = items.filter((i) => i.kind === 'bug').map(line);
  return [`## ${cfg.release.tagPrefix}${version} - ${date}`, '', ...(added.length ? ['### Added', '', ...added, ''] : []), ...(fixed.length ? ['### Fixed', '', ...fixed, ''] : [])].join('\n').trimEnd();
}

// The section of a version in a changelog's text, without its trailing blank lines, or null.
export function changelogSectionOf(text, version, cfg = config()) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const head = new RegExp(`^## ${cfg.release.tagPrefix}${version.replace(/\./g, '\\.')}(?: |$)`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start, end).join('\n').trimEnd();
}

// The file in the git directory where a release keeps what is not committed: its build record, the tag's message.
export function releaseDir(project, cfg = config()) {
  const r = spawnSync('git', ['-C', project, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  return join(resolve(project, r.stdout.trim()), ...cfg.release.pending.split('/'));
}
