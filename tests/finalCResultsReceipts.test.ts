// @vitest-environment jsdom
/**
 * C3 结果与回执：结果分类、草稿、用户报告、原复盘回执与演示边界。
 *
 * 这里只断言原 readback 字段的页面呈现与原有文案不回归：
 * - 分类直接来自 reviewProgressOf，不在客户端重算完成真值；
 * - Action/resultCardId 只链接原对象，页面不写入、不弹二次确认；
 * - ActionBoard 只保留原复盘回执链接，不给已完成行动第二个确认入口。
 */
import { createElement } from "react";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { MissionResultReceipts } from "@/components/MissionResultReceipts";
import { MissionReadback } from "@/components/MissionReadback";
import { ActionBoard } from "@/components/ActionBoard";
import { reviewProgressOf } from "@/lib/mission/reviewProgress";
import { missionResourceUsageOf } from "@/lib/mission/resourceUsage";
import type { MissionReadback as ReadbackData } from "@/lib/mission/readback";
import type { ActionItemData } from "@/lib/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// C1 负责的四问工作包本文件不测实现，只验证结果区确实排在其下方。
vi.mock("@/components/MissionWorkPacket", async () => {
  const React = await import("react");
  return {
    MissionWorkPacket: () =>
      React.createElement("div", { "data-testid": "work-packet" }, "四问工作包"),
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const FOLLOWING = 4;

function baseReadback(
  overrides: Partial<ReadbackData> = {},
): ReadbackData {
  return {
    missionId: "m",
    projectId: "p1",
    missionVersion: 7,
    missionStatus: "WAITING_INPUT",
    observedAt: "2026-10-25T08:00:00.000Z",
    missionUpdatedAt: "2026-10-25T08:00:00.000Z",
    materialUses: null,
    evidenceReviews: null,
    reviewProgress: reviewProgressOf({ steps: [], outputs: [], actions: [] }),
    callCoverage: null,
    resourceUsage: missionResourceUsageOf({
      models: 2,
      tools: 1,
      inputTokens: 120,
      outputTokens: 30,
      unknownCalls: 1,
    }),
    sourceConversation: null,
    selected: { question: null, approval: null, output: null, receipt: null },
    adoptions: [],
    actionReceipts: [],
    realityOutcome: "NOT_INFERRED",
    ...overrides,
  } as unknown as ReadbackData;
}

describe("C3 结果分类与支持上限", () => {
  it("沿用服务端原分类：执行、观察、独立支持、用户报告、反例、未知各自呈现，不合并成完成", () => {
    const progress = reviewProgressOf({
      steps: [
        { status: "SUCCEEDED", resultJson: { sources: [{ id: "capture:s1" }] } },
        { status: "UNKNOWN", resultJson: {} },
      ],
      outputs: [
        {
          id: "o1",
          revision: 1,
          claimChecksJson: [
            { status: "ENTAILS" },
            { status: "CONTRADICTS" },
            { status: "NOT_ENOUGH_INFORMATION" },
            { status: "NOT_CHECKED" },
          ],
        },
      ],
      actions: [
        { id: "a1", status: "DONE", resultCardId: "card-1", isSimulated: false },
        { id: "a2", status: "DONE", resultCardId: "card-sim", isSimulated: true },
      ],
    });
    render(
      createElement(MissionResultReceipts, {
        data: baseReadback({ reviewProgress: progress }),
      }),
    );
    const region = screen.getByRole("region", { name: "结果分类与支持上限" });
    expect(region.closest("details")).toBeNull();
    expect(within(region).getByText("已执行：2")).toBeTruthy();
    expect(within(region).getByText("已观察：1")).toBeTruthy();
    expect(within(region).getByText("已独立支持：0")).toBeTruthy();
    expect(
      within(region).getByText(/当前未提供独立核验回执/),
    ).toBeTruthy();
    expect(within(region).getByText("用户报告：1")).toBeTruthy();
    expect(within(region).getByText("反例：1")).toBeTruthy();
    expect(within(region).getByText("未知：3")).toBeTruthy();
    expect(
      within(region).getByText(
        /工具调用成功或用户自报完成 ≠ 独立支持 ≠ 现实目标达成/,
      ),
    ).toBeTruthy();
    expect(within(region).queryByText(/目标已完成|委托完成|已独立验证/)).toBeNull();
  });

  it("缺少分类摘要时如实说明，不构造默认完成事实", () => {
    render(
      createElement(MissionResultReceipts, {
        data: baseReadback({ reviewProgress: undefined }),
      }),
    );
    const region = screen.getByRole("region", { name: "结果分类与支持上限" });
    expect(within(region).getByText(/当前读回未提供结果分类摘要/)).toBeTruthy();
    expect(within(region).queryByText("已执行：0")).toBeNull();
  });
});

describe("C3 草稿与已采纳成果", () => {
  it("草稿只标只读版本，不显示完成；已采纳保留原链接与修订", () => {
    const data = baseReadback({
      selected: {
        question: null,
        approval: null,
        output: {
          id: "o1",
          revision: 2,
          contentJson: { blocks: [{ blockId: "b1", text: "草稿正文片段" }] },
        },
        receipt: null,
      },
      adoptions: [
        {
          receiptId: "r1",
          outputId: "o1",
          outputRevision: 2,
          artifactId: "art1",
          artifactType: "weekly_report",
          artifactCreatedAt: "2026-10-25T09:00:00.000Z",
          title: "阶段汇报",
        },
      ],
    } as unknown as Partial<ReadbackData>);
    render(createElement(MissionResultReceipts, { data }));
    const region = screen.getByRole("region", { name: "草稿与已采纳成果" });
    expect(within(region).getByText("指定草稿版本 2 · 只读")).toBeTruthy();
    expect(within(region).getByText("草稿正文片段")).toBeTruthy();
    const adoption = within(region).getByRole("link", { name: /阶段汇报/ });
    expect(adoption.getAttribute("href")).toBe(
      "/projects/p1/generate?artifact=art1&type=weekly_report",
    );
    expect(within(region).getByText(/来自草稿 2；回执 r1/)).toBeTruthy();
    expect(screen.queryByText(/用户报告完成/)).toBeNull();
  });
});

describe("C3 行动回执与真实行为边界", () => {
  it("用户报告与独立支持分开；resultCardId 链原复盘；演示不计真实；无回执入口不触发写", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const data = baseReadback({
      actionReceipts: [
        {
          id: "act1",
          title: "核对设备",
          status: "DONE",
          resultCardId: "card-9",
          completedAt: "2026-10-24T10:00:00.000Z",
          isSimulated: false,
        },
        {
          id: "act2",
          title: "补齐材料",
          status: "DONE",
          resultCardId: null,
          completedAt: null,
          isSimulated: false,
        },
        {
          id: "act3",
          title: "演示情境行动",
          status: "DONE",
          resultCardId: "card-sim",
          completedAt: null,
          isSimulated: true,
        },
        {
          id: "act4",
          title: "安排复测",
          status: "TODO",
          resultCardId: null,
          completedAt: null,
          isSimulated: false,
        },
      ],
    } as unknown as Partial<ReadbackData>);
    render(createElement(MissionResultReceipts, { data }));
    const region = screen.getByRole("region", { name: "行动与回执" });
    const reported = within(region).getByText(/用户报告完成/);
    expect(reported.textContent).toContain(
      new Date("2026-10-24T10:00:00.000Z").toLocaleString("zh-CN"),
    );
    expect(within(region).getByText("已标记完成，但无复盘回执")).toBeTruthy();
    expect(within(region).getByText("尚未开始，未完成")).toBeTruthy();
    expect(
      within(region).getAllByText(/演示情境，不计真实行为/),
    ).toHaveLength(1);
    expect(
      within(region).getByRole("link", { name: "查看原复盘回执 →" }).getAttribute("href"),
    ).toBe("/projects/p1/knowledge#card-card-9");
    const backLinks = within(region)
      .getAllByRole("link", { name: "回到原行动 →" })
      .map((link) => link.getAttribute("href"));
    expect(backLinks).toEqual([
      "/projects/p1/actions#action-act1",
      "/projects/p1/actions#action-act2",
    ]);
    expect(
      within(region).getByRole("link", { name: "回到原行动填写结果 →" }).getAttribute("href"),
    ).toBe("/projects/p1/actions#action-act4");
    // 演示行动不提供真实行为入口，也不冒充用户报告。
    expect(within(region).getByText(/演示完成标记/)).toBeTruthy();
    expect(within(region).queryAllByRole("button")).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("没有行动回执时给项目行动板入口，不自动写入", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(createElement(MissionResultReceipts, { data: baseReadback() }));
    const region = screen.getByRole("region", { name: "行动与回执" });
    expect(
      within(region).getByRole("link", { name: "到项目行动板处理行动 →" }).getAttribute("href"),
    ).toBe("/projects/p1/actions#action-board");
    expect(within(region).queryAllByRole("button")).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("C3 与旧读回、工作包与行动板的接线", () => {
  function materialUseItem(overrides: Record<string, unknown> = {}) {
    return {
      sourcePointer: { id: "capture:s1", hash: "a".repeat(64) },
      title: "显存记录",
      availability: "CURRENT",
      facts: [
        { kind: "SAVED", refId: "capture:s1" },
        { kind: "BOUND", refId: "step-1" },
      ],
      bodyCoverage: "NOT_RECORDED",
      excerpt: "10月显存6.2GB",
      coverage: {
        loadedCharacters: 9,
        totalCharacters: 9,
        truncated: false,
        extractionStatus: "SUCCESS",
      },
      ...overrides,
    };
  }
  function materialUsesOf(items: unknown[]) {
    return {
      schemaVersion: 1,
      questionId: "q1",
      items,
      coverage: { eventsTruncated: false },
    };
  }
  function evidenceReviewsOf() {
    return {
      items: [
        {
          eventId: "ev1",
          observedAt: "2026-10-25T08:00:00.000Z",
          fitStatus: "NOT_FIT",
          review: {
            mode: "CONDITIONAL_ANALYSIS",
            note: "观察条件不符，保留未知作条件分析",
          },
          unresolvedChecks: [],
        },
      ],
      truncated: false,
    };
  }

  it("旧读回文案不回归；结果分类排在工作包之后、技术细节之前", async () => {
    const legacy = baseReadback({
      materialUses: {
        schemaVersion: 1,
        questionId: "q1",
        items: [
          {
            sourcePointer: { id: "capture:s1", hash: "a".repeat(64) },
            title: "显存记录",
            availability: "CURRENT",
            facts: [
              { kind: "SAVED", refId: "capture:s1" },
              { kind: "BOUND", refId: "step-1" },
            ],
            bodyCoverage: "NOT_RECORDED",
            excerpt: "10月显存6.2GB",
            coverage: {
              loadedCharacters: 9,
              totalCharacters: 9,
              truncated: false,
              extractionStatus: "SUCCESS",
            },
          },
        ],
        coverage: { eventsTruncated: false },
      },
      selected: {
        question: { id: "q1", text: "请补充10月推理显存", historical: false },
        approval: null,
        output: null,
        receipt: null,
      },
    } as unknown as Partial<ReadbackData>);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ readback: legacy }),
      })),
    );
    render(createElement(MissionReadback, { missionId: "m", missionVersion: 7 }));
    const summary = await screen.findByText("本次用量 · 模型 2 次 · 工具 1 次");
    summary.click();
    expect(screen.getByText(/已记录输入 120 token/)).toBeTruthy();
    expect(screen.getByText(/不代表完整用量/)).toBeTruthy();
    expect(screen.getByText(/费用尚不能核算/)).toBeTruthy();
    expect(screen.queryByText(/总费用.*0/)).toBeNull();
    expect(screen.getByText("这份资料用在哪里 · 1")).toBeTruthy();
    expect(screen.getByText("已绑定原委托，尚未找到后续引用")).toBeTruthy();
    expect(
      screen.getByText("仅展示直接来源与有限历史；引用不表示结论已核验。"),
    ).toBeTruthy();
    const workPacket = screen.getByTestId("work-packet");
    const results = screen.getByRole("region", { name: "结果分类与支持上限" });
    const usage = screen.getByText("本次用量 · 模型 2 次 · 工具 1 次");
    expect(workPacket.compareDocumentPosition(results) & FOLLOWING).toBe(FOLLOWING);
    expect(results.compareDocumentPosition(usage) & FOLLOWING).toBe(FOLLOWING);
    expect(screen.getByText("这份资料用在哪里 · 1")).toBeTruthy();
  });

  it("新后端依据区已覆盖资料时不重复渲染旧资料块，证据核对指向依据区当前许可", async () => {
    const readback = baseReadback({
      materialUses: materialUsesOf([
        materialUseItem({ availability: "UNAVAILABLE", excerpt: null }),
      ]),
      evidenceReviews: evidenceReviewsOf(),
      workPacket: { basis: { questionId: "q1" } } as unknown as ReadbackData["workPacket"],
    } as unknown as Partial<ReadbackData>);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ readback }),
      })),
    );
    render(createElement(MissionReadback, { missionId: "m", missionVersion: 7 }));
    const evidence = await screen.findByText("这次资料核对");
    // 新后端由四问“依据是什么”逐项给当前许可，旧兼容块整体不出现。
    expect(screen.queryByText(/这份资料用在哪里/)).toBeNull();
    expect(
      screen.queryByText("仅展示直接来源与有限历史；引用不表示结论已核验。"),
    ).toBeNull();
    expect(screen.queryByText(/原资料暂不可访问/)).toBeNull();
    evidence.click();
    expect(
      screen.getByText("当前依据资格以「依据是什么」中的当前许可为准。"),
    ).toBeTruthy();
    // 顺序仍为 工作包 → 结果分类 → 技术细节。
    const workPacket = screen.getByTestId("work-packet");
    const results = screen.getByRole("region", { name: "结果分类与支持上限" });
    const usage = screen.getByText("本次用量 · 模型 2 次 · 工具 1 次");
    expect(workPacket.compareDocumentPosition(results) & FOLLOWING).toBe(FOLLOWING);
    expect(results.compareDocumentPosition(usage) & FOLLOWING).toBe(FOLLOWING);
  });

  it("旧后端 UNAVAILABLE 只说明兼容可用性，不误述为资料不可访问", async () => {
    const legacy = baseReadback({
      materialUses: materialUsesOf([
        materialUseItem({ availability: "UNAVAILABLE", excerpt: null }),
      ]),
    } as unknown as Partial<ReadbackData>);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ readback: legacy }),
      })),
    );
    render(createElement(MissionReadback, { missionId: "m", missionVersion: 7 }));
    expect(await screen.findByText("这份资料用在哪里 · 1")).toBeTruthy();
    expect(
      screen.getByText(
        "旧服务只返回兼容可用性；历史关联保留，不能据此推断当前许可或版本变化。",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/原资料暂不可访问/)).toBeNull();
    expect(screen.getByText("已绑定原委托，尚未找到后续引用")).toBeTruthy();
  });

  it("ActionBoard 只保留原复盘回链，不给已完成行动第二个确认", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const actions = [
      {
        id: "a1",
        projectId: "p",
        title: "完成演示",
        priority: 3,
        status: "DONE",
        resultCardId: "card-1",
        resultText: "演示通过",
        completedAt: "2026-10-24T10:00:00.000Z",
        isSimulated: false,
        createdAt: "2026-10-20T00:00:00.000Z",
        updatedAt: "2026-10-24T10:00:00.000Z",
      },
      {
        id: "a2",
        projectId: "p",
        title: "等待复测",
        priority: 3,
        status: "DOING",
        resultCardId: null,
        isSimulated: false,
        createdAt: "2026-10-20T00:00:00.000Z",
        updatedAt: "2026-10-20T00:00:00.000Z",
      },
    ] as ActionItemData[];
    render(createElement(ActionBoard, { projectId: "p", initialActions: actions }));
    fireEvent.click(screen.getByRole("button", { name: /已完成/ }));
    const card = document.getElementById("action-a1")!;
    expect(within(card).getByText("已完成")).toBeTruthy();
    expect(within(card).getByText(/回执：/)).toBeTruthy();
    expect(
      within(card).getByRole("link", { name: /查看结果复盘卡/ }).getAttribute("href"),
    ).toBe("/projects/p/knowledge#card-card-1");
    expect(
      within(card).queryByRole("button", { name: /确认完成|完成并写回执/ }),
    ).toBeNull();
    expect(
      within(card).queryByRole("button", { name: /确认/ }),
    ).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
