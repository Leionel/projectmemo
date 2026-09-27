"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, History, LoaderCircle, Paperclip, Pencil, RefreshCw } from "lucide-react";
import { emitWorkspaceChange } from "@/lib/client/workspaceEvents";

type Attachment = {
  id: string;
  type: string;
  fileName: string;
  size: number;
  extractedText: string | null;
  extractionStatus: string;
  extractionError: string | null;
  createdAt: string;
};

type Revision = { revisionIndex: number; source: string; text: string; createdAt: string };

const statusCopy: Record<string, { label: string; className: string }> = {
  SUCCESS: { label: "已提取并沉淀为记忆", className: "bg-[var(--teal-pale)] text-[var(--teal-strong)]" },
  NEEDS_OCR: { label: "待处理：需要 OCR", className: "bg-[var(--amber)]/15 text-[var(--amber)]" },
  PENDING: { label: "待处理", className: "bg-[var(--amber)]/15 text-[var(--amber)]" },
  FAILED: { label: "提取失败", className: "bg-[var(--brick-pale)] text-[var(--brick)]" },
};

const revisionSourceLabels: Record<string, string> = {
  EXTRACTION: "机器提取",
  EXTRACTION_RETRY: "重新提取",
  MANUAL_CORRECTION: "人工校对",
};

