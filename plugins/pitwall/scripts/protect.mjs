#!/usr/bin/env node
// Merge protection for a project's main branch (T1-AC2, ADR-0002, ADR-0005).
//
//   node protect.mjs [--project <dir>] [--repo <owner/name>] [--dry-run]
//
// First it checks that it may (L-5): gh is installed and signed in, the
// account is admin, the branch is on GitHub. Then a read-only probe of the
// protection API picks the mode:
//   available (public, or private on a paid plan) -> branch protection that
//     requires gate (GitHub Actions) and ai-review, admins included;
//   "Upgrade to GitHub Pro" (private on GitHub Free) -> local-hook: recorded,
//     the hook itself ships with the epic loop.
// A failed precondition or a refused write records "pending" and prints a
// HANDOFF block with a ready command for the owner. --dry-run makes the same
// reads, prints the writes and writes nothing, not even .claude/pitwall.json.
//
// The last line is "RESULT: <mode>". Exit 0 protected or local-hook, 3 handed
// to the owner, 2 usage. Set PITWALL_GH to a JSON array to run another gh
// binary (the checks use a fake one).

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config, parseArgs, readJson, requireNode, writeJson } from './lib.mjs';

requireNode();
const args = parseArgs(process.argv.slice(2), { project: 'value', repo: 'value', 'dry-run': 'switch' }, 'node protect.mjs [--project <dir>] [--repo <owner/name>] [--dry-run]');
const project = resolve(args.project ?? '.');
const dry = Boolean(args['dry-run']);
const cfg = config();
const mp = cfg.mergeProtection;
const branch = mp.branch;
const gateContext = cfg.review.gateContext;
const reviewContext = cfg.review.statusContext;
const ghCmd = process.env.PITWALL_GH ? JSON.parse(process.env.PITWALL_GH) : ['gh'];

function gh(ghArgs, input) {
  const r = spawnSync(ghCmd[0], [...ghCmd.slice(1), ...ghArgs], { cwd: project, input, encoding: 'utf8' });
  return { ok: !r.error && r.status === 0, missing: Boolean(r.error), out: r.stdout ?? '', err: `${r.stderr ?? ''}${r.error?.message ?? ''}` };
}

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
  ];
  return `gh api -X PUT repos/${repo}/branches/${branch}/protection ${fields.map((f) => `-F "${f}"`).join(' ')}`;
}

function record(mode) {
  const file = join(project, '.claude', 'pitwall.json');
  if (dry) return log(`dry run: .claude/pitwall.json not changed (would record ${mode})`);
  if (!existsSync(file)) return log(`no .claude/pitwall.json in ${project}: mode ${mode} not recorded`);
  const settings = readJson(file);
  if (settings.mergeProtection === mode) return;
  writeJson(file, { ...settings, mergeProtection: mode });
  log(`recorded mergeProtection "${mode}" in .claude/pitwall.json`);
}

function done(mode) {
  record(mode);
  console.log(`RESULT: ${mode}${dry ? ' (dry run, nothing written)' : ''}`);
  process.exit(0);
}

function handoff(reason, steps) {
  record('pending');
  console.log(`HANDOFF: ${reason}`);
  for (const s of steps) console.log(`  ${s}`);
  console.log('RESULT: pending');
  process.exit(3);
}

// Does an existing protection already hold what pitwall needs?
function satisfies(p) {
  const checks = p.required_status_checks?.checks ?? [];
  const gate = checks.find((c) => c.context === gateContext);
  const review = checks.find((c) => c.context === reviewContext);
  return Boolean(gate && gate.app_id === mp.githubActionsAppId && review && (review.app_id == null || review.app_id === -1) && p.enforce_admins?.enabled === true);
}

// 1. May we? gh, a signed-in account, a repository, admin rights, the branch on GitHub.
const version = gh(['--version']);
if (!version.ok) {
  handoff('the GitHub CLI is not installed or does not run.', ['Install it from https://cli.github.com, then run: gh auth login', 'Then run protect.mjs again.']);
}
if (!gh(['auth', 'status']).ok) handoff('gh is not signed in.', ['gh auth login', 'Then run protect.mjs again.']);

const view = gh(['repo', 'view', ...(args.repo ? [args.repo] : []), '--json', 'nameWithOwner,visibility,viewerPermission']);
if (!view.ok) {
  handoff(`no GitHub repository for ${args.repo ?? project}.`, [
    'Create one from the project folder: gh repo create <name> --private --source . --remote origin --push',
    '(or --public), then run protect.mjs again.',
  ]);
}
const repo = JSON.parse(view.out);
const name = repo.nameWithOwner;
log(`repository ${name} (${repo.visibility.toLowerCase()}), your permission: ${repo.viewerPermission}`);

if (repo.viewerPermission !== 'ADMIN') {
  handoff(`branch protection needs an admin of ${name}, and this account is ${repo.viewerPermission}.`, [
    `An admin runs: ${putCommand(name)}`,
    'Then run protect.mjs again to record it.',
  ]);
}
if (!gh(['api', `repos/${name}/branches/${branch}`]).ok) {
  handoff(`${branch} is not on GitHub yet.`, [`git push -u origin ${branch}`, 'Then run protect.mjs again.']);
}

// 2. Read-only probe: is branch protection available, and is it already on?
const probe = gh(['api', `repos/${name}/branches/${branch}/protection`]);
if (probe.ok) {
  if (satisfies(JSON.parse(probe.out))) {
    log(`${branch} is already protected with ${gateContext} and ${reviewContext}, admins included`);
    done('branch-protection');
  }
  handoff(`${branch} already has branch protection with other settings; pitwall does not replace them.`, [
    `To replace them with pitwall's (${gateContext} from GitHub Actions, ${reviewContext}, admins included): ${putCommand(name)}`,
    'Then run protect.mjs again to record it.',
  ]);
}
if (/Upgrade to GitHub Pro/i.test(probe.err + probe.out)) {
  log('branch protection is not available: a private repository on GitHub Free');
  log(`mode local-hook: a local hook will refuse "gh pr merge" until ${gateContext} and ${reviewContext} are green.`);
  log('pitwall does not ship that hook yet. Until it does, nothing blocks a merge here except the review flow.');
  done('local-hook');
}
if (!/HTTP 404/.test(probe.err)) {
  handoff(`could not read the branch protection of ${name}: ${probe.err.trim()}`, [`Run where gh has admin rights: ${putCommand(name)}`, 'Then run protect.mjs again to record it.']);
}
log('branch protection is available and not set yet');

// 3. Write, or in a dry run say what would be written.
if (dry) {
  log(`dry run: would run gh api -X PUT repos/${name}/branches/${branch}/protection with:`);
  console.log(JSON.stringify(body(), null, 2));
  done('branch-protection');
}
const put = gh(['api', '-X', 'PUT', `repos/${name}/branches/${branch}/protection`, '--input', '-'], JSON.stringify(body()));
if (!put.ok) {
  handoff(`GitHub refused the write: ${put.err.trim()}`, [`Run where gh has admin rights: ${putCommand(name)}`, 'Then run protect.mjs again to record it.']);
}
const after = gh(['api', `repos/${name}/branches/${branch}/protection`]);
if (!after.ok || !satisfies(JSON.parse(after.out))) {
  handoff('the write went through but reading it back does not show the required checks.', [`Check: gh api repos/${name}/branches/${branch}/protection`, 'Then run protect.mjs again.']);
}
log(`${branch} now requires ${gateContext} (GitHub Actions) and ${reviewContext}, admins included`);
done('branch-protection');
