"use client";
/**
 * 顶部四问工作包（C1）。
 *
 * 只消费服务端 `readback.workPacket`（final-a-workpacket-v1，见 lib/types/workPacket.ts）：
 * 已经做了什么、依据是什么、为何停下、现在由谁做哪一步。
 * 客户端不重算生命周期、优先级或授权；唯一主动作只做页面内定位或重新读取，
 * 不是执行令牌，绝不提交批准/执行，也不创建替代任务。
 *
 * 旧后端/包缺失时保留原详情并说明“当前摘要暂未提供”，不构造默认四问或成功事实；
 * 读回尚未成功（readback === null）时不渲染任何四问或成功结论。
 */
import { useState } from "react";
import { workPhaseLabel } from "@/lib/client/focusPresentation";
import { MissionBasisEvidence } from "./MissionBasisEvidence";
import type { MissionReadback as ReadbackData } from "@/lib/mission/readback";
import type { WorkState } from "@/lib/types/workState";
import type {
  WorkPacket,
  WorkPacketBlocker,
  WorkPacketObservationState,
  WorkPacketWaitingOn,
} from "@/lib/types/workPacket";
import styles from "./MissionWorkPacket.module.css";

export type MissionWorkPacketProps = {
  /** null = 读回尚未成功或已清空；undefined = 旧后端未提供整个工作包。 */
  readback: ReadbackData | null;
  packet: WorkPacket | undefined;
  missionId: string;
  /** 只重新读取同一只读端点；不得提交业务命令。 */
  onReload: () => void;
  disabled?: boolean;
};

const WAITING_ON_LABELS: Record<WorkPacketWaitingOn, string> = {
  USER_INPUT: "等你补充信息",
  USER_APPROVAL: "等你确认提案",
  USER_RECHECK: "等你重新核对条件",
  SYSTEM_WORKER: "等后台继续执行",
  SYSTEM_SETTLEMENT: "等本轮调用结算",
  SYSTEM_OBSERVATION: "等下一次观察",
  SYSTEM_LEASE: "等执行租约释放",
  SYSTEM_RECHECK: "等后台重新核对",
  BUDGET_RESET: "等额度重置",
  NONE: "不再等待谁",
};

const NEXT_ACTOR_LABELS: Record<string, string> = {
  USER: "你",
  AGENT: "Agent",
  SYSTEM: "系统",
  UNKNOWN: "未记录",
  NONE: "无",
};

const PERMISSION_LABELS: Record<WorkPacket["authority"]["permissionState"], string> = {
  WITHIN_TIME_BOUNDARY: "仍在时间边界内",
  EXPIRED: "已超出有效边界，需要重新核对",
  STOPPED: "原委托已停止",
  UNKNOWN: "权限状态未知",
};

const OBSERVATION_STATE_LABELS: Record<WorkPacketObservationState, string> = {
  OBSERVED: "最近有成功观察记录",
  NOT_OBSERVED: "尚未有成功观察记录",
  FAILED_LAST: "最近一次观察失败，晚于最近成功观察",
};

const BLOCKER_KIND_LABELS: Record<WorkPacketBlocker["kind"], string> = {
  AUTHORITY: "权限",
  WORK_STATE: "工作状态",
  STOP_REQUEST: "停止请求",
  BUDGET: "预算",
  SOURCE: "来源",
  APPROVAL: "提案",
  QUESTION: "原问题",
  LEASE: "执行租约",
  UNKNOWN_EFFECT: "未结算效果",
  FAILURE: "失败",
  DELEGATION: "委托",
  TIME_BOUNDARY: "时间边界",
};

const BUDGET_LABELS: Record<string, string> = {
  models: "模型调用",
  tools: "工具调用",
  searches: "搜索",
  fetches: "网页抓取",
  browserRequests: "浏览器请求",
  browserBytes: "浏览器字节",
  calendarRequests: "日历请求",
  externalWrites: "外部写入",
  metadataRequests: "元数据请求",
  activeMs: "执行时长（毫秒）",
  reservedOutputTokens: "预留输出 token",
  inputTokens: "输入 token",
  outputTokens: "输出 token",
  unknownCalls: "未知调用",
};

const BUDGET_KEY_ORDER = [
  "models",
  "tools",
  "searches",
  "fetches",
  "browserRequests",
  "browserBytes",
  "calendarRequests",
  "externalWrites",
  "metadataRequests",
  "activeMs",
  "reservedOutputTokens",
  "inputTokens",
  "outputTokens",
  "unknownCalls",
];

