import type { WorkState } from "@/lib/types/workState";
import { workPhaseLabel } from "@/lib/client/focusPresentation";

/**
 * 委托状态徽标：只读服务端 WorkState 投影，不另算阶段或主动作。
 *
 * 色调按“下一步该谁”：你 = 琥珀，忆程 = 墨绿，系统核对 = 虚线中性，暂停/待执行 = 灰，失败 = 砖红。
 * 停止请求与生命周期是并列事实，用第二枚徽标显示，不用一个互斥标签抹掉另一个。
 */
export type WorkTone = "user" | "agent" | "observing" | "queued" | "paused" | "failed" | "system" | "done" | "cancelled";

export function workTone(state: Pick<WorkState, "phase" | "terminal">): WorkTone {
  switch (state.phase) {
    case "WAITING_USER": case "WAITING_APPROVAL": return "user";
    case "RUNNING": return "agent";
    case "WAITING_OBSERVATION": return "observing";
    case "QUEUED": return "queued";
    case "PAUSED": return "paused";
    case "FAILED": return "failed";
    case "COMPLETED": return state.terminal?.status === "SUCCEEDED" ? "done" : "cancelled";
    default: return "system";
  }
}

/** COMPLETED 只靠 terminal 区分成功与取消；旧服务缺 terminal 时不推断为成功。 */
export function workStateLabel(state: Pick<WorkState, "phase" | "terminal">): string {
  if (state.phase === "COMPLETED") return state.terminal?.status === "SUCCEEDED" ? "条件已验收" : state.terminal?.status === "CANCELLED" ? "已取消（不是成功）" : workPhaseLabel(state.phase);
  return workPhaseLabel(state.phase);
}

const actorLabels: Partial<Record<WorkState["nextActor"], string>> = { USER: "你", AGENT: "忆程", SYSTEM: "系统" };
export function nextActorLabel(actor: WorkState["nextActor"] | undefined): string | null {
  return actor ? actorLabels[actor] ?? null : null;
}

/** 已收到停止请求 ≠ 已停止；只有未结算的请求才出第二枚徽标。 */
export function stopRequestBadge(state: Pick<WorkState, "stopRequest">): string | null {
  const stop = state.stopRequest;
  if (!stop || stop.settled) return null;
  if (stop.state === "PAUSE_REQUESTED") return "暂停请求待结算";
  if (stop.state === "CANCEL_REQUESTED") return "取消请求待结算";
  return null;
}

/** 主按钮形态随下一步执行方：轮到你 = 实心；忆程/系统在做 = 描边；失败 = 砖红描边。 */
export function primaryActionTone(state: Pick<WorkState, "phase" | "nextActor"> | undefined): "solid" | "outline" | "failed" {
  if (!state) return "solid";
  if (state.phase === "FAILED") return "failed";
  return state.nextActor === "USER" ? "solid" : "outline";
}
