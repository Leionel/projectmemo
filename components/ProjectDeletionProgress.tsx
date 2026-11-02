"use client";
import { useEffect, useState } from "react";
type Deletion = { receiptId: string; status: string; message: string; filesRemaining: number };
export function ProjectDeletionProgress() {
  const [rows, setRows] = useState<Deletion[]>([]), [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/project-deletions", { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("清除进度暂不可用，请刷新重试");
      const body = await response.json();
      if (!controller.signal.aborted) { setRows(body.deletions); setError(""); }
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [revision]);
  if (!rows.length && !error) return null;
  return <details className="mt-6 border-t border-[var(--rule)] py-4 text-sm">
    <summary className="focus-ring cursor-pointer">项目清除进度{rows.some(r => r.status !== "COMPLETED") ? " · 有待完成清理" : " · 已完成"}</summary>
    {error && <p role="status">{error}</p>}
    <ul className="mt-3 space-y-2">{rows.map(row => <li key={row.receiptId}>{row.message}{row.filesRemaining > 0 ? ` 待清理 ${row.filesRemaining} 个文件。` : ""}</li>)}</ul>
    <button className="workspace-link focus-ring mt-3" onClick={() => setRevision(v => v + 1)}>刷新清理状态</button>
  </details>;
}
