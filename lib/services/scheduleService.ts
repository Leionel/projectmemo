import { createHash } from "node:crypto";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { db } from "@/lib/db";
import type { ActionStatus, Prisma } from "@/lib/generated/prisma/client";
import {
  type CalendarSyncStatus,
  type ScheduleBlockData,
  type SchedulePlanData,
  type SchedulePreviewInput,
  type ScheduleSkipReason,
} from "@/lib/types/schedule";

const DEFAULT_TIMEZONE = "Asia/Shanghai";
const MAX_CANDIDATE_ACTIONS = 50;
/** 能进入时间块的行动状态；DONE/CANCELLED 不安排，确认时同样拒绝 */
const SCHEDULABLE_STATUSES: ActionStatus[] = ["TODO", "DOING"];

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
    for (const slot of result) {
      if (block.end <= slot.start || block.start >= slot.end) {
        next.push(slot);
        continue;
      }
      if (block.start > slot.start) next.push({ start: slot.start, end: Math.min(block.start, slot.end) });
      if (block.end < slot.end) next.push({ start: Math.max(block.end, slot.start), end: slot.end });
    }
    result = next.filter((item) => item.end > item.start);
  }
  return result;
}

function totalCapacity(intervals: Interval[]): number {
  return intervals.reduce((sum, item) => sum + (item.end - item.start), 0);
}

type PlanRow = Prisma.SchedulePlanGetPayload<{ include: { blocks: true } }>;

function serializeBlock(block: PlanRow["blocks"][number], titleByActionId: Map<string, string>): ScheduleBlockData {
  return {
    id: block.id,
    actionId: block.actionId,
    actionTitle: titleByActionId.get(block.actionId) ?? "",
    actionVersion: block.actionVersion,
    start: iso(block.startAt),
    end: iso(block.endAt),
    locked: block.locked,
    calendar: {
      status: (block.calendarSyncStatus ?? "NONE") as CalendarSyncStatus,
      calendarId: block.calendarId,
      eventId: block.calendarEventId,
      syncedAt: block.calendarSyncedAt ? iso(block.calendarSyncedAt) : null,
      error: block.calendarError,
    },
  };
}

async function loadBlockTitles(blocks: Array<{ actionId: string }>): Promise<Map<string, string>> {
  const ids = [...new Set(blocks.map((block) => block.actionId))];
  if (ids.length === 0) return new Map();
  const rows = await db.actionItem.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } });
  return new Map(rows.map((row) => [row.id, row.title]));
}

function readUnscheduled(row: PlanRow): ScheduleSkipReason[] {
  const stored = row.unscheduled;
  if (!Array.isArray(stored)) return [];
  return (stored as unknown as ScheduleSkipReason[]).filter(
    (item) => typeof item === "object" && item !== null && typeof item.actionId === "string",
  );
}

