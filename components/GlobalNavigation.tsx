"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, CheckSquare, FolderKanban, LayoutDashboard } from "lucide-react";

const destinations = [
  { href: "/focus", label: "焦点", icon: LayoutDashboard },
  { href: "/projects", label: "项目", icon: FolderKanban },
  { href: "/memory", label: "记忆", icon: BookOpen },
  { href: "/actions", label: "行动", icon: CheckSquare },
];

export function GlobalNavigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  return <div className={mobile ? "grid gap-1" : "flex items-center gap-1"}>
    {destinations.map(({ href, label, icon: Icon }) => <Link key={href} href={href}
      aria-current={pathname === href || pathname.startsWith(`${href}/`) ? "page" : undefined}
      onClick={event => event.currentTarget.closest("details")?.removeAttribute("open")}
      className="global-nav-link focus-ring"><Icon size={16} aria-hidden="true" />{label}</Link>)}
  </div>;
}
