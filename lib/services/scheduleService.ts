import { createHash } from "node:crypto";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { db } from "@/lib/db";
import {
  type ScheduleBlockData,
  type SchedulePlanData,
  type SchedulePreviewInput,
  type ScheduleSkipReason,
} from "@/lib/types/schedule";

const DEFAULT_TIMEZONE = "Asia/Shanghai";
/** 同一行动首版只能在一个当前计划中出现一次 */
const MAX_CANDIDATE_ACTIONS = 50;

function ensureScheduleEnabled() {
  if (!isFeatureEnabled("PROJECT_SCHEDULING_ENABLED", false)) {
    throw new AppError("PROJECT_SCHEDULING_DISABLED", "行动安排功能当前已关闭", 503);
  }
}

function iso(value: Date): string {
  return value.toISOString();
}

function toDate(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError("VALIDATION_ERROR", `${field} 不是有效的 ISO 8601 时间`, 422);
  }
  return parsed;
}

interface Interval {
  start: number;
  end: number;
}

/** 合并重叠、剔除空区间；比较基于绝对时刻，跨午夜/DST 由客户端换算成时刻后处理 */
function normalizeIntervals(intervals: Interval[]): Interval[] {
  const valid = intervals.filter((item) => item.end > item.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Interval[] = [];
  for (const item of valid) {
    const last = merged[merged.length - 1];
    if (last && item.start <= last.end) {
      last.end = Math.max(last.end, item.end);
    } else {
      merged.push({ ...item });
    }
  }
  return merged;
}

function subtractIntervals(free: Interval[], occupied: Interval[]): Interval[] {
  let result = free.map((item) => ({ ...item }));
  for (const block of occupied) {
    const next: Interval[] = [];
    for (const free2 of result) {
      if (block.end <= free2.start || block.start >= free2.end) {
        next.push(free2);
        continue;
      }
      if (block.start > free2.start) next.push({ start: free2.start, end: Math.min(block.start, free2.end) });
      if (block.end < free2.end) next.push({ start: Math.max(block.end, free2.start), end: free2.end });
    }
    result = next.filter((item) => item.end > item.start);
  }
  return result;
}

function serializeBlock(block: {
  id: string;
  actionId: string;
  actionVersion: number;
  startAt: Date;
  endAt: Date;
  locked: boolean;
}, titleByActionId: Map<string, string>): ScheduleBlockData {
  return {
    id: block.id,
    actionId: block.actionId,
    actionTitle: titleByActionId.get(block.actionId) ?? "",
    actionVersion: block.actionVersion,
    start: iso(block.startAt),
    end: iso(block.endAt),
    locked: block.locked,
  };
}

async function loadBlockTitles(blocks: Array<{ actionId: string }>): Promise<Map<string, string>> {
  const ids = [...new Set(blocks.map((block) => block.actionId))];
  if (ids.length === 0) return new Map();
  const rows = await db.actionItem.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } });
  return new Map(rows.map((row) => [row.id, row.title]));
}

