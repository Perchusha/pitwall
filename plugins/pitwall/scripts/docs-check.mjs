#!/usr/bin/env node
// The docs check of a pitwall project (T1-AC5, T2-AC1, T2-AC3, T2-AC4, ADR-0003, ADR-0006).
//
//   node docs-check.mjs [--root <dir>] [--stage <stage>[,<stage>...]] [--only sections,ids,size]
//
// Stages: kickoff, discovery, decide, spike, plan, plan-review.
//
// Always, unless --only narrows it:
//   sections  every "## " heading of a template document is in the project's copy,
//             ADRs follow docs/adr/0000-template.md and epics docs/epics/E0-skeleton.md;
//   ids       every ID in docs/ and CLAUDE.md points at something that exists:
//             ADR-NNNN, the epic IDs of docs/EPICS.md and their -ACn, BUG-n, L-n,
//             A-n (assumptions) and R-n (risks); an ID in a code span is an example;
//   size      CLAUDE.md and the state files stay within docsLimits in config/defaults.json.
// --stage adds the Check of that skill: what the stage writes is there and filled in.
// spike reads git history (pitwall ADR-0009): it runs locally only and fails closed on a
// shallow clone or outside git. plan-review includes plan.
//
// Exit 0 pass, 1 problems found (each printed), 2 usage.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config, gitRunner, listFiles, parseArgs, projectPath, requireNode, templateRoot } from './lib.mjs';

requireNode();
const usage = 'node docs-check.mjs [--root <dir>] [--stage kickoff|discovery|decide|spike|plan|plan-review[,...]] [--only sections,ids,size]';
const args = parseArgs(process.argv.slice(2), { root: 'value', stage: 'value', only: 'value' }, usage);
const KINDS = ['sections', 'ids', 'size'];
const STAGES = ['kickoff', 'discovery', 'decide', 'spike', 'plan', 'plan-review'];
const kinds = args.only ? args.only.split(',').map((k) => k.trim()) : KINDS;
const stages = args.stage ? args.stage.split(',').map((s) => s.trim()) : [];
if (kinds.some((k) => !KINDS.includes(k)) || stages.some((s) => !STAGES.includes(s))) {
  console.error(`docs-check: bad --only or --stage\nusage: ${usage}`);
  process.exit(2);
}
const root = resolve(args.root ?? '.');
if (!existsSync(root) || !statSync(root).isDirectory()) {
  console.error(`docs-check: ${root} is not a folder\nusage: ${usage}`);
  process.exit(2);
}
const cfg = config();
const problems = [];
const report = (where, msg) => problems.push(`${where}: ${msg}`);

// ---------- Markdown helpers ----------

const has = (rel) => existsSync(join(root, rel));
// A byte order mark (Windows PowerShell 5.1 writes one) is not part of the text.
const BOM = new RegExp(`^${String.fromCodePoint(0xfeff)}`);
const read = (rel) => readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n').replace(BOM, '');
const readTemplate = (rel) => readFileSync(join(templateRoot, rel), 'utf8').replace(/\r\n/g, '\n');

// Which lines belong to a fenced block, its fences included, the way GitHub reads them: a fence
// is three or more backticks or tildes indented at most three spaces, and the block ends at a
// fence of the same character, at least as long, with nothing after it.
function fencedLines(lines) {
  const out = [];
  let open = null;
  for (const line of lines) {
    if (open) {
      out.push(true);
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1][0] === open[0] && close[1].length >= open.length) open = null;
      continue;
    }
    const start = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    // A backtick fence's info string holds no backtick.
    if (start && !(start[1][0] === '`' && start[2].includes('`'))) {
      open = start[1];
      out.push(true);
      continue;
    }
    out.push(false);
  }
  return out;
}

// Fenced blocks become empty lines and code spans become spaces, so line numbers hold.
function stripCode(text) {
  const lines = text.split('\n');
  const fenced = fencedLines(lines);
  return lines.map((line, i) => (fenced[i] ? '' : line.replace(/(`+).*?\1/g, (m) => ' '.repeat(m.length)))).join('\n');
}
// The text with its fenced blocks blanked out, code spans kept.
const unfenced = (text) => {
  const lines = text.split('\n');
  const fenced = fencedLines(lines);
  return lines.map((line, i) => (fenced[i] ? '' : line)).join('\n');
};

// "## heading" -> its body lines, up to the next heading of level 1 or 2.
function sections(text) {
  const map = new Map();
  let current = null;
  const lines = text.split('\n');
  const fenced = fencedLines(lines);
  lines.forEach((line, i) => {
    const h = !fenced[i] && /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      current = h[1];
      map.set(current, []);
    } else if (!fenced[i] && /^#\s/.test(line)) {
      current = null;
    } else if (current) {
      map.get(current).push(line);
    }
  });
  return map;
}

const isSeparator = (cells) => cells.every((c) => /^:?-{3,}:?$/.test(c));
const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());

// Data rows of the first table in some lines, outside fenced blocks: header and separator dropped.
function tableRows(lines) {
  const rows = [];
  let seen = 0;
  const fenced = fencedLines(lines);
  for (const [i, line] of lines.entries()) {
    if (fenced[i] || !line.trim().startsWith('|')) {
      if (seen > 0) break;
      continue;
    }
    const cells = splitRow(line);
    seen += 1;
    if (seen === 1 || isSeparator(cells)) continue;
    rows.push(cells);
  }
  return rows;
}

const listItems = (lines) => lines.filter((l) => /^(?:[-*]|\d+\.)\s+\S/.test(l));

// A section is filled when it holds a line the template's section does not.
function filled(lines, templateLines = []) {
  const tpl = new Set(templateLines.map((l) => l.trim()).filter(Boolean));
  return lines.some((l) => {
    const t = l.trim();
    return t && !tpl.has(t) && !(t.startsWith('|') && isSeparator(splitRow(t)));
  });
}

// The header cells of the first table in some lines, outside fenced blocks, or null.
const tableHeader = (lines) => {
  const fenced = fencedLines(lines);
  const line = lines.find((l, i) => !fenced[i] && l.trim().startsWith('|'));
  return line ? splitRow(line) : null;
};

// The tables in some lines, outside fenced blocks: each run of lines that start with "|".
function tableCount(lines) {
  const fenced = fencedLines(lines);
  let count = 0;
  let inTable = false;
  lines.forEach((line, i) => {
    const row = !fenced[i] && line.trim().startsWith('|');
    if (row && !inTable) count += 1;
    inTable = row;
  });
  return count;
}
// "## " headings outside fenced blocks, in their order, repeats included.
function headingList(text) {
  const lines = text.split('\n');
  const fenced = fencedLines(lines);
  return lines.flatMap((line, i) => {
    const h = !fenced[i] && /^##\s+(.+?)\s*$/.exec(line);
    return h ? [h[1]] : [];
  });
}

// The checks read a file line by line: tables are lines that start with "|", sections start at
// "## " headings, fields are "- Name:" lines. Markdown that GitHub shows differently could hide a
// row from them, so in the files whose rows they judge it is refused (T2 reviews): HTML comments
// and blocks, block quotes, setext headings and rules, indented headings, a "|" outside a table
// row, a table indented as code, a table outside the sections that hold one, more than one table
// where one is read, a repeated first cell in a table, and a field that appears twice.
//   tables: the "## " sections that may hold one table each, null for one table in the file, "any" for no rule;
//   fields: field names ("- Name:" with dash, "Name:" without) that must appear at most once.
function checkStructure(rel, { tables = null, fields = [], dash = true } = {}) {
  if (!has(rel)) return;
  const lines = read(rel).split('\n');
  const fenced = fencedLines(lines);
  const plain = stripCode(lines.join('\n')).split('\n');
  const perSection = new Map();
  let section = null;
  let inTable = false;
  let rowIndex = 0;
  let firsts = new Set();
  lines.forEach((line, i) => {
    const where = `${rel}:${i + 1}`;
    if (fenced[i]) {
      inTable = false;
      return;
    }
    const text = plain[i];
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) section = heading[1];
    else if (/^#\s/.test(line)) section = null;
    if (text.includes('<!--')) report(where, 'an HTML comment: GitHub hides it, the checks would read it; remove it');
    else if (/^ {0,3}<[A-Za-z/!?]/.test(line)) report(where, 'an HTML block: write it in Markdown the checks read');
    if (/^ {0,3}>/.test(line)) report(where, 'a block quote: the checks read tables and fields outside quotes only');
    if (/^ {0,3}(?:=+|-+|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})[ \t]*$/.test(line)) report(where, 'a setext heading or a rule: use "## " headings and no rules');
    if (/^ {1,3}#{1,6}(?:\s|$)/.test(line)) report(where, 'an indented heading: start a heading at the first column');
    const row = /^ {0,3}\|/.test(line);
    if (!row && /(?<!\\)\|/.test(text)) {
      report(where, /^\s{4,}\|/.test(line) ? 'a table row indented four spaces, which GitHub shows as code' : 'a "|" outside a table row: start the row with "|", or write the "|" as "\\|"');
    }
    if (row) {
      if (!inTable) {
        perSection.set(section, (perSection.get(section) ?? 0) + 1);
        rowIndex = 0;
        firsts = new Set();
      }
      const cells = splitRow(line);
      rowIndex += 1;
      if (rowIndex > 1 && !isSeparator(cells)) {
        const first = (cells[0] ?? '').replace(/[`*_]/g, '').trim().toLowerCase();
        if (first && firsts.has(first)) report(where, `the row "${cells[0]}" repeats a row above it in the same table: keep one row for it`);
        firsts.add(first);
      }
    }
    inTable = row;
  });
  for (const [name, count] of perSection) {
    if (!Array.isArray(tables)) continue;
    if (!tables.includes(name)) report(rel, `a table ${name ? `in "## ${name}"` : 'outside the sections'}: the checks read tables only in ${tables.map((t) => `"## ${t}"`).join(', ')}`);
    else if (count > 1) report(rel, `"## ${name}" holds ${count} tables: keep every row in the one table the template gives it`);
  }
  if (tables === null) {
    const count = [...perSection.values()].reduce((a, b) => a + b, 0);
    if (count > 1) report(rel, `holds ${count} tables: keep every row in the one table the template gives it`);
  }
  const body = unfenced(lines.join('\n'));
  for (const name of fields) {
    const times = (body.match(new RegExp(`^${dash ? '- ' : ''}${name}:`, 'gm')) ?? []).length;
    if (times > 1) report(rel, `"${dash ? '- ' : ''}${name}:" appears ${times} times: keep one`);
  }
}

