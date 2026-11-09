// The work of pitwall's hooks (T3a), one function per event; hook.mjs calls run() and prints
// what it returns. The guard's decisions are in hook-guard.mjs.
//
// State lives in one folder per session under PITWALL_HOOK_STATE, or the account's own folder in
// the system temp folder:
// a file per agent with one byte per tool call (T3a-AC5), and markers for the checks (T3a-AC6).

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { config, ghRunner, parseJson, pluginRoot, pluginVersion, readGate, readReview } from './lib.mjs';
import { guard, norm } from './hook-guard.mjs';

const FILE_WRITES = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

function git(args, dir) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  return { ok: !r.error && r.status === 0, status: r.error ? -1 : r.status, out: (r.stdout ?? '').trim(), err: `${r.stderr ?? ''}${r.error?.message ?? ''}`.trim() };
}

// The account, so two users of one machine keep apart state folders.
function account() {
  try {
    return safe(userInfo().username);
  } catch {
    return safe(process.getuid?.() ?? 'user');
  }
}

const safe = (s) => String(s ?? 'unknown').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
const lastLine = (text) => String(text).trim().split('\n').pop();

export function run(event, input, root) {
  const cfg = config();
  const settings = parseJson(readFileSync(join(root, '.claude', 'pitwall.json'), 'utf8'));
  if (!settings || typeof settings !== 'object') throw new Error('.claude/pitwall.json is not JSON');
  const dir = join(process.env.PITWALL_HOOK_STATE || join(tmpdir(), `pitwall-${account()}`), safe(input.session_id));
  mkdirSync(dir, { recursive: true });
  const key = input.agent_id ? `agent-${safe(input.agent_id)}` : 'main';
  const s = { cfg, settings, root, dir, key, input };
  if (event === 'session-start') return sessionStart(s);
  if (event === 'pre-tool-use') return preToolUse(s);
  if (event === 'post-tool-use') return postToolUse(s);
  if (event === 'stop' || event === 'subagent-stop') return stop(s, event);
  throw new Error(`unknown hook event "${event}"`);
}

