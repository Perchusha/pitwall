// The decisions of pitwall's PreToolUse guard (T3a-AC3, T3a-AC4, T3a-AC7), apart from the
// call budget and the check before a handback: a tool call and the project in, a refusal or
// nothing out. hook.mjs runs it, and scripts/check.mjs tests it through hook.mjs on recorded
// payloads.
//
// It reads shell commands well enough to find what an honest agent runs by mistake: a push to
// main, a secret file, the guards' own settings. A command built to hide what it does gets past
// it, and that is the reviewer's and the owner's to catch (review.threatModel, R-2).

import { existsSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';

const WIN = process.platform === 'win32';

// ---- Paths ----

// A path as a tool or a shell names it, made absolute from cwd, with forward slashes, in its
// own case: ~ and $HOME are the home folder, and Git Bash's /c/ is C:/ on Windows.
export function native(p, cwd = '.', home = '') {
  let w = String(p);
  const homeRef = /^(?:~|\$HOME|\$\{HOME\}|\$env:USERPROFILE|\$env:HOME|%USERPROFILE%)(?=[\\/]|$)/i.exec(w);
  if (homeRef && home) w = home + w.slice(homeRef[0].length);
  w = w.split('\\').join('/');
  if (WIN && /^\/[a-zA-Z](\/|$)/.test(w)) w = `${w[1]}:${w.slice(2) || '/'}`;
  return resolve(String(cwd), w).split('\\').join('/');
}
// The same path as the guard compares it: lower case on Windows.
export function norm(p, cwd = '.', home = '') {
  const s = native(p, cwd, home);
  return WIN ? s.toLowerCase() : s;
}
const inside = (p, dir) => p === dir || p.startsWith(dir.endsWith('/') ? dir : `${dir}/`);

// A word with a glob in it, as a pattern over normalised paths.
const GLOB = /[*?[]/;
function globRegex(path) {
  let re = '';
  for (let i = 0; i < path.length; i += 1) {
    const c = path[i];
    if (c === '*') {
      if (path[i + 1] === '*') {
        re += '.*';
        i += 1;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const end = path.indexOf(']', i + 1);
      if (end < 0) re += '\\[';
      else {
        re += `[${path.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`;
        i = end;
      }
    } else re += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  // A "[" that is no glob, such as a reversed range in a regex ("[z-a]", "[\w-.]"): the word as it is.
  try {
    return new RegExp(`^${re}$`, WIN ? 'i' : '');
  } catch {
    const literal = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${literal}$`, WIN ? 'i' : '');
  }
}

// Does a word name this file: the same path, or a glob that matches it?
function names(word, cwd, home, file) {
  const p = norm(word, cwd, home);
  return GLOB.test(word) ? globRegex(p).test(file) : p === file;
}

// A file name against globs such as ".env.*" (no folders).
const nameMatches = (name, globs) => globs.some((g) => globRegex(g).test(name));

// ---- Commands ----

const SHELLS = { bash: 'bash', sh: 'bash', zsh: 'bash', dash: 'bash', pwsh: 'powershell', powershell: 'powershell' };
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'elseif', 'fi', 'do', 'done', 'while', 'until', 'try', 'catch', 'finally', 'foreach', 'switch', '!', '-not']);
const INTERPRETERS = new Set(['node', 'python', 'python3', 'py', 'perl', 'ruby', 'deno', 'bun', 'php']);

export const program = (word) =>
  basename(String(word ?? '').split('\\').join('/'))
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|com)$/, '');

// Splits a command line into simple commands: { argv, redirects, inputs, cwd }. Command
// substitutions, "bash -c", "eval" and the like are read as commands of their own.
// kind is "bash" or "powershell".
export function parseCommand(text, kind = 'bash', cwd = '.', home = '', depth = 0) {
  const out = [];
  if (depth > 4) return out;
  const ps = kind === 'powershell';
  const cmds = [];
  let cur = { argv: [], redirects: [], inputs: [] };
  let word = null;
  // What the next word is: a file written to ("out"), read from ("in"), or a heredoc's end ("heredoc").
  let redirect = null;
  const heredocs = [];
  const inner = [];
  // Open { blocks, so a "}" that closes one ends a command and any other "}" is text ("{owner}/{repo}").
  let blocks = 0;
  let textBraces = 0;
  const endWord = () => {
    if (word === null) return;
    if (redirect === 'out') cur.redirects.push(word);
    else if (redirect === 'in') cur.inputs.push(word);
    else if (redirect === 'heredoc') heredocs.push(word);
    else cur.argv.push(word);
    redirect = null;
    word = null;
  };
  const endCmd = () => {
    endWord();
    if (cur.argv.length || cur.redirects.length || cur.inputs.length) cmds.push(cur);
    cur = { argv: [], redirects: [], inputs: [] };
  };
  // A heredoc's lines are what the command reads, not commands: skip them to their end line.
  const skipHeredocs = (i) => {
    let j = i;
    while (heredocs.length) {
      const end = heredocs.shift();
      for (;;) {
        const next = text.indexOf('\n', j + 1);
        const line = text.slice(j + 1, next < 0 ? text.length : next).replace(/\r$/, '');
        j = next < 0 ? text.length : next;
        if (line.replace(/^\t+/, '') === end || next < 0) break;
      }
    }
    return j;
  };
  // The text of a $( ... ) from position i (just after the "("), and the position after its ")".
  // Parentheses inside quotes and heredocs do not count: "$(cat <<'EOF' ... a) step ... EOF\n)".
  const balanced = (i) => {
    let level = 1;
    let j = i;
    const ends = [];
    while (j < text.length) {
      const ch = text[j];
      if (ch === '\\') {
        j += 2;
        continue;
      }
      if (ch === "'") {
        const e = text.indexOf("'", j + 1);
        j = e < 0 ? text.length : e + 1;
        continue;
      }
      if (ch === '"') {
        j += 1;
        while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
        j += 1;
        continue;
      }
      if (ch === '<' && text[j + 1] === '<' && text[j + 2] !== '<') {
        let k = j + 2;
        if (text[k] === '-') k += 1;
        while (text[k] === ' ') k += 1;
        const m = /^(['"]?)([A-Za-z0-9_]+)\1/.exec(text.slice(k));
        if (m) {
          ends.push(m[2]);
          j = k + m[0].length;
          continue;
        }
      }
      if (ch === '\n' && ends.length) {
        // A heredoc's lines, up to its end line.
        while (ends.length) {
          const end = ends.shift();
          for (;;) {
            const next = text.indexOf('\n', j + 1);
            const line = text.slice(j + 1, next < 0 ? text.length : next).replace(/\r$/, '');
            j = next < 0 ? text.length : next;
            if (line.replace(/^\t+/, '') === end || next < 0) break;
          }
        }
        j += 1;
        continue;
      }
      if (ch === '(') level += 1;
      else if (ch === ')') {
        level -= 1;
        if (level === 0) return [text.slice(i, j), j + 1];
      }
      j += 1;
    }
    return [text.slice(i), text.length];
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === ' ' || c === '\t') {
      endWord();
      continue;
    }
    if (c === '\n' || c === '\r' || c === ';') {
      endCmd();
      if (c === '\n' && heredocs.length) i = skipHeredocs(i);
      continue;
    }
    if (c === '#' && word === null) {
      while (i < text.length && text[i] !== '\n') i += 1;
      endCmd();
      continue;
    }
    // ${NAME}: one word, braces and all.
    if (c === '{' && word !== null && word.endsWith('$')) {
      const end = text.indexOf('}', i + 1);
      const stop = end < 0 ? text.length : end;
      word += text.slice(i, stop + 1);
      i = stop;
      continue;
    }
    // Blocks and groups ("if ($?) { git push }", "{ a; }", "(cd x && b)"): each command inside is a command.
    // A "{" opens a block only where a word starts (and, in bash, before a blank: "{src,docs}" is a word);
    // a "(" or ")" where a word starts or ends; a subshell's cd ends with it.
    // In PowerShell a keyword, a negation or an assignment may touch its "(" or "{": "if(", "!(", "$ok=(", "try{", "}else{".
    const opener = word !== null && ps && (KEYWORDS.has(word.toLowerCase()) || word === '-not' || /^\$[\w:]+=$/.test(word));
    if ((c === '(' || c === ')') && (word === null || c === ')' || opener)) {
      endCmd();
      cmds.push({ group: c });
      continue;
    }
    if (c === '{' && (word === null ? ps || /\s/.test(text[i + 1] ?? ' ') : opener)) {
      endCmd();
      blocks += 1;
      continue;
    }
    // Any other "{" is text ("repos/{owner}", "src/{a,b}", "@{Key = 1}"), and so is the "}" that closes it;
    // only a "}" with no such "{" open closes a block.
    if (c === '{') textBraces += 1;
    if (c === '}' && textBraces > 0) {
      textBraces -= 1;
      word = `${word ?? ''}}`;
      continue;
    }
    if (c === '}' && blocks > 0 && (word === null || ps)) {
      endCmd();
      blocks -= 1;
      continue;
    }
    // A PowerShell here-string, @'...'@ or @"..."@ to a line that starts with its closing mark: one word of text.
    if (ps && c === '@' && (text[i + 1] === "'" || text[i + 1] === '"') && /^\r?\n/.test(text.slice(i + 2))) {
      const close = new RegExp(`\\n${text[i + 1]}@`).exec(text.slice(i + 2));
      const stop = close ? i + 2 + close.index : text.length;
      word = (word ?? '') + text.slice(i + 2, stop).replace(/^\r?\n/, '');
      i = close ? stop + 2 : text.length;
      continue;
    }
    if (c === '&') {
      if (text[i + 1] === '>') {
        endWord();
        redirect = 'out';
        i += text[i + 2] === '>' ? 2 : 1;
        continue;
      }
      // PowerShell's call operator: "& 'C:\path\tool.exe' args".
      if (ps && text[i + 1] !== '&' && cur.argv.length === 0 && word === null) continue;
      endCmd();
      if (text[i + 1] === '&') i += 1;
      continue;
    }
    if (c === '|') {
      endCmd();
      if (text[i + 1] === '|' || text[i + 1] === '&') i += 1;
      continue;
    }
    if (c === '<' && text[i + 1] === '<') {
      endWord();
      if (text[i + 2] === '<') {
        // A here-string: the next word is text, not a file.
        redirect = 'in';
        i += 2;
      } else {
        redirect = 'heredoc';
        i += text[i + 2] === '-' ? 2 : 1;
      }
      continue;
    }
    if (c === '>' || c === '<') {
      // "2>" and "*>": the number or star is the stream, not a word.
      if (word !== null && /^(\d|\*)$/.test(word)) word = null;
      endWord();
      redirect = c === '>' ? 'out' : 'in';
      if (text[i + 1] === '>' || text[i + 1] === '|') i += 1;
      if (text[i + 1] === '&') {
        // ">&2": a stream, not a file.
        i += 1;
        while (i + 1 < text.length && /[\d-]/.test(text[i + 1])) i += 1;
        redirect = null;
      }
      continue;
    }
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      const stop = end < 0 ? text.length : end;
      word = (word ?? '') + text.slice(i + 1, stop);
      i = stop;
      continue;
    }
    if (c === '"') {
      let s = '';
      let j = i + 1;
      for (; j < text.length && text[j] !== '"'; j += 1) {
        const d = text[j];
        if (!ps && d === '\\' && /["\\$`\n]/.test(text[j + 1] ?? '')) {
          s += text[j + 1];
          j += 1;
        } else if (ps && d === '`' && j + 1 < text.length) {
          s += text[j + 1];
          j += 1;
        } else if (d === '$' && text[j + 1] === '(') {
          const [body, end] = balanced(j + 2);
          inner.push(body);
          s += `$(${body})`;
          j = end - 1;
        } else if (!ps && d === '`') {
          const end = text.indexOf('`', j + 1);
          const stop = end < 0 ? text.length : end;
          inner.push(text.slice(j + 1, stop));
          s += '`';
          j = stop;
        } else s += d;
      }
      word = (word ?? '') + s;
      i = j;
      continue;
    }
    if (c === '$' && text[i + 1] === '(') {
      const [body, end] = balanced(i + 2);
      inner.push(body);
      word = `${word ?? ''}$(${body})`;
      i = end - 1;
      continue;
    }
    if (!ps && c === '`') {
      const end = text.indexOf('`', i + 1);
      const stop = end < 0 ? text.length : end;
      inner.push(text.slice(i + 1, stop));
      word = `${word ?? ''}\``;
      i = stop;
      continue;
    }
    if (!ps && c === '\\' && i + 1 < text.length) {
      if (text[i + 1] === '\n') {
        i += 1;
        continue;
      }
      word = (word ?? '') + text[i + 1];
      i += 1;
      continue;
    }
    if (ps && c === '`' && i + 1 < text.length) {
      word = (word ?? '') + text[i + 1];
      i += 1;
      continue;
    }
    word = (word ?? '') + c;
  }
  endCmd();

  // The folder each command runs in, following cd; wrappers and variable assignments dropped.
  let dir = cwd;
  const dirs = [];
  for (const cmd of cmds) {
    // A subshell keeps its cd to itself: "(cd web && npm ci) && rm x" removes ./x.
    if (cmd.group === '(') {
      dirs.push(dir);
      continue;
    }
    if (cmd.group === ')') {
      if (dirs.length) dir = dirs.pop();
      continue;
    }
    let argv = cmd.argv;
    for (;;) {
      if (argv.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0])) argv = argv.slice(1);
      // PowerShell's "$ok = (...)", "$ok=(...)" or "$r=git push": the assignment, not a program.
      else if (argv.length && /^\$[\w:]+=?$/.test(argv[0]) && (argv[0].endsWith('=') || argv[1] === '=')) argv = argv.slice(argv[0].endsWith('=') ? 1 : 2);
      else if (argv.length && /^\$[\w:]+=./.test(argv[0])) argv = [argv[0].replace(/^\$[\w:]+=/, ''), ...argv.slice(1)];
      // Keywords before a command: "if npm test; then git push ...", "else", "do", PowerShell's "try".
      else if (KEYWORDS.has(String(argv[0] ?? '').toLowerCase())) argv = argv.slice(1);
      else if (['sudo', 'command', 'exec', 'nohup', 'time', 'nice', 'builtin'].includes(program(argv[0]))) argv = argv.slice(1);
      else if (program(argv[0]) === 'env') {
        argv = argv.slice(1);
        while (argv.length && (argv[0].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0]))) argv = argv.slice(1);
      } else if (program(argv[0]) === 'xargs') {
        argv = argv.slice(1);
        while (argv.length && argv[0].startsWith('-')) argv = argv.slice(1);
      } else break;
    }
    out.push({ argv, redirects: cmd.redirects, inputs: cmd.inputs, cwd: dir });
    const p = program(argv[0]);
    if (['cd', 'pushd', 'chdir', 'set-location', 'sl'].includes(p)) {
      const target = argv.slice(1).find((a) => !a.startsWith('-'));
      if (target) dir = native(target, dir, home);
    }
    // A shell started with a command ("bash -c", "bash -lc", "pwsh -Command"): its command is read too.
    const sh = SHELLS[p];
    if (sh) {
      const flag = argv.findIndex((a, i) => i > 0 && /^(-[a-z]*c[a-z]*|-command|-commandwithargs|\/c)$/i.test(a));
      if (flag > 0 && argv[flag + 1] !== undefined) out.push(...parseCommand(argv.slice(flag + 1).join(' '), sh, dir, home, depth + 1));
    }
    if (p === 'eval' || p === 'invoke-expression' || p === 'iex') out.push(...parseCommand(argv.slice(1).join(' '), kind, dir, home, depth + 1));
    if (p === 'cmd') {
      const flag = argv.findIndex((a) => /^\/[ck]$/i.test(a));
      if (flag > 0) out.push(...parseCommand(argv.slice(flag + 1).join(' '), 'bash', dir, home, depth + 1));
    }
  }
  for (const body of inner) out.push(...parseCommand(body, kind, cwd, home, depth + 1));
  return out;
}

