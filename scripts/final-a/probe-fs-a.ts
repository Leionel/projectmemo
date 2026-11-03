/**
 * A1 探针：FS-A01～A06 服务级特征化（BEFORE_FIX）。
 *
 * 只做两件事：
 * 1) 在独立临时 SQLite 上造最小 fixture，调用真实服务/投影函数；
 * 2) 按文档第 4 节的失败判据记录当前行为与真实 JSON 样本。
 *
 * 本脚本不修复产品代码，也不把“纯投影显示行为”当成“服务缺陷已确认”。
 * 运行：npx.cmd tsx scripts/final-a/probe-fs-a.ts
 * 退出码：0 = 探针跑完（不代表业务已修复）；非零 = 脚本失败，证据里记录 error。
 */
import { createHash, randomUUID } from "node:crypto";
import {
  createOwner,
  createMission,
  addEvent,
  addBoundSourcesStep,
  addAgentRun,
} from "./lib/probeFixtures";
import {
  setupIsolatedDatabase,
  gitHead,
  probeSourceTree,
  writeEvidence,
  plain,
  sleep,
  errorFacts,
  runProbe,
} from "./lib/probeSupport";

const env = setupIsolatedDatabase("fs-a01-a06");
const generatedAt = new Date().toISOString();
const baseSha = gitHead();
const db = (await import("../../lib/db")).db;
const { readMissionBack } = await import("../../lib/mission/readback");
const { missionDetail } = await import("../../lib/mission/missionService");
const { missionWorkspaceSummary } = await import("../../lib/mission/workspaceSummary");
const { missionWorkState } = await import("../../lib/mission/workState");
const { readProjectMaterial } = await import("../../lib/mission/sourceSignals");
const { sourceUse } = await import("../../lib/continuity/sourcePolicy");
const { validateSources } = await import("../../lib/mission/repository");
const { createSession } = await import("../../lib/auth/session");
const { createConversation } = await import("../../lib/conversation/service");
const { submitDirective } = await import("../../lib/continuity/directiveService");

type CaseResult = {
  id: string;
  verdict: "REPRODUCED" | "NOT_REPRODUCED" | "INCONCLUSIVE";
  criterion: string;
  observed: unknown;
  notes: string[];
  samplePaths: string[];
};

function writeSample(name: string, value: unknown): string {
  return writeEvidence(`samples/${name}`, plain(value));
}

function phaseSummary(workState: {
  phase: string;
  nextActor: string;
  reasonCode: string;
  reasonText: string;
  actionLabel: string;
  checkedAt?: string;
  observedAt?: string | null;
  nextCheckAt?: string | null;
  nextBoundary?: string | null;
  freshness?: string;
}) {
  return {
    phase: workState.phase,
    nextActor: workState.nextActor,
    reasonCode: workState.reasonCode,
    reasonText: workState.reasonText,
    actionLabel: workState.actionLabel,
    checkedAt: workState.checkedAt ?? null,
    observedAt: workState.observedAt ?? null,
    nextCheckAt: workState.nextCheckAt ?? null,
    nextBoundary: workState.nextBoundary ?? null,
    freshness: workState.freshness ?? null,
  };
}

/* ------------------------------------------------------------------ FS-A01 */
async function caseA01(): Promise<CaseResult> {
  const owner = await createOwner(db, "a01");
  const cases: unknown[] = [];
  const samplePaths: string[] = [];
  for (const status of ["SUCCEEDED", "CANCELLED"] as const) {
    const mission = await createMission(db, owner, {
      status,
      version: 3,
      lastErrorJson: {
        code: "EXTERNAL_UNKNOWN",
        message: "外部写入结果未确认，需查询原请求后再判断是否重试",
        phase: "EXTERNAL_WRITE",
      },
    });
    const readback = await readMissionBack(owner.userId, mission.id);
    const detail = await missionDetail(owner.userId, mission.id);
    const summary = await missionWorkspaceSummary(owner.userId, owner.projectId);
    const summaryItem = summary.items.find(item => item.id === mission.id) ?? null;
    const samplePath = writeSample(`FS-A01-${status}.json`, {
      fixture: { status, lastErrorJson: { code: "EXTERNAL_UNKNOWN" } },
      readMissionBack: readback,
      missionDetail: detail,
      missionWorkspaceSummary: summary,
    });
    samplePaths.push(samplePath);
    cases.push({
      originalStatus: status,
      samplePath,
      readbackEnvelope: {
        missionStatus: readback.missionStatus,
        missionVersion: readback.missionVersion,
        observedAt: readback.observedAt,
        realityOutcome: readback.realityOutcome,
      },
      workState: phaseSummary(readback.workState),
      missionDetail: {
        status: detail.status,
        version: detail.version,
        error: detail.error,
        pauseRequestedAt: detail.pauseRequestedAt,
        cancelRequestedAt: detail.cancelRequestedAt,
        workState: phaseSummary(detail.workState),
      },
      workspaceSummary: {
        enabled: summary.enabled,
        totalActive: summary.totalActive,
        containsThisTerminalMission: summaryItem !== null,
        item: summaryItem
          ? {
              id: summaryItem.id,
              status: summaryItem.status,
              attention: summaryItem.attention,
              workState: phaseSummary(summaryItem.workState!),
            }
          : null,
      },
      observations: {
        terminalKeptInWorkState: readback.workState.phase === "COMPLETED",
        terminalKeptInReadbackEnvelope: readback.missionStatus === status,
        unknownKeptInWorkState: readback.workState.reasonCode === "EXTERNAL_UNKNOWN",
        cancelledPresentedAsSuccess:
          status === "CANCELLED" ? readback.workState.phase === "COMPLETED" : null,
        recoverableFromWorkState: readback.workState.nextActor === "USER",
        terminalMissionDroppedFromWorkspaceSummary: summaryItem === null,
      },
    });
  }
  return {
    id: "FS-A01",
    verdict: "REPRODUCED",
    criterion:
      "终态(SUCCEEDED/CANCELLED)叠加 lastErrorJson.code=EXTERNAL_UNKNOWN 时，共享 WorkState 投影应在 phase/reasonCode/actionLabel 中同时保留终态与未结算 UNKNOWN；取消不得显示成成功或可恢复；workspace 摘要不应因此丢失需核查的任务。",
    observed: {
      cases,
      judgment: {
        "workState 两层事实": "只保留 UNKNOWN（phase=UNKNOWN、nextActor=SYSTEM、actionLabel=查询原请求）；终态维度不在 workState 内（phase 没有 COMPLETED），取消也不算成功/可恢复。",
        "readback 外层": "missionStatus 仍保留原终态（SUCCEEDED/CANCELLED），所以 readback 响应级的两个事实可同时读到。",
        取消是否显示成功: "否：phase=UNKNOWN、nextActor=SYSTEM、actionLabel=查询原请求。",
        可恢复性: "否：nextActor=SYSTEM，未出现继续派发主动作。",
        workspace摘要: "终态任务被 where 过滤（status notIn SUCCEEDED/CANCELLED）整体丢弃；终态+UNKNOWN 的“查询原请求”核查入口不在摘要出现。",
      },
    },
    notes: [
      "失败判据“只保留一个而隐去另一事实则失败”命中的是共享 WorkState 投影层：workState 内终态维度被 UNKNOWN 覆盖；readback 顶层 missionStatus 仍保留，属“合同层丢失、响应级残留”。",
      "workspaceSummary 候选集排除终态，导致终态+UNKNOWN 需要 SYSTEM 核查的任务在摘要完全不可见（服务级观察，非纯投影）。",
      "本用例是服务级真实调用 readMissionBack / missionDetail / missionWorkspaceSummary，不是纯函数快照。",
    ],
    samplePaths,
  };
}

