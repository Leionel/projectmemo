import Link from "next/link";

const items = [
  { href: "/settings/memory", label: "我的记忆" },
  { href: "/settings/model", label: "模型与安全" },
] as const;

/** 设置页左侧导航：只列出仓库已有的设置页面。 */
export function SettingsNav({ current }: { current: (typeof items)[number]["href"] }) {
  return <nav aria-label="设置" className="flex flex-row flex-wrap gap-1 md:w-48 md:flex-col md:shrink-0">
    <h2 className="mb-1 hidden px-3 text-xs font-semibold text-[var(--muted)] md:block">设置</h2>
    {items.map(item => <Link key={item.href} prefetch={false} href={item.href} aria-current={item.href === current ? "page" : undefined}
      className={"focus-ring flex min-h-11 items-center rounded-md px-3 text-sm " + (item.href === current ? "bg-[var(--teal-pale)] font-bold text-[var(--ink)]" : "text-[var(--ink-soft)] hover:bg-[var(--paper-strong)]")}>{item.label}</Link>)}
  </nav>;
}
