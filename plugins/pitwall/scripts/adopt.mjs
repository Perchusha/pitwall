#!/usr/bin/env node
// Adopts an existing project (T6): pitwall starts in a repository that already holds code or
// docs, lays out only what is missing, keeps what is there, and starts at the stage the project
// has reached.
//
//   node adopt.mjs [--dry-run] [--target <dir>]
//   node adopt.mjs --write --name <project> --idea '<one line>' --level lite|standard|full
//                  --stage discovery|decide|plan [--plan-file <path>] [--target <dir>]
//   node adopt.mjs --gate [--target <dir>]      with the gate's commands on stdin
//
// --dry-run, the default, comes first and writes nothing (T6-AC5). It prints what the adoption
// would do, one line per fact, for the adopt skill and the owner to decide from:
//   ADD <path>            a template path the project lacks: --write lays it out
//   KEEP <path>           a template path the project already has: never overwritten (T6-AC1);
//                         for a document, the template's sections it lacks
//   SKIP <path>           a template path that is right for a new project only
//   PLAN <file>           a plan of the project's own (a roadmap, a to-do list) and its items,
//                         done or open: what docs/EPICS.md takes over, so there are never two plans
//   DOC <file>            a document of the project, with its headings, to map onto the template's
//   CHECK <command>       a check the project already runs, by its manifest or its CI: a proposal
//                         for scripts/gate, which the owner confirms (T6-AC3)
//   NOTE, BLOCKER         what the owner has to know, and what stops the adoption
// Exit 0 with "RESULT: dry run, nothing written"; exit 1 when this is no project to adopt.
//
// --write lays out every template path the project lacks, with the placeholders filled, and
// .claude/pitwall.json with the process level, the plugin version and the stage the project
// starts from (startStage, T6-AC4; planFile names the plan EPICS.md takes over). It overwrites
// nothing. It refuses on the branch merge protection guards, since the adoption is a change like
// any other and reaches that branch through the plan's PR, and over uncommitted work.
//
// --gate writes scripts/gate from the project's real checks (T6-AC3), one per line on stdin:
//   fast: <command>       run by scripts/gate --fast, before every commit
//   full: <command>       run by scripts/gate --full and --changed, and by CI
// It replaces only the template's stub, or a gate it wrote before; a gate the project brought
// stays as it is.
//
// Exit 0 done, 1 refused, 2 usage.

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { config, listFiles, parseArgs, pluginRoot, pluginVersion, projectPath, requireNode, templateRoot, writeJson } from './lib.mjs';

requireNode();
const usage =
  "node adopt.mjs [--dry-run] [--target <dir>] | --write --name <project> --idea '<one line>' --level lite|standard|full --stage discovery|decide|plan [--plan-file <path>] [--target <dir>] | --gate [--target <dir>]";
const args = parseArgs(process.argv.slice(2), { 'dry-run': 'switch', write: 'switch', gate: 'switch', name: 'value', idea: 'value', level: 'value', stage: 'value', 'plan-file': 'value', target: 'value' }, usage);
const cfg = config();
const A = cfg.adopt;
const bad = (msg) => {
  console.error(`adopt: ${msg}\nusage: ${usage}`);
  process.exit(2);
};
const refuse = (msg, list = []) => {
  console.log(`adopt: REFUSED - ${msg}`);
  for (const e of list.slice(0, A.maxListed)) console.log(`  ${e}`);
  console.log('RESULT: nothing written');
  process.exit(1);
};
if ([args['dry-run'], args.write, args.gate].filter(Boolean).length > 1) bad('give one of --dry-run, --write and --gate');
if (!args.write && (args.name || args.idea || args.level || args.stage || args['plan-file'])) bad('--name, --idea, --level, --stage and --plan-file go with --write');
const target = resolve(args.target ?? '.');
if (!existsSync(target) || !statSync(target).isDirectory()) bad(`${target} is not a folder`);

