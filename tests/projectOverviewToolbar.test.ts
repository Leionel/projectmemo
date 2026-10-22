// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectOverviewToolbar } from "@/components/ProjectOverviewToolbar";
import { EvidenceText } from "@/components/EvidenceText";
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
afterEach(() => { cleanup(); push.mockReset(); });
it("快捷键进入项目问答，不抢占输入框的编辑操作", () => {
  render(createElement("div", {}, createElement(ProjectOverviewToolbar, { projectId: "p" }), createElement("input", { "aria-label": "输入" })));
  fireEvent.keyDown(window, { ctrlKey: true, key: "j" });
  expect(push).toHaveBeenCalledWith("/projects/p/knowledge?openCopilot=1#memory-copilot");
  fireEvent.keyDown(screen.getByRole("textbox"), { metaKey: true, key: "j" });
  expect(push).toHaveBeenCalledTimes(1);
});
it("指标排版完整保留原文，不将描述变为已核实事实", () => {
  const text = "项目实验 P95 为 118ms，准确率 98.2%，尚待复测。";
  const html = renderToStaticMarkup(createElement(EvidenceText, { text }));
  const element = document.createElement("div"); element.innerHTML = html;
  expect(element.textContent).toBe(text);
  expect(element.querySelectorAll("code")).toHaveLength(2);
});