// The code of "node -e", "python -c" and the like, or null.
function inlineCode(argv) {
  const p = program(argv[0]);
  if (!INTERPRETERS.has(p)) return null;
  const flags = p === 'php' ? /^(-r)$/ : /^(-e|--eval|-p|--print|-c|--command)$/;
  const i = argv.findIndex((a, k) => k > 0 && flags.test(a));
  if (i > 0) return argv[i + 1] ?? '';
  const joined = argv.find((a) => /^--(eval|print)=/.test(a));
  return joined ? joined.split(/=(.*)/s)[1] : null;
}

// The words of a command that may be paths, and the parts of "--flag=value".
// A message, a search or a file pattern is text, not a path: the value of these flags, and a word with a space in it.
const TEXT_FLAGS = new Set(['-m', '--message', '--grep', '--title', '--body', '--subject', '--description', '--notes', '-e', '--regexp', '--exclude', '--exclude-dir', '--include', '--glob']);
function pathWords(argv) {
  const words = [];
  const args = argv.slice(1);
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (TEXT_FLAGS.has(a)) {
      i += 1;
      continue;
    }
    const eq = /^(-[^=]*)=(.*)$/s.exec(a);
    if (eq && TEXT_FLAGS.has(eq[1])) continue;
    // A word with a space is a path only when it starts like one ("C:/Users/A B/x", "./a b"), not like a sentence.
    if (/\s/.test(a) && !/^([A-Za-z]:|\/|~|\.{1,2}[\\/])/.test(a)) continue;
    words.push(a);
    if (eq && eq[2]) words.push(eq[2]);
  }
  return words;
}

