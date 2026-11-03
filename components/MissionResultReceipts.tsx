"use client";
/**
 * 结果分类、现实行动、回执与草稿（C3 接线）。
 *
 * 全部事实来自同一份 `readback` 快照：原 selected/adoptions/actionReceipts/reviewProgress/
 * resourceUsage/materialUses/evidenceReviews。这里不是第二份结果账本：草稿、已执行、
 * 用户报告、独立支持与未知沿用服务端原分类与对象 ID；Action/resultCardId 只链接原对象，
 * 不自动写入，也不把工具成功或用户自报完成升级成独立支持或现实目标达成。
 */
import { missionNavigationHref } from "@/lib/mission/navigation";
import { projectHref } from "@/lib/projectNavigation";
import { materialUseSummary } from "@/lib/client/materialUseLabels";
import { fitReasonLabel } from "@/lib/client/evidenceFitLabels";
import { fitStatusLabel } from "./MissionEvidenceReview";
import type { MissionReadback as Data } from "@/lib/mission/readback";

export type MissionResultReceiptsProps = { data: Data };

/**
 * 原行动状态如实分开：完成标记、用户报告回执与演示数据不是同一件事。
 * 未完成行动的入口是原行动板，由用户在那里决定是否执行，不在读回里代写。
 */
function actionOutcomeText(action: {
  status: string;
  resultCardId: string | null;
}) {
  if (action.status === "DONE")
    return action.resultCardId
      ? "用户报告完成（已留复盘回执）"
      : "已标记完成，但无复盘回执";
  if (action.status === "DOING") return "进行中，尚未完成";
  if (action.status === "CANCELLED") return "已取消，未完成";
  if (action.status === "TODO") return "尚未开始，未完成";
  return `状态待确认：${action.status}`;
}

export function MissionResultReceipts({ data }: MissionResultReceiptsProps) {
  const reviewProgress = data.reviewProgress;
  const adoptions = Array.isArray(data.adoptions) ? data.adoptions : [];
  const actionReceipts = Array.isArray(data.actionReceipts)
    ? data.actionReceipts
    : [];
  return (
    <>
      <p>
        读取于 {new Date(data.observedAt).toLocaleString("zh-CN")} · 委托版本{" "}
        {data.missionVersion}
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

      <section
        aria-label="结果分类与支持上限"
        className="mt-3 border-t border-[var(--rule)] pt-3"
      >
        <h4 className="font-semibold">结果分类与支持上限</h4>
        {reviewProgress && Array.isArray(reviewProgress.classes) ? (
          <dl className="mt-2 space-y-1" aria-label="服务端原结果分类">
            {reviewProgress.classes.map((item) => (
              <div key={item.key} className="flex gap-2">
                <dt className="w-24 shrink-0 font-semibold">
                  {item.label}：{item.count}
                </dt>
                <dd className="text-[var(--muted)]">{item.note}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-2">
            当前读回未提供结果分类摘要，暂不据此推断完成；原草稿与回执仍可核对。
          </p>
        )}
        <p className="mt-2">
          草稿存在不等于完成；工具调用成功或用户自报完成 ≠ 独立支持 ≠
          现实目标达成。
        </p>
      </section>

      <section
        aria-label="行动与回执"
        className="mt-3 border-t border-[var(--rule)] pt-3"
      >
        <h4 className="font-semibold">行动与回执</h4>
        {actionReceipts.length === 0 ? (
          <p className="mt-2">
            这次读回没有行动回执记录。
            <a
              className="workspace-link focus-ring"
              href={projectHref(data.projectId, "#action-board")}
            >
              到项目行动板处理行动 →
            </a>
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {actionReceipts.map((action) => {
              const actionHref = projectHref(
                data.projectId,
                `#action-${action.id}`,
              );
              return (
                <li key={action.id} className="space-y-1 break-words">
                  <strong>{action.title ?? "未命名行动"}</strong>
                  <p>
                    {action.isSimulated ? "演示情境，不计真实行为 · " : ""}
                    {action.isSimulated
                      ? action.status === "DONE"
                        ? "演示完成标记"
                        : "演示待办"
                      : actionOutcomeText(action)}
                    {action.completedAt
                      ? ` · ${new Date(action.completedAt).toLocaleString("zh-CN")}`
                      : ""}
                  </p>
                  {!action.isSimulated && (
                    <p className="flex flex-wrap gap-3">
                      <a className="workspace-link focus-ring" href={actionHref}>
                        {action.status === "DONE" ||
                        action.status === "CANCELLED"
                          ? "回到原行动 →"
                          : "回到原行动填写结果 →"}
                      </a>
                      {action.resultCardId && (
                        <a
                          className="workspace-link focus-ring"
                          href={`/projects/${encodeURIComponent(data.projectId)}/knowledge#card-${encodeURIComponent(action.resultCardId)}`}
                        >
                          查看原复盘回执 →
                        </a>
                      )}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {(data.selected.output ||
        data.selected.receipt ||
        adoptions.length > 0) && (
        <section
          aria-label="草稿与已采纳成果"
          className="mt-3 border-t border-[var(--rule)] pt-3"
        >
          <h4 className="font-semibold">草稿与已采纳成果</h4>
          {data.selected.output && (
            <div className="mt-2">
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
            <p className="mt-2">
              指定归入回执：{data.selected.receipt.id} · 草稿版本{" "}
              {data.selected.receipt.outputRevision}
            </p>
          )}
          {adoptions.map((r) => (
            <p className="mt-2" key={r.receiptId}>
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
        </section>
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
