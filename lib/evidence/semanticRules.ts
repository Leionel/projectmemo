/** 有界文本规则，不将未匹配解释为反证。与 Mission 核验共用。 */
const normalize = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ");
const numberPattern = /[-+]?\d+(?:\.\d+)?/g;
export function ruleVerdict(claim: string, evidence: string): { status: "ENTAILS" | "CONTRADICTS"; reasonCode: string } | null {
  const c = normalize(claim), e = normalize(evidence);
  if (c === e) return { status: "ENTAILS", reasonCode: "EXACT_QUOTATION" };
  const cn = c.match(numberPattern) ?? [], en = e.match(numberPattern) ?? [];
  if (cn.length && cn.length === en.length && c.replace(numberPattern, "#") === e.replace(numberPattern, "#") && cn.some((v, i) => Number(v) !== Number(en[i])))
    return { status: "CONTRADICTS", reasonCode: "NUMERIC_MISMATCH" };
  const polarity = /(?:没有|未)(?=(?:显著)?(?:改善|提升|通过|完成))|不(?=(?:支持|通过))/g;
  if (c.replace(polarity, "") === e.replace(polarity, "") && (c.match(polarity)?.length ?? 0) !== (e.match(polarity)?.length ?? 0))
    return { status: "CONTRADICTS", reasonCode: "NEGATION_MISMATCH" };
  return null;
}
