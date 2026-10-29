export function researchReadLevelLabel(level: string): string {
  switch (level) {
    case 'SEARCH_SNIPPET': return '检索短摘';
    case 'ACADEMIC_METADATA': return '论文元数据与摘要（非全文）';
    case 'SEARCH_SUMMARY': return '检索长摘要';
    case 'FETCH_EXCERPT': return '网页正文片段';
    case 'DOCUMENT_EXTRACT': return '文档片段';
    case 'UNAVAILABLE': return '尚未取得正文';
    default: return '来源片段';
  }
}
