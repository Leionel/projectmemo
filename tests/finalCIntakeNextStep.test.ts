// @vitest-environment jsdom
/**
 * C3 / S1 首次项目：建项成功后的下一步，以及材料同步失败的同一项目恢复。
 *
 * 只验证原确认/同步流程不被重造：确认只提交一次；同步失败保留同一 projectId
 * 与原重试入口；重试只调用原同步接口，不产生第二次建项。
 */
import { createElement } from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectIntakeForm } from "@/components/ProjectIntakeForm";
import { buildIntakeCoverage } from "@/lib/intake/coverage";
import type { IntakePreview } from "@/lib/intake/contracts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const accepted = {
  title: "课程原型交付",
  description: "先确认旧平板能否稳定演示，再决定原型方案。",
  goal: "确认设备可用性后完成可演示的课程原型",
  scenario: "COURSE_DESIGN" as const,
};

const materialRow = {
  id: "mat1",
  revision: 1,
  contentHash: "hash-m1",
  kind: "TEXT",
  rawText: "课程要求在 11 月 20 日前交付一个可演示的原型。",
  ordinal: 1,
  type: "TEXT",
  fileName: null,
  extractionStatus: "SUCCESS",
};

function preview(overrides: Record<string, unknown> = {}): IntakePreview {
  return {
    schemaVersion: 1,
    draftId: "d1",
    revision: 3,
    status: "READY",
    materialsHash: "materials-hash",
    understandingState: "READY",
    model: {
      used: false,
      provider: null,
      reason: "RULE_MODE",
      usageUnknown: false,
    },
    summary: "材料明确了交付时间与设备风险。",
    statements: [
      {
        materialId: "mat1",
        materialLabel: "材料 1",
        quote: "课程要求在 11 月 20 日前交付一个可演示的原型。",
        meaning: "交付时间明确。",
      },
    ],
    suggested: accepted,
    constraints: [],
    unknowns: [
      { text: "旧平板能否稳定运行演示", whyItMatters: "决定是否需要换设备。" },
    ],
    successCriteria: [],
    nextQuestion: {
      text: "旧平板最近一次稳定点亮是什么时候？",
      why: "决定是否需要换设备。",
    },
    correction: {
      appliedObjective: null,
      constraints: [],
      until: null,
      candidates: [],
      clarify: null,
      admittedAt: null,
    },
    accepted,
    coverage: buildIntakeCoverage({
      materials: [materialRow],
      materialsHash: "materials-hash",
      consentGranted: true,
      round: null,
    }),
    materials: [
      {
        ...materialRow,
        size: 20,
        sha256: null,
        extractionError: null,
        sync: { state: "PENDING" },
      },
    ],
    expiresAt: "2026-11-10T00:00:00.000Z",
    previewHash: "preview-hash-1",
    ...overrides,
  } as unknown as IntakePreview;
}

type Call = { url: string; method: string; body?: string };

function ok(body: unknown) {
  return { ok: true, json: async () => body };
}

