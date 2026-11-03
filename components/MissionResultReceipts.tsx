"use client";
/**
 * 原任务回执、成果分类、用量与依据历史（C3 接线骨架）。
 *
 * 数据来自同一份 `readback` 快照：原 selected/adoptions/actionReceipts/reviewProgress/
 * resourceUsage/materialUses/evidenceReviews。这里不是第二份结果账本：已执行、用户报告、
 * 独立支持与未知全部沿用服务端原分类与对象 ID；Action/resultCardId 只链接到原对象。
 */
import { missionNavigationHref } from "@/lib/mission/navigation";
import { materialUseSummary } from "@/lib/client/materialUseLabels";
import { fitReasonLabel } from "@/lib/client/evidenceFitLabels";
import { fitStatusLabel } from "./MissionEvidenceReview";
import type { MissionReadback as Data } from "@/lib/mission/readback";

export type MissionResultReceiptsProps = { data: Data };

export function MissionResultReceipts({ data }: MissionResultReceiptsProps) {
  return (
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
            {r.title} · {new Date(r.artifactCreatedAt).toLocaleString("zh-CN")}
          </a>
          （来自草稿 {r.outputRevision}；回执 {r.receiptId}）
        </p>
      ))}
      {data.actionReceipts.map((a) => (
        <p key={a.id}>
          {a.title}：{a.isSimulated ? "演示情境 · " : ""}
          {a.status === "DONE" && a.resultCardId
            ? "已填写行动完成回执"
            : a.status === "DONE"
              ? "已标记完成，未找到复盘回执"
              : "尚未填写完成回执"}
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
      {data.reviewProgress && (
        <details className="mt-3 border-t border-[var(--rule)] pt-3">
          <summary className="cursor-pointer font-semibold">
            执行、观察、支持、报告、反例与未知
          </summary>
          <dl className="mt-2 space-y-1">
            {data.reviewProgress.classes.map((item) => (
              <div key={item.key} className="flex gap-2">
                <dt className="w-24 shrink-0 font-semibold">
                  {item.label}：{item.count}
                </dt>
                <dd className="text-[var(--muted)]">{item.note}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-[var(--muted)]">
            这是原步骤、草稿核对、行动与回执的投影；工具成功或用户说完成都不等于现实目标已达成。
          </p>
        </details>
      )}
      {data.resourceUsage && (
        <details className="mt-3 border-t border-[var(--rule)] pt-3">
          <summary className="cursor-pointer font-semibold focus-ring">
            本次用量 · {data.resourceUsage.summary}
          </summary>
          <p className="mt-2">
            已记录输入 {data.resourceUsage.inputTokens ?? "待核对"} token ·
            输出 {data.resourceUsage.outputTokens ?? "待核对"} token
          </p>
          <p className="mt-1 text-[var(--muted)]">
            {data.resourceUsage.coverageNote}
          </p>
          <p className="mt-1">{data.resourceUsage.costNote}</p>
          {data.callCoverage && (
            <div className="mt-2 border-t border-[var(--rule)] pt-2">
              <p className="font-semibold">{data.callCoverage.summary}</p>
              <ul className="mt-1 space-y-1">
                {data.callCoverage.notes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
              <p className="mt-1 text-[var(--muted)]">
                {data.callCoverage.inspected.truncated
                  ? `已检查最近 ${data.callCoverage.inspected.limit} 条回执，计数是下界，不是完整账单。`
                  : "已核对当前委托已返回的调用回执；费用仍未知。"}
              </p>
              {data.callCoverage.failedCodes.length > 0 && (
                <p className="mt-1 text-[var(--muted)]">
                  失败码：{data.callCoverage.failedCodes.join("、")}
                </p>
              )}
            </div>
          )}
        </details>
      )}
      {data.materialUses && data.materialUses.items.length > 0 && (
        <details className="mt-3 border-t border-[var(--rule)] pt-3">
          <summary className="cursor-pointer font-semibold">
            这份资料用在哪里 · {data.materialUses.items.length}
          </summary>
          <ul className="mt-3 space-y-3">
            {data.materialUses.items.map((item) => (
              <li
                key={`${item.sourcePointer.id}:${item.sourcePointer.hash}`}
                className="space-y-1 break-words"
              >
                <strong>{item.title}</strong>
                <p>
                  {item.availability === "CHANGED" ? "历史版本 · " : ""}
                  {materialUseSummary(item.facts)}
                </p>
                {item.availability === "UNAVAILABLE" && (
                  <p>原资料暂不可访问，历史关联仍保留。</p>
                )}
                {item.excerpt && (
                  <details>
                    <summary className="cursor-pointer">查看原记录摘录</summary>
                    <p className="whitespace-pre-wrap">{item.excerpt}</p>
                  </details>
                )}
                {item.sourcePointer.id.startsWith("attachment:") &&
                  item.availability === "CURRENT" && (
                    <a
                      className="workspace-link focus-ring"
                      target="_blank"
                      rel="noopener noreferrer"
                      href={`/api/projects/${encodeURIComponent(data.projectId)}/attachments/${encodeURIComponent(item.sourcePointer.id.slice(11))}/file`}
                    >
                      查看附件原件 →
                    </a>
                  )}
                {item.facts
                  .filter((f) => f.kind === "OUTPUT_REFERENCE")
                  .map((f) => (
                    <a
                      key={f.refId}
                      className="workspace-link focus-ring mr-3"
                      href={missionNavigationHref(data.projectId, data.missionId, {
                        outputId: f.refId,
                        revision: f.revision,
                        questionId: data.materialUses?.questionId ?? undefined,
                      })}
                    >
                      查看草稿版本 {f.revision} →
                    </a>
                  ))}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[var(--muted)]">
            仅展示直接来源与有限历史；引用不表示结论已核验。
          </p>
        </details>
      )}
      {data.evidenceReviews?.items.length > 0 && (
        <details className="mt-3 border-t border-[var(--rule)] pt-3">
          <summary>这次资料核对</summary>
          {data.evidenceReviews.items.map((r) => (
            <div className="mt-3 space-y-2" key={r.eventId}>
              <strong>{fitStatusLabel[r.fitStatus]}</strong>
              <p>
                {r.review?.mode === "ANSWERING_EVIDENCE"
                  ? "用于回答这次测量"
                  : r.review?.mode === "BACKGROUND_ONLY"
                    ? "仅作背景，继续等待"
                    : "保留未知作条件分析"}
              </p>
              <p>{r.review?.note}</p>
              <ul>
                {[...new Set(r.unresolvedChecks.map(fitReasonLabel))].map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <p>用户核对 · 结果真实性仍待验证</p>
            </div>
          ))}
        </details>
      )}
    </>
  );
}
