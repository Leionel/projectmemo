/**
 * 项目体检：只读、确定性的「检查项目当前问题」。
 *
 * 原则：
 * 1. 不训练模型、不做主观打分、不生成「健康度 87 分」这类缺乏定义的综合分数；
 * 2. 每个问题都能解释、能定位、能跳转到修复入口；
 * 3. 「建议先处理」只有一个，排序规则固定且可测试；
 * 4. 子检查失败时保留其余已知结果，并明确标注哪一部分暂不可用；
 * 5. 读取不产生任何业务写入、行动或检查点。
 */
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { getProjectStateFreshness } from "@/lib/services/projectStateService";
import { evaluateEpisodeFreshness } from "@/lib/services/projectEpisodeService";
import { getMissingEvidenceTypes } from "@/lib/milestones/evidenceGap";
import type { EpisodeClaim, EpisodeSummary } from "@/lib/types/episode";
import {
  HEALTH_SCHEMA_VERSION,
  type HealthFinding,
  type HealthFindingCode,
  type HealthGroup,
  type HealthSeverity,
  type HealthUnavailableSection,
  type ProjectHealthReport,
} from "@/lib/types/health";

const SEVERITY_RANK: Record<HealthSeverity, number> = { ACTION_REQUIRED: 0, ATTENTION: 1, INFO: 2 };

/**
 * 同一严重度内的固定优先级。数组顺序即「谁更该先处理」，
 * 与数据量、创建时间无关，因此排序结果稳定可测。
 */
const FINDING_PRIORITY: HealthFindingCode[] = [
  "STATE_REFRESH_FAILED",
  "MEETING_CHANGES_UNAPPROVED",
  "ACTION_BLOCKED",
  "EPISODE_STALE",
  "STATE_STALE",
  "REMINDER_NEEDS_ATTENTION",
  "ACTION_CALENDAR_SYNC_FAILED",
  "EPISODE_PARTIALLY_STALE",
  "ACTION_OVERDUE",
  "DELIVERABLE_EVIDENCE_MISSING",
  "ATTACHMENT_EXTRACTION_FAILED",
  "EPISODE_UNSOURCED_CLAIM",
  "EPISODE_OPEN_QUESTION",
  "ACTION_UNKNOWN",
  "ACTION_MISSING_ESTIMATE",
  "ACTION_SCHEDULED_NOT_STARTED",
  "MEMORY_DUPLICATE_GROUP",
  "STATE_LONG_UNREFRESHED",
  "STATE_NEVER_REFRESHED",
  "EPISODE_MISSING",
];

const MAX_ACTIONS_SCANNED = 200;
/** 状态超过这个时长没有刷新就提示「长时间未刷新」 */
const STATE_STALE_AFTER_MS = 72 * 3_600_000;
/** 已安排且即将开始但仍未开工的窗口 */
const UPCOMING_WINDOW_MS = 24 * 3_600_000;

function priorityOf(code: HealthFindingCode): number {
  const index = FINDING_PRIORITY.indexOf(code);
  return index === -1 ? FINDING_PRIORITY.length : index;
}

/** 确定性排序：严重度 → 固定优先级 → 观察到的时间（早的等得更久）→ 对象 ID */
export function sortFindings(findings: HealthFinding[]): HealthFinding[] {
  return [...findings].sort((a, b) => {
    if (SEVERITY_RANK[a.severity] !== SEVERITY_RANK[b.severity]) {
      return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    }
    if (priorityOf(a.findingCode) !== priorityOf(b.findingCode)) {
      return priorityOf(a.findingCode) - priorityOf(b.findingCode);
    }
    if (a.observedAt !== b.observedAt) return a.observedAt < b.observedAt ? -1 : 1;
    if (a.objectId !== b.objectId) return a.objectId.localeCompare(b.objectId);
    return a.findingCode.localeCompare(b.findingCode);
  });
}

interface DetectorContext {
  projectId: string;
  now: Date;
  /** 当前登录用户；个人提醒与个人排程只按它过滤，null 表示没有可用身份 */
  viewerUserId: string | null;
  findings: HealthFinding[];
  unavailable: HealthUnavailableSection[];
}