/** 未安排原因随计划持久化：同 requestId 重放必须还原首次结果，不能变成空数组 */
async function serializePlan(row: PlanRow): Promise<SchedulePlanData> {
  const titleByActionId = await loadBlockTitles(row.blocks);
  const blocks = row.blocks
    .map((block) => serializeBlock(block, titleByActionId))
    .sort((a, b) => a.start.localeCompare(b.start) || a.actionId.localeCompare(b.actionId));
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    episodeRevisionId: row.episodeRevisionId,
    requestId: row.requestId,
    timezone: row.timezone,
    rangeStart: iso(row.rangeStart),
    rangeEnd: iso(row.rangeEnd),
    version: row.version,
    status: row.status as SchedulePlanData["status"],
    blocks,
    scheduled: blocks,
    unscheduled: readUnscheduled(row),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/**
 * 同一用户已确认的时段。按 userId 列过滤而不是按项目成员：
 * 同项目两名成员的个人时间互不占用。
 */
async function confirmedBlocksForUser(
  userId: string,
  rangeStart: Date,
  rangeEnd: Date,
  excludePlanId?: string,
  client: Prisma.TransactionClient = db as unknown as Prisma.TransactionClient,
) {
  const plans = await client.schedulePlan.findMany({
    where: {
      userId,
      status: "CONFIRMED",
      rangeStart: { lt: rangeEnd },
      rangeEnd: { gt: rangeStart },
      ...(excludePlanId ? { id: { not: excludePlanId } } : {}),
    },
    select: { blocks: { select: { startAt: true, endAt: true, actionId: true, planId: true } } },
  });
  return plans.flatMap((plan) => plan.blocks);
}

async function scheduledActionIdsForUser(userId: string): Promise<Set<string>> {
  const rows = await db.scheduleBlock.findMany({
    where: { plan: { userId, status: "CONFIRMED" } },
    select: { actionId: true },
  });
  return new Set(rows.map((row) => row.actionId));
}

export interface ScheduleActor {
  /** 来自鉴权结果的用户；绝不接受客户端传入 */
  userId: string;
}

/**
 * 确定性排程预览。不做全局最优、不拆分任务、不自动移动锁定区间；
 * 每个未安排行动都有 reasonCode 与中文说明。
 */
export async function previewSchedule(projectId: string, input: SchedulePreviewInput, actor: ScheduleActor): Promise<SchedulePlanData> {
  ensureScheduleEnabled();
  const rangeStart = toDate(input.rangeStart, "rangeStart");
  const rangeEnd = toDate(input.rangeEnd, "rangeEnd");
  if (rangeStart.getTime() >= rangeEnd.getTime()) {
    throw new AppError("INVALID_SCHEDULE_RANGE", "安排起点必须早于终点", 422);
  }
  if (!input.slots || input.slots.length === 0) {
    throw new AppError("VALIDATION_ERROR", "至少提供一个可用时间区间", 422);
  }

  const slots = normalizeIntervals(input.slots.map((slot) => ({
    start: toDate(slot.start, "slot.start").getTime(),
    end: toDate(slot.end, "slot.end").getTime(),
  })));
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
    userId: actor.userId,
    rangeStart: iso(rangeStart),
    rangeEnd: iso(rangeEnd),
    slots: input.slots,
    actionIds: input.actionIds ?? null,
    lockedBlocks: input.lockedBlocks ?? null,
    episodeRevisionId: input.episodeRevisionId ?? null,
  })).digest("hex");

  // requestId 幂等：同输入重放首次结果；同 ID 不同载荷一律 409，绝不删除旧计划重建
  const existing = await db.schedulePlan.findUnique({
    where: { projectId_requestId: { projectId, requestId: input.requestId } },
    include: { blocks: true },
  });
  if (existing) {
    if (existing.inputHash === inputHash && existing.userId === actor.userId) {
      return await serializePlan(existing);
    }
    throw new AppError("REQUEST_ID_REUSED", "该 requestId 已用于不同的安排请求，请换一个新的请求标识", 409);
  }

  // ---- 候选行动评估 ----
  const confirmedBlocks = await confirmedBlocksForUser(actor.userId, rangeStart, rangeEnd);
  const scheduledActionIds = await scheduledActionIdsForUser(actor.userId);

  const { assessActionFeasibility } = await import("@/lib/services/actionFeasibilityService");
  const explicit = Boolean(input.actionIds && input.actionIds.length > 0);
  const candidates = explicit
    ? await db.actionItem.findMany({ where: { projectId, id: { in: input.actionIds! } } })
    : await db.actionItem.findMany({ where: { projectId, status: { in: SCHEDULABLE_STATUSES } }, take: MAX_CANDIDATE_ACTIONS });

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
    if (!SCHEDULABLE_STATUSES.includes(action.status)) {
      if (explicit && requestedIds.has(action.id)) {
        unscheduled.push({ actionId: action.id, actionTitle: action.title, reasonCode: "DONE_OR_CANCELLED", message: "行动已完成或已取消，不再安排时间" });
      }
      continue;
    }
    if (scheduledActionIds.has(action.id)) {
      unscheduled.push({ actionId: action.id, actionTitle: action.title, reasonCode: "ALREADY_SCHEDULED", message: "该行动已出现在你当前已确认的安排中" });
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
  const lockedIntervals = lockedInput.map((block) => ({ start: block.start.getTime(), end: block.end.getTime() }));
  const crossProjectIntervals = confirmedBlocks.map((block) => ({ start: block.startAt.getTime(), end: block.endAt.getTime() }));
  // 只扣锁定区间的容量用于区分「容量不足」与「被其他项目占用」
  const freeIgnoringCrossProject = subtractIntervals(inRange, lockedIntervals);
  let free = subtractIntervals(freeIgnoringCrossProject, crossProjectIntervals);

  const placedBlocks: Array<{ actionId: string; actionVersion: number; startAt: Date; endAt: Date; locked: boolean }> = [];

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
      const blockedByOtherProjects = crossProjectIntervals.length > 0 &&
        totalCapacity(freeIgnoringCrossProject) >= durationMs &&
        totalCapacity(free) < durationMs;
      unscheduled.push(blockedByOtherProjects
        ? {
          actionId: candidate.id,
          actionTitle: candidate.title,
          reasonCode: "CROSS_PROJECT_CONFLICT",
          message: "该时段已被你其他项目的已确认安排占用，请换个时间或先调整那份安排",
        }
        : {
          actionId: candidate.id,
          actionTitle: candidate.title,
          reasonCode: "NO_CAPACITY",
          message: `剩余可用时间不足以容纳 ${candidate.estimatedMinutes} 分钟的完整时段`,
        });
      continue;
    }
    placedBlocks.push({
      actionId: candidate.id,
      actionVersion: candidate.dependencyVersion,
      startAt: new Date(target.start),
      endAt: new Date(target.start + durationMs),
      locked: false,
    });
    free = subtractIntervals(free, [{ start: target.start, end: target.start + durationMs }]);
  }

  const plan = await db.schedulePlan.create({
    data: {
      projectId,
      userId: actor.userId,
      episodeRevisionId: input.episodeRevisionId ?? null,
      requestId: input.requestId,
      timezone: input.timezone && input.timezone.trim().length > 0 ? input.timezone : DEFAULT_TIMEZONE,
      rangeStart,
      rangeEnd,
      inputHash,
      version: 1,
      status: "DRAFT",
      unscheduled: unscheduled as unknown as Prisma.InputJsonValue,
      blocks: {
        create: placedBlocks.map((block) => ({
          actionId: block.actionId,
          actionVersion: block.actionVersion,
          startAt: block.startAt,
          endAt: block.endAt,
          locked: block.locked,
          calendarSyncStatus: "NONE",
        })),
      },
    },
    include: { blocks: true },
  });
  return await serializePlan(plan);
}

