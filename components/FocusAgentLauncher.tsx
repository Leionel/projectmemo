"use client";
import styles from "./ConversationPanel.module.css";
import { BookmarkSpiritIcon } from "./mascot/BookmarkSpiritIcon";
export function FocusAgentLauncher({ onOpen, className = "" }: { onOpen: () => void; className?: string }) {
  return <button type="button" className={styles.launcher + " focus-ring " + className} onClick={onOpen} aria-label="问忆程，打开项目协作对话" title="问忆程"><BookmarkSpiritIcon /></button>;
}