// git's subcommand and the arguments after it, past the options before it.
function gitCommand(argv) {
  let i = 1;
  let dir = null;
  while (i < argv.length && argv[i].startsWith('-')) {
    if (['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path'].includes(argv[i])) {
      if (argv[i] === '-C') dir = argv[i + 1];
      i += 2;
    } else i += 1;
  }
  return { sub: argv[i], args: argv.slice(i + 1), dir };
}

// ---- The guard ----

const FILE_WRITES = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const COMMANDS = new Set(['Bash', 'PowerShell']);
const WRITERS = new Set([
  'rm', 'rmdir', 'del', 'erase', 'rd', 'mv', 'move', 'cp', 'copy', 'install', 'rsync', 'ln', 'touch', 'truncate', 'tee', 'dd', 'chmod', 'chown', 'chgrp', 'unlink', 'shred',
  'remove-item', 'ri', 'move-item', 'mi', 'copy-item', 'cpi', 'set-content', 'sc', 'add-content', 'ac', 'out-file', 'new-item', 'ni', 'rename-item', 'rni', 'ren', 'clear-content', 'clc',
]);
// Copiers write only their last path, the destination; the paths before it are read.
const COPIERS = new Set(['cp', 'copy', 'install', 'rsync', 'copy-item', 'cpi']);
const DELETERS = new Set(['rm', 'rmdir', 'del', 'erase', 'rd', 'mv', 'move', 'unlink', 'shred', 'remove-item', 'ri', 'move-item', 'mi']);
const MOVERS = new Set(['mv', 'move', 'move-item', 'mi']);
const GIT_WRITERS = new Set(['rm', 'mv', 'checkout', 'restore', 'clean', 'apply', 'stash', 'reset', 'switch']);
const HTTP = new Set(['curl', 'wget', 'http', 'https', 'xh', 'invoke-restmethod', 'irm', 'invoke-webrequest', 'iwr']);
// Programs whose operands are names or text, not files they open: "echo .env >> .gitignore", "test -f .env".
const NAMES_ONLY = new Set(['echo', 'printf', 'test', '[', '[[', 'ls', 'stat', 'find', 'test-path', 'write-output', 'write-host']);
// What a secret file is called, to test a search pattern against.
const SECRET_SAMPLES = ['.env', '.env.local', '.env.production', 'server.pem', 'server.key', 'cert.p12', 'cert.pfx', 'id_rsa', 'id_ed25519'];

const refuse = (rule, reason) => ({ rule, reason });

