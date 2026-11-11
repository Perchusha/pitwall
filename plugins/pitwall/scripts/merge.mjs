#!/usr/bin/env node
// Merges a PR of a pitwall project once it may: the plan after the owner's yes (T2-AC5,
// ADR-0008), and an epic or a bug fix by its risk class (T3b-AC5, ADR-0010).
//
//   node merge.mjs --plan --owner-approved [--project <dir>] [--wait <seconds>] [--dry-run]
//   node merge.mjs --change [--owner-approved] [--project <dir>] [--wait <seconds>] [--dry-run]
//
// --owner-approved is the skill's word that the owner said yes to this merge in the
// conversation; the script cannot hear the owner. The plan merges only with it. A change,
// the PR from the branch the project is on (epic/E<n>-<slug> or fix/BUG-<n>), merges with
// it at any risk class; without it only an epic whose risk class merges by itself
// (riskClasses.<class>.merge "auto": low and normal) in a project whose owner allowed that
// (autoMerge in .claude/pitwall.json, ADR-0010). Anything else waits for the owner (exit 4):
// high risk, a bug fix at any class (merges without the owner cover epics only: ADR-0010, T4b),
// an owner who said no or was not asked yet. pitwall's allow rule names "merge.mjs --change" exactly, with no wildcard, so
// --owner-approved never runs under it (ADR-0010).
//
// Before it merges, it checks that it may (L-5): gh is installed and signed in, the account
// may write, the PR from the branch is open into main with the local branch's commit as its
// head, ai-review is success and gate is success from GitHub Actions on that commit (it
// waits up to --wait seconds, plan.gateWaitSeconds in the config, for a gate that is running
// or not started yet), the repository allows merge commits, and neither a ruleset nor the
// branch protection requires linear history. It merges with a merge commit, never squashed,
// so the reviewed commit stays in the history of main (ADR-0008), whose message records
// who approved it:
//   the plan:   "Plan approved by the owner, <date>, at <sha>"
//   an epic:    "feat(E<n>): <title> (#<pr>)", the risk class and who approved it in the body
//   a bug fix:  "fix(BUG-<n>): <title> (#<pr>)", the same body
// A failed precondition prints a HANDOFF block with the commands for the owner, each on its
// own line, the same in bash and PowerShell (L-6). --dry-run reads, and merges nothing.
//
// The last line is "RESULT: merged", "RESULT: pending" or "RESULT: waits for the owner".
// Exit 0 merged (or already merged), 1 refused (a check is red or the head moved: nothing to
// hand over), 2 usage, 3 handed over, 4 waits for the owner's yes. PITWALL_GH runs another gh
// binary (the checks use a fake one).

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changeOf, config, ghRunner, gitRunner, parseArgs, parseJson, printHandoff, readGate, readReview, requireNode, riskClassAt, sleep } from './lib.mjs';

requireNode();
const usage = 'node merge.mjs --plan --owner-approved | --change [--owner-approved] [--project <dir>] [--wait <seconds>] [--dry-run]';
const args = parseArgs(process.argv.slice(2), { plan: 'switch', change: 'switch', 'owner-approved': 'switch', project: 'value', wait: 'value', 'dry-run': 'switch' }, usage);
const bad = (msg) => {
  console.error(`merge: ${msg}\nusage: ${usage}`);
  process.exit(2);
};
if (args.plan && args.change) bad('--plan and --change name different PRs: give one');
if (!args.plan && !args.change) bad('--plan is required for the plan PR, or --change for the PR of the change on this branch');
const approved = Boolean(args['owner-approved']);
if (args.plan && !approved) bad('--owner-approved is required: the plan merges only after the owner says yes (pitwall ADR-0008)');
const cfg = config();
// Short enough that the whole run fits in one tool call; a gate still running is handed back, and the skill runs this again.
const wait = Number(args.wait ?? cfg.plan.gateWaitSeconds);
if (!(wait >= 0)) bad('--wait takes a number of seconds');
const project = resolve(args.project ?? '.');
const dry = Boolean(args['dry-run']);
const base = cfg.mergeProtection.branch;
const git = gitRunner(project);
const gh = ghRunner(project, 'merge');
const rerun = `node "${fileURLToPath(import.meta.url)}" ${args.plan ? '--plan' : '--change'}${approved ? ' --owner-approved' : ''} --project "${project}"`;
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
function owners(msg) {
  console.log(`merge: ${msg}`);
  console.log('RESULT: waits for the owner');
  process.exit(4);
}
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 1. The branch and the commit the owner, or the risk class, approves.
let branch = cfg.planning.branch;
let change = null;
if (args.change) {
  branch = git('branch', '--show-current').out;
  change = changeOf(branch, cfg);
  if (!change?.id) refuse(`on branch "${branch || 'none'}": --change merges the PR of the change on this branch, epic/E<n>-<slug> or fix/BUG-<n>`);
}
const local = git('rev-parse', '--verify', '-q', `refs/heads/${branch}^{commit}`);
if (!local.ok) refuse(`there is no local branch ${branch} in ${project}`);
const sha = local.out;

