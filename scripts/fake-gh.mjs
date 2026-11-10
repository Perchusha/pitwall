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
// pr ({ number, state, base, branch (default plan/initial), head: "local" for that branch's local commit, or a sha; title }),
// status ("ok", "refuse", "lost"), statuses ({ <context>: <state> } already on the PR head),
// gate ("success", "failure", "pending", or null for none), gateApp (its app id),
// rules (the rules on main), merge ("ok", "refuse", "lost"), mergeMessage (of a PR merged before the run).
// reads ("statuses", "check-runs", "rules" or "protection": that read fails), gateRerun (an older failed gate run).

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

// FAKE_GH_LIVE: the stateful fake GitHub of the headless loop runs (scripts/fake-github.mjs), which exits itself.
if (process.env.FAKE_GH_LIVE) await import('./fake-github.mjs');
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
if (args[0] === 'repo' && args[1] === 'view') s.repo ? out(s.repo) : err(s.repoError ?? 'no git remotes found');

// The PR's head: "local" is the local commit of the PR's branch (the planning branch by default), read with git in the project folder.
const prHead = () => (s.pr?.head === 'local' ? spawnSync('git', ['rev-parse', `refs/heads/${s.pr.branch ?? 'plan/initial'}`], { encoding: 'utf8' }).stdout.trim() : s.pr?.head);

if (args[0] === 'pr') {
  // A PR is asked for by its branch or its number; any other branch has none.
  const asked = args[2];
  if (!s.pr || (!/^\d+$/.test(asked) && asked !== (s.pr.branch ?? 'plan/initial'))) err(`no pull requests found for branch "${asked}"`);
  const head = prHead();
  if (args[1] === 'merge') {
    if (s.merge === 'refuse') err('GraphQL: Merge commits are not allowed on this repository (mergePullRequest)');
    if (flag('--match-head-commit') !== head) err('GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)');
    // "lost": GitHub answers OK but the PR never reads merged.
    if (s.merge !== 'lost') {
      st.merged = { oid: 'f'.repeat(40), args };
      save();
    }
    out('');
  }
  if (args[1] === 'view') {
    out({ number: s.pr.number ?? 7, state: st.merged ? 'MERGED' : s.pr.state ?? 'OPEN', headRefOid: head, baseRefName: s.pr.base ?? 'main', url: 'https://github.com/o/r/pull/7', title: s.pr.title ?? 'The change', mergeCommit: st.merged ? { oid: st.merged.oid } : s.pr.state === "MERGED" ? { oid: "e".repeat(40) } : null });
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
  // Statuses and check runs belong to one commit: the scenario's are on the PR head only.
  // A failed read, the way gh shows one: the error body on stdout as JSON, the status on stderr.
  const failed = () => {
    process.stdout.write(JSON.stringify({ message: 'API rate limit exceeded', documentation_url: 'https://docs.github.com/rest' }));
    err('gh: API rate limit exceeded (HTTP 403)');
  };
  const list = /^repos\/[^/]+\/[^/]+\/commits\/([0-9a-f]+)\/statuses$/.exec(path);
  if (list) {
    if (s.reads === 'statuses') failed();
    out([...(st.statuses?.[list[1]] ?? []), ...(list[1] === prHead() ? Object.entries(s.statuses ?? {}).map(([context, state]) => ({ context, state })) : [])]);
  }
  const runs = /^repos\/[^/]+\/[^/]+\/commits\/([0-9a-f]+)\/check-runs$/.exec(path);
  if (runs) {
    if (s.reads === 'check-runs') failed();
    const gate = runs[1] === prHead() ? s.gate : null;
    const pending = gate === 'pending';
    // gateRerun: an older failed run before the latest one.
    const older = s.gateRerun ? [{ id: 1, name: 'gate', status: 'completed', conclusion: 'failure', app: { id: 15368 } }] : [];
    // The older run comes first, so a script that takes the first run instead of the latest one fails.
    out({ total_count: gate ? 1 + older.length : 0, check_runs: gate ? [...older, { id: 2, name: 'gate', status: pending ? 'in_progress' : 'completed', conclusion: pending ? null : gate, app: { id: s.gateApp ?? 15368 } }] : [] });
  }
  // A commit: the merge commit's message, for merge.mjs to see whether it records the approval.
  const commit = /^repos\/[^/]+\/[^/]+\/commits\/([0-9a-f]+)$/.exec(path);
  if (commit) out({ sha: commit[1], commit: { message: st.merged ? `Merge the plan\n\n${st.merged.args[st.merged.args.indexOf('--body') + 1]}` : s.mergeMessage ?? 'Merge pull request #7' } });
  if (/\/rules\/branches\//.test(path)) {
    if (s.reads === 'rules') failed();
    out(s.rules ?? []);
  }
  if (s.reads === 'protection' && path.endsWith('/protection') && method === 'GET') err('gh: Must have admin rights to Repository. (HTTP 403)');

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
