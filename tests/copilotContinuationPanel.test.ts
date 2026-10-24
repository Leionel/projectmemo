// @vitest-environment jsdom
import { createElement, StrictMode } from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { CopilotContinuation } from "@/components/CopilotContinuation";
import { MissionReadback } from "@/components/MissionReadback";
const suggestion = {
  schemaVersion: 1 as const,
  kind: "CREATE_MISSION" as const,
  projectId: "p",
  sourceRunId: "r",
  reason: "先预览委托",
  goal: "整理项目汇报",
  mission: null,
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("对话转委托确认与历史读回", () => {
  it("cancel and goal edits do not create tasks, consent starts unchecked and retries retain confirmation id", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        calls.push({ url, body });
        if (url.endsWith("confirm"))
          throw new Error("响应丢失，请重试同一预览");
        return {
          ok: true,
          json: async () => ({
            preview: { previewHash: body.goal, goal: body.goal },
          }),
        };
      }),
    );
    render(createElement(StrictMode, null, createElement(CopilotContinuation, { suggestion })));
    fireEvent.click(screen.getByRole("button", { name: "交给长期委托" }));
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: "暂不创建" }));
    expect(calls).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "交给长期委托" }));
    fireEvent.click(screen.getByRole("button", { name: "预览委托" }));
    await screen.findByRole("button", { name: "确认创建委托" });
    fireEvent.change(screen.getByRole("textbox", { name: "委托目标" }), {
      target: { value: "新的项目目标" },
    });
    expect(screen.queryByRole("button", { name: "确认创建委托" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "预览委托" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "确认创建委托" }),
    );
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "确认创建委托" }));
    await waitFor(() =>
      expect(calls.filter((c) => c.url.endsWith("confirm"))).toHaveLength(2),
    );
    const confirm = calls.filter((c) => c.url.endsWith("confirm"));
    expect(confirm[0].body.requestId).toBe(confirm[1].body.requestId);
    expect(confirm[0].body).toMatchObject({
      confirmed: true,
      sourceRunId: "r",
      previewHash: "新的项目目标",
    });
    expect(confirm[0].body.goal).toBeUndefined();
  });
  it("late readback from a previous Mission cannot replace the new identity", async () => {
    let resolve: (r: unknown) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url.includes("old")
          ? new Promise((r) => {
              resolve = r;
            })
          : Promise.resolve({
              ok: false,
              status: 404,
              json: async () => ({ error: { message: "原成果不可用" } }),
            }),
      ),
    );
    const view = render(createElement(MissionReadback, { missionId: "old" }));
    view.rerender(createElement(MissionReadback, { missionId: "new" }));
    await screen.findByText("原成果不可用");
    resolve({
      ok: true,
      json: async () => ({
        readback: {
          observedAt: new Date().toISOString(),
          missionVersion: 99,
          sourceConversation: null,
          selected: { question: { text: "旧账号私有问题" } },
          adoptions: [],
          actionReceipts: [],
        },
      }),
    });
    await waitFor(() =>
      expect(screen.queryByText(/旧账号私有问题/)).toBeNull(),
    );
  });
});
