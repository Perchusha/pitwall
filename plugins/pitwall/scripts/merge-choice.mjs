#!/usr/bin/env node
// Records the owner's choice of ADR-0010 (T3b-AC6): may low and normal risk epics merge without
// the owner once gate and ai-review are green?
//
//   node merge-choice.mjs --allow | --deny [--project <dir>]
//
// The answer is the owner's (ADR-0010). The main conversation that asked the question runs this
// itself, and pitwall's guard sends that one command to Claude Code's permission prompt, whatever the
// session's mode or allow rules (hooks.ownerOnly): the owner's yes at the prompt is what lets it
// run, and pitwall never writes an allow rule for it. Under Claude Code, which sets CLAUDECODE in
// every command it runs, the script therefore runs only when the guard has just left its note of
// that prompt for this project and this answer (lib.mjs ownerPromptFile, in the git directory), and takes the note away:
// with the hooks off, or through another command line, it refuses. No sub-agent runs it. In a
// terminal of the owner's own it runs as it always did, which is the way when nobody can answer a
// prompt (a headless session, a mode that never asks); the session then hands the owner this
// command (L-6).
//
// It writes the answer into .claude/pitwall.json (loop.ownerChoice, autoMerge). --allow also writes
// the two allow rules of merge-rules.mjs into .claude/settings.local.json, which stays on this
// machine, but only when the review guard works (merge-rules.mjs guardWorks); otherwise it records
// nothing and says why. --deny removes the rules. The session-start hook writes the rules again,
// with the plugin's path as the session spells it, whenever the answer is yes.
//
// Exit 0 recorded, 1 refused, 2 usage.

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config, ownerPromptFile, parseArgs, pluginRoot, requireNode, samePath, writeJson } from './lib.mjs';
import { guardWorks, syncRules } from './merge-rules.mjs';

requireNode();
const usage = 'node merge-choice.mjs --allow | --deny [--project <dir>]';
const args = parseArgs(process.argv.slice(2), { allow: 'switch', deny: 'switch', project: 'value' }, usage);
if (Boolean(args.allow) === Boolean(args.deny)) {
  console.error(`merge-choice: give --allow or --deny\nusage: ${usage}`);
  process.exit(2);
}
const refuse = (msg) => {
  console.log(`merge-choice: REFUSED - ${msg}`);
  console.log('RESULT: not recorded');
  process.exit(1);
};
const cfg = config();
const project = resolve(args.project ?? '.');
const file = join(project, '.claude', 'pitwall.json');
if (!existsSync(file)) refuse(`${project} is not a pitwall project: there is no .claude/pitwall.json. Run it from the project folder, or pass --project.`);
if (process.env.CLAUDECODE) {
  // The guard's note of the permission prompt: this project, this answer, not long ago, and used once.
  const noteFile = ownerPromptFile(project, cfg);
  let note = null;
  try {
    note = JSON.parse(readFileSync(noteFile, 'utf8'));
  } catch {}
  if (noteFile) rmSync(noteFile, { force: true });
  const asked = Boolean(note) && note.project === samePath(project) && Array.isArray(note.flags) && note.flags.includes(args.allow ? '--allow' : '--deny') && !note.flags.includes(args.allow ? '--deny' : '--allow');
  const age = asked ? Date.now() - Number(note.at) : NaN;
  if (!asked || !(age >= 0 && age < cfg.hooks.ownerPromptMinutes * 60000)) {
    refuse(
      `this records a choice of the owner (pitwall ADR-0010), so inside Claude Code it runs only right after pitwall's guard sent this very command to Claude Code's permission prompt, and ${asked ? `that was more than ${cfg.hooks.ownerPromptMinutes} minutes ago: the same command once more asks the owner again` : 'it did not (the hooks are off, the command names another answer or another project, or this session cannot read the guard\'s note): the owner runs it in a terminal of their own'}.`,
    );
  }
}
let settings;
try {
  settings = JSON.parse(readFileSync(file, 'utf8').replace(new RegExp(`^${String.fromCodePoint(0xfeff)}`), ''));
} catch (e) {
  refuse(`.claude/pitwall.json does not parse: ${String(e.message).split('\n')[0]}`);
}
const allow = Boolean(args.allow);
const key = cfg.loop.ownerChoice;

if (allow) {
  const broken = guardWorks(project, pluginRoot, cfg, settings);
  if (broken) refuse(`the review guard does not work here (${broken}), and the allow rules are written only while it does (pitwall ADR-0010). Nothing was recorded.`);
}
// The session spells the plugin's folder its own way (CLAUDE_PLUGIN_ROOT): the rules go in for both spellings
// of this one, and the next session start keeps only the session's.
const rules = syncRules(project, [pluginRoot, pluginRoot.split('\\').join('/')], allow);
if (rules.error) refuse(`.claude/settings.local.json ${rules.error}: fix it by hand, then run this again. Nothing was recorded.`);
const was = settings[key];
settings[key] = allow;
writeJson(file, settings);

console.log(`merge-choice: .claude/pitwall.json records ${key}: ${allow}${was === allow ? ' (as before)' : ''}`);
console.log(
  allow
    ? `merge-choice: low and normal risk epics now merge without you once gate and ai-review are green; high risk and bug fixes still wait for you. .claude/settings.local.json ${rules.changed ? 'now allows' : 'already allowed'} review-status.mjs and "merge.mjs --change" from ${pluginRoot}; each session start writes them again for the plugin's path as that session spells it.`
    : `merge-choice: every merge waits for your yes. ${rules.changed ? 'The allow rules were removed from .claude/settings.local.json.' : '.claude/settings.local.json holds no allow rules of pitwall.'}`,
);
console.log('merge-choice: the session commits .claude/pitwall.json with its next change.');
console.log('RESULT: recorded');
