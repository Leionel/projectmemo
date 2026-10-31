"use client";
import Link from "next/link";
import { useState } from "react";
import styles from "./MissionPanel.module.css";

export type ExperienceSuggestion = {
  id: string;
  kind: string;
  status: string;
  version: number;
  title: string;
  statement: string;
  conditions: string[];
  unknownConditions?: string[];
  notApplicableWhen?: string[];
  supportCount: number;
  counterCount: number;
  sampleCount: number;
  caseReferenceCount?: number;
  matchState?: "MATCH" | "MISMATCH" | "UNKNOWN";
  eligibleForInjection?: boolean;
  suppressed?: string | null;
  originMissionId?: string | null;
  revoked?: boolean;
  counterExamples?: Array<{ missionId?: string; reason?: string }>;
  modelDecision?: unknown;
  userFeedback?: unknown;
};

const STATUS: Record<string, string> = { ACTIVE: "注入中·建议", SHADOW: "影子观察·不注入", CANDIDATE: "案例参考", REVOKED: "已撤销" };
const MATCH: Record<string, string> = { MATCH: "条件匹配", MISMATCH: "条件不匹配", UNKNOWN: "条件未知" };

function decisionText(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const disposition = (value as { disposition?: string }).disposition;
  if (!disposition) return null;
  return { ADOPT: "模型本次采用", ADAPT: "模型本次改进后采用", REJECT: "模型本次未采用", INVESTIGATE: "模型据此继续调查" }[disposition] ?? disposition;
}

/** 委托内就近展示：条件、未知/反例、匹配结果、模型是否采用、原结果入口与安全控制。 */
export function ExperienceSuggestions({ projectId, missionId, suggestions, onChanged }: { projectId: string; missionId?: string; suggestions: ExperienceSuggestion[]; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!suggestions.length) return null;
  const act = async (id: string, action: "ACTIVATE" | "REVOKE" | "FEEDBACK", version?: number, extra?: Record<string, unknown>) => {
    setBusy(true); setError("");
    try {
      const r = await fetch(`/api/projects/${projectId}/experiences/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, requestId: crypto.randomUUID(), ...(version ? { expectedVersion: version } : {}), ...extra }),
        signal: AbortSignal.timeout(15000),
      });
      const v = await r.json();
      if (!r.ok) throw new Error(v.error?.message ?? "操作失败");
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={styles.attention} aria-label="项目经验建议">
      <h4>项目经验（本项目内）</h4>
      {suggestions.map((s) => (
        <div key={s.id} style={{ display: "grid", gap: ".25rem" }}>
          <p>
            <strong>{s.title}</strong>
            <span className={styles.badge} data-status={s.eligibleForInjection ? "SUCCEEDED" : "PAUSED"} style={{ marginLeft: ".5rem" }}>
              {s.eligibleForInjection ? "注入中·建议" : STATUS[s.status] ?? s.status}
            </span>
          </p>
          <p className={styles.muted}>
            适用：{s.conditions.join("；") || "同类委托"}
            {s.matchState && ` · ${MATCH[s.matchState]}`}
            {!s.eligibleForInjection && s.suppressed ? ` · 未注入：${s.suppressed}` : ""}
          </p>
          {!!s.unknownConditions?.length && <p className={styles.muted}>未知条件：{s.unknownConditions.join("；")}（未知不当成无条件）</p>}
          <p>{s.statement}</p>
          <p className={styles.muted}>
            来源：{s.sampleCount} 个样本（支持 {s.supportCount} / 反例 {s.counterCount}{s.caseReferenceCount ? ` / 案例 ${s.caseReferenceCount}` : ""}）；建议不改变权限。
          </p>
          {!!s.counterExamples?.length && <p className={styles.muted}>反例：{s.counterExamples.map(c => c.reason ?? c.missionId).join("；")}</p>}
          {decisionText(s.modelDecision) && <p className={styles.muted}>{decisionText(s.modelDecision)}</p>}
          {decisionText(s.userFeedback) && <p className={styles.muted}>你的反馈：{decisionText(s.userFeedback) ?? "已记录"}</p>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: ".5rem" }}>
            {s.originMissionId && <Link className="workspace-link focus-ring" href={`/projects/${projectId}/missions?mission=${encodeURIComponent(s.originMissionId)}`}>回原结果核对</Link>}
            {s.status === "ACTIVE" && <button disabled={busy} onClick={() => void act(s.id, "REVOKE", s.version, { reason: "USER_REVOKED" })}>停用此经验</button>}
            {s.status === "SHADOW" && <button disabled={busy} onClick={() => void act(s.id, "ACTIVATE", s.version)}>激活为建议</button>}
            {missionId && s.eligibleForInjection && <>
              <button disabled={busy} onClick={() => void act(s.id, "FEEDBACK", s.version, { disposition: "ADOPT", missionId })}>这次采用了</button>
              <button disabled={busy} onClick={() => void act(s.id, "FEEDBACK", s.version, { disposition: "NOT_APPLICABLE", missionId, reason: "USER_NOT_APPLICABLE" })}>不适用于本次</button>
            </>}
          </div>
        </div>
      ))}
      {error && <p role="alert" className={styles.muted}>{error}</p>}
    </section>
  );
}
