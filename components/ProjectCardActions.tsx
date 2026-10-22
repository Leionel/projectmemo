"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, LoaderCircle, MoreHorizontal, Trash2 } from "lucide-react";
import { runProjectLifecycleAction } from "@/lib/client/projectLifecycle";

type ProjectCardActionsProps = {
  projectId: string;
  projectTitle: string;
  /** 已归档项目只能「恢复」或「删除」；再「归档」一次没有意义。 */
  archived: boolean;
  onDone?: () => void;
};

/**
 * 项目卡上的归档 / 恢复 / 删除入口，收纳进「更多」菜单，不与「打开项目」竞争视觉权重。
 *
 * 归档是可恢复动作，按下即执行，不弹确认——给它加二次确认反而会让人以为
 * 它和删除一样危险。删除不可恢复，必须在菜单原位展开二次确认，且确认文案
 * 明确写出会失去什么。确认区用 role="alert" 而不是模态框：卡片里再套一层模态框
 * 会打断列表浏览。
 */
export function ProjectCardActions({ projectId, projectTitle, archived, onDone }: ProjectCardActionsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  const menuRef = useRef<HTMLDetailsElement>(null);

  async function run(action: "archive" | "restore" | "delete") {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");

    const result = await runProjectLifecycleAction(projectId, action);

    if (!result.ok) {
      setError(result.message);
      busyRef.current = false;
      setBusy(false);
      return;
    }

    setConfirming(false);
    busyRef.current = false;
    setBusy(false);
    onDone?.();
    router.refresh();
  }

  return (
    <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
      {confirming ? (
        <div role="alert" className="w-full rounded-md bg-[var(--brick-pale)] p-3">
          <p className="text-xs font-bold text-[var(--brick)]">
            删除「{projectTitle}」会同时删除它的全部卡片、行动与成果，且无法恢复。确认删除？
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void run("delete")}
              disabled={busy}
              className="focus-ring inline-flex items-center gap-1.5 rounded-lg bg-[var(--brick)] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-70"
            >
              {busy && <LoaderCircle className="animate-spin" size={13} aria-hidden="true" />}
              {busy ? "正在删除…" : "确认删除"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="focus-ring rounded-lg px-3 py-1.5 text-xs font-bold text-[var(--ink-soft)] disabled:opacity-60"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <details className="relative" ref={menuRef}>
          <summary className="focus-ring flex cursor-pointer list-none items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-[var(--muted)] hover:bg-[var(--paper)] hover:text-[var(--ink)]">
            <MoreHorizontal size={14} aria-hidden="true" />项目操作
          </summary>
          <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-[var(--rule)] bg-[var(--card-bg)] p-1 shadow-[var(--shadow-md)]">
            <button
              type="button"
              onClick={() => { menuRef.current?.removeAttribute("open"); void run(archived ? "restore" : "archive"); }}
              disabled={busy}
              className="focus-ring flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-bold text-[var(--ink-soft)] transition hover:bg-[var(--paper)] hover:text-[var(--ink)] disabled:opacity-60"
            >
              {busy
                ? <LoaderCircle className="animate-spin" size={13} aria-hidden="true" />
                : archived
                  ? <ArchiveRestore size={13} aria-hidden="true" />
                  : <Archive size={13} aria-hidden="true" />}
              {archived ? "恢复项目" : "归档项目"}
            </button>
            <button
              type="button"
              onClick={() => { menuRef.current?.removeAttribute("open"); setConfirming(true); setError(""); }}
              disabled={busy}
              className="focus-ring flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-bold text-[var(--brick)] transition hover:bg-[var(--brick-pale)] disabled:opacity-60"
            >
              <Trash2 size={13} aria-hidden="true" />
              删除项目
            </button>
          </div>
        </details>
      )}

      {error && <p role="alert" aria-live="polite" className="w-full text-right text-xs font-bold text-[var(--brick)]">{error}</p>}
    </div>
  );
}