const COVERAGE_LABELS: Record<string, string> = {
  RECENT_STEPS: "最近步骤",
  ACTION_RECEIPTS: "行动回执",
  MATERIAL_USES: "资料使用",
  MATERIAL_SOURCE_EVENTS: "资料来源事件",
  MATERIAL_MISSION_RUNS: "本委托模型运行",
  MISSION_MODEL_RUNS: "调用回执",
  EVIDENCE_REVIEWS: "证据审查",
};

const STEP_STATUS_LABELS: Record<string, string> = {
  READY: "准备执行",
  RUNNING: "正在执行",
  WAITING_APPROVAL: "待批准",
  SUCCEEDED: "已执行",
  FAILED: "执行失败",
  UNKNOWN: "结果待核对",
  OBSOLETE: "依据已变化",
  SKIPPED: "已跳过",
};

/** 只允许键盘可达的元素作为定位目标；禁用控件不算可聚焦。 */
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function formatTime(value: string | null | undefined, fallback = "未记录"): string {
  if (!value) return fallback;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return fallback;
  return new Date(time).toLocaleString("zh-CN");
}

function scrollIntoViewIfPossible(element: HTMLElement) {
  if (typeof element.scrollIntoView === "function") {
    element.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function focusFirstControl(container: HTMLElement): boolean {
  const target = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
  if (!target) return false;
  scrollIntoViewIfPossible(container);
  target.focus();
  return true;
}

function focusRegion(container: HTMLElement) {
  scrollIntoViewIfPossible(container);
  const target = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
  if (target) {
    target.focus();
    return;
  }
  // 区域本身没有可聚焦子控件时，用标准的 skip-link 模式让读屏定位到该区域。
  container.tabIndex = -1;
  container.focus();
}

function approvalContainer(approvalId: string): HTMLElement | null {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-mission-approval-id]"));
  return nodes.find((node) => node.getAttribute("data-mission-approval-id") === approvalId) ?? null;
}

function stopRequestText(stop: WorkPacket["stopped"]["stopRequest"]): string {
  if (!stop) return "停止请求：未记录（旧服务或摘要缺失）。";
  const label = stop.state === "PAUSE_REQUESTED" || stop.state === "PAUSE_SETTLED" ? "暂停" : "取消";
  if (stop.state === "PAUSE_REQUESTED" || stop.state === "CANCEL_REQUESTED") {
    return `已请求${label}，尚未结算（请求于 ${formatTime(stop.requestedAt)}）；等待本轮调用结算，不会继续派发新步骤。`;
  }
  if (stop.state === "PAUSE_SETTLED" || stop.state === "CANCEL_SETTLED") {
    return `${label}请求已结算（请求于 ${formatTime(stop.requestedAt)}）。${stop.note ?? ""}`;
  }
  return stop.note ? `无停止请求（${stop.note}）。` : "无停止请求。";
}

function unknownEffectText(effect: WorkPacket["stopped"]["unknownEffect"]): string {
  if (!effect) return "未结算效果：未记录。";
  if (!effect.present) return "未结算效果：无记录（读取不会核销任何未知效果）。";
  return `未结算效果：${effect.code ?? "代码未记录"} · ${effect.reasonText ?? "原因未记录"}；读取不会核销，需要重新核对原请求。`;
}

function budgetKeys(packet: WorkPacket): string[] {
  const known = new Set([...BUDGET_KEY_ORDER, ...Object.keys(packet.authority.budget.limits), ...Object.keys(packet.authority.budget.cumulativeUsed)]);
  return Array.from(known).filter(
    (key) => key in packet.authority.budget.limits || key in packet.authority.budget.cumulativeUsed,
  );
}

/** 旧后端或摘要构建失败：保留原委托详情，不构造默认四问/成功/费用 0。 */
function LegacyPacketNotice({ readback }: { readback: ReadbackData }) {
  // 旧服务可能比 A2 legacy 样本更旧：缺 workState 时不能直接读 phase/reasonText/actionLabel。
  const workState: WorkState | undefined = readback.workState;
  return (
    <section aria-label="原任务工作包暂未提供" className={styles.root}>
      <p className={styles.legacyTitle}>
        当前摘要暂未提供（旧服务或构建失败）；以下保留原委托详情，不据此推断成功或无变化。
      </p>
      <dl className={styles.facts}>
        <div>
          <dt>原状态</dt>
          <dd>{readback.missionStatus || "未记录"}</dd>
        </div>
        {workState ? (
          <>
            <div>
              <dt>显示阶段</dt>
              <dd>{workPhaseLabel(workState.phase)}</dd>
            </div>
            <div>
              <dt>原因</dt>
              <dd>{workState.reasonText || "未记录"}</dd>
            </div>
            <div>
              <dt>原动作</dt>
              <dd>{workState.actionLabel || "未记录"}</dd>
            </div>
          </>
        ) : (
          <div>
            <dt>显示阶段</dt>
            <dd>原状态未提供（旧服务未返回委托工作状态）。</dd>
          </div>
        )}
      </dl>
      <p className={styles.note}>
        不显示默认四问、成功结论或费用 0；重新读取只读取原委托状态，不会推进成功观察。
      </p>
    </section>
  );
}

export function MissionWorkPacket({ readback, packet, missionId, onReload, disabled = false }: MissionWorkPacketProps) {
  const [message, setMessage] = useState("");

  // 读回尚未成功（加载中/失败/已清空）：不渲染四问，也不报成功。
  if (readback === null) return null;
  if (!packet) return <LegacyPacketNotice readback={readback} />;

  const versionAdvanced = packet.snapshot.consistency === "VERSION_ADVANCED";
  const retried = packet.snapshot.consistency === "RETRIED";
  const action = packet.next.primaryAction;
  const showAction = versionAdvanced || (action !== null && action.kind !== "NONE");

  function reloadWithMessage(text: string) {
    setMessage(text);
    onReload();
  }

  /** 唯一主动作：只做页面内定位或重新读取；不发起任何业务写入。 */
  function runAction() {
    if (versionAdvanced) {
      reloadWithMessage("已重新读取当前状态");
      return;
    }
    if (!action || action.kind === "NONE") return;
    switch (action.kind) {
      case "ANSWER_QUESTION": {
        const container = document.getElementById("mission-question");
        if (!container || !focusFirstControl(container)) {
          reloadWithMessage("原入口暂不可见，已重新读取");
        }
        return;
      }
      case "REVIEW_APPROVAL": {
        const approvalId = action.target?.kind === "APPROVAL" ? action.target.id : null;
        const container = approvalId ? approvalContainer(approvalId) : null;
        if (!container || !focusFirstControl(container)) {
          reloadWithMessage("原入口暂不可见，已重新读取");
        }
        return;
      }
      case "RESUME_DELEGATION": {
        const container = document.getElementById("mission-error-block");
        const button = container?.querySelector<HTMLButtonElement>("button:not([disabled])") ?? null;
        if (!container || !button) {
          reloadWithMessage("原入口暂不可见，已重新读取");
          return;
        }
        scrollIntoViewIfPossible(container);
        // 只聚焦恢复入口，不替用户点击；是否可继续仍由原服务端判断。
        button.focus();
        return;
      }
      case "VIEW_RESULT":
      case "CHECK_UNKNOWN_EFFECT": {
        const container = document.getElementById("mission-results");
        if (!container) {
          reloadWithMessage("原入口暂不可见，已重新读取");
          return;
        }
        focusRegion(container);
        return;
      }
      case "CHECK_STOP_SETTLEMENT":
      case "WAIT_FOR_OBSERVATION":
      case "RECHECK_AUTHORITY":
      case "REVIEW_FAILURE": {
        reloadWithMessage("已重新读取当前状态");
        return;
      }
    }
  }

  const done = packet.done;
  const basis = packet.basis;
  const stopped = packet.stopped;
  const next = packet.next;
  const observations = packet.observations;
  const authority = packet.authority;
  const primaryBlock = stopped.primaryBlock;
  const materialCount = basis.materialUses ? basis.materialUses.items.length : null;
  const reviewCount = basis.evidenceReviews ? basis.evidenceReviews.items.length : null;
  const costText = authority.budget.monetaryCost === null ? "费用未知，未估算" : String(authority.budget.monetaryCost);

  return (
    <section aria-label="原任务四问工作包" className={styles.root}>
      {versionAdvanced && (
        <p role="alert" className={styles.alert}>
          读取期间版本已推进，提交前必须重新核对。
        </p>
      )}
      {retried && (
        <p role="status" className={styles.status}>
          读取期间版本有变化，已重读并采用同一快照。
        </p>
      )}
      {showAction && (
        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.primary}
            data-mission-primary-action={versionAdvanced ? "RELOAD" : action?.kind}
            disabled={disabled}
            onClick={runAction}
          >
            {versionAdvanced ? "重新读取" : action?.label}
          </button>
          <p className={styles.actionNote}>
            只做页面内定位或重新读取；不提交批准、执行或创建替代任务。
          </p>
        </div>
      )}
      {message && (
        <p role="status" className={styles.status}>
          {message}
        </p>
      )}

      <div className={styles.questions}>
        <section aria-label="做到哪" className={styles.question}>
          <h4>做到哪</h4>
          {done.recentSteps.length > 0 ? (
            <ol className={styles.steps}>
              {done.recentSteps.map((step) => (
                <li key={step.id}>
                  <span>{step.note ?? step.toolName}</span>
                  <span className={styles.muted}>
                    {STEP_STATUS_LABELS[step.status] ?? step.status} · {formatTime(step.at, "时间未记录")}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p>最近工作窗口内没有已完成步骤记录；未找到记录不等于从未发生。</p>
          )}
          <p>
            最近草稿：
            {done.latestOutput
              ? `修订 ${done.latestOutput.revision} · ${formatTime(done.latestOutput.createdAt, "时间未记录")}`
              : "窗口内未记录"}
          </p>
          {done.progress && (
            <p className={styles.muted}>
              {done.progress.classes.map((item) => `${item.label} ${item.count}`).join(" · ")}
            </p>
          )}
          {done.actionReceipts.length > 0 && (
            <ul className={styles.steps}>
              {done.actionReceipts.map((receipt) => (
                <li key={receipt.actionId}>
                  <span>{receipt.title ?? receipt.actionId}</span>
                  <span className={styles.muted}>
                    {receipt.isSimulated ? "演示情境 · " : ""}
                    {receipt.status}
                    {receipt.resultCardId ? " · 已填写复盘回执" : " · 尚未填写复盘回执"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className={styles.note}>{done.note}</p>
          <p className={styles.note}>
            步骤窗口上限 {done.coverage.limit} 条{done.coverage.truncated ? "，已截断" : ""}；窗口内没有记录只表示覆盖不足。
          </p>
          <p className={styles.note}>
            现实结果：未从委托状态推断（{packet.realityOutcome}），以原行动回执为准。
          </p>
        </section>

        <section aria-label="依据是什么" className={styles.question}>
          <h4>依据是什么</h4>
          <p>关联原问题：{basis.questionId ?? "未记录"}</p>
          <p>
            原资料使用 {materialCount === null ? "未记录" : `${materialCount} 项`} · 证据审查{" "}
            {reviewCount === null ? "未记录" : `${reviewCount} 条`}
          </p>
          <p>
            {basis.currentUsePolicy === "SOURCE_POLICY_APPLIED"
              ? "当前依据可用性已按来源策略判定；历史留痕不等于当前可用。"
              : "旧服务或未应用来源策略：当前依据可用性未知，不能当作允许。"}
          </p>
          <p className={styles.note}>{basis.note}</p>
          <details className={styles.details}>
            <summary>展开依据、原文与纠正入口</summary>
            {readback ? (
              <MissionBasisEvidence
                packet={packet}
                readback={readback}
                missionId={missionId}
                onReload={onReload}
                disabled={disabled}
              />
            ) : (
              <p className={styles.note}>读回详情暂不可用，暂不能展开依据。</p>
            )}
          </details>
        </section>

        <section aria-label="为何停下" className={styles.question}>
          <h4>为何停下</h4>
          <p>
            当前阶段：{workPhaseLabel(stopped.workState.phase)} · 原状态：{stopped.missionStatus}
          </p>
          <p>
            {stopped.workState.reasonText || "原因未记录"}
            {stopped.workState.reasonCode ? `（${stopped.workState.reasonCode}）` : ""}
          </p>
          {primaryBlock && (
            <p>
              首要阻断：{primaryBlock.text} <span className={styles.code}>{primaryBlock.code}</span>
            </p>
          )}
          <p>{stopRequestText(stopped.stopRequest)}</p>
          <p>{unknownEffectText(stopped.unknownEffect)}</p>
          {packet.blockers.length > 0 && (
            <details className={styles.details}>
              <summary>全部阻断（{packet.blockers.length} 项）</summary>
              <ul className={styles.blockers}>
                {packet.blockers.map((blocker, index) => (
                  <li key={`${blocker.kind}:${blocker.code}:${blocker.at ?? ""}:${index}`}>
                    <span>{blocker.text}</span>
                    <span className={styles.code}>
                      {BLOCKER_KIND_LABELS[blocker.kind] ?? blocker.kind} · {blocker.code}
                      {blocker.at ? ` · ${formatTime(blocker.at)}` : ""}
                      {blocker.blocksActions ? " · 阻止操作" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className={styles.note}>{stopped.note}</p>
        </section>

        <section aria-label="现在等谁" className={styles.question}>
          <h4>现在等谁</h4>
          <p>等待：{WAITING_ON_LABELS[next.waitingOn] ?? "未记录"}</p>
          <p>下一步由谁：{NEXT_ACTOR_LABELS[next.nextActor] ?? next.nextActor}</p>
          <p>下次检查时间：{formatTime(next.nextCheckAt)}</p>
          <p>有效边界：{formatTime(next.nextBoundary)}</p>
          <p className={styles.note}>{next.note}</p>
        </section>
      </div>

      <section aria-label="观察时间" className={styles.observations}>
        <h4>观察时间</h4>
        <dl className={styles.facts}>
          <div>
            <dt>读取于</dt>
            <dd>{formatTime(observations.readAt)}</dd>
          </div>
          <div>
            <dt>最近成功观察</dt>
            <dd>{observations.lastSuccessfulAt ? formatTime(observations.lastSuccessfulAt) : "尚未有成功观察记录"}</dd>
          </div>
          <div>
            <dt>最近失败观察</dt>
            <dd>{formatTime(observations.lastFailedAt)}</dd>
          </div>
          {observations.state === "OBSERVED" && observations.lastNoNewInformationAt !== null && (
            <div>
              <dt>最近“无变化”结论</dt>
              <dd>{formatTime(observations.lastNoNewInformationAt)}</dd>
            </div>
          )}
          <div>
            <dt>观察状态</dt>
            <dd>{OBSERVATION_STATE_LABELS[observations.state]}</dd>
          </div>
          <div>
            <dt>下次计划观察</dt>
            <dd>{formatTime(observations.nextCheckAt)}</dd>
          </div>
        </dl>
        <p className={styles.note}>
          读取时间只表示本次读取；刷新页面不会推进成功观察，也不表示刚刚核查或资料没有变化。
        </p>
      </section>

      <details className={styles.details}>
        <summary>责任边界、权限与累计预算</summary>
        <dl className={styles.facts}>
          <div>
            <dt>权限状态</dt>
            <dd>{PERMISSION_LABELS[authority.permissionState]}</dd>
          </div>
          <div>
            <dt>权限到期</dt>
            <dd>{formatTime(authority.permissionExpiresAt)}</dd>
          </div>
          <div>
            <dt>委托期限</dt>
            <dd>{formatTime(authority.deadline)}</dd>
          </div>
          <div>
            <dt>最早有效边界</dt>
            <dd>{formatTime(authority.nextBoundary)}</dd>
          </div>
          <div>
            <dt>生效的下次检查</dt>
            <dd>{formatTime(authority.effectiveNextCheckAt)}</dd>
          </div>
          <div>
            <dt>后台 Worker</dt>
            <dd>{authority.workerPresence}（心跳不代表成功观察）</dd>
          </div>
          <div>
            <dt>费用</dt>
            <dd>{costText}</dd>
          </div>
          <div>
            <dt>原委托版本</dt>
            <dd>
              {packet.identity.missionVersion} · 原状态 {packet.identity.missionStatus} · 快照{" "}
              {packet.snapshot.consistency}
            </dd>
          </div>
        </dl>
        <p className={styles.subheading}>累计预算（只展示原计数；未知不补 0）</p>
        <ul className={styles.budget}>
          {budgetKeys(packet).map((key) => {
            const limit = authority.budget.limits[key];
            const used = authority.budget.cumulativeUsed[key];
            return (
              <li key={key}>
                <span>{BUDGET_LABELS[key] ?? key}</span>
                <span>
                  上限 {typeof limit === "number" ? limit.toLocaleString("zh-CN") : "未记录"} · 已记录累计{" "}
                  {used == null ? "未知" : used.toLocaleString("zh-CN")}
                </span>
              </li>
            );
          })}
        </ul>
        <p className={styles.note}>{packet.snapshot.note}</p>
        <p className={styles.note}>
          以上只是只读展示，不构成执行许可；提交仍由原服务端重查所有者、项目、版本、来源、权限、租约、预算与幂等。
        </p>
      </details>

      <details className={styles.details}>
        <summary>查询覆盖与“未找到”说明</summary>
        <ul className={styles.coverage}>
          {packet.coverage.windows.map((window) => (
            <li key={window.name}>
              <span>
                {COVERAGE_LABELS[window.name] ?? window.name}：返回 {window.returned}/{window.limit}
                {window.truncated ? "（已截断）" : ""}
              </span>
              <span className={styles.note}>{window.note}</span>
            </li>
          ))}
        </ul>
        <p className={styles.note}>
          {packet.coverage.policy === "NOT_FOUND_IS_NOT_NEVER"
            ? "未找到记录只表示有界窗口覆盖不足，不等于从未发生、从未使用或没有变化。"
            : packet.coverage.policy}
        </p>
      </details>
    </section>
  );
}