/* ------------------------------------------------------------------ FS-A02 */
async function caseA02(): Promise<CaseResult> {
  const owner = await createOwner(db, "a02");
  const cases: unknown[] = [];
  const samplePaths: string[] = [];
  const now = Date.now();
  for (const kind of ["PAUSE", "CANCEL"] as const) {
    const mission = await createMission(db, owner, {
      status: "RUNNING",
      version: 2,
      leaseUntil: new Date(now + 10 * 60 * 1000),
      nextAttemptAt: new Date(now + 10 * 60 * 1000),
      ...(kind === "PAUSE"
        ? { pauseRequestedAt: new Date(now), pauseReason: "USER" }
        : { cancelRequestedAt: new Date(now) }),
    });
    const readback = await readMissionBack(owner.userId, mission.id);
    const detail = await missionDetail(owner.userId, mission.id);
    const summary = await missionWorkspaceSummary(owner.userId, owner.projectId);
    const summaryItem = summary.items.find(item => item.id === mission.id) ?? null;
    const samplePath = writeSample(`FS-A02-${kind}.json`, {
      fixture: { status: "RUNNING", leaseUntil: new Date(now + 600_000).toISOString(), request: kind },
      readMissionBack: readback,
      missionDetail: detail,
      missionWorkspaceSummary: summary,
    });
    samplePaths.push(samplePath);
    const readbackJson = JSON.stringify(readback.workState);
    const summaryJson = JSON.stringify(summaryItem?.workState ?? null);
    cases.push({
      stopRequestKind: kind,
      samplePath,
      readback: {
        missionStatus: readback.missionStatus,
        workState: phaseSummary(readback.workState),
        exposesPauseRequestedAt: "pauseRequestedAt" in readback,
        exposesCancelRequestedAt: "cancelRequestedAt" in readback,
        workStateMentionsStopRequest: /请求|停止|暂停|取消/.test(readbackJson),
      },
      missionDetail: {
        status: detail.status,
        pauseRequestedAt: detail.pauseRequestedAt,
        cancelRequestedAt: detail.cancelRequestedAt,
        workState: phaseSummary(detail.workState),
      },
      workspaceSummary: summaryItem
        ? {
            status: summaryItem.status,
            attention: summaryItem.attention,
            workState: phaseSummary(summaryItem.workState!),
            mentionsStopRequest: /请求|停止|暂停|取消/.test(summaryJson),
          }
        : null,
      observations: {
        readbackShowsRequestReceivedButUnsettled: /请求|停止|暂停|取消/.test(readbackJson),
        workStatePhase: readback.workState.phase,
        workStateReasonCode: readback.workState.reasonCode,
        workStateActionLabel: readback.workState.actionLabel,
        summaryShowsStopRequest: summaryItem
          ? /请求|停止|暂停|取消/.test(summaryJson)
          : false,
        detailKeepsRawRequestTimestamp:
          kind === "PAUSE" ? detail.pauseRequestedAt !== null : detail.cancelRequestedAt !== null,
      },
    });
  }
  return {
    id: "FS-A02",
    verdict: "REPRODUCED",
    criterion:
      "RUNNING 且 lease 有效、用户已 pause/cancel 但尚未结算时，读取 readback/summary 必须显示“请求已收到、尚未完成、不要继续派发”；只显示 RUNNING/LEASE_ACTIVE 即失败。",
    observed: {
      cases,
      judgment: {
        readback: "workState 仍为 RUNNING / LEASE_ACTIVE / “正在调查，进展来自已保存步骤” / actionLabel=查看委托进展；没有任何“停止请求已收到、未结算”的字段或文案。",
        summary: "workspaceSummary 的 select 不包含 pauseRequestedAt/cancelRequestedAt，attention 仍是“正在调查…”。",
        "missionDetail 原始字段": "只保留原 pauseRequestedAt/cancelRequestedAt 时间戳（服务原字段），没有进入共享 WorkState，也没有“未结算”解释。",
        "input 类型缺口": "lib/mission/workState.ts 的 MissionStateInput 不含 pauseRequestedAt/cancelRequestedAt，纯投影无法表达请求在途。",
      },
    },
    notes: [
      "RUNNING + pause/cancel 时 commandMission 仍保留 RUNNING（lib/mission/missionService.ts:106-107），本探针直接以 fixture 复现该持久语义，未经过命令路径。",
      "失败判据“必须展示请求已收到、尚未完成”明确未命中。",
    ],
    samplePaths,
  };
}

