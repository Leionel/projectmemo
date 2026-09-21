/**
 * R2 阶段检查点契约（版本化）。
 * claims/sourceRefs 首版使用带 schemaVersion 的 JSON 存储；只有出现跨检查点
 * 查询、单句权限或独立生命周期需求时，才拆分独立表。
 */

export const EPISODE_SCHEMA_VERSION = 1;

export type EpisodeStatus = "DRAFT" | "PUBLISHED" | "PARTIALLY_STALE" | "STALE" | "ARCHIVED";
export type EpisodeRevisionStatus = "DRAFT" | "PUBLISHED";
export type EpisodeGenerationMode = "TEMPLATE" | "MODEL" | "MODEL_FALLBACK_TEMPLATE";

/** 内容类型：事实句必须可回溯，规则解释标注系统判断，建议不冒充已执行 */
export type EpisodeClaimKind = "FACT" | "RULE" | "SUGGESTION";

export type EpisodeSourceKind = "CARD" | "RELATION" | "ATTACHMENT_REVISION" | "ACTION_RESULT" | "SNAPSHOT";

export interface EpisodeSourceRef {
  refId: string;
  kind: EpisodeSourceKind;
  /** CARD/KnowledgeCard；RELATION/CardRelation；ATTACHMENT_REVISION/AttachmentRevision；ACTION_RESULT/行动完成结果卡；SNAPSHOT/ProjectStateSnapshot */
  entityId: string;
  /** 附件修订号或快照序号；卡片来源为 null */
  revisionIndex: number | null;
  observedAt: string;
  contentHash: string;
  /** 展示用摘要，冻结生成时的观察版本 */
  title: string;
  /** 冻结的正文摘要：来源后续被改写或删除时，仍能展示当时看到的内容 */
  summary: string;
}

export interface EpisodeClaim {
  claimId: string;
  kind: EpisodeClaimKind;
  section: EpisodeSection;
  text: string;
  /** FACT 必须至少引用一个 sourceRef，否则不能发布；RULE 附带规则标识 */
  sourceRefIds: string[];
  /** kind=RULE 时的规则标识，如 state.health_v2 */
  ruleCode?: string;
  /** kind=SUGGESTION 时的候选行动 */
  suggestedActionId?: string;
  suggestedReason?: string;
}

export type EpisodeSection = "GOALS" | "CONFIRMED_CHANGES" | "DECISION_TRAIL" | "COMPLETED_ACTIONS" | "OPEN_QUESTIONS" | "NEXT_STEPS";

export interface EpisodeSummary {
  schemaVersion: number;
  goals: string;
  /** 分节段落；模型只压缩语言不新增事实，失败时使用模板 */
  sections: Array<{ section: EpisodeSection; text: string }>;
}

export interface EpisodeUnresolvedItem {
  /** 争议/未知卡片或受阻行动的项目内 ID */
  entityId: string;
  entityKind: "card" | "action";
  title: string;
  reason: string;
}

/** 生成预览时的范围与排除说明；不静默截断 */
export interface EpisodeScopeReport {
  windowStart: string;
  windowEnd: string;
  baseSnapshotId: string | null;
  endSnapshotId: string | null;
  candidateCount: number;
  includedCount: number;
  excludedCount: number;
  excludedReasons: string[];
  contestedCount: number;
  unknownCount: number;
}

export interface EpisodeSourceState {
  refId: string;
  kind: EpisodeSourceKind;
  entityId: string;
  /** AVAILABLE | CHANGED | ARCHIVED | SUPERSEDED | REVOKED | CONTESTED | DELETED | POLICY_CHANGED */
  state: string;
  displayReason: string;
}

export interface EpisodeClaimFreshness {
  claimId: string;
  affected: boolean;
  reason: string;
}

export interface EpisodeFreshnessReport {
  status: "FRESH" | "PARTIALLY_STALE" | "STALE";
  affectedClaims: EpisodeClaimFreshness[];
  sources: EpisodeSourceState[];
  evaluatedAt: string;
}

export interface EpisodeRevisionData {
  id: string;
  episodeId: string;
  revision: number;
  baseSnapshotId: string | null;
  endSnapshotId: string | null;
  sourceHash: string;
  sourceRefs: EpisodeSourceRef[];
  claims: EpisodeClaim[];
  summary: EpisodeSummary;
  generationMode: EpisodeGenerationMode;
  provider: string | null;
  fallbackReason: string | null;
  status: EpisodeRevisionStatus;
  /** 用户确认时间；草稿为 null */
  confirmedAt: string | null;
  createdAt: string;
}

export interface EpisodeData {
  id: string;
  projectId: string;
  kind: string;
  title: string;
  windowStart: string;
  windowEnd: string;
  status: EpisodeStatus;
  createdAt: string;
  updatedAt: string;
  revisions: EpisodeRevisionData[];
  /** 仅详情返回：读取时重新评估的来源新鲜度，不写入历史 */
  freshness?: EpisodeFreshnessReport;
}
