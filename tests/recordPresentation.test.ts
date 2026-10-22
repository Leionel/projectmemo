import { expect, it } from "vitest";
import { readableRecord } from "@/lib/recordPresentation";
it("结构化资料使用可读标题，既不展开内部JSON也不将指标标为事实", () => {
  const raw = JSON.stringify({ schemaVersion: 1, kind: "PROJECT_METRIC", value: 118 });
  expect(readableRecord(raw, raw)).toEqual({ title: "结构化项目实验记录", summary: "已保存结构化资料；打开原项目查看原文与核验状态。" });
  expect(readableRecord("实验 P95 为118ms", "待复测")).toEqual({ title: "实验 P95 为118ms", summary: "待复测" });
  expect(readableRecord("JSON代码笔记", '{"kind":"code"}').title).toBe("JSON代码笔记");
});
