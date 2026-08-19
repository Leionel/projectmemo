import type { CardDraft, CardLink, LinkableCard } from "@/lib/types";

function normalize(value: string) {
  return value.trim().toLowerCase();
}

export function linkRelatedCards(draft: CardDraft, existingCards: LinkableCard[], limit = 3): CardLink[] {
  const current = new Map(draft.keywords.map((keyword) => [normalize(keyword), keyword]));
  return existingCards
    .map((card) => {
      const sharedKeywords = card.keywords.filter((keyword) => current.has(normalize(keyword)));
      return {
        relatedCardId: card.id,
        relatedTitle: card.title,
        sharedKeywords,
        score: sharedKeywords.length,
        reason: sharedKeywords.length ? `都包含关键词：${sharedKeywords.join("、")}` : "",
      };
    })
    .filter((link) => link.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
