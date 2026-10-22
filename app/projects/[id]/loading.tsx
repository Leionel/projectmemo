import {LoaderCircle} from "lucide-react";

export default function ProjectLoading(){
 return <section className="py-4" aria-busy="true" aria-live="polite">
  <div className="mb-4 h-6 w-28 animate-pulse rounded bg-[var(--paper-strong)]"/>
  <section className="card-surface rounded-2xl p-5 sm:p-7">
   <div className="h-4 w-36 animate-pulse rounded bg-[var(--paper-strong)]"/>
   <div className="mt-3 h-8 w-2/3 animate-pulse rounded bg-[var(--paper-strong)]"/>
   <div className="mt-3 h-4 w-full max-w-2xl animate-pulse rounded bg-[var(--paper-strong)]"/>
   <div className="mt-7 flex items-center gap-2 text-sm text-[var(--ink-soft)]"><LoaderCircle size={17} className="animate-spin"/>正在打开项目…</div>
  </section>
  <span className="sr-only">正在加载项目内容</span>
 </section>;
}
