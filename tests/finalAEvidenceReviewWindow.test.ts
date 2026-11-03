import { afterAll, describe, expect, it, vi } from "vitest";
// 独立临时库必须在 import lib/db 之前设置；文件内串行，不开文件并行。
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("final-a-evidence-review-window"));
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { readMissionBack } from "@/lib/mission/readback";
import { materialUseProjection } from "@/lib/mission/materialUseProjection";
import { sourceUse } from "@/lib/continuity/sourcePolicy";
import { effectiveContinuity } from "@/lib/continuity/directiveService";

process.env.WORKER_PRESENCE_FILE = path.join(isolated.dir, "worker-presence.json");
afterAll(async () => {
  await db.$disconnect();
  fs.rmSync(isolated.dir, { recursive: true, force: true });
});

/**
 * A-新3：证据审查有界窗口回归。
 *
 * 修复前行为（本文件记录、不保留红例）：`fitRows` 先取全 Mission 最近 21 条
 * `EVIDENCE_FIT_REVIEWED`，再按 `evidenceFit.premise.questionId` 过滤。其他 question 的
 * 新审查事件可以把目标 question 的审查挤出窗口，于是 readback 返回 items=[]/truncated=true，
 * 消费方容易误读成“从未审查”。
 *
 * 修复后：选中 questionId 时先用原生 SQL `json_extract(payloadJson,'$.evidenceFit.premise.questionId')`
 * 过滤再限额（最近 20 条窗口、最多展示 3 条）；未选中 question 时保留旧窗口行为并在
 * coverage/note 中诚实标注。输出 shape 对旧消费者保持兼容（items/truncated 不变，只增字段）。
 */

type Fixture = Awaited<ReturnType<typeof createFixture>>;

let seqCounter = 0;
function resetSeq() {
  seqCounter = 0;
}

