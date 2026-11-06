import { quoteKey } from "@/lib/evidence/quoteMatch";
import type { IntakeUnderstanding } from "./contracts";

/**
 * 逐条核对模型引文，只留下确实来自材料的。
 *
 * 模型标错材料但引文确实在另一份里时，改绑到真正的出处；哪份都找不到的丢弃并返回，
 * 由调用方决定这一版还能不能成立。
 */
export function verifyQuotes(understanding: IntakeUnderstanding, materials: Array<{ id: string; rawText: string | null }>) {
  const texts = materials.map(material => ({ id: material.id, key: quoteKey(material.rawText ?? "") }));
  const quotes: IntakeUnderstanding["quotes"] = [];
  const dropped: IntakeUnderstanding["quotes"] = [];
  for (const quote of understanding.quotes) {
    const key = quoteKey(quote.quote);
    const source = key ? texts.find(text => text.id === quote.materialId && text.key.includes(key)) ?? texts.find(text => text.key.includes(key)) : undefined;
    if (source) quotes.push({ ...quote, materialId: source.id });
    else dropped.push(quote);
  }
  return { understanding: { ...understanding, quotes }, dropped };
}