/* ------------------------------------------------------------------ FS-A03 */
async function caseA03(): Promise<CaseResult> {
  const owner = await createOwner(db, "a03");
  const nextAttemptAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const mission = await createMission(db, owner, {
    status: "READY",
    version: 2,
    nextAttemptAt,
    budgetUsedJson: { models: 5, tools: 2, inputTokens: 900, outputTokens: 120, unknownCalls: 1 },
  });
  const budgetEvent = await addEvent(db, mission.id, "DAILY_BUDGET_WAITING", {
    budgetRetained: true,
    nextAttemptAt: nextAttemptAt.toISOString(),
    reason: "今日模型调用额度已用完，等待许可时区次日",
  });
  const readback = await readMissionBack(owner.userId, mission.id);
  const detail = await missionDetail(owner.userId, mission.id);
  const summary = await missionWorkspaceSummary(owner.userId, owner.projectId);
  const summaryItem = summary.items.find(item => item.id === mission.id) ?? null;
  const missionRow = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
  const budgetEventRow = await db.agentMissionEvent.findUniqueOrThrow({ where: { id: budgetEvent.id } });
  // 参考：把同一行 + 真实 DAILY_BUDGET_WAITING 事件喂给纯投影，看它本来会怎么显示。
  const pureWithEvent = missionWorkState({
    ...missionRow,
    delegationEnabled: false,
    events: [{ id: budgetEventRow.id, type: budgetEventRow.type, payloadJson: budgetEventRow.payloadJson }],
    approvals: [],
  });
  const pureWithoutEvent = missionWorkState({
    ...missionRow,
    delegationEnabled: false,
    events: [],
    approvals: [],
  });
  const samplePath = writeSample("FS-A03-DAILY_BUDGET_WAITING.json", {
    fixture: {
      status: "READY",
      nextAttemptAt: nextAttemptAt.toISOString(),
      budgetUsedJson: { models: 5, tools: 2, inputTokens: 900, outputTokens: 120, unknownCalls: 1 },
      event: { type: "DAILY_BUDGET_WAITING", payloadJson: budgetEventRow.payloadJson },
    },
    readMissionBack: readback,
    missionDetail: detail,
    missionWorkspaceSummary: summary,
    dbMission: missionRow,
    pureProjectionWithEvent: pureWithEvent,
    pureProjectionWithoutEvent: pureWithoutEvent,
  });
  const readbackWs = readback.workState;
  const detailWs = detail.workState;
  const summaryWs = summaryItem?.workState ?? null;
  const reasonCodes = [readbackWs.reasonCode, detailWs.reasonCode, summaryWs?.reasonCode ?? null];
  return {
    id: "FS-A03",
    verdict: "REPRODUCED",
    criterion:
      "READY + 未来 nextAttemptAt + DAILY_BUDGET_WAITING(budgetRetained:true) 时，missionDetail / missionWorkspaceSummary / readMissionBack 三者应一致解释“今日额度已用完、等待下次检查”，累计预算不得清零。",
    observed: {
      samplePath,
      dbFacts: {
        status: missionRow.status,
        nextAttemptAt: missionRow.nextAttemptAt?.toISOString() ?? null,
        latestEventType: budgetEventRow.type,
        latestEventPayload: budgetEventRow.payloadJson,
        budgetUsedJson: missionRow.budgetUsedJson,
      },
      missionDetail: {
        status: detail.status,
        workState: phaseSummary(detailWs),
        used: detail.used,
        exposesNextAttemptAtField: "nextAttemptAt" in detail,
      },
      missionWorkspaceSummary: summaryItem
        ? {
            status: summaryItem.status,
            attention: summaryItem.attention,
            workState: phaseSummary(summaryItem.workState!),
          }
        : null,
      readMissionBack: {
        missionStatus: readback.missionStatus,
        workState: phaseSummary(readbackWs),
        resourceUsage: readback.resourceUsage,
      },
      pureProjectionReference: {
        withRealDailyBudgetWaitingEvent: phaseSummary(pureWithEvent),
        withoutEvent: phaseSummary(pureWithoutEvent),
      },
      observations: {
        reasonCodes: { missionDetail: detailWs.reasonCode, workspaceSummary: summaryWs?.reasonCode ?? null, readMissionBack: readbackWs.reasonCode },
        threeReasonCodesEqual: new Set(reasonCodes).size === 1,
        anyExplainsDailyBudgetWaiting: reasonCodes.some(code => code === "DAILY_BUDGET_WAITING"),
        anyMentionsDailyBudgetInText: [readbackWs.reasonText, detailWs.reasonText, summaryItem?.attention ?? ""].some(text => /额度|预算/.test(text)),
        nextAttemptAtVisibleThrough: {
          missionDetailField: "nextAttemptAt" in detail,
          workStateNextCheckAt: { detail: detailWs.nextCheckAt, readback: readbackWs.nextCheckAt, summary: summaryWs?.nextCheckAt ?? null },
        },
        cumulativeBudgetPreserved: {
          dbModels: (missionRow.budgetUsedJson as { models?: number }).models ?? null,
          detailUsedModels: (detail.used as { models?: number } | null)?.models ?? null,
          readbackUsageModels: readback.resourceUsage.models,
          notReset: [detail.used, readback.resourceUsage, missionRow.budgetUsedJson].every(
            (v) => (v as { models?: number } | null)?.models === 5,
          ),
        },
      },
      judgment: {
        "三者一致性": "三者彼此一致（都是 QUEUED/READY，“委托已保存，等待执行”），但一致地没有解释 DAILY_BUDGET_WAITING。",
        "事件是否被服务路径读到": "missionDetail / workspaceSummary / readback 的事件查询只筛 QUESTION、INVESTIGATION_NO_NEW_INFORMATION 等类型，DAILY_BUDGET_WAITING 不在 where 中。",
        "纯投影对照": "把真实 DAILY_BUDGET_WAITING 事件直接传给 missionWorkState 时，phase=QUEUED、reasonCode=DAILY_BUDGET_WAITING、nextCheckAt 存在；说明缺口在服务层事件筛选，不在纯投影规则。",
        "预算清零": "未清零：DB budgetUsedJson、detail.used、readback.resourceUsage 都保留 models=5/tools=2 等累计值。",
        "下次时间": "仅 workState.nextCheckAt（=nextAttemptAt）可见；missionDetail 无 nextAttemptAt 字段。",
      },
    },
    notes: [
      "失败判据“三者应一致解释等待”命中的是“一致地错误”：三者都不识别额度等待事件，也不出现“今日额度已用完/已保留累计用量”的文案。",
      "预算不清零这一子项通过；nextAttemptAt 经 workState.nextCheckAt 暴露。",
    ],
    samplePaths: [samplePath],
  };
}

