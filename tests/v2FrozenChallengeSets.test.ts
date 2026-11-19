import { expect, test } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { challengeQuestions, metricChallengeQuestions, linkVerdict } from "@/lib/challenges/rules";
import { assessRevision, type DraftView, type QualitySource } from "@/lib/evaluation/contentQuality";

const rules = JSON.parse(fs.readFileSync("planning/v2-first-loop/evaluation/challenge-rules.v1.json", "utf8")) as {
  sourceTruth: string; realAuthorizedSources: number; cases: Array<{ id: string; kind: "EVIDENCE" | "METRIC"; sources: unknown[]; content: unknown;
    expectedError: boolean; expected: string[]; synthetic: boolean; realAuthorized: boolean }> };
const reports = JSON.parse(fs.readFileSync("planning/v2-first-loop/evaluation/challenge-report-contexts.v1.json", "utf8")) as {
  sourceTruth: string; realAuthorizedSources: number; cases: Array<{ id: string; current: DraftView; previous: DraftView | null;
    redirectQuote: string | null; requiredUnknowns: string[]; expectedFailed: string[] }> };
const reportSources: QualitySource[] = [
  { id: "capture:q1", hash: "q1".padEnd(64, "0"), text: "登录流程已完成；移动端输入回归尚未记录；分享入口未验证。" },
  { id: "capture:q2", hash: "q2".padEnd(64, "0"), text: "补测记录：移动端输入回归已补测，分享入口仍未验证，结果尚未独立复现。" },
];
const hash = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

test("frozen rule set has exactly 20 synthetic cases and an explicit real-source gap", () => {
  expect(rules.sourceTruth).toBe("SYNTHETIC_ONLY");
  expect(rules.realAuthorizedSources).toBe(0);
  expect(rules.cases).toHaveLength(20);
  expect(new Set(rules.cases.map(item => item.id)).size).toBe(20);
  expect(rules.cases.every(item => item.synthetic && !item.realAuthorized)).toBe(true);
  expect(hash("planning/v2-first-loop/evaluation/challenge-rules.v1.json")).toBe("fabc95f4f13fa3edf7a412914fabff8705b2278472faae22eaa8ffdd8ee8cd0d");
});

test("every frozen evidence/metric rule reproduces its expected outcome", () => {
  for (const item of rules.cases) {
    if (item.expectedError) {
      expect(() => item.kind === "METRIC" ? metricChallengeQuestions(item.sources as never) : challengeQuestions("EVIDENCE", item.content, item.sources as never),
        item.id).toThrow();
      continue;
    }
    const question = item.kind === "METRIC" ? metricChallengeQuestions(item.sources as never)[0]
      : challengeQuestions("EVIDENCE", item.content, item.sources as never)[0];
    expect(question.expected, item.id).toEqual(item.expected);
    expect(linkVerdict(question, item.expected), item.id).toBe("LINK_MATCH");
    // Internal expected keys stay server-side; the challenge service strips them before responding.
    expect(question.options.map(option => option.key)).not.toContain("expected");
  }
});

test("frozen report contexts reproduce the same deterministic pass/fail dimensions", () => {
  expect(reports.sourceTruth).toBe("SYNTHETIC_ONLY");
  expect(reports.realAuthorizedSources).toBe(0);
  expect(reports.cases).toHaveLength(12);
  expect(hash("planning/v2-first-loop/evaluation/challenge-report-contexts.v1.json")).toBe("d3bff12a61991a482017b6cc7b21fcbe42963cf28cffdf771d09076b1499d70e");
  for (const item of reports.cases) {
    const checks = assessRevision({ previous: item.previous, current: item.current, sources: reportSources,
      redirectQuote: item.redirectQuote, userRequest: item.redirectQuote, requiredUnknowns: item.requiredUnknowns });
    const failed = [...new Set(checks.filter(check => check.status === "FAIL").map(check => check.name))].sort();
    expect(failed, item.id).toEqual([...item.expectedFailed].sort());
    expect(checks.filter(check => check.judge === "HUMAN_REVIEW")).toEqual([]);
  }
});
