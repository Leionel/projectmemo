import { describe, expect, test } from "vitest";
import { locateQuote, quoteKey } from "@/lib/evidence/quoteMatch";
import { verifyQuotes } from "@/lib/intake/quoteCheck";
import type { IntakeUnderstanding } from "@/lib/intake/contracts";

/** 摘自真实 PDF 经 pdftotext -layout 抽取的结果（决赛演示的合成材料），断行和缩进保持原样。 */
const MEETING = `三、决定
 1. 建模方案由线性规划（方案A）改为整数规划（方案B），阶段汇报以方案B的

      结果为准。
 2. 方案A的记录不删，14这个结果汇报时作为下界对比。`;
const RECORD = `         实验记录（方案B 第一版）

记录人：林思远　日期：2026年11月5日（周四）
      林思远找到一篇论文（Raviv, Tzur, Forma, 2013，EURO J
Transp Logist）。`;

const matches = (quote: string, text: string) => quoteKey(text).includes(quoteKey(quote));

function understandingWith(quotes: IntakeUnderstanding["quotes"]) {
  return { quotes } as IntakeUnderstanding;
}

describe("引文比对只抹掉排版差异", () => {
  test.each([
    ["PDF 断行被模型接上", "阶段汇报以方案B的结果为准。", MEETING],
    ["中英之间的版面空格", "实验记录（方案B第一版）", RECORD],
    ["全角空格", "记录人：林思远 日期：2026年11月5日", RECORD],
    ["全半角标点", "建模方案由线性规划(方案A)改为整数规划(方案B)", MEETING],
    ["英文跨行保留空格", "EURO J Transp Logist", RECORD],
    ["康熙部首字形", "方案", "⽅案"],
    ["弯引号", "\"下界\"", "作为“下界”对比"],
    ["破折号", "7:00-9:00", "7:00—9:00"],
  ])("%s", (_name, quote, text) => { expect(matches(quote, text)).toBe(true); });

  test.each([
    ["改写", "阶段汇报以方案A的结果为准。", MEETING],
    ["调换字序", "结果为准，阶段汇报以方案B的", MEETING],
    ["改数字", "方案A的记录不删，15这个结果", MEETING],
    ["英文词边界", "notable", "The agent is not\nable to do it."],
    ["数字不能拼接", "12", "1 2"],
    ["空引文", "   ", MEETING],
  ])("%s 仍然对不上", (_name, quote, text) => {
    expect(quoteKey(quote) !== "" && matches(quote, text)).toBe(false);
  });
});

describe("定位回原文", () => {
  test("返回的片段一定是原文的连续子串", () => {
    const found = locateQuote(MEETING, "阶段汇报以方案B的结果为准。")!;
    expect(found.text).toBe("阶段汇报以方案B的\n\n      结果为准。");
    expect(MEETING.slice(found.start, found.end)).toBe(found.text);
  });
  test("区分唯一和重复，找不到返回 null", () => {
    expect(locateQuote("方案A\n通过，方案A\n未通过", "方案A通过")?.unique).toBe(true);
    expect(locateQuote("甲 乙，甲\n乙", "甲乙")?.unique).toBe(false);
    expect(locateQuote(MEETING, "材料里根本没写这句话。")).toBeNull();
    expect(locateQuote(MEETING, "  ")).toBeNull();
  });
});

describe("逐条核对", () => {
  const materials = [{ id: "meeting", rawText: MEETING }, { id: "record", rawText: RECORD }, { id: "scan", rawText: null }];

  test("只丢掉对不上的那条，其余保留", () => {
    const { understanding, dropped } = verifyQuotes(understandingWith([
      { materialId: "meeting", quote: "阶段汇报以方案B的结果为准。", meaning: "" },
      { materialId: "meeting", quote: "材料里根本没写这句话。", meaning: "" },
    ]), materials);
    expect(understanding.quotes.map(q => q.quote)).toEqual(["阶段汇报以方案B的结果为准。"]);
    expect(dropped.map(q => q.quote)).toEqual(["材料里根本没写这句话。"]);
  });

  test("标错材料时改绑到真正出处，不认识的材料也一样", () => {
    const { understanding } = verifyQuotes(understandingWith([
      { materialId: "record", quote: "方案A的记录不删", meaning: "" },
      { materialId: "文件 1", quote: "实验记录（方案B第一版）", meaning: "" },
    ]), materials);
    expect(understanding.quotes.map(q => q.materialId)).toEqual(["meeting", "record"]);
  });
});
