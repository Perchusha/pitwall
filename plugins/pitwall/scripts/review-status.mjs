#!/usr/bin/env node
// Sets the ai-review commit status: the reviewer's verdict (T2-AC5, ADR-0002, ADR-0007).
//
//   node review-status.mjs --review plan --state success|failure [--description "<text>"] [--project <dir>] [--dry-run]
//
// Only a reviewer runs it: the plan reviewer now, the code-reviewer from T3, when a
// hook lets only those two agents run it (ADR-0007). It commits nothing but the
// review file, and sets the status on the head of the open PR from the review's
// branch, after it checks that it may (L-5):
//   - the tree is clean but for the review file, on the review's branch;
//   - success only when the review passes its check (for the plan:
//     docs-check --stage plan-review, and spike when there are spikes);
//   - gh is installed and signed in, the account may write, the branch is pushed
//     (it pushes it), and the PR is open with this commit as its head.
// A failed precondition prints a HANDOFF block with the commands for the owner,
// each on its own line, the same in bash and PowerShell (L-6).
// --dry-run makes the same checks and reads, and commits, pushes and writes nothing.
//
// The last line is "RESULT: <state>" or "RESULT: pending". Exit 0 status set, 1 refused
// (the review or the tree is not ready: nothing for the owner to do), 2 usage, 3 handed
// over. PITWALL_GH runs another gh binary (the checks use a fake one).

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, ghRunner, gitRunner, parseArgs, parseJson, pluginRoot, printHandoff, requireNode, sleep } from './lib.mjs';

