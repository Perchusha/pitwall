// The live mode of scripts/fake-gh.mjs (T3b-AC7): a small GitHub for the headless runs of the epic
// loop, kept in a folder, with a local bare repository as origin. Not part of the plugin.
//
//   FAKE_GH_LIVE     the folder that holds its state: github.json (PRs, statuses), ci/ (the gate runs), calls.log
//   FAKE_GH_ORIGIN   the bare repository the project pushes to
//   FAKE_GH_REPO     owner/name, e2e/move-reminder by default
//
// It answers what pitwall's scripts and a session of the epic loop ask: the repository, PRs from
// branches (created, listed, viewed, merged with a merge commit into origin), commit statuses, the
// check runs of a CI that runs `bash scripts/gate --full` on a clean clone of each commit once, in
// the background (scripts/fake-ci.mjs), as the check "gate" from the GitHub Actions app, and branch
// protection as a private repository on GitHub Free refuses it, so kickoff's protect.mjs records
// local-hook. Anything else it does not know is an error, the way gh reports one. The shapes of its
// answers are checked against GitHub's own, recorded by `scripts/e2e.mjs --github`, in check.mjs.

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.env.FAKE_GH_LIVE;
const origin = process.env.FAKE_GH_ORIGIN;
const [owner, name] = (process.env.FAKE_GH_REPO ?? 'e2e/move-reminder').split('/');
const nameWithOwner = `${owner}/${name}`;
const GITHUB_ACTIONS = 15368;
const args = process.argv.slice(2);
let input = '';
try {
  input = args.includes('--input') ? readFileSync(0, 'utf8') : '';
} catch {}
mkdirSync(join(dir, 'ci'), { recursive: true });
appendFileSync(join(dir, 'calls.log'), JSON.stringify({ caller: process.env.PITWALL_CALLER ?? 'session', args }) + '\n');

const out = (o) => {
  process.stdout.write(typeof o === 'string' ? o : JSON.stringify(o));
  process.exit(0);
};
const err = (m, code = 1) => {
  process.stderr.write(m + '\n');
  process.exit(code);
};
// gh's failed API call: the error body on stdout, the message and the status on stderr.
const apiErr = (message, status) => {
  process.stdout.write(JSON.stringify({ message, documentation_url: 'https://docs.github.com/rest', status: String(status) }));
  err(`gh: ${message} (HTTP ${status})`);
};
const flag = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const has = (f) => args.includes(f);
const statePath = join(dir, 'github.json');
const st = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { prs: [], statuses: {}, next: 1 };
const save = () => writeFileSync(statePath, JSON.stringify(st, null, 2));
const git = (...a) => spawnSync('git', a, { encoding: 'utf8', env: process.env });
const originGit = (...a) => git('--git-dir', origin, ...a);
const tip = (branch) => {
  const r = originGit('rev-parse', '--verify', '-q', `refs/heads/${branch}`);
  return r.status === 0 ? r.stdout.trim() : null;
};
const url = (n) => `https://github.com/${nameWithOwner}/pull/${n}`;
const pick = (o, fields) => (fields ? Object.fromEntries(fields.split(',').map((f) => [f, o[f] ?? null])) : o);

// The CI: one run of the gate per commit, started the first time anything asks about the commit.
function ci(sha) {
  const f = join(dir, 'ci', `${sha}.json`);
  if (!existsSync(f)) {
    writeFileSync(f, JSON.stringify({ id: Date.now() % 1e9, status: 'queued', conclusion: null, sha }));
    const runner = join(dirname(fileURLToPath(import.meta.url)), 'fake-ci.mjs');
    spawn(process.execPath, [runner, dir, origin, sha], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env }).unref();
  }
  return JSON.parse(readFileSync(f, 'utf8'));
}

