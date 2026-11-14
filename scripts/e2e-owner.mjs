// What the scripted owner of the headless runs does with a question its facts and rules do not cover
// (owner, T3b): it answers as the assistant recommends, unless that would stop the work, and says so on a
// first line, which the harness takes off, records and prints in the results. The run goes on, and the
// question stays visible: it is data for T5 on the questions the process asks the owner. An answer that
// went on against a recommendation to stop is marked apart, and the run's result names it (T4a-AC5).

// The name of the project the headless runs build. It is not the name of any real project of the owner's: the app
// the runs build keeps its settings and caches under this name in the account's folders (%APPDATA%, ~/Library), and
// under the first name, move-reminder, they landed in the folder of the owner's own reminder (T5a).
export const TEST_PROJECT = 'pitwall-e2e-reminder';

export const UNSCRIPTED_RULE = `- When a question is covered by neither the facts nor any rule above: write a first line that says exactly UNSCRIPTED, then answer as the assistant recommends. When its recommendation is to stop, to wait for you or to leave the work for later, write instead a first line that says exactly UNSCRIPTED OVERRIDE, then take the option that lets the work go on now.`;

// The owner's reply without the marker; the question it answered when the reply was unscripted, and
// whether it overrode a recommendation to stop.
export function readOwner(reply, assistant) {
  const text = String(reply ?? '').trim();
  // The marker as the rule writes it, or as a model dresses it: bold, in any case, with punctuation
  // ("UNSCRIPTED - OVERRIDE", "(OVERRIDE)"), or OVERRIDE alone on the next line. OVERRIDE anywhere on the
  // marker's line counts: a stop overridden is what the result must not hide.
  const lines = text.split('\n');
  const wordsOf = (l) => String(l ?? '').replace(/[^A-Za-z]+/g, ' ').trim().toUpperCase();
  const first = wordsOf(lines[0]);
  if (!/^UNSCRIPTED\b/.test(first)) return { text, question: null, override: false };
  const alone = first === 'UNSCRIPTED' && wordsOf(lines[1]) === 'OVERRIDE';
  const head = lines[0].replace(/^[\W_]*UNSCRIPTED\b[\W_]*(?:OVERRIDE\b[\W_]*)?/i, '');
  const mark = { override: /\bOVERRIDE\b/.test(first) || alone, rest: [head, ...lines.slice(alone ? 2 : 1)].join('\n') };
  // The question: the last paragraph of the assistant's message that asks one, or the end of the message.
  const paragraphs = String(assistant ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const asked = [...paragraphs].reverse().find((p) => p.includes('?')) ?? paragraphs[paragraphs.length - 1] ?? '';
  // The marker alone on its line goes; "UNSCRIPTED: yes, go on" keeps what follows it, so no reply is ever empty.
  const rest = mark.rest.replace(/^[ \t:.-]*/, '').trim();
  return { text: rest || 'Do as you recommend.', question: asked.replace(/\s+/g, ' ').slice(0, 400), override: mark.override };
}

// The result's word: a run that went on against a recommendation to stop is not a plain PASS (T4a-AC5).
export function resultWord(passed, unscripted) {
  const overridden = unscripted.filter((u) => u.override).length;
  return !passed ? 'FAIL' : overridden ? `PASS, stops overridden: ${overridden}` : 'PASS';
}
