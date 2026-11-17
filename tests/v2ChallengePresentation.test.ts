import { describe, expect, test } from "vitest";
import { handoffStatus, locateExcerpt, mentorFinding, rehearsalStep, REHEARSAL_STEPS } from "@/lib/challenges/presentation";
import type { ChallengeAnswer, ChallengeQuestion } from "@/lib/types/challenge";

const source = "输入回归记录（节选）\n输入回归测试通过：桌面端输入与粘贴均已回归。\n系统分享尚未在真机验证，不能写成已完成。\n记录人：陈明";
const excerpt = "输入回归已完成；系统分享仍待真机验证。";

describe("原文定位", () => {
  test("wording changes still land on the relevant source paragraph", () => {
    const range = locateExcerpt(source, excerpt);
    expect(range).not.toBeNull();
    const hit = source.slice(range!.start, range!.end);
    expect(hit).toContain("系统分享");
    expect(hit).not.toContain("桌面端");
  });

  test("exact long spans win over nearby short matches", () => {
    const text = "计划在 11 月 20 日开展系统分享真机联调；需要真机与测试账号。";
    const excerpt = "计划在 11 月 20 日开展系统分享真机联调";
    const range = locateExcerpt(text, excerpt);
    expect(range).toEqual({ start: 0, end: excerpt.length });
    expect(text.slice(range!.start, range!.end)).toBe(excerpt);
  });

  test("unrelated text does not invent a location", () => {
    expect(locateExcerpt("这是一段完全无关的说明。", "系统分享真机验证")).toBeNull();
    expect(locateExcerpt("", excerpt)).toBeNull();
  });
});

describe("导师发现与交回文案", () => {
  const answer = (text: string, evidenceKeys?: string[]): ChallengeAnswer => ({ questionKey: "evidence", text, selected: [], verdict: "OPEN", ...(evidenceKeys ? { evidenceKeys } : {}) });
  const question = (key: string, text: string): ChallengeQuestion => ({ key, title: key, excerpt: text, options: [] });

  test("real draft text is labelled 原文, absent conditions are labelled 待核对", () => {
    expect(mentorFinding(question("evidence", "输入回归已完成。"), answer("还有一处引用"), 0)).toMatchObject({ basisLabel: "原文", basis: "输入回归已完成。" });
    expect(mentorFinding(question("unknown", "从原记录找出尚未确认的条件；也可以写“目前不知道”。"), answer("不知道"), 1)).toMatchObject({ basisLabel: "待核对" });
    expect(mentorFinding(question("unknown", "系统分享的真机验证"), answer("保留"), 1)).toMatchObject({ basisLabel: "原文", basis: "系统分享的真机验证" });
    expect(mentorFinding(question("revision", "把刚才发现的缺口变成一条可执行的改稿要求。"), answer("补充真机验证计划"), 2)).toMatchObject({ basisLabel: "待核对" });
  });

  test("evidence binding survives the finding projection", () => {
    const finding = mentorFinding(question("evidence", "原句"), answer("回答", ["capture:a@h"]), 0);
    expect(finding.evidenceKey).toBe("capture:a@h");
  });

  test("steps follow the real question keys", () => {
    expect(rehearsalStep(question("unknown", "x"), 0).label).toBe("边界");
    expect(REHEARSAL_STEPS.map(step => step.label)).toEqual(["依据", "边界", "改稿"]);
  });

  test("handoff copy never turns a saved receipt into a new draft", () => {
    expect(handoffStatus("RUNNING")).toContain("正在处理");
    expect(handoffStatus("PAUSED")).toContain("已暂停");
    expect(handoffStatus("UNKNOWN")).toContain("没有新稿回执");
    for (const phase of ["RUNNING", "QUEUED", "READY", "WAITING_OBSERVATION", "WAITING_USER", "PAUSED", "COMPLETED", "UNKNOWN"]) {
      expect(handoffStatus(phase)).not.toContain("已保存新稿");
    }
  });
});