// Creates a marker once: true the first time.
function once(dir, name) {
  try {
    writeFileSync(join(dir, name), '', { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

function guardContext({ cfg, settings, root, input }) {
  return {
    root,
    home: homedir(),
    pluginRoot,
    pluginRoots: [process.env.CLAUDE_PLUGIN_ROOT],
    cfg,
    settings,
    cwd: input.cwd || root,
    git,
    checkPr: (selector) => checkPr(selector, root, cfg),
  };
}

// ---- PreToolUse: the call budget, then the guard (T3a-AC3, AC4, AC5, AC7) ----

function budgetFor({ cfg, settings, input }) {
  const b = cfg.budgets;
  if (!input.agent_id) return { ...b.sessionToolCalls, name: 'budgets.sessionToolCalls' };
  if (input.agent_type === 'pitwall:researcher' && b.researcherToolCalls[settings.processLevel]) {
    return { ...b.researcherToolCalls[settings.processLevel], name: `budgets.researcherToolCalls.${settings.processLevel}` };
  }
  return { ...b.subagentToolCalls, name: 'budgets.subagentToolCalls' };
}

const deny = (rule, reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `pitwall refused this call (${rule}): ${reason}` } });

function preToolUse(s) {
  const { cfg, input, dir, key } = s;
  const tool = input.tool_name;
  if (typeof tool !== 'string') throw new Error('the input names no tool');
  // A sub-agent hands its report back through a tool call: the budget and the guards never refuse it,
  // and Claude Code ends the sub-agent there, so an implementer's check before stopping runs here.
  if (cfg.hooks.handback.includes(tool)) {
    if (!input.agent_id || !cfg.hooks.implementers.includes(input.agent_type)) return null;
    const check = checkBeforeStop(s, input.agent_type);
    if (check?.block) return deny('gate', check.block);
    // The sub-agent ends with this handback: a gate that could not run is not run again at its SubagentStop.
    rmSync(join(s.dir, `${s.key}.dirty`), { force: true });
    return check?.message ? { systemMessage: check.message } : null;
  }

  const file = join(dir, `${key}.calls`);
  appendFileSync(file, '.');
  const n = statSync(file).size;
  const budget = budgetFor(s);
  const main = !input.agent_id;
  const unattended = process.env.CLAUDE_CODE_SESSION_ATTENDED === '0';
  if (n > budget.stop && (!main || unattended)) {
    return deny('budget', main
      ? `this unattended session has used its ${budget.stop} tool calls (${budget.name}.stop): record where the work stands and end the session.`
      : `this agent has used its ${budget.stop} tool calls (${budget.name}.stop): return your report now, PARTIAL with a handoff.`);
  }

  const refusal = guard({ tool, input: input.tool_input ?? {}, agentId: input.agent_id, agentType: input.agent_type }, guardContext(s));
  if (refusal) return deny(refusal.rule, refusal.reason);

  let note = null;
  if (n >= budget.warn && once(dir, `${key}.warned`)) {
    note = main
      ? `pitwall: this session has made ${n} tool calls; ${budget.name} warns at ${budget.warn} and stops at ${budget.stop}. Record where the work stands and suggest a fresh session to the owner.`
      : `pitwall: this agent has made ${n} of its ${budget.stop} tool calls (${budget.name}). Wrap up: finish the step you are on and return PARTIAL with a handoff.`;
  }
  if (main && n >= budget.stop && once(dir, 'main.stopped')) {
    note = `pitwall: this session has made ${n} tool calls, its budget (${budget.name}.stop). Record where the work stands and suggest a fresh session to the owner${unattended ? '; the session is unattended, so its next call is refused' : ''}.`;
  }
  return note ? { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: note } } : null;
}

// The merge guard's read of a PR in the mode local-hook (T3a-AC7): a reason to refuse, or null.
function checkPr(selector, root, cfg) {
  const gh = ghRunner(root, 'hook');
  let sel = selector;
  if (!sel) {
    const b = git(['symbolic-ref', '--short', '-q', 'HEAD'], root);
    if (!b.ok) return 'the command names no PR, and there is no current branch to find one by.';
    sel = b.out;
  }
  const view = gh(['pr', 'view', sel, '--json', 'number,headRefOid,state']);
  const pr = view.ok ? parseJson(view.out) : null;
  if (!pr?.headRefOid) return `merge protection is local-hook, and gh could not read the PR ${sel} (${lastLine(view.err || view.out)}): nothing merges unchecked.`;
  const repo = gh(['repo', 'view', '--json', 'nameWithOwner']);
  const name = repo.ok ? parseJson(repo.out)?.nameWithOwner : null;
  if (!name) return `merge protection is local-hook, and gh could not read the repository (${lastLine(repo.err || repo.out)}): nothing merges unchecked.`;
  const sha = pr.headRefOid;
  const at = `${sha.slice(0, 7)}, the head of PR #${pr.number}`;
  const r = readReview(gh, name, sha, cfg);
  if (r.failed) return `merge protection is local-hook, and gh could not read the ${r.failed} of ${at} (${lastLine(r.read.err || r.read.out)}): nothing merges unchecked.`;
  const g = readGate(gh, name, sha, cfg);
  if (g.failed) return `merge protection is local-hook, and gh could not read the ${g.failed} of ${at} (${lastLine(g.read.err || g.read.out)}): nothing merges unchecked.`;
  if (r.review?.state !== 'success') return `merge protection is local-hook: ${cfg.review.statusContext} is ${r.review?.state ?? 'not set'} on ${at}.`;
  if (g.foreign) return `merge protection is local-hook: the ${cfg.review.gateContext} check on ${at} comes from app ${g.foreign.app?.id ?? 'unknown'}, not GitHub Actions.`;
  if (!g.gate) return `merge protection is local-hook: there is no ${cfg.review.gateContext} check from GitHub Actions on ${at}.`;
  if (g.gate.status !== 'completed') return `merge protection is local-hook: ${cfg.review.gateContext} is still ${g.gate.status} on ${at}.`;
  if (g.gate.conclusion !== 'success') return `merge protection is local-hook: ${cfg.review.gateContext} is ${g.gate.conclusion} on ${at}.`;
  return null;
}

// ---- PostToolUse and Stop: the gate after edits and before stopping (T3a-AC6) ----

function runGate(root, mode, seconds) {
  if (!existsSync(join(root, 'scripts', 'gate'))) return { missing: true };
  // As CI runs it (the template's ci.yml): through bash, so a gate without the executable bit still runs.
  const r = spawnSync('bash', ['scripts/gate', mode], { cwd: root, encoding: 'utf8', timeout: seconds * 1000, maxBuffer: 16 * 1024 * 1024 });
  if (r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM') return { timedOut: true };
  if (r.error) return { error: r.error.message };
  return { status: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const tail = (text, chars) => (text.length > chars ? `...${text.slice(-chars)}` : text).trim();

function postToolUse({ cfg, input, root, dir, key }) {
  if (!FILE_WRITES.includes(input.tool_name)) return null;
  const file = input.tool_name === 'NotebookEdit' ? input.tool_input?.notebook_path : input.tool_input?.file_path;
  if (!file) return null;
  const p = norm(String(file), input.cwd || root, homedir());
  const r = norm(root);
  if (!p.startsWith(`${r}/`) || p.startsWith(`${r}/docs/`) || p.startsWith(`${r}/.git/`)) return null;
  const branch = git(['symbolic-ref', '--short', '-q', 'HEAD'], root).out;
  if (!branch.startsWith('epic/')) return null;
  // An implementer answers for its own edits; any other sub-agent's edits are the main conversation's.
  const owner = input.agent_id && !cfg.hooks.implementers.includes(input.agent_type) ? 'main' : key;
  writeFileSync(join(dir, `${owner}.dirty`), branch);
  const seconds = cfg.hooks.gateTimeoutSeconds.fast;
  const g = runGate(root, '--fast', seconds);
  const say = (text) => ({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } });
  if (g.missing) return say('pitwall: there is no scripts/gate to check this edit with. E0 adds it (E0-AC1).');
  if (g.error) return say(`pitwall: scripts/gate --fast could not run after this edit (${g.error}); the edit is not checked.`);
  if (g.timedOut) return say(`pitwall: scripts/gate --fast did not finish in ${seconds} seconds after this edit; that is not counted as red.`);
  if (g.status === 0) return null;
  return say(`pitwall: scripts/gate --fast is red after this edit (exit ${g.status}). The edit stays; fix what the gate reports:\n${tail(g.output, cfg.hooks.gateOutputChars)}`);
}

// The check before an agent stops, after an edit outside docs/ on an epic branch: { block: reason },
// { message } for the owner, or null. A red gate holds the agent back at most hooks.stopRetries
// times in all until the gate is green again, however many edits come between.
function checkBeforeStop({ cfg, root, dir, key }, who) {
  const dirty = join(dir, `${key}.dirty`);
  if (!existsSync(dirty)) return null;
  const branch = readFileSync(dirty, 'utf8');
  const seconds = cfg.hooks.gateTimeoutSeconds.changed;
  const g = runGate(root, '--changed', seconds);
  if (g.missing) {
    rmSync(dirty, { force: true });
    return null;
  }
  if (g.error) return { message: `pitwall: scripts/gate --changed could not run before ${who} stopped (${g.error}); the edits on ${branch} are not checked.` };
  if (g.timedOut) return { message: `pitwall: scripts/gate --changed did not finish in ${seconds} seconds before ${who} stopped; that is not counted as red, and it runs again at the next stop.` };
  const retries = join(dir, `${key}.retries`);
  if (g.status === 0) {
    rmSync(dirty, { force: true });
    rmSync(retries, { force: true });
    return null;
  }
  const tries = Number(existsSync(retries) ? readFileSync(retries, 'utf8') : 0) || 0;
  const max = cfg.hooks.stopRetries;
  if (tries >= max) {
    // The tries stay used up until the gate is green; the next edit runs the gate at the next stop again.
    rmSync(dirty, { force: true });
    return { message: `pitwall: scripts/gate --changed is still red on ${branch} after ${max} tries; ${who} stops with it red.` };
  }
  writeFileSync(retries, String(tries + 1));
  return { block: `pitwall: scripts/gate --changed is red (exit ${g.status}) after the edits on ${branch}. Fix it before you stop (try ${tries + 1} of ${max}); if you cannot, stop and report PARTIAL with what the gate says:\n${tail(g.output, cfg.hooks.gateOutputChars)}` };
}

function stop(s, event) {
  const { cfg, input } = s;
  // A sub-agent that ends without a handback: the implementers only.
  if (event === 'subagent-stop' && !cfg.hooks.implementers.includes(input.agent_type)) return null;
  const check = checkBeforeStop(s, event === 'stop' ? 'the session' : input.agent_type);
  if (check?.block) return { decision: 'block', reason: check.block };
  return check?.message ? { systemMessage: check.message } : null;
}

// ---- SessionStart: the brief and the self-test (T3a-AC1, T3a-AC2) ----

const older = (a, b) => {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0);
  return false;
};

// The first epic in docs/EPICS.md whose status is neither merged nor released.
function currentEpic(root) {
  const path = join(root, 'docs', 'EPICS.md');
  if (!existsSync(path)) return 'docs/EPICS.md is missing.';
  const rows = readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l.startsWith('|')).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
  for (const cells of rows.slice(2)) {
    const status = cells[cells.length - 1] ?? '';
    if (/^(merged|released)\b/i.test(status)) continue;
    const link = /^\[([^\]]+)\]\(([^)]+)\)/.exec(cells[0] ?? '');
    const id = link ? link[1] : cells[0];
    let open = '';
    if (link && existsSync(join(root, 'docs', link[2]))) {
      const ids = [...readFileSync(join(root, 'docs', link[2]), 'utf8').matchAll(/^- \[ \] ([A-Z]+\d+[a-z]?-AC\d+):/gm)].map((m) => m[1]);
      open = ids.length ? `; unchecked: ${ids.join(', ')}` : '; every criterion is checked';
    }
    return `${id}, "${cells[1] ?? ''}", is ${status || 'without a status'} (docs/${link ? link[2] : 'EPICS.md'})${open}.`;
  }
  return 'docs/EPICS.md has no epic that is not merged or released.';
}