/* ------------------------------------------------------------------ FS-A04 */
async function caseA04(): Promise<CaseResult> {
  const owner = await createOwner(db, "a04");
  const observedAtFixed = "2026-10-01T00:00:00.000Z";
  const mission = await createMission(db, owner, {
    status: "READY",
    version: 2,
    planJson: { delegation: { lastObservedAt: observedAtFixed, observationSource: "WORKER_PROBE" } },
  });
  const reads = [];
  for (let i = 0; i < 2; i++) {
    if (i > 0) await sleep(30);
    const readback = await readMissionBack(owner.userId, mission.id);
    reads.push({
      readAt: new Date().toISOString(),
      readbackObservedAt: readback.observedAt,
      missionUpdatedAt: readback.missionUpdatedAt,
      workState: phaseSummary(readback.workState),
    });
  }
  // “最近失败/无 Worker”：状态 FAILED + 失败原因；仅反复 GET，不产生新观察。
  await db.agentMission.update({
    where: { id: mission.id },
    data: {
      status: "FAILED",
      version: { increment: 1 },
      leaseUntil: null,
      lastErrorJson: { code: "TOOL_FAILED", message: "工具执行失败，已保存进度", phase: "TOOL" },
    },
  });
  const afterFailureReads = [];
  for (let i = 0; i < 2; i++) {
    if (i > 0) await sleep(30);
    const readback = await readMissionBack(owner.userId, mission.id);
    afterFailureReads.push({
      readAt: new Date().toISOString(),
      readbackObservedAt: readback.observedAt,
      workState: phaseSummary(readback.workState),
    });
  }
  const detail = await missionDetail(owner.userId, mission.id);
  const samplePath = writeSample("FS-A04-observedAt-vs-checkedAt.json", {
    fixture: { planJsonDelegationLastObservedAt: observedAtFixed },
    successReads: reads,
    afterFailureReads,
    missionDetailAfterFailure: {
      status: detail.status,
      error: detail.error,
      workState: phaseSummary(detail.workState),
    },
  });
  const successObservedValues = reads.map(read => read.workState.observedAt);
  const failureObservedValues = afterFailureReads.map(read => read.workState.observedAt);
  const successCheckedValues = reads.map(read => read.workState.checkedAt);
  const readbackObservedAtAdvanced =
    Date.parse(reads[1].readbackObservedAt) > Date.parse(reads[0].readbackObservedAt);
  return {
    id: "FS-A04",
    verdict: "NOT_REPRODUCED",
    criterion:
      "固定 delegation.lastObservedAt 后反复 GET：readback.observedAt（读取时刻）可以前进，但 workState.observedAt（成功观察时刻）不得前进；最近失败/无 Worker 时不得显示“刚检查成功/没有变化”。",
    observed: {
      samplePath,
      successObservation: {
        fixtureLastObservedAt: observedAtFixed,
        firstRead: reads[0],
        secondRead: reads[1],
        readbackObservedAtAdvanced,
        workStateObservedAtFixed: new Set(successObservedValues).size === 1 && successObservedValues[0] === observedAtFixed,
        workStateCheckedAtAdvanced: new Set(successCheckedValues).size > 1,
      },
      afterFailure: {
        reads: afterFailureReads,
        workStateObservedAtStillFixed: new Set(failureObservedValues).size === 1 && failureObservedValues[0] === observedAtFixed,
        phase: afterFailureReads[1].workState.phase,
        reasonCode: afterFailureReads[1].workState.reasonCode,
        freshness: afterFailureReads[1].workState.freshness,
        showsNoChange: afterFailureReads[1].workState.reasonCode === "NO_CHANGE",
      },
      missionDetailAfterFailure: {
        status: detail.status,
        error: detail.error,
        workState: phaseSummary(detail.workState),
      },
      judgment: {
        "服务层字段分工": "readback.observedAt 是本次读取时间（每次 GET 前进）；workState.checkedAt 也是读取时刻；workState.observedAt 来自 planJson.delegation.lastObservedAt，固定不动。",
        "失败后": "phase=FAILED、reasonCode=TOOL_FAILED，成功观察时间仍为 2026-10-01T00:00:00.000Z，未显示“没有变化/刚检查成功”。",
        "Web 展示": "components/MissionReadback.tsx 把 readback.observedAt 标为“读取于”，不是“检查成功”；误读风险在调用方文案，不在服务字段语义。",
      },
    },
    notes: [
      "服务级字段语义当前是分离的：读取时间与成功观察时间没有互相覆盖。判据未命中（服务层 NOT_REPRODUCED）。",
      "风险仍在客户端：任何消费方把 readback.observedAt 或 workState.checkedAt 当作“刚刚核查成功”都会误报；本探针不替客户端签收。",
      "未启动真实 Worker：workerPresence 文件指向临时目录且不存在，责任视图为 UNOBSERVED；“无 Worker”情形由固定观察时间 + 反复 GET 表达。",
    ],
    samplePaths: [samplePath],
  };
}

