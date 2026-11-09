#!/usr/bin/env node
// Merge protection for a project's main branch (T1-AC2, ADR-0002, ADR-0005).
//
//   node protect.mjs [--project <dir>] [--repo <owner/name>] [--dry-run]
//
// No flag sets the mode it records: that comes only from what GitHub answers for the
// project's own repository, and --repo names one of the project's remotes or is refused.
//
// First it checks that it may (L-5): gh is installed and signed in, there is a
// repository, the branch is on GitHub, and the account is admin. The branch's
// protection summary, which any reader can see, shows when the job is already
// done. For an admin, a read-only probe of the protection API picks the mode:
//   available (public, or private on a paid plan: the probe reads protection or
//     answers 404) -> branch protection that requires gate (GitHub Actions) and
//     ai-review, admins included, linear history not required (ADR-0008);
//   403 "Upgrade to GitHub Pro" (private on GitHub Free) -> local-hook: recorded,
//     the hook itself ships with the epic loop.
// Only the probe and a public visibility tell that branch protection is available;
// a branch summary that shows protection does not (T2-AC6).
// A failed precondition or a refused write prints a HANDOFF block: each command
// for the owner stands on its own line under a plain label, the same in bash and
// PowerShell (L-6). It records "pending", but keeps a recorded mode this run could
// not check: a recorded branch-protection goes once the branch's protection is read
// and falls short, a recorded local-hook once the repository reads public or the
// probe shows branch protection is available.
// --dry-run makes the same reads, prints the writes and writes nothing, not
// even .claude/pitwall.json.
//
// The last line is "RESULT: <mode>". Exit 0 protected or local-hook, 3 handed
// to the owner, 2 usage. Set PITWALL_GH to a JSON array to run another gh
// binary (the checks use a fake one).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, ghRunner, parseArgs, parseJson as parse, printHandoff, requireNode, writeJson } from './lib.mjs';

requireNode();
const args = parseArgs(process.argv.slice(2), { project: 'value', repo: 'value', 'dry-run': 'switch' }, 'node protect.mjs [--project <dir>] [--repo <owner/name>] [--dry-run]');
const project = resolve(args.project ?? '.');
const dry = Boolean(args['dry-run']);
const cfg = config();
const mp = cfg.mergeProtection;
const branch = mp.branch;
const gateContext = cfg.review.gateContext;
const reviewContext = cfg.review.statusContext;
const settingsFile = join(project, '.claude', 'pitwall.json');
const rerun = `node "${fileURLToPath(import.meta.url)}" --project "${project}"${args.repo ? ` --repo ${args.repo}` : ''}`;
// No flag sets the mode: it comes from what GitHub answers for the project's own repository. --repo only
// picks among the project's remotes (a fork with an upstream), so it cannot point the probe elsewhere.
if (args.repo) {
  const remotes = spawnSync('git', ['-C', project, 'remote', '-v'], { encoding: 'utf8' }).stdout ?? '';
  const own = new RegExp(`github\\.com[:/]${args.repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.git)?(\\s|$)`, 'im');
  if (!own.test(remotes)) {
    console.error(`protect: --repo ${args.repo} is not a remote of ${project}: the mode records the project's own repository (git remote -v lists them)`);
    process.exit(2);
  }
}

const gh = ghRunner(project, 'protect');
const log = (msg) => console.log(`protect: ${msg}`);

function body() {
  return {
    required_status_checks: {
      strict: mp.strict,
      checks: [
        { context: gateContext, app_id: mp.githubActionsAppId },
        { context: reviewContext, app_id: -1 },
      ],
    },
    enforce_admins: mp.enforceAdmins,
    required_pull_request_reviews: null,
    restrictions: null,
    // The plan PR merges with a merge commit (ADR-0008), which linear history would refuse.
    required_linear_history: false,
  };
}

