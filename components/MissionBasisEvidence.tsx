"use client";
/**
 * 当前判断的依据 / 原文 / 纠正入口（C2）。
 *
 * 只消费服务端 `readback.workPacket.basis`（final-a-workpacket-v1）与原 readback，
 * 不新建判断/来源数据库，不发起写请求，也不重算许可或修订状态：
 * - currentUse（当前是否允许继续作为依据）：ALLOWED / SUPPRESSED / UNKNOWN / 旧服务未提供=资格未知；
 * - revisionAvailability（原修订匹配事实）：CURRENT / CHANGED / UNAVAILABLE / 未单独提供=未知；
 *   两者正交：availability=UNAVAILABLE 可能只是当前许可的兼容过滤，不能改写成“修订已变化”；
 * - 历史 facts/摘录原样保留，但被抑制/来源链未知的资料不作为当前推荐或默认引用；
 * - 只有文件级定位时说明未记录页码/段落，不编造精确位置；精确摘录、条件匹配与用户核对
 *   都不等于独立证实（truthVerified=false）；
 * - 纠正入口复用原 ClaimCorrection（kind=MISSION_OUTPUT，sourceId 来自 OUTPUT_REFERENCE），
 *   onChanged 只触发重新读取原端点，纠正影响后续理解，原记录与原提案需重新核对。
 */
import Link from "next/link";
import { useId } from "react";
import type { MissionReadback as ReadbackData } from "@/lib/mission/readback";
import type {
  WorkPacket,
  WorkPacketMaterialUseItem,
} from "@/lib/types/workPacket";
import { materialUseSummary } from "@/lib/client/materialUseLabels";
import { missionNavigationHref } from "@/lib/mission/navigation";
import { ClaimCorrection } from "./ClaimCorrection";
import styles from "./MissionBasisEvidence.module.css";

export type MissionBasisEvidenceProps = {
  packet: WorkPacket;
  readback: ReadbackData;
  missionId: string;
  /** 只重新读取原端点，用于纠正后/来源变化后重新核对。 */
  onReload: () => void;
  disabled?: boolean;
};

type CurrentUseState = "ALLOWED" | "SUPPRESSED" | "UNKNOWN" | "MISSING" | "UNRECOGNIZED";
type RevisionState = "CURRENT" | "CHANGED" | "UNAVAILABLE" | "MISSING";

const fitStatusLabels: Record<string, string> = {
  FIT: "条件对应",
  NOT_FIT: "条件不符",
  UNKNOWN: "仍有未决项",
};
const coverageWindowLabels: Record<string, string> = {
  RECENT_STEPS: "最近步骤",
  ACTION_RECEIPTS: "行动回执",
  MATERIAL_USES: "资料使用",
  MATERIAL_SOURCE_EVENTS: "资料事件",
  MATERIAL_MISSION_RUNS: "委托运行",
  MISSION_MODEL_RUNS: "模型调用",
  EVIDENCE_REVIEWS: "证据审查",
};

/** 只有服务端给出 currentUse 才判断资格；null/缺失只说明旧服务未评定，绝不当作允许。 */
function readCurrentUse(item: WorkPacketMaterialUseItem): { state: CurrentUseState; label: string } {
  const use = item?.currentUse;
  if (!use || typeof use !== "object" || typeof (use as { state?: unknown }).state !== "string") {
    return { state: "MISSING", label: "旧服务未提供当前许可判断 · 资格未知" };
  }
  switch (use.state) {
    case "ALLOWED":
      return { state: "ALLOWED", label: "当前允许作为依据（仅当前使用，不代表独立证据）" };
    case "SUPPRESSED":
      return { state: "SUPPRESSED", label: "当前许可已被撤回，不作为当前推荐或默认引用" };
    case "UNKNOWN":
      return { state: "UNKNOWN", label: "当前来源链未知，不用于当前推荐" };
    default:
      return { state: "UNRECOGNIZED", label: "当前许可判断无法识别 · 资格未知" };
  }
}

/** 修订事实独立显示；旧服务没有 revisionAvailability 时只记未知，不拿 availability 推断版本变化。 */
function readRevision(item: WorkPacketMaterialUseItem): { state: RevisionState; label: string } {
  switch (item?.revisionAvailability) {
    case "CURRENT":
      return { state: "CURRENT", label: "原修订匹配" };
    case "CHANGED":
      return { state: "CHANGED", label: "原修订已变化（历史留痕保留）" };
    case "UNAVAILABLE":
      return { state: "UNAVAILABLE", label: "原资料当前不可访问" };
    default:
      return {
        state: "MISSING",
        label: item?.availability === "UNAVAILABLE"
          ? "修订状态未单独提供 · 未知（旧服务兼容标记为不可用，原因未知）"
          : "修订状态未单独提供 · 未知",
      };
  }
}

function factsOf(item: WorkPacketMaterialUseItem) {
  return Array.isArray(item?.facts) ? item.facts : [];
}

function formatTime(value: string | null | undefined): string {
  if (!value) return "时间未知";
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) ? new Date(stamp).toLocaleString("zh-CN", { hour12: false }) : "时间未知";
}

