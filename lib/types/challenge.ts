export type ChallengeKind = "EVIDENCE" | "REHEARSAL";
export type ChallengeOption = { key: string; label: string; sourceKey?: string };
export type ChallengeQuestion = { key: string; title: string; excerpt: string; options: ChallengeOption[] };
export type ChallengeAnswer = { questionKey: string; text: string; selected: string[]; verdict: "LINK_MATCH" | "REVIEW" | "OPEN" };
export type ChallengeSession = {
  schemaVersion: 1; id: string; missionId: string; outputId: string; revision: number; kind: ChallengeKind;
  status: "ACTIVE" | "COMPLETED" | "STOPPED" | "STALE"; reason: string | null;
  questions: ChallengeQuestion[]; answers: ChallengeAnswer[]; sourceKeys: string[]; openedSourceKeys: string[];
  handoffSourceId: string | null; createdAt: string;
};
