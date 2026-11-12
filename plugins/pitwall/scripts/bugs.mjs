#!/usr/bin/env node
// Files and keeps the bugs and lessons of a pitwall project (T4b-AC1, AC2), for /pitwall:bug,
// /pitwall:lesson, /pitwall:continue and /pitwall:owner-calls.
//
//   node bugs.mjs file [--project <dir>]
//       The bug on stdin, one "name: value" line each (a line with no name goes on the value before it):
//       title, found in, steps, expected, actual, severity, risk, and confirmed: yes when the owner
//       answered on the severity and the class, no when they were not asked. An unconfirmed bug is
//       filed blocking, marked so, whatever the filer proposed (owner, 2026-11-11). The class picks the
//       implementer of the fix and nothing else: every fix merges after the owner's yes (ADR-0010).
//   node bugs.mjs set <BUG-n> [--severity <s>] [--risk <class>] [--status <s>] [--fix-pr <#n>] [--title <t>] [--found <where>] [--tree] [--project <dir>]
//       A change to a bug. An unconfirmed bug is confirmed by giving its severity.
//       --tree writes docs/BUGS.md in the work tree, for the conductor's own status on its branch;
//       without it the change waits in the git directory, as a new bug does.
//   node bugs.mjs accept <BUG-n> [--project <dir>]
//       The owner's no to a fix: the bug becomes the next R-n of docs/RISKS.md, its status accepted (R-n);
//       both wait in the git directory too. On stdin: fallback, what the owner does if it comes true.
//   node bugs.mjs risk [--tree] [--project <dir>]
//       A risk the owner accepted, on stdin as risk and fallback, the next R-n, dated today: --tree writes docs/RISKS.md in the work
//       tree, for a risk of the review of the change in flight; without it, it waits like a bug.
//   node bugs.mjs lesson [--tree] [--project <dir>]
//       The lesson on stdin, as a bug is given: rule, why, checked by. It becomes the next L-n, dated
//       today, and waits in the git directory; --tree writes docs/LESSONS.md in the work tree instead,
//       for a lesson from the review of the change in flight, which that change's branch commits, and
//       only when every BUG-n it names is a row there or in docs/archive/; risk --tree likewise.
//   node bugs.mjs list [--json] [--all] [--project <dir>]
//       The open bugs (--all: every bug): docs/BUGS.md, the bugs whose row only another branch holds,
//       and what waits over them.
//   node bugs.mjs flush [--project <dir>]
//       Writes what waits into docs/BUGS.md, docs/RISKS.md and docs/LESSONS.md, in the work tree of the
//       branch the project is on, never main, for the first commit of that branch; what waits stays in
//       the git directory until a commit holds it, and any later run lets it go. A table of seven
//       columns from before T4b gains the new ones first, each open bug in it blocking and high. A change
//       to a bug whose row is on the change in flight, not merged yet, keeps waiting for the branch after
//       it, and so does a lesson naming a bug that is not a row here. A table whose columns are neither
//       the template's nor the seven of before T4b is refused, and nothing is written.
//
// What waits lives in the git directory (bugs.pending in the config), outside the work tree, so no
// implementer commits it into another change and no switch, stash or checkout touches it (owner,
// 2026-11-11). One change is in flight at a time and a blocking bug waits for it to merge, so the
// branches never write docs/BUGS.md side by side. Numbers are taken past every one in the work tree, in
// what waits and on every branch.
// Exit 0 done, 1 refused (a value the config does not know, a bug that does not exist, main), 2 usage.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { archivedBugIds, bugCell, bugColumns, bugFacts, bugTable, bugsView, changedCells, config, gitRunner, isNewBug, nextBugId, oldDefaults, parseArgs, pendingBugsPath, requireNode, riskOrder, writeBugTable } from './lib.mjs';