type Detector = (context: DetectorContext) => Promise<void>;

/** 分组中文名：不可用时只告诉用户「哪一部分没读到」，不复述底层错误 */
const SECTION_LABELS: Record<string, string> = {
  episodes: "阶段检查点",
  state: "项目状态",
  actions: "待办检查",
  meetings: "会议变化",
  attachments: "附件解析",
  deliverables: "成果证据",
  memory: "重复记忆",
  personal_schedule: "与你个人相关的提醒和排程",
};

/**
 * 子检查失败的处理：
 * - 详细原因（可能含数据库错误）只写服务端日志；
 * - 返回给客户端的是稳定的中文分类说明与错误码，不含任何底层异常文本。
 */
async function runDetector(name: string, detector: Detector, context: DetectorContext) {
  try {
    await detector(context);
  } catch (error) {
    const rawCode = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
    // 只认我们自己定义的错误码形状（大写+下划线）；Prisma 的 P2002 / SQLITE_BUSY 这类
    // 内部码一律折叠成 SECTION_UNAVAILABLE，不把底层实现暴露给客户端。
    const looksLikeOurs = /^[A-Z][A-Z0-9_]{3,}$/.test(rawCode) && !/^P[0-9]+$/.test(rawCode);
    const knownCode = looksLikeOurs ? rawCode : "SECTION_UNAVAILABLE";
    console.error(`[project-health] section "${name}" failed`, { code: rawCode || knownCode, error });
    const label = SECTION_LABELS[name] ?? "这一部分";
    // 已知的开关关闭类错误可以如实说明；其它一律用统一分类，不泄露内部信息
    const message = knownCode.endsWith("DISABLED")
      ? `${label}功能当前已关闭，本次体检不包含这一部分。`
      : `${label}暂时无法读取，本次体检不包含这一部分。`;
    context.unavailable.push({ section: name, errorCode: knownCode, message });
  }
}

function finding(input: Omit<HealthFinding, "observedAt"> & { observedAt?: string }, now: Date): HealthFinding {
  return { observedAt: input.observedAt ?? now.toISOString(), ...input };
}

// ---------------------------------------------------------------- 检查点

