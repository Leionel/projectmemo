"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ConversationPanel } from "./ConversationPanel";
import { FocusAgentLauncher } from "./FocusAgentLauncher";
import { conversationHref } from "@/lib/conversation/navigation";
import styles from "./ConversationPanel.module.css";
export function ProjectConversationAccess({ projectId }: { projectId: string }) {
  const search = useSearchParams(), id = search.get("conversation");
  const requested = !!id || search.get("openCopilot") === "1";
  const identity = projectId + ":" + (id ?? "") + ":" + (search.get("openCopilot") ?? "");
  const [override, setOverride] = useState<{ identity: string; open: boolean } | null>(null);
  const open = override?.identity === identity ? override.open : requested;
  const setOpen = (value: boolean) => setOverride({ identity, open: value });
  return <section aria-label="项目关联讨论">
    {!open && <FocusAgentLauncher onOpen={() => setOpen(true)}/>}
    {open && <div className={styles.projectDrawer}><div className={styles.return}>
      <button type="button" className="workspace-link focus-ring" onClick={() => setOpen(false)}>收起讨论</button>
      {id && <Link className="workspace-link focus-ring" href={conversationHref("/focus", id, search.get("originMessage") ?? undefined)}>返回原焦点讨论</Link>}
    </div>
    <ConversationPanel key={id ?? projectId} projectId={projectId} initialConversationId={id ?? undefined}/></div>}
  </section>;
}
