// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { DecisionScenarios } from "@/components/DecisionScenarios";
import { GoalQuestion } from "@/components/GoalQuestion";
import "@testing-library/jest-dom/vitest";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const proposal = {
  id: "p",
  proposalHash: "h".repeat(64),
  revision: 1,
  status: "READY",
  expiresAt: new Date(Date.now() + 600000).toISOString(),
  base: {
    expectedVersion: 1,
    goal: "整理阶段汇报",
    successCriteria: ["DRAFT_EXISTS"],
    availableMinutes: 60,
  },
  scenarios: [
    {
      key: "BASELINE",
      title: "原计划参照",
      minutes: null,
      estimateSource: "原计划未估算",
      feasibility: "UNKNOWN",
      reasons: [],
      tradeoff: "保留原次序",
      executionBoundary: "READ_ANALYZE",
    },
    {
      key: "VERIFY_FIRST",
      title: "先核对变化依据",
      minutes: 15,
      estimateSource: "规则估算，非实测",
      feasibility: "READY",
      reasons: [],
      tradeoff: "先核对再整理",
      executionBoundary: "READ_ANALYZE",
    },
    {
      key: "DELIVER_FIRST",
      title: "先整理最小草稿",
      minutes: 30,
      estimateSource: "用户估计，非保证",
      feasibility: "READY",
      reasons: [],
      tradeoff: "待核对结论留空",
      executionBoundary: "READ_ANALYZE",
    },
  ],
  receipt: null,
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
async function open() {
  fireEvent.click(screen.getByText("对比本轮推进方案"));
  const details = screen.getByText("对比本轮推进方案")
    .parentElement as HTMLDetailsElement;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  await waitFor(() => expect(screen.getByText("先核对变化依据")).toBeVisible());
}
describe("P2 confirmation and private recovery UI", () => {
  it("loads original receipt after reopening without creating a proposal or a new Mission", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        reply({
          proposal: {
            ...proposal,
            status: "CONFIRMED",
            receipt: { missionId: "m", planRevision: 2 },
          },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    render(createElement(DecisionScenarios, { missionId: "m" }));
    await open();
    expect(screen.getByText(/计划修订为 2/)).toBeVisible();
    expect(fetch.mock.calls.every((c) => !c[1]?.body)).toBe(true);
  });
  it("a stale response preserves selection and typed input, and prevents repeat adoption until refresh", async () => {
    const fetch = vi.fn(async (_url: string, options?: RequestInit) =>
      options?.method === "POST"
        ? reply({ error: { message: "依据已变化" } }, 409)
        : reply({ proposal }),
    );
    vi.stubGlobal("fetch", fetch);
    render(createElement(DecisionScenarios, { missionId: "m" }));
    await open();
    fireEvent.change(screen.getByLabelText("这轮最多可投入几分钟"), {
      target: { value: "45" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /先核对变化依据/ }));
    fireEvent.click(screen.getByRole("button", { name: "采用到原委托" }));
    await waitFor(() => expect(screen.getByText("依据已变化")).toBeVisible());
    expect(screen.getByLabelText("这轮最多可投入几分钟")).toHaveValue(45);
    expect(screen.getByRole("radio", { name: /先核对变化依据/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "采用到原委托" })).toBeDisabled();
  });
  it("a lost confirmation response retries the same request ID, with model advice unchecked", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, options?: RequestInit) => {
        if (options?.method === "POST") {
          bodies.push(JSON.parse(String(options.body)));
          if (bodies.length === 1) throw new Error("连接中断");
          return reply({ receipt: { missionId: "m", planRevision: 2 } });
        }
        return reply({ proposal });
      }),
    );
    render(createElement(DecisionScenarios, { missionId: "m" }));
    await open();
    expect(screen.getByLabelText(/另请已授权/)).not.toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /先核对变化依据/ }));
    fireEvent.click(screen.getByRole("button", { name: "采用到原委托" }));
    await waitFor(() => expect(screen.getByText("连接中断")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: "采用到原委托" }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[0]).toEqual(bodies[1]);
  });
  it("a revoked identity clears private preview; policy denial never becomes exposure or device delivery", async () => {
    let denied = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, options?: RequestInit) => {
        if (options?.method === "POST") {
          denied = true;
          return reply({ error: { message: "登录已过期" } }, 401);
        }
        return reply({ proposal });
      }),
    );
    render(createElement(DecisionScenarios, { missionId: "m" }));
    await open();
    fireEvent.click(screen.getByRole("radio", { name: /先核对变化依据/ }));
    fireEvent.click(screen.getByRole("button", { name: "采用到原委托" }));
    await waitFor(() =>
      expect(
        screen.queryByText("原目标：整理阶段汇报"),
      ).not.toBeInTheDocument(),
    );
    expect(denied).toBe(true);
    cleanup();
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, options?: RequestInit) => {
        if (options?.method === "POST") {
          calls.push(JSON.parse(String(options.body)).action);
          return reply({
            allowed: false,
            question: null,
            reason: "BUDGET_EXHAUSTED",
          });
        }
        return reply({
          question: {
            questionId: "q",
            missionId: "m",
            contextHash: "x",
            text: "私有问题",
          },
        });
      }),
    );
    render(createElement(GoalQuestion, { projectId: "p" }));
    await waitFor(() => expect(calls).toContain("PRESENT"));
    expect(calls).not.toContain("EXPOSED");
    expect(screen.queryByText("私有问题")).not.toBeInTheDocument();
  });
});
