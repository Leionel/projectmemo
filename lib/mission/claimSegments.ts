const listPrefix = /^(?:[-*+]\s+|\d{1,3}(?:\.\d{1,3})*[.．、)]\s+|[一二三四五六七八九十]+[、.．]\s*)/;
const section = /^(?:已完成事项|已完成|当前风险|风险|下一步|待补充信息|项目概况|背景|结论|建议|资料来源|参考资料|摘要)[:：]?$/;
const title = /^(?:阶段汇报|周报|实验报告|研究报告|项目总结)(?:草稿|初稿|摘要)?(?:[（(][^）)\r\n]{1,120}[）)])?$/;
/** Keep exact source offsets; exclude presentation-only lines and list markers. */
export function segmentClaims(text: string) {
  const claims: Array<{ start: number; end: number }> = [];
  const segmenter = new Intl.Segmenter("zh", { granularity: "sentence" });
  let offset = 0;
  for (const line of text.split(/(?<=\n)/)) {
    let start = offset + (line.match(/^\s*/)?.[0].length ?? 0);
    let body = line.trim();
    const heading = body.match(/^#{1,6}\s+/)?.[0] ?? "";
    start += heading.length; body = body.slice(heading.length);
    const prefix = body.match(listPrefix)?.[0] ?? "";
    start += prefix.length; body = body.slice(prefix.length);
    const presentationTitle = title.test(body) && !/(?:准确率|达到|超过|提升|已完成|\d\s*(?:%|ms|mm|cm|秒|小时|MB|GB))/.test(body);
    if (body && !section.test(body) && !presentationTitle) {
      for (const part of segmenter.segment(body)) {
        const leading = part.segment.match(/^\s*/)?.[0].length ?? 0;
        const value = part.segment.trim();
        if (value) claims.push({ start: start + part.index + leading, end: start + part.index + leading + value.length });
      }
    }
    offset += line.length;
  }
  return claims;
}
export function claimNumbers(text: string) {
  return [...text.matchAll(/[-+]?\d+(?:\.\d+)?/g)].filter(match => {
    const before = text[match.index! - 1] ?? "", after = text.slice(match.index! + match[0].length);
    return !/[A-Za-z_\d.]/.test(before) && (!/^[A-Za-z_]/.test(after) || /^(?:ms|mm|cm|MB|GB)(?![A-Za-z_])/i.test(after));
  }).map(match => match[0]);
}
