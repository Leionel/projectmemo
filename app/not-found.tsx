import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";

export default function NotFound() {
  return <main id="main-content" className="shell grid min-h-[calc(100vh-64px)] place-items-center py-16 text-center"><div><SearchX className="mx-auto text-[var(--teal-strong)]" size={44} /><h1 className="mt-5 text-3xl font-black">没有找到这个项目</h1><p className="mt-3 text-[var(--ink-soft)]">它可能已被删除，或者链接不完整。</p><Link href="/projects" className="focus-ring editorial-button mt-6"><ArrowLeft size={17} /> 返回项目列表</Link></div></main>;
}
