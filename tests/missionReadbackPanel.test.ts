// @vitest-environment jsdom
import { createElement } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { MissionReadback } from "@/components/MissionReadback";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function readback(missionVersion: number) {
  return {
    missionId: "m", projectId: "p1", missionVersion, missionStatus: "WAITING_INPUT",
    observedAt: "2026-10-25T08:00:00.000Z", missionUpdatedAt: "2026-10-25T08:00:00.000Z",
    materialUses: {
      schemaVersion: 1, questionId: "q1",
      items: [{
        sourcePointer: { id: "capture:s1", hash: "a".repeat(64) }, title: "显存记录", availability: "CURRENT",
        facts: [{ kind: "SAVED", refId: "capture:s1" }, { kind: "BOUND", refId: "step-1" }],
        bodyCoverage: "NOT_RECORDED", excerpt: "10月显存6.2GB",
        coverage: { loadedCharacters: 9, totalCharacters: 9, truncated: false, extractionStatus: "SUCCESS" },
      }],
      coverage: { eventsTruncated: false },
    },
    sourceConversation: null,
    selected: { question: { id: "q1", text: "请补充10月推理显存", historical: false }, approval: null, output: null, receipt: null },
    adoptions: [], actionReceipts: [],
  };
}
describe("原任务读回面板", () => {
  it("定向材料读回展示使用事实，区分绑定与未核验", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { urls.push(url); return { ok: true, json: async () => ({ readback: readback(7) }) }; }));
    render(createElement(MissionReadback, { missionId: "m", target: { questionId: "q1", sourceId: "capture:s1" }, missionVersion: 7 }));
    expect(await screen.findByText("这份资料用在哪里 · 1")).toBeTruthy();
    expect(screen.getByText("已绑定原委托，尚未找到后续引用")).toBeTruthy();
    expect(screen.getByText("仅展示直接来源与有限历史；引用不表示结论已核验。")).toBeTruthy();
    const query = new URL(urls[0] as string, "https://x").searchParams;
    expect(query.get("sourceId")).toBe("capture:s1");
    expect(query.get("questionId")).toBe("q1");
  });
  it("同任务版本推进触发重读，旧结果明确标注而非丢弃", async () => {
    const responses = [readback(7), readback(8)]; let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ readback: responses[Math.min(calls++, 1)] }) })));
    const props = { missionId: "m", missionVersion: 7 };
    const { rerender } = render(createElement(MissionReadback, props));
    await screen.findByText("这份资料用在哪里 · 1");
    expect(screen.queryByText(/委托版本已变化/)).toBeNull();
    rerender(createElement(MissionReadback, { ...props, missionVersion: 9 }));
    await screen.findByText(/委托版本已变化，正在重新读取回执；以下为上次结果。/);
    expect(screen.getByText("这份资料用在哪里 · 1")).toBeTruthy();
    expect(calls).toBeGreaterThanOrEqual(2);
  });
  it("越权404清空私有读回内容，只保留错误提示", async () => {
    let failed = false;
    vi.stubGlobal("fetch", vi.fn(async () => failed
      ? { ok: true, json: async () => ({ readback: readback(7) }) }
      : (failed = true, { ok: false, status: 404, json: async () => ({ error: { message: "委托不存在" } }) })));
    render(createElement(MissionReadback, { missionId: "m", missionVersion: 7 }));
    await screen.findByText(/委托不存在/);
    expect(screen.queryByText("这份资料用在哪里 · 1")).toBeNull();
    expect(screen.queryByText("已绑定原委托，尚未找到后续引用")).toBeNull();
  });
});
