import { locateQuote } from "@/lib/evidence/quoteMatch";
import type { ConversationCitation, ConversationSource } from "@/lib/types/conversation";

/** 版面还原后可能比模型写的长，超过证据字段上限就不再当作可展示的引文。 */
const QUOTE_LIMIT = 1000;

function bindOne(observation: ConversationCitation, sources: ConversationSource[]) {
  const matches = sources.filter(s => s.id === observation.sourceId || s.sourceId === observation.sourceId);
  if (matches.length !== 1) return null;
  const quote = locateQuote(matches[0].excerpt, observation.quote)?.text;
  return quote && quote.length <= QUOTE_LIMIT ? { sourceId: matches[0].id, quote } : null;
}

/**
 * 逐条核对引文，只把来源别名和排版差异规范回原文；改写过的句子不会变成引文。
 * citations 只含通过的，aligned 与输入一一对应，没通过的位置是 null。
 */
export function bindAnswerEvidence(observations: ConversationCitation[], sources: ConversationSource[]) {
  const aligned = observations.map(observation => bindOne(observation, sources));
  return { aligned, citations: aligned.filter((citation): citation is ConversationCitation => citation !== null) };
}
