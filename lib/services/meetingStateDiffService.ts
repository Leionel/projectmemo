import { AppError } from "@/lib/api";
import { db } from "@/lib/db";
import { pickSupersedeCard } from "@/lib/services/changeImpactService";
import { refreshProjectState } from "@/lib/services/projectStateService";
import { recordLifecycleEventInTx } from "@/lib/services/memoryLifecycleService";
import type {
  MeetingConfirmResult,
  MeetingImpactPreview,
  MeetingTypedChange,
} from "@/lib/types/meetingState";
import { sha256Hex } from "@/lib/projectState/buildSnapshot";
import { isFeatureEnabled } from "@/lib/config/features";
import { Prisma } from "@/lib/generated/prisma/client";

/** V1 使用确定性规则抽取（不依赖模型可用性）；模型润色/抽取为后续增强，确认语义不变。 */

const WEEKDAY_MAP: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * 截止短语解析。相对表达（周几/明天/N天内/几月几日）需要明确会议日期；
 * 缺上下文时返回 ambiguous=true，由用户补充或修改文本后重新预览。
 */
export function resolveDeadlinePhrase(
  raw: string,
  meetingDateISO: string | null,
): { iso: string | null; ambiguous: boolean; note: string } {
  const text = raw.trim();
  const isoMatch = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const iso = `${isoMatch[1]}-${pad2(Number(isoMatch[2]))}-${pad2(Number(isoMatch[3]))}`;
    const d = new Date(`${iso}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) {
      return { iso, ambiguous: false, note: `绝对日期 ${iso}` };
    }
  }

  if (!meetingDateISO) {
    return {
      iso: null,
      ambiguous: true,
      note: `「${text}」缺少明确日期：请提供会议日期，或把文本改为具体日期（YYYY-MM-DD）后重新预览。`,
    };
  }
  const base = new Date(`${meetingDateISO}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) {
    return { iso: null, ambiguous: true, note: "会议日期格式无效，请使用 YYYY-MM-DD。" };
  }

  const weekday = text.match(/(下|本)?(?:周|星期|礼拜)([一二三四五六日天])/);
  if (weekday) {
    const target = WEEKDAY_MAP[weekday[2]];
    const offsetFromMonday = (target + 6) % 7; // 周一=0 … 周日=6
    const diffToMonday = (base.getUTCDay() + 6) % 7;
    const monday = new Date(base.getTime() - diffToMonday * 86400000);
    let result: Date;
    if (weekday[1] === "下") {
      result = new Date(monday.getTime() + (7 + offsetFromMonday) * 86400000);
    } else {
      // 本周X / 周X：本周内该日；裸“周X”若已过则顺延到下周同一日
      let candidate = new Date(monday.getTime() + offsetFromMonday * 86400000);
      if (weekday[1] === undefined && candidate.getTime() < base.getTime()) {
        candidate = new Date(candidate.getTime() + 7 * 86400000);
      }
      result = candidate;
    }
    const iso = isoDate(result);
    return { iso, ambiguous: false, note: `按会议日期 ${meetingDateISO} 解析为 ${iso}，请确认` };
  }

  if (/明天/.test(text)) {
    return { iso: isoDate(new Date(base.getTime() + 86400000)), ambiguous: false, note: `按会议日期解析为次日` };
  }
  if (/后天/.test(text)) {
    return { iso: isoDate(new Date(base.getTime() + 2 * 86400000)), ambiguous: false, note: `按会议日期解析为后天` };
  }
  const inDays = text.match(/(\d{1,3})\s*天/);
  if (inDays) {
    const iso = isoDate(new Date(base.getTime() + Number(inDays[1]) * 86400000));
    return { iso, ambiguous: false, note: `按会议日期 ${meetingDateISO} + ${inDays[1]} 天解析为 ${iso}` };
  }
  const monthDay = text.match(/(\d{1,2})月(\d{1,2})日/);
  if (monthDay) {
    const iso = `${base.getUTCFullYear()}-${pad2(Number(monthDay[1]))}-${pad2(Number(monthDay[2]))}`;
    return { iso, ambiguous: false, note: `按会议年份解析为 ${iso}，请确认` };
  }
  return {
    iso: null,
    ambiguous: true,
    note: `无法解析日期「${text}」：请改为具体日期（YYYY-MM-DD）后重新预览。`,
  };
}

