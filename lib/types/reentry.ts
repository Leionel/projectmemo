/**
 * R2 60 秒再入场契约：App、鸿蒙桌面卡片与小艺共用的只读聚合。
 * 只聚合，不另存一份项目事实；每个子部分都带观察时间与新鲜度，
 * 局部服务失败时保留上次有效数据并如实标注，不伪造空项目。
 */

export type ReentryPrimaryAction = "VIEW_CHANGES" | "ADD_EVIDENCE" | "RESOLVE_BLOCKED" | "START_ACTION";

export type ReentrySectionStatus = "OK" | "EMPTY" | "STALE" | "FAILED";

/** 顶层新鲜度由子状态推导，不写死为 FRESH */
export type ReentryFreshness = "FRESH" | "STALE" | "EMPTY" | "FAILED";

export interface ReentrySectionMeta {
  status: ReentrySectionStatus;
  observedAt: string | null;
  errorCode: string | null;
  message: string | null;
}

export interface ReentryEpisodePart {
  episodeId: string | null;
  revisionId: string | null;
  /** 当前版本号 Vn */
  revision: number | null;
  title: string | null;
  /** 当前有效结论/重点摘要；无检查点时为 null */
  keyConclusion: string | null;
  /** 是否为历史版本（非最新已发布，或已失效被新进展替代） */
  isHistorical: boolean;
  /** 已确认检查点的确认时间 */
  confirmedAt: string | null;
  status: string | null;
  /** 冻结来源数量 */
  sourceCount: number;
  /** 已确认检查点之后的简述；无变化时为空数组，不编造进展 */
  changesSince: string[];
  meta: ReentrySectionMeta;
}

export interface ReentryRiskPart {
  /** 最大风险或未知；没有已确认风险时为 null */
  text: string | null;
  severity: "HIGH" | "MEDIUM" | "LOW" | null;
  entityId: string | null;
  /** 明确区分风险类型：受阻（待办前置阻塞）、信息不足（未知/证据缺失）、评估风险（风险项） */
  kind: "BLOCKED" | "UNKNOWN" | "RISK" | null;
  /** 若属于受阻待办，记录对应行动 ID */
  actionId: string | null;
  meta: ReentrySectionMeta;
}

export interface ReentrySchedulePart {
  planId: string | null;
  blockId: string | null;
  actionId: string | null;
  actionTitle: string | null;
  start: string | null;
  end: string | null;
  status: string | null;
  /** 该时段的系统日历同步状态；未开启同步时为 NONE */
  calendarStatus: string | null;
  meta: ReentrySectionMeta;
}

export interface ReentryData {
  projectId: string;
  projectName: string;
  freshness: ReentryFreshness;
  episode: ReentryEpisodePart;
  risk: ReentryRiskPart;
  schedule: ReentrySchedulePart;
  primaryAction: ReentryPrimaryAction;
  primaryMessage: string;
  /** 主操作直达的目标实体 ID（如 actionId、episodeId、cardId 等），便于前端精确定位 */
  primaryTargetId: string | null;
  generatedAt: string;
}
