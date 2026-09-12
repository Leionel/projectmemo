/** T1：会议状态变化契约。抽取可为规则或模型，但确认必须绑定预览版本，不能绕过。 */

export type MeetingChangeKind =
  | "DECISION_SUPERSEDE"
  | "ACTION_CREATE"
  | "DEADLINE_CHANGE"
  | "FACT_RECORD";

export interface MeetingTypedChange {
  /** 提案内稳定 ID：chg-1、chg-2 … */
  changeId: string;
  kind: MeetingChangeKind;
  status: "PROPOSED" | "NEEDS_CLARIFICATION";
  /** 用户可读的摘要 */
  title: string;
  /** 确认后写入的具体内容 */
  detail: string;
  /** 原文片段，逐项可追溯 */
  evidenceSpan: string;
  supersededCardId: string | null;
  supersededCardTitle: string | null;
  /** 歧义候选卡片（同名/相近标题），确认前必须消除歧义 */
  candidateCardIds: string[];
  actionTitle: string | null;
  deadlineRaw: string | null;
  deadlineISO: string | null;
  clarification: string | null;
}

export interface MeetingImpactPreview {
  proposalId: string;
  projectId: string;
  baseSnapshotId: string;
  proposalVersion: number;
  sourceTextHash: string;
  meetingDate: string | null;
  extractor: "rules";
  typedChanges: MeetingTypedChange[];
  summary: string;
}

export interface MeetingConfirmResult {
  proposalId: string;
  applied: Array<{
    changeId: string;
    kind: MeetingChangeKind;
    newCardId: string | null;
    newActionId: string | null;
    supersededCardId: string | null;
    deadlineISO: string | null;
  }>;
  /** 确认后刷新出的新快照，用于“会后 Diff”（from = baseSnapshotId） */
  afterSnapshotId: string | null;
  alreadyConfirmed: boolean;
}
