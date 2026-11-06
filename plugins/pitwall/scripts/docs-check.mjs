#!/usr/bin/env node
// The docs check of a pitwall project (T1-AC5, ADR-0003, ADR-0006).
//
//   node docs-check.mjs [--root <dir>] [--stage kickoff|discovery|decide] [--only sections,ids,size]
//
// Always, unless --only narrows it:
//   sections  every "## " heading of a template document is in the project's copy,
//             ADRs follow docs/adr/0000-template.md and epics docs/epics/E0-skeleton.md;
//   ids       every ID in docs/ and CLAUDE.md points at something that exists:
//             ADR-NNNN, the epic IDs of docs/EPICS.md and their -ACn, BUG-n, L-n,
//             A-n (assumptions) and R-n (risks); an ID in a code span is an example;
//   size      CLAUDE.md and the state files stay within docsLimits in config/defaults.json.
// --stage adds the Check of that skill: what the stage writes is there and filled in.
//
// Exit 0 pass, 1 problems found (each printed), 2 usage.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config, listFiles, parseArgs, projectPath, requireNode, templateRoot } from './lib.mjs';

requireNode();
const usage = 'node docs-check.mjs [--root <dir>] [--stage kickoff|discovery|decide] [--only sections,ids,size]';
const args = parseArgs(process.argv.slice(2), { root: 'value', stage: 'value', only: 'value' }, usage);
const KINDS = ['sections', 'ids', 'size'];
const STAGES = ['kickoff', 'discovery', 'decide'];
const kinds = args.only ? args.only.split(',').map((k) => k.trim()) : KINDS;
if (kinds.some((k) => !KINDS.includes(k)) || (args.stage && !STAGES.includes(args.stage))) {
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
const read = (rel) => readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const readTemplate = (rel) => readFileSync(join(templateRoot, rel), 'utf8').replace(/\r\n/g, '\n');
const isFence = (line) => /^\s*(```|~~~)/.test(line);

// Fenced blocks become empty lines and code spans become spaces, so line numbers hold.
function stripCode(text) {
  let fence = false;
  return text
    .split('\n')
    .map((line) => {
      if (isFence(line)) {
        fence = !fence;
        return '';
      }
      return fence ? '' : line.replace(/(`+).*?\1/g, (m) => ' '.repeat(m.length));
    })
    .join('\n');
}

// "## heading" -> its body lines, up to the next heading of level 1 or 2.
function sections(text) {
  const map = new Map();
  let current = null;
  let fence = false;
  for (const line of text.split('\n')) {
    if (isFence(line)) fence = !fence;
    const h = !fence && /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      current = h[1];
      map.set(current, []);
    } else if (!fence && /^#\s/.test(line)) {
      current = null;
    } else if (current) {
      map.get(current).push(line);
    }
  }
  return map;
}

const isSeparator = (cells) => cells.every((c) => /^:?-{3,}:?$/.test(c));
const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());

