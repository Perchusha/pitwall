// The decisions of pitwall's PreToolUse guard (T3a-AC3, T3a-AC4, T3a-AC7), apart from the
// call budget: a tool call and the project in, a refusal or nothing out. hook.mjs runs it, and
// scripts/check.mjs tests it through hook.mjs on recorded payloads.
//
// It reads shell commands well enough to find what an honest agent runs by mistake: a push to
// main, a secret file, the guards' own settings. A command built to hide what it does gets past
// it, and that is the reviewer's and the owner's to catch (review.threatModel, R-1).

import { basename, isAbsolute, resolve } from 'node:path';

const WIN = process.platform === 'win32';

// ---- Paths ----

// A path as the guard compares it: absolute, forward slashes, and lower case on Windows.
export function norm(p) {
  let s = String(p).split('\\').join('/');
  // Git Bash spells C:\ as /c/.
  if (WIN && /^\/[a-zA-Z](\/|$)/.test(s)) s = `${s[1]}:${s.slice(2) || '/'}`;
  s = resolve(s).split('\\').join('/');
  return WIN ? s.toLowerCase() : s;
}
const inside = (p, dir) => p === dir || p.startsWith(dir.endsWith('/') ? dir : `${dir}/`);

// A word of a command as a path, from the folder the command runs in.
function wordPath(word, cwd, home) {
  let w = word;
  const homeRef = /^(?:~|\$HOME|\$\{HOME\}|\$env:USERPROFILE|\$env:HOME|%USERPROFILE%)(?=[\\/]|$)/i.exec(w);
  if (homeRef) w = home + w.slice(homeRef[0].length);
  if (WIN && /^\/[a-zA-Z](\/|$)/.test(w)) return norm(w);
  return norm(isAbsolute(w) ? w : resolve(cwd, w));
}

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
  return new RegExp(`^${re}$`, WIN ? 'i' : '');
}

// Does a word name this file: the same path, or a glob that matches it?
function names(word, cwd, home, file) {
  const p = wordPath(word, cwd, home);
  return GLOB.test(word) ? globRegex(p).test(file) : p === file;
}

// A file name against globs such as ".env.*" (no folders).
const nameMatches = (name, globs) => globs.some((g) => globRegex(g).test(name));

// ---- Commands ----

const SHELLS = { bash: 'bash', sh: 'bash', zsh: 'bash', dash: 'bash', pwsh: 'powershell', powershell: 'powershell' };
const INTERPRETERS = new Set(['node', 'python', 'python3', 'py', 'perl', 'ruby', 'deno', 'bun', 'php']);

export const program = (word) =>
  basename(String(word ?? '').split('\\').join('/'))
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|com)$/, '');

// Splits a command line into simple commands: { argv, redirects, cwd }. Command
// substitutions, "bash -c", "eval" and the like are read as commands of their own.
// kind is "bash" or "powershell".
export function parseCommand(text, kind = 'bash', cwd = '.', depth = 0) {
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
  // The text of a $( ... ) from position i (just after the "("), and where it ends.
  const balanced = (i) => {
    let level = 1;
    let j = i;
    for (; j < text.length && level > 0; j += 1) {
      if (text[j] === '(') level += 1;
      else if (text[j] === ')') level -= 1;
    }
    return [text.slice(i, j - 1), j];
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
  for (const cmd of cmds) {
    let argv = cmd.argv;
    for (;;) {
      if (argv.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0])) argv = argv.slice(1);
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
    if (['cd', 'pushd', 'chdir', 'set-location', 'sl'].includes(p) && argv[1] && argv[1] !== '-') dir = resolve(dir, argv.filter((a) => !a.startsWith('-'))[1] ?? argv[1]);
    // A shell started with a command: its command is read too.
    const sh = SHELLS[p];
    if (sh) {
      const flag = argv.findIndex((a, i) => i > 0 && /^(-c|-command|-commandwithargs|\/c)$/i.test(a));
      if (flag > 0 && argv[flag + 1] !== undefined) out.push(...parseCommand(argv.slice(flag + 1).join(' '), sh, dir, depth + 1));
    }
    if (p === 'eval' || p === 'invoke-expression' || p === 'iex') out.push(...parseCommand(argv.slice(1).join(' '), kind, dir, depth + 1));
    if (p === 'cmd') {
      const flag = argv.findIndex((a) => /^\/[ck]$/i.test(a));
      if (flag > 0) out.push(...parseCommand(argv.slice(flag + 1).join(' '), 'bash', dir, depth + 1));
    }
  }
  for (const body of inner) out.push(...parseCommand(body, kind, cwd, depth + 1));
  return out;
}

