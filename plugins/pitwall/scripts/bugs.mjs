#!/usr/bin/env node
// Files and keeps the bugs and lessons of a pitwall project (T4b-AC1, AC2), for /pitwall:bug,
// /pitwall:lesson, /pitwall:continue and /pitwall:owner-calls.
//
//   node bugs.mjs file [--project <dir>]
//       The bug on stdin, one "name: value" line each (a line with no name goes on the value before it):
//       title, found in, steps, expected, actual, severity, risk, and confirmed: yes when the owner
//       answered on the severity and the class, no when they were not asked. An unconfirmed bug is
//       filed blocking and high, marked so, whatever the filer proposed (owner, 2026-11-11).
//   node bugs.mjs set <BUG-n> [--severity <s>] [--risk <class>] [--status <s>] [--fix-pr <#n>] [--title <t>] [--tree] [--project <dir>]
//       A change to a bug. An unconfirmed bug is confirmed by giving both its severity and its class.
//       --tree writes docs/BUGS.md in the work tree, for the conductor's own status on its branch;
//       without it the change waits in the git directory, as a new bug does.
//   node bugs.mjs accept <BUG-n> --fallback <text> [--project <dir>]
//       The owner's no to a fix: the bug becomes the next R-n of docs/RISKS.md, its status accepted (R-n);
//       both wait in the git directory too.
//   node bugs.mjs lesson [--tree] [--project <dir>]
//       The lesson on stdin, as a bug is given: rule, why, checked by. It becomes the next L-n, dated
//       today, and waits in the git directory; --tree writes docs/LESSONS.md in the work tree instead,
//       for a lesson from the review of the change in flight, which that change's branch commits.
//   node bugs.mjs list [--json] [--all] [--project <dir>]
//       The open bugs (--all: every bug): docs/BUGS.md, the bugs whose row only another branch holds,
//       and what waits over them.
//   node bugs.mjs flush [--project <dir>]
//       Moves what waits into docs/BUGS.md, docs/RISKS.md and docs/LESSONS.md, in the work tree of the
//       branch the project is on, never main, for the first commit of that branch. A table of seven
//       columns from before T4b gains the new ones first, each open bug in it blocking and high. A change
//       to a bug whose row another branch holds, not merged yet, takes that row with it; one no branch
//       holds keeps waiting.
//   node bugs.mjs resolve [--project <dir>]
//       Finishes a git merge of main into a change's branch that stopped on docs/BUGS.md, docs/RISKS.md
//       or docs/LESSONS.md: every row of both sides stays; a cell of a bug both sides changed keeps the
//       status further along, the higher class, blocking, or else main's word.
//
// What waits lives in the git directory (bugs.pending in the config), outside the work tree, so no
// implementer commits it into another change and no switch, stash or checkout touches it (owner,
// 2026-11-11). Numbers are taken past every one in the work tree, in what waits and on every branch.
// Exit 0 done, 1 refused (a value the config does not know, a bug that does not exist, main), 2 usage.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { bugCell, bugFacts, bugsOnBranches, bugTable, bugsView, changedCells, config, gitRunner, isNewBug, nextBugId, oldDefaults, parseArgs, pendingBugsPath, requireNode, riskOrder, writeBugTable } from './lib.mjs';

requireNode();
const usage = [
  'node bugs.mjs file [--project <dir>]   (the bug on stdin)',
  'node bugs.mjs set <BUG-n> [--severity <s>] [--risk <class>] [--status <s>] [--fix-pr <#n>] [--title <t>] [--tree] [--project <dir>]',
  'node bugs.mjs accept <BUG-n> --fallback <text> [--project <dir>]',
  'node bugs.mjs lesson [--tree] [--project <dir>]   (the lesson on stdin)',
  'node bugs.mjs list [--json] [--all] [--project <dir>]',
  'node bugs.mjs flush [--project <dir>]',
  'node bugs.mjs resolve [--project <dir>]',
].join('\n       ');
const bad = (msg) => {
  console.error(`bugs: ${msg}\nusage: ${usage}`);
  process.exit(2);
};
const refuse = (msg) => {
  console.error(`bugs: ${msg}`);
  process.exit(1);
};