// Data rows of the first table in some lines: header and separator dropped.
function tableRows(lines) {
  const rows = [];
  let seen = 0;
  for (const line of lines) {
    if (!line.trim().startsWith('|')) {
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

// The header cells of the first table in some lines, or null.
const tableHeader = (lines) => {
  const line = lines.find((l) => l.trim().startsWith('|'));
  return line ? splitRow(line) : null;
};

// Checks that the named sections of a project file are present and filled in, and
// that a table the template's section holds keeps the template's columns in every row.
function requireFilled(rel, templateRel, names) {
  if (!has(rel)) return report(rel, 'missing');
  const mine = sections(read(rel));
  const tpl = sections(readTemplate(templateRel));
  for (const name of names) {
    if (!mine.has(name)) {
      report(rel, `missing section "## ${name}"`);
      continue;
    }
    if (!filled(mine.get(name), tpl.get(name))) report(rel, `section "## ${name}" is not filled in`);
    const want = tableHeader(tpl.get(name) ?? []);
    if (!want) continue;
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
  if (!has(rel)) return report(rel, 'missing (a contract path, ADR-0006)');
  const mine = sections(read(rel));
  for (const h of need) if (!mine.has(h)) report(rel, `missing section "## ${h}" (template ${templateRel})`);
}

const filesIn = (rel) => (has(rel) && statSync(join(root, rel)).isDirectory() ? readdirSync(join(root, rel)) : []);
const adrFiles = filesIn('docs/adr').filter((f) => /^\d{4}-.+\.md$/.test(f) && !f.startsWith('0000-'));
const epicFiles = filesIn('docs/epics').filter((f) => f.endsWith('.md'));

if (kinds.includes('sections')) {
  for (const { rel, dest } of templateDocs) requireHeadings(dest, rel);
  for (const f of adrFiles) requireHeadings(`docs/adr/${f}`, 'docs/adr/0000-template.md');
  for (const f of epicFiles.filter((f) => f !== 'E0-skeleton.md')) requireHeadings(`docs/epics/${f}`, 'docs/epics/E0-skeleton.md');
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
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  const adrId = (cell) => /ADR-\d{4}/.exec(cell ?? '')?.[0];
  const adrFields = (id) => {
    const f = adrFiles.find((name) => name.startsWith(id.slice(4) + '-'));
    if (!f) return null;
    const text = read(`docs/adr/${f}`);
    const field = (name) => new RegExp(`^- ${name}: *(.+)$`, 'm').exec(text)?.[1].trim() ?? '';
    return { status: field('Status'), cls: field('Class'), by: field('Decided by') };
  };
  // The process level decides whether a one-way area may end as a two-way line the owner accepted in the list.
  let level;
  try {
    level = JSON.parse(read('.claude/pitwall.json')).processLevel;
  } catch {
    level = undefined;
  }
  const restMayBeTwoWay = cfg.processLevels[level]?.decisions?.restMayBeTwoWay === true;
  const byOwner = (by) => /^owner\b/.test(by);
  const notNeeded = (r) => r[1].toLowerCase().startsWith(d.notNeeded.toLowerCase());
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
      if (!f) report(rel, `one-way area "${area}" cites ${id}, which has no file in docs/adr/`);
      else if (!(f.cls === 'one-way' && byOwner(f.by) && f.status.startsWith('accepted'))) {
        report(rel, `one-way area "${area}" cites ${id}, which is not an accepted one-way decision by the owner (Status: ${f.status || '-'}, Class: ${f.cls || '-'}, Decided by: ${f.by || '-'})`);
      }
    } else if (!(line && (notNeeded(line) || restMayBeTwoWay))) {
      report(rel, `one-way area "${area}" has no ADR (or a two-way line "${d.notNeeded}" with the reason${restMayBeTwoWay ? '' : `; at the ${level ?? 'unknown'} level every other one-way area needs an ADR`})`);
    }
  }
  const numbers = adrFiles.map((f) => f.slice(0, 4));
  for (const n of new Set(numbers.filter((x, i) => numbers.indexOf(x) !== i))) report('docs/adr', `two ADR files share the number ${n}`);
  for (const [area, choice, version, source, adr] of decisions) {
    if (!version) report(rel, `"${area}: ${choice}" has no version (use - when there is none)`);
    else if (version !== '-' && !(LINK.test(source ?? '') && DATE.test(source ?? ''))) report(rel, `"${area}: ${choice}" ${version} has no registry link with a date`);
    if (!(adrId(adr) || adr === '-')) report(rel, `"${area}: ${choice}" has ADR "${adr}", expected ADR-NNNN or -`);
  }
  for (const [area, choice, why] of twoWay) if (!why) report(rel, `two-way "${area}: ${choice}" has no reason`);

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

if (args.stage === 'kickoff') checkKickoff();
if (args.stage === 'discovery') checkDiscovery();
if (args.stage === 'decide') checkDecide();

const what = `${kinds.join(',')}${args.stage ? `, stage ${args.stage}` : ''}`;
if (problems.length === 0) {
  console.log(`PASS docs-check (${what}) in ${root}`);
} else {
  console.log(`FAIL docs-check (${what}) in ${root}`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
