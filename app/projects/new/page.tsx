import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { NewProjectForm } from "@/components/NewProjectForm";
import { ProjectIntakeForm } from "@/components/ProjectIntakeForm";
import { getSessionUser } from "@/lib/auth/serverSession";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  // 表单提交走鉴权后的 API，匿名访问只会在填完后拿到 401。
  const user = await getSessionUser();
  if (!user) redirect("/login?from=%2Fprojects%2Fnew");
  const { draft } = await searchParams;
  const drafts = await db.projectIntakeDraft.findMany({
    where: { ownerUserId: user.id, status: { in: ["DRAFT", "PREVIEW_READY", "FAILED", "UNDERSTANDING"] }, expiresAt: { gt: new Date() } },
    orderBy: { updatedAt: "desc" }, take: 5,
    select: { id: true, status: true, revision: true, understandingState: true, expiresAt: true },
  });
  return <main id="main-content" className="shell max-w-3xl py-12 sm:py-16">
    <Link href="/projects" className="focus-ring inline-flex items-center gap-2 rounded-lg text-sm font-semibold text-[var(--ink-soft)] hover:text-[var(--navy)]"><ArrowLeft size={16} /> 返回项目列表</Link>
    <h1 className="mt-8 text-3xl font-black tracking-tight sm:text-4xl">从材料开始</h1>
    <p className="mt-3 leading-7 text-[var(--ink-soft)]">先放真实材料，核对 Agent 的理解，再建立项目。目标可以在这里改。</p>
    <ProjectIntakeForm initialDraftId={draft} openDrafts={drafts.map(item => ({ ...item, expiresAt: item.expiresAt.toISOString() }))} />
    <details className="mt-10 rounded-lg border border-[var(--rule)] px-5 py-4">
      <summary className="focus-ring cursor-pointer text-sm font-semibold text-[var(--ink-soft)]">已经有明确目标，直接填写</summary>
      <NewProjectForm />
    </details>
  </main>;
}