// ctx: { root, home, pluginRoot, cfg, settings (the project's .claude/pitwall.json), cwd,
//   git(args, dir) -> { ok, out, status, err }, checkPr(selector) -> null or a reason }
export function guard(call, ctx) {
  const { tool, input = {}, agentId, agentType } = call;
  const h = ctx.cfg.hooks;
  if (h.handback.includes(tool)) return null;
  const home = native(ctx.home);
  const root = norm(ctx.root);
  // The plugin's folder as this script finds it (links resolved) and as Claude Code spells it (CLAUDE_PLUGIN_ROOT).
  const plugins = [...new Set([ctx.pluginRoot, ...(ctx.pluginRoots ?? [])].filter(Boolean).map((d) => norm(d)))];
  const inPlugin = (p) => plugins.some((d) => inside(p, d));
  const cwd = ctx.cwd ?? ctx.root;
  const protectedFiles = [
    `${root}/.claude/pitwall.json`,
    `${root}/.claude/settings.json`,
    `${root}/.claude/settings.local.json`,
    `${norm(home)}/.claude/settings.json`,
    `${norm(home)}/.claude/settings.local.json`,
  ];
  const contentPatterns = h.secrets.content.map((s) => new RegExp(s));
  const isSecretName = (name) => nameMatches(name, h.secrets.files) && !nameMatches(name, h.secrets.notSecret);
  const keyIn = (text) => typeof text === 'string' && contentPatterns.some((re) => re.test(text));
  const policy = agentId ? h.agents[agentType] : undefined;
  const mode = ctx.settings.mergeProtection;

  // The file a file tool writes, and what it writes.
  const target = FILE_WRITES.has(tool) ? (tool === 'NotebookEdit' ? input.notebook_path : input.file_path) : null;
  const written = tool === 'Write' ? [input.content] : tool === 'Edit' ? [input.new_string] : tool === 'MultiEdit' ? (input.edits ?? []).map((e) => e.new_string) : tool === 'NotebookEdit' ? [input.new_source] : [];

  // 1. An agent with limits of its own (T3a-AC4, T3b-AC4): the plan reviewer and the code reviewer.
  if (policy) {
    if (target !== null) {
      const t = norm(String(target), cwd, home);
      // A file, or a glob over the files of one folder ("docs/reviews/*.md").
      const allowed = policy.write.some((f) => (GLOB.test(f) ? globRegex(norm(f, ctx.root)).test(t) : norm(f, ctx.root) === t));
      if (!allowed) return refuse('agent', `${agentType} writes only ${policy.write.join(', ')}, not ${target}.`);
    }
    if (COMMANDS.has(tool)) {
      let text = String(input.command ?? '');
      // It may start from the project root, "cd <root> && <command>", the way agents often do.
      const cd = /^\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|<>`'"]+))\s*&&\s*/.exec(text);
      if (cd && norm(cd[1] ?? cd[2] ?? cd[3], cwd, home) === root) text = text.slice(cd[0].length);
      // Agents add "2>&1" to see errors in the output; it writes nothing (L-9).
      text = text.replace(/\s+2>&1\s*$/, '');
      if (/[;&|<>`\n\r]|\$\(/.test(text)) return refuse('agent', `${agentType} runs one command at a time, with no ; & | < > backtick, $( or line break (a cd to the project root before it is fine).`);
      const cmds = parseCommand(text, tool === 'PowerShell' ? 'powershell' : 'bash', cd ? ctx.root : cwd, home);
      const one = cmds.length === 1 ? cmds[0] : null;
      const argv = one?.argv ?? [];
      const at = one?.cwd ?? cwd;
      const scripts = plugins.flatMap((d) => policy.run.map((s) => `${d}/scripts/${s}`));
      const runsScript = program(argv[0]) === 'node' && scripts.includes(norm(argv[1] ?? '', at, home));
      // Read-only git in this project: the subcommands of policy.git, with no option that runs a program,
      // sets a config or writes a file ("-c core.pager=...", "--output=...", "--ext-diff").
      const g = policy.git && program(argv[0]) === 'git' ? gitCommand(argv) : null;
      const gitOptions = argv.slice(1, argv.indexOf(g?.sub));
      const readsGit =
        Boolean(g) &&
        policy.git.includes(g.sub) &&
        gitOptions.every((a, i) => a === '--no-pager' || a === '-C' || gitOptions[i - 1] === '-C') &&
        (!g.dir || norm(g.dir, at, home) === root) &&
        !g.args.some((a) => /^(--output(=|$)|--ext-diff|--textconv|--open-files-in-pager)/.test(a)) &&
        // git branch only lists here: it names no branch to create, move or delete.
        (g.sub !== 'branch' || g.args.every((a) => /^(--show-current|--list|-a|--all|-r|--remotes|-v|-vv|--verbose|--contains|--merged|--no-merged|--no-color)$/.test(a)));
      // The project's gate in any of its modes, as CI runs it or straight from its path.
      const gateArgs = program(argv[0]) === 'bash' ? argv.slice(1) : argv;
      const runsGate = Boolean(policy.gate) && norm(gateArgs[0] ?? '', at, home) === `${root}/scripts/gate` && gateArgs.length <= 2 && (gateArgs.length === 1 || ['--fast', '--changed', '--full'].includes(gateArgs[1]));
      if (!one || !(runsScript || readsGit || runsGate)) {
        const also = [...(policy.git ? [`read-only git (${policy.git.join(', ')})`] : []), ...(policy.gate ? ['scripts/gate'] : [])];
        return refuse('agent', `${agentType} runs only ${policy.run.join(' and ')} from the pitwall plugin, as node "<path>" with its arguments${also.length ? `, and ${also.join(' and ')}` : ''}.`);
      }
    }
  }

  // 2. File tools.
  if (target !== null || tool === 'Read' || tool === 'Grep') {
    const file = tool === 'Read' ? input.file_path : tool === 'Grep' ? input.path : target;
    const p = file ? norm(String(file), cwd, home) : null;
    if (p && isSecretName(basename(p))) return refuse('secrets', `${file} is a secret file: pitwall keeps agents out of it. Use .env.example or test values; a run that needs the real secrets is the owner's.`);
    if (tool === 'Grep' && input.glob) {
      // The file name the search pattern matches, against what secret files are called.
      const last = String(input.glob).split(/[\\/]/).pop();
      if (!/^[*?]*$/.test(last) && SECRET_SAMPLES.some((s) => globRegex(last).test(s) && isSecretName(s))) return refuse('secrets', `a search through ${input.glob} reads secret files: pitwall keeps agents out of them.`);
    }
    if (target !== null) {
      if (written.some(keyIn)) return refuse('secrets', `what this writes to ${target} looks like a key or a token. Keep secrets out of files the agents write; tests make their keys at run time.`);
      if (protectedFiles.includes(p) || inPlugin(p)) return refuse('switch', `${target} is one of the switches of pitwall's guards: only the owner, or a pitwall script, changes it.`);
      if (inside(p, root) && !inside(p, `${root}/.git`)) {
        // git gets the path in its own case: an ignore pattern can be case-sensitive.
        const rel = native(String(target), cwd, home).slice(root.length + 1);
        const r = ctx.git(['check-ignore', '-q', '--', rel], ctx.root);
        if (r.status === 0) return refuse('ignored', `git ignores ${target}: it is generated or stays on this machine. Change the source it comes from; a file the owner wants changed by hand, the owner changes.`);
        // A path in a submodule or outside any repository: git ignores nothing there for this project.
        if (r.status !== 1 && !/not a git repository|submodule/i.test(r.err)) return refuse('broken', `git check-ignore could not read ${target}: ${r.err || `exit ${r.status}`}.`);
      }
    }
    return null;
  }

  // 3. MCP tools: merge protection, commit statuses and merges.
  if (tool.startsWith('mcp__')) {
    const name = tool.toLowerCase();
    const action = name.split('__').pop();
    if (/protection|ruleset/.test(name) && !/^(get|list|read|search)/.test(action)) return refuse('protection', `${tool} changes merge protection, which only the owner changes (pitwall ADR-0005).`);
    if ((/commit.?status|statuses/.test(name) && !/^(get|list|read|search)/.test(action)) || (/status/.test(name) && JSON.stringify(input).includes(ctx.cfg.review.statusContext))) {
      return refuse('review', `${tool} writes a commit status: ${ctx.cfg.review.statusContext} is set only by a pitwall reviewer, through review-status.mjs (pitwall ADR-0007), and no other status is written by hand.`);
    }
    if (/merge/.test(name) && /pull|(^|_)pr(_|$)/.test(action) && mode !== 'branch-protection') return refuse('merge', `merge protection is ${mode ?? 'not recorded'}: merge with gh pr merge, which pitwall checks.`);
    return null;
  }

  if (!COMMANDS.has(tool)) return null;
  const text = String(input.command ?? '');
  const cmds = parseCommand(text, tool === 'PowerShell' ? 'powershell' : 'bash', cwd, home);
  if (keyIn(text)) return refuse('secrets', 'this command holds what looks like a key or a token. Keep secrets out of commands; tests make their keys at run time.');
  // PowerShell writing through .NET ([IO.File]::WriteAllText, the usual way to write without a byte order mark).
  // Only the paths it writes count: the first argument of a Write, Append, Create or Delete, both of a Copy,
  // Move or Replace; the text it writes may mention anything.
  for (const m of text.matchAll(/\[(?:System\.)?IO\.(?:File|Directory)\]::\s*(Write|Append|Delete|Move|Copy|Replace|Create)\w*\s*\(\s*(["'])((?:(?!\2).)*)\2(?:\s*,\s*(["'])((?:(?!\4).)*)\4)?/gi)) {
    const paths = /^(Move|Copy|Replace)$/i.test(m[1]) ? [m[3], m[5]] : [m[3]];
    const flatPath = (s) => String(s ?? '').split('\\').join('/');
    if (paths.some((s) => s !== undefined && (/\.claude\/+(pitwall|settings(\.local)?)\.json/i.test(flatPath(s)) || plugins.some((d) => (WIN ? flatPath(s).toLowerCase() : flatPath(s)).includes(d))))) {
      return refuse('switch', 'this .NET call writes one of the switches of pitwall\'s guards: only the owner, or a pitwall script, changes it.');
    }
  }
  const reviewer = Boolean(agentId) && h.reviewers.includes(agentType);
  const base = ctx.cfg.mergeProtection.branch;
  // The branch a command switched to earlier in the same line ("git switch -c x && git push -u origin HEAD").
  let switchedTo = null;
  // What a stash, a commit or git add earlier in the line has already kept of the uncommitted work, by
  // repository (T4a-AC1).
  const lineState = keptInLine(ctx);

  for (const { argv, redirects, inputs, cwd: dir } of cmds) {
    const p = program(argv[0]);
    const words = pathWords(argv);
    const code = inlineCode(argv);
    const git = p === 'git' ? gitCommand(argv) : null;
    const inPlace = argv.some((a) => /^(-i|--in-place|-[a-hj-zA-Z]*i)/.test(a));
    const readOnly =
      h.readOnlyCommands.includes(p) ||
      (git && h.readOnlyGit.includes(git.sub)) ||
      (git?.sub === 'restore' && git.args.includes('--staged') && !git.args.some((a) => a === '--worktree' || a === '-W')) ||
      // A commit, or a reset that keeps the files, changes the index and history, not the files.
      git?.sub === 'commit' ||
      (git?.sub === 'reset' && !git.args.some((a) => ['--hard', '--merge', '--keep'].includes(a)));

    // (a) Secret files, named by any command but one that only names them; a search pattern or a filter is no file.
    const namesOnly = NAMES_ONLY.has(p) || (git && (['check-ignore', 'ls-files', 'status'].includes(git.sub) || (git.sub === 'rm' && git.args.includes('--cached'))));
    const patterns = patternOperands(p, git, argv);
    for (const w of [...(namesOnly ? [] : words.filter((x) => !patterns.has(x))), ...redirects, ...inputs]) {
      if (isSecretName(basename(w.split('\\').join('/')))) return refuse('secrets', `${w} is a secret file: pitwall keeps agents out of it. Use .env.example or test values; a run that needs the real secrets is the owner's.`);
    }
    // In inline code, the quoted strings: "readFileSync('.env')", not a property such as "o.key".
    if (code !== null && [...code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].some((m) => isSecretName(basename(m[2].split('\\').join('/'))))) {
      return refuse('secrets', 'this inline script names a secret file: pitwall keeps agents out of it.');
    }
    // A recursive grep reads every file under its paths, ignored ones too, and prints what matches.
    // rg reads ignored and hidden files only when told to: -uu, or --no-ignore with --hidden.
    const rgReadsAll = p === 'rg' && (argv.some((a) => /^-u{2,}$/.test(a)) || (argv.some((a) => /^--no-ignore/.test(a)) && argv.includes('--hidden')));
    if (rgReadsAll || (['grep', 'egrep', 'fgrep'].includes(p) && argv.some((a) => /^(--recursive|--dereference-recursive|-[a-zA-Z]*[rR][a-zA-Z]*)$/.test(a)))) {
      const leak = secretFilesSearched(argv, dir, home, ctx, isSecretName);
      if (leak) return refuse('secrets', `${p === 'rg' ? 'rg' : 'grep -r'} reads ${leak}, a secret file: search with the Grep tool or git grep, which skip it, or leave it out (grep --exclude, rg -g '!${basename(leak)}').`);
    }

    // (d) The guards' switch: the settings, the plugin's folder, the plugin's enablement.
    const switchReason = 'is one of the switches of pitwall\'s guards: only the owner, or a pitwall script, changes it.';
    for (const t of redirects) {
      if (protectedFiles.some((f) => names(t, dir, home, f)) || inPlugin(norm(t, dir, home))) return refuse('switch', `${t} ${switchReason}`);
    }
    // A copy's or a move's destination: PowerShell's -Destination wherever it stands, else the last operand.
    const destFlag = argv.findIndex((a) => /^-destination$/i.test(a));
    const operands = words.filter((w) => !w.startsWith('-') && (destFlag < 0 || w !== argv[destFlag + 1]));
    if (destFlag >= 0 && argv[destFlag + 1]) operands.push(argv[destFlag + 1]);
    // What a command writes: a copier its destination, any other writer every path it names.
    const writes = (w) => (COPIERS.has(p) ? w === operands[operands.length - 1] : WRITERS.has(p) || (git && GIT_WRITERS.has(git.sub)) || (['sed', 'perl'].includes(p) && inPlace));
    for (const w of words) {
      const named = protectedFiles.some((f) => names(w, dir, home, f));
      if (named && !readOnly && (!COPIERS.has(p) || writes(w))) return refuse('switch', `${w} ${switchReason}`);
      const wp = norm(w, dir, home);
      if (writes(w) && inPlugin(wp)) return refuse('switch', `${w} is inside the pitwall plugin, one of the switches of its guards.`);
      // A move takes its sources away, not its destination ("mv build/out.js ." keeps "." where it is).
      const moved = MOVERS.has(p) && w === operands[operands.length - 1] && operands.length > 1;
      if (DELETERS.has(p) && !moved && [...protectedFiles, ...plugins].some((f) => inside(f, wp))) return refuse('switch', `${w} holds the switches of pitwall's guards: only the owner removes it.`);
    }
    // Any command that names a switch file or the plugin's folder is refused unless it only reads or stages
    // them, or is one of pitwall's own scripts: that closes "node -e", "python -c", "sed -i", a formatter and
    // a copy onto them alike (owner, 2026-11-09). A message or a search pattern is no path (pathWords).
    const namesSwitch = (w) => {
      const f = String(w).split('\\').join('/');
      // An exclusion leaves the file alone: git's ":!x" and ":(exclude)x", a formatter's "!x".
      if (/^(!|:!|:\^|:\([^)]*exclude[^)]*\))/.test(f)) return false;
      const g = WIN ? f.toLowerCase() : f;
      return /\.claude\/+(pitwall|settings(\.local)?)\.json/i.test(f) || /\$\{?CLAUDE_PLUGIN_ROOT\b/.test(f) || plugins.some((d) => g.includes(d) || g.includes(d.replace(/^([a-z]):/i, (_, x) => `/${x.toLowerCase()}`)));
    };
    // One of pitwall's own scripts: node, its options, then a script in the plugin's scripts folder; the
    // other words that may be paths (not an --idea or a --description) name no switch.
    const script = p === 'node' ? argv.slice(1).find((a) => !a.startsWith('-')) : undefined;
    const pitwallScript = Boolean(script) && /\.mjs$/i.test(script) && plugins.some((d) => inside(norm(script, dir, home), `${d}/scripts`)) && !words.filter((w) => w !== script).some(namesSwitch);
    // The plugin's own files (defaults.json, the template) may also be read the ways agents read: sed -n, find,
    // tree, du, sort, cd. The switch files themselves keep to hooks.readOnlyCommands.
    const isSwitchFile = (w) => /\.claude\/+(pitwall|settings(\.local)?)\.json/i.test(String(w).split('\\').join('/'));
    const pluginReader =
      ['tree', 'du', 'cd', 'pushd', 'set-location', 'sl', 'realpath', 'readlink', 'dirname', 'basename'].includes(p) ||
      (p === 'sort' && !argv.some((a) => /^(-o|--output)/.test(a))) ||
      (p === 'find' && !argv.some((a) => /^-(delete|exec|execdir|ok|okdir|fprint0?|fprintf|fls)$/.test(a))) ||
      (p === 'sed' && argv.includes('-n') && !inPlace && /^(\d+|\$)(,(\d+|\$))?p$/.test(argv.slice(1).find((a) => !a.startsWith('-')) ?? ''));
    // A "<" only reads, so what it reads from names nothing here.
    const named = words.filter(namesSwitch);
    const naming = named[0] ?? (code !== null && namesSwitch(code) ? 'this inline script' : null);
    const readsPlugin = pluginReader && named.length > 0 && !named.some(isSwitchFile);
    if (naming && !readOnly && !pitwallScript && !readsPlugin) {
      return refuse('switch', `${naming} names one of the switches of pitwall's guards (.claude/pitwall.json, the Claude Code settings, the plugin's folder). A command that names one may only read it (cat, head, grep, git diff, log, show) or stage it (git add); only the owner, or a pitwall script, changes it.`);
    }
    if (git?.sub === 'clean' && git.args.some((a) => /^-[a-zA-Z]*[xX]/.test(a)) && !git.args.some((a) => a === '--dry-run' || /^-[a-zA-Z]*n/.test(a))) return refuse('switch', 'git clean -x removes ignored files, and .claude/settings.local.json is one of the switches of pitwall\'s guards.');
    if (p === 'claude' && /^plugins?$/.test(argv[1] ?? '') && (/^(disable|uninstall|remove|rm)$/.test(argv[2] ?? '') || (argv[2] === 'marketplace' && /^(remove|rm)$/.test(argv[3] ?? '')))) {
      return refuse('switch', `claude ${argv.slice(1, 4).join(' ')} turns pitwall's guards off: only the owner does that.`);
    }

    // (c) Pushes that change main.
    if (git?.sub === 'push') {
      const reason = pushChangesMain(git, base, dir, home, ctx, switchedTo);
      if (reason) return refuse('push', reason);
    }

    // T4a-AC1, L-12: a git command that would throw away uncommitted work. What a stash, a commit or git add
    // earlier in the same line kept ("git stash push -- a.js && git checkout -- a.js") is judged kept; the
    // rest is judged on the tree as it is now.
    if (git) {
      const where = git.dir ? native(git.dir, dir, home) : dir;
      const lost = discards(git, where, ctx, lineState);
      if (lost?.error) return refuse('broken', `git status could not read the tree before "git ${git.sub}": ${lost.error}.`);
      if (lost?.files.length) {
        const shown = lost.files.slice(0, 8).join(' ');
        const more = lost.files.length > 8 ? ` and ${lost.files.length - 8} more` : '';
        return refuse('uncommitted', lost.stash
          ? `git stash ${git.args[0]} would throw away ${shown}${more}, uncommitted work kept in the stash (L-12). Apply it first (git stash pop), or leave the stash; the owner drops it in a terminal if it should go.`
          : `git ${git.sub} would throw away uncommitted ${lost.untracked ? 'new files' : 'changes in'} ${shown}${more} (L-12). Keep them first: git stash push${lost.untracked ? ' -u' : ''} -- ${shown} keeps them in a stash to restore with git stash pop, or commit them; then run it again.`);
      }
      keeps(git, where, ctx, lineState);
    }
    if (git && (git.sub === 'checkout' || git.sub === 'switch')) {
      const flag = git.args.findIndex((a) => /^(-[bBcC]|--create|--force-create|--orphan)$/.test(a));
      if (flag >= 0 && git.args[flag + 1]) switchedTo = git.args[flag + 1];
      else {
        const name = git.args.find((a) => !a.startsWith('-'));
        if (name && !git.args.includes('--') && ctx.git(['rev-parse', '--verify', '-q', `refs/heads/${name}`], git.dir ? native(git.dir, dir, home) : dir).ok) switchedTo = name;
      }
    }

    // T3b-AC6: the scripts only the owner runs, in a terminal (hooks.ownerOnly): the one that records
    // whether merges may run without them (ADR-0010). No agent runs them, the main conversation included.
    const ownerOnly = (h.ownerOnly ?? []).find((s) => argv.some((w) => basename(String(w).split('\\').join('/')).toLowerCase() === s) || (code !== null && code.includes(s)));
    if (ownerOnly && (INTERPRETERS.has(p) || basename(String(argv[0] ?? '').split('\\').join('/')).toLowerCase() === ownerOnly)) {
      return refuse('owner', `${ownerOnly} records a choice of the owner (pitwall ADR-0010): the owner runs it in a terminal, not an agent. Hand them the command.`);
    }

    // AC4: review-status.mjs only from the two reviewers.
    const runsReviewStatus = ((INTERPRETERS.has(p) || /review-status\.mjs$/i.test(argv[0] ?? '')) && argv.some((w) => /review-status\.mjs$/i.test(w))) || (code !== null && code.includes('review-status'));
    if (runsReviewStatus && !reviewer) return refuse('review', `only ${h.reviewers.join(' and ')} run review-status.mjs (pitwall ADR-0007), and this call comes from ${agentId ? agentType || 'a sub-agent' : 'the main conversation'}.`);

    // (e), AC4 and AC7 over the GitHub API: protection, statuses and merges.
    const api = apiCall(p, argv);
    if (api) {
      if (api.write && /\/branches\/[^/]+\/protection/.test(api.path)) return refuse('protection', `${api.method} ${api.path} changes branch protection, which only the owner changes (pitwall ADR-0005).`);
      if (api.write && /(^|\/)rulesets(\/|$)/.test(api.path)) return refuse('protection', `${api.method} ${api.path} changes a ruleset, which only the owner changes (pitwall ADR-0005).`);
      if (api.graphql && /\b(create|update|delete)(BranchProtectionRule|RepositoryRuleset)\b/.test(api.body)) return refuse('protection', 'this GraphQL mutation changes merge protection, which only the owner changes (pitwall ADR-0005).');
      if (api.write && /\/statuses\//.test(api.path)) return refuse('review', `${api.method} ${api.path} writes a commit status: ${ctx.cfg.review.statusContext} is set only through review-status.mjs (pitwall ADR-0007), and no other status is written by hand.`);
      const merges = (api.write && /\/pulls\/\d+\/merge$/.test(api.path)) || (api.graphql && /\bmergePullRequest\b/.test(api.body));
      if (merges && mode !== 'branch-protection') return refuse('merge', `merge protection is ${mode ?? 'not recorded'}: merge with gh pr merge, which pitwall checks.`);
    }
    if (p === 'gh' && argv[1] === 'pr' && argv[2] === 'merge') {
      if (argv.includes('--admin')) return refuse('protection', 'gh pr merge --admin bypasses the required checks, and admins are included in the protection (pitwall ADR-0005).');
      if (mode === 'local-hook') {
        const flagsWithValue = new Set(['-b', '--body', '-F', '--body-file', '-t', '--subject', '--match-head-commit', '-A', '--author-email', '-R', '--repo']);
        let selector = null;
        for (let i = 3; i < argv.length; i += 1) {
          if (flagsWithValue.has(argv[i])) i += 1;
          else if (!argv[i].startsWith('-')) {
            selector = argv[i];
            break;
          }
        }
        const reason = ctx.checkPr(selector);
        if (reason) return refuse('merge', reason);
      } else if (mode !== 'branch-protection') {
        return refuse('merge', `merge protection is ${mode ?? 'not recorded'}: nothing merges until protect.mjs has set it up (pitwall ADR-0002).`);
      }
    }
  }
  return null;
}

// The words of a command that are a search pattern or a filter, not a file: the pattern of grep,
// rg, git grep and Select-String, a jq or yq filter, and the value of git log -S and -G.
const SEARCHERS = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'select-string', 'sls']);
const FILTERS = new Set(['jq', 'yq', 'gojq']);
function patternOperands(p, git, argv) {
  const out = new Set();
  let args = SEARCHERS.has(p) || FILTERS.has(p) ? argv.slice(1) : git?.sub === 'grep' ? git.args : null;
  // yq's subcommand comes before its filter: "yq e '.a.key' x.yaml".
  if (p === 'yq' && /^(e|eval|ea|eval-all)$/.test(args?.[0] ?? '')) args = args.slice(1);
  if (args) {
    const given = args.some((a) => /^(-e|--regexp|-f|--file|-pattern)(=|$)/i.test(a));
    for (let i = 0; i < args.length; i += 1) {
      const a = args[i];
      if (/^-pattern$/i.test(a) || /^(-e|--regexp)$/.test(a)) {
        out.add(args[i + 1]);
        i += 1;
      } else if (/^-[ABCmdDfg]$/.test(a) || /^--(max-count|context|after-context|before-context|file|glob|type|arg|argjson)$/.test(a) || /^-(path|literalpath)$/i.test(a)) {
        i += 1;
      } else if (!given && !a.startsWith('-')) {
        out.add(a);
        break;
      }
    }
  }
  if (git) for (let i = 0; i < git.args.length; i += 1) if (/^-[SG]$/.test(git.args[i])) out.add(git.args[i + 1]);
  out.delete(undefined);
  return out;
}

// The first secret file a recursive grep reads, as the project names it, or null: the project's
// secret files (ignored or tracked) under the paths it searches that no --exclude leaves out.
function secretFilesSearched(argv, dir, home, ctx, isSecretName) {
  const excludes = [];
  const excludeDirs = [];
  const includes = [];
  const operands = [];
  let patternGiven = false;
  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i];
    const [flag, inline] = a.startsWith('--') && a.includes('=') ? a.split(/=(.*)/s) : [a, undefined];
    if (flag === '--exclude' || flag === '--exclude-dir' || flag === '--include') {
      ({ '--exclude': excludes, '--exclude-dir': excludeDirs, '--include': includes })[flag].push(inline ?? argv[(i += 1)] ?? '');
    } else if (flag === '-g' || flag === '--glob') {
      // rg's globs: "!x" leaves x out, anything else limits the search to it.
      const g = inline ?? argv[(i += 1)] ?? '';
      if (g.startsWith('!')) excludes.push(g.slice(1));
      else includes.push(g);
    } else if (['-e', '--regexp', '-f', '--file'].includes(flag)) {
      patternGiven = true;
      if (inline === undefined) i += 1;
    } else if (/^-[a-zA-Z]*[efABCm]$/.test(a)) i += 1;
    else if (!a.startsWith('-')) operands.push(a);
  }
  const paths = (patternGiven ? operands : operands.slice(1)).map((x) => norm(x, dir, home));
  if (paths.length === 0) paths.push(norm(dir));
  const files = ctx.cfg.hooks.secrets.files;
  const ignored = ctx.git(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'], ctx.root);
  const tracked = ctx.git(['ls-files', '--', ...files.map((g) => `:(glob)**/${g}`)], ctx.root);
  const found = [...ignored.out.split('\n'), ...tracked.out.split('\n')].map((f) => f.trim()).filter((f) => f && isSecretName(basename(f)));
  for (const f of found) {
    const p = norm(f, ctx.root);
    if (!paths.some((d) => inside(p, d))) continue;
    if (excludes.some((g) => globRegex(g).test(basename(f)))) continue;
    // With --include, grep opens only the files it names: "--include=*.ts" never opens .env.
    if (includes.length && !includes.some((g) => globRegex(g).test(basename(f)))) continue;
    if (excludeDirs.some((g) => f.split('/').slice(0, -1).some((seg) => globRegex(g).test(seg)))) continue;
    return f;
  }
  return null;
}

