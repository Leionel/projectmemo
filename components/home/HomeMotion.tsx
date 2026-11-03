"use client";

import { useEffect } from "react";

/**
 * 官网的滚动动效控制器。
 *
 * 原则：动效只辅助阅读，不承载事实；无 JS 或减少动画时内容完全可见；
 * 只用 transform / translate / scale，不隐藏内容、不做布局动画、不做逐段淡入。
 */
export function HomeMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("main");
    if (!root) return;
    if (!("IntersectionObserver" in window)) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const observers: IntersectionObserver[] = [];
    const drawables = Array.from(root.querySelectorAll<HTMLElement>("[data-draw]"));

    const hero = root.querySelector<HTMLElement>("[data-hero]");
    const rail = root.querySelector<HTMLElement>("[data-rail]");
    const railSteps = Array.from(root.querySelectorAll<HTMLElement>("[data-rail-step]"));
    const progressBar = root.querySelector<HTMLElement>("[data-scroll-progress]");
    const stackedRail = window.matchMedia("(max-width: 720px)");

    let frame = 0;
    let enabled = false;
    const clamp = (value: number, min: number, max: number) =>
      Math.min(max, Math.max(min, value));

    const update = () => {
      frame = 0;
      if (!enabled || reduceMotion.matches) return;
      const viewport = window.innerHeight;

      if (progressBar) {
        const scrollable = Math.max(document.documentElement.scrollHeight - viewport, 1);
        const pageProgress = clamp(window.scrollY / scrollable, 0, 1);
        progressBar.style.transform = `scaleX(${pageProgress.toFixed(4)})`;
        progressBar.toggleAttribute("data-visible", pageProgress > 0.005);
      }

      if (hero) {
        const heroHeight = Math.max(hero.offsetHeight, 1);
        const shift = clamp(window.scrollY / (heroHeight * 0.85), 0, 1);
        hero.style.setProperty("--hero-shift", shift.toFixed(3));
      }

      if (rail) {
        const rect = rail.getBoundingClientRect();
        let progress: number;
        if (stackedRail.matches) {
          progress = clamp(
            (viewport * 0.72 - rect.top) / Math.max(rect.height * 0.92, 1),
            0,
            1,
          );
        } else {
          const start = viewport * 0.86;
          const span = Math.max(viewport * 0.5, 240);
          progress = clamp((start - rect.top) / span, 0, 1);
        }
        rail.style.setProperty("--rail-progress", progress.toFixed(3));
        railSteps.forEach((step, index) => {
          const threshold = (index + 0.55) / railSteps.length;
          step.toggleAttribute("data-active", progress >= threshold);
        });
      }
    };

    const requestUpdate = () => {
      if (!enabled || reduceMotion.matches || frame) return;
      frame = window.requestAnimationFrame(update);
    };

    const stopMotion = () => {
      enabled = false;
      window.cancelAnimationFrame(frame);
      frame = 0;
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      stackedRail.removeEventListener("change", requestUpdate);
      observers.splice(0).forEach((observer) => observer.disconnect());
      hero?.style.setProperty("--hero-shift", "0");
      rail?.style.setProperty("--rail-progress", "0");
      railSteps.forEach((step) => step.removeAttribute("data-active"));
      if (progressBar) {
        progressBar.style.transform = "scaleX(0)";
        progressBar.removeAttribute("data-visible");
      }
    };

    const applyPreference = () => {
      if (reduceMotion.matches) {
        stopMotion();
        root.setAttribute("data-motion", "reduced");
        return;
      }
      if (enabled) return;
      enabled = true;
      root.setAttribute("data-motion", "on");
      if (drawables.length) {
        const drawObserver = new IntersectionObserver(
          (entries, observer) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              entry.target.setAttribute("data-drawn", "true");
              observer.unobserve(entry.target);
            }
          },
          { rootMargin: "0px 0px -10% 0px", threshold: 0.15 },
        );
        drawables.forEach((element) => drawObserver.observe(element));
        observers.push(drawObserver);
      }
      window.addEventListener("scroll", requestUpdate, { passive: true });
      window.addEventListener("resize", requestUpdate);
      stackedRail.addEventListener("change", requestUpdate);
      update();
    };

    reduceMotion.addEventListener("change", applyPreference);
    applyPreference();

    return () => {
      reduceMotion.removeEventListener("change", applyPreference);
      stopMotion();
      root.removeAttribute("data-motion");
    };
  }, []);

  return null;
}