export interface ScheduleConfirmInput {
  requestId: string;
  /** 预览返回的 version；不匹配说明计划已被重新预览 */
  expectedVersion?: number;
}

/**
 * 确认前重新校验行动状态、版本与可行性，并在同一事务内做跨项目冲突检查：
 * 先取得写锁再校验，两个项目并发确认重叠时段时只允许一个成功。
 */
export async function confirmSchedulePlan(projectId: string, planId: string, input: ScheduleConfirmInput, actor: ScheduleActor): Promise<SchedulePlanData> {
  ensureScheduleEnabled();
  const plan = await db.schedulePlan.findFirst({
    where: { id: planId, projectId, userId: actor.userId },
    include: { blocks: true },
  });
  if (!plan) throw new AppError("SCHEDULE_PLAN_NOT_FOUND", "排程计划不存在或不属于当前项目", 404);

  if (plan.status === "CONFIRMED") {
    if (plan.requestId === input.requestId) return await serializePlan(plan);
    throw new AppError("SCHEDULE_PLAN_ALREADY_CONFIRMED", "该计划已用其他请求确认过", 409);
  }
  if (plan.status !== "DRAFT") {
    throw new AppError("SCHEDULE_PLAN_STATE_CONFLICT", `计划当前状态为 ${plan.status}，不能确认`, 409);
  }
  if (input.expectedVersion !== undefined && input.expectedVersion !== plan.version) {
    throw new AppError("SCHEDULE_VERSION_CHANGED", "计划已被重新预览，请使用最新版本确认", 409);
  }

  // 事务外先评估可行性（读多写少，避免把外部判定放进写事务）
  const { assessActionFeasibility } = await import("@/lib/services/actionFeasibilityService");
  for (const block of plan.blocks) {
    if (block.locked) continue;
    const assessment = await assessActionFeasibility(projectId, block.actionId);
    if (assessment.feasibility !== "READY") {
      throw new AppError("SCHEDULE_ACTION_CHANGED", `行动「${assessment.summary}」当前不再可开始，请重新预览`, 409);
    }
  }

  const updated = await db.$transaction(async (tx) => {
    // 先抢占写锁：并发确认在此串行化，后到者能看到前者已提交的时段
    const claimed = await tx.schedulePlan.updateMany({
      where: { id: plan.id, status: "DRAFT", userId: actor.userId },
      data: { status: "CONFIRMED" },
    });
    if (claimed.count === 0) {
      throw new AppError("SCHEDULE_PLAN_STATE_CONFLICT", "计划已被并发请求确认，请刷新后重试", 409);
    }

    const blocks = await tx.scheduleBlock.findMany({ where: { planId: plan.id } });
    for (const block of blocks) {
      const action = await tx.actionItem.findFirst({ where: { id: block.actionId, projectId } });
      if (!action) {
        throw new AppError("SCHEDULE_ACTION_CHANGED", "计划中的行动已被删除，请重新预览", 409);
      }
      // 锁定块同样受行动状态约束：锁定的是时间，不是绕过状态检查
      if (!SCHEDULABLE_STATUSES.includes(action.status)) {
        throw new AppError("SCHEDULE_ACTION_CHANGED", `行动「${action.title}」已${action.status === "DONE" ? "完成" : "取消"}，不能再安排时间`, 409);
      }
      if (action.dependencyVersion !== block.actionVersion) {
        throw new AppError("SCHEDULE_ACTION_CHANGED", `行动「${action.title}」的依赖或估时已变化，请重新预览`, 409);
      }
      if (action.estimatedMinutes === null && !block.locked) {
        throw new AppError("SCHEDULE_ACTION_CHANGED", `行动「${action.title}」的估时已被清空，请重新预览`, 409);
      }
    }

    const conflicting = await confirmedBlocksForUser(actor.userId, plan.rangeStart, plan.rangeEnd, plan.id, tx);
    for (const block of blocks) {
      const conflict = conflicting.find((item) => item.startAt < block.endAt && item.endAt > block.startAt);
      if (conflict) {
        throw new AppError("SCHEDULE_CAPACITY_CONFLICT", "所选时段与其他项目的已确认安排冲突，请重新预览", 409);
      }
    }

    return tx.schedulePlan.findUniqueOrThrow({ where: { id: plan.id }, include: { blocks: true } });
  });

  return await serializePlan(updated);
}

