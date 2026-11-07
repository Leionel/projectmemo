"use client";
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

export function prefersReducedMotion() {
  return typeof window === "undefined" || !window.matchMedia || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

/** 弹层打开期间把 Tab 焦点留在弹层内，关闭后交还给触发元素。 */
export function useFocusTrap<T extends HTMLElement>(active: boolean): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const element = ref.current;
    if (!active || !element) return;
    const previous = document.activeElement as HTMLElement | null;
    if (!element.contains(document.activeElement)) element.focus?.();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = [...element.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(item => item.offsetParent !== null || item === document.activeElement);
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus?.(); };
  }, [active]);
  return ref;
}

/** 列表项位置变化时平滑移动，新出现的项淡入。key 通过 data-flip-key 标记，只动 transform/opacity。 */
export function useListFlip<T extends HTMLElement>(signature: string): RefObject<T | null> {
  const ref = useRef<T>(null);
  const positions = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const next = new Map<string, number>();
    const items = root.querySelectorAll<HTMLElement>("[data-flip-key]");
    const animate = positions.current.size > 0 && !prefersReducedMotion();
    items.forEach(item => {
      const key = item.dataset.flipKey!, top = item.getBoundingClientRect().top + window.scrollY;
      next.set(key, top);
      if (!animate || !item.animate) return;
      const previous = positions.current.get(key);
      if (previous === undefined) item.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "cubic-bezier(.22,1,.36,1)" });
      else if (Math.abs(previous - top) > 1) item.animate([{ transform: `translateY(${previous - top}px)` }, { transform: "none" }], { duration: 220, easing: "cubic-bezier(.22,1,.36,1)" });
    });
    positions.current = next;
  }, [signature]);
  return ref;
}

/**
 * 正文引用 ↔ 来源的牵引线：悬停或聚焦 [data-cite-source] 时点亮 [data-source] 并画一条线。
 * 来源未展开时不画；线只是强调，引用本身仍是可点击的链接。
 */
export function useEvidenceTether<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let svg: SVGSVGElement | null = null, lit: HTMLElement | null = null;
    const clear = () => { svg?.remove(); svg = null; lit?.removeAttribute("data-tether"); lit = null; };
    const show = (event: Event) => {
      const cite = (event.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-cite-source]");
      if (!cite) return;
      clear();
      const target = [...root.querySelectorAll<HTMLElement>("[data-source]")].find(item => item.dataset.source === cite.dataset.citeSource && item.getClientRects().length);
      if (!target) return;
      lit = target; target.setAttribute("data-tether", "");
      const box = root.getBoundingClientRect(), a = cite.getBoundingClientRect(), b = target.getBoundingClientRect();
      const x1 = a.left - box.left + a.width / 2, y1 = a.bottom - box.top, x2 = b.left - box.left, y2 = b.top - box.top + Math.min(b.height / 2, 24);
      const gutter = Math.min(x1, x2) - 10;
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("aria-hidden", "true"); svg.setAttribute("data-tether-line", "");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M${x1} ${y1} C${x1} ${y1 + 16},${gutter} ${y1 + 8},${gutter} ${(y1 + y2) / 2} S${x2 - 12} ${y2},${x2} ${y2}`);
      path.setAttribute("pathLength", "1");
      svg.append(path); root.append(svg);
    };
    const hide = (event: Event) => { if ((event.target as HTMLElement | null)?.closest?.("[data-cite-source]")) clear(); };
    root.addEventListener("mouseover", show); root.addEventListener("focusin", show);
    root.addEventListener("mouseout", hide); root.addEventListener("focusout", hide);
    return () => { clear(); root.removeEventListener("mouseover", show); root.removeEventListener("focusin", show); root.removeEventListener("mouseout", hide); root.removeEventListener("focusout", hide); };
  }, []);
  return ref;
}
