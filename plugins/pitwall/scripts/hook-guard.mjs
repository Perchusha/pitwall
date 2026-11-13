// The decisions of pitwall's PreToolUse guard (T3a-AC3, T3a-AC4, T3a-AC7), apart from the
// call budget and the check before a handback: a tool call and the project in, a refusal or
// nothing out. hook.mjs runs it, and scripts/check.mjs tests it through hook.mjs on recorded
// payloads.
//
// It reads shell commands well enough to find what an honest agent runs by mistake: a push to
// main, a secret file, the guards' own settings. A command built to hide what it does gets past
// it, and that is the reviewer's and the owner's to catch (review.threatModel, R-2).

import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, relative, resolve } from 'node:path';

const WIN = process.platform === 'win32';

// ---- Paths ----

// A path as a tool or a shell names it, made absolute from cwd, with forward slashes, in its
// own case: ~ and $HOME are the home folder, and Git Bash's /c/ is C:/ on Windows.
export function native(p, cwd = '.', home = '') {
  let w = String(p);
  const homeRef = /^(?:~|\$HOME|\$\{HOME\}|\$env:USERPROFILE|\$env:HOME|%USERPROFILE%)(?=[\\/]|$)/i.exec(w);
  if (homeRef && home) w = home + w.slice(homeRef[0].length);
  // The project folder as Claude Code gives it to hooks and to the shell.
  const projectRef = /^(?:\$CLAUDE_PROJECT_DIR|\$\{CLAUDE_PROJECT_DIR\}|\$env:CLAUDE_PROJECT_DIR|%CLAUDE_PROJECT_DIR%)(?=[\\/]|$)/i.exec(w);
  if (projectRef && process.env.CLAUDE_PROJECT_DIR) w = process.env.CLAUDE_PROJECT_DIR + w.slice(projectRef[0].length);
  // The temporary folder: by its variables, and as Git Bash mounts it at /tmp on Windows.
  const tempRef = /^(?:\$TMPDIR|\$\{TMPDIR\}|\$TEMP|\$\{TEMP\}|\$TMP|\$env:TEMP|\$env:TMP|%TEMP%|%TMP%)(?=[\\/]|$)/i.exec(w) ?? (WIN ? /^\/tmp(?=\/|$)/.exec(w) : null);
  if (tempRef) w = tmpdir() + w.slice(tempRef[0].length);
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
  // Variables the line sets to a plain value or to its repository's top ("S=/x/y", "ROOT=$(git rev-parse
  // --show-toplevel)", PowerShell's "$root = git rev-parse --show-toplevel"), put in the words after them.
  const vars = new Map();
  const key = (k) => (kind === 'powershell' ? k.toLowerCase() : k);
  const topOf = (d) => {
    for (let x = native(d); ; x = dirname(x)) {
      if (existsSync(`${x}/.git`)) return x;
      if (dirname(x) === x) return null;
    }
  };
  // (The parser keeps no body of a backtick substitution, so only "$(...)" can be read here.)
  const TOP = /\$\(\s*git\s+rev-parse\s+--show-toplevel\s*\)/g;
  const expand = (w) =>
    String(w)
      .replace(TOP, (m) => topOf(dir) ?? m)
      .replace(/\$\{(\w+)\}|\$(\w+)(?![\w:])/g, (m, a, b) => vars.get(key(a ?? b)) ?? m);
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
    // A line of assignments alone ("S=/x", "export S=/x") sets shell variables; before a command they are
    // its environment only, which the shell does not put in its words.
    // A value the shell splits ("P='a b'; git checkout -- $P") or a list is several paths only the run
    // knows: the name is forgotten, so its words stand for the whole tree, as a loop variable's do.
    const assigns = argv[0] === 'export' ? argv.slice(1) : argv;
    if (assigns.length && assigns.every((x) => /^[A-Za-z_]\w*=/.test(x))) {
      for (const x of assigns) {
        const [name, raw] = [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)];
        if (/\s/.test(raw.replace(TOP, ''))) vars.delete(key(name));
        else vars.set(key(name), expand(raw));
      }
    }
    // A loop or a read sets its variable at run time ("for f in $(git diff --name-only)", "while read f").
    if (argv[0] === 'for' && /^\w+$/.test(argv[1] ?? '')) vars.delete(key(argv[1]));
    if (/^foreach$/i.test(argv[0] ?? '') && /^\(?\$\w+$/.test(argv[1] ?? '')) vars.delete(key(argv[1].replace(/^\(?\$/, '')));
    if (program(argv[0]) === 'read') for (const x of argv.slice(1).filter((w) => /^\w+$/.test(w))) vars.delete(key(x));
    let ps = null;
    if (kind === 'powershell') {
      const spaced = /^\$(\w+)$/.exec(argv[0] ?? '');
      const glued = /^\$(\w+)=(.*)$/.exec(argv[0] ?? '');
      if (spaced && argv[1] === '=') ps = [spaced[1], argv.slice(2)];
      else if (glued) ps = [glued[1], [glued[2], ...argv.slice(1)].filter(Boolean)];
    }
    if (ps) {
      const [name, rest] = ps;
      const top = rest.join(' ') === 'git rev-parse --show-toplevel' ? topOf(dir) : null;
      if (top) vars.set(key(name), top);
      else if (rest.length === 1 && !/,|^@?\(/.test(rest[0])) vars.set(key(name), expand(rest[0]));
      // A command's output or a list ("$f = git diff --name-only", "'a','b'"): only the run knows it.
      else vars.delete(key(name));
    }
    // The words take the variables' values; an assignment's own name never does ("$p = 'x'" stays one).
    const expanding = vars.size > 0 || argv.some((x) => /rev-parse/.test(x));
    if (expanding) {
      argv = argv.map((x, i) => {
        if (ps && argv[1] === '=' && i < 2) return x;
        if (ps && i === 0) return x.slice(0, x.indexOf('=') + 1) + expand(x.slice(x.indexOf('=') + 1));
        return expand(x);
      });
    }
    // xargs hands its command operands only the run knows.
    let xargs = false;
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
        xargs = true;
        while (argv.length && argv[0].startsWith('-')) argv = argv.slice(1);
      } else break;
    }
    out.push({ argv, redirects: expanding ? cmd.redirects.map(expand) : cmd.redirects, inputs: expanding ? cmd.inputs.map(expand) : cmd.inputs, cwd: dir, ...(xargs ? { xargs } : {}) });
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

// T4d-AC3: the folder of the gate before every commit (pitwall ADR-0012).
const HOOKS_PATH = '.githooks';

// The options of git commit that take the next word as their value, unless it is glued on ("-mfix", "--message=x"),
// and the short ones among them as letters of a bundle ("-am <msg>"). -u and -S take a value only glued on.
const COMMIT_VALUED = new Set(['-m', '--message', '-F', '--file', '-C', '--reuse-message', '-c', '--reedit-message', '-t', '--template', '--author', '--date', '--cleanup', '--fixup', '--squash', '--trailer', '--pathspec-from-file']);
const COMMIT_SHORT_VALUED = 'mFCct';
const COMMIT_SHORT_GLUED = 'uS';

// The flag with which "git commit <args>" skips the pre-commit hook, as written, or null: --no-verify, or -n alone or
// in a bundle of short flags ("-an", "-anm x"), but not an n that is the value of a flag before it ("-mn"). The last of
// --no-verify, -n and --verify wins, as in git.
export function skipsCommitHook(args) {
  let skip = null;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--') break;
    if (a === '--no-verify') skip = a;
    else if (a === '--verify') skip = null;
    else if (a.startsWith('--')) {
      if (COMMIT_VALUED.has(a)) i += 1;
    } else if (/^-[^-]/.test(a)) {
      for (let k = 1; k < a.length; k += 1) {
        const c = a[k];
        if (c === 'n') skip = a;
        if (COMMIT_SHORT_VALUED.includes(c)) {
          if (k === a.length - 1) i += 1;
          break;
        }
        if (COMMIT_SHORT_GLUED.includes(c)) break;
      }
    }
  }
  return skip;
}

