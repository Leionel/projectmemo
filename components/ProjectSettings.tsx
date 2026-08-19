"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Pencil, Save, Trash2, X } from "lucide-react";
import { scenarioOptions } from "@/lib/types";
import { emitWorkspaceChange } from "@/lib/client/workspaceEvents";

type ProjectSettingsProps = {
  project: { id: string; title: string; description: string; goal: string; scenario: string; deadline: string };
};

export function ProjectSettings({ project }: ProjectSettingsProps) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false);

  useEffect(() => { busyRef.current = saving || deleting; }, [deleting, saving]);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => dialogRef.current?.querySelector<HTMLElement>("button, input, textarea, select")?.focus(), 0);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) setOpen(false);
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]')];
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => { window.clearTimeout(focusTimer); document.body.style.overflow = oldOverflow; document.removeEventListener("keydown", handleKey); trigger?.focus(); };
  }, [open]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError("");
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const response = await fetch(`/api/projects/${project.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "保存失败，请稍后重试");
      setOpen(false); setConfirmDelete(false); emitWorkspaceChange(project.id, ["projects", "interventions", "metrics"]); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败，请稍后重试"); }
    finally { setSaving(false); }
  }

  async function remove() {
    setDeleting(true); setError("");
    try {
      const response = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      const data = response.status === 204 ? null : await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "删除失败，请稍后重试");
      router.push("/projects"); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "删除失败，请稍后重试"); setDeleting(false); }
  }

  const field = "focus-ring editorial-input mt-2 w-full px-3.5 py-2.5 text-sm";
  return <>
    <button ref={triggerRef} type="button" onClick={() => { setOpen(true); setError(""); }} className="focus-ring editorial-button-secondary"><Pencil size={16} /> 编辑项目</button>
    {open && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[rgba(16,27,50,.46)] p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving && !deleting) setOpen(false); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="project-settings-title" className="card-surface my-6 w-full max-w-2xl rounded-[1.5rem] bg-[var(--paper-strong)] p-5 shadow-[var(--shadow-lg)] sm:p-7">
        <div className="flex items-start justify-between gap-4 border-b archive-rule pb-4"><div><p className="archive-label">项目设置</p><h2 id="project-settings-title" className="mt-2 text-xl font-black">编辑项目档案</h2></div><button type="button" onClick={() => setOpen(false)} disabled={saving || deleting} aria-label="关闭项目设置" className="focus-ring rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--paper-strong)]"><X size={19} /></button></div>
        <form onSubmit={save} className="mt-5 space-y-4" aria-busy={saving}>
          <fieldset disabled={saving || deleting} className="space-y-4 disabled:opacity-70">
            <div><label htmlFor="edit-title" className="text-sm font-bold">项目名称</label><input id="edit-title" name="title" defaultValue={project.title} minLength={2} maxLength={80} required className={field} /></div>
            <div><label htmlFor="edit-description" className="text-sm font-bold">项目描述</label><textarea id="edit-description" name="description" defaultValue={project.description} minLength={10} maxLength={500} required rows={3} className={field} /></div>
            <div><label htmlFor="edit-goal" className="text-sm font-bold">项目目标</label><textarea id="edit-goal" name="goal" defaultValue={project.goal} minLength={2} maxLength={300} required rows={3} className={field} /></div>
            <div className="grid gap-4 sm:grid-cols-2"><div><label htmlFor="edit-scenario" className="text-sm font-bold">项目场景</label><select id="edit-scenario" name="scenario" defaultValue={project.scenario} className={field}>{scenarioOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div><div><label htmlFor="edit-deadline" className="text-sm font-bold">截止日期</label><input id="edit-deadline" name="deadline" type="date" defaultValue={project.deadline} className={field} /></div></div>
          </fieldset>
          {error && <p role="alert" className="rounded-xl bg-[var(--brick-pale)] px-4 py-3 text-sm font-medium text-[var(--brick)]">{error}</p>}
          <div className="flex flex-col-reverse justify-between gap-3 border-t archive-rule pt-5 sm:flex-row sm:items-center">
            {!confirmDelete ? <button type="button" onClick={() => setConfirmDelete(true)} disabled={saving} className="focus-ring inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold text-[var(--brick)] hover:bg-[var(--brick-pale)]"><Trash2 size={16} /> 删除项目</button> : <div className="rounded-xl bg-[var(--brick-pale)] p-3 text-sm"><p className="font-bold text-[var(--brick)]">会同时删除所有卡片与成果，且无法恢复。</p><div className="mt-2 flex gap-2"><button type="button" onClick={remove} disabled={deleting} className="focus-ring rounded-lg bg-[var(--brick)] px-3 py-2 font-bold text-white">{deleting ? "正在删除…" : "确认删除"}</button><button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting} className="focus-ring rounded-lg px-3 py-2 font-bold text-[var(--ink-soft)]">取消</button></div></div>}
            <button disabled={saving || deleting} className="focus-ring editorial-button sm:self-end">{saving ? <LoaderCircle className="animate-spin" size={17} /> : <Save size={17} />}{saving ? "正在保存…" : "保存修改"}</button>
          </div>
        </form>
      </section>
    </div>}
  </>;
}