const [command, ...rest] = process.argv.slice(2);
const specs = {
  file: { project: 'value' },
  set: { project: 'value', severity: 'value', risk: 'value', status: 'value', 'fix-pr': 'value', title: 'value', tree: 'switch' },
  accept: { project: 'value', fallback: 'value' },
  lesson: { project: 'value', tree: 'switch' },
  list: { project: 'value', json: 'switch', all: 'switch' },
  flush: { project: 'value' },
  resolve: { project: 'value' },
};
if (!specs[command]) bad(command ? `unknown command "${command}"` : 'a command is required');
const named = ['set', 'accept'].includes(command);
const id = named ? rest[0] : null;
if (named && !/^BUG-\d+$/.test(id ?? '')) bad(`${command} needs the bug's ID first, BUG-<n>`);
const args = parseArgs(named ? rest.slice(1) : rest, specs[command], usage);
const cfg = config();
const project = resolve(args.project ?? '.');
const git = gitRunner(project);
const mark = cfg.bugs.unconfirmed.mark;
const severities = Object.keys(cfg.bugs.severities);
const classes = riskOrder(cfg);
const pick = (value, values, what) => {
  const v = values.find((x) => x.toLowerCase() === String(value ?? '').trim().toLowerCase());
  if (!v) refuse(`${what} "${value ?? ''}" is not one of ${values.join(', ')}`);
  return v;
};
const waiting = {};
for (const kind of Object.keys(cfg.bugs.pending)) waiting[kind] = pendingBugsPath(project, cfg, kind);
if (!waiting.bugs) refuse(`${project} is not inside a git repository: the bugs wait in its git directory until a branch commits them`);
const shown = (p) => p.split('\\').join('/');
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const INTRO = {
  bugs: '# Bugs waiting for the next branch\n\npitwall keeps these rows here, outside the work tree, until the first commit of the next branch moves them into docs/BUGS.md (T4b). A row that changes a bug holds its ID and the cells that change.\n\n',
  risks: '# Risks waiting for the next branch\n\nThe owner accepted these in place of a fix; the first commit of the next branch moves them into docs/RISKS.md (T4b).\n\n| ID | Risk | Fallback | Accepted on |\n| --- | --- | --- | --- |\n',
  lessons: '# Lessons waiting for the next branch\n\nThe first commit of the next branch moves these into docs/LESSONS.md (T4b).\n\n| ID | Rule | Why | Date | Checked by |\n| --- | --- | --- | --- | --- |\n',
};
const DOC = { risks: 'docs/RISKS.md', lessons: 'docs/LESSONS.md' };
const save = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// The rows of a plain table of IDs (RISKS, LESSONS) as lines, and its ID.
const rowLines = (table) => (table.first < 0 ? [] : table.lines.slice(table.first + 2, table.end).filter((l) => l.trim()));
const rowId = (line) => /^\|\s*`?([A-Z]+-\d+)`?\s*\|/.exec(line)?.[1] ?? null;
const refs = () => git('for-each-ref', '--format=%(refname:short)', 'refs/heads/', 'refs/remotes/').out.split('\n').filter((r) => r && !/\/HEAD$/.test(r));
// The next number of a plain table: past every one in the work tree, in what waits and on every branch.
function nextId(prefix, rel, kind) {
  const texts = [read(join(project, rel)), read(waiting[kind]), ...refs().map((r) => git('show', `${r}:${rel}`).raw)];
  const n = Math.max(0, ...texts.flatMap((t) => t.split('\n')).map((l) => Number(new RegExp(`^\\|\\s*${prefix}-(\\d+)\\s*\\|`).exec(l)?.[1] ?? 0)));
  return `${prefix}-${n + 1}`;
}
const appendRows = (text, lines) => {
  const table = bugTable(text);
  const out = table.lines.slice();
  out.splice(table.end, 0, ...lines);
  return out.join('\n');
};
// The fields of a bug or a lesson given on stdin, one "name: value" line each.
function stdinFields(names) {
  let text = '';
  try {
    text = readFileSync(0, 'utf8');
  } catch {}
  const fields = {};
  let last = null;
  const re = new RegExp(`^\\s*(${names.join('|')})\\s*:\\s*(.*)$`, 'i');
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const m = re.exec(line);
    if (m) {
      last = m[1].toLowerCase();
      if (last in fields) refuse(`"${m[1]}" is given twice`);
      fields[last] = m[2].trim();
    } else if (line.trim() && last) fields[last] += ` ${line.trim()}`;
    else if (line.trim()) refuse(`"${line.trim().slice(0, 40)}" names no field: ${names.join(', ')}`);
  }
  const missing = names.filter((k) => !fields[k]);
  if (missing.length) refuse(`stdin lacks ${missing.join(', ')}: one "name: value" line each`);
  return fields;
}

