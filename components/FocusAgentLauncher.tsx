"use client";
import styles from "./ConversationPanel.module.css";
export function FocusAgentLauncher({ onOpen, className = "" }: { onOpen: () => void; className?: string }) {
  return <button type="button" className={styles.launcher + " focus-ring " + className} onClick={onOpen} aria-label="问忆程，打开项目协作对话"><span aria-hidden="true">忆</span>问忆程</button>;
}
