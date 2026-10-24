"use client";
import { useState } from "react";
import styles from "./MissionPanel.module.css";

type SignalView = {
  id: string; connectionId: string; kind: string; sha: string; title: string; authorName: string;
  committedAt: string | null; url: string; status: string; adoptedAt: string | null; adoptedCaptureId: string | null; linkedActionId: string | null;
};
type ConnectionView = {
  id: string; repo: string; ref: string; status: string; lastFetchedAt: string | null;
  lastStatus: string | null; lastError: string | null; revokedAt: string | null; revokedReason: string | null;
  candidateCount: number; adoptedCount: number;
};
type ListReply = { enabled: boolean; note: string; connections: ConnectionView[]; signals: SignalView[] };

const STATUS_LABEL: Record<string, string> = {
  CANDIDATE: "候选", ADOPTED: "已采纳", DISMISSED: "已忽略",
  OK: "已刷新", NOT_MODIFIED: "无新提交", RATE_LIMITED: "被限流", FORBIDDEN: "被拒绝", NOT_FOUND: "仓库或分支不存在", ERROR: "出错",
};

/** P3-B 资料页候选：外部仓库信号只是候选资料，采纳需确认；commit 不构成现实完成证明。 */
export function RepoSignalsCard({ projectId }: { projectId: string }) {
  const [data, setData] = useState<ListReply | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [repo, setRepo] = useState("");
  const [ref, setRef] = useState("");
  const [actionChoice, setActionChoice] = useState<Record<string, string>>({});
  const [actions, setActions] = useState<Array<{ id: string; title: string }>>([]);

  async function api(path: string, method: "GET" | "POST", body?: unknown) {
    const response = await fetch(path, {
      method, headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(25000),
    });
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.error?.message ?? "操作失败"), { status: response.status });
    return value;
  }
  async function load() {
    setBusy(true);
    try {
      setData(await api(`/api/projects/${projectId}/repo-signals`, "GET"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "信号列表暂不可用");
    } finally { setBusy(false); }
  }
  async function loadActions() {
    try {
      const value = await api(`/api/projects/${projectId}/actions`, "GET");
      setActions((value.actions as Array<{ id: string; title: string; status: string; isSimulated: boolean }>)
        .filter(a => !a.isSimulated && a.status !== "DONE" && a.status !== "CANCELLED").map(a => ({ id: a.id, title: a.title })));
    } catch { /* 行动列表失败不阻塞信号面板 */ }
  }
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    try { await work(); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); } finally { setBusy(false); }
  }
  const create = () => run(async () => {
    await api(`/api/projects/${projectId}/repo-signals`, "POST", { repo: repo.trim(), ref: ref.trim() || "main", requestId: crypto.randomUUID() });
    setRepo(""); setRef("");
    await load();
  });
  const refresh = (id: string) => run(async () => { await api(`/api/projects/${projectId}/repo-signals/connections/${id}`, "POST", { action: "REFRESH", requestId: crypto.randomUUID() }); await load(); });
  const revoke = (id: string) => run(async () => { await api(`/api/projects/${projectId}/repo-signals/connections/${id}`, "POST", { action: "REVOKE", requestId: crypto.randomUUID() }); await load(); });
  const adopt = (id: string) => run(async () => {
    await api(`/api/projects/${projectId}/repo-signals/signals/${id}`, "POST", { action: "ADOPT", requestId: crypto.randomUUID(), ...(actionChoice[id] ? { actionId: actionChoice[id] } : {}) });
    await load();
  });
  const dismiss = (id: string) => run(async () => {
    await api(`/api/projects/${projectId}/repo-signals/signals/${id}`, "POST", { action: "DISMISS", requestId: crypto.randomUUID() });
    await load();
  });

  return (
    <details className={styles.attention} onToggle={e => { if (e.currentTarget.open && !data) { void load(); void loadActions(); } }}>
      <summary style={{ cursor: "pointer" }}>仓库信号（外部候选）{data ? `：${data.connections.filter(c => c.status === "ACTIVE").length} 个连接 · ${data.signals.filter(s => s.status === "CANDIDATE").length} 条待处理` : ""}</summary>
      <p className={styles.muted}>{data?.note ?? "来自公开仓库的只读候选；未采纳不写入任何项目事实。"}</p>
      {error && <p role="alert" className={styles.muted}>{error}</p>}
      {data?.connections.map(c => (
        <div key={c.id} style={{ display: "grid", gap: ".25rem" }}>
          <p><strong>{c.repo}@{c.ref}</strong>
            <span className={styles.badge} style={{ marginLeft: ".5rem" }}>{c.status === "ACTIVE" ? "活跃" : "已撤销"}</span>
            {c.lastStatus && <span className={styles.badge} style={{ marginLeft: ".5rem" }}>{STATUS_LABEL[c.lastStatus] ?? c.lastStatus}</span>}
          </p>
          <p className={styles.muted}>
            候选 {c.candidateCount} · 已采纳 {c.adoptedCount}{c.lastFetchedAt ? ` · 上次刷新 ${new Date(c.lastFetchedAt).toLocaleString("zh-CN")}` : ""}
            {c.lastError ? ` · ${c.lastError}` : ""}{c.revokedReason ? ` · 撤销原因：${c.revokedReason}` : ""}
          </p>
          {c.status === "ACTIVE" && (
            <div className={styles.actions}>
              <button disabled={busy} onClick={() => void refresh(c.id)}>刷新（匿名 ETag，无新提交不计限额）</button>
              <button disabled={busy} onClick={() => void revoke(c.id)}>撤销连接（停止新请求，历史保留）</button>
            </div>
          )}
        </div>
      ))}
      {data && data.connections.filter(c => c.status !== "REVOKED").length < 3 && (
        <div style={{ display: "grid", gap: ".25rem" }}>
          <label>新增公开仓库连接（如 Leionel/luojia-math-tutor-skill）
            <input value={repo} onChange={e => setRepo(e.target.value)} placeholder="owner/repo" />
            <input value={ref} onChange={e => setRef(e.target.value)} placeholder="分支或 ref，默认 main" />
          </label>
          <button disabled={busy || !repo.trim()} onClick={() => void create()}>创建并首次刷新</button>
        </div>
      )}
      {data?.signals.map(s => (
        <div key={s.id} style={{ display: "grid", gap: ".25rem" }}>
          <p>
            <strong>{s.title}</strong>
            <span className={styles.badge} style={{ marginLeft: ".5rem" }}>{STATUS_LABEL[s.status] ?? s.status}</span>
          </p>
          <p className={styles.muted}>
            {s.sha.slice(0, 10)} · {s.authorName}{s.committedAt ? ` · ${new Date(s.committedAt).toLocaleString("zh-CN")}` : ""}
            {" · "}
            <a href={s.url} target="_blank" rel="noopener noreferrer">查看提交</a>
            {s.linkedActionId ? ` · 已关联行动 ${s.linkedActionId.slice(-6)}` : ""}
            {s.adoptedCaptureId ? ` · 已写入资料记录 ${s.adoptedCaptureId.slice(-6)}` : ""}
          </p>
          {s.status === "CANDIDATE" && (
            <div className={styles.actions}>
              <select value={actionChoice[s.id] ?? ""} onChange={e => setActionChoice(current => ({ ...current, [s.id]: e.target.value }))} aria-label="可选关联行动">
                <option value="">不关联行动</option>
                {actions.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
              </select>
              <button disabled={busy} onClick={() => void adopt(s.id)}>采纳为项目资料</button>
              <button disabled={busy} onClick={() => void dismiss(s.id)}>忽略</button>
            </div>
          )}
        </div>
      ))}
      {data && !data.signals.length && <p className={styles.muted}>还没有信号；创建连接或点刷新拉取。</p>}
      <p className={styles.muted}>提交/CI 状态只是资料线索，不等于现实完成；行动完成仍以你填写的回执为准。</p>
    </details>
  );
}
