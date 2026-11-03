// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DemoVideoPlayer } from "@/components/home/DemoVideoPlayer";
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("点击前没有iframe，键盘激活后只移交一次焦点；用户离开后加载/计时不能抢回", () => {
  vi.useFakeTimers();
  render(createElement(DemoVideoPlayer));
  expect(document.querySelector("iframe")).toBeNull();
  const facade = screen.getByRole("button", { name: /在本页加载/ });
  facade.focus(); fireEvent.click(facade);
  const frame = screen.getByTitle(/官方播放器/);
  act(() => vi.advanceTimersByTime(180));
  expect(document.activeElement).toBe(frame);
  const close = screen.getByRole("button", { name: "收起播放器" });
  close.focus();
  fireEvent.load(frame);
  act(() => vi.advanceTimersByTime(2000));
  expect(document.activeElement).toBe(close);
  fireEvent.click(close);
  expect(document.querySelector("iframe")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: /在本页加载/ }));
});
