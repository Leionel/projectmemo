"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Download, ExternalLink, Eye, FileText, FileUp, History, LoaderCircle, Paperclip, Pencil, RefreshCw, X } from "lucide-react";
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
  SUCCESS: { label: "已提取并沉淀为记忆", className: "bg-[var(--teal-pale)] text-[var(--teal-strong)] border-transparent" },
  NEEDS_OCR: { label: "待处理：需要 OCR", className: "bg-[var(--amber)]/15 text-[var(--amber)] border-[var(--amber)]/30" },
  PENDING: { label: "待处理", className: "bg-[var(--amber)]/15 text-[var(--amber)] border-[var(--amber)]/30" },
  FAILED: { label: "提取失败", className: "bg-[var(--brick-pale)] text-[var(--brick)] border-[var(--brick)]/30" },
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
 * 附件收件箱：上传 PDF / 图片，如实展示提取结果并提供完整原件查看、预览与校对闭环。
 *
 * 当前环境没有可用的 OCR 或视觉 provider 时，附件保存为「待处理」并说明原因，
 * 不会伪造一条提取成功的记忆；用户可以随时在线预览原件、重试提取，或直接对照原件人工校对文本进入记忆。
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
  const [preview, setPreview] = useState<{ id: string; fileName: string; url: string; size: number; isImage: boolean } | null>(null);
  const [showExtractedFor, setShowExtractedFor] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const openPreview = (attachment: Attachment) => {
    const isImage = /\.(png|jpe?g|webp|gif|bmp)$/i.test(attachment.fileName);
    setPreview({
      id: attachment.id,
      fileName: attachment.fileName,
      size: attachment.size,
      url: `/api/projects/${projectId}/attachments/${attachment.id}/file`,
      isImage,
    });
  };

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

  const [sourceExpanded, setSourceExpanded] = useState(true);
  useEffect(() => {
    const locate = () => {
      if (window.location.hash.startsWith("#attachment-")) {
        setSourceExpanded(true);
        setTimeout(() => document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "center" }), 50);
      }
    };
    locate();
    window.addEventListener("hashchange", locate);
    return () => window.removeEventListener("hashchange", locate);
  }, [attachments]);

  // Esc 键关闭预览弹窗
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && preview) setPreview(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [preview]);

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
        throw new Error((data as { error?: { code?: string } } | null)?.error?.code === "ATTACHMENT_INVALID"
          ? `这个文件没有被接受：忆程只支持 PDF 与图片，并按文件内容校验类型（服务端原因：${reason}）`
          : reason);
      }
      const attachment = data.attachment as Attachment;
      replaceAttachment(attachment);
      await load();
      if (data.isDuplicate) {
        setMessage(`《${attachment.fileName}》此前已经上传过，已复用原记录，没有重复保存。点击“查看原件”可随时查阅。`);
      } else if (attachment.extractionStatus === "SUCCESS") {
        setMessage(`《${attachment.fileName}》已归档，并沉淀为项目记忆。点击“查看原件”可直接在线预览。`);
        emitWorkspaceChange(projectId, ["cards", "interventions", "metrics", "projects"]);
        router.refresh();
      } else if (attachment.extractionStatus === "NEEDS_OCR") {
        setMessage(`《${attachment.fileName}》已保存；当前环境需要 OCR，未生成伪造记忆。你可以随时点击“查看原件”查阅，并进行重试或人工校对。`);
      } else {
        setMessage(`《${attachment.fileName}》已保存，但提取失败：${attachment.extractionError ?? "未知原因"}。原件已妥善保存，可在线查阅或人工校对内容。`);
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
        setMessage(`《${attachment.fileName}》仍然无法自动提取（${data.attachment?.extractionError ?? "当前环境缺少 OCR 能力"}）。原件已完整保留，可点击“查看原件”对照校对内容。`);
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
      // 修订链读取失败不阻塞校对
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

  const copyExtractedText = (id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }).catch(() => {});
  };

  const pending = attachments.filter((item) => item.extractionStatus !== "SUCCESS");
  const archived = attachments.filter((item) => item.extractionStatus === "SUCCESS");

  return (
    <div className="mt-5 rounded-xl border border-[var(--rule)] bg-[var(--card-bg)] p-4 sm:p-5 shadow-xs">
      {/* 头部工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--rule)] pb-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--navy)]">
            <Paperclip size={16} className="text-[var(--teal-strong)]" />
            附件资料库（PDF 与图片原件）
          </h3>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            支持在线预览原件、提取结构化文本。无 OCR 依赖时原件如实保留，可对照查阅校对。
          </p>
        </div>
        <label className="focus-ring inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--rule-strong)] bg-[var(--paper-strong)] px-3.5 py-2 text-xs font-bold text-[var(--ink)] shadow-xs transition hover:border-[var(--teal)] hover:text-[var(--teal-strong)]">
          <input
            type="file"
            accept=".pdf,image/png,image/jpeg,image/webp,image/gif,image/bmp"
            className="hidden"
            disabled={busy !== null}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void upload(file);
            }}
          />
          {busy === "upload" ? <LoaderCircle size={15} className="animate-spin" /> : <FileUp size={15} />}
          {busy === "upload" ? "正在安全上传…" : "上传新附件"}
        </label>
      </div>

      {message && (
        <p role="status" className="mt-3 rounded-lg bg-[var(--teal-pale)] px-3 py-2 text-xs font-semibold leading-5 text-[var(--teal-strong)] border border-[var(--teal)]/20 animate-fade-in">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-[var(--brick-pale)] px-3 py-2 text-xs font-semibold leading-5 text-[var(--brick)] border border-[var(--brick)]/20 animate-fade-in">
          {error}
        </p>
      )}

      {loading && <p className="mt-4 text-xs text-[var(--muted)]">正在载入附件资料库…</p>}

      {/* 待处理附件区域 */}
      {!loading && pending.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-black text-[var(--amber)]">
              待处理附件（{pending.length}）· 原件已保存，随时可查看与提取
            </p>
          </div>
          <ul className="mt-2.5 space-y-3">
            {pending.map((attachment) => {
              const status = statusCopy[attachment.extractionStatus] ?? statusCopy.PENDING;
              const fileUrl = `/api/projects/${projectId}/attachments/${attachment.id}/file`;
              return (
                <li
                  id={`attachment-${attachment.id}`}
                  key={attachment.id}
                  className="rounded-xl border border-[var(--rule)] bg-[var(--paper-strong)] p-3.5 shadow-xs transition-shadow hover:shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2.5">
                    <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                      <span className="truncate text-sm font-bold text-[var(--navy)]">
                        {attachment.fileName}
                      </span>
                      <span className="text-xs text-[var(--muted)]">{formatSize(attachment.size)}</span>
                      <span className={"rounded-md border px-2 py-0.5 text-xs font-bold " + status.className}>
                        {status.label}
                      </span>
                    </div>
                    {/* 明确的在线查看原件与操作入口 */}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openPreview(attachment)}
                        className="focus-ring inline-flex items-center gap-1.5 rounded-lg bg-[var(--teal-pale)] px-3 py-1.5 text-xs font-bold text-[var(--teal-strong)] transition hover:bg-[var(--teal)] hover:text-white"
                        title="在线预览原件"
                      >
                        <Eye size={14} />
                        查看原件
                      </button>
                      <a
                        href={fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="focus-ring inline-flex items-center gap-1 rounded-lg border border-[var(--rule)] bg-[var(--card-bg)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ink-soft)] hover:text-[var(--teal-strong)]"
                        title="在新标签页打开原件"
                      >
                        <ExternalLink size={13} />
                        新窗口
                      </a>
                      <a
                        href={`${fileUrl}?download=1`}
                        className="focus-ring inline-flex items-center gap-1 rounded-lg border border-[var(--rule)] bg-[var(--card-bg)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ink-soft)] hover:text-[var(--teal-strong)]"
                        title="下载文件原件"
                      >
                        <Download size={13} />
                        下载
                      </a>
                    </div>
                  </div>

                  {attachment.extractionError && (
                    <p className="mt-2 text-xs leading-5 text-[var(--ink-soft)] bg-[var(--paper)] rounded-md p-2">
                      <span className="font-semibold text-[var(--navy)]">说明：</span>
                      {attachment.extractionError}
                    </p>
                  )}

                  <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-[var(--rule)]/60 pt-2.5">
                    <button
                      type="button"
                      onClick={() => void retry(attachment)}
                      disabled={busy !== null}
                      className="focus-ring inline-flex items-center gap-1.5 rounded-lg bg-[var(--card-bg)] px-3 py-1.5 text-xs font-bold text-[var(--teal-strong)] border border-[var(--rule)] hover:bg-[var(--paper)] disabled:opacity-50"
                    >
                      {busy === attachment.id ? <LoaderCircle size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                      重试提取
                    </button>
                    <button
                      type="button"
                      onClick={() => void openCorrection(attachment)}
                      disabled={busy !== null}
                      className="focus-ring inline-flex items-center gap-1.5 rounded-lg bg-[var(--card-bg)] px-3 py-1.5 text-xs font-bold text-[var(--ink-soft)] border border-[var(--rule)] hover:bg-[var(--paper)] disabled:opacity-50"
                    >
                      <Pencil size={13} />
                      {correctFor === attachment.id ? "收起校对" : "对照原件校对内容"}
                    </button>
                  </div>

                  {/* 校对文本展开面板 */}
                  {correctFor === attachment.id && (
                    <div className="mt-3 rounded-xl border border-[var(--rule)] bg-[var(--card-bg)] p-3.5 animate-fade-in">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label htmlFor={`correct-${attachment.id}`} className="text-xs font-black text-[var(--navy)]">
                          校对后的文本（将生成事实项目记忆，原版本完整保留在修订链）
                        </label>
                        <button
                          type="button"
                          onClick={() => openPreview(attachment)}
                          className="focus-ring inline-flex items-center gap-1 text-xs font-bold text-[var(--teal-strong)] underline underline-offset-4 hover:text-[var(--navy)]"
                        >
                          <Eye size={13} />
                          弹出原件对照查看
                        </button>
                      </div>
                      <textarea
                        id={`correct-${attachment.id}`}
                        value={correctText}
                        onChange={(event) => setCorrectText(event.target.value)}
                        rows={5}
                        maxLength={20000}
                        className="focus-ring editorial-input mt-2 w-full resize-y p-3 text-sm leading-6"
                        placeholder="对照原件把关键内容抄录或粘贴到这里，生成具有证据支撑的项目记忆"
                      />
                      {revisions && revisions.length > 0 && (
                        <details className="mt-2.5 rounded-lg bg-[var(--paper-strong)] p-2.5 border border-[var(--rule)]">
                          <summary className="focus-ring flex cursor-pointer items-center gap-1.5 text-xs font-bold text-[var(--ink-soft)]">
                            <History size={13} />
                            查看历史修订链（{revisions.length}）
                          </summary>
                          <ul className="mt-2 space-y-2">
                            {revisions.map((revision) => (
                              <li key={revision.revisionIndex} className="rounded bg-[var(--card-bg)] p-2.5 text-xs leading-5 text-[var(--ink-soft)] border border-[var(--rule)]/50">
                                <span className="mr-1.5 rounded bg-[var(--paper-strong)] px-1.5 py-0.5 text-xs font-bold text-[var(--navy)]">
                                  #{revision.revisionIndex} {revisionSourceLabels[revision.source] ?? revision.source}
                                </span>
                                <span className="text-xs text-[var(--muted)]">
                                  {new Date(revision.createdAt).toLocaleString("zh-CN", { hour12: false })}
                                </span>
                                <span className="mt-1 block line-clamp-3 text-sm leading-6">{revision.text}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                      <div className="mt-3 flex justify-end gap-2.5">
                        <button
                          type="button"
                          onClick={() => {
                            setCorrectFor(null);
                            setRevisions(null);
                          }}
                          className="focus-ring rounded-lg px-3 py-1.5 text-xs font-bold text-[var(--muted)] hover:bg-[var(--paper)]"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={() => void submitCorrection(attachment)}
                          disabled={busy !== null || correctText.trim().length < 2}
                          className="focus-ring editorial-button text-xs disabled:opacity-50"
                        >
                          {busy === attachment.id ? <LoaderCircle size={14} className="animate-spin" /> : <Pencil size={14} />}
                          提交校对并入库
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* 已归档附件区域：直接展开，并提供原件查看、新窗口查看、下载和提取文本展示 */}
      {!loading && archived.length > 0 && (
        <div className="mt-5 border-t border-[var(--rule)] pt-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-black text-[var(--teal-strong)] flex items-center gap-1.5">
              <Check size={14} />
              已归档原件与提取记忆（{archived.length}）
            </p>
            <button
              type="button"
              onClick={() => setSourceExpanded(!sourceExpanded)}
              className="text-xs font-bold text-[var(--muted)] hover:text-[var(--navy)] underline underline-offset-2"
            >
              {sourceExpanded ? "收起列表" : "展开列表"}
            </button>
          </div>

          {sourceExpanded && (
            <ul className="mt-3 space-y-3">
              {archived.map((attachment) => {
                const fileUrl = `/api/projects/${projectId}/attachments/${attachment.id}/file`;
                const isTextOpen = showExtractedFor === attachment.id;
                return (
                  <li
                    id={`attachment-${attachment.id}`}
                    key={attachment.id}
                    className="rounded-xl border border-[var(--rule)]/70 bg-[var(--paper-strong)] p-3.5 text-xs text-[var(--ink-soft)] shadow-xs transition hover:border-[var(--teal)]/40"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2.5">
                      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                        <span className="truncate text-sm font-bold text-[var(--navy)]">
                          {attachment.fileName}
                        </span>
                        <span className="text-xs text-[var(--muted)]">
                          {formatSize(attachment.size)} · {new Date(attachment.createdAt).toLocaleDateString("zh-CN")}
                        </span>
                        <span className="rounded-md bg-[var(--teal-pale)] px-2 py-0.5 text-xs font-bold text-[var(--teal-strong)]">
                          已沉淀为记忆
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* 醒目的查看原件大按钮 */}
                        <button
                          type="button"
                          onClick={() => openPreview(attachment)}
                          className="focus-ring inline-flex items-center gap-1.5 rounded-lg bg-[var(--teal-pale)] px-3 py-1.5 text-xs font-bold text-[var(--teal-strong)] transition hover:bg-[var(--teal)] hover:text-white"
                          title="在线预览此原件"
                        >
                          <Eye size={14} />
                          查看原件
                        </button>
                        <a
                          href={fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="focus-ring inline-flex items-center gap-1 rounded-lg border border-[var(--rule)] bg-[var(--card-bg)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ink-soft)] hover:text-[var(--teal-strong)]"
                          title="新窗口打开"
                        >
                          <ExternalLink size={13} />
                          新窗口
                        </a>
                        <a
                          href={`${fileUrl}?download=1`}
                          className="focus-ring inline-flex items-center gap-1 rounded-lg border border-[var(--rule)] bg-[var(--card-bg)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ink-soft)] hover:text-[var(--teal-strong)]"
                          title="下载文件原件"
                        >
                          <Download size={13} />
                          下载
                        </a>
                        {attachment.extractedText && (
                          <button
                            type="button"
                            onClick={() => setShowExtractedFor(isTextOpen ? null : attachment.id)}
                            className="focus-ring inline-flex items-center gap-1 rounded-lg border border-[var(--rule)] bg-[var(--card-bg)] px-2.5 py-1.5 text-xs font-bold text-[var(--navy)] hover:bg-[var(--paper)]"
                          >
                            <FileText size={13} />
                            {isTextOpen ? "收起提取文本" : "查看提取文本"}
                          </button>
                        )}
                      </div>
                    </div>

                    {isTextOpen && attachment.extractedText && (
                      <div className="mt-3 rounded-lg bg-[var(--card-bg)] p-3 border border-[var(--rule)] animate-fade-in">
                        <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-[var(--rule)]/60">
                          <p className="font-bold text-xs text-[var(--navy)]">机器提取并归档的结构化文本：</p>
                          <button
                            type="button"
                            onClick={() => copyExtractedText(attachment.id, attachment.extractedText ?? "")}
                            className="focus-ring inline-flex items-center gap-1 text-xs font-bold text-[var(--teal-strong)] hover:text-[var(--navy)]"
                          >
                            {copiedId === attachment.id ? <Check size={13} /> : <Copy size={13} />}
                            {copiedId === attachment.id ? "已复制" : "复制全文"}
                          </button>
                        </div>
                        <pre className="whitespace-pre-wrap font-sans text-xs leading-6 text-[var(--ink)] max-h-60 overflow-y-auto">
                          {attachment.extractedText}
                        </pre>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* 在线原件大图 / PDF 预览 Modal */}
      {preview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="附件原件在线预览"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3 sm:p-6 backdrop-blur-xs animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPreview(null);
          }}
        >
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-2xl border border-[var(--rule)] bg-[var(--card-bg)] shadow-2xl overflow-hidden">
            {/* 预览窗 Header */}
            <header className="flex flex-wrap items-center justify-between border-b border-[var(--rule)] px-5 py-3.5 bg-[var(--paper-strong)] gap-3">
              <div className="flex items-center gap-2.5 min-w-0 pr-3">
                <Paperclip size={18} className="text-[var(--teal-strong)] shrink-0" />
                <h3 className="truncate text-base font-bold text-[var(--navy)]" title={preview.fileName}>
                  {preview.fileName}
                </h3>
                <span className="text-xs text-[var(--muted)] shrink-0">({formatSize(preview.size)})</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={preview.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-[var(--rule)] bg-[var(--card-bg)] px-3 py-1.5 text-xs font-bold text-[var(--ink)] hover:border-[var(--teal)] hover:text-[var(--teal-strong)] transition"
                >
                  <ExternalLink size={14} />
                  在新标签页打开
                </a>
                <a
                  href={`${preview.url}?download=1`}
                  className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-[var(--rule)] bg-[var(--card-bg)] px-3 py-1.5 text-xs font-bold text-[var(--ink)] hover:border-[var(--teal)] hover:text-[var(--teal-strong)] transition"
                >
                  <Download size={14} />
                  下载原件
                </a>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="focus-ring rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--rule)]/40 hover:text-[var(--navy)] transition"
                  aria-label="关闭预览"
                >
                  <X size={20} />
                </button>
              </div>
            </header>

            {/* 预览内容区 */}
            <div className="flex-1 overflow-auto p-4 sm:p-6 flex items-center justify-center bg-[var(--paper)] min-h-[420px]">
              {preview.isImage ? (
                <div className="flex flex-col items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={preview.url}
                    alt={preview.fileName}
                    className="max-h-[75vh] max-w-full rounded-lg object-contain shadow-lg border border-[var(--rule)]"
                  />
                  <p className="mt-3 text-xs text-[var(--muted)]">提示：点击图片右键可选择“复制图像”或“另存为”</p>
                </div>
              ) : (
                <div className="w-full flex flex-col h-[76vh]">
                  <iframe
                    src={preview.url}
                    title={preview.fileName}
                    className="h-full w-full rounded-lg border border-[var(--rule)] bg-white shadow-sm"
                  />
                  <div className="mt-2 text-center text-xs text-[var(--muted)]">
                    若浏览器阻止内嵌显示 PDF，可直接{" "}
                    <a
                      href={preview.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-bold text-[var(--teal-strong)] underline"
                    >
                      点击此处新标签页打开
                    </a>{" "}
                    或{" "}
                    <a
                      href={`${preview.url}?download=1`}
                      className="font-bold text-[var(--teal-strong)] underline"
                    >
                      直接下载文件
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
