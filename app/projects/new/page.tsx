import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { NewProjectForm } from "@/components/NewProjectForm";
import { getSessionUser } from "@/lib/auth/serverSession";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function NewProjectPage() {
  // 表单提交走鉴权后的 API，匿名访问只会在填完后拿到 401。
  if (!(await getSessionUser())) {
    redirect("/login?from=%2Fprojects%2Fnew");
  }
  return <main id="main-content" className="shell max-w-3xl py-12 sm:py-16"><Link href="/projects" className="focus-ring inline-flex items-center gap-2 rounded-lg text-sm font-semibold text-[var(--ink-soft)] hover:text-[var(--navy)]"><ArrowLeft size={16} /> 返回项目列表</Link><h1 className="mt-8 text-3xl font-black tracking-tight sm:text-4xl">创建项目记忆空间</h1><p className="mt-3 leading-7 text-[var(--ink-soft)]">先定义目标和场景，后续每一条碎片都会在同一项目上下文中被理解。</p><NewProjectForm /></main>;
}
