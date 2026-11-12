#!/usr/bin/env node
// Sets the ai-review commit status: the reviewer's verdict (T2-AC5, ADR-0002, ADR-0007).
//
//   node review-status.mjs --review plan|code|release --state success|failure [--description "<text>"] [--project <dir>] [--dry-run]
//
// Only a reviewer runs it: the plan reviewer (--review plan), the code reviewer
// (--review code, T3b-AC4) and the qa agent, for a release only (--review release, T4c-AC5,
// ADR-0013); pitwall's hook lets only those three agents run it, the qa agent only with
// --review release (ADR-0007, T3a-AC4). It commits nothing but the review file, and sets the status on the head of
// the open PR from the review's branch, after it checks that it may (L-5):
//   - the tree is clean but for the review file, on the review's branch: the planning
//     branch for the plan; for code, the branch of the change (epic/E<n>-<slug> or
//     fix/BUG-<n>), whose review file is docs/reviews/<change>.md (ADR-0011); for a release,
//     release/v<x.y.z>, whose review file is docs/reviews/release-v<x.y.z>.md;
//   - success only when the review passes its check (for the plan:
//     docs-check --stage plan-review, and spike when there are spikes; for code:
//     docs-check --stage code-review; for a release: docs-check --stage release and
//     release.mjs --check), and for code and a release only when nothing but the review
//     file changed after the commit the review names as reviewed (owner, ADR-0011);
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
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changeOf, config, ghRunner, gitRunner, parseArgs, parseJson, pluginRoot, printHandoff, requireNode, sleep } from './lib.mjs';

