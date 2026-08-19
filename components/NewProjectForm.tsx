"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { scenarioOptions } from "@/lib/types";

const initialValues = { title: "", description: "", goal: "", scenario: "COMPETITION", deadline: "" };
type Field = keyof typeof initialValues;

function validate(values: typeof initialValues) {
  const errors: Partial<Record<Field, string>> = {};
  const title = values.title.trim(); const description = values.description.trim(); const goal = values.goal.trim();
  if (title.length < 2) errors.title = "项目名称至少 2 个字"; else if (title.length > 80) errors.title = "项目名称不能超过 80 个字";
  if (description.length < 10) errors.description = "请用至少 10 个字说明项目要解决的问题"; else if (description.length > 500) errors.description = "项目描述不能超过 500 个字";
  if (goal.length < 2) errors.goal = "请填写一个明确的项目目标"; else if (goal.length > 300) errors.goal = "项目目标不能超过 300 个字";
  return errors;
}

export function NewProjectForm() {
  const [values, setValues] = useState(initialValues);
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const errors = validate(values);

  function update(field: Field, value: string) { setValues((current) => ({ ...current, [field]: value })); setError(""); }
  function fieldError(field: Field) { return touched[field] ? errors[field] : undefined; }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched({ title: true, description: true, goal: true, scenario: true, deadline: true });
    if (Object.keys(errors).length) return;
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "创建失败，请稍后重试");
      // A new project changes the whole workspace context. A full navigation
      // avoids showing stale server data while the newly created archive loads.
      window.location.assign(`/projects/${data.project.id}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "创建失败，请稍后重试"); setLoading(false); }
  }

  const fieldClass = "focus-ring editorial-input mt-2 w-full px-4 py-3 placeholder:text-[var(--placeholder)]";
  return <form onSubmit={submit} className="card-surface mt-9 space-y-6 rounded-[1.7rem] p-6 sm:p-8" aria-busy={loading}><fieldset disabled={loading} className="space-y-6 disabled:opacity-70"><div className="border-b archive-rule pb-5"><p className="archive-label">新建项目档案</p><p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">先定义目标和场景，Agent 会以此理解后续项目记录。输入内容会在提交失败时保留。</p></div>
    <div><div className="flex items-end justify-between gap-3"><label htmlFor="title" className="text-sm font-bold">项目名称</label><span className="text-xs text-[var(--muted)]">{values.title.length} / 80</span></div><input id="title" value={values.title} onChange={(event) => update("title", event.target.value)} onBlur={() => setTouched((old) => ({ ...old, title: true }))} aria-invalid={Boolean(fieldError("title"))} aria-describedby="title-error" minLength={2} maxLength={80} required className={fieldClass} placeholder="例如：人工智能创意赛作品开发" />{fieldError("title") && <p id="title-error" className="mt-2 text-sm font-medium text-[var(--brick)]">{fieldError("title")}</p>}</div>
    <div><div className="flex items-end justify-between gap-3"><label htmlFor="description" className="text-sm font-bold">项目描述</label><span className="text-xs text-[var(--muted)]">{values.description.length} / 500</span></div><textarea id="description" value={values.description} onChange={(event) => update("description", event.target.value)} onBlur={() => setTouched((old) => ({ ...old, description: true }))} aria-invalid={Boolean(fieldError("description"))} aria-describedby="description-error" minLength={10} maxLength={500} required rows={4} className={fieldClass} placeholder="这个项目要解决什么问题？面向谁？" />{fieldError("description") && <p id="description-error" className="mt-2 text-sm font-medium text-[var(--brick)]">{fieldError("description")}</p>}</div>
    <div><div className="flex items-end justify-between gap-3"><label htmlFor="goal" className="text-sm font-bold">项目目标</label><span className="text-xs text-[var(--muted)]">{values.goal.length} / 300</span></div><textarea id="goal" value={values.goal} onChange={(event) => update("goal", event.target.value)} onBlur={() => setTouched((old) => ({ ...old, goal: true }))} aria-invalid={Boolean(fieldError("goal"))} aria-describedby="goal-error" minLength={2} maxLength={300} required rows={3} className={fieldClass} placeholder="希望最终完成什么成果？" />{fieldError("goal") && <p id="goal-error" className="mt-2 text-sm font-medium text-[var(--brick)]">{fieldError("goal")}</p>}</div>
    <div className="grid gap-5 sm:grid-cols-2"><div><label htmlFor="scenario" className="text-sm font-bold">项目场景</label><select id="scenario" value={values.scenario} onChange={(event) => update("scenario", event.target.value)} className={fieldClass}>{scenarioOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div><div><label htmlFor="deadline" className="text-sm font-bold">截止日期 <span className="font-normal text-[var(--muted)]">（可选）</span></label><input id="deadline" value={values.deadline} onChange={(event) => update("deadline", event.target.value)} type="date" className={fieldClass} /></div></div></fieldset>
    {error && <p role="alert" className="rounded-xl bg-[var(--brick-pale)] px-4 py-3 text-sm font-medium text-[var(--brick)]">{error}</p>}<div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Link href="/projects" className="focus-ring editorial-button-secondary">取消</Link><button disabled={loading} className="focus-ring editorial-button disabled:cursor-not-allowed disabled:opacity-60">{loading ? <LoaderCircle className="animate-spin" size={18} /> : <ArrowRight size={18} />}{loading ? "正在创建…" : "创建项目并开始沉淀"}</button></div></form>;
}
