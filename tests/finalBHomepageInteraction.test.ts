// @vitest-environment jsdom
import { createElement, StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HomeHeroLens } from "@/components/home/HomeHeroLens";
import { HomeMotion } from "@/components/home/HomeMotion";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("阶段标题跟随当前内容，离开时不要求确认，回到原阶段仍保留任务身份", () => {
  render(createElement(HomeHeroLens));
  expect(screen.getByText("等你确认")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: /离开时/ }));
  expect(screen.getByText("无需操作")).toBeTruthy();
  expect(screen.getByText("暂时不需要你操作")).toBeTruthy();
  expect(screen.queryByText("等你确认")).toBeNull();
  fireEvent.keyDown(screen.getByRole("tab", { name: /离开时/ }), { key: "ArrowRight" });
  expect(screen.getByText("核对示例")).toBeTruthy();
  expect(screen.getByRole("tab", { name: /期间/ }).getAttribute("aria-selected")).toBe("true");
  fireEvent.click(screen.getByRole("tab", { name: /回来后/ }));
  expect(screen.getByText("等你确认")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "整理阶段汇报" })).toBeTruthy();
});

class MediaPreference extends EventTarget {
  matches: boolean;
  constructor(matches: boolean) { super(); this.matches = matches; }
  set(matches: boolean) { this.matches = matches; this.dispatchEvent(new Event("change")); }
}

function motionEnvironment(reducedInitially = false) {
  const reduced = new MediaPreference(reducedInitially);
  const stacked = new MediaPreference(false);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => query.includes("prefers-reduced-motion") ? reduced : stacked));
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const requestFrame = vi.fn((callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  const cancelFrame = vi.fn((id: number) => { frames.delete(id); });
  vi.stubGlobal("requestAnimationFrame", requestFrame);
  vi.stubGlobal("cancelAnimationFrame", cancelFrame);
  const disconnect = vi.fn();
  vi.stubGlobal("IntersectionObserver", class {
    observe = vi.fn(); unobserve = vi.fn(); disconnect = disconnect;
  });
  vi.stubGlobal("scrollY", 120);
  const rendered = render(createElement(StrictMode, null,
    createElement("main", null,
      createElement("section", { "data-hero": true }, "原任务仍可读"),
      createElement("div", { "data-scroll-progress": true }),
      createElement("div", { "data-rail": true }, createElement("p", { "data-rail-step": true }, "原来源仍可读")),
      createElement("p", { "data-draw": true }, "依据"),
      createElement(HomeMotion))));
  const root = rendered.container.querySelector("main")!;
  const hero = root.querySelector<HTMLElement>("[data-hero]")!;
  const rail = root.querySelector<HTMLElement>("[data-rail]")!;
  const progress = root.querySelector<HTMLElement>("[data-scroll-progress]")!;
  return { ...rendered, reduced, stacked, frames, requestFrame, cancelFrame, disconnect, root, hero, rail, progress };
}

it("挂载后开启减弱动效会取消已排帧、清除视差和进度；恢复后不重复监听", () => {
  const env = motionEnvironment();
  expect(env.root.getAttribute("data-motion")).toBe("on");
  expect(Number(env.hero.style.getPropertyValue("--hero-shift"))).toBeGreaterThan(0);
  fireEvent.scroll(window);
  expect(env.frames.size).toBe(1);
  act(() => env.reduced.set(true));
  expect(env.frames.size).toBe(0);
  expect(env.root.getAttribute("data-motion")).toBe("reduced");
  expect(Number(env.hero.style.getPropertyValue("--hero-shift"))).toBe(0);
  expect(Number(env.rail.style.getPropertyValue("--rail-progress"))).toBe(0);
  expect(env.progress.style.transform).toBe("scaleX(0)");
  expect(env.rail.querySelector("[data-active]")).toBeNull();
  const pausedCalls = env.requestFrame.mock.calls.length;
  fireEvent.scroll(window); fireEvent.resize(window); act(() => env.stacked.set(true));
  expect(env.requestFrame.mock.calls.length).toBe(pausedCalls);
  expect(screen.getByText("原任务仍可读")).toBeTruthy();
  expect(screen.getByText("原来源仍可读")).toBeTruthy();
  for (let i = 0; i < 3; i++) {
    act(() => env.reduced.set(false));
    fireEvent.scroll(window);
    expect(env.frames.size).toBe(1);
    act(() => env.reduced.set(true));
    expect(env.frames.size).toBe(0);
  }
  act(() => env.reduced.set(false));
  env.requestFrame.mockClear();
  fireEvent.scroll(window);
  expect(env.requestFrame).toHaveBeenCalledTimes(1);
  env.unmount();
  expect(env.frames.size).toBe(0);
  expect(env.root.hasAttribute("data-motion")).toBe(false);
  const afterUnmount = env.requestFrame.mock.calls.length;
  act(() => env.reduced.set(true)); act(() => env.reduced.set(false));
  fireEvent.scroll(window);
  expect(env.requestFrame.mock.calls.length).toBe(afterUnmount);
});

it("初始减弱动效也保留偏好监听，之后可启用并再次停用；卸载清理偏好监听", () => {
  const env = motionEnvironment(true);
  expect(env.root.getAttribute("data-motion")).toBe("reduced");
  fireEvent.scroll(window);
  expect(env.frames.size).toBe(0);
  act(() => env.reduced.set(false));
  expect(env.root.getAttribute("data-motion")).toBe("on");
  fireEvent.scroll(window);
  expect(env.frames.size).toBe(1);
  act(() => env.reduced.set(true));
  expect(env.frames.size).toBe(0);
  env.unmount();
  expect(env.root.hasAttribute("data-motion")).toBe(false);
  act(() => env.reduced.set(false));
  expect(env.root.hasAttribute("data-motion")).toBe(false);
});
