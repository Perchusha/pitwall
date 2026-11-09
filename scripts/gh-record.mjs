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