/** 原问题身份只用于定位回原任务；缺失时不伪造。 */
function questionTarget(questionId: string | null) {
  return questionId ? { questionId } : {};
}

export function MissionBasisEvidence({ packet, readback, missionId, onReload, disabled }: MissionBasisEvidenceProps) {
  const headingId = useId();
  if (!packet || typeof packet !== "object") return null;
  const basis = packet.basis;
  const policyApplied = basis?.currentUsePolicy === "SOURCE_POLICY_APPLIED";
  // 工作包没有资料窗口时退回原 readback 的同名字段；两者都没有才说明本次未读取。
  const materialUses = basis?.materialUses ?? readback?.materialUses ?? null;
  const rawItems = (materialUses as { items?: unknown } | null | undefined)?.items;
  const items = Array.isArray(rawItems) ? (rawItems as WorkPacketMaterialUseItem[]) : [];
  const materialQuestionId = (materialUses as { questionId?: string | null } | null | undefined)?.questionId ?? null;
  const questionId = basis?.questionId ?? materialQuestionId ?? readback?.selected?.question?.id ?? null;
  const projectId = readback?.projectId ?? packet.identity?.projectId ?? "";
  const reviews = basis?.evidenceReviews ?? null;
  const reviewItems = reviews && Array.isArray(reviews.items) ? reviews.items : [];
  const selectedOutput = readback?.selected?.output ?? null;
  const windows = packet.coverage && Array.isArray(packet.coverage.windows) ? packet.coverage.windows : [];
  const truncatedWindows = windows.filter((window) => window && window.truncated === true);
  const materialCoverage = (materialUses as { coverage?: Record<string, unknown> } | null | undefined)?.coverage;
  const materialWindowTruncated = !!materialCoverage && [
    "eventsTruncated", "stepsTruncated", "outputsTruncated", "receiptsTruncated", "runsTruncated", "sourceLimitReached",
  ].some((key) => materialCoverage[key] === true);
  const hasCorrectionTarget = items.some((item) =>
    factsOf(item).some((fact) => fact.kind === "OUTPUT_REFERENCE" && typeof fact.refId === "string" && fact.refId.length > 0),
  );
  const shownCorrectionTargets = new Set<string>();

  return (
    <section className={styles.basis} aria-labelledby={headingId} data-basis-policy={policyApplied ? "APPLIED" : "NOT_APPLIED"}>
      <div className={styles.header}>
        <h5 id={headingId} className={styles.heading}>逐项依据与原文</h5>
      </div>
      <p className={styles.lead}>当前可用只表示此刻能作为依据；历史留痕保留原身份，不等于独立支持。</p>

      {!policyApplied && (
        <p className={styles.legacyWarning}>本次未应用来源许可判断，当前资格未知。</p>
      )}

      {items.length === 0 && (
        materialUses
          ? <p className={styles.empty}>本次资料使用窗口内没有记录；未找到不等于从未使用。</p>
          : <p className={styles.empty}>本次未读取资料使用窗口，未找到不等于从未使用。</p>
      )}

      {items.length > 0 && (
        <ul className={styles.items}>
          {items.map((item, index) => {
            const pointer = item?.sourcePointer && typeof item.sourcePointer.id === "string"
              ? { id: item.sourcePointer.id, hash: typeof item.sourcePointer.hash === "string" ? item.sourcePointer.hash : "" }
              : null;
            const current = readCurrentUse(item);
            const revision = readRevision(item);
            const facts = factsOf(item);
            const outputReferences = facts.filter(
              (fact) => fact.kind === "OUTPUT_REFERENCE" && typeof fact.refId === "string" && fact.refId.length > 0,
            );
            const exactQuote = facts.some((fact) => fact.kind === "EXACT_QUOTE");
            const isAttachment = !!pointer && pointer.id.startsWith("attachment:");
            const attachmentAllowed = isAttachment && current.state === "ALLOWED";
            const attachmentHref = attachmentAllowed && projectId
              ? `/api/projects/${encodeURIComponent(projectId)}/attachments/${encodeURIComponent(pointer!.id.slice("attachment:".length))}/file`
              : null;
            const notCurrent = current.state !== "ALLOWED";
            const correctionTarget = outputReferences.find((fact) => !shownCorrectionTargets.has(fact.refId));
            if (correctionTarget) shownCorrectionTargets.add(correctionTarget.refId);
            const itemKey = `${pointer?.id ?? "item"}:${pointer?.hash ?? index}`;
            return (
              <li className={styles.item} key={itemKey}>
                <div className={styles.itemHead}>
                  <h4 className={styles.itemTitle}>{item?.title || "未命名来源"}</h4>
                  {pointer && <p className={styles.pointer}>{pointer.id}</p>}
                </div>
                <dl className={styles.statusList}>
                  <div className={styles.statusRow} data-state={current.state}>
                    <dt>当前使用资格</dt>
                    <dd>{current.label}</dd>
                  </div>
                  <div className={styles.statusRow} data-state={revision.state}>
                    <dt>修订状态</dt>
                    <dd>{revision.label}</dd>
                  </div>
                  <div className={styles.statusRow}>
                    <dt>历史留痕</dt>
                    <dd>{facts.length ? materialUseSummary(facts) : "未记录具体使用事实"}</dd>
                  </div>
                </dl>

                {item?.excerpt && (
                  <details className={styles.excerpt}>
                    <summary>查看原记录摘录</summary>
                    {notCurrent && <p className={styles.excerptWarning}>当前不作为依据或推荐；以下仅为历史留痕。</p>}
                    <blockquote className={styles.excerptBody}>{item.excerpt}</blockquote>
                    {item.bodyCoverage === "NOT_RECORDED" && (
                      <p className={styles.excerptNote}>正文读取范围未记录；摘录不代表全文，也不代表精确位置。</p>
                    )}
                  </details>
                )}

                <div className={styles.links}>
                  {attachmentHref && (
                    <a className={styles.link} href={attachmentHref} target="_blank" rel="noopener noreferrer">查看附件原件</a>
                  )}
                  {outputReferences.map((fact) => (
                    <Link
                      key={`${fact.refId}:${fact.revision ?? "none"}`}
                      className={styles.link}
                      href={missionNavigationHref(projectId, missionId, {
                        outputId: fact.refId,
                        ...(typeof fact.revision === "number" ? { revision: fact.revision } : {}),
                        ...questionTarget(questionId),
                      })}
                    >
                      {typeof fact.revision === "number" ? `查看草稿版本 ${fact.revision}` : "查看原草稿"}
                    </Link>
                  ))}
                  {pointer && (
                    <Link
                      className={styles.link}
                      href={missionNavigationHref(projectId, missionId, { sourceId: pointer.id, ...questionTarget(questionId) })}
                    >
                      回原任务定位该来源
                    </Link>
                  )}
                </div>

                {!attachmentAllowed && (
                  <p className={styles.locationNote}>仅定位到原文件/记录，未记录页码或段落，不编造精确位置。</p>
                )}
                {exactQuote && <p className={styles.scopeNote}>原文精确摘录只表示引用范围，不等于独立证实。</p>}
                {correctionTarget && (
                  <div className={styles.correction}>
                    <ClaimCorrection projectId={projectId} kind="MISSION_OUTPUT" sourceId={correctionTarget.refId} onChanged={onReload} />
                    <p className={styles.correctionNote}>
                      纠正影响后续理解，原记录与原提案需重新核对。
                      {disabled ? "读回可能已过期，纠正会先读取当前原记录。" : ""}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {items.length > 0 && !hasCorrectionTarget && (
        <div className={styles.correctionFallback}>
          <p className={styles.correctionNote}>未找到可定位的原草稿版本，暂不提供纠正入口；请回原任务核对原记录。</p>
          <div className={styles.links}>
            {selectedOutput && (
              <Link
                className={styles.link}
                href={missionNavigationHref(projectId, missionId, {
                  outputId: selectedOutput.id,
                  revision: selectedOutput.revision,
                  ...questionTarget(questionId),
                })}
              >
                查看原草稿版本 {selectedOutput.revision}
              </Link>
            )}
            <Link className={styles.link} href={missionNavigationHref(projectId, missionId, questionTarget(questionId))}>
              回原任务核对原记录
            </Link>
          </div>
        </div>
      )}

      <div className={styles.reviews}>
        <h4 className={styles.reviewTitle}>支持范围</h4>
        {reviewItems.length > 0 ? (
          <>
            <p className={styles.reviewLead}>
              规则/条件匹配或用户核对不等于独立证实（truthVerified=false）；引用、精确摘录与用户确认都不能替代现实核验。
            </p>
            <ul className={styles.reviewList}>
              {reviewItems.map((review, index) => (
                <li className={styles.reviewItem} key={review.eventId || `review-${index}`}>
                  <p>{fitStatusLabels[review.fitStatus ?? ""] ?? "未记录条件判断"} · 核对于 {formatTime(review.observedAt)}</p>
                  <p className={styles.reviewMeta}>
                    规则版本 {review.ruleVersion ?? "未知"}
                    {review.fitHash ? ` · 条件摘要 ${review.fitHash.slice(0, 8)}` : ""}
                    {" · truthVerified=false"}
                  </p>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className={styles.reviewLead}>本次未读取证据审查窗口；未找到记录不等于从未发生。</p>
        )}
        {reviews?.truncated && (
          <p className={styles.coverageNote}>证据审查窗口已截断；未找到记录不等于从未发生。</p>
        )}
      </div>

      {truncatedWindows.length > 0 ? (
        <p className={styles.coverageNote}>
          查询窗口已截断（{truncatedWindows.map((entry) => coverageWindowLabels[entry.name] ?? entry.name).join("、")}）；未找到记录不等于从未发生。
        </p>
      ) : materialWindowTruncated ? (
        <p className={styles.coverageNote}>资料使用查询窗口已截断；未找到记录不等于从未发生。</p>
      ) : null}
    </section>
  );
}