// ---- Uncommitted work (T4a-AC1, L-12) ----

// The operands of a git command, apart from its options and their values: valued are the options that
// take the next word, shortValued the letters that do at the end of a cluster ("-am wip").
function gitOperands(args, valued = [], shortValued = '') {
  const before = [];
  for (let i = 0; i < args.length; i += 1) {
    const x = args[i];
    if (x === '--') return { before, after: args.slice(i + 1) };
    if (x.startsWith('-')) {
      const cluster = /^-[a-zA-Z]+$/.test(x) ? [...x.slice(1)].findIndex((c) => shortValued.includes(c)) : -1;
      if (valued.includes(x) || (cluster >= 0 && cluster === x.length - 2)) i += 1;
      continue;
    }
    before.push(x);
  }
  return { before, after: null };
}

// The tree's changes under paths (all of it without), from the repository's root: { entries: [{ kind,
// x, y, path }] } as porcelain v2 gives them ("1" and "2" changed, "u" in a merge conflict, "?" new;
// x the index against HEAD, y the work tree against the index, "." unchanged), or { error }.
function treeStatus(dir, ctx, paths, untracked = 'all') {
  const r = ctx.git(['-c', 'core.quotePath=false', '-c', 'status.relativePaths=false', 'status', '--porcelain=v2', `--untracked-files=${untracked}`, ...(paths?.length ? ['--', ...paths] : [])], dir);
  if (!r.ok) return { error: r.err || `exit ${r.status}` };
  // Porcelain v2 lines never start with a space, so a trimmed output still reads right.
  const field = (l, n) => l.split(' ').slice(n).join(' ').split('\t')[0];
  const at = { 1: 8, 2: 9, u: 10 };
  return {
    entries: r.out.split('\n').filter(Boolean).flatMap((l) => {
      if (l.startsWith('? ')) return [{ kind: '?', x: '?', y: '?', path: l.slice(2) }];
      const xy = l.split(' ')[1] ?? '..';
      return at[l[0]] ? [{ kind: l[0], x: xy[0], y: xy[1], path: field(l, at[l[0]]) }] : [];
    }),
  };
}
const has = (set, path) => set === 'all' || set.has(path);
const join2 = (set, more) => (set === 'all' || more === 'all' ? 'all' : new Set([...set, ...more]));

