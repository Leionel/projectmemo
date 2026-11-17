/**
 * Content-quality scoring for V2 continuous revision.
 *
 * Deterministic structural checks catch the cheap fakes we explicitly reject:
 * copying the user request, adding a title to unrelated text, unrelated citations that pretend to
 * retain old evidence, a few-character edit presented as a revision, and dropped unknowns.
 * Semantic truth (claims actually supported, redirect actually meaningful) stays in an explicit
 * HUMAN_REVIEW bucket and is never reported as a pass.
 */

export type QualitySource = { id: string; hash?: string; text: string };
export type DraftBlock = { blockId: string; text: string; kind: string; sourceIds: string[]; citations?: Array<{ sourceId: string }> };
export type DraftView = { text: string; blocks: DraftBlock[]; sourceIds: string[]; missingInformation?: string[] };
export type QualityCheck = { name: string; status: "PASS" | "FAIL" | "UNVERIFIED"; judge: "DETERMINISTIC" | "HUMAN_REVIEW"; detail: string };

const STOP = /今天|本周|这周|先|核对|对应|工作重点|中的|的/g;

function normalize(text: string): string {
  return text.toLowerCase().replace(/[\s，。；：、！？「」『』（）()【】[\]"'`~!@#$%^&*+=|\\/<>-]/g, "");
}
function tokens(text: string): Set<string> {
  const clean = normalize(text);
  const set = new Set<string>();
  for (let index = 0; index < clean.length - 1; index++) set.add(clean.slice(index, index + 2));
  for (const word of text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []) set.add(word);
  return set;
}
function overlap(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const token of left) if (right.has(token)) count++;
  return count;
}
function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  return overlap(left, right) / (left.size + right.size - overlap(left, right));
}
function focusTerms(quote: string): string[] {
  return quote.replace(STOP, " ").split(/[\s，。；、]+/).filter(term => term.length >= 2);
}

function check(name: string, passed: boolean, detail: string): QualityCheck {
  return { name, status: passed ? "PASS" : "FAIL", judge: "DETERMINISTIC", detail };
}

