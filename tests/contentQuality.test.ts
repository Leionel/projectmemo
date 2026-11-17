import { expect, test } from "vitest";
import { assessRevision, semanticReviewChecks, structuralPassed, type DraftView, type QualitySource } from "@/lib/evaluation/contentQuality";

const sources: QualitySource[] = [
  { id: "capture:a", hash: "a".repeat(64), text: "登录流程已完成；移动端输入回归尚未记录；分享入口未验证。" },
  { id: "capture:b", hash: "b".repeat(64), text: "新增发布记录：移动端输入回归已补测，分享入口仍未验证；结果尚未独立复现。" },
];
const redirectQuote = "今天先核对第二版交付依据";
const requiredUnknowns = ["分享入口未验证"];

function draft(text: string, blocks: DraftView["blocks"], sourceIds: string[], missingInformation: string[] = []): DraftView {
  return { text, blocks, sourceIds, missingInformation };
}
const first = draft("项目资料记载：登录流程已完成；移动端输入回归尚未记录；分享入口未验证。未知项：分享入口未验证。",
  [
    { blockId: "a", text: "项目资料记载：登录流程已完成；移动端输入回归尚未记录；分享入口未验证。", kind: "PROJECT_OBSERVATION", sourceIds: ["capture:a"], citations: [{ sourceId: "capture:a" }] },
    { blockId: "note", text: "未知项：分享入口未验证，不能写成已完成。", kind: "INFERENCE", sourceIds: [] },
  ], ["capture:a"], ["分享入口未验证"]);
const goodRevision = draft("本轮工作重点：今天先核对第二版交付依据。项目资料记载：登录流程已完成；移动端输入回归尚未记录；分享入口未验证。新增记录：移动端输入回归已补测，结果尚未独立复现。据此，发布说明保留登录流程为已验证项，移动端输入回归标注待复现，分享入口未验证仍列为未知。",
  [
    { blockId: "a", text: "项目资料记载：登录流程已完成；移动端输入回归尚未记录；分享入口未验证。", kind: "PROJECT_OBSERVATION", sourceIds: ["capture:a"], citations: [{ sourceId: "capture:a" }] },
    { blockId: "b", text: "新增记录：移动端输入回归已补测，结果尚未独立复现。", kind: "PROJECT_OBSERVATION", sourceIds: ["capture:b"], citations: [{ sourceId: "capture:b" }] },
    { blockId: "note", text: "本轮工作重点：今天先核对第二版交付依据。分享入口未验证仍列为未知。", kind: "INFERENCE", sourceIds: [] },
  ], ["capture:a", "capture:b"], ["分享入口未验证"]);

test("a genuine evidence-backed revision passes every structural check", () => {
  const checks = assessRevision({ previous: first, current: goodRevision, sources, redirectQuote, userRequest: redirectQuote, requiredUnknowns });
  expect(checks.filter(check => check.status === "FAIL")).toEqual([]);
  expect(structuralPassed(checks)).toBe(true);
});

test("copying the user request does not count as implementing the redirect", () => {
  const copy = draft((redirectQuote + "。").repeat(8), [{ blockId: "copy", text: (redirectQuote + "。").repeat(8), kind: "INFERENCE", sourceIds: [] }], []);
  const checks = assessRevision({ previous: first, current: copy, sources, redirectQuote, userRequest: redirectQuote, requiredUnknowns });
  const failed = new Set(checks.filter(check => check.status === "FAIL").map(check => check.name));
  expect(failed.has("EVIDENCE_BOUND")).toBe(true);
  expect(failed.has("NOT_COPY_OF_USER_REQUEST")).toBe(true);
  expect(failed.has("REDIRECT_ADDRESSED")).toBe(true);
});

test("unrelated body plus a matching title is rejected", () => {
  const unrelated = draft("本轮工作重点：今天先核对第二版交付依据。今天午饭吃了面条，下午去操场散步，天气很好，明天可能下雨。",
    [{ blockId: "title", text: "本轮工作重点：今天先核对第二版交付依据。", kind: "INFERENCE", sourceIds: [] },
      { blockId: "filler", text: "今天午饭吃了面条，下午去操场散步，天气很好，明天可能下雨。", kind: "INFERENCE", sourceIds: [] }], []);
  const checks = assessRevision({ previous: first, current: unrelated, sources, redirectQuote, requiredUnknowns });
  const failed = new Set(checks.filter(check => check.status === "FAIL").map(check => check.name));
  expect(failed.has("EVIDENCE_BOUND")).toBe(true);
  expect(failed.has("REDIRECT_ADDRESSED")).toBe(true);
});

test("an unrelated citation cannot pretend old evidence was retained", () => {
  const masquerade = draft("项目资料记载：登录流程已完成；移动端输入回归尚未记录；分享入口未验证。另附一条无关引用说明。",
    [{ blockId: "a", text: "项目资料记载：登录流程已完成；移动端输入回归尚未记录；分享入口未验证。", kind: "PROJECT_OBSERVATION", sourceIds: ["capture:other"], citations: [{ sourceId: "capture:other" }] },
      { blockId: "note", text: "另附一条无关引用说明。", kind: "INFERENCE", sourceIds: [] }],
    ["capture:other"]);
  const checks = assessRevision({ previous: first, current: masquerade, sources, redirectQuote, requiredUnknowns });
  const failed = new Set(checks.filter(check => check.status === "FAIL").map(check => check.name));
  expect(failed.has("CITATIONS_RESOLVE")).toBe(true);
});

test("a few-character edit is not an effective revision", () => {
  const trivial = draft(first.text.replace("未知项：分享入口未验证。", "未知项：分享入口仍未验证。"), first.blocks, first.sourceIds, first.missingInformation);
  const checks = assessRevision({ previous: first, current: trivial, sources, redirectQuote, requiredUnknowns });
  expect(checks.find(check => check.name === "EFFECTIVE_REVISION")?.status).toBe("FAIL");
});

test("dropping a required unknown is rejected", () => {
  const withoutUnknown = draft("本轮工作重点：今天先核对第二版交付依据。项目资料记载：登录流程已完成；移动端输入回归已补测。",
    goodRevision.blocks.map(block => block.blockId === "note" ? { ...block, text: "本轮工作重点：今天先核对第二版交付依据。" } : block),
    goodRevision.sourceIds, []);
  const checks = assessRevision({ previous: first, current: withoutUnknown, sources, redirectQuote, requiredUnknowns });
  expect(checks.find(check => check.name === "UNKNOWN_PRESERVED")?.status).toBe("FAIL");
});

test("semantic claims stay unverified and are never reported as passes", () => {
  const semantic = semanticReviewChecks();
  expect(semantic.length).toBeGreaterThan(0);
  expect(semantic.every(check => check.status === "UNVERIFIED" && check.judge === "HUMAN_REVIEW")).toBe(true);
});