/** 只模拟确认与同步两个端点；未声明的请求直接失败，暴露多余调用。 */
function stubIntakeFlow(options: { syncFailures: number }) {
  const calls: Call[] = [];
  let syncAttempt = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body as string | undefined });
    if (url === "/api/intake/d1" && method === "GET")
      return ok({ preview: preview(), confirmedProjectId: null, processingConsent: true });
    if (url === "/api/intake/d1/confirm" && method === "POST")
      return ok({ projectId: "p1" });
    if (url === "/api/intake/d1/sync" && method === "POST") {
      syncAttempt++;
      if (syncAttempt <= options.syncFailures)
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: { message: "原件暂时不可用" } }),
        };
      return ok({
        projectId: "p1",
        pending: 0,
        materials: [{ materialId: "mat1", state: "SYNCED" }],
        preview: preview(),
      });
    }
    throw new Error(`未预期的请求：${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

function renderForm() {
  render(
    createElement(ProjectIntakeForm, {
      ownerId: "u1",
      initialDraftId: "d1",
      openDrafts: [],
    }),
  );
}

async function openConfirmedPreview() {
  await screen.findByText("已形成理解，请整体核对");
  expect(screen.queryByText("下一步")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "确认理解，建立项目" }));
}

describe("C3 建项成功后的下一步", () => {
  it("建项成功后给出核对目标、查看材料与未知、开始原调查的入口，且只建项一次", async () => {
    const { calls } = stubIntakeFlow({ syncFailures: 0 });
    renderForm();
    await openConfirmedPreview();
    await screen.findByText(/项目已建立，材料已同步 1\/1 份。/);
    expect(screen.getByText("下一步")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "核对目标与范围 →" }).getAttribute("href"),
    ).toBe("/projects/p1");
    expect(
      screen.getByRole("link", { name: "查看材料与未知 →" }).getAttribute("href"),
    ).toBe("/projects/p1/records");
    expect(
      screen.getByRole("link", { name: "开始原调查 →" }).getAttribute("href"),
    ).toBe("/projects/p1/missions");
    expect(
      screen.getByText(
        "材料已保存；这次没有启用真实模型，只做了规则整理，未声称已理解全文。",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "确认理解，建立项目" })).toBeNull();
    const confirmCalls = calls.filter((call) => call.url === "/api/intake/d1/confirm");
    expect(confirmCalls).toHaveLength(1);
    expect(JSON.parse(confirmCalls[0].body!)).toMatchObject({
      expectedRevision: 3,
      previewHash: "preview-hash-1",
      accepted,
    });
    expect(calls.filter((call) => call.url === "/api/intake/d1/sync")).toHaveLength(1);
    expect(calls.some((call) => call.url === "/api/intake")).toBe(false);
  });

  it("同步失败保留同一 projectId、原重试入口与下一步，重试不第二次建项", async () => {
    const { calls } = stubIntakeFlow({ syncFailures: 1 });
    renderForm();
    await openConfirmedPreview();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("项目已建立");
    expect(alert.textContent).toContain("原件暂时不可用");
    expect(alert.textContent).toContain("不会重复建项");
    expect(screen.queryByText(/确认建项失败/)).toBeNull();
    expect(screen.getByRole("link", { name: "进入项目" }).getAttribute("href")).toBe(
      "/projects/p1",
    );
    expect(
      screen.getByRole("link", { name: "核对目标与范围 →" }).getAttribute("href"),
    ).toBe("/projects/p1");
    const retry = screen.getByRole("button", { name: "重新同步材料" });
    fireEvent.click(retry);
    await screen.findByText(/项目已建立，材料已同步 1\/1 份。/);
    expect(screen.queryByRole("alert")).toBeNull();
    const syncCalls = calls.filter((call) => call.url === "/api/intake/d1/sync");
    expect(syncCalls).toHaveLength(2);
    expect(syncCalls.every((call) => call.method === "POST")).toBe(true);
    expect(calls.filter((call) => call.url === "/api/intake/d1/confirm")).toHaveLength(1);
    expect(calls.some((call) => call.url === "/api/intake")).toBe(false);
    expect(screen.getByRole("link", { name: "进入项目" }).getAttribute("href")).toBe(
      "/projects/p1",
    );
    expect(screen.getByText("下一步")).toBeTruthy();
  });

  it("重试仍失败时项目身份与重试入口都保留，不重新确认建项", async () => {
    const { calls } = stubIntakeFlow({ syncFailures: 2 });
    renderForm();
    await openConfirmedPreview();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "重新同步材料" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("原件暂时不可用"),
    );
    expect(screen.queryByText(/重新同步失败/)).toBeNull();
    expect(screen.getByRole("link", { name: "进入项目" }).getAttribute("href")).toBe(
      "/projects/p1",
    );
    expect(screen.getByRole("button", { name: "重新同步材料" })).toBeTruthy();
    expect(calls.filter((call) => call.url === "/api/intake/d1/confirm")).toHaveLength(1);
    expect(calls.filter((call) => call.url === "/api/intake/d1/sync")).toHaveLength(2);
    expect(calls.some((call) => call.url === "/api/intake")).toBe(false);
  });
});
