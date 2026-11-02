// @vitest-environment jsdom
import { createElement } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { IntakeCoveragePanel } from "@/components/IntakeCoveragePanel";
import { buildIntakeCoverage } from "@/lib/intake/coverage";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("读取下一页时版本已变化，丢弃旧缓存且不拼接新旧正文", async () => {
  const materials = [{ id: "m", revision: 1, contentHash: "old", kind: "TEXT", rawText: "初版原文", ordinal: 1, type: "TEXT", fileName: null, extractionStatus: "SUCCESS" }];
  const coverage = buildIntakeCoverage({ materials, materialsHash: "old", consentGranted: true, round: null });
  let calls = 0;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ++calls === 1
    ? { materialId: "m", revision: 1, contentHash: "old", text: "初版原文", offset: 0, totalChars: 100, hasMore: true }
    : { materialId: "m", revision: 2, contentHash: "new", text: "新版片段", offset: 4, totalChars: 100, hasMore: false } })));
  render(createElement(IntakeCoveragePanel, { draftId: "d", coverage, materials }));
  fireEvent.click(screen.getByRole("button", { name: /^核对原文/ }));
  await screen.findByText("初版原文");
  fireEvent.click(screen.getByRole("button", { name: "继续读" }));
  await screen.findByText(/原文版本已变化或无法核对/);
  expect(screen.queryByText("初版原文")).toBeNull();
  expect(screen.queryByText(/新版片段/)).toBeNull();
  expect(calls).toBe(2);
});
