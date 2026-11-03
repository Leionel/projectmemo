// @vitest-environment jsdom
/**
 * C 接线回归：读回遇到 409 WORK_PACKET_AUTHORITY_CHANGED 时保留上次结果并提示重新核对，
 * 不自动沿用旧资格、不清空已显示的私有内容；401/403/404 仍清空。
 *
 * 这是 Lead 集成用例，覆盖 MissionReadback 容器的并发/权限变化恢复路径；
 * 四问/依据/结果子组件的行为由各 Track C 专项测试覆盖。
 */
import { createElement } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { MissionReadback } from "@/components/MissionReadback";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function legacyReadback(missionVersion: number) {
  // 旧后端形态：保留原 readback 字段但没有 workPacket；客户端必须保留原详情。
  return {
    missionId: "m",
    projectId: "p",
    missionVersion,
    missionStatus: "WAITING_INPUT",
    observedAt: "2026-11-03T06:00:00.000Z",
    missionUpdatedAt: "2026-11-03T06:00:00.000Z",
    workState: {
      phase: "WAITING_USER",
      nextActor: "USER",
      requiresUser: true,
      reasonCode: "QUESTION_PENDING",
      reasonText: "等待你补充原问题",
      actionLabel: "回答原问题",
      originalRef: { kind: "MISSION", id: "m", version: missionVersion },
      exactQuestionRef: "q1",
      exactApprovalRef: null,
      checkedAt: "2026-11-03T06:00:00.000Z",
      observedAt: null,
      nextCheckAt: null,
      nextBoundary: null,
      freshness: "FRESH",
    },
    materialUses: null,
    evidenceReviews: null,
    reviewProgress: null,
    callCoverage: null,
    resourceUsage: null,
    sourceConversation: null,
    selected: { question: null, approval: null, output: null, receipt: null },
    adoptions: [],
    actionReceipts: [],
    realityOutcome: "NOT_INFERRED",
  };
}

function okResponse(readback: unknown) {
  return { ok: true, status: 200, json: async () => ({ readback }) };
}

function errorResponse(status: number, code: string, message: string) {
  return { ok: false, status, json: async () => ({ error: { code, message } }) };
}

describe("读回并发与权限变化恢复", () => {
  it("409 WORK_PACKET_AUTHORITY_CHANGED 保留上次结果并提示重新核对，不静默沿用旧资格", async () => {
    let mode: "ok" | "conflict" = "ok";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mode === "ok"
          ? okResponse(legacyReadback(3))
          : errorResponse(
              409,
              "WORK_PACKET_AUTHORITY_CHANGED",
              "读取期间来源或权限持续变化，请重新读取原委托后核对",
            ),
      ),
    );
    render(createElement(MissionReadback, { missionId: "m", missionVersion: 3 }));
    // 首次读取成功：旧后端但保留原详情，明确摘要暂未提供。
    expect(await screen.findByText(/当前摘要暂未提供/)).toBeTruthy();
    // C1 工作包已把原状态枚举中文化：旧后端降级同样显示中文状态。
    expect(screen.getByText("等待补充信息")).toBeTruthy();

    mode = "conflict";
    fireEvent.click(screen.getByRole("button", { name: "重新读取状态与回执" }));
    const notice = await screen.findByText(/已保留上次读取结果/);
    expect(notice.textContent).toContain("重新读取原委托后核对");
    expect(notice.textContent).toContain("不会自动沿用旧资格");
    // 上次读取的详情仍在，不被 409 清空。
    expect(screen.getByText(/当前摘要暂未提供/)).toBeTruthy();
  });

  it("401 清空已显示的私有读回，不留下旧账号内容", async () => {
    let mode: "ok" | "unauthorized" = "ok";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mode === "ok"
          ? okResponse(legacyReadback(3))
          : errorResponse(401, "UNAUTHORIZED", "登录已过期"),
      ),
    );
    render(createElement(MissionReadback, { missionId: "m", missionVersion: 3 }));
    expect(await screen.findByText(/当前摘要暂未提供/)).toBeTruthy();
    mode = "unauthorized";
    fireEvent.click(screen.getByRole("button", { name: "重新读取状态与回执" }));
    expect(await screen.findByText(/登录已过期/)).toBeTruthy();
    expect(screen.queryByText(/当前摘要暂未提供/)).toBeNull();
  });
});
