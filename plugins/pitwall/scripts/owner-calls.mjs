#!/usr/bin/env node
// What waits for the owner in a pitwall project (T4a-AC3), for /pitwall:owner-calls.
//
//   node owner-calls.mjs [--project <dir>] [--json] [--no-github]
//
// Read-only. It gathers, grouped, each with what happens if the owner says nothing:
//   switches   the switches only the owner sets, each with the command to run in a terminal:
//              merge protection still pending, the choice of ADR-0010 not made;
//   questions  the open questions of every epic not merged yet, and while the plan is made the
//              open items of docs/PLAN-REVIEW.md;
//   merges     the PRs of the loop that are ready, gate and ai-review green on their head, and
//              wait for the owner's yes: high risk, a bug fix, or no yes to merges without them;
//   bugs       the open rows of docs/BUGS.md.
// GitHub is read through gh, as merge.mjs reads it; --no-github, or a gh that cannot read, leaves
// the merges out and says why. --json prints { groups: [{ name, title, items: [{ what, default, run? }] }], notes },
// run being the commands for the owner, each on a line of its own in the text output. An open question
// is a line of "## Open questions" that asks one; "Answered (<date>): ..." and notes are not.
// Exit 0, or 2 on a usage error or outside a pitwall project.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { changeOf, config, ghRunner, gitRunner, parseArgs, parseJson, pluginRoot, readGate, readReview, requireNode } from './lib.mjs';

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
const epics = plan.map((c) => ({ id: /^\[?(E\d+)\]?/.exec(c[0] ?? '')?.[1], link: /\]\(([^)]+)\)/.exec(c[0] ?? '')?.[1], risk: c[2], status: c[4] ?? '' })).filter((e) => e.id);
for (const e of epics.filter((x) => !/^(merged|released)\b/i.test(x.status))) {
  const text = e.link ? read(join('docs', e.link)) : null;
  const open = section(text, 'Open questions');
  if (!open || /^none\.?$/i.test(open)) continue;
  // An open question asks something; an answer is recorded as "Answered (<date>): ..." (the continue skill),
  // and a note that asks nothing waits for nobody.
  for (const q of open.split('\n').map((l) => l.replace(/^[-*]\s+/, '').trim()).filter(Boolean)) {
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

// The open bugs.
for (const r of rows(read('docs/BUGS.md')).slice(1)) {
  if (!/^BUG-\d+$/.test(r[0] ?? '') || /^(fixed|closed)\b/i.test(r[5] ?? '')) continue;
  groups.bugs.push({ what: `${r[0]} (${r[5] || 'open'}), found in ${r[1]}: ${r[4]}`, default: 'its fix goes first in the next /pitwall:continue' });
}

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
    const risk = c.epic ? epics.find((e) => e.id === c.epic)?.risk : null;
    const waits = !c.epic ? 'a bug fix' : cfg.riskClasses[risk]?.merge !== 'auto' ? `${risk} risk` : choice !== true ? 'you have not allowed merges without you' : null;
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
