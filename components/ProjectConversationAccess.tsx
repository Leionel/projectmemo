"use client";
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ConversationPanel } from "./ConversationPanel";
import { conversationHref } from "@/lib/conversation/navigation";
import styles from "./ConversationPanel.module.css";
export function ProjectConversationAccess({ projectId }: { projectId: string }) {
  const search = useSearchParams(), id = search.get("conversation");
  const requested = !!id || search.get("openCopilot") === "1";
  const identity = projectId + ":" + (id ?? "") + ":" + (search.get("openCopilot") ?? "");
  const [override, setOverride] = useState<{ identity: string; open: boolean } | null>(null);
  const open = override?.identity === identity ? override.open : requested;
  const router = useRouter(), pathname = usePathname();
  // 收起时去掉 openCopilot，再点顶部“问忆程”会重新带上它，从而能再次打开。
  function close() {
    const params = new URLSearchParams(search.toString());
    const had = params.has("openCopilot");
    params.delete("openCopilot");
    setOverride({ identity: projectId + ":" + (id ?? "") + ":", open: false });
    if (had) router.replace(pathname + (params.size ? "?" + params.toString() : ""), { scroll: false });
  }
  return <section aria-label="项目关联讨论">
    {open && <div className={styles.projectDrawer} data-project-drawer="">
    {id && <div className={styles.return}><Link className="workspace-link focus-ring" href={conversationHref("/focus", id, search.get("originMessage") ?? undefined)}>返回原焦点讨论</Link></div>}
    <ConversationPanel key={id ?? projectId} projectId={projectId} initialConversationId={id ?? undefined} onClose={close}/></div>}
  </section>;
}