// 2. A change: who may merge it. The class is read from the commit that merges, the one the reviewer saw,
// and from the plan where the branch left main: the higher of the two counts, so a class raised on the
// branch (the owner said so at the clarification) holds, and one lowered there does not.
let riskClass = null;
let title = '';
if (change?.epic) {
  riskClass = riskClassAt(git, change.epic, sha, base, cfg);
  if (!riskClass) refuse(`docs/EPICS.md at ${sha.slice(0, 7)} gives ${change.epic} no risk class of ${Object.keys(cfg.riskClasses).filter((k) => typeof cfg.riskClasses[k] === 'object').join(', ')}`);
  const file = git('show', `${sha}:docs/epics/${change.id}.md`);
  title = (file.ok ? new RegExp(`^# ${change.epic} - (.+)$`, 'm').exec(file.out)?.[1] : '')?.trim() ?? '';
}
if (change && !approved) {
  let settings = null;
  try {
    settings = JSON.parse(readFileSync(join(project, '.claude', 'pitwall.json'), 'utf8').replace(new RegExp(`^${String.fromCodePoint(0xfeff)}`), ''));
  } catch {}
  const choice = settings?.[cfg.loop.ownerChoice];
  if (!change.epic) owners(`${change.bug} is a bug fix: every fix merges after the owner's yes, at any risk class (pitwall ADR-0010)`);
  if (cfg.riskClasses[riskClass].merge !== 'auto') owners(`${change.epic} is ${riskClass} risk: it merges only after the owner's yes (SPEC 6)`);
  if (choice !== true) {
    owners(choice === false
      ? `the owner chose that every merge waits for them (${cfg.loop.ownerChoice} is false in .claude/pitwall.json, ADR-0010)`
      : `the owner has not chosen yet whether low and normal risk merge without them (no ${cfg.loop.ownerChoice} in .claude/pitwall.json, ADR-0010): ask them`);
  }
  log(`${change.epic} is ${riskClass} risk, and the owner allowed low and normal risk to merge without them (ADR-0010)`);
}

// 3. May we? gh, a signed-in account, a repository we may write to.
if (!gh(['--version']).ok) handoff('the GitHub CLI is not installed or does not run.', [{ note: 'install it from https://cli.github.com' }, { run: 'gh auth login' }]);
if (!gh(['auth', 'status', '--hostname', 'github.com']).ok) handoff('gh is not signed in to github.com.', [{ run: 'gh auth login' }]);
const view = gh(['repo', 'view', '--json', 'nameWithOwner,viewerPermission,mergeCommitAllowed']);
const repo = view.ok ? parseJson(view.out) : null;
if (!repo?.nameWithOwner) {
  handoff(`gh could not read the repository: ${view.err.trim() || view.out.trim()}`, [{ note: `the ${args.plan ? 'plan' : 'change'} merges through a PR on GitHub: create the repository, push and open the PR, review it, then` }, { run: 'gh repo view' }]);
}
const name = repo.nameWithOwner;
if (!['ADMIN', 'MAINTAIN', 'WRITE'].includes(repo.viewerPermission)) {
  handoff(`merging into ${name} needs write access, and this account is ${repo.viewerPermission}.`, [{ note: 'someone with write access runs the command below' }]);
}

// 4. The PR: open, into main, with the approved commit as its head.
const prView = gh(['pr', 'view', branch, '--json', 'number,state,headRefOid,baseRefName,mergeCommit,title']);
const pr = prView.ok ? parseJson(prView.out) : null;
if (!pr) handoff(`there is no PR from ${branch}.`, [{ run: `git push -u origin ${branch}` }, { run: `gh pr create --base ${base} --head ${branch} --fill` }]);
const record = args.plan ? 'Plan approved by the owner' : /Approved by the owner|Merged without the owner/;
if (pr.state === 'MERGED') {
  // A PR merged at another commit leaves the local commits after it unmerged and unreviewed.
  if (pr.headRefOid !== sha) refuse(`PR #${pr.number} was merged at ${String(pr.headRefOid).slice(0, 7)}, and the local ${branch} is at ${sha.slice(0, 7)}: the commits after it need a PR and a review of their own`);
  log(`PR #${pr.number} is already merged${pr.mergeCommit?.oid ? ` as ${pr.mergeCommit.oid}` : ''}`);
  // A merge by hand looks the same from here, so say whether the message records who approved it.
  const message = pr.mergeCommit?.oid ? parseJson(gh(['api', `repos/${name}/commits/${pr.mergeCommit.oid}`]).out)?.commit?.message ?? '' : '';
  const recorded = typeof record === 'string' ? message.includes(record) : record.test(message);
  log(recorded ? `its merge commit records the approval${args.plan ? ' of the owner' : ''}` : `its merge commit does not record the approval${args.plan ? ' of the owner' : ''}: it was merged another way`);
  console.log('RESULT: merged');
  process.exit(0);
}
if (pr.state !== 'OPEN') refuse(`PR #${pr.number} is ${String(pr.state).toLowerCase()}`);
if (pr.baseRefName !== base) refuse(`PR #${pr.number} goes into ${pr.baseRefName}, not ${base}`);
if (pr.headRefOid !== sha) refuse(`PR #${pr.number} has head ${String(pr.headRefOid).slice(0, 7)}, and the local ${branch} is ${sha.slice(0, 7)}: ${args.plan ? 'the owner approved what is here' : 'what is here is what merges'}, so push it and review it again`);

