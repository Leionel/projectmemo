import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Archive, ArrowLeft, ArrowRight, Bot, CalendarDays, CheckSquare, FileOutput, FileText, Goal, Sparkles, Star, type LucideIcon } from "lucide-react";
import { ActionBoard } from "@/components/ActionBoard";
import { AgentMetrics } from "@/components/AgentMetrics";
import { CaptureBox } from "@/components/CaptureBox";
import { CompetitionReadiness } from "@/components/CompetitionReadiness";
import { InterventionPanel } from "@/components/InterventionPanel";
import { KnowledgeFeed } from "@/components/KnowledgeFeed";
import { MemoryCopilot } from "@/components/MemoryCopilot";
import { ProjectSettings } from "@/components/ProjectSettings";
import { ProjectPulse } from "@/components/ProjectPulse";
import { AppError } from "@/lib/api";
import { evaluateProjectContext } from "@/lib/services/agentContextService";
import { getProjectMetrics, listActions, listInterventions } from "@/lib/repositories/agent";
import { getProjectDetail } from "@/lib/repositories/projects";
import { getDecisionTimeline } from "@/lib/services/temporalLedgerService";
import { scenarioOptions, getScenarioColor, type ActionItemData, type AgentEvidence, type InterventionData, type ProposedAction, type ProjectMetrics } from "@/lib/types";
import { buildProjectDashboard } from "@/lib/projectDashboard";
import { getSessionUser, hasProjectAccess } from "@/lib/auth/serverSession";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) {
    redirect(`/login?from=${encodeURIComponent(`/projects/${id}`)}`);
  }
  // 归属校验必须先于 evaluateProjectContext：后者会写入干预与行动，越权请求不能触发它。
  if (!(await hasProjectAccess(user.id, id))) {
    notFound();
  }
  let project;
  try {
    await evaluateProjectContext(id, {}, user.id);
    project = await getProjectDetail(id);
  } catch (error) {
    if (error instanceof AppError && error.code === "PROJECT_NOT_FOUND") notFound();
    throw error;
  }
  const [actions, metrics, temporalTimeline] = await Promise.all([listActions(id), getProjectMetrics(id), getDecisionTimeline(id)]);
  const temporalById = new Map(temporalTimeline.items.map((item) => [item.card.id, item]));
  const knowledgeCards = project.cards.map((card) => {
    const temporal = temporalById.get(card.id);
    return {
      ...card,
      temporal: temporal ? {
        topLevelState: temporal.topLevelState,
        reasonCode: temporal.reasonCode,
        displayReason: temporal.displayReason,
        evidenceRefs: temporal.evidenceRefs,
      } : undefined,
    };
  });
  const scenario = scenarioOptions.find((item) => item.value === project.scenario)?.label ?? project.scenario;
  const initialInterventions = await listInterventions(id, true);
  const interventionData = initialInterventions.map(toInterventionData);
  const actionData = actions.map(toActionData);
  const metricData = metrics as ProjectMetrics;
  const projectPath = `/projects/${id}`;
  const dashboard = buildProjectDashboard({
    projectId: id,
    deadline: project.deadline,
    cards: project.cards.map((card) => ({ type: String(card.type) })),
    artifacts: project.artifacts.map((artifact) => ({ artifactType: String(artifact.artifactType) })),
    actions: actions.map((action) => ({ ...action, status: String(action.status) })),
    interventions: initialInterventions.map((item) => ({ ...item, status: String(item.status), triggerType: String(item.triggerType) })),
  });
  const openReminderCount = dashboard.activeReminderCount;
  const openActionCount = dashboard.activeActionCount;
  const importantCardCount = project.cards.filter((card) => card.importance >= 4).length;
  const outline = project.artifacts.find((artifact) => String(artifact.artifactType) === "competition_outline");
  const latestArtifact = project.artifacts[0];

  return <main id="main-content" className="shell py-10 sm:py-12">
    <Link href="/projects" className="focus-ring inline-flex items-center gap-2 rounded-lg text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--navy)]"><ArrowLeft size={16} /> 返回项目列表</Link>
    <header className="mt-7 border-y archive-rule py-7">
      <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><span className={`paper-tab px-3 py-1.5 text-xs font-bold ${getScenarioColor(project.scenario)}`}>{scenario}</span>{project.archivedAt && <span className="rounded-full bg-[var(--paper-strong)] px-2.5 py-1 text-xs font-bold text-[var(--ink-soft)]"><Archive aria-hidden="true" size={12} className="mr-1 inline" />已归档</span>}<span className="text-xs text-[var(--muted)]">更新于 {project.updatedAt.toLocaleDateString("zh-CN")}</span></div>
          <p className="archive-label mt-5">项目工作档案</p>
          <h1 className="mt-3 max-w-4xl text-3xl font-black tracking-tight [overflow-wrap:anywhere] sm:text-4xl">{project.title}</h1>
          <p className="mt-3 max-w-3xl leading-7 text-[var(--ink-soft)] [overflow-wrap:anywhere]">{project.description}</p>
        </div>
        <div className="flex flex-wrap gap-3"><ProjectSettings project={{ id, title: project.title, description: project.description, goal: project.goal, scenario: project.scenario, deadline: project.deadline ? project.deadline.toISOString().slice(0, 10) : "", archivedAt: project.archivedAt ? project.archivedAt.toISOString() : null }} /><Link href={"/projects/" + id + "/generate"} className="focus-ring editorial-button shrink-0"><FileOutput size={18} /> 生成项目成果</Link></div>
      </div>
    </header>

    <ProjectPulse dashboard={dashboard} goal={project.goal} deadlineLabel={project.deadline ? project.deadline.toLocaleDateString("zh-CN") : "暂未设置"} />

    <nav aria-label="项目页目录" className="sticky top-3 z-20 mt-5 rounded-2xl border border-[var(--rule)] bg-[rgba(255,253,248,.94)] p-2 shadow-[var(--shadow-sm)] backdrop-blur">
      <div className="flex items-center gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:thin]">
        <span className="shrink-0 px-2 text-xs font-black text-[var(--muted)]">项目大纲</span>
        <WorkspaceNavLink href="#capture-box" label="记录进展" icon={FileText} />
        <WorkspaceNavLink href="#interventions" label="主动提醒" count={openReminderCount} icon={Sparkles} />
        <WorkspaceNavLink href="#action-board" label="待办" count={openActionCount} icon={CheckSquare} />
        <WorkspaceNavLink href="#knowledge-assets" label="知识资产" count={project.cards.length} icon={Star} />
        <WorkspaceNavLink href="#competition-readiness" label="参赛准备" count={dashboard.readiness.completed} icon={Goal} />
        <WorkspaceNavLink href={`${projectPath}/generate`} label="成果" count={project._count.artifacts} icon={FileOutput} />
      </div>
    </nav>

    <div className="mt-6"><CaptureBox projectId={id} /></div>
    <section aria-label="常用项目入口" className="mt-4 rounded-[1.35rem] border border-[var(--rule)] bg-[var(--card-bg)] p-4 sm:p-5">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]"><Link href={dashboard.nextAction.href} className={"focus-ring group flex min-w-0 items-center justify-between gap-4 rounded-2xl p-4 text-white shadow-[var(--shadow-sm)] transition hover:-translate-y-0.5 " + (dashboard.nextAction.tone === "critical" ? "bg-[var(--brick)]" : "bg-[var(--navy)]")}><span><span className="text-[11px] font-black uppercase tracking-[.14em] text-white/70">忆程建议下一步</span><span className="mt-1 block text-base font-black">{dashboard.nextAction.label}</span><span className="mt-1 block text-xs leading-5 text-white/75">{dashboard.nextAction.detail}</span></span><ArrowRight size={20} className="shrink-0 transition group-hover:translate-x-1" /></Link><div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3"><QuickJump href={`${projectPath}?cardSort=importance#knowledge-assets`} icon={Star} label="重点记录" detail={`${importantCardCount} 张`} /><QuickJump href={`${projectPath}/generate?type=competition_outline`} icon={FileOutput} label={outline ? "作品说明" : "生成大纲"} detail={outline ? "已有版本" : "尚未生成"} /><QuickJump href={`${projectPath}?openCopilot=1#memory-copilot`} icon={Bot} label="问忆程" detail="检索记忆" /></div></div>
    </section>

    <div className="mt-8"><InterventionPanel projectId={id} initialInterventions={interventionData} demoEnabled={process.env.DEMO_SCENARIOS !== "false"} /></div>
    <div className="mt-9 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-8">
        <ActionBoard projectId={id} initialActions={actionData} />
        <KnowledgeFeed projectId={id} cards={knowledgeCards} />
        <CompetitionReadiness readiness={dashboard.readiness} />
        <MemoryCopilot projectId={id} />
      </div>
      <aside id="project-output" className="card-surface hidden scroll-mt-24 min-w-0 rounded-[1.45rem] p-5 lg:sticky lg:top-24 lg:block"><p className="archive-label">项目概览</p><div className="mt-5 space-y-5"><Info icon={Goal} label="项目目标" value={project.goal} /><Info icon={CalendarDays} label="截止日期" value={project.deadline ? project.deadline.toLocaleDateString("zh-CN") : "暂未设置"} /></div><div className="mt-6 grid grid-cols-3 gap-2 border-y archive-rule py-5 text-center"><Stat value={project._count.cards} label="卡片" /><Stat value={project._count.captures} label="碎片" /><Stat value={project._count.artifacts} label="成果" /></div><div className="mt-5 rounded-xl bg-[var(--paper-strong)] p-3 text-xs leading-5 text-[var(--ink-soft)]"><p className="font-black text-[var(--navy)]">闭环进度</p><p className="mt-1">已关联 {metricData.relationCount} 条卡片关系，完成 {metricData.closedLoopCount} 次行动回执。</p></div>{latestArtifact && <p className="mt-4 text-xs leading-5 text-[var(--muted)]">最近成果：<span className="font-bold text-[var(--ink-soft)]">{latestArtifact.artifactType === "competition_outline" ? "作品说明大纲" : latestArtifact.artifactType === "weekly_report" ? "项目周报" : "项目材料"}</span> · {latestArtifact.createdAt.toLocaleDateString("zh-CN")}</p>}<Link href={`${projectPath}/generate?type=weekly_report`} className="focus-ring editorial-button-secondary mt-5 flex">前往生成周报 <FileOutput size={16} /></Link><div className="mt-6 border-t archive-rule pt-5"><p className="archive-label">项目成效</p><div className="mt-3"><AgentMetrics metrics={metricData} compact /></div></div></aside>
    </div>
  </main>;
}

