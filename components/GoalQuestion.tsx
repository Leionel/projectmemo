"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GoalQuestion as Question } from "@/lib/decision/questions";
export function GoalQuestion({
  projectId,
  missionId,
  compact = false,
}: {
  projectId: string;
  missionId?: string;
  compact?: boolean;
}) {
  const [conversationEnabled, setConversationEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    void fetch("/api/conversations/capabilities", { cache: "no-store" }).then(r => r.ok ? r.json() : null)
      .then(v => { if (live) setConversationEnabled(v?.enabled === true); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const [q, setQ] = useState<Question | null>(null),
    [muted, setMuted] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [nonce, setNonce] = useState(0);
  const region = useRef<HTMLDivElement>(null),
    seen = useRef(new Set<string>()),
    keys = useRef(new Map<string, string>());
  const post = useCallback(
    async (question: Question, action: string) => {
      const key = `${question.questionId}:${question.contextHash}:${action}`;
      let id = keys.current.get(key);
      if (!id) {
        id = crypto.randomUUID();
        keys.current.set(key, id);
      }
      const r = await fetch(`/api/projects/${projectId}/goal-question`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: question.questionId,
          contextHash: question.contextHash,
          action,
          requestId: id,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const v = await r.json();
      if (!r.ok)
        throw Object.assign(new Error(v.error?.message ?? "问题反馈未保存"), {
          status: r.status,
        });
      return v;
    },
    [projectId],
  );
  useEffect(() => {
    let live = true;
    void fetch(`/api/projects/${projectId}/goal-question`, {
      cache: "no-store",
    })
      .then(async (r) => {
        const v = await r.json();
        if (!r.ok) throw new Error(v.error?.message ?? "当前问题暂不可读");
        if (!live) return;
        setMuted(v.mutedMissionId ?? null);
        if (!v.question || (missionId && v.question.missionId !== missionId)) {
          setQ(null);
          return;
        }
        const presented = await post(v.question, "PRESENT");
        if (live) setQ(presented.allowed ? presented.question : null);
      })
      .catch((e) => {
        if (live) {
          setQ(null);
          setError(e.message);
        }
      });
    return () => {
      live = false;
    };
  }, [projectId, missionId, nonce, post]);
  useEffect(() => {
    if (!q || !region.current || !window.IntersectionObserver) return;
    const question = q;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5) &&
          !seen.current.has(question.contextHash)
        ) {
          seen.current.add(question.contextHash);
          void post(question, "EXPOSED").catch(() =>
            seen.current.delete(question.contextHash),
          );
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(region.current);
    return () => observer.disconnect();
  }, [q, post]);
  async function respond(action: string) {
    if (!q || busy) return;
    setBusy(true);
    setError("");
    try {
      await post(q, action);
      if (["UNKNOWN", "LATER", "STOP", "NOT_USEFUL"].includes(action)) {
        setMuted(q.missionId);
        setQ(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "反馈失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      ref={region}
      className="mt-3 space-y-2 text-sm"
      aria-label="当前目标的一项问题"
    >
      {q && (
        <>
          {!compact && <h3 className="font-bold">{q.text}</h3>}
          <p>{q.whyNow}</p>
          <p className="text-xs text-[var(--muted)]">
            {q.answerability} {q.unansweredConsequence}
          </p>
          <a className="workspace-link focus-ring" href={q.href}>
            {q.kind === "WAITING_INPUT"
              ? "补充到原问题 →"
              : "核对并接续原委托 →"}
          </a>
          {conversationEnabled && <a className="workspace-link focus-ring" href={"/focus?entryKind=GOAL_QUESTION&entryId=" + encodeURIComponent(q.questionId) + "&entryProject=" + encodeURIComponent(projectId)}>围绕这项问题追问</a>}
          <div className="flex flex-wrap gap-2">
            {[
              ["UNKNOWN", "我还不知道"],
              ["LATER", "明天再看"],
              ["STOP", "停止此委托的主动追问"],
              ["WORTH_IT", "这项问题有用"],
              ["NOT_USEFUL", "这次没有帮助"],
            ].map(([action, label]) => (
              <button
                key={action}
                className="workspace-tool focus-ring"
                disabled={busy}
                onClick={() => void respond(action)}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
      {muted && (
        <p className="text-xs text-[var(--muted)]">
          已按你的选择减少这项追问。
          <button
            className="workspace-link focus-ring ml-2"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void fetch(`/api/missions/${muted}/goal-question-preference`, {
                method: "DELETE",
              })
                .then((r) => {
                  if (!r.ok) throw new Error("恢复失败，请重新读取");
                  setMuted(null);
                  setNonce((n) => n + 1);
                })
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            恢复该委托的问题提示
          </button>
        </p>
      )}
      {error && (
        <p role="status" className="text-[var(--brick)]">
          {error}
          <button
            className="workspace-link focus-ring ml-2"
            onClick={() => {
              setError("");
              setNonce((n) => n + 1);
            }}
          >
            重新读取问题
          </button>
        </p>
      )}
    </div>
  );
}
