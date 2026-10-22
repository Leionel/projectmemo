"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function HomeMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = root.current;
    if (!container || !("IntersectionObserver" in window)) return;
    const nodes = Array.from(container.querySelectorAll<HTMLElement>("[data-reveal]"));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let observer: IntersectionObserver | undefined;
    const start = () => {
      observer?.disconnect();
      container.dataset.motionReady = reducedMotion.matches ? "false" : "true";
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) if (entry.isIntersecting) {
          (entry.target as HTMLElement).dataset.inView = "true";
          observer?.unobserve(entry.target);
        }
      }, { threshold: 0.1, rootMargin: "0px 0px -30px 0px" });
      for (const node of nodes) {
        const visible = reducedMotion.matches || node.dataset.inView === "true" || node.getBoundingClientRect().top < window.innerHeight - 30;
        node.dataset.inView = visible ? "true" : "false";
        if (!visible) observer.observe(node);
      }
    };
    start();
    reducedMotion.addEventListener("change", start);
    return () => { observer?.disconnect(); reducedMotion.removeEventListener("change", start); };
  }, []);
  return <div ref={root}>{children}</div>;
}
