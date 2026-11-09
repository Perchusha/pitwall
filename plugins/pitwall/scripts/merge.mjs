#!/usr/bin/env node
// Merges the plan PR once the owner said yes (T2-AC5, ADR-0005, ADR-0008).
//
//   node merge.mjs --plan --owner-approved [--project <dir>] [--wait <seconds>] [--dry-run]
//
// --owner-approved is the plan skill's word that the owner said yes to the plan; the
// script cannot hear the owner, so without it nothing happens. Before it merges, it
// checks that it may (L-5): gh is installed and signed in, the account may write, the
// PR from the planning branch is open into main with the local branch's commit as its
// head, ai-review is success and gate is success from GitHub Actions on that commit
// (it waits up to --wait seconds, plan.gateWaitSeconds in the config, for a gate that
// is running or not started yet), the repository allows merge
// commits, and neither a ruleset nor the branch protection requires linear history.
// It merges with a merge commit whose message records the approval:
//   Plan approved by the owner, <date>, at <sha>
// A failed precondition prints a HANDOFF block with the commands for the owner, each
// on its own line, the same in bash and PowerShell (L-6). --dry-run reads, and merges
// nothing. T3b extends it to epics by risk class (T3b-AC5).
//
// The last line is "RESULT: merged" or "RESULT: pending". Exit 0 merged (or already
// merged), 1 refused (a check is red or the head moved: nothing to hand over), 2 usage,
// 3 handed over. PITWALL_GH runs another gh binary (the checks use a fake one).

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, ghRunner, gitRunner, parseArgs, parseJson, printHandoff, requireNode, sleep } from './lib.mjs';

requireNode();
const usage = 'node merge.mjs --plan --owner-approved [--project <dir>] [--wait <seconds>] [--dry-run]';
const args = parseArgs(process.argv.slice(2), { plan: 'switch', 'owner-approved': 'switch', project: 'value', wait: 'value', 'dry-run': 'switch' }, usage);
const bad = (msg) => {
  console.error(`merge: ${msg}\nusage: ${usage}`);
  process.exit(2);
};
if (!args.plan) bad('--plan is required: the plan PR is the only one this script merges until T3b');
if (!args['owner-approved']) bad('--owner-approved is required: the plan merges only after the owner says yes (pitwall ADR-0008)');
const cfg = config();
// Short enough that the whole run fits in one tool call; a gate still running is handed back, and the skill runs this again.
const wait = Number(args.wait ?? cfg.plan.gateWaitSeconds);
if (!(wait >= 0)) bad('--wait takes a number of seconds');
const project = resolve(args.project ?? '.');
const dry = Boolean(args['dry-run']);
const branch = cfg.planning.branch;
const base = cfg.mergeProtection.branch;
const git = gitRunner(project);
const gh = ghRunner(project, 'merge');
const rerun = `node "${fileURLToPath(import.meta.url)}" --plan --owner-approved --project "${project}"`;
const log = (msg) => console.log(`merge: ${msg}`);
const suffix = dry ? ' (dry run, nothing written)' : '';

function refuse(msg) {
  console.log(`merge: REFUSED - ${msg}`);
  console.log('RESULT: not merged');
  process.exit(1);
}
function handoff(reason, steps) {
  printHandoff(reason, steps, rerun);
  console.log(`RESULT: pending${suffix}`);
  process.exit(3);
}
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 1. The local planning branch: the commit the owner approved.
const local = git('rev-parse', '--verify', '-q', `refs/heads/${branch}^{commit}`);
if (!local.ok) refuse(`there is no local branch ${branch} in ${project}`);
const sha = local.out;

// 2. May we? gh, a signed-in account, a repository we may write to.
if (!gh(['--version']).ok) handoff('the GitHub CLI is not installed or does not run.', [{ note: 'install it from https://cli.github.com' }, { run: 'gh auth login' }]);
if (!gh(['auth', 'status', '--hostname', 'github.com']).ok) handoff('gh is not signed in to github.com.', [{ run: 'gh auth login' }]);
const view = gh(['repo', 'view', '--json', 'nameWithOwner,viewerPermission,mergeCommitAllowed']);
const repo = view.ok ? parseJson(view.out) : null;
if (!repo?.nameWithOwner) {
  handoff(`gh could not read the repository: ${view.err.trim() || view.out.trim()}`, [{ note: 'the plan merges through a PR on GitHub: create the repository, push and open the PR, review it, then' }, { run: 'gh repo view' }]);
}
const name = repo.nameWithOwner;
if (!['ADMIN', 'MAINTAIN', 'WRITE'].includes(repo.viewerPermission)) {
  handoff(`merging into ${name} needs write access, and this account is ${repo.viewerPermission}.`, [{ note: 'someone with write access runs the command below' }]);
}

