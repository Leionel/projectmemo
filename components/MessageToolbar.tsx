"use client";
import { BookOpen, Files, ListChecks, Pencil, Reply, SquarePen } from "lucide-react";
import type { ConversationMessage } from "@/lib/types/conversation";
import styles from "./ConversationPanel.module.css";

/** 消息底部工具栏：资料 / 判断依据 / 记忆 / 纠正 / 追问。不存在的功能不渲染占位。 */
export function MessageToolbar({ message, sourceCount, showBasis, basisOpen, memoryOpen, canCorrect, busy, onSources, onBasis, onMemory, onCorrect, onAsk, onEdit }: {
  message: ConversationMessage; sourceCount: number; showBasis: boolean; basisOpen: boolean; memoryOpen?: boolean; canCorrect: boolean; busy: boolean;
  onSources?: () => void; onBasis?: () => void; onMemory?: () => void; onCorrect?: () => void; onAsk?: () => void; onEdit?: () => void;
}) {
  const memoryCount = message.memoryUse?.items.length ?? 0;
  const isAssistant = message.role === "ASSISTANT";
  if (!isAssistant && !sourceCount && !onEdit) return null;
  return <div className={styles.messageTools} role="toolbar" aria-label="消息操作">
    {!!sourceCount && onSources && <button type="button" className={styles.toolEntry + " focus-ring"} onClick={onSources}
      aria-haspopup="dialog" aria-label={`资料 ${sourceCount}，查看本次回答的资料`} data-tooltip="引用资料"><Files size={16} strokeWidth={1.75} aria-hidden="true"/><span className={styles.toolCount} aria-hidden="true">{sourceCount}</span></button>}
    {!isAssistant && onEdit && <button type="button" className={styles.toolEntry + " focus-ring"} disabled={busy} onClick={onEdit} aria-label="编辑" data-tooltip="编辑消息"><Pencil size={16} strokeWidth={1.75} aria-hidden="true"/></button>}
    {isAssistant && showBasis && onBasis && <button type="button" className={styles.toolEntry + " focus-ring"} aria-expanded={basisOpen}
      onClick={onBasis} aria-label="判断依据" data-tooltip="判断依据"><ListChecks size={16} strokeWidth={1.75} aria-hidden="true"/></button>}
    {isAssistant && !!memoryCount && onMemory && <button type="button" className={styles.toolEntry + " focus-ring"} aria-expanded={!!memoryOpen}
      onClick={onMemory} aria-label={`记忆 ${memoryCount}`} data-tooltip="参考记忆"><BookOpen size={16} strokeWidth={1.75} aria-hidden="true"/><span className={styles.toolCount} aria-hidden="true">{memoryCount}</span></button>}
    {isAssistant && canCorrect && onCorrect && <button type="button" className={styles.toolEntry + " focus-ring"} onClick={onCorrect}
      aria-haspopup="dialog" aria-label="纠正" data-tooltip="纠正理解"><SquarePen size={16} strokeWidth={1.75} aria-hidden="true"/></button>}
    {isAssistant && onAsk && !message.restricted && <button type="button" className={styles.toolEntry + " focus-ring"} disabled={busy}
      onClick={onAsk} aria-label="追问" data-tooltip="继续追问"><Reply size={16} strokeWidth={1.75} aria-hidden="true"/></button>}
  </div>;
}