function requireFilled(rel, templateRel, names) {
  if (!has(rel)) return report(rel, 'missing');
  const mine = sections(read(rel));
  const tpl = sections(readTemplate(templateRel));
  // A repeated heading hides the first one from the checks, which read the last: it is refused.
  const headings = headingList(read(rel));
  for (const name of names) {
    const times = headings.filter((h) => h === name).length;
    if (times > 1) report(rel, `"## ${name}" appears ${times} times: keep one`);
    if (!mine.has(name)) {
      report(rel, `missing section "## ${name}"`);
      continue;
    }
    if (!filled(mine.get(name), tpl.get(name))) report(rel, `section "## ${name}" is not filled in`);
    const want = tableHeader(tpl.get(name) ?? []);
    if (!want) continue;
    // The checks read one table per section, so a second one, such as a later round's rows
    // under a subheading, would go unread: it is refused instead.
    const tables = tableCount(mine.get(name));
    if (tables > 1) report(rel, `"## ${name}" holds ${tables} tables: keep every row in the one table the template gives it`);
    const got = tableHeader(mine.get(name));
    if (!got || got.join('|').toLowerCase() !== want.join('|').toLowerCase()) {
      report(rel, `the table in "## ${name}" must keep the template's columns: | ${want.join(' | ')} |`);
      continue;
    }
    for (const row of tableRows(mine.get(name))) {
      if (row.length !== want.length) report(rel, `"## ${name}": the row "${row[0]}" has ${row.length} cells, the table has ${want.length} columns`);
    }
  }
  return mine;
}

// ---------- sections ----------

const templateDocs = listFiles(templateRoot)
  .map((rel) => ({ rel, dest: projectPath(rel) }))
  .filter(({ dest }) => dest === 'CLAUDE.md' || (dest.startsWith('docs/') && dest.endsWith('.md')));

function requireHeadings(rel, templateRel) {
  const need = [...sections(readTemplate(templateRel)).keys()];
  if (need.length === 0) return;
  if (!has(rel)) return report(rel, 'missing (a contract path, pitwall ADR-0006)');
  const mine = sections(read(rel));
  for (const h of need) if (!mine.has(h)) report(rel, `missing section "## ${h}" (template ${templateRel})`);
}

const filesIn = (rel) => (has(rel) && statSync(join(root, rel)).isDirectory() ? readdirSync(join(root, rel)) : []);
const adrFiles = filesIn('docs/adr').filter((f) => /^\d{4}-.+\.md$/.test(f) && !f.startsWith('0000-'));
const epicFiles = filesIn('docs/epics').filter((f) => f.endsWith('.md'));
const spikeFiles = filesIn('docs/spikes').filter((f) => f.endsWith('.md') && f !== 'README.md' && f !== 'template.md');

if (kinds.includes('sections')) {
  for (const { rel, dest } of templateDocs) requireHeadings(dest, rel);
  for (const f of adrFiles) requireHeadings(`docs/adr/${f}`, 'docs/adr/0000-template.md');
  for (const f of epicFiles.filter((f) => f !== 'E0-skeleton.md')) requireHeadings(`docs/epics/${f}`, 'docs/epics/E0-skeleton.md');
  for (const f of spikeFiles) requireHeadings(`docs/spikes/${f}`, 'docs/spikes/template.md');
}

// ---------- ids ----------

function epicPrefix() {
  if (!has('docs/EPICS.md')) return 'E';
  for (const line of read('docs/EPICS.md').split('\n')) {
    const m = /^\|\s*\[?([A-Z])\d+\]?/.exec(line);
    if (m) return m[1];
  }
  return 'E';
}