/** 当前已确认计划；按用户隔离，空计划返回 null 由调用方给结构化空态 */
export async function getCurrentSchedulePlan(projectId: string, userId: string): Promise<SchedulePlanData | null> {
  ensureScheduleEnabled();
  const plan = await db.schedulePlan.findFirst({
    where: { projectId, userId, status: "CONFIRMED" },
    include: { blocks: true },
    orderBy: { updatedAt: "desc" },
  });
  return plan ? await serializePlan(plan) : null;
}

export async function cancelSchedulePlan(projectId: string, planId: string, userId: string): Promise<SchedulePlanData> {
  ensureScheduleEnabled();
  const plan = await db.schedulePlan.findFirst({
    where: { id: planId, projectId, userId },
    include: { blocks: true },
  });
  if (!plan) throw new AppError("SCHEDULE_PLAN_NOT_FOUND", "排程计划不存在或不属于当前项目", 404);
  if (plan.status === "CANCELLED") return await serializePlan(plan);
  const updated = await db.schedulePlan.update({
    where: { id: plan.id },
    data: { status: "CANCELLED" },
    include: { blocks: true },
  });
  return await serializePlan(updated);
}

export interface CalendarSyncInput {
  blockId: string;
  calendarId: string | null;
  eventId: string | null;
  status: CalendarSyncStatus;
  error?: string | null;
}

/**
 * 记录系统日历写入回执。只登记 ProjectMemo 自己创建的 eventId，
 * 服务端不接受「删除用户原有日程」的语义：撤销只作用于带 eventId 的块。
 */
export async function recordCalendarSync(projectId: string, planId: string, entries: CalendarSyncInput[], userId: string): Promise<SchedulePlanData> {
  ensureScheduleEnabled();
  if (!isFeatureEnabled("PROJECT_CALENDAR_SYNC_ENABLED", false)) {
    throw new AppError("PROJECT_CALENDAR_SYNC_DISABLED", "系统日历同步功能当前已关闭", 503);
  }
  const plan = await db.schedulePlan.findFirst({ where: { id: planId, projectId, userId }, include: { blocks: true } });
  if (!plan) throw new AppError("SCHEDULE_PLAN_NOT_FOUND", "排程计划不存在或不属于当前项目", 404);

  const now = new Date();
  await db.$transaction(async (tx) => {
    for (const entry of entries) {
      const block = plan.blocks.find((item) => item.id === entry.blockId);
      if (!block) throw new AppError("SCHEDULE_BLOCK_NOT_FOUND", "要同步的时段不存在或不属于当前计划", 404);
      await tx.scheduleBlock.update({
        where: { id: block.id },
        data: {
          calendarId: entry.calendarId,
          calendarEventId: entry.eventId,
          calendarSyncStatus: entry.status,
          calendarSyncedAt: entry.status === "SYNCED" || entry.status === "REVOKED" ? now : block.calendarSyncedAt,
          calendarError: entry.error ?? null,
        },
      });
    }
  });

  const updated = await db.schedulePlan.findUniqueOrThrow({ where: { id: plan.id }, include: { blocks: true } });
  return await serializePlan(updated);
}

/** 计划取消/替代时撤销自己写入的日历事件回执；用户原有日程不受影响 */
export async function markCalendarRevoked(projectId: string, planId: string, blockIds: string[], userId: string): Promise<SchedulePlanData> {
  ensureScheduleEnabled();
  const plan = await db.schedulePlan.findFirst({ where: { id: planId, projectId, userId }, include: { blocks: true } });
  if (!plan) throw new AppError("SCHEDULE_PLAN_NOT_FOUND", "排程计划不存在或不属于当前项目", 404);
  const targets = plan.blocks.filter((block) => blockIds.includes(block.id) && block.calendarEventId !== null);
  if (targets.length > 0) {
    await db.$transaction(async (tx) => {
      for (const block of targets) {
        await tx.scheduleBlock.update({
          where: { id: block.id },
          data: { calendarSyncStatus: "REVOKED", calendarSyncedAt: new Date(), calendarError: null },
        });
      }
    });
  }
  const updated = await db.schedulePlan.findUniqueOrThrow({ where: { id: plan.id }, include: { blocks: true } });
  return await serializePlan(updated);
}
