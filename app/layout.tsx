import type { Metadata } from "next";
import { Menu } from "lucide-react";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GlobalNavigation } from "@/components/GlobalNavigation";
import { UserNav } from "@/components/UserNav";
import { SiteHeader } from "@/components/SiteHeader";
import {BrandLink} from "@/components/BrandLink";
import { accountMailConfiguration } from "@/lib/auth/mail";
import "./globals.css";

export const metadata: Metadata = {
  title: "忆程 ProjectMemo｜你的个人项目 Agent",
  description: "忆程 ProjectMemo：面向大学生的个人项目 Agent，留住过程、找回依据、看清变化、接续行动。",
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
          <SiteHeader registrationEnabled={Boolean(accountMailConfiguration())}><header className="app-header">
            <div className="app-header-row">
              <div className="app-header-left">
                <BrandLink/>
                <div className="hidden lg:flex"><GlobalNavigation /></div>
              </div>
              <div className="hidden items-center gap-2.5 lg:flex">
                <UserNav liveLlm={liveLlm} />
              </div>
              <div className="lg:hidden flex items-center">
                <details className="group relative">
                  <summary aria-label="打开全局导航" className="focus-ring grid h-11 w-11 cursor-pointer list-none place-items-center rounded-xl bg-[var(--card-bg)] border border-[var(--rule)] text-[var(--ink)] transition hover:text-[var(--teal)] [&::-webkit-details-marker]:hidden">
                    <Menu size={16} />
                  </summary>
                  <div className="absolute right-0 top-full mt-2 flex w-48 flex-col gap-1 rounded-2xl border border-[var(--rule)] bg-[var(--card-bg)] p-2 shadow-xl">
                    <GlobalNavigation mobile />
                    <ThemeToggle isMenuItem />
                    <UserNav isMenuItem liveLlm={liveLlm} />
                  </div>
                </details>
              </div>
            </div>
          </header></SiteHeader>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
