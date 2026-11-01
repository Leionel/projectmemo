import type { PriorityReason } from "@/lib/types/conversation";

export type PriorityPresentation = { headlines: string[]; basis: string; detail: string[] };

const NO_BLOCKING = "观察范围内没有等待回应的委托";
const NO_DEADLINE = "未记录项目截止日";
const NO_IMPORTANCE = "长期重要性未明确";
const NO_EFFORT = "本次投入未知";

/**
 * 把服务端优先级字段的原始文本映射成少量用户可读的判断要点。
 * 只做字段到短语的映射，不补充字段里没有的结论；UNKNOWN 保持“尚未明确”。
 */
export function presentPriority(p: PriorityReason): PriorityPresentation {
  const headlines: string[] = [];
  if (p.urgency !== NO_DEADLINE) {
    headlines.push(p.urgency.includes("已过") ? "项目截止日已过，需核对适用阶段" : p.urgency.replace("距项目截止日约 ", "距截止日约 "));
  }
  if (p.blocking !== NO_BLOCKING) headlines.push(p.blocking);
  if (p.importance === NO_IMPORTANCE) headlines.push("长期重要性尚未明确");
  if (p.effort === NO_EFFORT) headlines.push("本次可投入时间尚未提供");
  if (!headlines.length) headlines.push("当前依据里没有需要特别处理的压力或缺口");
  const detail: string[] = [];
  if (p.importance) detail.push("重要性：" + p.importance);
  if (p.urgency) detail.push("紧急程度：" + p.urgency);
  if (p.blocking) detail.push("阻塞状态：" + p.blocking);
  if (p.effort) detail.push("可投入时间：" + p.effort);
  if (p.preference) detail.push("你的偏好：" + p.preference);
  if (p.tradeoff) detail.push("取舍说明：" + p.tradeoff);
  if (p.unknown.length) detail.push("待明确：" + p.unknown.join("、"));
  return {
    headlines: headlines.slice(0, 4),
    basis: p.basis === "MODEL_ADVICE" ? "依据：模型建议，可纠正" : "依据：项目状态与你标记的偏好",
    detail,
  };
}

export type SourceEntryKind = "文档与附件" | "网页引用" | "日历来源" | "项目记录" | "项目成果" | "CI 观察";
export const sourceEntryKinds: SourceEntryKind[] = ["文档与附件", "网页引用", "日历来源", "项目记录", "项目成果", "CI 观察"];