/** 附件路由的错误体是 { error: string }，与其他路由的 { error: { message } } 不同 */
function readError(data: unknown, fallback: string) {
  const error = (data as { error?: unknown } | null)?.error;
  if (typeof error === "string" && error) return error;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && message ? message : fallback;
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 附件收件箱：上传 PDF / 图片，如实展示提取结果。
 *
 * 当前环境没有可用的 OCR 或视觉 provider 时，附件保存为「待处理」并说明原因，
 * 不会伪造一条提取成功的记忆；用户可以重试提取，或直接人工校对文本进入记忆。
 */
export function AttachmentInbox({ projectId, enabled }: { projectId: string; enabled: boolean }) {
  const router = useRouter();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [correctFor, setCorrectFor] = useState<string | null>(null);
  const [correctText, setCorrectText] = useState("");
  const [expectedText, setExpectedText] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<Revision[] | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/attachments`);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readError(data, "读取附件列表失败"));
      setAttachments(Array.isArray(data) ? data as Attachment[] : []);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取附件列表失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // 挂载后异步拉取；setState 均发生在 await 之后
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (enabled) void load();
  }, [enabled, load]);

  if (!enabled) return null;

  function replaceAttachment(next: Attachment) {
    setAttachments((old) => old.map((item) => item.id === next.id ? next : item));
  }

  async function upload(file: File) {
    setBusy("upload");
    setMessage("");
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`/api/projects/${projectId}/attachments`, { method: "POST", body: form });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const reason = readError(data, "附件上传失败");
        // 服务端按文件内容校验，原因是英文；这里补一句用户能懂的说明，同时保留真实原因
        throw new Error((data as { error?: { code?: string } } | null)?.error?.code === "ATTACHMENT_INVALID"
          ? `这个文件没有被接受：忆程只支持 PDF 与图片，并按文件内容校验类型（服务端原因：${reason}）`
          : reason);
      }
      const attachment = data.attachment as Attachment;
      replaceAttachment(attachment);
      await load();
      if (data.isDuplicate) {
        setMessage(`《${attachment.fileName}》此前已经上传过，已复用原记录，没有重复保存。`);
      } else if (attachment.extractionStatus === "SUCCESS") {
        setMessage(`《${attachment.fileName}》已归档，并沉淀为项目记忆。`);
        emitWorkspaceChange(projectId, ["cards", "interventions", "metrics", "projects"]);
        router.refresh();
      } else if (attachment.extractionStatus === "NEEDS_OCR") {
        setMessage(`《${attachment.fileName}》已保存；当前环境需要 OCR，未生成伪造记忆。可以重试提取，或直接人工校对内容。`);
      } else {
        setMessage(`《${attachment.fileName}》已保存，但提取失败：${attachment.extractionError ?? "未知原因"}。可以重试，或人工校对内容。`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "附件上传失败");
    } finally {
      setBusy(null);
    }
  }

  async function retry(attachment: Attachment) {
    setBusy(attachment.id);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/attachments/${attachment.id}/retry`, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readError(data, "重试提取失败"));
      replaceAttachment(data.attachment as Attachment);
      if (data.attachment?.extractionStatus === "SUCCESS") {
        setMessage(`《${attachment.fileName}》已提取并沉淀为项目记忆。`);
        emitWorkspaceChange(projectId, ["cards", "interventions", "metrics", "projects"]);
        router.refresh();
      } else {
        setMessage(`《${attachment.fileName}》仍然无法自动提取（${data.attachment?.extractionError ?? "当前环境缺少 OCR 能力"}）。文件已保留，可人工校对内容。`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "重试提取失败");
    } finally {
      setBusy(null);
    }
  }

  async function openCorrection(attachment: Attachment) {
    if (correctFor === attachment.id) {
      setCorrectFor(null);
      setRevisions(null);
      return;
    }
    setCorrectFor(attachment.id);
    setCorrectText(attachment.extractedText ?? "");
    setExpectedText(attachment.extractedText);
    setRevisions(null);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/attachments/${attachment.id}/revisions`);
      const data = await response.json().catch(() => null);
      if (response.ok) setRevisions(data.revisions as Revision[]);
    } catch {
      // 修订链读取失败不阻塞校对：仍可提交，服务端会做原版本校验
    }
  }

  async function submitCorrection(attachment: Attachment) {
    if (correctText.trim().length < 2) {
      setError("校对文本不能为空且至少 2 个字符。");
      return;
    }
    setBusy(attachment.id);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/attachments/${attachment.id}/correct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correctedText: correctText.trim(), expectedCurrentText: expectedText }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        // 原版本校验失败：重新载入最新文本，不把别人的校对覆盖掉
        if (String((data as { error?: { code?: string } } | null)?.error?.code ?? "").includes("ATTACHMENT_TEXT_CHANGED") || readError(data, "").includes("已被其他校对修改")) {
          await load();
          setCorrectFor(null);
          setError(readError(data, "附件文本已被其他校对修改") + "。已重新载入最新内容，请再校对一次。");
          return;
        }
        throw new Error(readError(data, "校对失败，请稍后重试"));
      }
      replaceAttachment(data.attachment as Attachment);
      setCorrectFor(null);
      setRevisions(null);
      setMessage(data.idempotentReplay
        ? "这段文本此前已经校对过，已返回当时的结果，没有重复建卡。"
        : "校对成功！已保存校对内容并生成项目记忆，旧版本仍保留在修订链里。");
      emitWorkspaceChange(projectId, ["cards", "interventions", "metrics", "projects"]);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "校对失败，请稍后重试");
    } finally {
      setBusy(null);
    }
  }

  const pending = attachments.filter((item) => item.extractionStatus !== "SUCCESS");

  return <div className="mt-4 rounded-xl border border-[var(--rule)] bg-[var(--card-bg)] p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="flex items-center gap-1.5 text-xs font-black text-[var(--navy)]"><Paperclip size={14} className="text-[var(--teal-strong)]" />附件资料（PDF / 图片）</p>
      <label className="focus-ring inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--rule-strong)] bg-[var(--paper-strong)] px-2.5 py-1.5 text-xs font-bold text-[var(--ink-soft)] transition hover:border-[var(--teal)] hover:text-[var(--teal-strong)]">
        <input type="file" accept=".pdf,image/png,image/jpeg,image/webp,image/gif,image/bmp" className="hidden" disabled={busy !== null} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
        {busy === "upload" ? <LoaderCircle size={13} className="animate-spin" /> : <FileUp size={13} />}{busy === "upload" ? "上传中…" : "上传附件"}
      </label>
    </div>
    <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">单个文件不超过 20MB，服务端按文件内容校验类型。相同文件不会重复保存；没有 OCR 能力时如实标记为待处理，不伪造记忆。</p>

    {message && <p role="status" className="mt-2 rounded-lg bg-[var(--teal-pale)] px-2.5 py-1.5 text-[11px] font-semibold leading-5 text-[var(--teal-strong)]">{message}</p>}
    {error && <p role="alert" className="mt-2 rounded-lg bg-[var(--brick-pale)] px-2.5 py-1.5 text-[11px] font-semibold leading-5 text-[var(--brick)]">{error}</p>}

    {loading && <p className="mt-2 text-[11px] text-[var(--muted)]">正在读取附件列表…</p>}

    {!loading && pending.length > 0 && <div className="mt-2.5">
      <p className="text-[11px] font-black text-[var(--amber)]">待处理附件（{pending.length}）· 退出重进仍可恢复重试</p>
      <ul className="mt-1.5 space-y-1.5">
        {pending.map((attachment) => {
          const status = statusCopy[attachment.extractionStatus] ?? statusCopy.PENDING;
          return <li key={attachment.id} className="rounded-lg bg-[var(--paper-strong)] p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 truncate text-[11px] font-bold text-[var(--navy)]">{attachment.fileName}</span>
              <span className="text-[10px] text-[var(--muted)]">{formatSize(attachment.size)}</span>
              <span className={"rounded px-1.5 py-0.5 text-[10px] font-bold " + status.className}>{status.label}</span>
            </div>
            {attachment.extractionError && <p className="mt-1 text-[11px] leading-5 text-[var(--ink-soft)]">原因：{attachment.extractionError}</p>}
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <button type="button" onClick={() => void retry(attachment)} disabled={busy !== null} className="focus-ring inline-flex items-center gap-1 rounded-md bg-[var(--card-bg)] px-2 py-1 text-[11px] font-bold text-[var(--teal-strong)] disabled:opacity-50">
                {busy === attachment.id ? <LoaderCircle size={12} className="animate-spin" /> : <RefreshCw size={12} />}重试提取
              </button>
              <button type="button" onClick={() => void openCorrection(attachment)} disabled={busy !== null} className="focus-ring inline-flex items-center gap-1 rounded-md bg-[var(--card-bg)] px-2 py-1 text-[11px] font-bold text-[var(--ink-soft)] disabled:opacity-50">
                <Pencil size={12} />{correctFor === attachment.id ? "收起校对" : "人工校对内容"}
              </button>
            </div>
            {correctFor === attachment.id && <div className="mt-2 rounded-lg border border-[var(--rule)] bg-[var(--card-bg)] p-2.5">
              <label htmlFor={`correct-${attachment.id}`} className="text-[11px] font-black text-[var(--navy)]">校对后的文本（会生成项目记忆，原版本保留）</label>
              <textarea id={`correct-${attachment.id}`} value={correctText} onChange={(event) => setCorrectText(event.target.value)} rows={5} maxLength={20000} className="focus-ring editorial-input mt-1.5 w-full resize-y p-2.5 text-xs leading-5" placeholder="把附件里的关键内容抄录或粘贴到这里" />
              {revisions && revisions.length > 0 && <details className="mt-2 rounded-lg bg-[var(--paper-strong)] p-2">
                <summary className="focus-ring flex cursor-pointer items-center gap-1.5 text-[11px] font-bold text-[var(--ink-soft)]"><History size={12} />修订链（{revisions.length}）</summary>
                <ul className="mt-1.5 space-y-1.5">
                  {revisions.map((revision) => <li key={revision.revisionIndex} className="rounded bg-[var(--card-bg)] p-2 text-[11px] leading-5 text-[var(--ink-soft)]">
                    <span className="mr-1.5 rounded bg-[var(--paper-strong)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--navy)]">#{revision.revisionIndex} {revisionSourceLabels[revision.source] ?? revision.source}</span>
                    <span className="text-[10px] text-[var(--muted)]">{new Date(revision.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
                    <span className="mt-1 block line-clamp-3">{revision.text}</span>
                  </li>)}
                </ul>
              </details>}
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={() => { setCorrectFor(null); setRevisions(null); }} className="focus-ring rounded-md px-2 py-1 text-[11px] font-bold text-[var(--muted)]">取消</button>
                <button type="button" onClick={() => void submitCorrection(attachment)} disabled={busy !== null || correctText.trim().length < 2} className="focus-ring editorial-button text-[11px] disabled:opacity-50">
                  {busy === attachment.id ? <LoaderCircle size={12} className="animate-spin" /> : <Pencil size={12} />}提交校对
                </button>
              </div>
            </div>}
          </li>;
        })}
      </ul>
    </div>}

    {!loading && attachments.length > pending.length && <details className="mt-2.5 rounded-lg bg-[var(--paper-strong)] p-2">
      <summary className="focus-ring cursor-pointer text-[11px] font-bold text-[var(--ink-soft)]">已归档附件（{attachments.length - pending.length}）</summary>
      <ul className="mt-1.5 space-y-1">
        {attachments.filter((item) => item.extractionStatus === "SUCCESS").map((attachment) => <li key={attachment.id} className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--ink-soft)]">
          <span className="min-w-0 truncate font-bold text-[var(--navy)]">{attachment.fileName}</span>
          <span className="text-[10px] text-[var(--muted)]">{formatSize(attachment.size)} · {new Date(attachment.createdAt).toLocaleDateString("zh-CN")}</span>
          <span className="rounded bg-[var(--teal-pale)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--teal-strong)]">已沉淀为记忆</span>
        </li>)}
      </ul>
    </details>}
  </div>;
}
