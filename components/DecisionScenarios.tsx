"use client";
import { useRef, useState } from "react";
import type { Scenario } from "@/lib/decision/scenarios";
type Proposal = {
  id: string;
  proposalHash: string;
  revision: number;
  status: string;
  expiresAt: string;
  stale?: boolean;
  currentVersion?: number;
  base: {
    expectedVersion: number;
    goal: string;
    successCriteria: unknown;
    availableMinutes: number;
  };
  scenarios: Array<
    Scenario & { modelTradeoff?: string; modelProvider?: string }
  >;
  receipt: unknown;
};
async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(25000),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const v = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(v.error?.message ?? "方案暂不可用"), {
      status: r.status,
    });
  return v;
}
function criteriaText(value: unknown) {
  const labels: Record<string, string> = {
    DRAFT_EXISTS: "保存一份草稿",
    ACTION_CREATED: "创建行动并留下回执",
    APPROVAL_CONSUMED: "经用户批准执行提案",
    REQUIRED_INPUT_PRESENT: "补充所需资料",
  };
  return (Array.isArray(value) ? value : [])
    .map((v) =>
      typeof v === "string"
        ? (labels[v] ?? "核对原委托条件")
        : `至少 ${v.minimum ?? "指定数量"} 条来源`,
    )
    .join("、");
}
export function DecisionScenarios({
  missionId,
  disabled = false,
  onAdopted,
}: {
  missionId: string;
  disabled?: boolean;
  onAdopted?: () => void;
}) {
  const keys = useRef(new Map<string, string>()),
    loaded = useRef(false);
  const [available, setAvailable] = useState(""),
    [estimate, setEstimate] = useState(""),
    [cloud, setCloud] = useState(false),
    [allowActions, setAllowActions] = useState(false),
    [proposal, setProposal] = useState<Proposal | null>(null),
    [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [receipt, setReceipt] = useState<{
      planRevision: number;
      missionId: string;
    } | null>(null);
  function requestId(body: unknown) {
    const hash = JSON.stringify(body);
    let id = keys.current.get(hash);
    if (!id) {
      id = crypto.randomUUID();
      keys.current.set(hash, id);
    }
    return id;
  }
  async function perform(work: () => Promise<void>, readOnly = false) {
    if ((disabled && !readOnly) || busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      if (e instanceof Error && "status" in e && Number(e.status) === 409)
        setProposal((p) => (p ? { ...p, stale: true } : p));
      if (
        e instanceof Error &&
        "status" in e &&
        [401, 403, 404].includes(Number(e.status))
      ) {
        setProposal(null);
        setAvailable("");
        setEstimate("");
        setSelected("");
        setCloud(false);
        setAllowActions(false);
      }
      setError(e instanceof Error ? e.message : "方案读取失败");
    } finally {
      setBusy(false);
    }
  }
  const stale =
    proposal?.stale === true ||
    (!!proposal && new Date(proposal.expiresAt) <= new Date());
  return (
    <details
      onToggle={(e) => {
        if (e.currentTarget.open && !loaded.current) {
          loaded.current = true;
          void perform(async () => {
            const v = await api(
              `/api/missions/${missionId}/decision-scenarios`,
            );
            setProposal(v.proposal);
            setReceipt(v.proposal?.receipt ?? null);
          },true);
        }
      }}
      className="mt-4 border-t border-[var(--rule)] pt-3"
    >
      <summary className="focus-ring cursor-pointer text-sm font-bold">
        对比本轮推进方案
      </summary>
      <div className="mt-3 space-y-3 text-sm leading-6">
        <p>
          保留原目标和成功条件，比较先核对依据与先整理草稿的取舍。采用只更新当前委托，不创建新的任务或日历安排。
        </p>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void perform(async () => {
              const body = {
                availableMinutes: Number(available),
                deliveryMinutes: Number(estimate),
                requestModelAdvice: cloud,
                allowActionProposals: allowActions,
                ...(proposal &&
                !["CONFIRMED", "REJECTED"].includes(proposal.status)
                  ? { parentId: proposal.id }
                  : {}),
              };
              const v = await api(
                `/api/missions/${missionId}/decision-scenarios`,
                "POST",
                { ...body, requestId: requestId(body) },
              );
              setProposal(v.proposal);
              setReceipt(null);
            });
          }}
        >
          <label>
            这轮最多可投入几分钟
            <input
              className="editorial-input block w-full p-2"
              type="number"
              min={1}
              max={100000}
              required
              value={available}
              onChange={(e) => setAvailable(e.target.value)}
            />
          </label>
          <label>
            你估计最小草稿需要几分钟
            <input
              className="editorial-input block w-full p-2"
              type="number"
              min={1}
              max={100000}
              required
              value={estimate}
              onChange={(e) => setEstimate(e.target.value)}
            />
          </label>
          <label className="flex items-start gap-2 sm:col-span-2">
            <input
              type="checkbox"
              checked={allowActions}
              onChange={(e) => setAllowActions(e.target.checked)}
            />
            允许「先整理草稿」方案提议行动；创建行动仍需逐项批准
          </label>
          <label className="flex items-start gap-2 sm:col-span-2">
            <input
              type="checkbox"
              checked={cloud}
              onChange={(e) => setCloud(e.target.checked)}
            />
            另请已授权的云模型补充一轮定性权衡（占用原委托与账户额度）
          </label>
          <button
            disabled={disabled || busy}
            className="workspace-tool focus-ring justify-self-start"
          >
            {busy
              ? "正在核对方案…"
              : proposal
                ? "更新对比预览"
                : "生成对比预览"}
          </button>
        </form>
        {proposal && (
          <>
            <p>原目标：{proposal.base.goal}</p>
            <p>
              原成功条件：{criteriaText(proposal.base.successCriteria)} ·
              本轮上限 {proposal.base.availableMinutes} 分钟 · 修订{" "}
              {proposal.revision}/3
            </p>
            {stale && (
              <p role="status" className="text-[var(--brick)]">
                这份预览已陈旧，请更新对比；原选择保留。
              </p>
            )}
            <fieldset
              className="grid gap-3 md:grid-cols-3"
              disabled={
                busy || disabled || stale || proposal.status !== "READY"
              }
            >
              <legend className="mb-2 font-bold">选择要采用的方案</legend>
              {proposal.scenarios.map((s) => (
                <label
                  key={s.key}
                  className={`block rounded-lg border p-3 ${selected === s.key ? "border-[var(--teal)] bg-[var(--teal-pale)]" : "border-[var(--rule)]"}`}
                >
                  <span className="font-bold">
                    {s.key !== "BASELINE" && (
                      <input
                        className="mr-2"
                        type="radio"
                        aria-label={s.title}
                        name={`decision-${missionId}`}
                        value={s.key}
                        checked={selected === s.key}
                        onChange={() => setSelected(s.key)}
                        disabled={s.feasibility !== "READY"}
                      />
                    )}{" "}
                    {s.title}
                  </span>
                  <p>
                    {s.minutes === null ? "时长未知" : `${s.minutes} 分钟`} ·{" "}
                    {s.estimateSource}
                  </p>
                  <p>{s.tradeoff}</p>
                  <p>
                    {s.executionBoundary === "READ_ANALYZE"
                      ? "仅读取、分析和保存草稿"
                      : "可提议行动；创建仍需批准"}
                  </p>
                  {s.reasons.map((r) => (
                    <p className="text-[var(--brick)]" key={r}>
                      {r}
                    </p>
                  ))}
                  {s.modelTradeoff ? (
                    <p>模型补充（不改变计算结果）：{s.modelTradeoff}</p>
                  ) : (
                    <p className="text-xs text-[var(--muted)]">
                      规则对比，未使用模型权衡
                    </p>
                  )}
                </label>
              ))}
            </fieldset>
            {proposal.status === "BUILDING" && (
              <p>
                模型权衡仍在处理中，可重新读取同一方案；不会再次发起模型请求。
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                className="workspace-tool focus-ring"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    const v = await api(
                      `/api/decision-scenarios/${proposal.id}`,
                    );
                    setProposal(v.proposal);
                    setReceipt(v.proposal.receipt ?? null);
                  },true)
                }
              >
                重新读取原方案
              </button>
              <button
                className="editorial-button focus-ring"
                disabled={
                  busy ||
                  disabled ||
                  stale ||
                  !selected ||
                  proposal.status !== "READY"
                }
                onClick={() =>
                  void perform(async () => {
                    const body = {
                      proposalHash: proposal.proposalHash,
                      scenarioKey: selected,
                      expectedVersion:
                        proposal.currentVersion ??
                        proposal.base.expectedVersion,
                      confirmed: true,
                    };
                    const v = await api(
                      `/api/decision-scenarios/${proposal.id}`,
                      "POST",
                      {
                        ...body,
                        requestId: requestId({ id: proposal.id, ...body }),
                      },
                    );
                    setReceipt(v.receipt);
                    setProposal({ ...proposal, status: "CONFIRMED" });
                    onAdopted?.();
                  })
                }
              >
                采用到原委托
              </button>
              <button
                className="workspace-tool focus-ring"
                disabled={busy || disabled || proposal.status !== "READY"}
                onClick={() =>
                  void perform(async () => {
                    await api(
                      `/api/decision-scenarios/${proposal.id}`,
                      "DELETE",
                    );
                    setProposal({ ...proposal, status: "REJECTED" });
                  })
                }
              >
                保留原计划，不采用
              </button>
            </div>
          </>
        )}
        {receipt && (
          <p role="status">
            已采用到同一委托，计划修订为 {receipt.planRevision}
            ；原步骤、草稿和回执保留。请核对当前状态后继续。
          </p>
        )}
        {error && (
          <p role="alert" className="text-[var(--brick)]">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