export function assessRevision(input: {
  previous: DraftView | null;
  current: DraftView;
  sources: QualitySource[];
  redirectQuote?: string | null;
  userRequest?: string | null;
  requiredUnknowns?: string[];
}): QualityCheck[] {
  const { previous, current, sources } = input;
  const currentTokens = tokens(current.text), sourceTokens = sources.reduce((set, source) => { for (const token of tokens(source.text)) set.add(token); return set; }, new Set<string>());
  const evidenceHits = overlap(currentTokens, sourceTokens);
  const sourceIds = new Set(sources.map(source => source.id));
  const cited = new Set([...current.sourceIds, ...current.blocks.flatMap(block => [...block.sourceIds, ...(block.citations ?? []).map(citation => citation.sourceId)])]);
  const unknownText = [current.text, ...(current.missingInformation ?? [])].join("\n");
  const checks: QualityCheck[] = [];

  checks.push(check("CURRENT_HAS_CONTENT", normalize(current.text).length >= 80, "当前稿正文长度 " + normalize(current.text).length + " 字"));
  const previousTokens = previous ? tokens(previous.text) : new Set<string>();
  const changedTokens = previous ? overlap(currentTokens, previousTokens) === 0 ? Math.max(currentTokens.size, previousTokens.size)
    : currentTokens.size + previousTokens.size - 2 * overlap(currentTokens, previousTokens) : currentTokens.size;
  const changedRatio = previous ? 1 - jaccard(previousTokens, currentTokens) : 1;
  checks.push(check("EFFECTIVE_REVISION", previous === null || (changedRatio >= 0.12 && changedTokens >= 24),
    previous === null ? "首版" : "与上一版差异率 " + changedRatio.toFixed(2) + "，变化词 " + changedTokens + "（改几个字不算修订）"));
  checks.push(check("EVIDENCE_BOUND", sources.length > 0 && evidenceHits >= 8 && current.blocks.some(block => block.sourceIds.length > 0),
    "正文与真实来源重合词 " + evidenceHits + "，来源绑定段落 " + current.blocks.filter(block => block.sourceIds.length > 0).length));
  checks.push(check("CITATIONS_RESOLVE", cited.size > 0 && [...cited].every(id => sourceIds.has(id)),
    "引用 " + cited.size + " 个，均可解析到本轮来源"));
  const unrelated = current.blocks.filter(block => block.citations?.some(citation => {
    const source = sources.find(item => item.id === citation.sourceId);
    return source ? overlap(tokens(block.text), tokens(source.text)) < 2 : true;
  }));
  checks.push(check("CITATIONS_RELEVANT", unrelated.length === 0, unrelated.length ? unrelated.length + " 段引用与正文无关" : "所有引用与所引段落相关"));
  if (previous) {
    const previousIds = new Set(previous.sourceIds.filter(id => sourceIds.has(id)));
    const retained = [...previousIds].filter(id => cited.has(id));
    checks.push(check("OLD_EVIDENCE_RETAINED", previousIds.size === 0 || retained.length === previousIds.size,
      "旧依据保留 " + retained.length + "/" + previousIds.size + "（新增无关引用不能冒充保留）"));
    const added = [...cited].filter(id => !previous.sourceIds.includes(id));
    checks.push(check("NEW_EVIDENCE_ADDED", added.length > 0, added.length ? "新增依据 " + added.join(",") : "没有引入任何新来源"));
  } else {
    checks.push(check("NEW_EVIDENCE_ADDED", true, "首版"));
    checks.push(check("OLD_EVIDENCE_RETAINED", true, "首版没有旧依据"));
  }
  if (input.userRequest) {
    const userOverlap = jaccard(currentTokens, tokens(input.userRequest));
    checks.push(check("NOT_COPY_OF_USER_REQUEST", !(userOverlap > 0.75 && evidenceHits < 12),
      "与用户要求重合率 " + userOverlap.toFixed(2) + "，与来源重合词 " + evidenceHits));
  }
  if (input.redirectQuote) {
    const terms = focusTerms(input.redirectQuote), hits = terms.filter(term => normalize(current.text).includes(normalize(term)));
    checks.push(check("REDIRECT_ADDRESSED", hits.length > 0 && evidenceHits >= 8 && (previous === null || changedTokens >= 10),
      "改道重点命中=" + (hits.join("|") || "无") + "，变化词 " + changedTokens + "，来源重合 " + evidenceHits));
  }
  if (input.requiredUnknowns?.length) {
    const missing = input.requiredUnknowns.filter(unknown => !unknownText.includes(unknown) && !unknownText.includes("未知") && !unknownText.includes("未给出") && !unknownText.includes("未写明"));
    checks.push(check("UNKNOWN_PRESERVED", missing.length === 0, missing.length ? "遗漏关键未知：" + missing.join("；") : "关键未知保留"));
  }
  return checks;
}

/** Semantic judgement cannot be proven by an offline fixture; it must never be reported as PASS. */
export function semanticReviewChecks(): QualityCheck[] {
  return [
    { name: "SEMANTIC_CLAIM_SUPPORT", status: "UNVERIFIED", judge: "HUMAN_REVIEW", detail: "每条事实主张是否被所引来源支持，需要真实模型输出或人工审核" },
    { name: "SEMANTIC_COMPARABILITY", status: "UNVERIFIED", judge: "HUMAN_REVIEW", detail: "条件不可比、负结果与未知是否被正确解释，需要人工审核" },
    { name: "SEMANTIC_REDIRECT", status: "UNVERIFIED", judge: "HUMAN_REVIEW", detail: "改道重点是否被实质落实（而非只出现关键词），需要人工审核" },
    { name: "SEMANTIC_USER_VALUE", status: "UNVERIFIED", judge: "HUMAN_REVIEW", detail: "成果是否满足用户真实目标，需要用户或人工审核" },
  ];
}

export function structuralPassed(checks: QualityCheck[]): boolean {
  return checks.every(item => item.status === "PASS");
}