requireNode();
const usage = [
  'node bugs.mjs file [--project <dir>]   (the bug on stdin)',
  'node bugs.mjs set <BUG-n> [--severity <s>] [--risk <class>] [--status <s>] [--fix-pr <#n>] [--title <t>] [--found <where>] [--tree] [--project <dir>]',
  'node bugs.mjs accept <BUG-n> [--project <dir>]   (the fallback on stdin)',
  'node bugs.mjs risk [--tree] [--project <dir>]   (the risk and its fallback on stdin)',
  'node bugs.mjs lesson [--tree] [--project <dir>]   (the lesson on stdin)',
  'node bugs.mjs list [--json] [--all] [--project <dir>]',
  'node bugs.mjs flush [--project <dir>]',
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
  set: { project: 'value', severity: 'value', risk: 'value', status: 'value', 'fix-pr': 'value', title: 'value', found: 'value', tree: 'switch' },
  accept: { project: 'value' },
  risk: { project: 'value', tree: 'switch' },
  lesson: { project: 'value', tree: 'switch' },
  list: { project: 'value', json: 'switch', all: 'switch' },
  flush: { project: 'value' },
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
  // A column it does not know would be lost on the rewrite: the table must be the template's or the old one.
  const want = bugColumns();
  if (!table.old && table.header.map((h) => h.toLowerCase()).join('|') !== want.map((h) => h.toLowerCase()).join('|')) {
    refuse(`docs/BUGS.md has the columns | ${table.header.join(' | ')} |: neither the template's (| ${want.join(' | ')} |) nor the seven of a project laid out before T4b. Put the template's back (pitwall ADR-0006), then run this again; nothing was written.`);
  }
  const rows = table.rows.map((r) => (table.old ? { ...r, ...oldDefaults(r, cfg) } : { ...r }));
  return { path, table, rows };
}
// The bugs a text names: the docs check reads every BUG-n of docs/ as an ID that must point somewhere.
// One in a code span is an example, which the docs check skips.
const bugsNamed = (text) => [...new Set([...String(text ?? '').replace(/`[^`]*`/g, ' ').matchAll(/\bBUG-\d+\b/g)].map((m) => m[0]))];
function notOnMain(what) {
  const branch = git('branch', '--show-current').out;
  if (branch === cfg.mergeProtection.branch) refuse(`${what} on ${branch}, which is protected: it belongs in the first commit of the next branch, so run it there`);
}

// A new bug, a risk or a lesson leaves the git directory only once a commit holds it (review round 2): flush
// writes it into docs/ and keeps it, and each run lets go of what HEAD holds now, a bug by its ID, whatever
// the conductor set on it since (review round 3), or the same line of a risk or a lesson. A session that
// ends between the flush and the commit loses no new row. A change to a bug goes at the flush that writes it.
function prune() {
  const atHead = (rel) => {
    const r = git('show', `HEAD:${rel}`);
    return r.ok ? r.raw : null;
  };
  const headBugs = atHead('docs/BUGS.md');
  if (headBugs !== null && existsSync(waiting.bugs)) {
    const held = new Map(bugTable(headBugs).rows.map((r) => [bugFacts(r, cfg).id, r]));
    const table = bugTable(read(waiting.bugs));
    const left = table.rows.filter((w) => {
      const h = held.get(w.id);
      if (!h) return true;
      if (isNewBug(w)) return false;
      return Object.entries(changedCells(w)).some(([k, v]) => String(h[k] ?? '').trim() !== String(v).trim());
    });
    if (left.length === 0) rmSync(waiting.bugs, { force: true });
    else if (left.length !== table.rows.length) save(waiting.bugs, writeBugTable(table, left, INTRO.bugs));
  }
  for (const kind of ['risks', 'lessons']) {
    const headText = atHead(DOC[kind]);
    if (headText === null || !existsSync(waiting[kind])) continue;
    const held = new Set(headText.split(/\r?\n/).map((l) => l.trim()));
    const lines = rowLines(bugTable(read(waiting[kind])));
    const left = lines.filter((l) => !held.has(l.trim()));
    if (left.length === 0) rmSync(waiting[kind], { force: true });
    else if (left.length !== lines.length) save(waiting[kind], appendRows(INTRO[kind], left));
  }
}
prune();

// The bugs this branch holds a row of, the archive's included: the only ones a text written on it may name.
const bugsHere = () => new Set([...bugTable(read(join(project, 'docs', 'BUGS.md'))).rows.map((r) => bugFacts(r, cfg).id), ...archivedBugIds(project)]);
const onlyBugsHere = (text, what) => {
  const away = bugsNamed(text).filter((b) => !bugsHere().has(b));
  if (away.length) refuse(`${away.join(', ')} is not a row of docs/BUGS.md on this branch: record this ${what} without --tree, so that it waits with the bug and reaches docs/ in the same first commit, or name the bug in a code span`);
};

const view = bugsView(project, cfg);
const find = (bug) => view.rows.find((r) => r.id === bug) ?? refuse(`${bug} is not a bug of docs/BUGS.md, nor one waiting to go there`);

if (command === 'file') {
  const fields = stdinFields(['title', 'found in', 'steps', 'expected', 'actual', 'severity', 'risk', 'confirmed']);
  if (fields.title.length > 60) refuse(`the title is ${fields.title.length} characters: a short name of at most 60, which plans and RISKS give the bug beside its ID`);
  const confirmed = pick(fields.confirmed, ['yes', 'no'], 'confirmed');
  const found = pick(fields['found in'], cfg.bugs.foundIn, 'found in');
  let severity = pick(fields.severity, severities, 'severity');
  const risk = pick(fields.risk, classes, 'risk');
  // Not confirmed by the owner: blocking, marked so, until they answer; the class only picks the implementer.
  if (confirmed === 'no') severity = `${cfg.bugs.unconfirmed.severity} (${mark})`;
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
  // An unconfirmed bug is confirmed by its severity, as the owner answered.
  if (args.severity !== undefined) change.severity = pick(args.severity, severities, 'severity');
  if (args.risk !== undefined) change.risk = pick(args.risk, classes, 'risk');
  if (args.status !== undefined) {
    const status = pick(args.status, cfg.bugs.statuses, 'status');
    if (status === 'accepted') refuse('a bug the owner will not have fixed becomes a risk: bugs.mjs accept <BUG-n>, the fallback on stdin');
    change.status = status;
  }
  if (args['fix-pr'] !== undefined) {
    if (!/^#\d+$/.test(args['fix-pr'])) refuse(`--fix-pr "${args['fix-pr']}" is not a PR number, #<n>`);
    change.fix = args['fix-pr'];
  }
  if (args.found !== undefined) change.found = pick(args.found, cfg.bugs.foundIn, 'found in');
  if (Object.keys(change).length === 1) bad('set changes nothing: give --severity, --risk, --status, --fix-pr, --title or --found');
  const what = Object.keys(change).filter((k) => k !== 'id').join(', ');
  // A bug a flush just wrote into this branch, its commit not made yet: the change goes into that row, or it
  // would wait over a row the next flush never writes again (review round 3).
  const inTree = bugTable(read(join(project, 'docs', 'BUGS.md'))).rows.some((r) => bugFacts(r, cfg).id === id);
  const waitsNew = bugTable(read(waiting.bugs)).rows.some((r) => r.id === id && isNewBug(r));
  if (!args.tree && inTree && waitsNew) refuse(`${id} was just written into docs/BUGS.md on this branch and is not committed yet: set it with --tree`);
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
  // Free text goes on stdin through a quoted heredoc: in a quoted argument bash would expand it (review round 3).
  const { fallback } = stdinFields(['fallback']);
  const risk = nextId('R', DOC.risks, 'risks');
  const line = `| ${risk} | ${bugCell(`${id} (${bug.title}), not fixed: ${bug.row.actual ?? ''}`)} | ${bugCell(fallback)} | ${today()} |`;
  save(waiting.risks, appendRows(read(waiting.risks) || INTRO.risks, [line]));
  wait({ id, status: `accepted (${risk})` });
  console.log(`ACCEPTED: ${id} becomes ${risk}; both wait in the git directory until the first commit of the next branch`);
  process.exit(0);
}

if (command === 'risk') {
  // A risk the owner accepted in a review round: numbered past every R-n here, waiting and on every branch.
  const { risk: text, fallback } = stdinFields(['risk', 'fallback']);
  const risk = nextId('R', DOC.risks, 'risks');
  const line = `| ${risk} | ${bugCell(text)} | ${bugCell(fallback)} | ${today()} |`;
  if (args.tree) {
    notOnMain('writing docs/RISKS.md');
    onlyBugsHere(`${text} ${fallback}`, 'risk');
    const path = join(project, DOC.risks);
    if (!existsSync(path) || !bugTable(read(path)).header) refuse(`${path} holds no table of risks: it is a path every pitwall project has (pitwall ADR-0006)`);
    writeFileSync(path, appendRows(read(path), [line]));
    console.log(`ACCEPTED: ${risk} in docs/RISKS.md; commit it with the change it comes from`);
  } else {
    save(waiting.risks, appendRows(read(waiting.risks) || INTRO.risks, [line]));
    console.log(`ACCEPTED: ${risk}; it waits in ${shown(waiting.risks)} until the first commit of the next branch moves it into docs/RISKS.md`);
  }
  process.exit(0);
}

if (command === 'lesson') {
  const fields = stdinFields(['rule', 'why', 'checked by']);
  if (/^-+$/.test(fields['checked by'])) refuse('"checked by" says nothing: name the tool that checks it, "Not by a tool until" the bug that builds one, or who checks it by hand');
  const lesson = nextId('L', DOC.lessons, 'lessons');
  const line = `| ${lesson} | ${bugCell(fields.rule)} | ${bugCell(fields.why)} | ${today()} | ${bugCell(fields['checked by'])} |`;
  if (args.tree) {
    notOnMain('writing docs/LESSONS.md');
    // A lesson in the tree that names a bug whose row is not there fails the docs check of this change (round 1, finding 2).
    onlyBugsHere(`${fields.rule} ${fields.why} ${fields['checked by']}`, 'lesson');
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
    console.log(`${b.id} (${b.title}): ${b.severity}${b.unconfirmed ? ` (${mark})` : ''}, ${b.risk}, ${b.status || 'open'}${b.branch ? `, its row on ${b.branch}` : ''}${b.waiting ? `, waits in the git directory (${b.waiting === 'new' ? 'new' : 'a change'})` : ''}`);
  }
  if (view.tree.old) console.log('Note: docs/BUGS.md has the table of seven columns from before T4b; bugs.mjs flush gives it the new columns, each open bug blocking and high.');
  process.exit(0);
}

if (command === 'flush') {
  notOnMain('moving what waits into docs/');
  const { path, table, rows } = treeTable();
  const moved = [];
  const kept = [];
  if (table.old) moved.push(`docs/BUGS.md gains the columns Title, Severity, Risk: each bug of the old table is ${cfg.bugs.oldTable.severity} and ${cfg.bugs.oldTable.risk}, its title taken from what happened`);
  const archived = archivedBugIds(project);
  const applied = [];
  for (const p of bugTable(read(waiting.bugs)).rows) {
    const at = rows.findIndex((r) => bugFacts(r, cfg).id === p.id);
    const cells = changedCells(p);
    if (isNewBug(p)) {
      // A new bug an earlier flush wrote, or the archive holds, is never written over: what the branch set
      // on it since stands (review round 3).
      if (at >= 0 || archived.has(p.id)) continue;
      rows.push(p);
      moved.push(`${p.id} (new)`);
    } else if (at >= 0) {
      const differ = Object.keys(cells).filter((k) => String(rows[at][k] ?? '').trim() !== String(cells[k]).trim());
      rows[at] = { ...rows[at], ...cells };
      applied.push(p.id);
      if (differ.length) moved.push(`${p.id} (${differ.join(', ')})`);
    } else {
      // A change to a bug whose row is on the change in flight, not merged yet: it waits for a branch that
      // starts after that change merged, which holds the row (one change in flight at a time).
      kept.push(p);
    }
  }
  const ids = new Set([...rows.map((r) => bugFacts(r, cfg).id), ...archivedBugIds(project)]);
  const writes = [];
  const keptLessons = [];
  for (const kind of ['risks', 'lessons']) {
    let lines = rowLines(bugTable(read(waiting[kind])));
    // A lesson that names a bug whose row is not here keeps waiting for it.
    if (kind === 'lessons') {
      keptLessons.push(...lines.filter((l) => bugsNamed(l).some((b) => !ids.has(b))));
      lines = lines.filter((l) => !keptLessons.includes(l));
    }
    const rel = DOC[kind];
    // A line a flush before this one already wrote, the commit not made yet, is not written twice.
    const there = new Set(rowLines(bugTable(read(join(project, rel)))).map(rowId));
    lines = lines.filter((l) => !there.has(rowId(l)));
    if (!lines.length) continue;
    if (!existsSync(join(project, rel)) || !bugTable(read(join(project, rel))).header) refuse(`${rel} holds no table: it is a path every pitwall project has (pitwall ADR-0006)`);
    writes.push([rel, appendRows(read(join(project, rel)), lines)]);
    moved.push(...lines.map((l) => `${rowId(l)} into ${rel}`));
  }
  const left = [kept.length ? ` Still waiting for the branch after the change in flight, which holds their row: ${kept.map((k) => k.id).join(', ')}.` : '', keptLessons.length ? ` Still waiting for the bugs they name: ${keptLessons.map(rowId).join(', ')}.` : ''].join('');
  if (moved.length === 0) {
    console.log(`FLUSHED: nothing new to move.${left}`);
    process.exit(0);
  }
  writeFileSync(path, writeBugTable(table, rows));
  for (const [rel, text] of writes) writeFileSync(join(project, rel), text);
  // A change is written once and goes; a new bug waits until a commit holds it.
  if (applied.length) {
    const t = bugTable(read(waiting.bugs));
    const left = t.rows.filter((r) => isNewBug(r) || !applied.includes(r.id));
    if (left.length) save(waiting.bugs, writeBugTable(t, left, INTRO.bugs));
    else rmSync(waiting.bugs, { force: true });
  }
  const files = ['docs/BUGS.md', ...writes.map(([rel]) => rel)];
  console.log(`FLUSHED: ${moved.join('; ')}. Commit ${files.join(', ')} in the first commit of this branch: what waits leaves the git directory once a commit holds it.${left}`);
  process.exit(0);
}
