import { isFeatureEnabled } from "@/lib/config/features";
import { AgentMemoryPanel } from "./AgentMemoryPanel";
import Link from "next/link";
import { ArrowRight, Plus, Search } from "lucide-react";
import { MemoryScopeNav } from "@/components/MemoryScopeNav";
import { PageHeading } from "@/components/PageHeading";
import { EvidenceText } from "@/components/EvidenceText";
import { knowledgeTypeLabels, knowledgeTypes, temporalStateLabels, type TemporalTopLevelState } from "@/lib/types";
import { loadGlobalWorkspace, type WorkspaceFilters } from "@/lib/server/globalWorkspace";

/** 常用类型直接给出，其余收进“更多类型”；仍是同一个 type 查询参数。 */
const primaryTypes = ["experiment_log", "meeting_note", "requirement", "risk"] as const;
const moreTypes = knowledgeTypes.filter(t => !(primaryTypes as readonly string[]).includes(t));

const temporalBadge: Record<TemporalTopLevelState, string> = {
  CURRENT: "bg-[var(--teal-pale)] text-[var(--teal-strong)]",
  SUPERSEDED: "bg-[var(--paper-strong)] text-[var(--muted)]",
  CONTESTED: "bg-[var(--brick-pale)] text-[var(--brick)]",
  UNKNOWN: "bg-[var(--amber)]/10 text-[var(--amber)]",
};

