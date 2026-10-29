export function researchReadLevelLabel(level?: string) {
  return ({ ACADEMIC_METADATA:"论文元数据与摘要（非全文）", SEARCH_SNIPPET: "检索短摘", SEARCH_SUMMARY: "检索长摘要", FETCH_EXCERPT: "网页正文片段", DOCUMENT_EXTRACT: "文档片段", UNAVAILABLE: "尚未取得正文" } as Record<string, string>)[level ?? ""] ?? "来源片段";
}
export function researchCoverageLabel(state: string) {
  return ({ UNSEEN: "尚未查到", SUMMARY_ONLY: "仅有摘要", PARTIAL: "部分依据", READ_SUFFICIENT: "已读相关依据", CONFLICTED: "存在冲突", UNAVAILABLE: "来源不可读", UNKNOWN: "尚待核对" } as Record<string, string>)[state] ?? "尚待核对";
}
