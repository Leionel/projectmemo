import { describe, expect, test } from "vitest";
import { bindAnswerEvidence } from "@/lib/conversation/answerEvidence";
import { groundedCandidates } from "@/lib/decision/changeCandidateRules";
import { pagesFromBbox } from "@/lib/documents/pdfLayout";
import type { ConversationSource } from "@/lib/types/conversation";
import type { EvidenceSlice } from "@/lib/types/changeReview";

const word = (xMin: number, yMin: number, xMax: number, yMax: number, text: string) =>
  `<word xMin="${xMin}" yMin="${yMin}" xMax="${xMax}" yMax="${yMax}">${text}</word>`;
const page = (...words: string[]) => `<page width="595" height="842">\n${words.join("\n")}\n</page>`;
const doc = (...pages: string[]) => `<doc>${pages.join("\n")}</doc>`;

describe("PDF 词坐标还原版面", () => {
  test("基线不同的减号回到公式原位（坐标取自决赛演示的实验记录）", () => {
    const [text] = pagesFromBbox(doc(page(
      word(74.25, 519.19, 518.25, 531.19, "目标最小化缺口。单站"),
      word(182.25, 526.95, 189.21, 558.15, "−"),
      word(74.25, 539.44, 98.25, 551.44, "缺口"),
      word(158.25, 539.44, 182.25, 551.44, "借出"),
      word(189.21, 539.44, 243.21, 551.44, "期末库存)"),
    )));
    expect(text).toContain("借出−期末库存)");
    expect(text.split("\n")).toHaveLength(2);
  });

  test("空单元格之后的数字仍留在自己那一列", () => {
    const row = (y: number, label: string, x: number, value: string) => [word(80, y, 104, y + 12, label), word(x, y, x + 12, y + 12, value)];
    const lines = pagesFromBbox(doc(page(
      word(80, 100, 104, 112, "站点"), word(200, 100, 224, 112, "装上"), word(300, 100, 324, 112, "卸下"),
      ...row(120, "东门", 300, "8"), ...row(140, "一食", 200, "13"),
    )))[0].split("\n");
    const unload = lines[0].indexOf("卸下"), load = lines[0].indexOf("装上");
    expect(lines[1].indexOf("8")).toBeGreaterThan(load + 2);
    expect(Math.abs(lines[1].indexOf("8") - unload)).toBeLessThanOrEqual(4);
    expect(Math.abs(lines[2].indexOf("13") - load)).toBeLessThanOrEqual(4);
  });

  test("保留空页以维持物理页码，转义符还原", () => {
    const pages = pagesFromBbox(doc(page(word(10, 10, 60, 22, "A&amp;B")), page(), page(word(10, 10, 60, 22, "&lt;end&gt;"))));
    expect(pages).toEqual(["A&B", "", "<end>"]);
  });
});

describe("其他功能共用同一套引文核对", () => {
  const excerpt = "阶段汇报以方案B的\n\n      结果为准。\n方案A的记录不删。";
  const sources = [{ id: "s", sourceId: "attachment:a", excerpt }] as ConversationSource[];

  test("问答：跨行引文通过并还原成原文片段，坏引文只丢那一条", () => {
    const { citations, aligned } = bindAnswerEvidence([
      { sourceId: "attachment:a", quote: "阶段汇报以方案B的结果为准。" },
      { sourceId: "s", quote: "材料里根本没写这句话。" },
      { sourceId: "s", quote: "方案A的记录不删。" },
    ], sources);
    expect(citations.map(c => c.quote)).toEqual(["阶段汇报以方案B的\n\n      结果为准。", "方案A的记录不删。"]);
    expect(citations.every(c => excerpt.includes(c.quote))).toBe(true);
    expect(aligned[1]).toBeNull();
  });

  test("变更审查：只去掉引用不实的候选，全部不实才整轮不成立", () => {
    const evidence = [{ ref: "r", text: excerpt }] as EvidenceSlice[];
    const good = { evidence: [{ ref: "r", quote: "阶段汇报以方案B的结果为准。" }] };
    const bad = { evidence: [{ ref: "r", quote: "材料里根本没写这句话。" }] };
    expect(groundedCandidates([good, bad], evidence)).toEqual([good]);
    expect(() => groundedCandidates([bad], evidence)).toThrow(/候选引用不在实际读取的原文中/);
    expect(groundedCandidates([], evidence)).toEqual([]);
  });
});
