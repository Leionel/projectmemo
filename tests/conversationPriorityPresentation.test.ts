import { describe, expect, it } from "vitest";
import { presentPriority } from "@/lib/conversation/priorityPresentation";
import type { PriorityReason } from "@/lib/types/conversation";

const reason = (overrides: Partial<PriorityReason>): PriorityReason => ({
  projectId: "p1", importance: "长期重要性未明确", urgency: "未记录项目截止日", blocking: "观察范围内没有等待回应的委托",
  effort: "本次投入未知", preference: "未记录明确偏好", tradeoff: "时效与长期重要性分开判断；未知投入时先确认可完成范围。",
  unknown: [], basis: "USER_AND_STATE", ...overrides,
});

describe("presentPriority 映射", () => {
  it("默认只输出有信息量的判断要点，未知维度转为“尚未明确/尚未提供”", () => {
    const view = presentPriority(reason({}));
    expect(view.headlines).toEqual(["长期重要性尚未明确", "本次可投入时间尚未提供"]);
    expect(view.basis).toBe("依据：项目状态与你标记的偏好");
  });

  it("截止日、阻塞、未知重要性与投入分别映射为短句", () => {
    const view = presentPriority(reason({
      urgency: "距项目截止日约 5 天", blocking: "2 项等待回应，1 项暂停或失败",
      unknown: ["目标重要性", "投入"],
    }));
    expect(view.headlines).toEqual([
      "距截止日约 5 天",
      "2 项等待回应，1 项暂停或失败",
      "长期重要性尚未明确",
      "本次可投入时间尚未提供",
    ]);
  });

  it("过期截止日提示核对适用阶段，不生成新的紧迫结论", () => {
    const view = presentPriority(reason({ urgency: "项目截止日已过，请核对适用阶段" }));
    expect(view.headlines[0]).toBe("项目截止日已过，需核对适用阶段");
  });

  it("完整依据保留原始字段文本，UNKNOWN 不被转成确定判断", () => {
    const view = presentPriority(reason({
      importance: "你标记的重要性：4/5", effort: "你估计本次投入约 90 分钟",
      preference: "先做汇报框架", unknown: ["目标重要性"],
    }));
    expect(view.detail).toContain("重要性：你标记的重要性：4/5");
    expect(view.detail).toContain("可投入时间：你估计本次投入约 90 分钟");
    expect(view.detail).toContain("你的偏好：先做汇报框架");
    expect(view.detail).toContain("待明确：目标重要性");
    expect(view.headlines.join("\n")).not.toContain("低优先级");
    expect(view.headlines.join("\n")).not.toContain("不紧急");
  });

  it("模型建议与用户偏好依据分别标注", () => {
    expect(presentPriority(reason({ basis: "MODEL_ADVICE" })).basis).toBe("依据：模型建议，可纠正");
  });

  it("要点最多保留 4 条", () => {
    const view = presentPriority(reason({
      urgency: "距项目截止日约 2 天", blocking: "1 项等待回应，0 项暂停或失败",
      unknown: ["目标重要性"],
    }));
    expect(view.headlines.length).toBeLessThanOrEqual(4);
  });
});
