#!/usr/bin/env node
// The release of a pitwall project (T4c, ADR-0013), for /pitwall:release and the qa agent.
//
//   node release.mjs --plan [--version <x.y.z>] [--json] [--project <dir>]
//       Read-only. What the next release holds: the loop's merge commits on main since the last release
//       (feat(E<n>): ... and fix(BUG-<n>): ..., its first-parent history), the commits left out, and
//       the version: an epic in it makes a minor, fixes alone a patch, and a major only with --version,
//       the owner's word. The first release of a project needs --version too: the owner picks 0.1.0 or
//       1.0.0 (release.firstVersions). It refuses while a blocking bug is open, an unconfirmed one
//       included, and while a release is merged and not tagged.
//   node release.mjs --write [--project <dir>]
//       On release/v<x.y.z>, branched from main as it is: writes the changelog's section into
//       CHANGELOG.md (created when missing), released (v<x.y.z>) as the status of each epic in it in
//       docs/EPICS.md, and fixed with its PR for each bug in it (bugs.mjs set --tree). The conductor adds
//       the journal entries and commits.
//   node release.mjs --check [--project <dir>]
//       On release/v<x.y.z>: the branch changes only CHANGELOG.md and docs/, main has not moved since it
//       branched, the changelog's section and the statuses are what --write writes, and no blocking bug
//       is open. The qa agent runs it; it writes nothing.
//   node release.mjs --build [--project <dir>]
//       On release/v<x.y.z>, with a clean tree: runs bash scripts/build <x.y.z>, which must exit 0, print
//       one "ARTIFACT: <path>" line per thing it built, each there and not empty, and leave the tree as
//       clean as it found it. Records the commit it built and the artifacts in the git directory
//       (release.pending), where --tag reads them.
//   node release.mjs --tag [--version <x.y.z>] [--project <dir>]
//       After the release merged: hands the owner the commands that make and push the annotated tag on
//       the release's merge commit and publish the artifacts (gh release create), with the changelog's
//       section as the message (owner, 2026-11-12). It makes no tag itself. It refuses when the tag
//       exists and when the merge commit's code differs from the code the qa agent built.
//
// Exit 0 done (--check: passes), 1 refused or failed, 2 usage, 3 handed to the owner (--tag), 4 the
// owner's answer is needed (the first version). The last line is "RESULT: ...", but for --plan --json, which prints the JSON alone.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEMVER, bugsView, changeOf, changelogSection, changelogSectionOf, compareVersions, config, gitRunner, openBlockingBugs, parseArgs, printHandoff, releaseDir, releaseHistory, requireNode, templateRoot } from './lib.mjs';

requireNode();
const usage = 'node release.mjs --plan [--version <x.y.z>] [--json] | --write | --check | --build | --tag [--version <x.y.z>]   [--project <dir>]';
const args = parseArgs(process.argv.slice(2), { plan: 'switch', write: 'switch', check: 'switch', build: 'switch', tag: 'switch', version: 'value', json: 'switch', project: 'value' }, usage);
const modes = ['plan', 'write', 'check', 'build', 'tag'].filter((m) => args[m]);
const bad = (msg) => {
  console.error(`release: ${msg}\nusage: ${usage}`);
  process.exit(2);
};
if (modes.length !== 1) bad('give one of --plan, --write, --check, --build, --tag');
const mode = modes[0];
if (args.version && !SEMVER.test(args.version.replace(/^v/, ''))) bad(`--version takes x.y.z, not "${args.version}"`);
const cfg = config();
const project = resolve(args.project ?? '.');
// The project's folder as the owner copies it into either shell.
const where = project.split('\\').join('/');
const git = gitRunner(project);
const main = cfg.mergeProtection.branch;
const prefix = cfg.release.tagPrefix;
const log = (msg) => console.log(`release: ${msg}`);
const self = fileURLToPath(import.meta.url).split('\\').join('/');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
function refuse(msg, detail = []) {
  console.log(`release: REFUSED - ${msg}`);
  for (const d of detail) console.log(`  ${d}`);
  console.log('RESULT: refused');
  process.exit(1);
}
const short = (sha) => String(sha ?? '').slice(0, 7);
const itemLine = (i) => `${i.kind === 'epic' ? 'epic' : 'fix'} ${i.id}: ${i.title} (#${i.pr})`;

