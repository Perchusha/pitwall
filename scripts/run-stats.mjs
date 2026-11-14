#!/usr/bin/env node
// The numbers of a run of pitwall in a project, taken from Claude Code's local transcripts of the
// owner's own sessions there (T5a-AC3): per stage, the questions put to the owner, the messages they
// typed, the time spent waiting for them, the tool calls and tokens of the main conversation and of
// every sub-agent, and the session's cost where Claude Code recorded one.
//
//   node scripts/run-stats.mjs --project <the project's folder> [--marks <file.json>] [--list]
//   node scripts/run-stats.mjs --transcripts <folder of .jsonl files> [--marks <file.json>] [--list]
//
// A tool for developing pitwall: not part of the plugin, and not a step of scripts/check.mjs, since
// CI has no transcripts. It reads the transcripts where they lie and writes nothing. What it prints
// quotes the owner's sessions, so its output is read in the terminal and summed up in
// docs/JOURNAL.md in other words: no transcript line enters the repository (L-13).
//
// A stage starts at each /pitwall:<skill> command and ends at the next one; where /pitwall:continue
// conducts, each stage skill's file the main conversation reads starts that stage. --list prints every
// question (Q<n>), every message the owner typed (M<n>) and every sub-agent (A<n>), so that a marks
// file can say how to count them:
//
//   { "unnecessary": ["Q7", "Q8"], "interventions": ["M3"], "answers": ["M1"], "unrelated": ["M12"] }
//
// A typed message counts as an answer when the assistant's message before it ended in a question,
// and as an intervention otherwise, unless the marks file says so. "unnecessary" marks a question
// the owner would rather not have been asked: theirs to judge, never the script's.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : '';
};
const usage = 'usage: node scripts/run-stats.mjs --project <dir> | --transcripts <dir> [--marks <file.json>] [--list]';
const known = ['--project', '--transcripts', '--marks', '--list'];
if (argv.some((a) => a.startsWith('--') && !known.includes(a)) || (!opt('project') && !opt('transcripts'))) {
  console.error(usage);
  process.exit(2);
}

// Claude Code keeps a project's transcripts in ~/.claude/projects/<the folder's path, every character
// other than a letter or a digit turned into "-">; on Windows the drive letter's case varies.
function transcriptsOf(project) {
  const base = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
  const want = resolve(project).replace(/[^A-Za-z0-9]/g, '-').toLowerCase();
  if (!existsSync(base)) return '';
  const hit = readdirSync(base).find((d) => d.toLowerCase() === want);
  return hit ? join(base, hit) : '';
}
const dir = opt('transcripts') ? resolve(opt('transcripts')) : transcriptsOf(opt('project'));
const files = dir && existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.jsonl')) : [];
if (files.length === 0) {
  console.log(`run-stats: no transcripts ${dir ? `in ${dir}` : `for ${opt('project')}`}: nothing to count (Claude Code deletes them after cleanupPeriodDays).`);
  process.exit(0);
}
let marks = {};
if (opt('marks')) {
  try {
    marks = JSON.parse(readFileSync(opt('marks'), 'utf8'));
  } catch (e) {
    console.error(`run-stats: ${opt('marks')} does not read as JSON: ${e.message}`);
    process.exit(2);
  }
}
const marked = (kind, id) => (marks[kind] ?? []).includes(id);

const readLines = (file) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
const textOf = (content) => (typeof content === 'string' ? content : (content ?? []).map((p) => (p.type === 'text' ? p.text : p.type === 'tool_result' ? textOf(p.content) : '')).join('\n'));
const ms = (ts) => (ts ? Date.parse(ts) : NaN);
const short = (s, n = 110) => String(s).replace(/\s+/g, ' ').trim().slice(0, n);

// Tokens of one transcript: each API message once, by its id, since a message is written once per block.
function tokens(lines) {
  const byId = new Map();
  for (const o of lines) if (o.type === 'assistant' && o.message?.usage && o.message.id) byId.set(o.message.id, o.message.usage);
  const sum = { out: 0, processed: 0, messages: byId.size };
  for (const u of byId.values()) {
    sum.out += u.output_tokens ?? 0;
    sum.processed += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  }
  return sum;
}
const toolCalls = (lines) => lines.reduce((n, o) => n + (o.type === 'assistant' ? (o.message?.content ?? []).filter((p) => p.type === 'tool_use').length : 0), 0);