if (kinds.includes('ids')) {
  const P = epicPrefix();
  const defined = new Set();
  for (const f of adrFiles) defined.add(`ADR-${f.slice(0, 4)}`);
  const firstCells = (rel) => (has(rel) ? read(rel).split('\n').filter((l) => l.trim().startsWith('|')).map((l) => splitRow(l)[0]) : []);
  const idIn = (cell) => /^\[?([A-Z]+-?\d+)\]?(?:\(.*\))?$/.exec(cell.replace(/`/g, ''))?.[1];
  const rowFiles = ['docs/EPICS.md', 'docs/BUGS.md', 'docs/LESSONS.md', 'docs/RISKS.md', 'docs/DISCOVERY.md', ...filesIn('docs/archive').map((f) => `docs/archive/${f}`)];
  for (const rel of rowFiles) for (const cell of firstCells(rel)) if (idIn(cell)) defined.add(idIn(cell));
  for (const f of epicFiles) {
    const epic = new RegExp(`^(${P}\\d+)-`).exec(f);
    if (epic) defined.add(epic[1]);
    for (const m of read(`docs/epics/${f}`).matchAll(new RegExp(`\\b(${P}\\d+-AC\\d+):`, 'g'))) defined.add(m[1]);
  }

  const patterns = [/\bADR-\d{4}\b/g, new RegExp(`\\b${P}\\d+(?:-AC\\d+)?\\b`, 'g'), /\bBUG-\d+\b/g, /\bL-\d+\b/g, /\bA-\d+\b/g, /\bR-\d+\b/g];
  const scan = ['CLAUDE.md', ...(has('docs') ? listFiles(join(root, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`) : [])].filter(has);
  for (const rel of scan) {
    stripCode(read(rel))
      .split('\n')
      .forEach((line, i) => {
        for (const re of patterns) {
          for (const m of line.matchAll(re)) {
            const id = m[0];
            if (id === 'ADR-0000') continue;
            if (!defined.has(id)) report(`${rel}:${i + 1}`, `${id} points nowhere`);
          }
        }
      });
  }
}

// ---------- size ----------

if (kinds.includes('size')) {
  const lim = cfg.docsLimits;
  if (has('CLAUDE.md')) {
    const lines = read('CLAUDE.md').replace(/\n$/, '').split('\n').length;
    if (lines > lim.claudeMdMaxLines) report('CLAUDE.md', `${lines} lines, over the ${lim.claudeMdMaxLines}-line limit`);
  }
  for (const rel of lim.stateFiles.filter(has)) {
    const kb = statSync(join(root, rel)).size / 1024;
    if (kb > lim.stateFileMaxKB) report(rel, `${kb.toFixed(1)} KB, over the ${lim.stateFileMaxKB} KB limit: move closed rows to docs/archive/`);
  }
}

// ---------- stages: the Check of each skill ----------

const DATE = /\b\d{4}-\d{2}-\d{2}\b/;
const LINK = /https?:\/\/[^\s)]+/;
// "- Name: value" (ADRs, spikes) or "Name: value" (epics): the first one in the text.
const field = (text, name, dash = true) => new RegExp(`^${dash ? '- ' : ''}${name}: *(.*)$`, 'm').exec(unfenced(text))?.[1].trim() ?? '';
const same = (a, b) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase();
// IDs written outside code spans: an ID in a code span is an example.
const plainIds = (cell, re) => [...stripCode(cell ?? '').matchAll(re)].map((m) => m[0]);
function projectLevel() {
  try {
    return JSON.parse(read('.claude/pitwall.json')).processLevel;
  } catch {
    return undefined;
  }
}

function checkKickoff() {
  for (const f of listFiles(root)) if (f.endsWith('.tmpl')) report(f, 'still carries the .tmpl suffix');
  for (const { dest } of listFiles(templateRoot).map((rel) => ({ dest: projectPath(rel) }))) {
    if (has(dest) && /\{\{[A-Z_]+\}\}/.test(read(dest))) report(dest, 'still holds a {{PLACEHOLDER}}');
  }
  const file = '.claude/pitwall.json';
  if (!has(file)) report(file, 'missing');
  else {
    let s;
    try {
      s = JSON.parse(read(file));
    } catch (err) {
      report(file, `does not parse: ${err.message}`);
    }
    if (s !== undefined && (s === null || typeof s !== 'object' || Array.isArray(s))) {
      report(file, 'is not a JSON object');
      s = undefined;
    }
    if (s) {
      if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(s.templateVersion ?? ''))) report(file, `templateVersion "${s.templateVersion}" is not a version`);
      if (!Object.keys(cfg.processLevels).includes(s.processLevel)) report(file, `processLevel "${s.processLevel}" is not one of ${Object.keys(cfg.processLevels).join(', ')}`);
      if (!cfg.mergeProtection.modes.includes(s.mergeProtection)) report(file, `mergeProtection "${s.mergeProtection}" is not one of ${cfg.mergeProtection.modes.join(', ')}`);
    }
  }
  requireFilled('docs/IDEA.md', 'docs/IDEA.md', ['Problem', 'Who it is for', 'Out of scope', 'Process level']);
}

function checkDiscovery() {
  const d = cfg.discovery;
  const rel = 'docs/DISCOVERY.md';
  const s = requireFilled(rel, rel, ['Problem and user', 'Scenarios', 'Non-goals', 'Analogues', 'Owner constraints', 'Assumptions by risk']);
  if (!s) return;
  const scenarios = listItems(s.get('Scenarios') ?? []).length;
  if (scenarios < d.scenarios.min || scenarios > d.scenarios.max) report(rel, `${scenarios} scenarios, expected ${d.scenarios.min} to ${d.scenarios.max} list items`);
  if (listItems(s.get('Non-goals') ?? []).length === 0) report(rel, 'no non-goals as list items');

  const analogues = tableRows(s.get('Analogues') ?? []);
  if (analogues.length < d.analogues.min || analogues.length > d.analogues.max) report(rel, `${analogues.length} analogues, expected ${d.analogues.min} to ${d.analogues.max}`);
  const seenAnalogues = new Set();
  for (const row of analogues) {
    const link = LINK.exec(row[row.length - 1] ?? '')?.[0];
    if (!link) report(rel, `analogue "${row[0]}" has no link in its last column`);
    for (const key of [row[0].toLowerCase(), link]) {
      if (key && seenAnalogues.has(key)) report(rel, `analogue "${row[0]}" is listed twice (${key})`);
      if (key) seenAnalogues.add(key);
    }
  }

  const constraints = tableRows(s.get('Owner constraints') ?? []);
  for (const want of d.constraints) {
    const row = constraints.find((r) => r[0].toLowerCase() === want.toLowerCase());
    if (!row) report(rel, `constraint "${want}" is missing`);
    else if (!row[1]) report(rel, `constraint "${want}" has no answer`);
    else if (!DATE.test(row[2] ?? '')) report(rel, `constraint "${want}" has no confirmation date`);
  }

  const assumptions = tableRows(s.get('Assumptions by risk') ?? []);
  if (assumptions.length === 0) report(rel, 'no assumptions');
  const seen = new Set();
  let last = 0;
  assumptions.forEach(([id], i) => {
    if (/^A-\d+$/.test(id ?? '') && id !== `A-${i + 1}`) report(rel, `assumption ${id} is row ${i + 1}: number them A-1, A-2, ... in their order`);
  });
  for (const [id, text, risk, how] of assumptions) {
    if (!/^A-\d+$/.test(id ?? '')) report(rel, `assumption "${text}" has ID "${id}", expected A-n`);
    else if (seen.has(id)) report(rel, `assumption ID ${id} is used twice`);
    seen.add(id);
    const rank = d.riskOrder.indexOf((risk ?? '').toLowerCase());
    if (rank < 0) report(rel, `${id}: risk "${risk}" is not one of ${d.riskOrder.join(', ')}`);
    else if (rank < last) report(rel, `${id}: assumptions are not sorted by risk, highest first`);
    else last = rank;
    if (!how) report(rel, `${id}: no way to check it`);
  }
}

