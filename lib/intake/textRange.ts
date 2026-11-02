/** 保持既有 UTF-16 长度/偏移合同，边界不拆开完整的代理对。 */
function splitsPair(text: string, offset: number) {
  const before = text.charCodeAt(offset - 1), after = text.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

export function intactPrefix(text: string, limit: number) {
  let end = Math.min(text.length, Math.max(0, Math.trunc(limit)));
  if (splitsPair(text, end)) end--;
  return text.slice(0, end);
}

export function originalTextPage(text: string, requestedOffset = 0, requestedLimit = 4000) {
  const limit = Math.min(4000, Math.max(200, Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : 4000));
  let offset = Math.min(text.length, Math.max(0, Number.isFinite(requestedOffset) ? Math.trunc(requestedOffset) : 0));
  if (splitsPair(text, offset)) offset--;
  const page = intactPrefix(text.slice(offset), limit);
  return { totalChars: text.length, offset, limit, text: page, hasMore: offset + page.length < text.length };
}
