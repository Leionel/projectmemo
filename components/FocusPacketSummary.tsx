"use client";
import { useEffect, useState } from "react";
import type { WorkPacket } from "@/lib/types/workPacket";
import { STEP_STATUS_LABELS } from "./MissionWorkPacket";
import styles from "./FocusAgentWorkspace.module.css";

/**
 * 焦点主卡片内的「做到哪 / 依据 / 为什么停」：读原委托工作包，只摘要服务端投影，不重算阶段或动作。
 * 读取失败、旧服务缺工作包时不渲染，不用空白冒充“没有进展”。
 */
export function FocusPacketSummary({ missionId, version }: { missionId: string; version?: number }) {
  const [packet, setPacket] = useState<WorkPacket | null>(null);
  useEffect(() => {
    let live = true;
    void fetch(`/api/missions/${encodeURIComponent(missionId)}/readback`, { cache: "no-store", signal: AbortSignal.timeout(10000) })
      .then(r => r.ok ? r.json() : null)
      .then((body: { readback?: { workPacket?: WorkPacket | null } } | null) => { if (live) setPacket(body?.readback?.workPacket ?? null); })
      .catch(() => { if (live) setPacket(null); });
    return () => { live = false; };
  }, [missionId, version]);
  if (!packet) return null;
  const step = packet.done.recentSteps[0];
  const uses = packet.basis.materialUses?.items ?? null;
  const allowed = uses?.filter(item => item.currentUse?.state === "ALLOWED").length ?? 0;
  const unsettled = packet.stopped.unknownEffect?.present === true;
  const stopReason = packet.stopped.primaryBlock?.text ?? (packet.stopped.workState.phase === "RUNNING" ? null : packet.stopped.note);
  return <dl className={styles.packet} aria-label="委托工作包摘要">
    <div><dt>做到哪</dt><dd>{step ? `${step.note ?? step.toolName} · ${STEP_STATUS_LABELS[step.status] ?? "状态待核对"}` : "最近窗口内没有已完成步骤"}{unsettled && <span className={styles.packetWarn}> · 1 步待结算</span>}</dd></div>
    <div><dt>依据</dt><dd>{uses === null ? packet.basis.note : uses.length ? `${uses.length} 份资料${packet.basis.currentUsePolicy === "SOURCE_POLICY_APPLIED" ? `，当前可用 ${allowed} 份` : ""}` : "尚未选入资料"}</dd></div>
    {stopReason && <div><dt>为什么停</dt><dd>{stopReason}</dd></div>}
  </dl>;
}
