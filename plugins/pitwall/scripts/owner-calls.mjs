#!/usr/bin/env node
// What waits for the owner in a pitwall project (T4a-AC3), for /pitwall:owner-calls.
//
//   node owner-calls.mjs [--project <dir>] [--json] [--no-github]
//
// Read-only. It gathers, grouped, each with what happens if the owner says nothing:
//   switches   the switches only the owner sets, each with the command to run in a terminal:
//              merge protection still pending, the choice of ADR-0010 not made;
//   questions  the open questions of every epic not merged yet, while the plan is made the open
//              items of docs/PLAN-REVIEW.md, and every bug filed without the owner's answer on its
//              severity (T4b);
//   merges     the PRs of the loop that are ready, gate and ai-review green on their head, and
//              wait for the owner's yes: high risk, a bug fix at any class, or no yes to merges
//              without them;
//   bugs       the open bugs, docs/BUGS.md with the rows that wait in the git directory over it (T4b):
//              a blocking one's fix goes right after the change in flight, one that is not blocking
//              waits until no epic is ready.
// GitHub is read through gh, as merge.mjs reads it; --no-github, or a gh that cannot read, leaves
// the merges out and says why. --json prints { groups: [{ name, title, items: [{ what, default, run? }] }], notes },
// run being the commands for the owner, each on a line of its own in the text output. An open question
// is an item of "## Open questions" (a bullet with its wrapped lines, or a paragraph) that asks one;
// "Answered (<date>): ..." and notes are not. A PR's risk class is read as merge.mjs reads it, at its
// head and where it left main.
// Exit 0, or 2 on a usage error or outside a pitwall project.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { bugsView, changeOf, config, ghRunner, gitRunner, parseArgs, parseJson, pluginRoot, readGate, readReview, requireNode, riskClassAt } from './lib.mjs';

