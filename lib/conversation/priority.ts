import type { PriorityReason } from "@/lib/types/conversation";

export type PriorityObservation = {
  id: string; deadline: string | null; waiting: number; blocked: number;
  preference: { importance: number | null; longTermGoal: string; estimatedMinutes: number | null; notes: string; version: number } | null;
};
/** Explain independent dimensions. Unknown values never become invented scores. */
export function explainPriority(p: PriorityObservation, now = new Date()): PriorityReason {
  const pref = p.preference;
  const days = p.deadline ? Math.ceil((new Date(p.deadline).getTime() - now.getTime()) / 86400000) : null;
  return {
    projectId: p.id, basis: "USER_AND_STATE",
    importance: pref?.importance ? "你标记的重要性：" + pref.importance + "/5" : "长期重要性未明确",
    urgency: days === null ? "未记录项目截止日" : days < 0 ? "项目截止日已过，请核对适用阶段" : "距项目截止日约 " + days + " 天",
    blocking: p.waiting || p.blocked ? p.waiting + " 项等待回应，" + p.blocked + " 项暂停或失败" : "观察范围内没有等待回应的委托",
    effort: pref?.estimatedMinutes ? "你估计本次投入约 " + pref.estimatedMinutes + " 分钟" : "本次投入未知",
    preference: [pref?.longTermGoal, pref?.notes].filter(Boolean).join("；") || "未记录明确偏好",
    tradeoff: "时效与长期重要性分开判断；未知投入时先确认可完成范围。",
    unknown: [!pref?.importance ? "目标重要性" : "", !pref?.estimatedMinutes ? "投入" : ""].filter(Boolean),
  };
}
