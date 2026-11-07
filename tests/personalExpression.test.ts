import { afterAll, describe, expect, it, vi } from "vitest";
const isolated = await vi.hoisted(async () =>
  (await import("./helpers/continuityDatabase")).continuityDatabase("personal-expression"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { detectPersonalExpressions, suggestFromExpression } from "@/lib/memory/personalExpression";
import { commandPersonalMemory, listPendingCandidates, listPersonalMemory } from "@/lib/memory/personalMemoryService";

afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });
const seed = () => db.user.create({ data: { username: "expr-" + crypto.randomUUID().slice(0, 8), displayName: "x", passwordHash: "fixture" } });

const statements = (text: string) => detectPersonalExpressions(text).map(item => item.statement);

describe("个人表达识别", () => {
  it("识别长期偏好、背景和长期关注", () => {
    expect(detectPersonalExpressions("以后技术讨论先给结论，再展开。")).toEqual([{ statement: "以后技术讨论先给结论，再展开", kind: "PREFERENCE" }]);
    expect(detectPersonalExpressions("我习惯先跑小规模实验")[0].kind).toBe("PREFERENCE");
    expect(detectPersonalExpressions("我是计算机专业大三学生")[0].kind).toBe("BACKGROUND");
    expect(detectPersonalExpressions("我平时用 Python 做实验")[0].kind).toBe("BACKGROUND");
    expect(detectPersonalExpressions("我一直在关注端侧模型部署")[0].kind).toBe("FOCUS");
  });
  it("不把临时、假设、提问和项目内要求当成长期记忆", () => {
    for (const text of ["这次先给结论吧", "以后这个项目都用方案B", "如果我习惯先写结论会怎样", "我一般这样写可以吗？", "我习惯今天先做这个", "下一步怎么做"]) expect(statements(text)).toEqual([]);
  });
  it("拒绝敏感内容和他人转述", () => {
    for (const text of ["我习惯把密码写在便签上", "我通常每月工资都存起来", "以后都按他说的方式处理"]) expect(statements(text)).toEqual([]);
  });
  it("长文本不扫描，单次最多两条，重复只算一条", () => {
    expect(statements("我习惯先写测试。".repeat(80))).toEqual([]);
    expect(statements("我习惯先写测试。我习惯先写测试。")).toEqual(["我习惯先写测试"]);
    expect(statements("我习惯先写测试。我喜欢简短回答。我更喜欢先看结论。我通常晚上工作。")).toHaveLength(2);
  });
});

describe("日常输入生成候选", () => {
  it("只生成待确认候选，确认后才生效", async () => {
    const user = await seed();
    expect(await suggestFromExpression(user.id, "我习惯先跑小规模实验。", { via: "CONVERSATION" })).toBe(1);
    expect((await listPersonalMemory(user.id, {})).items).toHaveLength(0);
    const [candidate] = (await listPendingCandidates(user.id)).items;
    expect(candidate.statement).toBe("我习惯先跑小规模实验");
    expect(candidate.basis).toContain("讨论");
    await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "CONFIRM_CANDIDATE", claimId: candidate.claimId, expectedRevision: candidate.revision, frozenContentHash: candidate.contentHash });
    expect((await listPersonalMemory(user.id, {})).items.map(item => item.statement)).toEqual(["我习惯先跑小规模实验"]);
  });
  it("拒绝后同一句不再提议，已保存的内容也不重复提议", async () => {
    const user = await seed();
    await suggestFromExpression(user.id, "我习惯先写结论", { via: "CAPTURE" });
    const [candidate] = (await listPendingCandidates(user.id)).items;
    await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "REJECT_CANDIDATE", claimId: candidate.claimId, expectedRevision: candidate.revision });
    expect(await suggestFromExpression(user.id, "我习惯先写结论", { via: "CONVERSATION" })).toBe(0);
    await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "ADD_EXPLICIT", quote: "以后回答先给结论", kind: "PREFERENCE" });
    expect(await suggestFromExpression(user.id, "以后回答先给结论", { via: "CONVERSATION" })).toBe(0);
  });
  it("关闭开关后不再提议；累积上限内不堆积；异常不影响调用方", async () => {
    const user = await seed();
    await db.userMemoryPolicy.create({ data: { ownerUserId: user.id, expressionSuggestEnabled: false } });
    expect(await suggestFromExpression(user.id, "我习惯先写结论", { via: "CONVERSATION" })).toBe(0);
    const other = await seed();
    for (let i = 0; i < 14; i++) await suggestFromExpression(other.id, `我习惯第${i}种写法`, { via: "CONVERSATION" });
    expect((await listPendingCandidates(other.id)).items).toHaveLength(12);
    await expect(suggestFromExpression("missing-user", "我习惯先写结论", { via: "CONVERSATION" })).resolves.toBe(0);
  });
});
