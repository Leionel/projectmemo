process.env.PROJECT_STATE_ENABLED = "1";

import { describe, it, expect, afterAll } from "vitest";
import { db } from "@/lib/db";
import { checkInProjectState, refreshProjectState } from "@/lib/services/projectStateService";
import { GET as stateRoute } from "@/app/api/projects/[id]/state/route";
import {
  diffMeta,
  hasUnreadChange,
  healthSummary,
  nextStepText,
  stateDiffMeta,
  topConfirmedRisk,
} from "@/lib/client/projectStateView";
import type { ProjectStatePayload } from "@/lib/types/projectState";
import { createTestAuth } from "./testAuthHelper";

/**
 * Web 端「状态与变化」依赖的两件事：
 * 1. 呈现口径是纯函数，两端读法一致（UNKNOWN 不当 FALSE，无已确认风险不编造风险）；
 * 2. 已读基线来自服务端游标（按 consumerKey 归属），浏览器不在本地另存一份「上次看到哪」。
 */
describe("web 状态呈现口径", () => {
  it("五种变化类型各有确定符号，未知类型不会崩", () => {
    const glyphs = Object.values(stateDiffMeta).map((item) => item.glyph);
    expect(new Set(glyphs).size).toBe(glyphs.length);
    expect(stateDiffMeta.RESOLVED.glyph).toBe("✓");
    expect(stateDiffMeta.REGRESSED.glyph).toBe("!");
    expect(diffMeta("SOMETHING_NEW").glyph).toBe("→");
  });

  it("首次查看（没有游标）算未读，读到最新才算已读", () => {
    expect(hasUnreadChange(null, "snap-1")).toBe(true);
    expect(hasUnreadChange("", "snap-1")).toBe(true);
    expect(hasUnreadChange("snap-1", "snap-1")).toBe(false);
    expect(hasUnreadChange("snap-1", "snap-2")).toBe(true);
  });

  it("只把 truth=TRUE 的风险当作已确认风险", () => {
    const payload = {
      risks: [
        { stableKey: "r1", text: "证据不足的风险", truth: "UNKNOWN", severity: "HIGH", evidenceRefs: [], ruleId: "R1" },
        { stableKey: "r2", text: "已确认的风险", truth: "TRUE", severity: "MEDIUM", evidenceRefs: [], ruleId: "R2" },
      ],
      unknowns: [],
    } as unknown as Pick<ProjectStatePayload, "risks" | "unknowns">;
    expect(topConfirmedRisk(payload)?.text).toBe("已确认的风险");
    expect(nextStepText(payload)).toBe("先处理上方风险对应的任务。");
  });

  it("没有已确认风险时给出未知项的补充输入建议，而不是「没有风险」", () => {
    const payload = {
      health: "UNKNOWN",
      risks: [],
      unknowns: [{ predicate: "p", text: "消融实验是否完成未知", missingInputs: [], suggestedInputAction: "补一条实验记录" }],
    } as unknown as Pick<ProjectStatePayload, "health" | "risks" | "unknowns">;
    expect(topConfirmedRisk(payload)).toBeNull();
    expect(healthSummary(payload).label).toBe("信息不足，无法判断");
    expect(nextStepText(payload)).toBe("补一条实验记录");
  });

  it("既无风险也无未知项时才回到「继续推进当前待办」", () => {
    const payload = { health: "ON_TRACK", risks: [], unknowns: [] } as unknown as Pick<ProjectStatePayload, "health" | "risks" | "unknowns">;
    expect(healthSummary(payload).label).toBe("暂无已确认风险");
    expect(nextStepText(payload)).toBe("继续推进当前待办。");
  });
});

describe("GET /api/projects/[id]/state 的已读游标", () => {
  const createdProjectIds: string[] = [];
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdProjectIds.splice(0)) {
      await db.project.delete({ where: { id } }).catch(() => {});
    }
    for (const id of createdUserIds.splice(0)) {
      await db.user.delete({ where: { id } }).catch(() => {});
    }
  });

  async function readState(projectId: string, headers: Record<string, string>, consumerKey?: string) {
    const query = consumerKey ? `?consumerKey=${encodeURIComponent(consumerKey)}` : "";
    const request = new Request(`http://localhost/api/projects/${projectId}/state${query}`, { headers });
    const response = await stateRoute(request, { params: Promise.resolve({ id: projectId }) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  it("未带 consumerKey 时不返回游标；带游标的客户端读到自己的已读位置", async () => {
    const project = await db.project.create({
      data: { title: "Web 状态游标项目", description: "验证 Web 端从服务端读取已读基线", goal: "游标归属", scenario: "COMPETITION" },
    });
    createdProjectIds.push(project.id);
    const auth = await createTestAuth(project.id);
    createdUserIds.push(auth.user.id);

    const { snapshot } = await refreshProjectState(project.id);

    const anonymous = await readState(project.id, auth.headers);
    expect(anonymous.status).toBe(200);
    expect(anonymous.body.snapshot).not.toBeNull();
    expect(anonymous.body.lastSeenSnapshotId).toBeNull();

    const webKey = "web-test-install";
    const beforeCheckIn = await readState(project.id, auth.headers, webKey);
    expect(beforeCheckIn.body.lastSeenSnapshotId).toBeNull();

    await checkInProjectState(project.id, { displayedSnapshotId: snapshot.id, consumerKey: webKey });

    const afterCheckIn = await readState(project.id, auth.headers, webKey);
    expect(afterCheckIn.body.lastSeenSnapshotId).toBe(snapshot.id);
  });

  it("不同 consumerKey 的已读位置互不影响：Web 读过不会替鸿蒙端标记已读", async () => {
    const project = await db.project.create({
      data: { title: "Web 与设备游标隔离项目", description: "验证已读游标按客户端归属，不互相覆盖", goal: "游标隔离", scenario: "COMPETITION" },
    });
    createdProjectIds.push(project.id);
    const auth = await createTestAuth(project.id);
    createdUserIds.push(auth.user.id);

    const { snapshot } = await refreshProjectState(project.id);
    await checkInProjectState(project.id, { displayedSnapshotId: snapshot.id, consumerKey: "web-install" });

    const web = await readState(project.id, auth.headers, "web-install");
    const device = await readState(project.id, auth.headers, "device-install");
    expect(web.body.lastSeenSnapshotId).toBe(snapshot.id);
    expect(device.body.lastSeenSnapshotId).toBeNull();
  });

  it("未登录时仍然 401，不会因为新增查询参数放宽归属校验", async () => {
    const project = await db.project.create({
      data: { title: "Web 状态越权项目", description: "验证状态读取仍然要求登录与项目归属", goal: "越权防护", scenario: "COMPETITION" },
    });
    createdProjectIds.push(project.id);

    const response = await readState(project.id, {}, "web-test-install");
    expect(response.status).toBe(401);
  });
});
