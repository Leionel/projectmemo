import { knowledgeTypeLabels, type KnowledgeTypeValue } from "@/lib/types";

/** Translate generated requirement lists for display without rewriting the saved source. */
export function readableProjectNotice(text: string): string {
  return text.replace(/(目前尚缺少：|当前缺失证据：)([^。\n]+)/g, (_, prefix: string, list: string) =>
    prefix + list.split("、").map(value => {
      const key = value.trim();
      return Object.prototype.hasOwnProperty.call(knowledgeTypeLabels, key) ? knowledgeTypeLabels[key as KnowledgeTypeValue] : value;
    }).join("、"));
}
