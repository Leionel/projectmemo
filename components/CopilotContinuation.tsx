"use client";
import { useEffect, useRef, useState } from "react";
import { missionNavigationHref } from "@/lib/mission/navigation";
import type {
  CopilotContinuationSuggestion,
  CopilotMissionPreview,
  CopilotMissionReceipt,
} from "@/lib/types/copilotContinuation";
import { emitWorkspaceChange } from "@/lib/client/workspaceEvents";
export function CopilotContinuation({
  suggestion,
}: {
  suggestion: CopilotContinuationSuggestion;
}) {
  const [editing, setEditing] = useState(false),
    [goal, setGoal] = useState(suggestion.goal),
    [cloud, setCloud] = useState(false),
    [preview, setPreview] = useState<CopilotMissionPreview | null>(null),
    [receipt, setReceipt] = useState<CopilotMissionReceipt | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const requestId = useRef("");
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);
  if (suggestion.kind === "ANSWER_ONLY") return null;
  if (suggestion.kind === "OPEN_MISSION" && suggestion.mission) {
    const m = suggestion.mission;
    return (
      <div className="mt-3 border-t border-[var(--rule)] pt-3">
        <p className="text-xs">{suggestion.reason}</p>
        <a
          className="workspace-link focus-ring mt-2 inline-block"
          href={missionNavigationHref(suggestion.projectId, m.id, {
            questionId: m.questionId ?? undefined,
            approvalId: m.approvalId ?? undefined,
            outputId: m.outputId ?? undefined,
            revision: m.outputRevision ?? undefined,
          })}
        >
          继续此委托 →
        </a>
      </div>
    );
  }
  async function send(action: string, body: unknown) {
    const r = await fetch(
      `/api/projects/${suggestion.projectId}/agent/continuation/${action}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      },
    );
    const value = await r.json();
    if (!r.ok)
      throw new Error(value.error?.message ?? "未能接续，请重试读取原结果");
    return value;
  }
  async function review() {
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const v = await send("preview", {
        sourceRunId: suggestion.sourceRunId,
        goal,
        llmContextApproved: cloud,
      });
      if (!live.current) return;
      setPreview(v.preview);
      requestId.current = crypto.randomUUID();
    } catch (e) {
      if (!live.current) return;
      setError(e instanceof Error ? e.message : "预览失败");
    } finally {
      if (live.current) setBusy(false);
    }
  }
  async function confirm() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const v = await send("confirm", {
        sourceRunId: suggestion.sourceRunId,
        requestId: requestId.current,
        previewHash: preview.previewHash,
        confirmed: true,
      });
      if (!live.current) return;
      setReceipt(v.receipt);
      emitWorkspaceChange(suggestion.projectId, ["projects"]);
    } catch (e) {
      if (!live.current) return;
      setError(
        e instanceof Error ? e.message : "结果尚未确认，请用同一预览重试",
      );
    } finally {
      if (live.current) setBusy(false);
    }
  }
  return (
    <div
      className="mt-3 rounded-lg border border-[var(--rule)] p-3"
      aria-label="对话转长期委托"
    >
      <p className="text-xs">{suggestion.reason}</p>
      {receipt ? (
        <a
          className="workspace-link focus-ring"
          href={missionNavigationHref(receipt.projectId, receipt.missionId)}
        >
          查看已受理的原委托 →
        </a>
      ) : !editing ? (
        <button
          type="button"
          className="workspace-tool focus-ring mt-2"
          onClick={() => setEditing(true)}
        >
          交给长期委托
        </button>
      ) : (
        <div className="mt-2 space-y-2">
          <label className="block text-xs">
            委托目标
            <textarea
              aria-label="委托目标"
              className="editorial-input mt-1 w-full p-2"
              rows={3}
              value={goal}
              maxLength={2000}
              disabled={busy}
              onChange={(e) => {
                setGoal(e.target.value);
                setPreview(null);
              }}
            />
          </label>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={cloud}
              disabled={busy}
              onChange={(e) => {
                setCloud(e.target.checked);
                setPreview(null);
              }}
            />
            允许当前配置的云模型处理此委托所需的项目资料（受账户配额限制）
          </label>
          <p className="text-xs">
            只读取、分析并保存草稿；不联网研究，不创建或修改行动。资料不足时会等待补充。
          </p>
          {preview ? (
            <>
              <p className="text-xs">
                将创建1项委托；验收条件为保存草稿，内容仍需审阅。
              </p>
              <button
                type="button"
                className="editorial-button focus-ring"
                disabled={busy}
                onClick={() => void confirm()}
              >
                确认创建委托
              </button>
            </>
          ) : (
            <button
              type="button"
              className="workspace-tool focus-ring"
              disabled={busy || goal.trim().length < 3}
              onClick={() => void review()}
            >
              预览委托
            </button>
          )}
          <button
            type="button"
            className="workspace-tool focus-ring"
            disabled={busy}
            onClick={() => {
              setEditing(false);
              setPreview(null);
            }}
          >
            暂不创建
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-[var(--brick)]">
          {error}
        </p>
      )}
    </div>
  );
}
