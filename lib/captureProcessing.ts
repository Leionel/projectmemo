import type { AgentExecutionResult } from "@/lib/types";
export type CaptureProcessing = { mode: "MODEL" | "RULE" | "FALLBACK" | "UNKNOWN"; provider: string | null; reason: string | null };
export const unknownCaptureProcessing: CaptureProcessing = { mode: "UNKNOWN", provider: null, reason: "历史记录未提供整理方式" };
export function captureProcessing(result: Pick<AgentExecutionResult<unknown>, "status" | "provider" | "fallbackReason">): CaptureProcessing {
  if (result.status === "FALLBACK") return { mode: "FALLBACK", provider: result.provider, reason: "云端整理未完成，已使用规则整理；请核对结果" };
  if (result.provider === "mock" || result.provider.startsWith("mock-")) return { mode: "RULE", provider: result.provider, reason: "已按规则整理，未调用云模型" };
  return result.status === "SUCCESS" ? { mode: "MODEL", provider: result.provider, reason: null } : { mode: "UNKNOWN", provider: result.provider, reason: "未确认整理结果" };
}