function checkDecide() {
  const d = cfg.decide;
  const rel = 'docs/STACK.md';
  const s = requireFilled(rel, rel, ['Decisions', 'Models, prices and limits', 'Two-way decisions']);
  requireFilled('CLAUDE.md', 'CLAUDE.md.tmpl', ['Architecture boundaries']);
  if (!s) return;
  const decisions = tableRows(s.get('Decisions') ?? []);
  const twoWay = tableRows(s.get('Two-way decisions') ?? []);
  const adrId = (cell) => /ADR-\d{4}/.exec(cell ?? '')?.[0];
  const adrFields = (id) => {
    const f = adrFiles.find((name) => name.startsWith(id.slice(4) + '-'));
    if (!f) return null;
    const text = read(`docs/adr/${f}`);
    const field = (name) => new RegExp(`^- ${name}: *(.+)$`, 'm').exec(text)?.[1].trim() ?? '';
    return { status: field('Status'), cls: field('Class'), by: field('Decided by') };
  };
  // The process level decides whether a one-way area may end as a two-way line the owner accepted in the list.
  const level = projectLevel();
  const rule = cfg.processLevels[level]?.decisions ?? {};
  const restMayBeTwoWay = rule.restMayBeTwoWay === true;
  const byOwner = (by) => /^owner\b/.test(by);
  const notNeeded = (r) => (r[1] ?? '').toLowerCase().startsWith(d.notNeeded.toLowerCase());
  for (const area of d.areas) {
    const withAdr = decisions.find((r) => same(r[0], area) && adrId(r[4]));
    const line = twoWay.find((r) => same(r[0], area));
    const anywhere = withAdr || decisions.find((r) => same(r[0], area)) || line;
    if (!anywhere) {
      report(rel, `area "${area}" is in neither table`);
      continue;
    }
    if (withAdr && line && notNeeded(line)) report(rel, `area "${area}" has an ADR and a "${d.notNeeded}" line`);
    if (!withAdr && !line) report(rel, `area "${area}" has neither an ADR nor a line with its reason in the Two-way table`);
    if (!d.oneWay.includes(area)) continue;
    if (withAdr) {
      const id = adrId(withAdr[4]);
      const f = adrFields(id);
      if (f && !(f.cls === 'one-way' && byOwner(f.by) && f.status.startsWith('accepted'))) {
        report(rel, `one-way area "${area}" cites ${id}, which is not an accepted one-way decision by the owner (Status: ${f.status || '-'}, Class: ${f.cls || '-'}, Decided by: ${f.by || '-'})`);
      }
    } else if (!(line && (notNeeded(line) || restMayBeTwoWay))) {
      report(rel, `one-way area "${area}" has no ADR (or a two-way line "${d.notNeeded}" with the reason${restMayBeTwoWay ? '' : `; at the ${level ?? 'unknown'} level every other one-way area needs an ADR`})`);
    }
  }
  // Where the rest may be two-way, the owner still answers at least askOwner.min one-way questions.
  const applicable = d.oneWay.filter((a) => !twoWay.some((r) => same(r[0], a) && notNeeded(r)));
  // Counted are the distinct ADRs that STACK.md cites for one-way areas and that hold an accepted owner decision.
  const accepted = new Set(
    decisions
      .filter((r) => d.oneWay.some((a) => same(r[0], a)))
      .map((r) => adrId(r[4]))
      .filter((id) => {
        const x = id && adrFields(id);
        return x && x.cls === 'one-way' && byOwner(x.by) && x.status.startsWith('accepted');
      }),
  ).size;
  const least = typeof rule.askOwner?.min === 'number' ? Math.min(rule.askOwner.min, applicable.length) : 0;
  if (accepted < least) report(rel, `one-way areas cite ${accepted} accepted one-way decisions by the owner; the ${level} level asks for at least ${least}`);
  // Every ADR a row cites must exist, in every row, whatever its area.
  for (const r of decisions) {
    const id = adrId(r[4]);
    if (id && !adrFields(id)) report(rel, `"${r[0]}" cites ${id}, which has no file in docs/adr/`);
  }
  const numbers = adrFiles.map((f) => f.slice(0, 4));
  for (const n of new Set(numbers.filter((x, i) => numbers.indexOf(x) !== i))) report('docs/adr', `two ADR files share the number ${n}`);
  for (const [area, choice, version, source, adr] of decisions) {
    if (!version) report(rel, `"${area}: ${choice ?? ''}" has no version (use - when there is none)`);
    else if (version !== '-' && !(LINK.test(source ?? '') && DATE.test(source ?? ''))) report(rel, `"${area}: ${choice}" ${version} has no registry link with a date`);
    if (!(adrId(adr) || adr === '-')) report(rel, `"${area}: ${choice ?? ''}" has ADR "${adr ?? ''}", expected ADR-NNNN or -`);
  }
  for (const [area, choice, why] of twoWay) if (!why) report(rel, `two-way "${area}: ${choice ?? ''}" has no reason`);

  for (const f of adrFiles) {
    const adr = `docs/adr/${f}`;
    const text = read(adr);
    const field = (name) => new RegExp(`^- ${name}: *(.+)$`, 'm').exec(text)?.[1].trim() ?? '';
    if (!/^(proposed|accepted|superseded)/.test(field('Status'))) report(adr, 'no "- Status:" line');
    if (!DATE.test(field('Date'))) report(adr, 'no "- Date:" line');
    const cls = field('Class');
    if (!['one-way', 'two-way'].includes(cls)) report(adr, '"- Class:" is not one-way or two-way');
    const by = field('Decided by');
    if (!by) report(adr, 'no "- Decided by:" line');
    const body = requireFilled(adr, 'docs/adr/0000-template.md', ['Context', 'Options', 'Decision', 'Consequences']);
    if (cls === 'one-way') {
      if (!/^owner\b/.test(by)) report(adr, 'a one-way decision must be decided by the owner');
      const rows = tableRows(body?.get('Options') ?? []);
      if (rows.length < d.options.min || rows.length > d.options.max) report(adr, `${rows.length} options compared, expected ${d.options.min} to ${d.options.max}`);
      for (const row of rows) {
        if (row.some((c) => !c)) report(adr, `option "${row[0]}" has an empty cell (write unknown when it is not known)`);
        if (!LINK.test(row[row.length - 1] ?? '')) report(adr, `option "${row[0]}" has no source link in its last column`);
      }
    }
  }
}

// ---------- spike (T2-AC1, ADR-0009) ----------

const SPIKE_TEMPLATE = 'docs/spikes/template.md';
const SPIKE_STRUCTURE = { tables: ['Criterion', 'Result'], fields: ['Assumption', 'Branch', 'Date', 'Outcome', 'Prototype', 'Follow-up'] };

// The non-empty lines of a section, trimmed, so whitespace alone is no change.
const sectionText = (text, name) => (sections(text).get(name) ?? []).map((l) => l.trim()).filter(Boolean).join('\n');

