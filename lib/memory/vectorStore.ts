import type { CardDraft, CardLink, LinkableCard } from "@/lib/types";
import { linkRelatedCards } from "@/lib/memory/linker";

export interface VectorStore {
  index(card: LinkableCard): Promise<void>;
  search(draft: CardDraft, cards: LinkableCard[], limit?: number): Promise<CardLink[]>;
}

export class KeywordVectorStore implements VectorStore {
  async index(card: LinkableCard) {
    void card; // SQLite persistence already indexes the card for this MVP.
  }
  async search(draft: CardDraft, cards: LinkableCard[], limit = 3) {
    return linkRelatedCards(draft, cards, limit);
  }
}
