"use client";

import Link from "next/link";
import { RefreshCw, TriangleAlert } from "lucide-react";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main id="main-content" className="shell grid min-h-[calc(100vh-64px)] place-items-center py-16 text-center"><div className="max-w-md"><TriangleAlert className="mx-auto text-[var(--brick)]" size={44} /><h1 className="mt-5 text-3xl font-black">页面暂时没有加载成功</h1><p className="mt-3 leading-7 text-[var(--ink-soft)]">项目数据仍然保留着。请重试一次；如果本地服务刚启动，稍等几秒即可恢复。</p><div className="mt-6 flex flex-wrap justify-center gap-3"><button type="button" onClick={reset} className="focus-ring editorial-button"><RefreshCw size={17} /> 重新加载</button><Link href="/projects" className="focus-ring editorial-button-secondary">返回项目列表</Link></div></div></main>;
}
