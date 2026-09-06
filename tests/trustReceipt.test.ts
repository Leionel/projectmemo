import { describe, expect, it } from "vitest";
import { evaluateTrustReceipt, guardedAnswerMessage, type CardEvidenceState } from "@/lib/evidence/trustReceipt";

function evidence(overrides: Partial<CardEvidenceState> = {}): CardEvidenceState {
  return {
    cardId: "card-current",
    belongsToProject: true,
    current: true,
    supportState: "INSUFFICIENT",
    supersededBy: null,
    ...overrides,
  };
}

describe("W05 evidence trust receipt", () => {
  it("supports a claim only with a current same-project card", () => {
    const result = evaluateTrustReceipt({
      claims: [{ text: "消融实验已经完成", cardIds: ["card-current"] }],
      fallbackClaimText: "",
      fallbackCardIds: [],
      evidence: [evidence()],
      retrievalMode: "keyword_fallback",
      evaluatedAt: new Date("2026-09-02T00:00:00.000Z"),
    });
    expect(result.receipt).toMatchObject({ supportState: "SUPPORTED", abstained: false });
    expect(result.receipt.claims[0]).toMatchObject({ cardIds: ["card-current"], supersededCardIds: [] });
  });

  it("refuses when the only cited card has been superseded", () => {
    const result = evaluateTrustReceipt({
      claims: [{ text: "仍采用旧检索方案", cardIds: ["card-old"] }],
      fallbackClaimText: "",
      fallbackCardIds: [],
      evidence: [evidence({ cardId: "card-old", current: false, supportState: "SUPERSEDED" })],
      retrievalMode: "hybrid",
    });
    expect(result.receipt.supportState).toBe("INSUFFICIENT");
    expect(result.receipt.claims[0].supersededCardIds).toEqual(["card-old"]);
    expect(guardedAnswerMessage(result.receipt, "错误的肯定回答")).toContain("我不知道");
  });

  it.each(["CONFLICT", "PENDING"] as const)("marks %s evidence as contested", (supportState) => {
    const result = evaluateTrustReceipt({
      claims: [{ text: "当前方案已经确定", cardIds: ["card-current"] }],
      fallbackClaimText: "",
      fallbackCardIds: [],
      evidence: [evidence({ supportState })],
      retrievalMode: "keyword_fallback",
    });
    expect(result.receipt).toMatchObject({ supportState: "CONTESTED", abstained: true });
  });

  it("rejects an unknown or cross-project citation", () => {
    const result = evaluateTrustReceipt({
      claims: [{ text: "另一个项目的结果也适用", cardIds: ["foreign-card"] }],
      fallbackClaimText: "",
      fallbackCardIds: [],
      evidence: [evidence({ cardId: "foreign-card", belongsToProject: false })],
      retrievalMode: "keyword_fallback",
    });
    expect(result.receipt.supportState).toBe("INSUFFICIENT");
    expect(result.acceptedCardIds).toEqual([]);
    expect(result.rejectedCardIds).toEqual(["foreign-card"]);
  });

  it("uses the strictest state across multiple claims", () => {
    const result = evaluateTrustReceipt({
      claims: [
        { text: "已完成事实", cardIds: ["card-current"] },
        { text: "尚无依据的事实", cardIds: [] },
      ],
      fallbackClaimText: "",
      fallbackCardIds: [],
      evidence: [evidence()],
      retrievalMode: "keyword_fallback",
    });
    expect(result.receipt.supportState).toBe("INSUFFICIENT");
    expect(result.receipt.abstained).toBe(true);
  });
});
