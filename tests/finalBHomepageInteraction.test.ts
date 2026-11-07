// @vitest-environment jsdom
import { createElement, StrictMode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HomeResumeCard } from "@/components/home/HomeResumeCard";
import { HomeMotion } from "@/components/home/HomeMotion";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("首屏接续卡展示上次停在哪、依据与判断变化，按时间排列来源且不提供可点击的写操作", () => {
  render(createElement(HomeResumeCard));
  expect(screen.getByRole("article", { name: /接续卡/ })).toBeTruthy();
  expect(screen.getByText("演示流程的实际结果")).toBeTruthy();
  expect(screen.getByText("待确认")).toBeTruthy();
  expect(screen.getAllByRole("time").map(t => t.textContent)).toEqual(["10/18", "10/20", "10/23"]);
  expect(screen.getByText("先补演示结果，再写汇报")).toBeTruthy();
  expect(screen.queryAllByRole("button")).toHaveLength(0);
});

class MediaPreference extends EventTarget {
  matches: boolean;
  constructor(matches: boolean) { super(); this.matches = matches; }
  set(matches: boolean) { this.matches = matches; this.dispatchEvent(new Event("change")); }
}

function motionEnvironment(reducedInitially = false) {
  const reduced = new MediaPreference(reducedInitially);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => query.includes("reduced") ? reduced : { matches: false }));
  const observers: Array<{ callback: IntersectionObserverCallback; disconnect: ReturnType<typeof vi.fn> }> = [];
  vi.stubGlobal("IntersectionObserver", class {
    observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn();
    constructor(public callback: IntersectionObserverCallback) { observers.push(this as never); }
  });
  const addScroll = vi.spyOn(window, "addEventListener");
  const rendered = render(createElement(StrictMode, null,
    createElement("main", null,
      createElement("div", { "data-rail": true }, createElement("p", { "data-rail-step": true }, "原来源仍可读")),
      createElement(HomeMotion))));
  const root = rendered.container.querySelector("main")!;
  const rail = root.querySelector<HTMLElement>("[data-rail]")!;
  const enter = () => act(() => observers.at(-1)!.callback([{ isIntersecting: true } as IntersectionObserverEntry], observers.at(-1) as never));
  return { root, rail, reduced, observers, enter, addScroll, unmount: rendered.unmount };
}

it("接续线进入视口时只播放一次，全程不监听滚动", () => {
  const env = motionEnvironment();
  expect(env.root.getAttribute("data-motion")).toBe("on");
  expect(env.rail.hasAttribute("data-played")).toBe(false);
  env.enter();
  expect(env.rail.hasAttribute("data-played")).toBe(true);
  expect(env.observers.at(-1)!.disconnect).toHaveBeenCalled();
  expect(env.addScroll.mock.calls.some(([type]) => type === "scroll" || type === "resize")).toBe(false);
  env.unmount();
  expect(env.root.hasAttribute("data-motion")).toBe(false);
});

it("减少动效时内容完整可读，偏好切换后再启用；卸载后不再响应", () => {
  const env = motionEnvironment(true);
  expect(env.root.getAttribute("data-motion")).toBe("reduced");
  expect(screen.getByText("原来源仍可读")).toBeTruthy();
  act(() => env.reduced.set(false));
  expect(env.root.getAttribute("data-motion")).toBe("on");
  env.enter();
  act(() => env.reduced.set(true));
  expect(env.root.getAttribute("data-motion")).toBe("reduced");
  expect(env.rail.hasAttribute("data-played")).toBe(false);
  env.unmount();
  act(() => env.reduced.set(false));
  expect(env.root.hasAttribute("data-motion")).toBe(false);
});