// The same write as one command for the owner. Typed -F fields, no stdin: piped
// text gains a byte order mark in Windows PowerShell and GitHub rejects the JSON (L-6).
function putCommand(repo) {
  const b = body();
  const fields = [
    `required_status_checks[strict]=${b.required_status_checks.strict}`,
    ...b.required_status_checks.checks.flatMap((c) => [`required_status_checks[checks][][context]=${c.context}`, `required_status_checks[checks][][app_id]=${c.app_id}`]),
    `enforce_admins=${b.enforce_admins}`,
    'required_pull_request_reviews=null',
    'restrictions=null',
    `required_linear_history=${b.required_linear_history}`,
  ];
  return `gh api -X PUT repos/${repo}/branches/${branch}/protection ${fields.map((f) => `-F "${f}"`).join(' ')}`;
}

// What this run has learned, for record(): the branch's protection was read and falls short
// (a recorded branch-protection no longer holds), or branch protection is available (a
// recorded local-hook no longer holds). Available means public, or a probe that reads
// protection or answers 404: a protected branch summary alone proves nothing, since a
// repository can keep its protection after a downgrade to GitHub Free.
const known = { branchRead: false, available: false };

function record(mode) {
  if (!existsSync(settingsFile)) return log(`no .claude/pitwall.json in ${project}: mode ${mode} not recorded`);
  const settings = parse(readFileSync(settingsFile, 'utf8'));
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return log(`.claude/pitwall.json is not a JSON object: mode ${mode} not recorded`);
  const was = settings.mergeProtection;
  const stale = (was === 'branch-protection' && known.branchRead) || (was === 'local-hook' && known.available);
  if (mode === 'pending' && mp.modes.includes(was) && was !== 'pending' && !stale) {
    return log(`${dry ? 'dry run: would keep' : 'kept'} the recorded mode "${was}"; this run could not check it`);
  }
  if (was === mode) return;
  if (dry) return log(`dry run: .claude/pitwall.json not changed (would record ${mode})`);
  writeJson(settingsFile, { ...settings, mergeProtection: mode });
  log(`recorded mergeProtection "${mode}" in .claude/pitwall.json`);
}

function done(mode) {
  record(mode);
  console.log(`RESULT: ${mode}${dry ? ' (dry run, nothing written)' : ''}`);
  process.exit(0);
}

// steps: { run } is a ready command, { note } is plain text for the owner.
function handoff(reason, steps) {
  record('pending');
  printHandoff(reason, steps, rerun);
  console.log(`RESULT: pending${dry ? ' (dry run, nothing written)' : ''}`);
  process.exit(3);
}

// Is a protection, in the full form (admins) or the summary every reader sees, what pitwall needs?
function satisfies(p) {
  const checks = p?.required_status_checks?.checks ?? [];
  const gate = checks.find((c) => c.context === gateContext);
  const review = checks.find((c) => c.context === reviewContext);
  const admins = p?.enforce_admins ? p.enforce_admins.enabled === true : p?.required_status_checks?.enforcement_level === 'everyone';
  // Only the full form shows linear history; required, it would refuse the plan's merge commit (ADR-0008).
  const linear = p?.required_linear_history?.enabled === true;
  return Boolean(gate && gate.app_id === mp.githubActionsAppId && review && (review.app_id == null || review.app_id === -1) && admins && !linear);
}

// 1. May we? gh, a signed-in account, a repository, the branch on GitHub, admin rights.
if (!gh(['--version']).ok) {
  handoff('the GitHub CLI is not installed or does not run.', [{ note: 'install it from https://cli.github.com' }, { run: 'gh auth login' }]);
}
if (!gh(['auth', 'status', '--hostname', 'github.com']).ok) handoff('gh is not signed in to github.com.', [{ run: 'gh auth login' }]);

const view = gh(['repo', 'view', ...(args.repo ? [args.repo] : []), '--json', 'nameWithOwner,visibility,viewerPermission']);
const repo = view.ok ? parse(view.out) : null;
if (!repo?.nameWithOwner && !args.repo && /no git remotes|not a git repository/i.test(view.err)) {
  handoff(`no GitHub repository for ${project}.`, [
    { note: 'from the project folder, create one named after the folder (use --public for a public repository), then push main' },
    { run: 'gh repo create --private --source . --remote origin' },
    { run: `git push -u origin ${branch}` },
  ]);
}
if (!repo?.nameWithOwner) handoff(`gh could not read the repository: ${view.err.trim() || view.out.trim()}`, [{ note: 'fix what gh reports (the remote, the network, the name), then' }, { run: 'gh repo view' }]);
const name = repo.nameWithOwner;
// A public repository can always have branch protection, so a recorded local-hook cannot hold there.
known.available = String(repo.visibility).toUpperCase() === 'PUBLIC';
log(`repository ${name} (${String(repo.visibility).toLowerCase()}), your permission: ${repo.viewerPermission}`);

