import type { ChallengeAnswer, ChallengeKind, ChallengeQuestion, ChallengeSession } from "@/lib/types/challenge";

export function challengeKindLabel(kind: ChallengeKind) {
  return kind === "EVIDENCE" ? "证据侦探" : kind === "REHEARSAL" ? "交付彩排" : "指标核对";
}

export const REHEARSAL_STEPS = [
  { key: "evidence", label: "依据", hint: "这段成果的哪一处依据，还值得核对？" },
  { key: "unknown", label: "边界", hint: "哪个尚未确认的条件，会影响这次交付？" },
  { key: "revision", label: "改稿", hint: "希望忆程下一版具体改进什么？" },
] as const;

export function rehearsalStep(question: ChallengeQuestion, index: number) {
  return REHEARSAL_STEPS.find(step => step.key === question.key) ?? REHEARSAL_STEPS[Math.min(index, REHEARSAL_STEPS.length - 1)];
}

export type MentorFinding = {
  questionKey: string;
  stepLabel: string;
  /** “原文”表示这条意见对应稿件里的真实文字；“待核对”表示原稿没有可引用的片段。 */
  basisLabel: "原文" | "待核对";
  basis: string;
  suggestion: string;
  evidenceKey?: string;
};

/** 右侧“本轮发现”由真实问题与原回答组成；不生成模型建议，也不把回答当成已批准结论。 */
export function mentorFinding(question: ChallengeQuestion, answer: ChallengeAnswer, index: number): MentorFinding {
  const step = rehearsalStep(question, index);
  if (question.key === "evidence") return { questionKey: question.key, stepLabel: step.label, basisLabel: "原文", basis: question.excerpt.trim(), suggestion: answer.text.trim(), evidenceKey: answer.evidenceKeys?.[0] };
  if (question.key === "unknown" && !question.excerpt.trim().startsWith("从原记录")) {
    return { questionKey: question.key, stepLabel: step.label, basisLabel: "原文", basis: question.excerpt.trim(), suggestion: answer.text.trim(), evidenceKey: answer.evidenceKeys?.[0] };
  }
  return { questionKey: question.key, stepLabel: step.label, basisLabel: "待核对",
    basis: question.key === "unknown" ? "原稿没有记录这一条件。" : "下一版的具体位置，由你的改稿意见确定。",
    suggestion: answer.text.trim(), evidenceKey: answer.evidenceKeys?.[0] };
}

export type EvidenceVerdict = { tone: "match" | "review"; title: string; detail: string; note: string };

/** 只解释服务端 verdict；不在前端比较选项与隐藏答案。 */
export function evidenceVerdict(session: ChallengeSession): EvidenceVerdict | null {
  const answer = session.answers[0];
  if (session.kind !== "EVIDENCE" || !answer) return null;
  return answer.verdict === "LINK_MATCH"
    ? { tone: "match", title: "引用关系已对上", detail: "内容仍待核验", note: "这只说明这段稿确实引用了所选记录，不代表结论已经被来源支持。" }
    : { tone: "review", title: "引用关系与稿件不一致", detail: "需要复核", note: "可以打开原记录继续核对，或把“这段没有引用依据”作为缺口交回；内容仍待核验。" };
}

const SPACE = /\s/;

function normalized(text: string) {
  let value = "", lastSpace = false;
  const map: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (SPACE.test(char)) {
      if (!lastSpace && value) { value += " "; map.push(index); lastSpace = true; }
      continue;
    }
    value += char; map.push(index); lastSpace = false;
  }
  return { value, map };
}

/**
 * 在来源全文里定位与稿件原句最长的共同片段。
 * 这是展示定位，不是事实判断；找不到时返回 null，界面会明确说明。
 */
export function locateExcerpt(sourceText: string, excerpt: string): { start: number; end: number } | null {
  const source = normalized(sourceText), target = normalized(excerpt);
  if (!source.value || !target.value) return null;
  const window = Math.min(8, target.value.length);
  if (window < 4) return null;
  let best = { length: 0, start: 0, end: 0 };
  for (let index = 0; index + window <= target.value.length; index += Math.max(1, Math.floor(window / 2))) {
    const seed = target.value.slice(index, index + window);
    let from = 0;
    while (from <= source.value.length - window) {
      const at = source.value.indexOf(seed, from);
      if (at < 0) break;
      let left = 0, right = window;
      while (at - left - 1 >= 0 && index - left - 1 >= 0 && source.value[at - left - 1] === target.value[index - left - 1]) left++;
      while (at + right < source.value.length && index + right < target.value.length && source.value[at + right] === target.value[index + right]) right++;
      if (right + left > best.length) best = { length: right + left, start: at - left, end: at + right };
      from = at + 1;
    }
  }
  if (best.length >= Math.min(8, target.value.length)) return { start: source.map[best.start], end: source.map[best.end - 1] + 1 };
  // 稿件常是来源的改写；逐字匹配失败时，按相邻二字片段重合度定位最相关段落。
  const grams = new Set<string>();
  const cleaned = target.value.replace(/[\s，。；：、！？（）()“”"'·—\-.,;:!?]/g, "");
  for (let index = 0; index + 2 <= cleaned.length; index++) grams.add(cleaned.slice(index, index + 2));
  if (grams.size < 3) return null;
  let chosen: { start: number; end: number; score: number } | null = null;
  for (const paragraph of paragraphs(sourceText)) {
    let hits = 0;
    for (const gram of grams) if (paragraph.text.includes(gram)) hits++;
    const score = hits / grams.size;
    if (hits >= 3 && score >= 0.15 && (!chosen || score > chosen.score)) chosen = { start: paragraph.start, end: paragraph.end, score };
  }
  return chosen ? { start: chosen.start, end: chosen.end } : null;
}

function paragraphs(text: string) {
  const result: Array<{ text: string; start: number; end: number }> = [];
  let cursor = 0;
  for (const line of text.split("\n")) {
    const start = cursor, end = cursor + line.length;
    if (line.trim()) result.push({ text: line, start, end });
    cursor = end + 1;
  }
  return result;
}

/** 把原文拆成高亮/非高亮片段，保持原始换行。 */
export function highlightSegments(text: string, range: { start: number; end: number } | null) {
  if (!range || range.start < 0 || range.end > text.length || range.start >= range.end) return [{ text, marked: false }];
  return [
    { text: text.slice(0, range.start), marked: false },
    { text: text.slice(range.start, range.end), marked: true },
    { text: text.slice(range.end), marked: false },
  ].filter(segment => segment.text);
}

/** 交回后的真实进度文案；不把“已保存反馈”说成“正在写入”或“已保存新稿”。 */
export function handoffStatus(phase: string) {
  if (phase === "RUNNING") return "原委托已接到反馈，正在处理；新稿保存前不会出现打开入口。";
  if (phase === "QUEUED" || phase === "READY") return "反馈已保存，等待后台派发；新稿保存前不会出现打开入口。";
  if (phase === "WAITING_OBSERVATION") return "反馈已保存；原委托在观察新资料，尚未保存新稿。";
  if (phase === "WAITING_USER") return "反馈已保存；原委托在等待你的判断。";
  if (phase === "PAUSED") return "原委托已暂停，恢复后才会继续处理这条反馈。";
  if (phase === "COMPLETED") return "原委托已结束；反馈保留在原记录中。";
  return "反馈已保存为待核对材料；当前没有新稿回执。";
}

export function sprintClock(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}