async function createFixture(label: string) {
  const user = await db.user.create({
    data: { username: `evidence-window-${label}-${randomUUID()}`, displayName: `证据窗口 ${label}`, passwordHash: "unused" },
  });
  const project = await db.project.create({
    data: {
      title: `证据审查窗口 ${label}`,
      description: "SYNTHETIC_FINAL_A_EVIDENCE_WINDOW",
      goal: "核对有界证据审查窗口先筛后限",
      scenario: "RESEARCH",
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  const mission = await db.agentMission.create({
    data: {
      ownerUserId: user.id,
      projectId: project.id,
      createRequestId: `evidence-window-${randomUUID()}`,
      createPayloadHash: "synthetic-final-a-evidence-window",
      goal: "核对证据审查窗口",
      successCriteriaJson: [],
      constraintsJson: {},
      budgetJson: {},
    },
  });
  resetSeq();
  const addEvent = async (type: string, payload: unknown, createdAt?: Date) => {
    seqCounter += 1;
    const row = await db.agentMissionEvent.create({
      data: { missionId: mission.id, seq: seqCounter, type, payloadJson: payload as never, ...(createdAt ? { createdAt } : {}) },
    });
    return row;
  };
  return { user, project, mission, addEvent };
}

/** 与 readback 消费的 evidenceFit 摘要结构一致；questionId 为 undefined 时表示“未标注原问题”。 */
function reviewPayload(questionId?: string, seed = 0) {
  return {
    fitHash: `fit-${seed}-${questionId ?? "none"}`,
    review: { mode: "ANSWERING_EVIDENCE" },
    observationExcerpts: [],
    evidenceFit: {
      ruleVersion: "evidence-fit-v1",
      fitStatus: seed % 2 === 0 ? "FIT" : "PARTIAL",
      premise: { ...(questionId !== undefined ? { questionId } : {}), premiseHash: `premise-${seed}`, constraintsVersion: 1, scopeVersion: 1, measurement: "COUNT", checks: [] },
      groups: [],
      eligibleGroups: [],
      excludedGroups: [],
      unresolvedChecks: [],
      conflicts: [],
      coverage: {},
    },
  };
}

async function businessSnapshot(missionId: string) {
  const mission = await db.agentMission.findUniqueOrThrow({ where: { id: missionId }, select: { version: true, updatedAt: true, nextEventSeq: true, status: true } });
  return {
    version: mission.version,
    updatedAt: mission.updatedAt.toISOString(),
    nextEventSeq: mission.nextEventSeq,
    status: mission.status,
    events: await db.agentMissionEvent.count({ where: { missionId } }),
    steps: await db.agentMissionStep.count({ where: { missionId } }),
    outputs: await db.agentMissionOutput.count({ where: { missionId } }),
    receipts: await db.missionArtifactReceipt.count({ where: { missionId } }),
  };
}

async function createQuestion(fixture: Fixture) {
  const question = await fixture.addEvent("QUESTION", { question: "请补充同条件启动日志" });
  return question.id;
}

/** 24 条更新的其他 question 审查：修复前会把窗口占满，修复后不应影响目标 question。 */
async function addOtherQuestionReviews(fixture: Fixture, count = 24) {
  const now = Date.now();
  for (let index = 0; index < count; index++) {
    await fixture.addEvent("EVIDENCE_FIT_REVIEWED", reviewPayload(`other-question-${index}`, index), new Date(now - (index + 1) * 60_000));
  }
}

describe("A-新3 证据审查有界窗口：先按原问题过滤再限额", () => {
  it("21+ 条更新的其他 question 审查不再挤出目标 question，且修复后命中=3、零写入", async () => {
    const fixture = await createFixture("squeeze");
    const questionId = await createQuestion(fixture);
    // 目标 question 的 3 条审查较早（seq 小），随后 24 条其他 question 审查更新（seq 大）。
    for (let index = 0; index < 3; index++) {
      await fixture.addEvent("EVIDENCE_FIT_REVIEWED", reviewPayload(questionId, 100 + index), new Date(Date.now() - (10 - index) * 24 * 60 * 60 * 1000));
    }
    await addOtherQuestionReviews(fixture);
    const before = await businessSnapshot(fixture.mission.id);

    const readback = await readMissionBack(fixture.user.id, fixture.mission.id, { questionId });

    // 修复前这里会是 0（目标审查被 24 条更新的其他 question 审查挤出），修复后命中 3 条。
    expect(readback.evidenceReviews.items.length).toBe(3);
    expect(readback.evidenceReviews.items.length).toBeLessThanOrEqual(3);
    for (const item of readback.evidenceReviews.items) {
      expect((item as { premise?: { questionId?: string } }).premise?.questionId).toBe(questionId);
      expect(item.truthVerified).toBe(false);
    }
    // 目标问题自身只有 3 条、未超过 20 条窗口 → truncated=false；truncated 现在只表示该问题窗口溢出。
    expect(readback.evidenceReviews.truncated).toBe(false);
    expect(readback.evidenceReviews).toMatchObject({
      questionFiltered: true,
      questionId,
      windowLimit: 20,
      displayLimit: 3,
      inspected: 3,
    });
    expect(readback.evidenceReviews.note).toContain("先过滤");
    // workPacket 引用同一批审查条目，shape 保持 { items, truncated }。
    expect(readback.workPacket?.basis.evidenceReviews?.items.length).toBe(3);
    expect(readback.workPacket?.basis.evidenceReviews?.truncated).toBe(false);
    expect(readback.workPacket?.coverage.windows.find(window => window.name === "EVIDENCE_REVIEWS")?.note).toContain("过滤");

    // 读取前后零业务写入：版本/行数/事件序列号均不变。
    expect(await businessSnapshot(fixture.mission.id)).toEqual(before);
  });

  it("目标 question 自身超过 20 条时 truncated=true、仍最多展示 3 条且全部属于目标 question", async () => {
    const fixture = await createFixture("truncated");
    const questionId = await createQuestion(fixture);
    for (let index = 0; index < 22; index++) {
      await fixture.addEvent("EVIDENCE_FIT_REVIEWED", reviewPayload(questionId, 200 + index), new Date(Date.now() - (30 - index) * 60_000));
    }
    await addOtherQuestionReviews(fixture);
    const before = await businessSnapshot(fixture.mission.id);

    const readback = await readMissionBack(fixture.user.id, fixture.mission.id, { questionId });

    expect(readback.evidenceReviews.items.length).toBe(3);
    for (const item of readback.evidenceReviews.items) {
      expect((item as { premise?: { questionId?: string } }).premise?.questionId).toBe(questionId);
    }
    // 过滤后取 21 条判断截断 → 该问题窗口溢出，truncated=true；不是“没有记录”。
    expect(readback.evidenceReviews.truncated).toBe(true);
    expect(readback.evidenceReviews.inspected).toBe(21);
    expect(readback.workPacket?.basis.evidenceReviews?.truncated).toBe(true);
    expect(await businessSnapshot(fixture.mission.id)).toEqual(before);
  });

  it("未选中原问题时保留旧窗口行为（不按问题过滤）并诚实标注覆盖", async () => {
    const fixture = await createFixture("no-question");
    // 2 条无 questionId 的审查；旧行为即“最近 20 条里满足 questionId===undefined 的记录”，修复后保持一致。
    await fixture.addEvent("EVIDENCE_FIT_REVIEWED", reviewPayload(undefined, 1));
    await fixture.addEvent("EVIDENCE_FIT_REVIEWED", reviewPayload(undefined, 2));
    const before = await businessSnapshot(fixture.mission.id);

    const readback = await readMissionBack(fixture.user.id, fixture.mission.id);

    expect(readback.evidenceReviews.items.length).toBe(2);
    expect(readback.evidenceReviews.truncated).toBe(false);
    expect(readback.evidenceReviews).toMatchObject({ questionFiltered: false, questionId: null, windowLimit: 20 });
    expect(readback.evidenceReviews.note).toContain("未选中原问题");
    expect(await businessSnapshot(fixture.mission.id)).toEqual(before);
  });

  it("未选中原问题且窗口被其他 question 审查占满：保持旧行为（0 条 + truncated 真），不改成猜测", async () => {
    const fixture = await createFixture("no-question-squeezed");
    // 2 条无 questionId 的较早审查 + 24 条更新的其他 question 审查：旧窗口里目标记录为 0。
    await fixture.addEvent("EVIDENCE_FIT_REVIEWED", reviewPayload(undefined, 1), new Date(Date.now() - 20 * 60_000));
    await fixture.addEvent("EVIDENCE_FIT_REVIEWED", reviewPayload(undefined, 2), new Date(Date.now() - 19 * 60_000));
    await addOtherQuestionReviews(fixture);
    const before = await businessSnapshot(fixture.mission.id);

    const readback = await readMissionBack(fixture.user.id, fixture.mission.id);

    expect(readback.evidenceReviews.items.length).toBe(0);
    expect(readback.evidenceReviews.truncated).toBe(true);
    expect(readback.evidenceReviews.questionFiltered).toBe(false);
    expect(await businessSnapshot(fixture.mission.id)).toEqual(before);
  });
});

/**
 * A-新3 同请求只读复用（Lead 批准的最小方案）：
 * materialUseProjection 每请求只算一次 continuity view 并传给 sourceUse；readback 的责任读取复用
 * 同一事务已 ownedMission 的 mission。这里断言“预载 path 与无预载 path 判定完全一致”，
 * 特别是 suppressed 仍为 SUPPRESSED、independentEvidence=false，避免复用把安全判定短路。
 */
describe("A-新3 同请求只读复用：预载 continuity / preloaded mission 不改变判定", () => {
  it("预载 continuity 与无预载的 sourceUse 结果完全一致；materialUseProjection 逐 item currentUse 同源", async () => {
    const fixture = await createFixture("precomputed-continuity");
    const questionId = await createQuestion(fixture);
    const captures = await db.capture.createManyAndReturn({
      data: [
        { projectId: fixture.project.id, rawText: "启动日志原始记录：同条件两次观察。", sourceType: "记录" },
        { projectId: fixture.project.id, rawText: "另一条可正常使用的原始记录。", sourceType: "记录" },
      ],
    });
    const suppressedSourceId = `capture:${captures[0]!.id}`;
    const allowedSourceId = `capture:${captures[1]!.id}`;
    const { readProjectMaterial } = await import("@/lib/mission/sourceSignals");
    for (const sourceId of [suppressedSourceId, allowedSourceId]) {
      const material = await readProjectMaterial(fixture.project.id, sourceId);
      if (!material) throw new Error(`readProjectMaterial 失败：${sourceId}`);
      await fixture.addEvent("SOURCE_ARRIVED", { questionId, sourcePointer: { id: material.id, hash: material.hash } });
    }
    // 项目级 USE_SUPPRESSION 指令（missionId 为 null，对本次委托仍生效）。
    const user = await db.user.findUniqueOrThrow({ where: { id: fixture.user.id } });
    await db.agentDirectiveEvent.create({
      data: {
        ownerUserId: fixture.user.id, projectId: fixture.project.id, seq: user.continuitySeq + 1,
        commandId: `precomputed-directive-${randomUUID()}`, eventIndex: 0, inputHash: "a".repeat(64), directiveId: randomUUID(),
        kind: "USE_SUPPRESSION", operation: "SET", quote: "停止使用这条来源", sourceIdsJson: [suppressedSourceId],
        sourceJson: { origin: "TEST_PRECOMPUTED_CONTINUITY" }, admissionJson: { status: "DIRECT_APPLIED", kind: "USE_SUPPRESSION" },
        validFrom: new Date(Date.now() - 60_000), timezone: "Asia/Shanghai",
      },
    });
    await db.user.update({ where: { id: fixture.user.id }, data: { continuitySeq: { increment: 1 } } });
    const before = await businessSnapshot(fixture.mission.id);

    const direct = await db.$transaction(async tx => {
      const continuity = await effectiveContinuity(fixture.user.id, { projectId: fixture.project.id, missionId: fixture.mission.id }, tx);
      return {
        continuity,
        suppressedWithout: await sourceUse(fixture.user.id, fixture.project.id, suppressedSourceId, tx, { missionId: fixture.mission.id }),
        suppressedWith: await sourceUse(fixture.user.id, fixture.project.id, suppressedSourceId, tx, { missionId: fixture.mission.id }, { continuity }),
        allowedWithout: await sourceUse(fixture.user.id, fixture.project.id, allowedSourceId, tx, { missionId: fixture.mission.id }),
        allowedWith: await sourceUse(fixture.user.id, fixture.project.id, allowedSourceId, tx, { missionId: fixture.mission.id }, { continuity }),
      };
    });
    // 无预载路径与预载路径逐字段一致：复用只是省重复计算，不放宽任何判定。
    expect(direct.suppressedWith).toEqual(direct.suppressedWithout);
    expect(direct.allowedWith).toEqual(direct.allowedWithout);
    expect(direct.suppressedWith.state).toBe("SUPPRESSED");
    expect(direct.suppressedWith.independentEvidence).toBe(false);
    expect(direct.allowedWith.state).toBe("ALLOWED");

    // materialUseProjection：每 item 一次 SourcePolicy 判定，currentUse 与直接 sourceUse 同一判定；
    // 抑制来源 availability=UNAVAILABLE/excerpt=null，但历史 facts 不删。
    const projection = await db.$transaction(tx => materialUseProjection(tx, {
      missionId: fixture.mission.id, projectId: fixture.project.id, questionId, userId: fixture.user.id,
    }));
    expect(projection.items.length).toBe(2);
    expect(projection.coverage.sourcePolicyChecks).toBe(2);
    const suppressedItem = projection.items.find(item => item.sourcePointer.id === suppressedSourceId)!;
    const allowedItem = projection.items.find(item => item.sourcePointer.id === allowedSourceId)!;
    expect(suppressedItem.currentUse).toMatchObject({ state: "SUPPRESSED", independentEvidence: false, reason: "ROOT_SUPPRESSED" });
    expect(suppressedItem.availability).toBe("UNAVAILABLE");
    expect(suppressedItem.excerpt).toBeNull();
    expect(suppressedItem.facts.some(fact => fact.kind === "SAVED" || fact.kind === "CANDIDATE")).toBe(true);
    expect(allowedItem.currentUse).toMatchObject({ state: "ALLOWED", independentEvidence: true });
    expect(allowedItem.availability).toBe("CURRENT");
    // 读取前后零业务写入。
    expect(await businessSnapshot(fixture.mission.id)).toEqual(before);
  });
});