// While the plan is being made (on the planning branch, or while main holds only the skeleton):
// the first stage whose docs check does not pass yet. Null once planning is over.
function planningStage(root, cfg, branch) {
  const plan = cfg.planning.branch;
  // main with one commit is the skeleton; with none yet (or unreadable), kickoff has not committed it.
  const count = git(['rev-list', '--count', `refs/heads/${cfg.mergeProtection.branch}`], root);
  if (branch !== plan && count.ok && Number(count.out) > 1) return null;
  const spikes = existsSync(join(root, 'docs', 'spikes')) && readdirSync(join(root, 'docs', 'spikes')).some((f) => f.endsWith('.md') && !['README.md', 'template.md'].includes(f));
  const stages = ['kickoff', 'discovery', 'decide', ...(spikes ? ['spike'] : []), 'plan', 'plan-review'];
  for (const stage of stages) {
    const r = spawnSync(process.execPath, [join(pluginRoot, 'scripts', 'docs-check.mjs'), '--root', root, '--stage', stage], { encoding: 'utf8' });
    if (r.status !== 0) return `planning on ${plan}; the next stage is ${stage} (its docs check does not pass yet): /pitwall:${stage === 'plan-review' ? 'plan' : stage}.`;
  }
  return `planning on ${plan}; the plan is reviewed and waits for its merge: /pitwall:plan.`;
}