requireNode();
const usage = 'node owner-calls.mjs [--project <dir>] [--json] [--no-github]';
const args = parseArgs(process.argv.slice(2), { project: 'value', json: 'switch', 'no-github': 'switch' }, usage);
const cfg = config();
const project = resolve(args.project ?? '.');
const read = (rel) => (existsSync(join(project, rel)) ? readFileSync(join(project, rel), 'utf8').replace(/\r\n?/g, '\n') : null);
const settings = parseJson(read('.claude/pitwall.json') ?? '');
if (!settings) {
  console.error(`owner-calls: ${project} is not a pitwall project: .claude/pitwall.json is missing or does not parse\nusage: ${usage}`);
  process.exit(2);
}
// A command the owner runs as it is, in bash or PowerShell, from anywhere (L-6).
const script = (name, ...rest) => [`node "${join(pluginRoot, 'scripts', name).split('\\').join('/')}"`, ...rest, `--project "${project}"`].join(' ');
const rows = (text) => (text ?? '').split('\n').filter((l) => /^\|/.test(l)).map((l) => l.split('|').slice(1, -1).map((c) => c.trim())).filter((c) => !c.every((x) => /^:?-+:?$/.test(x)));
const section = (text, name) => {
  const m = new RegExp(`^## ${name}[ \\t]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(text ?? '');
  return m ? m[1].trim() : '';
};
// The items of a list: a bullet with the lines wrapped or nested under it, or a paragraph.
const items = (text) => {
  const out = [];
  let open = false;
  for (const l of text.split('\n')) {
    const bullet = /^([ \t]*)(?:[-*+]|\d+[.)])\s+(.*)$/.exec(l);
    if (!l.trim()) open = false;
    else if (bullet && open && bullet[1].length >= 2) out[out.length - 1] += ` ${bullet[2].trim()}`;
    else if (bullet || !open) {
      out.push((bullet ? bullet[2] : l).trim());
      open = true;
    } else out[out.length - 1] += ` ${l.trim()}`;
  }
  return out;
};
const groups = { switches: [], questions: [], merges: [], bugs: [] };
const notes = [];

// The switches: only the owner sets them, so they are handed over as commands (L-6).
if (settings.mergeProtection === 'pending' || !cfg.mergeProtection.modes.includes(settings.mergeProtection)) {
  groups.switches.push({ what: `merge protection is ${settings.mergeProtection ?? 'not recorded'}`, default: 'nothing merges', run: [script('protect.mjs')] });
}
const choice = settings[cfg.loop.ownerChoice];
if (typeof choice !== 'boolean') {
  groups.switches.push({ what: 'you have not chosen whether low and normal risk epics merge without you (ADR-0010): the first command says yes, the second no', default: 'every merge waits for you', run: [script('merge-choice.mjs', '--allow'), script('merge-choice.mjs', '--deny')] });
}

// The open questions of every epic not merged yet.
const plan = rows(read('docs/EPICS.md')).slice(1);
const epics = plan.map((c) => ({ id: /^\[?(E\d+)\]?/.exec(c[0] ?? '')?.[1], link: /\]\(([^)]+)\)/.exec(c[0] ?? '')?.[1], status: c[4] ?? '' })).filter((e) => e.id);
for (const e of epics.filter((x) => !/^(merged|released)\b/i.test(x.status))) {
  const text = e.link ? read(join('docs', e.link)) : null;
  const open = section(text, 'Open questions');
  if (!open || /^none\.?$/i.test(open)) continue;
  // An open question asks something; an answer is recorded as "Answered (<date>): ..." (the continue skill),
  // and a note that asks nothing waits for nobody.
  for (const q of items(open)) {
    if (/^(answered|closed)\b/i.test(q) || !q.includes('?')) continue;
    groups.questions.push({ what: `${e.id}: ${q}`, default: `${e.id} waits for the answer before any code` });
  }
}
// While the plan is made: the open items of the plan review.
const git = gitRunner(project);
const planMerged = git('log', '--merges', '--format=%H', '--grep', 'Plan approved by the owner', '-1', cfg.mergeProtection.branch).out !== '';
if (!planMerged) {
  for (const r of rows(read('docs/PLAN-REVIEW.md'))) {
    const last = r[r.length - 1] ?? '';
    if (/^open\b/i.test(last)) groups.questions.push({ what: `plan review: ${r.slice(0, -1).filter(Boolean).join(' | ')}: ${last}`, default: 'the plan does not merge' });
  }
}

// The open bugs, docs/BUGS.md with what waits in the git directory over it. A bug nobody confirmed is a
// question: it is blocking until the owner answers (owner, 2026-11-11).
const view = bugsView(project, cfg);
const blocking = Object.keys(cfg.bugs.severities)[0];
for (const b of view.rows.filter((x) => x.open)) {
  const waits = `${b.row.branch ? `, its row on ${b.row.branch}, not merged yet` : ''}${b.row.waiting ? ', waiting in the git directory for the next branch' : ''}`;
  if (b.unconfirmed) {
    groups.questions.push({ what: `${b.id} (${b.title}) was filed without your answer: confirm its severity, now ${b.severity}, and its class, ${b.risk}${waits}`, default: `it stays ${b.severity}: its fix goes right after the change in flight` });
  } else {
    groups.bugs.push({ what: `${b.id} (${b.title}): ${b.severity}, ${b.risk} risk, ${b.status || 'open'}${waits}`, default: /^in (progress|review)$/i.test(b.status) ? 'its fix is in flight, and merges after your yes' : b.severity === blocking ? 'its fix goes right after the change in flight, before the next epic' : 'it waits until no epic is ready' });
  }
}
if (view.tree.old) notes.push(`docs/BUGS.md has the table of seven columns from before T4b: each open bug in it counts as ${cfg.bugs.oldTable.severity} and ${cfg.bugs.oldTable.risk} until /pitwall:continue gives it the new columns`);

// The PRs of the loop that are ready and wait for the owner's yes.
if (args['no-github']) notes.push('GitHub was not read (--no-github): PRs waiting for your yes are not listed');
else {
  const gh = ghRunner(project, 'owner-calls');
  const view = gh(['repo', 'view', '--json', 'nameWithOwner']);
  const name = view.ok ? parseJson(view.out)?.nameWithOwner : null;
  const list = name ? gh(['pr', 'list', '--state', 'open', '--json', 'number,headRefName,headRefOid,title']) : null;
  const prs = list?.ok ? parseJson(list.out) : null;
  if (!Array.isArray(prs)) notes.push(`GitHub could not be read (${((list ?? view).err || (list ?? view).out).trim().split('\n').pop() || 'no repository'}): PRs waiting for your yes are not listed`);
  for (const pr of Array.isArray(prs) ? prs : []) {
    const c = changeOf(pr.headRefName, cfg);
    if (!c?.id) continue;
    const r = readReview(gh, name, pr.headRefOid, cfg);
    const g = readGate(gh, name, pr.headRefOid, cfg);
    if (r.failed || g.failed) {
      notes.push(`PR #${pr.number}: its checks could not be read`);
      continue;
    }
    if (r.review?.state !== 'success' || g.gate?.conclusion !== 'success') continue;
    // The class merge.mjs will read: at the PR's head, here or as fetched, and where it left main.
    const head = c.epic ? [pr.headRefOid, `refs/remotes/origin/${pr.headRefName}`].find((x) => git('rev-parse', '--verify', '-q', `${x}^{commit}`).ok) : null;
    const risk = head ? riskClassAt(git, c.epic, head, cfg.mergeProtection.branch, cfg) : null;
    // Every bug fix waits for the owner's yes, at any class (ADR-0010; owner, 2026-11-11).
    const waits = !c.epic
      ? 'a bug fix'
      : !risk
        ? head ? `docs/EPICS.md at its head gives ${c.epic} no risk class` : 'its head is not in this clone, so its risk class is unknown: git fetch'
        : cfg.riskClasses[risk].merge !== 'auto' ? `${risk} risk` : choice !== true ? 'you have not allowed merges without you' : null;
    if (waits) groups.merges.push({ what: `PR #${pr.number} (${c.id}) is ready: gate and ai-review are green; it waits for your yes (${waits})`, default: 'it stays open' });
  }
}

const titles = { switches: 'Switches only you set', questions: 'Questions', merges: 'Ready to merge, waiting for your yes', bugs: 'Open bugs' };
const out = { groups: Object.entries(groups).map(([n, items]) => ({ name: n, title: titles[n], items })).filter((g) => g.items.length), notes };
if (args.json) {
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}
if (out.groups.length === 0) console.log('owner-calls: nothing waits for you.');
for (const g of out.groups) {
  console.log(`${g.title}:`);
  for (const i of g.items) {
    console.log(`- ${i.what} (if you say nothing: ${i.default})`);
    if (i.run) {
      console.log('  Run this yourself, in bash or PowerShell:');
      for (const c of i.run) console.log(`    ${c}`);
    }
  }
}
for (const n of notes) console.log(`Note: ${n}`);
