import type { ConversationProgress } from "@/lib/types/conversation";

/** A text-free public projection of actual durable steps. No source excerpts or model prose. */
export function experienceProgress(manifest: unknown): ConversationProgress | undefined {
  if (!manifest || typeof manifest !== "object") return;
  const state = (manifest as { experience?: { policyVersion?: string; phase?: string; budget?: { mode?: string; maxToolReads?: number }; steps?: Array<{ id: string; status: string; decision?: { call?: { tool?: string } } }>; stopReason?: string | null } }).experience;
  if (state?.policyVersion !== "r4-v1" || !state.phase || !Array.isArray(state.steps)) return;
  const labels: Record<string, string> = { inspect_project: "查看项目与行动", search_memory: "检索项目记录", read_project_material: "读取原始资料", inspect_action: "核对原行动状态" };
  return { phase: (manifest as { stopRequested?: boolean }).stopRequested ? "STOPPING" : state.phase, mode: state.budget?.mode ?? "STANDARD", completedReads: state.steps.filter(s => s.status === "SUCCEEDED").length,
    readLimit: state.budget?.maxToolReads ?? 0, steps: state.steps.map(s => ({ id: s.id, status: s.status, label: labels[s.decision?.call?.tool ?? ""] ?? "核对项目资料" })), stopReason: state.stopReason ?? null };
}
