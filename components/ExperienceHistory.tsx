"use client";
import Link from "next/link";
import { useState } from "react";
import styles from "./MissionPanel.module.css";
import type { ExperienceSuggestion } from "./ExperienceSuggestions";

type ExperienceRow = ExperienceSuggestion & {
  tools: string[];
  sampleMissions: string[];
  revokedReason: string | null;
  activatedAt: string | null;
  validUntil: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  conditionsComplete: boolean;
  eligibility: { eligible: boolean; reason: string };
  resultLabels: Record<string, number>;
};
type ListReply = {
  enabled: boolean;
  trajectory: { missionCount: number; truncated: boolean; engineeringSucceeded: number; adopted: number; actionsCompleted: number;
    realOutcomeAttested: number; independentMeasurements: number; explicitNegative: number; note: string } | null;
  experiences: ExperienceRow[];
  synced?: { changed: number; at: string };
};

const STATUS_LABEL: Record<string, string> = {
  CANDIDATE: "案例参考（样本或条件不足，不注入）",
  SHADOW: "影子观察（不注入）",
  ACTIVE: "注入中·建议",
  REVOKED: "已撤销（保留历史）",
};

/** 二级历史管理：放在委托区末尾，不新增一级导航。激活仅限影子观察中的经验。 */
export function ExperienceHistory({ projectId }: { projectId: string }) {
  const [data, setData] = useState<ListReply | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/experiences`, { signal: AbortSignal.timeout(25000) });
      const v: ListReply = await r.json();
      if (!r.ok) throw new Error((v as unknown as { error?: { message?: string } }).error?.message ?? "经验列表暂不可用");
      setData(v); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "经验列表暂不可用"); }
    finally { setBusy(false); }
  }
  async function act(id: string, action: "ACTIVATE" | "REVOKE", version?: number) {
    setBusy(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/experiences/${id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, requestId: crypto.randomUUID(), ...(version ? { expectedVersion: version } : {}) }),
        signal: AbortSignal.timeout(15000),
      });
      const v = await r.json();
      if (!r.ok) throw new Error(v.error?.message ?? "操作失败");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); }
    finally { setBusy(false); }
  }
  async function refresh() {
    setBusy(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/experiences`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REFRESH", requestId: crypto.randomUUID() }),
        signal: AbortSignal.timeout(30000),
      });
      const v: ListReply = await r.json();
      if (!r.ok) throw new Error((v as unknown as { error?: { message?: string } }).error?.message ?? "整理失败");
      setData(v); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "整理失败"); }
    finally { setBusy(false); }
  }
  return (
    <details className={styles.attention} onToggle={e => { if (e.currentTarget.open && !data) void load(); }}>
      <summary style={{ cursor: "pointer" }}>项目经验历史{data ? `（${data.experiences.length}）` : ""}</summary>
      {error && <p role="alert" className={styles.muted}>{error}</p>}
      {!data && !error && <p className={styles.muted}>正在读取项目经验…</p>}
      {data && !data.enabled && <p className={styles.muted}>项目经验复用当前未开启；已有数据保留。</p>}
      {data?.enabled && (
        <>
          <p className={styles.muted}>
            轨迹：{data.trajectory?.missionCount ?? 0} 个委托（工程成功 {data.trajectory?.engineeringSucceeded ?? 0}、用户采用 {data.trajectory?.adopted ?? 0}、行动完成回执 {data.trajectory?.actionsCompleted ?? 0}、用户自述 {data.trajectory?.realOutcomeAttested ?? 0}、独立实测 {data.trajectory?.independentMeasurements ?? 0}、明确负结果 {data.trajectory?.explicitNegative ?? 0}）。
            {data.trajectory?.note}
          </p>
          <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
            <button disabled={busy} onClick={() => void refresh()}>整理当前真实结果</button>
            {data.synced && <p className={styles.muted}>上次整理：{new Date(data.synced.at).toLocaleString("zh-CN")} · 更新 {data.synced.changed} 条</p>}
          </div>
          {data.experiences.map((row) => (
            <div key={row.id} style={{ display: "grid", gap: ".25rem" }}>
              <p><strong>{row.title}</strong><span className={styles.badge} style={{ marginLeft: ".5rem" }}>{STATUS_LABEL[row.status] ?? row.status}</span></p>
              <p className={styles.muted}>适用：{row.conditions.join("；") || "同类委托"}</p>
              {(row.unknownConditions?.length ?? 0) > 0 && <p className={styles.muted}>未知条件：{row.unknownConditions!.join("；")}（未知不当成无条件）</p>}
              <p>{row.statement}</p>
              <p className={styles.muted}>
                样本 {row.sampleCount}（支持 {row.supportCount} / 反例 {row.counterCount}{row.caseReferenceCount ? ` / 案例 ${row.caseReferenceCount}` : ""}）{!row.conditionsComplete ? " · 条件不完整，仅案例参考" : ""}
                {row.revokedReason ? `；撤销原因：${row.revokedReason}` : ""}
              </p>
              {!row.eligibility.eligible && <p className={styles.muted}>未注入：{row.eligibility.reason}{row.suppressed ? ` / ${row.suppressed}` : ""}</p>}
              {!!row.originMissionId && <Link className="workspace-link focus-ring" href={`/projects/${projectId}/missions?mission=${encodeURIComponent(row.originMissionId)}`}>回原结果核对</Link>}
              {row.status === "SHADOW" && <button disabled={busy} onClick={() => void act(row.id, "ACTIVATE", row.version)}>激活为建议</button>}
              {row.status === "ACTIVE" && <button disabled={busy} onClick={() => void act(row.id, "REVOKE", row.version)}>停用此经验</button>}
            </div>
          ))}
          {!data.experiences.length && <p className={styles.muted}>还没有可提炼的经验；采用成果、完成行动或固定核算后点“整理当前真实结果”。</p>}
        </>
      )}
    </details>
  );
}
