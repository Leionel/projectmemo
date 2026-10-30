import { expect, test, vi } from "vitest";
import { runWorkerCycle, type WorkerCycleState } from "@/lib/mission/workerCycle";

test("持续聊天积压下原循环轮换，两类任务各获一半机会且每轮最多运行一个", async () => {
  const state: WorkerCycleState = { first: "CONVERSATION", nextScanAt: 0 };
  const conversation = vi.fn(async () => true), mission = vi.fn(async () => true);
  const scan = vi.fn(async () => undefined);
  for (let i = 0; i < 100; i++) await runWorkerCycle(state, { conversation, mission, scan: [{ name: "scan", run: scan }], onError: vi.fn() }, 1000 + i);
  expect(conversation).toHaveBeenCalledTimes(50); expect(mission).toHaveBeenCalledTimes(50); expect(scan).toHaveBeenCalledTimes(1);
});
test("扫描或一类队列失败仍给其他队列机会；失败扫描退避、不伪称成功", async () => {
  const state: WorkerCycleState = { first: "CONVERSATION", nextScanAt: 0 }, onError = vi.fn();
  const failing = vi.fn(async () => { throw new Error("isolated failure"); }), otherScan = vi.fn(async () => undefined);
  const operations = { scan: [{ name: "bad", run: failing }, { name: "good", run: otherScan }], conversation: failing, mission: vi.fn(async () => true), onError };
  expect(await runWorkerCycle(state, operations, 1000)).toEqual({ ran: true, queue: "MISSION", failures: 2 });
  expect(otherScan).toHaveBeenCalledTimes(1);
  await runWorkerCycle(state, operations, 2000); expect(otherScan).toHaveBeenCalledTimes(1);
  await runWorkerCycle(state, operations, 16000); expect(otherScan).toHaveBeenCalledTimes(2);
  expect(onError.mock.calls.map(c => c[0])).toContain("CONVERSATION");
});
test("一类队列空闲不浪费另一类机会；同时为空不会制造已运行", async () => {
  const state: WorkerCycleState = { first: "MISSION", nextScanAt: 0 }, conversation = vi.fn(async () => true);
  const operations = { scan: [], conversation, mission: vi.fn(async () => false), onError: vi.fn() };
  expect((await runWorkerCycle(state, operations)).queue).toBe("CONVERSATION");
  conversation.mockResolvedValue(false); expect((await runWorkerCycle(state, operations)).ran).toBe(false);
});
