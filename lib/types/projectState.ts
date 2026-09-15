/**
 * R2/S1 项目状态快照契约（版本化）。
 * schemaVersion 变化必须同时升级 policyVersion；旧版本快照保留为历史，不做自动迁移。
 * 本文件只描述数据形状；构建与比较逻辑在 lib/projectState/*。
 */

export const PROJECT_STATE_SCHEMA_VERSION = 1;
// v2：E1 修复后快照事实结论由统一 Ledger 计算；v1 行保留为历史，跨版本比较要求重建基线
export const PROJECT_STATE_POLICY_VERSION = "2";
export const PROJECT_STATE_DIFF_ALGORITHM_VERSION = "1";
export const PROJECT_STATE_BRIEF_TEMPLATE_VERSION = "1";

export type ProjectHealth = "AT_RISK" | "ON_TRACK" | "UNKNOWN";

export type ProjectStateFreshnessStatus = "EMPTY" | "FRESH" | "STALE" | "FAILED";

export interface ProjectStateFreshnessData {
  projectId: string;
  status: ProjectStateFreshnessStatus;
  snapshotId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attemptedAt: string | null;
  refreshedAt: string | null;
}

/** 结论支持程度：作用于具体事实句，不把 UNKNOWN 默认为 FALSE */
export type SnapshotTruth = "TRUE" | "FALSE" | "UNKNOWN";

export interface SnapshotEvidenceRef {
  /** 实体种类 + 项目内 ID + 源字段 + 观察时间 + 内容摘要哈希；只保留 ID 不足以审计 */
  entityKind: "card" | "action" | "deliverable" | "attachment";
  entityId: string;
  field: string;
  observedAt: string;
  contentHash: string;
}

/** facts 稳定键：decision:<cardId>；一条记录一个键 */
export interface SnapshotFact {
  key: string;
  text: string;
  truth: SnapshotTruth;
  temporalStatus: string;
  temporalState?: "CURRENT" | "SUPERSEDED" | "CONTESTED" | "UNKNOWN";
  reasonCode?: string;
  displayReason?: string;
  evidenceRefs: SnapshotEvidenceRef[];
  ruleId: string;
}

export interface SnapshotActionState {
  actionId: string;
  title: string;
  recordedStatus: string;
  resultCardId: string | null;
  evidenceRefs: SnapshotEvidenceRef[];
}

export interface SnapshotGap {
  deliverableId: string;
  missingEvidenceTypes: string[];
  truth: SnapshotTruth;
  evidenceRefs: SnapshotEvidenceRef[];
}

export interface SnapshotRisk {
  stableKey: string;
  text: string;
  truth: SnapshotTruth;
  severity: "HIGH" | "MEDIUM" | "LOW";
  evidenceRefs: SnapshotEvidenceRef[];
  ruleId: string;
}

export interface SnapshotUnknown {
  predicate: string;
  text: string;
  missingInputs: string[];
  suggestedInputAction: string;
}

export interface ProjectStatePayload {
  snapshotId: string;
  projectId: string;
  schemaVersion: number;
  policyVersion: string;
  evaluatedAt: string;
  goal: string | null;
  deadline: string | null;
  stage: string | null;
  health: ProjectHealth;
  facts: SnapshotFact[];
  actions: SnapshotActionState[];
  gaps: SnapshotGap[];
  risks: SnapshotRisk[];
  unknowns: SnapshotUnknown[];
}

/** buildSnapshot 的输入：从数据库读出的规范化源数据（不含任何 LLM 产物） */
export interface SnapshotSourceInput {
  projectId: string;
  goal: string | null;
  deadline: string | null;
  cards: Array<{
    id: string;
    title: string;
    summary: string;
    createdAt: string;
  }>;
  relations: Array<{
    id: string;
    relationType: string;
    reason: string;
    confirmed: boolean;
    confirmedAt: string | null;
    revokedAt: string | null;
    validFrom?: string | null;
    validTo?: string | null;
    createdAt?: string;
    currentCardId: string;
    relatedCardId: string;
    counterpartTitle: string;
  }>;
  actions: Array<{
    id: string;
    title: string;
    status: string;
    resultCardId: string | null;
    completedAt: string | null;
    dueAt: string | null;
  }>;
  deliverables: Array<{
    id: string;
    expectedEvidenceTypes: string[];
    confirmedEvidenceTypes: string[];
  }>;
  now: string;
}

/** 纯函数构建产物：不含 snapshotId（服务层落库后回填） */
export interface BuiltProjectState extends Omit<ProjectStatePayload, "snapshotId"> {
  sourceHash: string;
  contentHash: string;
  evaluationKey: string;
}

// ---- Diff ----

export type StateDiffKind = "ADDED" | "CHANGED" | "RESOLVED" | "REGRESSED" | "UNCERTAIN";

export interface StateDiffItem {
  /** 稳定变化键，例如 decision:<cardId>:validity、action:<id>:status */
  changeKey: string;
  kind: StateDiffKind;
  /** 面向用户的确定性描述 */
  summary: string;
  before: string | null;
  after: string | null;
  evidenceRefs: SnapshotEvidenceRef[];
}

// ---- C1：变化简报（确定性模板，逐句携带 changeKey 与证据数量；读简报不创建行动） ----

export interface ChangeBriefEvidence {
  entityKind: string;
  entityId: string;
  field: string;
  observedAt: string;
  contentHash: string;
}

export interface ChangeBriefSentence {
  changeKey: string;
  kind: StateDiffKind;
  /** 变化 */
  text: string;
  /** 影响 */
  impact: string;
  /** 建议 */
  suggestion: string;
  evidenceCount: number;
  /** 可点开的证据引用（实体种类 + 项目内 ID） */
  evidence: ChangeBriefEvidence[];
}

export interface ProjectChangeBrief {
  fromSnapshotId: string;
  toSnapshotId: string;
  templateVersion: string;
  materialChange: boolean;
  headline: string;
  sentences: ChangeBriefSentence[];
  generatedAt: string;
}

export interface ProjectStateDiff {
  fromSnapshotId: string;
  toSnapshotId: string;
  algorithmVersion: string;
  materialChange: boolean;
  summary: string;
  items: StateDiffItem[];
}
