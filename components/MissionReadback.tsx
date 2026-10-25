"use client";
import { useEffect, useRef, useState } from "react";
import { missionNavigationHref, type MissionReadTarget } from "@/lib/mission/navigation";
import { materialUseSummary } from "@/lib/client/materialUseLabels";
import { fitReasonLabel } from "@/lib/client/evidenceFitLabels";
import { fitStatusLabel } from "./MissionEvidenceReview";
import type { MissionReadback as Data } from "@/lib/mission/readback";
import { failedReadState, type ReadState } from "@/lib/client/readState";
export function MissionReadback({
  missionId,
  target = {},
  missionVersion,
  refreshKey = 0,
}: {
  missionId: string;
  target?: MissionReadTarget;
  missionVersion?: number;
  refreshKey?: number;
}) {
  const [data, setData] = useState<Data | null>(null),
    [state, setState] = useState<ReadState>("unavailable"),
    [error, setError] = useState("");
  const [reload,setReload]=useState(0);
  const [observedKey,setObservedKey]=useState("");
  const generation = useRef(0),
    hasData = useRef(false);
  const query = Object.entries(target)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(
      ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
    )
    .join("&");
  useEffect(() => {
    const request = ++generation.current;
    let cancelled = false;
    void fetch(`/api/missions/${missionId}/readback?${query}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    })
      .then(async (r) => {
        const body = await r.json();
        if (cancelled || request !== generation.current) return;
        if (!r.ok)
          throw Object.assign(
            new Error(body.error?.message ?? "读回暂不可用"),
            { status: r.status },
          );
        hasData.current = true; setObservedKey(`${missionId}?${query}`);
        setData(body.readback);
        setState("fresh");
        setError("");
      })
      .catch((e) => {
        if (cancelled || request !== generation.current) return;
        const status = e.status ?? 0;
        setState(failedReadState(hasData.current, status));
        if ([401, 403, 404].includes(status)) {
          hasData.current = false;
          setData(null);
        }
        setError(e.message ?? "读回失败");
      });
    return () => {
      cancelled = true;
    };
  }, [missionId, query, reload, missionVersion, refreshKey]);
  useEffect(() => {
    const refresh = () => { if (!document.hidden) setReload(v => v + 1); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  return (
    <section
      aria-label="原任务与完成回执"
      className="mt-3 rounded-lg border border-[var(--rule)] p-3 text-xs"
    >
      <button type="button" className="workspace-tool focus-ring" onClick={()=>setReload(v=>v+1)}>重新读取回执</button>
      {data && missionVersion !== undefined && data.missionVersion < missionVersion && <p role="status">委托版本已变化，正在重新读取回执；以下为上次结果。</p>}
      {error && (
        <p role="status">
          {error}
          {state === "lastKnown"
            ? "；以下为上次读取的历史结果，请刷新后再操作。"
            : ""}
        </p>
      )}
      {data && observedKey===`${missionId}?${query}` && (
        <>
          <p>
            读取于 {new Date(data.observedAt).toLocaleString("zh-CN")} ·
            委托版本 {data.missionVersion}
          </p>
          {data.sourceConversation && (
            <a
              className="workspace-link focus-ring"
              href={data.sourceConversation.href}
            >
              返回来源对话 →
            </a>
          )}
          {data.selected.question && (
            <p>
              {data.selected.question.historical
                ? "历史问题（只读）"
                : "链接指向的问题"}
              ：{data.selected.question.text}
            </p>
          )}
          {data.selected.approval && (
            <p>
              链接指向的提案：{data.selected.approval.status}
              ，批准仍需在当前有效预览中操作。
            </p>
          )}
          {data.selected.output && (
            <div>
              <strong>
                指定草稿版本 {data.selected.output.revision} · 只读
              </strong>
              {(
                data.selected.output.contentJson as {
                  blocks?: Array<{ blockId: string; text: string }>;
                }
              ).blocks?.map((b) => (
                <p className="whitespace-pre-wrap" key={b.blockId}>
                  {b.text}
                </p>
              ))}
            </div>
          )}
          {data.selected.receipt && (
            <p>
              指定归入回执：{data.selected.receipt.id} · 草稿版本{" "}
              {data.selected.receipt.outputRevision}
            </p>
          )}
          {data.adoptions.map((r) => (
            <p key={r.receiptId}>
              已归入成果：
              <a
                className="workspace-link focus-ring"
                href={`/projects/${data.projectId}/generate?artifact=${r.artifactId}&type=${r.artifactType}`}
              >
                {r.title} ·{" "}
                {new Date(r.artifactCreatedAt).toLocaleString("zh-CN")}
              </a>
              （来自草稿 {r.outputRevision}；回执 {r.receiptId}）
            </p>
          ))}
          {data.actionReceipts.map((a) => (
            <p key={a.id}>
              {a.title}：{a.isSimulated ? "演示情境 · " : ""}
              {a.status === "DONE" && a.resultCardId ? "已填写行动完成回执" : a.status === "DONE" ? "已标记完成，未找到复盘回执" : "尚未填写完成回执"}
              {a.resultCardId && (
                <a
                  className="workspace-link focus-ring"
                  href={`/projects/${data.projectId}/knowledge#card-${a.resultCardId}`}
                >
                  查看复盘记录 →
                </a>
              )}
            </p>
          ))}
          {data.materialUses && data.materialUses.items.length > 0 && <details className="mt-3 border-t border-[var(--rule)] pt-3">
            <summary className="cursor-pointer font-semibold">这份资料用在哪里 · {data.materialUses.items.length}</summary>
            <ul className="mt-3 space-y-3">
              {data.materialUses.items.map(item => <li key={`${item.sourcePointer.id}:${item.sourcePointer.hash}`} className="space-y-1 break-words">
                <strong>{item.title}</strong><p>{item.availability === "CHANGED" ? "历史版本 · " : ""}{materialUseSummary(item.facts)}</p>
                {item.availability === "UNAVAILABLE" && <p>原资料暂不可访问，历史关联仍保留。</p>}
                {item.excerpt && <details><summary className="cursor-pointer">查看原记录摘录</summary><p className="whitespace-pre-wrap">{item.excerpt}</p></details>}
                {item.sourcePointer.id.startsWith("attachment:") && item.availability === "CURRENT" && <a className="workspace-link focus-ring" target="_blank" rel="noopener noreferrer" href={`/api/projects/${encodeURIComponent(data.projectId)}/attachments/${encodeURIComponent(item.sourcePointer.id.slice(11))}/file`}>查看附件原件 →</a>}
                {item.facts.filter(f => f.kind === "OUTPUT_REFERENCE").map(f => <a key={f.refId} className="workspace-link focus-ring mr-3" href={missionNavigationHref(data.projectId, data.missionId, { outputId: f.refId, revision: f.revision, questionId: data.materialUses?.questionId ?? undefined })}>查看草稿版本 {f.revision} →</a>)}
              </li>)}
            </ul>
            <p className="mt-2 text-[var(--muted)]">仅展示直接来源与有限历史；引用不表示结论已核验。</p>
          </details>}
          {data.evidenceReviews?.items.length>0&&<details className="mt-3 border-t border-[var(--rule)] pt-3"><summary>这次资料核对</summary>
            {data.evidenceReviews.items.map(r=><div className="mt-3 space-y-2" key={r.eventId}><strong>{fitStatusLabel[r.fitStatus]}</strong>
              <p>{r.review?.mode==="ANSWERING_EVIDENCE"?"用于回答这次测量":r.review?.mode==="BACKGROUND_ONLY"?"仅作背景，继续等待":"保留未知作条件分析"}</p>
              <p>{r.review?.note}</p><ul>{[...new Set(r.unresolvedChecks.map(fitReasonLabel))].map(c=><li key={c}>{c}</li>)}</ul>
              <p>用户核对 · 结果真实性仍待验证</p></div>)}
          </details>}
        </>
      )}
    </section>
  );
}
