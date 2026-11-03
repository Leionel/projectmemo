/**
 * 冻结的四问工作包合同：final-a-workpacket-v1 / schemaVersion 1。
 *
 * 它只是原 Mission 已存在事实的只读组合，不新增生命周期、授权或执行器：
 * - done：已经做了什么（原 Step/Output/Action/回执，有界窗口）。
 * - basis：依据是什么（原 materialUses/evidenceReviews 与 SourcePolicy 判定）。
 * - stopped：为何停下（原 WorkState 与未结算效果/停止请求/阻断展开）。
 * - next：现在由谁做哪一步（唯一主操作 + 全量版本要求 + 服务端重查守卫）。
 *
 * 另有 identity/snapshot/authority/observations/blockers/coverage：身份与同一快照版本、
 * 责任许可的有界展示（只读、不是第二授权）、观察时间窗口、阻断展开与查询覆盖说明。
 * 可空字段与缺失字段含义不同：本服务输出必须显式给 null（如 lastSuccessfulAt），
 * 缺失（`?`）只用于旧后端尚未提供整个 workPacket 或该增量字段的情形。
 * 读取本包不会核销 UNKNOWN、不会推进成功观察时间、不会授予任何写入资格。
 */
import type { WorkState, WorkStateStopRequest, WorkStateTerminal, WorkStateUnsettledEffect } from "@/lib/types/workState";
import type { MaterialUseProjection } from "@/lib/mission/materialUseProjection";
import type { reviewProgressOf } from "@/lib/mission/reviewProgress";

export const WORK_PACKET_SCHEMA_VERSION = 1 as const;
export const WORK_PACKET_CONTRACT_VERSION = "final-a-workpacket-v1" as const;

export type WorkPacketSchemaVersion = typeof WORK_PACKET_SCHEMA_VERSION;
export type WorkPacketContractVersion = typeof WORK_PACKET_CONTRACT_VERSION;

/** 原 Mission 身份与同一读取快照的版本组合。 */
export type WorkPacketOriginalRef = { kind: "MISSION"; id: string; version: number };
export type WorkPacketIdentity = {
  missionId: string;
  projectId: string;
  missionVersion: number;
  /** 原生命周期字符串原样保留（不新增第二套枚举）。 */
  missionStatus: string;
  planRevision: number;
  contextVersion: number;
  constraintsVersion: number;
  researchScopeVersion: number;
  controlVersion: string | null;
  originalRef: WorkPacketOriginalRef;
};

/** 同一只读事务/快照的说明；版本推进时不得静默混用新旧事实。 */
export type WorkPacketSnapshotConsistency = "VERSION_STABLE" | "RETRIED" | "VERSION_ADVANCED";
export type WorkPacketSnapshot = {
  mode: "SINGLE_READ_TRANSACTION";
  consistency: WorkPacketSnapshotConsistency;
  retries: number;
  checkedAt: string;
  note: string;
};

/**
 * 责任/权限摘要的有界展示块：来自原 readMissionResponsibility 摘要输入。
 * 只做展示与主操作判定，不产生执行资格（note 固定 VIEW_ONLY_NO_EXECUTION_PERMISSION）；
 * 真正提交仍由原服务重查 owner/项目/版本/来源/权限/lease/预算与幂等。
 */
export type WorkPacketAuthority = {
  /** 原 controlVersion；null 表示旧服务/摘要缺失，不填 "" 冒充有效哈希。 */
  controlVersion: string | null;
  permissionState: "WITHIN_TIME_BOUNDARY" | "EXPIRED" | "STOPPED" | "UNKNOWN";
  permissionExpiresAt: string | null;
  deadline: string | null;
  /** 原责任/审批/lease/个人记忆等有效边界的最早时刻。 */
  nextBoundary: string | null;
  effectiveNextCheckAt: string | null;
  /** 原 workerPresence.status；心跳不代表成功观察。 */
  workerPresence: string;
  budget: {
    limits: Record<string, number>;
    /** 只展示原累计计数；null 表示该计数未知，不补 0、不因重启/跨日重置。 */
    cumulativeUsed: Record<string, number | null>;
    policy: "CUMULATIVE_NOT_RESET_ON_RESTART_OR_DATE";
    monetaryCost: null;
  };
  note: "VIEW_ONLY_NO_EXECUTION_PERMISSION";
};