const onGitHub = gh(['api', `repos/${name}/branches/${branch}`]);
if (!onGitHub.ok) handoff(`${branch} is not on GitHub yet.`, [{ run: `git push -u origin ${branch}` }]);
const summary = parse(onGitHub.out);
// The summary cannot show linear history, so an admin, who can read the full form, reads it below.
if (summary?.protected && satisfies(summary.protection) && repo.viewerPermission !== 'ADMIN') {
  log(`${branch} is already protected with ${gateContext} and ${reviewContext}, admins included`);
  done('branch-protection');
}
// From here on the job is not done, or an admin reads the full form. The branch's protection
// counts as read, and falling short, if the summary parsed and does not satisfy.
known.branchRead = summary !== null && !(summary?.protected && satisfies(summary.protection));
if (repo.viewerPermission !== 'ADMIN') {
  const steps = [{ note: 'an admin runs' }, { run: putCommand(name) }];
  if (String(repo.visibility).toUpperCase() !== 'PUBLIC') steps.push({ note: 'on GitHub Free that write fails with "Upgrade to GitHub Pro": the mode is then local-hook, and the last command below, run by the admin, records it' });
  handoff(`branch protection needs an admin of ${name}, and this account is ${repo.viewerPermission}.`, steps);
}

// 2. Read-only probe: is branch protection available, and is it already on?
const probe = gh(['api', `repos/${name}/branches/${branch}/protection`]);
// A probe that reads protection, or answers 404, shows that branch protection is available here.
const probed = probe.ok || /HTTP 404/.test(probe.err);
known.available = known.available || probed;
if (probed) known.branchRead = true;
if (probe.ok) {
  if (satisfies(parse(probe.out))) done('branch-protection');
  handoff(
    `${branch} already has branch protection with other settings; pitwall does not replace them.`,
    [{ note: `to replace them with pitwall's (${gateContext} from GitHub Actions, ${reviewContext}, admins included)` }, { run: putCommand(name) }],
  );
}
if (/Upgrade to GitHub Pro/i.test(probe.err + probe.out)) {
  log('branch protection is not available: a private repository on GitHub Free');
  log(`mode local-hook: a local hook will refuse "gh pr merge" until ${gateContext} and ${reviewContext} are green.`);
  log('pitwall does not ship that hook yet. Until it does, nothing blocks a merge here except the review flow.');
  done('local-hook');
}
if (!/HTTP 404/.test(probe.err)) {
  handoff(`could not read the branch protection of ${name}: ${probe.err.trim()}`, [{ note: 'where gh has admin rights' }, { run: putCommand(name) }]);
}
log('branch protection is available and not set yet');

// 3. Write, or in a dry run say what would be written.
if (dry) {
  log(`dry run: would run gh api -X PUT repos/${name}/branches/${branch}/protection with:`);
  console.log(JSON.stringify(body(), null, 2));
  done('branch-protection');
}
const put = gh(['api', '-X', 'PUT', `repos/${name}/branches/${branch}/protection`, '--input', '-'], JSON.stringify(body()));
if (!put.ok) handoff(`GitHub refused the write: ${put.err.trim()}`, [{ note: 'where gh has admin rights' }, { run: putCommand(name) }]);
const after = gh(['api', `repos/${name}/branches/${branch}/protection`]);
if (!after.ok || !satisfies(parse(after.out))) {
  handoff('the write went through, but reading it back does not show the required checks.', [{ run: `gh api repos/${name}/branches/${branch}/protection` }]);
}
log(`${branch} now requires ${gateContext} (GitHub Actions) and ${reviewContext}, admins included`);
done('branch-protection');
