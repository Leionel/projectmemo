import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Menu } from "lucide-react";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GlobalSettings } from "@/components/GlobalSettings";
import { GlobalNavigation } from "@/components/GlobalNavigation";
import { UserNav } from "@/components/UserNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "忆程 ProjectMemo｜知识资产沉淀与主动推进 Agent",
  description: "忆程 ProjectMemo：面向大学生项目制学习的知识资产沉淀与主动推进 Agent",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const liveLlm = process.env.LLM_MODE === "openai-compatible" && Boolean(process.env.LLM_API_KEY);
  return (
    <html lang="zh-CN" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body className="antialiased selection:bg-[var(--selection)]">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <a href="#main-content" className="skip-link">跳到主要内容</a>
          <header className="sticky top-0 z-40 border-b border-[var(--rule)] bg-[var(--header-bg)] backdrop-blur-xl transition-colors duration-400">
            <div className="shell flex h-16 items-center justify-between">
              <Link href="/" className="focus-ring flex items-center gap-2.5 rounded-xl font-bold tracking-tight text-[var(--ink)]">
                <Image src="/logo.png" alt="忆程 ProjectMemo 标志" width={36} height={36} className="h-9 w-9 shrink-0 rounded-md object-cover shadow-[var(--shadow-sm)]" />
                <span className="majestic-heading text-lg">忆程<span className="hidden sm:inline"> ProjectMemo</span></span>
                <span className="hidden border-l border-[var(--rule-strong)] pl-2 text-[10px] font-black tracking-[.16em] text-[var(--ink-soft)] xl:inline">MEMORY AGENT</span>
              </Link>
              <nav className="flex items-center gap-2 text-sm font-medium">
                <span className="hidden items-center gap-1.5 paper-tab px-3 py-1.5 text-[var(--ink-soft)] lg:flex">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--teal)] shadow-[0_0_8px_var(--teal)]" /> {liveLlm ? "云模型已配置" : "演示模式"}
                </span>
                
                {/* Desktop Nav */}
                <div className="hidden items-center gap-2 lg:flex">
                  <GlobalNavigation />
                  <div className="h-4 w-px bg-[var(--rule-strong)] mx-1" />
                  <GlobalSettings />
                  <ThemeToggle />
                  <div className="h-4 w-px bg-[var(--rule-strong)] mx-1" />
                  <UserNav />
                </div>

                {/* Mobile Menu */}
                <div className="lg:hidden flex items-center">
                  <details className="group relative">
                    <summary aria-label="打开全局导航" className="focus-ring grid h-11 w-11 cursor-pointer list-none place-items-center rounded-xl bg-[var(--card-bg)] border border-[var(--rule)] text-[var(--ink)] transition hover:text-[var(--teal)] [&::-webkit-details-marker]:hidden">
                      <Menu size={16} />
                    </summary>
                    <div className="absolute right-0 top-full mt-2 flex w-44 flex-col gap-1 rounded-2xl border border-[var(--rule)] bg-[var(--card-bg)] p-2 shadow-xl">
                      <GlobalNavigation mobile />
                      <GlobalSettings isMenuItem />
                      <ThemeToggle isMenuItem />
                      <UserNav isMenuItem />
                    </div>
                  </details>
                </div>
              </nav>
            </div>
          </header>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
