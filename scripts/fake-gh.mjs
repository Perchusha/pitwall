#!/usr/bin/env node
// A fake gh for scripts/check.mjs: it answers the calls protect.mjs, review-status.mjs
// and merge.mjs make, from a scenario, and logs each call. Not part of the plugin.
//
//   FAKE_GH        the scenario, JSON (see below)
//   FAKE_GH_LOG    a file: one JSON line per call, { caller, args, input }
//   FAKE_GH_STATE  a file: what the fake GitHub holds after a write (protection, statuses, merges)
//
// Scenario fields: auth (signed in), repo (what "gh repo view" prints, or null),
// branch (false: main not on GitHub; "garbled": the branch endpoint prints no JSON),
// protection (the protection GitHub holds before any write), probe ("404", "free" for
// "Upgrade to GitHub Pro", "denied" for a refused read), put ("ok", "refuse", "lost"),
// pr ({ number, state, base, head: "local" for the planning branch's local commit, or a sha }),
// status ("ok", "refuse", "lost"), statuses ({ <context>: <state> } already on every commit),
// gate ("success", "failure", "pending", or null for none), gateApp (its app id),
// rules (the rules on main), merge ("ok", "refuse").

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const s = JSON.parse(process.env.FAKE_GH);
const args = process.argv.slice(2);
let input = '';
try {
  input = readFileSync(0, 'utf8');
} catch {}
appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ caller: process.env.PITWALL_CALLER ?? '', args, input }) + '\n');
const out = (o) => {
  process.stdout.write(typeof o === 'string' ? o : JSON.stringify(o));
  process.exit(0);
};
const err = (m) => {
  process.stderr.write(m + '\n');
  process.exit(1);
};
const statePath = process.env.FAKE_GH_STATE;
const st = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
const save = () => writeFileSync(statePath, JSON.stringify(st));
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const fields = () => Object.fromEntries(args.flatMap((a, i) => (args[i - 1] === '-f' ? [a.split(/=(.*)/s).slice(0, 2)] : [])));

if (args[0] === '--version') out('gh version 2.0.0 (fake)\n');
if (args[0] === 'auth') s.auth ? out('Logged in\n') : err('You are not logged into any GitHub hosts.');
if (args[0] === 'repo' && args[1] === 'view') s.repo ? out(s.repo) : err('no git remotes found');

if (args[0] === 'pr') {
  if (!s.pr) err(`no pull requests found for branch "${args[2]}"`);
  const head = s.pr.head === 'local' ? spawnSync('git', ['rev-parse', 'refs/heads/plan/initial'], { encoding: 'utf8' }).stdout.trim() : s.pr.head;
  if (args[1] === 'merge') {
    if (s.merge === 'refuse') err('GraphQL: Merge commits are not allowed on this repository (mergePullRequest)');
    if (flag('--match-head-commit') !== head) err('GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)');
    st.merged = { oid: 'f'.repeat(40), args };
    save();
    out('');
  }
  if (args[1] === 'view') {
    out({ number: s.pr.number ?? 7, state: st.merged ? 'MERGED' : s.pr.state ?? 'OPEN', headRefOid: head, baseRefName: s.pr.base ?? 'main', url: 'https://github.com/o/r/pull/7', mergeCommit: st.merged ? { oid: st.merged.oid } : null });
  }
}

if (args[0] === 'api') {
  const path = args.find((a) => a.startsWith('repos/'));
  const method = flag('-X') ?? 'GET';
  const stored = st.protection !== undefined ? st.protection : s.protection ?? null;

  // Commit statuses: written by review-status.mjs, read by it and by merge.mjs.
  const status = /^repos\/[^/]+\/[^/]+\/statuses\/([0-9a-f]+)$/.exec(path);
  if (status && method === 'POST') {
    if (s.status === 'refuse') err('gh: Resource not accessible by integration (HTTP 403)');
    const f = fields();
    if (s.status !== 'lost') {
      st.statuses ??= {};
      (st.statuses[status[1]] ??= []).unshift({ context: f.context, state: f.state, description: f.description });
      save();
    }
    out({ state: f.state, context: f.context });
  }
  const list = /^repos\/[^/]+\/[^/]+\/commits\/([0-9a-f]+)\/statuses$/.exec(path);
  if (list) out([...(st.statuses?.[list[1]] ?? []), ...Object.entries(s.statuses ?? {}).map(([context, state]) => ({ context, state }))]);
  if (/\/commits\/[0-9a-f]+\/check-runs$/.test(path)) {
    const pending = s.gate === 'pending';
    out({ total_count: s.gate ? 1 : 0, check_runs: s.gate ? [{ name: 'gate', status: pending ? 'in_progress' : 'completed', conclusion: pending ? null : s.gate, app: { id: s.gateApp ?? 15368 } }] : [] });
  }
  if (/\/rules\/branches\//.test(path)) out(s.rules ?? []);

  // Branch protection: written by protect.mjs, read by it and by merge.mjs.
  if (method === 'PUT') {
    if (s.put === 'refuse') err('gh: Resource not accessible by integration (HTTP 403)');
    const b = JSON.parse(input);
    // "lost": GitHub answers OK but the protection never shows up.
    if (s.put === 'ok') {
      st.protection = {
        required_status_checks: { checks: b.required_status_checks.checks.map((c) => ({ context: c.context, app_id: c.app_id === -1 ? null : c.app_id })) },
        enforce_admins: { enabled: b.enforce_admins },
        required_linear_history: { enabled: b.required_linear_history },
      };
      save();
    }
    out('{}');
  }
  if (path.endsWith('/protection')) {
    if (s.probe === 'free') err('gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)');
    // A refused read wins over what is stored, so a refused probe can meet a visible branch summary.
    if (s.probe === 'denied') err('gh: Resource not accessible by integration (HTTP 403)');
    if (stored) out(stored);
    err('gh: Branch not protected (HTTP 404)');
  }
  if (s.branch === false) err('gh: Branch not found (HTTP 404)');
  if (s.branch === 'garbled') out('not json');
  // The branch endpoint: the protection summary any reader sees.
  out(
    stored
      ? { name: 'main', protected: true, protection: { enabled: true, required_status_checks: { checks: stored.required_status_checks.checks, enforcement_level: stored.enforce_admins?.enabled ? 'everyone' : 'non_admins' } } }
      : { name: 'main', protected: false, protection: { enabled: false } },
  );
}
err('fake gh: unexpected call ' + args.join(' '));
