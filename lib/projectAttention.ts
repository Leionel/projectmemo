/** Presentation priority only; this never changes a Mission, reminder or action. */
export type ProjectFocusKind = "reminder" | "mission" | "deadline" | "action" | "capture";
export function selectProjectFocus(missionStatus: string, severity: number, deadlineRank: number, hasAction: boolean): ProjectFocusKind {
  if (severity >= 4) return "reminder";
  if (["WAITING_INPUT", "WAITING_APPROVAL", "PAUSED", "FAILED"].includes(missionStatus)) return "mission";
  if (deadlineRank >= 3) return "deadline";
  if (["READY", "RUNNING"].includes(missionStatus)) return "mission";
  if (hasAction) return "action";
  if (severity > 0) return "reminder";
  return "capture";
}
