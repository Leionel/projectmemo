"use client";
import { useState } from "react";
import styles from "./MissionPanel.module.css";

export type ExperienceSuggestion = {
  id: string;
  kind: string;
  status: string;
  title: string;
  statement: string;
  conditions: string[];
  supportCount: number;
  counterCount: number;
  sampleCount: number;
};

/** 委托内就近展示：适用条件、来源样本数与停用入口；只提供建议，不改变权限。 */
export function ExperienceSuggestions({ projectId, suggestions, onChanged }: { projectId: string; suggestions: ExperienceSuggestion[]; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!suggestions.length) return null;
  const act = async (id: string, action: "ACTIVATE" | "REVOKE") => {
    setBusy(true); setError("");
    try {
      const r = await fetch(`/api/projects/${projectId}/experiences/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, requestId: crypto.randomUUID() }),
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
            <span className={styles.badge} data-status={s.status === "ACTIVE" ? "SUCCEEDED" : "PAUSED"} style={{ marginLeft: ".5rem" }}>
              {s.status === "ACTIVE" ? "注入中·建议" : "影子观察·不注入"}
            </span>
          </p>
          <p className={styles.muted}>适用：{s.conditions.join("；") || "同类委托"}</p>
          <p>{s.statement}</p>
          <p className={styles.muted}>
            来源：{s.sampleCount} 个委托样本（支持 {s.supportCount} / 反例 {s.counterCount}）；建议不改变权限。
          </p>
          {s.status === "ACTIVE" ? (
            <button disabled={busy} onClick={() => void act(s.id, "REVOKE")}>停用此经验</button>
          ) : (
            <button disabled={busy} onClick={() => void act(s.id, "ACTIVATE")}>激活为建议</button>
          )}
        </div>
      ))}
      {error && <p role="alert" className={styles.muted}>{error}</p>}
    </section>
  );
}
