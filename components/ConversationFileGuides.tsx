"use client";
import { Fragment } from "react";
import type { ConversationMessage } from "@/lib/types/conversation";
import { conversationHref } from "@/lib/conversation/navigation";
import styles from "./ConversationPanel.module.css";

function destination(file: NonNullable<ConversationMessage["fileGuides"]>[number], conversationId: string, messageId: string) {
  return file.kind === "ATTACHMENT" ? file.href : conversationHref(file.href, conversationId, messageId);
}
export function ConversationAnswer({ message, conversationId }: { message: ConversationMessage; conversationId: string }) {
  return message.content.split(/(【\d+】)/g).map((part, index) => {
    const match = /^【(\d+)】$/.exec(part);
    const file = match ? message.fileGuides?.find(f => f.number === Number(match[1])) : null;
    return file && !file.missing ? <a key={index} data-cite-source={file.sourceId} className={styles.inlineCitation + " focus-ring"}
      href={destination(file, conversationId, message.id)} target={file.kind === "ATTACHMENT" ? "_blank" : undefined}
      rel={file.kind === "ATTACHMENT" ? "noopener noreferrer" : undefined} title={file.title}
      aria-label={`资料 ${file.number}：${file.title}${file.stale ? "，引用后已有修订" : ""}`}>{part}</a> : <Fragment key={index}>{part}</Fragment>;
  });
}
