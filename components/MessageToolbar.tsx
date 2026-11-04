"use client";
import { CornerDownRight } from "lucide-react";
import type { ConversationMessage } from "@/lib/types/conversation";
import styles from "./ConversationPanel.module.css";

/** 消息底部工具栏：资料 / 判断依据 / 记忆 / 纠正 / 追问。不存在的功能不渲染占位。 */
export function MessageToolbar({ message, sourceCount, showBasis, basisOpen, memoryOpen, canCorrect, busy, onSources, onBasis, onMemory, onCorrect, onAsk }: {
  message: ConversationMessage; sourceCount: number; showBasis: boolean; basisOpen: boolean; memoryOpen?: boolean; canCorrect: boolean; busy: boolean;
  onSources?: () => void; onBasis?: () => void; onMemory?: () => void; onCorrect?: () => void; onAsk?: () => void;
}) {
  const memoryCount = message.memoryUse?.items.length ?? 0;
  const isAssistant = message.role === "ASSISTANT";
  if (!isAssistant && !sourceCount) return null;
  return <div className={styles.messageTools} role="toolbar" aria-label="消息操作">
    {!!sourceCount && onSources && <button type="button" className={styles.toolEntry + " focus-ring"} onClick={onSources}
      aria-haspopup="dialog">资料 {sourceCount}</button>}
    {isAssistant && showBasis && onBasis && <button type="button" className={styles.toolEntry + " focus-ring"} aria-expanded={basisOpen}
      onClick={onBasis}>判断依据</button>}
    {isAssistant && !!memoryCount && onMemory && <button type="button" className={styles.toolEntry + " focus-ring"} aria-expanded={!!memoryOpen}
      onClick={onMemory}>记忆 {memoryCount}</button>}
    {isAssistant && canCorrect && onCorrect && <button type="button" className={styles.toolEntry + " focus-ring"} onClick={onCorrect}
      aria-haspopup="dialog">纠正</button>}
    {isAssistant && onAsk && !message.restricted && <button type="button" className={styles.toolEntry + " focus-ring"} disabled={busy}
      onClick={onAsk}><CornerDownRight size={13} aria-hidden="true"/>追问</button>}
  </div>;
}
