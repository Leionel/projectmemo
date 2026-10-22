import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { getSessionUser } from "@/lib/auth/serverSession";
import { loadGlobalFocus } from "@/lib/server/globalFocus";
import { missionStatusLabels } from "@/lib/mission/presentation";
import { PageHeading } from "@/components/PageHeading";
import { EvidenceText } from "@/components/EvidenceText";
import type { FocusEntry } from "@/lib/types/globalFocus";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function FocusPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?from=%2Ffocus");
  const focus = await loadGlobalFocus(user.id, (await searchParams).archived === "1");
  const empty = ![focus.waiting, focus.running, focus.actions, focus.reminders, focus.records].some(rows => rows.length);
  return <main id="main-content" className="shell workspace-index">
    <PageHeading eyebrow="我的工作台" title="焦点" description="先回应需要你的事，再继续正在推进的目标。" actions={<Link href="/projects" className="workspace-tool focus-ring">查看项目<ArrowRight size={14} aria-hidden="true" /></Link>} />
    <form action="/focus" className="workspace-filters"><label className="flex items-center gap-2 text-xs text-[var(--ink-soft)]"><input type="checkbox" name="archived" value="1" defaultChecked={focus.archived} />包含归档项目</label><button className="workspace-tool focus-ring">更新范围</button></form>
    {!focus.missionEnabled && <p role="status" className="mb-4 text-sm text-[var(--ink-soft)]">长期委托当前未开启，已有委托数据仍保留。</p>}
    {empty ? <section className="workspace-empty workspace-list-panel"><h2 className="text-base font-semibold">从一个真实项目开始</h2><p>当前范围内没有待回应或推进中的事项。进入项目记录资料，或委托一个长期目标。</p><Link className="workspace-link focus-ring" href="/projects">选择或创建项目<ArrowRight size={14} aria-hidden="true" /></Link></section> : <div className="focus-page-grid">
      <div className="grid content-start gap-4">
        <FocusGroup title="需要回应的委托" items={focus.waiting} kind="mission" />
        <FocusGroup title="正在推进的委托" items={focus.running} kind="mission" />
        <FocusGroup title="需要处理的行动" items={focus.actions} kind="action" />
      </div><aside className="grid content-start gap-4" aria-label="提醒与近期资料">
        <FocusGroup title="有效提醒" items={focus.reminders} kind="reminder" />
        {focus.records.length > 0 && <details className="workspace-list-panel focus-records"><summary className="focus-ring">最近保存的资料（{focus.records.length}）</summary><FocusGroup title="最近保存的资料" items={focus.records} kind="record" /></details>}
      </aside>
    </div>}
    {focus.hasMore && <p className="mt-4 text-xs text-[var(--ink-soft)]">每类最多显示 6 项。<Link href="/projects" className="workspace-link focus-ring">进入所属项目查看全部 →</Link></p>}
  </main>;
}
function FocusGroup({ title, items, kind }: { title: string; items: FocusEntry[]; kind: "mission" | "action" | "reminder" | "record" }) {
  if (!items.length) return null;
  const renderItem = (item: FocusEntry) => {
    const base = `/projects/${item.projectId}`;
    const href = kind === "mission" ? `${base}/missions?mission=${encodeURIComponent(item.id)}` : kind === "action" ? `${base}/actions#action-${item.id}` : kind === "reminder" ? `${base}/actions#intervention-${item.id}` : `${base}/knowledge#card-${item.id}`;
    const label = kind === "mission" ? item.status === "WAITING_INPUT" ? "补充委托资料" : item.status === "WAITING_APPROVAL" ? "审阅待批准提案" : item.status === "PAUSED" ? "查看暂停原因" : item.status === "FAILED" ? "查看失败原因" : "查看委托进展" : kind === "action" ? "打开行动" : kind === "reminder" ? "查看提醒依据" : "查看资料与来源";
    return <article key={item.id} className="workspace-row"><div className="min-w-0"><div className="workspace-row-meta">{kind === "mission" && <span className={item.status === "READY" || item.status === "RUNNING" ? "workspace-status workspace-status-neutral" : "workspace-status"}>{missionStatusLabels[item.status]}</span>}{kind === "action" && <span>{item.status === "DOING" ? "进行中" : "待开始"}</span>}<span>{item.projectTitle}</span></div><h3>{item.title}</h3>{item.detail && <p><EvidenceText text={item.detail} /></p>}{item.activity && <p>{item.activity}{item.activityAt ? ` · ${new Date(item.activityAt).toLocaleString("zh-CN")}` : ""}</p>}{item.recordedAt && <p className="font-mono">{kind === "action" ? "截止：" : "保存于："}{new Date(item.recordedAt).toLocaleString("zh-CN")}</p>}</div><Link className="workspace-link focus-ring" href={href}>{label}<ArrowRight size={14} aria-hidden="true" /></Link></article>;
  };
  return <section className="workspace-list-panel" aria-label={title}><div className="workspace-panel-heading"><h2>{title}</h2></div>{items.slice(0, 3).map(renderItem)}{items.length > 3 && <details className="focus-more"><summary className="focus-ring">展开其余 {items.length - 3} 项{kind === "reminder" ? "提醒" : "事项"}</summary>{items.slice(3).map(renderItem)}</details>}</section>;
}
