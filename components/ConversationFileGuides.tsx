"use client";
import { Fragment } from "react";
import { FileText, ArrowUpRight } from "lucide-react";
import type { ConversationMessage, ConversationFileGuide } from "@/lib/types/conversation";
import { conversationHref } from "@/lib/conversation/navigation";
import styles from "./ConversationPanel.module.css";

function destination(file: ConversationFileGuide, conversationId: string, messageId: string) {
  return file.kind === "ATTACHMENT" ? file.href : conversationHref(file.href, conversationId, messageId);
}
export function ConversationAnswer({ message, conversationId }: { message: ConversationMessage; conversationId: string }) {
  return message.content.split(/(【\d+】)/g).map((part, index) => {
    const match = /^【(\d+)】$/.exec(part);
    const file = match ? message.fileGuides?.find(f => f.number === Number(match[1])) : null;
    return file && !file.missing ? <a key={index} className={styles.inlineCitation + " focus-ring"}
      href={destination(file, conversationId, message.id)} target={file.kind === "ATTACHMENT" ? "_blank" : undefined}
      rel={file.kind === "ATTACHMENT" ? "noopener noreferrer" : undefined} title={file.title}
      aria-label={`资料 ${file.number}：${file.title}${file.stale ? "，引用后已有修订" : ""}`}>{part}</a> : <Fragment key={index}>{part}</Fragment>;
  });
}
export function ConversationFileGuides({ message, conversationId }: { message: ConversationMessage; conversationId: string }) {
  if (!message.fileGuides?.length) return null;
  return <div className={styles.fileGuides} aria-label="本条回答的资料指引">
    {message.fileGuides.map(file => <details key={file.sourceId}>
      <summary><FileText size={15} aria-hidden="true"/><span>【{file.number}】{file.title}</span>
        <small>{file.quote ? "引用" : "读取"}{file.readScope === "SUMMARY" ? "摘要" : "片段"}</small></summary>
      {file.stale && <p className={styles.fileNotice}>引用后已有修订，下方保留当时读取的片段。</p>}
      {file.missing && <p className={styles.fileNotice}>原资料已不可用，下方保留历史片段。</p>}
      {file.archived && <p className={styles.fileNotice}>资料已归档，归档不改变引用时的事实状态。</p>}
      <blockquote>{file.quote ?? file.excerpt}</blockquote>
      {!file.missing && <a href={destination(file, conversationId, message.id)} className="workspace-link focus-ring"
        target={file.kind === "ATTACHMENT" ? "_blank" : undefined} rel={file.kind === "ATTACHMENT" ? "noopener noreferrer" : undefined}>
        {file.kind === "ATTACHMENT" ? "打开原文件" : file.kind === "ARTIFACT" ? "查看原成果" : "查看项目资料"}<ArrowUpRight size={13} aria-hidden="true"/>
      </a>}
    </details>)}
  </div>;
}