// 3. The PR: open, into main, with the approved commit as its head.
const prView = gh(['pr', 'view', branch, '--json', 'number,state,headRefOid,baseRefName,mergeCommit']);
const pr = prView.ok ? parseJson(prView.out) : null;
if (!pr) handoff(`there is no PR from ${branch}.`, [{ run: `git push -u origin ${branch}` }, { run: `gh pr create --base ${base} --head ${branch} --fill` }]);
if (pr.state === 'MERGED') {
  // A PR merged at another commit leaves the local commits after it unmerged and unreviewed.
  if (pr.headRefOid !== sha) refuse(`PR #${pr.number} was merged at ${String(pr.headRefOid).slice(0, 7)}, and the local ${branch} is at ${sha.slice(0, 7)}: the commits after it need a PR and a review of their own`);
  log(`PR #${pr.number} is already merged${pr.mergeCommit?.oid ? ` as ${pr.mergeCommit.oid}` : ''}`);
  // A merge by hand looks the same from here, so say whether the message records the owner's approval.
  const message = pr.mergeCommit?.oid ? parseJson(gh(['api', `repos/${name}/commits/${pr.mergeCommit.oid}`]).out)?.commit?.message ?? '' : '';
  log(message.includes('Plan approved by the owner') ? 'its merge commit records the approval of the owner' : 'its merge commit does not record the approval of the owner: it was merged another way');
  console.log('RESULT: merged');
  process.exit(0);
}
if (pr.state !== 'OPEN') refuse(`PR #${pr.number} is ${String(pr.state).toLowerCase()}`);
if (pr.baseRefName !== base) refuse(`PR #${pr.number} goes into ${pr.baseRefName}, not ${base}`);
if (pr.headRefOid !== sha) refuse(`PR #${pr.number} has head ${String(pr.headRefOid).slice(0, 7)}, and the local ${branch} is ${sha.slice(0, 7)}: the owner approved what is here, so push it and review it again`);

// 4. Both checks are green on that commit: ai-review from the review flow, gate from GitHub Actions only (ADR-0005).
// gh prints an error body, a JSON object, on a failed read: a read that fails is handed back, never read as "not set".
const readFailed = (what, r) => handoff(`gh could not read the ${what} of ${sha.slice(0, 7)}: ${(r.err.trim() || r.out.trim()).split('\n').pop()}`, [{ note: 'when GitHub answers again (a rate limit passes, the network is back), then' }, { run: 'gh auth status' }]);
const statusRead = gh(['api', `repos/${name}/commits/${sha}/statuses`]);
const statuses = statusRead.ok ? parseJson(statusRead.out) : null;
if (!Array.isArray(statuses)) readFailed('statuses', statusRead);
const review = statuses.find((s) => s.context === cfg.review.statusContext);
if (review?.state !== 'success') refuse(`${cfg.review.statusContext} is ${review?.state ?? 'not set'} on ${sha.slice(0, 7)}: the plan reviewer sets it (pitwall ADR-0007)`);
const pollMs = Number(process.env.PITWALL_POLL_MS ?? 15000);
const deadline = Date.now() + wait * 1000;
let gate;
for (;;) {
  const runRead = gh(['api', `repos/${name}/commits/${sha}/check-runs`]);
  const runs = runRead.ok ? parseJson(runRead.out)?.check_runs : null;
  if (!Array.isArray(runs)) readFailed('check runs', runRead);
  const named = runs.filter((c) => c.name === cfg.review.gateContext);
  // The latest run from GitHub Actions decides: a re-run replaces the run before it.
  gate = named.filter((c) => c.app?.id === cfg.mergeProtection.githubActionsAppId).sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0];
  // A gate from anything but GitHub Actions never passes (ADR-0005), so there is nothing to wait for.
  if (!gate && named.length > 0) refuse(`the ${cfg.review.gateContext} check on ${sha.slice(0, 7)} comes from app ${named[0].app?.id ?? 'unknown'}, not GitHub Actions`);
  if (gate?.status === 'completed' || Date.now() >= deadline) break;
  sleep(Math.max(0, Math.min(pollMs, deadline - Date.now())));
}
if (!gate) handoff(`no ${cfg.review.gateContext} check from GitHub Actions on ${sha.slice(0, 7)} after ${wait} seconds.`, [{ note: 'CI may not have started: look at the Actions tab of the repository, then' }, { run: `gh pr checks ${pr.number}` }]);
if (gate.status !== 'completed') handoff(`${cfg.review.gateContext} is still ${gate.status} on ${sha.slice(0, 7)} after ${wait} seconds.`, [{ note: 'wait for it to finish, then' }, { run: `gh pr checks ${pr.number}` }]);
if (gate.conclusion !== 'success') refuse(`${cfg.review.gateContext} is ${gate.conclusion} on ${sha.slice(0, 7)}`);
log(`${cfg.review.statusContext} and ${cfg.review.gateContext} are green on ${sha.slice(0, 7)}`);