async function serializePlan(row: { id: string; projectId: string; episodeRevisionId: string | null; requestId: string; timezone: string; rangeStart: Date; rangeEnd: Date; version: number; status: string; createdAt: Date; updatedAt: Date; blocks: Array<{ id: string; actionId: string; actionVersion: number; startAt: Date; endAt: Date; locked: boolean }> }, unscheduled: ScheduleSkipReason[]): Promise<SchedulePlanData> {
  const titleByActionId = await loadBlockTitles(row.blocks);
  const blocks = row.blocks
    .map((block) => serializeBlock(block, titleByActionId))
    .sort((a, b) => a.start.localeCompare(b.start) || a.actionId.localeCompare(b.actionId));
  return {
    id: row.id,
    projectId: row.projectId,
    episodeRevisionId: row.episodeRevisionId,
    requestId: row.requestId,
    timezone: row.timezone,
    rangeStart: iso(row.rangeStart),
    rangeEnd: iso(row.rangeEnd),
    version: row.version,
    status: row.status as SchedulePlanData["status"],
    blocks,
    scheduled: blocks,
    unscheduled,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

async function confirmedBlocksForUser(userId: string, rangeStart: Date, rangeEnd: Date) {
  const memberships = await db.projectMembership.findMany({ where: { userId }, select: { projectId: true } });
  if (memberships.length === 0) return [];
  const plans = await db.schedulePlan.findMany({
    where: {
      projectId: { in: memberships.map((item) => item.projectId) },
      status: "CONFIRMED",
      rangeStart: { lt: rangeEnd },
      rangeEnd: { gt: rangeStart },
    },
    select: { blocks: { select: { startAt: true, endAt: true, actionId: true } } },
  });
  return plans.flatMap((plan) => plan.blocks);
}

export interface SchedulePreviewOptions {
  userId: string;
}

/**
 * 确定性排程预览。不做全局最优、不拆分任务、不自动移动锁定区间；
 * 每个未安排行动都有 reasonCode 与中文说明。
 */
export async function previewSchedule(projectId: string, input: SchedulePreviewInput, options: SchedulePreviewOptions): Promise<SchedulePlanData> {
  ensureScheduleEnabled();
  const rangeStart = toDate(input.rangeStart, "rangeStart");
  const rangeEnd = toDate(input.rangeEnd, "rangeEnd");
  if (rangeStart.getTime() >= rangeEnd.getTime()) {
    throw new AppError("INVALID_SCHEDULE_RANGE", "安排起点必须早于终点", 422);
  }
  if (!input.slots || input.slots.length === 0) {
    throw new AppError("VALIDATION_ERROR", "至少提供一个可用时间区间", 422);
  }

  const slots = normalizeIntervals(input.slots.map((slot) => ({ start: toDate(slot.start, "slot.start").getTime(), end: toDate(slot.end, "slot.end").getTime() })));
  if (slots.length === 0) {
    throw new AppError("INVALID_SCHEDULE_SLOTS", "可用时间区间为空或全部无效", 422);
  }
  const inRange = slots.filter((slot) => slot.end > rangeStart.getTime() && slot.start < rangeEnd.getTime());
  if (inRange.length === 0) {
    throw new AppError("INVALID_SCHEDULE_SLOTS", "可用时间不在安排范围内", 422);
  }

  const lockedInput = (input.lockedBlocks ?? []).map((block) => ({
    actionId: block.actionId ?? null,
    title: block.title ?? null,
    start: toDate(block.start, "lockedBlock.start"),
    end: toDate(block.end, "lockedBlock.end"),
  }));
  for (const block of lockedInput) {
    if (block.end <= block.start) {
      throw new AppError("INVALID_SCHEDULE_SLOTS", "锁定区间的结束必须晚于开始", 422);
    }
  }

  const inputHash = createHash("sha256").update(JSON.stringify({
    rangeStart: iso(rangeStart),
    rangeEnd: iso(rangeEnd),
    slots: input.slots,
    actionIds: input.actionIds ?? null,
    lockedBlocks: input.lockedBlocks ?? null,
    episodeRevisionId: input.episodeRevisionId ?? null,
  })).digest("hex");

  const existing = await db.schedulePlan.findUnique({
    where: { projectId_requestId: { projectId, requestId: input.requestId } },
    include: { blocks: true },
  });
  if (existing) {
    if (existing.status === "DRAFT" && existing.inputHash === inputHash) {
      return await serializePlan(existing, []);
    }
    if (existing.status === "CONFIRMED") {
      // 幂等重放：已确认计划不重建
      return await serializePlan(existing, []);
    }
    if (existing.status !== "DRAFT" && existing.status !== "STALE") {
      throw new AppError("REQUEST_ID_REUSED", "该 requestId 已被占用，请换一个新的请求标识", 409);
    }
    await db.schedulePlan.delete({ where: { id: existing.id } });
  }

  // ---- 候选行动评估 ----
  const confirmedBlocks = await confirmedBlocksForUser(options.userId, rangeStart, rangeEnd);
  const memberships = await db.projectMembership.findMany({ where: { userId: options.userId }, select: { projectId: true } });
  const scheduledActionIds = new Set(
    memberships.length === 0
      ? []
      : (await db.scheduleBlock.findMany({
        where: { plan: { status: "CONFIRMED", projectId: { in: memberships.map((item) => item.projectId) } } },
        select: { actionId: true },
      })).map((item) => item.actionId),
  );

  const { assessActionFeasibility } = await import("@/lib/services/actionFeasibilityService");
  const explicit = input.actionIds && input.actionIds.length > 0;
  const candidates = explicit
    ? await db.actionItem.findMany({ where: { projectId, id: { in: input.actionIds! } } })
    : await db.actionItem.findMany({
      where: { projectId, status: "TODO" },
      take: MAX_CANDIDATE_ACTIONS,
    });

  interface Candidate {
    id: string;
    title: string;
    priority: number;
    dueAt: Date | null;
    createdAt: Date;
    dependencyVersion: number;
    estimatedMinutes: number;
  }
  const ready: Candidate[] = [];
  const unscheduled: ScheduleSkipReason[] = [];
  const requestedIds = new Set(input.actionIds ?? []);

  for (const action of candidates) {
    if (action.status === "DONE" || action.status === "CANCELLED") {
      if (explicit && requestedIds.has(action.id)) {
        unscheduled.push({ actionId: action.id, actionTitle: action.title, reasonCode: "DONE_OR_CANCELLED", message: "行动已完成或已取消，不再安排时间" });
      }
      continue;
    }
    if (scheduledActionIds.has(action.id)) {
      unscheduled.push({ actionId: action.id, actionTitle: action.title, reasonCode: "ALREADY_SCHEDULED", message: "该行动已出现在当前已确认计划中" });
      continue;
    }
    if (!action.estimatedMinutes || action.estimatedMinutes <= 0) {
      unscheduled.push({ actionId: action.id, actionTitle: action.title, reasonCode: "MISSING_ESTIMATE", message: "缺少正数估时，请先补充估算时间" });
      continue;
    }
    const assessment = await assessActionFeasibility(projectId, action.id);
    if (assessment.feasibility === "BLOCKED") {
      unscheduled.push({ actionId: action.id, actionTitle: action.title, reasonCode: "BLOCKED", message: assessment.summary });
      continue;
    }
    if (assessment.feasibility === "UNKNOWN") {
      unscheduled.push({ actionId: action.id, actionTitle: action.title, reasonCode: "UNKNOWN", message: assessment.summary });
      continue;
    }
    ready.push({
      id: action.id,
      title: action.title,
      priority: action.priority,
      dueAt: action.dueAt,
      createdAt: action.createdAt,
      dependencyVersion: action.dependencyVersion,
      estimatedMinutes: action.estimatedMinutes,
    });
  }
  for (const actionId of input.actionIds ?? []) {
    if (!candidates.some((action) => action.id === actionId)) {
      unscheduled.push({ actionId, actionTitle: "", reasonCode: "VERSION_CHANGED", message: "行动不存在或不属于当前项目" });
    }
  }

  // 稳定排序：截止时间（缺失排后）→ 优先级 → 创建时间 → ID
  ready.sort((a, b) => {
    const dueA = a.dueAt ? a.dueAt.getTime() : Number.POSITIVE_INFINITY;
    const dueB = b.dueAt ? b.dueAt.getTime() : Number.POSITIVE_INFINITY;
    if (dueA !== dueB) return dueA - dueB;
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.createdAt.getTime() !== b.createdAt.getTime()) return a.createdAt.getTime() - b.createdAt.getTime();
    return a.id.localeCompare(b.id);
  });

  // ---- 确定性放置 ----
  const lockedByKey = new Map<string, { start: number; end: number }>();
  for (const block of lockedInput) {
    if (block.actionId) lockedByKey.set(block.actionId, { start: block.start.getTime(), end: block.end.getTime() });
  }
  const occupied: Interval[] = [
    ...confirmedBlocks.map((block) => ({ start: block.startAt.getTime(), end: block.endAt.getTime() })),
    ...lockedInput.map((block) => ({ start: block.start.getTime(), end: block.end.getTime() })),
  ];
  let free = subtractIntervals(inRange, occupied);

  const placedBlocks: Array<{
    actionId: string;
    actionVersion: number;
    startAt: Date;
    endAt: Date;
    locked: boolean;
  }> = [];

  for (const candidate of ready) {
    const locked = lockedByKey.get(candidate.id);
    if (locked) {
      placedBlocks.push({
        actionId: candidate.id,
        actionVersion: candidate.dependencyVersion,
        startAt: new Date(locked.start),
        endAt: new Date(locked.end),
        locked: true,
      });
      continue;
    }
    const durationMs = candidate.estimatedMinutes * 60_000;
    const target = free.find((interval) => interval.end - interval.start >= durationMs);
    if (!target) {
      unscheduled.push({ actionId: candidate.id, actionTitle: candidate.title, reasonCode: "NO_CAPACITY", message: `剩余可用时间不足以容纳 ${candidate.estimatedMinutes} 分钟的完整时段` });
      continue;
    }
    const startAt = new Date(target.start);
    const endAt = new Date(target.start + durationMs);
    placedBlocks.push({ actionId: candidate.id, actionVersion: candidate.dependencyVersion, startAt, endAt, locked: false });
    free = subtractIntervals(free, [{ start: target.start, end: target.start + durationMs }]);
  }

  const plan = await db.schedulePlan.create({
    data: {
      projectId,
      episodeRevisionId: input.episodeRevisionId ?? null,
      requestId: input.requestId,
      timezone: input.timezone && input.timezone.trim().length > 0 ? input.timezone : DEFAULT_TIMEZONE,
      rangeStart,
      rangeEnd,
      inputHash,
      version: 1,
      status: "DRAFT",
      blocks: {
        create: placedBlocks.map((block) => ({
          actionId: block.actionId,
          actionVersion: block.actionVersion,
          startAt: block.startAt,
          endAt: block.endAt,
          locked: block.locked,
        })),
      },
    },
    include: { blocks: true },
  });
  return await serializePlan(plan, unscheduled);
}

export interface ScheduleConfirmInput {
  requestId: string;
  /** 预览返回的 version；不匹配说明计划已被重新预览 */
  expectedVersion?: number;
}

/** 确认前重新校验行动版本、可行性与跨项目占用；任何关键变化返回 409 */
export async function confirmSchedulePlan(projectId: string, planId: string, input: ScheduleConfirmInput, options: SchedulePreviewOptions): Promise<SchedulePlanData> {
  ensureScheduleEnabled();
  const plan = await db.schedulePlan.findFirst({
    where: { id: planId, projectId },
    include: { blocks: true },
  });
  if (!plan) throw new AppError("SCHEDULE_PLAN_NOT_FOUND", "排程计划不存在或不属于当前项目", 404);

  if (plan.status === "CONFIRMED") {
    if (plan.requestId === input.requestId) return await serializePlan(plan, []);
    throw new AppError("SCHEDULE_PLAN_ALREADY_CONFIRMED", "该计划已用其他请求确认过", 409);
  }
  if (plan.status !== "DRAFT") {
    throw new AppError("SCHEDULE_PLAN_STATE_CONFLICT", `计划当前状态为 ${plan.status}，不能确认`, 409);
  }
  if (input.expectedVersion !== undefined && input.expectedVersion !== plan.version) {
    throw new AppError("SCHEDULE_VERSION_CHANGED", "计划已被重新预览，请使用最新版本确认", 409);
  }

  const { assessActionFeasibility } = await import("@/lib/services/actionFeasibilityService");
  for (const block of plan.blocks) {
    const action = await db.actionItem.findFirst({ where: { id: block.actionId, projectId } });
    if (!action) {
      throw new AppError("SCHEDULE_ACTION_CHANGED", "计划中的行动已被删除，请重新预览", 409);
    }
    if (action.dependencyVersion !== block.actionVersion) {
      throw new AppError("SCHEDULE_ACTION_CHANGED", `行动「${action.title}」的依赖或估时已变化，请重新预览`, 409);
    }
    if (block.locked) continue;
    const assessment = await assessActionFeasibility(projectId, action.id);
    if (assessment.feasibility !== "READY") {
      throw new AppError("SCHEDULE_ACTION_CHANGED", `行动「${action.title}」当前不再可开始（${assessment.feasibility}），请重新预览`, 409);
    }
  }

  // 跨项目占用：同一用户已确认的任何时段不能重叠
  const confirmed = await confirmedBlocksForUser(options.userId, plan.rangeStart, plan.rangeEnd);
  for (const block of plan.blocks) {
    const conflict = confirmed.find(
      (item) => item.startAt < block.endAt && item.endAt > block.startAt,
    );
    if (conflict) {
      throw new AppError("SCHEDULE_CAPACITY_CONFLICT", "所选时段与其他项目的已确认安排冲突，请重新预览", 409);
    }
  }

  const updated = await db.$transaction(async (tx) => {
    const result = await tx.schedulePlan.updateMany({
      where: { id: plan.id, status: "DRAFT" },
      data: { status: "CONFIRMED" },
    });
    if (result.count === 0) {
      throw new AppError("SCHEDULE_PLAN_STATE_CONFLICT", "计划已被并发请求确认", 409);
    }
    return tx.schedulePlan.findUniqueOrThrow({
      where: { id: plan.id },
      include: { blocks: true },
    });
  });

  return await serializePlan(updated, []);
}

/** 当前已确认计划；空计划返回结构化空态 */
export async function getCurrentSchedulePlan(projectId: string): Promise<SchedulePlanData | null> {
  ensureScheduleEnabled();
  const plan = await db.schedulePlan.findFirst({
    where: { projectId, status: "CONFIRMED" },
    include: { blocks: true },
    orderBy: { updatedAt: "desc" },
  });
  return plan ? await serializePlan(plan, []) : null;
}

export async function cancelSchedulePlan(projectId: string, planId: string): Promise<SchedulePlanData> {
  ensureScheduleEnabled();
  const plan = await db.schedulePlan.findFirst({
    where: { id: planId, projectId },
    include: { blocks: true },
  });
  if (!plan) throw new AppError("SCHEDULE_PLAN_NOT_FOUND", "排程计划不存在或不属于当前项目", 404);
  if (plan.status === "CANCELLED") return await serializePlan(plan, []);
  const updated = await db.schedulePlan.update({
    where: { id: plan.id },
    data: { status: "CANCELLED" },
    include: { blocks: true },
  });
  return await serializePlan(updated, []);
}
