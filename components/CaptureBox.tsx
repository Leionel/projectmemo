"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { emitWorkspaceChange } from "@/lib/client/workspaceEvents";
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

export function CaptureBox({ projectId }: { projectId: string }) {
  const router = useRouter();
  const draftKey = `projectmemo:capture:${projectId}`;
  const [text, setText] = useState("");
  const [sourceType, setSourceType] = useState(sources[0]);
  const [draftReady, setDraftReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [newCardId, setNewCardId] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(draftKey);
        if (saved) {
          const draft = JSON.parse(saved) as {
            text?: string;
            sourceType?: string;
          };
          setText(draft.text ?? "");
          if (sources.includes(draft.sourceType ?? ""))
            setSourceType(draft.sourceType!);
        }
      } catch {
        window.localStorage.removeItem(draftKey);
      }
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [draftKey]);

  useEffect(() => {
    if (!draftReady) return;
    if (text)
      window.localStorage.setItem(
        draftKey,
        JSON.stringify({ text, sourceType }),
      );
    else window.localStorage.removeItem(draftKey);
  }, [draftKey, draftReady, sourceType, text]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    setNewCardId("");
    try {
      const response = await fetch(`/api/projects/${projectId}/captures`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: text, sourceType }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(data?.error?.message ?? "沉淀失败，请稍后重试");
      setText("");
      window.localStorage.removeItem(draftKey);
      setNewCardId(data.card.id);
      setMessage({ ok: true, text: `已生成《${data.card.title}》知识卡片` });
      emitWorkspaceChange(projectId, [
        "cards",
        "interventions",
        "metrics",
        "projects",
      ]);
      router.refresh();
    } catch (reason) {
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
      className="card-surface scroll-mt-24 rounded-[1.5rem] p-5 sm:p-6"
    >
      <div className="flex flex-col justify-between gap-4 border-b archive-rule pb-5 sm:flex-row sm:items-end">
        <div>
          <p className="archive-label">新建项目记录</p>
          <h2 className="mt-3 text-lg font-black">捕获一条项目碎片</h2>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            无需整理，Agent 会自动分类、提炼并关联历史知识。
          </p>
        </div>
        <label className="text-xs font-bold text-[var(--ink-soft)]">
          记录来源
          <select
            aria-label="来源类型"
            value={sourceType}
            onChange={(event) => setSourceType(event.target.value)}
            disabled={loading}
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
            setText(event.target.value);
            setMessage(null);
          }}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter")
              event.currentTarget.form?.requestSubmit();
          }}
          disabled={loading}
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
            {text && draftReady ? (
              <span className="inline-flex items-center gap-1">
                <Save size={13} /> 草稿已自动保存在本机
              </span>
            ) : (
              "支持 Ctrl / ⌘ + Enter 快速提交"
            )}
          </span>
          <span>{text.length} / 5000</span>
        </div>
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
                    href={`#card-${newCardId}`}
                    className="focus-ring rounded-md underline underline-offset-4"
                  >
                    查看新卡片
                  </a>
                )}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <label className="focus-ring flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-[var(--rule-strong)] bg-[var(--card-bg)] px-4 py-2.5 text-sm font-bold text-[var(--ink)] shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--teal)] hover:bg-[var(--paper-strong)]">
              <input
                type="file"
                accept=".txt,.md,.pdf,.csv,.json,.docx"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.[0]) {
                    setMessage({
                      ok: true,
                      text: `已选中文件：${e.target.files[0].name} (即将支持解析)`,
                    });
                  }
                }}
              />
              <span>上传文档资料</span>
            </label>
            <button
              disabled={loading || text.trim().length < 5}
              className="focus-ring editorial-button disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <LoaderCircle className="animate-spin" size={18} />
              ) : (
                <Sparkles size={18} />
              )}
              {loading ? "Agent 正在沉淀…" : "沉淀为知识资产"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
