#!/usr/bin/env node
// pitwall's hooks (T3a). hooks/hooks.json runs this for each event it registers:
//
//   node hook.mjs session-start | pre-tool-use | post-tool-use | stop | subagent-stop
//
// with the event's JSON on stdin. Outside a pitwall project, a folder without
// .claude/pitwall.json at CLAUDE_PROJECT_DIR, it prints nothing. Otherwise it prints its answer
// as JSON and exits 0. When it cannot do its job, a guard refuses the call and every other hook
// lets the session go on, each saying what broke (T3a-AC1).
//
// This file still loads on an old Node, so it can say that the hooks need a newer one; the work
// is in hook-events.mjs and hook-guard.mjs. PITWALL_HOOK_RECORD, a file, gets every input as a
// JSON line: scripts/e2e.mjs --hooks --record uses it to record the payloads the checks run on.

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

var here = dirname(fileURLToPath(import.meta.url));
var event = process.argv[2];
var OFF = 'To turn pitwall off in this project, run this yourself in a terminal, not through an agent (the guard stops an agent that tries): claude plugin disable pitwall@pitwall --scope local';

function print(answer) {
  if (answer) process.stdout.write(JSON.stringify(answer));
  process.exit(0);
}

// What each hook says when it cannot run: the guard refuses, the others let the session go on.
function broken(what) {
  if (event === 'pre-tool-use') {
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'pitwall refused this call (broken): its guard could not run: ' + what + '. ' + OFF + '.' } };
  }
  if (event === 'session-start') {
    var text = 'pitwall: ' + what + '. Its guards refuse every tool call until this is fixed. ' + OFF + '.';
    return { systemMessage: text, hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } };
  }
  if (event === 'post-tool-use') {
    return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'pitwall: the check after this edit could not run: ' + what + '. The session goes on without it.' } };
  }
  return { systemMessage: 'pitwall: the check before stopping could not run: ' + what + '. The session goes on without it.' };
}

var raw = '';
try {
  raw = readFileSync(0, 'utf8');
} catch (e) {}
var input = null;
try {
  input = JSON.parse(raw);
} catch (e) {}
if (process.env.PITWALL_HOOK_RECORD) {
  try {
    appendFileSync(process.env.PITWALL_HOOK_RECORD, JSON.stringify({ event: event, input: input, attended: process.env.CLAUDE_CODE_SESSION_ATTENDED === undefined ? null : process.env.CLAUDE_CODE_SESSION_ATTENDED }) + '\n');
  } catch (e) {}
}

var root = process.env.CLAUDE_PROJECT_DIR || (input && input.cwd) || process.cwd();
if (!existsSync(join(root, '.claude', 'pitwall.json'))) process.exit(0);

var need = 0;
try {
  need = JSON.parse(readFileSync(join(here, '..', 'config', 'defaults.json'), 'utf8')).runtime.nodeMinMajor;
} catch (e) {
  print(broken('the plugin config does not read (' + e.message + ')'));
}
if (Number(process.versions.node.split('.')[0]) < need) {
  print(broken('the hooks need Node ' + need + ' or later, and this is Node ' + process.versions.node + '; install the LTS release from https://nodejs.org'));
}
if (!input || typeof input !== 'object') print(broken('the input from Claude Code is not JSON'));

import('./hook-events.mjs')
  .then(function (m) {
    print(m.run(event, input, root));
  })
  .catch(function (e) {
    print(broken(String((e && e.message) || e).split('\n')[0]));
  });
