import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ArtifactGenerator } from "@/components/ArtifactGenerator";
import { getProjectDetail } from "@/lib/repositories/projects";
import { AppError } from "@/lib/api";
import { getSessionUser, hasProjectAccess } from "@/lib/auth/serverSession";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function GeneratePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ type?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  const user = await getSessionUser();
  if (!user) {
    redirect(`/login?from=${encodeURIComponent(`/projects/${id}/generate`)}`);
  }
  if (!(await hasProjectAccess(user.id, id))) {
    notFound();
  }
  let project;
  try { project = await getProjectDetail(id); } catch (error) { if (error instanceof AppError && error.code === "PROJECT_NOT_FOUND") notFound(); throw error; }
  return <main id="main-content" className="shell py-10 sm:py-12"><Link href={`/projects/${id}`} className="focus-ring inline-flex items-center gap-2 rounded-lg text-sm font-semibold text-[var(--ink-soft)] hover:text-[var(--navy)]"><ArrowLeft size={16} /> 返回项目详情</Link><header className="mt-7 border-y archive-rule py-7"><p className="archive-label">成果文档室</p><h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">把项目记忆变成成果</h1><p className="mt-3 max-w-3xl leading-7 text-[var(--ink-soft)]">基于《{project.title}》的 {project.cards.length} 张知识卡片，生成可复制、可导出 Markdown 的中文项目材料。</p></header><ArtifactGenerator key={query.type ?? "weekly_report"} projectId={id} initialArtifacts={project.artifacts} /></main>;
}