// The options of git config that take the next word as their value.
const CONFIG_VALUED = new Set(['-f', '--file', '--blob', '--type', '--default', '--comment', '--value']);
const CONFIG_SUBCOMMANDS = new Set(['set', 'unset', 'get', 'list', 'edit', 'rename-section', 'remove-section']);

// What "git config <args>" does to core.hooksPath that the gate before every commit does not allow, in words ("unsets
// core.hooksPath"), or null: a read, another key, or core.hooksPath set to .githooks, at any scope. Reads both forms,
// "git config [--unset] <key> [<value>]" and "git config set|unset <key> [<value>]" (git 2.46).
export function hooksPathChange(args) {
  const words = [];
  let action = null;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--') {
      words.push(...args.slice(i + 1));
      break;
    }
    if (CONFIG_VALUED.has(a)) i += 1;
    else if (a === '--unset' || a === '--unset-all') action = 'unset';
    else if (/^--(get|get-all|get-regexp|get-urlmatch|get-color|get-colorbool|list|edit|rename-section|remove-section)$/.test(a) || a === '-l' || a === '-e') action ??= 'read';
    else if (!a.startsWith('-')) words.push(a);
  }
  const sub = CONFIG_SUBCOMMANDS.has(words[0]) && words.length > 1 ? words.shift() : null;
  if (!/^core\.hookspath$/i.test(words[0] ?? '')) return null;
  if (sub === 'unset' || action === 'unset') return 'unsets core.hooksPath';
  if (sub === 'get' || sub === 'list' || action === 'read' || words.length < 2) return null;
  // The same folder however it is spelled: "./.githooks", ".githooks/" (review round 1).
  const folder = words[1].replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  return folder === HOOKS_PATH ? null : `sets core.hooksPath to "${words[1]}"`;
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

  // 1. An agent with limits of its own (T3a-AC4, T3b-AC4, T4c-AC5): the plan reviewer, the code reviewer and the qa agent.
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
      // A quoted heredoc as the input of the command, the way /pitwall:bug gives bugs.mjs a bug: bash expands
      // nothing in it, so it is data for the script, which must then be one of the agent's own (T4c-AC5). The first
      // line that is the delimiter alone ends it, as bash reads it, and only blank lines may follow: a line after it
      // would run as a command (review round 1). The command's words may also follow the delimiter on its line, and a
      // "2>&1" may stand before or after it (review round 2); whatever else is there meets the test below.
      const opener = tool === 'Bash' ? /^([^\n]*?)\s*<<(-?)\s*(['"])([A-Za-z_]\w*)\3([^\n]*?)[ \t]*\r?\n/.exec(text) : null;
      let heredoc = null;
      if (opener) {
        const rest = text.slice(opener[0].length).split(/\r?\n/);
        const end = rest.findIndex((l) => (opener[2] ? l.replace(/^\t+/, '') : l).replace(/[ \t]+$/, '') === opener[4]);
        if (end >= 0 && rest.slice(end + 1).every((l) => !l.trim())) heredoc = opener;
      }
      if (heredoc) text = `${heredoc[1]}${heredoc[5]}`.replace(/\s+2>&1(?=\s|$)/g, '');
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
      if (!one || !(runsScript || (!heredoc && (readsGit || runsGate)))) {
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
  // Whether a git command after each one in the line can throw work away.
  const discarding = cmds.map((c) => program(c.argv[0]) === 'git' && ['checkout', 'switch', 'restore', 'reset', 'clean', 'stash'].includes(gitCommand(c.argv).sub));
  const laterDiscard = discarding.map((_, i) => discarding.slice(i + 1).some(Boolean));

  for (const [i, { argv, redirects, inputs, cwd: dir, xargs }] of cmds.entries()) {
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

    // (f) T4d-AC3: the gate before every commit, the project's .githooks/pre-commit (pitwall ADR-0012). Narrow by
    // the owner's decision: git commit with --no-verify or -n, and git config that sets core.hooksPath to anything but
    // .githooks or unsets it. What it does not read is R-5.
    if (git?.sub === 'commit') {
      const flag = skipsCommitHook(git.args);
      if (flag) return refuse('precommit', `git commit ${flag} skips the gate before every commit, the project's .githooks/pre-commit (pitwall ADR-0012). Commit without it: when the gate is red, fix what it reports first. A commit of nothing but Markdown under docs/ and .claude/pitwall.json passes the hook even while the gate is red.`);
    }
    if (git?.sub === 'config') {
      const change = hooksPathChange(git.args);
      if (change) return refuse('precommit', `this git config ${change}, the setting that runs the gate before every commit from ${HOOKS_PATH} (pitwall ADR-0012). The only change pitwall makes is git config core.hooksPath ${HOOKS_PATH}; anything else is the owner's, in a terminal.`);
    }

    // T4a-AC1, L-12: a git command that would throw away uncommitted work. What a stash, a commit or git add
    // earlier in the same line kept ("git stash push -- a.js && git checkout -- a.js") is judged kept; the
    // rest is judged on the tree as it is now.
    if (git) {
      const where = git.dir ? native(git.dir, dir, home) : dir;
      if (xargs) git.runtime = true;
      const lost = discards(git, where, ctx, lineState);
      if (lost?.error) return refuse('broken', `git status could not read the tree before "git ${git.sub}": ${lost.error}.`);
      if (lost?.files.length) {
        const shown = lost.files.slice(0, 8).join(' ');
        const more = lost.files.length > 8 ? ` and ${lost.files.length - 8} more` : '';
        if (lost.stash) return refuse('uncommitted', `git stash ${git.args[0]} would throw away ${shown}${more}, uncommitted work kept in the stash (L-12). Apply it first (git stash pop), or leave the stash; the owner drops it in a terminal if it should go.`);
        // In a merge, a rebase, a cherry-pick or a revert, what it staged is its own, and git stash refuses
        // its unmerged paths: its --abort is the way back.
        const op = lost.untracked ? null : operation(where, ctx);
        return refuse('uncommitted', `git ${git.sub} would throw away uncommitted ${lost.untracked ? 'new files' : 'changes in'} ${shown}${more} (L-12). ${op ? `A ${op.name} is in progress: ${op.abort} ends it and puts the tree back as it was before it. To keep the changes instead,` : 'Keep them first:'} git stash push${lost.untracked ? ' -u' : ''} -- ${shown} keeps them in a stash to restore with git stash pop, or commit them; then run it again.`);
      }
      // Only a command after it in the line can need what this one kept.
      if (laterDiscard[i]) keeps(git, where, ctx, lineState);
    }
    lineState.made.push(...foldersMade(argv, git, dir, home));
    if (git && (git.sub === 'checkout' || git.sub === 'switch')) {
      const flag = git.args.findIndex((a) => /^(-[bBcC]|--create|--force-create|--orphan)$/.test(a));
      if (flag >= 0 && git.args[flag + 1]) switchedTo = git.args[flag + 1];
      else {
        const name = git.args.find((a) => !a.startsWith('-'));
        if (name && !git.args.includes('--') && ctx.git(['rev-parse', '--verify', '-q', `refs/heads/${name}`], git.dir ? native(git.dir, dir, home) : dir).ok) switchedTo = name;
      }
    }

    // T3b-AC6, T5a: the scripts that record a choice of the owner (hooks.ownerOnly): the one that records whether
    // merges may run without them (ADR-0010). The main conversation runs one only through Claude Code's permission
    // prompt: the guard answers "ask", which no allow rule and no mode's classifier answers for the owner (probed
    // on Claude Code 2.1.323), and only for the script run alone (a cd before it may stand), so that the prompt
    // shows the owner the whole command. No sub-agent runs one, and neither does a session whose mode never prompts.
    const ownerOnly = (h.ownerOnly ?? []).find((s) => argv.some((w) => basename(String(w).split('\\').join('/')).toLowerCase() === s) || (code !== null && code.includes(s)));
    if (ownerOnly && (INTERPRETERS.has(p) || basename(String(argv[0] ?? '').split('\\').join('/')).toLowerCase() === ownerOnly)) {
      const what = `${ownerOnly} records a choice of the owner (pitwall ADR-0010)`;
      if (agentId) return refuse('owner', `${what}: only the main conversation runs it, at the owner's permission prompt, never a sub-agent. Return the question to the main conversation.`);
      const alone = cmds.every((c, k) => k === i || ['cd', 'set-location', 'sl', 'pushd'].includes(program(c.argv[0])));
      if (!alone || code !== null || redirects.length > 0 || inputs.length > 0 || xargs) return refuse('owner', `${what}: run it alone, one command in the call (node "<plugin>/scripts/${ownerOnly}" --allow or --deny), so that Claude Code's permission prompt shows the owner exactly what runs.`);
      // From the project root, or with --project: the prompt is for this project, and so is the guard's note of it.
      if (!argv.includes('--project') && norm(dir, cwd, home) !== root) return refuse('owner', `${what}: run it from the project root, or with --project "<the project root>", so that the answer is recorded for this project.`);
      if ((h.noPromptModes ?? []).includes(call.permissionMode)) return refuse('owner', `${what}, and this session's permission mode (${call.permissionMode}) never asks them: hand the owner the command to run themselves in a terminal, from the project folder.`);
      return { rule: 'owner', ask: true, what, reason: `${what}: allow it only if this is your own answer. pitwall asks through this prompt whatever the session's mode or allow rules are, and never adds an allow rule for it.` };
    }

    // AC4: review-status.mjs only from the reviewers.
    const runsReviewStatus = ((INTERPRETERS.has(p) || /review-status\.mjs$/i.test(argv[0] ?? '')) && argv.some((w) => /review-status\.mjs$/i.test(w))) || (code !== null && code.includes('review-status'));
    if (runsReviewStatus && !reviewer) return refuse('review', `only ${h.reviewers.join(' and ')} run review-status.mjs (pitwall ADR-0007), and this call comes from ${agentId ? agentType || 'a sub-agent' : 'the main conversation'}.`);
    // T4c-AC8: each reviewer sets the status of its own kind of review only (hooks.agents.<agent>.review): the plan
    // reviewer the plan's, the code reviewer a change's, the qa agent a release's (ADR-0007, ADR-0013).
    // Every --review counts: the script reads the last one (review round 1).
    const kinds = argv.flatMap((a, k) => (a === '--review' ? [argv[k + 1]] : []));
    if (runsReviewStatus && policy?.review && (kinds.length === 0 || kinds.some((x) => x !== policy.review))) return refuse('review', `${agentType} sets ${ctx.cfg.review.statusContext} only through review-status.mjs --review ${policy.review} (pitwall ADR-0007, ADR-0013).`);

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
  // Git Bash hands git a "/c/..." path as "C:/..."; the hook's own git gets it as the agent wrote it.
  const specs = (paths ?? []).map((x) => (WIN && /^\/[a-zA-Z]\//.test(x) ? native(x) : x));
  const r = ctx.git(['-c', 'core.quotePath=false', '-c', 'status.relativePaths=false', 'status', '--porcelain=v2', `--untracked-files=${untracked}`, ...(specs.length ? ['--', ...specs] : [])], dir);
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
// What the line last did to a path in the index ('staged', 'unstaged', or null for nothing), and marking it.
const staging = (side, path) => side.paths.get(path) ?? side.all;
function mark(side, paths, value) {
  if (paths === 'all') {
    side.all = value;
    side.paths.clear();
  } else for (const p of paths) side.paths.set(p, value);
}
// An operand whose value only the run knows: a variable, a command's output, xargs' "{}".
const late = (x) => /[$`]|\{\}/.test(x);

// What the commands of one line did to the uncommitted work, by repository:
//   kept     by a stash or a commit: safe from every command after it (paths from the root, or 'all');
//   index    by path or for all paths, the last one winning: what git add staged, safe from a restore of
//            the work tree out of the index and from git clean; what git reset or restore --staged
//            unstaged, whose staged change a restore from the index then throws away too, and which git
//            clean deletes when it was staged as new; what git rm --cached removed, untracked now;
//   stashed  whether the line made a stash.
// line.made holds the folders commands of the line make (git clone, git init, git worktree add, mkdir).
function keptInLine(ctx) {
  const tops = new Map();
  const states = new Map();
  const line = (dir) => {
    if (!tops.has(dir)) {
      const r = ctx.git(['rev-parse', '--show-toplevel'], dir);
      tops.set(dir, r.ok && r.out ? r.out : dir);
    }
    const top = tops.get(dir);
    const side = () => ({ all: null, paths: new Map() });
    if (!states.has(top)) states.set(top, { top, stashed: false, kept: { tracked: new Set(), untracked: new Set() }, index: { tracked: side(), untracked: side() } });
    const st = states.get(top);
    // A folder git names another way than the shell (a short or a linked path) gets git's ":/" from the root.
    const down = relative(top, dir).split('\\').join('/');
    const show = (p) => {
      const rel = !down ? p : /^(\.\.|\/|[a-zA-Z]:)/.test(down) ? `:/${p}` : relative(dir, `${top}/${p}`).split('\\').join('/') || '.';
      return /[\s"'$`*?[\]();&|<>]/.test(rel) ? `"${rel}"` : rel;
    };
    return { st, show };
  };
  line.made = [];
  return line;
}

// The folders a command makes, as norm() gives them, and whether each is a repository of its own: git clone's,
// git init's and git worktree add's are; mkdir's is an empty folder in the repository around it.
function foldersMade(argv, git, dir, home) {
  const p = program(argv[0]);
  // A folder there already ("git init" in the project, "git clone x .") is read as it is.
  const made = (path) => (existsSync(path) ? [] : [{ path, repo: true }]);
  if (git?.sub === 'init') {
    // Without a folder, git init makes the one it runs in a repository.
    const target = gitOperands(git.args, ['--template', '--separate-git-dir', '-b', '--initial-branch', '--object-format', '--ref-format']).before[0] ?? '.';
    return made(norm(target, git.dir ? native(git.dir, dir, home) : dir, home));
  }
  if (git?.sub === 'clone') {
    const { before } = gitOperands(git.args, ['-o', '--origin', '-b', '--branch', '-u', '--upload-pack', '--reference', '--reference-if-able', '--separate-git-dir', '--depth', '--shallow-since', '--shallow-exclude', '-c', '--config', '--filter', '-j', '--jobs', '--template', '--server-option', '--bundle-uri']);
    const url = String(before[0] ?? '').replace(/[\\/]+$/, '');
    const target = before[1] ?? url.split(/[\\/:]/).pop()?.replace(/\.git$/, '');
    return target ? made(norm(target, dir, home)) : [];
  }
  if (git?.sub === 'worktree' && git.args[0] === 'add') {
    const target = gitOperands(git.args.slice(1), ['-b', '-B', '--reason']).before[0];
    return target ? made(norm(target, dir, home)) : [];
  }
  if (['mkdir', 'md', 'new-item', 'ni'].includes(p)) {
    const valued = /^-(itemtype|type|name|value)$/i;
    return argv.slice(1).filter((a, i) => !a.startsWith('-') && !valued.test(argv[i] ?? '')).map((a) => ({ path: norm(a, dir, home), repo: false }));
  }
  return [];
}

// What a git command would throw away of the uncommitted work in dir: { files, untracked } with the
// paths, { files, stash: true } with the entries of the stash, { error } when git cannot read the tree,
// or null. Only these lose work: checkout over paths or with -f, switch -f or --discard-changes, restore
// of the work tree, reset --hard, clean -f, stash drop and clear. A branch switch without -f, restore
// --staged alone, clean -n, reset --soft or --mixed keep it. Never lost: what a command earlier in the
// line kept; a change staged, when the work tree is restored from the index and the line did not unstage
// it; a file that is only deleted; a path in a merge conflict, which git merge --abort throws away too
// and --ours, --theirs or -m resolve. Paths that only the run knows ("-- $(git diff --name-only)", xargs)
// stand for the whole tree.
function discards(git, dir, ctx, line) {
  const a = git.args;
  const flag = (...names) => a.some((x) => names.includes(x));
  const short = (letter) => a.some((x) => /^-[a-zA-Z]+$/.test(x) && x.includes(letter));
  const runtime = (ops) => Boolean(git.runtime) || ops.some(late);
  // The folder is read only for a form that can throw work away; any other command passes untouched.
  // A repository a command earlier in the line makes (git clone, git init, git worktree add) holds no
  // work yet. A folder mkdir makes sits in the repository around it, which git then works on: judged
  // there, with the paths read from the new folder (base). Any other missing folder is one the guard
  // could not follow (a variable it does not know, a command's output), and a read that fails refuses.
  const missing = !existsSync(dir);
  const absent = () => {
    const made = line.made.filter((m) => inside(norm(dir), m.path));
    if (made.some((m) => m.repo)) return null;
    if (!made.length) return { error: `the folder ${dir} is not there as written: a folder named through a variable or a command's output is not followed, so name it plainly` };
    let up = dir;
    while (!existsSync(up) && dirname(up) !== up) up = dirname(up);
    return discards({ ...git, base: dir }, up, ctx, line);
  };
  const spec = (paths) => (git.base && paths ? paths.map((p) => native(p, git.base)) : paths);
  const isCommit = (x) => ctx.git(['rev-parse', '--verify', '-q', `${x}^{commit}`], dir).ok;
  // What the line did to a path's place in the index: 'removed' (git rm --cached) and 'unstaged' (git
  // reset, restore --staged) for sure, 'maybe-' either for paths only the run knew.
  const outOfIndex = (was) => ['unstaged', 'removed', 'maybe-unstaged', 'maybe-removed'].includes(was);
  // Untracked by now for sure: removed, or staged as new and unstaged.
  const untrackedNow = (e, was) => was === 'removed' || (was === 'unstaged' && e.x === 'A');
  // fromIndex: the work tree is restored from the index, so what is staged stays there, unless the line
  // took it out of the index first. A file untracked by now is left alone by a restore and by a reset.
  const tracked = (paths, fromIndex) => {
    const s = treeStatus(dir, ctx, spec(paths), 'no');
    if (s.error) return s;
    const { st, show } = line(dir);
    const changed = (c) => !['.', 'D'].includes(c);
    const files = s.entries.filter((e) => {
      if ((e.kind !== '1' && e.kind !== '2') || has(st.kept.tracked, e.path)) return false;
      const was = staging(st.index.tracked, e.path);
      if (!fromIndex) return !(e.x === 'A' && untrackedNow(e, was)) && (changed(e.x) || changed(e.y));
      if (untrackedNow(e, was)) return false;
      return was !== 'staged' && (changed(e.y) || (outOfIndex(was) && changed(e.x)));
    });
    return { files: files.map((e) => show(e.path)) };
  };
  // A name git could take for a branch: not ".", nothing a path or a pattern has and a ref cannot.
  const branchLike = (x) => !/^[.-]|\.\.|[*?[:\\\s]|\/$|\.lock$/.test(x);

  if (git.sub === 'checkout') {
    if (flag('-p', '--patch')) return null;
    const force = flag('-f', '--force') || short('f');
    const { before, after } = gitOperands(a, ['-b', '-B', '--orphan', '--conflict', '--pathspec-from-file']);
    // A branch switch or a new branch keeps the work: no operand, or ("main", "main --") a single one in a
    // folder the guard cannot read, where it is taken for the branch it usually is.
    const late2 = (after && runtime(after)) || (git.runtime && !after?.length && !before.length);
    if (!force && !late2 && !after?.length && (!before.length || (missing && before.length === 1 && (branchLike(before[0]) || late(before[0]))))) return null;
    if (missing) return absent();
    // Without "--", a first operand that names a commit is the commit (or the branch); the rest are paths.
    const source = after ? (before[0] ?? null) : before.length && isCommit(before[0]) ? before[0] : null;
    const paths = after ?? (source ? before.slice(1) : before);
    // Paths only the run knows ("xargs git checkout --", "-- $(git diff --name-only)", "-- $f"): the whole tree.
    if (late2) return tracked(null, !source);
    if (!paths.length) return force ? tracked(null, false) : null;
    return tracked(paths, !source);
  }
  if (git.sub === 'switch') {
    if (!(flag('-f', '--force', '--discard-changes') || short('f'))) return null;
    return missing ? absent() : tracked(null, false);
  }
  if (git.sub === 'restore') {
    const staged = flag('--staged') || short('S');
    const worktree = flag('--worktree') || short('W');
    if (staged && !worktree) return null;
    if (missing) return absent();
    const { before, after } = gitOperands(a, ['-s', '--source', '--pathspec-from-file']);
    const paths = [...before, ...(after ?? [])];
    // The work tree alone: the index keeps what is staged, whatever the source. git refuses a restore
    // without a path, so none means paths that come at run time.
    return tracked(!paths.length || runtime(paths) ? null : paths, !staged);
  }
  if (git.sub === 'reset') {
    if (!flag('--hard')) return null;
    return missing ? absent() : tracked(null, false);
  }
  if (git.sub === 'clean') {
    if (flag('-n', '--dry-run') || short('n') || !(flag('-f', '--force') || short('f'))) return null;
    if (missing) return absent();
    const { before, after } = gitOperands(a, ['-e', '--exclude']);
    // In a folder mkdir made, git clean starts from there.
    const paths = [...before, ...(after ?? [])];
    const unknown = runtime(paths);
    const where = unknown ? [] : git.base && !paths.length ? [git.base] : spec(paths);
    // Without -d or a path, git clean leaves the new folders alone.
    const s = treeStatus(dir, ctx, where, unknown || where.length || flag('-d') || short('d') ? 'all' : 'normal');
    if (s.error) return s;
    const { st, show } = line(dir);
    // New files, and the files the line took out of the index, or may have, so that they are untracked
    // now: one staged as new and unstaged, or any removed with git rm --cached.
    const cleaned = (e) => {
      if (e.kind === '?') return !e.path.endsWith('/') && staging(st.index.untracked, e.path) !== 'staged';
      const was = staging(st.index.tracked, e.path);
      return (e.kind === '1' || e.kind === '2') && e.y !== 'D' && (was === 'removed' || was === 'maybe-removed' || ((was === 'unstaged' || was === 'maybe-unstaged') && e.x === 'A'));
    };
    const files = s.entries.filter((e) => cleaned(e) && !has(st.kept.untracked, e.path));
    return { untracked: true, files: files.map((e) => show(e.path)) };
  }
  if (git.sub === 'stash' && (a[0] === 'drop' || a[0] === 'clear')) {
    if (missing) return absent();
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

// A merge, a rebase, a cherry-pick or a revert in progress, with the command that ends it, or null.
function operation(dir, ctx) {
  const ops = [['MERGE_HEAD', 'merge'], ['REBASE_HEAD', 'rebase'], ['CHERRY_PICK_HEAD', 'cherry-pick'], ['REVERT_HEAD', 'revert']];
  const found = ops.find(([ref]) => ctx.git(['rev-parse', '-q', '--verify', ref], dir).ok);
  return found ? { name: found[1], abort: `git ${found[1]} --abort` } : null;
}

// What a git command does to the uncommitted work for the commands after it in the line (discards): git
// add stages paths; git reset (mixed), restore --staged and rm --cached unstage them; a commit keeps what
// it commits; a stash push keeps what it takes. Paths only the run knows keep and stage nothing, and
// unstage everything.
function keeps(git, dir, ctx, line) {
  if (!['add', 'commit', 'stash', 'reset', 'restore', 'rm'].includes(git.sub) || !existsSync(dir)) return;
  const sub = git.sub === 'stash' ? (git.args[0] && !git.args[0].startsWith('-') ? git.args[0] : 'push') : git.sub;
  // A stash popped or applied puts its work back in the tree, where nothing keeps it any more.
  if (git.sub === 'stash' && (sub === 'pop' || sub === 'apply')) {
    const { st } = line(dir);
    st.kept = { tracked: new Set(), untracked: new Set() };
    return;
  }
  if (git.sub === 'stash' && !['push', 'save'].includes(sub)) return;
  const a = git.sub === 'stash' && git.args[0] === sub ? git.args.slice(1) : git.args;
  const flag = (...names) => a.some((x) => names.includes(x));
  const short = (letter) => a.some((x) => /^-[a-zA-Z]+$/.test(x) && x.includes(letter));
  const { st } = line(dir);
  const listed = (paths) => {
    if (paths.some(late)) return [];
    const s = treeStatus(dir, ctx, paths);
    return s.error ? [] : s.entries;
  };
  const trackedOf = (entries) => entries.filter((e) => e.kind === '1' || e.kind === '2').map((e) => e.path);
  const newOf = (entries) => entries.filter((e) => e.kind === '?').map((e) => e.path);
  // What a commit of the index takes: each change whole in the index by now, staged in the line, or
  // staged before it with nothing more in the work tree and not unstaged since.
  const keepStaged = () => {
    for (const e of listed([])) {
      const was = staging(e.kind === '?' ? st.index.untracked : st.index.tracked, e.path);
      if (e.kind === '?') {
        if (was === 'staged') st.kept.untracked = join2(st.kept.untracked, [e.path]);
      } else if ((e.kind === '1' || e.kind === '2') && (was === 'staged' || (was == null && e.x !== '.' && ['.', 'D'].includes(e.y)))) st.kept.tracked = join2(st.kept.tracked, [e.path]);
    }
  };
  // Paths only the run knows ("git rm --cached $(...)", xargs) may name any path: each is marked as maybe
  // out of the index, which a restore from the index and git clean both judge the losing way.
  const unstage = (paths, value = 'unstaged') => {
    if (git.runtime || paths.some(late)) {
      mark(st.index.tracked, 'all', `maybe-${value}`);
      mark(st.index.untracked, 'all', 'maybe-unstaged');
      return;
    }
    if (!paths.length) {
      mark(st.index.tracked, 'all', value);
      mark(st.index.untracked, 'all', 'unstaged');
      return;
    }
    const e = listed(paths);
    mark(st.index.tracked, trackedOf(e), value);
    mark(st.index.untracked, newOf(e), 'unstaged');
  };

  if (sub === 'add') {
    if (flag('-n', '--dry-run', '-p', '--patch', '-i', '--interactive', '-e', '--edit', '-N', '--intent-to-add') || ['n', 'p', 'i', 'e', 'N'].some(short)) return;
    const { before, after } = gitOperands(a, ['--pathspec-from-file']);
    const paths = [...before, ...(after ?? [])];
    const update = flag('-u', '--update') || short('u');
    if (!paths.length) {
      if (flag('-A', '--all', '--no-ignore-removal') || short('A')) {
        mark(st.index.tracked, 'all', 'staged');
        mark(st.index.untracked, 'all', 'staged');
      } else if (update) mark(st.index.tracked, 'all', 'staged');
      return;
    }
    const e = listed(paths);
    mark(st.index.tracked, trackedOf(e), 'staged');
    if (!update) mark(st.index.untracked, newOf(e), 'staged');
    return;
  }
  if (sub === 'reset') {
    if (flag('--soft', '--hard', '--keep', '--merge')) return;
    const { before, after } = gitOperands(a, ['--pathspec-from-file']);
    // git reset [<commit>] [--] [<paths>]: without "--", a first operand that names a commit is the commit.
    return unstage(after ?? (before.length && ctx.git(['rev-parse', '--verify', '-q', `${before[0]}^{commit}`], dir).ok ? before.slice(1) : before));
  }
  if (sub === 'restore') {
    if (!(flag('--staged') || short('S'))) return;
    const { before, after } = gitOperands(a, ['-s', '--source', '--pathspec-from-file']);
    return unstage([...before, ...(after ?? [])]);
  }
  if (sub === 'rm') {
    if (!flag('--cached')) return;
    const { before, after } = gitOperands(a, ['--pathspec-from-file']);
    return unstage([...before, ...(after ?? [])], 'removed');
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
    st.kept.untracked = untracked ? 'all' : join2(st.kept.untracked, newOf(listed([])).filter((p) => staging(st.index.untracked, p) === 'staged'));
    return;
  }
  const e = listed(paths);
  st.kept.tracked = join2(st.kept.tracked, trackedOf(e));
  st.kept.untracked = join2(st.kept.untracked, newOf(e).filter((p) => untracked || staging(st.index.untracked, p) === 'staged'));
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
