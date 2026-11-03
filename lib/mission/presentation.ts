/** Presentation only. State transitions and permissions belong to Mission services. */
export const missionStatusLabels: Record<string, string> = {
  READY: "等待执行", RUNNING: "正在执行", WAITING_INPUT: "等待补充信息",
  WAITING_APPROVAL: "等待你的批准", PAUSED: "已暂停", FAILED: "执行失败",
  SUCCEEDED: "委托条件已验收", CANCELLED: "已取消",
};
export const missionToolLabels: Record<string, string> = {
  read_paper_metadata:"读取论文元数据",
  propose_metric_verification:"提交固定核算预览",
  inspect_experiment_metrics:"读取实验指标",compare_experiment_metrics:"比较实验条件与结果",
  inspect_document:"读取文档目录",read_document_page:"读取原文件页",read_document_section:"读取章节片段",read_document_table:"读取候选表格",
  inspect_project: "读取项目", search_memory: "检索项目记忆", web_search: "检索公开资料",
  web_fetch: "读取公开来源", save_mission_output: "保存草稿", propose_action: "提议行动", propose_calendar_event: "提出日历事件预览", propose_calendar_events: "提出批量日历事件预览",
  inspect_action: "读取行动", bind_project_sources: "选入补充材料",
};
export type MissionWorkspaceItem = {
  id: string; goal: string; status: string; version: number;
  workState?: import("@/lib/types/workState").WorkState; attention: string | null; activity: string | null; activityAt: string | null;
  outputRevision: number | null;
};
/**
 * 终态 + 未结算 UNKNOWN 的既有摘要找回窗口：增量可选字段，旧客户端忽略，不改变 items/totalActive 语义。
 * 只有“窗口内实际检查到的终态委托”才可能出现在 items；为空只表示本窗口未找到，不等于全库没有。
 */
export type MissionTerminalUnsettledSummary = {
  items: MissionWorkspaceItem[];
  /** 本次实际检查的本项目终态委托条数（按 updatedAt 倒序的有界窗口，可能为 limit 或 limit+1）。 */
  inspected: number;
  /** 单次检查窗口上限；items 不会超过 limit。 */
  limit: number;
  /** 窗口外仍有未检查的本项目终态委托：窗口内未找到不等于全库没有。 */
  truncated: boolean;
  note: string;
  identityNote: string;
};
export type MissionWorkspaceSummary = {
  enabled: boolean; totalActive: number; items: MissionWorkspaceItem[];
  /** 可选：终态委托中仍有未结算 UNKNOWN（lastErrorJson UNKNOWN 或原 Step UNKNOWN）的只读找回入口。 */
  terminalUnsettled?: MissionTerminalUnsettledSummary;
};

/** Read-only facets from existing criteria events, Output and adoption receipts. */
export type MissionCompletionSummary = {
  criteriaPassed: boolean | null;
  criteriaCheckedAt: string | null;
  draftVerification: string | null;
  adoptionCount: number;
  latestArtifactId: string | null;
  realityOutcome: "NOT_INFERRED";
};

export type MissionRecovery = {
  kind: string;
  automatic: boolean;
  message: string;
  attempt?: number;
  maxAttempts?: number;
  nextAttemptAt?: string;
};

export function missionErrorPhaseLabel(phase?: string): string {
  const labels: Record<string, string> = {
    CONTEXT: "准备上下文", DECISION: "模型决策", TOOL: "工具执行",
    VERIFY: "结果核验", COMMIT: "保存执行结果", APPROVAL: "批准与执行提交",
  };
  return phase ? labels[phase] ?? "执行阶段待确认" : "执行阶段未记录";
}

export function missionCompletionFacts(status: string, completion?: MissionCompletionSummary, draftVerification?: string): Array<{ label: string; value: string }> {
  const verification = completion?.draftVerification ?? draftVerification;
  return [
    { label: "执行条件", value: completion?.criteriaPassed === true ? "已通过本委托设定的条件" : completion?.criteriaPassed === false ? "条件未通过，请核对执行记录" : status === "SUCCEEDED" ? "已验收，明细待读取" : "尚未完成条件验收" },
    { label: "草稿核验", value: verification ? verification === "NEEDS_REVIEW" ? "待审阅，尚未整体核验" : `核验状态待核对（${verification}）` : "尚无已保存草稿" },
    { label: "用户采纳", value: completion ? completion.adoptionCount > 0 ? `已确认归入 ${completion.adoptionCount} 份项目成果` : "尚未归入项目成果" : "采纳回执待读取" },
    { label: "现实完成", value: "未从委托状态推断，以实际行动回执为准" },
  ];
}