const episodeDetector: Detector = async ({ projectId, now, findings }) => {
  if (!isFeatureEnabled("PROJECT_EPISODES_ENABLED", false)) {
    throw new AppError("EPISODES_DISABLED", "阶段检查点功能当前已关闭", 503);
  }
  const episode = await db.projectEpisode.findFirst({
    where: { projectId, status: { not: "ARCHIVED" } },
    orderBy: { createdAt: "desc" },
  });
  if (!episode) {
    findings.push(finding({
      findingCode: "EPISODE_MISSING",
      severity: "ATTENTION",
      objectType: "episode",
      objectId: projectId,
      title: "还没有阶段检查点",
      explanation: "项目里还没有已确认的阶段判断，因此「上次做到哪、哪些结论仍有效」没有可追溯的版本。",
      suggestedAction: "整理一次阶段进展，确认第一版检查点",
      suggestedTarget: { kind: "episode", id: null, fallback: "record" },
    }, now));
    return;
  }

  const revision = await db.episodeRevision.findFirst({
    where: { episodeId: episode.id, status: "PUBLISHED" },
    orderBy: { revision: "desc" },
  });
  if (!revision) {
    findings.push(finding({
      findingCode: "EPISODE_MISSING",
      severity: "ATTENTION",
      objectType: "episode",
      objectId: episode.id,
      title: "阶段检查点还没有确认版本",
      explanation: "这个检查点还是草稿，没有经过你确认，因此不能作为当前阶段判断使用。",
      suggestedAction: "打开检查点确认版本",
      suggestedTarget: { kind: "episode", id: episode.id, fallback: null },
    }, now));
    return;
  }

  const freshness = await evaluateEpisodeFreshness(projectId, revision);
  if (freshness.status === "STALE") {
    findings.push(finding({
      findingCode: "EPISODE_STALE",
      severity: "ACTION_REQUIRED",
      objectType: "episode",
      objectId: episode.id,
      title: "阶段检查点已过期",
      explanation: "它的核心来源不可用或大部分结论已被新版本取代，不能继续代表当前阶段。",
      suggestedAction: "重新生成这个检查点的新版本",
      suggestedTarget: { kind: "episode", id: episode.id, fallback: null },
    }, now));
  } else if (freshness.status === "PARTIALLY_STALE") {
    findings.push(finding({
      findingCode: "EPISODE_PARTIALLY_STALE",
      severity: "ACTION_REQUIRED",
      objectType: "episode",
      objectId: episode.id,
      title: `阶段检查点有 ${freshness.affectedClaims.length} 条结论受来源变化影响`,
      explanation: freshness.affectedClaims
        .slice(0, 3)
        .map((item) => `${item.claimId}：${item.reason}`)
        .join("；"),
      suggestedAction: "逐条打开受影响结论，确认后生成新版本",
      suggestedTarget: { kind: "episode", id: episode.id, fallback: null },
    }, now));
  }

  const claims = (Array.isArray(revision.claims) ? revision.claims : []) as unknown as EpisodeClaim[];
  const unsourced = claims.filter((claim) => claim.kind === "FACT" && (!claim.sourceRefIds || claim.sourceRefIds.length === 0));
  if (unsourced.length > 0) {
    findings.push(finding({
      findingCode: "EPISODE_UNSOURCED_CLAIM",
      severity: "ATTENTION",
      objectType: "episode",
      objectId: revision.id,
      title: `阶段检查点有 ${unsourced.length} 条结论缺少来源`,
      explanation: `需要补证据的结论：「${unsourced.slice(0, 3).map((claim) => claim.text).join("」「")}」`,
      suggestedAction: "补上对应来源，或把结论改为待补证据",
      suggestedTarget: { kind: "episode", id: episode.id, fallback: "record" },
    }, now));
  }

  const summary = revision.summary as EpisodeSummary | null;
  const openSection = summary?.sections?.find((section) => section.section === "OPEN_QUESTIONS");
  if (openSection && !openSection.text.startsWith("检查点范围内没有待解决的争议或未知项")) {
    findings.push(finding({
      findingCode: "EPISODE_OPEN_QUESTION",
      severity: "ATTENTION",
      objectType: "episode",
      objectId: revision.id,
      title: "阶段检查点里还有未解决的争议或未知",
      explanation: openSection.text,
      suggestedAction: "打开检查点处理争议与未知项",
      suggestedTarget: { kind: "episode", id: episode.id, fallback: "memory_timeline" },
    }, now));
  }
};

// ---------------------------------------------------------------- 项目状态

const stateDetector: Detector = async ({ projectId, now, findings }) => {
  if (!isFeatureEnabled("PROJECT_STATE_ENABLED", false)) {
    throw new AppError("PROJECT_STATE_DISABLED", "项目状态功能当前已关闭", 503);
  }
  const freshness = await getProjectStateFreshness(projectId);
  if (freshness.status === "FAILED") {
    findings.push(finding({
      findingCode: "STATE_REFRESH_FAILED",
      severity: "ACTION_REQUIRED",
      objectType: "project_state",
      objectId: projectId,
      title: "项目状态上次刷新失败",
      // 只说明「刷新没有成功」，不复述可能含数据库细节的原始错误文本
      explanation: "刷新没有成功，界面上的状态可能停留在上一次成功的结果。可以重新刷新一次。",
      suggestedAction: "重新刷新项目状态",
      suggestedTarget: { kind: "state", id: null, fallback: null },
    }, now));
  } else if (freshness.status === "STALE") {
    findings.push(finding({
      findingCode: "STATE_STALE",
      severity: "ACTION_REQUIRED",
      objectType: "project_state",
      objectId: projectId,
      title: "项目状态已过期",
      explanation: "项目状态是旧快照，不能代表当前事实。",
      suggestedAction: "重新刷新项目状态",
      suggestedTarget: { kind: "state", id: null, fallback: null },
    }, now));
  } else if (freshness.status === "EMPTY") {
    findings.push(finding({
      findingCode: "STATE_NEVER_REFRESHED",
      severity: "INFO",
      objectType: "project_state",
      objectId: projectId,
      title: "项目状态还没有生成过",
      explanation: "还没有可比较的状态快照，变化对比与新鲜度都无从判断。",
      suggestedAction: "生成一次项目状态快照",
      suggestedTarget: { kind: "state", id: null, fallback: null },
    }, now));
  } else if (freshness.refreshedAt) {
    const refreshedAt = new Date(freshness.refreshedAt).getTime();
    if (now.getTime() - refreshedAt > STATE_STALE_AFTER_MS) {
      findings.push(finding({
        findingCode: "STATE_LONG_UNREFRESHED",
        severity: "INFO",
        objectType: "project_state",
        objectId: projectId,
        title: "项目状态已经很久没有刷新",
        explanation: `上次成功刷新是在 ${freshness.refreshedAt.slice(0, 10)}。`,
        observedAt: freshness.refreshedAt,
        suggestedAction: "刷新项目状态，看看这段时间发生了变化",
        suggestedTarget: { kind: "state", id: null, fallback: null },
      }, now));
    }
  }
};

