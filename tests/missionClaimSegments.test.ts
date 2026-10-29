import { describe, expect, it } from "vitest";
import { segmentClaims, claimNumbers } from "@/lib/mission/claimSegments";
import { verifyResearchClaims } from "@/lib/mission/claimVerifier";
import { jsonHash, type Source } from "@/lib/mission/contracts";
import { textHash } from "@/lib/research/sourceRepository";
const raw = "复赛验证准确率：91%。本项目基线训练与参数核对已完成；数字是隔离评测合成材料，不代表真实实验。下一步核对验证数据划分并审阅阶段汇报。";
const source: Source = { id: "capture:fixture", kind: "PROJECT", entityType: "CAPTURE", hash: textHash(raw), revision: "v1", text: raw, observedAt: "2026-10-23T00:00:00Z" };
const draft = "阶段汇报草稿（P0-A 隔离合成项目）\n\n一、已完成事项\n1. 基线训练与参数核对已完成。\n2. 复赛验证准确率：91%（复赛验证阶段）。注意：该数字来自隔离评测合成材料，不代表真实实验。\n\n二、风险\n1. 复赛验证准确率 91% 为合成材料数据，不能作为真实实验结论对外引用。\n2. 验证数据划分尚未核对，可能影响指标可比性。\n\n三、下一步\n1. 核对验证数据划分。\n2. 审阅本阶段汇报草稿。";
const body = (text: string) => ({ kind: "NOTE", blocks: [{ blockId: "draft", text, kind: "PROJECT_OBSERVATION", sourceIds: [source.id], citations: [{ sourceId: source.id, start: 0, end: raw.length, excerptHash: textHash(raw) }] }] });
describe("real-ECS draft formatting regression (synthetic material)", () => {
  it("blank lines, P0-A title and list ordinals do not exhaust claim budget; content keeps exact ranges", async () => {
    const checks = await verifyResearchClaims(body(draft), [source], { enabled: true });
    expect(checks).toHaveLength(7);
    expect(checks.every(c => c.reasonCode !== "UNSUPPORTED_NUMBER" && c.reasonCode !== "CLAIM_LIMIT")).toBe(true);
    expect(checks.some(c => c.text === "审阅本阶段汇报草稿。")).toBe(true);
    for (const check of checks) { expect(draft.slice(check.claimStart, check.claimEnd)).toBe(check.text); expect(check.claimHash).toBe(jsonHash(check.text)); }
    expect(checks.every(c => c.status === "NOT_CHECKED")).toBe(true);
  });
  it("genuine unsupported metrics and factual headings remain checked", async () => {
    const checks = await verifyResearchClaims(body("# 准确率95%\n1. 准确率96%。\n2. 误差1.2mm。\n阶段汇报草稿（准确率97%）"), [source], { enabled: true });
    expect(checks).toHaveLength(4); expect(checks.every(c => c.reasonCode === "UNSUPPORTED_NUMBER")).toBe(true);
  });
  it("identifiers and ordinals are presentation, not measured quantities; adjacent Chinese metrics survive", () => {
    expect(claimNumbers("P0-A 与 ResNet50 的 P95 延迟118ms，准确率91%，误差-1.5mm。")).toEqual(["118", "91", "-1.5"]);
    const text = "  1.2. 准确率91%。\r\n\r\n### 下一步\r\n- 核对记录。";
    expect(segmentClaims(text).map(s => text.slice(s.start, s.end))).toEqual(["准确率91%。", "核对记录。"]);
  });
  it("more than nine actual claims still exposes the unverified remainder", async () => {
    const text = Array.from({ length: 12 }, () => "需要核对实验记录。").join("\n");
    const checks = await verifyResearchClaims(body(text), [source], { enabled: true });
    expect(checks).toHaveLength(9); expect(checks[8].reasonCode).toBe("CLAIM_LIMIT"); expect(checks[8].claimEnd).toBe(text.length);
  });
});
