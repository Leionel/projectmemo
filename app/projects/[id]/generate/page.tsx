import { notFound, redirect } from "next/navigation";
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
  return <><header className="mb-5"><h2 className="text-lg font-bold">成果文档</h2><p className="mt-2 text-sm text-[var(--ink-soft)]">基于《{project.title}》的 {project.cards.length} 张知识卡片，生成和审阅项目材料。</p></header><ArtifactGenerator key={query.type ?? "weekly_report"} projectId={id} initialArtifacts={project.artifacts} /></>;
}