// ---------------------------------------------------------------- 行动

const actionDetector: Detector = async ({ projectId, now, findings }) => {
  const actions = await db.actionItem.findMany({
    where: { projectId, status: { in: ["TODO", "DOING"] } },
    orderBy: { createdAt: "asc" },
    take: MAX_ACTIONS_SCANNED,
  });
  if (actions.length === 0) return;

  // 这里只检查「项目共享的行动事实」（受阻、无法确认、缺估时、逾期）。
  // 个人提醒与个人排程状态全部移到 personalScheduleDetector，并按当前登录用户过滤，
  // 避免成员之间互相看到对方的日历权限、失败原因或私人安排。
  const { assessActionFeasibility } = await import("@/lib/services/actionFeasibilityService");

  for (const action of actions) {
    const assessment = await assessActionFeasibility(projectId, action.id);
    if (assessment.feasibility === "BLOCKED") {
      findings.push(finding({
        findingCode: "ACTION_BLOCKED",
        severity: "ACTION_REQUIRED",
        objectType: "action",
        objectId: action.id,
        title: `待办「${action.title}」还有前置事项没完成`,
        explanation: assessment.summary,
        observedAt: action.updatedAt.toISOString(),
        suggestedAction: "补充前置依赖、补充信息，或先创建一个解阻待办",
        suggestedTarget: { kind: "action", id: action.id, fallback: "action_board" },
      }, now));
    } else if (assessment.feasibility === "UNKNOWN") {
      findings.push(finding({
        findingCode: "ACTION_UNKNOWN",
        severity: "ATTENTION",
        objectType: "action",
        objectId: action.id,
        title: `待办「${action.title}」暂时无法确认能否开始`,
        explanation: assessment.summary,
        observedAt: action.updatedAt.toISOString(),
        suggestedAction: "补齐依赖信息来源后再评估",
        suggestedTarget: { kind: "action", id: action.id, fallback: "record" },
      }, now));
    }

    if (action.estimatedMinutes === null) {
      findings.push(finding({
        findingCode: "ACTION_MISSING_ESTIMATE",
        severity: "INFO",
        objectType: "action",
        objectId: action.id,
        title: `待办「${action.title}」还没有估算用时`,
        explanation: "没有估时就无法安排到具体时段，只能留在待补充区。",
        observedAt: action.updatedAt.toISOString(),
        suggestedAction: "补充预计用时",
        suggestedTarget: { kind: "action", id: action.id, fallback: "action_board" },
      }, now));
    }

    if (action.dueAt && action.dueAt.getTime() < now.getTime()) {
      findings.push(finding({
        findingCode: "ACTION_OVERDUE",
        severity: "ACTION_REQUIRED",
        objectType: "action",
        objectId: action.id,
        title: `待办「${action.title}」已逾期`,
        explanation: `计划截止时间是 ${action.dueAt.toISOString().slice(0, 10)}，现在仍是${action.status === "DOING" ? "进行中" : "未开始"}。`,
        observedAt: action.dueAt.toISOString(),
        suggestedAction: "调整截止时间，或先完成它",
        suggestedTarget: { kind: "action", id: action.id, fallback: "action_board" },
      }, now));
    }

  }
};

// ---------------------------------------------------------------- 个人提醒与个人排程（按登录用户隔离）

