"use client";
import { useEffect, useState } from "react";
import { CaptureBox } from "./CaptureBox";
import { missionNavigationHref } from "@/lib/mission/navigation";

export function MissionMaterialIntake({ projectId, missionId, questionId, ownerId, inboxEnabled }: {
  projectId: string; missionId: string; questionId: string; ownerId: string; inboxEnabled: boolean;
}) {
  const [sourceId, setSourceId] = useState(""), [question, setQuestion] = useState("正在读取原问题…"), [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void fetch(`/api/missions/${encodeURIComponent(missionId)}/readback?questionId=${encodeURIComponent(questionId)}`, { cache: "no-store", signal: AbortSignal.timeout(10000) })
      .then(async r => { const body = await r.json(); if (!live) return; if (!r.ok || body.readback.projectId !== projectId) throw new Error(body.error?.message ?? "无法定位原问题"); const q = body.readback.selected.question; setQuestion(q.text); setError(q.historical ? "原问题已变化，资料仍可保存；返回原委托核对后再继续。" : ""); })
      .catch(e => { if (live) setError(e.message ?? "原问题读取失败，请返回原委托核对"); });
    return () => { live = false; };
  }, [projectId, missionId, questionId]);
  return <>
    <section className="space-y-3 border-b border-[var(--rule)] pb-4" aria-label="为原问题补充资料">
      <p className="text-sm text-[var(--ink-soft)]">补充给原问题</p><p>{question}</p>
      {error && <p role="status" className="text-sm text-[var(--brick)]">{error}</p>}
      <a className="workspace-link focus-ring" href={missionNavigationHref(projectId, missionId, { questionId, ...(sourceId ? { sourceId } : {}) })}>{sourceId ? "回到原问题，核对这份资料 →" : "返回原委托 →"}</a>
    </section>
    <CaptureBox key={`${ownerId}:${missionId}:${questionId}`} projectId={projectId} inboxEnabled={inboxEnabled} draftScope={`${ownerId}:${missionId}:${questionId}`} onMaterialSaved={setSourceId}/>
  </>;
}