// The code of "node -e", "python -c" and the like, or null.
function inlineCode(argv) {
  if (!INTERPRETERS.has(program(argv[0]))) return null;
  const i = argv.findIndex((a, k) => k > 0 && /^(-e|--eval|-p|--print|-c|-r|--command)$/.test(a));
  if (i > 0) return argv[i + 1] ?? '';
  const joined = argv.find((a) => /^--(eval|print)=/.test(a));
  return joined ? joined.split(/=(.*)/s)[1] : null;
}

// The words of a command that may be paths, and the parts of "--flag=value".
function pathWords(argv) {
  const words = [];
  for (const a of argv.slice(1)) {
    words.push(a);
    const eq = /^-[^=]*=(.+)$/.exec(a);
    if (eq) words.push(eq[1]);
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
const DELETERS = new Set(['rm', 'rmdir', 'del', 'erase', 'rd', 'mv', 'move', 'unlink', 'shred', 'remove-item', 'ri', 'move-item', 'mi']);
const GIT_WRITERS = new Set(['rm', 'mv', 'checkout', 'restore', 'clean', 'apply', 'stash', 'reset', 'switch']);
const HTTP = new Set(['curl', 'wget', 'http', 'https', 'xh', 'invoke-restmethod', 'irm', 'invoke-webrequest', 'iwr']);

const refuse = (rule, reason) => ({ rule, reason });

// ctx: { root, home, pluginRoot, cfg, settings (the project's .claude/pitwall.json), cwd,
//   git(args, dir) -> { ok, out, status, err }, checkPr(selector) -> null or a reason }
export function guard(call, ctx) {
  const { tool, input = {}, agentId, agentType } = call;
  const h = ctx.cfg.hooks;
  if (h.neverRefused.includes(tool)) return null;
  const root = norm(ctx.root);
  const home = norm(ctx.home);
  const plugin = norm(ctx.pluginRoot);
  const cwd = ctx.cwd ?? ctx.root;
  const protectedFiles = [
    `${root}/.claude/pitwall.json`,
    `${root}/.claude/settings.json`,
    `${root}/.claude/settings.local.json`,
    `${home}/.claude/settings.json`,
    `${home}/.claude/settings.local.json`,
  ];
  const contentPatterns = h.secrets.content.map((s) => new RegExp(s));
  const isSecretName = (name) => nameMatches(name, h.secrets.files) && !nameMatches(name, h.secrets.notSecret);
  const keyIn = (text) => typeof text === 'string' && contentPatterns.some((re) => re.test(text));
  const policy = agentId ? h.agents[agentType] : undefined;

  // The file a file tool writes, and what it writes.
  const target = FILE_WRITES.has(tool) ? (tool === 'NotebookEdit' ? input.notebook_path : input.file_path) : null;
  const written = tool === 'Write' ? [input.content] : tool === 'Edit' ? [input.new_string] : tool === 'MultiEdit' ? (input.edits ?? []).map((e) => e.new_string) : tool === 'NotebookEdit' ? [input.new_source] : [];

  // 1. An agent with limits of its own (T3a-AC4): the plan reviewer.
  if (policy) {
    if (target !== null) {
      const allowed = policy.write.map((f) => norm(resolve(ctx.root, f)));
      if (!allowed.includes(norm(resolve(cwd, String(target))))) return refuse('agent', `${agentType} writes only ${policy.write.join(', ')}, not ${target}.`);
    }
    if (COMMANDS.has(tool)) {
      const text = String(input.command ?? '');
      if (/[;&|<>`\n\r]|\$\(/.test(text)) return refuse('agent', `${agentType} runs one command at a time, with no ; & | < > backtick, $( or line break.`);
      const cmds = parseCommand(text, tool === 'PowerShell' ? 'powershell' : 'bash', cwd);
      const scripts = policy.run.map((s) => `${plugin}/scripts/${s}`);
      const ok = cmds.length === 1 && program(cmds[0].argv[0]) === 'node' && scripts.includes(wordPath(cmds[0].argv[1] ?? '', cmds[0].cwd, home));
      if (!ok) return refuse('agent', `${agentType} runs only ${policy.run.join(' and ')} from the pitwall plugin, as node "<path>" with its arguments.`);
    }
  }

  // 2. File tools.
  if (target !== null || tool === 'Read' || tool === 'Grep') {
    const file = tool === 'Read' ? input.file_path : tool === 'Grep' ? input.path : target;
    const p = file ? norm(resolve(cwd, String(file))) : null;
    if (p && isSecretName(basename(p))) return refuse('secrets', `${file} is a secret file: pitwall keeps agents out of it. Use .env.example or test values; a run that needs the real secrets is the owner's.`);
    if (tool === 'Grep' && input.glob && /\.env|\.pem|\.key|id_rsa/.test(String(input.glob)) && !nameMatches(String(input.glob), h.secrets.notSecret)) {
      return refuse('secrets', `a search through ${input.glob} reads secret files: pitwall keeps agents out of them.`);
    }
    if (target !== null) {
      if (written.some(keyIn)) return refuse('secrets', `what this writes to ${target} looks like a key or a token. Keep secrets out of files the agents write; tests make their keys at run time.`);
      if (protectedFiles.includes(p) || inside(p, plugin)) return refuse('switch', `${target} is one of the switches of pitwall's guards: only the owner, or a pitwall script, changes it.`);
      if (inside(p, root) && !inside(p, `${root}/.git`)) {
        const rel = p.slice(root.length + 1);
        const r = ctx.git(['check-ignore', '-q', '--', rel], ctx.root);
        if (r.status === 0) return refuse('ignored', `git ignores ${target}: it is generated or stays on this machine. Change the source it comes from; a file the owner wants changed by hand, the owner changes.`);
        if (r.status !== 1 && !/not a git repository/i.test(r.err)) return refuse('broken', `git check-ignore could not read ${target}: ${r.err || `exit ${r.status}`}.`);
      }
    }
    return null;
  }

  // 3. MCP tools: merge protection and commit statuses.
  if (tool.startsWith('mcp__')) {
    const name = tool.toLowerCase();
    const text = JSON.stringify(input);
    if (/protection|ruleset/.test(name) && !/(^|_)(get|list|read|search)/.test(name.split('__').pop())) return refuse('protection', `${tool} changes merge protection, which only the owner changes (pitwall ADR-0005).`);
    if (/status/.test(name) && text.includes(ctx.cfg.review.statusContext)) return refuse('review', `${ctx.cfg.review.statusContext} is set only by a pitwall reviewer, through review-status.mjs (pitwall ADR-0007).`);
    if (/merge/.test(name) && ctx.settings.mergeProtection !== 'branch-protection') return refuse('merge', `merge protection is ${ctx.settings.mergeProtection}: merge with gh pr merge, which pitwall checks.`);
    return null;
  }

  if (!COMMANDS.has(tool)) return null;
  const text = String(input.command ?? '');
  const cmds = parseCommand(text, tool === 'PowerShell' ? 'powershell' : 'bash', cwd);
  if (keyIn(text)) return refuse('secrets', 'this command holds what looks like a key or a token. Keep secrets out of commands; tests make their keys at run time.');
  const reviewer = Boolean(agentId) && h.reviewers.includes(agentType);
  const base = ctx.cfg.mergeProtection.branch;

  for (const { argv, redirects, inputs, cwd: dir } of cmds) {
    const p = program(argv[0]);
    const words = pathWords(argv);
    const code = inlineCode(argv);
    const git = p === 'git' ? gitCommand(argv) : null;
    const readOnly = ctx.cfg.hooks.readOnlyCommands.includes(p) || (git && ctx.cfg.hooks.readOnlyGit.includes(git.sub));

    // (a) Secret files, named by any command.
    for (const w of [...words, ...redirects, ...inputs]) {
      const name = basename(w.split('\\').join('/'));
      if (isSecretName(name)) return refuse('secrets', `${w} is a secret file: pitwall keeps agents out of it. Use .env.example or test values; a run that needs the real secrets is the owner's.`);
    }
    if (code !== null && code.split(/[\s'"`(),;=:+]+/).some((piece) => isSecretName(basename(piece.split('\\').join('/'))))) {
      return refuse('secrets', 'this inline script names a secret file: pitwall keeps agents out of it.');
    }

    // (d) The guards' switch: the settings, the plugin's folder, the plugin's enablement.
    const switchReason = 'is one of the switches of pitwall\'s guards: only the owner, or a pitwall script, changes it.';
    for (const t of redirects) {
      const tp = wordPath(t, dir, home);
      if (protectedFiles.some((f) => names(t, dir, home, f)) || inside(tp, plugin)) return refuse('switch', `${t} ${switchReason}`);
    }
    for (const w of words) {
      if (!readOnly && protectedFiles.some((f) => names(w, dir, home, f))) return refuse('switch', `${w} ${switchReason}`);
      const wp = wordPath(w, dir, home);
      const writes = WRITERS.has(p) || (git && GIT_WRITERS.has(git.sub)) || (['sed', 'perl'].includes(p) && argv.some((a) => /^(-i|--in-place)/.test(a) || /^-[a-hj-zA-Z]*i/.test(a)));
      if (writes && inside(wp, plugin)) return refuse('switch', `${w} is inside the pitwall plugin, one of the switches of its guards.`);
      if (DELETERS.has(p) && [...protectedFiles, plugin].some((f) => inside(f, wp))) return refuse('switch', `${w} holds the switches of pitwall's guards: only the owner removes it.`);
    }
    if (code !== null && (/pitwall\.json|settings(\.local)?\.json/.test(code) || code.toLowerCase().includes(plugin.toLowerCase()))) {
      return refuse('switch', 'this inline script names one of the switches of pitwall\'s guards.');
    }
    if (git?.sub === 'clean' && git.args.some((a) => /^-[a-zA-Z]*[xX]/.test(a))) return refuse('switch', 'git clean -x removes ignored files, and .claude/settings.local.json is one of the switches of pitwall\'s guards.');
    if (p === 'claude' && /^plugins?$/.test(argv[1] ?? '') && (/^(disable|uninstall|remove|rm)$/.test(argv[2] ?? '') || (argv[2] === 'marketplace' && /^(remove|rm)$/.test(argv[3] ?? '')))) {
      return refuse('switch', `claude ${argv.slice(1, 4).join(' ')} turns pitwall's guards off: only the owner does that.`);
    }

    // (c) Pushes that change main.
    if (git?.sub === 'push') {
      const reason = pushChangesMain(git, base, dir, ctx);
      if (reason) return refuse('push', reason);
    }

    // AC4: review-status.mjs only from the two reviewers.
    const runsReviewStatus = (!readOnly && argv.some((w) => /review-status\.mjs$/i.test(w))) || (code !== null && code.includes('review-status'));
    if (runsReviewStatus && !reviewer) return refuse('review', `only ${h.reviewers.join(' and ')} run review-status.mjs (pitwall ADR-0007), and this call comes from ${agentId ? agentType || 'a sub-agent' : 'the main conversation'}.`);

    // (e), AC4 and AC7 over the GitHub API: protection, statuses and merges.
    const api = apiCall(p, argv);
    if (api) {
      if (api.write && /\/branches\/[^/]+\/protection/.test(api.path)) return refuse('protection', `${api.method} ${api.path} changes branch protection, which only the owner changes (pitwall ADR-0005).`);
      if (api.write && /(^|\/)rulesets(\/|$)/.test(api.path)) return refuse('protection', `${api.method} ${api.path} changes a ruleset, which only the owner changes (pitwall ADR-0005).`);
      if (api.graphql && /\b(create|update|delete)(BranchProtectionRule|RepositoryRuleset)\b/.test(api.body)) return refuse('protection', 'this GraphQL mutation changes merge protection, which only the owner changes (pitwall ADR-0005).');
      if (api.write && /\/statuses\//.test(api.path)) return refuse('review', `${api.method} ${api.path} writes a commit status: ${ctx.cfg.review.statusContext} is set only through review-status.mjs (pitwall ADR-0007), and no other status is written by hand.`);
      const merges = (api.write && /\/pulls\/\d+\/merge$/.test(api.path)) || (api.graphql && /\bmergePullRequest\b/.test(api.body));
      if (merges && ctx.settings.mergeProtection !== 'branch-protection') return refuse('merge', `merge protection is ${ctx.settings.mergeProtection}: merge with gh pr merge, which pitwall checks.`);
    }
    if (p === 'gh' && argv[1] === 'pr' && argv[2] === 'merge') {
      if (argv.includes('--admin')) return refuse('protection', 'gh pr merge --admin bypasses the required checks, and admins are included in the protection (pitwall ADR-0005).');
      const mode = ctx.settings.mergeProtection;
      if (mode === 'pending') return refuse('merge', 'merge protection is pending: nothing merges until protect.mjs has set it up (pitwall ADR-0002).');
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
      }
    }
  }
  return null;
}

// Would this git push change the base branch? A reason, or null.
function pushChangesMain(git, base, dir, ctx) {
  const where = git.dir ? resolve(dir, git.dir) : dir;
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
  const current = () => {
    const r = ctx.git(['symbolic-ref', '--short', '-q', 'HEAD'], where);
    return r.ok ? r.out : '';
  };
  const refspecs = pos.slice(1);
  // "git push --tags" with no refspec pushes the tags only.
  if (tagsOnly && refspecs.length === 0) return null;
  const targets = refspecs.length === 0 ? [{ dst: current(), plus: false, gone: false }] : refspecs.map((r) => {
    const plus = r.startsWith('+');
    const s = plus ? r.slice(1) : r;
    const colon = s.indexOf(':');
    const src = colon < 0 ? s : s.slice(0, colon);
    let dst = colon < 0 ? s : s.slice(colon + 1);
    if (dst === 'HEAD' || (colon < 0 && src === 'HEAD')) dst = current();
    return { dst: dst.replace(/^refs\/heads\//, ''), plus, gone: colon === 0 };
  });
  for (const t of targets) {
    if (t.dst !== base) continue;
    if (del || t.gone) return `this push deletes ${base}, which only changes through a PR.`;
    if (force || t.plus) return `this is a forced push to ${base}, which only changes through a PR.`;
    // The skeleton is the only direct commit on main (SPEC 9): its first push passes.
    const count = ctx.git(['rev-list', '--count', `refs/heads/${base}`], where);
    if (count.ok && count.out === '1') return null;
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
    const url = argv.find((a) => /^https?:\/\/api\.github\.com\//i.test(a) || /api\.github\.com\//i.test(a));
    if (!url) return null;
    const path = url.replace(/^https?:\/\/api\.github\.com/i, '').replace(/[?#].*$/, '');
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
