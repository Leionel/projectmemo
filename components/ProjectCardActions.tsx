"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArchiveRestore, Archive, LoaderCircle, Trash2 } from "lucide-react";
import { runProjectLifecycleAction } from "@/lib/client/projectLifecycle";

type ProjectCardActionsProps = {
  projectId: string;
  projectTitle: string;
  /** 已归档项目只能「恢复」或「删除」；再「归档」一次没有意义。 */
  archived: boolean;
  onDone?: () => void;
};

/**
 * 项目卡片上的归档 / 恢复 / 删除入口。
 *
 * 归档是可恢复动作，按下即执行，不弹确认——给它加二次确认反而会让人以为
 * 它和删除一样危险。删除不可恢复，必须二次确认，且确认文案明确写出会失去什么。
 * 删除确认区用 role="alert" 而不是模态框：卡片里再套一层模态框会打断列表浏览。
 */
export function ProjectCardActions({ projectId, projectTitle, archived, onDone }: ProjectCardActionsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false);

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

  const quietButton = "focus-ring inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition disabled:opacity-60";

  return (
    <div className="mt-4 border-t archive-rule pt-4">
      {confirming ? (
        <div role="alert" className="rounded-xl bg-[var(--brick-pale)] p-3">
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
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => void run(archived ? "restore" : "archive")}
            disabled={busy}
            aria-label={archived ? `恢复项目 ${projectTitle}` : `归档项目 ${projectTitle}`}
            className={`${quietButton} text-[var(--ink-soft)] hover:bg-[var(--paper-strong)] hover:text-[var(--teal-strong)]`}
          >
            {busy
              ? <LoaderCircle className="animate-spin" size={13} aria-hidden="true" />
              : archived
                ? <ArchiveRestore size={13} aria-hidden="true" />
                : <Archive size={13} aria-hidden="true" />}
            {archived ? "恢复" : "归档"}
          </button>
          <button
            type="button"
            onClick={() => { setConfirming(true); setError(""); }}
            disabled={busy}
            aria-label={`删除项目 ${projectTitle}`}
            className={`${quietButton} text-[var(--brick)] hover:bg-[var(--brick-pale)]`}
          >
            <Trash2 size={13} aria-hidden="true" />
            删除
          </button>
        </div>
      )}

      {error && <p role="alert" aria-live="polite" className="mt-2 text-right text-xs font-bold text-[var(--brick)]">{error}</p>}
    </div>
  );
}