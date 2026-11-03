/**
 * Track E 独立验收：工作态/进展/用量/Worker presence 的纯投影边界。
 *
 * 这些用例按 docs/FINAL/ProjectMemo_2026_11_03-12_决赛冲刺规划/04_工程验收/10_纵向演示与独立验收协议.md
 * 第 4 节反例（R01/R07/R10/R11）与 07_执行准备/03_鸿蒙与独立验收职责.md 的 FS-A01/FS-A02/FS-A04 验收条件编写，
 * 不是对现有实现的复述，也不复用现有测试文件。
 *
 * 失败即为独立验收发现的缺口：不删除断言、不放宽期望、不加 skip 换绿。
 */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { missionWorkState } from "@/lib/mission/workState";
import { reviewProgressOf } from "@/lib/mission/reviewProgress";
import { missionResourceUsageOf } from "@/lib/mission/resourceUsage";
import { clearWorkerPresenceForTest, readWorkerPresence, recordWorkerPresence } from "@/lib/mission/workerPresence";

const NOW = new Date("2026-11-03T03:00:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);
const ISO = (d: Date) => d.toISOString();

type MissionRow = Parameters<typeof missionWorkState>[0];
/** 真实读回把 Prisma 行整体展开传入投影；这里保留同样的额外列，避免只喂“好看”的字段。 */
const row = (over: Record<string, unknown>): MissionRow =>
  ({ id: "synthetic-mission", status: "READY", version: 3, ...over }) as unknown as MissionRow;
const display = (state: ReturnType<typeof missionWorkState>) =>
  `${state.phase} ${state.reasonCode} ${state.reasonText} ${state.actionLabel}`;

describe("FS-A02 停止请求在途（暂停/取消）必须在同一工作态里可见", () => {
  it("RUNNING 期间发起取消：保留 RUNNING 保护，同时明确“取消请求尚未结算”，不得显示已取消或已完成", () => {
    const state = missionWorkState(row({ status: "RUNNING", leaseUntil: at(60_000), cancelRequestedAt: NOW }), NOW);
    // 原 RUNNING 保护保留：停止请求不是终态，不能提前结束或放行恢复。
    expect(state.phase).toBe("RUNNING");
    expect(state.phase).not.toBe("COMPLETED");
    // FS-A02 验收：明确停止请求尚未结算；只显示 LEASE_ACTIVE“正在调查”不满足。
    expect(display(state)).not.toMatch(/LEASE_ACTIVE/);
    expect(display(state)).toMatch(/取消|停止|CANCEL/i);
  });

  it("RUNNING 期间发起暂停：保留 RUNNING 保护，同时明确“暂停请求尚未结算”", () => {
    const state = missionWorkState(row({ status: "RUNNING", leaseUntil: at(60_000), pauseRequestedAt: NOW }), NOW);
    expect(state.phase).toBe("RUNNING");
    expect(display(state)).not.toMatch(/LEASE_ACTIVE/);
    expect(display(state)).toMatch(/暂停|停止|PAUSE/i);
  });
});

describe("FS-A01 终态、取消与未结算效果同时保留", () => {
  it("已取消不显示成功完成", () => {
    const state = missionWorkState(row({ status: "CANCELLED" }), NOW);
    expect(state.phase).toBe("COMPLETED");
    expect(state.reasonCode).toBe("CANCELLED");
    expect(state.reasonText).toContain("取消");
    expect(display(state)).not.toContain("完成条件已通过");
  });

  it("原终态 SUCCEEDED 与未结算 UNKNOWN 效果必须同时可见，不能只留其一", () => {
    const state = missionWorkState(
      row({ status: "SUCCEEDED", lastErrorJson: { code: "EXTERNAL_UNKNOWN", message: "外部请求结果未知" } }),
      NOW,
    );
    const text = JSON.stringify(state);
    // 未结算效果保留
    expect(text).toMatch(/UNKNOWN|待核对/);
    // 原终态同样可见（不能把 SUCCEEDED 覆盖成纯 UNKNOWN）
    expect(text).toMatch(/SUCCEEDED|完成/);
  });
});

describe("无事件时间越界：等于边界即失效，不靠新事件触发", () => {
  it("RUNNING 租约恰好到期：不显示正在运行，freshness 不为 FRESH", () => {
    const state = missionWorkState(row({ status: "RUNNING", leaseUntil: NOW }), NOW);
    expect(state.phase).toBe("UNAVAILABLE");
    expect(state.reasonCode).toBe("LEASE_UNCONFIRMED");
    expect(state.freshness).toBe("UNAVAILABLE");
  });

  it("RUNNING 租约仍在有效窗口内：保留 RUNNING 并给出最近边界", () => {
    const lease = at(1);
    const state = missionWorkState(row({ status: "RUNNING", leaseUntil: lease }), NOW);
    expect(state.phase).toBe("RUNNING");
    expect(state.reasonCode).toBe("LEASE_ACTIVE");
    expect(state.nextBoundary).toBe(ISO(lease));
  });

  it("持续观察许可恰好到期：不能继续宣称按已授权条件检查", () => {
    const state = missionWorkState(
      row({
        status: "WAITING_INPUT",
        waitStateJson: { waitingFor: "OBSERVATION", startedAt: ISO(at(-3_600_000)) },
        planJson: { delegation: { mode: "BOUNDED_INVESTIGATION" } },
        continuationPolicyJson: { mode: "BOUNDED_INVESTIGATION", expiresAt: ISO(NOW) },
      }),
      NOW,
    );
    expect(state.phase).toBe("PAUSED");
    expect(state.reasonCode).toBe("DELEGATION_EXPIRED");
  });

  it("持续观察许可仍有效：进入等待观察，不外推成正在执行", () => {
    const expiresAt = at(1);
    const state = missionWorkState(
      row({
        status: "WAITING_INPUT",
        waitStateJson: { waitingFor: "OBSERVATION", startedAt: ISO(at(-3_600_000)) },
        planJson: { delegation: { mode: "BOUNDED_INVESTIGATION" } },
        continuationPolicyJson: { mode: "BOUNDED_INVESTIGATION", expiresAt: ISO(expiresAt) },
      }),
      NOW,
    );
    expect(state.phase).toBe("WAITING_OBSERVATION");
    expect(state.reasonCode).toBe("OBSERVATION_PENDING");
  });

  it("待批准提案恰好到期：必须回到“重新核对”，且不指向旧提案", () => {
    const state = missionWorkState(
      row({ status: "WAITING_APPROVAL", approvals: [{ id: "approval-old", expiresAt: NOW }] }),
      NOW,
    );
    expect(state.reasonCode).toBe("APPROVAL_EXPIRED");
    expect(state.exactApprovalRef).toBeNull();
    expect(state.actionLabel).toContain("重新核对");
  });

  it("待批准提案仍有效：只指向当前这一份提案与边界", () => {
    const expiresAt = at(1);
    const state = missionWorkState(
      row({ status: "WAITING_APPROVAL", approvals: [{ id: "approval-current", expiresAt }] }),
      NOW,
    );
    expect(state.reasonCode).toBe("APPROVAL_PENDING");
    expect(state.exactApprovalRef).toBe("approval-current");
    expect(state.nextBoundary).toBe(ISO(expiresAt));
  });
});

describe("E-RES-01 结果分层：用户自报、模拟、未知不升级为现实完成", () => {
  const baseInput = {
    steps: [{ status: "SUCCEEDED", resultJson: { data: {}, sources: [{ id: "capture:x", hash: "h" }] } }],
    outputs: [{ id: "o1", revision: 1, claimChecksJson: [{ status: "ENTAILS" }, { status: "CONTRADICTS" }, { status: "NOT_ENOUGH_INFORMATION" }] }],
    actions: [
      { id: "a-real", status: "DONE", resultCardId: "card-real", isSimulated: false },
      { id: "a-sim", status: "DONE", resultCardId: "card-sim", isSimulated: true },
    ],
    unknownSteps: 2,
  };

  it("用户填写完成只计为用户报告；模拟行动不计；独立支持仍为 0", () => {
    const progress = reviewProgressOf(baseInput);
    const cls = Object.fromEntries(progress.classes.map(item => [item.key, item.count]));
    expect(cls.userReported).toBe(1); // 只算真实行动的复盘回执
    expect(cls.independentlySupported).toBe(0); // 文本蕴含不等于独立支持
    expect(cls.executed).toBe(1); // 模拟行动不进入“已执行”
    expect(cls.counterExamples).toBe(1);
    expect(cls.unknown).toBe(3); // 1 条 claim 未知 + 2 个 UNKNOWN 步骤，不当作失败或没有
    expect(progress.policy).toBe("PROJECTION_FROM_EXISTING_STEPS_OUTPUTS_ACTIONS_RECEIPTS_NOT_REALITY_COMPLETION");
    expect(progress.classes.map(item => item.key)).not.toContain("completed");
  });

  it("未绑定货币费率时费用保持 UNPRICED/未知，不写成 0", () => {
    const usage = missionResourceUsageOf({ models: 3, tools: 4, inputTokens: 900, outputTokens: 120, unknownCalls: 1 });
    expect(usage.monetaryCost).toBeNull();
    expect(usage.pricingState).toBe("UNPRICED");
    expect(usage.coverageNote).toContain("1 次");
    expect(usage.costNote).toContain("不能核算");
  });
});

describe("R07 Worker presence 不能把“有心跳”当“已核对无变化”", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "final-e-presence-"));
  const envKeys = ["WORKER_PRESENCE_FILE", "PROJECTMEMO_RELEASE", "LLM_MODE"] as const;
  const saved = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  process.env.WORKER_PRESENCE_FILE = path.join(dir, "presence.json");

  afterEach(() => {
    clearWorkerPresenceForTest();
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    process.env.WORKER_PRESENCE_FILE = path.join(dir, "presence.json");
  });

  it("心跳新鲜但 release 不匹配：不得显示为正在有效观察", () => {
    process.env.PROJECTMEMO_RELEASE = "release-a";
    recordWorkerPresence({ workerId: "w1", scan: true, version: "1.0.0" });
    process.env.PROJECTMEMO_RELEASE = "release-b";
    const presence = readWorkerPresence(Date.now());
    expect(presence.identityMatches).toBe(false);
    expect(presence.mismatchReason).toBe("RELEASE_MISMATCH");
    expect(presence.status).toBe("STALE");
    expect(presence.isActivelyInspecting).toBe(false);
  });

  it("同一轮里其它扫描成功不能抹掉持续失败；只有干净整轮才清除", () => {
    recordWorkerPresence({ workerId: "w2", scan: true, failedScan: "OBSERVATION" });
    recordWorkerPresence({ workerId: "w2", scan: true });
    const failed = readWorkerPresence(Date.now());
    expect(failed.lastScanFailedAt).not.toBeNull();
    expect(failed.failedPhase).toBe("OBSERVATION");
    expect(failed.isActivelyInspecting).toBe(false);
    recordWorkerPresence({ workerId: "w2", scan: true, cleanCycle: true });
    const recovered = readWorkerPresence(Date.now());
    expect(recovered.lastScanFailedAt).toBeNull();
    expect(recovered.failedPhase).toBeNull();
  });
});
