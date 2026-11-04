// @vitest-environment jsdom
import { createElement } from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { MissionJudgmentChanges } from "@/components/MissionJudgmentChanges";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const reply = (items: unknown[]) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ hypotheses: { items } }) })));

describe("委托内的判断变化", () => {
  it("只列出本委托产生且被修订或推翻的判断，并给出原判断与反例数量", async () => {
    reply([
      { id: "h1", statement: "基线结果来自旧数据划分", effectiveStatus: "REFUTED", sourceMissionId: "m1",
        history: [{ revision: 2, at: "2026-11-04T02:00:00.000Z", statement: "基线结果来自旧数据划分", state: "REFUTED" }, { revision: 1, at: "2026-11-03T02:00:00.000Z", statement: "基线结果可能来自旧数据划分", state: "SUPPORTED" }],
        evidence: [{ role: "COUNTER", qualified: true }, { role: "SUPPORT", qualified: true }] },
      { id: "h2", statement: "其他委托的判断", effectiveStatus: "REFUTED", sourceMissionId: "m2", history: [], evidence: [] },
      { id: "h3", statement: "本委托未变化的判断", effectiveStatus: "SUPPORTED", sourceMissionId: "m1", history: [{ revision: 1, at: "2026-11-03T02:00:00.000Z", state: "SUPPORTED" }], evidence: [] },
    ]);
    render(createElement(MissionJudgmentChanges, { projectId: "p", missionId: "m1", missionVersion: 3 }));
    expect(await screen.findByRole("region", { name: "判断变化" })).toBeTruthy();
    expect(screen.getByText("发现反例")).toBeTruthy();
    expect(screen.getByText(/有条件支持/)).toBeTruthy();
    expect(screen.getByText("原判断：基线结果可能来自旧数据划分")).toBeTruthy();
    expect(screen.getByText("1 处反例来自已核对的原文")).toBeTruthy();
    expect(screen.queryByText("其他委托的判断")).toBeNull();
    expect(screen.queryByText("本委托未变化的判断")).toBeNull();
  });

  it("没有变化或接口不可用时不渲染", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const { container } = render(createElement(MissionJudgmentChanges, { projectId: "p", missionId: "m1", missionVersion: 1 }));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });
});
