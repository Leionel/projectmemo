export type ProjectSprint = {
  id: string; missionId: string; objective: string; startedAt: string; endsAt: string;
  status: "ACTIVE" | "ENDED" | "ELAPSED"; selfReportedDone: boolean;
  agent: { working: boolean; label: string; completedSteps: number; newOutputs: number; latestRevision: number | null };
};
export type SprintView = { canStart: boolean; reason: string; session: ProjectSprint | null };