// A message the owner typed: not a command, not a tool's answer, not a sub-agent's report, not a note of Claude Code's.
const NOT_TYPED = /^\s*(<local-command|<command-name>|<command-message>|<task-notification>|<system-reminder>|Another Claude session sent a message|\[Request interrupted|Caveat:|<bash-|<user-prompt-submit-hook>)/;

const sessions = [];
for (const f of files.sort()) {
  const lines = readLines(join(dir, f));
  const main = lines.filter((o) => !o.isSidechain);
  const id = f.replace(/\.jsonl$/, '');
  // Sub-agents of this session, each with its own transcript and a meta file that names the call that started it.
  const subDir = join(dir, id, 'subagents');
  const agents = new Map();
  if (existsSync(subDir)) {
    for (const a of readdirSync(subDir).filter((x) => x.endsWith('.jsonl'))) {
      let meta = {};
      try {
        meta = JSON.parse(readFileSync(join(subDir, a.replace(/\.jsonl$/, '.meta.json')), 'utf8'));
      } catch {}
      const al = readLines(join(subDir, a));
      const stamps = al.map((o) => ms(o.timestamp)).filter((x) => !Number.isNaN(x));
      agents.set(meta.toolUseId ?? a, { type: meta.agentType ?? '?', description: meta.description ?? '', calls: toolCalls(al), tokens: tokens(al), minutes: stamps.length ? (Math.max(...stamps) - Math.min(...stamps)) / 60000 : 0 });
    }
  }
  sessions.push({ id, main, agents, cost: lines.find((o) => o.type === 'cost-state') });
}

const stages = [];
const items = { Q: [], M: [], A: [] };
let stage = null;
const open = (name, o, session) => {
  stage = { name, session, start: ms(o.timestamp), end: ms(o.timestamp), lines: [], questions: [], refused: 0, typed: [], agents: [], waiting: 0 };
  stages.push(stage);
};
for (const s of sessions) {
  stage = null;
  let lastEvent = NaN;
  let lastAssistantText = '';
  const pendingAsk = new Map();
  for (const o of s.main) {
    const t = ms(o.timestamp);
    if (o.type !== 'user' && o.type !== 'assistant') continue;
    const content = o.message?.content;
    if (o.type === 'user' && !o.isMeta) {
      const text = textOf(typeof content === 'string' ? content : (content ?? []).filter((p) => p.type === 'text'));
      const cmd = /<command-name>\/(?:pitwall:)?([\w-]+)<\/command-name>/.exec(text);
      if (cmd && /<command-name>\/pitwall:/.test(text)) open(cmd[1], o, s.id);
      else if (text.trim() && !NOT_TYPED.test(text) && typeof content === 'string') {
        if (!stage) open('(before the first command)', o, s.id);
        const id = `M${items.M.length + 1}`;
        const asked = /\?\s*$/.test(lastAssistantText.trim().split(/\n\s*\n/).pop() ?? '');
        const kind = marked('unrelated', id) ? 'unrelated' : marked('interventions', id) ? 'intervention' : marked('answers', id) ? 'answer' : asked ? 'answer' : 'intervention';
        const m = { id, stage: stage.name, kind, waited: Number.isNaN(lastEvent) ? 0 : (t - lastEvent) / 60000, text: short(text.replace(/<\/?pasted_content[^>]*>/g, '')), after: short(lastAssistantText.trim().split('\n').pop() ?? '', 90) };
        items.M.push(m);
        stage.typed.push(m);
        stage.waiting += m.waited;
      }
      for (const p of Array.isArray(content) ? content : []) {
        if (p.type !== 'tool_result' || !pendingAsk.has(p.tool_use_id)) continue;
        const ask = pendingAsk.get(p.tool_use_id);
        pendingAsk.delete(p.tool_use_id);
        const answer = textOf(p.content);
        if (p.is_error || /InputValidationError/.test(answer)) {
          ask.stage.refused += ask.questions.length;
          continue;
        }
        const waited = (t - ask.at) / 60000;
        ask.stage.waiting += waited;
        ask.questions.forEach((q, i) => {
          const id = `Q${items.Q.length + 1}`;
          const item = { id, stage: ask.stage.name, unnecessary: marked('unnecessary', id), waited: i === 0 ? waited : 0, header: q.header ?? '', text: short(q.question, 140), options: (q.options ?? []).length, answer: short(new RegExp(`${q.question.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^=]*"="([^"]*)"`).exec(answer)?.[1] ?? '', 70) };
          items.Q.push(item);
          ask.stage.questions.push(item);
        });
      }
    }
    if (!stage) continue;
    stage.lines.push(o);
    if (!Number.isNaN(t)) {
      stage.end = t;
      lastEvent = t;
    }
    if (o.type === 'assistant') {
      for (const p of content ?? []) {
        if (p.type === 'text' && p.text.trim()) lastAssistantText = p.text;
        if (p.type !== 'tool_use') continue;
        // The conductor reads the stage's own skill file: that is where the stage starts.
        const led = p.name === 'Read' ? /skills[\\/]+([\w-]+)[\\/]+SKILL\.md$/.exec(String(p.input?.file_path ?? ''))?.[1] : null;
        if (led && led !== stage.name) {
          if (stage.name === 'continue' && stage.questions.length === 0 && stage.agents.length === 0 && stage.typed.length === 0) stage.name = led;
          else open(led, o, s.id);
        }
        if (p.name === 'AskUserQuestion') pendingAsk.set(p.id, { stage, at: t, questions: p.input?.questions ?? [] });
        if (p.name === 'Agent' || p.name === 'Task') {
          const sub = s.agents.get(p.id);
          const a = { id: `A${items.A.length + 1}`, stage: stage.name, type: p.input?.subagent_type ?? sub?.type ?? '?', description: p.input?.description ?? '', calls: sub?.calls ?? 0, tokens: sub?.tokens ?? { out: 0, processed: 0 }, minutes: sub?.minutes ?? 0 };
          items.A.push(a);
          stage.agents.push(a);
        }
      }
    }
  }
}

const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
const row = (cells) => `| ${cells.join(' | ')} |`;
console.log(`run-stats: ${sessions.length} session(s) in ${dir}\n`);
console.log(row(['Stage', 'Minutes', 'Waiting for the owner', 'Questions in a form', 'Unnecessary', 'Refused by the tool', 'Typed: answers', 'Typed: interventions', 'Main tool calls', 'Main tokens out / read', 'Sub-agents', 'Their tool calls', 'Their tokens out / read']));
console.log(row(Array(13).fill('---')));
const total = { minutes: 0, waiting: 0, q: 0, un: 0, refused: 0, ans: 0, int: 0, calls: 0, out: 0, processed: 0, agents: 0, acalls: 0, aout: 0, aprocessed: 0 };
for (const st of stages) {
  const tk = tokens(st.lines);
  const calls = toolCalls(st.lines);
  const byType = {};
  for (const a of st.agents) byType[a.type.replace(/^pitwall:/, '')] = (byType[a.type.replace(/^pitwall:/, '')] ?? 0) + 1;
  const acalls = st.agents.reduce((n, a) => n + a.calls, 0);
  const aout = st.agents.reduce((n, a) => n + a.tokens.out, 0);
  const aproc = st.agents.reduce((n, a) => n + a.tokens.processed, 0);
  const minutes = (st.end - st.start) / 60000;
  const ans = st.typed.filter((m) => m.kind === 'answer').length;
  const int = st.typed.filter((m) => m.kind === 'intervention').length;
  const un = st.questions.filter((q) => q.unnecessary).length;
  console.log(row([st.name, minutes.toFixed(1), st.waiting.toFixed(1), st.questions.length, un, st.refused, ans, int, calls, `${k(tk.out)} / ${k(tk.processed)}`, st.agents.length ? `${st.agents.length} (${Object.entries(byType).map(([t, n]) => `${n} ${t}`).join(', ')})` : '0', acalls, `${k(aout)} / ${k(aproc)}`]));
  total.minutes += minutes;
  total.waiting += st.waiting;
  total.q += st.questions.length;
  total.un += un;
  total.refused += st.refused;
  total.ans += ans;
  total.int += int;
  total.calls += calls;
  total.out += tk.out;
  total.processed += tk.processed;
  total.agents += st.agents.length;
  total.acalls += acalls;
  total.aout += aout;
  total.aprocessed += aproc;
}
console.log(row(['all', total.minutes.toFixed(1), total.waiting.toFixed(1), total.q, total.un, total.refused, total.ans, total.int, total.calls, `${k(total.out)} / ${k(total.processed)}`, total.agents, total.acalls, `${k(total.aout)} / ${k(total.aprocessed)}`]));
const unrelated = items.M.filter((m) => m.kind === 'unrelated').length;
if (unrelated) console.log(`\n${unrelated} typed message(s) marked unrelated to the run are in neither column.`);
console.log('\n"read" is every input token a request carried, cached ones included, summed over the requests; "out" is the output tokens.');
for (const s of sessions) {
  const c = s.cost;
  if (!c) continue;
  console.log(`\nSession ${s.id.slice(0, 8)}: $${Number(c.totalCostUSD).toFixed(2)} at API prices (Claude Code's own count, sub-agents included), ${(c.totalDuration / 3600000).toFixed(2)} h open, ${(c.totalAPIDuration / 3600000).toFixed(2)} h of model time, ${(c.totalToolDuration / 60000).toFixed(0)} min of tools.`);
  for (const [model, u] of Object.entries(c.modelUsage ?? {})) console.log(`  ${model}: $${Number(u.costUSD).toFixed(2)}, out ${k(u.outputTokens)}, cache read ${k(u.cacheReadInputTokens)}, cache written ${k(u.cacheCreationInputTokens)}, input ${k(u.inputTokens)}`);
}

if (argv.includes('--list')) {
  console.log('\n== questions in a form');
  for (const q of items.Q) console.log(`${q.id} [${q.stage}]${q.unnecessary ? ' UNNECESSARY' : ''} ${q.options} options, waited ${q.waited.toFixed(1)} min: (${q.header}) ${q.text} => ${q.answer}`);
  console.log('\n== messages the owner typed');
  for (const m of items.M) console.log(`${m.id} [${m.stage}] ${m.kind}, after ${m.waited.toFixed(1)} min: ${m.text}\n      following: ${m.after}`);
  console.log('\n== sub-agents');
  for (const a of items.A) console.log(`${a.id} [${a.stage}] ${a.type}: ${a.description}; ${a.calls} tool calls, ${a.minutes.toFixed(1)} min, tokens out ${k(a.tokens.out)} / read ${k(a.tokens.processed)}`);
}