function splitSentences(text: string): string[] {
  return text
    .split(/[。！？；;\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

export function extractMeetingChanges(
  text: string,
  meetingDateISO: string | null,
  activeCards: Array<{ id: string; title: string }>,
): Array<Omit<MeetingTypedChange, "changeId">> {
  const candidates: Array<Omit<MeetingTypedChange, "changeId">> = [];

  for (const sentence of splitSentences(text)) {
    // 1. 截止变化（关键词更具体，先于取代判断，避免“截止改为下周五”里的“改为”误入取代分支）
    const deadlineMatch = sentence.match(
      /(?:截止(?:时间|日期)?(?:改为|提前到|推迟到|调整为)?|提前到|推迟到|之前完成|日前完成)([^。；;]*)/,
    );
    if (deadlineMatch) {
      const raw = deadlineMatch[1].trim() || sentence;
      const resolved = resolveDeadlinePhrase(raw, meetingDateISO);
      candidates.push({
        kind: "DEADLINE_CHANGE",
        status: resolved.ambiguous ? "NEEDS_CLARIFICATION" : "PROPOSED",
        title: resolved.ambiguous ? `截止变化（日期待澄清）：${raw}` : `截止变化：${resolved.iso}`,
        detail: resolved.iso ?? raw,
        evidenceSpan: sentence,
        supersededCardId: null,
        supersededCardTitle: null,
        candidateCardIds: [],
        actionTitle: null,
        deadlineRaw: raw,
        deadlineISO: resolved.iso,
        clarification: resolved.ambiguous ? resolved.note : `截止将改为 ${resolved.iso}（${resolved.note}），请确认。`,
      });
      continue;
    }

    // 2. 决策取代
    if (/(改为|替换为|调整为|转为|升级为|变更为|替代|取代|不再采用)/.test(sentence)) {
      const picked = pickSupersedeCard(activeCards, sentence);
      if (picked.card) {
        candidates.push({
          kind: "DECISION_SUPERSEDE",
          status: "PROPOSED",
          title: `决策取代：采用 ${sentence.length > 24 ? `${sentence.substring(0, 24)}…` : sentence}`,
          detail: sentence,
          evidenceSpan: sentence,
          supersededCardId: picked.card.id,
          supersededCardTitle: picked.card.title,
          candidateCardIds: [],
          actionTitle: null,
          deadlineRaw: null,
          deadlineISO: null,
          clarification: null,
        });
      } else {
        const note = picked.tieCandidateIds.length > 1
          ? `存在 ${picked.tieCandidateIds.length} 张同名或相近的候选决策，无法唯一确定被取代对象。`
          : "会议中提到替代关系，但没有匹配到现有决策记录。";
        candidates.push({
          kind: "DECISION_SUPERSEDE",
          status: "NEEDS_CLARIFICATION",
          title: "决策取代（需要澄清）",
          detail: sentence,
          evidenceSpan: sentence,
          supersededCardId: null,
          supersededCardTitle: null,
          candidateCardIds: picked.tieCandidateIds,
          actionTitle: null,
          deadlineRaw: null,
          deadlineISO: null,
          clarification: `${note}请修改文本明确指出旧决策，或在决策变更中手动指定。`,
        });
      }
      continue;
    }

    // 3. 结论/确认记录
    const factMatch = sentence.match(/^(?:结论|确认|决定)[:：]?\s*(.+)$/);
    if (factMatch) {
      candidates.push({
        kind: "FACT_RECORD",
        status: "PROPOSED",
        title: `记录结论：${factMatch[1].substring(0, 24)}`,
        detail: factMatch[1],
        evidenceSpan: sentence,
        supersededCardId: null,
        supersededCardTitle: null,
        candidateCardIds: [],
        actionTitle: null,
        deadlineRaw: null,
        deadlineISO: null,
        clarification: null,
      });
      continue;
    }

    // 4. 行动候选（会上“准备做”只能生成 TODO，不会被写成完成）
    if (/(需要|准备|负责|跟进|安排|行动[:：]|待办[:：])/.test(sentence)) {
      candidates.push({
        kind: "ACTION_CREATE",
        status: "PROPOSED",
        title: `新增行动：${sentence.substring(0, 24)}${sentence.length > 24 ? "…" : ""}`,
        detail: sentence,
        evidenceSpan: sentence,
        supersededCardId: null,
        supersededCardTitle: null,
        candidateCardIds: [],
        actionTitle: sentence.length > 60 ? sentence.substring(0, 60) : sentence,
        deadlineRaw: null,
        deadlineISO: null,
        clarification: null,
      });
    }
  }

  return candidates;
}

export interface MeetingPreviewInput {
  text: string;
  meetingDate?: string | null;
  baseSnapshotId?: string | null;
}

export async function createMeetingImpactPreview(projectId: string, input: MeetingPreviewInput): Promise<MeetingImpactPreview> {
  const trimmed = input.text.trim();
  if (trimmed.length < 5) {
    throw new AppError("INVALID_INPUT", "会议文本请至少输入 5 个字", 422);
  }
  const meetingDate = input.meetingDate?.trim() ? input.meetingDate.trim() : null;
  if (meetingDate && !/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) {
    throw new AppError("INVALID_INPUT", "会议日期格式须为 YYYY-MM-DD", 422);
  }

  // 会前快照：显式指定则校验归属；否则取最新；一个都没有时按用户预览动作生成基线
  let baseSnapshotId = input.baseSnapshotId?.trim() || "";
  if (baseSnapshotId) {
    const snapshot = await db.projectStateSnapshot.findFirst({ where: { id: baseSnapshotId, projectId } });
    if (!snapshot) throw new AppError("SNAPSHOT_NOT_FOUND", "会前快照不存在或不属于当前项目", 404);
  } else {
    const featureOn = isFeatureEnabled("PROJECT_STATE_ENABLED", false);
    if (featureOn) {
      const latest = await db.projectStateSnapshot.findFirst({
        where: { projectId },
        orderBy: { evaluatedAt: "desc" },
      });
      const snapshot = latest ?? (await refreshProjectState(projectId)).snapshot;
      baseSnapshotId = snapshot.id;
    }
  }

  // 活跃卡片（未被确认取代）供取代匹配
  const cards = await db.knowledgeCard.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: {
      incomingLinks: { where: { relationType: "SUPERSEDES", confirmed: true, revokedAt: null } },
    },
  });
  const activeCards = cards.filter((c) => c.incomingLinks.length === 0);

  const extracted = extractMeetingChanges(trimmed, meetingDate, activeCards.map((c) => ({ id: c.id, title: c.title.trim() })));
  const typedChanges: MeetingTypedChange[] = extracted.map((change, index) => ({
    ...change,
    changeId: `chg-${index + 1}`,
  }));

  const sourceTextHash = sha256Hex(trimmed);
  const run = await db.agentRun.create({
    data: {
      projectId,
      runType: "EVALUATE",
      status: "SUCCESS",
      provider: "meeting_state_diff",
      trace: {
        baseSnapshotId,
        sourceTextHash,
        proposalVersion: 1,
        meetingDate,
        extractor: "rules",
        typedChanges: typedChanges as unknown as Prisma.InputJsonValue,
      },
      resultJson: { status: "PENDING" },
    },
  });

  return {
    proposalId: `mip_${run.id}`,
    projectId,
    baseSnapshotId,
    proposalVersion: 1,
    sourceTextHash,
    meetingDate,
    extractor: "rules",
    typedChanges,
    summary: `会议文本解析出 ${typedChanges.length} 项候选变化；逐项勾选后确认，未勾选或待澄清的变化不会写入。`,
  };
}

export interface MeetingConfirmInput {
  proposalId: string;
  sourceTextHash: string;
  proposalVersion: number;
  selectedChangeIds: string[];
}

export async function confirmMeetingChanges(projectId: string, input: MeetingConfirmInput): Promise<MeetingConfirmResult> {
  const runId = input.proposalId.startsWith("mip_") ? input.proposalId.substring(4) : input.proposalId;
  const run = await db.agentRun.findFirst({
    where: { id: runId, projectId, runType: "EVALUATE", provider: "meeting_state_diff" },
  });
  if (!run) {
    throw new AppError("PROPOSAL_NOT_FOUND", "会议提案不存在或不属于当前项目", 404);
  }

  const result = run.resultJson as { status?: string; executionResult?: unknown } | null;
  if (result?.status === "CONFIRMED") {
    // 重复确认返回相同业务 ID，不产生第二次写入
    return { ...(result.executionResult as MeetingConfirmResult), proposalId: input.proposalId, alreadyConfirmed: true };
  }

  const trace = (run.trace && typeof run.trace === "object" && !Array.isArray(run.trace)
    ? run.trace as Record<string, unknown>
    : {}) as {
    baseSnapshotId?: string;
    sourceTextHash?: string;
    proposalVersion?: number;
    typedChanges?: MeetingTypedChange[];
  };

  // 版本绑定：文本哈希与提案版本必须与预览一致；任何事实/日期修改都必须重新预览
  if (trace.sourceTextHash !== input.sourceTextHash || trace.proposalVersion !== input.proposalVersion) {
    throw new AppError("PROPOSAL_VERSION_MISMATCH", "会议文本或提案版本已变化，请重新预览后再确认", 400);
  }
  const typedChanges = trace.typedChanges ?? [];
  const selectedSet = new Set(input.selectedChangeIds);
  const selected = typedChanges.filter((change) => selectedSet.has(change.changeId));
  if (selected.length !== input.selectedChangeIds.length) {
    throw new AppError("INVALID_SELECTION", "包含未在预览中出现的变化项，已拒绝", 400);
  }
  const unclear = selected.filter((change) => change.status === "NEEDS_CLARIFICATION");
  if (unclear.length > 0) {
    throw new AppError(
      "NEEDS_CLARIFICATION",
      `选中项中存在待澄清内容：${unclear.map((change) => change.clarification ?? change.title).join("；")}`,
      422,
    );
  }

  // 兼容性：同一张旧卡不能被两个取代项同时取代
  const supersedeTargets = selected
    .filter((change) => change.kind === "DECISION_SUPERSEDE" && change.supersededCardId)
    .map((change) => change.supersededCardId as string);
  if (new Set(supersedeTargets).size !== supersedeTargets.length) {
    throw new AppError("INCOMPATIBLE_CHANGES", "多个取代变化指向同一张旧决策，请只保留一项", 422);
  }

  // 源版本核对：预览后相关卡片若已被取代，必须重新预览（无关变化可重新校验后继续）
  if (supersedeTargets.length > 0) {
    const nowSuperseded = await db.cardRelation.count({
      where: {
        relationType: "SUPERSEDES",
        confirmed: true,
        revokedAt: null,
        relatedCardId: { in: supersedeTargets },
      },
    });
    if (nowSuperseded > 0) {
      throw new AppError("STATE_CHANGED_REPREVIEW", "预览后相关决策的状态已变化，请重新预览后确认", 409);
    }
  }

  const applied: MeetingConfirmResult["applied"] = [];
  let afterSnapshotId: string | null = null;

  await db.$transaction(async (tx) => {
    for (const change of selected) {
      if (change.kind === "DECISION_SUPERSEDE" && change.supersededCardId) {
        const capture = await tx.capture.create({
          data: { projectId, rawText: change.detail, sourceType: "会议决策" },
        });
        const newCard = await tx.knowledgeCard.create({
          data: {
            projectId,
            captureId: capture.id,
            type: "meeting_note",
            title: change.detail.length > 30 ? `${change.detail.substring(0, 30)}…` : change.detail,
            summary: change.detail,
            keywords: ["会议决策", "时态替代"],
            relatedTasks: [],
            nextActions: [],
            importance: 5,
          },
        });
        const relation = await tx.cardRelation.create({
          data: {
            currentCardId: newCard.id,
            relatedCardId: change.supersededCardId,
            relationType: "SUPERSEDES",
            reason: `会议确认：${change.evidenceSpan}`,
            score: 100,
            confidence: 1.0,
            confirmed: true,
            confirmedAt: new Date(),
            validFrom: new Date(),
          },
        });
        await recordLifecycleEventInTx(tx, {
          projectId,
          cardId: newCard.id,
          eventType: "RELATION_CONFIRM",
          reason: change.evidenceSpan,
          relationId: relation.id,
        });
        await recordLifecycleEventInTx(tx, {
          projectId,
          cardId: change.supersededCardId,
          eventType: "RELATION_CONFIRM",
          reason: change.evidenceSpan,
          relationId: relation.id,
        });
        applied.push({
          changeId: change.changeId,
          kind: change.kind,
          newCardId: newCard.id,
          newActionId: null,
          supersededCardId: change.supersededCardId,
          deadlineISO: null,
        });
        continue;
      }

      if (change.kind === "ACTION_CREATE" && change.actionTitle) {
        const action = await tx.actionItem.create({
          data: {
            projectId,
            title: change.actionTitle,
            description: `来自会议记录：${change.evidenceSpan}`,
            status: "TODO",
            priority: 3,
          },
        });
        applied.push({
          changeId: change.changeId,
          kind: change.kind,
          newCardId: null,
          newActionId: action.id,
          supersededCardId: null,
          deadlineISO: null,
        });
        continue;
      }

      if (change.kind === "DEADLINE_CHANGE" && change.deadlineISO) {
        await tx.project.update({
          where: { id: projectId },
          data: { deadline: new Date(`${change.deadlineISO}T00:00:00Z`) },
        });
        applied.push({
          changeId: change.changeId,
          kind: change.kind,
          newCardId: null,
          newActionId: null,
          supersededCardId: null,
          deadlineISO: change.deadlineISO,
        });
        continue;
      }

      if (change.kind === "FACT_RECORD") {
        const capture = await tx.capture.create({
          data: { projectId, rawText: `【会议结论】${change.detail}`, sourceType: "会议记录" },
        });
        const newCard = await tx.knowledgeCard.create({
          data: {
            projectId,
            captureId: capture.id,
            type: "meeting_note",
            title: change.detail.length > 30 ? `${change.detail.substring(0, 30)}…` : change.detail,
            summary: change.detail,
            keywords: ["会议结论"],
            relatedTasks: [],
            nextActions: [],
            importance: 4,
          },
        });
        await recordLifecycleEventInTx(tx, {
          projectId,
          cardId: newCard.id,
          eventType: "CONFIRM",
          reason: `会议记录确认：${change.evidenceSpan}`,
        });
        applied.push({
          changeId: change.changeId,
          kind: change.kind,
          newCardId: newCard.id,
          newActionId: null,
          supersededCardId: null,
          deadlineISO: null,
        });
      }
    }

    await tx.agentRun.update({
      where: { id: run.id },
      data: {
        resultJson: {
          status: "CONFIRMED",
          executionResult: {
            proposalId: input.proposalId,
            applied,
            afterSnapshotId: null,
            alreadyConfirmed: false,
          } as unknown as Prisma.InputJsonValue,
          confirmedAt: new Date().toISOString(),
        },
      },
    });
  });

  // 会后状态：显式刷新一次，返回新快照供“会后 Diff”
  if (isFeatureEnabled("PROJECT_STATE_ENABLED", false)) {
    try {
      const refreshed = await refreshProjectState(projectId);
      afterSnapshotId = refreshed.snapshot.id;
      await db.agentRun.update({
        where: { id: run.id },
        data: {
          resultJson: {
            status: "CONFIRMED",
            executionResult: {
              proposalId: input.proposalId,
              applied,
              afterSnapshotId,
              alreadyConfirmed: false,
            } as unknown as Prisma.InputJsonValue,
            confirmedAt: new Date().toISOString(),
          },
        },
      });
    } catch (_e) {
      // 状态刷新失败不吞掉业务写入：afterSnapshotId 为空，界面提示可稍后重试
      afterSnapshotId = null;
    }
  }

  return { proposalId: input.proposalId, applied, afterSnapshotId, alreadyConfirmed: false };
}