const git = (...a) => {
  const r = spawnSync('git', ['-C', target, '-c', 'core.quotePath=false', ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: !r.error && r.status === 0, out: (r.stdout ?? '').trim(), err: `${r.stderr ?? ''}${r.error?.message ?? ''}`.trim() };
};
const has = (rel) => existsSync(join(target, rel));
const read = (rel) => readFileSync(join(target, rel), 'utf8');
const sameFolder = (a, b) => {
  const n = (p) => resolve(p).split('\\').join('/').replace(/\/+$/, '');
  return process.platform === 'win32' ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
};
const guarded = cfg.mergeProtection.branch;
const STUB_GATE = readFileSync(join(templateRoot, 'scripts', 'gate'));
const GATE_MARK = "# Written by pitwall's adopt.mjs";
const settingsFile = '.claude/pitwall.json';

// ---------- what every mode needs to know first ----------

// A project to adopt: the top folder of a git repository with a commit, not a pitwall project yet.
function requireProject() {
  const top = git('rev-parse', '--show-toplevel');
  if (!top.ok) refuse(`${target} is not in a git repository. A project that exists but is not under git yet: run git init and commit what it holds, then adopt it; a new one starts with /pitwall:kickoff in an empty folder.`);
  if (!sameFolder(top.out, target)) refuse(`${target} is not the top folder of its git repository (${top.out}): a project is adopted from there.`);
  if (!git('rev-parse', '--verify', '-q', 'HEAD').ok) refuse(`the repository in ${target} has no commit yet: a new project starts with /pitwall:kickoff.`);
  if (has(settingsFile)) refuse(`${target} is a pitwall project already (${settingsFile}): /pitwall:continue goes on with it.`);
  // The adoption lives on the planning branch until the plan merges: a session on main, or a new clone, finds it
  // there, here or on origin (review round 1).
  const plan = cfg.planning.branch;
  const holder = [plan, `origin/${plan}`].find((ref) => git('cat-file', '-e', `${ref}:${settingsFile}`).ok);
  if (holder) refuse(`this project is being adopted already: ${holder} holds ${settingsFile}. Switch to it (git switch ${plan}) and go on with /pitwall:continue there.`);
}

// Tracked files, and the untracked ones git does not ignore.
const projectFiles = () => {
  const tracked = git('ls-files').out.split('\n').filter(Boolean);
  const untracked = git('ls-files', '--others', '--exclude-standard').out.split('\n').filter(Boolean);
  return { tracked, untracked };
};

// The "## " headings of a Markdown text, outside fenced code.
function headings(text) {
  const out = [];
  let fence = null;
  for (const line of String(text).split(/\r?\n/)) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (f) {
      if (!fence) fence = f[0];
      else if (f[0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const h = /^##[ \t]+(.+?)[ \t]*$/.exec(line);
    if (h) out.push(h[1]);
  }
  return out;
}

// The template, as it lands in a project. The project's own CI keeps its file: the job named
// `gate` then goes into a workflow of its own. Three files of the template act on every file of
// a project, which is right for a new one and wrong for one that exists: an adopted project gets
// narrow ones, for pitwall's own paths only, or none.
const CI = '.github/workflows/ci.yml';
const NARROW = {
  '.gitattributes': {
    body: '# pitwall\'s scripts run through bash on every system, which stops at a carriage return:\n# their line endings stay LF. Nothing else of the project is touched.\nscripts/gate text eol=lf\nscripts/build text eol=lf\n.githooks/* text eol=lf\n',
    because: ' (for pitwall\'s own scripts only, which need LF line endings; the line endings of your files stay as they are)',
  },
  '.gitignore': {
    body: '# Secrets\n.env\n.env.*\n!.env.example\n\n# Claude Code settings that stay on this machine\n.claude/settings.local.json\n',
    because: ' (only .env files and Claude Code\'s local settings)',
  },
  '.editorconfig': { skip: 'an editor setting of the template\'s, which would restyle your files: add one yourself if you want it' },
};
function layoutPlan() {
  return listFiles(templateRoot).map((rel) => {
    let dest = projectPath(rel);
    let because = '';
    // The gate's workflow runs scripts/gate on a bare runner: an adopted project's real checks need its toolchain.
    const setup = 'it runs scripts/gate on a bare runner, so the adoption adds the setup your checks need, the toolchain and the dependencies, from your workflows or your answer';
    if (dest === CI && has(CI)) {
      dest = A.gateWorkflow;
      because = ` (your ${CI} is kept, and the check named ${cfg.review.gateContext} needs a job of its own; ${setup})`;
    } else if (dest === CI) because = ` (${setup})`;
    const narrow = NARROW[dest] ?? {};
    return { rel, dest, because: narrow.because ?? because, body: narrow.body, skip: has(dest) ? undefined : narrow.skip, kept: has(dest) };
  });
}

// What stops the adoption, whatever the owner decides.
function blockers() {
  const out = [];
  // The default branch: GitHub's, as origin's HEAD records it, else the branch this clone stands on. pitwall guards
  // one branch, the same in every project, until 1.0 at least (owner, 2026-11-14): a project whose default branch has
  // another name renames it first, and the dry run says how.
  const remote = git('remote', 'get-url', 'origin').ok;
  const originHead = git('symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD').out.replace(/^origin\//, '');
  const here = git('symbolic-ref', '--short', '-q', 'HEAD').out;
  const hasGuarded = git('rev-parse', '--verify', '-q', `refs/heads/${guarded}`).ok;
  // Without origin's HEAD on record (a remote never fetched by git 2.48 or later), GitHub is asked; the branch
  // checked out names the default only where there is no remote at all (T6 review, round 3).
  let fromRemote = originHead;
  if (!fromRemote && remote) fromRemote = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(git('ls-remote', '--symref', 'origin', 'HEAD').out)?.[1] ?? '';
  const other = fromRemote ? (fromRemote !== guarded ? fromRemote : null) : !hasGuarded ? (remote ? '<the default branch>' : here || null) : null;
  if (other) {
    const steps = [
      ...(remote
        ? [`on GitHub, which also moves its open PRs and its branch protection to the new name and keeps it the default: gh api -X POST repos/{owner}/{repo}/branches/${other}/rename -f new_name=${guarded}`]
        : []),
      `here: git branch -m ${other} ${guarded}`,
      ...(remote ? [`here and in every other clone: git fetch origin, git branch -u origin/${guarded} ${guarded}, git remote set-head origin -a`] : []),
      `then whatever names ${other} by name: the workflows' branch filters, a deploy, a badge, scripts`,
    ];
    out.push(
      `pitwall guards the branch "${guarded}", and this project's default branch is ${other.startsWith('<') ? 'not it (GitHub could not be asked which it is)' : `"${other}"${fromRemote === other ? ' on GitHub' : ''}`}. Rename it first, then adopt:\n${steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`,
    );
  }
  return out;
}

// ---------- --gate ----------

if (args.gate) {
  if (!has(settingsFile)) refuse(`${target} is not a pitwall project yet: run adopt.mjs --write first.`);
  const file = join(target, 'scripts', 'gate');
  if (existsSync(file)) {
    const now = readFileSync(file);
    if (!now.equals(STUB_GATE) && !now.toString('utf8').includes(GATE_MARK)) refuse('scripts/gate is the project\'s own file, and pitwall never overwrites it. Make it take --fast, --changed and --full, and exit 0 only when the project\'s checks pass.');
  }
  let text = '';
  try {
    text = readFileSync(0, 'utf8');
  } catch {}
  const lists = { fast: [], full: [] };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(fast|full):\s*(\S.*)$/.exec(line);
    if (!m) bad(`"${line.slice(0, 60)}" is not a line of the gate: "fast: <command>" or "full: <command>"`);
    lists[m[1]].push(m[2].trim());
  }
  if (lists.full.length === 0) bad('give at least one "full: <command>" line on stdin: the gate of an adopted project runs its real checks');
  // Without a fast list, every commit waits for the full one.
  if (lists.fast.length === 0) lists.fast = [...lists.full];
  const quote = (c) => `'${c.split("'").join("'\\''")}'`;
  const body = `#!/usr/bin/env bash
# The gate contract of a pitwall project.
#
#   scripts/gate --fast      the quick checks: the inner loop, and before every commit
#   scripts/gate --changed   checks for what changed since ${guarded} (here: the full list)
#   scripts/gate --full      everything CI runs
#
# Exit 0 is a pass, anything else is a fail. pitwall never assumes a stack: its
# skills and hooks only call this script.
#
${GATE_MARK} (${pluginVersion()}), from the checks this project
# already had, as its owner confirmed them when pitwall adopted it. It is the
# project's file now: change the two lists as the checks change.
set -uo pipefail
cd "$(dirname "$0")/.."

fast=(
${lists.fast.map((c) => `  ${quote(c)}`).join('\n')}
)
full=(
${lists.full.map((c) => `  ${quote(c)}`).join('\n')}
)

mode="\${1:---full}"
case "$mode" in
  --fast) checks=("\${fast[@]}") ;;
  --changed|--full) checks=("\${full[@]}") ;;
  *) echo "usage: scripts/gate [--fast|--changed|--full]" >&2; exit 2 ;;
esac

for check in "\${checks[@]}"; do
  echo "gate: $check"
  if ! bash -c "$check"; then
    echo "gate: FAIL ($mode) - $check"
    exit 1
  fi
done
echo "gate: PASS ($mode) - \${#checks[@]} checks"
`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
  chmodSync(file, 0o755);
  console.log(`adopt: scripts/gate runs ${lists.fast.length} check(s) with --fast and ${lists.full.length} with --full and --changed`);
  for (const c of lists.full) console.log(`  full: ${c}`);
  for (const c of lists.fast) console.log(`  fast: ${c}`);
  console.log('adopt: mark it executable in the index (git update-index --chmod=+x scripts/gate, after git add) and run it: bash scripts/gate --full');
  console.log('RESULT: gate written');
  process.exit(0);
}

// ---------- the dry run, and --write ----------

requireProject();
const { tracked, untracked } = projectFiles();
const all = [...tracked, ...untracked];
const plan = layoutPlan();
const stops = blockers();
const branch = git('symbolic-ref', '--short', '-q', 'HEAD').out;
// Every file, not a collapsed folder: an untracked .claude/ that holds only Claude Code's local settings is no work.
const dirty = git('status', '--porcelain', '--untracked-files=all').out.split('\n').filter((l) => l && !l.endsWith('.claude/settings.local.json'));
// Files the project wrote before pitwall under docs/, which pitwall's checks read: its own decisions, plans, reviews and
// notes, kept as they are and left alone by the docs check, their IDs included (review rounds 1 and 2).
const ownDocs = all.filter((f) => f.startsWith(`${A.ownDocsFolder}/`) && !plan.some((p) => p.dest === f)).sort();
// A path the project's .gitignore ignores would never be committed: the adoption could not finish (review round 1).
const ignoredAdds = (() => {
  const adds = plan.filter((p) => !p.kept && !p.skip).map((p) => p.dest);
  const r = spawnSync('git', ['-C', target, 'check-ignore', '--no-index', '--stdin'], { encoding: 'utf8', input: adds.join('\n') + '\n' });
  return (r.stdout ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
})();
if (ignoredAdds.length) stops.push(`the project's ignore rules ignore ${ignoredAdds.length > 3 ? `${ignoredAdds.slice(0, 3).join(', ')} and ${ignoredAdds.length - 3} more` : ignoredAdds.join(', ')}, which pitwall must commit: change the rule (git check-ignore -v <path> names it), or re-include the path after it with "!<path>", and when the rule names a folder that holds it (docs/, .claude/), re-include that folder itself ("!.claude/"), since git cannot re-include a file inside a folder it excludes; then adopt.`);
// The documents pitwall keeps and reads (CLAUDE.md, a kept docs/SPEC.md): an ID in them that points nowhere fails the docs
// check at every stage, and the adoption never changes the owner's lines; and pitwall's sections must still fit CLAUDE.md's
// size (review round 2). Both are the owner's to put right on main, before the adoption.
const keptDocs = plan.filter((p) => p.kept && p.dest.endsWith('.md')).map((p) => p.dest);
if (keptDocs.length) {
  const ids = spawnSync(process.execPath, [join(pluginRoot, 'scripts', 'docs-check.mjs'), '--root', target, '--only', 'ids'], { encoding: 'utf8' });
  const loose = (ids.stdout ?? '').split(/\r?\n/).map((l) => /^ {2}- (.+?):(\d+): (\S+) points nowhere$/.exec(l)).filter((m) => m && keptDocs.includes(m[1]));
  if (loose.length) stops.push(`${loose.slice(0, 6).map((m) => `${m[3]} (${m[1]}:${m[2]})`).join(', ')}${loose.length > 6 ? ` and ${loose.length - 6} more` : ''}: an ID of pitwall's form that no pitwall document will define, in a file pitwall keeps and its docs check reads. Put each in a code span, which marks an example, or reword it, on main; then adopt.`);
}
const claudeKept = plan.find((p) => p.dest === 'CLAUDE.md' && p.kept);
if (claudeKept) {
  const lines = (text) => text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  const tpl = lines(readFileSync(join(templateRoot, claudeKept.rel), 'utf8'));
  const have = new Set(headings(read('CLAUDE.md')));
  let added = 0;
  tpl.forEach((l, i) => {
    const h = /^##[ \t]+(.+?)[ \t]*$/.exec(l)?.[1];
    if (!h || have.has(h)) return;
    const end = tpl.findIndex((x, k) => k > i && /^##[ \t]/.test(x));
    added += (end < 0 ? tpl.length : end) - i + 1;
  });
  const total = lines(read('CLAUDE.md')).length + added;
  if (total > cfg.docsLimits.claudeMdMaxLines) stops.push(`CLAUDE.md would be about ${total} lines with the ${added} lines of pitwall's sections it lacks, over the limit of ${cfg.docsLimits.claudeMdMaxLines} lines the docs check holds it to. Move part of it into a file of its own that CLAUDE.md imports with one line, @<the file>, on main; then adopt.`);
}

if (args.write) {
  for (const key of ['name', 'idea', 'level', 'stage']) if (!args[key]?.trim()) bad(`--${key} is required`);
  if (!Object.keys(cfg.processLevels).includes(args.level)) bad(`--level must be one of ${Object.keys(cfg.processLevels).join(', ')}`);
  if (!A.stages.includes(args.stage)) bad(`--stage must be one of ${A.stages.join(', ')}: the stage the project starts from`);
  for (const key of ['name', 'idea']) {
    if (/[\r\n]/.test(args[key])) bad(`--${key} must be one line`);
    if (args[key].includes('{{')) bad(`--${key} must not contain "{{"`);
  }
  const planFile = args['plan-file']?.split('\\').join('/');
  if (planFile && !all.includes(planFile)) bad(`--plan-file ${planFile} is not a file of this repository`);
  if (stops.length) refuse(stops[0]);
  if (!branch) refuse('HEAD names no branch: switch to the planning branch first.');
  if (branch === guarded) refuse(`${guarded} is the branch merge protection guards: the adoption goes on the planning branch (git switch -c ${cfg.planning.branch}) and reaches ${guarded} with the plan's PR.`);
  if (dirty.length) refuse('the tree holds uncommitted work, and the adoption\'s commit holds only what pitwall lays out. Commit it or put it aside first:', dirty);

  const values = { PROJECT_NAME: args.name.trim(), ONE_LINE_IDEA: args.idea.trim(), PROCESS_LEVEL: args.level, TEMPLATE_VERSION: pluginVersion(), PLANNING_BRANCH: cfg.planning.branch };
  // Every file in memory first, so an error writes nothing.
  const files = plan
    .filter((f) => !f.kept && !f.skip)
    .map((f) => {
      const raw = f.body !== undefined ? Buffer.from(f.body, 'utf8') : readFileSync(join(templateRoot, f.rel));
      let body = raw;
      if (raw.includes('{{')) {
        let text = raw.toString('utf8');
        for (const [k, v] of Object.entries(values)) text = text.split(`{{${k}}}`).join(v);
        const left = /\{\{[A-Z_]+\}\}/.exec(text);
        if (left) refuse(`template/${f.rel} has a placeholder this script does not fill: ${left[0]}`);
        body = Buffer.from(text, 'utf8');
      }
      // Beside the project's own workflow named ci, pitwall's has a name of its own in the list of Actions.
      if (f.dest === A.gateWorkflow) body = Buffer.from(body.toString('utf8').replace(/^name: ci$/m, 'name: pitwall-gate'), 'utf8');
      return { ...f, body, mode: statSync(join(templateRoot, f.rel)).mode };
    });
  for (const f of files) {
    const out = join(target, f.dest);
    mkdirSync(dirname(out), { recursive: true });
    // Never over a file: "wx" fails where one appeared since the listing.
    writeFileSync(out, f.body, { flag: 'wx' });
    if (f.mode & 0o111 || /^(scripts|\.githooks)\//.test(f.dest)) chmodSync(out, 0o755);
  }
  // .claude/pitwall.json is among them (the project had none): it gains where the project starts.
  const settings = JSON.parse(read(settingsFile));
  settings[A.key] = args.stage;
  if (planFile) settings.planFile = planFile;
  if (ownDocs.length) settings[A.ownDocsKey] = ownDocs;
  writeJson(join(target, settingsFile), settings);
  console.log(`adopt: wrote ${files.length} files into ${target}, and overwrote none`);
  for (const f of files) console.log(`  ADDED ${f.dest}`);
  for (const f of plan.filter((p) => p.kept)) console.log(`  KEPT ${f.dest}`);
  console.log(`adopt: ${settingsFile} records level ${args.level}, template ${values.TEMPLATE_VERSION}, merge protection pending, and ${A.key} ${args.stage}${planFile ? `, with ${planFile} as the plan docs/EPICS.md takes over` : ''}`);
  console.log('adopt: scripts/gate is still the template\'s stub, which fails on a project with code: adopt.mjs --gate writes the real one next');
  console.log(`RESULT: adopted at ${args.stage}`);
  process.exit(0);
}

// The dry run: every line a fact, nothing written.
const count = git('rev-list', '--count', 'HEAD').out;
const remote = git('remote', 'get-url', 'origin');
console.log(`adopt: ${target} holds a project: ${tracked.length} tracked files, ${count} commits, on ${branch || 'a detached HEAD'}; origin: ${remote.ok ? remote.out : 'none'}`);
for (const b of stops) console.log(`BLOCKER ${b}`);
if (dirty.length) console.log(`NOTE ${dirty.length} uncommitted change(s): the adoption's commit holds only what pitwall lays out, so commit them or put them aside before it.`);

console.log('\n== what pitwall would add, and what it keeps');
for (const f of plan.filter((p) => !p.kept && !p.skip)) console.log(`ADD ${f.dest}${f.because}`);
for (const f of plan.filter((p) => p.skip)) console.log(`SKIP ${f.dest} (${f.skip})`);
const KEEP_NOTES = {
  '.claude/settings.json': 'the template\'s holds deny rules for .env files, the pitwall marketplace and the plugin: merge them in by hand if you want them',
  '.gitattributes': 'pitwall\'s scripts and the gate need LF line endings: add the lines "scripts/gate text eol=lf", "scripts/build text eol=lf" and ".githooks/* text eol=lf", and nothing that renormalises your own files',
  'scripts/gate': 'your own gate stays: it must take --fast, --changed and --full and exit 0 only when the checks pass',
  'scripts/build': 'your own build stays: /pitwall:release runs it as scripts/build <version> and reads its "ARTIFACT: <path>" lines',
  'CHANGELOG.md': '/pitwall:release writes each version\'s section at its top',
  '.githooks/pre-commit': 'your own hook stays: pitwall\'s runs scripts/gate --fast before every commit',
};
for (const f of plan.filter((p) => p.kept)) {
  let note = KEEP_NOTES[f.dest] ?? '';
  if (f.dest.endsWith('.md')) {
    const want = headings(readFileSync(join(templateRoot, f.rel), 'utf8'));
    const mine = new Set(headings(read(f.dest)));
    const optional = cfg.docsLimits.optionalSections?.[f.dest] ?? [];
    const lacks = want.filter((h) => !mine.has(h) && !optional.includes(h));
    if (lacks.length) note = `lacks the template's sections: ${lacks.map((h) => `"${h}"`).join(', ')}`;
  }
  console.log(`KEEP ${f.dest}${note ? ` (${note})` : ''}`);
}
// A .gitignore of the project's own: what pitwall counts on being ignored.
if (has('.gitignore')) {
  const open = ['.env', '.claude/settings.local.json'].filter((p) => !git('check-ignore', '-q', '--no-index', p).ok);
  if (open.length) console.log(`NOTE your .gitignore does not ignore ${open.join(' and ')}: add ${open.length > 1 ? 'them' : 'it'}, so that secrets and Claude Code's local settings are never committed.`);
}

console.log('\n== the project\'s own plan');
const planRe = new RegExp(`(^|/)(${A.planNames.join('|')})[^/]*\\.md$`, 'i');
const templateDests = new Set(plan.map((p) => p.dest));
const plans = all.filter((f) => planRe.test(f) && f.split('/').length <= 3 && !templateDests.has(f));
if (plans.length === 0) console.log('NOTE no plan file found (a roadmap, a to-do list): the plan stage drafts docs/EPICS.md from the docs and the owner\'s answers.');
for (const f of plans) {
  const lines = read(f).split(/\r?\n/);
  const boxes = lines.map((l) => /^\s*(?:[-*+]|\d+[.)]) \[([ xX])\] (.+)$/.exec(l)).filter(Boolean).map((m) => ({ state: m[1] === ' ' ? 'open' : 'done', text: m[2].trim() }));
  const items = boxes.length ? boxes : lines.map((l) => /^#{2,3}[ \t]+(.+?)[ \t]*$/.exec(l)).filter(Boolean).map((m) => ({ state: 'state not marked', text: m[1] }));
  const open = items.filter((i) => i.state === 'open').length;
  console.log(`PLAN ${f}: ${items.length} items${boxes.length ? `, ${open} open and ${items.length - open} done` : ', as headings'}`);
  for (const i of items.slice(0, A.maxListed)) console.log(`  - [${i.state}] ${i.text.slice(0, 160)}`);
  if (items.length > A.maxListed) console.log(`  ... and ${items.length - A.maxListed} more`);
}

console.log('\n== the project\'s own documents');
for (const f of ownDocs.slice(0, A.maxListed)) console.log(`KEEP ${f} (written before pitwall: kept as it is, and the docs check leaves it alone, the IDs in it included)`);
if (ownDocs.length > A.maxListed) console.log(`KEEP and ${ownDocs.length - A.maxListed} more files under ${A.ownDocsFolder}/, kept as they are`);
const docs = all.filter((f) => /\.md$/i.test(f) && !templateDests.has(f) && !plans.includes(f) && (f.split('/').length === 1 || /^docs?\//i.test(f)) && f.split('/').length <= 4);
for (const f of docs.slice(0, A.maxListed)) console.log(`DOC ${f}: ${headings(read(f)).slice(0, 12).join(' | ') || 'no "##" headings'}`);
if (docs.length > A.maxListed) console.log(`NOTE ${docs.length - A.maxListed} more documents are not listed.`);
if (docs.length === 0) console.log('NOTE no document of its own beside the template\'s paths.');
const decisions = A.decisionFolders.filter((d) => all.some((f) => f.toLowerCase().startsWith(`${d}/`)));
for (const d of decisions) console.log(`DOC ${d}/: ${all.filter((f) => f.toLowerCase().startsWith(`${d}/`)).length} files of recorded decisions`);

console.log('\n== the checks the project already runs');
const checks = [];
const propose = (command, from) => {
  if (!checks.some((c) => c.command === command)) checks.push({ command, from });
};
if (has('package.json')) {
  let scripts = {};
  try {
    scripts = JSON.parse(read('package.json')).scripts ?? {};
  } catch {}
  const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb') || has('bun.lock') ? 'bun' : 'npm';
  for (const name of A.checkScripts) if (typeof scripts[name] === 'string') propose(name === 'test' ? `${pm} test` : `${pm} run ${name}`, `package.json "${name}"`);
}
if (has('Makefile')) for (const t of A.checkScripts) if (new RegExp(`^${t}:`, 'm').test(read('Makefile'))) propose(`make ${t}`, 'Makefile');
if (has('Cargo.toml')) propose('cargo test', 'Cargo.toml');
if (has('go.mod')) {
  propose('go vet ./...', 'go.mod');
  propose('go test ./...', 'go.mod');
}
if (['pytest.ini', 'tox.ini', 'pyproject.toml', 'setup.cfg'].some((f) => has(f) && /pytest/.test(read(f)))) propose('pytest', 'the Python configuration');
if (all.some((f) => /^[^/]+\.(sln|csproj)$/.test(f))) propose('dotnet test', 'the .NET solution');
for (const c of checks) console.log(`CHECK ${c.command} (from ${c.from})`);
// What CI runs today is the best witness of the project's real checks.
const workflows = all.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f));
for (const f of workflows) {
  const runs = read(f).split(/\r?\n/).map((l) => /^\s*-?\s*run:\s*(\S.*)$/.exec(l)?.[1]).filter((r) => r && r !== '|' && r !== '>');
  console.log(`CI ${f}: ${runs.length ? runs.slice(0, 12).map((r) => `run: ${r}`).join(' ; ') : 'no one-line run steps'}`);
}
if (checks.length === 0 && workflows.length === 0) console.log('NOTE no check found in a manifest or in CI: the owner names the commands, or the gate starts with the one that builds the project.');

console.log('\n== hooks');
const hooksPath = git('config', '--get', 'core.hooksPath').out;
if (hooksPath && hooksPath !== '.githooks') console.log(`NOTE core.hooksPath is ${hooksPath}: hooks of the owner's own, which pitwall's .githooks/pre-commit would replace only with their yes.`);
if (existsSync(join(target, '.husky'))) console.log('NOTE .husky/ holds hooks of the project\'s own: pitwall\'s gate before every commit is a git hook in .githooks, and git runs one hooks folder.');
if (has('.pre-commit-config.yaml')) console.log('NOTE .pre-commit-config.yaml: the project uses the pre-commit framework; its checks can go into the gate\'s fast list.');
try {
  const own = readdirSync(join(target, '.git', 'hooks')).filter((f) => !f.endsWith('.sample'));
  if (own.length) console.log(`NOTE .git/hooks holds ${own.join(', ')}: they stop running once core.hooksPath is .githooks.`);
} catch {}

console.log(`\nadopt: ${plan.filter((p) => !p.kept && !p.skip).length} paths to add, ${plan.filter((p) => p.kept).length} kept, ${plans.length} plan file(s), ${checks.length} check(s) proposed`);
console.log('RESULT: dry run, nothing written');
