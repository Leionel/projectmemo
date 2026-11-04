import Link from "next/link";
import { scenarioOptions, getScenarioColor } from "@/lib/types";
import { ProjectCardActions } from "@/components/ProjectCardActions";
import type { ProjectDashboard } from "@/lib/projectDashboard";

export type ProjectCardData = {
  id: string;
  title: string;
  description: string;
  scenario: string;
  deadline: Date | string | null;
  /** 非空表示该项目已归档：仍然可打开、可恢复，只是不再占用主列表。 */
  archivedAt: Date | string | null;
  updatedAt: Date | string;
  canDelete?: boolean;
  _count: { cards: number; artifacts: number };
  dashboard: ProjectDashboard;
};

export function ProjectCard({ project }: { project: ProjectCardData }) {
  const scenario = scenarioOptions.find((item) => item.value === project.scenario)?.label ?? project.scenario;
  const dashboard = project.dashboard;
  const urgent = dashboard.deadline.kind === "overdue" || dashboard.deadline.kind === "urgent";
  const next = dashboard.nextAction;
  const nextHref = project.scenario !== "COMPETITION" && next.detail.startsWith("参赛准备度") ? `/projects/${project.id}/records` : next.href;
  return <article className="project-card">
    <div className="project-card-top">
      <span className={`project-card-tag ${getScenarioColor(project.scenario)}`}>{scenario}</span>
      {urgent ? <span className="project-card-deadline">{dashboard.deadline.label}</span> : <span className="project-card-updated">更新于 <time dateTime={new Date(project.updatedAt).toISOString()}>{new Date(project.updatedAt).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}</time></span>}
    </div>
    <h2 className="project-card-title"><Link prefetch={false} href={`/projects/${project.id}`} className="focus-ring">{project.title}</Link></h2>
    <Link prefetch={false} href={nextHref} className="project-card-next focus-ring" data-tone={next.tone}><strong>{next.label}：</strong>{next.detail}</Link>
    {project.scenario === "COMPETITION" && <div className="project-card-readiness" title="只是这份清单的完成比例，不代表项目整体完成率">
      <div><span>参赛准备度</span><span>{dashboard.readiness.completed} / {dashboard.readiness.total} 项已形成</span></div>
      <div className="project-card-bar"><div style={{ width: `${dashboard.readiness.percentage}%` }} /></div>
    </div>}
    <p className="project-card-stats">
      <span data-alert={dashboard.activeReminderCount > 0 ? "true" : undefined}><strong>{dashboard.activeReminderCount}</strong> 条提醒</span>
      <span><strong>{dashboard.activeActionCount}</strong> 项待办</span>
      <span><strong>{project._count.cards}</strong> 张卡片</span>
      <span><strong>{project._count.artifacts}</strong> 份成果</span>
    </p>
    <div className="project-card-actions">
      <Link prefetch={false} href={`/projects/${project.id}`} className="project-card-open focus-ring">打开项目</Link>
      <Link prefetch={false} href={`/projects/${project.id}/records`} className="project-card-record focus-ring">记录最新进展</Link>
    </div>
    <ProjectCardActions projectId={project.id} projectTitle={project.title} canDelete={project.canDelete} expectedVersion={new Date(project.updatedAt).toISOString()} archived={project.archivedAt !== null} />
  </article>;
}
