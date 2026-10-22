/** Presentation only. State transitions and permissions belong to Mission services. */
export const missionStatusLabels: Record<string, string> = {
  READY: "等待执行", RUNNING: "正在执行", WAITING_INPUT: "等待补充信息",
  WAITING_APPROVAL: "等待你的批准", PAUSED: "已暂停", FAILED: "执行失败",
  SUCCEEDED: "委托条件已验收", CANCELLED: "已取消",
};
export const missionToolLabels: Record<string, string> = {
  inspect_project: "读取项目", search_memory: "检索项目记忆", web_search: "检索公开资料",
  web_fetch: "读取公开来源", save_mission_output: "保存草稿", propose_action: "提议行动",
  inspect_action: "读取行动", bind_project_sources: "选入补充材料",
};
export type MissionWorkspaceItem = {
  id: string; goal: string; status: string; version: number;
  attention: string | null; activity: string | null; activityAt: string | null;
  outputRevision: number | null;
};
export type MissionWorkspaceSummary = { enabled: boolean; totalActive: number; items: MissionWorkspaceItem[] };
