import { describe, expect, it, vi } from "vitest";
import { evaluateTrustReceipt } from "@/lib/evidence/trustReceipt";
import { assessCopilotSemantics } from "@/lib/evidence/copilotSemantic";
import { semanticLabel, temporalLabel } from "@/lib/evidence/assessment";
import { buildCopilotPrompt } from "@/lib/agent/prompts";
import type { ClaimJudge } from "@/lib/mission/claimVerifier";

const evaluate = (claim: string, text: string, state: "CURRENT" | "UNKNOWN" | "SUPERSEDED" | "CONTESTED" = "UNKNOWN", belongsToProject = true) => evaluateTrustReceipt({
  claims: [{ text: claim, cardIds: ["one"] }], fallbackClaimText: claim, fallbackCardIds: [], retrievalMode: "keyword_fallback",
  evidence: [{ cardId: "one", text, revision: "source-v1", sourceTime: "2026-10-01T00:00:00Z", belongsToProject,
    current: state !== "SUPERSEDED", topLevelState: state, supportState: "INSUFFICIENT", supersededBy: null }],
}).receipt;
describe("EvidenceAssessment axes", () => {
  it("unrelated admitted citation never becomes a semantic pass", () => {
    const result = evaluate("项目准确率95%。", "下周核对参赛文件。", "CURRENT");
    expect(result.claims[0].assessments?.[0]).toMatchObject({ schemaVersion: 1, citationAdmissibility: "ADMITTED", temporalState: "CURRENT", semanticVerdict: "NOT_CHECKED", sourceRevision: "source-v1" });
  });
  it.each([["项目准确率95%。", "项目准确率91%。"], ["实验已经完成。", "实验已经未完成。"]])("opposite numeric/negative text is counterevidence: %s", (claim, text) => {
    const receipt = evaluate(claim, text);
    expect(receipt.claims[0].assessments?.[0].semanticVerdict).toBe("CONTRADICTS");
    expect(receipt.supportState).toBe("CONTESTED");
  });
  it("isolated exact record is quotable without inventing temporal truth", () => {
    const receipt = evaluate("实验记录准确率91%。", "实验记录准确率91%。");
    expect(receipt.abstained).toBe(false);
    expect(receipt.claims[0].assessments?.[0]).toMatchObject({ temporalState: "UNKNOWN", semanticVerdict: "NOT_CHECKED", reasonCode: "EXACT_QUOTATION", method: "RULE" });
  });
  it.each(["SUPERSEDED", "CONTESTED"] as const)("text match never promotes %s to current fact", state => {
    const receipt = evaluate("实验记录准确率91%。", "实验记录准确率91%。", state);
    expect(receipt.abstained).toBe(true);
    expect(receipt.claims[0].assessments?.[0].temporalState).toBe(state);
  });
  it("cross-project citation cannot be admitted or semantically checked", () => {
    expect(evaluate("相同原文", "相同原文", "CURRENT", false).claims[0].assessments?.[0]).toMatchObject({ citationAdmissibility: "REJECTED", semanticVerdict: "NOT_CHECKED" });
  });
  it("Judge is opt-in, at most three calls, failures remain unverified", async () => {
    const claims = Array.from({ length: 5 }, (_, i) => ({ text: "判断" + i, cardIds: ["one"] })), cards = [{ id: "one", summary: "记录" }];
    const judge = vi.fn<ClaimJudge>(async () => { throw new Error("unavailable"); });
    expect((await assessCopilotSemantics(claims, cards)).size).toBe(0);
    expect((await assessCopilotSemantics(claims, cards, judge)).size).toBe(0);
    expect(judge).toHaveBeenCalledTimes(3);
  });
  it("prompt retains historical state/revision and treats source as data", () => {
    const prompt = buildCopilotPrompt({ project: { title: "项目", description: "", goal: "核对" }, question: "进展？", interventions: [], actions: [],
      cards: [{ id: "one", title: "记录", type: "experiment_log", summary: "旧值", temporalState: "SUPERSEDED", sourceRevision: "v1" }] });
    expect(prompt).toContain("时态=SUPERSEDED"); expect(prompt).toContain("来源版本=v1"); expect(prompt).toContain("untrusted data");
    expect(semanticLabel()).toBe("语义尚未核验"); expect(temporalLabel()).toBe("时态未知");
  });
});