// 5. Both checks are green on that commit: ai-review from the review flow, gate from GitHub Actions only (ADR-0005).
// gh prints an error body, a JSON object, on a failed read: a read that fails is handed back, never read as "not set".
const readFailed = (what, r) => handoff(`gh could not read the ${what} of ${sha.slice(0, 7)}: ${(r.err.trim() || r.out.trim()).split('\n').pop()}`, [{ note: 'when GitHub answers again (a rate limit passes, the network is back), then' }, { run: 'gh auth status' }]);
const reviewRead = readReview(gh, name, sha, cfg);
if (reviewRead.failed) readFailed(reviewRead.failed, reviewRead.read);
const review = reviewRead.review;
if (review?.state !== 'success') refuse(`${cfg.review.statusContext} is ${review?.state ?? 'not set'} on ${sha.slice(0, 7)}: the ${args.plan ? 'plan' : 'code'} reviewer sets it (pitwall ADR-0007)`);
const pollMs = Number(process.env.PITWALL_POLL_MS ?? 15000);
const deadline = Date.now() + wait * 1000;
let gate;
for (;;) {
  const gateRead = readGate(gh, name, sha, cfg);
  if (gateRead.failed) readFailed(gateRead.failed, gateRead.read);
  gate = gateRead.gate;
  // A gate from anything but GitHub Actions never passes (ADR-0005), so there is nothing to wait for.
  if (gateRead.foreign) refuse(`the ${cfg.review.gateContext} check on ${sha.slice(0, 7)} comes from app ${gateRead.foreign.app?.id ?? 'unknown'}, not GitHub Actions`);
  if (gate?.status === 'completed' || Date.now() >= deadline) break;
  sleep(Math.max(0, Math.min(pollMs, deadline - Date.now())));
}
if (!gate) handoff(`no ${cfg.review.gateContext} check from GitHub Actions on ${sha.slice(0, 7)} after ${wait} seconds.`, [{ note: 'CI may not have started: look at the Actions tab of the repository, then' }, { run: `gh pr checks ${pr.number}` }]);
if (gate.status !== 'completed') handoff(`${cfg.review.gateContext} is still ${gate.status} on ${sha.slice(0, 7)} after ${wait} seconds.`, [{ note: 'wait for it to finish, then' }, { run: `gh pr checks ${pr.number}` }]);
if (gate.conclusion !== 'success') refuse(`${cfg.review.gateContext} is ${gate.conclusion} on ${sha.slice(0, 7)}`);
log(`${cfg.review.statusContext} and ${cfg.review.gateContext} are green on ${sha.slice(0, 7)}`);

// 6. A merge commit is possible: allowed by the repository, and no linear history required (ADR-0008).
if (repo.mergeCommitAllowed === false) {
  handoff(`${name} does not allow merge commits, and pitwall merges with one (pitwall ADR-0008).`, [{ run: `gh repo edit ${name} --enable-merge-commit` }]);
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

// 7. Merge, with who approved it in the message, only if the head is still the approved commit.
// The words reach a handed-over command too, so they keep to characters both shells take as they are (L-6).
const plainWords = (text) => String(text ?? '').replace(/["`$\\]/g, "'").replace(/\s+/g, ' ').trim();
let subject;
let body;
if (args.plan) {
  subject = `Merge the plan from ${branch} (#${pr.number})`;
  body = `Plan approved by the owner, ${today()}, at ${sha}`;
} else {
  // A fix takes its title from the PR, without a leading BUG-n or conventional prefix.
  const prTitle = plainWords(pr.title).replace(/^(?:fix|feat)\([^)]*\):\s*/i, '').replace(new RegExp(`^${change.bug ?? change.epic}\\b\\s*[-:]?\\s*`), '');
  subject = `${change.epic ? 'feat' : 'fix'}(${change.epic ?? change.bug}): ${plainWords(title) || prTitle || change.id} (#${pr.number})`;
  const who = approved ? `Approved by the owner, ${today()}, at ${sha}.` : `Merged without the owner, who allowed low and normal risk to merge once ${cfg.review.gateContext} and ${cfg.review.statusContext} are green (pitwall ADR-0010), at ${sha}.`;
  body = `${change.epic ? `Risk class: ${riskClass}.` : 'A bug fix, approved by the owner as every fix is (pitwall ADR-0010).'} ${who}`;
}
const mergeArgs = ['pr', 'merge', String(pr.number), '--merge', '--match-head-commit', sha, '--subject', subject, '--body', body];
const command = `gh pr merge ${pr.number} --merge --match-head-commit ${sha} --subject "${subject}" --body "${body}"`;
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
log(args.plan ? body : `${subject}: ${body}`);
console.log('RESULT: merged');