function WorkspaceNavLink({ href, label, count, icon: Icon }: { href: string; label: string; count?: number; icon: LucideIcon }) {
  return <a href={href} className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-bold text-[var(--ink-soft)] transition hover:bg-[var(--teal-pale)] hover:text-[var(--teal-strong)]"><Icon size={14} />{label}{count !== undefined && <span className="rounded-md bg-[var(--paper-strong)] px-1.5 py-0.5 text-[10px] text-[var(--navy)]">{count}</span>}</a>;
}

function QuickJump({ href, icon: Icon, label, detail }: { href: string; icon: LucideIcon; label: string; detail: string }) {
  return <a href={href} className="focus-ring group flex min-w-0 items-center gap-3 rounded-xl border border-[var(--glass-border)] bg-[var(--card-bg)] px-3.5 py-3 text-left transition hover:-translate-y-0.5 hover:border-[var(--teal)] hover:bg-[var(--paper-strong)] hover:shadow-[var(--shadow-sm)]"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--teal-pale)] text-[var(--teal-strong)] transition group-hover:bg-[var(--teal)] group-hover:text-white"><Icon size={17} /></span><span className="min-w-0"><span className="block truncate text-sm font-black text-[var(--navy)]">{label}</span><span className="mt-0.5 block truncate text-xs text-[var(--ink-soft)]">{detail}</span></span></a>;
}

