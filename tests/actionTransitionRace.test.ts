import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { continuityDatabase } from "./helpers/continuityDatabase";

const isolated = continuityDatabase("action-transition-race");
let db: typeof import("@/lib/db").db;
let patch: typeof import("@/app/api/projects/[id]/actions/[actionId]/route").PATCH;

beforeAll(async () => {
  db = (await import("@/lib/db")).db;
  patch = (await import("@/app/api/projects/[id]/actions/[actionId]/route")).PATCH;
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await db.$disconnect(); void isolated; });

it.each(["DOING", "CANCELLED"] as const)("过期的 %s 请求不能覆盖另一端已完成的行动", async status => {
  const project = await db.project.create({ data: {
    title: "行动并发验证", goal: "保留完成回执", description: "独立测试库合成数据", scenario: "RESEARCH",
  } });
  const { createTestAuth } = await import("./testAuthHelper");
  const auth = await createTestAuth(project.id);
  const action = await db.actionItem.create({ data: { projectId: project.id, title: "核对实验数据" } });
  const { prepareActionResult, commitActionResult } = await import("@/lib/services/actionService");
  const prepared = await prepareActionResult(project.id, action.id, "已经核对实验数据并完成记录", true);
  let read!: () => void;
  let resume!: () => void;
  const ready = new Promise<void>(resolve => { read = resolve; });
  const barrier = new Promise<void>(resolve => { resume = resolve; });
  const findFirst = db.actionItem.findFirst.bind(db.actionItem);
  // 此调用方只 await 查询，测试在读取快照后暂停以复现另一端提交。
  const actionReader = db.actionItem as unknown as {
    findFirst: (...args: Parameters<typeof findFirst>) => Promise<Awaited<ReturnType<typeof findFirst>>>;
  };
  vi.spyOn(actionReader, "findFirst").mockImplementationOnce(async args => {
    const snapshot = await findFirst(args);
    read();
    await barrier;
    return snapshot;
  });
  const pending = patch(new Request("http://localhost/api/actions", {
    method: "PATCH", headers: { ...auth.headers, "Content-Type": "application/json" }, body: JSON.stringify({ status }),
  }), { params: Promise.resolve({ id: project.id, actionId: action.id }) });
  await ready;
  try {
    await db.$transaction(tx => commitActionResult(tx, prepared));
  } finally {
    resume();
  }
  expect((await pending).status).toBe(409);
  expect(await db.actionItem.findUniqueOrThrow({ where: { id: action.id } })).toMatchObject({
    status: "DONE", resultCardId: prepared.cardId, resultText: prepared.cleanResult,
  });
});
