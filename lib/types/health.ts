/**
 * 项目体检契约。
 *
 * 这是只读、确定性的「检查项目当前问题」：服务端聚合已有事实，逐条列出
 * 可解释的问题与修复入口。它不训练模型、不做主观打分，也绝不产生业务写入。
 *
 * 刻意不提供「健康度 87 分」这种缺乏定义的综合评分：只用问题数量与分组表达规模，
 * 每个问题都能跳转到修复入口。
 */

export const HEALTH_SCHEMA_VERSION = 1;

/** 严重度只表达「要不要马上处理」，不折算成分数 */
export type HealthSeverity = "ACTION_REQUIRED" | "ATTENTION" | "INFO";

export type HealthObjectType =
  | "episode"
  | "project_state"
  | "action"
  | "attachment"
  | "card"
  | "deliverable"
  | "reminder"
  | "meeting"
  | "memory";

export type HealthFindingCode =
  | "EPISODE_MISSING"
  | "EPISODE_STALE"
  | "EPISODE_PARTIALLY_STALE"
  | "EPISODE_UNSOURCED_CLAIM"
  | "EPISODE_OPEN_QUESTION"
  | "STATE_NEVER_REFRESHED"
  | "STATE_STALE"
  | "STATE_REFRESH_FAILED"
  | "STATE_LONG_UNREFRESHED"
  | "ACTION_BLOCKED"
  | "ACTION_UNKNOWN"
  | "ACTION_MISSING_ESTIMATE"
  | "ACTION_OVERDUE"
  | "ACTION_SCHEDULED_NOT_STARTED"
  | "ACTION_CALENDAR_SYNC_FAILED"
  | "MEETING_CHANGES_UNAPPROVED"
  | "ATTACHMENT_EXTRACTION_FAILED"
  | "MEMORY_DUPLICATE_GROUP"
  | "DELIVERABLE_EVIDENCE_MISSING"
  | "REMINDER_NEEDS_ATTENTION";

/** 修复入口：界面据此跳转，不猜目标 */
export interface HealthSuggestedTarget {
  /** 页面内锚点标识，由客户端映射到具体路由 */
  kind: "episode" | "action" | "state" | "attachment" | "card" | "deliverable" | "reminder" | "meeting" | "memory";
  id: string | null;
  /** 需要用户补充信息时指向记录入口 */
  fallback?: "record" | "action_board" | "memory_timeline" | "inbox" | null;
}

export interface HealthFinding {
  findingCode: HealthFindingCode;
  severity: HealthSeverity;
  objectType: HealthObjectType;
  objectId: string;
  title: string;
  explanation: string;
  observedAt: string;
  /** 一条可直接执行的中文动作描述 */
  suggestedAction: string;
  suggestedTarget: HealthSuggestedTarget;
}

/** 子检查失败时如实标注哪一部分暂不可用，其余已知结果照常返回 */
export interface HealthUnavailableSection {
  section: string;
  errorCode: string;
  message: string;
}

export interface HealthGroup {
  severity: HealthSeverity;
  count: number;
  findingCodes: HealthFindingCode[];
}

export interface ProjectHealthReport {
  schemaVersion: number;
  projectId: string;
  generatedAt: string;
  findings: HealthFinding[];
  severityCounts: Record<HealthSeverity, number>;
  groups: HealthGroup[];
  /** 唯一一个「建议先处理」；没有任何问题时为 null */
  primaryAction: HealthFinding | null;
  primaryMessage: string;
  unavailable: HealthUnavailableSection[];
  /** 该接口只读，不产生业务写入、行动或检查点 */
  readOnly: true;
}

export const HEALTH_SEVERITY_LABEL: Record<HealthSeverity, string> = {
  ACTION_REQUIRED: "需要马上处理",
  ATTENTION: "需要留意",
  INFO: "供参考",
};
