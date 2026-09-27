import type { ProjectStatePayload, SnapshotRisk, SnapshotUnknown, StateDiffKind } from "@/lib/types/projectState";

export type StateTone = "ok" | "warn" | "bad" | "muted" | "brand";

/** 变化类型的确定性呈现：与鸿蒙端同一套符号，避免两端读法不一致 */
export const stateDiffMeta: Record<StateDiffKind, { glyph: string; label: string; tone: StateTone }> = {
  ADDED: { glyph: "＋", label: "新增", tone: "brand" },
  CHANGED: { glyph: "→", label: "变化", tone: "brand" },
  RESOLVED: { glyph: "✓", label: "已解决", tone: "ok" },
  REGRESSED: { glyph: "!", label: "回退", tone: "bad" },
  UNCERTAIN: { glyph: "?", label: "待确认", tone: "warn" },
};

export function diffMeta(kind: string) {
  return stateDiffMeta[kind as StateDiffKind] ?? { glyph: "→", label: kind, tone: "brand" as StateTone };
}

/** 没有游标（首次查看）也算未读：这时要如实说明这是第一份记录，而不是「没有变化」 */
export function hasUnreadChange(lastSeenSnapshotId: string | null, snapshotId: string): boolean {
  return !lastSeenSnapshotId || lastSeenSnapshotId !== snapshotId;
}

/** 只取已确认为真的风险；UNKNOWN 不当作 FALSE，也不冒充风险 */
export function topConfirmedRisk(payload: Pick<ProjectStatePayload, "risks">): SnapshotRisk | null {
  return payload.risks.find((risk) => risk.truth === "TRUE") ?? null;
}

export function healthSummary(payload: Pick<ProjectStatePayload, "health">): { label: string; tone: StateTone } {
  if (payload.health === "AT_RISK") return { label: "存在已确认的风险", tone: "bad" };
  if (payload.health === "ON_TRACK") return { label: "暂无已确认风险", tone: "ok" };
  return { label: "信息不足，无法判断", tone: "muted" };
}

export function nextStepText(payload: Pick<ProjectStatePayload, "risks" | "unknowns">): string {
  if (topConfirmedRisk(payload)) return "先处理上方风险对应的任务。";
  const unknown: SnapshotUnknown | undefined = payload.unknowns[0];
  if (unknown) return unknown.suggestedInputAction;
  return "继续推进当前待办。";
}