if (!git('rev-parse', '--show-toplevel').ok) refuse(`${project} is not inside a git repository`);
const mainRef = [`refs/remotes/origin/${main}`, `refs/heads/${main}`].find((r) => git('rev-parse', '--verify', '-q', r).ok);
if (!mainRef) refuse(`there is no ${main} here, nor origin/${main}`);

// The version a release of these items gets, after the last one; null when the owner must name it.
function nextVersion(history) {
  const last = history.untagged?.version ?? history.last?.version ?? null;
  if (!last) return null;
  const [M, m, p] = last.split('.').map(Number);
  return history.items.some((i) => i.kind === 'epic') ? `${M}.${m + 1}.0` : `${M}.${m}.${p + 1}`;
}
// The version asked for, checked against the history: the computed one, or one the owner named above it.
function versionFor(history, asked) {
  const computed = nextVersion(history);
  const last = history.last?.version ?? null;
  if (!asked) return { version: computed, named: false };
  if (last && compareVersions(asked, last) <= 0) refuse(`${prefix}${asked} is not above the last release, ${prefix}${last}`);
  if (computed && compareVersions(asked, computed) < 0) refuse(`${prefix}${asked} is below ${prefix}${computed}, what this release holds makes: ${history.items.some((i) => i.kind === 'epic') ? 'an epic makes a minor' : 'fixes make a patch'}`);
  return { version: asked, named: computed !== asked };
}
const blockers = (ref = mainRef) => openBlockingBugs(project, cfg, ref).map((b) => `${b.id} (${b.title}): ${b.severity}${b.unconfirmed ? `, ${cfg.bugs.unconfirmed.mark}` : ''}, ${b.status || 'open'}${b.row.waiting ? ', waiting in the git directory' : ''}`);

// The release on the branch the project is on.
function onRelease() {
  const branch = git('branch', '--show-current').out;
  const c = changeOf(branch, cfg);
  if (c?.kind !== 'release' || !c.release) refuse(`on branch "${branch || 'none'}": --${mode} runs on the branch of a release, ${cfg.loop.branches.release}${prefix}<x.y.z>`);
  return { branch, version: c.release.slice(prefix.length), id: c.id };
}

// The epics' rows of docs/EPICS.md: the status cell of each epic named, set to status.
function setEpicStatuses(text, ids, status) {
  const done = new Set();
  const lines = text.split('\n').map((line) => {
    const m = /^\|\s*\[?(E\d+)\]?(?:\([^)]*\))?\s*\|/.exec(line);
    if (!m || !ids.includes(m[1])) return line;
    const cells = line.replace(/\s+$/, '').split(/(?<!\\)\|/);
    // ['', id, goal, risk, deps, status, ''] for a row that ends with a pipe.
    const statusAt = cells.length - 2;
    if (statusAt < 1) return line;
    cells[statusAt] = ` ${status} `;
    done.add(m[1]);
    return cells.join('|');
  });
  return { text: lines.join('\n'), done };
}
const epicStatus = (text, id) => {
  const line = text.split('\n').find((l) => new RegExp(`^\\|\\s*\\[?${id}\\]?(?:\\([^)]*\\))?\\s*\\|`).test(l));
  if (!line) return null;
  const cells = line.replace(/\s+$/, '').split(/(?<!\\)\|/);
  return (cells[cells.length - 2] ?? '').trim();
};

// ---------- --plan ----------
if (mode === 'plan') {
  const history = releaseHistory(git, mainRef, cfg);
  if (history.untagged) {
    refuse(`${prefix}${history.untagged.version} is merged as ${short(history.untagged.sha)} and not tagged yet: the next release starts after its tag, which the owner makes`, [`for the commands: node "${self}" --tag --project "${where}"`]);
  }
  const stops = blockers();
  if (stops.length) refuse(`a blocking bug is open: no release goes until its fix merges or the owner confirms it is not blocking (pitwall ADR-0013)`, stops);
  const asked = args.version?.replace(/^v/, '') ?? null;
  const out = { since: history.last ? { tag: history.last.tag, sha: history.last.sha } : null, items: history.items, leftOut: history.leftOut, version: null, first: !history.last, named: false };
  if (history.items.length === 0) {
    if (args.json) console.log(JSON.stringify(out, null, 2));
    else log(`nothing to release: no merge of the loop on ${main} since ${history.last ? history.last.tag : 'the start'}`);
    if (!args.json) console.log('RESULT: nothing to release');
    process.exit(1);
  }
  if (!history.last && !asked) {
    if (args.json) console.log(JSON.stringify(out, null, 2));
    else {
      log(`the first release of this project: ${history.items.length} change${history.items.length === 1 ? '' : 's'}`);
      for (const i of history.items) console.log(`  ${itemLine(i)}`);
      log(`the owner picks its version, ${cfg.release.firstVersions.join(' or ')}: run this again with --version <x.y.z>`);
    }
    if (!args.json) console.log('RESULT: waits for the owner');
    process.exit(4);
  }
  const { version, named } = versionFor(history, asked);
  Object.assign(out, { version, named });
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else {
    log(`${prefix}${version}${history.last ? `, after ${history.last.tag} (${short(history.last.sha)})${named ? ', the version the owner named' : ''}` : ', the first release, the version the owner picked'}`);
    for (const i of history.items) console.log(`  ${itemLine(i)}`);
    for (const l of history.leftOut) log(`left out: ${short(l.sha)} ${l.subject}: ${l.why}`);
  }
  if (!args.json) console.log(`RESULT: ${prefix}${version}`);
  process.exit(0);
}

