"use client";

import { useEffect, useState } from "react";

type Responsibility = {
  schemaVersion: number;
  missionId: string;
  projectId: string;
  controlVersion: string;
  goal: string;
  successCriteria: string[];
  workingObjective?: string | null;
  constraints: Record<string, unknown>;
  researchScope: Record<string, unknown>;
  continuationPolicy: Record<string, unknown>;
  deadline: string | null;
  permissionExpiresAt: string | null;
  permissionState: string;
  budget: {
    limits: Record<string, number>;
    cumulativeUsed: Record<string, number>;
    additionalUsed?: Record<string, unknown>;
    policy: string;
    monetaryCost: string | null;
  };
  workState: {
    phase: string;
    description: string;
    nextCheckAt?: string | null;
  };
  pendingOriginalRefs?: {
    questionId: string | null;
    approvalIds: string[];
  };
  nextCheckAt: string | null;
  workerPresence: "UNOBSERVED" | "RECENT" | "STALE";
  workerPresenceDetail?: {
    workerId: string | null;
    lastHeartbeatAt: string | null;
    lastScanAt: string | null;
  } | null;
  activity: Array<{ id: string; sequence: number; kind: string; at: string }>;
};

const presenceLabels: Record<string, string> = {
  RECENT: "后台正常（最近有活跃观察）",
  STALE: "心跳超时（未在近期收到心跳）",
  UNOBSERVED: "未观察到 Worker 进程",
};

const permissionLabels: Record<string, string> = {
  WITHIN_TIME_BOUNDARY: "在许可有效期内",
  EXPIRED: "许可已到期",
  STOPPED: "已由用户停止",
};

export function MissionResponsibilityPanel({
  missionId,
  onRevised,
}: {
  missionId: string;
  onRevised?: () => void;
}) {
  const [data, setData] = useState<Responsibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Edit draft states
  const [goalDraft, setGoalDraft] = useState("");
  const [deadlineDraft, setDeadlineDraft] = useState("");

  useEffect(() => {
    const abort = new AbortController();
    void fetch(`/api/missions/${missionId}/responsibility`, { signal: abort.signal })
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error?.message ?? "无法加载责任视图");
        setData(body.responsibility);
        setGoalDraft(body.responsibility.goal);
        setDeadlineDraft(body.responsibility.deadline ?? "");
        setError("");
      })
      .catch(e => {
        if (!abort.signal.aborted) {
          setError(e instanceof Error ? e.message : "加载失败");
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) {
          setLoading(false);
        }
      });
    return () => abort.abort();
  }, [missionId, refreshTrigger]);

  async function handleRevise() {
    if (!data) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/missions/${missionId}/responsibility`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          expectedControlVersion: data.controlVersion,
          goal: goalDraft,
          constraints: {
            ...data.constraints,
            deadline: deadlineDraft ? new Date(deadlineDraft).toISOString() : null,
          },
        }),
      });
      const resBody = await res.json();
      if (!res.ok) throw new Error(resBody.error?.message ?? "修订失败");
      setData(resBody.responsibility);
      setEditing(false);
      setRefreshTrigger(v => v + 1);
      onRevised?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "修订失败");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) {
    return <div className="p-4 text-sm text-neutral-500">正在读取责任合同...</div>;
  }

  if (!data) {
    return error ? <div className="p-4 text-sm text-red-500">{error}</div> : null;
  }

  const { budget, workerPresence, permissionState, deadline, permissionExpiresAt } = data;

  return (
    <div className="border rounded-lg p-4 bg-white shadow-sm space-y-4 my-3 text-sm">
      <div className="flex justify-between items-center border-b pb-2">
        <h4 className="font-semibold text-base text-neutral-800">长期责任与授权合同</h4>
        <span
          className={`px-2 py-0.5 text-xs rounded font-medium ${
            workerPresence === "RECENT"
              ? "bg-emerald-100 text-emerald-800"
              : workerPresence === "STALE"
              ? "bg-amber-100 text-amber-800"
              : "bg-neutral-100 text-neutral-700"
          }`}
        >
          {presenceLabels[workerPresence] ?? workerPresence}
        </span>
      </div>

      {error && <div className="text-red-600 bg-red-50 p-2 rounded text-xs">{error}</div>}

      {!editing ? (
        <div className="space-y-3">
          <div>
            <span className="font-medium text-neutral-700">办什么：</span>
            <p className="mt-0.5 text-neutral-900 bg-neutral-50 p-2 rounded border border-neutral-100">
              {data.goal}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-neutral-500 block text-xs">目标截止时间 (deadline)</span>
              <span className="font-medium text-neutral-800">
                {deadline ? new Date(deadline).toLocaleString("zh-CN") : "未限定"}
              </span>
            </div>
            <div>
              <span className="text-neutral-500 block text-xs">持续许可到期 (expiresAt)</span>
              <span className="font-medium text-neutral-800">
                {permissionExpiresAt ? new Date(permissionExpiresAt).toLocaleString("zh-CN") : "手动模式"}
                <span className="ml-1 text-xs text-neutral-500">({permissionLabels[permissionState] ?? permissionState})</span>
              </span>
            </div>
          </div>

          <div className="bg-neutral-50 p-3 rounded border border-neutral-100">
            <span className="text-xs font-medium text-neutral-600 block mb-1">
              累计消耗与总包（永不清零）
            </span>
            <div className="flex gap-4 text-xs text-neutral-700">
              <div>模型：<span className="font-semibold">{budget.cumulativeUsed.models ?? 0}</span> / {budget.limits.maxModels ?? "-"}</div>
              <div>工具：<span className="font-semibold">{budget.cumulativeUsed.tools ?? 0}</span> / {budget.limits.maxTools ?? "-"}</div>
              <div>未知请求 (UNKNOWN)：<span className="font-semibold">{budget.cumulativeUsed.unknownCalls ?? 0}</span></div>
              <div>元数据请求：<span className="font-semibold">{budget.cumulativeUsed.metadataRequests ?? 0}</span></div>
            </div>
          </div>

          {data.nextCheckAt && (
            <div className="text-xs text-neutral-500">
              下次计划核对时间：{new Date(data.nextCheckAt).toLocaleString("zh-CN")}
            </div>
          )}

          <div className="pt-2 flex justify-end">
            <button
              onClick={() => setEditing(true)}
              className="px-3 py-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded text-xs font-medium transition"
            >
              原子修订合同
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">修订目标</label>
            <textarea
              className="w-full border rounded p-2 text-sm"
              rows={3}
              value={goalDraft}
              onChange={e => setGoalDraft(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">目标截止时间</label>
            <input
              type="datetime-local"
              className="border rounded p-1.5 text-sm"
              value={deadlineDraft ? deadlineDraft.slice(0, 16) : ""}
              onChange={e => setDeadlineDraft(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              disabled={busy}
              onClick={() => setEditing(false)}
              className="px-3 py-1.5 border rounded text-xs text-neutral-600 hover:bg-neutral-50"
            >
              取消
            </button>
            <button
              disabled={busy || !goalDraft.trim()}
              onClick={() => void handleRevise()}
              className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? "正在保存..." : "确认修订（失效原有提案）"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
