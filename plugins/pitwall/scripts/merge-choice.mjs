#!/usr/bin/env node
// Records the owner's choice of ADR-0010 (T3b-AC6): may low and normal risk epics merge without
// the owner once gate and ai-review are green?
//
//   node merge-choice.mjs --allow | --deny [--project <dir>]
//
// The owner runs it in a terminal, never an agent: it refuses to run under Claude Code, which sets
// CLAUDECODE in every command it runs, and pitwall's guard refuses it to every agent, the main
// conversation included (hooks.ownerOnly). A session that asks the question hands the owner this
// command (L-6).
//
// It writes the answer into .claude/pitwall.json (loop.ownerChoice, autoMerge). --allow also writes
// the two allow rules of merge-rules.mjs into .claude/settings.local.json, which stays on this
// machine, but only when the review guard works (merge-rules.mjs guardWorks); otherwise it records
// nothing and says why. --deny removes the rules. The session-start hook writes the rules again,
// with the plugin's path as the session spells it, whenever the answer is yes.
//
// Exit 0 recorded, 1 refused, 2 usage.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config, parseArgs, pluginRoot, requireNode, writeJson } from './lib.mjs';
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
if (process.env.CLAUDECODE) refuse('this records a choice of the owner (pitwall ADR-0010), so it runs in your own terminal, not inside Claude Code: an agent never records it.');

const cfg = config();
const project = resolve(args.project ?? '.');
const file = join(project, '.claude', 'pitwall.json');
if (!existsSync(file)) refuse(`${project} is not a pitwall project: there is no .claude/pitwall.json. Run it from the project folder, or pass --project.`);
let settings;
try {
  settings = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  refuse(`.claude/pitwall.json does not parse: ${String(e.message).split('\n')[0]}`);
}
const allow = Boolean(args.allow);
const key = cfg.loop.ownerChoice;

if (allow) {
  const broken = guardWorks(project, pluginRoot, cfg, settings);
  if (broken) refuse(`the review guard does not work here (${broken}), and the allow rules are written only while it does (pitwall ADR-0010). Nothing was recorded.`);
}
const rules = syncRules(project, pluginRoot, allow);
if (rules.error) refuse(`.claude/settings.local.json ${rules.error}: fix it by hand, then run this again. Nothing was recorded.`);
const was = settings[key];
settings[key] = allow;
writeJson(file, settings);

console.log(`merge-choice: .claude/pitwall.json records ${key}: ${allow}${was === allow ? ' (as before)' : ''}`);
console.log(
  allow
    ? `merge-choice: low and normal risk epics now merge without you once gate and ai-review are green; high risk and bug fixes still wait for you. .claude/settings.local.json ${rules.changed ? 'now allows' : 'already allowed'} review-status.mjs and "merge.mjs --change" from ${pluginRoot}, and each session start writes them again for the plugin's path.`
    : `merge-choice: every merge waits for your yes. ${rules.changed ? 'The allow rules were removed from .claude/settings.local.json.' : '.claude/settings.local.json holds no allow rules of pitwall.'}`,
);
console.log('merge-choice: the session commits .claude/pitwall.json with its next change.');
console.log('RESULT: recorded');