// A PR as gh shows it. An open PR's head is the tip of its branch on origin.
function shown(pr) {
  const head = pr.state === 'OPEN' ? tip(pr.branch) : pr.mergedHead;
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body,
    state: pr.state,
    headRefName: pr.branch,
    headRefOid: head,
    baseRefName: pr.base,
    url: url(pr.number),
    mergeCommit: pr.mergeCommit ? { oid: pr.mergeCommit } : null,
    comments: pr.comments ?? [],
    isDraft: false,
  };
}
const current = () => git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim();
function find(sel) {
  const s = sel ?? current();
  const m = /(?:^|\/pull\/)(\d+)$/.exec(s);
  const prs = m ? st.prs.filter((p) => p.number === Number(m[1])) : st.prs.filter((p) => p.branch === s);
  // A branch with several PRs: the open one, else the latest.
  return prs.find((p) => p.state === 'OPEN') ?? prs[prs.length - 1] ?? null;
}
// The first argument after the subcommand that is not a flag or a flag's value.
const VALUE_FLAGS = new Set(['--json', '--jq', '-q', '--template', '-t', '--head', '-H', '--base', '-B', '--state', '-s', '--limit', '-L', '--title', '--body', '-b', '--body-file', '-F', '--subject', '--match-head-commit', '--repo', '-R', '--branch', '--author', '--label', '--search', '-S', '--assignee', '-a', '--reviewer', '-r', '--milestone', '-m', '--workflow', '-w']);
function selector(from) {
  for (let i = from; i < args.length; i += 1) {
    if (VALUE_FLAGS.has(args[i])) i += 1;
    else if (!args[i].startsWith('-')) return args[i];
  }
  return undefined;
}
// --jq is gh's own filter; the loop's commands do not need it, and an answer without it is honest.
if (has('--jq') || has('-q') || has('--template')) err('fake GitHub: --jq and --template are not supported; read the JSON as it is');

if (args[0] === '--version') out('gh version 2.0.0 (fake GitHub for pitwall e2e)\n');
if (args[0] === 'auth' && args[1] === 'status') out(`github.com\n  Logged in to github.com account ${owner} (fake)\n`);

if (args[0] === 'repo' && args[1] === 'view') {
  const repo = { nameWithOwner, name, owner: { login: owner }, visibility: 'PRIVATE', viewerPermission: 'ADMIN', mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: true, defaultBranchRef: { name: 'main' }, url: `https://github.com/${nameWithOwner}` };
  out(has('--json') ? pick(repo, flag('--json')) : `${nameWithOwner}\n`);
}

