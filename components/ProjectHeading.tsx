"use client";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import styles from "./ProjectWorkspace.module.css";

/**
 * 项目头部：概览展示完整信息，子页折叠成一行，首屏留给内容。
 * 滚过头部后出现紧凑条，保留项目名和问忆程；用哨兵判断位置，不监听滚动。
 */
export function ProjectHeading({ projectId, title, askHref, children, actions }: {
  projectId: string; title: string; askHref: string; children: React.ReactNode; actions: React.ReactNode;
}) {
  const path = usePathname();
  const compact = path !== `/projects/${projectId}`;
  const sentinel = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const element = sentinel.current;
    if (!element || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting && entry.boundingClientRect.top < 0), { rootMargin: "-61px 0px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <>
    <header className={styles.heading} data-compact={compact ? "" : undefined}>
      <div className="min-w-0">{children}</div>
      <div className={styles.headingActions}>{actions}</div>
    </header>
    <div ref={sentinel} aria-hidden="true"/>
    <div className={styles.stickyBar} data-visible={scrolled ? "" : undefined} aria-hidden={scrolled ? undefined : true} inert={!scrolled} data-testid="project-sticky-bar">
      <div className={styles.stickyInner}>
        <strong>{title}</strong>
        <Link prefetch={false} scroll={false} href={askHref} className={styles.stickyAsk + " focus-ring"} aria-label="打开项目协作对话"><MessageCircle size={14} aria-hidden="true"/>问忆程</Link>
      </div>
    </div>
  </>;
}