requireNode();
const usage = 'node review-status.mjs --review plan|code|release --state success|failure [--description "<text>"] [--project <dir>] [--dry-run]';
const args = parseArgs(process.argv.slice(2), { review: 'value', state: 'value', description: 'value', project: 'value', 'dry-run': 'switch' }, usage);
const cfg = config();
const project = resolve(args.project ?? '.');
const git = gitRunner(project);
const words = { success: 'approved', failure: 'changes requested' };
const REVIEWS = {
  plan: () => ({
    branch: cfg.planning.branch,
    file: 'docs/PLAN-REVIEW.md',
    stages: ['plan-review', ...(spikes(project) ? ['spike'] : [])],
    subject: (s) => `docs: plan review, ${words[s]}`,
  }),
  // The branch the project is on names the change and its review file (ADR-0011).
  code: () => {
    const c = changeOf(git('branch', '--show-current').out, cfg);
    // A release is the qa agent's to review (ADR-0013).
    if (c?.kind === 'release') refuse(`${c.branch} is a release: the qa agent reviews it, with --review release (pitwall ADR-0013)`);
    return {
      branch: c?.branch ?? Object.values(cfg.loop.branches).map((b) => `${b}<change>`).join(' or '),
      change: c,
      file: c?.review,
      stages: ['code-review'],
      subject: (s) => `docs: code review of ${c?.id}, ${words[s]}`,
    };
  },
  // A release, reviewed by the qa agent (T4c-AC5, ADR-0013).
  release: () => {
    const c = changeOf(git('branch', '--show-current').out, cfg);
    const ok = c?.kind === 'release' && c.id;
    return {
      branch: ok ? c.branch : `${cfg.loop.branches.release}${cfg.release.tagPrefix}<x.y.z>`,
      change: ok ? c : { id: null },
      file: ok ? c.review : null,
      stages: ['release'],
      subject: (s) => `docs: qa of ${c?.id}, ${words[s]}`,
    };
  },
};
if (!Object.hasOwn(REVIEWS, args.review ?? '') || !['success', 'failure'].includes(args.state)) {
  console.error(`review-status: --review must be ${Object.keys(REVIEWS).join(' or ')} and --state success or failure\nusage: ${usage}`);
  process.exit(2);
}
const review = REVIEWS[args.review]();
const dry = Boolean(args['dry-run']);
const state = args.state;
const context = cfg.review.statusContext;
const base = cfg.mergeProtection.branch;
// A description goes into a handed-over command too, so it keeps to characters both shells take as they are.
const description = (args.description ?? `${args.review} review: ${words[state]}`).replace(/["`$\\]/g, "'").slice(0, 140);
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
if (args.review === 'release' && !review.change.id) refuse(`the branch ${branch} is no release: ${cfg.loop.branches.release}${cfg.release.tagPrefix}<x.y.z>`);
if (args.review === 'code' && !review.change.id) refuse(`the branch ${branch} names no change: epic/E<n>-<slug>, named as the epic's file in docs/epics/, or fix/BUG-<n>`);
// Porcelain lines are "XY path", and the first may start with a space, so the output is not trimmed.
const changed = git('-c', 'core.quotePath=false', 'status', '--porcelain', '--untracked-files=all').raw.split('\n').filter(Boolean).map((l) => l.slice(3));
const others = changed.filter((p) => p !== review.file);
if (others.length > 0) refuse(`the tree has changes besides ${review.file}; the main conversation commits its fixes before a review round`, others.slice(0, 20).join('\n'));
// The check reads the files on disk, so an ignored file it would read, and the commit would not hold, is refused too.
// Only what docs-check reads counts: Markdown under docs/, CLAUDE.md and .claude/pitwall.json, not the OS files the template ignores.
const ignored = git('-c', 'core.quotePath=false', 'status', '--porcelain', '--ignored', '--untracked-files=all', '--', 'docs', 'CLAUDE.md', '.claude/pitwall.json')
  .raw.split('\n')
  .filter((l) => l.startsWith('!! '))
  .map((l) => l.slice(3))
  .filter((p) => p.endsWith('.md') || p === '.claude/pitwall.json');
if (ignored.length > 0) refuse('files the docs check reads are ignored by git, so the reviewed commit would not hold them', ignored.slice(0, 20).join('\n'));

// 2. success only when the review passes its check, on the tree as it is.
if (state === 'success') {
  const stages = review.stages.join(',');
  const check = spawnSync(process.execPath, [join(pluginRoot, 'scripts', 'docs-check.mjs'), '--root', project, '--stage', stages], { encoding: 'utf8' });
  if (check.status !== 0) refuse(`the review does not pass docs-check --stage ${stages}: close what it reports, or set failure`, `${check.stdout}${check.stderr}`.trim());
  log(`docs-check --stage ${stages} passes`);
  // The check reads this too, but the rule is this script's own (owner, ADR-0011): success belongs to the
  // reviewed code, so after the commit the review names, nothing but the review file may have changed.
  // A release passes its own check too: the changelog, the records and no blocking bug open (ADR-0013).
  if (args.review === 'release') {
    const rel = spawnSync(process.execPath, [join(pluginRoot, 'scripts', 'release.mjs'), '--check', '--project', project], { encoding: 'utf8' });
    if (rel.status !== 0) refuse('the release does not pass release.mjs --check: the release is red, so set failure', `${rel.stdout}${rel.stderr}`.trim());
    log('release.mjs --check passes');
  }
  if (args.review !== 'plan') {
    // Read as the docs check reads the field: any list marker, emphasis or a code span around the sha.
    const reviewed = /^[-*+] Reviewed: *[*_`]*([0-9a-f]{40})[*_`]*[ \t]*$/m.exec(readFileSync(join(project, review.file), 'utf8'))?.[1];
    const after = reviewed ? git('-c', 'core.quotePath=false', 'diff', '--name-only', reviewed, 'HEAD') : null;
    if (!after?.ok) refuse(`${review.file} names no reviewed commit that git can read`);
    const moved = after.out.split('\n').filter((f) => f && f !== review.file);
    if (moved.length > 0) refuse(`files changed after the reviewed commit ${reviewed.slice(0, 7)}: a new round reviews the head`, moved.slice(0, 20).join('\n'));
  }
}

// 3. The review file is committed, so the status belongs to the commit that holds the verdict.
if (changed.includes(review.file)) {
  if (dry) log(`dry run: would commit ${review.file}`);
  else {
    const add = git('add', '--', review.file);
    const commit = add.ok && git('commit', '-m', review.subject(state), '--', review.file);
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
    // Spike branches go too, while the plan is reviewed: the spike check wants them on the remote once there is one (pitwall ADR-0009).
    const spikeBranches = args.review === 'plan' ? git('for-each-ref', '--format=%(refname:short)', 'refs/heads/spike/').out.split('\n').filter(Boolean) : [];
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