/**
 * 只检查「当前查看者自己的」提醒与排程状态。
 *
 * 与 actionDetector 的分工：行动是否受阻、是否逾期属于项目共享事实，所有成员看到同一份；
 * 而设备日历权限、写入失败原因、私人时段属于个人数据，只能按 viewerUserId 过滤，
 * 绝不能把别的成员的状态混进同一条发现。
 */
const personalScheduleDetector: Detector = async ({ projectId, now, findings, viewerUserId, unavailable }) => {
  if (viewerUserId === null) {
    // 没有登录身份时宁可不检查，也不能用「全部成员」代替「当前用户」
    unavailable.push({
      section: "personal_schedule",
      errorCode: "NO_VIEWER_IDENTITY",
      message: "没有可用登录身份，本次不检查个人提醒与个人排程状态。",
    });
    return;
  }

  const actions = await db.actionItem.findMany({
    where: { projectId, status: { in: ["TODO", "DOING"] } },
    orderBy: { createdAt: "asc" },
    take: MAX_ACTIONS_SCANNED,
    select: { id: true, title: true, status: true },
  });
  if (actions.length === 0) return;
  const actionIds = actions.map((action) => action.id);

  const reminders = await db.actionReminder.findMany({
    where: { projectId, userId: viewerUserId, actionId: { in: actionIds } },
    select: { id: true, actionId: true, syncStatus: true, reminderAt: true },
  });
  const blocks = await db.scheduleBlock.findMany({
    where: { actionId: { in: actionIds }, plan: { status: "CONFIRMED", projectId, userId: viewerUserId } },
    select: { actionId: true, startAt: true, calendarSyncStatus: true, calendarError: true },
  });

  for (const action of actions) {
    const mine = reminders.filter((item) => item.actionId === action.id);
    const failed = mine.filter((item) => item.syncStatus === "FAILED");
    const denied = mine.filter((item) => item.syncStatus === "PERMISSION_DENIED");
    const missing = mine.filter((item) => item.syncStatus === "MISSING");
    if (failed.length > 0 || denied.length > 0) {
      const target = denied[0] ?? failed[0];
      findings.push(finding({
        findingCode: "ACTION_CALENDAR_SYNC_FAILED",
        severity: "ATTENTION",
        objectType: "reminder",
        objectId: target.id,
        title: denied.length > 0
          ? `你为「${action.title}」设置的日历提醒没有拿到权限`
          : `你为「${action.title}」设置的日历提醒没有写进设备`,
        explanation: denied.length > 0
          ? "计划时间已经保存在忆程里，但设备日历权限被拒，到点不会有提醒。这条状态只有你自己能看到。"
          : "计划时间仍然保留；这条失败原因只属于你的设备，其他成员看不到。",
        observedAt: target.reminderAt.toISOString(),
        suggestedAction: denied.length > 0 ? "到系统设置里允许忆程使用日历，然后重试" : "重试写入设备日历",
        suggestedTarget: { kind: "reminder", id: target.id, fallback: "action_board" },
      }, now));
    }
    if (missing.length > 0) {
      findings.push(finding({
        findingCode: "REMINDER_NEEDS_ATTENTION",
        severity: "ATTENTION",
        objectType: "reminder",
        objectId: missing[0].id,
        title: `你为「${action.title}」设置的日历日程已不存在`,
        explanation: "忆程记录过一条你设备上的日历日程，但当前在设备上找不到它，可能被手动删除了。",
        observedAt: missing[0].reminderAt.toISOString(),
        suggestedAction: "重新写入设备日历，或撤销这条提醒",
        suggestedTarget: { kind: "reminder", id: missing[0].id, fallback: "action_board" },
      }, now));
    }
    const block = blocks.find((item) => item.actionId === action.id);
    if (block && action.status === "TODO" && block.startAt.getTime() - now.getTime() < UPCOMING_WINDOW_MS) {
      findings.push(finding({
        findingCode: "ACTION_SCHEDULED_NOT_STARTED",
        severity: "INFO",
        objectType: "action",
        objectId: action.id,
        title: `你已安排的「${action.title}」还没开始`,
        explanation: `你把它安排在 ${block.startAt.toISOString().slice(0, 16).replace("T", " ")}，现在状态仍是未开始。`,
        observedAt: block.startAt.toISOString(),
        suggestedAction: "打开待办开始执行",
        suggestedTarget: { kind: "action", id: action.id, fallback: "action_board" },
      }, now));
    }
    if (block?.calendarSyncStatus === "FAILED") {
      findings.push(finding({
        findingCode: "ACTION_CALENDAR_SYNC_FAILED",
        severity: "ATTENTION",
        objectType: "action",
        objectId: action.id,
        title: `你已安排的「${action.title}」时段没有写进设备日历`,
        explanation: block.calendarError?.trim() || "已确认的时段仍然有效，只是你设备上的日历还没有对应日程。",
        observedAt: block.startAt.toISOString(),
        suggestedAction: "重试写入设备日历",
        suggestedTarget: { kind: "action", id: action.id, fallback: "action_board" },
      }, now));
    }
  }
};