function toInterventionData(item: Awaited<ReturnType<typeof listInterventions>>[number]): InterventionData {
  return {
    id: item.id,
    projectId: item.projectId,
    triggerType: String(item.triggerType) as InterventionData["triggerType"],
    dedupeKey: item.dedupeKey,
    status: String(item.status) as InterventionData["status"],
    severity: item.severity,
    title: item.title,
    content: item.content,
    evidence: item.evidence as unknown as AgentEvidence,
    proposedActions: item.proposedActions as unknown as ProposedAction[],
    isSimulated: item.isSimulated,
    snoozedUntil: item.snoozedUntil?.toISOString() ?? null,
    dismissReason: item.dismissReason,
    handledAt: item.handledAt?.toISOString() ?? null,
    evidenceCardId: item.evidenceCardId,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    actions: item.actions?.map(toActionData),
  };
}

type ActionLike = {
  id: string;
  projectId: string;
  sourceInterventionId: string | null;
  sourceCardId: string | null;
  resultCardId: string | null;
  title: string;
  description: string | null;
  priority: number;
  status: string;
  dueAt: Date | null;
  resultText: string | null;
  isSimulated: boolean;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toActionData(item: ActionLike): ActionItemData {
  return {
    id: item.id,
    projectId: item.projectId,
    sourceInterventionId: item.sourceInterventionId,
    sourceCardId: item.sourceCardId,
    resultCardId: item.resultCardId,
    title: item.title,
    description: item.description,
    priority: item.priority,
    status: String(item.status) as ActionItemData["status"],
    dueAt: item.dueAt?.toISOString() ?? null,
    resultText: item.resultText,
    isSimulated: item.isSimulated,
    completedAt: item.completedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function Info({ icon: Icon, label, value }: { icon: typeof Goal; label: string; value: string }) {
  return <div className="flex gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--teal-pale)] text-[var(--teal)]"><Icon size={17} /></span><div><p className="text-xs font-bold text-[var(--muted)]">{label}</p><p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">{value}</p></div></div>;
}

function Stat({ value, label }: { value: number; label: string }) {
  return <div><p className="text-xl font-black text-[var(--navy)]">{value}</p><p className="mt-1 text-xs text-[var(--muted)]">{label}</p></div>;
}