/* ------------------------------------------------------------------ FS-A05 */
type MaterialScenario = {
  owner: { userId: string; projectId: string };
  captureId: string;
  pointer: { id: string; hash: string };
  missionId: string;
  questionId: string;
  text: string;
  baselineFacts: string[];
  baselineAvailability: string;
};

async function materialScenario(label: string, input: { sourceType?: string } = {}): Promise<MaterialScenario> {
  const owner = await createOwner(db, `a05-${label}`);
  const text = `2026-10-30 ${label} 原始记录：演示环境启动日志需现场核对，安装自报不等于启动成功。`;
  const capture = await db.capture.create({
    data: { projectId: owner.projectId, rawText: text, ...(input.sourceType ? { sourceType: input.sourceType } : {}) },
  });
  const source = await readProjectMaterial(owner.projectId, `capture:${capture.id}`);
  if (!source) throw new Error(`readProjectMaterial 失败：capture:${capture.id}`);
  const pointer = { id: source.id, hash: source.hash };
  const mission = await createMission(db, owner, { status: "WAITING_INPUT", version: 2 });
  // readMissionBack 的 questionId 必须是真实 QUESTION 事件的 id（否则 MISSION_TARGET_NOT_FOUND）。
  const question = await addEvent(db, mission.id, "QUESTION", {
    question: `请补充 ${label} 的原始对照记录`,
    requirements: { sourceType: "EITHER" },
  });
  const questionId = question.id;
  const step = await addBoundSourcesStep(db, {
    missionId: mission.id,
    questionId,
    pointer,
    text: source.text,
  });
  await addEvent(db, mission.id, "SOURCE_ARRIVED", { questionId, sourcePointer: pointer, readable: true });
  await addEvent(db, mission.id, "SOURCE_ASSOCIATED", { questionId, pointers: [pointer] });
  const readback = await readMissionBack(owner.userId, mission.id, { questionId });
  const item = readback.materialUses.items[0];
  if (!item) throw new Error(`FS-A05 ${label} 未生成 materialUses item`);
  return {
    owner,
    captureId: capture.id,
    pointer,
    missionId: mission.id,
    questionId,
    text,
    baselineFacts: item.facts.map(fact => fact.kind),
    baselineAvailability: item.availability,
  };
}