// ---------------------------------------------------------------- 会议变更

const meetingDetector: Detector = async ({ projectId, now, findings }) => {
  const pending = await db.agentRun.findMany({
    where: { projectId, provider: "meeting_state_diff", confirmedAt: null },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, createdAt: true, resultJson: true },
  });
  for (const run of pending) {
    const result = run.resultJson as { status?: string } | null;
    if (result?.status !== "PENDING") continue;
    findings.push(finding({
      findingCode: "MEETING_CHANGES_UNAPPROVED",
      severity: "ACTION_REQUIRED",
      objectType: "meeting",
      objectId: run.id,
      title: "有一次会议变化还没有确认",
      explanation: "会议文本已经解析出候选变化，但还没有逐项确认，因此这些变化既没有写入项目，也没有被排除。",
      observedAt: run.createdAt.toISOString(),
      suggestedAction: "打开这次会议变化，逐项确认或丢弃",
      suggestedTarget: { kind: "meeting", id: run.id, fallback: null },
    }, now));
  }
};

// ---------------------------------------------------------------- 附件

const attachmentDetector: Detector = async ({ projectId, now, findings }) => {
  if (!isFeatureEnabled("PROJECT_INBOX_ENABLED", false)) {
    throw new AppError("PROJECT_INBOX_DISABLED", "附件入口当前已关闭", 503);
  }
  const failed = await db.attachment.findMany({
    where: { projectId, extractionStatus: "FAILED" },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: { id: true, fileName: true, createdAt: true, extractionError: true },
  });
  for (const attachment of failed) {
    findings.push(finding({
      findingCode: "ATTACHMENT_EXTRACTION_FAILED",
      severity: "ATTENTION",
      objectType: "attachment",
      objectId: attachment.id,
      title: `附件《${attachment.fileName}》解析失败`,
      explanation: attachment.extractionError?.trim() || "附件没能提取出正文，相关内容还没有进入项目记忆。",
      observedAt: attachment.createdAt.toISOString(),
      suggestedAction: "重试解析，或手工补充/纠正正文",
      suggestedTarget: { kind: "attachment", id: attachment.id, fallback: "inbox" },
    }, now));
  }
};

// ---------------------------------------------------------------- 成果证据

