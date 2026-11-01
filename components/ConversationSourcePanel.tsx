"use client";
import { ArrowUpRight } from "lucide-react";
import type { ConversationMessage } from "@/lib/types/conversation";
import { conversationHref } from "@/lib/conversation/navigation";
import { researchReadLevelLabel } from "@/lib/conversation/researchLabels";
import { sourceEntryKinds, type SourceEntryKind } from "@/lib/conversation/priorityPresentation";
import { OverlayPanel } from "./OverlayPanel";
import styles from "./ConversationPanel.module.css";

function destination(file: NonNullable<ConversationMessage["fileGuides"]>[number], conversationId: string, messageId: string) {
  return file.kind === "ATTACHMENT" ? file.href : conversationHref(file.href, conversationId, messageId);
}
function kindOf(file: NonNullable<ConversationMessage["fileGuides"]>[number]): SourceEntryKind {
  return file.kind === "WEB" ? "网页引用" : file.kind === "CALENDAR" ? "日历来源" : file.kind === "ATTACHMENT" ? "文档与附件" : file.kind === "ARTIFACT" ? "项目成果" : "项目记录";
}
function openLabel(file: NonNullable<ConversationMessage["fileGuides"]>[number]) {
  return file.document ? "查看原页与引用" : file.kind === "WEB" ? "查看网页来源" : file.kind === "CALENDAR" ? "查看日历来源" : file.kind === "ATTACHMENT" ? "打开原文件" : file.kind === "ARTIFACT" ? "查看原成果" : "查看项目资料";
}
type SourceEntry = { key: string; kind: SourceEntryKind; title: string; meta: string; body: string; notice: string;
  href?: string; externalLink?: boolean; linkLabel?: string };
function collectEntries(message: ConversationMessage, conversationId: string): SourceEntry[] {
  const entries: SourceEntry[] = [];
  for (const file of message.fileGuides ?? []) {
    const meta: string[] = [(file.quote ? "引用" : "读取") + (file.readScope === "SUMMARY" ? "摘要" : "片段")];
    if (file.external) meta.push(researchReadLevelLabel(file.external.readLevel) + " · 抓取于 " + file.external.fetchedAt.slice(0, 10) +
      (file.external.publishedAt ? " · 发布于 " + file.external.publishedAt.slice(0, 10) : "") + (file.external.truncated ? " · 已截断" : ""));
    if (file.document) meta.push((file.document.pages.length ? `原件物理第 ${file.document.pages[0]} 页` : "校对文本或文件目录") + (file.document.kind === "TABLE" ? " · 表头待核对" : ""));
    if (file.calendar) meta.push("飞书日历只读 · " + file.calendar.calendarSummary + " · " + file.calendar.eventStatus +
      " · " + (file.calendar.startAt?.slice(0, 16).replace("T", " ") ?? file.calendar.startDate ?? "") +
      (file.calendar.window.complete ? "" : " · 本次窗口未完整读取"));
    entries.push({ key: file.sourceId, kind: kindOf(file), title: `【${file.number}】${file.title}`, meta: meta.join(" · "),
      body: file.quote ?? file.excerpt,
      notice: file.stale ? "引用后已有修订，保留当时读取的片段。" : file.missing ? "原资料已不可用，保留历史片段。" : file.archived ? "资料已归档，归档不改变引用时的事实状态。" : "",
      href: file.missing ? undefined : destination(file, conversationId, message.id), externalLink: file.kind === "ATTACHMENT",
      linkLabel: openLabel(file) });
  }
  const known = new Set((message.fileGuides ?? []).map(f => f.sourceId));
  for (const source of message.sources) {
    if (known.has(source.sourceId)) continue;
    const kind: SourceEntryKind = source.repository ? "CI 观察" : source.calendar ? "日历来源" : source.external ? "网页引用" : source.document ? "文档与附件" : "项目记录";
    const meta: string[] = [source.temporalState, new Date(source.observedAt).toLocaleString("zh-CN")];
    if (source.repository) meta.push(source.repository.repo + " · " + source.repository.sha.slice(0, 10) + " · " +
      (source.repository.kind === "LOG" ? "脱敏日志片段" : source.repository.kind === "JOBS" ? "任务列表" : "CI 状态"));
    entries.push({ key: source.sourceId, kind, title: source.title, meta: meta.join(" · "), body: source.excerpt, notice: "",
      href: source.repository ? `https://github.com/${source.repository.repo}/commit/${source.repository.sha}` : undefined, externalLink: !!source.repository,
      linkLabel: source.repository ? "查看原始提交" : undefined });
  }
  return entries;
}
/** 消息工具栏「资料 N」用的真实条目数（fileGuides 与其他来源按 sourceId 去重）。 */
export function sourceEntryCount(message: ConversationMessage): number {
  const known = new Set((message.fileGuides ?? []).map(f => f.sourceId));
  return (message.fileGuides ?? []).length + message.sources.filter(s => !known.has(s.sourceId)).length;
}
/** Controlled source panel: the toolbar owns the entry, this only renders the drawer. */
export function SourcePanelDialog({ open, onClose, message, conversationId }: {
  open: boolean; onClose: () => void; message: ConversationMessage | null; conversationId: string;
}) {
  if (!open || !message) return null;
  const entries = collectEntries(message, conversationId);
  return <OverlayPanel label="本次回答的资料" title="本次回答的资料" variant="drawer" onClose={onClose}>
    <div className={styles.sourceGroups}>
      {sourceEntryKinds.map(kind => {
        const rows = entries.filter(e => e.kind === kind);
        if (!rows.length) return null;
        return <section key={kind} className={styles.sourceGroup}>
          <p className={styles.sourceGroupTitle}>{kind} {rows.length}</p>
          {rows.map(e => <article key={e.key} className={styles.sourceCard}>
            <header><strong>{e.title}</strong>{e.notice && <span className={styles.sourceFlag}>{e.notice.includes("不可用") ? "已失效" : "已修订"}</span>}</header>
            {e.notice && <p className={styles.sourceNotice}>{e.notice}</p>}
            <p className={styles.sourceMeta}>{e.meta}</p>
            <blockquote>{e.body}</blockquote>
            {e.href && e.linkLabel && <a className="workspace-link focus-ring" href={e.href} target={e.externalLink ? "_blank" : undefined}
              rel={e.externalLink ? "noopener noreferrer" : undefined}>{e.linkLabel} <ArrowUpRight size={13} aria-hidden="true"/></a>}
          </article>)}
        </section>;
      })}
      {!!message.limitations.length && <section className={styles.sourceGroup}>
        <p className={styles.sourceGroupTitle}>其他限制</p>
        {message.limitations.map((l, i) => <p key={i} className={styles.sourceNotice}>{l}</p>)}
      </section>}
    </div>
  </OverlayPanel>;
}
