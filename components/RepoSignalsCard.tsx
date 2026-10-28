"use client";
import { useCallback, useEffect, useState } from "react";
import { Github } from "lucide-react";
import styles from "./MissionPanel.module.css";
import repoStyles from "./RepoSignalsCard.module.css";

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
  OK: "已刷新", PARTIAL: "尚有提交待同步", NOT_MODIFIED: "无新提交", RATE_LIMITED: "被限流", FORBIDDEN: "被拒绝", NOT_FOUND: "仓库或分支不存在", ERROR: "出错",
};

async function api(path: string, method: "GET" | "POST", body?: unknown) {
  const response = await fetch(path, {
    method, headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(25000),
  });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error?.message ?? "操作失败"), { status: response.status });
  return value;
}

/** P3-B 资料页候选：外部仓库信号只是候选资料，采纳需确认；commit 不构成现实完成证明。 */
export function RepoSignalsCard({ projectId, initialOpen = false }: { projectId: string; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const [data, setData] = useState<ListReply | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [repo, setRepo] = useState("");
  const [ref, setRef] = useState("");
  const [actionChoice, setActionChoice] = useState<Record<string, string>>({});
  const [actions, setActions] = useState<Array<{ id: string; title: string }>>([]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await api(`/api/projects/${projectId}/repo-signals`, "GET"));
      setError("");
    } catch (e) {
      if ([401, 403, 404].includes((e as {status?:number}).status ?? 0)) { setData(null); setActions([]); }
      setError(e instanceof Error ? e.message : "信号列表暂不可用");
    } finally { setBusy(false); }
  }, [projectId]);
  const loadActions = useCallback(async () => {
    try {
      const value = await api(`/api/projects/${projectId}/actions`, "GET");
      setActions((value.actions as Array<{ id: string; title: string; status: string; isSimulated: boolean }>)
        .filter(a => !a.isSimulated && a.status !== "DONE" && a.status !== "CANCELLED").map(a => ({ id: a.id, title: a.title })));
    } catch { /* 行动列表失败不阻塞信号面板 */ }
  }, [projectId]);
  useEffect(() => {
    if (!initialOpen) return;
    const timer = window.setTimeout(() => { void load(); void loadActions(); }, 0);
    return () => window.clearTimeout(timer);
  }, [initialOpen, load, loadActions]);
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
    <details id="repo-signals" open={open} className={`${styles.panel} ${repoStyles.panel}`} onToggle={e => { setOpen(e.currentTarget.open); if (e.currentTarget.open && !data && !busy) { void load(); void loadActions(); } }}>
      <summary><Github size={18} aria-hidden="true"/>GitHub 仓库{data ? ` · ${data.connections.filter(c => c.status === "ACTIVE").length} 个连接 · ${data.signals.filter(s => s.status === "CANDIDATE").length} 条待处理` : " · 连接与提交记录"}</summary>
      <div className={repoStyles.body}>
      <p className={styles.muted}>连接公开仓库，查看提交，再选择哪些记录加入项目资料。首次读取最近 30 条；后续刷新追踪新的提交。</p>
      {error && <p role="alert" className={styles.muted}>{error}</p>}
      {data?.connections.map(c => (
        <div key={c.id} className={repoStyles.item}>
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
              <button disabled={busy} onClick={() => { setBusy(true); void api('/api/conversations/entry', 'POST', { requestId: crypto.randomUUID(), scope: 'PROJECT', projectId, entry: { kind: 'SOURCE_OBSERVATION', projectId, id: c.id } }).then(r => { window.location.href = '/focus?conversation=' + encodeURIComponent(r.id); }).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>在忆程中讨论</button>
              <button disabled={busy} onClick={() => void refresh(c.id)}>{c.lastStatus === "PARTIAL" ? "继续同步提交" : "刷新提交"}</button>
              <button disabled={busy} onClick={() => void revoke(c.id)}>撤销连接（停止新请求，历史保留）</button>
            </div>
          )}
        </div>
      ))}
      {data && data.connections.filter(c => c.status !== "REVOKED").length < 3 && (
        <div className={repoStyles.form}>
          <label>公开仓库（owner/repo）
            <input value={repo} onChange={e => setRepo(e.target.value)} placeholder="owner/repo" />
          </label>
          <label>分支或提交引用
            <input value={ref} onChange={e => setRef(e.target.value)} placeholder="分支或 ref，默认 main" />
          </label>
          <button disabled={busy || !repo.trim()} onClick={() => void create()}>创建并首次刷新</button>
        </div>
      )}
      {data?.signals.map(s => (
        <div key={s.id} className={repoStyles.item}>
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
      <p className={styles.muted}>提交记录只是资料线索；行动完成仍以你填写的回执为准。</p>
      </div>
    </details>
  );
}
