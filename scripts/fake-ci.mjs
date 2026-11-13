// The CI of the fake GitHub (scripts/fake-github.mjs): runs the project's gate job on one commit and
// records the result as the check run "gate". Not part of the plugin.
//
//   node fake-ci.mjs <state folder> <origin> <sha>
//
// A clean clone of origin at the commit, then the "run:" steps of the job "gate" in
// .github/workflows/ci.yml, in order, through bash, as GitHub Actions would run them; "uses:" steps
// (checkout, a toolchain) are this machine's own. Without that job, `bash scripts/gate --full`. At
// most 30 minutes in all. The result goes to <state>/ci/<sha>.json, the output to <state>/ci/<sha>.log.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, origin, sha] = process.argv.slice(2);
const file = join(dir, 'ci', `${sha}.json`);
const run = JSON.parse(readFileSync(file, 'utf8'));
const write = (fields) => writeFileSync(file, JSON.stringify({ ...run, ...fields }));
write({ status: 'in_progress', startedAt: new Date().toISOString() });

// The run steps of the job "gate": "run: <command>" on one line, or "run: |" and the lines indented under it.
function gateSteps(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const job = lines.findIndex((l) => /^ {2}gate:\s*$/.test(l));
  if (job < 0) return null;
  const steps = [];
  for (let i = job + 1; i < lines.length && !/^ {2}\S/.test(lines[i]) && !/^\S/.test(lines[i]); i += 1) {
    const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (!/^[|>][-+]?\s*$/.test(m[2])) {
      steps.push(m[2].replace(/^(['"])(.*)\1$/, '$2'));
      continue;
    }
    const block = [];
    let indent = null;
    for (i += 1; i < lines.length; i += 1) {
      if (lines[i].trim() === '') {
        block.push('');
        continue;
      }
      const lead = /^(\s*)/.exec(lines[i])[1].length;
      if (lead <= m[1].length) break;
      indent ??= lead;
      block.push(lines[i].slice(indent));
    }
    i -= 1;
    steps.push(block.join('\n').trim());
  }
  return steps;
}

const work = mkdtempSync(join(dir, 'ci', 'work-'));
const started = Date.now();
let conclusion = 'failure';
let log = '';
try {
  const clone = spawnSync('git', ['clone', '-q', origin, work], { encoding: 'utf8' });
  const checkout = clone.status === 0 ? spawnSync('git', ['-C', work, 'checkout', '-q', sha], { encoding: 'utf8' }) : clone;
  if (checkout.status !== 0) log = `git: ${checkout.stderr}`;
  else {
    const ciFile = join(work, '.github', 'workflows', 'ci.yml');
    const steps = (existsSync(ciFile) && gateSteps(readFileSync(ciFile, 'utf8'))) || ['bash scripts/gate --full'];
    conclusion = 'success';
    for (const step of steps) {
      const left = 30 * 60 * 1000 - (Date.now() - started);
      const r = spawnSync('bash', ['-e', '-c', step], { cwd: work, encoding: 'utf8', timeout: Math.max(left, 1000), maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CI: 'true' } });
      log += `$ ${step}\n${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}\n`;
      // A step that failed says how, even when it printed nothing (a shell that could not start, a signal).
      if (r.status !== 0) log += `(exit ${r.status ?? 'none'}${r.signal ? `, signal ${r.signal}` : ''})\n`;
      if (r.status !== 0) {
        conclusion = 'failure';
        break;
      }
    }
  }
} catch (e) {
  log += `\n${e.message}`;
} finally {
  writeFileSync(join(dir, 'ci', `${sha}.log`), log);
  write({ status: 'completed', conclusion, completedAt: new Date().toISOString() });
  rmSync(work, { recursive: true, force: true });
}