/** 观察维度：读取时间、成功观察、失败观察与“无变化”结论分开。 */
export type WorkPacketObservationState = "OBSERVED" | "NOT_OBSERVED" | "FAILED_LAST";
export type WorkPacketObservations = {
  /** 本次读取时间；刷新只推进它，不推进 lastSuccessfulAt。 */
  readAt: string;
  state: WorkPacketObservationState;
  /** 最近一次成功观察时间；真实 null 必须出现，表示没有成功观察记录。 */
  lastSuccessfulAt: string | null;
  /** 最近一次失败观察时间；真实 null 必须出现。 */
  lastFailedAt: string | null;
  /** 最近一次“无新变化”观察结论时间；真实 null 必须出现，null 不等于无变化。 */
  lastNoNewInformationAt: string | null;
  nextCheckAt: string | null;
  authority: "ORIGINAL_DELEGATION_RECORDS_ONLY";
};

/** 原 MaterialUseProjection 的当前可用性增量（SourcePolicy）；旧服务缺失时不能推断“当前可用”。 */
export type WorkPacketMaterialCurrentUse = {
  state: "ALLOWED" | "SUPPRESSED" | "UNKNOWN";
  independentEvidence: boolean;
  reason: string;
  policy: string;
  checkedAt: string;
  appliesTo: "CURRENT_USE_ONLY";
};
type MaterialUseItemBase = MaterialUseProjection["items"][number];
export type WorkPacketMaterialUseItem = Omit<MaterialUseItemBase, "currentUse" | "availabilityMeaning"> & {
  /** 当前是否允许继续作为依据；缺省只表示旧服务/未应用来源策略，不能当作允许。 */
  currentUse?: WorkPacketMaterialCurrentUse | null;
  /** availability=CURRENT 只说明版本匹配；该文案说明它不等于当前可用或独立证据。 */
  availabilityMeaning?: string | null;
};
/** 复用原 MaterialUseProjection 形状，只叠加 currentUse/availabilityMeaning 增量。 */
export type WorkPacketMaterialUses = Omit<MaterialUseProjection, "items"> & {
  items: WorkPacketMaterialUseItem[];
};

export type WorkPacketEvidenceReviewItem = {
  eventId: string;
  observedAt: string;
  fitHash: string | null;
  fitStatus: string | null;
  ruleVersion: string | null;
  truthVerified: false;
};
export type WorkPacketEvidenceReviews = {
  items: WorkPacketEvidenceReviewItem[];
  truncated: boolean;
};

export type WorkPacketProgress = ReturnType<typeof reviewProgressOf>;

export type WorkPacketStep = {
  id: string;
  ordinal: number;
  toolName: string;
  status: string;
  /** 原 Step 完成时间；null 表示尚未完成或旧记录无时间。 */
  at: string | null;
  /** 确定性文案（原工具/状态标签），不是模型重写的摘要。 */
  note: string | null;
};
export type WorkPacketOutputRef = {
  id: string;
  revision: number;
  createdAt: string | null;
};
export type WorkPacketActionReceipt = {
  actionId: string;
  title: string | null;
  status: string;
  resultCardId: string | null;
  completedAt: string | null;
  isSimulated: boolean;
};
/** done 只覆盖 recentSteps 的有界窗口；其他窗口见顶层 coverage。 */
export type WorkPacketDoneCoverage = { limit: number; truncated: boolean };
export type WorkPacketDone = {
  recentSteps: WorkPacketStep[];
  latestOutput: WorkPacketOutputRef | null;
  progress: WorkPacketProgress | null;
  actionReceipts: WorkPacketActionReceipt[];
  note: string;
  coverage: WorkPacketDoneCoverage;
};

/** 依据维度：当前可用 ≠ 历史留痕，也 ≠ 独立支持。 */
export type WorkPacketBasis = {
  questionId: string | null;
  materialUses: WorkPacketMaterialUses | null;
  evidenceReviews: WorkPacketEvidenceReviews | null;
  currentUsePolicy: "SOURCE_POLICY_APPLIED" | "NOT_APPLIED";
  note: string;
};

export type WorkPacketTargetKind = "MISSION" | "QUESTION" | "APPROVAL" | "OUTPUT" | "ACTION" | "SOURCE";
export type WorkPacketOriginalObjectRef = {
  kind: WorkPacketTargetKind;
  id: string;
};
export type WorkPacketTarget = {
  kind: WorkPacketTargetKind;
  id: string;
  version: number | null;
};

export type WorkPacketPrimaryActionKind =
  | "ANSWER_QUESTION"
  | "REVIEW_APPROVAL"
  | "RESUME_DELEGATION"
  | "RECHECK_AUTHORITY"
  | "CHECK_UNKNOWN_EFFECT"
  | "CHECK_STOP_SETTLEMENT"
  | "WAIT_FOR_OBSERVATION"
  | "REVIEW_FAILURE"
  | "VIEW_RESULT"
  | "NONE";

