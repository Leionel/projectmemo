export type ChallengeKind = "EVIDENCE" | "REHEARSAL" | "METRIC";
export type ChallengeOption = { key: string; label: string; sourceKey?: string };
export type ChallengeQuestion = { key: string; title: string; excerpt: string; options: ChallengeOption[] };
export type ChallengeAnswer = { questionKey: string; text: string; selected: string[]; verdict: "LINK_MATCH" | "REVIEW" | "OPEN";
  /** REHEARSAL 可选：回答引用的本轮来源（id@hash）。旧客户端不发送时为空。 */
  evidenceKeys?: string[] };
export type ChallengeSession = {
  schemaVersion: 1; id: string; missionId: string; outputId: string; revision: number; kind: ChallengeKind;
  status: "ACTIVE" | "COMPLETED" | "STOPPED" | "STALE"; reason: string | null;
  questions: ChallengeQuestion[]; answers: ChallengeAnswer[]; sourceKeys: string[]; openedSourceKeys: string[];
  handoffSourceId: string | null; handoffAt?: string | null; createdAt: string;
  retentionDays?: number; logicalDeletionNote?: string;
};
