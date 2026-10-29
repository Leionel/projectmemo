import type { ConversationCitation, ConversationSource } from "@/lib/types/conversation";

/** Canonicalize unique source aliases and whitespace only. Paraphrases never become quotations. */
export function bindAnswerEvidence(observations: ConversationCitation[], sources: ConversationSource[]) {
  const citations: ConversationCitation[] = [];
  for (const observation of observations) {
    const matches = sources.filter(s => s.id === observation.sourceId || s.sourceId === observation.sourceId);
    if (matches.length !== 1) return null;
    const source = matches[0];
    let quote = observation.quote;
    if (!source.excerpt.includes(quote)) {
      const pattern = quote.trim().split(/\s+/u).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
      const matched = pattern ? new RegExp(pattern, "u").exec(source.excerpt) : null;
      if (!matched) return null;
      quote = matched[0];
    }
    citations.push({ sourceId: source.id, quote });
  }
  return citations;
}