export type WorkPacketSubmissionGuard = "SERVER_RECHECKS_OWNER_PROJECT_VERSION_SOURCE_PERMISSION_LEASE_BUDGET_IDEMPOTENCY";

/** 提交时由服务端重查的版本要求；读取本身不授予执行/写入资格。 */
export type WorkPacketRequires = {
  missionVersion: number;
  planRevision: number;
  contextVersion: number;
  constraintsVersion: number;
  researchScopeVersion: number;
  controlVersion: string | null;
  questionId: string | null;
  approvalId: string | null;
  proposalHash: string | null;
  requiredSourceRevisions: string[];
  boundaryAt: string | null;
};

export type WorkPacketPrimaryAction = {
  kind: WorkPacketPrimaryActionKind;
  label: string;
  /** 指向原对象；版本为 null 表示原问题/审批不以版本号定位。 */
  target: WorkPacketTarget | null;
  requires: WorkPacketRequires;
  submissionGuard: WorkPacketSubmissionGuard;
  readOnly: true;
};

export type WorkPacketBlockerKind =
  | "AUTHORITY"
  | "WORK_STATE"
  | "STOP_REQUEST"
  | "BUDGET"
  | "SOURCE"
  | "APPROVAL"
  | "QUESTION"
  | "LEASE"
  | "UNKNOWN_EFFECT"
  | "FAILURE"
  | "DELEGATION"
  | "TIME_BOUNDARY";

/** 一项阻断事实；所有阻断都保留展开，不只留主动作那一个。 */
export type WorkPacketBlocker = {
  kind: WorkPacketBlockerKind;
  code: string;
  text: string;
  at: string | null;
  blocksActions: boolean;
  originalRef: WorkPacketOriginalObjectRef | null;
};

export type WorkPacketUnknownEffect = WorkStateUnsettledEffect;
export type WorkPacketStopRequest = WorkStateStopRequest;

/** 停下维度：生命周期、停止请求、未结算效果与阻断并列，不用一个显示状态覆盖另一个。 */
export type WorkPacketStopped = {
  workState: WorkState;
  missionStatus: string;
  primaryBlock: WorkPacketBlocker | null;
  blockers: WorkPacketBlocker[];
  unknownEffect: WorkPacketUnknownEffect | null;
  stopRequest: WorkPacketStopRequest | null;
  note: string;
};

export type WorkPacketWaitingOn =
  | "USER_INPUT"
  | "USER_APPROVAL"
  | "USER_RECHECK"
  | "SYSTEM_WORKER"
  | "SYSTEM_SETTLEMENT"
  | "SYSTEM_OBSERVATION"
  | "SYSTEM_LEASE"
  | "SYSTEM_RECHECK"
  | "BUDGET_RESET"
  | "NONE";

export type WorkPacketNext = {
  nextActor: WorkState["nextActor"];
  primaryAction: WorkPacketPrimaryAction | null;
  nextCheckAt: string | null;
  nextBoundary: string | null;
  waitingOn: WorkPacketWaitingOn;
  note: string;
};

export type WorkPacketCoverageWindow = {
  name: string;
  limit: number;
  returned: number;
  truncated: boolean;
  note: string;
};
export type WorkPacketCoverage = {
  windows: WorkPacketCoverageWindow[];
  /** “未找到记录”只说明有界窗口覆盖不足，不等于“从未发生/从未使用/没有变化”。 */
  policy: "NOT_FOUND_IS_NOT_NEVER";
};

/** 四问工作包冻结 DTO。 */
export type WorkPacket = {
  schemaVersion: WorkPacketSchemaVersion;
  contractVersion: WorkPacketContractVersion;
  readAt: string;
  identity: WorkPacketIdentity;
  snapshot: WorkPacketSnapshot;
  authority: WorkPacketAuthority;
  observations: WorkPacketObservations;
  done: WorkPacketDone;
  basis: WorkPacketBasis;
  stopped: WorkPacketStopped;
  next: WorkPacketNext;
  blockers: WorkPacketBlocker[];
  coverage: WorkPacketCoverage;
  /** 工作包只是投影：不推断现实目标是否达成。 */
  realityOutcome: "NOT_INFERRED";
};

/** 旧后端响应没有 workPacket 时，客户端退回原详情而不伪造成功事实。 */
export type WorkPacketOptionalDelta = { workPacket?: WorkPacket };