// The commit that first added a file, and its path there: the oldest add of the path, and when
// that commit renamed it from another path, the oldest add of that one before it, and so on.
function spikeOrigin(git, rel) {
  let path = rel;
  let from = 'HEAD';
  for (let hop = 0; hop < 50; hop += 1) {
    const added = git('log', '--no-renames', '--diff-filter=A', '--format=%H', from, '--', path).out.split('\n').filter(Boolean);
    if (added.length === 0) return null;
    const sha = added[added.length - 1];
    const changes = git('-c', 'core.quotePath=false', 'show', '-M', '--name-status', '--format=', sha).out.split('\n').map((l) => l.split('\t'));
    const renamed = changes.find((c) => c[0].startsWith('R') && c[2] === path);
    if (!renamed) return { sha, path };
    path = renamed[1];
    from = `${sha}^`;
  }
  return null;
}

function checkSpike() {
  const d = cfg.spike;
  if (spikeFiles.length === 0) return report('docs/spikes', 'no spike: a spike is docs/spikes/<topic>.md, copied from docs/spikes/template.md');
  const git = gitRunner(root);
  // Without the whole history nothing below can be shown, so the check fails, never passes (ADR-0009).
  let history = git('rev-parse', '--is-inside-work-tree').out === 'true';
  if (!history) report('docs/spikes', 'not inside a git repository: the spike check reads git history (pitwall ADR-0009)');
  else if (git('rev-parse', '--is-shallow-repository').out !== 'false') {
    report('docs/spikes', 'the clone is shallow: run git fetch --unshallow, the spike check reads the whole history (pitwall ADR-0009)');
    history = false;
  }
  const hasRef = (ref) => git('rev-parse', '--verify', '-q', `${ref}^{commit}`).ok;
  const ancestor = (a, b) => git('merge-base', '--is-ancestor', a, b).ok;
  const remote = history && git('remote').out.split('\n').includes('origin');
  for (const f of spikeFiles) {
    const rel = `docs/spikes/${f}`;
    const topic = f.slice(0, -3);
    checkStructure(rel, SPIKE_STRUCTURE);
    const s = requireFilled(rel, SPIKE_TEMPLATE, ['Hypothesis', 'Criterion', 'Result', 'Conclusion']);
    if (!s) continue;
    const text = read(rel);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(topic)) report(rel, `the topic "${topic}" is not lower-case words joined by hyphens`);
    if (plainIds(field(text, 'Assumption'), /\bA-\d+\b/g).length === 0) report(rel, 'names no assumption A-n in "- Assumption:"');
    const branch = d.branch.replace('<topic>', topic);
    if (field(text, 'Branch') !== branch) report(rel, `"- Branch:" is "${field(text, 'Branch')}", expected ${branch}`);
    if (!DATE.test(field(text, 'Date'))) report(rel, 'no "- Date:" line');
    const outcome = field(text, 'Outcome');
    if (!d.outcomes.includes(outcome)) report(rel, `"- Outcome:" is "${outcome}": a finished spike is ${d.outcomes.join(' or ')}`);
    const criterion = tableRows(s.get('Criterion') ?? []);
    if (criterion.length === 0) report(rel, 'the criterion has no row');
    for (const row of criterion) if (!/\d/.test(row[row.length - 1] ?? '')) report(rel, `criterion "${row[0]}": "Success when" holds no number`);
    const result = tableRows(s.get('Result') ?? []);
    if (result.length === 0) report(rel, 'the result has no measurement');
    for (const [metric, measured, by, date] of result) {
      if (!/\d/.test(measured ?? '')) report(rel, `result "${metric}": "Measured" holds no number`);
      if (!/^(?:command:\s*\S|owner\b)/i.test(by ?? '')) report(rel, `result "${metric}": "Measured by" is "${by ?? ''}": write "command: <the command>" or "owner"`);
      if (!DATE.test(date ?? '')) report(rel, `result "${metric}": no date`);
    }
    if (sectionText(text, 'Conclusion') === 'Pending.') report(rel, 'the conclusion still reads "Pending."');
    const follow = field(text, 'Follow-up');
    if (outcome === 'not confirmed' && !(/\bADR-\d{4}\b|\bR-\d+\b/.test(stripCode(follow)) || follow.startsWith(d.pending))) {
      report(rel, 'not confirmed, and "- Follow-up:" names no ADR, no accepted risk R-n and no "pending, /pitwall:decide <area>"');
    }
    const proto = /\b[0-9a-f]{7,40}\b/.exec(field(text, 'Prototype'))?.[0];
    if (!proto) report(rel, '"- Prototype:" names no commit');
    if (!history) continue;

    // The criterion came first: the commit that first added the file, under whatever name it had
    // then, holds the same criterion and no result. Renames are followed; a copy of another
    // spike is not (git log --follow would walk into the other spike's history).
    const origin = spikeOrigin(git, rel);
    if (!origin) {
      // git log shows no adding commit for a file that only a merge brought in, and such a merge cannot show the criterion came first.
      const inHistory = git('log', '--format=%H', '-1', 'HEAD', '--', rel).out !== '';
      report(rel, inHistory ? 'no commit but a merge adds it, so nothing shows the criterion came first: commit the criterion on the planning branch before any prototype code' : 'is not committed: commit the criterion on the planning branch before any prototype code');
      continue;
    }
    const first = origin.sha;
    const shown = git('show', `${first}:${origin.path}`);
    if (!shown.ok) {
      report(rel, `cannot read ${origin.path} at ${first.slice(0, 7)}: ${shown.err}`);
      continue;
    }
    const before = shown.raw.replace(/\r\n/g, '\n');
    if (sectionText(before, 'Criterion') !== sectionText(text, 'Criterion')) report(rel, `the criterion changed after ${first.slice(0, 7)}, the commit that added it: a criterion is never adjusted to the result`);
    const conclusionBefore = sections(before).get('Conclusion') ?? [];
    const concludedBefore = filled(conclusionBefore, sections(readTemplate(SPIKE_TEMPLATE)).get('Conclusion')) && !/^pending\b/i.test(sectionText(before, 'Conclusion'));
    // A result written as prose under "## Result" counts too, not only rows in its table.
    const resultBefore = filled(sections(before).get('Result') ?? [], sections(readTemplate(SPIKE_TEMPLATE)).get('Result'));
    if (resultBefore || d.outcomes.includes(field(before, 'Outcome')) || /\b[0-9a-f]{7,40}\b/.test(field(before, 'Prototype')) || concludedBefore) {
      report(rel, `${first.slice(0, 7)}, the commit that added it, already held a result: the criterion is committed before the prototype`);
    }
    if (!proto) continue;
    if (!hasRef(proto)) {
      report(rel, `the prototype commit ${proto} is not in this clone: fetch ${branch}`);
      continue;
    }
    const full = git('rev-parse', `${proto}^{commit}`).out;
    if (full === first || !ancestor(first, full)) report(rel, `the prototype commit ${proto} does not come after ${first.slice(0, 7)}, the criterion commit: start ${branch} from it`);
    // Spike code never reaches the planning branch or main.
    for (const ref of ['HEAD', cfg.planning.branch, cfg.mergeProtection.branch]) {
      if (hasRef(ref) && ancestor(full, ref)) report(rel, `the prototype commit ${proto} is reachable from ${ref}: spike code stays on ${branch}`);
    }
    // Pushed before this check when there is a remote (ADR-0009); on the local branch otherwise.
    const home = remote ? `refs/remotes/origin/${branch}` : `refs/heads/${branch}`;
    if (!hasRef(home) || !ancestor(full, home)) {
      report(rel, remote ? `push ${branch} before this check: origin/${branch} does not hold ${proto} (pitwall ADR-0009)` : `${branch} does not hold the prototype commit ${proto}`);
    }
  }
}