// 5. A merge commit is possible: allowed by the repository, and no linear history required (ADR-0008).
if (repo.mergeCommitAllowed === false) {
  handoff(`${name} does not allow merge commits, and the plan merges with one (pitwall ADR-0008).`, [{ run: `gh repo edit ${name} --enable-merge-commit` }]);
}
const rules = gh(['api', `repos/${name}/rules/branches/${base}`]);
const lastLine = (text) => text.trim().split('\n').pop();
if (!rules.ok) log(`could not read the rules on ${base} (${lastLine(rules.err)}); GitHub will refuse the merge if one requires linear history`);
if (rules.ok && (parseJson(rules.out) ?? []).some((r) => r.type === 'required_linear_history')) {
  handoff(`a ruleset on ${name} requires linear history on ${base}, which refuses a merge commit (pitwall ADR-0008).`, [{ note: `remove that rule in the repository settings (Rules, Rulesets), or merge PR #${pr.number} by hand, then` }, { run: `gh api repos/${name}/rules/branches/${base}` }]);
}
const protection = gh(['api', `repos/${name}/branches/${base}/protection`]);
if (!protection.ok && !/HTTP 404/.test(protection.err)) log(`could not read the branch protection of ${base} (${lastLine(protection.err)}); GitHub will refuse the merge if it requires linear history`);
if (protection.ok && parseJson(protection.out)?.required_linear_history?.enabled === true) {
  handoff(`the branch protection of ${base} requires linear history, which refuses a merge commit (pitwall ADR-0008).`, [{ note: `turn off "Require linear history" for ${base} in the repository settings (Branches), then` }, { run: `gh api repos/${name}/branches/${base}/protection` }]);
}

// 6. Merge, with the approval in the message, only if the head is still the approved commit.
const approval = `Plan approved by the owner, ${today()}, at ${sha}`;
const subject = `Merge the plan from ${branch} (#${pr.number})`;
const mergeArgs = ['pr', 'merge', String(pr.number), '--merge', '--match-head-commit', sha, '--subject', subject, '--body', approval];
const command = `gh pr merge ${pr.number} --merge --match-head-commit ${sha} --subject "${subject}" --body "${approval}"`;
if (dry) {
  log(`dry run: would run ${command}`);
  console.log(`RESULT: merged${suffix}`);
  process.exit(0);
}
const merged = gh(mergeArgs);
if (!merged.ok) handoff(`GitHub refused the merge: ${merged.err.trim()}`, [{ run: command }]);
const after = parseJson(gh(['pr', 'view', String(pr.number), '--json', 'state,mergeCommit']).out);
if (after?.state !== 'MERGED') handoff(`the merge went through, but PR #${pr.number} reads ${after?.state ?? 'nothing'}.`, [{ run: `gh pr view ${pr.number}` }]);
log(`PR #${pr.number} merged as ${after.mergeCommit?.oid ?? 'a merge commit'}`);
log(approval);
console.log('RESULT: merged');
