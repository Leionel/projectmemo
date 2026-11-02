"use client";
import {projectHref} from "@/lib/projectNavigation";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { emitWorkspaceChange } from "@/lib/client/workspaceEvents";
import { AttachmentInbox } from "@/components/AttachmentInbox";
import { captureDraftKey, captureOwner, captureGeneration, onCaptureOwnerChange, writeCaptureDraft, clearCaptureDrafts } from "@/lib/client/captureDrafts";
import { CheckCircle2, LoaderCircle, Save, Sparkles } from "lucide-react";

const sources = [
  "随手记录",
  "论文笔记",
  "代码报错",
  "实验记录",
  "会议纪要",
  "老师建议",
  "比赛材料",
];

function newRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `capture-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type CaptureBoxProps = { projectId: string; ownerId: string; inboxEnabled?: boolean; onMaterialSaved?: (sourceId: string) => void; draftScope?: string };
export function CaptureBox(props: CaptureBoxProps) {
  return <CaptureForm key={captureDraftKey(props.ownerId, props.projectId, props.draftScope)} {...props} />;
}
function CaptureForm({ projectId, ownerId, inboxEnabled = true, onMaterialSaved, draftScope }: CaptureBoxProps) {
  const router = useRouter();
  const draftKey = captureDraftKey(ownerId, projectId, draftScope);
  const [text, setText] = useState("");
  const [sourceType, setSourceType] = useState(sources[0]);
  const [requestId, setRequestId] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [newCardId, setNewCardId] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    let timer: number;
    const restore = () => {
      window.clearTimeout(timer);
      if (captureOwner() !== ownerId) { setText(""); setRequestId(""); setMessage(null); setNewCardId(""); setDraftReady(false); return; }
      timer = window.setTimeout(() => {
      if (!mounted.current || captureOwner() !== ownerId) return;
      try {
        const saved = window.localStorage.getItem(draftKey);
        if (saved) {
          const draft = JSON.parse(saved) as {
            text?: string;
            sourceType?: string;
            requestId?: string;
          };
          setText(draft.text ?? "");
          setRequestId(draft.requestId ?? "");
          if (sources.includes(draft.sourceType ?? ""))
            setSourceType(draft.sourceType!);
        }
      } catch {
        writeCaptureDraft(draftKey, ownerId, null);
      }
      setDraftReady(true);
      }, 0);
    };
    const unsubscribe = onCaptureOwnerChange(restore);
    restore();
    return () => { window.clearTimeout(timer); unsubscribe(); };
  }, [draftKey, ownerId]);

  useEffect(() => {
    if (!draftReady) return;
    writeCaptureDraft(draftKey, ownerId, text ? { text, sourceType, requestId } : null);
  }, [draftKey, ownerId, draftReady, requestId, sourceType, text]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!draftReady || captureOwner() !== ownerId || loading) return;
    const submittedGeneration = captureGeneration();
    const current = () => mounted.current && captureOwner() === ownerId && captureGeneration() === submittedGeneration;
    setLoading(true);
    setMessage(null);
    setNewCardId("");
    const activeRequestId = requestId || newRequestId();
    setRequestId(activeRequestId);
    writeCaptureDraft(draftKey, ownerId, { text, sourceType, requestId: activeRequestId });
    try {
      const response = await fetch(`/api/projects/${projectId}/captures`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": activeRequestId,
        },
        body: JSON.stringify({ rawText: text, sourceType, requestId: activeRequestId }),
      });
      const data = await response.json().catch(() => null);
      if (!current()) return;
      if (response.status === 401) { clearCaptureDrafts(); window.dispatchEvent(new Event("projectmemo:session-changed")); return; }
      if (response.status === 403 || response.status === 404) {
        writeCaptureDraft(draftKey, ownerId, null); setText(""); setRequestId(""); setDraftReady(false);
        setMessage({ ok: false, text: "项目已不可访问，已停止使用本机草稿" }); return;
      }
      if (!response.ok)
        throw new Error(data?.error?.message ?? "沉淀失败，请稍后重试");
      setText("");
      setRequestId("");
      writeCaptureDraft(draftKey, ownerId, null);
      setNewCardId(data.card.id);
      if (data.card.captureId) onMaterialSaved?.(`capture:${data.card.captureId}`);
      setMessage({
        ok: true,
        text: `${data.replayed ? "已恢复" : "已保存"}《${data.card.title}》；${data.card.processing?.mode === "MODEL" ? "已用云模型整理，请核对内容" : data.card.processing?.reason ?? "整理方式未确认，请核对原文"}`,
      });
      emitWorkspaceChange(projectId, [
        "cards",
        "interventions",
        "metrics",
        "projects",
      ]);
      router.refresh();
    } catch (reason) {
      if (!current()) return;
      setMessage({
        ok: false,
        text: reason instanceof Error ? reason.message : "沉淀失败，请稍后重试",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section
      id="capture-box"
      className="card-surface scroll-mt-24 rounded-lg p-5 sm:p-6"
    >
      <div className="flex flex-col justify-between gap-4 border-b archive-rule pb-5 sm:flex-row sm:items-end">
        <div>
          <p className="archive-label">新建项目记录</p>
          <h2 className="mt-3 text-lg font-black">捕获一条项目碎片</h2>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            原文完整保存；生成的知识卡保留来源，属待核对的候选结论，不会自动当作已确认事实。
          </p>
        </div>
        <label className="text-xs font-bold text-[var(--ink-soft)]">
          记录来源
          <select
            aria-label="来源类型"
            value={sourceType}
            onChange={(event) => {
              const nextSource = event.target.value;
              setSourceType(nextSource);
              if (nextSource !== sourceType && requestId) setRequestId(newRequestId());
            }}
            disabled={!draftReady || loading}
            className="focus-ring editorial-input mt-1 block w-full px-3 py-2 text-sm font-semibold sm:w-auto"
          >
            {sources.map((source) => (
              <option key={source}>{source}</option>
            ))}
          </select>
        </label>
      </div>
      <form onSubmit={submit} className="mt-5" aria-busy={loading}>
        <textarea
          aria-label="碎片内容"
          aria-describedby="capture-help"
          value={text}
          onChange={(event) => {
            const nextText = event.target.value;
            setText(nextText);
            if (nextText !== text && requestId) setRequestId(newRequestId());
            setMessage(null);
          }}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter")
              event.currentTarget.form?.requestSubmit();
          }}
          disabled={!draftReady || loading}
          minLength={5}
          maxLength={5000}
          required
          rows={5}
          className="focus-ring editorial-input w-full resize-y p-4 leading-7 placeholder:text-[var(--placeholder)]"
          placeholder="例如：老师建议作品不要叫普通学习助手，要突出项目制学习和知识资产复用……"
        />
        <div
          id="capture-help"
          className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted)]"
        >
          <span>
            {!draftReady ? "正在恢复本机草稿…" : text ? (
              <span className="inline-flex items-center gap-1">
                <Save size={13} /> 草稿已自动保存在本机
              </span>
            ) : (
              "支持 Ctrl / ⌘ + Enter 快速提交"
            )}
          </span>
          <span>{text.length} / 5000</span>
        </div>
        <p className="mt-2 text-xs leading-5 text-[var(--ink-soft)]">
          保存后：原始记录留存 → 生成带来源的知识卡（待核对）→ 在「项目记忆与问答」中核对结论与时态；与已有记录冲突时会以对照呈现，不静默覆盖。
        </p>
        <div className="mt-3 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div
            aria-live="polite"
            className={`text-sm font-medium ${message?.ok ? "text-[var(--teal-strong)]" : "text-[var(--brick)]"}`}
          >
            {message && (
              <span className="inline-flex flex-wrap items-center gap-2">
                {message.ok && <CheckCircle2 size={16} />}
                {message.text}
                {message.ok && newCardId && (
                  <a
                    href={projectHref(projectId,`#card-${newCardId}`)}
                    className="focus-ring rounded-md underline underline-offset-4"
                  >
                    查看新卡片
                  </a>
                )}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              disabled={!draftReady || loading || text.trim().length < 5}
              className="focus-ring editorial-button disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <LoaderCircle className="animate-spin" size={18} />
              ) : (
                <Sparkles size={18} />
              )}
              {loading ? "正在保存并生成…" : "保存记录并生成知识卡"}
            </button>
          </div>
        </div>
      </form>
      <AttachmentInbox projectId={projectId} enabled={inboxEnabled} onMaterialSaved={onMaterialSaved} />
    </section>
  );
}