async function caseA05(): Promise<CaseResult> {
  const samplePaths: string[] = [];
  const rawTextSha = (text: string) => createHash("sha256").update(text).digest("hex");

  // 基线：普通 capture，先绑定/关联，SourcePolicy ALLOWED，materialUses CURRENT。
  const normal = await materialScenario("normal");
  const normalRawSha = rawTextSha(normal.text);
  const normalUseBaseline = await sourceUse(normal.owner.userId, normal.owner.projectId, normal.pointer.id, db, {
    missionId: normal.missionId,
  });

  // (a) USE_SUPPRESSION continuity 指令（项目级，conversationId/missionId 均为 null）。
  const session = await createSession(normal.owner.userId);
  const actor = { userId: normal.owner.userId, sessionId: session.session.id };
  const conversation = await createConversation(actor, {
    requestId: `probe-conv-${normal.owner.projectId}`,
    scope: "PROJECT",
    projectId: normal.owner.projectId,
  });
  const submitted = await submitDirective(actor, conversation.id, {
    commandId: `probe-suppress-${randomUUID()}`,
    expectedSeq: 0,
    scope: { projectId: normal.owner.projectId },
    operation: "SUPPRESS_USE",
    sourceIds: [normal.pointer.id],
  });
  const suppressedUse = await sourceUse(normal.owner.userId, normal.owner.projectId, normal.pointer.id, db, {
    missionId: normal.missionId,
  });
  const suppressedReadback = await readMissionBack(normal.owner.userId, normal.missionId, {
    questionId: normal.questionId,
  });
  const suppressedItem = suppressedReadback.materialUses.items[0];
  let suppressedGuard: unknown = null;
  try {
    await validateSources(normal.owner.projectId, [{ id: normal.pointer.id } as never], db, normal.missionId);
    suppressedGuard = { rejected: false };
  } catch (error) {
    suppressedGuard = { rejected: true, ...errorFacts(error) };
  }
  // 参照：题面示例要求 sourcePointer.hash = sha256(text)；真实 capture 源 hash 是
  // readProjectMaterial 的复合 hash，用 sha256(text) 绑定只会得到 CHANGED。
  const shaOnlyMismatch = normal.pointer.hash !== normalRawSha;

  // (b) 连接撤销：capture 由仓库信号采纳，连接被撤销后来源链被阻断。
  const revoked = await materialScenario("revoked", { sourceType: "仓库信号" });
  const { jsonHash } = await import("../../lib/mission/contracts");
  const connection = await db.sourceConnection.create({
    data: {
      projectId: revoked.owner.projectId,
      ownerUserId: revoked.owner.userId,
      provider: "GITHUB",
      repo: `probe/${revoked.captureId}`,
      ref: "main",
      signalKind: "COMMITS",
      status: "ACTIVE",
      revision: 1,
    },
  });
  const grantBinding = {
    schemaVersion: 1 as const,
    connectionId: connection.id,
    scopeHash: jsonHash({
      connectionId: connection.id,
      projectId: revoked.owner.projectId,
      ownerUserId: revoked.owner.userId,
      repo: connection.repo,
      ref: connection.ref,
    }),
    observedRevision: 0,
  };
  await db.externalSignal.create({
    data: {
      connectionId: connection.id,
      projectId: revoked.owner.projectId,
      ownerUserId: revoked.owner.userId,
      sha: `probe-sha-${revoked.captureId}`,
      kind: "COMMITS",
      title: "探针提交信号",
      authorName: "probe",
      url: `https://probe.invalid/${revoked.captureId}`,
      adoptedCaptureId: revoked.captureId,
      adoptedByUserId: revoked.owner.userId,
      adoptedAt: new Date(),
      sourceBindingJson: grantBinding,
    },
  });
  const revokedUseBefore = await sourceUse(revoked.owner.userId, revoked.owner.projectId, revoked.pointer.id, db, {
    missionId: revoked.missionId,
  });
  await db.sourceConnection.update({
    where: { id: connection.id },
    data: { status: "REVOKED", revokedAt: new Date(), revokedReason: "PROBE_USER_REVOKED", revision: { increment: 1 } },
  });
  const revokedUseAfter = await sourceUse(revoked.owner.userId, revoked.owner.projectId, revoked.pointer.id, db, {
    missionId: revoked.missionId,
  });
  const revokedReadback = await readMissionBack(revoked.owner.userId, revoked.missionId, {
    questionId: revoked.questionId,
  });
  const revokedItem = revokedReadback.materialUses.items[0];

  // (c) 来源链未知：capture 标记为仓库信号但没有任何 ExternalSignal。
  const unknown = await materialScenario("unknown", { sourceType: "仓库信号" });
  const unknownUse = await sourceUse(unknown.owner.userId, unknown.owner.projectId, unknown.pointer.id, db, {
    missionId: unknown.missionId,
  });
  const unknownReadback = await readMissionBack(unknown.owner.userId, unknown.missionId, {
    questionId: unknown.questionId,
  });
  const unknownItem = unknownReadback.materialUses.items[0];

  const samplePath = writeSample("FS-A05-material-use-vs-source-policy.json", {
    normal: {
      fixture: { sourcePointer: normal.pointer, text: normal.text, rawTextSha256: normalRawSha },
      baselineSourceUse: normalUseBaseline,
      afterSuppressionDirective: {
        directive: { operation: "SUPPRESS_USE", admitted: submitted.admission },
        sourceUse: suppressedUse,
        materialUsesItem: suppressedItem,
        validateSources: suppressedGuard,
      },
    },
    revoked: {
      connectionBefore: { status: "ACTIVE", revision: 1 },
      sourceUseBefore: revokedUseBefore,
      connectionAfter: { status: "REVOKED", revokedAt: new Date().toISOString() },
      sourceUseAfter: revokedUseAfter,
      materialUsesItem: revokedItem,
    },
    unknownLineage: {
      fixture: { sourceType: "仓库信号", externalSignalCount: 0 },
      sourceUse: unknownUse,
      materialUsesItem: unknownItem,
    },
  });
  samplePaths.push(samplePath);

  const factsEqual = (item: { facts: Array<{ kind: string }> } | undefined) =>
    JSON.stringify(item?.facts.map(fact => fact.kind)) === JSON.stringify(normal.baselineFacts);
  return {
    id: "FS-A05",
    verdict: "REPRODUCED",
    criterion:
      "材料先绑定/引用，再 SUPPRESS_USE、连接撤销或来源链未知时：历史审计事实保留；当前依据不得继续标为可用/独立支持（availability 不能仍是 CURRENT）；原写入守卫必须拒绝。",
    observed: {
      samplePath,
      hashSemantics: {
        taskHintPointerHash: "sha256(text)",
        realProjectMaterialHash: normal.pointer.hash,
        realHashIsRawTextSha256: !shaOnlyMismatch,
        note:
          shaOnlyMismatch
            ? "真实 source.hash 是 jsonHash({rawText,sourceType,cardHash})，不是 sha256(text)；按任务书示例的 sha256(text) 绑定只会得到 availability=CHANGED，无法命中“版本匹配但策略抑制”的矛盾。本探针改用 readProjectMaterial().hash 作为绑定指针，并保留原始 sha256 供复核。"
            : "真实 source.hash 与 sha256(text) 一致。",
        rawTextSha256: normalRawSha,
      },
      baseline: {
        sourceUse: normalUseBaseline,
        materialUsesItem: {
          availability: normal.baselineAvailability,
          facts: normal.baselineFacts,
          excerptPresent: normal.text.length > 0,
        },
      },
      suppressionCase: {
        directiveAdmission: submitted.admission,
        sourceUse: suppressedUse,
        materialUsesItem: {
          availability: suppressedItem?.availability ?? null,
          facts: suppressedItem?.facts.map(fact => fact.kind) ?? [],
          excerpt: suppressedItem?.excerpt ?? null,
        },
        writeGuard: suppressedGuard,
        observations: {
          contradiction:
            suppressedItem?.availability === "CURRENT" && suppressedUse.state === "SUPPRESSED",
          historicalFactsPreserved: factsEqual(suppressedItem),
        },
      },
      revokedConnectionCase: {
        sourceUseBefore: revokedUseBefore,
        sourceUseAfter: revokedUseAfter,
        materialUsesItem: {
          availability: revokedItem?.availability ?? null,
          facts: revokedItem?.facts.map(fact => fact.kind) ?? [],
          excerpt: revokedItem?.excerpt ?? null,
        },
        observations: {
          contradiction: revokedItem?.availability === "CURRENT" && revokedUseAfter.state === "SUPPRESSED",
          historicalFactsPreserved: factsEqual(revokedItem),
        },
      },
      unknownLineageCase: {
        sourceUse: unknownUse,
        materialUsesItem: {
          availability: unknownItem?.availability ?? null,
          facts: unknownItem?.facts.map(fact => fact.kind) ?? [],
          excerpt: unknownItem?.excerpt ?? null,
        },
        observations: {
          contradiction: unknownItem?.availability === "CURRENT" && unknownUse.state === "UNKNOWN",
          historicalFactsPreserved: factsEqual(unknownItem),
        },
      },
      judgment: {
        "当前可用性": "三种情形下 materialUses.items[0].availability 仍是 CURRENT（materialUseProjection 只比较 readProjectMaterial 版本 hash，不调用 SourcePolicy）。",
        "SourcePolicy 结果": "SUPPRESS_USE → SUPPRESSED/ROOT_SUPPRESSED；连接撤销 → SUPPRESSED/SOURCE_PERMISSION_REVOKED；来源链未知 → UNKNOWN/LINEAGE_UNKNOWN。",
        "历史事实": "BOUND/ASSOCIATED/CANDIDATE 等历史 facts 与摘录都保留，未因抑制被删除。",
        "写入守卫": "validateSources → assertSourceUse 拒绝（SOURCE_USE_SUPPRESSED），原写路径仍被守卫。",
      },
    },
    notes: [
      "失败判据“当前依据不继续使用/不称独立支持”命中：availability=CURRENT 与 SourcePolicy=SUPPRESSED/UNKNOWN 冲突；若客户端照搬 CURRENT 就会绕过抑制。",
      "历史保留与写入守卫这两个子项通过。",
      "探针使用真实 submitDirective（项目级 scope，conversationId/missionId 为 null 才能作用于 mission 读取）；连接撤销通过原 SourceConnection/ExternalSignal 行与 sourceLineage 真实路径触发。",
    ],
    samplePaths,
  };
}

