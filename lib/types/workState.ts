/**
 * Display of original work, never an execution state or authorization.
 *
 * 一条只读投影，供 Focus、详情、摘要、读回与工作包共用；客户端不另算 phase 或主动作。
 * 原生命周期、停止请求、观察结论与未结算 UNKNOWN 效果是四个并列事实：
 * 先保留它们，再由投影决定显示，不用一个互斥标签抹掉另一个事实。
 */

/** 终态事实。phase 都是 COMPLETED 时，取消与成功必须靠这里及 reasonCode 区分。 */
export type WorkStateTerminal = {
  status: "SUCCEEDED" | "CANCELLED";
  /** 原终态时间；取 finishedAt，缺失时才退回 updatedAt，两者都缺为 null。 */
  at: string | null;
  /** NO_TIME 明确表示原记录没有可用的终态/修订时间，不用 UPDATED_AT 伪装。 */
  atSource: "FINISHED_AT" | "UPDATED_AT" | "NO_TIME";
  reasonCode: "SUCCEEDED" | "CANCELLED";
};

/** 尚未结算的原请求/外部效果。读取只展示，不会核销；只有重查原请求才能结算。 */
export type WorkStateUnsettledEffect = {
  present: boolean;
  code: string | null;
  source: "LAST_ERROR" | "STEP" | "NONE";
  reasonText: string | null;
  /** 读取或刷新不改变结算事实。 */
  resolvedByRead: false;
};

export type WorkStateStopRequestState =
  | "NONE"
  | "PAUSE_REQUESTED"
  | "CANCEL_REQUESTED"
  | "PAUSE_SETTLED"
  | "CANCEL_SETTLED";

/** 用户停止请求维度：已收到请求不等于已经停止完成，也不等于可以继续派发。 */
export type WorkStateStopRequest = {
  state: WorkStateStopRequestState;
  requestedAt: string | null;
  settled: boolean;
  note: string | null;
};

export type WorkState = {
  phase: "QUEUED" | "RUNNING" | "WAITING_OBSERVATION" | "WAITING_USER" | "WAITING_APPROVAL" | "PAUSED" | "FAILED" | "UNKNOWN" | "COMPLETED" | "UNAVAILABLE";
  nextActor: "USER" | "AGENT" | "SYSTEM" | "UNKNOWN" | "NONE";
  requiresUser: boolean;
  reasonCode: string;
  reasonText: string;
  actionLabel: string;
  originalRef: { kind: "MISSION"; id: string; version: number };
  exactQuestionRef: string | null;
  exactApprovalRef: string | null;
  /** 本次读取时间；每次 GET 前进，不能被当作成功观察时间。 */
  checkedAt: string;
  /** 最近一次成功观察时间，只来自 delegation.lastObservedAt；读取/刷新绝不推进。 */
  observedAt: string | null;
  nextCheckAt: string | null;
  nextBoundary: string | null;
  freshness: "FRESH" | "PARTIAL" | "UNAVAILABLE";
  /** 增量可选字段：旧缓存/旧后端缺字段时保持 undefined；新服务端总是输出。 */
  terminal?: WorkStateTerminal | null;
  unsettledEffect?: WorkStateUnsettledEffect | null;
  stopRequest?: WorkStateStopRequest;
};
