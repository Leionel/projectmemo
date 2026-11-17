export type SprintReceipt = { id: string; label: string; at: string; kind: "STEP" | "OUTPUT" };
export type ProjectSprint = {
  id: string; missionId: string; objective: string; startedAt: string; endsAt: string;
  status: "ACTIVE" | "ENDED" | "ELAPSED"; selfReportedDone: boolean;
  agent: {
    working: boolean; label: string; completedSteps: number; newOutputs: number; latestRevision: number | null;
    /** 本轮内真实保存的最新一版；没有保存回执时为 null，不显示“打开新稿”。 */
    latestNewRevision: number | null; latestNewOutputAt: string | null;
    /** 本轮内成功的步骤与保存回执，按时间正序；用于“读取资料/整理依据/保存新稿”轨迹。 */
    receipts: SprintReceipt[];
    /** 本轮内实际打开过的来源数（来自持久 CHALLENGE_SOURCE_OPENED 事件）。 */
    openedSources: number;
    /** 本轮新稿里记录的待判断项；没有则不编造。 */
    openItems: string[];
  };
};
export type SprintView = { canStart: boolean; reason: string; session: ProjectSprint | null };