// ---------- plan (T2-AC2, T2-AC3) ----------

// R-n -> whether docs/RISKS.md accepts it: a risk, a fallback and the date the owner accepted it.
// Rows outside its one table go unread, so a second table is refused where the risks are checked.
function risksAccepted() {
  const rows = has('docs/RISKS.md') ? tableRows(read('docs/RISKS.md').split('\n')) : [];
  return new Map(rows.map(([id, risk, fallback, on]) => [id, Boolean(risk && fallback && DATE.test(on ?? ''))]));
}
// The ADR that a failed spike led to cites the spike: /pitwall:decide <area> links it in the new
// ADR, so neither the ADR the spike disproved nor an unrelated one can stand in for it.
const adrCites = (id, spikeFile) => {
  const f = adrFiles.find((name) => name.startsWith(id.slice(4) + '-'));
  return Boolean(f && read(`docs/adr/${f}`).includes(`spikes/${spikeFile}`));
};
function adrAccepted(id) {
  const f = adrFiles.find((name) => name.startsWith(id.slice(4) + '-'));
  return Boolean(f && field(read(`docs/adr/${f}`), 'Status').startsWith('accepted'));
}

// The relative Markdown links of a file that point nowhere.
function brokenLinks(rel) {
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  const out = [];
  // [text](target), [text](<target with spaces>) and [text](target "title").
  for (const m of stripCode(read(rel)).matchAll(/\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g)) {
    const raw = m[1].replace(/^<|>$/g, '');
    const target = raw.split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    let path = target;
    try {
      path = decodeURI(target);
    } catch {}
    if (!existsSync(resolve(root, dir, path))) out.push(raw);
  }
  return out;
}