function selfTest(s) {
  const ctx = guardContext(s);
  const write = guard({ tool: 'Write', input: { file_path: join(s.root, '.claude', 'pitwall.json'), content: '{}' } }, ctx);
  const push = guard({ tool: 'Bash', input: { command: `git push --force origin ${s.cfg.mergeProtection.branch}` } }, ctx);
  if (write?.rule !== 'switch') return 'the guard let an edit of .claude/pitwall.json through';
  if (push?.rule !== 'push') return 'the guard let a forced push to main through';
  return null;
}

function sessionStart(s) {
  const { cfg, settings, root } = s;
  const lines = ['pitwall brief, from its session hook:'];
  const plugin = pluginVersion();
  const tv = settings.templateVersion;
  lines.push(`- Project: process level ${settings.processLevel}, merge protection ${settings.mergeProtection}, laid out from pitwall ${tv}${tv && older(tv, plugin) ? `, older than this plugin's ${plugin}: the template may have changed since` : ''}.`);
  const branch = git(['symbolic-ref', '--short', '-q', 'HEAD'], root);
  const status = git(['status', '--porcelain'], root);
  if (!status.ok) lines.push('- Git: not a git repository, or git does not run here.');
  else {
    const changed = status.out ? status.out.split('\n').length : 0;
    lines.push(`- Branch: ${branch.ok ? branch.out : 'a detached HEAD'}, ${changed ? `${changed} changed or untracked files` : 'tree clean'}.`);
  }
  const stage = branch.ok ? planningStage(root, cfg, branch.out) : null;
  lines.push(stage ? `- Stage: ${stage}` : `- Current epic: ${currentEpic(root)}`);
  const b = cfg.budgets.sessionToolCalls;
  const attended = process.env.CLAUDE_CODE_SESSION_ATTENDED;
  lines.push(
    attended === '0'
      ? `- Budget: this session is unattended; it is warned at ${b.warn} tool calls and refused past ${b.stop} (budgets.sessionToolCalls).`
      : attended === '1'
        ? `- Budget: this session is warned at ${b.warn} and ${b.stop} tool calls (budgets.sessionToolCalls) and never refused, since the owner is here.`
        : `- Budget: Claude Code did not say whether anyone attends this session, so the budget warns at ${b.warn} and ${b.stop} tool calls but cannot stop it.`,
  );
  const failed = selfTest(s);
  lines.push(failed ? `- Hooks: the self-test FAILED: ${failed}.` : '- Hooks: the guards are on (secrets, ignored files, pushes to main, their own switch, merge protection, ai-review, the call budget), and the self-test passed.');
  const brief = lines.join('\n').slice(0, cfg.hooks.briefMaxChars);
  const out = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: brief } };
  if (failed) out.systemMessage = `pitwall: the self-test of its guards failed: ${failed}. To turn pitwall off in this project, the owner runs: claude plugin disable pitwall@pitwall --scope local`;
  return out;
}
