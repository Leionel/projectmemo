import Link from "next/link";
import { ArrowRight, BrainCircuit, FileOutput, GitMerge, Layers3, Zap } from "lucide-react";

const values = [
  { icon: Layers3, title: "碎片自动资产化", text: "论文、报错、会议和灵感，自动变成可复用的结构化知识卡片。" },
  { icon: GitMerge, title: "项目记忆主动关联", text: "用关键词找回历史经验，让新记录和旧知识形成可追溯的项目脉络。" },
  { icon: FileOutput, title: "成果一键生成", text: "从真实项目过程生成周报、PPT、README、简历和下一步计划。" },
];

export default function Home() {
  return (
    <main id="main-content">
      <section className="shell grid min-h-[calc(100vh-64px)] items-center gap-12 py-14 lg:grid-cols-[1.02fr_.98fr] lg:py-20">
        <div className="animate-fade-in">
          <p className="archive-label">知识资产沉淀 · 主动推进 Agent</p>
          <h1 className="mt-6 max-w-3xl text-4xl font-black leading-[1.14] tracking-[-.04em] text-[var(--ink)] sm:text-5xl lg:text-6xl">
            沉淀每一步，<span className="text-[var(--teal)] drop-shadow-[0_0_12px_var(--teal-pale)]">推进下一程。</span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-8 text-[var(--ink-soft)] sm:text-lg">
            忆程 ProjectMemo 是面向大学生项目制学习的知识资产沉淀与主动推进 Agent。它将项目碎片组织为可关联的长期记忆，主动发现风险、推动行动，并复用为比赛成果。
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/projects" className="focus-ring editorial-button px-5 py-3">
              进入 Demo <ArrowRight size={18} />
            </Link>
            <a href="#loop" className="focus-ring editorial-button-secondary px-5 py-3">
              查看完整闭环
            </a>
          </div>
        </div>

        <div className="relative animate-fade-in animate-delay-200">
          <div className="absolute -inset-4 -z-10 rotate-2 rounded-[2.2rem] border border-[var(--rule)] bg-[var(--teal-pale)] opacity-50 dark:opacity-20" />
          <div className="card-surface relative rounded-[1.7rem] p-5 sm:p-7">
            <div className="dark-glow rounded-[1.7rem]" />
            <div className="flex items-center justify-between border-b archive-rule pb-5">
              <div><p className="archive-label text-[10px]">Project memory</p><h2 className="mt-2 font-bold font-sans">人工智能创意赛作品开发</h2></div>
              <span className="paper-tab bg-[var(--brick-pale)] px-3 py-1 text-xs font-bold text-[var(--brick)] shadow-[0_0_8px_var(--brick-pale)]">2 个风险</span>
            </div>
            <div className="my-5 rounded-2xl border border-[var(--rule)] border-l-4 border-l-[var(--teal)] bg-[var(--teal-pale)] p-4 shadow-sm">
              <div className="flex gap-3"><Zap size={19} className="mt-0.5 shrink-0 text-[var(--teal)]" /><div><p className="font-bold text-[var(--teal-strong)]">忆程主动提醒</p><p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">距离截止日期较近，建议先生成提交材料清单并安排一次完整彩排。</p></div></div>
            </div>
            <div className="space-y-3">
              <MemoryPreview tag="论文笔记" title="Agent Memory 的长期记忆设计" keywords="Agent Memory · episodic memory" />
              <MemoryPreview tag="项目风险" title="RAG 检索效果不稳定" keywords="RAG · 检索 · 切片" risk />
              <MemoryPreview tag="会议纪要" title="老师建议突出知识资产复用" keywords="项目制学习 · 知识资产" />
            </div>
          </div>
        </div>
      </section>

      <section id="loop" className="border-y border-[var(--rule)] bg-[var(--header-bg)] py-20 backdrop-blur-md">
        <div className="shell">
          <div className="mb-10 flex items-end justify-between gap-6 animate-fade-in">
            <div>
              <p className="archive-label">完整闭环</p>
              <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl majestic-heading">不是记下来，而是用起来</h2>
            </div>
            <BrainCircuit className="hidden text-[var(--teal)] sm:block drop-shadow-[0_0_12px_var(--teal-pale)]" size={40} />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {values.map(({ icon: Icon, title, text }, index) => (
              <div key={title} className={`card-surface hover-lift rounded-[1.4rem] border-t-4 p-6 animate-fade-in animate-delay-${(index + 1) * 100} ${index === 1 ? "border-t-[var(--teal)]" : "border-t-[var(--rule-strong)]"}`}>
                <div className="dark-glow rounded-[1.4rem]" />
                <div className="flex items-center justify-between">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--paper-strong)] text-[var(--teal)] border border-[var(--rule)] shadow-sm dark:bg-[rgba(0,210,143,0.1)]">
                    <Icon size={21} />
                  </span>
                  <span className="archive-label text-[10px]">0{index + 1}</span>
                </div>
                <h3 className="mt-6 text-xl font-bold font-sans text-[var(--ink)]">{title}</h3>
                <p className="mt-3 leading-7 text-[var(--ink-soft)]">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function MemoryPreview({ tag, title, keywords, risk = false }: { tag: string; title: string; keywords: string; risk?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--rule)] bg-[var(--paper-strong)] p-4 shadow-sm hover:border-[var(--teal)] transition-colors dark:bg-[rgba(255,255,255,0.02)]">
      <div className="flex items-center gap-2">
        <span className={`rounded-md px-2 py-1 text-[11px] font-bold shadow-sm ${risk ? "bg-[var(--brick-pale)] text-[var(--brick)]" : "bg-[var(--card-bg)] text-[var(--teal)] border border-[var(--rule)]"}`}>{tag}</span>
        <span className="text-xs text-[var(--placeholder)]">刚刚沉淀</span>
      </div>
      <h3 className="mt-2.5 font-bold font-sans text-[var(--ink)]">{title}</h3>
      <p className="mt-2 text-xs text-[var(--muted)]">{keywords}</p>
    </div>
  );
}