export async function GlobalWorkspacePage({ userId, mode, input }: { userId: string; mode: "memory" | "actions"; input: WorkspaceFilters }) {
  const data = await loadGlobalWorkspace(userId, mode, input);
  const { filters: f } = data;
  const memory = mode === "memory", path = memory ? "/memory" : "/actions";
  const filtered = Boolean(f.q || f.project || f.type);
  const pageHref = (page: number) => {
    const query = new URLSearchParams({ ...(f.q ? { q: f.q } : {}), ...(f.project ? { project: f.project } : {}), ...(memory && f.type ? { type: f.type } : {}), ...(f.archived ? { archived: "1" } : {}), page: String(page) });
    return `${path}?${query}`;
  };
  const typeHref = (type: string) => {
    const query = new URLSearchParams({ ...(f.q ? { q: f.q } : {}), ...(f.project ? { project: f.project } : {}), ...(type ? { type } : {}), ...(f.archived ? { archived: "1" } : {}) });
    return `${path}${query.size ? `?${query}` : ""}`;
  };
  return <main id="main-content" className="shell workspace-index">
    <PageHeading eyebrow="我的工作台" title={memory ? "项目记忆档案" : "行动与提醒"}
      description={memory ? "跨项目查找已保存的记忆，回到所属项目查看来源与结论演进。" : "集中查看各项目的待办行动和当前提醒，回到原项目处理。"}
      actions={<Link prefetch={false} className="editorial-button-secondary focus-ring" href={f.project && data.projects.some(p => p.id === f.project) ? `/projects/${f.project}/${memory ? "records#capture-box" : "actions#action-board"}` : "/projects"}><Plus size={14} aria-hidden="true" />{memory ? "选择项目记录进展" : "选择项目新增行动"}</Link>} />
    {memory && <MemoryScopeNav />}
    <form action={path} className="workspace-filters" aria-label={memory ? "筛选项目记忆" : "筛选待办与提醒"}>
      <label className="workspace-search"><span className="sr-only">{memory ? "搜索记忆标题或摘要" : "搜索行动或提醒"}</span><Search size={15} aria-hidden="true" /><input className="editorial-input focus-ring" name="q" defaultValue={f.q} placeholder={memory ? "搜索标题或摘要" : "搜索行动或提醒"} maxLength={200} /></label>
      <label><span className="sr-only">所属项目</span><select name="project" defaultValue={f.project} className="editorial-input focus-ring"><option value="">全部项目</option>{f.project && !data.projects.some(p => p.id === f.project) && <option value={f.project}>项目不可访问或已归档</option>}{data.projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
      {memory && f.type && <input type="hidden" name="type" value={f.type} />}
      <label className="flex items-center gap-2 text-xs text-[var(--ink-soft)]"><input type="checkbox" name="archived" value="1" defaultChecked={f.archived} />包含归档项目</label>
      <button className="editorial-button-secondary focus-ring" type="submit">应用筛选</button>{filtered && <Link prefetch={false} className="workspace-link focus-ring" href={path}>清除筛选</Link>}
    </form>
    {memory && <nav aria-label="记忆类型" className="workspace-type-chips">
      {[["", "全部类型"], ...primaryTypes.map(t => [t, knowledgeTypeLabels[t]] as const)].map(([value, label]) => <Link key={value || "all"} prefetch={false} href={typeHref(value)} aria-current={f.type === value ? "page" : undefined} className="focus-ring">{label}</Link>)}
      <details className={moreTypes.includes(f.type as typeof moreTypes[number]) ? "is-current" : undefined}><summary className="focus-ring">{moreTypes.includes(f.type as typeof moreTypes[number]) ? knowledgeTypeLabels[f.type as typeof moreTypes[number]] : "更多类型"}</summary>
        <div>{moreTypes.map(t => <Link key={t} prefetch={false} href={typeHref(t)} aria-current={f.type === t ? "page" : undefined} className="focus-ring">{knowledgeTypeLabels[t]}</Link>)}</div></details>
    </nav>}
    {memory && isFeatureEnabled("FOCUS_AGENT_ENABLED",false) && f.project && data.projects.some(p=>p.id===f.project) && <AgentMemoryPanel key={userId+f.project} projectId={f.project}/>} 
    {memory ? <section aria-label="跨项目记忆" className="workspace-list-panel">
      <div className="workspace-panel-heading"><h2>已保存的记忆</h2></div>
      {data.cards.map(card => <article key={card.id} className="workspace-row"><div className="min-w-0"><div className="workspace-row-meta workspace-row-tags"><span className="workspace-tag" data-kind="type">{knowledgeTypeLabels[card.type]}</span>{card.capture.sourceType && <span className="workspace-tag">{card.capture.sourceType}</span>}{card.temporal && card.temporal.reasonCode !== "NO_SUPPORTING_EVIDENCE" && <span className={`workspace-tag ${temporalBadge[card.temporal.topLevelState]}`} title={`时态只描述与当前结论的关系：${card.temporal.displayReason}`}>{temporalStateLabels[card.temporal.topLevelState]}</span>}<span>{card.project.title}{card.project.archivedAt ? " · 已归档" : ""}</span><time dateTime={card.createdAt.toISOString()}>{card.createdAt.toLocaleDateString("zh-CN")}</time></div><h3>{card.title}</h3>{card.summary.trim() !== card.title.trim() && <p><EvidenceText text={card.summary} /></p>}</div><Link prefetch={false} className="workspace-link focus-ring" href={`/projects/${card.project.id}/knowledge#card-${card.id}`}>查看记忆与来源<ArrowRight size={14} aria-hidden="true" /></Link></article>)}
      {!data.cards.length && <Empty filtered={filtered || f.page > 1} memory />}
    </section> : <div className="workspace-inbox-grid">
      <section aria-label="主动提醒" className="workspace-list-panel"><div className="workspace-panel-heading"><h2>主动提醒</h2></div>{data.reminders.map(item => <article className="workspace-row" key={item.id}><div className="min-w-0"><div className="workspace-row-meta"><span className="workspace-status">优先级 {item.severity}/5</span><span>{item.project.title}{item.project.archivedAt ? " · 已归档" : ""}</span></div><h3>{item.title}</h3><p>{item.content}</p></div><Link prefetch={false} className="workspace-link focus-ring" href={`/projects/${item.project.id}/actions#intervention-${item.id}`}>查看提醒依据<ArrowRight size={14} aria-hidden="true" /></Link></article>)}{!data.reminders.length && <Empty filtered={filtered || f.page > 1} />}</section>
      <section aria-label="待办行动" className="workspace-list-panel"><div className="workspace-panel-heading"><h2>待办行动</h2></div>{data.actions.map(item => <article className="workspace-row" key={item.id}><div className="min-w-0"><div className="workspace-row-meta"><span>{item.status === "DOING" ? "进行中" : "待开始"} · 优先级 {item.priority}/5</span><span>{item.project.title}{item.project.archivedAt ? " · 已归档" : ""}</span></div><h3>{item.title}</h3><p>{item.dueAt ? `${item.dueAt.toLocaleDateString("zh-CN")} 截止` : "未设截止"}{item.description ? ` · ${item.description}` : ""}</p></div><Link prefetch={false} className="workspace-link focus-ring" href={`/projects/${item.project.id}/actions#action-${item.id}`}>打开行动<ArrowRight size={14} aria-hidden="true" /></Link></article>)}{!data.actions.length && <Empty filtered={filtered || f.page > 1} />}</section>
    </div>}
    <nav aria-label="结果分页" className="workspace-pagination">{f.page > 1 && <Link prefetch={false} className="workspace-tool focus-ring" href={pageHref(f.page - 1)}>上一页</Link>}<span>第 {f.page} 页 · 每类最多 30 条</span>{data.hasMore && <Link prefetch={false} className="workspace-tool focus-ring" href={pageHref(f.page + 1)}>下一页</Link>}</nav>
  </main>;
}

function Empty({ filtered, memory = false }: { filtered: boolean; memory?: boolean }) {
  return <div className="workspace-empty"><h3>{filtered ? "没有符合当前筛选的内容" : memory ? "还没有项目记忆" : "当前没有待处理事项"}</h3><p>{filtered ? "调整项目或关键词，或清除筛选再看看。" : memory ? "进入一个项目记录真实进展，生成的知识卡会汇总到这里。" : "项目中的新提醒和未完成行动会汇总到这里。"}</p>{!filtered && <Link prefetch={false} className="workspace-link focus-ring" href="/projects">选择项目<ArrowRight size={14} aria-hidden="true" /></Link>}</div>;
}
