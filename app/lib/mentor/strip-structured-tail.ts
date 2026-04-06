const RIDVAN_STRUCTURED_MARKS = ['---RIDVAN_EVENTS---', '---RIDVAN_INSIGHT---'] as const;

/** Tar bort events/insight-del som inte ska visas i chatten (t.ex. SSE-stream eller modellfel). */
export function stripMentorStructuredTailForUi(text: string): string {
  if (!text) {
    return text;
  }
  let out = text;
  for (const mark of RIDVAN_STRUCTURED_MARKS) {
    const idx = out.indexOf(mark);
    if (idx !== -1) {
      out = out.slice(0, idx);
    }
  }
  return out.trimEnd();
}