requireNode();
const usage = 'node review-status.mjs --review plan --state success|failure [--description "<text>"] [--project <dir>] [--dry-run]';
const args = parseArgs(process.argv.slice(2), { review: 'value', state: 'value', description: 'value', project: 'value', 'dry-run': 'switch' }, usage);
const cfg = config();
const REVIEWS = {
  plan: {
    branch: cfg.planning.branch,
    file: 'docs/PLAN-REVIEW.md',
    stages: (project) => ['plan-review', ...(spikes(project) ? ['spike'] : [])],
    words: { success: 'approved', failure: 'changes requested' },
  },
};
const review = REVIEWS[args.review];
if (!review || !['success', 'failure'].includes(args.state)) {
  console.error(`review-status: --review must be ${Object.keys(REVIEWS).join(' or ')} and --state success or failure\nusage: ${usage}`);
  process.exit(2);
}
const project = resolve(args.project ?? '.');
const dry = Boolean(args['dry-run']);
const state = args.state;
const context = cfg.review.statusContext;
const base = cfg.mergeProtection.branch;
// A description goes into a handed-over command too, so it keeps to characters both shells take as they are.
const description = (args.description ?? `${args.review} review: ${review.words[state]}`).replace(/["`$\\]/g, "'").slice(0, 140);
const git = gitRunner(project);
const gh = ghRunner(project, 'review-status');
const self = fileURLToPath(import.meta.url);
const rerun = `node "${self}" --review ${args.review} --state ${state}${args.description ? ` --description "${description}"` : ''} --project "${project}"`;
const log = (msg) => console.log(`review-status: ${msg}`);
const suffix = dry ? ' (dry run, nothing written)' : '';

function spikes(dir) {
  try {
    return readdirSync(join(dir, 'docs', 'spikes')).some((f) => f.endsWith('.md') && f !== 'README.md' && f !== 'template.md');
  } catch {
    return false;
  }
}
function refuse(msg, detail = '') {
  console.log(`review-status: REFUSED - ${msg}`);
  if (detail) console.log(detail.replace(/^/gm, '  '));
  console.log('RESULT: not set');
  process.exit(1);
}
function handoff(reason, steps) {
  printHandoff(reason, steps, rerun);
  console.log(`RESULT: pending${suffix}`);
  process.exit(3);
}

// 1. The tree: on the review's branch, nothing changed but the review file.
if (!git('rev-parse', '--show-toplevel').ok) refuse(`${project} is not inside a git repository`);
const branch = git('branch', '--show-current').out;
if (branch !== review.branch) refuse(`on branch "${branch}": the ${args.review} review sets its status on ${review.branch}`);
// Porcelain lines are "XY path", and the first may start with a space, so the output is not trimmed.
const changed = git('-c', 'core.quotePath=false', 'status', '--porcelain', '--untracked-files=all').raw.split('\n').filter(Boolean).map((l) => l.slice(3));
const others = changed.filter((p) => p !== review.file);
if (others.length > 0) refuse(`the tree has changes besides ${review.file}; the main conversation commits its fixes before a review round`, others.slice(0, 20).join('\n'));
// The check reads the files on disk, so an ignored file it would read, and the commit would not hold, is refused too.
const ignored = git('-c', 'core.quotePath=false', 'status', '--porcelain', '--ignored', '--untracked-files=all', '--', 'docs', 'CLAUDE.md', '.claude/pitwall.json').raw.split('\n').filter((l) => l.startsWith('!! ')).map((l) => l.slice(3));
if (ignored.length > 0) refuse('files the docs check reads are ignored by git, so the reviewed commit would not hold them', ignored.slice(0, 20).join('\n'));

// 2. success only when the review passes its check, on the tree as it is.
if (state === 'success') {
  const stages = review.stages(project).join(',');
  const check = spawnSync(process.execPath, [join(pluginRoot, 'scripts', 'docs-check.mjs'), '--root', project, '--stage', stages], { encoding: 'utf8' });
  if (check.status !== 0) refuse(`the review does not pass docs-check --stage ${stages}: close what it reports, or set failure`, `${check.stdout}${check.stderr}`.trim());
  log(`docs-check --stage ${stages} passes`);
}

// 3. The review file is committed, so the status belongs to the commit that holds the verdict.
if (changed.includes(review.file)) {
  if (dry) log(`dry run: would commit ${review.file}`);
  else {
    const add = git('add', '--', review.file);
    const commit = add.ok && git('commit', '-m', `docs: ${args.review} review, ${review.words[state]}`, '--', review.file);
    if (!commit?.ok) refuse(`git could not commit ${review.file}`, (commit || add).err);
    log(`committed ${review.file}`);
  }
}
const sha = git('rev-parse', 'HEAD').out;

// 4. May we? gh, a signed-in account, a repository we may write to.
if (!gh(['--version']).ok) handoff('the GitHub CLI is not installed or does not run.', [{ note: 'install it from https://cli.github.com' }, { run: 'gh auth login' }]);
if (!gh(['auth', 'status', '--hostname', 'github.com']).ok) handoff('gh is not signed in to github.com.', [{ run: 'gh auth login' }]);
const view = gh(['repo', 'view', '--json', 'nameWithOwner,viewerPermission']);
const repo = view.ok ? parseJson(view.out) : null;
if (!repo?.nameWithOwner) {
  if (/no git remotes|not a git repository/i.test(view.err)) {
    // Spike branches go too: the spike check wants them on the remote once there is one (pitwall ADR-0009).
    const spikeBranches = git('for-each-ref', '--format=%(refname:short)', 'refs/heads/spike/').out.split('\n').filter(Boolean);
    handoff(`no GitHub repository for ${project}.`, [
      { note: 'from the project folder, create one named after the folder (use --public for a public repository), push the branches and open the PR' },
      { run: 'gh repo create --private --source . --remote origin' },
      { run: `git push -u origin ${base}` },
      { run: `git push -u origin ${review.branch}` },
      ...spikeBranches.map((b) => ({ run: `git push -u origin ${b}` })),
      { run: `gh pr create --base ${base} --head ${review.branch} --fill` },
    ]);
  }
  handoff(`gh could not read the repository: ${view.err.trim() || view.out.trim()}`, [{ note: 'fix what gh reports (the remote, the network, the name), then' }, { run: 'gh repo view' }]);
}
const name = repo.nameWithOwner;
if (!['ADMIN', 'MAINTAIN', 'WRITE'].includes(repo.viewerPermission)) {
  handoff(`setting a status on ${name} needs write access, and this account is ${repo.viewerPermission}.`, [{ note: 'someone with write access runs the command below' }]);
}

// 5. The commit is on GitHub: push the branch (never forced).
if (dry) log(`dry run: would push ${review.branch} to origin`);
else {
  const push = git('push', 'origin', review.branch);
  if (!push.ok) handoff(`git could not push ${review.branch}: ${push.err.split('\n').pop()}`, [{ run: `git push -u origin ${review.branch}` }]);
}

// 6. The open PR from the branch has this commit as its head. GitHub may lag a push by a few seconds.
const pollMs = Number(process.env.PITWALL_POLL_MS ?? 3000);
let pr = null;
for (let i = 0; i < 5; i += 1) {
  const r = gh(['pr', 'view', review.branch, '--json', 'number,state,headRefOid,baseRefName,url']);
  pr = r.ok ? parseJson(r.out) : null;
  if (!pr) handoff(`there is no PR from ${review.branch}.`, [{ run: `gh pr create --base ${base} --head ${review.branch} --fill` }]);
  if (pr.state !== 'OPEN') refuse(`PR #${pr.number} is ${String(pr.state).toLowerCase()}: a status on it decides nothing`);
  if (pr.baseRefName !== base) refuse(`PR #${pr.number} goes into ${pr.baseRefName}, not ${base}`);
  if (pr.headRefOid === sha || dry) break;
  sleep(pollMs);
}
if (pr.headRefOid !== sha && !dry) {
  handoff(`PR #${pr.number} shows head ${String(pr.headRefOid).slice(0, 7)}, and the reviewed commit is ${sha.slice(0, 7)}.`, [{ note: 'push the branch and wait until the PR shows the reviewed commit' }, { run: `git push origin ${review.branch}` }]);
}
log(`PR #${pr.number}, head ${sha.slice(0, 7)}`);

// 7. Write the status, then read it back.
const post = `gh api -X POST repos/${name}/statuses/${sha} -f "state=${state}" -f "context=${context}" -f "description=${description}"`;
if (dry) {
  log(`dry run: would run ${post}`);
  console.log(`RESULT: ${state}${suffix}`);
  process.exit(0);
}
const write = gh(['api', '-X', 'POST', `repos/${name}/statuses/${sha}`, '-f', `state=${state}`, '-f', `context=${context}`, '-f', `description=${description}`]);
if (!write.ok) handoff(`GitHub refused the status: ${write.err.trim()}`, [{ note: 'where gh may write to the repository' }, { run: post }]);
const back = gh(['api', `repos/${name}/commits/${sha}/statuses`]);
// gh prints an error body, a JSON object, on a failed read, so only an array is a list of statuses.
const list = back.ok ? parseJson(back.out) : null;
const latest = Array.isArray(list) ? list.find((s) => s.context === context) : undefined;
if (!back.ok || latest?.state !== state) handoff('the status went through, but reading it back does not show it.', [{ run: `gh api repos/${name}/commits/${sha}/statuses` }]);
log(`${context} is ${state} on ${sha.slice(0, 7)}: ${description}`);
console.log(`RESULT: ${state}`);
