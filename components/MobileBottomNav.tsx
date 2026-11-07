"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { workspaceDestinations } from "./GlobalNavigation";

/** 手机和窄屏的全局导航，与鸿蒙主 Tab 同一组入口。官网和账号页不显示。 */
export function MobileBottomNav() {
  const pathname = usePathname();
  const active = workspaceDestinations.find(({ href }) => pathname === href || pathname.startsWith(`${href}/`));
  if (!active && !pathname.startsWith("/missions")) return null;
  return <>
    <div className="mobile-nav-spacer" aria-hidden="true"/>
    <nav className="mobile-nav" aria-label="全局导航">
      {workspaceDestinations.map(({ href, label, icon: Icon }) => <Link prefetch={false} key={href} href={href} aria-current={active?.href === href ? "page" : undefined} className="focus-ring">
        <Icon size={19} aria-hidden="true"/>{label}
      </Link>)}
    </nav>
  </>;
}