// A row waits: a new bug's whole row, or a change merged into the row that already waits for that bug.
function wait(change) {
  const table = bugTable(read(waiting.bugs));
  const rows = table.rows.map((r) => ({ ...r }));
  const at = rows.findIndex((r) => r.id === change.id);
  if (at < 0) rows.push(change);
  else rows[at] = { ...rows[at], ...change };
  save(waiting.bugs, writeBugTable(table, rows, INTRO.bugs));
}

// docs/BUGS.md in the work tree, a table of seven columns given the new ones first.
function treeTable() {
  const path = join(project, 'docs', 'BUGS.md');
  if (!existsSync(path)) refuse(`${path} does not exist: it is a path every pitwall project has (pitwall ADR-0006)`);
  const table = bugTable(read(path));
  if (!table.header) refuse(`${path} holds no table`);
  const rows = table.rows.map((r) => (table.old ? { ...r, ...oldDefaults(r, cfg) } : { ...r }));
  return { path, table, rows };
}
function notOnMain(what) {
  const branch = git('branch', '--show-current').out;
  if (branch === cfg.mergeProtection.branch) refuse(`${what} on ${branch}, which is protected: it belongs in the first commit of the next branch, so run it there`);
}

const view = bugsView(project, cfg);
const find = (bug) => view.rows.find((r) => r.id === bug) ?? refuse(`${bug} is not a bug of docs/BUGS.md, nor one waiting to go there`);

if (command === 'file') {
  const fields = stdinFields(['title', 'found in', 'steps', 'expected', 'actual', 'severity', 'risk', 'confirmed']);
  if (fields.title.length > 60) refuse(`the title is ${fields.title.length} characters: a short name of at most 60, which plans and RISKS give the bug beside its ID`);
  const confirmed = pick(fields.confirmed, ['yes', 'no'], 'confirmed');
  const found = pick(fields['found in'], cfg.bugs.foundIn, 'found in');
  let severity = pick(fields.severity, severities, 'severity');
  let risk = pick(fields.risk, classes, 'risk');
  if (confirmed === 'no') {
    severity = `${cfg.bugs.unconfirmed.severity} (${mark})`;
    risk = `${cfg.bugs.unconfirmed.risk} (${mark})`;
  }
  const bug = nextBugId(project, view, git, cfg);
  wait({ id: bug, title: fields.title, found, steps: fields.steps, expected: fields.expected, actual: fields.actual, severity, risk, status: cfg.bugs.statuses[0], fix: '-' });
  console.log(`FILED: ${bug} (${bugCell(fields.title)}), ${severity}, ${risk}. It waits in ${shown(waiting.bugs)} until the first commit of the next branch moves it into docs/BUGS.md.`);
  process.exit(0);
}