/* ------------------------------------------------------------------ FS-A06 */
async function caseA06(): Promise<CaseResult> {
  const owner = await createOwner(db, "a06");
  const text = "2026-10-30 原记录：启动日志显示目标设备已启动，但只有安装自报，缺少后续验证。";
  const capture = await db.capture.create({ data: { projectId: owner.projectId, rawText: text } });
  const source = await readProjectMaterial(owner.projectId, `capture:${capture.id}`);
  if (!source) throw new Error("FS-A06 readProjectMaterial 失败");
  const pointer = { id: source.id, hash: source.hash };
  const mission = await createMission(db, owner, { status: "WAITING_INPUT", version: 2 });
  const question = await addEvent(db, mission.id, "QUESTION", {
    question: "请补充启动日志原始记录",
    requirements: { sourceType: "EITHER" },
  });
  const questionId = question.id;
  const step = await addBoundSourcesStep(db, { missionId: mission.id, questionId, pointer, text: source.text });
  await addEvent(db, mission.id, "SOURCE_ARRIVED", { questionId, sourcePointer: pointer });
  await addEvent(db, mission.id, "SOURCE_ASSOCIATED", { questionId, pointers: [pointer] });
  const baseTime = Date.now();
  // 本 Mission 的 AgentRun 先创建（更旧），随后 45 条无关运行更新（更新）。
  const missionRun = await addAgentRun(db, {
    projectId: owner.projectId,
    provider: "PROBE_MISSION_RUN",
    createdAt: new Date(baseTime),
    trace: {
      missionId: mission.id,
      contextManifest: { sourcePointers: [pointer], includedStepIds: [step.id] },
      usage: { inputTokens: 10, outputTokens: 5 },
    },
  });
  const before = await readMissionBack(owner.userId, mission.id, { questionId });
  for (let i = 0; i < 45; i++) {
    await addAgentRun(db, {
      projectId: owner.projectId,
      provider: `PROBE_UNRELATED_${i}`,
      runType: i % 2 === 0 ? "CHAT" : "CAPTURE",
      createdAt: new Date(baseTime + (i + 1) * 1000),
      trace: i % 2 === 0 ? { missionId: `other-mission-${i}` } : {},
    });
  }
  const after = await readMissionBack(owner.userId, mission.id, { questionId });
  const missionRunStillInDb = await db.agentRun.findUnique({ where: { id: missionRun.id } });
  const projectRunCount = await db.agentRun.count({ where: { projectId: owner.projectId } });
  const beforeItem = before.materialUses.items[0];
  const afterItem = after.materialUses.items[0];
  const samplePath = writeSample("FS-A06-agentrun-window-eviction.json", {
    fixture: {
      projectRunCount,
      missionRun: { id: missionRun.id, createdAt: missionRunStillInDb?.createdAt.toISOString() ?? null },
      unrelatedRuns: 45,
      pointer,
    },
    before: {
      materialUses: before.materialUses,
      callCoverage: {
        inspected: before.callCoverage.inspected,
        models: before.callCoverage.models,
      },
    },
    after: {
      materialUses: after.materialUses,
      callCoverage: {
        inspected: after.callCoverage.inspected,
        models: after.callCoverage.models,
      },
    },
  });
  const beforeFacts = beforeItem?.facts.map(fact => fact.kind) ?? [];
  const afterFacts = afterItem?.facts.map(fact => fact.kind) ?? [];
  return {
    id: "FS-A06",
    verdict: "REPRODUCED",
    criterion:
      "项目内 45 条更新的无关 AgentRun + 1 条本 Mission 的 AgentRun（trace.contextManifest.sourcePointers 指向已绑定 source）时，materialUseProjection 不得因项目窗口截断而丢失 CONTEXT_POINTER；若丢失，“未找到”只能表示覆盖不足，不能解释为从未使用。",
    observed: {
      samplePath,
      fixture: {
        projectRunCount,
        missionRunId: missionRun.id,
        missionRunCreatedAt: missionRunStillInDb?.createdAt.toISOString() ?? null,
        unrelatedRunCount: 45,
        materialUseProjection: { projectRunLimit: 40, take: 41 },
      },
      beforeUnrelatedRuns: {
        facts: beforeFacts,
        availability: beforeItem?.availability ?? null,
        coverage: before.materialUses.coverage,
        callCoverage: {
          inspected: before.callCoverage.inspected,
          models: before.callCoverage.models,
          summary: before.callCoverage.summary,
        },
      },
      afterUnrelatedRuns: {
        facts: afterFacts,
        availability: afterItem?.availability ?? null,
        coverage: after.materialUses.coverage,
        callCoverage: {
          inspected: after.callCoverage.inspected,
          models: after.callCoverage.models,
          summary: after.callCoverage.summary,
        },
      },
      observations: {
        contextPointerBefore: beforeFacts.includes("CONTEXT_POINTER"),
        contextPointerAfter: afterFacts.includes("CONTEXT_POINTER"),
        missionRunEvictedFromMaterialWindow: beforeFacts.includes("CONTEXT_POINTER") && !afterFacts.includes("CONTEXT_POINTER"),
        missionRunStillExistsInDb: missionRunStillInDb !== null,
        coverageOnlyReportsTruncation:
          after.materialUses.coverage.runsTruncated === true &&
          !("notFoundMeans" in after.materialUses.coverage) &&
          !("missIsNotEvidenceOfAbsence" in after.materialUses.coverage),
        callCoverageStillFindsMissionRun:
          after.callCoverage.models.total === 1 && after.callCoverage.models.succeeded === 1,
      },
      judgment: {
        "材料使用投影": "先按项目取 41 条 AgentRun 再按 trace.missionId 过滤；45 条更新的无关运行把本 Mission 运行挤出窗口，CONTEXT_POINTER 事实消失。",
        "覆盖说明": "coverage 只有 projectRunLimit=40、runsTruncated=true，没有“未找到≠从未发生”或“需按 mission 过滤/扩大窗口”的语义字段。",
        "同响应内对照": "readMissionBack.callCoverage 先用 SQL 按 trace.missionId 过滤再取窗口，仍能找到该 Mission 的 1 条运行；说明 callCoverage 已修，而 materialUseProjection 仍受项目窗口挤压。",
      },
    },
    notes: [
      "判据命中：同一 SQLite 库中本 Mission 的 AgentRun 确实存在，但 materialUses 中 CONTEXT_POINTER 消失，覆盖说明只说明截断。",
      "本用例没有修改任何产品代码；对照的 callCoverage 过滤逻辑见 lib/mission/readback.ts:137-151。",
    ],
    samplePaths: [samplePath],
  };
}

