// What the scripted owner of the headless runs does with a question its facts and rules do not cover
// (owner, T3b): it answers as the assistant recommends, unless that would stop the work, and says so on a
// first line UNSCRIPTED, which the harness takes off, records and prints in the results. The run goes on,
// and the question stays visible: it is data for T5 on the questions the process asks the owner.

export const UNSCRIPTED_RULE = `- When a question is covered by neither the facts nor any rule above: write a first line that says exactly UNSCRIPTED, then answer: do as the assistant recommends; when its recommendation is to stop, to wait for you or to leave the work for later, take instead the option that lets the work go on now.`;

// The owner's reply without the marker, and the question it answered when the reply was unscripted.
export function readOwner(reply, assistant) {
  const text = String(reply ?? '').trim();
  if (!/^UNSCRIPTED\b/.test(text)) return { text, question: null };
  // The question: the last paragraph of the assistant's message that asks one, or the end of the message.
  const paragraphs = String(assistant ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const asked = [...paragraphs].reverse().find((p) => p.includes('?')) ?? paragraphs[paragraphs.length - 1] ?? '';
  // The marker alone on its line goes; "UNSCRIPTED: yes, go on" keeps what follows it, so no reply is ever empty.
  const rest = text.replace(/^UNSCRIPTED\b[ \t:.-]*/, '').trim();
  return { text: rest || 'Do as you recommend.', question: asked.replace(/\s+/g, ' ').slice(0, 400) };
}
