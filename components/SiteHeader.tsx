"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import styles from "@/app/home.module.css";

export function SiteHeader({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname !== "/") return children;
  return <header className={styles.siteHeader}>
    <div className={styles.siteHeaderInner}>
      <Link href="/" className={styles.homeBrand} aria-label="忆程 ProjectMemo 首页"><Image src="/logo.png" alt="" width={34} height={34} /><span>忆程 <span>ProjectMemo</span></span></Link>
      <nav aria-label="首页导航" className={styles.homeNav}>
        <a href="#experience">产品体验</a><a href="#moments">使用场景</a><a href="#principles">个人 Agent</a>
        <Link href="/focus" className={styles.headerCta}>进入工作台<ArrowUpRight size={15} aria-hidden="true" /></Link>
      </nav>
    </div>
  </header>;
}