if (command === 'set') {
  const bug = find(id);
  const change = { id };
  if (args.title !== undefined) {
    if (!args.title.trim() || args.title.length > 60) refuse('the title is a short name of 1 to 60 characters');
    change.title = args.title.trim();
  }
  if (bug.unconfirmed && (args.severity !== undefined) !== (args.risk !== undefined)) refuse(`${id} is not confirmed yet: give both its severity and its class, as the owner answered`);
  if (args.severity !== undefined) change.severity = pick(args.severity, severities, 'severity');
  if (args.risk !== undefined) change.risk = pick(args.risk, classes, 'risk');
  if (args.status !== undefined) {
    const status = pick(args.status, cfg.bugs.statuses, 'status');
    if (status === 'accepted') refuse('a bug the owner will not have fixed becomes a risk: bugs.mjs accept <BUG-n> --fallback <text>');
    change.status = status;
  }
  if (args['fix-pr'] !== undefined) {
    if (!/^#\d+$/.test(args['fix-pr'])) refuse(`--fix-pr "${args['fix-pr']}" is not a PR number, #<n>`);
    change.fix = args['fix-pr'];
  }
  if (Object.keys(change).length === 1) bad('set changes nothing: give --severity, --risk, --status, --fix-pr or --title');
  const what = Object.keys(change).filter((k) => k !== 'id').join(', ');
  if (args.tree) {
    notOnMain('writing docs/BUGS.md');
    const { path, table, rows } = treeTable();
    const at = rows.findIndex((r) => bugFacts(r, cfg).id === id);
    if (at < 0) refuse(`${id} is not a row of docs/BUGS.md in the work tree: what waits for the next branch moves there with bugs.mjs flush`);
    rows[at] = { ...rows[at], ...change };
    writeFileSync(path, writeBugTable(table, rows));
    console.log(`SET: ${id} ${what} in docs/BUGS.md`);
  } else {
    wait(change);
    console.log(`SET: ${id} ${what}; it waits in ${shown(waiting.bugs)} until the first commit of the next branch`);
  }
  process.exit(0);
}

if (command === 'accept') {
  const bug = find(id);
  if (!bug.open) refuse(`${id} is ${bug.status} already`);
  if (!args.fallback?.trim()) bad('accept needs --fallback: what the owner does if the risk comes true');
  const risk = nextId('R', DOC.risks, 'risks');
  const line = `| ${risk} | ${bugCell(`${id} (${bug.title}), not fixed: ${bug.row.actual ?? ''}`)} | ${bugCell(args.fallback)} | ${today()} |`;
  save(waiting.risks, appendRows(read(waiting.risks) || INTRO.risks, [line]));
  wait({ id, status: `accepted (${risk})` });
  console.log(`ACCEPTED: ${id} becomes ${risk}; both wait in the git directory until the first commit of the next branch`);
  process.exit(0);
}

if (command === 'lesson') {
  const fields = stdinFields(['rule', 'why', 'checked by']);
  const lesson = nextId('L', DOC.lessons, 'lessons');
  const line = `| ${lesson} | ${bugCell(fields.rule)} | ${bugCell(fields.why)} | ${today()} | ${bugCell(fields['checked by'])} |`;
  if (args.tree) {
    notOnMain('writing docs/LESSONS.md');
    const path = join(project, DOC.lessons);
    if (!existsSync(path) || !bugTable(read(path)).header) refuse(`${path} holds no table of lessons: it is a path every pitwall project has (pitwall ADR-0006)`);
    writeFileSync(path, appendRows(read(path), [line]));
    console.log(`RECORDED: ${lesson} in docs/LESSONS.md; commit it with the change it comes from`);
  } else {
    save(waiting.lessons, appendRows(read(waiting.lessons) || INTRO.lessons, [line]));
    console.log(`RECORDED: ${lesson}; it waits in ${shown(waiting.lessons)} until the first commit of the next branch moves it into docs/LESSONS.md`);
  }
  process.exit(0);
}

if (command === 'list') {
  const bugs = view.rows.filter((r) => args.all || r.open).map((r) => ({ id: r.id, title: r.title, severity: r.severity, risk: r.risk, unconfirmed: r.unconfirmed, status: r.status, waiting: r.row.waiting ?? null, branch: r.row.branch ?? null }));
  if (args.json) {
    console.log(JSON.stringify({ bugs, old: view.tree.old, pending: shown(waiting.bugs) }, null, 2));
    process.exit(0);
  }
  if (bugs.length === 0) console.log(`bugs: no ${args.all ? '' : 'open '}bugs.`);
  for (const b of bugs) {
    console.log(`${b.id} (${b.title}): ${b.severity}${b.unconfirmed ? ` and ${b.risk}, both ${mark}` : `, ${b.risk}`}, ${b.status || 'open'}${b.branch ? `, its row on ${b.branch}` : ''}${b.waiting ? `, waits in the git directory (${b.waiting === 'new' ? 'new' : 'a change'})` : ''}`);
  }
  if (view.tree.old) console.log('Note: docs/BUGS.md has the table of seven columns from before T4b; bugs.mjs flush gives it the new columns, each open bug blocking and high.');
  process.exit(0);
}

if (command === 'flush') {
  notOnMain('moving what waits into docs/');
  const { path, table, rows } = treeTable();
  const moved = [];
  const kept = [];
  if (table.old) moved.push(`docs/BUGS.md gains the columns Title, Severity, Risk: each bug of the old table is ${cfg.bugs.unconfirmed.severity} and ${cfg.bugs.unconfirmed.risk}, its title taken from what happened`);
  let elsewhere = null;
  for (const p of bugTable(read(waiting.bugs)).rows) {
    const at = rows.findIndex((r) => bugFacts(r, cfg).id === p.id);
    const cells = changedCells(p);
    if (at >= 0) {
      rows[at] = { ...rows[at], ...cells };
      moved.push(`${p.id} (${Object.keys(cells).join(', ')})`);
    } else if (isNewBug(p)) {
      rows.push(p);
      moved.push(`${p.id} (new)`);
    } else {
      // A change to a bug another branch holds, not merged yet: this branch takes the row with the
      // change, and when both meet in a merge, bugs.mjs resolve joins the two rows cell by cell.
      elsewhere ??= bugsOnBranches(project, cfg, git);
      const base = elsewhere.get(p.id);
      if (!base) {
        kept.push(p);
        continue;
      }
      rows.push({ ...base.row, ...cells });
      moved.push(`${p.id} (its row from ${base.branch}, with ${Object.keys(cells).join(', ')})`);
    }
  }
  const writes = [];
  for (const kind of ['risks', 'lessons']) {
    const lines = rowLines(bugTable(read(waiting[kind])));
    if (!lines.length) continue;
    const rel = DOC[kind];
    if (!existsSync(join(project, rel)) || !bugTable(read(join(project, rel))).header) refuse(`${rel} holds no table: it is a path every pitwall project has (pitwall ADR-0006)`);
    writes.push([rel, appendRows(read(join(project, rel)), lines)]);
    moved.push(...lines.map((l) => `${rowId(l)} into ${rel}`));
  }
  const left = kept.length ? ` Still waiting, since no branch holds their row: ${kept.map((k) => k.id).join(', ')}.` : '';
  if (moved.length === 0) {
    console.log(`FLUSHED: nothing waits.${left}`);
    process.exit(0);
  }
  writeFileSync(path, writeBugTable(table, rows));
  for (const [rel, text] of writes) writeFileSync(join(project, rel), text);
  if (kept.length) save(waiting.bugs, writeBugTable(bugTable(read(waiting.bugs)), kept, INTRO.bugs));
  else rmSync(waiting.bugs, { force: true });
  for (const kind of ['risks', 'lessons']) rmSync(waiting[kind], { force: true });
  const files = ['docs/BUGS.md', ...writes.map(([rel]) => rel)];
  console.log(`FLUSHED: ${moved.join('; ')}. Commit ${files.join(', ')} in the first commit of this branch.${left}`);
  process.exit(0);
}

if (command === 'resolve') {
  // After git merge main stopped on docs/BUGS.md, docs/RISKS.md or docs/LESSONS.md: both sides added or
  // changed rows. Every row of both is kept; a cell of a bug that only one side changed is that side's.
  if (!git('rev-parse', '-q', '--verify', 'MERGE_HEAD').ok) refuse('no merge is in progress: resolve finishes a git merge that stopped on docs/BUGS.md, docs/RISKS.md or docs/LESSONS.md');
  const conflicted = git('-c', 'core.quotePath=false', 'diff', '--name-only', '--diff-filter=U').out.split('\n').filter(Boolean);
  const done = [];
  const side = (stage, rel) => bugTable(git('show', `:${stage}:${rel}`).raw);
  if (conflicted.includes('docs/BUGS.md')) {
    const [base, ours, theirs] = [1, 2, 3].map((n) => side(n, 'docs/BUGS.md'));
    if (!ours.header || !theirs.header) refuse('docs/BUGS.md: one side holds no table, so its rows cannot be joined: resolve it by hand');
    const byId = (t) => new Map(t.rows.map((r) => [bugFacts(r, cfg).id, t.old ? { ...r, ...oldDefaults(r, cfg) } : r]));
    const [b, o, t] = [base, ours, theirs].map(byId);
    // Cell by cell against the merge base: a cell one side changed is that side's. One both changed
    // differently keeps the status further along, the higher class, blocking over not blocking, and
    // otherwise main's word.
    const rank = { status: (v) => cfg.bugs.statuses.findIndex((s) => String(v).toLowerCase().startsWith(s)), risk: (v) => classes.indexOf(bugFacts({ risk: v }, cfg).risk), severity: (v) => (bugFacts({ severity: v }, cfg).severity === severities[0] ? 1 : 0) };
    const joinRows = (was, mine, main) => {
      const row = {};
      for (const k of new Set([...Object.keys(main), ...Object.keys(mine)])) {
        const [x, y, z] = [was?.[k], mine[k] ?? '', main[k] ?? ''];
        row[k] = y === z ? y : was && y === x ? z : was && z === x ? y : rank[k] ? (rank[k](y) > rank[k](z) ? y : z) : z;
      }
      return row;
    };
    const rows = [...t.keys()].map((key) => (o.has(key) ? joinRows(b.get(key), o.get(key), t.get(key)) : t.get(key)));
    for (const [key, r] of o) if (!t.has(key)) rows.push(r);
    writeFileSync(join(project, 'docs', 'BUGS.md'), writeBugTable(ours, rows));
    git('add', '--', 'docs/BUGS.md');
    done.push('docs/BUGS.md');
  }
  for (const rel of Object.values(DOC).filter((r) => conflicted.includes(r))) {
    const [ours, theirs] = [2, 3].map((n) => side(n, rel));
    if (!ours.header || !theirs.header) refuse(`${rel}: one side holds no table, so its rows cannot be joined: resolve it by hand`);
    const main = new Map(rowLines(theirs).map((l) => [rowId(l) ?? l, l]));
    const clash = rowLines(ours).filter((l) => main.has(rowId(l) ?? l) && main.get(rowId(l) ?? l).trim() !== l.trim()).map(rowId);
    if (clash.length) refuse(`${rel}: both sides gave ${clash.join(', ')} to different rows: number one of them anew by hand`);
    const lines = [...ours.lines.slice(0, ours.first), ...theirs.lines.slice(theirs.first, theirs.end), ...rowLines(ours).filter((l) => !main.has(rowId(l) ?? l)), ...ours.lines.slice(ours.end)];
    writeFileSync(join(project, rel), lines.join('\n'));
    git('add', '--', rel);
    done.push(rel);
  }
  const others = conflicted.filter((f) => !done.includes(f));
  if (others.length) refuse(`${done.length ? `joined the rows of ${done.join(', ')}; ` : ''}other files are in conflict too (${others.join(', ')}): they are no table of rows, so stop and hand them over`);
  console.log(done.length ? `RESOLVED: ${done.join(', ')}, every row of both sides kept, each cell of a bug as the side that changed it left it. Finish the merge with git commit --no-edit.` : 'RESOLVED: nothing: none of docs/BUGS.md, docs/RISKS.md, docs/LESSONS.md is in conflict');
  process.exit(0);
}
