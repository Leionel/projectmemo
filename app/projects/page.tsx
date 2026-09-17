import Link from "next/link";
import { redirect } from "next/navigation";
import { Archive, Plus, Sparkles } from "lucide-react";
import { PageHeading } from "@/components/PageHeading";
import { ProjectList } from "@/components/ProjectList";
import { ProjectCard } from "@/components/ProjectCard";
import { listProjects } from "@/lib/repositories/projects";
import { getSessionUser } from "@/lib/auth/serverSession";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ProjectsPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login?from=%2Fprojects");
  }
  const projects = await listProjects(user.id);
  const archivedProjects = await listProjects(user.id, { archived: "only" });

  return <main id="main-content" className="shell py-12 sm:py-16"><PageHeading eyebrow="项目空间" title="把过程变成项目资产" description="选择一个项目继续沉淀，或创建新的项目记忆空间。" actions={<Link href="/projects/new" className="focus-ring editorial-button"><Plus size={18} /> 创建新项目</Link>} />{projects.length ? <ProjectList projects={projects} /> : <div className="card-surface mt-10 grid min-h-80 place-items-center rounded-[1.7rem] p-8 text-center"><div><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--teal-pale)] text-[var(--teal-strong)]"><Sparkles size={26} /></span><h2 className="mt-5 text-xl font-bold">从第一个项目开始</h2><p className="mt-2 text-[var(--ink-soft)]">创建项目后，忆程会帮你沉淀每一条过程记录。</p><Link href="/projects/new" className="focus-ring mt-6 editorial-button"><Plus size={17} /> 创建项目</Link></div></div>}
    {archivedProjects.length > 0 && <details className="card-surface mt-10 rounded-[1.35rem] p-5 sm:p-6">
      <summary className="focus-ring cursor-pointer list-none rounded-lg text-sm font-bold text-[var(--ink-soft)]">
        <Archive aria-hidden="true" size={16} className="mr-2 inline text-[var(--teal-strong)]" />
        已归档项目（{archivedProjects.length}）
        <span className="mt-1 block text-xs font-medium text-[var(--muted)] sm:ml-6 sm:mt-0 sm:inline">归档只让项目离开主列表，它的记忆、行动与成果都保持有效，随时可以恢复。</span>
      </summary>
      <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {archivedProjects.map((project) => <ProjectCard key={project.id} project={project} />)}
      </div>
    </details>}
  </main>;
}