if (args[0] === 'pr') {
  const sub = args[1];
  if (sub === 'list') {
    const state = (flag('--state') ?? flag('-s') ?? 'open').toUpperCase();
    const head = flag('--head') ?? flag('-H');
    const prs = st.prs.filter((p) => (state === 'ALL' || p.state === state) && (!head || p.branch === head)).map(shown);
    out(has('--json') ? prs.map((p) => pick(p, flag('--json'))) : prs.map((p) => `${p.number}\t${p.title}\t${p.headRefName}\t${p.state}`).join('\n') + (prs.length ? '\n' : ''));
  }
  if (sub === 'create') {
    const head = flag('--head') ?? flag('-H') ?? current();
    const base = flag('--base') ?? flag('-B') ?? 'main';
    if (!tip(head)) err(`pull request create failed: GraphQL: Head sha can't be blank, Base sha can't be blank, No commits between ${base} and ${head}, Head ref must be a branch (createPullRequest)`);
    if (st.prs.some((p) => p.branch === head && p.state === 'OPEN')) err(`a pull request for branch "${head}" into branch "${base}" already exists:\n${url(st.prs.find((p) => p.branch === head && p.state === 'OPEN').number)}`);
    const subject = originGit('log', '-1', '--format=%s', tip(head)).stdout.trim();
    const bodyFile = flag('--body-file') ?? flag('-F');
    const pr = { number: st.next, branch: head, base, title: flag('--title') ?? flag('-t') ?? subject, body: bodyFile ? readFileSync(bodyFile, 'utf8') : flag('--body') ?? flag('-b') ?? '', state: 'OPEN', mergeCommit: null, mergedHead: null };
    st.next += 1;
    st.prs.push(pr);
    save();
    ci(tip(head));
    out(`${url(pr.number)}\n`);
  }
  const pr = find(selector(2));
  if (!pr) err(`no pull requests found for branch "${selector(2) ?? current()}"`);
  if (sub === 'comment') {
    const body = flag('--body') ?? flag('-b');
    if (!body) err('fake GitHub: pr comment takes --body');
    (pr.comments ??= []).push({ author: { login: owner }, body, createdAt: new Date().toISOString() });
    save();
    out(`${url(pr.number)}#issuecomment-${pr.comments.length}\n`);
  }
  if (sub === 'view') {
    if (pr.state === 'OPEN') ci(tip(pr.branch));
    const p = shown(pr);
    out(has('--json') ? pick(p, flag('--json')) : `${p.title} #${p.number}\n${p.state}\n${p.url}\n`);
  }
  if (sub === 'checks') {
    const head = shown(pr).headRefOid;
    const run = ci(head);
    const review = (st.statuses[head] ?? []).find((s) => s.context === 'ai-review');
    const gate = run.status !== 'completed' ? 'pending' : run.conclusion === 'success' ? 'pass' : 'fail';
    const ai = !review ? 'pending' : review.state === 'success' ? 'pass' : review.state === 'pending' ? 'pending' : 'fail';
    // As gh prints them without a terminal: name, state, elapsed, link, description (recorded from GitHub, T3b).
    process.stdout.write(`ai-review\t${ai}\t0\t\t${review?.description ?? ''}\ngate\t${gate}\t${run.status === 'completed' ? '20s' : '0'}\thttps://github.com/${nameWithOwner}/actions/runs/${run.id}/job/${run.id}\t\n`);
    process.exit(gate === 'fail' || ai === 'fail' ? 1 : gate === 'pending' || ai === 'pending' ? 8 : 0);
  }
  if (sub === 'merge') {
    if (pr.state !== 'OPEN') err(`Pull request #${pr.number} is not mergeable: it is ${pr.state.toLowerCase()}`);
    if (has('--admin')) err('fake GitHub: --admin is not supported');
    if (!has('--merge')) err('fake GitHub: pitwall merges with a merge commit (--merge)');
    const head = tip(pr.branch);
    const match = flag('--match-head-commit');
    if (match && match !== head) err('GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)');
    const work = mkdtempSync(join(dir, 'merge-'));
    try {
      const w = (...a) => spawnSync('git', ['-C', work, ...a], { encoding: 'utf8', env: process.env });
      for (const step of [['clone', '-q', origin, work]]) {
        const r = spawnSync('git', step, { encoding: 'utf8', env: process.env });
        if (r.status !== 0) err(`fake GitHub: ${r.stderr}`);
      }
      const subject = flag('--subject') ?? `Merge pull request #${pr.number} from ${pr.branch}`;
      const body = flag('--body') ?? pr.title;
      w('checkout', '-q', pr.base);
      const m = w('merge', '--no-ff', '-q', `origin/${pr.branch}`, '-m', subject, '-m', body);
      if (m.status !== 0) err(`GraphQL: Pull Request is not mergeable (mergePullRequest)\n${m.stderr}`);
      const p = w('push', '-q', 'origin', pr.base);
      if (p.status !== 0) err(`fake GitHub: ${p.stderr}`);
      pr.state = 'MERGED';
      pr.mergedHead = head;
      pr.mergeCommit = w('rev-parse', 'HEAD').stdout.trim();
      save();
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
    // gh prints nothing on a merge without a terminal (recorded from GitHub, T3b).
    out('');
  }
  err(`fake GitHub: unexpected call gh ${args.join(' ')}`);
}

if (args[0] === 'run' && args[1] === 'list') {
  const branch = flag('--branch') ?? flag('-b');
  const sha = branch ? tip(branch) : null;
  const runs = sha ? [ci(sha)].map((r) => ({ databaseId: r.id, status: r.status, conclusion: r.conclusion ?? '', headSha: sha, headBranch: branch, displayTitle: originGit('log', '-1', '--format=%s', sha).stdout.trim(), workflowName: 'ci', event: 'push', url: `https://github.com/${nameWithOwner}/actions/runs/${r.id}` })) : [];
  out(has('--json') ? runs.map((r) => pick(r, flag('--json'))) : runs.map((r) => `${r.status}\t${r.conclusion}\t${r.displayTitle}\tci\t${r.headBranch}\tpush\t${r.databaseId}`).join('\n') + '\n');
}

if (args[0] === 'api') {
  const path = args.find((a) => /^\/?repos\//.test(a))?.replace(/^\//, '');
  const method = (flag('-X') ?? flag('--method') ?? (args.some((a) => a === '-f' || a === '-F' || a === '--field' || a === '--raw-field') ? 'POST' : 'GET')).toUpperCase();
  const prefix = `repos/${nameWithOwner}/`;
  if (!path || !path.startsWith(prefix)) err(`fake GitHub: unexpected call gh ${args.join(' ')}`);
  const rest = path.slice(prefix.length);
  const fields = Object.fromEntries(args.flatMap((a, i) => (['-f', '-F', '--field', '--raw-field'].includes(args[i - 1]) ? [a.split(/=(.*)/s).slice(0, 2)] : [])));
  let m;
  if ((m = /^statuses\/([0-9a-f]{40})$/.exec(rest)) && method === 'POST') {
    if (originGit('cat-file', '-e', `${m[1]}^{commit}`).status !== 0) apiErr('No commit found for SHA: ' + m[1], 422);
    const s = { context: fields.context ?? 'default', state: fields.state, description: fields.description ?? null, target_url: null, created_at: new Date().toISOString(), id: Date.now() % 1e9 };
    (st.statuses[m[1]] ??= []).unshift(s);
    save();
    out({ ...s, url: `https://api.github.com/${prefix}statuses/${m[1]}` });
  }
  if ((m = /^commits\/([0-9a-f]{40})\/statuses$/.exec(rest))) out(st.statuses[m[1]] ?? []);
  if ((m = /^commits\/([0-9a-f]{40})\/check-runs$/.exec(rest))) {
    if (originGit('cat-file', '-e', `${m[1]}^{commit}`).status !== 0) apiErr('No commit found for SHA: ' + m[1], 422);
    const r = ci(m[1]);
    out({ total_count: 1, check_runs: [{ id: r.id, name: 'gate', head_sha: m[1], status: r.status, conclusion: r.conclusion, app: { id: GITHUB_ACTIONS, slug: 'github-actions', name: 'GitHub Actions' } }] });
  }
  if ((m = /^commits\/([0-9a-f]{40})$/.exec(rest))) {
    const msg = originGit('log', '-1', '--format=%B', m[1]);
    if (msg.status !== 0) apiErr('No commit found for SHA: ' + m[1], 422);
    out({ sha: m[1], commit: { message: msg.stdout.replace(/\n+$/, '') } });
  }
  // Rulesets, like branch protection, are not available to a private repository on GitHub Free (recorded, T3b).
  if (/^rules\/branches\/[^/]+$/.test(rest)) apiErr('Upgrade to GitHub Pro or make this repository public to enable this feature.', 403);
  if (/^branches\/[^/]+\/protection$/.test(rest)) apiErr('Upgrade to GitHub Pro or make this repository public to enable this feature.', 403);
  if ((m = /^branches\/([^/]+)$/.exec(rest))) {
    if (!tip(m[1])) apiErr('Branch not found', 404);
    out({ name: m[1], commit: { sha: tip(m[1]) }, protected: false, protection: { enabled: false, required_status_checks: { enforcement_level: 'off', contexts: [], checks: [] } } });
  }
  err(`fake GitHub: unexpected call gh ${args.join(' ')}`);
}
err(`fake GitHub: unexpected call gh ${args.join(' ')}`);
