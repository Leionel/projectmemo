"use client";

import { useEffect } from "react";

const MAX_TILT = 5;

/**
 * 官网动效控制器：滚动揭示、接续线、卡片 3D 倾斜与光斑。
 *
 * 原则：不监听滚动、不写继承到大子树的变量；指针变量只写在被指向的卡片上，每帧最多一次。
 * 无 JS 或减少动画时内容完整呈现；触屏没有指针效果。
 */
export function HomeMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("main");
    if (!root) return;
    if (!("IntersectionObserver" in window)) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const rail = root.querySelector<HTMLElement>("[data-rail]");
    const reveals = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    const pointerCards = Array.from(root.querySelectorAll<HTMLElement>("[data-spot],[data-tilt]"));
    const observers: IntersectionObserver[] = [];
    let cleanupPointer: Array<() => void> = [];

    const stop = () => {
      observers.splice(0).forEach((observer) => observer.disconnect());
      cleanupPointer.forEach((off) => off());
      cleanupPointer = [];
    };

    const bindPointer = (card: HTMLElement) => {
      let frame = 0;
      let x = 0;
      let y = 0;
      const tilt = card.hasAttribute("data-tilt");
      const paint = () => {
        frame = 0;
        const box = card.getBoundingClientRect();
        const px = (x - box.left) / Math.max(box.width, 1);
        const py = (y - box.top) / Math.max(box.height, 1);
        card.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
        card.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
        if (tilt) {
          card.style.setProperty("--rx", `${((0.5 - py) * MAX_TILT).toFixed(2)}deg`);
          card.style.setProperty("--ry", `${((px - 0.5) * MAX_TILT).toFixed(2)}deg`);
        }
      };
      const move = (event: PointerEvent) => {
        x = event.clientX;
        y = event.clientY;
        card.setAttribute("data-hot", "");
        if (!frame) frame = window.requestAnimationFrame(paint);
      };
      const leave = () => {
        window.cancelAnimationFrame(frame);
        frame = 0;
        card.removeAttribute("data-hot");
        card.style.removeProperty("--rx");
        card.style.removeProperty("--ry");
      };
      card.addEventListener("pointermove", move);
      card.addEventListener("pointerleave", leave);
      cleanupPointer.push(() => {
        card.removeEventListener("pointermove", move);
        card.removeEventListener("pointerleave", leave);
        leave();
      });
    };

    const applyPreference = () => {
      stop();
      if (reduceMotion.matches) {
        root.setAttribute("data-motion", "reduced");
        rail?.removeAttribute("data-played");
        reveals.forEach((element) => element.removeAttribute("data-in"));
        return;
      }
      root.setAttribute("data-motion", "on");
      if (finePointer.matches) pointerCards.forEach(bindPointer);

      const pending = reveals.filter((element) => !element.hasAttribute("data-in"));
      if (pending.length) {
        const revealObserver = new IntersectionObserver(
          (entries, observer) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              entry.target.setAttribute("data-in", "");
              observer.unobserve(entry.target);
            }
          },
          { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
        );
        pending.forEach((element) => revealObserver.observe(element));
        observers.push(revealObserver);
      }

      if (rail && !rail.hasAttribute("data-played")) {
        const railObserver = new IntersectionObserver(
          (entries, observer) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            rail.setAttribute("data-played", "");
            observer.disconnect();
          },
          { threshold: 0.35 },
        );
        railObserver.observe(rail);
        observers.push(railObserver);
      }
    };

    reduceMotion.addEventListener("change", applyPreference);
    applyPreference();

    return () => {
      reduceMotion.removeEventListener("change", applyPreference);
      stop();
      root.removeAttribute("data-motion");
    };
  }, []);

  return null;
}