const deliverableDetector: Detector = async ({ projectId, now, findings }) => {
  const deliverables = await db.deliverable.findMany({
    where: { milestone: { projectId }, status: { not: "COMPLETED" } },
    include: { evidences: true, milestone: { select: { title: true } } },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  for (const deliverable of deliverables) {
    let expected: string[] = [];
    try {
      const parsed = JSON.parse(deliverable.expectedEvidence);
      expected = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      expected = [];
    }
    if (expected.length === 0) continue;
    const missing = getMissingEvidenceTypes(expected, deliverable.evidences.map((evidence) => ({
      evidenceType: evidence.evidenceType,
      confirmed: evidence.confirmed,
    })));
    if (missing.length === 0) continue;
    findings.push(finding({
      findingCode: "DELIVERABLE_EVIDENCE_MISSING",
      severity: "ATTENTION",
      objectType: "deliverable",
      objectId: deliverable.id,
      title: `关键成果「${deliverable.title}」还缺少证据`,
      explanation: `里程碑「${deliverable.milestone.title}」要求 ${missing.join("、")}，目前没有已确认的证据。`,
      observedAt: deliverable.createdAt.toISOString(),
      suggestedAction: "补充并确认对应证据",
      suggestedTarget: { kind: "deliverable", id: deliverable.id, fallback: "record" },
    }, now));
  }
};

// ---------------------------------------------------------------- 重复记忆

const memoryDetector: Detector = async ({ projectId, now, findings }) => {
  if (!isFeatureEnabled("PROJECT_MEMORY_CONSOLIDATION_ENABLED", false)) {
    throw new AppError("MEMORY_CONSOLIDATION_DISABLED", "记忆整理功能当前已关闭", 503);
  }
  const { listConsolidationProposals } = await import("@/lib/services/memoryConsolidationService");
  const proposals = await listConsolidationProposals(projectId);
  if (proposals.length === 0) return;
  const top = proposals[0];
  findings.push(finding({
    findingCode: "MEMORY_DUPLICATE_GROUP",
    severity: "INFO",
    objectType: "memory",
    objectId: top.proposalId,
    title: `发现 ${proposals.length} 组可能重复的记忆`,
    explanation: top.reason,
    suggestedAction: "查看建议保留与建议归档的记录，确认后整理",
    suggestedTarget: { kind: "memory", id: top.proposalId, fallback: "memory_timeline" },
  }, now));
};

const DETECTORS: Array<[string, Detector]> = [
  ["episodes", episodeDetector],
  ["state", stateDetector],
  ["actions", actionDetector],
  ["meetings", meetingDetector],
  ["attachments", attachmentDetector],
  ["deliverables", deliverableDetector],
  ["memory", memoryDetector],
  // 个人数据单独一组：按登录用户过滤，不与项目共享事实混为一条发现
  ["personal_schedule", personalScheduleDetector],
];

function buildGroups(findings: HealthFinding[]): HealthGroup[] {
  const order: HealthSeverity[] = ["ACTION_REQUIRED", "ATTENTION", "INFO"];
  const groups: HealthGroup[] = [];
  for (const severity of order) {
    const bucket = findings.filter((item) => item.severity === severity);
    if (bucket.length === 0) continue;
    groups.push({
      severity,
      count: bucket.length,
      findingCodes: [...new Set(bucket.map((item) => item.findingCode))],
    });
  }
  return groups;
}

/**
 * 生成只读体检报告。任何检测失败都只影响对应分组，不影响其余结果。
 */
export interface HealthViewer {
  /** 当前登录用户；个人提醒与个人排程只按它过滤，禁止用「全部成员」代替 */
  userId: string | null;
  now?: Date;
}

export async function buildProjectHealthReport(
  projectId: string,
  viewer: HealthViewer,
): Promise<ProjectHealthReport> {
  if (!isFeatureEnabled("PROJECT_HEALTH_ENABLED", true)) {
    throw Object.assign(new Error("项目体检功能当前已关闭"), { code: "PROJECT_HEALTH_DISABLED" });
  }
  const now = viewer.now ?? new Date();
  const context: DetectorContext = {
    projectId,
    now,
    viewerUserId: viewer.userId,
    findings: [],
    unavailable: [],
  };
  for (const [name, detector] of DETECTORS) {
    await runDetector(name, detector, context);
  }

  const findings = sortFindings(context.findings);
  const severityCounts: Record<HealthSeverity, number> = {
    ACTION_REQUIRED: findings.filter((item) => item.severity === "ACTION_REQUIRED").length,
    ATTENTION: findings.filter((item) => item.severity === "ATTENTION").length,
    INFO: findings.filter((item) => item.severity === "INFO").length,
  };
  const primaryAction = findings[0] ?? null;

  return {
    schemaVersion: HEALTH_SCHEMA_VERSION,
    projectId,
    generatedAt: now.toISOString(),
    findings,
    severityCounts,
    groups: buildGroups(findings),
    primaryAction,
    primaryMessage: primaryAction
      ? primaryAction.suggestedAction
      : "当前没有需要立即处理的问题",
    unavailable: context.unavailable,
    readOnly: true,
  };
}
