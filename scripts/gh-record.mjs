#!/usr/bin/env node
// Runs the real gh and records what GitHub answered, for `scripts/e2e.mjs --github` (T3b-AC7).
// Not part of the plugin.
//
//   GH_REAL     the real gh binary
//   GH_RECORD   a file: one JSON line per call, { caller, args, status, stdout, stderr }
//
// It passes stdin, stdout, stderr and the exit code through unchanged. e2e.mjs scrubs the records
// and keeps one answer per kind of request in scripts/github-responses/, which scripts/check.mjs
// holds the fake GitHub to.

import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
// The owner's account is real here, so the run asks GitHub only what the loop asks: the session pushes
// (with git) and opens PRs, the scripts read and set statuses and merge (owner, T3b). Anything else is refused.
const a = args.join(' ');
const apiMethod = args[0] === 'api' ? (args.includes('-X') ? args[args.indexOf('-X') + 1] : args.some((x) => ['-f', '-F', '--field', '--raw-field', '--input'].includes(x)) ? 'POST' : 'GET') : null;
const apiPath = args.find((x) => /^\/?repos\//.test(x)) ?? '';
const allowed =
  /^(--version|auth status\b|repo view\b|pr (create|list|view|checks|diff|merge|comment)\b|run (list|view)\b)/.test(a) ||
  (apiMethod === 'GET' && /^\/?repos\//.test(apiPath)) ||
  (apiMethod === 'POST' && /\/statuses\/[0-9a-f]{40}$/.test(apiPath)) ||
  // protect.mjs tries to protect main; on GitHub Free the probe refuses before this, and on a paid plan it is what kickoff does.
  (apiMethod === 'PUT' && /\/branches\/[^/]+\/protection$/.test(apiPath));
if (!allowed || args.includes('--admin')) {
  process.stderr.write(`gh-record: the e2e run does not let a session run "gh ${a}" on the owner's account\n`);
  process.exit(1);
}
let input;
try {
  input = args.includes('--input') ? readFileSync(0) : undefined;
} catch {}
const r = spawnSync(process.env.GH_REAL || 'gh', args, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
try {
  appendFileSync(process.env.GH_RECORD, JSON.stringify({ caller: process.env.PITWALL_CALLER ?? 'session', args, status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }) + '\n');
} catch {}
process.stdout.write(r.stdout ?? '');
process.stderr.write(`${r.stderr ?? ''}${r.error ? r.error.message : ''}`);
process.exit(r.status ?? 1);