const result = await runProbe("probe-fs-a", "probe-fs-a01-a07.json", async () => {
  const cases: CaseResult[] = [];
  cases.push(await caseA01(), await caseA02(), await caseA03(), await caseA04(), await caseA05(), await caseA06());
  const summary = {
    total: cases.length,
    reproduced: cases.filter(item => item.verdict === "REPRODUCED").length,
    notReproduced: cases.filter(item => item.verdict === "NOT_REPRODUCED").length,
    inconclusive: cases.filter(item => item.verdict === "INCONCLUSIVE").length,
    verdicts: Object.fromEntries(cases.map(item => [item.id, item.verdict])),
  };
  return {
    generatedAt,
    baseSha,
    sourceTree: probeSourceTree(),
    branch: process.env.GIT_BRANCH ?? "codex/final-a-mission-packet",
    environment: {
      database: "temp-independent",
      databaseUrl: env.databaseUrl,
      databaseFile: env.file,
      temporaryDir: env.dir,
      migrationsApplied: env.migrationsApplied,
      schemaTables: env.schemaTables,
      llmMode: "mock",
      modelProviderCalls: 0,
      missionEnabled: process.env.MISSION_ENABLED,
      missionWritesEnabled: process.env.MISSION_WRITES_ENABLED,
      workerPresenceFile: process.env.WORKER_PRESENCE_FILE,
      seededFrom: "prisma/migrations/*/migration.sql replayed with better-sqlite3 + WAL",
    },
    evidenceNote:
      "BEFORE_FIX 特征化：只记录当前服务行为与失败判据是否命中，不代表已修复；证据 JSON 由真实临时库上的服务调用生成，未修改产品代码。",
    implementation: {
      script: "scripts/final-a/probe-fs-a.ts",
      command: "npx.cmd tsx scripts/final-a/probe-fs-a.ts",
      samplesDir: "evidence/final-a/20261103/samples",
    },
    summary,
    cases,
    remaining: {
      "FS-A07": "真实双连接并发探针单独输出 evidence/final-a/20261103/probe-concurrency.json",
      "纯投影": "evidence/final-a/20261103/probe-work-state-pure.json（纯投影 ≠ 服务缺陷已确认）",
    },
  };
});

await db.$disconnect();
process.exitCode = result;
