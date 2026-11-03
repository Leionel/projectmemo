/** Read projection shared by Web and ArkTS. No commands or synthetic progress. */
export type FocusEntry = {
  workState?:import("./workState").WorkState; actionLabel?:string; entityKind?:"MISSION"|"ACTION"|"INTERVENTION"|"PROJECT";
  id: string; projectId: string; projectTitle: string; title: string; detail: string;
  status: string; activity: string; activityAt: string; recordedAt: string; dueAt: string; projectDeadline: string; recordFields: Array<{label: string; value: string}>;
};
export type GlobalFocus = {
  coverage?:{
    complete:boolean;consideredProjectIds:string[];countsAreBounded:boolean;
    /**
     * 可选增量：终态 + 未结算 UNKNOWN 的有界窗口覆盖说明（旧客户端忽略）。
     * 非终态 waiting 窗口与终态 unsettled 窗口分别有界；窗口内未找到 ≠ 全库没有。
     */
    terminalUnsettled?:{inspected:number;limit:number;truncated:boolean;note:string};
  };
  discussions?: Array<{ conversationId: string; title: string; unread: number }>;
  primaryContext?: import("./projectAgentContext").ProjectAgentContext | null;
  counts: {waiting: number; running: number; actions: number; reminders: number};
  nextDeadline: {projectId: string; projectTitle: string; at: string} | null;
  schemaVersion: 1; missionEnabled: boolean; archived: boolean; hasMore: boolean;
  waiting: FocusEntry[]; running: FocusEntry[]; actions: FocusEntry[]; reminders: FocusEntry[]; records: FocusEntry[];
};
