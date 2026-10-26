"use client";
import { useState } from "react";
import { useSearchParams, usePathname } from "next/navigation";
import Link from "next/link";
import { ConversationPanel } from "./ConversationPanel";
import { conversationHref } from "@/lib/conversation/navigation";
import styles from "./ConversationPanel.module.css";
export function ProjectConversationAccess({ projectId }: { projectId: string }) {
  const search = useSearchParams(), id = search.get("conversation");
  const pathname = usePathname();
  const [open, setOpen] = useState(!!id || pathname.endsWith("/knowledge"));
  return <section aria-label="项目关联讨论">
    <div className={styles.return}>
      <button type="button" className="workspace-link focus-ring" onClick={() => setOpen(v => !v)}>{id ? "继续原讨论" : "项目讨论与焦点会话"}</button>
      {id && <Link className="workspace-link focus-ring" href={conversationHref("/focus", id, search.get("originMessage") ?? undefined)}>返回原焦点讨论</Link>}
    </div>
    {open && <ConversationPanel key={id ?? projectId} projectId={projectId} initialConversationId={id ?? undefined}/>}
  </section>;
}