// What the commands of one line kept of the uncommitted work, by repository: kept, by a stash or a commit,
// is safe from every command after it; staged, by git add, from a restore of the work tree out of the index
// and from git clean. Each is a set of paths from the repository's root, or 'all'.
function keptInLine(ctx) {
  const tops = new Map();
  const states = new Map();
  return (dir) => {
    if (!tops.has(dir)) {
      const r = ctx.git(['rev-parse', '--show-toplevel'], dir);
      tops.set(dir, r.ok && r.out ? r.out : dir);
    }
    const top = tops.get(dir);
    if (!states.has(top)) states.set(top, { top, stashed: false, kept: { tracked: new Set(), untracked: new Set() }, staged: { tracked: new Set(), untracked: new Set() } });
    const st = states.get(top);
    // A path from the root as the command's folder names it, quoted when the shell would split it.
    // A folder git names another way than the shell (a short or a linked path) gets git's ":/" from the root.
    const down = relative(top, dir).split('\\').join('/');
    const show = (p) => {
      const rel = !down ? p : /^(\.\.|\/|[a-zA-Z]:)/.test(down) ? `:/${p}` : relative(dir, `${top}/${p}`).split('\\').join('/') || '.';
      return /[\s"'$`*?[\]();&|<>]/.test(rel) ? `"${rel}"` : rel;
    };
    return { st, show };
  };
}

// What a git command would throw away of the uncommitted work in dir: { files, untracked } with the
// paths, { files, stash: true } with the entries of the stash, { error } when git cannot read the tree,
// or null. Only these lose work: checkout over paths or with -f, switch -f or --discard-changes, restore
// of the work tree, reset --hard, clean -f, stash drop and clear. A branch switch without -f, restore
// --staged alone, clean -n, reset --soft or --mixed keep it. Never lost: what a command earlier in the
// line kept; a change already staged, when the work tree is restored from the index; a file that is only
// deleted; a path in a merge conflict, which git merge --abort throws away too and --ours, --theirs or
// -m resolve.
function discards(git, dir, ctx, line) {
  // A folder a command earlier in the line makes (git clone, git worktree add) holds no work yet.
  if (!existsSync(dir)) return null;
  const a = git.args;
  const flag = (...names) => a.some((x) => names.includes(x));
  const short = (letter) => a.some((x) => /^-[a-zA-Z]+$/.test(x) && x.includes(letter));
  const isCommit = (x) => ctx.git(['rev-parse', '--verify', '-q', `${x}^{commit}`], dir).ok;
  // fromIndex: the work tree is restored from the index, so what is staged stays there.
  const tracked = (paths, fromIndex) => {
    const s = treeStatus(dir, ctx, paths);
    if (s.error) return s;
    const { st, show } = line(dir);
    const changed = (c) => !['.', 'D'].includes(c);
    const files = s.entries.filter((e) => (e.kind === '1' || e.kind === '2') && (changed(e.y) || (!fromIndex && changed(e.x))) && !has(st.kept.tracked, e.path) && !(fromIndex && has(st.staged.tracked, e.path)));
    return { files: files.map((e) => show(e.path)) };
  };

  if (git.sub === 'checkout') {
    if (flag('-p', '--patch')) return null;
    const force = flag('-f', '--force') || short('f');
    const { before, after } = gitOperands(a, ['-b', '-B', '--orphan', '--conflict', '--pathspec-from-file']);
    // Without "--", a first operand that names a commit is the commit (or the branch); the rest are paths.
    const source = after ? (before[0] ?? null) : before.length && isCommit(before[0]) ? before[0] : null;
    const paths = after ?? (source ? before.slice(1) : before);
    if (!paths.length) return force ? tracked(null, false) : null;
    return tracked(paths, !source);
  }
  if (git.sub === 'switch') return flag('-f', '--force', '--discard-changes') || short('f') ? tracked(null, false) : null;
  if (git.sub === 'restore') {
    const staged = flag('--staged') || short('S');
    const worktree = flag('--worktree') || short('W');
    if (staged && !worktree) return null;
    const { before, after } = gitOperands(a, ['-s', '--source', '--pathspec-from-file']);
    const paths = [...before, ...(after ?? [])];
    // The work tree alone: the index keeps what is staged, whatever the source.
    return paths.length ? tracked(paths, !staged) : null;
  }
  if (git.sub === 'reset') return flag('--hard') ? tracked(null, false) : null;
  if (git.sub === 'clean') {
    if (flag('-n', '--dry-run') || short('n') || !(flag('-f', '--force') || short('f'))) return null;
    const { before, after } = gitOperands(a, ['-e', '--exclude']);
    const paths = [...before, ...(after ?? [])];
    // Without -d or a path, git clean leaves the new folders alone.
    const s = treeStatus(dir, ctx, paths, paths.length || flag('-d') || short('d') ? 'all' : 'normal');
    if (s.error) return s;
    const { st, show } = line(dir);
    const files = s.entries.filter((e) => e.kind === '?' && !e.path.endsWith('/') && !has(st.kept.untracked, e.path) && !has(st.staged.untracked, e.path));
    return { untracked: true, files: files.map((e) => show(e.path)) };
  }
  if (git.sub === 'stash' && (a[0] === 'drop' || a[0] === 'clear')) {
    const list = ctx.git(['stash', 'list'], dir);
    if (!list.ok) return { error: list.err || `exit ${list.status}` };
    // A stash made earlier in the line is stash@{0} by now.
    const count = list.out.split('\n').filter(Boolean).length + (line(dir).st.stashed ? 1 : 0);
    const entries = Array.from({ length: count }, (_, i) => `stash@{${i}}`);
    if (a[0] === 'clear') return { stash: true, files: entries };
    const named = a.slice(1).find((x) => !x.startsWith('-')) ?? 'stash@{0}';
    const ref = /^\d+$/.test(named) ? `stash@{${named}}` : named;
    // A name git reads some other way (a commit of the stash) is taken as one of its entries.
    return { stash: true, files: entries.includes(ref) || (!/^stash@\{\d+\}$/.test(ref) && entries.length) ? [ref] : [] };
  }
  return null;
}

// What a git command keeps of the uncommitted work for the commands after it in the line (discards):
// git add stages paths; a commit keeps what it commits; a stash push keeps what it takes.
function keeps(git, dir, ctx, line) {
  if (!['add', 'commit', 'stash'].includes(git.sub) || !existsSync(dir)) return;
  const sub = git.sub === 'stash' ? (git.args[0] && !git.args[0].startsWith('-') ? git.args[0] : 'push') : git.sub;
  if (git.sub === 'stash' && !['push', 'save'].includes(sub)) return;
  const a = git.sub === 'stash' && git.args[0] === sub ? git.args.slice(1) : git.args;
  const flag = (...names) => a.some((x) => names.includes(x));
  const short = (letter) => a.some((x) => /^-[a-zA-Z]+$/.test(x) && x.includes(letter));
  const { st } = line(dir);
  const listed = (paths) => {
    const s = treeStatus(dir, ctx, paths);
    return s.error ? [] : s.entries;
  };
  const trackedOf = (entries) => entries.filter((e) => e.kind === '1' || e.kind === '2').map((e) => e.path);
  const newOf = (entries) => entries.filter((e) => e.kind === '?').map((e) => e.path);
  // What a commit of the index takes: what was staged before the line, where the work tree adds
  // nothing to it, and what git add staged in it.
  const keepStaged = () => {
    st.kept.tracked = join2(join2(st.kept.tracked, listed([]).filter((e) => (e.kind === '1' || e.kind === '2') && e.x !== '.' && ['.', 'D'].includes(e.y)).map((e) => e.path)), st.staged.tracked);
    st.kept.untracked = join2(st.kept.untracked, st.staged.untracked);
  };

  if (sub === 'add') {
    if (flag('-n', '--dry-run', '-p', '--patch', '-i', '--interactive', '-e', '--edit', '-N', '--intent-to-add') || ['n', 'p', 'i', 'e', 'N'].some(short)) return;
    const { before, after } = gitOperands(a, ['--pathspec-from-file']);
    const paths = [...before, ...(after ?? [])];
    const update = flag('-u', '--update') || short('u');
    if (!paths.length) {
      if (flag('-A', '--all', '--no-ignore-removal') || short('A')) st.staged = { tracked: 'all', untracked: 'all' };
      else if (update) st.staged.tracked = 'all';
      return;
    }
    const e = listed(paths);
    st.staged.tracked = join2(st.staged.tracked, trackedOf(e));
    if (!update) st.staged.untracked = join2(st.staged.untracked, newOf(e));
    return;
  }
  if (sub === 'commit') {
    if (flag('--dry-run', '-p', '--patch', '--interactive') || short('p')) return;
    const { before, after } = gitOperands(a, ['-m', '--message', '-F', '--file', '-C', '--reuse-message', '-c', '--reedit-message', '--author', '--date', '--fixup', '--squash', '-t', '--template', '--cleanup', '--trailer', '--pathspec-from-file'], 'mFCct');
    const paths = [...before, ...(after ?? [])];
    if (flag('-a', '--all') || short('a')) st.kept.tracked = 'all';
    else if (paths.length) st.kept.tracked = join2(st.kept.tracked, trackedOf(listed(paths)));
    // With paths and no --include, a commit takes those paths only, not the rest of the index.
    if (!paths.length || flag('-i', '--include') || short('i')) keepStaged();
    return;
  }
  // A stash push or save; a patch stash takes only some of the work, so it keeps nothing sure.
  st.stashed = true;
  if (flag('-p', '--patch') || short('p')) return;
  if (flag('-S', '--staged') || short('S')) return keepStaged();
  const untracked = flag('-u', '--include-untracked', '-a', '--all') || short('u') || short('a');
  const { before, after } = sub === 'save' ? { before: [], after: null } : gitOperands(a, ['-m', '--message', '--pathspec-from-file'], 'm');
  const paths = [...before, ...(after ?? [])];
  if (!paths.length) {
    st.kept.tracked = 'all';
    st.kept.untracked = untracked ? 'all' : join2(st.kept.untracked, st.staged.untracked);
    return;
  }
  const e = listed(paths);
  st.kept.tracked = join2(st.kept.tracked, trackedOf(e));
  st.kept.untracked = join2(st.kept.untracked, newOf(e).filter((p) => untracked || has(st.staged.untracked, p)));
}

// Would this git push change the base branch? A reason, or null.
function pushChangesMain(git, base, dir, home, ctx, switchedTo) {
  const where = git.dir ? native(git.dir, dir, home) : dir;
  const valued = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
  let force = false;
  let del = false;
  let tagsOnly = false;
  const pos = [];
  for (let i = 0; i < git.args.length; i += 1) {
    const a = git.args[i];
    if (valued.has(a)) i += 1;
    else if (a === '--mirror' || a === '--all' || a === '--branches') return `git push ${a} pushes every branch, ${base} with them: push the branch you work on.`;
    else if (a === '-n' || a === '--dry-run') return null;
    else if (a === '--tags') tagsOnly = true;
    else if (a === '--delete' || a === '-d') del = true;
    else if (/^(--force|--force-with-lease|--force-if-includes)(=|$)/.test(a) || /^-[a-zA-Z]*f/.test(a)) force = true;
    else if (!a.startsWith('-')) pos.push(a);
  }
  // The branch HEAD is on; null when git cannot tell.
  const current = () => {
    if (switchedTo) return switchedTo;
    const r = ctx.git(['symbolic-ref', '--short', '-q', 'HEAD'], where);
    return r.ok && r.out ? r.out : null;
  };
  const remote = pos[0] ?? 'origin';
  const refspecs = pos.slice(1);
  // "git push --tags" with no refspec pushes the tags only.
  if (tagsOnly && refspecs.length === 0) return null;
  const unknown = 'git cannot tell which branch this pushes: name it, as in git push origin <branch>.';
  const targets = [];
  if (refspecs.length === 0) {
    const b = current();
    if (b === null) return unknown;
    targets.push({ src: b, dst: b, plus: false, gone: false });
  }
  for (const r of refspecs) {
    const plus = r.startsWith('+');
    const s = plus ? r.slice(1) : r;
    const colon = s.indexOf(':');
    let src = colon < 0 ? s : s.slice(0, colon);
    let dst = colon < 0 ? s : s.slice(colon + 1);
    // HEAD, or a name the shell works out ("$(git branch --show-current)"), is the current branch.
    const isCurrent = (x) => x === 'HEAD' || x === '@' || /[$`]/.test(x);
    if (isCurrent(src)) src = current();
    if (isCurrent(dst) || (colon < 0 && src !== s)) dst = colon < 0 ? src : current();
    if (dst === null) return unknown;
    // A named destination that is not the base: what it is pushed from does not matter here.
    if (src === null && dst.replace(/^refs\/heads\//, '') !== base) continue;
    if (src === null) return unknown;
    targets.push({ src: src.replace(/^refs\/heads\//, ''), dst: dst.replace(/^refs\/heads\//, ''), plus, gone: colon === 0 });
  }
  for (const t of targets) {
    if (t.dst !== base) continue;
    if (del || t.gone) return `this push deletes ${base}, which only changes through a PR.`;
    if (force || t.plus) return `this is a forced push to ${base}, which only changes through a PR.`;
    // The skeleton is the only direct commit on main (SPEC 9): its first push passes, from main
    // itself, while main holds that one commit and has never been pushed to this remote.
    if (t.src === base) {
      const count = ctx.git(['rev-list', '--count', `refs/heads/${base}`], where);
      const pushed = ctx.git(['rev-parse', '--verify', '-q', `refs/remotes/${remote}/${base}`], where);
      if (count.ok && count.out === '1' && !pushed.ok) return null;
    }
    return `${base} changes only through a PR: push your branch and open one.`;
  }
  return null;
}

// A call to the GitHub API by gh or an HTTP client: { path, method, write, graphql, body }, or null.
function apiCall(p, argv) {
  if (p === 'gh' && argv[1] === 'api') {
    const valued = new Set(['-X', '--method', '-f', '-F', '--field', '--raw-field', '-H', '--header', '--input', '-q', '--jq', '-t', '--template', '--hostname', '--cache', '-p', '--preview']);
    let path = null;
    let method = null;
    let fields = false;
    const body = [];
    for (let i = 2; i < argv.length; i += 1) {
      const a = argv[i];
      const [flag, inline] = a.startsWith('--') && a.includes('=') ? a.split(/=(.*)/s) : [a, undefined];
      if (valued.has(flag)) {
        const v = inline ?? argv[(i += inline === undefined ? 1 : 0)];
        if (flag === '-X' || flag === '--method') method = String(v).toUpperCase();
        if (['-f', '-F', '--field', '--raw-field', '--input'].includes(flag)) {
          fields = true;
          body.push(String(v));
        }
      } else if (/^-X[A-Za-z]+$/.test(a)) method = a.slice(2).toUpperCase();
      else if (!a.startsWith('-') && path === null) path = a;
    }
    if (path === null) return null;
    method ??= fields ? 'POST' : 'GET';
    const graphql = /^\/?graphql$/.test(path);
    return { path: `/${path.replace(/^\//, '')}`, method, write: method !== 'GET' && method !== 'HEAD', graphql, body: body.join(' ') };
  }
  if (HTTP.has(p)) {
    const url = argv.find((a) => /api\.github\.com\//i.test(a));
    if (!url) return null;
    const path = url.replace(/^.*?api\.github\.com/i, '').replace(/[?#].*$/, '');
    let method = 'GET';
    const body = [];
    for (let i = 1; i < argv.length; i += 1) {
      const a = argv[i];
      if (/^(-X|--request|-Method)$/i.test(a)) method = String(argv[i + 1] ?? '').toUpperCase();
      else if (/^-X[A-Za-z]+$/.test(a)) method = a.slice(2).toUpperCase();
      else if (/^(-d|--data.*|--json|-F|--form|-T|--upload-file|-Body)$/i.test(a)) {
        if (method === 'GET') method = 'POST';
        body.push(String(argv[i + 1] ?? ''));
      }
    }
    return { path, method, write: method !== 'GET' && method !== 'HEAD', graphql: /^\/graphql$/.test(path), body: body.join(' ') };
  }
  return null;
}
