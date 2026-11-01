"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const scopes = [
  { href: "/settings/memory", label: "个人记忆", hint: "你的协作偏好与背景" },
  { href: "/memory", label: "项目记忆", hint: "项目记录与当前理解" },
];

/** 两种记忆范围的唯一入口切换：复用既有两个页面，不新增聚合页。 */
export function MemoryScopeNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="记忆范围" className="mt-4 flex flex-wrap items-center gap-2 border-b border-[var(--rule)] pb-3">
      {scopes.map(({ href, label, hint }) => {
        const current = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={href} prefetch={false} href={href} aria-current={current ? "page" : undefined}
            className={`focus-ring rounded-lg px-3 py-1.5 text-sm font-bold transition ${current
              ? "bg-[var(--teal-pale)] text-[var(--teal-strong)]"
              : "text-[var(--ink-soft)] hover:bg-[var(--paper-strong)]"}`}>
            {label}
            <span className="ml-1.5 hidden text-xs font-semibold text-[var(--muted)] sm:inline">{hint}</span>
          </Link>
        );
      })}
    </nav>
  );
}
