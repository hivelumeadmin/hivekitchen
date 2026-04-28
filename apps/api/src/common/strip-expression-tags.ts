// Eleven v3 expression tags ([warmly], [pause], etc.) are TTS delivery hints,
// not transcript. Strip before persisting to thread_turns.body or returning
// to a text-mode client (where they would render as literal bracketed text).
// Defense-in-depth — the text-mode prompt already instructs the model not to
// emit them, but LLM rule-adherence is ~95% so a defensive filter is cheap.
const EXPRESSION_TAG = /\s*\[[a-z][a-z0-9\s-]*\]\s*/gi;

export function stripExpressionTags(text: string): string {
  return text.replace(EXPRESSION_TAG, ' ').replace(/\s+/g, ' ').trim();
}
