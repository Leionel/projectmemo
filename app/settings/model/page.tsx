import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/serverSession";
import { GlobalSettings } from "@/components/GlobalSettings";
import { SettingsNav } from "@/components/SettingsNav";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ModelSettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?from=%2Fsettings%2Fmodel");
  return <main id="main-content" className="shell flex flex-col gap-6 py-8 md:flex-row md:gap-10">
    <SettingsNav current="/settings/model"/>
    <div className="min-w-0 flex-1">
      <h1 className="majestic-heading text-[2rem] font-semibold leading-tight text-[var(--ink)]">模型与安全</h1>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">模型已配置不等于可执行；实际结果以各委托的运行记录为准。</p>
      <div className="mt-6"><GlobalSettings inline/></div>
    </div>
  </main>;
}
