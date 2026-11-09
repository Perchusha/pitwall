// The allow rules of ADR-0010 (T3b-AC6), shared by merge-choice.mjs, which the owner runs, and the
// session-start hook, which writes them again when the plugin's path changes.
//
// On the owner's yes, .claude/settings.local.json allows exactly two commands, each by the absolute
// path of the plugin's script, so that the review status and a merge by risk class run without a
// prompt and without the auto mode classifier, which refuses both by default:
//   Bash(node "<plugin>/scripts/review-status.mjs" *)     its arguments are free; the guard runs it
//                                                         for the two reviewers only (T3a-AC4)
//   Bash(node "<plugin>/scripts/merge.mjs" --change)      exact, no wildcard: --owner-approved never
//                                                         runs under the rule, and merge.mjs itself
//                                                         merges only low and normal risk this way
// They are written only while the review guard works: hooks.json registers it, and it refuses
// review-status.mjs to the main conversation and to an implementer and lets the code reviewer run it.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { guard } from './hook-guard.mjs';

// A byte order mark (Windows PowerShell 5.1 writes one) is not part of the JSON; built from its code point (L-3).
const BOM = new RegExp(`^${String.fromCodePoint(0xfeff)}`);

// The plugin's folder as the session spells it: CLAUDE_PLUGIN_ROOT, with its own separators.
export function allowRules(pluginDir) {
  const at = (script) => `${String(pluginDir).replace(/[\\/]+$/, '')}/scripts/${script}`;
  return [`Bash(node "${at('review-status.mjs')}" *)`, `Bash(node "${at('merge.mjs')}" --change)`];
}

// A rule this file writes, for any plugin path: the ones to replace when the path changes.
export const isPitwallRule = (rule) => /^Bash\(node "[^"]+[\\/]scripts[\\/](?:review-status\.mjs" \*|merge\.mjs" --change)\)$/.test(String(rule));

// Makes .claude/settings.local.json hold the rules for pluginDir (want) or none of them, and keeps
// everything else in it. Returns { changed } or { error } when the file does not read as settings.
export function syncRules(projectRoot, pluginDir, want) {
  const file = join(projectRoot, '.claude', 'settings.local.json');
  let settings = {};
  if (existsSync(file)) {
    try {
      settings = JSON.parse(readFileSync(file, 'utf8').replace(BOM, ''));
    } catch (e) {
      return { error: `does not parse as JSON (${String(e.message).split('\n')[0]})` };
    }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return { error: 'is not a JSON object' };
    if (settings.permissions !== undefined && (typeof settings.permissions !== 'object' || Array.isArray(settings.permissions))) return { error: 'has a "permissions" that is not an object' };
    if (settings.permissions?.allow !== undefined && !Array.isArray(settings.permissions.allow)) return { error: 'has a "permissions.allow" that is not a list' };
  } else if (!want) return { changed: false };
  const before = settings.permissions?.allow ?? [];
  const wanted = want ? allowRules(pluginDir) : [];
  // The rules already there, in any order, are left as they are: a session start rewrites nothing it need not.
  const current = before.filter(isPitwallRule);
  if (current.length === wanted.length && wanted.every((r) => current.includes(r))) return { changed: false };
  const after = [...before.filter((r) => !isPitwallRule(r)), ...wanted];
  settings.permissions = { ...(settings.permissions ?? {}), allow: after };
  if (after.length === 0) delete settings.permissions.allow;
  if (Object.keys(settings.permissions).length === 0) delete settings.permissions;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  return { changed: true };
}

// Null when the review guard is installed and works for the project, else what is wrong.
export function guardWorks(projectRoot, pluginDir, cfg, settings) {
  const hooksFile = join(pluginDir, 'hooks', 'hooks.json');
  let hooks;
  try {
    hooks = JSON.parse(readFileSync(hooksFile, 'utf8'));
  } catch {
    return `${hooksFile} does not read`;
  }
  const pre = (hooks?.hooks?.PreToolUse ?? []).flatMap((m) => (m.matcher === '*' ? m.hooks ?? [] : []));
  if (!pre.some((h) => /scripts\/hook\.mjs"? pre-tool-use/.test(h.command ?? '') && h.onFailure === 'block')) return 'hooks.json registers no guard on every tool call that blocks when it fails';
  const git = (args, dir) => {
    const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
    return { ok: !r.error && r.status === 0, status: r.error ? -1 : r.status, out: (r.stdout ?? '').trim(), err: `${r.stderr ?? ''}${r.error?.message ?? ''}`.trim() };
  };
  const ctx = { root: projectRoot, home: homedir(), pluginRoot: pluginDir, pluginRoots: [], cfg, settings, cwd: projectRoot, git, checkPr: () => 'not read here' };
  const call = { tool: 'Bash', input: { command: `node "${pluginDir}/scripts/review-status.mjs" --review code --state success` } };
  if (guard(call, ctx)?.rule !== 'review') return 'the guard let the main conversation run review-status.mjs';
  if (guard({ ...call, agentId: 'self-test', agentType: cfg.hooks.implementers[0] }, ctx)?.rule !== 'review') return `the guard let ${cfg.hooks.implementers[0]} run review-status.mjs`;
  const reviewer = cfg.hooks.reviewers.find((r) => r.endsWith(':code-reviewer'));
  const r = guard({ ...call, agentId: 'self-test', agentType: reviewer }, ctx);
  if (r) return `the guard refused review-status.mjs to ${reviewer} (${r.rule}: ${r.reason})`;
  return null;
}
