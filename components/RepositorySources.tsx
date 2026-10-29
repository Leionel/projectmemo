"use client";
import type { ConversationSource } from "@/lib/types/conversation";
export function RepositorySources({ sources }: { sources: ConversationSource[] }) {
  const rows = sources.filter(s => s.repository);
  if (!rows.length) return null;
  return <details className="my-2"><summary>CI 观察与日志（{rows.length}）</summary>{rows.map(s => {
    const r = s.repository!;
    return <article key={s.id} className="my-3"><a href={`https://github.com/${r.repo}/commit/${r.sha}`} target="_blank" rel="noreferrer">{r.repo} · {r.sha.slice(0, 10)}</a>
      <p className="text-sm">{r.kind === "LOG" ? "脱敏日志片段" : r.kind === "JOBS" ? "任务列表" : "CI 状态"}{r.attempt ? ` · attempt ${r.attempt}` : ""} · {new Date(r.observedAt).toLocaleString("zh-CN")}</p>
      <pre className="whitespace-pre-wrap break-words text-sm">{s.excerpt}</pre><p className="text-sm">此观察不确认部署、实验或原行动完成。</p></article>;
  })}</details>;
}
