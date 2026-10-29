"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { BrandLink } from "./BrandLink";
import styles from "@/app/home.module.css";

export function SiteHeader({
  children,
  registrationEnabled = false,
}: {
  children: ReactNode;
  registrationEnabled?: boolean;
}) {
  const pathname = usePathname();
  const accountPage = [
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
    "/resend-verification",
  ].includes(pathname);
  if (pathname !== "/" && !accountPage) return children;
  return (
    <header
      className={`${styles.siteHeader} ${pathname === "/" ? styles.homeHeader : ""}`}
    >
      <div className={styles.siteHeaderInner}>
        <BrandLink />
        <nav aria-label="首页导航" className={styles.homeNav}>
          {accountPage ? (
            <Link href="/" className={styles.headerCta}>
              返回官网
            </Link>
          ) : (
            <>
              <a href="#experience">产品体验</a>
              <a href="#missions">长期委托</a>
              <a href="#moments">使用场景</a>
              {registrationEnabled && <Link href="/register">注册</Link>}
              <Link href="/focus" className={styles.headerCta}>
                进入工作台
                <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