// The epics as docs/EPICS.md lists them, or null when the table is missing or has other columns.
function readPlan(quiet = false) {
  const rel = 'docs/EPICS.md';
  if (!has(rel)) {
    if (!quiet) report(rel, 'missing');
    return null;
  }
  const lines = read(rel).split('\n');
  const want = tableHeader(readTemplate(rel).split('\n'));
  const got = tableHeader(lines);
  if (!got || !same(got.join('|'), want.join('|'))) {
    if (!quiet) report(rel, `the table must keep the template's columns: | ${want.join(' | ')} |`);
    return null;
  }
  return tableRows(lines).map((row) => {
    const m = /^\[?(E\d+)\]?(?:\(([^)\s]+)\))?$/.exec((row[0] ?? '').replace(/`/g, ''));
    return { row, id: m?.[1], link: m?.[2], goal: row[1], risk: row[2], deps: plainIds(row[3], /\bE\d+\b/g), status: row[4] };
  });
}

// The process level sets the numbers both checks hold a plan to, so a level that is not known fails, never relaxes them.
function knownLevel() {
  const name = projectLevel();
  if (!Object.hasOwn(cfg.processLevels, name ?? '')) report('.claude/pitwall.json', `processLevel "${name ?? ''}" is not one of ${Object.keys(cfg.processLevels).join(', ')}: the plan checks need the level`);
  return name;
}

function checkPlan() {
  const p = cfg.plan;
  const rel = 'docs/EPICS.md';
  const levelName = knownLevel();
  const epics = readPlan();
  if (!epics) return;
  if (epics.length === 0) return report(rel, 'no epics in the table');
  const risks = Object.keys(cfg.riskClasses).filter((k) => typeof cfg.riskClasses[k] === 'object');
  const index = new Map();
  epics.forEach((e, i) => {
    if (e.row.length !== 5) report(rel, `the row "${e.row[0]}" has ${e.row.length} cells, the table has 5 columns`);
    if (!e.id) return report(rel, `the row "${e.row[0]}" has no epic ID E<n>`);
    if (index.has(e.id)) report(rel, `${e.id} is listed twice`);
    else index.set(e.id, i);
  });
  if (epics[0].id !== p.firstEpic) report(rel, `the first epic is ${epics[0].id ?? epics[0].row[0]}: the plan starts with ${p.firstEpic}, the walking skeleton`);
  const numbers = epics.map((e) => Number(e.id?.slice(1)));
  for (let i = 1; i < numbers.length; i += 1) if (!(numbers[i] > numbers[i - 1])) report(rel, `${epics[i].id ?? epics[i].row[0]} comes after ${epics[i - 1].id ?? epics[i - 1].row[0]}: number the epics in their order`);
  const listed = new Set();
  for (const e of epics.filter((x) => x.id)) {
    if (!e.goal) report(rel, `${e.id} has no goal`);
    if (!risks.includes(e.risk)) report(rel, `${e.id}: risk "${e.risk ?? ''}" is not one of ${risks.join(', ')}`);
    if (e.status !== p.status) report(rel, `${e.id}: status "${e.status ?? ''}", every epic of a new plan is ${p.status}`);
    for (const dep of e.deps) {
      if (!index.has(dep)) report(rel, `${e.id} depends on ${dep}, which is not in the plan`);
      else if (index.get(dep) >= index.get(e.id)) report(rel, `${e.id} depends on ${dep}, which does not come before it`);
    }
    if (!e.link || !new RegExp(`^epics/${e.id}-[a-z0-9]+(?:-[a-z0-9]+)*\\.md$`).test(e.link)) {
      report(rel, `${e.id} must link its file as [${e.id}](epics/${e.id}-<slug>.md)`);
      continue;
    }
    const file = `docs/${e.link}`;
    listed.add(e.link.slice('epics/'.length));
    if (!has(file)) {
      report(rel, `${e.id} links ${e.link}, which does not exist`);
      continue;
    }
    const text = read(file);
    if (!new RegExp(`^# ${e.id} - \\S`, 'm').test(text)) report(file, `the title is not "# ${e.id} - <title>"`);
    if (!field(text, 'Goal', false)) report(file, 'no "Goal:" line');
    const cls = field(text, 'Risk class', false).split(/[\s(]/)[0];
    if (!cls) report(file, `no risk class: a "Risk class:" line with one of ${risks.join(', ')}`);
    else if (!risks.includes(cls)) report(file, `risk class "${cls}" is not one of ${risks.join(', ')}`);
    else if (cls !== e.risk) report(file, `risk class ${cls}, but docs/EPICS.md says ${e.risk}`);
    const deps = plainIds(field(text, 'Depends on', false), /\bE\d+\b/g);
    if ([...new Set(deps)].sort().join(',') !== [...new Set(e.deps)].sort().join(',')) {
      report(file, `depends on ${deps.join(', ') || 'no epic'}, but docs/EPICS.md says ${e.deps.join(', ') || 'no epic'}`);
    }
    const adrLine = field(text, 'ADR', false);
    const cited = plainIds(adrLine, /\bADR-\d{4}\b/g);
    if (cited.length === 0 && !same(adrLine, 'none')) report(file, `the "ADR:" line is "${adrLine}": list the ADR IDs, or none`);
    for (const id of cited) if (!adrFiles.some((name) => name.startsWith(id.slice(4) + '-'))) report(file, `cites ${id}, which has no file in docs/adr/`);
    if (e.id === p.firstEpic && cited.length === 0 && adrFiles.length > 0) report(file, `${p.firstEpic} lays down the stack: its "ADR:" line cites the stack ADRs`);
    const items = listItems(sections(text).get('Acceptance criteria') ?? []);
    if (items.length === 0) report(file, 'no acceptance criteria');
    items.forEach((l, i) => {
      const m = /^- \[[ xX]\] (E\d+)-AC(\d+):\s*\S/.exec(l);
      if (!m) report(file, `"${l.slice(0, 60)}" is not a criterion "- [ ] ${e.id}-AC${i + 1}: ..."`);
      else if (m[1] !== e.id || Number(m[2]) !== i + 1) report(file, `${m[1]}-AC${m[2]} is criterion ${i + 1}: number them ${e.id}-AC1, ${e.id}-AC2, ... in their order`);
    });
    for (const link of brokenLinks(file)) report(file, `broken link ${link}`);
  }
  // A cycle is named as a cycle, even though one of its edges is reported above as well.
  const graph = new Map(epics.filter((e) => e.id).map((e) => [e.id, e.deps.filter((x) => index.has(x))]));
  const state = new Map();
  const cycles = new Set();
  const visit = (id, path) => {
    state.set(id, 'open');
    for (const next of graph.get(id) ?? []) {
      if (state.get(next) === 'open') cycles.add([...path.slice(path.indexOf(next)), next].join(' -> '));
      else if (!state.has(next)) visit(next, [...path, next]);
    }
    state.set(id, 'done');
  };
  for (const id of graph.keys()) if (!state.has(id)) visit(id, [id]);
  for (const c of cycles) report(rel, `dependency cycle: ${c}`);
  for (const f of epicFiles) if (!listed.has(f)) report(`docs/epics/${f}`, 'is not in the table of docs/EPICS.md');
  for (const doc of [rel, 'docs/SPEC.md'].filter(has)) for (const link of brokenLinks(doc)) report(doc, `broken link ${link}`);
  const max = cfg.processLevels[levelName]?.epics?.max;
  if (typeof max === 'number' && epics.length - 1 > max) {
    report(rel, `${epics.length - 1} epics after ${p.firstEpic}: the ${levelName} level holds at most ${max}; cut the plan, or raise the level with an ADR`);
  }
  requireFilled('docs/SPEC.md', 'docs/SPEC.md', [...sections(readTemplate('docs/SPEC.md')).keys()]);
  // The files whose rows and fields this check reads keep to Markdown it reads as GitHub shows it.
  checkStructure(rel, { tables: null });
  checkStructure('docs/RISKS.md', { tables: null });
  for (const f of epicFiles) checkStructure(`docs/epics/${f}`, { tables: 'any', fields: ['Goal', 'Depends on', 'Risk class', 'ADR'], dash: false });
  // Every spike is concluded, and a failed one has a follow-up that is done.
  const accepted = risksAccepted();
  const conclusionTemplate = sections(readTemplate(SPIKE_TEMPLATE)).get('Conclusion');
  for (const f of spikeFiles) {
    const sr = `docs/spikes/${f}`;
    checkStructure(sr, SPIKE_STRUCTURE);
    const text = read(sr);
    const outcome = field(text, 'Outcome');
    if (!cfg.spike.outcomes.includes(outcome)) report(sr, `the spike is not concluded (Outcome "${outcome}"): finish it with /pitwall:spike`);
    else if (/^pending\b/i.test(sectionText(text, 'Conclusion')) || !filled(sections(text).get('Conclusion') ?? [], conclusionTemplate)) report(sr, 'the conclusion is not written: it still reads "Pending." or the template');
    if (outcome !== 'not confirmed') continue;
    const follow = stripCode(field(text, 'Follow-up'));
    const adr = /\bADR-\d{4}\b/.exec(follow)?.[0];
    const risk = /\bR-\d+\b/.exec(follow)?.[0];
    // An ADR follow-up is the new decision /pitwall:decide <area> wrote: accepted, and citing this spike.
    if (adr ? !(adrAccepted(adr) && adrCites(adr, f)) : risk ? !accepted.get(risk) : true) {
      report(sr, `not confirmed, and its follow-up is not done: a new accepted ADR from /pitwall:decide <area> that links docs/spikes/${f}, or a risk R-n the owner accepted in docs/RISKS.md with a date`);
    }
  }
}

// ---------- plan review (T2-AC4) ----------

function checkPlanReview() {
  checkPlan();
  const r = cfg.planReview;
  const levelName = projectLevel();
  const level = cfg.processLevels[levelName] ?? {};
  const rel = 'docs/PLAN-REVIEW.md';
  // checkPlan has reported an unknown level; nothing below can be checked without one.
  if (!Object.hasOwn(cfg.processLevels, levelName ?? '')) return;
  const s = requireFilled(rel, rel, ['Pre-mortem', 'Non-functional requirements', 'Launch questions', 'Epic sizing', 'Findings']);
  if (!s) return;
  for (const doc of [rel, 'docs/RISKS.md'].filter(has)) for (const link of brokenLinks(doc)) report(doc, `broken link ${link}`);
  // The files whose rows decide this review keep to Markdown the check reads as GitHub shows it:
  // tables only in the template's sections, one each, and no row twice.
  const TABLED = ['Pre-mortem', 'Non-functional requirements', 'Launch questions', 'Epic sizing', 'Findings'];
  checkStructure(rel, { tables: TABLED });
  checkStructure('docs/DISCOVERY.md', { tables: ['Analogues', 'Owner constraints', 'Assumptions by risk'] });
  const accepted = risksAccepted();
  // A cell's words with emphasis and a leading "closed by" taken off.
  const bare = (cell) => stripCode(cell ?? '').trim().replace(/^[*_~\s]+/, '').replace(/^closed by\s+/i, '').replace(/^[*_~\s]+/, '');
  // Closed means the cell starts with the ID that closes it (after "closed by", if the reviewer
  // wrote that), outside a code span, and a risk that closes it is one the owner accepted. A cell
  // that starts with "open", or with other words, is open whatever IDs follow.
  const CLOSER = /^\[?(E\d+(?:-AC\d+)?|ADR-(?!0000)\d{4}|R-\d+)\b/;
  const isOpen = (cell) => new RegExp(`^[\\s*_~]*${r.open}\\b`, 'i').test(stripCode(cell ?? ''));
  const closed = (cell) => {
    const id = CLOSER.exec(bare(cell))?.[1];
    return Boolean(id) && !isOpen(cell) && (!id.startsWith('R-') || accepted.get(id) === true);
  };
  // Only the template's sections are read, so a heading of its own, such as a later round's
  // findings, would hide rows: it is refused. In those sections every cell but the item and its
  // description is a status, and a status that reads open is reported wherever it stands.
  const known = new Set(sections(readTemplate(rel)).keys());
  for (const h of new Set(headingList(read(rel)))) if (!known.has(h)) report(rel, `"## ${h}" is not a section of the template: keep every row in the template's sections`);
  const described = { 'Pre-mortem': 2, Findings: 2, 'Non-functional requirements': 1, 'Launch questions': 1, 'Epic sizing': 1 };
  for (const name of TABLED) {
    for (const row of tableRows(s.get(name) ?? [])) {
      if (row.slice(described[name]).some((c) => isOpen(c))) report(rel, `an open item in "## ${name}": | ${row.join(' | ')} |`.slice(0, 160));
    }
  }
  // An answer is more than a dash or a placeholder; a place names a document of the project or an ID.
  const blank = (cell) => !cell || isOpen(cell) || /^(?:-+|n\/a|tbd|todo|pending|\?+)\.?$/i.test(bare(cell));
  // An action is more than that, and more than saying there is none.
  const noAction = (cell) => blank(cell) || /^(?:none|no|nothing|no action)\.?$/i.test(bare(cell));
  const place = (cell) => {
    if (blank(cell)) return false;
    if (/\b(?:E\d+(?:-AC\d+)?|ADR-(?!0000)\d{4}|R-\d+)\b/.test(stripCode(cell))) return true;
    const doc = /([\w./-]+\.md)\b/.exec(cell.replace(/`/g, ''))?.[1];
    return Boolean(doc && (has(doc) || has(`docs/${doc}`)));
  };
  const forLevel = (list) => list.filter((x) => x.levels.includes(levelName)).map((x) => x.item);

  const reasons = tableRows(s.get('Pre-mortem') ?? []);
  const need = level.preMortemReasons ?? 0;
  if (reasons.length < need) report(rel, `${reasons.length} pre-mortem reasons, the ${levelName} level asks for ${need}`);
  for (const [n, reason, by] of reasons) {
    if (!reason) report(rel, `pre-mortem row ${n} has no reason`);
    if (!closed(by)) report(rel, `pre-mortem reason ${n} is not closed: start its last cell with the ID of the epic, criterion or ADR that closes it, or of a risk R-n the owner accepted`);
  }
  const answered = (section, items, third, missing) => {
    const rows = tableRows(s.get(section) ?? []);
    for (const item of items) {
      const row = rows.find((x) => same(x[0], item));
      if (!row) report(rel, `"## ${section}": "${item}" is missing`);
      else if (blank(row[1])) report(rel, `"## ${section}": "${item}" has no answer`);
      else if (!third(row[2] ?? '')) report(rel, `"## ${section}": "${item}" has ${missing}`);
    }
  };
  answered('Non-functional requirements', forLevel(r.nonFunctional), place, 'no place where it lives: a document of the project (SPEC.md, an ADR file) or an ID');
  answered('Launch questions', forLevel(r.launch), (c) => /^\d{4}-\d{2}-\d{2}\b/.test(bare(c)), 'no date the owner confirmed it at the start of its cell');

  const sizing = tableRows(s.get('Epic sizing') ?? []);
  for (const e of (readPlan(true) ?? []).filter((x) => x.id)) {
    const row = sizing.find((x) => plainIds((x[0] ?? '').replace(/`/g, ''), /\bE\d+\b/g)[0] === e.id);
    if (!row) {
      report(rel, `${e.id} is not sized`);
      continue;
    }
    const [, size, unc, action] = row;
    const u = (unc ?? '').toLowerCase();
    if (!r.sizes.includes(size)) report(rel, `${e.id}: size "${size ?? ''}" is not one of ${r.sizes.join(', ')}`);
    if (!r.uncertainty.includes(u)) report(rel, `${e.id}: uncertainty "${unc ?? ''}" is not one of ${r.uncertainty.join(', ')}`);
    if ((r.needsAction.sizes.includes(size) || r.needsAction.uncertainty.includes(u)) && noAction(action)) {
      report(rel, `${e.id} is ${size}, ${u}: it needs an action (split it, clarify it, or a spike first)`);
    }
  }
  for (const [n, finding, severity, by] of tableRows(s.get('Findings') ?? [])) {
    if (!finding) report(rel, `finding ${n} says nothing`);
    if (!r.severities.includes((severity ?? '').toLowerCase())) report(rel, `finding ${n}: severity "${severity ?? ''}" is not one of ${r.severities.join(', ')}`);
    if (!closed(by)) report(rel, `finding ${n} is not closed: start its last cell with the ID of the epic, criterion or ADR that closes it, or of a risk R-n the owner accepted`);
  }
  // An accepted risk is a row in the one table of docs/RISKS.md with its fallback and the date the owner accepted it.
  for (const id of new Set(plainIds(read(rel), /\bR-\d+\b/g))) if (!accepted.get(id)) report('docs/RISKS.md', `${id} is not an accepted risk: a row in its table with the risk, a fallback and the date in "Accepted on"`);

  // Every high-risk assumption is covered by a spike, an ADR, an epic or an accepted risk.
  if (!has('docs/DISCOVERY.md')) return report('docs/DISCOVERY.md', 'missing');
  const assumptions = tableRows(sections(read('docs/DISCOVERY.md')).get('Assumptions by risk') ?? []);
  const top = cfg.discovery.riskOrder[0];
  // Only accepted ADRs count: a superseded or proposed one decides nothing any more.
  const covering = [
    ...spikeFiles.map((f) => `docs/spikes/${f}`),
    ...adrFiles.filter((f) => field(read(`docs/adr/${f}`), 'Status').startsWith('accepted')).map((f) => `docs/adr/${f}`),
    ...epicFiles.map((f) => `docs/epics/${f}`),
  ].map((f) => stripCode(read(f)));
  // From docs/RISKS.md only the risks the owner accepted count.
  const risks = has('docs/RISKS.md') ? tableRows(read('docs/RISKS.md').split('\n')) : [];
  for (const row of risks) if (accepted.get(row[0])) covering.push(stripCode(row.join(' | ')));
  for (const [id, , risk] of assumptions) {
    if (!same(risk, top) || !/^A-\d+$/.test(id ?? '')) continue;
    if (!covering.some((text) => new RegExp(`\\b${id}\\b`).test(text))) report(rel, `high-risk assumption ${id} is covered by no spike, ADR, epic or accepted risk`);
  }
  if (level.spikeRequired && assumptions[0]) {
    const riskiest = assumptions[0][0];
    const tested = spikeFiles.some((f) => {
      const text = read(`docs/spikes/${f}`);
      return plainIds(field(text, 'Assumption'), /\bA-\d+\b/g).includes(riskiest) && cfg.spike.outcomes.includes(field(text, 'Outcome'));
    });
    if (!tested) report(rel, `the ${levelName} level asks for a concluded spike on the riskiest assumption, ${riskiest}`);
  }
}

const checks = { kickoff: checkKickoff, discovery: checkDiscovery, decide: checkDecide, spike: checkSpike, plan: checkPlan, 'plan-review': checkPlanReview };
for (const s of stages) checks[s]();

const what = `${kinds.join(',')}${stages.length ? `, stage ${stages.join(',')}` : ''}`;
if (problems.length === 0) {
  console.log(`PASS docs-check (${what}) in ${root}`);
} else {
  console.log(`FAIL docs-check (${what}) in ${root}`);
  for (const p of new Set(problems)) console.log(`  - ${p}`);
  process.exit(1);
}