// The release on this branch, checked against main where the branch left it.
function releaseHere() {
  const r = onRelease();
  const base = git('merge-base', 'HEAD', mainRef).out;
  const tip = git('rev-parse', mainRef).out;
  if (!base) refuse(`the branch shares no history with ${main}`);
  const history = releaseHistory(git, base, cfg);
  return { ...r, base, tip, history };
}

// ---------- --write ----------
if (mode === 'write') {
  const r = releaseHere();
  if (r.base !== r.tip) refuse(`${main} moved since ${r.branch} left it (${short(r.base)}, now ${short(r.tip)}): close this release and start it again from ${main}`);
  if (r.history.untagged) refuse(`${prefix}${r.history.untagged.version} is merged and not tagged yet: it is tagged first`);
  if (r.history.items.length === 0) refuse(`nothing to release on ${main} since ${r.history.last?.tag ?? 'the start'}`);
  versionFor(r.history, r.version);
  const stops = blockers();
  if (stops.length) refuse('a blocking bug is open: no release goes until it is fixed or confirmed not blocking (pitwall ADR-0013)', stops);
  // CHANGELOG.md: the section of this version, after the file's introduction and before the versions before it.
  const path = join(project, cfg.release.changelog);
  // A project laid out before 0.9.0 has none: it starts as the template's.
  const text = readFileSync(existsSync(path) ? path : join(templateRoot, cfg.release.changelog), 'utf8').replace(/\r\n?/g, '\n');
  const date = /^## \S+ - (\d{4}-\d{2}-\d{2})/.exec(changelogSectionOf(text, r.version, cfg) ?? '')?.[1] ?? today();
  const section = changelogSection(r.version, date, r.history.items, cfg);
  const lines = text.split('\n');
  const old = changelogSectionOf(text, r.version, cfg);
  let next;
  if (old !== null) next = text.replace(old, section);
  else {
    const first = lines.findIndex((l) => /^## /.test(l));
    const at = first < 0 ? lines.length : first;
    const before = lines.slice(0, at).join('\n').trimEnd();
    const after = lines.slice(at).join('\n').trim();
    next = `${before}\n\n${section}\n${after ? `\n${after}\n` : ''}`;
  }
  writeFileSync(path, next.replace(/\n*$/, '\n'));
  log(`${cfg.release.changelog}: the section ${prefix}${r.version} - ${date}, ${r.history.items.length} line${r.history.items.length === 1 ? '' : 's'}`);
  // docs/EPICS.md: released (v<x.y.z>) for each epic in it.
  const epics = r.history.items.filter((i) => i.kind === 'epic').map((i) => i.id);
  if (epics.length) {
    const ep = join(project, 'docs', 'EPICS.md');
    if (!existsSync(ep)) refuse('docs/EPICS.md does not exist: it is a path every pitwall project has (pitwall ADR-0006)');
    const { text: written, done } = setEpicStatuses(readFileSync(ep, 'utf8').replace(/\r\n?/g, '\n'), epics, `${cfg.release.status} (${prefix}${r.version})`);
    const missing = epics.filter((e) => !done.has(e));
    if (missing.length) refuse(`docs/EPICS.md has no row for ${missing.join(', ')}`);
    writeFileSync(ep, written);
    log(`docs/EPICS.md: ${epics.join(', ')} ${cfg.release.status} (${prefix}${r.version})`);
  }
  // docs/BUGS.md: each bug in it fixed, with its PR, as bugs.mjs writes it.
  for (const b of r.history.items.filter((i) => i.kind === 'bug')) {
    const s = spawnSync(process.execPath, [join(self, '..', 'bugs.mjs'), 'set', b.id, '--status', 'fixed', '--fix-pr', `#${b.pr}`, '--tree', '--project', project], { encoding: 'utf8' });
    if (s.status !== 0) refuse(`bugs.mjs could not record ${b.id} fixed`, `${s.stdout}${s.stderr}`.trim().split('\n'));
    log(`docs/BUGS.md: ${b.id} fixed (#${b.pr})`);
  }
  for (const l of r.history.leftOut) log(`left out: ${short(l.sha)} ${l.subject}: ${l.why}`);
  log('the conductor adds the journal entries of the changes merged and not recorded yet, then commits CHANGELOG.md and docs/ by name');
  console.log('RESULT: written');
  process.exit(0);
}

// ---------- --check ----------
if (mode === 'check') {
  const r = releaseHere();
  const fails = [];
  const pass = (msg) => log(`ok: ${msg}`);
  if (r.base !== r.tip) fails.push(`${main} moved since ${r.branch} left it (${short(r.base)}, now ${short(r.tip)}): the release holds what ${main} held then; close it and start it again`);
  else pass(`branched from ${main} as it is (${short(r.tip)})`);
  if (r.history.untagged) fails.push(`${prefix}${r.history.untagged.version} is merged and not tagged yet`);
  if (r.history.items.length === 0) fails.push(`no merge of the loop on ${main} since ${r.history.last?.tag ?? 'the start'}: nothing to release`);
  // The version: the computed one, or one the owner named above it; the first is always the owner's.
  const computed = nextVersion(r.history);
  if (r.history.last && compareVersions(r.version, r.history.last.version) <= 0) fails.push(`${prefix}${r.version} is not above the last release, ${r.history.last.tag}`);
  else if (computed && compareVersions(r.version, computed) < 0) fails.push(`${prefix}${r.version} is below ${prefix}${computed}, what the release holds makes`);
  else pass(`${prefix}${r.version}${computed ? (computed === r.version ? ', as its changes make' : `, the owner's version above ${prefix}${computed}`) : ', the first release, the owner\'s version'}`);
  // Only CHANGELOG.md and docs/ change: the tag then holds the code the qa agent built.
  const committed = git('-c', 'core.quotePath=false', 'diff', '--name-only', r.base, 'HEAD').out.split('\n').filter(Boolean);
  const working = git('-c', 'core.quotePath=false', 'status', '--porcelain', '--untracked-files=all').raw.split('\n').filter(Boolean).map((l) => l.slice(3));
  const others = [...new Set([...committed, ...working])].filter((f) => f !== cfg.release.changelog && !f.startsWith('docs/'));
  if (others.length) fails.push(`the release changes more than ${cfg.release.changelog} and docs/: ${others.slice(0, 10).join(', ')}`);
  else pass(`it changes only ${cfg.release.changelog} and docs/`);
  // The changelog's section is the one --write writes from the merges.
  const path = join(project, cfg.release.changelog);
  const have = existsSync(path) ? changelogSectionOf(readFileSync(path, 'utf8'), r.version, cfg) : null;
  const date = /^## \S+ - (\d{4}-\d{2}-\d{2})$/m.exec(have ?? '')?.[1];
  const want = changelogSection(r.version, date ?? today(), r.history.items, cfg);
  if (!have) fails.push(`${cfg.release.changelog} has no section ${prefix}${r.version}`);
  else if (!date) fails.push(`${cfg.release.changelog}: the section's heading is not "## ${prefix}${r.version} - <yyyy-mm-dd>"`);
  else if (have !== want) fails.push(`${cfg.release.changelog}: the section ${prefix}${r.version} is not what the merges make; release.mjs --write writes it:\n${want.replace(/^/gm, '    ')}`);
  else pass(`${cfg.release.changelog} holds the section ${prefix}${r.version}, ${r.history.items.length} line${r.history.items.length === 1 ? '' : 's'}`);
  // The records: each epic released, each bug fixed with its PR.
  const epicsText = existsSync(join(project, 'docs', 'EPICS.md')) ? readFileSync(join(project, 'docs', 'EPICS.md'), 'utf8') : '';
  const status = `${cfg.release.status} (${prefix}${r.version})`;
  for (const e of r.history.items.filter((i) => i.kind === 'epic')) {
    const s = epicStatus(epicsText, e.id);
    if (s !== status) fails.push(`docs/EPICS.md: ${e.id} is "${s ?? 'not there'}", not "${status}"`);
  }
  const bugs = bugsView(project, cfg).rows;
  for (const b of r.history.items.filter((i) => i.kind === 'bug')) {
    const row = bugs.find((x) => x.id === b.id);
    if (!row) fails.push(`docs/BUGS.md has no row for ${b.id}`);
    else if (!/^fixed$/i.test(row.status) || String(row.row.fix ?? '').trim() !== `#${b.pr}`) fails.push(`docs/BUGS.md: ${b.id} is "${row.status}" with fix PR "${String(row.row.fix ?? '').trim()}", not fixed with #${b.pr}`);
  }
  if (!fails.some((f) => f.startsWith('docs/'))) pass('docs/EPICS.md and docs/BUGS.md record each change of the release');
  for (const b of blockers('HEAD')) fails.push(`a blocking bug is open: ${b}`);
  for (const l of r.history.leftOut) log(`left out: ${short(l.sha)} ${l.subject}: ${l.why}`);
  for (const f of fails) log(`FAIL: ${f}`);
  console.log(fails.length ? `RESULT: fail (${fails.length})` : 'RESULT: pass');
  process.exit(fails.length ? 1 : 0);
}

const recordPath = (version) => {
  const dir = releaseDir(project, cfg);
  return dir ? join(dir, `${prefix}${version}.json`) : null;
};
const porcelain = () => git('-c', 'core.quotePath=false', 'status', '--porcelain', '--untracked-files=all').raw.split('\n').filter(Boolean);

// ---------- --build ----------
if (mode === 'build') {
  const r = onRelease();
  const script = cfg.release.build;
  if (!git('ls-files', '--error-unmatch', '--', script).ok) {
    refuse(`this project has no ${script} in git: a project laid out before pitwall 0.9.0 lacks it. The owner adds one that builds what they run or install, prints one "${cfg.release.artifactLine} <path>" line per thing it built and changes no tracked file (pitwall ADR-0013), then the release runs again`);
  }
  const before = porcelain();
  if (before.length) refuse('the tree is not clean: the build runs on the commit the release holds', before.slice(0, 10));
  const sha = git('rev-parse', 'HEAD').out;
  log(`bash ${script} ${r.version}, at ${short(sha)}`);
  const run = spawnSync('bash', [script, r.version], { cwd: project, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const tail = output.length > cfg.hooks.gateOutputChars ? `...${output.slice(-cfg.hooks.gateOutputChars)}` : output;
  if (run.error) refuse(`${script} could not run: ${run.error.message}`);
  if (run.status !== 0) refuse(`${script} failed (exit ${run.status})`, tail.trim().split('\n'));
  const marker = cfg.release.artifactLine;
  const named = (run.stdout ?? '').split(/\r?\n/).filter((l) => l.startsWith(marker)).map((l) => l.slice(marker.length).trim()).filter(Boolean);
  if (named.length === 0) refuse(`${script} passed but printed no "${marker} <path>" line: it names each thing it built`, tail.trim().split('\n').slice(-20));
  const artifacts = [];
  const missing = [];
  for (const p of named) {
    const full = isAbsolute(p) ? p : join(project, p);
    let st = null;
    try {
      st = statSync(full);
    } catch {}
    if (!st || (st.isFile() && st.size === 0)) missing.push(`${p}: ${st ? 'empty' : 'not there'}`);
    else artifacts.push({ path: p.split('\\').join('/'), kind: st.isFile() ? 'file' : 'folder', bytes: st.isFile() ? st.size : null });
  }
  if (missing.length) refuse(`${script} named artifacts that are not there`, missing);
  const after = porcelain();
  if (after.join('\n') !== before.join('\n')) refuse(`${script} changed the tree: it may change no tracked file and leave nothing git does not ignore`, after.slice(0, 10));
  if (git('rev-parse', 'HEAD').out !== sha) refuse(`${script} moved HEAD`);
  const record = recordPath(r.version);
  mkdirSync(join(record, '..'), { recursive: true });
  writeFileSync(record, `${JSON.stringify({ version: r.version, branch: r.branch, built: sha, at: new Date().toISOString(), artifacts }, null, 2)}\n`);
  for (const a of artifacts) log(`artifact: ${a.path} (${a.kind === 'file' ? `${a.bytes} bytes` : 'a folder'})`);
  log(`recorded in ${record.split('\\').join('/')}`);
  console.log('RESULT: built');
  process.exit(0);
}

// ---------- --tag ----------
if (mode === 'tag') {
  // The release to tag: the one named, or the newest merged and not tagged.
  let version = args.version?.replace(/^v/, '') ?? null;
  let merge = null;
  if (version) {
    const found = git('log', '--first-parent', '--merges', '--format=%H%x1f%s', mainRef).out.split('\n').map((l) => l.split('\x1f')).find(([, s]) => s && new RegExp(`^${cfg.release.subject}: ${prefix}${version.replace(/\./g, '\\.')} \\(#\\d+\\)$`).test(s));
    if (found) merge = found[0];
  } else {
    const h = releaseHistory(git, mainRef, cfg);
    if (h.untagged) ({ version, sha: merge } = h.untagged);
  }
  if (!version) {
    log(`no release on ${main} waits for its tag`);
    console.log('RESULT: nothing to tag');
    process.exit(0);
  }
  const tag = `${prefix}${version}`;
  if (!merge) refuse(`no merge commit "${cfg.release.subject}: ${tag} (#<pr>)" on ${main}: merge the release first (merge.mjs --change)`);
  const existing = git('rev-parse', '--verify', '-q', `refs/tags/${tag}^{commit}`);
  if (existing.ok) {
    if (existing.out === merge) {
      log(`${tag} is already the tag of ${short(merge)}`);
      console.log('RESULT: tagged');
      process.exit(0);
    }
    refuse(`${tag} already exists, on ${short(existing.out)}, not on the release's merge commit ${short(merge)}`);
  }
  // The tag holds the code the qa agent built: only CHANGELOG.md and docs/ may differ.
  const record = recordPath(version);
  let built = null;
  try {
    built = JSON.parse(readFileSync(record, 'utf8'));
  } catch {}
  if (!built?.built) refuse(`no build of ${tag} is recorded in this clone (${String(record).split('\\').join('/')}): the qa agent's build (release.mjs --build) ran elsewhere or not at all, so this clone cannot tell the tag holds the built code`);
  const code = git('diff', '--name-only', built.built, merge, '--', '.', `:(exclude)docs`, `:(exclude)${cfg.release.changelog}`);
  if (!code.ok) refuse(`git cannot compare the built commit ${short(built.built)} with the merge commit ${short(merge)}: ${code.err}`);
  if (code.out) refuse(`the code of the merge commit ${short(merge)} differs from the code the qa agent built at ${short(built.built)}: ${main} moved under the release, so its tag would hold code nobody built or checked`, code.out.split('\n').slice(0, 10));
  // The message: the changelog's section as the merge commit holds it.
  const changelog = git('show', `${merge}:${cfg.release.changelog}`);
  const section = changelog.ok ? changelogSectionOf(changelog.raw, version, cfg) : null;
  if (!section) refuse(`${cfg.release.changelog} at ${short(merge)} has no section ${tag}`);
  const message = join(record, '..', `${tag}.md`);
  writeFileSync(message, `${section}\n`);
  const m = message.split('\\').join('/');
  const remote = git('remote').out.split('\n').includes('origin');
  const files = (built.artifacts ?? []).filter((a) => a.kind === 'file');
  const folders = (built.artifacts ?? []).filter((a) => a.kind !== 'file');
  const steps = [
    { note: `from the project folder, ${where}: the annotated tag on the release's merge commit, its message the changelog's section (verbatim keeps its headings)` },
    { run: `git tag -a ${tag} ${merge} -F "${m}" --cleanup=verbatim` },
    ...(remote
      ? [
          { run: `git push origin ${tag}` },
          { note: `then, to publish the build${files.length ? '' : ' (it named no file to upload)'}, a GitHub release with the same notes` },
          { run: `gh release create ${tag}${files.map((a) => ` "${a.path}"`).join('')} --title ${tag} --notes-file "${m}"` },
        ]
      : [{ note: 'this project has no remote origin: the tag stays in this clone' }]),
    ...(folders.length ? [{ note: `the build also made ${folders.map((a) => a.path).join(', ')}, a folder: zip it to upload it` }] : []),
  ];
  printHandoff(`${tag} is merged as ${short(merge)}, its code the one the qa agent built: the tag and its publication are yours (pitwall ADR-0013).`, steps);
  console.log('RESULT: handed to the owner');
  process.exit(3);
}
